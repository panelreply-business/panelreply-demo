'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { Readable } = require('node:stream');
const { EventEmitter } = require('node:events');
const { openStore, digest } = require('../workspace/store.cjs');
const { hashPassword, csrfFor } = require('../workspace/auth.cjs');
const { createWorkspaceApp, MAX_PANEL_BODY_BYTES } = require('../workspace/api.cjs');
const { OcrError } = require('../workspace/ocr.cjs');

const ORIGIN = 'http://127.0.0.1:10001';
const HASH = hashPassword('Synthetic panel API fixture password 2026!');
const row = (changes = {}) => ({ partNumber: 'SYN-11', manufacturer: 'Fixture Electric', description: 'Synthetic panel component', quantity: 1, reviewStatus: 'unreviewed', notes: '', sourceImageId: null, ...changes });
const project = (changes = {}) => ({ name: 'Synthetic API panel', notes: '', rows: [row()], ...changes });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { resolve, promise }; };
function png() {
  function chunk(type, data) {
    const content = Buffer.concat([Buffer.from(type), data]); let crc = 0xffffffff;
    for (const byte of content) { crc ^= byte; for (let i = 0; i < 8; i += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); }
    const result = Buffer.alloc(data.length + 12); result.writeUInt32BE(data.length); content.copy(result, 4); result.writeUInt32BE((crc ^ 0xffffffff) >>> 0, result.length - 4); return result;
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(1); ihdr.writeUInt32BE(1, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.from([0, 255, 255, 255]))), chunk('IEND', Buffer.alloc(0))]);
}
const source = version => ({ version, name: 'synthetic-api.png', mime: 'image/png', dataBase64: png().toString('base64') });
const ocrResult = () => ({ engine: 'tesseract', engineVersion: 'fixture', rawText: 'Part number: SYN-11', candidates: [{ partNumber: 'SYN-11', manufacturer: '', description: '', confidence: { partNumber: 91, manufacturer: null, description: null }, reviewStatus: 'unreviewed', warnings: [] }], warnings: [], durationMs: 1 });

async function request(app, { method = 'GET', url = '/api/panel-projects', headers = {}, input, stream, observe } = {}) {
  const req = stream || Readable.from(input === undefined ? [] : [JSON.stringify(input)]);
  Object.assign(req, { method, url, headers: { host: '127.0.0.1:10001', origin: ORIGIN, 'content-type': 'application/json', ...headers }, socket: { remoteAddress: '127.0.0.1' } });
  if (observe) observe(req);
  const res = new EventEmitter(); res.writableEnded = false; res.destroyed = false;
  res.writeHead = (status, values) => { res.status = status; res.headers = values; };
  res.end = value => { res.buffer = value === undefined ? Buffer.alloc(0) : Buffer.isBuffer(value) ? Buffer.from(value) : Buffer.from(String(value)); res.writableEnded = true; };
  await app.handler(req, res);
  const text = res.buffer?.toString('utf8') || '';
  return { status: res.status, headers: res.headers, buffer: res.buffer, text, body: res.headers?.['Content-Type']?.startsWith('application/json') && text ? JSON.parse(text) : null };
}
async function fixture(t, options = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'panelreply-panel-api-'));
  let clock = Date.now();
  const store = openStore({ dataDir, now: () => clock });
  const passwordHash = await HASH;
  const alice = store.createBusinessOwner({ businessName: 'Panel API Fixture', username: 'api-panel@example.test', passwordHash });
  const bob = store.createBusinessOwner({ businessName: 'Other API Fixture', username: 'other-api-panel@example.test', passwordHash });
  const app = createWorkspaceApp({ store, origin: ORIGIN, recognizeImage: async () => ocrResult(), getOcrStatus: async () => ({ available: false, engine: 'tesseract', version: null, reason: 'fixture' }), ...options });
  function login(user = alice) { const token = crypto.randomBytes(32).toString('base64url'); store.createSession(user.id, digest(token)); return { cookie: app.auth.cookie(token).split(';')[0], 'x-csrf-token': csrfFor(token) }; }
  t.after(() => { store.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });
  function saved() { const p = store.createPanelProject(alice, project(), crypto.randomUUID()).project; return store.addPanelSource(alice, p.id, source(1), crypto.randomUUID()); }
  return { store, alice, bob, app, login, saved, reset() { store.resetOwnerPassword({ username: alice.username, passwordHash }); }, expire() { clock += 31 * 60 * 1000; } };
}
function delayedBody(input) {
  const raw = JSON.stringify(input), started = deferred(), release = deferred();
  const stream = Readable.from((async function* () { yield raw.slice(0, 5); started.resolve(); await release.promise; yield raw.slice(5); })());
  return { stream, started: started.promise, release: release.resolve };
}

