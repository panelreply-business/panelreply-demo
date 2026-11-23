'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { Readable } = require('node:stream');
const { spawnSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const { openStore, digest } = require('../workspace/store.cjs');
const { hashPassword, createAuth } = require('../workspace/auth.cjs');
const { createEncryptedBackup, restoreEncryptedBackup, validateDatabase, BackupError, MAX_DATABASE_BYTES, MAX_ARCHIVE_BYTES, HEADER_BYTES, TAG_BYTES, RESTORE_DISABLED_PASSWORD } = require('../workspace/backup.cjs');
const { SYNTHETIC_POLICY, INPUT_BYTES } = require('../workspace/usage.cjs');
const { parseArgs, readPassphrase } = require('../scripts/workspace-backup.cjs');
const resetPassword = require('../scripts/workspace-reset-password.cjs');

const PASSWORD = 'Synthetic-owner-password-2026!';
const NEW_PASSWORD = 'Replacement-synthetic-password-2026!';
const PASSPHRASE = 'Synthetic-backup-passphrase-2026!';
const PASSWORD_HASH = hashPassword(PASSWORD);
const TABLES = ['businesses', 'users', 'sessions', 'login_attempts', 'leads', 'messages', 'audit', 'suppression', 'panel_projects', 'panel_sources', 'record_deletions', 'deletion_operations', 'safety_holds', 'assistant_usage', 'callback_tasks', 'callback_operations'];

function request(overrides = {}) {
  return { customerName: 'Jamie Backup Fixture', phone: '+15865550101', job: 'Install a garage EV charger', zip: '48315', callbackWindow: 'Monday after 4 pm', requestedWorkDate: 'Friday', contactPermission: 'requested_callback', conversation: [{ role: 'customer', text: 'Please call me Monday about an EV charger.' }], ...overrides };
}
function failure(code) { return error => error instanceof BackupError && (!code || error.code === code); }
function snapshots(filename) {
  const db = new DatabaseSync(filename, { readOnly: true });
  try { return Object.fromEntries(TABLES.map(table => [table, db.prepare('SELECT * FROM ' + table + ' ORDER BY rowid').all().map(row => ({ ...row }))])); }
  finally { db.close(); }
}
async function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'panelreply-backup-'));
  const source = path.join(directory, 'source');
  fs.mkdirSync(source, { mode: 0o700 });
  let store = openStore({ dataDir: source });
  const alice = store.createBusinessOwner({ businessName: 'Recovery Fixture Electric', username: 'alice@example.test', passwordHash: await PASSWORD_HASH });
  const bob = store.createBusinessOwner({ businessName: 'Other Fixture Electric', username: 'bob@example.test', passwordHash: await PASSWORD_HASH });
  const profile = store.getProfile(alice);
  profile.facts.hours = { verified: true, answer: 'Weekdays from 8 am to 4 pm.' };
  store.updateProfile(alice, { version: profile.version, businessName: profile.business.name, facts: profile.facts });
  const key = crypto.randomUUID();
  const first = store.createLead(alice, request(), key).lead;
  store.updateLead(alice, first.id, { version: 1, status: 'new', notes: 'Synthetic note retained through recovery.' });
  store.suppressPhone(alice, first.phone);
  store.createLead(alice, request({ customerName: 'Safety Fixture', phone: '+12485550144', conversation: [{ role: 'customer', text: 'The outlet is sparking.' }] }), crypto.randomUUID());
  store.createLead(bob, request({ customerName: 'Other Business Fixture' }), crypto.randomUUID());
  const auth = createAuth(store);
  const session = await auth.login({ username: alice.username, password: PASSWORD });
  store.consumeLoginAttempt('fixture-throttle', 5);
  const archives = path.join(directory, 'archives');
  fs.mkdirSync(archives, { mode: 0o700 });
  const archive = path.join(archives, 'backup.prbk');
  const restored = path.join(directory, 'restored');
  t.after(() => { store?.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  return { directory, source, archives, archive, restored, alice, bob, key, session, get store() { return store; }, close() { store?.close(); store = null; } };
}

async function create(f, changes = {}) { return createEncryptedBackup({ dataDir: f.source, outputFile: f.archive, passphrase: PASSPHRASE, ...changes }); }
async function restore(f, changes = {}) { return restoreEncryptedBackup({ backupFile: f.archive, dataDir: f.restored, passphrase: PASSPHRASE, ...changes }); }
function temporaryNames(parent) { return fs.readdirSync(parent).filter(name => name.startsWith('.panelreply-recovery-')); }

// Create an authenticated but invalid fixture payload, to test validation after
// authentication. Fresh salt/nonce are used for every synthetic re-encryption.
function rewriteAuthenticatedArchive(f, mutate) {
  const bytes = fs.readFileSync(f.archive);
  const header = Buffer.from(bytes.subarray(0, HEADER_BYTES));
  const options = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };
  const key = crypto.scryptSync(PASSPHRASE, header.subarray(32, 48), 32, options);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, header.subarray(48, 60), { authTagLength: TAG_BYTES });
  decipher.setAAD(header); decipher.setAuthTag(bytes.subarray(bytes.length - TAG_BYTES));
  const plaintext = Buffer.concat([decipher.update(bytes.subarray(HEADER_BYTES, bytes.length - TAG_BYTES)), decipher.final()]);
  const file = path.join(f.directory, 'fixture-rewrite.sqlite');
  fs.writeFileSync(file, plaintext, { flag: 'wx', mode: 0o600 });
  const db = new DatabaseSync(file);
  try { mutate(db); } finally { db.close(); }
  const replacement = fs.readFileSync(file);
  fs.unlinkSync(file);
  header.writeBigUInt64BE(BigInt(replacement.length), 24);
  crypto.randomBytes(16).copy(header, 32); crypto.randomBytes(12).copy(header, 48);
  const replacementKey = crypto.scryptSync(PASSPHRASE, header.subarray(32, 48), 32, options);
  const cipher = crypto.createCipheriv('aes-256-gcm', replacementKey, header.subarray(48, 60), { authTagLength: TAG_BYTES });
  cipher.setAAD(header);
  const encrypted = Buffer.concat([cipher.update(replacement), cipher.final()]);
  fs.writeFileSync(f.archive, Buffer.concat([header, encrypted, cipher.getAuthTag()]));
  key.fill(0); replacementKey.fill(0); plaintext.fill(0); replacement.fill(0);
}

