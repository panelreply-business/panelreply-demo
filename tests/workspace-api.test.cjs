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
const { hashPassword } = require('../workspace/auth.cjs');
const { createWorkspaceApp, MAX_BODY_BYTES } = require('../workspace/api.cjs');
const { workspaceConfig } = require('../workspace-server.cjs');
const { main: createOwner, parseArgs, readPassword } = require('../scripts/workspace-admin.cjs');
const { client, settle } = require('./platform-client-fixture.cjs');

const ORIGIN = 'http://127.0.0.1:10001';
const PASSWORD = 'fixture-only-password-2026';
const passwordHash = hashPassword(PASSWORD);
const LEAD = { customerName: 'Alex Fixture', phone: '(248) 555-0123', job: 'Install a garage EV charger', zip: '48315', callbackWindow: 'Friday afternoon', requestedWorkDate: 'Next week', contactPermission: 'requested_callback', conversation: [] };
async function fixture(t, options = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'panelreply-api-'));
  let store = openStore({ dataDir, now: options.now });
  const user = store.createBusinessOwner({ businessName: 'Fixture Electric', username: 'owner@example.test', passwordHash: await passwordHash });
  let app = createWorkspaceApp({ store, origin: options.origin || ORIGIN, previewMessage: options.previewMessage });
  t.after(() => { store.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });
  return { get app() { return app; }, get store() { return store; }, user, dataDir, origin: options.origin || ORIGIN, reopen() { store.close(); store = openStore({ dataDir, now: options.now }); app = createWorkspaceApp({ store, origin: options.origin || ORIGIN }); } };
}
async function request(app, options = {}) {
  const raw = options.raw !== undefined ? options.raw : options.input === undefined ? '' : JSON.stringify(options.input);
  const req = options.stream || Readable.from(options.chunks || [raw]);
  req.method = options.method || 'GET'; req.url = options.url || '/api/session';
  req.headers = { host: new URL(options.origin || ORIGIN).host, origin: options.origin || ORIGIN, 'content-type': 'application/json', ...options.headers };
  req.socket = { remoteAddress: options.remoteAddress || '127.0.0.1' };
  const res = new EventEmitter();
  res.writableEnded = false; res.destroyed = false;
  res.writeHead = (status, headers) => { res.status = status; res.headers = headers; };
  res.end = body => { res.text = body === undefined ? '' : Buffer.isBuffer(body) ? body.toString() : body; res.writableEnded = true; };
  await app.handler(req, res);
  return { status: res.status, headers: res.headers, text: res.text, body: res.text && res.headers['Content-Type'].startsWith('application/json') ? JSON.parse(res.text) : res.text };
}
async function login(f, options = {}) {
  const result = await request(f.app, { method: 'POST', url: '/api/login', origin: f.origin, input: { username: f.user.username, password: PASSWORD }, ...options });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  return { result, headers: { cookie: result.headers['Set-Cookie'].split(';')[0], 'x-csrf-token': result.body.csrfToken } };
}

test('private pages redirect to login, APIs deny anonymous access, and safe health has no secrets', async t => {
  const f = await fixture(t);
  for (const url of ['/', '/preview']) { const result = await request(f.app, { url }); assert.equal(result.status, 303); assert.equal(result.headers.Location, '/login'); }
  for (const url of ['/api/session', '/api/profile', '/api/leads']) assert.equal((await request(f.app, { url })).status, 401);
  const health = await request(f.app, { url: '/health' });
  assert.deepEqual(health.body, { ok: true, mode: 'private-local', aiEnabled: false, bookingEnabled: false });
  assert.equal(health.headers['Cache-Control'], 'no-store');
  assert.equal(health.headers['X-Content-Type-Options'], 'nosniff');
  assert.ok(!health.text.includes(f.dataDir));
  assert.equal((await request(f.app, { url: '/favicon.ico' })).status, 204);
});

