'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { DatabaseSync } = require('node:sqlite');
const { openStore, SCHEMAS, assertWorkspaceSchema, digest } = require('../workspace/store.cjs');
const panels = require('../workspace/panels.cjs');
const { hashPassword, createAuth } = require('../workspace/auth.cjs');
const { createEncryptedBackup, restoreEncryptedBackup, validateDatabase, RESTORE_DISABLED_PASSWORD, HEADER_BYTES, TAG_BYTES } = require('../workspace/backup.cjs');

const PASSWORD = 'Synthetic panel fixture password 2026!';
const PASSPHRASE = 'Synthetic panel backup passphrase 2026!';
const HASH = hashPassword(PASSWORD);
const row = (changes = {}) => ({ partNumber: 'SYN-100', manufacturer: 'Sample Electric', description: 'Synthetic component for testing', quantity: 1, reviewStatus: 'unreviewed', notes: '', sourceImageId: null, ...changes });
const project = (changes = {}) => ({ name: 'Synthetic service panel', notes: '', rows: [row()], ...changes });
const errorCode = code => error => error.code === code;

function png() {
  function chunk(type, data) {
    const content = Buffer.concat([Buffer.from(type), data]);
    let crc = 0xffffffff;
    for (const byte of content) { crc ^= byte; for (let i = 0; i < 8; i += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); }
    const result = Buffer.alloc(data.length + 12);
    result.writeUInt32BE(data.length); content.copy(result, 4); result.writeUInt32BE((crc ^ 0xffffffff) >>> 0, result.length - 4);
    return result;
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(1); ihdr.writeUInt32BE(1, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.from([0, 255, 255, 255]))), chunk('IEND', Buffer.alloc(0))]);
}
function source(version, changes = {}) { return { version, name: 'synthetic-panel.png', mime: 'image/png', dataBase64: png().toString('base64'), ...changes }; }
async function fixture(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'panelreply-panels-'));
  const dataDir = path.join(base, 'workspace');
  let store = openStore({ dataDir });
  const passwordHash = await HASH;
  const alice = store.createBusinessOwner({ businessName: 'Synthetic Electric', username: 'panel-owner@example.test', passwordHash });
  const bob = store.createBusinessOwner({ businessName: 'Other Synthetic Electric', username: 'other-panel@example.test', passwordHash });
  t.after(() => { store?.close(); fs.rmSync(base, { recursive: true, force: true }); });
  return { base, dataDir, alice, bob, passwordHash, get store() { return store; }, close() { store?.close(); store = null; }, reopen() { store?.close(); store = openStore({ dataDir }); return store; } };
}
function makeLegacy(dataDir) {
  fs.mkdirSync(dataDir, { mode: 0o700 });
  const filename = path.join(dataDir, 'workspace.sqlite');
  fs.writeFileSync(filename, '', { mode: 0o600 });
  const db = new DatabaseSync(filename);
  db.exec([...Object.values(SCHEMAS[1].tables), ...Object.values(SCHEMAS[1].indexes), 'PRAGMA user_version=1'].join(';') + ';');
  db.close();
  return filename;
}

test('panel projects persist exact corrections across close and reopen', async t => {
  const f = await fixture(t);
  const created = f.store.createPanelProject(f.alice, project(), crypto.randomUUID());
  assert.equal(created.created, true);
  const edited = { name: 'Workshop panel', notes: 'Keep the original photo.', rows: [row({ partNumber: '  =SYN-200', description: 'Line 1, "quoted"\nLine 2', notes: ' café Ω ', reviewStatus: 'reviewed', quantity: 7 })] };
  const saved = f.store.updatePanelProject(f.alice, created.project.id, { version: 1, ...edited });
  assert.equal(saved.version, 2);
  f.reopen();
  assert.deepEqual(f.store.getPanelProject(f.alice, saved.id), saved);
  assert.deepEqual(saved.rows, edited.rows);
});

test('project idempotency prevents duplicate creates and rejects changed payload reuse', async t => {
  const f = await fixture(t), key = crypto.randomUUID();
  const first = f.store.createPanelProject(f.alice, project(), key);
  const repeated = f.store.createPanelProject(f.alice, project(), key);
  assert.equal(repeated.created, false);
  assert.deepEqual(repeated.project, first.project);
  assert.throws(() => f.store.createPanelProject(f.alice, project({ name: 'Other' }), key), errorCode('idempotency_conflict'));
  assert.equal(f.store.listPanelProjects(f.alice).length, 1);
  assert.equal(f.store.createPanelProject(f.bob, project(), key).created, true);
});