test('encrypted restore preserves pending, failed and succeeded usage without refunding reservations', async t => {
  const f = await fixture(t), input = { inputBytes: 512, outputTokenLimit: 2048 };
  const policy = { ...SYNTHETIC_POLICY, perAttemptReserveMicros: 5, dailyReserveLimitMicros: 20, lifetimeReserveLimitMicros: 25 };
  const pendingHash = digest('synthetic pending attempt');
  const pending = f.store.reserveAssistantUsage(f.alice, pendingHash, input, policy);
  const failed = f.store.reserveAssistantUsage(f.alice, digest('synthetic failed attempt'), input, policy);
  f.store.finishAssistantUsage(f.alice, failed.id, 'failed');
  const succeeded = f.store.reserveAssistantUsage(f.bob, digest('synthetic successful attempt'), input, policy);
  f.store.finishAssistantUsage(f.bob, succeeded.id, 'succeeded');
  const before = snapshots(f.store.filename);
  const archived = await create(f); assert.equal(archived.counts.assistantUsage, 3);
  const restoredResult = await restore(f); assert.equal(restoredResult.counts.assistantUsage, 3);
  let recovered = openStore({ dataDir: f.restored, create: false });
  try {
    assert.deepEqual(snapshots(recovered.filename).assistant_usage, before.assistant_usage);
    recovered.close(); recovered = openStore({ dataDir: f.restored, create: false });
    assert.deepEqual(snapshots(recovered.filename).assistant_usage, before.assistant_usage);
    assert.deepEqual(recovered.getAssistantUsage(f.alice).statuses, { failed: 1, pending: 1 });
    assert.equal(recovered.getAssistantUsage(f.alice).lifetimeAttempts, 2); assert.equal(recovered.getAssistantUsage(f.alice).lifetimeReservedMicros, 10);
    assert.deepEqual(recovered.getAssistantUsage(f.bob).statuses, { succeeded: 1 }); assert.equal(recovered.getAssistantUsage(f.bob).lifetimeReservedMicros, 5);
    assert.throws(() => recovered.reserveAssistantUsage(f.alice, pendingHash, input, policy), { code: 'assistant_attempt_recorded' });
    assert.throws(() => recovered.finishAssistantUsage(f.bob, pending.id, 'succeeded'), { code: 'assistant_usage_not_found' });
    assert.deepEqual(snapshots(recovered.filename).assistant_usage, before.assistant_usage);
    assert.equal(recovered.findUser(f.alice.username).password_hash, RESTORE_DISABLED_PASSWORD);
  } finally { recovered.close(); }
  assert.deepEqual(snapshots(f.store.filename), before);
});