test('login/session/logout use private cookies and revoke replayed tokens', async t => {
  const f = await fixture(t);
  const signed = await login(f);
  const setCookie = signed.result.headers['Set-Cookie'];
  assert.match(setCookie, /^PanelReplyLocalSession=[A-Za-z0-9_-]{43};/);
  for (const required of ['HttpOnly', 'SameSite=Strict', 'Path=/', 'Max-Age=28800']) assert.ok(setCookie.includes(required));
  assert.ok(!signed.result.text.includes('password'));
  assert.deepEqual(signed.result.body.user, f.user);
  const session = await request(f.app, { headers: signed.headers });
  assert.deepEqual(session.body, signed.result.body);
  const revoked = await request(f.app, { method: 'POST', url: '/api/logout', headers: signed.headers });
  assert.equal(revoked.status, 204);
  assert.match(revoked.headers['Set-Cookie'], /Max-Age=0/);
  assert.equal((await request(f.app, { headers: signed.headers })).status, 401);
  f.reopen();
  assert.equal((await request(f.app, { headers: signed.headers })).status, 401);
});

test('HTTPS handlers issue Secure host-only cookies and new sign-in rotates and revokes the old session', async t => {
  const f = await fixture(t, { origin: 'https://workspace.example.test' });
  const first = await login(f);
  assert.match(first.result.headers['Set-Cookie'], /^__Host-PanelReplySession=/);
  assert.match(first.result.headers['Set-Cookie'], /; Secure$/);
  assert.doesNotMatch(first.result.headers['Set-Cookie'], /Domain=/);
  const second = await login(f, { headers: first.headers });
  assert.notEqual(second.headers.cookie, first.headers.cookie);
  assert.equal((await request(f.app, { origin: f.origin, headers: first.headers })).status, 401);
  assert.equal((await request(f.app, { origin: f.origin, headers: second.headers })).status, 200);
});

test('every mutation requires an exact origin and authenticated writes require the session CSRF token', async t => {
  const f = await fixture(t);
  for (const origin of [undefined, 'null', 'https://unrelated.example.test', ORIGIN + '/']) {
    const result = await request(f.app, { method: 'POST', url: '/api/login', headers: { origin }, input: { username: f.user.username, password: PASSWORD } });
    assert.equal(result.status, 403); assert.equal(result.body.error.code, 'origin_rejected');
  }
  const signed = await login(f);
  const cases = [
    { cookie: signed.headers.cookie },
    { ...signed.headers, 'x-csrf-token': 'incorrect' },
    { ...signed.headers, origin: 'https://unrelated.example.test' }
  ];
  for (const headers of cases) {
    const result = await request(f.app, { method: 'POST', url: '/api/leads', headers: { ...headers, 'idempotency-key': crypto.randomUUID() }, input: LEAD });
    assert.equal(result.status, 403);
  }
  assert.equal(f.store.listLeads(f.user).length, 0);
  const other = await login(f);
  const crossed = await request(f.app, { method: 'POST', url: '/api/logout', headers: { cookie: signed.headers.cookie, 'x-csrf-token': other.result.body.csrfToken } });
  assert.equal(crossed.status, 403);
  assert.equal((await request(f.app, { headers: signed.headers })).status, 200);
});

test('duplicate or tampered cookies fail authentication and untrusted Host/forwarded headers cannot bypass the origin', async t => {
  const f = await fixture(t);
  const signed = await login(f);
  for (const cookie of [signed.headers.cookie + '; ' + signed.headers.cookie, 'PanelReplyLocalSession=short', signed.headers.cookie.slice(0, -1) + '!']) assert.equal((await request(f.app, { headers: { cookie } })).status, 401);
  const rebinding = await request(f.app, { url: '/health', headers: { host: 'unrelated.example.test', 'x-forwarded-host': '127.0.0.1:10001' } });
  assert.equal(rebinding.status, 421);
  const preflight = await request(f.app, { method: 'OPTIONS', url: '/api/leads', headers: { origin: 'https://unrelated.example.test' } });
  assert.equal(preflight.headers['Access-Control-Allow-Origin'], undefined);
});

test('login failures are generic and persistent throttling blocks further password attempts', async t => {
  const f = await fixture(t);
  for (let i = 0; i < 5; i++) {
    const result = await request(f.app, { method: 'POST', url: '/api/login', input: { username: f.user.username, password: 'wrong-fixture-password' } });
    assert.equal(result.status, 401); assert.equal(result.body.error.code, 'invalid_credentials');
  }
  f.reopen();
  const limited = await request(f.app, { method: 'POST', url: '/api/login', input: { username: f.user.username, password: PASSWORD } });
  assert.equal(limited.status, 429); assert.equal(limited.headers['Retry-After'], '900');
  const unknown = await request(f.app, { method: 'POST', url: '/api/login', input: { username: 'missing@example.test', password: PASSWORD } });
  assert.equal(unknown.status, 401); assert.equal(unknown.body.error.code, 'invalid_credentials');
});

