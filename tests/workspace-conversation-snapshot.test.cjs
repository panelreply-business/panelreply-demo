'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { Readable } = require('node:stream');
const { EventEmitter } = require('node:events');
const { digest } = require('../workspace/store.cjs');
const { openProductStore } = require('../workspace/products.cjs');
const { hashPassword } = require('../workspace/auth.cjs');
const { createWorkspaceApp } = require('../workspace/api.cjs');

const START = Date.parse('2026-11-23T15:00:00.000Z');
const ORIGIN = 'http://127.0.0.1:10001';
const HASH = hashPassword('Synthetic callback snapshot password 2026!');
const key = () => crypto.randomUUID();
const DETAIL_SQL = 'SELECT * FROM leads WHERE id = ? AND business_id = ?';
const LIST_SQL = 'SELECT * FROM leads WHERE business_id = ? ORDER BY created_at DESC, rowid DESC';
const AUDIT_SQL = 'SELECT * FROM audit WHERE business_id = ? AND lead_id = ? ORDER BY created_at, rowid';
const MESSAGES_SQL = 'SELECT role, text FROM messages WHERE lead_id = ? AND business_id = ? ORDER BY position';
const taskInput = leadVersion => ({ leadVersion, kind: 'callback', dueAt: '2026-11-23T16:00:00.000Z', timeZone: 'America/Detroit', notes: 'Synthetic task.' });

async function request(app, headers, url) {
  const req = Readable.from([]);
  Object.assign(req, { method: 'GET', url, headers: { host: '127.0.0.1:10001', ...headers }, socket: { remoteAddress: '127.0.0.1' } });
  const res = new EventEmitter();
  res.writableEnded = false; res.destroyed = false;
  res.writeHead = (status, values) => { res.status = status; res.headers = values; };
  res.end = value => { res.buffer = value === undefined ? Buffer.alloc(0) : Buffer.from(value); res.writableEnded = true; };
  await app.handler(req, res);
  return { status: res.status, body: JSON.parse(res.buffer.toString('utf8')) };
}