test('a stale project edit leaves the latest rows and revision unchanged', async t => {
  const f = await fixture(t), p = f.store.createPanelProject(f.alice, project(), crypto.randomUUID()).project;
  const saved = f.store.updatePanelProject(f.alice, p.id, { version: 1, ...project({ notes: 'Latest correction' }) });
  assert.throws(() => f.store.updatePanelProject(f.alice, p.id, { version: 1, ...project({ notes: 'Stale edit' }) }), errorCode('version_conflict'));
  assert.deepEqual(f.store.getPanelProject(f.alice, p.id), saved);
});

test('project list, detail, edits, image bytes and CSV stay business scoped', async t => {
  const f = await fixture(t), p = f.store.createPanelProject(f.alice, project(), crypto.randomUUID()).project;
  const image = f.store.addPanelSource(f.alice, p.id, source(1), crypto.randomUUID());
  assert.deepEqual(f.store.listPanelProjects(f.bob), []);
  for (const read of [() => f.store.getPanelProject(f.bob, p.id), () => f.store.exportPanelProject(f.bob, p.id), () => f.store.getPanelSource(f.bob, p.id, image.source.id), () => f.store.updatePanelProject(f.bob, p.id, { version: 2, ...project() }), () => f.store.addPanelSource(f.bob, p.id, source(2), crypto.randomUUID())]) assert.throws(read, errorCode('not_found'));
  assert.throws(() => f.store.getPanelProject({ ...f.alice, businessId: f.bob.businessId }, p.id), errorCode('unauthorized'));
});

test('source references must belong to the same saved project', async t => {
  const f = await fixture(t), p = f.store.createPanelProject(f.alice, project(), crypto.randomUUID()).project;
  const other = f.store.createPanelProject(f.alice, project({ name: 'Second' }), crypto.randomUUID()).project;
  const image = f.store.addPanelSource(f.alice, other.id, source(1), crypto.randomUUID());
  assert.throws(() => f.store.updatePanelProject(f.alice, p.id, { version: 1, ...project({ rows: [row({ sourceImageId: image.source.id })] }) }), errorCode('source_not_found'));
  assert.throws(() => f.store.createPanelProject(f.alice, project({ rows: [row({ sourceImageId: image.source.id })] }), crypto.randomUUID()), errorCode('source_not_found'));
});

test('private source bytes survive reload and caller mutation cannot change stored bytes', async t => {
  const f = await fixture(t), p = f.store.createPanelProject(f.alice, project(), crypto.randomUUID()).project;
  const result = f.store.addPanelSource(f.alice, p.id, source(1), crypto.randomUUID());
  assert.equal(result.project.version, 2);
  assert.equal(result.source.bytes, png().length);
  const fetched = f.store.getPanelSource(f.alice, p.id, result.source.id);
  assert.deepEqual(fetched.data, png()); fetched.data.fill(0);
  f.reopen();
  assert.deepEqual(f.store.getPanelSource(f.alice, p.id, result.source.id).data, png());
  assert.deepEqual(Object.keys(result.source).sort(), ['bytes', 'createdAt', 'height', 'id', 'mime', 'name', 'width']);
});

test('source retries stay idempotent after the project version changes', async t => {
  const f = await fixture(t), p = f.store.createPanelProject(f.alice, project(), crypto.randomUUID()).project, key = crypto.randomUUID();
  const first = f.store.addPanelSource(f.alice, p.id, source(1), key);
  const repeat = f.store.addPanelSource(f.alice, p.id, source(1), key);
  assert.equal(repeat.created, false);
  assert.deepEqual(repeat.project, first.project);
  assert.throws(() => f.store.addPanelSource(f.alice, p.id, source(2, { name: 'changed.png' }), key), errorCode('idempotency_conflict'));
  assert.throws(() => f.store.addPanelSource(f.alice, p.id, source(1), crypto.randomUUID()), errorCode('version_conflict'));
});

test('source count is bounded and a rejected sixth source does not change the project', async t => {
  const f = await fixture(t), p = f.store.createPanelProject(f.alice, project(), crypto.randomUUID()).project;
  let last = p;
  for (let i = 0; i < 5; i += 1) last = f.store.addPanelSource(f.alice, p.id, source(last.version, { name: 'sample-' + i + '.png' }), crypto.randomUUID()).project;
  assert.equal(last.sources.length, 5);
  assert.throws(() => f.store.addPanelSource(f.alice, p.id, source(last.version), crypto.randomUUID()), errorCode('source_limit'));
  assert.deepEqual(f.store.getPanelProject(f.alice, p.id), last);
});