test('backup record validation rejects malformed or cross-business usage metadata', async t => {
  const f = await fixture(t);
  f.store.reserveAssistantUsage(f.alice, digest('synthetic validation attempt'), { inputBytes: 512, outputTokenLimit: 2048 }, SYNTHETIC_POLICY);
  const before = snapshots(f.store.filename), db = new DatabaseSync(f.store.filename);
  const mutations = [
    () => db.prepare('UPDATE assistant_usage SET actor_id=?').run(f.bob.id),
    () => db.prepare("UPDATE assistant_usage SET id='invalid-id'").run(),
    () => db.prepare("UPDATE assistant_usage SET request_hash='untrusted text'").run(),
    () => db.prepare("UPDATE assistant_usage SET status='refunded'").run(),
    () => db.prepare('UPDATE assistant_usage SET input_bytes=0').run(),
    () => db.prepare('UPDATE assistant_usage SET input_bytes=?').run(INPUT_BYTES + 1),
    () => db.prepare('UPDATE assistant_usage SET output_token_limit=999999').run(),
    () => db.prepare('UPDATE assistant_usage SET reserved_micros=-1').run(),
    () => db.prepare('UPDATE assistant_usage SET reserved_micros=1000000001').run(),
    () => db.prepare('UPDATE assistant_usage SET created_at=-1').run(),
    () => db.prepare('UPDATE assistant_usage SET expires_at=created_at+60001').run(),
    () => db.prepare('UPDATE assistant_usage SET finished_at=created_at').run(),
    () => db.prepare("UPDATE assistant_usage SET status='failed'").run(),
    () => db.prepare("UPDATE assistant_usage SET status='failed',finished_at=created_at-1").run()
  ];
  try {
    for (const mutate of mutations) { db.exec('BEGIN'); try { mutate(); assert.throws(() => validateDatabase(db), failure('invalid_database')); } finally { db.exec('ROLLBACK'); } }
  } finally { db.close(); }
  assert.deepEqual(snapshots(f.store.filename), before);
});

test('authenticated archives with invalid usage metadata cannot publish a restored database', async t => {
  const f = await fixture(t);
  f.store.reserveAssistantUsage(f.alice, digest('synthetic authenticated archive attempt'), { inputBytes: 512, outputTokenLimit: 2048 }, SYNTHETIC_POLICY);
  const before = snapshots(f.store.filename);
  await create(f); const originalArchive = fs.readFileSync(f.archive);
  const mutations = [
    db => db.prepare('UPDATE assistant_usage SET actor_id=?').run(f.bob.id),
    db => db.prepare("UPDATE assistant_usage SET status='failed'").run(),
    db => db.prepare('UPDATE assistant_usage SET reserved_micros=-1').run(),
    db => db.prepare('UPDATE assistant_usage SET expires_at=created_at').run()
  ];
  for (const mutate of mutations) {
    fs.writeFileSync(f.archive, originalArchive); rewriteAuthenticatedArchive(f, mutate);
    await assert.rejects(restore(f), failure('invalid_database'));
    assert.equal(fs.existsSync(f.restored), false); assert.deepEqual(temporaryNames(f.directory), []);
    assert.deepEqual(snapshots(f.store.filename), before);
  }
});

