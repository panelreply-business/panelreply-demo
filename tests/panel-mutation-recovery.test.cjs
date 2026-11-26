'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { Readable } = require('node:stream');
const { EventEmitter } = require('node:events');
const { openProductStore } = require('../workspace/products.cjs');
const { digest } = require('../workspace/store.cjs');
const { hashPassword, csrfFor } = require('../workspace/auth.cjs');
const { createWorkspaceApp } = require('../workspace/api.cjs');
const { validateDatabase, createEncryptedBackup, restoreEncryptedBackup, RESTORE_DISABLED_PASSWORD } = require('../workspace/backup.cjs');
const { exportProjectXlsx } = require('../workspace/xlsx.cjs');

const TIME = Date.UTC(2026, 10, 23, 12);
const MAX_LIVE_VERSION = Number.MAX_SAFE_INTEGER - 1;
const HASH = hashPassword('Synthetic spreadsheet recovery password 2026!');
const PASSPHRASE = 'Synthetic spreadsheet recovery archive passphrase 2026!';
const IMAGE = fs.readFileSync(path.join(__dirname, 'fixtures/panels/complete.png'));
const TABLES = ['panel_projects', 'panel_sources', 'audit', 'record_deletions', 'deletion_operations'];
const errorCode = (code, status) => error => error.code === code && error.status === status;
const edit = (project, changes = {}) => ({ version: project.version, name: project.name, notes: project.notes, rows: project.rows.map(row => ({ ...row })), ...changes });
const imageBody = (version, name = 'synthetic-source.png') => ({ version, name, mime: 'image/png', dataBase64: IMAGE.toString('base64') });