test('panel APIs require the existing session and private pages redirect to sign-in', async t => {
  const f = await fixture(t), p = f.saved();
  for (const url of ['/api/panel-projects', '/api/panel-ocr', '/api/panel-projects/' + p.project.id, '/api/panel-projects/' + p.project.id + '/export.csv', '/api/panel-projects/' + p.project.id + '/sources/' + p.source.id]) assert.equal((await request(f.app, { url })).status, 401);
  for (const url of ['/panels', '/dashboard']) {
    const result = await request(f.app, { url }); assert.equal(result.status, 303); assert.equal(result.headers.Location, '/login');
  }
});

test('create, retry, list, reopen and update operate on saved project versions', async t => {
  const f = await fixture(t), headers = { ...f.login(), 'idempotency-key': crypto.randomUUID() };
  const created = await request(f.app, { method: 'POST', headers, input: project() });
  assert.equal(created.status, 201); assert.equal(created.body.project.version, 1);
  assert.equal((await request(f.app, { method: 'POST', headers, input: project() })).status, 200);
  const id = created.body.project.id, url = '/api/panel-projects/' + id;
  assert.equal((await request(f.app, { headers })).body.projects[0].id, id);
  assert.deepEqual((await request(f.app, { url, headers })).body.project, created.body.project);
  const update = await request(f.app, { method: 'PATCH', url, headers, input: { version: 1, ...project({ rows: [row({ quantity: 3, reviewStatus: 'reviewed' })] }) } });
  assert.equal(update.status, 200); assert.equal(update.body.project.version, 2);
  const stale = await request(f.app, { method: 'PATCH', url, headers, input: { version: 1, ...project() } });
  assert.equal(stale.status, 409); assert.equal(stale.body.error.code, 'version_conflict');
});

test('all panel mutations require exact Origin and CSRF tokens', async t => {
  const f = await fixture(t), saved = f.saved(), p = saved.project, headers = { ...f.login(), 'idempotency-key': crypto.randomUUID() };
  const operations = [
    { method: 'POST', url: '/api/panel-projects', input: project() },
    { method: 'PATCH', url: '/api/panel-projects/' + p.id, input: { version: p.version, ...project() } },
    { method: 'POST', url: '/api/panel-projects/' + p.id + '/sources', input: source(p.version) },
    { method: 'POST', url: '/api/panel-projects/' + p.id + '/sources/' + saved.source.id + '/ocr', input: { version: p.version } }
  ];
  for (const operation of operations) {
    assert.equal((await request(f.app, { ...operation, headers: { ...headers, origin: 'https://foreign.example.test' } })).status, 403);
    assert.equal((await request(f.app, { ...operation, headers: { ...headers, 'x-csrf-token': 'invalid' } })).status, 403);
  }
  assert.deepEqual(f.store.getPanelProject(f.alice, p.id), p);
});

test('source upload is private, returns metadata and does not expose file paths', async t => {
  const f = await fixture(t), p = f.store.createPanelProject(f.alice, project(), crypto.randomUUID()).project;
  const headers = { ...f.login(), 'idempotency-key': crypto.randomUUID() }, url = '/api/panel-projects/' + p.id + '/sources';
  const upload = await request(f.app, { method: 'POST', url, headers, input: source(1) });
  assert.equal(upload.status, 201); assert.equal(upload.body.project.version, 2);
  assert.equal(upload.body.source.data, undefined); assert.equal(upload.body.source.path, undefined);
  assert.equal((await request(f.app, { method: 'POST', url, headers, input: source(1) })).status, 200);
  const result = await request(f.app, { url: url + '/' + upload.body.source.id, headers });
  assert.equal(result.status, 200); assert.deepEqual(result.buffer, png());
  assert.equal(result.headers['Content-Type'], 'image/png');
  assert.equal(result.headers['Cache-Control'], 'no-store');
  assert.equal(result.headers['Cross-Origin-Resource-Policy'], 'same-origin');
  assert.equal(result.headers['X-Content-Type-Options'], 'nosniff');
});

