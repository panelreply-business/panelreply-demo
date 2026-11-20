'use strict';

// Product-bound recovery exercises synthetic local databases only. The V1
// recovery suite remains separate and keeps its original schema/format checks.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const http = require('node:http');
const { once } = require('node:events');
const { Worker } = require('node:worker_threads');
const { DatabaseSync } = require('node:sqlite');
const { Readable } = require('node:stream');
const { openStore, digest } = require('../workspace/store.cjs');
const { MARKER, productBinding, readProductBinding, openProductStore, bindProductDirectory } = require('../workspace/products.cjs');
const { hashPassword, createAuth } = require('../workspace/auth.cjs');
const { assertPrivateDirectory } = require('../workspace/file-safety.cjs');
const { createEncryptedBackup, restoreEncryptedBackup, RESTORE_DISABLED_PASSWORD } = require('../workspace/backup.cjs');
const { startSeparatedWorkspace, startWorkspace } = require('../workspace-server.cjs');
const backupCli = require('../scripts/workspace-backup.cjs');

const PASSWORD = 'Synthetic product owner password 2026!';
const PASSPHRASE = 'Synthetic product archive passphrase 2026!';
const HASH = hashPassword(PASSWORD);
const TABLES = ['businesses', 'users', 'sessions', 'login_attempts', 'leads', 'messages', 'audit', 'suppression', 'panel_projects', 'panel_sources', 'record_deletions', 'deletion_operations', 'safety_holds', 'assistant_usage'];
const other = product => product === 'callback' ? 'spreadsheet' : 'callback';
const errorCode = code => error => error.code === code;
function snapshots(filename) {
  const db = new DatabaseSync(filename, { readOnly: true });
  try { return Object.fromEntries(TABLES.map(table => [table, db.prepare('SELECT * FROM ' + table + ' ORDER BY rowid').all().map(row => ({ ...row }))])); }
  finally { db.close(); }
}
function environment(product, dataDir, port = 18081) {
  const prefix = product === 'callback' ? 'CALLBACK' : 'SPREADSHEET';
  return { [prefix + '_DATA_DIR']: dataDir, [prefix + '_PORT']: String(port), [prefix + '_ORIGIN']: 'http://127.0.0.1:' + port };
}
async function fixture(t, product, { legacy = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'panelreply-product-backup-'));
  fs.chmodSync(root, 0o700);
  const source = path.join(root, 'source'), archives = path.join(root, 'archives'), restored = path.join(root, 'restored');
  fs.mkdirSync(archives, { mode: 0o700 });
  let store = legacy ? openStore({ dataDir: source }) : openProductStore({ dataDir: source, product });
  t.after(() => {
    store?.close();
    // A failed application restore deliberately preserves its locked directory.
    // Cleanup changes only this disposable test's known target before removal.
    if (fs.existsSync(restored) && (fs.statSync(restored).mode & 0o777) === 0o300) fs.chmodSync(restored, 0o700);
    fs.rmSync(root, { recursive: true, force: true });
  });
  const actor = store.createBusinessOwner({ businessName: 'Synthetic Product Electric', username: product + '@example.test', passwordHash: await HASH });
  if (product === 'callback') {
    const lead = store.createLead(actor, { customerName: 'Synthetic Callback Owner', phone: '+15865550122', job: 'Install a garage EV charger', zip: '48315', callbackWindow: 'Monday afternoon', requestedWorkDate: 'Friday', contactPermission: 'requested_callback', conversation: [{ role: 'customer', text: 'Please call me about an EV charger.' }] }, crypto.randomUUID()).lead;
    store.updateLead(actor, lead.id, { version: lead.version, status: 'new', notes: 'Preserve this synthetic callback note.' });
    store.suppressPhone(actor, lead.phone);
  } else {
    const project = store.createPanelProject(actor, { name: 'Synthetic source-linked panel', notes: 'Corrected values must survive recovery.', rows: [{ partNumber: '00120', manufacturer: 'SYNTHETIC PARTS', description: 'Synthetic component', quantity: 2, reviewStatus: 'unreviewed', notes: 'Retain exact notes', sourceImageId: null }] }, crypto.randomUUID()).project;
    const dataBase64 = fs.readFileSync(path.join(__dirname, 'fixtures/panels/complete.png')).toString('base64');
    const upload = store.addPanelSource(actor, project.id, { version: project.version, name: 'synthetic-panel.png', mime: 'image/png', dataBase64 }, crypto.randomUUID());
    store.updatePanelProject(actor, project.id, { version: upload.project.version, name: project.name, notes: project.notes,
      rows: project.rows.map(row => ({ ...row, sourceImageId: upload.source.id, reviewStatus: 'reviewed' })) });
  }
  const session = await createAuth(store).login({ username: actor.username, password: PASSWORD });
  store.consumeLoginAttempt('synthetic-product-throttle', 5);
  return { root, source, archives, restored, archive: path.join(archives, 'product.prbk'), actor, session, product,
    get store() { return store; }, close() { store?.close(); store = null; } };
}
function create(f, extra = {}) { return createEncryptedBackup({ dataDir: f.source, outputFile: f.archive, passphrase: PASSPHRASE, product: f.product, ...extra }); }
function restore(f, extra = {}) { return restoreEncryptedBackup({ backupFile: f.archive, dataDir: f.restored, passphrase: PASSPHRASE, product: f.product, ...extra }); }