test('encrypted backup roundtrip preserves tenant records, opt-outs, holds and idempotency', async t => {
  const f = await fixture(t);
  const expectedAlice = f.store.listLeads(f.alice), expectedBob = f.store.listLeads(f.bob), expectedProfile = f.store.getProfile(f.alice);
  const created = await create(f);
  assert.equal(created.format, 'panelreply-encrypted-backup');
  assert.equal(created.sessionsIncluded, false);
  assert.deepEqual(created.counts, { businesses: 2, users: 2, leads: 3, messages: 3, audit: 7, optOuts: 1, panelProjects: 0, panelSources: 0, deletedRecords: 0, deletionOperations: 0, safetyHolds: 1, assistantUsage: 0, callbackTasks: 0, callbackOperations: 0 });
  const result = await restore(f);
  assert.deepEqual(result.counts, created.counts);
  assert.equal(result.passwordResetRequired, true);
  assert.equal(result.ownersRequiringReset, 2);
  const restored = openStore({ dataDir: f.restored, create: false });
  try {
    assert.deepEqual(restored.getProfile(f.alice), expectedProfile);
    assert.deepEqual(restored.listLeads(f.alice), expectedAlice);
    assert.deepEqual(restored.listLeads(f.bob), expectedBob);
    assert.throws(() => restored.getLead(f.bob, expectedAlice[0].id), error => error.code === 'not_found');
    assert.equal(restored.createLead(f.alice, request(), f.key).created, false);
    assert.equal(restored.listLeads(f.alice).length, 2);
    assert.equal(restored.isSuppressed(f.alice, request().phone), true);
    assert.equal(restored.isSuppressed(f.bob, request().phone), false);
    assert.equal(restored.listLeads(f.alice).find(lead => lead.customerName === 'Safety Fixture').safetyHold, true);
  } finally { restored.close(); }
});

test('backup snapshot includes committed WAL contents while leaving source sessions and data unchanged', async t => {
  const f = await fixture(t);
  assert.ok(fs.statSync(path.join(f.source, 'workspace.sqlite-wal')).size > 0);
  const before = snapshots(f.store.filename);
  await create(f);
  assert.deepEqual(snapshots(f.store.filename), before);
  await restore(f);
  assert.deepEqual(snapshots(f.store.filename), before);
  const recovered = snapshots(path.join(f.restored, 'workspace.sqlite'));
  for (const table of ['businesses', 'leads', 'messages', 'audit', 'suppression']) assert.deepEqual(recovered[table], before[table]);
  assert.deepEqual(recovered.sessions, []);
  assert.deepEqual(recovered.login_attempts, []);
  assert.deepEqual(f.store.session(digest(f.session.token)), f.alice);
});

test('encrypted archives contain no customer text, account hash, session token or passphrase', async t => {
  const f = await fixture(t);
  const result = await create(f);
  const bytes = fs.readFileSync(f.archive);
  for (const secret of [request().customerName, request().phone, request().job, PASSWORD, PASSPHRASE, f.session.token, await PASSWORD_HASH, 'SQLite format 3']) assert.equal(bytes.includes(Buffer.from(secret)), false);
  const json = JSON.stringify(result);
  for (const value of [f.archive, f.source, PASSWORD, PASSPHRASE, f.alice.username, request().customerName]) assert.equal(json.includes(value), false);
  assert.equal(fs.statSync(f.archive).mode & 0o777, 0o600);
  assert.equal(fs.statSync(f.archive).nlink, 1);
  assert.deepEqual(temporaryNames(f.archives), []);
});

