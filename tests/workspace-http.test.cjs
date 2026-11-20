'use strict';

// Actual sockets are reserved for CI or an explicitly enabled local runner.
// Offline tests use the same handler with streams and never bind a port.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { once } = require('node:events');
const { openStore } = require('../workspace/store.cjs');
const { hashPassword } = require('../workspace/auth.cjs');
const { createWorkspaceApp, MAX_BODY_BYTES } = require('../workspace/api.cjs');

const ENABLED = process.env.CI === 'true' || process.env.WORKSPACE_HTTP_TESTS === '1';
const PASSWORD = 'http-fixture-password-2026';
const LEAD = { customerName: 'HTTP Fixture', phone: '248-555-0123', job: 'Install a garage light', zip: '48315', callbackWindow: 'Friday after 4 pm', requestedWorkDate: '', contactPermission: 'requested_callback', conversation: [{ role: 'customer', text: 'Please call me about installing a light.' }] };
let passwordHash;

test('HTTP: server shutdown cancels pending assistance, settles accounting and closes storage once', { skip: !ENABLED, timeout: 15000 }, async t => {
  const net = require('node:net');
  const { digest } = require('../workspace/store.cjs');
  const { csrfFor, createAuth } = require('../workspace/auth.cjs');
  const { PreviewError } = require('../workspace/conversation.cjs');
  const { startWorkspace } = require('../workspace-server.cjs');
  const probe = net.createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
  const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'panelreply-shutdown-review-')), dataDir = path.join(root, 'source');
  let startedResolve, aborted = false;
  const started = new Promise(resolve => { startedResolve = resolve; });
  const workspace = startWorkspace({ PORT: String(port), WORKSPACE_DATA_DIR: dataDir }, { conversationProvider: { kind: 'fake', generate: (_context, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => { aborted = true; reject(new PreviewError(409, 'assistant_cancelled', 'Synthetic shutdown')); }, { once: true });
    startedResolve();
  }) } });
  t.after(async () => { await workspace.close(); fs.rmSync(root, { recursive: true, force: true }); });
  await once(workspace.server, 'listening');
  passwordHash ||= hashPassword(PASSWORD);
  const actor = workspace.store.createBusinessOwner({ businessName: 'Shutdown Synthetic Business', username: 'shutdown-owner', passwordHash: await passwordHash });
  const token = crypto.randomBytes(32).toString('base64url'); workspace.store.createSession(actor.id, digest(token));
  const body = JSON.stringify({ message: 'I need a panel upgrade', state: null });
  const response = new Promise((resolve, reject) => {
    const req = http.request(workspace.config.origin + '/api/preview', { method: 'POST', headers: { origin: workspace.config.origin, 'content-type': 'application/json', 'content-length': Buffer.byteLength(body), cookie: createAuth(workspace.store).cookie(token).split(';')[0], 'x-csrf-token': csrfFor(token) } }, res => {
      const chunks = []; res.on('data', chunk => chunks.push(chunk)); res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString()) }));
    });
    req.on('error', reject); req.end(body);
  });
  await started;
  const firstClose = workspace.close(); assert.equal(workspace.close(), firstClose);
  const result = await response; await firstClose;
  assert.equal(aborted, true); assert.equal(result.status, 409); assert.equal(result.body.error.code, 'assistant_cancelled');
  assert.equal(workspace.server.listening, false);
  assert.throws(() => workspace.store.getProfile(actor));
  const reopened = openStore({ dataDir, create: false });
  try { assert.equal(reopened.getAssistantUsage(actor).lifetimeAttempts, 1); assert.deepEqual(reopened.getAssistantUsage(actor).statuses, { cancelled: 1 }); }
  finally { reopened.close(); }
});
async function fixture(t) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'panelreply-http-'));
  let store = openStore({ dataDir });
  passwordHash ||= hashPassword(PASSWORD);
  const user = store.createBusinessOwner({ businessName: 'HTTP Fixture Electric', username: 'http-owner', passwordHash: await passwordHash });
  let app;
  const server = http.createServer((req, res) => app.handler(req, res));
  server.requestTimeout = 10000;
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = 'http://127.0.0.1:' + server.address().port;
  app = createWorkspaceApp({ store, origin });
  t.after(async () => {
    await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    store.close(); fs.rmSync(dataDir, { recursive: true, force: true });
  });
  return { server, user, origin, get store() { return store; }, reopen() { store.close(); store = openStore({ dataDir }); app = createWorkspaceApp({ store, origin }); } };
}
async function request(f, url, options = {}) {
  const response = await fetch(f.origin + url, { redirect: 'manual', ...options, headers: { origin: f.origin, 'content-type': 'application/json', ...options.headers }, body: options.body === undefined ? undefined : JSON.stringify(options.body) });
  const text = await response.text();
  return { response, status: response.status, text, body: text && response.headers.get('content-type')?.startsWith('application/json') ? JSON.parse(text) : text };
}
async function login(f) {
  const result = await request(f, '/api/login', { method: 'POST', body: { username: f.user.username, password: PASSWORD } });
  assert.equal(result.status, 200);
  return { cookie: result.response.headers.get('set-cookie').split(';')[0], 'x-csrf-token': result.body.csrfToken };
}
function rawRequest(f, headers, chunks) {
  return new Promise((resolve, reject) => {
    const req = http.request(f.origin + '/api/leads', { method: 'POST', headers: { origin: f.origin, 'content-type': 'application/json', ...headers } }, res => {
      const received = [];
      res.on('data', chunk => received.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(received).toString() }));
      res.on('error', reject);
    });
    req.on('error', reject);
    for (const chunk of chunks) req.write(chunk);
    req.end();
  });
}