test('another tenant cannot fetch, edit, export or run OCR on the owner project', async t => {
  let calls = 0;
  const f = await fixture(t, { recognizeImage: async () => { calls += 1; return ocrResult(); } }), saved = f.saved(), p = saved.project;
  const headers = { ...f.login(f.bob), 'idempotency-key': crypto.randomUUID() }, base = '/api/panel-projects/' + p.id;
  for (const operation of [{ url: base }, { url: base + '/export.csv' }, { url: base + '/sources/' + saved.source.id }, { method: 'PATCH', url: base, input: { version: p.version, ...project() } }, { method: 'POST', url: base + '/sources', input: source(p.version) }, { method: 'POST', url: base + '/sources/' + saved.source.id + '/ocr', input: { version: p.version } }]) assert.equal((await request(f.app, { ...operation, headers })).status, 404);
  assert.equal(calls, 0); assert.deepEqual((await request(f.app, { headers })).body.projects, []);
});

test('CSV downloads only persisted rows with safe headers, encoding and formulas', async t => {
  const f = await fixture(t), p = f.store.createPanelProject(f.alice, project({ rows: [row({ partNumber: ' \t=1+1', manufacturer: '@formula', description: 'Corrected, "quoted" Ω', notes: '-1+2' })] }), crypto.randomUUID()).project;
  const result = await request(f.app, { url: '/api/panel-projects/' + p.id + '/export.csv', headers: f.login() });
  assert.equal(result.status, 200); assert.equal(result.headers['Content-Type'], 'text/csv; charset=utf-8');
  assert.equal(result.headers['Cache-Control'], 'no-store'); assert.match(result.headers['Content-Disposition'], /^attachment; filename="panelreply-parts-[0-9a-f-]+\.csv"$/);
  assert.equal(result.buffer.subarray(0, 3).toString('hex'), 'efbbbf');
  assert.match(result.text, /"' \t=1\+1","'@formula","Corrected, ""quoted"" Ω"/); assert.match(result.text, /"'-1\+2"\r\n$/);
});

test('panel JSON has its own bound while the intake endpoint retains its smaller bound', async t => {
  const f = await fixture(t), headers = { ...f.login(), 'idempotency-key': crypto.randomUUID() };
  const large = project({ rows: Array.from({ length: 200 }, () => row({ description: 'x'.repeat(1000), notes: 'y'.repeat(1000) })) });
  assert.ok(Buffer.byteLength(JSON.stringify(large)) > 192 * 1024);
  assert.equal((await request(f.app, { method: 'POST', headers, input: large })).status, 201);
  assert.equal((await request(f.app, { method: 'POST', url: '/api/leads', headers, input: large })).status, 413);
  assert.equal((await request(f.app, { method: 'POST', headers: { ...headers, 'content-length': String(MAX_PANEL_BODY_BYTES + 1) }, input: {} })).status, 413);
});

test('unknown fields, invalid rows and malformed images fail without changing stored state', async t => {
  const f = await fixture(t), saved = f.saved(), headers = { ...f.login(), 'idempotency-key': crypto.randomUUID() }, base = '/api/panel-projects/' + saved.project.id;
  const invalidProject = await request(f.app, { method: 'POST', headers, input: { ...project(), arbitrary: true } });
  assert.equal(invalidProject.status, 400);
  const invalidRow = await request(f.app, { method: 'PATCH', url: base, headers, input: { version: saved.project.version, ...project({ rows: [row({ manufacturer: '', reviewStatus: 'reviewed' })] }) } });
  assert.equal(invalidRow.status, 400);
  const invalidImage = await request(f.app, { method: 'POST', url: base + '/sources', headers, input: { ...source(saved.project.version), dataBase64: Buffer.from('<svg><script>bad</script></svg>').toString('base64') } });
  assert.equal(invalidImage.status, 400); assert.equal(invalidImage.body.error.code, 'IMAGE_INVALID');
  assert.deepEqual(f.store.getPanelProject(f.alice, saved.project.id), saved.project);
});

test('HTML-like corrections are returned as JSON data and the CSP forbids inline scripts', async t => {
  const f = await fixture(t), headers = { ...f.login(), 'idempotency-key': crypto.randomUUID() };
  const description = '<img src=x onerror="fetch(\'https://foreign.example.test\')">';
  const result = await request(f.app, { method: 'POST', headers, input: project({ rows: [row({ description })] }) });
  assert.equal(result.status, 201); assert.equal(result.body.project.rows[0].description, description);
  assert.equal(result.headers['Content-Type'], 'application/json; charset=utf-8');
  assert.match(result.headers['Content-Security-Policy'], /script-src 'self'/); assert.doesNotMatch(result.headers['Content-Security-Policy'], /unsafe-inline|https:/);
});