test('separate backups use fresh salts and nonces and are not byte-identical', async t => {
  const f = await fixture(t);
  await create(f);
  const other = path.join(f.archives, 'second.prbk');
  await create(f, { outputFile: other });
  const a = fs.readFileSync(f.archive), b = fs.readFileSync(other);
  assert.notDeepEqual(a.subarray(32, 48), b.subarray(32, 48));
  assert.notDeepEqual(a.subarray(48, 60), b.subarray(48, 60));
  assert.notDeepEqual(a, b);
});

test('an existing archive is never overwritten', async t => {
  const f = await fixture(t);
  fs.writeFileSync(f.archive, 'existing archive fixture', { mode: 0o600 });
  await assert.rejects(create(f), failure('unsafe_path'));
  assert.equal(fs.readFileSync(f.archive, 'utf8'), 'existing archive fixture');
  assert.deepEqual(temporaryNames(f.archives), []);
});

test('an existing restore directory is refused even when empty', async t => {
  const f = await fixture(t);
  await create(f);
  fs.mkdirSync(f.restored, { mode: 0o700 });
  await assert.rejects(restore(f), failure('unsafe_path'));
  assert.deepEqual(fs.readdirSync(f.restored), []);
  const before = snapshots(f.store.filename);
  await assert.rejects(restore(f, { dataDir: f.source }), failure('unsafe_path'));
  assert.deepEqual(snapshots(f.store.filename), before);
});

test('wrong backup passphrase fails before publishing or writing plaintext restore files', async t => {
  const f = await fixture(t);
  await create(f);
  await assert.rejects(restore(f, { passphrase: 'An incorrect synthetic passphrase' }), failure('authentication_failed'));
  assert.equal(fs.existsSync(f.restored), false);
  assert.deepEqual(temporaryNames(f.directory), []);
});

test('ciphertext and authentication tag tampering cannot restore a database', async t => {
  const f = await fixture(t);
  await create(f);
  const original = fs.readFileSync(f.archive);
  for (const offset of [HEADER_BYTES + 200, original.length - 1]) {
    const altered = Buffer.from(original); altered[offset] ^= 1;
    fs.writeFileSync(f.archive, altered);
    await assert.rejects(restore(f), failure('authentication_failed'));
    assert.equal(fs.existsSync(f.restored), false);
    assert.deepEqual(temporaryNames(f.directory), []);
  }
});

test('authenticated header metadata cannot be changed unnoticed', async t => {
  const f = await fixture(t);
  await create(f);
  const bytes = fs.readFileSync(f.archive);
  bytes[23] ^= 1;
  fs.writeFileSync(f.archive, bytes);
  await assert.rejects(restore(f), failure('authentication_failed'));
  assert.equal(fs.existsSync(f.restored), false);
});

test('truncated, appended, unsupported and empty archives fail without a restore directory', async t => {
  const f = await fixture(t);
  await create(f);
  const original = fs.readFileSync(f.archive);
  const unsupported = Buffer.from(original); unsupported.writeUInt16BE(99, 8);
  for (const bytes of [Buffer.alloc(0), original.subarray(0, 50), original.subarray(0, original.length - 1), Buffer.concat([original, Buffer.from('extra')]), unsupported]) {
    fs.writeFileSync(f.archive, bytes);
    await assert.rejects(restore(f), failure());
    assert.equal(fs.existsSync(f.restored), false);
  }
});

test('oversized sparse archives and impossible declared lengths fail before key derivation', async t => {
  const f = await fixture(t);
  const fd = fs.openSync(f.archive, 'wx', 0o600);
  fs.ftruncateSync(fd, MAX_ARCHIVE_BYTES + 1); fs.closeSync(fd);
  await assert.rejects(restore(f), failure('size_limit'));
  fs.unlinkSync(f.archive);
  await create(f);
  const bytes = fs.readFileSync(f.archive);
  bytes.writeBigUInt64BE(BigInt(MAX_DATABASE_BYTES + 1), 24);
  fs.writeFileSync(f.archive, bytes);
  await assert.rejects(restore(f), failure('invalid_archive'));
});

