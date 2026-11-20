'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { Readable } = require('node:stream');
const { EventEmitter } = require('node:events');
const { openStore, digest } = require('../workspace/store.cjs');
const { hashPassword, csrfFor } = require('../workspace/auth.cjs');
const { createWorkspaceApp } = require('../workspace/api.cjs');
const ORIGIN = 'http://127.0.0.1:10001';
const HASH = hashPassword('Synthetic deletion API fixture 2026!');
const IMAGE = fs.readFileSync(path.join(__dirname, 'fixtures/panels/complete.png'));
const uuid = () => crypto.randomUUID();
async function fixture(t, kind) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'panelreply-delete-api-'));
  let now = Date.now();
  const store = openStore({ dataDir: dir, now: () => now }), passwordHash = await HASH;
  const actor = store.createBusinessOwner({ businessName: 'Synthetic Delete A', username: 'delete-a@example.test', passwordHash });
  const other = store.createBusinessOwner({ businessName: 'Synthetic Delete B', username: 'delete-b@example.test', passwordHash });
  const app = createWorkspaceApp({ store, origin: ORIGIN });
  t.after(() => { app.close(); store.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  function login(user = actor) { const token = crypto.randomBytes(32).toString('base64url'); store.createSession(user.id, digest(token)); return { cookie: app.auth.cookie(token).split(';')[0], 'x-csrf-token': csrfFor(token), 'x-workspace-session': csrfFor(token), 'idempotency-key': uuid() }; }
  let record, target, url, read;
  if (kind.startsWith('lead')) {
    record = store.createLead(actor, { customerName: 'Synthetic Delete Customer', phone: '+15865550101', job: 'EV charger estimate', zip: '48315', callbackWindow: '', requestedWorkDate: '', contactPermission: 'requested_callback', conversation: [{ role: 'customer', text: 'Please call me after four about an EV charger.' }] }, uuid()).lead;
    target = record.id; url = '/api/leads/' + record.id + (kind === 'lead_conversation' ? '/conversation' : '');
    read = () => store.getLead(actor, record.id);
  } else {
    record = store.createPanelProject(actor, { name: 'Synthetic Delete Panel', notes: '', rows: [] }, uuid()).project;
    if (kind === 'panel_source') { const upload = store.addPanelSource(actor, record.id, { version: record.version, name: 'synthetic.png', mime: 'image/png', dataBase64: IMAGE.toString('base64') }, uuid()); record = upload.project; target = upload.source.id; }
    else target = record.id;
    url = '/api/panel-projects/' + record.id + (kind === 'panel_source' ? '/sources/' + target : '');
    read = () => store.getPanelProject(actor, record.id);
  }
  return { app, actor, other, store, record, target, url, read, login, input: { version: record.version, confirmation: 'DELETE' }, expire: () => { now += 31 * 60 * 1000; }, revoke: () => store.resetOwnerPassword({ username: actor.username, passwordHash }) };
}
async function request(f, { headers = {}, input = f.input, stream, method = 'DELETE', url = f.url } = {}) {
  const req = stream || Readable.from([JSON.stringify(input)]);
  Object.assign(req, { method, url, headers: { host: '127.0.0.1:10001', origin: ORIGIN, 'content-type': 'application/json', ...headers }, socket: { remoteAddress: '127.0.0.1' } });
  const res = new EventEmitter(); res.writableEnded = false; res.destroyed = false;
  res.writeHead = (status, headers) => { res.status = status; res.headers = headers; };
  res.end = body => { res.body = body ? JSON.parse(String(body)) : null; res.writableEnded = true; };
  await f.app.handler(req, res);
  return { status: res.status, body: res.body, headers: res.headers };
}
const kinds = ['lead', 'lead_conversation', 'panel_project', 'panel_source'];
for (const kind of kinds) {
  test(kind + ' deletion requires authenticated same-origin CSRF and current workspace identity', async t => {
    const f = await fixture(t, kind), valid = f.login();
    for (const [headers, status] of [[{}, 401], [{ ...valid, origin: 'https://foreign.example.test' }, 403], [{ ...valid, 'x-csrf-token': 'wrong' }, 403], [{ ...valid, 'x-workspace-session': 'wrong' }, 401]]) {
      const result = await request(f, { headers }); assert.equal(result.status, status); assert.equal(result.body.receipt, undefined);
      assert.deepEqual(f.read(), f.record);
    }
  });
  test(kind + ' deletion has explicit confirmation, bounded body, version and retry-key validation', async t => {
    const f = await fixture(t, kind), headers = f.login();
    for (const input of [{ version: f.record.version }, { ...f.input, confirmation: 'delete' }, { ...f.input, businessId: f.other.businessId }, { ...f.input, version: 0 }]) assert.equal((await request(f, { headers, input })).status, 400);
    assert.equal((await request(f, { headers: { ...headers, 'idempotency-key': undefined } })).status, 400);
    assert.equal((await request(f, { headers, input: { ...f.input, version: f.record.version + 1 } })).status, 409);
    assert.equal((await request(f, { headers, input: { padding: 'x'.repeat(2100) } })).status, 413);
    assert.deepEqual(f.read(), f.record);
  });
  test(kind + ' deletion and its replay are business-scoped and content-free', async t => {
    const f = await fixture(t, kind), headers = f.login();
    const foreign = await request(f, { headers: f.login(f.other) }); assert.equal(foreign.status, 404); assert.equal(foreign.body.receipt, undefined);
    assert.deepEqual(f.read(), f.record);
    const first = await request(f, { headers }); assert.equal(first.status, 200); assert.equal(first.body.receipt.deleted, true); assert.equal(first.body.receipt.id, f.target); assert.equal(first.body.receipt.kind, kind);
    assert.equal(first.body.receipt.version, f.record.version + 1);
    assert.deepEqual((await request(f, { headers })).body, first.body);
    assert.equal((await request(f, { headers: { ...f.login(f.other), 'idempotency-key': headers['idempotency-key'] } })).status, 404);
    const output = JSON.stringify(first.body); assert.equal(output.includes('Synthetic Delete'), false); assert.equal(output.includes('5550101'), false); assert.equal(output.includes('dataBase64'), false);
    if (kind === 'lead_conversation') { assert.equal(f.read().conversation.length, 0); assert.equal(f.read().job, f.record.job); }
    else if (kind === 'panel_source') { assert.equal(f.read().sources.length, 0); assert.equal(f.read().version, f.record.version + 1); }
    else assert.throws(f.read, error => error.code === 'not_found');
  });
  for (const state of ['expire', 'revoke']) test(kind + ' deletion rechecks ' + state + ' after a delayed body', async t => {
    const f = await fixture(t, kind), headers = f.login();
    let release, began; const wait = new Promise(resolve => { release = resolve; }), start = new Promise(resolve => { began = resolve; });
    const raw = JSON.stringify(f.input);
    const stream = Readable.from((async function* () { yield raw.slice(0, 5); began(); await wait; yield raw.slice(5); })());
    const result = request(f, { headers, stream }); await start; f[state](); release();
    assert.equal((await result).status, 401); assert.deepEqual(f.read(), f.record);
  });
  test(kind + ' deletion rejects an interrupted body without a mutation', async t => {
    const f = await fixture(t, kind);
    const stream = Readable.from((async function* () { yield '{"version":'; throw new Error('Synthetic interrupted body'); })());
    assert.equal((await request(f, { headers: f.login(), stream })).status, 400); assert.deepEqual(f.read(), f.record);
  });
}
