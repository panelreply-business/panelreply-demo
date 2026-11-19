'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { Readable } = require('node:stream');
const { EventEmitter } = require('node:events');
const { openStore } = require('../workspace/store.cjs');
const { hashPassword } = require('../workspace/auth.cjs');
const { createWorkspaceApp } = require('../workspace/api.cjs');
const { previewMessage } = require('../workspace/conversation.cjs');

const ORIGIN = 'http://127.0.0.1:10001';
const PASSWORD = 'Synthetic delayed body password 2026!';
const HASHES = Promise.all([hashPassword(PASSWORD), hashPassword('Replacement synthetic password 2026!')]);
const LEAD = { customerName: 'Delayed Fixture', phone: '+15865550101', job: 'Install a garage EV charger', zip: '48315', callbackWindow: 'Monday after 4 pm', requestedWorkDate: 'Friday', contactPermission: 'requested_callback', conversation: [] };

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
function delayedBody(input) {
  const raw = JSON.stringify(input), started = deferred(), release = deferred();
  const stream = Readable.from((async function* () {
    yield raw.slice(0, 10);
    started.resolve();
    await release.promise;
    yield raw.slice(10);
  })());
  return { stream, started: started.promise, release: release.resolve };
}
async function request(app, { method = 'GET', url = '/api/session', headers = {}, input, stream, observe } = {}) {
  const req = stream || Readable.from(input === undefined ? [] : [JSON.stringify(input)]);
  Object.assign(req, { method, url, headers: { host: '127.0.0.1:10001', origin: ORIGIN, 'content-type': 'application/json', ...headers }, socket: { remoteAddress: '127.0.0.1' } });
  if (observe) observe(req);
  const res = new EventEmitter();
  res.writableEnded = false; res.destroyed = false;
  res.writeHead = (status, resultHeaders) => { res.status = status; res.headers = resultHeaders; };
  res.end = body => { res.text = body === undefined ? '' : String(body); res.writableEnded = true; };
  await app.handler(req, res);
  return { status: res.status, headers: res.headers, text: res.text, body: res.text ? JSON.parse(res.text) : null };
}
async function fixture(t, preview) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'panelreply-revocation-'));
  const store = openStore({ dataDir });
  const [passwordHash, replacementHash] = await HASHES;
  const owner = store.createBusinessOwner({ businessName: 'Original Electric', username: 'slow-owner@example.test', passwordHash });
  const other = store.createBusinessOwner({ businessName: 'Other Electric', username: 'other-slow-owner@example.test', passwordHash });
  const app = createWorkspaceApp({ store, origin: ORIGIN, previewMessage: preview });
  t.after(() => { store.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });
  async function login(user = owner) {
    const result = await request(app, { method: 'POST', url: '/api/login', input: { username: user.username, password: PASSWORD } });
    assert.equal(result.status, 200);
    return { cookie: result.headers['Set-Cookie'].split(';')[0], 'x-csrf-token': result.body.csrfToken };
  }
  return { store, owner, other, app, login, reset() { store.resetOwnerPassword({ username: owner.username, passwordHash: replacementHash }); } };
}

test('password reset while profile JSON is arriving blocks the pending edit', async t => {
  const f = await fixture(t), headers = await f.login();
  const before = f.store.getProfile(f.owner);
  const body = delayedBody({ version: before.version, businessName: 'Changed after revocation', facts: before.facts });
  const pending = request(f.app, { method: 'PATCH', url: '/api/profile', headers, stream: body.stream });
  await body.started;
  f.reset();
  body.release();
  const result = await pending;
  assert.equal(result.status, 401);
  assert.deepEqual(f.store.getProfile(f.owner), before);
  assert.equal((await request(f.app, { headers })).status, 401);
});

test('password reset while create-lead JSON is arriving prevents a saved record', async t => {
  const f = await fixture(t), headers = await f.login();
  const body = delayedBody(LEAD);
  const pending = request(f.app, { method: 'POST', url: '/api/leads', headers: { ...headers, 'idempotency-key': crypto.randomUUID() }, stream: body.stream });
  await body.started;
  f.reset();
  body.release();
  assert.equal((await pending).status, 401);
  assert.deepEqual(f.store.listLeads(f.owner), []);
});