test('HTTP: authentication, persistence, profile, lead updates and logout work over a real socket', { skip: !ENABLED }, async t => {
  const f = await fixture(t);
  const anonymous = await request(f, '/'); assert.equal(anonymous.status, 303);
  assert.equal(anonymous.response.headers.get('location'), '/login');
  const headers = await login(f);
  const profile = await request(f, '/api/profile', { headers });
  assert.equal(profile.status, 200); assert.equal(profile.body.business.name, 'HTTP Fixture Electric');
  const key = crypto.randomUUID();
  const saved = await request(f, '/api/leads', { method: 'POST', headers: { ...headers, 'idempotency-key': key }, body: LEAD });
  assert.equal(saved.status, 201); assert.equal(saved.body.lead.phone, '+12485550123');
  f.reopen();
  const persisted = await request(f, '/api/leads/' + saved.body.lead.id, { headers });
  assert.deepEqual(persisted.body.lead, saved.body.lead);
  const updated = await request(f, '/api/leads/' + saved.body.lead.id, { method: 'PATCH', headers, body: { version: 1, status: 'contacted', notes: 'Owner recorded contact' } });
  assert.equal(updated.status, 200); assert.equal(updated.body.lead.version, 2);
  const stale = await request(f, '/api/leads/' + saved.body.lead.id, { method: 'PATCH', headers, body: { version: 1, status: 'closed' } });
  assert.equal(stale.status, 409);
  assert.equal((await request(f, '/api/logout', { method: 'POST', headers })).status, 204);
  assert.equal((await request(f, '/api/leads', { headers })).status, 401);
});

test('HTTP: parallel retries commit exactly one lead and conflicting data returns409', { skip: !ENABLED }, async t => {
  const f = await fixture(t); const headers = await login(f);
  headers['idempotency-key'] = crypto.randomUUID();
  const results = await Promise.all(Array.from({ length: 4 }, () => request(f, '/api/leads', { method: 'POST', headers, body: LEAD })));
  assert.deepEqual(results.map(result => result.status).sort(), [200, 200, 200, 201]);
  assert.equal(new Set(results.map(result => result.body.lead.id)).size, 1);
  assert.equal(f.store.listLeads(f.user).length, 1);
  const changed = await request(f, '/api/leads', { method: 'POST', headers, body: { ...LEAD, zip: '48316' } });
  assert.equal(changed.status, 409);
});