test('invalid base64, MIME, paths, oversized and malformed source images are rejected', async t => {
  const f = await fixture(t), p = f.store.createPanelProject(f.alice, project(), crypto.randomUUID()).project;
  const invalid = [{ name: '../escape.png' }, { name: 'x\r\ny.png' }, { mime: 'image/svg+xml' }, { mime: 'image/jpeg' }, { dataBase64: png().toString('base64') + '\n' }, { dataBase64: 'not an image' }, { dataBase64: Buffer.from('<svg onload=evil()>').toString('base64') }, { dataBase64: Buffer.alloc(panels.MAX_IMAGE_BYTES + 1).toString('base64') }];
  for (const bad of invalid) assert.throws(() => f.store.addPanelSource(f.alice, p.id, source(1, bad), crypto.randomUUID()));
  assert.deepEqual(f.store.getPanelProject(f.alice, p.id), p);
});

test('project validation rejects unknown fields, broken Unicode and invalid row state', async t => {
  const f = await fixture(t);
  const invalid = [project({ name: '' }), project({ unknown: true }), project({ rows: [row({ quantity: 0 })] }), project({ rows: [row({ quantity: 1.2 })] }), project({ rows: [row({ quantity: 10000 })] }), project({ rows: [row({ reviewStatus: 'verified' })] }), project({ rows: [row({ partNumber: '', manufacturer: '', description: '' })] }), project({ rows: [row({ partNumber: '', reviewStatus: 'reviewed' })] }), project({ rows: [row({ notes: '\ud800' })] }), project({ rows: [row({ sourceImageId: '../secret' })] }), project({ rows: Array.from({ length: 201 }, () => row()) }), project({ rows: [row({ description: 'x'.repeat(1001) })] })];
  for (const input of invalid) assert.throws(() => f.store.createPanelProject(f.alice, input, crypto.randomUUID()), errorCode('invalid_input'));
  assert.deepEqual(f.store.listPanelProjects(f.alice), []);
});

test('an empty project is allowed and unreviewed rows can preserve missing core fields', async t => {
  const f = await fixture(t);
  const empty = f.store.createPanelProject(f.alice, project({ rows: [] }), crypto.randomUUID()).project;
  assert.deepEqual(empty.rows, []);
  const partial = f.store.updatePanelProject(f.alice, empty.id, { version: 1, ...project({ rows: [row({ partNumber: '', manufacturer: '', description: 'Unreadable model, inspect photo' })] }) });
  assert.equal(partial.rows[0].reviewStatus, 'unreviewed');
});

test('CSV has BOM, CRLF, proper quoting and exact saved corrected values', async t => {
  const f = await fixture(t);
  const p = f.store.createPanelProject(f.alice, project({ rows: [row({ description: 'Comma, quote " and\nnew line', notes: ' café Ω ', quantity: 12, reviewStatus: 'reviewed' })] }), crypto.randomUUID()).project;
  const csv = f.store.exportPanelProject(f.alice, p.id);
  assert.equal(csv.charCodeAt(0), 0xfeff);
  assert.match(csv, /"Description","Quantity","Source image","Review status","Notes"\r\n/);
  assert.match(csv, /"Comma, quote "" and\nnew line","12","","reviewed"," café Ω "\r\n$/);
});

test('CSV literalizes formulas even after whitespace, control and format characters', () => {
  for (const input of ['=1+1', '+SUM(A1)', '-1+2', '@SUM(A1)', ' \t\r\n=1', '\u0085=1', '\u200b=1', '\ufeff+1', '\u0000@evil']) assert.equal(panels.csvCell(input), '"\'' + input + '"');
  assert.equal(panels.csvCell('SYN-100'), '"SYN-100"');
  assert.equal(panels.csvCell('He said "hi"'), '"He said ""hi"""');
});

test('source filenames in CSV receive the same formula protection', async t => {
  const f = await fixture(t), p = f.store.createPanelProject(f.alice, project(), crypto.randomUUID()).project;
  const upload = f.store.addPanelSource(f.alice, p.id, source(1, { name: '=formula.png' }), crypto.randomUUID());
  f.store.updatePanelProject(f.alice, p.id, { version: 2, ...project({ rows: [row({ sourceImageId: upload.source.id })] }) });
  assert.match(f.store.exportPanelProject(f.alice, p.id), /"'=formula.png"/);
});