test('password reset while lead-edit JSON is arriving preserves the saved revision and audit', async t => {
  const f = await fixture(t), headers = await f.login();
  const before = f.store.createLead(f.owner, LEAD, crypto.randomUUID()).lead;
  const body = delayedBody({ version: before.version, status: 'contacted', notes: 'Should never be saved.' });
  const pending = request(f.app, { method: 'PATCH', url: '/api/leads/' + before.id, headers, stream: body.stream });
  await body.started;
  f.reset();
  body.release();
  assert.equal((await pending).status, 401);
  assert.deepEqual(f.store.getLead(f.owner, before.id), before);
});

test('password reset while preview JSON is arriving cannot create an opt-out through the revoked session', async t => {
  const f = await fixture(t), headers = await f.login();
  const before = f.store.createLead(f.owner, LEAD, crypto.randomUUID()).lead;
  const body = delayedBody({ message: 'STOP', state: { phone: LEAD.phone, conversation: [] } });
  const pending = request(f.app, { method: 'POST', url: '/api/preview', headers, stream: body.stream });
  await body.started;
  f.reset();
  body.release();
  const result = await pending;
  assert.equal(result.status, 401);
  assert.equal(result.body.state, undefined);
  assert.equal(f.store.isSuppressed(f.owner, LEAD.phone), false);
  assert.deepEqual(f.store.getLead(f.owner, before.id), before);
});

test('password reset during awaited preview work is rechecked before opt-out persistence', async t => {
  const started = deferred(), release = deferred();
  const f = await fixture(t, async (...args) => {
    started.resolve();
    await release.promise;
    return previewMessage(...args);
  });
  const headers = await f.login();
  const before = f.store.createLead(f.owner, LEAD, crypto.randomUUID()).lead;
  const pending = request(f.app, { method: 'POST', url: '/api/preview', headers, input: { message: 'STOP', state: { phone: LEAD.phone, conversation: [] } } });
  await started.promise;
  f.reset();
  release.resolve();
  assert.equal((await pending).status, 401);
  assert.equal(f.store.isSuppressed(f.owner, LEAD.phone), false);
  assert.deepEqual(f.store.getLead(f.owner, before.id), before);
});

test('a pending write cannot switch to a different authenticated principal after its body is read', async t => {
  const f = await fixture(t), headers = await f.login(), otherHeaders = await f.login(f.other);
  const before = f.store.getProfile(f.owner), otherBefore = f.store.getProfile(f.other);
  const body = delayedBody({ version: before.version, businessName: 'Wrong principal edit', facts: before.facts });
  let pendingRequest;
  const pending = request(f.app, { method: 'PATCH', url: '/api/profile', headers, stream: body.stream, observe: req => { pendingRequest = req; } });
  await body.started;
  // Model a surrounding middleware/session replacement. Revalidation must
  // retain the original principal, not just accept any now-valid cookie.
  pendingRequest.headers.cookie = otherHeaders.cookie;
  pendingRequest.headers['x-csrf-token'] = otherHeaders['x-csrf-token'];
  body.release();
  assert.equal((await pending).status, 401);
  assert.deepEqual(f.store.getProfile(f.owner), before);
  assert.deepEqual(f.store.getProfile(f.other), otherBefore);
});

test('the final mutation check also preserves the original CSRF requirement', async t => {
  const f = await fixture(t), headers = await f.login();
  const before = f.store.getProfile(f.owner);
  const body = delayedBody({ version: before.version, businessName: 'Untrusted token edit', facts: before.facts });
  let pendingRequest;
  const pending = request(f.app, { method: 'PATCH', url: '/api/profile', headers, stream: body.stream, observe: req => { pendingRequest = req; } });
  await body.started;
  pendingRequest.headers['x-csrf-token'] = 'invalid-after-read';
  body.release();
  assert.equal((await pending).status, 403);
  assert.deepEqual(f.store.getProfile(f.owner), before);
});

test('a delayed body still succeeds when its original session remains authorized', async t => {
  const f = await fixture(t), headers = await f.login();
  const before = f.store.getProfile(f.owner);
  const body = delayedBody({ version: before.version, businessName: 'Reviewed Electric', facts: before.facts });
  const pending = request(f.app, { method: 'PATCH', url: '/api/profile', headers, stream: body.stream });
  await body.started;
  body.release();
  const result = await pending;
  assert.equal(result.status, 200);
  assert.equal(result.body.business.name, 'Reviewed Electric');
  assert.equal(result.body.version, before.version + 1);
});
