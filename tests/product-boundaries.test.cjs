'use strict';

// Product authorization is enforced by the server, independently of navigation.
// All requests here use actual SQLite with in-process HTTP adapters, no listener.
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
const { openProductStore, productMetadata, productCookieName } = require('../workspace/products.cjs');
const { hashPassword, csrfFor, createAuth } = require('../workspace/auth.cjs');
const { createWorkspaceApp } = require('../workspace/api.cjs');

const PASSWORD = 'Synthetic independent product fixture 2026!';
const HASH = hashPassword(PASSWORD);
const IMAGE = fs.readFileSync(path.join(__dirname, 'fixtures/panels/blank.png'));
const uuid = () => crypto.randomUUID();
const leadInput = () => ({ customerName: 'Synthetic Product Customer', phone: '+15865550101',
  job: 'Install an EV charger', zip: '48315', callbackWindow: 'Monday afternoon', requestedWorkDate: 'Friday',
  contactPermission: 'requested_callback', conversation: [{ role: 'customer', text: 'Please call me about an EV charger.' }] });
const projectInput = () => ({ name: 'Synthetic Product Project', notes: 'Private project notes', rows: [{
  partNumber: 'SYN-001', manufacturer: 'Synthetic Manufacturer', description: 'Synthetic component',
  quantity: 2, reviewStatus: 'reviewed', notes: 'Private row notes', sourceImageId: null
}] });
const sourceInput = version => ({ version, name: 'synthetic.png', mime: 'image/png', dataBase64: IMAGE.toString('base64') });