test('database size limit includes uncheckpointed WAL pages rather than only the main file', async t => {
  const f = await fixture(t);
  const writer = new DatabaseSync(f.store.filename);
  try {
    writer.exec('PRAGMA wal_autocheckpoint=0;');
    writer.prepare('UPDATE leads SET data_json=CAST(zeroblob(?) AS TEXT) WHERE id=(SELECT id FROM leads LIMIT 1)').run(MAX_DATABASE_BYTES + 4096);
    assert.ok(fs.statSync(f.store.filename).size < MAX_DATABASE_BYTES);
    assert.ok(fs.statSync(f.store.filename + '-wal').size > MAX_DATABASE_BYTES);
    await assert.rejects(create(f), failure('size_limit'));
    assert.equal(fs.existsSync(f.archive), false);
    assert.deepEqual(temporaryNames(f.archives), []);
  } finally { writer.close(); }
});

test('missing sources never create a workspace or an empty archive', async t => {
  const f = await fixture(t);
  const missing = path.join(f.directory, 'typo-source');
  await assert.rejects(create(f, { dataDir: missing }), failure('unsafe_path'));
  assert.equal(fs.existsSync(missing), false);
  assert.equal(fs.existsSync(f.archive), false);
  fs.mkdirSync(missing, { mode: 0o700 });
  await assert.rejects(create(f, { dataDir: missing }), failure('unsafe_path'));
  assert.deepEqual(fs.readdirSync(missing), []);
});

test('linked files, linked path components and public output directories are refused', async t => {
  const f = await fixture(t);
  const alias = path.join(f.directory, 'source-link');
  fs.symlinkSync(f.source, alias);
  await assert.rejects(create(f, { dataDir: alias }), failure('unsafe_path'));
  const dangling = path.join(f.archives, 'dangling.prbk');
  fs.symlinkSync(path.join(f.directory, 'missing'), dangling);
  await assert.rejects(create(f, { outputFile: dangling }), failure('unsafe_path'));
  const publicDir = path.join(f.directory, 'shared'); fs.mkdirSync(publicDir, { mode: 0o755 });
  await assert.rejects(create(f, { outputFile: path.join(publicDir, 'backup.prbk') }), failure('unsafe_path'));
  await create(f);
  const hardlink = path.join(f.archives, 'linked.prbk'); fs.linkSync(f.archive, hardlink);
  await assert.rejects(restore(f), failure('unsafe_path'));
  assert.equal(fs.existsSync(f.restored), false);
});

test('invalid passphrases fail without changing source or creating files', async t => {
  const f = await fixture(t);
  const before = snapshots(f.store.filename);
  for (const passphrase of ['', 'too short', ' '.repeat(20), 'x'.repeat(129), 'synthetic\npassphrase', 'synthetic\0passphrase', 'x'.repeat(20) + '\ud800']) await assert.rejects(create(f, { passphrase }), failure('invalid_passphrase'));
  assert.deepEqual(snapshots(f.store.filename), before);
  assert.equal(fs.existsSync(f.archive), false);
});

test('restored directory and database remain owner-only with no sidecars or staging files', async t => {
  const f = await fixture(t);
  await create(f); await restore(f);
  assert.equal(fs.statSync(f.restored).mode & 0o777, 0o700);
  assert.deepEqual(fs.readdirSync(f.restored), ['workspace.sqlite']);
  const stat = fs.statSync(path.join(f.restored, 'workspace.sqlite'));
  assert.equal(stat.mode & 0o777, 0o600); assert.equal(stat.nlink, 1);
  assert.deepEqual(temporaryNames(f.directory), []);
});