test('schema 1 migration preserves owner, intake, holds and sessions and adds only panel schema', async t => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'panelreply-migration-')), dataDir = path.join(base, 'legacy');
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const filename = makeLegacy(dataDir);
  const legacy = openStore({ dataDir, create: false });
  const owner = legacy.createBusinessOwner({ businessName: 'Legacy Synthetic Electric', username: 'legacy@example.test', passwordHash: await HASH });
  const lead = legacy.createLead(owner, { customerName: 'Fixture', phone: '+15865550101', job: 'Sparking outlet', zip: '48315', callbackWindow: '', requestedWorkDate: '', contactPermission: 'opted_out', conversation: [] }, crypto.randomUUID()).lead;
  legacy.createSession(owner.id, digest('migration-session'));
  legacy.close();
  let db = new DatabaseSync(filename); assert.equal(assertWorkspaceSchema(db), 1); db.close();
  const migrated = openStore({ dataDir });
  try {
    assert.deepEqual(migrated.getLead(owner, lead.id), lead);
    assert.equal(migrated.findUser(owner.username).password_hash, await HASH);
    assert.deepEqual(migrated.session(digest('migration-session')), owner);
    assert.deepEqual(migrated.listPanelProjects(owner), []);
  } finally { migrated.close(); }
  db = new DatabaseSync(filename); assert.equal(assertWorkspaceSchema(db), 2); db.close();
});

test('startup rejects a forged schema 1 before migration or modifying records', async t => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'panelreply-forged-panels-')), dataDir = path.join(base, 'legacy');
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const filename = makeLegacy(dataDir), db = new DatabaseSync(filename);
  db.exec('CREATE VIEW unexpected AS SELECT id FROM users'); db.close();
  const before = fs.readFileSync(filename);
  assert.throws(() => openStore({ dataDir }), errorCode('unsupported_schema'));
  assert.deepEqual(fs.readFileSync(filename), before);
});

test('schema 2 validates exact constraints and refuses a cross-business source link', async t => {
  const f = await fixture(t), p = f.store.createPanelProject(f.alice, project(), crypto.randomUUID()).project;
  const upload = f.store.addPanelSource(f.alice, p.id, source(1), crypto.randomUUID());
  const db = new DatabaseSync(f.store.filename);
  try {
    assert.equal(assertWorkspaceSchema(db), 2);
    assert.throws(() => db.prepare('UPDATE panel_sources SET business_id=? WHERE id=?').run(f.bob.businessId, upload.source.id), /FOREIGN KEY/);
  } finally { db.close(); }
});

test('encrypted schema 2 backup preserves projects and source bytes and disables restored credentials', async t => {
  const f = await fixture(t), key = crypto.randomUUID(), p = f.store.createPanelProject(f.alice, project(), key).project;
  const uploaded = f.store.addPanelSource(f.alice, p.id, source(1), crypto.randomUUID());
  const saved = f.store.updatePanelProject(f.alice, p.id, { version: 2, ...project({ rows: [row({ sourceImageId: uploaded.source.id, reviewStatus: 'reviewed', partNumber: 'Corrected-77' })] }) });
  f.store.createSession(f.alice.id, digest('backup-panel-session'));
  const archive = path.join(f.base, 'panels.prbk'), restoredDir = path.join(f.base, 'restored');
  const created = await createEncryptedBackup({ dataDir: f.dataDir, outputFile: archive, passphrase: PASSPHRASE });
  assert.equal(created.schemaVersion, 2); assert.equal(created.counts.panelProjects, 1); assert.equal(created.counts.panelSources, 1);
  assert.equal(fs.readFileSync(archive).readUInt16BE(10), 2);
  const result = await restoreEncryptedBackup({ backupFile: archive, dataDir: restoredDir, passphrase: PASSPHRASE });
  assert.equal(result.schemaVersion, 2); assert.equal(result.passwordResetRequired, true);
  const restored = openStore({ dataDir: restoredDir, create: false });
  try {
    assert.deepEqual(restored.getPanelProject(f.alice, p.id), saved);
    assert.deepEqual(restored.getPanelSource(f.alice, p.id, uploaded.source.id).data, png());
    assert.equal(restored.session(digest('backup-panel-session')), null);
    assert.equal(restored.findUser(f.alice.username).password_hash, RESTORE_DISABLED_PASSWORD);
    assert.throws(() => restored.getPanelProject(f.bob, p.id), errorCode('not_found'));
    assert.equal(restored.createPanelProject(f.alice, project(), key).created, false);
    restored.resetOwnerPassword({ username: f.alice.username, passwordHash: await HASH });
    const auth = createAuth(restored); assert.equal((await auth.login({ username: f.alice.username, password: PASSWORD })).user.id, f.alice.id);
    assert.deepEqual(restored.getPanelProject(f.alice, p.id), saved);
  } finally { restored.close(); }
  assert.deepEqual(f.store.getPanelProject(f.alice, p.id), saved);
  assert.deepEqual(f.store.getPanelSource(f.alice, p.id, uploaded.source.id).data, png());
  assert.equal(f.store.findUser(f.alice.username).password_hash, await HASH);
  assert.equal(f.store.session(digest('backup-panel-session')).id, f.alice.id);
});