async function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'panelreply-callback-snapshot-'));
  const dataDir = path.join(directory, 'data');
  const reader = openProductStore({ dataDir, product: 'callback', now: () => START });
  let writer;
  t.after(() => { writer?.close(); reader.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  const passwordHash = await HASH;
  const actor = reader.createBusinessOwner({ businessName: 'Callback snapshot fixture', username: 'callback-snapshot-a@example.test', passwordHash });
  const other = reader.createBusinessOwner({ businessName: 'Other callback fixture', username: 'callback-snapshot-b@example.test', passwordHash });
  const input = name => ({ customerName: name, phone: '+12485550123', job: 'Install a garage EV charger', zip: '48315',
    callbackWindow: 'Tomorrow afternoon', requestedWorkDate: 'Next month', contactPermission: 'requested_callback',
    conversation: [{ role: 'customer', text: name + ': Please call me about the charger.' }] });
  const lead = reader.createLead(actor, input('First synthetic request'), key()).lead;
  const second = reader.createLead(actor, input('Second synthetic request'), key()).lead;
  const unrelated = reader.createLead(other, input('Other owner synthetic request'), key()).lead;
  const savedList = reader.listLeads(actor);
  writer = openProductStore({ dataDir, product: 'callback', now: () => START, create: false });
  const app = createWorkspaceApp({ store: reader, product: 'callback', origin: ORIGIN });
  function login(owner) {
    const token = crypto.randomBytes(32).toString('base64url');
    reader.createSession(owner.id, digest(token));
    return { cookie: app.auth.cookie(token).split(';')[0] };
  }
  return { reader, writer, actor, other, lead, second, unrelated, savedList, app, headers: login(actor), otherHeaders: login(other), url: '/api/leads/' + lead.id };
}

// The hook runs after the actual SQLite result returns. A separate connection
// commits through public mutations. Results, flags, audits and transaction
// behavior remain native; only the ordering of the two connections is fixed.
function afterRead(t, sqlToPause, method, matches, mutate) {
  const prepare = DatabaseSync.prototype.prepare;
  const observed = { commits: 0, result: null };
  let fired = false;
  t.mock.method(DatabaseSync.prototype, 'prepare', function (sql) {
    const statement = prepare.call(this, sql);
    if (!fired && sql === sqlToPause) {
      const read = statement[method];
      statement[method] = function (...args) {
        const value = read.apply(this, args);
        if (!fired && matches(value, args)) {
          fired = true;
          observed.result = mutate();
          observed.commits += 1;
        }
        return value;
      };
    }
    return statement;
  });
  return observed;
}
function afterLead(t, f, mutate) { return afterRead(t, DETAIL_SQL, 'get', row => row?.id === f.lead.id, mutate); }
function afterList(t, f, mutate) { return afterRead(t, LIST_SQL, 'all', (_, args) => args[0] === f.actor.businessId, mutate); }
function connection(t, f) {
  const prepare = DatabaseSync.prototype.prepare;
  let db;
  const mock = t.mock.method(DatabaseSync.prototype, 'prepare', function (sql) { db ??= this; return prepare.call(this, sql); });
  try { f.reader.getLead(f.actor, f.lead.id); }
  finally { mock.mock.restore(); }
  assert.ok(db);
  return db;
}

test('callback detail binds notes and status to the revision and audit read before a concurrent edit', async t => {
  const f = await fixture(t);
  const race = afterLead(t, f, () => f.writer.updateLead(f.actor, f.lead.id, { version: f.lead.version, status: 'contacted', notes: 'Changed note Ω.' }));
  const response = await request(f.app, f.headers, f.url);
  assert.equal(race.commits, 1); assert.equal(response.status, 200);
  assert.deepEqual(response.body.lead, f.lead);
  assert.deepEqual(f.reader.getLead(f.actor, f.lead.id), race.result);
  assert.equal(race.result.version, f.lead.version + 1);
  assert.equal(race.result.status, 'contacted'); assert.equal(race.result.notes, 'Changed note Ω.');
  assert.equal(race.result.audit.at(-1).version, race.result.version);
  assert.throws(() => f.reader.updateLead(f.actor, f.lead.id, { version: f.lead.version, status: f.lead.status, notes: 'Stale change.' }), { code: 'version_conflict' });
});

test('callback detail cannot combine an earlier revision with a deleted conversation and later audit', async t => {
  const f = await fixture(t);
  const race = afterLead(t, f, () => f.writer.deleteLeadConversation(f.actor, f.lead.id, { version: f.lead.version, confirmation: 'DELETE' }, key()));
  const response = await request(f.app, f.headers, f.url);
  assert.equal(race.commits, 1); assert.equal(response.status, 200);
  assert.deepEqual(response.body.lead, f.lead);
  const current = f.reader.getLead(f.actor, f.lead.id);
  assert.equal(current.version, f.lead.version + 1); assert.deepEqual(current.conversation, []);
  assert.equal(current.audit.at(-1).action, 'lead.conversation_deleted');
  assert.equal(current.audit.at(-1).version, current.version);
  assert.deepEqual(f.reader.getLead(f.other, f.unrelated.id), f.unrelated);
  assert.equal((await request(f.app, f.otherHeaders, f.url)).status, 404);
});

test('callback list holds one snapshot across a safety hold while fresh task mutations remain blocked', async t => {
  const f = await fixture(t);
  const race = afterList(t, f, () => f.writer.holdPhone(f.actor, f.lead.phone));
  const response = await request(f.app, f.headers, '/api/leads');
  assert.equal(race.commits, 1); assert.equal(response.status, 200);
  assert.deepEqual(response.body.leads, f.savedList);
  const latest = f.reader.listLeads(f.actor);
  assert.ok(latest.every(lead => lead.version === 2 && lead.safetyHold && !lead.contactAllowed && lead.status === 'needs_review'));
  assert.ok(latest.every(lead => lead.audit.at(-1).action === 'safety.held' && lead.audit.at(-1).version === lead.version));
  assert.throws(() => f.reader.createCallbackTask(f.actor, f.lead.id, taskInput(f.lead.version), key()), { code: 'version_conflict' });
  assert.throws(() => f.reader.createCallbackTask(f.actor, f.lead.id, taskInput(2), key()), { code: 'safety_review_required' });
  assert.equal(f.reader.listCallbackTasks(f.actor).tasks.length, 0);
  assert.deepEqual(f.reader.getLead(f.other, f.unrelated.id), f.unrelated);
});

test('callback detail keeps STOP flags with their saved revision and rejects contact mutations after STOP', async t => {
  const f = await fixture(t);
  const race = afterLead(t, f, () => f.writer.suppressPhone(f.actor, f.lead.phone));
  const response = await request(f.app, f.headers, f.url);
  assert.equal(race.commits, 1); assert.equal(response.status, 200);
  assert.deepEqual(response.body.lead, f.lead);
  const latest = f.reader.getLead(f.actor, f.lead.id);
  assert.equal(latest.version, f.lead.version + 1); assert.equal(latest.status, 'needs_review');
  assert.equal(latest.optedOut, true); assert.equal(latest.contactPermission, 'opted_out'); assert.equal(latest.contactAllowed, false);
  assert.throws(() => f.reader.createCallbackTask(f.actor, f.lead.id, taskInput(f.lead.version), key()), { code: 'version_conflict' });
  assert.throws(() => f.reader.createCallbackTask(f.actor, f.lead.id, taskInput(latest.version), key()), { code: 'contact_blocked' });
  assert.throws(() => f.reader.updateLead(f.actor, f.lead.id, { version: latest.version, status: 'contacted' }), { code: 'contact_blocked' });
  assert.deepEqual(f.reader.getLead(f.other, f.unrelated.id), f.unrelated);
});

test('callback list keeps later records in the same snapshot after the first record is materialized', async t => {
  const f = await fixture(t);
  const first = f.savedList[0], later = f.savedList[1];
  const race = afterRead(t, AUDIT_SQL, 'all', (_, args) => args[0] === f.actor.businessId && args[1] === first.id,
    () => f.writer.updateLead(f.actor, later.id, { version: later.version, status: 'contacted', notes: 'Changed during list materialization.' }));
  const response = await request(f.app, f.headers, '/api/leads');
  assert.equal(race.commits, 1); assert.equal(response.status, 200);
  assert.deepEqual(response.body.leads, f.savedList);
  assert.deepEqual(f.reader.getLead(f.actor, later.id), race.result);
  assert.deepEqual(f.reader.getLead(f.actor, first.id), first);
});

test('callback detail and list read failures release owned snapshots without writes or stale later reads', async t => {
  const f = await fixture(t), db = connection(t, f);
  const changes = db.prepare('SELECT total_changes() AS n').get().n;
  for (const read of [() => f.reader.getLead(f.actor, f.lead.id), () => f.reader.listLeads(f.actor)]) {
    const prepare = DatabaseSync.prototype.prepare;
    let fail = true;
    const mock = t.mock.method(DatabaseSync.prototype, 'prepare', function (sql) {
      if (fail && sql === MESSAGES_SQL) { fail = false; throw new Error('Synthetic conversation read failure'); }
      return prepare.call(this, sql);
    });
    try { assert.throws(read, /Synthetic conversation read failure/); }
    finally { mock.mock.restore(); }
    assert.equal(fail, false); assert.equal(db.isTransaction, false);
    assert.equal(db.prepare('SELECT total_changes() AS n').get().n, changes);
  }
  const updated = f.writer.updateLead(f.actor, f.lead.id, { version: f.lead.version, status: f.lead.status, notes: 'Written after failed reads.' });
  assert.deepEqual(f.reader.getLead(f.actor, f.lead.id), updated);
  assert.ok(f.reader.listLeads(f.actor).some(lead => lead.id === updated.id && lead.version === updated.version));
  const saved = f.reader.updateLead(f.actor, f.lead.id, { version: updated.version, status: updated.status, notes: 'The reader still writes.' });
  assert.equal(saved.version, updated.version + 1);
});

test('callback reads leave a caller read snapshot open across later deletion and missing-record errors', async t => {
  const f = await fixture(t), db = connection(t, f);
  db.exec('BEGIN');
  try {
    assert.deepEqual(f.reader.getLead(f.actor, f.lead.id), f.lead);
    f.writer.deleteLeadConversation(f.actor, f.lead.id, { version: f.lead.version, confirmation: 'DELETE' }, key());
    assert.throws(() => f.reader.getLead(f.actor, key()), { code: 'not_found' });
    assert.equal(db.isTransaction, true);
    assert.deepEqual(f.reader.getLead(f.actor, f.lead.id), f.lead);
    assert.deepEqual(f.reader.listLeads(f.actor), f.savedList);
    assert.equal(db.isTransaction, true);
  } finally { if (db.isTransaction) db.exec('ROLLBACK'); }
  assert.deepEqual(f.reader.getLead(f.actor, f.lead.id).conversation, []);
  assert.equal(f.reader.getLead(f.actor, f.lead.id).version, f.lead.version + 1);
});

test('callback business export retains its outer snapshot through nested request reads and a concurrent hold', async t => {
  const f = await fixture(t);
  const created = f.reader.createCallbackTask(f.actor, f.lead.id, taskInput(f.lead.version), key());
  const before = f.reader.exportBusiness(f.actor);
  const race = afterList(t, f, () => f.writer.holdPhone(f.actor, f.lead.phone));
  const exported = f.reader.exportBusiness(f.actor);
  assert.equal(race.commits, 1);
  assert.deepEqual(exported, before);
  const current = f.reader.getLead(f.actor, f.lead.id);
  assert.equal(current.version, created.lead.version + 1); assert.equal(current.contactAllowed, false);
  const tasks = f.reader.listCallbackTasks(f.actor).tasks;
  assert.equal(tasks.length, 1); assert.equal(tasks[0].blockReason, 'safety_review_required');
  assert.equal(tasks[0].leadVersion, current.version);
});
