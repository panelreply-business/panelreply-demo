'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { Readable } = require('node:stream');
const { spawnSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const { openStore, StoreError, digest } = require('../workspace/store.cjs');
const { hashPassword, verifyPassword, validPassword, createAuth } = require('../workspace/auth.cjs');
const { main, parseArgs, publicError, RecoveryInputError } = require('../scripts/workspace-reset-password.cjs');

const ORIGINAL = 'Synthetic original owner password 2026!';
const REPLACEMENT = 'Synthetic replacement owner password 2026!';
const hashes = Promise.all([hashPassword(ORIGINAL), hashPassword(REPLACEMENT)]);
const ROOT = path.resolve(__dirname, '..');
const LEAD = { customerName: 'Synthetic Customer', phone: '586-555-0101', job: 'Install garage lighting', zip: '48315', callbackWindow: 'Monday afternoon', requestedWorkDate: 'Next Friday', contactPermission: 'requested_callback', conversation: [{ role: 'customer', text: 'Please call me about installing garage lighting.' }] };

async function fixture(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'panelreply-owner-recovery-'));
  const dataDir = path.join(base, 'data');
  let store = openStore({ dataDir });
  const [oldHash, newHash] = await hashes;
  const alice = store.createBusinessOwner({ businessName: 'Synthetic Electric', username: 'alice@example.test', passwordHash: oldHash });
  const bob = store.createBusinessOwner({ businessName: 'Other Synthetic Electric', username: 'bob@example.test', passwordHash: oldHash });
  t.after(() => { store.close(); fs.rmSync(base, { recursive: true, force: true }); });
  return { base, dataDir, alice, bob, oldHash, newHash, get store() { return store; }, reopen() { store.close(); store = openStore({ dataDir }); return store; } };
}
function fails(code) { return error => error instanceof StoreError && error.code === code; }
function readRows(f, sql) {
  const db = new DatabaseSync(path.join(f.dataDir, 'workspace.sqlite'), { readOnly: true });
  try { return db.prepare(sql).all().map(row => ({ ...row })); }
  finally { db.close(); }
}
function args(f, name = f.alice.username) { return ['--data-dir', f.dataDir, '--username', name]; }
function reset(f) { return f.store.resetOwnerPassword({ username: f.alice.username, passwordHash: f.newHash }); }

test('malformed Unicode passwords cannot collide with a different replacement-character password', async () => {
  const malformed = 'Synthetic password phrase ' + String.fromCharCode(0xd800);
  const replacement = 'Synthetic password phrase ' + String.fromCharCode(0xfffd);
  assert.equal(validPassword(malformed), false);
  assert.equal(validPassword('Synthetic password phrase ' + String.fromCodePoint(0x1f512)), true);
  await assert.rejects(hashPassword(malformed), fails('invalid_password'));
  assert.equal(await verifyPassword(malformed, await hashPassword(replacement)), false);
});

test('owner recovery replaces the password and rejects the old password', async t => {
  const f = await fixture(t);
  const result = reset(f);
  assert.deepEqual(result, { reset: true, userId: f.alice.id, businessId: f.alice.businessId, username: f.alice.username, revokedSessions: 0 });
  assert.equal(await verifyPassword(REPLACEMENT, f.store.findUser(f.alice.username).password_hash), true);
  const auth = createAuth(f.store);
  await assert.rejects(auth.login({ username: f.alice.username, password: ORIGINAL }), fails('invalid_credentials'));
  const signed = await auth.login({ username: f.alice.username, password: REPLACEMENT });
  assert.deepEqual(signed.user, f.alice);
});

test('owner recovery revokes every target session while preserving another owner session', async t => {
  const f = await fixture(t);
  const auth = createAuth(f.store);
  const first = await auth.login({ username: f.alice.username, password: ORIGINAL });
  const second = await auth.login({ username: f.alice.username, password: ORIGINAL });
  const other = await auth.login({ username: f.bob.username, password: ORIGINAL });
  assert.equal(reset(f).revokedSessions, 2);
  assert.equal(f.store.session(digest(first.token)), null);
  assert.equal(f.store.session(digest(second.token)), null);
  assert.deepEqual(f.store.session(digest(other.token)), f.bob);
  assert.equal(f.store.findUser(f.bob.username).password_hash, f.oldHash);
});

