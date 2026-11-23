'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const { EventEmitter } = require('node:events');
const { openProductStore } = require('../workspace/products.cjs');
const { hashPassword } = require('../workspace/auth.cjs');
const { createWorkspaceApp } = require('../workspace/api.cjs');

const ORIGIN = 'http://127.0.0.1:10001';
const PASSWORD = 'Synthetic scheduling API password 2026!';
const HASH = hashPassword(PASSWORD);
const LEAD = { customerName: 'Jamie API Schedule', phone: '+12485550123', job: 'Install garage lighting', zip: '48315', callbackWindow: 'Monday afternoon', requestedWorkDate: 'Next month', contactPermission: 'requested_callback', conversation: [] };
const INPUT = { leadVersion: 1, kind: 'callback', dueAt: '2026-12-01T16:00:00.000Z', timeZone: 'America/Detroit', notes: 'Synthetic callback task' };

async function request(app, { method = 'GET', url = '/api/callback-tasks', headers = {}, input, raw, stream } = {}) {
  const req = stream || Readable.from([raw === undefined ? input === undefined ? '' : JSON.stringify(input) : raw]);
  Object.assign(req, { method, url, headers: { host: '127.0.0.1:10001', origin: ORIGIN, 'content-type': 'application/json', ...headers }, socket: { remoteAddress: '127.0.0.1' } });
  const res = new EventEmitter(); res.writableEnded = false; res.destroyed = false;
  res.writeHead = (status, resultHeaders) => { res.status = status; res.headers = resultHeaders; };
  res.end = body => { res.text = body === undefined ? '' : String(body); res.writableEnded = true; };
  await app.handler(req, res);
  return { status: res.status, headers: res.headers, text: res.text, body: res.text && res.headers['Content-Type'].startsWith('application/json') ? JSON.parse(res.text) : null };
}
async function fixture(t, product = 'callback') {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'panelreply-callback-api-'));
  const store = openProductStore({ dataDir, product });
  const passwordHash = await HASH;
  const owner = store.createBusinessOwner({ businessName: 'Callback API Fixture', username: 'api-owner@example.test', passwordHash });
  const other = store.createBusinessOwner({ businessName: 'Other Business Fixture', username: 'api-other@example.test', passwordHash });
  const lead = store.createLead(owner, LEAD, crypto.randomUUID()).lead;
  const app = createWorkspaceApp({ store, origin: ORIGIN, product });
  t.after(() => { app.close(); store.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });
  async function login(user = owner) {
    const response = await request(app, { method: 'POST', url: '/api/login', input: { username: user.username, password: PASSWORD } });
    assert.equal(response.status, 200); return { cookie: response.headers['Set-Cookie'].split(';')[0], 'x-csrf-token': response.body.csrfToken, 'x-workspace-session': response.body.csrfToken };
  }
  return { app, store, owner, other, lead, login, create(headers, changes = {}, key = crypto.randomUUID()) { return request(app, { method: 'POST', url: '/api/leads/' + lead.id + '/tasks', headers: { ...headers, 'idempotency-key': key }, input: { ...INPUT, ...changes } }); } };
}
function delayed(input) {
  let start, release;
  const started = new Promise(resolve => { start = resolve; }), gate = new Promise(resolve => { release = resolve; });
  const raw = JSON.stringify(input);
  return { started, release: () => release(), stream: Readable.from((async function* () { yield raw.slice(0, 10); start(); await gate; yield raw.slice(10); })()) };
}