async function fixture(t, product) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'panelreply-product-' + product + '-'));
  const store = openProductStore({ product, dataDir });
  const actor = store.createBusinessOwner({ businessName: 'Synthetic ' + product + ' business', username: product + '@example.test', passwordHash: await HASH });
  const lead = store.createLead(actor, leadInput(), uuid()).lead;
  let project = store.createPanelProject(actor, projectInput(), uuid()).project;
  const uploaded = store.addPanelSource(actor, project.id, sourceInput(project.version), uuid()); project = uploaded.project;
  const port = product === 'callback' ? 10001 : 10002;
  const origin = 'http://127.0.0.1:' + port;
  const calls = { ocr: 0, status: 0, assistant: 0, session: 0 };
  const session = store.session.bind(store);
  store.session = value => { calls.session++; return session(value); };
  const app = createWorkspaceApp({ store, product, origin,
    ...(product === 'callback' ? { conversationProvider: { kind: 'fake', generate: async () => { calls.assistant++; return { changes: [], clarify: [], answerTopics: [], intent: 'continue' }; } } } : {}),
    recognizeImage: async () => { calls.ocr++; return { engine: 'synthetic-only', rawText: 'SYNTHETIC OCR', warnings: [],
      candidates: [{ partNumber: 'SYN-001', manufacturer: '', description: '', reviewStatus: 'reviewed' }] }; },
    getOcrStatus: async () => { calls.status++; return { available: false, engine: 'tesseract', reason: 'synthetic fixture' }; }
  });
  const token = crypto.randomBytes(32).toString('base64url'); store.createSession(actor.id, digest(token));
  const headers = { cookie: app.auth.cookie(token).split(';')[0], 'x-csrf-token': csrfFor(token), 'x-workspace-session': csrfFor(token), 'idempotency-key': uuid() };
  t.after(() => { app.close(); store.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });
  return { product, dataDir, store, actor, app, origin, port, calls, headers, token, lead, project, source: uploaded.source };
}
async function request(f, { method = 'GET', url = '/api/session', headers = f.headers, input, stream } = {}) {
  const req = stream || Readable.from(input === undefined ? [] : [JSON.stringify(input)]);
  Object.assign(req, { method, url, headers: { host: '127.0.0.1:' + f.port, origin: f.origin, 'content-type': 'application/json', ...headers }, socket: { remoteAddress: '127.0.0.1' } });
  const res = new EventEmitter(); res.writableEnded = false; res.destroyed = false;
  res.writeHead = (status, values) => { res.status = status; res.headers = values; };
  res.end = value => { res.buffer = value === undefined ? Buffer.alloc(0) : Buffer.from(value); res.writableEnded = true; };
  await f.app.handler(req, res);
  const text = res.buffer?.toString('utf8') || '';
  return { status: res.status, headers: res.headers, buffer: res.buffer, text,
    body: res.headers?.['Content-Type']?.startsWith('application/json') && text ? JSON.parse(text) : null };
}
function snapshot(f) {
  const db = new DatabaseSync(f.store.filename, { readOnly: true });
  try {
    return Object.fromEntries(db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
      .map(({ name }) => { assert.match(name, /^[a-z_]+$/); return [name, db.prepare('SELECT * FROM "' + name + '"').all().map(row => JSON.stringify(row)).sort()]; }));
  } finally { db.close(); }
}
const blockedRoutes = {
  callback: [
    ['GET', '/panels'], ['HEAD', '/panels'], ['GET', '/dashboard'], ['GET', '/assets/panels.js'], ['GET', '/assets/dashboard.js'],
    ['GET', '/api/panel-projects'], ['POST', '/api/panel-projects'], ['GET', '/api/panel-ocr'],
    ['GET', '/api/panel-projects/{project}'], ['PATCH', '/api/panel-projects/{project}'], ['DELETE', '/api/panel-projects/{project}'],
    ['GET', '/api/panel-projects/{project}/export.csv'], ['GET', '/api/panel-projects/{project}/export.xlsx'],
    ['POST', '/api/panel-projects/{project}/sources'], ['GET', '/api/panel-projects/{project}/sources/{source}'],
    ['DELETE', '/api/panel-projects/{project}/sources/{source}'], ['POST', '/api/panel-projects/{project}/sources/{source}/ocr']
  ],
  spreadsheet: [
    ['GET', '/preview'], ['HEAD', '/preview'], ['GET', '/dashboard'], ['GET', '/assets/app.js'], ['GET', '/assets/preview.js'], ['GET', '/assets/dashboard.js'], ['GET', '/assets/schedule.js'],
    ['GET', '/api/assistant'], ['GET', '/api/assistant/usage'], ['GET', '/api/profile'], ['PATCH', '/api/profile'],
    ['GET', '/api/leads'], ['POST', '/api/leads'], ['GET', '/api/leads/{lead}'], ['PATCH', '/api/leads/{lead}'],
    ['DELETE', '/api/leads/{lead}'], ['DELETE', '/api/leads/{lead}/conversation'], ['GET', '/api/export'], ['POST', '/api/preview'],
    ['GET', '/api/callback-tasks'], ['POST', '/api/leads/{lead}/tasks'], ['PATCH', '/api/callback-tasks/11111111-1111-4111-8111-111111111111']
  ]
};
for (const product of ['callback', 'spreadsheet']) for (const [method, route] of blockedRoutes[product]) for (const signedIn of [false, true]) {
  test(`PROD.deny.${product}.${method}.${route}.${signedIn ? 'signed-in' : 'anonymous'} | other-product surface is denied before work`, async t => {
    const f = await fixture(t, product);
    const url = route.replace('{project}', f.project.id).replace('{source}', f.source.id).replace('{lead}', f.lead.id);
    const before = snapshot(f), calls = { ...f.calls };
    let bodyRead = false;
    const stream = Readable.from((async function* () { bodyRead = true; yield '{"product":"combined","version":1}'; })());
    const response = await request(f, { method, url, headers: signedIn ? f.headers : {}, stream });
    assert.equal(response.status, 404, response.text); assert.equal(response.body.error.code, 'not_found');
    assert.equal(bodyRead, false, 'blocked product parsed a mutation body');
    assert.deepEqual(f.calls, calls, 'blocked product touched authentication, provider or native OCR');
    assert.deepEqual(snapshot(f), before, 'blocked product changed database state');
    assert.equal(response.text.includes(f.actor.businessId), false); assert.equal(response.text.includes('Private'), false);
  });
}