test('owner recovery leaves profiles, requests, transcripts, audit history and restrictions unchanged', async t => {
  const f = await fixture(t);
  const a = f.store.createLead(f.alice, { ...LEAD, contactPermission: 'opted_out' }, crypto.randomUUID()).lead;
  const b = f.store.createLead(f.bob, { ...LEAD, conversation: [{ role: 'customer', text: 'The panel is sparking.' }] }, crypto.randomUUID()).lead;
  const profile = f.store.getProfile(f.alice);
  profile.facts.hours = { verified: true, answer: 'Synthetic office hours: weekdays 9–5.' };
  const savedProfile = f.store.updateProfile(f.alice, { version: profile.version, businessName: profile.business.name, facts: profile.facts });
  reset(f);
  assert.deepEqual(f.store.getProfile(f.alice), savedProfile);
  assert.deepEqual(f.store.getLead(f.alice, a.id), a);
  assert.deepEqual(f.store.getLead(f.bob, b.id), b);
  assert.equal(f.store.isSuppressed(f.alice, a.phone), true);
  assert.equal(f.store.isSuppressed(f.bob, a.phone), false);
});

test('owner recovery clears only the target username throttle and preserves IP and other-user limits', async t => {
  const f = await fixture(t);
  const a = 'user:' + digest(f.alice.username), b = 'user:' + digest(f.bob.username), ip = 'ip:' + digest('127.0.0.1');
  for (const key of [a, b, ip]) for (let i = 0; i < 5; i++) assert.equal(f.store.consumeLoginAttempt(key, 5), true);
  reset(f);
  assert.equal(f.store.consumeLoginAttempt(a, 5), true);
  assert.equal(f.store.consumeLoginAttempt(b, 5), false);
  assert.equal(f.store.consumeLoginAttempt(ip, 5), false);
});

test('owner recovery records metadata without password hashes or session secrets', async t => {
  const f = await fixture(t);
  const session = await createAuth(f.store).login({ username: f.alice.username, password: ORIGINAL });
  const result = reset(f);
  const audit = readRows(f, "SELECT * FROM audit WHERE action = 'owner.password_reset'");
  assert.equal(audit.length, 1);
  assert.equal(audit[0].business_id, f.alice.businessId);
  assert.equal(audit[0].actor_id, f.alice.id);
  assert.equal(audit[0].lead_id, null);
  assert.equal(audit[0].version, 0);
  assert.deepEqual(JSON.parse(audit[0].details_json), { source: 'local_operator', revokedSessions: 1 });
  const serialized = JSON.stringify({ audit, result });
  for (const secret of [ORIGINAL, REPLACEMENT, f.oldHash, f.newHash, session.token, session.csrfToken]) assert.ok(!serialized.includes(secret));
});

test('unknown owner recovery never creates an account or writes an audit event', async t => {
  const f = await fixture(t);
  const before = readRows(f, 'SELECT * FROM users ORDER BY id');
  assert.throws(() => f.store.resetOwnerPassword({ username: 'missing@example.test', passwordHash: f.newHash }), fails('owner_not_found'));
  assert.deepEqual(readRows(f, 'SELECT * FROM users ORDER BY id'), before);
  assert.equal(readRows(f, 'SELECT * FROM audit').length, 0);
});

test('malformed recovery inputs cannot replace a password', async t => {
  const f = await fixture(t);
  for (const passwordHash of ['', 'scrypt$not-a-real-hash', ORIGINAL, 'scrypt$2$1$1$invalid$invalid', null]) {
    assert.throws(() => f.store.resetOwnerPassword({ username: f.alice.username, passwordHash }), fails('invalid_password_hash'));
  }
  assert.throws(() => f.store.resetOwnerPassword({ username: f.alice.username, passwordHash: f.newHash, businessId: f.bob.businessId }), fails('invalid_input'));
  assert.equal(f.store.findUser(f.alice.username).password_hash, f.oldHash);
});

test('password and session recovery remain effective after database reopen', async t => {
  const f = await fixture(t);
  const session = await createAuth(f.store).login({ username: f.alice.username, password: ORIGINAL });
  reset(f);
  f.reopen();
  assert.equal(f.store.session(digest(session.token)), null);
  assert.equal(await verifyPassword(ORIGINAL, f.store.findUser(f.alice.username).password_hash), false);
  const signed = await createAuth(f.store).login({ username: f.alice.username, password: REPLACEMENT });
  assert.deepEqual(signed.user, f.alice);
  assert.equal(readRows(f, "SELECT * FROM audit WHERE action = 'owner.password_reset'").length, 1);
});