test('JSON content, bounded length, unsupported fields and invalid UTF-8 fail before saving', async t => {
  const f = await fixture(t);
  const signed = await login(f);
  const base = { method: 'POST', url: '/api/leads', headers: { ...signed.headers, 'idempotency-key': crypto.randomUUID() } };
  const cases = [
    { raw: '{', expected: 400 }, { raw: '[]', expected: 400 }, { raw: 'null', expected: 400 },
    { input: { ...LEAD, businessId: f.user.businessId }, expected: 400 },
    { raw: Buffer.from([0xff, 0xfe]), expected: 400 },
    { raw: 'x'.repeat(MAX_BODY_BYTES + 1), expected: 413 },
    { input: LEAD, headers: { 'content-type': 'text/plain' }, expected: 415 },
    { input: LEAD, headers: { 'content-encoding': 'gzip' }, expected: 415 },
    { input: LEAD, headers: { 'content-length': String(MAX_BODY_BYTES + 1) }, expected: 413 },
    { input: LEAD, headers: { 'content-length': '5' }, expected: 400 },
    { input: LEAD, headers: { 'content-length': '-1' }, expected: 400 }
  ];
  for (const item of cases) {
    const result = await request(f.app, { ...base, ...item, headers: { ...base.headers, ...item.headers } });
    assert.equal(result.status, item.expected, JSON.stringify(result.body));
  }
  assert.equal(f.store.listLeads(f.user).length, 0);
  const interrupted = Readable.from((async function* () { yield '{"customerName":"Alex"'; throw new Error('fixture connection interruption'); })());
  const failed = await request(f.app, { ...base, stream: interrupted });
  assert.equal(failed.status, 400); assert.equal(failed.body.error.code, 'incomplete_body');
  assert.equal(f.store.listLeads(f.user).length, 0);
});

test('lead create/retry/update/profile operations preserve version and tenant boundaries', async t => {
  const f = await fixture(t);
  const signed = await login(f);
  const headers = { ...signed.headers, 'idempotency-key': crypto.randomUUID() };
  const saved = await request(f.app, { method: 'POST', url: '/api/leads', headers, input: LEAD });
  assert.equal(saved.status, 201); assert.equal(saved.body.created, true);
  const retry = await request(f.app, { method: 'POST', url: '/api/leads', headers, input: LEAD });
  assert.equal(retry.status, 200); assert.equal(retry.body.lead.id, saved.body.lead.id);
  const changedRetry = await request(f.app, { method: 'POST', url: '/api/leads', headers, input: { ...LEAD, zip: '48316' } });
  assert.equal(changedRetry.status, 409);
  const url = '/api/leads/' + saved.body.lead.id;
  const updated = await request(f.app, { method: 'PATCH', url, headers, input: { version: 1, status: 'needs_review', notes: 'Review requested' } });
  assert.equal(updated.status, 200); assert.equal(updated.body.lead.version, 2);
  assert.equal((await request(f.app, { method: 'PATCH', url, headers, input: { version: 1, status: 'closed' } })).status, 409);
  assert.equal((await request(f.app, { method: 'GET', url: '/api/leads', headers })).body.leads.length, 1);
  const bob = f.store.createBusinessOwner({ businessName: 'Second Fixture', username: 'second@example.test', passwordHash: await passwordHash });
  const bLogin = await request(f.app, { method: 'POST', url: '/api/login', input: { username: bob.username, password: PASSWORD } });
  const bHeaders = { cookie: bLogin.headers['Set-Cookie'].split(';')[0], 'x-csrf-token': bLogin.body.csrfToken };
  assert.equal((await request(f.app, { url, headers: bHeaders })).status, 404);
  assert.equal((await request(f.app, { method: 'PATCH', url, headers: bHeaders, input: { version: 2, status: 'closed' } })).status, 404);
  const profile = await request(f.app, { url: '/api/profile', headers });
  const profileInput = { version: profile.body.version, businessName: 'Reviewed Fixture', facts: profile.body.facts };
  profileInput.facts.services = { verified: true, answer: 'EV charger installations' };
  assert.equal((await request(f.app, { method: 'PATCH', url: '/api/profile', headers, input: profileInput })).status, 200);
  assert.equal((await request(f.app, { method: 'PATCH', url: '/api/profile', headers, input: profileInput })).status, 409);
});