for (const product of ['callback', 'spreadsheet']) {
  test(`PROD.metadata.${product} | health and session disclose only fixed product capabilities`, async t => {
    const f = await fixture(t, product), expected = productMetadata(product);
    const health = await request(f, { url: '/health', headers: {} });
    assert.equal(health.status, 200); assert.deepEqual(health.body.product, expected);
    assert.equal(health.body.aiEnabled, false); assert.equal(health.body.bookingEnabled, false);
    assert.equal(health.body.product.capabilities.liveCalls, false); assert.equal(health.body.product.capabilities.liveMessages, false);
    const session = await request(f); assert.equal(session.status, 200); assert.deepEqual(session.body.product, expected);
    assert.equal(session.body.user.businessId, f.actor.businessId);
    const changed = await request(f, { url: '/health?product=' + (product === 'callback' ? 'spreadsheet' : 'callback'), headers: { 'x-product': 'combined' } });
    assert.deepEqual(changed.body.product, expected);
  });
  test(`PROD.login.${product} | sign-in and logout use the selected product cookie only`, async t => {
    const f = await fixture(t, product);
    const response = await request(f, { method: 'POST', url: '/api/login', headers: {}, input: { username: f.actor.username, password: PASSWORD } });
    assert.equal(response.status, 200, response.text); assert.deepEqual(response.body.product, productMetadata(product));
    assert.ok(response.headers['Set-Cookie'].startsWith(productCookieName(product, false) + '='));
    assert.match(response.headers['Set-Cookie'], /Path=\/; HttpOnly; SameSite=Strict/);
    const headers = { cookie: response.headers['Set-Cookie'].split(';')[0], 'x-csrf-token': response.body.csrfToken, 'x-workspace-session': response.body.csrfToken };
    assert.equal((await request(f, { headers })).status, 200);
    const logout = await request(f, { method: 'POST', url: '/api/logout', headers });
    assert.equal(logout.status, 204); assert.ok(logout.headers['Set-Cookie'].startsWith(productCookieName(product, false) + '='));
    assert.equal((await request(f, { headers })).status, 401);
  });
  test(`PROD.pages.${product} | allowed pages render the fixed product and excluded assets remain absent`, async t => {
    const f = await fixture(t, product);
    const login = await request(f, { url: '/login', headers: {} });
    assert.equal(login.status, 200, login.text); assert.ok(login.text.includes(productMetadata(product).label));
    assert.equal(login.headers['Content-Length'], login.buffer.length);
    const page = await request(f, { url: product === 'callback' ? '/' : '/panels' });
    assert.equal(page.status, 200, page.text); assert.equal(page.headers['Content-Length'], page.buffer.length);
    assert.ok(page.text.includes('data-product-id="' + product + '"'));
    assert.equal(page.text.includes('href="/dashboard"'), false);
    if (product === 'spreadsheet') {
      const root = await request(f, { url: '/' }); assert.equal(root.status, 303); assert.equal(root.headers.Location, '/panels');
      assert.equal(page.text.includes('src="/assets/app.js"'), false);
    } else assert.equal(page.text.includes('src="/assets/panels.js"'), false);
  });
}

test('PROD.cookies.localhost | both product cookies coexist and cannot authenticate the other program', async t => {
  const callback = await fixture(t, 'callback'), spreadsheet = await fixture(t, 'spreadsheet');
  const both = callback.headers.cookie + '; ' + spreadsheet.headers.cookie;
  assert.notEqual(callback.app.auth.cookieName, spreadsheet.app.auth.cookieName);
  for (const [own, other] of [[callback, spreadsheet], [spreadsheet, callback]]) {
    assert.equal((await request(own, { headers: { ...own.headers, cookie: other.headers.cookie } })).status, 401);
    const ownResponse = await request(own, { headers: { ...own.headers, cookie: both } });
    assert.equal(ownResponse.status, 200); assert.equal(ownResponse.body.user.businessId, own.actor.businessId);
    const renamed = own.app.auth.cookieName + '=' + other.token;
    assert.equal((await request(own, { headers: { ...other.headers, cookie: renamed } })).status, 401, 'foreign database token must not become valid by renaming its cookie');
    assert.equal((await request(own, { headers: { ...own.headers, cookie: 'PanelReplyLocalSession=' + own.token } })).status, 401);
  }
});
test('PROD.cookies.secure | product cookie identities retain Host-prefix restrictions', async t => {
  const f = await fixture(t, 'callback');
  const names = [];
  for (const product of ['callback', 'spreadsheet']) {
    const auth = createAuth(f.store, { secure: true, product });
    names.push(auth.cookieName); assert.ok(auth.cookieName.startsWith('__Host-'));
    assert.match(auth.cookie(f.token), /; Path=\/; HttpOnly; SameSite=Strict; Max-Age=28800; Secure$/);
    assert.equal(auth.cookie(f.token).includes('Domain='), false);
  }
  assert.equal(new Set(names).size, 2);
});

test('PROD.workflow.callback | intake, business facts and request lifecycle work without panel capabilities', async t => {
  const f = await fixture(t, 'callback');
  const profile = (await request(f, { url: '/api/profile' })).body;
  profile.facts.hours = { verified: true, answer: 'Synthetic hours: weekdays nine to five.' };
  const update = await request(f, { method: 'PATCH', url: '/api/profile', input: { version: profile.version, businessName: profile.business.name, facts: profile.facts } });
  assert.equal(update.status, 200);
  const preview = await request(f, { method: 'POST', url: '/api/preview', input: { message: 'What are your hours?', state: null } });
  assert.equal(preview.status, 200); assert.ok(preview.body.replies.join(' ').includes(profile.facts.hours.answer));
  const headers = { ...f.headers, 'idempotency-key': uuid() };
  const created = await request(f, { method: 'POST', url: '/api/leads', headers, input: leadInput() });
  assert.equal(created.status, 201); assert.equal(created.body.lead.version, 1);
  assert.equal((await request(f, { method: 'POST', url: '/api/leads', headers, input: leadInput() })).status, 200);
  const url = '/api/leads/' + created.body.lead.id;
  const updated = await request(f, { method: 'PATCH', url, input: { version: 1, status: 'closed', notes: 'Callback owner reviewed this request.' } });
  assert.equal(updated.status, 200); assert.equal(updated.body.lead.version, 2);
  const exported = await request(f, { url: '/api/export' });
  assert.equal(exported.status, 200); assert.ok(exported.body.leads.some(lead => lead.id === created.body.lead.id));
  assert.equal((await request(f, { url: '/api/assistant' })).status, 200);
  assert.equal((await request(f, { url: '/api/assistant/usage' })).status, 200);
  const removed = await request(f, { method: 'DELETE', url, headers: { ...f.headers, 'idempotency-key': uuid() }, input: { version: 2, confirmation: 'DELETE' } });
  assert.equal(removed.status, 200); assert.equal((await request(f, { url })).status, 404);
  assert.equal(f.calls.ocr, 0); assert.equal(f.calls.status, 0);
});