test('callback API supports create, queue, reschedule, completion and follow-up without claiming outbound delivery', async t => {
  const f = await fixture(t), headers = await f.login(); const created = await f.create(headers);
  assert.equal(created.status, 201); assert.equal(created.body.lead.version, 2);
  const id = created.body.task.id;
  const queue = await request(f.app, { headers }); assert.equal(queue.status, 200); assert.equal(queue.body.total, 1); assert.equal(queue.body.tasks[0].id, id);
  const changed = await request(f.app, { method: 'PATCH', url: '/api/callback-tasks/' + id, headers: { ...headers, 'idempotency-key': crypto.randomUUID() }, input: { leadVersion: 2, version: 1, action: 'reschedule', dueAt: '2026-12-02T17:00:00.000Z', timeZone: 'America/Chicago', notes: 'Operator adjusted plan' } });
  assert.equal(changed.status, 200); assert.equal(changed.body.task.version, 2); assert.equal(changed.body.lead.version, 3);
  const completed = await request(f.app, { method: 'PATCH', url: '/api/callback-tasks/' + id, headers: { ...headers, 'idempotency-key': crypto.randomUUID() }, input: { leadVersion: 3, version: 2, action: 'complete', outcome: 'no_answer', notes: 'Operator reported no answer' } });
  assert.equal(completed.status, 200); assert.equal(completed.body.task.status, 'completed'); assert.equal(completed.body.task.outcome, 'no_answer');
  const followup = await f.create(headers, { leadVersion: 4, kind: 'follow_up' }); assert.equal(followup.status, 201);
  assert.equal((await request(f.app, { headers, url: '/api/callback-tasks?state=completed&leadId=' + f.lead.id })).body.total, 1);
  const health = await request(f.app, { url: '/health' }); assert.equal(health.body.bookingEnabled, false); assert.equal(health.body.product.capabilities.liveCalls, false); assert.equal(health.body.product.capabilities.liveMessages, false);
  assert.equal(health.body.product.capabilities.callbackScheduling, true);
});

test('callback API creation and completion retries return current saved state without another mutation', async t => {
  const f = await fixture(t), headers = await f.login(), key = crypto.randomUUID(); const first = await f.create(headers, {}, key);
  const replay = await f.create(headers, {}, key); assert.equal(replay.status, 200); assert.equal(replay.body.replayed, true); assert.equal(replay.body.task.id, first.body.task.id);
  assert.equal((await f.create(headers, { notes: 'Changed payload' }, key)).status, 409);
  const updateKey = crypto.randomUUID(), input = { leadVersion: 2, version: 1, action: 'complete', outcome: 'reached', notes: 'Reported complete' };
  const options = { method: 'PATCH', url: '/api/callback-tasks/' + first.body.task.id, headers: { ...headers, 'idempotency-key': updateKey }, input };
  assert.equal((await request(f.app, options)).status, 200); const again = await request(f.app, options); assert.equal(again.status, 200); assert.equal(again.body.replayed, true); assert.equal(again.body.task.version, 2); assert.equal(again.body.lead.version, 3);
});

test('callback API anonymous, forged cookie and stale pinned session cannot read queues or create tasks', async t => {
  const f = await fixture(t), headers = await f.login();
  for (const denied of [{}, { cookie: 'PanelReplyCallbackLocalSession=forged' }, { ...headers, 'x-workspace-session': 'wrong-session' }]) {
    assert.equal((await request(f.app, { headers: denied })).status, 401); assert.equal((await f.create(denied)).status, 401);
  }
  assert.equal(f.store.listCallbackTasks(f.owner).total, 0);
});

test('callback writes require exact origin, CSRF and host before reading the mutation body', async t => {
  const f = await fixture(t), headers = await f.login();
  for (const [overrides, status, code] of [[{ origin: 'https://unrelated.example.test' }, 403, 'origin_rejected'], [{ origin: undefined }, 403, 'origin_rejected'], [{ 'x-csrf-token': undefined }, 403, 'csrf_rejected'], [{ 'x-csrf-token': 'forged' }, 403, 'csrf_rejected'], [{ host: 'unrelated.example.test' }, 421, 'host_rejected']]) {
    let consumed = false;
    const stream = Readable.from((function* () { consumed = true; yield JSON.stringify(INPUT); })());
    const result = await request(f.app, { method: 'POST', url: '/api/leads/' + f.lead.id + '/tasks', headers: { ...headers, ...overrides, 'idempotency-key': crypto.randomUUID() }, stream });
    assert.equal(result.status, status); assert.equal(result.body.error.code, code); assert.equal(consumed, false);
  }
  assert.equal(f.store.listCallbackTasks(f.owner).total, 0);
});