test('OCR returns unreviewed source-linked candidates and leaves the saved rows untouched', async t => {
  let inspected;
  const f = await fixture(t, { recognizeImage: async bytes => { inspected = Buffer.from(bytes); const result = ocrResult(); result.candidates[0].reviewStatus = 'reviewed'; return result; } });
  const saved = f.saved(), headers = f.login();
  const response = await request(f.app, { method: 'POST', url: '/api/panel-projects/' + saved.project.id + '/sources/' + saved.source.id + '/ocr', headers, input: { version: saved.project.version } });
  assert.equal(response.status, 200); assert.deepEqual(inspected, png());
  assert.equal(response.body.candidates[0].sourceImageId, saved.source.id); assert.equal(response.body.candidates[0].reviewStatus, 'unreviewed');
  assert.equal(response.body.candidates[0].manufacturer, ''); assert.equal(response.body.candidates[0].description, '');
  assert.deepEqual(f.store.getPanelProject(f.alice, saved.project.id), saved.project);
  assert.deepEqual(f.store.getPanelSource(f.alice, saved.project.id, saved.source.id).data, png());
});

test('OCR refuses an already stale project before starting the recognition work', async t => {
  let calls = 0;
  const f = await fixture(t, { recognizeImage: async () => { calls += 1; return ocrResult(); } }), saved = f.saved();
  const response = await request(f.app, { method: 'POST', url: '/api/panel-projects/' + saved.project.id + '/sources/' + saved.source.id + '/ocr', headers: f.login(), input: { version: 1 } });
  assert.equal(response.status, 409); assert.equal(calls, 0);
});

test('a concurrent project edit invalidates an OCR response after recognition yields', async t => {
  const started = deferred(), release = deferred();
  const f = await fixture(t, { recognizeImage: async () => { started.resolve(); await release.promise; return ocrResult(); } }), saved = f.saved();
  const pending = request(f.app, { method: 'POST', url: '/api/panel-projects/' + saved.project.id + '/sources/' + saved.source.id + '/ocr', headers: f.login(), input: { version: saved.project.version } });
  await started.promise;
  const updated = f.store.updatePanelProject(f.alice, saved.project.id, { version: saved.project.version, ...project({ notes: 'Concurrent user correction' }) });
  release.resolve();
  const result = await pending; assert.equal(result.status, 409); assert.equal(result.body.candidates, undefined);
  assert.deepEqual(f.store.getPanelProject(f.alice, saved.project.id), updated);
});

test('password reset during OCR prevents the private extraction response', async t => {
  const started = deferred(), release = deferred();
  const f = await fixture(t, { recognizeImage: async () => { started.resolve(); await release.promise; return ocrResult(); } }), saved = f.saved();
  const pending = request(f.app, { method: 'POST', url: '/api/panel-projects/' + saved.project.id + '/sources/' + saved.source.id + '/ocr', headers: f.login(), input: { version: saved.project.version } });
  await started.promise; f.reset(); release.resolve();
  const result = await pending; assert.equal(result.status, 401); assert.equal(result.body.rawText, undefined); assert.equal(result.body.candidates, undefined);
  assert.deepEqual(f.store.getPanelProject(f.alice, saved.project.id), saved.project);
});

test('a delayed create body cannot save after owner password reset', async t => {
  const f = await fixture(t), body = delayedBody(project());
  const pending = request(f.app, { method: 'POST', headers: { ...f.login(), 'idempotency-key': crypto.randomUUID() }, stream: body.stream });
  await body.started; f.reset(); body.release();
  assert.equal((await pending).status, 401); assert.deepEqual(f.store.listPanelProjects(f.alice), []);
});

test('a delayed project edit cannot save after session expiry', async t => {
  const f = await fixture(t), saved = f.saved(), body = delayedBody({ version: saved.project.version, ...project({ notes: 'Should not save' }) });
  const pending = request(f.app, { method: 'PATCH', url: '/api/panel-projects/' + saved.project.id, headers: f.login(), stream: body.stream });
  await body.started; f.expire(); body.release();
  assert.equal((await pending).status, 401); assert.deepEqual(f.store.getPanelProject(f.alice, saved.project.id), saved.project);
});

test('a delayed source upload cannot persist bytes after session revocation', async t => {
  const f = await fixture(t), saved = f.saved(), body = delayedBody(source(saved.project.version));
  const pending = request(f.app, { method: 'POST', url: '/api/panel-projects/' + saved.project.id + '/sources', headers: { ...f.login(), 'idempotency-key': crypto.randomUUID() }, stream: body.stream });
  await body.started; f.reset(); body.release();
  assert.equal((await pending).status, 401); assert.deepEqual(f.store.getPanelProject(f.alice, saved.project.id), saved.project);
});