test('PROD.workflow.spreadsheet | upload, review, save, reopen and CSV/XLSX export work without callback routes', async t => {
  const f = await fixture(t, 'spreadsheet');
  const created = await request(f, { method: 'POST', url: '/api/panel-projects', headers: { ...f.headers, 'idempotency-key': uuid() }, input: projectInput() });
  assert.equal(created.status, 201);
  const url = '/api/panel-projects/' + created.body.project.id;
  const uploaded = await request(f, { method: 'POST', url: url + '/sources', headers: { ...f.headers, 'idempotency-key': uuid() }, input: sourceInput(1) });
  assert.equal(uploaded.status, 201); assert.equal(uploaded.body.project.version, 2);
  const sourceUrl = url + '/sources/' + uploaded.body.source.id;
  assert.deepEqual((await request(f, { url: sourceUrl })).buffer, IMAGE);
  const beforeOcr = f.store.getPanelProject(f.actor, created.body.project.id);
  const ocr = await request(f, { method: 'POST', url: sourceUrl + '/ocr', input: { version: 2 } });
  assert.equal(ocr.status, 200); assert.equal(ocr.body.candidates[0].reviewStatus, 'unreviewed');
  assert.deepEqual(f.store.getPanelProject(f.actor, created.body.project.id), beforeOcr);
  const input = projectInput(); input.rows[0].partNumber = '000123'; input.rows[0].sourceImageId = uploaded.body.source.id;
  const saved = await request(f, { method: 'PATCH', url, input: { version: 2, ...input } });
  assert.equal(saved.status, 200); assert.equal(saved.body.project.version, 3);
  assert.deepEqual((await request(f, { url })).body.project, saved.body.project);
  const csv = await request(f, { url: url + '/export.csv' }), xlsx = await request(f, { url: url + '/export.xlsx' });
  assert.equal(csv.status, 200); assert.ok(csv.text.includes('"000123"'));
  assert.equal(xlsx.status, 200); assert.equal(xlsx.buffer.subarray(0, 4).toString('hex'), '504b0304');
  assert.equal((await request(f, { url: '/api/panel-ocr' })).status, 200);
  const removed = await request(f, { method: 'DELETE', url: sourceUrl, headers: { ...f.headers, 'idempotency-key': uuid() }, input: { version: 3, confirmation: 'DELETE' } });
  assert.equal(removed.status, 200);
  const after = (await request(f, { url })).body.project;
  assert.equal(after.version, 4); assert.equal(after.rows[0].sourceImageId, null); assert.equal(after.rows[0].reviewStatus, 'unreviewed');
  const deleted = await request(f, { method: 'DELETE', url, headers: { ...f.headers, 'idempotency-key': uuid() }, input: { version: 4, confirmation: 'DELETE' } });
  assert.equal(deleted.status, 200); assert.equal((await request(f, { url })).status, 404);
  assert.equal(f.calls.assistant, 0);
});

for (const option of ['conversationProvider', 'allowExternalProvider', 'assistantUsagePolicy', 'previewMessage']) {
  test(`PROD.configuration.spreadsheet.${option} | callback dependency activation is refused`, async t => {
    const f = await fixture(t, 'spreadsheet');
    const options = { conversationProvider: { kind: 'fake', generate: () => { throw new Error('must not run'); } },
      allowExternalProvider: true, assistantUsagePolicy: {}, previewMessage: () => { throw new Error('must not run'); } };
    const before = snapshot(f);
    assert.throws(() => createWorkspaceApp({ store: f.store, origin: f.origin, product: 'spreadsheet', [option]: options[option] }), /cannot activate callback/);
    assert.deepEqual(snapshot(f), before);
  });
}
