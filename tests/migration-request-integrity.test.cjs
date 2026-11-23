'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { openStore, SCHEMAS, SCHEMA_VERSION } = require('../workspace/store.cjs');
const { hashPassword } = require('../workspace/auth.cjs');
const { validateDatabase, createEncryptedBackup, restoreEncryptedBackup } = require('../workspace/backup.cjs');

const START = Date.parse('2026-11-23T15:00:00.000Z');
const MAX_TIME = 8640000000000000;
const MAX_REVISION = Number.MAX_SAFE_INTEGER;
const PASSWORD_HASH = hashPassword('Synthetic migration integrity password 2026!');
const PASSPHRASE = 'Synthetic legacy recovery archive passphrase 2026!';
const INPUT = { customerName: 'Synthetic migration customer', phone: '+15865550101', job: 'Replace a garage outlet', zip: '48315', callbackWindow: 'After four', requestedWorkDate: 'Next week', contactPermission: 'requested_callback', conversation: [{ role: 'customer', text: 'Please call about the outlet.' }] };
const PANEL = { name: 'Retain spreadsheet history', notes: 'Original note Ω', rows: [{ partNumber: '', manufacturer: '', description: 'Unknown label retained', quantity: 1, reviewStatus: 'unreviewed', sourceImageId: null, notes: '' }] };
const key = () => crypto.randomUUID();

function inspect(filename, action) {
  const db = new DatabaseSync(filename, { enableForeignKeyConstraints: true });
  try { return action(db); } finally { db.close(); }
}
function snapshot(filename) {
  return inspect(filename, db => {
    const version = db.prepare('PRAGMA user_version').get().user_version;
    return { version, schema: db.prepare('SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name').all(),
      records: Object.fromEntries(Object.keys(SCHEMAS[version].tables).map(table => [table, db.prepare('SELECT * FROM ' + table + ' ORDER BY rowid').all()])) };
  });
}
async function fixture(t, schemaVersion = 2) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'panelreply-migration-integrity-'));
  const dataDir = path.join(root, 'data'), filename = path.join(dataDir, 'workspace.sqlite');
  fs.mkdirSync(dataDir, { mode: 0o700 }); fs.writeFileSync(filename, '', { mode: 0o600 });
  inspect(filename, db => db.exec([...Object.values(SCHEMAS[schemaVersion].tables), ...Object.values(SCHEMAS[schemaVersion].indexes), 'PRAGMA user_version=' + schemaVersion].join(';\n') + ';'));
  let time = START, current = openStore({ dataDir, create: false, now: () => time });
  const close = () => { if (current) { current.close(); current = null; } };
  t.after(() => { close(); fs.rmSync(root, { recursive: true, force: true }); });
  const owner = current.createBusinessOwner({ businessName: 'Synthetic migration account', username: 'migration@example.test', passwordHash: await PASSWORD_HASH });
  const held = current.createLead(owner, { ...INPUT, job: 'The outlet is sparking.' }, key()).lead;
  const ordinary = current.createLead(owner, INPUT, key()).lead;
  const panel = current.createPanelProject(owner, PANEL, key()).project;
  return { root, dataDir, filename, owner, held, ordinary, panel, get store() { return current; },
    setTime(value) { time = value; }, close,
    open({ create = false, now = () => time } = {}) { close(); current = openStore({ dataDir, create, now }); return current; },
    migrate(value = START + 1000) { time = value; return this.open({ create: true }); },
    db(action) { return inspect(filename, action); }, snapshot() { return snapshot(filename); },
    validate() { return inspect(filename, validateDatabase); },
    version(id, value) { inspect(filename, db => db.prepare('UPDATE leads SET version=? WHERE id=?').run(value, id)); }
  };
}
function unchanged(f, before) {
  // WAL mode and connection pragmas may change during startup. This checks the
  // schema, schema version and all logical records, not database-file bytes.
  assert.deepEqual(f.snapshot(), before);
  assert.doesNotThrow(() => f.validate());
}