test('request editor consumes API normalization and confirms later opt-out state without replaying a committed update', async t => {
  const f = await fixture(t), signed = await login(f);
  const created = await request(f.app, { method: 'POST', url: '/api/leads',
    headers: { ...signed.headers, 'idempotency-key': crypto.randomUUID() }, input: LEAD });
  assert.equal(created.status, 201);
  const initial = created.body.lead, url = '/api/leads/' + initial.id;
  let phase = 'fresh', lostWrites = 0;
  const reply = result => ({ status: result.status, ok: result.status >= 200 && result.status < 300,
    headers: result.headers, json: async () => structuredClone(result.body) });
  const page = client('app.js', { lead: initial.id, respond: async (route, outgoing) => {
    if (route === url && outgoing.method === 'PATCH' && phase === 'lost' && ++lostWrites === 2) {
      return reply({ status: 403, body: { error: { code: 'forbidden', message: 'Synthetic refusal after a lost committed response' } } });
    }
    const response = await request(f.app, { method: outgoing.method || 'GET', url: route, raw: outgoing.body || '',
      headers: { cookie: signed.headers.cookie, ...Object.fromEntries(Object.entries(outgoing.headers || {}).map(([key, value]) => [key.toLowerCase(), value])) } });
    if (route === url && outgoing.method === 'PATCH' && phase === 'lost' && lostWrites === 1) {
      assert.equal(response.status, 200);
      throw new Error('Synthetic loss of the real committed API response');
    }
    return reply(response);
  } });
  await settle();
  assert.equal(page.element('lead-version').textContent, 'Revision 1');
  page.element('lead-name').value = '  Fixture owner 🔧  ';
  page.element('lead-phone').value = '1 (248) 555-0123';
  page.element('lead-job').value = '  Install a charger\nUse the reviewed plan  ';
  page.element('lead-callback').value = '  Afternoon  ';
  page.element('lead-work-date').value = '  Next week  ';
  page.element('lead-notes').value = '  First saved note 🔧  ';
  page.element('lead-status-select').value = 'needs_review';
  await page.element('lead-form').emit('submit');
  assert.match(page.element('lead-status').textContent, /Changes saved/);
  const fresh = f.store.getLead(f.user, initial.id);
  assert.equal(fresh.version, 2);
  for (const [key, id] of Object.entries({ customerName: 'lead-name', phone: 'lead-phone', job: 'lead-job', callbackWindow: 'lead-callback', requestedWorkDate: 'lead-work-date', notes: 'lead-notes' })) {
    assert.equal(page.element(id).value, fresh[key]);
  }
  assert.equal(fresh.customerName, 'Fixture owner 🔧');
  assert.equal(fresh.phone, '+12485550123');
  assert.equal(fresh.notes, 'First saved note 🔧');
  phase = 'lost';
  page.element('lead-notes').value = '  Confirm this saved note after STOP  ';
  await page.element('lead-form').emit('submit');
  assert.equal(page.element('lead-fields').disabled, true);
  assert.equal(page.element('lead-status').textContent, '');
  assert.equal(page.element('save-lead').textContent, 'Retry save');
  assert.equal(f.store.getLead(f.user, initial.id).version, 3);
  await page.element('lead-form').emit('submit');
  assert.equal(page.element('lead-fields').disabled, true);
  assert.equal(page.element('lead-notes').value, '  Confirm this saved note after STOP  ');
  assert.match(page.element('lead-error').textContent, /Synthetic refusal/);
  const stop = await request(f.app, { method: 'POST', url: '/api/leads',
    headers: { ...signed.headers, 'idempotency-key': crypto.randomUUID() }, input: { ...LEAD, contactPermission: 'opted_out' } });
  assert.equal(stop.status, 201);
  const restricted = f.store.getLead(f.user, initial.id);
  // This request already needs review, so STOP changes the public restriction
  // without another parent revision. Revision3 still follows submitted version2.
  assert.equal(restricted.version, 3);
  assert.equal(restricted.contactPermission, 'opted_out');
  assert.equal(restricted.contactAllowed, false);
  await page.element('lead-form').emit('submit');
  assert.match(page.element('lead-status').textContent, /Saved values confirmed/);
  assert.doesNotMatch(page.element('lead-status').textContent, /Changes saved/);
  assert.equal(page.element('lead-notes').value, 'Confirm this saved note after STOP');
  assert.equal(page.element('lead-permission').value, 'opted_out');
  assert.equal(page.element('lead-version').textContent, 'Revision ' + restricted.version);
  assert.equal(page.element('callback-task-fields').disabled, true);
  const writes = page.calls.filter(call => call.path === url && call.method === 'PATCH').slice(1);
  assert.equal(writes.length, 3);
  assert.deepEqual(writes, [writes[0], writes[0], writes[0]]);
  assert.equal(JSON.parse(writes[0].body).version, 2);
  assert.equal(writes[0].headers['Idempotency-Key'], undefined);
  assert.equal(f.store.getLead(f.user, initial.id).audit.filter(entry => entry.action === 'lead.updated').length, 2);
  assert.deepEqual(f.store.getLead(f.user, initial.id), restricted);
});