test('HTTP: CSRF, Origin and Host checks deny cross-origin writes without exposing CORS', { skip: !ENABLED }, async t => {
  const f = await fixture(t); const headers = await login(f);
  const noToken = await request(f, '/api/leads', { method: 'POST', headers: { cookie: headers.cookie, 'idempotency-key': crypto.randomUUID() }, body: LEAD });
  assert.equal(noToken.status, 403);
  const wrongOrigin = await request(f, '/api/leads', { method: 'POST', headers: { ...headers, origin: 'https://unrelated.example.test', 'idempotency-key': crypto.randomUUID() }, body: LEAD });
  assert.equal(wrongOrigin.status, 403);
  assert.equal(wrongOrigin.response.headers.get('access-control-allow-origin'), null);
  const wrongHost = await rawRequest(f, { ...headers, host: 'unrelated.example.test', 'idempotency-key': crypto.randomUUID() }, [JSON.stringify(LEAD)]);
  assert.equal(wrongHost.status, 421);
  assert.equal(f.store.listLeads(f.user).length, 0);
});

test('HTTP: declared and chunked oversized bodies return413 without a saved record', { skip: !ENABLED }, async t => {
  const f = await fixture(t); const headers = await login(f);
  headers['idempotency-key'] = crypto.randomUUID();
  const text = 'x'.repeat(MAX_BODY_BYTES + 1);
  const declared = await rawRequest(f, { ...headers, 'content-length': String(Buffer.byteLength(text)) }, [text]);
  assert.equal(declared.status, 413);
  const chunked = await rawRequest(f, headers, ['{"extra":"', text.slice(0, 32000), text.slice(32000), '"}']);
  assert.equal(chunked.status, 413);
  assert.equal(JSON.parse(chunked.text).error.code, 'body_too_large');
  assert.equal(f.store.listLeads(f.user).length, 0);
});

test('HTTP: STOP persists without lead save and later re-entry cannot enable replies/contact', { skip: !ENABLED }, async t => {
  const f = await fixture(t); const headers = await login(f);
  const stopped = await request(f, '/api/preview', { method: 'POST', headers, body: { message: 'STOP', state: { phone: '+12485550123' } } });
  assert.equal(stopped.status, 200); assert.equal(stopped.body.state.stopped, true);
  assert.deepEqual(f.store.listLeads(f.user), []);
  f.reopen();
  const reset = await request(f, '/api/preview', { method: 'POST', headers, body: { message: 'My phone is 248-555-0123', state: null } });
  assert.equal(reset.status, 200); assert.equal(reset.body.state.stopped, true); assert.deepEqual(reset.body.replies, []);
  const saved = await request(f, '/api/leads', { method: 'POST', headers: { ...headers, 'idempotency-key': crypto.randomUUID() }, body: LEAD });
  assert.equal(saved.status, 201); assert.equal(saved.body.lead.optedOut, true); assert.equal(saved.body.lead.contactAllowed, false);
});

test('HTTP: authenticated HTML and public scripts load with restrictive headers and source paths remain unavailable', { skip: !ENABLED }, async t => {
  const f = await fixture(t); const headers = await login(f);
  for (const url of ['/', '/preview', '/login', '/assets/styles.css', '/assets/app.js', '/assets/preview.js', '/assets/login.js']) {
    const result = await request(f, url, { headers });
    assert.equal(result.status, 200, url);
    assert.equal(result.response.headers.get('cache-control'), 'no-store');
    assert.match(result.response.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  }
  for (const url of ['/workspace/store.cjs', '/workspace.sqlite', '/.env', '/server.cjs']) assert.equal((await request(f, url, { headers })).status, 404);
});
