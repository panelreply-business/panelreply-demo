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
const { openStore, SCHEMAS, SCHEMA_VERSION, digest } = require('../workspace/store.cjs');
const { hashPassword, csrfFor } = require('../workspace/auth.cjs');
const { createWorkspaceApp } = require('../workspace/api.cjs');
const { validateDatabase, createEncryptedBackup, restoreEncryptedBackup } = require('../workspace/backup.cjs');

const START = Date.parse('2026-11-23T15:00:00.000Z');
const MAX_TIME = 8640000000000000;
const MAX_REVISION = Number.MAX_SAFE_INTEGER;
const HASH = hashPassword('Synthetic request integrity password 2026!');
const PASSPHRASE = 'Synthetic request recovery passphrase 2026!';
const ORIGIN = 'http://127.0.0.1:10001';
const INPUT = { customerName: 'Synthetic Request Integrity', phone: '+15865550101', job: 'Replace a garage outlet',
  zip: '48315', callbackWindow: 'After four', requestedWorkDate: 'Next week', contactPermission: 'requested_callback',
  conversation: [{ role: 'customer', text: 'Please call about replacing the outlet.' }] };
const key = () => crypto.randomUUID();
const confirmed = version => ({ version, confirmation: 'DELETE' });

async function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'panelreply-request-integrity-'));
  let at = START, step = 0, calls = 0;
  const now = () => { const result = at; at += step; return result; };
  const store = openStore({ dataDir: path.join(directory, 'data'), now });
  const passwordHash = await HASH;
  const owner = store.createBusinessOwner({ businessName: 'Synthetic Integrity', username: 'owner@example.test', passwordHash });
  const other = store.createBusinessOwner({ businessName: 'Other Integrity', username: 'other@example.test', passwordHash });
  const app = createWorkspaceApp({ store, origin: ORIGIN, conversationProvider: { kind: 'fake', async generate() {
    calls++; return { changes: [], clarify: [], answerTopics: [], intent: 'continue' };
  } } });
  t.after(() => { app.close(); store.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  const f = { directory, store, owner, other, app, get providerCalls() { return calls; },
    setClock(value, increment = 0) { at = value; step = increment; },
    create(input = {}, operationKey = key(), actor = owner) { return store.createLead(actor, { ...INPUT, ...input }, operationKey); },
    task(lead) { return store.createCallbackTask(owner, lead.id, { leadVersion: lead.version, kind: 'callback',
      dueAt: '2026-12-01T15:00:00.000Z', timeZone: 'UTC', notes: 'Retain the linked task' }, key()); },
    db(action) { const db = new DatabaseSync(store.filename, { enableForeignKeyConstraints: true }); try { return action(db); } finally { db.close(); } },
    snapshot() { return this.db(db => Object.fromEntries(Object.keys(SCHEMAS[SCHEMA_VERSION].tables)
      .filter(table => !['sessions', 'login_attempts'].includes(table))
      .map(table => [table, db.prepare('SELECT * FROM ' + table + ' ORDER BY rowid').all().map(row => ({ ...row }))]))); },
    validate() { return this.db(db => validateDatabase(db)); },
    headers() { const token = crypto.randomBytes(32).toString('base64url'); store.createSession(owner.id, digest(token));
      return { cookie: app.auth.cookie(token).split(';')[0], 'x-csrf-token': csrfFor(token), 'x-workspace-session': csrfFor(token) }; }
  };
  return f;
}

async function preview(f, headers, input) {
  const req = Readable.from([JSON.stringify(input)]);
  Object.assign(req, { method: 'POST', url: '/api/preview', headers: { host: '127.0.0.1:10001', origin: ORIGIN,
    'content-type': 'application/json', ...headers }, socket: { remoteAddress: '127.0.0.1' } });
  const res = new EventEmitter(); res.writableEnded = false; res.destroyed = false;
  res.writeHead = (status, responseHeaders) => { res.status = status; res.headers = responseHeaders; };
  res.end = body => { res.text = body === undefined ? '' : String(body); res.writableEnded = true; };
  await f.app.handler(req, res);
  return { status: res.status, body: res.text ? JSON.parse(res.text) : null };
}

test('new request writes reject invalid clocks while exact create retries preserve the saved result', async t => {
  const f = await fixture(t), operationKey = key(), saved = f.create({}, operationKey).lead;
  const before = f.snapshot();
  for (const invalid of [-1, 0.5, NaN, Infinity, MAX_TIME + 1]) {
    f.setClock(invalid);
    assert.throws(() => f.create(), { code: 'clock_unavailable', status: 503 });
    const retry = f.create({}, operationKey);
    assert.equal(retry.created, false); assert.deepEqual(retry.lead, saved);
    assert.deepEqual(f.snapshot(), before);
  }
  f.setClock(START + 1); assert.equal(f.create().created, true); f.validate();
});

test('a backward request edit preserves its fields, history and linked callback task', async t => {
  const f = await fixture(t), saved = f.task(f.create().lead).lead, before = f.snapshot();
  f.setClock(START - 1000);
  assert.throws(() => f.store.updateLead(f.owner, saved.id, { version: saved.version, status: 'new', notes: 'Must not save' }), { code: 'clock_unavailable', status: 503 });
  assert.deepEqual(f.snapshot(), before); f.validate();
  f.setClock(START + 1000);
  const corrected = f.store.updateLead(f.owner, saved.id, { version: saved.version, status: 'new', notes: 'Saved after clock recovery' });
  assert.equal(corrected.version, saved.version + 1); assert.equal(corrected.updatedAt, new Date(START + 1000).toISOString());
  assert.equal(f.store.listCallbackTasks(f.owner).tasks[0].leadVersion, corrected.version);
  assert.deepEqual(f.snapshot().callback_tasks, before.callback_tasks); f.validate();
});

test('request deletion paths reject backward clocks before removing messages, tasks or receipts', async t => {
  const f = await fixture(t), saved = f.task(f.create().lead).lead, before = f.snapshot();
  f.setClock(START - 1000);
  for (const method of ['deleteLead', 'deleteLeadConversation']) {
    assert.throws(() => f.store[method](f.owner, saved.id, confirmed(saved.version), key()), { code: 'clock_unavailable', status: 503 });
    assert.deepEqual(f.snapshot(), before);
  }
  f.setClock(START + 1000);
  const operationKey = key(), receipt = f.store.deleteLeadConversation(f.owner, saved.id, confirmed(saved.version), operationKey);
  const after = f.snapshot();
  assert.equal(receipt.messagesDeleted, 1); assert.equal(after.callback_tasks.length, 1); f.validate();
  f.setClock(-1);
  assert.deepEqual(f.store.deleteLeadConversation(f.owner, saved.id, confirmed(saved.version), operationKey), receipt);
  assert.deepEqual(f.snapshot(), after);
});

test('request terminal revision preserves reads and permits a safe whole-record deletion receipt', async t => {
  const f = await fixture(t), saved = f.task(f.create().lead).lead;
  f.db(db => db.prepare('UPDATE leads SET version=? WHERE id=?').run(MAX_REVISION - 2, saved.id));
  const last = f.store.updateLead(f.owner, saved.id, { version: MAX_REVISION - 2, status: 'new', notes: 'Last supported live increment' });
  assert.equal(last.version, MAX_REVISION - 1); f.validate();
  const before = f.snapshot();
  assert.throws(() => f.store.updateLead(f.owner, saved.id, { version: last.version, status: 'closed' }), { code: 'version_exhausted', status: 409 });
  assert.throws(() => f.store.deleteLeadConversation(f.owner, saved.id, confirmed(last.version), key()), { code: 'version_exhausted', status: 409 });
  assert.deepEqual(f.snapshot(), before); assert.deepEqual(f.store.getLead(f.owner, saved.id), last);
  const operationKey = key(), receipt = f.store.deleteLead(f.owner, saved.id, confirmed(last.version), operationKey);
  assert.equal(receipt.version, MAX_REVISION); assert.equal(f.snapshot().callback_tasks.length, 0); f.validate();
  const deleted = f.snapshot(); f.setClock(-1);
  assert.deepEqual(f.store.deleteLead(f.owner, saved.id, confirmed(last.version), operationKey), receipt);
  assert.deepEqual(f.snapshot(), deleted);
});

for (const [label, method] of [['STOP', 'suppressPhone'], ['safety', 'holdPhone']]) {
  test(label + ' fan-out preflights every affected request before any restriction, audit or revision write', async t => {
    const f = await fixture(t), first = f.create().lead, second = f.create().lead, other = f.create({}, key(), f.other).lead;
    // One row can be invalid for this mutation while another row is writable.
    // The transaction must preserve both and the independent business.
    for (const [version, updatedAt, code] of [[1, START + 1000, 'clock_unavailable'], [MAX_REVISION - 1, START, 'version_exhausted'], [MAX_REVISION, START, 'version_exhausted']]) {
      f.db(db => db.prepare('UPDATE leads SET version=?,updated_at=? WHERE id=?').run(version, updatedAt, second.id));
      f.validate(); const before = f.snapshot();
      assert.throws(() => f.store[method](f.owner, first.phone), { code });
      assert.deepEqual(f.snapshot(), before); assert.deepEqual(f.store.getLead(f.other, other.id), other); f.validate();
    }
    f.db(db => db.prepare('UPDATE leads SET version=1,updated_at=? WHERE id=?').run(START, second.id));
    f.setClock(START + 1000); assert.equal(f.store[method](f.owner, first.phone), true);
    for (const id of [first.id, second.id]) {
      const current = f.store.getLead(f.owner, id);
      assert.equal(current.version, 2); assert.equal(current.status, 'needs_review'); assert.equal(current.contactAllowed, false);
    }
    const after = f.snapshot(); f.setClock(-1);
    assert.equal(f.store[method](f.owner, first.phone), true); assert.deepEqual(f.snapshot(), after); f.validate();
  });
}

test('a held request phone correction rolls back both contact-point changes if propagation cannot advance', async t => {
  const f = await fixture(t), held = f.create({ job: 'The outlet is sparking.' }).lead;
  const nextPhone = '+12485550111', affected = f.create({ phone: nextPhone }).lead;
  f.db(db => db.prepare('UPDATE leads SET version=? WHERE id=?').run(MAX_REVISION, affected.id));
  f.validate(); const before = f.snapshot();
  assert.throws(() => f.store.updateLead(f.owner, held.id, { version: held.version, status: 'needs_review', phone: nextPhone }), { code: 'version_exhausted' });
  assert.deepEqual(f.snapshot(), before);
  assert.equal(f.store.isSafetyHeld(f.owner, held.phone), true); assert.equal(f.store.isSafetyHeld(f.owner, nextPhone), false);
  f.validate();
});

test('request and restriction audit records share the operation timestamp even when clock reads advance', async t => {
  const f = await fixture(t), first = f.create().lead, second = f.create().lead;
  f.setClock(START + 1000, 1);
  const stopped = f.create({ contactPermission: 'opted_out' }).lead;
  const expected = stopped.createdAt;
  assert.equal(stopped.updatedAt, expected);
  assert.ok(stopped.audit.every(entry => entry.createdAt === expected));
  for (const id of [first.id, second.id]) {
    const current = f.store.getLead(f.owner, id);
    assert.equal(current.updatedAt, expected); assert.equal(current.audit.at(-1).createdAt, expected);
  }
  assert.equal(new Date(f.snapshot().suppression[0].created_at).toISOString(), expected); f.validate();
});

test('failed STOP and safety persistence returns its explicit error without provider work or partial records', async t => {
  const f = await fixture(t), saved = f.create().lead, headers = f.headers();
  for (const [version, updatedAt, status, code] of [[MAX_REVISION, START, 409, 'version_exhausted'], [1, START + 1000, 503, 'clock_unavailable']]) {
    f.db(db => db.prepare('UPDATE leads SET version=?,updated_at=? WHERE id=?').run(version, updatedAt, saved.id));
    f.validate();
    for (const message of ['STOP', 'The outlet is sparking.']) {
      const before = f.snapshot();
      const result = await preview(f, headers, { message, state: { phone: saved.phone } });
      assert.equal(result.status, status); assert.equal(result.body.error.code, code);
      assert.equal(result.body.state, undefined); assert.equal(f.providerCalls, 0);
      assert.deepEqual(f.snapshot(), before); f.validate();
    }
  }
});

test('archive validation rejects unserializable request clocks, reversed chronology and invalid opt-out timestamps', async t => {
  const f = await fixture(t), saved = f.create().lead;
  f.store.suppressPhone(f.owner, saved.phone); const before = f.snapshot();
  const mutations = [
    db => db.prepare('UPDATE leads SET created_at=-1 WHERE id=?').run(saved.id),
    db => db.prepare('UPDATE leads SET updated_at=? WHERE id=?').run(MAX_TIME + 1, saved.id),
    db => db.prepare('UPDATE leads SET updated_at=created_at-1 WHERE id=?').run(saved.id),
    db => db.prepare('UPDATE suppression SET created_at=-1').run(),
    db => db.prepare('UPDATE suppression SET created_at=?').run(MAX_TIME + 1)
  ];
  f.db(db => {
    for (const mutate of mutations) {
      db.exec('BEGIN');
      try { mutate(db); assert.throws(() => validateDatabase(db), { code: 'invalid_database' }); }
      finally { db.exec('ROLLBACK'); }
    }
  });
  assert.deepEqual(f.snapshot(), before); f.validate();
});

test('encrypted recovery retains earlier epoch timestamps and already-existing safe terminal request revisions', async t => {
  const f = await fixture(t), saved = f.create().lead;
  f.db(db => db.prepare('UPDATE leads SET version=?,created_at=0,updated_at=0 WHERE id=?').run(MAX_REVISION, saved.id));
  f.validate(); const expected = f.store.getLead(f.owner, saved.id), before = f.snapshot();
  const archive = path.join(f.directory, 'archive.prbk'), restored = path.join(f.directory, 'restored');
  await createEncryptedBackup({ dataDir: path.dirname(f.store.filename), outputFile: archive, passphrase: PASSPHRASE });
  await restoreEncryptedBackup({ backupFile: archive, dataDir: restored, passphrase: PASSPHRASE });
  const recovered = openStore({ dataDir: restored, create: false, now: () => START });
  try {
    assert.deepEqual(recovered.getLead(f.owner, saved.id), expected);
    assert.throws(() => recovered.updateLead(f.owner, saved.id, { version: MAX_REVISION, status: 'new', notes: 'Must not advance' }), { code: 'version_exhausted' });
    assert.deepEqual(recovered.getLead(f.owner, saved.id), expected);
  } finally { recovered.close(); }
  assert.deepEqual(f.snapshot(), before);
});