test('schema 1 archives restore without migration and later startup upgrades safely', async t => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'panelreply-old-archive-')), dataDir = path.join(base, 'legacy');
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  makeLegacy(dataDir);
  const legacy = openStore({ dataDir, create: false });
  const owner = legacy.createBusinessOwner({ businessName: 'Legacy Electric', username: 'old-owner@example.test', passwordHash: await HASH });
  const expected = legacy.getProfile(owner); legacy.close();
  const archive = path.join(base, 'old.prbk'), target = path.join(base, 'restored');
  const created = await createEncryptedBackup({ dataDir, outputFile: archive, passphrase: PASSPHRASE });
  assert.equal(created.schemaVersion, 1); assert.equal(created.counts.panelProjects, undefined);
  const result = await restoreEncryptedBackup({ backupFile: archive, dataDir: target, passphrase: PASSPHRASE });
  assert.equal(result.schemaVersion, 1);
  let db = new DatabaseSync(path.join(target, 'workspace.sqlite')); assert.equal(assertWorkspaceSchema(db), 1); db.close();
  const recovery = openStore({ dataDir: target, create: false });
  assert.deepEqual(recovery.getProfile(owner), expected); recovery.close();
  const migrated = openStore({ dataDir: target });
  assert.deepEqual(migrated.getProfile(owner), expected); assert.deepEqual(migrated.listPanelProjects(owner), []); migrated.close();
  db = new DatabaseSync(path.join(target, 'workspace.sqlite')); assert.equal(assertWorkspaceSchema(db), 2); db.close();
});

test('backup validation rejects altered image bytes and dangling row source references', async t => {
  const f = await fixture(t), p = f.store.createPanelProject(f.alice, project(), crypto.randomUUID()).project;
  const upload = f.store.addPanelSource(f.alice, p.id, source(1), crypto.randomUUID());
  const db = new DatabaseSync(f.store.filename);
  try {
    db.prepare('UPDATE panel_sources SET bytes=? WHERE id=?').run(Buffer.from('invalid'), upload.source.id);
    assert.throws(() => validateDatabase(db), errorCode('invalid_database'));
    db.prepare('UPDATE panel_sources SET bytes=? WHERE id=?').run(png(), upload.source.id);
    db.prepare('UPDATE panel_projects SET rows_json=? WHERE id=?').run(JSON.stringify([row({ sourceImageId: crypto.randomUUID() })]), p.id);
    assert.throws(() => validateDatabase(db), errorCode('invalid_database'));
    db.prepare('UPDATE panel_projects SET rows_json=? WHERE id=?').run(JSON.stringify([row()]), p.id);
    db.exec('PRAGMA foreign_keys=OFF');
    db.prepare('UPDATE panel_sources SET business_id=? WHERE id=?').run(f.bob.businessId, upload.source.id);
    assert.throws(() => validateDatabase(db), errorCode('invalid_database'));
  } finally { db.close(); }
});

test('panel writes roll back when the audit insertion fails', async t => {
  const f = await fixture(t), p = f.store.createPanelProject(f.alice, project(), crypto.randomUUID()).project;
  const db = new DatabaseSync(f.store.filename);
  try {
    db.exec("CREATE TRIGGER fail_panel_audit BEFORE INSERT ON audit BEGIN SELECT RAISE(ABORT, 'fixture failure'); END");
    assert.throws(() => f.store.updatePanelProject(f.alice, p.id, { version: 1, ...project({ notes: 'Do not retain' }) }), /fixture failure/);
    assert.throws(() => f.store.addPanelSource(f.alice, p.id, source(1), crypto.randomUUID()), /fixture failure/);
    assert.deepEqual(f.store.getPanelProject(f.alice, p.id), p);
  } finally { db.exec('DROP TRIGGER fail_panel_audit'); db.close(); }
});