test('callback API cross-business identifiers cannot read, create or cancel another business task', async t => {
  const f = await fixture(t), headers = await f.login(), other = await f.login(f.other); const first = await f.create(headers);
  assert.equal((await request(f.app, { headers: other })).body.total, 0);
  assert.equal((await request(f.app, { headers: other, url: '/api/callback-tasks?leadId=' + f.lead.id })).status, 404);
  assert.equal((await f.create(other)).status, 404);
  const result = await request(f.app, { method: 'PATCH', url: '/api/callback-tasks/' + first.body.task.id, headers: { ...other, 'idempotency-key': crypto.randomUUID() }, input: { leadVersion: 2, version: 1, action: 'cancel', notes: '' } });
  assert.equal(result.status, 404); assert.ok(!result.text.includes(LEAD.customerName)); assert.equal(f.store.listCallbackTasks(f.owner).tasks[0].status, 'scheduled');
});

test('spreadsheet product denies every scheduling route before session lookup or body consumption', async t => {
  const f = await fixture(t, 'spreadsheet');
  let sessions = 0; const session = f.store.session; f.store.session = (...args) => { sessions++; return session(...args); };
  for (const [method, url] of [['GET', '/api/callback-tasks'], ['POST', '/api/leads/' + f.lead.id + '/tasks'], ['PATCH', '/api/callback-tasks/' + crypto.randomUUID()]]) {
    let consumed = false; const stream = Readable.from((function* () { consumed = true; yield JSON.stringify(INPUT); })());
    const result = await request(f.app, { method, url, stream }); assert.equal(result.status, 404); assert.equal(consumed, false);
  }
  assert.equal(sessions, 0);
});

test('callback queue rejects duplicate, unsupported and malformed query filters', async t => {
  const f = await fixture(t), headers = await f.login(); await f.create(headers);
  for (const query of ['state=open&state=all', 'businessId=other', 'limit=1.5', 'limit=', 'limit=-1', 'limit=01', 'offset=Infinity', 'offset=2001', 'limit=501', 'leadId=other', 'state=unknown']) {
    const result = await request(f.app, { headers, url: '/api/callback-tasks?' + query }); assert.equal(result.status, 400, query);
  }
  const valid = await request(f.app, { headers, url: '/api/callback-tasks?state=all&limit=1&offset=0' }); assert.equal(valid.status, 200); assert.equal(valid.body.limit, 1);
});

test('callback scheduling rejects malformed, oversized and non-JSON bodies without writing partial data', async t => {
  const f = await fixture(t), headers = await f.login();
  for (const [raw, extra, status] of [['{', {}, 400], ['[]', {}, 400], [JSON.stringify(INPUT), { 'content-type': 'text/plain' }, 415], [JSON.stringify(INPUT), { 'content-encoding': 'gzip' }, 415], ['x'.repeat(16385), {}, 413], [JSON.stringify(INPUT), { 'content-length': '999' }, 400]]) {
    const result = await request(f.app, { method: 'POST', url: '/api/leads/' + f.lead.id + '/tasks', headers: { ...headers, ...extra, 'idempotency-key': crypto.randomUUID() }, raw }); assert.equal(result.status, status);
  }
  assert.equal(f.store.listCallbackTasks(f.owner).total, 0); assert.equal(f.store.getLead(f.owner, f.lead.id).version, 1);
});