test('request receipt phone normalization rejects forbidden input while preserving permitted whitespace', async t => {
  const f = await fixture(t), signed = await login(f);
  const created = await request(f.app, { method: 'POST', url: '/api/leads',
    headers: { ...signed.headers, 'idempotency-key': crypto.randomUUID() }, input: LEAD });
  assert.equal(created.status, 201);
  const initial = created.body.lead, url = '/api/leads/' + initial.id, observations = [];
  const reply = result => ({ status: result.status, ok: result.status >= 200 && result.status < 300,
    headers: result.headers, json: async () => structuredClone(result.body) });
  async function transport(route, outgoing) {
    return reply(await request(f.app, { method: outgoing.method || 'GET', url: route, raw: outgoing.body || '',
      headers: { cookie: signed.headers.cookie, ...Object.fromEntries(Object.entries(outgoing.headers || {}).map(([key, value]) => [key.toLowerCase(), value])) } }));
  }
  for (const phone of ['\u000b2485550123', '248\u000c5550123', '2485550123\u000c', '248\ud8005550123']) {
    const rejected = await request(f.app, { method: 'PATCH', url, headers: signed.headers,
      input: { version: initial.version, status: initial.status, phone, notes: 'Keep rejected phone draft' } });
    assert.equal(rejected.status, 400);
    assert.deepEqual(rejected.body.error.fields, ['phone']);
    assert.deepEqual(f.store.getLead(f.user, initial.id), initial);
    const page = client('app.js', { lead: initial.id, respond: async (route, outgoing) => {
      if (route === url && outgoing.method === 'PATCH') {
        const body = JSON.parse(outgoing.body), version = initial.version + 1;
        return reply({ status: 200, body: { lead: { ...initial, ...body, phone: initial.phone, version,
          audit: [...initial.audit, { action: 'lead.updated', version, createdAt: initial.updatedAt, details: { fields: ['phone', 'notes'] } }] } } });
      }
      return transport(route, outgoing);
    } });
    await settle();
    page.element('lead-phone').value = phone;
    page.element('lead-notes').value = 'Keep rejected phone draft';
    await page.element('lead-form').emit('submit');
    observations.push({ phone, apiStatus: rejected.status, fieldsLocked: page.element('lead-fields').disabled,
      version: page.element('lead-version').textContent, status: page.element('lead-status').textContent,
      phoneRetained: page.element('lead-phone').value === phone, note: page.element('lead-notes').value });
  }
  const valid = client('app.js', { lead: initial.id, respond: transport });
  await settle();
  valid.element('lead-phone').value = '\t248\t555-0123\r';
  valid.element('lead-notes').value = '  Permitted whitespace control  ';
  await valid.element('lead-form').emit('submit');
  assert.match(valid.element('lead-status').textContent, /Changes saved/);
  assert.equal(valid.element('lead-phone').value, '+12485550123');
  assert.equal(valid.element('lead-notes').value, 'Permitted whitespace control');
  assert.equal(valid.element('lead-version').textContent, 'Revision 2');
  assert.equal(f.store.getLead(f.user, initial.id).audit.filter(entry => entry.action === 'lead.updated').length, 1);
  assert.equal(observations.every(result => result.apiStatus === 400 && result.fieldsLocked
    && result.version === 'Revision 1' && result.status === '' && result.phoneRetained && result.note === 'Keep rejected phone draft'), true,
  JSON.stringify(observations));
});