function inspect(f, action) {
  const db = new DatabaseSync(f.store.filename);
  try { return action(db); } finally { db.close(); }
}
function snapshot(f) {
  return inspect(f, db => Object.fromEntries(TABLES.map(table => [table, db.prepare('SELECT * FROM ' + table + ' ORDER BY rowid').all()])));
}
function unchanged(f, before) {
  assert.deepEqual(snapshot(f), before);
  assert.doesNotThrow(() => inspect(f, validateDatabase));
  assert.deepEqual(f.store.getPanelSource(f.actor, f.project.id, f.source.id).data, IMAGE);
}
function setVersion(f, version) {
  inspect(f, db => db.prepare('UPDATE panel_projects SET version=? WHERE id=?').run(version, f.project.id));
  assert.doesNotThrow(() => inspect(f, validateDatabase));
  return f.store.getPanelProject(f.actor, f.project.id);
}
async function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'panelreply-panel-mutation-'));
  fs.chmodSync(root, 0o700);
  let clock = TIME, reads = 0, clockSequence = null;
  const dataDir = path.join(root, 'data');
  const store = openProductStore({ dataDir, product: 'spreadsheet', now: () => { reads += 1; return clockSequence ? clockSequence.shift() : clock; } });
  t.after(() => { store.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const actor = store.createBusinessOwner({ businessName: 'Synthetic spreadsheet owner', username: 'synthetic-panel@example.test', passwordHash: await HASH });
  const createBody = { name: 'Synthetic correction project', notes: 'Retain this correction.', rows: [
    { partNumber: '000120-Ω', manufacturer: 'SYNTHETIC PARTS', description: 'Synthetic component', quantity: 2, reviewStatus: 'unreviewed', notes: 'Exact correction\nsecond line', sourceImageId: null },
    { partNumber: '', manufacturer: '', description: 'Unknown values remain blank', quantity: 1, reviewStatus: 'unreviewed', notes: '', sourceImageId: null },
  ] };
  const createKey = crypto.randomUUID(), created = store.createPanelProject(actor, createBody, createKey).project;
  const uploadBody = imageBody(created.version), uploadKey = crypto.randomUUID();
  const uploaded = store.addPanelSource(actor, created.id, uploadBody, uploadKey);
  const project = store.updatePanelProject(actor, created.id, edit(uploaded.project, {
    rows: created.rows.map((row, index) => ({ ...row, sourceImageId: uploaded.source.id, reviewStatus: index ? 'unreviewed' : 'reviewed' })),
  }));
  const result = { root, dataDir, store, actor, project, source: uploaded.source, createKey, createBody, uploadKey, uploadBody,
    setClock(value) { clock = value; clockSequence = null; reads = 0; },
    sequence(values) { clockSequence = [...values]; reads = 0; },
    get clockReads() { return reads; },
  };
  assert.doesNotThrow(() => inspect(result, validateDatabase));
  return result;
}

async function request(app, headers, method, url, input) {
  const req = Readable.from(input === undefined ? [] : [JSON.stringify(input)]);
  Object.assign(req, { method, url, headers: { host: '127.0.0.1:10001', origin: 'http://127.0.0.1:10001', 'content-type': 'application/json', ...headers }, socket: { remoteAddress: '127.0.0.1' } });
  const res = new EventEmitter(); res.writableEnded = false; res.destroyed = false;
  res.writeHead = (status, values) => { res.status = status; res.headers = values; };
  res.end = value => { res.buffer = value === undefined ? Buffer.alloc(0) : Buffer.from(value); res.writableEnded = true; };
  await app.handler(req, res);
  if (res.headers?.['Content-Type']?.startsWith('application/json') && res.buffer.length) res.body = JSON.parse(res.buffer);
  return res;
}

test('panel correction rejects a one-second clock rollback without losing rows or export state', async t => {
  const f = await fixture(t), before = snapshot(f), csv = f.store.exportPanelProject(f.actor, f.project.id), xlsx = exportProjectXlsx(f.project);
  const update = edit(f.project, { notes: 'Pending correction retained by the caller.' });
  const originalInput = structuredClone(update);
  f.setClock(TIME - 1000);
  assert.throws(() => f.store.updatePanelProject(f.actor, f.project.id, update), errorCode('clock_unavailable', 503));
  unchanged(f, before); assert.deepEqual(update, originalInput);
  assert.equal(f.store.exportPanelProject(f.actor, f.project.id), csv);
  assert.deepEqual(exportProjectXlsx(f.store.getPanelProject(f.actor, f.project.id)), xlsx);
  f.setClock(TIME + 1000);
  const saved = f.store.updatePanelProject(f.actor, f.project.id, update);
  assert.equal(saved.version, f.project.version + 1); assert.equal(saved.notes, update.notes);
  assert.deepEqual(saved.rows, update.rows); assert.equal(saved.rows[1].partNumber, ''); assert.equal(saved.rows[1].reviewStatus, 'unreviewed');
  assert.doesNotThrow(() => inspect(f, validateDatabase));
});

test('source upload rejects a backward clock before changing bytes, audit or project version', async t => {
  const f = await fixture(t), before = snapshot(f), input = imageBody(f.project.version, 'second-synthetic-source.png'), key = crypto.randomUUID();
  f.setClock(TIME - 1000);
  assert.throws(() => f.store.addPanelSource(f.actor, f.project.id, input, key), errorCode('clock_unavailable', 503));
  unchanged(f, before);
  f.setClock(TIME + 1000);
  const uploaded = f.store.addPanelSource(f.actor, f.project.id, input, key);
  assert.equal(uploaded.created, true); assert.equal(uploaded.project.version, f.project.version + 1);
  assert.deepEqual(f.store.getPanelSource(f.actor, f.project.id, uploaded.source.id).data, IMAGE);
  assert.doesNotThrow(() => inspect(f, validateDatabase));
});

test('panel mutations reject a clock earlier than the latest saved update', async t => {
  const f = await fixture(t);
  f.setClock(TIME + 2000);
  const current = f.store.updatePanelProject(f.actor, f.project.id, edit(f.project, { notes: 'A later saved correction' })), before = snapshot(f);
  f.setClock(TIME + 1000);
  for (const action of [
    () => f.store.updatePanelProject(f.actor, current.id, edit(current, { notes: 'An earlier clock value' })),
    () => f.store.addPanelSource(f.actor, current.id, imageBody(current.version, 'earlier-clock.png'), crypto.randomUUID()),
    () => f.store.deletePanelSource(f.actor, current.id, f.source.id, { version: current.version, confirmation: 'DELETE' }, crypto.randomUUID()),
    () => f.store.deletePanelProject(f.actor, current.id, { version: current.version, confirmation: 'DELETE' }, crypto.randomUUID()),
  ]) { assert.throws(action, errorCode('clock_unavailable', 503)); unchanged(f, before); }
});

test('source deletion rejects a backward clock before removing the image or changing review state', async t => {
  const f = await fixture(t), before = snapshot(f), input = { version: f.project.version, confirmation: 'DELETE' }, key = crypto.randomUUID();
  f.setClock(TIME - 1000);
  assert.throws(() => f.store.deletePanelSource(f.actor, f.project.id, f.source.id, input, key), errorCode('clock_unavailable', 503));
  unchanged(f, before);
  f.setClock(TIME + 1000);
  const receipt = f.store.deletePanelSource(f.actor, f.project.id, f.source.id, input, key);
  assert.equal(receipt.referencesCleared, 2); assert.equal(receipt.version, f.project.version + 1);
  const project = f.store.getPanelProject(f.actor, f.project.id);
  assert.deepEqual(project.rows, f.project.rows.map(row => ({ ...row, sourceImageId: null, reviewStatus: 'unreviewed' })));
  assert.doesNotThrow(() => inspect(f, validateDatabase));
});

test('project deletion rejects a backward clock and retains its complete saved state', async t => {
  const f = await fixture(t), before = snapshot(f), input = { version: f.project.version, confirmation: 'DELETE' }, key = crypto.randomUUID();
  f.setClock(TIME - 1000);
  assert.throws(() => f.store.deletePanelProject(f.actor, f.project.id, input, key), errorCode('clock_unavailable', 503));
  unchanged(f, before);
  f.setClock(TIME + 1000);
  const receipt = f.store.deletePanelProject(f.actor, f.project.id, input, key);
  assert.equal(receipt.deleted, true); assert.equal(receipt.sourcesDeleted, 1);
  assert.doesNotThrow(() => inspect(f, validateDatabase));
  f.setClock(NaN);
  assert.deepEqual(f.store.deletePanelProject(f.actor, f.project.id, input, key), receipt);
});

test('invalid clock values cannot create a project or mutate a saved project or source', async t => {
  const f = await fixture(t), before = snapshot(f);
  for (const value of [-1, 0.5, NaN, Infinity, 8640000000000001]) {
    f.setClock(value);
    const actions = [
      () => f.store.createPanelProject(f.actor, { ...f.createBody, name: 'Another synthetic project' }, crypto.randomUUID()),
      () => f.store.updatePanelProject(f.actor, f.project.id, edit(f.project, { notes: 'Rejected clock' })),
      () => f.store.addPanelSource(f.actor, f.project.id, imageBody(f.project.version, 'rejected.png'), crypto.randomUUID()),
      () => f.store.deletePanelSource(f.actor, f.project.id, f.source.id, { version: f.project.version, confirmation: 'DELETE' }, crypto.randomUUID()),
      () => f.store.deletePanelProject(f.actor, f.project.id, { version: f.project.version, confirmation: 'DELETE' }, crypto.randomUUID()),
    ];
    for (const action of actions) assert.throws(action, errorCode('clock_unavailable', 503), String(value));
    unchanged(f, before);
  }
});

test('terminal live project revision rejects correction, upload and source deletion atomically', async t => {
  const f = await fixture(t), current = setVersion(f, MAX_LIVE_VERSION), before = snapshot(f);
  f.setClock(TIME + 1000);
  for (const action of [
    () => f.store.updatePanelProject(f.actor, current.id, edit(current, { notes: 'Cannot increment further' })),
    () => f.store.addPanelSource(f.actor, current.id, imageBody(current.version, 'rejected.png'), crypto.randomUUID()),
    () => f.store.deletePanelSource(f.actor, current.id, f.source.id, { version: current.version, confirmation: 'DELETE' }, crypto.randomUUID()),
  ]) { assert.throws(action, errorCode('version_exhausted', 409)); unchanged(f, before); }
  assert.equal(f.store.getPanelProject(f.actor, current.id).version, MAX_LIVE_VERSION);
  assert.doesNotThrow(() => exportProjectXlsx(f.store.getPanelProject(f.actor, current.id)));
});

test('the final supported live revision increment remains valid for each panel mutation', async t => {
  for (const action of ['correction', 'upload', 'source-deletion']) {
    const f = await fixture(t), current = setVersion(f, MAX_LIVE_VERSION - 1);
    f.setClock(TIME + 1000);
    if (action === 'correction') f.store.updatePanelProject(f.actor, current.id, edit(current, { notes: 'Final supported correction' }));
    if (action === 'upload') f.store.addPanelSource(f.actor, current.id, imageBody(current.version, 'final.png'), crypto.randomUUID());
    if (action === 'source-deletion') f.store.deletePanelSource(f.actor, current.id, f.source.id, { version: current.version, confirmation: 'DELETE' }, crypto.randomUUID());
    assert.equal(f.store.getPanelProject(f.actor, current.id).version, MAX_LIVE_VERSION, action);
    assert.doesNotThrow(() => inspect(f, validateDatabase), action);
  }
});

test('completed create, upload and source-deletion retries survive a later clock or revision block', async t => {
  const f = await fixture(t), extra = f.store.addPanelSource(f.actor, f.project.id, imageBody(f.project.version, 'removed.png'), crypto.randomUUID());
  const input = { version: extra.project.version, confirmation: 'DELETE' }, key = crypto.randomUUID();
  const receipt = f.store.deletePanelSource(f.actor, f.project.id, extra.source.id, input, key);
  const current = setVersion(f, MAX_LIVE_VERSION), before = snapshot(f);
  f.setClock(NaN);
  const created = f.store.createPanelProject(f.actor, f.createBody, f.createKey);
  const uploaded = f.store.addPanelSource(f.actor, current.id, f.uploadBody, f.uploadKey);
  assert.equal(created.created, false); assert.equal(created.project.version, MAX_LIVE_VERSION);
  assert.equal(uploaded.created, false); assert.equal(uploaded.source.id, f.source.id);
  assert.deepEqual(f.store.deletePanelSource(f.actor, current.id, extra.source.id, input, key), receipt);
  unchanged(f, before);
});

test('terminal project deletion still creates a recoverable receipt and supports exact retry', async t => {
  const f = await fixture(t), current = setVersion(f, MAX_LIVE_VERSION), key = crypto.randomUUID();
  const input = { version: current.version, confirmation: 'DELETE' };
  f.setClock(TIME + 1000);
  const receipt = f.store.deletePanelProject(f.actor, current.id, input, key);
  assert.equal(receipt.version, Number.MAX_SAFE_INTEGER); assert.equal(receipt.deleted, true);
  assert.doesNotThrow(() => inspect(f, validateDatabase));
  f.setClock(NaN);
  assert.deepEqual(f.store.deletePanelProject(f.actor, current.id, input, key), receipt);
  assert.doesNotThrow(() => inspect(f, validateDatabase));
});

test('each panel write uses one validated clock reading for record and audit timestamps', async t => {
  const f = await fixture(t);
  const actions = [
    () => f.store.createPanelProject(f.actor, { ...f.createBody, name: 'Single clock sample' }, crypto.randomUUID()),
    () => f.store.updatePanelProject(f.actor, f.project.id, edit(f.store.getPanelProject(f.actor, f.project.id), { notes: 'Single clock correction' })),
    () => f.store.addPanelSource(f.actor, f.project.id, imageBody(f.store.getPanelProject(f.actor, f.project.id).version, 'single-clock.png'), crypto.randomUUID()),
    () => f.store.deletePanelSource(f.actor, f.project.id, f.source.id, { version: f.store.getPanelProject(f.actor, f.project.id).version, confirmation: 'DELETE' }, crypto.randomUUID()),
    () => f.store.deletePanelProject(f.actor, f.project.id, { version: f.store.getPanelProject(f.actor, f.project.id).version, confirmation: 'DELETE' }, crypto.randomUUID()),
  ];
  for (const action of actions) {
    f.sequence([TIME + 1000, NaN]); action(); assert.equal(f.clockReads, 1);
    assert.equal(inspect(f, db => db.prepare('SELECT created_at FROM audit ORDER BY rowid DESC LIMIT 1').get().created_at), TIME + 1000);
    assert.doesNotThrow(() => inspect(f, validateDatabase));
  }
});

test('rejected panel mutations preserve a product-bound encrypted restore with exact source bytes and exports', async t => {
  const f = await fixture(t), current = setVersion(f, MAX_LIVE_VERSION), before = snapshot(f);
  const csv = f.store.exportPanelProject(f.actor, current.id), xlsx = exportProjectXlsx(current);
  assert.throws(() => f.store.updatePanelProject(f.actor, current.id, edit(current, { notes: 'Cannot save over revision ceiling' })), errorCode('version_exhausted', 409));
  f.setClock(TIME - 1000);
  assert.throws(() => f.store.deletePanelProject(f.actor, current.id, { version: current.version, confirmation: 'DELETE' }, crypto.randomUUID()), errorCode('clock_unavailable', 503));
  unchanged(f, before);
  const archive = path.join(f.root, 'spreadsheet.prbk'), destination = path.join(f.root, 'restored');
  await createEncryptedBackup({ dataDir: f.dataDir, outputFile: archive, passphrase: PASSPHRASE, product: 'spreadsheet' });
  const restored = await restoreEncryptedBackup({ backupFile: archive, dataDir: destination, passphrase: PASSPHRASE, product: 'spreadsheet' });
  assert.equal(restored.product, 'spreadsheet'); assert.equal(restored.passwordResetRequired, true);
  const copy = openProductStore({ dataDir: destination, product: 'spreadsheet', create: false });
  try {
    assert.deepEqual(copy.getPanelProject(f.actor, current.id), current);
    assert.deepEqual(copy.getPanelSource(f.actor, current.id, f.source.id).data, IMAGE);
    assert.equal(copy.exportPanelProject(f.actor, current.id), csv);
    assert.deepEqual(exportProjectXlsx(copy.getPanelProject(f.actor, current.id)), xlsx);
    assert.equal(copy.findUser(f.actor.username).password_hash, RESTORE_DISABLED_PASSWORD);
  } finally { copy.close(); }
  assert.throws(() => openProductStore({ dataDir: destination, product: 'callback', create: false }), /another|not bound|requested product/i);
  unchanged(f, before);
});

test('fixed spreadsheet APIs expose controlled mutation failures while preserving saved rows, sources and exports', async t => {
  const f = await fixture(t), app = createWorkspaceApp({ store: f.store, product: 'spreadsheet', origin: 'http://127.0.0.1:10001' });
  t.after(() => app.close());
  const token = crypto.randomBytes(32).toString('base64url'); f.store.createSession(f.actor.id, digest(token));
  const headers = { cookie: app.auth.cookie(token).split(';')[0], 'x-csrf-token': csrfFor(token), 'idempotency-key': crypto.randomUUID() };
  const url = '/api/panel-projects/' + f.project.id, before = snapshot(f);
  assert.equal((await request(app, headers, 'GET', '/api/session')).body.product.id, 'spreadsheet');
  assert.equal((await request(app, headers, 'GET', '/api/leads')).status, 404);
  f.setClock(TIME - 1000);
  for (const [method, suffix, input] of [
    ['PATCH', '', edit(f.project, { notes: 'Clock must be checked' })],
    ['POST', '/sources', imageBody(f.project.version, 'not-saved.png')],
    ['DELETE', '/sources/' + f.source.id, { version: f.project.version, confirmation: 'DELETE' }],
    ['DELETE', '', { version: f.project.version, confirmation: 'DELETE' }],
  ]) {
    const response = await request(app, headers, method, url + suffix, input);
    assert.equal(response.status, 503); assert.equal(response.body.error.code, 'clock_unavailable'); unchanged(f, before);
  }
  f.setClock(TIME);
  const current = setVersion(f, MAX_LIVE_VERSION), terminal = snapshot(f);
  for (const [method, suffix, input] of [
    ['PATCH', '', edit(current, { notes: 'Revision limit' })],
    ['POST', '/sources', imageBody(current.version, 'not-saved.png')],
    ['DELETE', '/sources/' + f.source.id, { version: current.version, confirmation: 'DELETE' }],
  ]) {
    const response = await request(app, headers, method, url + suffix, input);
    assert.equal(response.status, 409); assert.equal(response.body.error.code, 'version_exhausted'); unchanged(f, terminal);
  }
  const csv = await request(app, headers, 'GET', url + '/export.csv'), xlsx = await request(app, headers, 'GET', url + '/export.xlsx');
  assert.equal(csv.status, 200); assert.equal(csv.buffer.toString(), f.store.exportPanelProject(f.actor, current.id));
  assert.equal(xlsx.status, 200); assert.deepEqual(xlsx.buffer, exportProjectXlsx(current));
});