test('legacy safety propagation rejects a one-second rollback before DDL or saved history changes', async t => {
  const f = await fixture(t), before = f.snapshot(); f.validate();
  assert.equal(f.ordinary.safetyHold, false);
  assert.throws(() => f.migrate(START - 1000), { code: 'clock_unavailable', status: 503 });
  unchanged(f, before);
  const legacy = f.open();
  assert.deepEqual(legacy.getLead(f.owner, f.ordinary.id), f.ordinary);
  assert.deepEqual(legacy.getPanelProject(f.owner, f.panel.id), f.panel);
});

test('legacy safety propagation cannot move a later saved correction backwards even after creation time', async t => {
  const f = await fixture(t);
  f.setTime(START + 2000);
  const corrected = f.store.updateLead(f.owner, f.ordinary.id, { version: f.ordinary.version, status: 'new', notes: 'Keep this later correction Ω' });
  const before = f.snapshot(); f.validate();
  assert.throws(() => f.migrate(START + 1000), { code: 'clock_unavailable', status: 503 });
  unchanged(f, before);
  assert.deepEqual(f.open().getLead(f.owner, corrected.id), corrected);
});

test('legacy safety propagation rejects terminal affected revisions without invalidating their saved recovery state', async t => {
  for (const version of [MAX_REVISION, MAX_REVISION - 1]) {
    const f = await fixture(t);
    f.version(f.ordinary.id, version); f.validate();
    const saved = f.store.getLead(f.owner, f.ordinary.id), before = f.snapshot();
    assert.throws(() => f.migrate(), { code: 'version_exhausted', status: 409 });
    unchanged(f, before);
    assert.deepEqual(f.open().getLead(f.owner, saved.id), saved);
  }
});

test('migration preflights every propagation target before changing earlier requests, restrictions, audit or schema', async t => {
  const f = await fixture(t);
  const later = f.store.createLead(f.owner, INPUT, key()).lead;
  const other = f.store.createBusinessOwner({ businessName: 'Other synthetic account', username: 'other@example.test', passwordHash: await PASSWORD_HASH });
  const otherLead = f.store.createLead(other, INPUT, key()).lead;
  f.version(later.id, MAX_REVISION);
  const before = f.snapshot(); f.validate();
  assert.throws(() => f.migrate(), { code: 'version_exhausted', status: 409 });
  unchanged(f, before);
  assert.equal(f.snapshot().schema.some(item => item.name === 'safety_holds'), false);
  const legacy = f.open();
  assert.deepEqual(legacy.getLead(f.owner, f.ordinary.id), f.ordinary);
  assert.deepEqual(legacy.getLead(other, otherLead.id), otherLead);
});

test('valid migration permits the last live increment and retains unaffected terminal records and idempotent reopen', async t => {
  const f = await fixture(t);
  const unrelated = f.store.createLead(f.owner, { ...INPUT, phone: '+12485550112' }, key()).lead;
  f.version(f.held.id, MAX_REVISION); f.version(unrelated.id, MAX_REVISION); f.version(f.ordinary.id, MAX_REVISION - 2);
  const held = f.store.getLead(f.owner, f.held.id), untouched = f.store.getLead(f.owner, unrelated.id);
  const before = f.snapshot(); f.validate();
  const store = f.migrate();
  assert.equal(f.snapshot().version, SCHEMA_VERSION);
  assert.deepEqual(store.getLead(f.owner, held.id), held);
  assert.deepEqual(store.getLead(f.owner, untouched.id), untouched);
  assert.deepEqual(store.getPanelProject(f.owner, f.panel.id), f.panel);
  const updated = store.getLead(f.owner, f.ordinary.id);
  assert.equal(updated.version, MAX_REVISION - 1); assert.equal(updated.safetyHold, true);
  assert.equal(updated.status, 'needs_review'); assert.equal(updated.contactAllowed, false);
  assert.equal(updated.updatedAt, new Date(START + 1000).toISOString());
  for (const field of ['customerName', 'phone', 'job', 'zip', 'callbackWindow', 'requestedWorkDate', 'notes', 'conversation', 'createdAt']) assert.deepEqual(updated[field], f.ordinary[field]);
  assert.deepEqual(updated.audit.slice(0, -1), f.ordinary.audit);
  assert.equal(updated.audit.at(-1).details.source, 'migration');
  const after = f.snapshot();
  for (const table of Object.keys(before.records).filter(table => !['leads', 'audit'].includes(table))) assert.deepEqual(after.records[table], before.records[table]);
  assert.deepEqual(after.records.audit.slice(0, before.records.audit.length), before.records.audit);
  assert.equal(after.records.audit.length, before.records.audit.length + 1);
  f.validate();
  f.open({ create: true, now: () => { throw new Error('A current-schema reopen must not run migration clock or history writes.'); } });
  assert.deepEqual(f.snapshot(), after);
  assert.deepEqual(f.store.getLead(f.owner, updated.id), updated);
});