for (const product of ['callback', 'spreadsheet']) test(product + ' authenticated backup preserves binding, data, disabled credentials and source state', async t => {
  const f = await fixture(t, product), before = snapshots(f.store.filename), marker = fs.readFileSync(path.join(f.source, MARKER));
  const created = await create(f), restored = await restore(f);
  assert.equal(created.version, 2); assert.equal(created.product, product);
  assert.equal(restored.version, 2); assert.equal(restored.product, product);
  assert.equal(restored.passwordResetRequired, true); assert.equal(restored.sessionsRestored, false);
  assert.deepEqual(readProductBinding(f.restored), productBinding(product));
  assert.equal(fs.statSync(f.restored).mode & 0o777, 0o700);
  for (const name of [MARKER, 'workspace.sqlite']) {
    const stat = fs.statSync(path.join(f.restored, name)); assert.equal(stat.mode & 0o777, 0o600); assert.equal(stat.nlink, 1);
  }
  const recovered = openProductStore({ dataDir: f.restored, product, create: false });
  try {
    const after = snapshots(recovered.filename);
    for (const table of TABLES.filter(table => !['users', 'sessions', 'login_attempts'].includes(table))) assert.deepEqual(after[table], before[table], table);
    assert.deepEqual(after.sessions, []); assert.deepEqual(after.login_attempts, []);
    assert.equal(recovered.findUser(f.actor.username).password_hash, RESTORE_DISABLED_PASSWORD);
    assert.equal(recovered.session(digest(f.session.token)), null);
    await assert.rejects(createAuth(recovered).login({ username: f.actor.username, password: PASSWORD }), errorCode('invalid_credentials'));
  } finally { recovered.close(); }
  assert.throws(() => openProductStore({ dataDir: f.restored, product: other(product), create: false }), /another|not bound|requested product/i);
  assert.deepEqual(snapshots(f.store.filename), before); assert.deepEqual(fs.readFileSync(path.join(f.source, MARKER)), marker);
  assert.deepEqual(f.store.session(digest(f.session.token)), f.actor);
});

for (const product of ['callback', 'spreadsheet']) test(product + ' restored archive retains binding through a second backup and restore', async t => {
  const f = await fixture(t, product); await create(f); await restore(f);
  const second = path.join(f.archives, 'second.prbk'), destination = path.join(f.root, 'second-restore');
  await createEncryptedBackup({ dataDir: f.restored, outputFile: second, passphrase: PASSPHRASE, product });
  const result = await restoreEncryptedBackup({ backupFile: second, dataDir: destination, passphrase: PASSPHRASE, product });
  assert.equal(result.product, product); assert.deepEqual(readProductBinding(destination), productBinding(product));
  const copy = openProductStore({ dataDir: destination, product, create: false });
  try { assert.equal(copy.findUser(f.actor.username).password_hash, RESTORE_DISABLED_PASSWORD); } finally { copy.close(); }
});

for (const product of ['callback', 'spreadsheet']) test(product + ' bound source requires the matching explicit backup product', async t => {
  const f = await fixture(t, product), before = snapshots(f.store.filename);
  await assert.rejects(create(f, { product: undefined }), errorCode('product_required'));
  await assert.rejects(create(f, { product: other(product) }), errorCode('product_mismatch'));
  assert.equal(fs.existsSync(f.archive), false); assert.deepEqual(snapshots(f.store.filename), before);
});

for (const product of ['callback', 'spreadsheet']) test(product + ' bound restore requires the matching authenticated product before publishing files', async t => {
  const f = await fixture(t, product); await create(f);
  await assert.rejects(restore(f, { product: undefined }), errorCode('product_required'));
  await assert.rejects(restore(f, { product: other(product) }), errorCode('product_mismatch'));
  assert.equal(fs.existsSync(f.restored), false);
  assert.deepEqual(fs.readdirSync(f.root).sort(), ['archives', 'source']);
});