test('a reset committed while login awaits password verification prevents a stale session', async t => {
  const f = await fixture(t);
  const auth = createAuth(f.store);
  // login reads the old hash synchronously, then awaits scrypt. Reset commits
  // before that await can resume. No clock, sleep or timing guess is involved.
  const inFlight = auth.login({ username: f.alice.username, password: ORIGINAL });
  reset(f);
  await assert.rejects(inFlight, fails('invalid_credentials'));
  assert.equal(readRows(f, 'SELECT * FROM sessions').length, 0);
  assert.equal((await auth.login({ username: f.alice.username, password: REPLACEMENT })).user.id, f.alice.id);
});

test('a failed recovery audit rolls back password, sessions and throttle changes together', async t => {
  const f = await fixture(t);
  const session = await createAuth(f.store).login({ username: f.alice.username, password: ORIGINAL });
  const key = 'user:' + digest(f.alice.username);
  for (let i = 0; i < 5; i++) f.store.consumeLoginAttempt(key, 5);
  const connection = new DatabaseSync(path.join(f.dataDir, 'workspace.sqlite'));
  try { connection.exec("CREATE TRIGGER recovery_test_failure BEFORE INSERT ON audit WHEN NEW.action = 'owner.password_reset' BEGIN SELECT RAISE(ABORT, 'synthetic recovery write failure'); END;"); }
  finally { connection.close(); }
  assert.throws(() => reset(f), /synthetic recovery write failure/);
  assert.equal(f.store.findUser(f.alice.username).password_hash, f.oldHash);
  assert.deepEqual(f.store.session(digest(session.token)), f.alice);
  assert.equal(f.store.consumeLoginAttempt(key, 5), false);
  assert.equal(readRows(f, "SELECT * FROM audit WHERE action = 'owner.password_reset'").length, 0);
});

test('recovery CLI accepts only explicit data directory and existing username options', () => {
  assert.deepEqual(parseArgs(['--username', 'ALICE@example.test', '--data-dir', '/private/fixture']), { dataDir: '/private/fixture', username: 'alice@example.test' });
  for (const input of [[], ['--data-dir', '/private/fixture'], ['--username', 'a', '--username', 'b'], ['--data-dir', '/private/fixture', '--password', ORIGINAL], ['--data-dir', '/private/fixture', '--username', 'owner', '--password', ORIGINAL]]) {
    assert.throws(() => parseArgs(input));
  }
});

test('recovery CLI changes an existing owner using stdin and returns only safe confirmation', async t => {
  const f = await fixture(t);
  const signed = await createAuth(f.store).login({ username: f.alice.username, password: ORIGINAL });
  const result = await main(args(f), Readable.from([REPLACEMENT + '\n']));
  assert.equal(result.reset, true);
  assert.equal(result.revokedSessions, 1);
  assert.equal(result.userId, f.alice.id);
  assert.equal(f.store.session(digest(signed.token)), null);
  const serialized = JSON.stringify(result);
  for (const secret of [ORIGINAL, REPLACEMENT, f.oldHash, f.newHash, signed.token]) assert.ok(!serialized.includes(secret));
  assert.equal(await verifyPassword(REPLACEMENT, f.store.findUser(f.alice.username).password_hash), true);
});

test('a restored disabled account requires operator recovery before it can sign in', async t => {
  const f = await fixture(t);
  const db = new DatabaseSync(path.join(f.dataDir, 'workspace.sqlite'));
  db.prepare('UPDATE users SET password_hash=? WHERE id=?').run('disabled:restore-required', f.alice.id);
  db.close();
  const auth = createAuth(f.store);
  await assert.rejects(auth.login({ username: f.alice.username, password: ORIGINAL }), fails('invalid_credentials'));
  await main(args(f), Readable.from([REPLACEMENT + '\n']));
  assert.equal((await auth.login({ username: f.alice.username, password: REPLACEMENT })).user.id, f.alice.id);
  assert.equal(f.store.findUser(f.bob.username).password_hash, f.oldHash);
});

