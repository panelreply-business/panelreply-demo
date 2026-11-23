'use strict';
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto'), http = require('node:http');
const { fork, execFileSync } = require('node:child_process');
const { performance } = require('node:perf_hooks');
const { DatabaseSync } = require('node:sqlite');
// Synthetic local workload. No real customer data, provider, public host or test-count credit.
const ROOT = path.resolve(process.env.PANELREPLY_BENCHMARK_ROOT || path.join(__dirname, '..'));
const LABEL = process.env.PANELREPLY_BENCHMARK_LABEL || 'baseline';
if (!/^[a-z0-9-]+$/.test(LABEL)) throw new Error('Use a simple benchmark label.');
const OUTPUT = path.resolve(process.env.PANELREPLY_BENCHMARK_OUTPUT || path.join('artifacts', 'callback-workload-' + LABEL + '.json'));
fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
const RUNTIME_FILES = ['workspace/callback-tasks.cjs', 'workspace/store.cjs', 'workspace/api.cjs', 'workspace/backup.cjs', 'workspace/lifecycle.cjs', 'workspace/retention.cjs', 'workspace/products.cjs', 'workspace/auth.cjs', 'workspace-server.cjs'];
function runtimeHashes() { return Object.fromEntries(RUNTIME_FILES.map(file => [file, crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, file))).digest('hex')])); }
const { openProductStore } = require(ROOT + '/workspace/products.cjs');
const { hashPassword } = require(ROOT + '/workspace/auth.cjs');
const { validateDatabase, createEncryptedBackup, restoreEncryptedBackup } = require(ROOT + '/workspace/backup.cjs');
const NOW = Date.parse('2026-11-23T15:00:00.000Z');
const PASSWORD = 'Synthetic callback workload password 2026!';
const report = { format: 'panelreply-callback-resource-review-v1', startedAt: new Date().toISOString(), sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(), platform: { node: process.version, platform: process.platform, arch: process.arch, release: os.release(), cpus: os.cpus().length }, fixture: { businesses: 1, leads: 500, tasks: 2000, operations: 20000, transcriptCharactersPerLead: 20000, taskNoteCharacters: 2000, maximumReadPage: 500 }, goalPassesClaimed: 0, scope: 'Synthetic selected callback loopback process on one development host. Not a selected-host capacity, real-user or physical-device acceptance result.', results: [] };
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'panelreply-callback-perf-')), dataDir = path.join(directory, 'callback');
report.label = LABEL; report.runtimeHashes = runtimeHashes();
report.harnessSha256 = crypto.createHash('sha256').update(fs.readFileSync(__filename)).digest('hex');
report.fixture.specificationSha256 = crypto.createHash('sha256').update(JSON.stringify(report.fixture)).digest('hex');
let store, child, requestCount = 0;
function record(name, value) { report.results.push({ name, ...value }); console.log(JSON.stringify({ name, ...value })); }
function timing(name, fn) { const start = performance.now(); const value = fn(); record(name, { durationMs: performance.now() - start }); return value; }
function percentile(values, p) { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)]; }
async function metrics() { const id = crypto.randomUUID(); return new Promise((resolve, reject) => { const timeout = setTimeout(() => { child.off('message', handle); reject(new Error('metrics timeout')); }, 15000); const handle = value => { if (value.event === 'metrics' && value.id === id) { clearTimeout(timeout); child.off('message', handle); resolve(value); } }; child.on('message', handle); child.send({ type: 'metrics', id }); }); }
async function availablePort() { const socket = http.createServer(); await new Promise((resolve, reject) => { socket.once('error', reject); socket.listen(0, '127.0.0.1', resolve); }); const port = socket.address().port; await new Promise(resolve => socket.close(resolve)); return port; }
async function closeChild() {
  if (!child || child.exitCode !== null || child.signalCode !== null) return { clean: true, alreadyStopped: true };
  return new Promise(resolve => {
    let settled = false, forced = false;
    function finish(result) {
      if (settled) return;
      settled = true; clearTimeout(terminate); clearTimeout(kill); clearTimeout(deadline);
      child.removeListener('exit', exited); resolve({ ...result, forced });
    }
    function exited(code, signal) { finish({ clean: code === 0 && !forced, exitCode: code, signal }); }
    const terminate = setTimeout(() => { forced = true; child.kill('SIGTERM'); }, 3000);
    const kill = setTimeout(() => { forced = true; child.kill('SIGKILL'); }, 7000);
    const deadline = setTimeout(() => {
      if (child.connected) child.disconnect();
      child.stdout?.destroy(); child.stderr?.destroy(); child.unref();
      finish({ clean: false, error: 'The callback workload process did not exit within 10 seconds.' });
    }, 10000);
    child.once('exit', exited);
    try {
      if (child.connected) child.send({ type: 'stop' }, error => { if (error && !settled) { forced = true; child.kill('SIGTERM'); } });
      else { forced = true; child.kill('SIGTERM'); }
    } catch (_) { forced = true; child.kill('SIGTERM'); }
  });
}
async function main() {
  store = openProductStore({ dataDir, product: 'callback', now: () => NOW });
  const owner = store.createBusinessOwner({ businessName: 'Synthetic Callback Load', username: 'load-owner@example.test', passwordHash: await hashPassword(PASSWORD) });
  const leadInput = { customerName: 'Synthetic workload request', phone: '+12485550123', job: 'Install garage lighting', zip: '48315', callbackWindow: 'Next business day', requestedWorkDate: 'Next month', contactPermission: 'requested_callback', conversation: Array.from({ length: 10 }, () => ({ role: 'customer', text: '漢'.repeat(2000) })) };
  const leads = [], tasks = []; const seedStart = performance.now();
  for (let index = 0; index < 500; index++) leads.push(store.createLead(owner, { ...leadInput, customerName: 'Synthetic workload request ' + index }, crypto.randomUUID()).lead);
  for (let index = 0; index < 2000; index++) {
    const lead = leads[index % 500], result = store.createCallbackTask(owner, lead.id, { leadVersion: lead.version, kind: index < 500 ? 'callback' : 'follow_up', dueAt: new Date(NOW - 3600000 + index * 1000).toISOString(), timeZone: 'America/Detroit', notes: '漢'.repeat(2000) }, crypto.randomUUID());
    leads[index % 500] = result.lead; tasks.push(result.task);
    if ((index + 1) % 500 === 0) console.log('Seeded ' + (index + 1) + ' callback tasks.');
  }
  // Exercise actual bounded writes to fill the operation ledger. These are
  // workload preparation, not distinct test cases or goal credit.
  for (let operation = 2000; operation < 20000; operation++) {
    const index = operation % 2000, task = tasks[index], lead = leads[index % 500];
    const result = store.updateCallbackTask(owner, task.id, { leadVersion: lead.version, version: task.version, action: 'reschedule', dueAt: new Date(NOW - 3600000 + index * 1000 + Math.floor(operation / 2000) * 1000).toISOString(), timeZone: 'America/Detroit', notes: '漢'.repeat(2000) }, crypto.randomUUID());
    tasks[index] = result.task; leads[index % 500] = result.lead;
    if ((operation + 1) % 2000 === 0) console.log('Seeded ' + (operation + 1) + ' callback operations.');
  }
  record('fixture-seeding', { durationMs: performance.now() - seedStart });
  const db = new DatabaseSync(store.filename, { readOnly: true });
  const counts = timing('validate-full-schema4-fixture', () => validateDatabase(db));
  record('fixture-verified', { counts, databaseBytes: fs.statSync(store.filename).size, walBytes: fs.existsSync(store.filename + '-wal') ? fs.statSync(store.filename + '-wal').size : 0, queryPlans: {
    queue: db.prepare("EXPLAIN QUERY PLAN SELECT * FROM callback_tasks WHERE business_id=? AND status='scheduled' ORDER BY due_at,id LIMIT 500 OFFSET 0").all(owner.businessId),
    taskOperations: db.prepare('EXPLAIN QUERY PLAN SELECT count(*),min(created_at),max(created_at) FROM callback_operations WHERE business_id=? AND task_id=? AND lead_id=?').all(owner.businessId, tasks[0].id, leads[0].id)
  } }); db.close();
  let getLeadCalls = 0, transcriptCharsMaterialized = 0, auditRowsMaterialized = 0;
  const getLead = store.getLead;
  store.getLead = (...args) => { const result = getLead(...args); getLeadCalls++; transcriptCharsMaterialized += result.conversation.reduce((sum, message) => sum + message.text.length, 0); auditRowsMaterialized += result.audit.length; return result; };
  const page = timing('queue-component-500-distinct-requests', () => store.listCallbackTasks(owner, { state: 'open', limit: 500 }));
  record('queue-materialization', { taskCount: page.tasks.length, total: page.total, getLeadCalls, transcriptCharsMaterialized, auditRowsMaterialized, returnedBodyBytes: Buffer.byteLength(JSON.stringify(page)) });
  store.getLead = getLead;
  const readDurations = [];
  for (let iteration = 0; iteration < 5; iteration++) { const start = performance.now(); const result = store.listCallbackTasks(owner, { state: 'open', limit: 500, offset: iteration % 4 * 500 }); if (result.tasks.length !== 500 || result.total !== 2000) throw new Error('Queue pagination lost tasks'); readDurations.push(performance.now() - start); }
  record('queue-component-500-page-distribution', { samplesMs: readDurations, medianMs: percentile(readDurations, 0.5), maxMs: Math.max(...readDurations) });
  store.close(); store = null;
  // Capture the complete checkpointed SQLite file, including this run's random
  // identifiers. Same-spec runs need not have byte-identical databases.
  let fixtureBytes = fs.readFileSync(path.join(dataDir, 'workspace.sqlite'));
  report.fixture.databaseSha256 = crypto.createHash('sha256').update(fixtureBytes).digest('hex');
  report.fixture.databaseBytes = fixtureBytes.length;
  fixtureBytes.fill(0); fixtureBytes = null;
  const backupStart = performance.now(), archive = path.join(directory, 'callback.prbk'), passphrase = 'Synthetic performance backup phrase 2026!';
  const backup = await createEncryptedBackup({ dataDir, product: 'callback', outputFile: archive, passphrase }); record('encrypted-backup-at-capacity', { durationMs: performance.now() - backupStart, archiveBytes: backup.archiveBytes, counts: backup.counts });
  const restoreStart = performance.now(), restoredDir = path.join(directory, 'restored');
  const restored = await restoreEncryptedBackup({ dataDir: restoredDir, product: 'callback', backupFile: archive, passphrase }); record('encrypted-restore-at-capacity', { durationMs: performance.now() - restoreStart, counts: restored.counts });
  const port = await availablePort(), origin = 'http://127.0.0.1:' + port;
  child = fork(path.join(__dirname, '..', 'tests', 'helpers', 'callback-workload-server.cjs'), [], { env: { ...process.env, PANELREPLY_BENCHMARK_ROOT: ROOT, CALLBACK_DATA_DIR: dataDir, CALLBACK_PORT: String(port), CALLBACK_ORIGIN: origin }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  child.stdout.on('data', chunk => process.stdout.write(chunk)); child.stderr.on('data', chunk => process.stderr.write(chunk));
  await new Promise((resolve, reject) => { const timeout = setTimeout(() => reject(new Error('callback startup timeout')), 15000); child.on('message', value => { if (value.event === 'listening') { clearTimeout(timeout); resolve(); } }); child.once('error', reject); child.once('exit', code => reject(new Error('callback exited ' + code))); });
  const login = await fetch(origin + '/api/login', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ username: owner.username, password: PASSWORD }), signal: AbortSignal.timeout(15000), redirect: 'error' });
  const loginBody = await login.json(); if (login.status !== 200) throw new Error('login failed ' + login.status);
  const headers = { cookie: login.headers.get('set-cookie').split(';')[0], 'x-workspace-session': loginBody.csrfToken };
  async function read(route, expectedTasks) { const start = performance.now(), response = await fetch(origin + route, { headers, signal: AbortSignal.timeout(15000), redirect: 'error' }), body = await response.text(); requestCount++; if (response.status !== 200) throw new Error('HTTP ' + response.status + ' on ' + route); const parsed = JSON.parse(body); if (expectedTasks !== undefined && (parsed.tasks.length !== expectedTasks || parsed.total !== 2000)) throw new Error('HTTP queue result mismatch'); return { durationMs: performance.now() - start, bytes: Buffer.byteLength(body) }; }
  const before = await metrics();
  for (const limit of [20, 100, 500]) { const results = []; for (let iteration = 0; iteration < 5; iteration++) results.push(await read('/api/callback-tasks?state=open&limit=' + limit + '&offset=' + (iteration % (2000 / limit)) * limit, limit)); record('http-sequential-queue-' + limit, { requests: results.length, samplesMs: results.map(result => result.durationMs), medianMs: percentile(results.map(result => result.durationMs), 0.5), maxMs: Math.max(...results.map(result => result.durationMs)), bodyBytes: results[0].bytes }); }
  for (const limit of [20, 500]) {
    const burstStart = performance.now(), requests = Array.from({ length: 12 }, (_, index) => read('/api/callback-tasks?state=open&limit=' + limit + '&offset=' + index % 4 * limit, limit));
    const healthStart = performance.now(), health = fetch(origin + '/health', { signal: AbortSignal.timeout(15000), redirect: 'error' }).then(async response => { if (response.status !== 200 || !(await response.json()).ok) throw new Error('health failed'); return performance.now() - healthStart; });
    const [results, healthMs] = await Promise.all([Promise.all(requests), health]); record('http-12-client-queue-' + limit, { durationMs: performance.now() - burstStart, requests: results.length, p50Ms: percentile(results.map(result => result.durationMs), 0.5), p95Ms: percentile(results.map(result => result.durationMs), 0.95), maxMs: Math.max(...results.map(result => result.durationMs)), responseBytes: results.reduce((sum, result) => sum + result.bytes, 0), concurrentHealthMs: healthMs });
  }
  record('callback-process-resources', { before, after: await metrics() });
  record('http-export-at-capacity', await read('/api/export'));
  const quotaResponse = await fetch(origin + '/api/callback-tasks/' + tasks[0].id, { method: 'PATCH', headers: { ...headers, origin, 'content-type': 'application/json', 'x-csrf-token': loginBody.csrfToken, 'idempotency-key': crypto.randomUUID() }, body: JSON.stringify({ leadVersion: leads[0].version, version: tasks[0].version, action: 'cancel', notes: '' }), signal: AbortSignal.timeout(15000), redirect: 'error' });
  const quota = await quotaResponse.json(); if (quotaResponse.status !== 503 || quota.error?.code !== 'callback_history_limit') throw new Error('quota behavior changed'); record('operation-quota-refusal', { status: quotaResponse.status, code: quota.error.code });
  report.httpQueueRequests = requestCount - 1; report.unexpectedErrors = 0;
}
main().catch(error => { report.unexpectedErrors = 1; report.error = { message: error.message, stack: error.stack }; console.error(error.stack); process.exitCode = 1; }).finally(async () => {
  report.cleanup = await closeChild();
  if (!report.cleanup.clean) { report.unexpectedErrors = (report.unexpectedErrors || 0) + 1; process.exitCode = 1; }
  store?.close(); report.completedAt = new Date().toISOString();
  try { report.runtimeHashesAfter = runtimeHashes(); report.runtimeChanged = JSON.stringify(report.runtimeHashes) !== JSON.stringify(report.runtimeHashesAfter); }
  catch (error) { report.runtimeHashesAfter = null; report.runtimeChanged = true; report.sourceReadError = error.message; }
  if (report.runtimeChanged) { report.unexpectedErrors = (report.unexpectedErrors || 0) + 1; report.sourceIntegrityFailure = 'Runtime source changed during the workload.'; process.exitCode = 1; }
  fs.writeFileSync(OUTPUT, JSON.stringify(report, null, 2) + '\n');
  fs.rmSync(directory, { recursive: true, force: true }); console.log('Saved ' + OUTPUT);
});