for (const product of ['callback', 'spreadsheet']) test(product + ' cannot adopt an unbound source or legacy archive through backup flags', async t => {
  const f = await fixture(t, product, { legacy: true });
  await assert.rejects(create(f), errorCode('product_binding_required'));
  assert.equal(fs.existsSync(f.archive), false); assert.equal(readProductBinding(f.source), null);
  const archived = await create(f, { product: undefined }); assert.equal(archived.version, 1);
  await assert.rejects(restore(f), errorCode('legacy_product_binding_forbidden'));
  assert.equal(fs.existsSync(f.restored), false);
  const recovered = await restore(f, { product: undefined }); assert.equal(recovered.version, 1);
  assert.equal(readProductBinding(f.restored), null);
  assert.throws(() => openProductStore({ dataDir: f.restored, product }), /unmarked nonempty/);
});

for (const product of ['callback', 'spreadsheet']) test(product + ' backup refuses a missing or malformed binding without publishing an archive', async t => {
  const f = await fixture(t, product), marker = path.join(f.source, MARKER), original = fs.readFileSync(marker);
  fs.unlinkSync(marker);
  await assert.rejects(create(f), errorCode('product_binding_required'));
  fs.writeFileSync(marker, '{malformed', { flag: 'wx', mode: 0o600 });
  await assert.rejects(create(f), errorCode('invalid_product_binding'));
  fs.writeFileSync(marker, original);
  assert.equal(fs.existsSync(f.archive), false); assert.deepEqual(readProductBinding(f.source), productBinding(product));
});

for (const product of ['callback', 'spreadsheet']) for (const change of ['different-product', 'downgrade-version', 'unknown-product-code', 'reserved-bytes']) test(product + ' archive rejects header tampering: ' + change, async t => {
  const f = await fixture(t, product); await create(f);
  const bytes = fs.readFileSync(f.archive);
  if (change === 'different-product') bytes.writeUInt16BE(product === 'callback' ? 2 : 1, 14);
  else if (change === 'downgrade-version') { bytes.writeUInt16BE(1, 8); bytes.writeUInt16BE(0, 14); }
  else if (change === 'unknown-product-code') bytes.writeUInt16BE(99, 14);
  else bytes.writeUInt32BE(1, 60);
  fs.writeFileSync(f.archive, bytes);
  await assert.rejects(restore(f), errorCode(['different-product', 'downgrade-version'].includes(change) ? 'authentication_failed' : 'unsupported_format'));
  assert.equal(fs.existsSync(f.restored), false);
  assert.deepEqual(fs.readdirSync(f.root).sort(), ['archives', 'source']);
});

for (const product of ['callback', 'spreadsheet']) test(product + ' restore rejects an existing destination without changing its permissions or contents', async t => {
  const f = await fixture(t, product); await create(f);
  fs.mkdirSync(f.restored, { mode: 0o700 }); fs.writeFileSync(path.join(f.restored, 'operator-file'), 'preserve', { mode: 0o600 });
  await assert.rejects(restore(f), errorCode('unsafe_path'));
  assert.equal(fs.statSync(f.restored).mode & 0o777, 0o700); assert.equal(fs.readFileSync(path.join(f.restored, 'operator-file'), 'utf8'), 'preserve');
});

const INTERRUPT = String.raw`
  const { parentPort, workerData } = require('node:worker_threads');
  const fs = require('node:fs'), path = require('node:path');
  const pause = stage => { parentPort.postMessage({ stage }); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 30000); throw new Error('Interruption wait expired'); };
  const mkdir = fs.mkdirSync, link = fs.linkSync, unlink = fs.unlinkSync, chmod = fs.chmodSync;
  let stagedDatabase, stagedMarker;
  fs.mkdirSync = (destination, options) => {
    const result = mkdir(destination, options);
    if (destination === workerData.target && workerData.stage === 'empty-locked') pause('empty-locked');
    return result;
  };
  fs.linkSync = (source, destination) => {
    if (destination === path.join(workerData.target, 'workspace.sqlite')) stagedDatabase = source;
    if (destination === path.join(workerData.target, 'product-binding.json')) stagedMarker = source;
    const result = link(source, destination);
    if (source === stagedDatabase && workerData.stage === 'database-linked') pause('database-linked');
    if (source === stagedMarker && workerData.stage === 'binding-linked') pause('binding-linked');
    return result;
  };
  fs.unlinkSync = filename => {
    const result = unlink(filename);
    if (filename === stagedDatabase && workerData.stage === 'database-published') pause('database-published');
    return result;
  };
  fs.chmodSync = (filename, mode) => {
    if (filename === workerData.target && mode === 0o700 && workerData.stage === 'before-ready') pause('before-ready');
    const result = chmod(filename, mode);
    if (filename === workerData.target && mode === 0o700 && workerData.stage === 'ready') pause('ready');
    return result;
  };
  require(workerData.module).restoreEncryptedBackup({ backupFile: workerData.archive, dataDir: workerData.target,
    passphrase: workerData.passphrase, product: workerData.product }).then(
      () => parentPort.postMessage({ unexpectedCompletion: true }),
      error => parentPort.postMessage({ error: error.code || error.message }));
`;