test('the OCR availability response rechecks the session after its local probe', async t => {
  const started = deferred(), release = deferred();
  const f = await fixture(t, { getOcrStatus: async () => { started.resolve(); await release.promise; return { available: true, engine: 'tesseract', version: 'fixture' }; } });
  const pending = request(f.app, { url: '/api/panel-ocr', headers: f.login() });
  await started.promise; f.reset(); release.resolve();
  const response = await pending; assert.equal(response.status, 401); assert.equal(response.body.available, undefined);
});

test('local OCR errors stay explicit and do not mark a project reviewed', async t => {
  const f = await fixture(t, { recognizeImage: async () => { throw new OcrError('OCR_FAILED'); } }), saved = f.saved();
  const response = await request(f.app, { method: 'POST', url: '/api/panel-projects/' + saved.project.id + '/sources/' + saved.source.id + '/ocr', headers: f.login(), input: { version: saved.project.version } });
  assert.equal(response.status, 422); assert.equal(response.body.error.code, 'OCR_FAILED');
  assert.deepEqual(f.store.getPanelProject(f.alice, saved.project.id), saved.project);
});

test('client cancellation reaches the local OCR cancellation signal', async t => {
  const started = deferred(); let observed;
  const f = await fixture(t, { recognizeImage: async (_bytes, { signal }) => new Promise((_resolve, reject) => { signal.addEventListener('abort', () => reject(new OcrError('OCR_CANCELLED')), { once: true }); started.resolve(); }) }), saved = f.saved();
  const pending = request(f.app, { method: 'POST', url: '/api/panel-projects/' + saved.project.id + '/sources/' + saved.source.id + '/ocr', headers: f.login(), input: { version: saved.project.version }, observe: req => { observed = req; } });
  await started.promise; observed.emit('aborted');
  assert.equal((await pending).status, 499);
  assert.deepEqual(f.store.getPanelProject(f.alice, saved.project.id), saved.project);
});

test('source and CSV paths cannot be used for filesystem traversal or unauthenticated static reads', async t => {
  const f = await fixture(t), headers = f.login();
  for (const url of ['/workspace/workspace.sqlite', '/assets/../workspace.sqlite', '/api/panel-projects/../../etc/passwd', '/api/panel-projects/%2e%2e/export.csv']) assert.equal((await request(f.app, { url, headers })).status, 404);
});

test('an optional workspace session pin accepts the original session and rejects a mismatched pin on reads', async t => {
  const f = await fixture(t), saved = f.saved(), session = f.login();
  const correct = { ...session, 'x-workspace-session': session['x-csrf-token'] };
  const wrong = { ...session, 'x-workspace-session': 'not-this-page-session' };
  for (const url of ['/api/session', '/api/profile', '/api/leads', '/api/panel-projects', '/api/panel-projects/' + saved.project.id, '/api/panel-projects/' + saved.project.id + '/export.csv', '/api/export']) {
    assert.equal((await request(f.app, { url, headers: correct })).status, 200);
    const rejected = await request(f.app, { url, headers: wrong });
    assert.equal(rejected.status, 401); assert.equal(rejected.body.error.code, 'session_changed');
    assert.equal(rejected.headers['Content-Disposition'], undefined);
    assert.equal(rejected.text.includes('Synthetic API panel'), false);
  }
  assert.equal((await request(f.app, { headers: { 'x-workspace-session': session['x-csrf-token'] } })).status, 401);
});

test('a stale page pin cannot read or mutate the business selected by a replaced cookie', async t => {
  const f = await fixture(t), first = f.login(), second = f.login(f.bob);
  const other = f.store.createPanelProject(f.bob, project({ name: 'Other business private panel' }), crypto.randomUUID()).project;
  const stale = { ...second, 'x-workspace-session': first['x-csrf-token'], 'idempotency-key': crypto.randomUUID() };
  for (const url of ['/api/profile', '/api/panel-projects', '/api/panel-projects/' + other.id + '/export.csv']) {
    const result = await request(f.app, { url, headers: stale });
    assert.equal(result.status, 401); assert.equal(result.body.error.code, 'session_changed');
    assert.equal(result.text.includes('Other business'), false);
  }
  const write = await request(f.app, { method: 'POST', headers: stale, input: project() });
  assert.equal(write.status, 401); assert.equal(write.body.error.code, 'session_changed');
  assert.equal(f.store.listPanelProjects(f.bob).length, 1);
  const badCsrf = await request(f.app, { method: 'POST', headers: { ...second, 'x-csrf-token': 'wrong', 'idempotency-key': crypto.randomUUID() }, input: project() });
  assert.equal(badCsrf.status, 403); assert.equal(badCsrf.body.error.code, 'csrf_rejected');
});
