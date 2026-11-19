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
const HASH = hashPassword('Synthetic assistant API password 2026!');
const emptyOutput = () => ({ changes: [], clarify: [], answerTopics: [], intent: 'continue' });
const defer = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
async function fixture(t, generate = async () => emptyOutput()) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'panelreply-assistant-api-'));
  let clock = Date.now();
  const store = openStore({ dataDir: dir, now: () => clock });
  const passwordHash = await HASH;
  const actor = store.createBusinessOwner({ businessName: 'Synthetic Assistant', username: 'assistant@example.test', passwordHash });
  const other = store.createBusinessOwner({ businessName: 'Other Synthetic Assistant', username: 'other-assistant@example.test', passwordHash });
  const app = createWorkspaceApp({ store, origin: ORIGIN, conversationProvider: { kind: 'fake', generate } });
  const login = (user = actor) => { const token = crypto.randomBytes(32).toString('base64url'); store.createSession(user.id, digest(token)); return { cookie: app.auth.cookie(token).split(';')[0], 'x-csrf-token': csrfFor(token), 'x-workspace-session': csrfFor(token) }; };
  t.after(() => { app.close(); store.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  return { app, store, actor, other, login, expire: () => { clock += 31 * 60 * 1000; }, revoke: () => store.resetOwnerPassword({ username: actor.username, passwordHash }) };
}
async function request(f, { method = 'POST', url = '/api/preview', headers = {}, input, observe } = {}) {
  const req = Readable.from(input === undefined ? [] : [JSON.stringify(input)]);
  Object.assign(req, { method, url, headers: { host: '127.0.0.1:10001', origin: ORIGIN, 'content-type': 'application/json', ...headers }, socket: { remoteAddress: '127.0.0.1' } });
  const res = new EventEmitter(); res.writableEnded = false; res.destroyed = false;
  res.writeHead = (status, values) => { res.status = status; res.headers = values; };
  res.end = body => { res.text = body === undefined ? '' : String(body); res.writableEnded = true; };
  observe?.(req, res);
  await f.app.handler(req, res);
  return { status: res.status, headers: res.headers, body: res.text ? JSON.parse(res.text) : null };
}

test('assistant mode and generation require authentication, Origin, CSRF and the current session pin', async t => {
  let calls = 0; const f = await fixture(t, async () => { calls++; return emptyOutput(); });
  assert.equal((await request(f, { method: 'GET', url: '/api/assistant' })).status, 401);
  const headers = f.login();
  const mode = await request(f, { method: 'GET', url: '/api/assistant', headers });
  assert.deepEqual(mode.body, { mode: 'fake-provider', liveEnabled: false });
  for (const bad of [{}, { ...headers, origin: 'https://foreign.example.test' }, { ...headers, 'x-csrf-token': 'wrong' }, { ...headers, 'x-workspace-session': 'wrong' }]) {
    const response = await request(f, { headers: bad, input: { message: 'I need a panel upgrade', state: null } });
    assert.ok([401, 403].includes(response.status));
  }
  assert.equal(calls, 0);
});

test('validated assistant fields remain an unsaved draft until the normal authorized save', async t => {
  const f = await fixture(t, async () => ({ ...emptyOutput(), changes: [{ field: 'job', value: 'panel upgrade', evidence: 'I need a panel upgrade', operation: 'set' }] }));
  const headers = f.login();
  const result = await request(f, { headers, input: { message: 'I need a panel upgrade', state: { customerName: 'Synthetic Example', phone: '+15865550101', zip: '48315' } } });
  assert.equal(result.status, 200); assert.equal(result.body.state.job, 'panel upgrade');
  assert.equal(result.body.assistance.mode, 'fake-provider'); assert.deepEqual(f.store.listLeads(f.actor), []);
  const { state } = result.body;
  const body = { customerName: state.customerName, phone: state.phone, job: state.job, zip: state.zip, callbackWindow: state.callbackWindow, requestedWorkDate: state.requestedWorkDate, contactPermission: 'requested_callback', conversation: state.conversation };
  const key = crypto.randomUUID();
  const saved = await request(f, { url: '/api/leads', headers: { ...headers, 'idempotency-key': key }, input: body });
  assert.equal(saved.status, 201); assert.equal(saved.body.lead.job, 'panel upgrade');
  assert.equal((await request(f, { url: '/api/leads', headers: { ...headers, 'idempotency-key': key }, input: body })).status, 200);
  assert.equal(f.store.listLeads(f.actor).length, 1); assert.deepEqual(f.store.listLeads(f.other), []);
});

for (const action of ['expire', 'revoke']) test('pending assistance cannot return private data after session ' + action, async t => {
  const started = defer(), release = defer();
  const f = await fixture(t, async () => { started.resolve(); await release.promise; return emptyOutput(); });
  const pending = request(f, { headers: f.login(), input: { message: 'I need a panel upgrade', state: null } });
  await started.promise; f[action](); release.resolve();
  const result = await pending;
  assert.equal(result.status, 401); assert.equal(result.body.state, undefined);
  assert.deepEqual(f.store.listLeads(f.actor), []);
});

test('a concurrent STOP cancels generation and persists contact suppression without saving a request', async t => {
  const started = defer(), release = defer(); let signal;
  const f = await fixture(t, async (_, options) => { signal = options.signal; started.resolve(); await release.promise; return emptyOutput(); });
  const headers = f.login(), state = { phone: '+15865550101' };
  const pending = request(f, { headers, input: { message: 'I need a panel upgrade', state } });
  await started.promise;
  const stopped = await request(f, { headers, input: { message: 'STOP', state } });
  assert.equal(stopped.status, 200); assert.equal(stopped.body.state.stopped, true);
  assert.equal(signal.aborted, true); assert.equal(f.store.isSuppressed(f.actor, state.phone), true);
  release.resolve(); assert.equal((await pending).status, 409);
  assert.deepEqual(f.store.listLeads(f.actor), []);
});

test('a concurrent safety message cancels generation without claiming emergency dispatch', async t => {
  const started = defer(), release = defer(); let signal;
  const f = await fixture(t, async (_, options) => { signal = options.signal; started.resolve(); await release.promise; return emptyOutput(); });
  const headers = f.login();
  const pending = request(f, { headers, input: { message: 'I need a panel upgrade', state: null } });
  await started.promise;
  const held = await request(f, { headers, input: { message: 'The panel is sparking and smoking', state: null } });
  assert.equal(held.status, 200); assert.equal(held.body.state.hold, true); assert.equal(signal.aborted, true);
  release.resolve(); assert.equal((await pending).status, 409);
  assert.deepEqual(f.store.listLeads(f.actor), []);
});

test('provider context is business-scoped and a stale business pin prevents generation', async t => {
  const contexts = []; const f = await fixture(t, async context => { contexts.push(context); return emptyOutput(); });
  for (const [actor, answer] of [[f.actor, 'Synthetic A hours'], [f.other, 'Synthetic B hours']]) {
    const p = f.store.getProfile(actor); p.facts.hours = { verified: true, answer };
    f.store.updateProfile(actor, { version: p.version, businessName: p.business.name, facts: p.facts });
  }
  const a = f.login(), b = f.login(f.other);
  assert.equal((await request(f, { headers: { ...b, 'x-workspace-session': a['x-workspace-session'] }, input: { message: 'What are your hours?', state: null } })).status, 401);
  assert.equal(contexts.length, 0);
  await request(f, { headers: b, input: { message: 'What are your hours?', state: null } });
  assert.equal(contexts[0].data.approvedBusinessFacts.hours.answer, 'Synthetic B hours');
  const serialized = JSON.stringify(contexts[0]);
  for (const privateValue of [f.actor.businessId, f.other.businessId, b.cookie, 'Synthetic A hours']) assert.equal(serialized.includes(privateValue), false);
});

test('changed business facts invalidate a pending answer before it reaches the browser', async t => {
  const started = defer(), release = defer();
  const f = await fixture(t, async () => { started.resolve(); await release.promise; return { ...emptyOutput(), answerTopics: ['hours'] }; });
  let p = f.store.getProfile(f.actor); p.facts.hours = { verified: true, answer: 'Old synthetic hours' };
  f.store.updateProfile(f.actor, { version: p.version, businessName: p.business.name, facts: p.facts });
  const pending = request(f, { headers: f.login(), input: { message: 'What are your hours?', state: null } });
  await started.promise;
  p = f.store.getProfile(f.actor); p.facts.hours = { verified: false, answer: '' };
  f.store.updateProfile(f.actor, { version: p.version, businessName: p.business.name, facts: p.facts });
  release.resolve();
  const result = await pending;
  assert.equal(result.status, 409); assert.equal(result.body.error.code, 'profile_changed');
  assert.equal(JSON.stringify(result).includes('Old synthetic hours'), false);
});

test('a disconnected preview aborts generation and cannot create records', async t => {
  const started = defer(), release = defer(); let signal, response;
  const f = await fixture(t, async (_, options) => { signal = options.signal; started.resolve(); await release.promise; return emptyOutput(); });
  const pending = request(f, { headers: f.login(), input: { message: 'I need a panel upgrade', state: null }, observe: (_, res) => { response = res; } });
  await started.promise; response.destroyed = true; response.emit('close');
  assert.equal(signal.aborted, true); release.resolve(); await pending;
  assert.deepEqual(f.store.listLeads(f.actor), []);
});

test('a response disconnected before listeners attach never starts the provider', async t => {
  let calls = 0;
  const f = await fixture(t, async () => { calls++; return emptyOutput(); });
  await request(f, { headers: f.login(), input: { message: 'I need a panel upgrade', state: null }, observe: (_, res) => { res.destroyed = true; } });
  assert.equal(calls, 0); assert.deepEqual(f.store.listLeads(f.actor), []);
});