for (const product of ['callback', 'spreadsheet']) for (const stage of ['empty-locked', 'database-linked', 'database-published', 'binding-linked', 'before-ready', 'ready']) test(product + ' restore interruption at ' + stage + ' cannot adopt an incomplete workspace', async t => {
  const f = await fixture(t, product), before = snapshots(f.store.filename); await create(f);
  const worker = new Worker(INTERRUPT, { eval: true, workerData: { module: path.join(__dirname, '../workspace/backup.cjs'), archive: f.archive,
    target: f.restored, passphrase: PASSPHRASE, product, stage } });
  t.after(() => worker.terminate());
  const [message] = await once(worker, 'message', { signal: AbortSignal.timeout(15000) });
  assert.equal(message.stage, stage, JSON.stringify(message)); await worker.terminate();
  assert.deepEqual(snapshots(f.store.filename), before);
  if (stage === 'ready') {
    assert.equal(fs.statSync(f.restored).mode & 0o777, 0o700);
    const recovered = openProductStore({ dataDir: f.restored, product, create: false });
    try { assert.equal(recovered.findUser(f.actor.username).password_hash, RESTORE_DISABLED_PASSWORD); assert.equal(recovered.session(digest(f.session.token)), null); }
    finally { recovered.close(); }
    assert.throws(() => startSeparatedWorkspace(other(product), environment(other(product), f.restored)), /not bound|requested product|another/i);
  } else {
    assert.equal(fs.statSync(f.restored).mode & 0o777, 0o300);
    assert.throws(() => assertPrivateDirectory(f.restored), /0700/);
    for (const attempted of ['callback', 'spreadsheet']) {
      assert.throws(() => bindProductDirectory(f.restored, attempted), /0700/);
      assert.throws(() => startSeparatedWorkspace(attempted, environment(attempted, f.restored)), /0700/);
    }
    assert.throws(() => startWorkspace({ PORT: '18081', WORKSPACE_ORIGIN: 'http://127.0.0.1:18081', WORKSPACE_DATA_DIR: f.restored }), /0700/);
    assert.equal(fs.statSync(f.restored).mode & 0o777, 0o300, 'failed startup must not repair permissions or create records');
  }
  await assert.rejects(restore(f), errorCode('unsafe_path'));
});

for (const product of ['callback', 'spreadsheet']) test(product + ' backup CLI carries explicit binding without exposing the passphrase', async t => {
  const f = await fixture(t, product);
  const created = await backupCli.main(['create', '--data-dir', f.source, '--output', f.archive, '--product', product], Readable.from([PASSPHRASE + '\n']));
  const restored = await backupCli.main(['restore', '--backup', f.archive, '--data-dir', f.restored, '--product', product], Readable.from([PASSPHRASE + '\n']));
  assert.equal(created.product, product); assert.equal(restored.product, product);
  assert.equal(JSON.stringify([created, restored]).includes(PASSPHRASE), false);
});

test('backup CLI rejects ambiguous products and missing paths', () => {
  for (const args of [
    ['create', '--data-dir', '/source', '--product', 'callback'],
    ['restore', '--backup', '/archive', '--product', 'spreadsheet'],
    ['create', '--data-dir', '/source', '--output', '/target', '--product', 'combined'],
    ['restore', '--backup', '/archive', '--data-dir', '/target', '--product', 'unknown'],
    ['restore', '--backup', '/archive', '--data-dir', '/target', '--passphrase', PASSPHRASE]
  ]) assert.throws(() => backupCli.parseArgs(args));
});

async function availablePort() {
  const listener = http.createServer(); listener.listen(0, '127.0.0.1'); await once(listener, 'listening');
  const port = listener.address().port; await new Promise(resolve => listener.close(resolve)); return port;
}
for (const product of ['callback', 'spreadsheet']) test(product + ' fixed entrypoint starts its restored workspace with the correct product metadata', { skip: process.env.WORKSPACE_HTTP_TESTS !== '1' }, async t => {
  const f = await fixture(t, product); await create(f); await restore(f);
  const port = await availablePort(), app = startSeparatedWorkspace(product, environment(product, f.restored, port));
  t.after(() => app.close()); await once(app.server, 'listening');
  const response = await fetch('http://127.0.0.1:' + port + '/health', { redirect: 'error', signal: AbortSignal.timeout(5000) });
  assert.equal(response.status, 200); const result = await response.json();
  assert.equal(result.product.id, product); assert.equal(result.aiEnabled, false);
  assert.equal(result.product.capabilities.intake, product === 'callback');
  assert.equal(result.product.capabilities.panelProjects, product === 'spreadsheet');
  assert.equal(app.store.findUser(f.actor.username).password_hash, RESTORE_DISABLED_PASSWORD);
  await app.close();
});