test('valid Unicode at every supported lead limit fits the bounded JSON body', async t => {
  const f = await fixture(t);
  const signed = await login(f);
  const input = { ...LEAD, customerName: '漢'.repeat(120), job: 'Install ' + '漢'.repeat(1992), callbackWindow: '漢'.repeat(200), requestedWorkDate: '漢'.repeat(200), conversation: Array.from({ length: 10 }, () => ({ role: 'customer', text: '漢'.repeat(2000) })) };
  const raw = JSON.stringify(input).replace(/漢/g, '\\u6f22');
  assert.ok(Buffer.byteLength(raw) > 64 * 1024);
  assert.ok(Buffer.byteLength(raw) < MAX_BODY_BYTES);
  const saved = await request(f.app, { method: 'POST', url: '/api/leads', headers: { ...signed.headers, 'idempotency-key': crypto.randomUUID() }, raw });
  assert.equal(saved.status, 201); assert.equal(saved.body.lead.customerName, input.customerName);
  assert.deepEqual(saved.body.lead.conversation, input.conversation);
});

test('API rejects escaped unpaired UTF-16 without writes and preserves paired Unicode through export', async t => {
  const f = await fixture(t), signed = await login(f), profile = f.store.getProfile(f.user);
  const key = crypto.randomUUID(), headers = { ...signed.headers, 'idempotency-key': key };
  for (const malformed of ['Synthetic\ud800message', 'Synthetic\udc00message']) {
    const badLead = await request(f.app, { method: 'POST', url: '/api/leads', headers,
      input: { ...LEAD, conversation: [{ role: 'customer', text: malformed }] } });
    assert.equal(badLead.status, 400); assert.equal(badLead.body.error.code, 'invalid_input');
    assert.deepEqual(badLead.body.error.fields, ['conversation']);
    assert.deepEqual(f.store.listLeads(f.user), []);
    const badProfile = await request(f.app, { method: 'PATCH', url: '/api/profile', headers: signed.headers,
      input: { version: profile.version, businessName: malformed, facts: profile.facts } });
    assert.equal(badProfile.status, 400); assert.deepEqual(badProfile.body.error.fields, ['businessName']);
    assert.deepEqual(f.store.getProfile(f.user), profile);
  }
  // A valid pair at the transcript's UTF-16 length boundary must survive both
  // escaped JSON and SQLite TEXT. A literal U+FFFD is valid text as well.
  const message = '\ud83d\udd0c'.repeat(1000), businessName = 'Synthetic \ud83d\udd0c e\u0301 \u6f22 \ufffd';
  const validProfile = await request(f.app, { method: 'PATCH', url: '/api/profile', headers: signed.headers,
    input: { version: profile.version, businessName, facts: profile.facts } });
  assert.equal(validProfile.status, 200); assert.equal(validProfile.body.business.name, businessName);
  const input = { ...LEAD, conversation: [{ role: 'customer', text: message }] };
  const raw = JSON.stringify(input).replaceAll('\ud83d\udd0c', '\\ud83d\\udd0c');
  const accepted = await request(f.app, { method: 'POST', url: '/api/leads', headers, raw });
  assert.equal(accepted.status, 201); assert.equal(accepted.body.lead.conversation[0].text, message);
  const saved = accepted.body.lead;
  const badNotes = await request(f.app, { method: 'PATCH', url: '/api/leads/' + saved.id, headers: signed.headers,
    input: { version: saved.version, status: 'new', notes: 'Correction\ud800' } });
  assert.equal(badNotes.status, 400); assert.deepEqual(badNotes.body.error.fields, ['notes']);
  assert.deepEqual(f.store.getLead(f.user, saved.id), saved);
  const retry = await request(f.app, { method: 'POST', url: '/api/leads', headers, raw });
  assert.equal(retry.status, 200); assert.equal(retry.body.created, false); assert.deepEqual(retry.body.lead, saved);
  const exported = await request(f.app, { url: '/api/export', headers: signed.headers });
  assert.equal(exported.status, 200);
  assert.equal(exported.body.profile.business.name, businessName);
  assert.equal(exported.body.leads[0].conversation[0].text, message);
});