test('schema-three migration preserves existing sticky hold digests and terminal history without propagating twice', async t => {
  const f = await fixture(t, 3);
  f.store.holdPhone(f.owner, '+12485550112');
  f.version(f.ordinary.id, MAX_REVISION);
  const saved = f.store.getLead(f.owner, f.ordinary.id), before = f.snapshot(); f.validate();
  assert.equal(before.records.safety_holds.length, 2);
  const store = f.migrate();
  const after = f.snapshot();
  assert.equal(after.version, SCHEMA_VERSION);
  for (const [table, records] of Object.entries(before.records)) assert.deepEqual(after.records[table], records);
  assert.deepEqual(store.getLead(f.owner, saved.id), saved);
  assert.equal(store.isSafetyHeld(f.owner, '+12485550112'), true);
  f.validate();
  f.open({ create: true, now: () => { throw new Error('Migration must not run twice.'); } });
  assert.deepEqual(f.snapshot(), after);
});

test('a rejected legacy migration remains backup-restorable and can propagate safely after clock recovery', async t => {
  const f = await fixture(t), before = f.snapshot();
  assert.throws(() => f.migrate(START - 1000), { code: 'clock_unavailable', status: 503 });
  unchanged(f, before);
  const archive = path.join(f.root, 'legacy.prbk'), destination = path.join(f.root, 'restored');
  const created = await createEncryptedBackup({ dataDir: f.dataDir, outputFile: archive, passphrase: PASSPHRASE });
  const restored = await restoreEncryptedBackup({ backupFile: archive, dataDir: destination, passphrase: PASSPHRASE });
  assert.equal(created.schemaVersion, 2); assert.equal(restored.schemaVersion, 2);
  let copy = openStore({ dataDir: destination, create: false });
  try {
    assert.deepEqual(copy.getLead(f.owner, f.ordinary.id), f.ordinary);
    assert.deepEqual(copy.getPanelProject(f.owner, f.panel.id), f.panel);
    copy.close(); copy = openStore({ dataDir: destination, now: () => START + 1000 });
    const updated = copy.getLead(f.owner, f.ordinary.id);
    assert.equal(updated.version, f.ordinary.version + 1);
    assert.equal(updated.safetyHold, true); assert.equal(updated.contactAllowed, false);
    assert.deepEqual(updated.conversation, f.ordinary.conversation);
    assert.deepEqual(updated.audit.slice(0, -1), f.ordinary.audit);
    inspect(copy.filename, validateDatabase);
  } finally { copy.close(); }
  unchanged(f, before);
});

test('migration rejects unavailable clocks with controlled errors and unchanged valid legacy records', async t => {
  const f = await fixture(t), before = f.snapshot();
  for (const time of [-1, 0.5, NaN, Infinity, MAX_TIME + 1]) {
    assert.throws(() => f.migrate(time), { code: 'clock_unavailable', status: 503 });
    unchanged(f, before);
  }
});