test('project count limit rejects only a new create and still permits an idempotent retry', async t => {
  const f = await fixture(t), key = crypto.randomUUID(), input = project({ rows: [] });
  const first = f.store.createPanelProject(f.alice, input, key).project;
  for (let i = 1; i < panels.MAX_PROJECTS_PER_BUSINESS; i += 1) f.store.createPanelProject(f.alice, input, crypto.randomUUID());
  assert.throws(() => f.store.createPanelProject(f.alice, input, crypto.randomUUID()), errorCode('project_limit'));
  const retry = f.store.createPanelProject(f.alice, input, key);
  assert.equal(retry.created, false); assert.equal(retry.project.id, first.id);
  assert.equal(f.store.listPanelProjects(f.alice).length, 200);
  assert.equal(f.store.createPanelProject(f.bob, input, crypto.randomUUID()).created, true);
});

test('global panel payload quota bounds valid UTF-8 data without partial writes', async t => {
  const f = await fixture(t);
  const input = project({ rows: Array.from({ length: 200 }, () => row({ partNumber: '界'.repeat(128), manufacturer: '界'.repeat(120), description: '界'.repeat(1000), notes: '界'.repeat(1000) })) });
  let accepted = 0;
  for (;;) {
    try { f.store.createPanelProject(f.alice, input, crypto.randomUUID()); accepted += 1; }
    catch (error) { assert.equal(error.code, 'panel_storage_limit'); break; }
    assert.ok(accepted < 30, 'the byte quota must stop valid large records');
  }
  const payloadBytes = Buffer.byteLength(input.name) + Buffer.byteLength(input.notes) + Buffer.byteLength(JSON.stringify(input.rows));
  assert.ok(accepted * payloadBytes <= panels.MAX_PANEL_DATA_BYTES);
  assert.ok((accepted + 1) * payloadBytes > panels.MAX_PANEL_DATA_BYTES);
  assert.equal(f.store.listPanelProjects(f.alice).length, accepted);
  assert.throws(() => f.store.createPanelProject(f.bob, input, crypto.randomUUID()), errorCode('panel_storage_limit'));
  assert.deepEqual(f.store.listPanelProjects(f.bob), []);
});

test('an authenticated archive with a mismatched declared schema cannot publish a restored database', async t => {
  const f = await fixture(t), archive = path.join(f.base, 'mismatched.prbk'), target = path.join(f.base, 'restore');
  await createEncryptedBackup({ dataDir: f.dataDir, outputFile: archive, passphrase: PASSPHRASE });
  const original = fs.readFileSync(archive), header = Buffer.from(original.subarray(0, HEADER_BYTES));
  const key = crypto.scryptSync(PASSPHRASE, header.subarray(32, 48), 32, { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 });
  const decrypt = crypto.createDecipheriv('aes-256-gcm', key, header.subarray(48, 60), { authTagLength: TAG_BYTES });
  decrypt.setAAD(header); decrypt.setAuthTag(original.subarray(original.length - TAG_BYTES));
  const plaintext = Buffer.concat([decrypt.update(original.subarray(HEADER_BYTES, original.length - TAG_BYTES)), decrypt.final()]);
  header.writeUInt16BE(1, 10); // Supported header, but the actual database remains schema 2.
  crypto.randomBytes(12).copy(header, 48);
  const encrypt = crypto.createCipheriv('aes-256-gcm', key, header.subarray(48, 60), { authTagLength: TAG_BYTES });
  encrypt.setAAD(header);
  fs.writeFileSync(archive, Buffer.concat([header, encrypt.update(plaintext), encrypt.final(), encrypt.getAuthTag()]));
  key.fill(0); plaintext.fill(0);
  await assert.rejects(restoreEncryptedBackup({ backupFile: archive, dataDir: target, passphrase: PASSPHRASE }), errorCode('invalid_archive'));
  assert.equal(fs.existsSync(target), false);
  assert.equal(fs.readdirSync(f.base).some(name => name.startsWith('.panelreply-recovery-')), false);
  assert.equal(f.store.findUser(f.alice.username).password_hash, await HASH);
});