test('recovery CLI refuses missing directories, empty directories and empty database files without initialization', async t => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'panelreply-missing-recovery-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const missing = path.join(base, 'missing');
  await assert.rejects(main(['--data-dir', missing, '--username', 'owner'], Readable.from([REPLACEMENT])), RecoveryInputError);
  assert.equal(fs.existsSync(missing), false);
  const empty = path.join(base, 'empty');
  fs.mkdirSync(empty, { mode: 0o700 });
  await assert.rejects(main(['--data-dir', empty, '--username', 'owner'], Readable.from([REPLACEMENT])), RecoveryInputError);
  assert.deepEqual(fs.readdirSync(empty), []);
  const filename = path.join(empty, 'workspace.sqlite');
  fs.writeFileSync(filename, '', { mode: 0o600 });
  await assert.rejects(main(['--data-dir', empty, '--username', 'owner'], Readable.from([REPLACEMENT])), RecoveryInputError);
  assert.equal(fs.statSync(filename).size, 0);
});

test('recovery CLI rejects unrelated and unsupported schemas without creating workspace tables', async t => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'panelreply-schema-recovery-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const filename = path.join(base, 'workspace.sqlite');
  fs.writeFileSync(filename, '', { mode: 0o600 });
  const db = new DatabaseSync(filename);
  db.exec("CREATE TABLE unrelated (note TEXT); INSERT INTO unrelated VALUES ('keep this record');");
  for (const version of [0, 1, 2]) {
    db.exec('PRAGMA user_version=' + version);
    await assert.rejects(main(['--data-dir', base, '--username', 'owner'], Readable.from([REPLACEMENT])), RecoveryInputError);
    assert.deepEqual(db.prepare("SELECT name FROM sqlite_schema WHERE type='table'").all().map(row => row.name), ['unrelated']);
    assert.equal(db.prepare('SELECT note FROM unrelated').get().note, 'keep this record');
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, version);
  }
  db.close();
});

test('recovery CLI rejects missing owners, TTY, malformed or absent stdin without changing credentials', async t => {
  const f = await fixture(t);
  await assert.rejects(main(args(f, 'missing@example.test'), Readable.from([REPLACEMENT])), fails('owner_not_found'));
  for (const value of ['', 'short', 'contains-a-line\nbreak-password', Buffer.from([0xff, 0xfe])]) {
    await assert.rejects(main(args(f), Readable.from([value])), RecoveryInputError);
  }
  const tty = Readable.from([REPLACEMENT]); tty.isTTY = true;
  await assert.rejects(main(args(f), tty), RecoveryInputError);
  assert.equal(f.store.findUser(f.alice.username).password_hash, f.oldHash);
  assert.equal(f.store.findUser('missing@example.test'), null);
  assert.equal(readRows(f, 'SELECT * FROM audit').length, 0);
});

test('recovery process ignores password environment variables and never prints rejected password arguments', async t => {
  const f = await fixture(t);
  const envAttempt = spawnSync(process.execPath, ['scripts/workspace-reset-password.cjs', ...args(f)], { cwd: ROOT, input: '', encoding: 'utf8', env: { ...process.env, WORKSPACE_NEW_PASSWORD: REPLACEMENT } });
  assert.equal(envAttempt.status, 1);
  assert.equal(envAttempt.stdout, '');
  assert.ok(!envAttempt.stderr.includes(REPLACEMENT));
  const argvAttempt = spawnSync(process.execPath, ['scripts/workspace-reset-password.cjs', ...args(f), '--password', REPLACEMENT], { cwd: ROOT, input: '', encoding: 'utf8' });
  assert.equal(argvAttempt.status, 1);
  assert.equal(argvAttempt.stdout, '');
  assert.ok(!argvAttempt.stderr.includes(REPLACEMENT));
  assert.equal(f.store.findUser(f.alice.username).password_hash, f.oldHash);
});

test('recovery process uses stdin and unexpected error messages remain generic', async t => {
  const f = await fixture(t);
  const attempt = spawnSync(process.execPath, ['scripts/workspace-reset-password.cjs', ...args(f)], { cwd: ROOT, input: REPLACEMENT + '\n', encoding: 'utf8' });
  assert.equal(attempt.status, 0, attempt.stderr);
  assert.equal(JSON.parse(attempt.stdout).userId, f.alice.id);
  assert.ok(!attempt.stdout.includes(REPLACEMENT));
  assert.ok(!attempt.stderr.includes(REPLACEMENT));
  assert.equal(await verifyPassword(REPLACEMENT, f.store.findUser(f.alice.username).password_hash), true);
  const leak = 'PRIVATE PASSWORD HASH OR SQL FAILURE';
  assert.ok(!publicError(new Error(leak)).includes(leak));
});