test('preview only uses verified business facts and persists no lead until explicit save', async t => {
  const f = await fixture(t);
  const signed = await login(f);
  const profile = f.store.getProfile(f.user);
  profile.facts.pricing = { verified: true, answer: 'Pricing needs an on-site assessment.' };
  profile.facts.warranty = { verified: false, answer: 'UNVERIFIED FIXTURE CLAIM' };
  f.store.updateProfile(f.user, { version: 1, businessName: profile.business.name, facts: profile.facts });
  const price = await request(f.app, { method: 'POST', url: '/api/preview', headers: signed.headers, input: { message: 'How much will this cost?', state: null } });
  assert.equal(price.status, 200); assert.ok(price.body.replies.join(' ').includes('Pricing needs an on-site assessment.'));
  const warranty = await request(f.app, { method: 'POST', url: '/api/preview', headers: signed.headers, input: { message: 'Do you offer a warranty?', state: null } });
  assert.equal(warranty.status, 200); assert.ok(!warranty.body.replies.join(' ').includes('UNVERIFIED FIXTURE CLAIM'));
  assert.equal(f.store.listLeads(f.user).length, 0);
});

test('STOP before saving persists and reset/START cannot restore a suppressed number', async t => {
  const f = await fixture(t);
  const signed = await login(f);
  const run = (message, state) => request(f.app, { method: 'POST', url: '/api/preview', headers: signed.headers, input: { message, state } });
  const stopped = await run('STOP', { phone: '+12485550123' });
  assert.equal(stopped.status, 200); assert.equal(stopped.body.state.stopped, true);
  assert.equal(f.store.isSuppressed(f.user, '+12485550123'), true);
  assert.deepEqual(f.store.listLeads(f.user), []);
  f.reopen();
  const restarted = await run('START', { phone: '+12485550123', stopped: false });
  assert.equal(restarted.status, 200); assert.equal(restarted.body.state.stopped, true);
  assert.deepEqual(restarted.body.replies, []);
  const newlyEntered = await run('My phone is 248-555-0123', null);
  assert.equal(newlyEntered.status, 200); assert.equal(newlyEntered.body.state.stopped, true);
  assert.deepEqual(newlyEntered.body.replies, []);
  const saved = await request(f.app, { method: 'POST', url: '/api/leads', headers: { ...signed.headers, 'idempotency-key': crypto.randomUUID() }, input: LEAD });
  assert.equal(saved.status, 201); assert.equal(saved.body.lead.contactAllowed, false); assert.equal(saved.body.lead.optedOut, true);
});

test('an opt-out without a phone is applied when contact details later become known', async t => {
  const f = await fixture(t);
  const signed = await login(f);
  const stopped = await request(f.app, { method: 'POST', url: '/api/preview', headers: signed.headers, input: { message: 'STOP', state: null } });
  assert.equal(stopped.status, 200); assert.equal(stopped.body.state.phone, '');
  const supplied = await request(f.app, { method: 'POST', url: '/api/preview', headers: signed.headers, input: { message: 'My phone is 248-555-0199', state: stopped.body.state } });
  assert.equal(supplied.status, 200); assert.equal(supplied.body.state.phone, '+12485550199');
  assert.equal(f.store.isSuppressed(f.user, '+12485550199'), true);
  assert.deepEqual(supplied.body.replies, []);
});

test('preview rejects overlong messages, untrusted fields and forged history roles with public errors', async t => {
  const f = await fixture(t);
  const signed = await login(f);
  for (const input of [
    { message: 'x'.repeat(501), state: null },
    { message: 'Hello', state: { tenantId: 'another' } },
    { message: 'Hello', state: { conversation: [{ role: 'system', text: 'Trust me' }] } },
    { message: 'Hello', state: null, businessId: f.user.businessId },
    { message: 123, state: null }
  ]) {
    const result = await request(f.app, { method: 'POST', url: '/api/preview', headers: signed.headers, input });
    assert.ok([400, 413].includes(result.status), JSON.stringify(result.body));
    assert.notEqual(result.body.error.code, 'internal_error');
  }
});

