'use strict';

// CI-only loopback workload. Never accepts a target URL or an existing database.
if (process.env.CI !== 'true' || process.env.PANELREPLY_HTTP_STRESS !== '1') throw new Error('Run only in the authorized isolated CI workload job.');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { performance } = require('node:perf_hooks');
const { once } = require('node:events');
const { Worker } = require('node:worker_threads');
const { DatabaseSync } = require('node:sqlite');
const { openStore, SCHEMAS, SCHEMA_VERSION } = require('../workspace/store.cjs');
const { hashPassword } = require('../workspace/auth.cjs');
const { createWorkspaceApp } = require('../workspace/api.cjs');
const { createOcrService } = require('../workspace/ocr.cjs');
const { createEncryptedBackup, restoreEncryptedBackup } = require('../workspace/backup.cjs');
const PASSWORD = 'Synthetic HTTP workload password 2026!';
const PASSPHRASE = 'Synthetic HTTP recovery passphrase 2026!';
const IMAGE = fs.readFileSync(path.join(__dirname, '../tests/fixtures/panels/complete.png'));
const uuid = () => crypto.randomUUID();
const sha = data => crypto.createHash('sha256').update(data).digest('hex');
const project = (i, count = 1) => ({ name: 'Synthetic HTTP panel ' + i, notes: '', rows: Array.from({ length: count }, (_, n) => ({ partNumber: String(n).padStart(6, '0'), manufacturer: 'SYNTHETIC Ω', description: 'Corrected, "quoted"\npart ' + n, quantity: 1, reviewStatus: 'unreviewed', notes: '=SYNTHETIC()', sourceImageId: null })) });
const lead = i => ({ customerName: 'Synthetic HTTP customer ' + i, phone: '+1586555' + String(100 + i % 100).padStart(4, '0'), job: 'EV charger estimate', zip: '48315', callbackWindow: 'After 4 PM', requestedWorkDate: 'Saturday', contactPermission: 'requested_callback', conversation: [{ role: 'customer', text: 'Please call about an EV charger estimate.' }] });
function logicalSnapshot(filename) {
  const db = new DatabaseSync(filename, { readOnly: true });
  try {
    assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
    const snapshot = {};
    for (const table of Object.keys(SCHEMAS[SCHEMA_VERSION].tables).filter(name => !['sessions', 'login_attempts'].includes(name))) {
      const rows = db.prepare('SELECT * FROM ' + table).all().map(row => {
        const item = { ...row }; if (table === 'users') delete item.password_hash;
        for (const key of Object.keys(item)) if (item[key] instanceof Uint8Array) item[key] = { bytes: item[key].length, hash: sha(item[key]) };
        return JSON.stringify(item);
      }).sort();
      snapshot[table] = { rows: rows.length, hash: sha(JSON.stringify(rows)) };
    }
    return snapshot;
  } finally { db.close(); }
}
function bytes(directory) { return fs.readdirSync(directory).reduce((n, file) => n + fs.statSync(path.join(directory, file)).size, 0); }
function distribution(values) { const a = [...values].sort((a, b) => a - b); const p = fraction => Number(a[Math.max(0, Math.ceil(a.length * fraction) - 1)].toFixed(3)); return { count: a.length, p50Ms: p(.5), p95Ms: p(.95), p99Ms: p(.99), maxMs: p(1) }; }

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'panelreply-http-workload-'));
  const dataDir = path.join(root, 'data'), restoreDir = path.join(root, 'restored');
  let clock = Date.now(), service = null, fixtureStore = null, peakRss = process.memoryUsage().rss;
  const begin = performance.now(), cpu = process.cpuUsage(), timings = {}, statuses = {}, checks = [], controlled = [];
  const sampler = setInterval(() => { peakRss = Math.max(peakRss, process.memoryUsage().rss); }, 20); sampler.unref();
  let unexpected = 0;
  async function start(directory) {
    const store = openStore({ dataDir: directory, create: false, now: () => clock });
    const ocr = createOcrService(); let app;
    const server = http.createServer({ requestTimeout: 20000, headersTimeout: 10000, keepAliveTimeout: 1000 }, (req, res) => app.handler(req, res));
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const origin = 'http://127.0.0.1:' + server.address().port;
    app = createWorkspaceApp({ store, origin, recognizeImage: ocr.recognizeImage, getOcrStatus: ocr.getOcrStatus });
    return { store, ocr, server, origin, async close() { app.close(); await ocr.shutdown(); await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }); store.close(); } };
  }
  async function request(category, route, { method = 'GET', headers = {}, body, expected = [200] } = {}) {
    const began = performance.now();
    const response = await fetch(service.origin + route, { method, redirect: 'manual', signal: AbortSignal.timeout(30000), headers: { origin: service.origin, 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    const buffer = Buffer.from(await response.arrayBuffer());
    (timings[category] ||= []).push(performance.now() - began);
    statuses[response.status] = (statuses[response.status] || 0) + 1;
    if (!expected.includes(response.status)) unexpected++;
    assert.ok(expected.includes(response.status), category + ' unexpected ' + response.status + ' ' + buffer.toString('utf8').slice(0, 300));
    return { status: response.status, headers: response.headers, buffer, body: response.headers.get('content-type')?.startsWith('application/json') && buffer.length ? JSON.parse(buffer) : null };
  }
  async function login(actor) {
    const result = await request('authentication', '/api/login', { method: 'POST', body: { username: actor.username, password: PASSWORD } });
    return { cookie: result.headers.get('set-cookie').split(';')[0], 'x-csrf-token': result.body.csrfToken, 'x-workspace-session': result.body.csrfToken };
  }
  try {
    fixtureStore = openStore({ dataDir, now: () => clock });
    const passwordHash = await hashPassword(PASSWORD);
    const owners = ['a', 'b'].map(n => fixtureStore.createBusinessOwner({ businessName: 'Synthetic Workload ' + n, username: 'workload-' + n + '@example.test', passwordHash }));
    const initialBytes = bytes(dataDir), projects = [[], []];
    for (let tenant = 0; tenant < 2; tenant++) {
      for (let n = 0; n < (tenant ? 20 : 200); n++) projects[tenant].push(fixtureStore.createPanelProject(owners[tenant], project(n, n === 0 ? 200 : 1), uuid()).project);
      for (let n = 0; n < (tenant ? 60 : 240); n++) fixtureStore.createLead(owners[tenant], lead(n), uuid());
    }
    const upload = fixtureStore.addPanelSource(owners[0], projects[0][0].id, { version: 1, name: 'synthetic.png', mime: 'image/png', dataBase64: IMAGE.toString('base64') }, uuid());
    projects[0][0] = upload.project;
    const seededBytes = bytes(dataDir); fixtureStore.close(); fixtureStore = null;
    service = await start(dataDir);
    const clients = [];
    // Two concurrent authentications match the actual bounded password worker.
    for (let n = 0; n < 6; n++) clients.push(...await Promise.all(owners.map(async (actor, tenant) => ({ headers: await login(actor), tenant, record: projects[tenant][n + 1] }))));
    checks.push({ check: '12 authenticated HTTP clients in two isolated businesses', status: 'PASS' });
    await Promise.all(clients.map(async client => {
      for (let wave = 0; wave < 8; wave++) {
        const list = await request('projectList', '/api/panel-projects', { headers: client.headers });
        assert.equal(list.body.projects.length, client.tenant ? 20 : 200);
        const requests = await request('requestList', '/api/leads', { headers: client.headers });
        assert.equal(requests.body.leads.length, client.tenant ? 60 : 240);
        const p = client.record;
        const saved = await request('save', '/api/panel-projects/' + p.id, { method: 'PATCH', headers: client.headers, body: { version: p.version, name: p.name, notes: 'Client ' + client.tenant + ' wave ' + wave, rows: p.rows } });
        client.record = saved.body.project;
        const base = '/api/panel-projects/' + projects[client.tenant][0].id;
        const csv = await request('csv200Rows', base + '/export.csv', { headers: client.headers });
        const xlsx = await request('xlsx200Rows', base + '/export.xlsx', { headers: client.headers });
        assert.equal(csv.buffer.subarray(0, 3).toString('hex'), 'efbbbf'); assert.ok(csv.buffer.includes(Buffer.from('000199')));
        assert.equal(xlsx.buffer.readUInt32LE(0), 0x04034b50);
      }
    }));
    for (const client of clients) assert.deepEqual(service.store.getPanelProject(owners[client.tenant], client.record.id), client.record);
    checks.push({ check: '480 concurrent list/save/export operations preserve each saved version', status: 'PASS' });
    const headers = clients[0].headers, base = '/api/panel-projects/' + projects[0][0].id;
    const stale = service.store.getPanelProject(owners[0], projects[0][0].id);
    const races = await Promise.all(Array.from({ length: 8 }, (_, n) => request('versionRace', base, { method: 'PATCH', headers, body: { version: stale.version, name: stale.name, notes: 'Race writer ' + n, rows: stale.rows }, expected: [200, 409] })));
    assert.equal(races.filter(r => r.status === 200).length, 1); assert.equal(races.filter(r => r.status === 409).length, 7);
    controlled.push({ operation: '8 simultaneous writers at one saved version', outcomes: { saved: 1, stale: 7 } });
    const current = service.store.getPanelProject(owners[0], stale.id);
    const readiness = await request('ocrStatus', '/api/panel-ocr', { headers }); assert.equal(readiness.body.available, true, JSON.stringify(readiness.body));
    const ocrPath = base + '/sources/' + upload.source.id + '/ocr';
    const extracted = await Promise.all(Array.from({ length: 4 }, () => request('concurrentOcr', ocrPath, { method: 'POST', headers, body: { version: current.version }, expected: [200, 429] })));
    assert.equal(extracted.filter(r => r.status === 200).length, 1); assert.equal(extracted.filter(r => r.status === 429).length, 3);
    const candidates = extracted.find(r => r.status === 200).body.candidates;
    assert.equal(candidates.length, 1); assert.equal(candidates[0].partNumber, 'DEMO-1001');
    assert.equal(candidates[0].manufacturer, 'SAMPLE COMPONENTS');
    assert.equal(candidates[0].description, 'SYNTHETIC LABEL ALPHA');
    assert.ok(candidates.every(row => row.reviewStatus === 'unreviewed'));
    assert.deepEqual(service.store.getPanelProject(owners[0], current.id), current);
    controlled.push({ operation: '4 simultaneous native OCR requests', outcomes: { processed: 1, busy: 3 } });
    checks.push({ check: 'optimistic write conflicts and OCR backpressure preserve records', status: 'PASS' });
    const other = clients[1].headers;
    await request('tenantBoundary', base + '/export.xlsx', { headers: other, expected: [404] });
    checks.push({ check: 'foreign-tenant HTTP export denied', status: 'PASS' });
    // The separate connection releases 350ms AFTER this server observes the
    // HTTP request. The parent may then block on SQLite while the worker's
    // independent timer releases the lock. A slow scheduler cannot fake overlap.
    const barrier = new SharedArrayBuffer(4), gate = new Int32Array(barrier);
    const worker = new Worker(path.join(__dirname, '../tests/helpers/http-workload-worker.cjs'), { workerData: { filename: service.store.filename, barrier } });
    let releaseInfo = null, requestArrivedAt = null;
    worker.on('message', data => { if (data.releasedAt) releaseInfo = data; });
    const exited = once(worker, 'exit'); exited.catch(() => {});
    await once(worker, 'message', { signal: AbortSignal.timeout(5000) });
    service.server.prependOnceListener('request', () => { requestArrivedAt = Date.now(); Atomics.store(gate, 0, 1); Atomics.notify(gate, 0); });
    const locked = await request('databaseContention', base, { method: 'PATCH', headers, body: { version: current.version, name: current.name, notes: 'After bounded external write lock', rows: current.rows } });
    assert.equal(locked.body.project.version, current.version + 1); assert.equal((await exited)[0], 0);
    assert.ok(releaseInfo && requestArrivedAt && releaseInfo.lockedAt <= requestArrivedAt && releaseInfo.releasedAt - requestArrivedAt >= 300, 'The actual HTTP request must overlap the independent write lock.');
    checks.push({ check: 'HTTP save completes after separate SQLite write-lock contention', status: 'PASS' });
    const count = service.store.listLeads(owners[0]).length, retryKey = uuid(), body = lead(999);
    await new Promise((resolve, reject) => {
      const client = http.request(service.origin + '/api/leads', { method: 'POST', headers: { origin: service.origin, 'content-type': 'application/json', ...headers, 'idempotency-key': retryKey, 'content-length': Buffer.byteLength(JSON.stringify(body)) } });
      const timer = setTimeout(() => { client.destroy(); reject(new Error('Interrupted-body check timed out')); }, 5000);
      client.on('error', () => {});
      service.server.once('request', req => { req.once('aborted', () => { clearTimeout(timer); resolve(); }); req.once('data', () => client.destroy()); });
      client.write(JSON.stringify(body).slice(0, 12));
    });
    assert.equal(service.store.listLeads(owners[0]).length, count);
    const created = await request('interruptedRetry', '/api/leads', { method: 'POST', headers: { ...headers, 'idempotency-key': retryKey }, body, expected: [201] });
    const replay = await request('interruptedRetry', '/api/leads', { method: 'POST', headers: { ...headers, 'idempotency-key': retryKey }, body });
    assert.equal(created.body.lead.id, replay.body.lead.id); assert.equal(service.store.listLeads(owners[0]).length, count + 1);
    checks.push({ check: 'interrupted HTTP body is inert and same-key retry creates one request', status: 'PASS' });
    clock += 31 * 60 * 1000;
    await request('expiredSession', '/api/leads', { headers, expected: [401] });
    const fresh = await login(owners[0]);
    await request('freshSession', '/api/leads', { headers: fresh });
    checks.push({ check: 'expired HTTP session denied and fresh authentication succeeds', status: 'PASS' });
    const snapshot = logicalSnapshot(service.store.filename), beforeRestartBytes = bytes(dataDir);
    const restartStart = performance.now(); await service.close(); service = await start(dataDir);
    await request('afterRestart', '/api/leads', { headers: fresh });
    const inProcessServiceRestartMs = performance.now() - restartStart;
    assert.deepEqual(logicalSnapshot(service.store.filename), snapshot);
    const archive = path.join(root, 'synthetic.prbk'), backupStart = performance.now();
    await createEncryptedBackup({ dataDir, outputFile: archive, passphrase: PASSPHRASE });
    const backupMs = performance.now() - backupStart, restoreStart = performance.now();
    await restoreEncryptedBackup({ backupFile: archive, dataDir: restoreDir, passphrase: PASSPHRASE });
    const restoreMs = performance.now() - restoreStart;
    assert.deepEqual(logicalSnapshot(path.join(restoreDir, 'workspace.sqlite')), snapshot);
    assert.deepEqual(logicalSnapshot(service.store.filename), snapshot);
    await service.close(); service = await start(restoreDir);
    await request('restoredOldSession', '/api/leads', { headers: fresh, expected: [401] });
    service.store.resetOwnerPassword({ username: owners[0].username, passwordHash });
    const recovered = await login(owners[0]);
    assert.equal((await request('recoveredHttpRead', '/api/leads', { headers: recovered })).body.leads.length, count + 1);
    checks.push({ check: 'in-process HTTP/store restart and encrypted restore preserve all logical tables and source images', status: 'PASS' });
    checks.push({ check: 'restored sessions denied until explicit owner password recovery', status: 'PASS' });
    const result = {
      status: 'PASS', scope: 'Synthetic CI loopback only. Same Node process runs HTTP server and clients. Native OCR child CPU/RSS excluded from these process totals. Not hosted capacity or an SLA.',
      node: process.version, platform: process.platform, clients: 12, businesses: 2, seededProjects: 220, seededRequests: 300,
      checks, controlledRejections: controlled, http: { completed: Object.values(statuses).reduce((a, b) => a + b, 0), statuses, unexpectedErrors: unexpected, unexpectedErrorRate: 0, timings: Object.fromEntries(Object.entries(timings).map(([name, values]) => [name, distribution(values)])) },
      durationMs: Number((performance.now() - begin).toFixed(3)), processCpuMicros: process.cpuUsage(cpu), sampledPeakRssBytes: peakRss, sampleIntervalMs: 20, processHighWaterRssBytes: process.resourceUsage().maxRSS * 1024,
      databaseBytes: { empty: initialBytes, seeded: seededBytes, beforeRestart: beforeRestartBytes, restored: bytes(restoreDir) }, recovery: { restartScope: 'HTTP server and database reopened in the same Node process; not an OS process or hosted restart', inProcessServiceRestartMs: Number(inProcessServiceRestartMs.toFixed(3)), backupMs: Number(backupMs.toFixed(3)), restoreMs: Number(restoreMs.toFixed(3)) }, integrity: snapshot
    };
    console.log(JSON.stringify(result));
  } finally { clearInterval(sampler); fixtureStore?.close(); if (service) await service.close(); fs.rmSync(root, { recursive: true, force: true }); }
}
main().catch(error => { console.error(JSON.stringify({ status: 'FAIL', error: error.message })); process.exitCode = 1; });
