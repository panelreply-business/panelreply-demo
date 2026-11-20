'use strict';

// Bounded storage/recovery drill. No HTTP listener, real account, provider call
// or production database. All temporary data belongs to this invocation.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { performance } = require('node:perf_hooks');
const { DatabaseSync } = require('node:sqlite');
const { openStore, digest } = require('../workspace/store.cjs');
const { hashPassword, createAuth } = require('../workspace/auth.cjs');
const { createEncryptedBackup, restoreEncryptedBackup, RESTORE_DISABLED_PASSWORD } = require('../workspace/backup.cjs');

const TABLES = ['businesses', 'users', 'leads', 'messages', 'audit', 'suppression', 'panel_projects', 'panel_sources', 'sessions', 'login_attempts', 'record_deletions', 'deletion_operations', 'safety_holds', 'assistant_usage'];
const PASSWORD = 'Synthetic stress owner password 2026!';
const RESET_PASSWORD = 'Synthetic reset owner password 2026!';
const PASSPHRASE = 'Synthetic stress backup passphrase 2026!';
const IMAGE = fs.readFileSync(path.join(__dirname, '../tests/fixtures/panels/complete.png'));
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function canonical(value) {
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return { bytes: value.length, sha256: sha(value) };
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
function databaseDigests(filename, { businessId, includeCredentials = false } = {}) {
  const db = new DatabaseSync(filename, { readOnly: true });
  try {
    assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
    const tables = {};
    for (const table of TABLES) {
      if (!includeCredentials && ['sessions', 'login_attempts'].includes(table)) continue;
      let rows = db.prepare('SELECT * FROM ' + table).all();
      if (businessId) rows = rows.filter(row => table === 'businesses' ? row.id === businessId : row.business_id === businessId);
      rows = rows.map(row => {
        const result = { ...row };
        if (!includeCredentials && table === 'users') delete result.password_hash;
        return JSON.stringify(canonical(result));
      }).sort();
      tables[table] = { rows: rows.length, sha256: sha(JSON.stringify(rows)) };
    }
    return { tables, sha256: sha(JSON.stringify(canonical(tables))) };
  } finally { db.close(); }
}
function directoryBytes(directory) { return fs.readdirSync(directory).reduce((total, file) => total + fs.statSync(path.join(directory, file)).size, 0); }
function summarize(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const rank = n => Number(sorted[Math.max(0, Math.ceil(sorted.length * n) - 1)].toFixed(3));
  return { operations: values.length, p50Ms: rank(.5), p95Ms: rank(.95), maxMs: rank(1) };
}
const row = index => ({ partNumber: index % 17 === 0 ? ' =SUM(A1:A2)' : ' 00' + String(index).padStart(4, '0') + ' ', manufacturer: 'SYNTHETIC MAKER Ω', description: 'Fixture, "quoted"\ncomponent ' + index, quantity: index % 2 ? 9999 : 1, reviewStatus: 'unreviewed', notes: ' retain corrected spacing ', sourceImageId: null });
const projectInput = (index, count = 1) => ({ name: 'Synthetic panel ' + index, notes: ' Saved note Ω\nnext line ', rows: Array.from({ length: count }, (_, part) => row(part)) });
const leadInput = index => ({ customerName: 'Synthetic Customer ' + index, phone: '+1586555' + String(100 + index % 100).padStart(4, '0'), job: 'EV charger estimate fixture ' + index, zip: '48315', callbackWindow: 'After 4 PM', requestedWorkDate: 'Saturday', contactPermission: 'requested_callback', conversation: [{ role: 'customer', text: 'Synthetic request ' + index + ' for an EV charger estimate.' }] });

async function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'panelreply-bounded-stress-'));
  const sourceDir = path.join(root, 'source'), restoreDir = path.join(root, 'restored'), archive = path.join(root, 'synthetic.prbk');
  const timings = {}, expectedRejections = [], checks = [];
  const started = performance.now(), cpuStart = process.cpuUsage(), rssStart = process.memoryUsage().rss;
  let store, restored;
  const timed = (name, action) => {
    const began = performance.now();
    const result = action();
    (timings[name] ||= []).push(performance.now() - began);
    return result;
  };
  const timedAsync = async (name, action) => {
    const began = performance.now();
    const result = await action();
    (timings[name] ||= []).push(performance.now() - began);
    return result;
  };
  try {
    store = openStore({ dataDir: sourceDir });
    const initialBytes = directoryBytes(sourceDir);
    const passwordHash = await hashPassword(PASSWORD);
    const alice = store.createBusinessOwner({ businessName: 'Synthetic Load A', username: 'load-a@example.test', passwordHash });
    const bob = store.createBusinessOwner({ businessName: 'Synthetic Load B', username: 'load-b@example.test', passwordHash });
    let first;
    for (let i = 0; i < 200; i += 1) {
      const created = timed('createProject', () => store.createPanelProject(alice, projectInput(i, i === 0 ? 200 : 1), crypto.randomUUID())).project;
      if (i === 0) first = created;
    }
    for (let i = 0; i < 4; i += 1) timed('createProject', () => store.createPanelProject(bob, projectInput(200 + i), crypto.randomUUID()));
    for (let i = 0; i < 300; i += 1) timed('createRequest', () => store.createLead(i < 240 ? alice : bob, leadInput(i), crypto.randomUUID()));
    for (let i = 0; i < 5; i += 1) first = timed('attachImage', () => store.addPanelSource(alice, first.id, { version: first.version, name: 'fixture-' + i + '.png', mime: 'image/png', dataBase64: IMAGE.toString('base64') }, crypto.randomUUID())).project;
    assert.throws(() => store.createPanelProject(alice, projectInput(999), crypto.randomUUID()), error => { expectedRejections.push(error.code); return error.code === 'project_limit'; });
    assert.throws(() => store.addPanelSource(alice, first.id, { version: first.version, name: 'extra.png', mime: 'image/png', dataBase64: IMAGE.toString('base64') }, crypto.randomUUID()), error => { expectedRejections.push(error.code); return error.code === 'source_limit'; });
    assert.throws(() => store.updatePanelProject(alice, first.id, { ...projectInput(0, 201), version: first.version }), error => { expectedRejections.push(error.code); return error.code === 'invalid_input'; });
    checks.push({ check: 'project/row/image capacity boundaries', status: 'PASS' });
    for (let i = 0; i < 100; i += 1) {
      const input = { name: first.name, notes: ' Corrected note ' + i + ' Ω\nsecond line ', rows: first.rows, version: first.version };
      first = timed('save200RowProject', () => store.updatePanelProject(alice, first.id, input));
      assert.deepEqual(first.rows, input.rows);
      assert.equal(first.notes, input.notes);
    }
    const csvHash = sha(store.exportPanelProject(alice, first.id));
    for (let i = 0; i < 100; i += 1) assert.equal(sha(timed('export200RowsCsv', () => store.exportPanelProject(alice, first.id))), csvHash);
    for (let i = 0; i < 20; i += 1) {
      assert.equal(timed('list240Requests', () => store.listLeads(alice)).length, 240);
      assert.equal(timed('list200Projects', () => store.listPanelProjects(alice)).length, 200);
    }
    for (let i = 0; i < 5; i += 1) {
      store.close();
      store = timed('reopenDatabase', () => openStore({ dataDir: sourceDir, create: false }));
      assert.deepEqual(store.getPanelProject(alice, first.id), first);
    }
    checks.push({ check: 'repeated saves, exports, listing and reopen preserve saved values', status: 'PASS' });
    const optoutPhone = leadInput(0).phone;
    store.suppressPhone(alice, optoutPhone);
    const held = store.createLead(alice, { ...leadInput(900), job: 'Sparking outlet', conversation: [{ role: 'customer', text: 'The outlet is sparking.' }] }, crypto.randomUUID()).lead;
    assert.equal(held.safetyHold, true);
    const profile = store.getProfile(alice);
    profile.facts.hours = { verified: true, answer: 'Synthetic weekdays 8 AM to 4 PM.' };
    store.updateProfile(alice, { version: profile.version, businessName: profile.business.name, facts: profile.facts });
    const tokens = Array.from({ length: 5 }, () => crypto.randomBytes(32).toString('base64url'));
    for (const token of tokens) store.createSession(alice.id, digest(token), passwordHash);
    store.consumeLoginAttempt('synthetic-stress-throttle', 5);
    const beforeFull = databaseDigests(store.filename, { includeCredentials: true });
    const beforeAlice = databaseDigests(store.filename, { businessId: alice.businessId });
    const beforeBob = databaseDigests(store.filename, { businessId: bob.businessId });
    const bytesBeforeBackup = directoryBytes(sourceDir);
    const backup = await timedAsync('encryptedBackup', () => createEncryptedBackup({ dataDir: sourceDir, outputFile: archive, passphrase: PASSPHRASE }));
    const recovery = await timedAsync('authenticatedRestore', () => restoreEncryptedBackup({ backupFile: archive, dataDir: restoreDir, passphrase: PASSPHRASE }));
    assert.deepEqual(databaseDigests(store.filename, { includeCredentials: true }), beforeFull);
    const afterAlice = databaseDigests(path.join(restoreDir, 'workspace.sqlite'), { businessId: alice.businessId });
    const afterBob = databaseDigests(path.join(restoreDir, 'workspace.sqlite'), { businessId: bob.businessId });
    assert.deepEqual(afterAlice, beforeAlice);
    assert.deepEqual(afterBob, beforeBob);
    assert.deepEqual(recovery.counts, backup.counts);
    const recoveredState = databaseDigests(path.join(restoreDir, 'workspace.sqlite'), { includeCredentials: true });
    assert.equal(recoveredState.tables.sessions.rows, 0);
    assert.equal(recoveredState.tables.login_attempts.rows, 0);
    restored = openStore({ dataDir: restoreDir, create: false });
    assert.equal(restored.findUser(alice.username).password_hash, RESTORE_DISABLED_PASSWORD);
    assert.equal(restored.findUser(bob.username).password_hash, RESTORE_DISABLED_PASSWORD);
    for (const token of tokens) assert.equal(restored.session(digest(token)), null);
    assert.equal(restored.isSuppressed(alice, optoutPhone), true);
    assert.equal(restored.getLead(alice, held.id).safetyHold, true);
    for (const source of first.sources) assert.deepEqual(restored.getPanelSource(alice, first.id, source.id).data, IMAGE);
    assert.equal(sha(restored.exportPanelProject(alice, first.id)), csvHash);
    checks.push({ check: 'encrypted restore retains canonical records, private image bytes, flags and exports', status: 'PASS' });
    const auth = createAuth(restored);
    await assert.rejects(auth.login({ username: alice.username, password: PASSWORD }), error => error.code === 'invalid_credentials');
    restored.resetOwnerPassword({ username: alice.username, passwordHash: await hashPassword(RESET_PASSWORD) });
    const signedIn = await auth.login({ username: alice.username, password: RESET_PASSWORD });
    assert.equal(signedIn.user.id, alice.id);
    assert.equal(restored.findUser(bob.username).password_hash, RESTORE_DISABLED_PASSWORD);
    assert.equal(recovery.sessionsRestored, false);
    assert.equal(recovery.passwordResetRequired, true);
    checks.push({ check: 'restored sessions removed, old credentials rejected and operator reset restores one owner', status: 'PASS' });
    assert.throws(() => restored.getPanelProject(bob, first.id), error => error.code === 'not_found');
    assert.throws(() => restored.getPanelSource(bob, first.id, first.sources[0].id), error => error.code === 'not_found');
    assert.throws(() => restored.exportPanelProject(bob, first.id), error => error.code === 'not_found');
    checks.push({ check: 'tenant boundaries remain after recovery', status: 'PASS' });
    const cpu = process.cpuUsage(cpuStart);
    return { status: 'PASS', date: new Date().toISOString(), scope: 'One local synthetic storage/recovery drill. Not HTTP load, user concurrency, hardware sizing or production capacity.',
      sourceSha256: { harness: sha(fs.readFileSync(__filename)), store: sha(fs.readFileSync(path.join(__dirname, '../workspace/store.cjs'))), backup: sha(fs.readFileSync(path.join(__dirname, '../workspace/backup.cjs'))) },
      workload: { businesses: 2, projects: 204, requests: 301, maximumRowsInProject: 200, sourceImages: 5, repeatedSaves: 100, repeatedCsvExports: 100, listPasses: 20, reopenCycles: 5, sessionsBeforeBackup: 5 },
      unexpectedErrors: 0, expectedRejections, checks, latency: Object.fromEntries(Object.entries(timings).map(([name, values]) => [name, summarize(values)])),
      elapsedMs: Math.round(performance.now() - started),
      process: { node: process.version, platform: process.platform, cpuUserMs: Math.round(cpu.user / 1000), cpuSystemMs: Math.round(cpu.system / 1000), rssBeforeBytes: rssStart, rssAfterBytes: process.memoryUsage().rss, peakRssKiB: process.resourceUsage().maxRSS },
      storage: { initialDirectoryBytes: initialBytes, populatedDirectoryBytes: bytesBeforeBackup, restoredDirectoryBytes: directoryBytes(restoreDir), encryptedArchiveBytes: backup.archiveBytes, counts: backup.counts },
      integrity: { sourceUnchanged: true, businessA: { before: beforeAlice.sha256, after: afterAlice.sha256, tables: beforeAlice.tables }, businessB: { before: beforeBob.sha256, after: afterBob.sha256, tables: beforeBob.tables }, csvSha256: csvHash, restoredSessions: 0, passwordsDisabledBeforeReset: 2 } };
  } finally {
    restored?.close(); store?.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

if (require.main === module) run().then(result => {
  if (process.argv[2]) fs.writeFileSync(process.argv[2], JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
}).catch(error => { console.error(JSON.stringify({ status: 'FAIL', code: error.code || 'STRESS_ASSERTION_FAILED', detail: error.message })); process.exitCode = 1; });

module.exports = { run, canonical, databaseDigests, summarize };