test('restoring an older archive cannot revive a password reset later on the source', async t => {
  const f = await fixture(t);
  await create(f);
  const replacementHash = await hashPassword(NEW_PASSWORD);
  f.store.resetOwnerPassword({ username: f.alice.username, passwordHash: replacementHash });
  const currentSource = snapshots(f.store.filename);
  await restore(f);
  const restored = openStore({ dataDir: f.restored, create: false });
  try {
    assert.equal(restored.findUser(f.alice.username).password_hash, RESTORE_DISABLED_PASSWORD);
    assert.equal(restored.session(digest(f.session.token)), null);
    const auth = createAuth(restored);
    await assert.rejects(auth.login({ username: f.alice.username, password: PASSWORD }), error => error.code === 'invalid_credentials');
    await assert.rejects(auth.login({ username: f.alice.username, password: NEW_PASSWORD }), error => error.code === 'invalid_credentials');
    await resetPassword.main(['--data-dir', f.restored, '--username', f.alice.username], Readable.from([NEW_PASSWORD + '\n']));
    assert.equal((await auth.login({ username: f.alice.username, password: NEW_PASSWORD })).user.id, f.alice.id);
    assert.equal(restored.findUser(f.bob.username).password_hash, RESTORE_DISABLED_PASSWORD);
  } finally { restored.close(); }
  assert.deepEqual(snapshots(f.store.filename), currentSource);
});

test('a restored database can be backed up again before its owners reset passwords', async t => {
  const f = await fixture(t);
  await create(f); await restore(f);
  const next = path.join(f.archives, 'restored-copy.prbk');
  const result = await create(f, { dataDir: f.restored, outputFile: next });
  assert.equal(result.counts.users, 2);
  const final = path.join(f.directory, 'second-restore');
  await restore(f, { backupFile: next, dataDir: final });
  assert.ok(snapshots(path.join(final, 'workspace.sqlite')).users.every(row => row.password_hash === RESTORE_DISABLED_PASSWORD));
});

test('authenticated archives with unsupported schema versions, views or triggers are refused', async t => {
  const f = await fixture(t);
  await create(f);
  const original = fs.readFileSync(f.archive);
  for (const mutate of [db => db.exec('PRAGMA user_version=99'), db => db.exec('CREATE VIEW leak AS SELECT * FROM users'), db => db.exec('CREATE TRIGGER change_leads AFTER INSERT ON users BEGIN DELETE FROM leads; END')]) {
    fs.writeFileSync(f.archive, original);
    rewriteAuthenticatedArchive(f, mutate);
    await assert.rejects(restore(f), failure('unsupported_schema'));
    assert.equal(fs.existsSync(f.restored), false);
    assert.deepEqual(temporaryNames(f.directory), []);
  }
});

test('authenticated archives with changed constraints, malformed records or tenant links are refused', async t => {
  const f = await fixture(t);
  await create(f);
  const original = fs.readFileSync(f.archive);
  const mutations = [
    db => db.exec('DROP INDEX leads_business_created'),
    db => db.prepare('UPDATE businesses SET facts_json=?').run('{malformed'),
    db => db.prepare('UPDATE messages SET business_id=? WHERE business_id=?').run(f.bob.businessId, f.alice.businessId),
    db => { db.exec('PRAGMA foreign_keys=OFF'); db.exec("UPDATE users SET business_id='missing-business'"); }
  ];
  for (let index = 0; index < mutations.length; index += 1) {
    fs.writeFileSync(f.archive, original); rewriteAuthenticatedArchive(f, mutations[index]);
    await assert.rejects(restore(f), failure(index === 0 ? 'unsupported_schema' : 'invalid_database'));
    assert.equal(fs.existsSync(f.restored), false);
    assert.deepEqual(temporaryNames(f.directory), []);
  }
});