test('largest valid escaped Unicode task notes fit the explicit request boundary', async t => {
  const f = await fixture(t), headers = await f.login(), notes = '漢'.repeat(2000);
  const raw = JSON.stringify({ ...INPUT, notes }).replace(/漢/g, '\\u6f22');
  const result = await request(f.app, { method: 'POST', url: '/api/leads/' + f.lead.id + '/tasks', headers: { ...headers, 'idempotency-key': crypto.randomUUID() }, raw });
  assert.equal(result.status, 201); assert.equal(result.body.task.notes, notes);
});

for (const operation of ['create', 'complete']) test('sign-out during delayed callback ' + operation + ' body prevents the pending write', async t => {
  const f = await fixture(t), headers = await f.login(); const first = operation === 'complete' ? await f.create(headers) : null;
  const input = first ? { leadVersion: 2, version: 1, action: 'complete', outcome: 'reached', notes: '' } : INPUT;
  const body = delayed(input), before = f.store.exportBusiness(f.owner);
  const pending = request(f.app, { method: first ? 'PATCH' : 'POST', url: first ? '/api/callback-tasks/' + first.body.task.id : '/api/leads/' + f.lead.id + '/tasks', headers: { ...headers, 'idempotency-key': crypto.randomUUID() }, stream: body.stream });
  await body.started;
  assert.equal((await request(f.app, { method: 'POST', url: '/api/logout', headers, input: {} })).status, 204); body.release();
  assert.equal((await pending).status, 401); assert.deepEqual(f.store.exportBusiness(f.owner), before);
});

test('STOP received while a callback body is arriving blocks contact with fresh parent revision', async t => {
  const f = await fixture(t), headers = await f.login(); const first = await f.create(headers);
  const body = delayed({ leadVersion: 2, version: 1, action: 'complete', outcome: 'reached', notes: '' });
  const pending = request(f.app, { method: 'PATCH', url: '/api/callback-tasks/' + first.body.task.id, headers: { ...headers, 'idempotency-key': crypto.randomUUID() }, stream: body.stream });
  await body.started; f.store.suppressPhone(f.owner, f.lead.phone); body.release();
  const result = await pending; assert.equal(result.status, 409); assert.equal(result.body.error.code, 'version_conflict');
  const current = (await request(f.app, { headers })).body.tasks[0]; assert.equal(current.status, 'scheduled'); assert.equal(current.contactAllowed, false);
  const retry = await request(f.app, { method: 'PATCH', url: '/api/callback-tasks/' + current.id, headers: { ...headers, 'idempotency-key': crypto.randomUUID() }, input: { leadVersion: current.leadVersion, version: current.version, action: 'complete', outcome: 'reached', notes: '' } });
  assert.equal(retry.status, 409); assert.equal(retry.body.error.code, 'contact_blocked');
});

test('version2 record export includes saved scheduling and safe audit identifiers without internal operation data', async t => {
  const f = await fixture(t), headers = await f.login(); const first = await f.create(headers);
  const original = f.store.exportBusiness;
  f.store.exportBusiness = actor => {
    const saved = original(actor); return { ...saved, callbackTasks: saved.callbackTasks.map(task => ({ ...task, password_hash: 'PRIVATE_HASH', operation_key: 'PRIVATE_RETRY', request_hash: 'PRIVATE_DIGEST' })) };
  };
  const result = await request(f.app, { headers, url: '/api/export' }); assert.equal(result.status, 200); assert.equal(result.body.version, 2);
  assert.equal(result.body.callbackTasks.length, 1); assert.equal(result.body.callbackTasks[0].id, first.body.task.id); assert.equal(result.body.callbackTasks[0].notes, INPUT.notes);
  assert.equal(result.body.leads[0].audit.at(-1).details.taskId, first.body.task.id);
  for (const value of ['PRIVATE_HASH', 'PRIVATE_RETRY', 'PRIVATE_DIGEST', 'operation_key', 'request_hash', 'password_hash']) assert.ok(!result.text.includes(value));
  const other = await f.login(f.other); const empty = await request(f.app, { headers: other, url: '/api/export' }); assert.deepEqual(empty.body.callbackTasks, []);
});