test('startup and recovery reject a read-only database without changing its permissions', async t => {
  const f = await fixture(t);
  const filename = path.join(f.dataDir, 'workspace.sqlite');
  fs.chmodSync(filename, 0o400);
  assert.throws(() => openStore({ dataDir: f.dataDir }), /read and write/);
  await assert.rejects(main(args(f), Readable.from([REPLACEMENT])), RecoveryInputError);
  assert.equal(fs.statSync(filename).mode & 0o777, 0o400);
  fs.chmodSync(filename, 0o600);
});

test('startup rejects linked database and linked sidecar paths without touching their targets', async t => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'panelreply-linked-recovery-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const target = path.join(base, 'keep');
  fs.writeFileSync(target, 'unchanged synthetic target', { mode: 0o600 });
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    const directory = path.join(base, 'data' + (suffix || '-db'));
    fs.mkdirSync(directory, { mode: 0o700 });
    fs.symlinkSync(target, path.join(directory, 'workspace.sqlite' + suffix));
    assert.throws(() => openStore({ dataDir: directory }), /symbolic|exists/);
    assert.equal(fs.readFileSync(target, 'utf8'), 'unchanged synthetic target');
    assert.equal(fs.statSync(target).mode & 0o777, 0o600);
  }
});

test('recovery refuses injected triggers before changing an owner password', async t => {
  const f = await fixture(t);
  const db = new DatabaseSync(path.join(f.dataDir, 'workspace.sqlite'));
  db.exec("CREATE TRIGGER forbidden_recovery_effect AFTER UPDATE OF password_hash ON users BEGIN DELETE FROM leads; END;");
  db.close();
  await assert.rejects(main(args(f), Readable.from([REPLACEMENT])), RecoveryInputError);
  assert.equal(f.store.findUser(f.alice.username).password_hash, f.oldHash);
});

test('recovery rejects same-name schemas that drop constraints or change column types', async t => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'panelreply-forged-schema-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  for (const [name, transform] of [
    ['nullability', sql => sql.replace('username TEXT NOT NULL UNIQUE', 'username TEXT UNIQUE')],
    ['foreign-key', sql => sql.replace(' REFERENCES businesses(id)', '')],
    ['unique-key', sql => sql.replace(' NOT NULL UNIQUE', ' NOT NULL')],
    ['column-type', sql => sql.replace('created_at INTEGER', 'created_at TEXT')]
  ]) {
    const directory = path.join(base, name);
    const source = openStore({ dataDir: directory }); source.close();
    const db = new DatabaseSync(path.join(directory, 'workspace.sqlite'));
    const sql = db.prepare("SELECT sql FROM sqlite_schema WHERE name='users'").get().sql;
    db.exec('DROP TABLE users');
    db.exec(transform(sql));
    db.close();
    assert.throws(() => openStore({ dataDir: directory, create: false }), /supported schema/);
  }
});

test('business export uses one snapshot while another connection writes profile and requests', async t => {
  const f = await fixture(t);
  const first = f.store.createLead(f.alice, LEAD, crypto.randomUUID()).lead;
  const writer = openStore({ dataDir: f.dataDir, create: false });
  t.after(() => writer.close());
  const originalGetProfile = f.store.getProfile;
  f.store.getProfile = actor => {
    const profile = originalGetProfile(actor);
    writer.updateProfile(actor, { version: profile.version, businessName: 'New committed business name', facts: profile.facts });
    writer.createLead(actor, { ...LEAD, customerName: 'New committed customer' }, crypto.randomUUID());
    return profile;
  };
  const result = f.store.exportBusiness(f.alice);
  f.store.getProfile = originalGetProfile;
  assert.equal(result.profile.business.name, 'Synthetic Electric');
  assert.deepEqual(result.leads.map(lead => lead.id), [first.id]);
  assert.equal(f.store.getProfile(f.alice).business.name, 'New committed business name');
  assert.equal(f.store.listLeads(f.alice).length, 2);
  assert.deepEqual(f.store.exportBusiness(f.bob).leads, []);
});

test('a failed export closes its read transaction and leaves records unchanged', async t => {
  const f = await fixture(t);
  const originalListLeads = f.store.listLeads;
  f.store.listLeads = () => { throw new Error('synthetic interrupted export'); };
  assert.throws(() => f.store.exportBusiness(f.alice), /synthetic interrupted export/);
  f.store.listLeads = originalListLeads;
  const saved = f.store.createLead(f.alice, LEAD, crypto.randomUUID()).lead;
  assert.deepEqual(f.store.exportBusiness(f.alice).leads, [saved]);
});