test('source database schema failures never publish an archive or leave plaintext staging files', async t => {
  const f = await fixture(t);
  const filename = f.store.filename;
  f.close();
  const db = new DatabaseSync(filename);
  db.exec('CREATE VIEW unwanted AS SELECT * FROM users'); db.close();
  await assert.rejects(create(f), failure('unsupported_schema'));
  assert.equal(fs.existsSync(f.archive), false);
  assert.deepEqual(temporaryNames(f.archives), []);
});

test('archive publication refuses a destination created during key derivation', async t => {
  const f = await fixture(t);
  const pending = create(f);
  await new Promise(resolve => setImmediate(resolve));
  fs.writeFileSync(f.archive, 'competing fixture content', { flag: 'wx', mode: 0o600 });
  await assert.rejects(pending, failure('destination_exists'));
  assert.equal(fs.readFileSync(f.archive, 'utf8'), 'competing fixture content');
  assert.deepEqual(temporaryNames(f.archives), []);
});

test('restore publication never overwrites a directory created during authentication', async t => {
  const f = await fixture(t);
  await create(f);
  const pending = restore(f);
  await new Promise(resolve => setImmediate(resolve));
  fs.mkdirSync(f.restored, { mode: 0o700 });
  fs.writeFileSync(path.join(f.restored, 'keep.txt'), 'existing fixture record', { mode: 0o600 });
  await assert.rejects(pending, failure('destination_exists'));
  assert.equal(fs.readFileSync(path.join(f.restored, 'keep.txt'), 'utf8'), 'existing fixture record');
  assert.deepEqual(fs.readdirSync(f.restored), ['keep.txt']);
  assert.deepEqual(temporaryNames(f.directory), []);
});

test('backup CLI accepts only supported unique flags and stdin passphrases', async () => {
  assert.deepEqual(parseArgs(['create', '--data-dir', '/source', '--output', '/archive']), { command: 'create', dataDir: '/source', outputFile: '/archive' });
  assert.deepEqual(parseArgs(['restore', '--backup', '/archive', '--data-dir', '/target']), { command: 'restore', backupFile: '/archive', dataDir: '/target' });
  for (const args of [[], ['erase'], ['create', '--data-dir', '/a', '--data-dir', '/b'], ['create', '--data-dir', '/a', '--passphrase', PASSPHRASE], ['restore', '--backup', '/a', '--force', '/b']]) assert.throws(() => parseArgs(args));
  assert.equal(await readPassphrase(Readable.from([PASSPHRASE + '\r\n'])), PASSPHRASE);
  await assert.rejects(readPassphrase({ isTTY: true }));
  await assert.rejects(readPassphrase(Readable.from([Buffer.from([0xff])])));
  await assert.rejects(readPassphrase(Readable.from(['x'.repeat(1025)])));
  await assert.rejects(readPassphrase(Readable.from([PASSPHRASE + '\n' + 'another line'])));
});

test('backup CLI roundtrip succeeds without logging paths, credentials or customer values', async t => {
  const f = await fixture(t);
  const script = path.resolve(__dirname, '../scripts/workspace-backup.cjs');
  const created = spawnSync(process.execPath, [script, 'create', '--data-dir', f.source, '--output', f.archive], { input: PASSPHRASE + '\n', encoding: 'utf8', timeout: 15000 });
  assert.equal(created.status, 0, created.stderr);
  assert.equal(JSON.parse(created.stdout).operation, 'create');
  const restored = spawnSync(process.execPath, [script, 'restore', '--backup', f.archive, '--data-dir', f.restored], { input: PASSPHRASE + '\n', encoding: 'utf8', timeout: 15000 });
  assert.equal(restored.status, 0, restored.stderr);
  assert.equal(JSON.parse(restored.stdout).passwordResetRequired, true);
  for (const output of [created.stdout, created.stderr, restored.stdout, restored.stderr]) for (const value of [PASSPHRASE, PASSWORD, f.directory, f.alice.username, request().customerName]) assert.equal(output.includes(value), false);
});