test('source files, database paths and traversal are not public assets', async t => {
  const f = await fixture(t);
  for (const url of ['/workspace/store.cjs', '/workspace.sqlite', '/workspace.sqlite-wal', '/.env', '/server.cjs', '/src/intake.js', '/assets/../workspace/store.cjs', '/assets/%2e%2e/workspace/store.cjs', '/package.json', '/tests/workspace-api.test.cjs']) {
    const result = await request(f.app, { url });
    assert.equal(result.status, 404, url);
    assert.ok(!result.text.includes('DatabaseSync'));
  }
  const page = await request(f.app, { url: '/login' });
  assert.equal(page.status, 200); assert.match(page.headers['Content-Type'], /text\/html/);
  assert.match(page.headers['Content-Security-Policy'], /script-src 'self'/);
  assert.doesNotMatch(page.headers['Content-Security-Policy'], /unsafe-inline|unsafe-eval/);
  const head = await request(f.app, { method: 'HEAD', url: '/login' });
  assert.equal(head.status, 200); assert.equal(head.text, '');
});

test('unexpected database errors return a generic failure without SQL, paths or private notes', async t => {
  const f = await fixture(t);
  const signed = await login(f);
  const original = f.store.listLeads;
  f.store.listLeads = () => { throw new Error('SQL SELECT password_hash at /private/path: PRIVATE NOTES'); };
  const result = await request(f.app, { url: '/api/leads', headers: signed.headers });
  f.store.listLeads = original;
  assert.equal(result.status, 500); assert.equal(result.body.error.code, 'internal_error');
  assert.doesNotMatch(result.text, /SQL|password_hash|private\/path|PRIVATE NOTES/);
});

test('startup binds only loopback with an explicit data location and rejects origin/port mismatch', () => {
  assert.deepEqual(workspaceConfig({ WORKSPACE_DATA_DIR: '/private/fixture' }), { port: 10001, host: '127.0.0.1', origin: ORIGIN, dataDir: '/private/fixture' });
  for (const env of [
    {}, { WORKSPACE_DATA_DIR: 'relative' }, { WORKSPACE_DATA_DIR: '/private/fixture', PORT: '0' },
    { WORKSPACE_DATA_DIR: '/private/fixture', PORT: '65536' },
    { WORKSPACE_DATA_DIR: '/private/fixture', WORKSPACE_ORIGIN: 'http://0.0.0.0:10001' },
    { WORKSPACE_DATA_DIR: '/private/fixture', WORKSPACE_ORIGIN: 'https://workspace.example.test' },
    { WORKSPACE_DATA_DIR: '/private/fixture', WORKSPACE_ORIGIN: 'http://127.0.0.1:10002' },
    { WORKSPACE_DATA_DIR: '/private/fixture', WORKSPACE_ORIGIN: ORIGIN + '/path' }
  ]) assert.throws(() => workspaceConfig(env));
});

test('admin CLI reads passwords only from stdin and creates one explicit local owner', async t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'panelreply-admin-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const args = ['--data-dir', dataDir, '--business', 'CLI Fixture', '--username', 'cli-owner'];
  const result = await createOwner(args, Readable.from([PASSWORD + '\n']));
  assert.equal(result.username, 'cli-owner');
  assert.ok(!JSON.stringify(result).includes(PASSWORD));
  const store = openStore({ dataDir });
  try { assert.equal(store.getProfile({ id: result.userId, businessId: result.businessId }).business.name, 'CLI Fixture'); }
  finally { store.close(); }
  assert.throws(() => parseArgs([...args, '--password', PASSWORD]), /Usage/);
  assert.throws(() => parseArgs(['--data-dir', dataDir, '--data-dir', dataDir, '--username', 'cli-owner']), /supported option/);
  await assert.rejects(readPassword(Readable.from(['short\n'])), /15–128/);
  await assert.rejects(readPassword(Readable.from([PASSWORD + '\nsecond-line'])), /line breaks/);
});
