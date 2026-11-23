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
const { SCHEMA_COLUMNS, StoreError, digest } = require('../workspace/store.cjs');
const { openProductStore } = require('../workspace/products.cjs');
const { hashPassword } = require('../workspace/auth.cjs');
const { createWorkspaceApp } = require('../workspace/api.cjs');
const { validateDatabase, createEncryptedBackup, restoreEncryptedBackup, RESTORE_DISABLED_PASSWORD } = require('../workspace/backup.cjs');

const TIME = Date.UTC(2026, 10, 23, 12);
const MINUTE = 60 * 1000;
const PASSWORD = 'Synthetic account invariant password 2026!';
const HASH = hashPassword(PASSWORD);
const PASSPHRASE = 'Synthetic account recovery passphrase 2026!';
const ORIGIN = 'http://127.0.0.1:10001';
const code = (name, status) => error => error instanceof StoreError && error.code === name && error.status === status;

function inspect(f, action) {
  const db = new DatabaseSync(f.store.filename);
  try { return action(db); } finally { db.close(); }
}
function snapshot(f) {
  return inspect(f, db => Object.fromEntries(Object.keys(SCHEMA_COLUMNS).map(table => [table,
    db.prepare('SELECT * FROM ' + table + ' ORDER BY rowid').all()])));
}
function sessionRow(f, tokenHash = f.tokenHash) {
  return inspect(f, db => db.prepare('SELECT * FROM sessions WHERE token_hash=?').get(tokenHash));
}
function profileInput(profile, changes = {}) {
  return { version: profile.version, businessName: profile.business.name, facts: structuredClone(profile.facts), ...changes };
}
function setProfileVersion(f, version) {
  inspect(f, db => db.prepare('UPDATE businesses SET version=? WHERE id=?').run(version, f.actor.businessId));
  assert.doesNotThrow(() => inspect(f, validateDatabase));
  return f.store.getProfile(f.actor);
}
async function fixture(t, product = 'callback') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'panelreply-account-invariants-'));
  fs.chmodSync(root, 0o700);
  const dataDir = path.join(root, 'source');
  let clock = TIME, reads = 0, sequence = null;
  const now = () => { reads += 1; return sequence ? sequence.shift() : clock; };
  let store = openProductStore({ dataDir, product, now });
  t.after(() => { store.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const actor = store.createBusinessOwner({ businessName: 'Synthetic Account Electric', username: 'account@example.test', passwordHash: await HASH });
  const tokenHash = digest(crypto.randomBytes(32));
  store.createSession(actor.id, tokenHash);
  return { root, dataDir, product, actor, tokenHash, get store() { return store; },
    setClock(value) { clock = value; sequence = null; reads = 0; },
    sequence(values) { sequence = [...values]; reads = 0; },
    get clockReads() { return reads; },
    reopen() { store.close(); store = openProductStore({ dataDir, product, now, create: false }); },
  };
}
function appFor(t, f) {
  const app = createWorkspaceApp({ store: f.store, product: f.product, origin: ORIGIN });
  t.after(() => app.close());
  return app;
}
async function request(app, method, url, input, headers = {}) {
  const req = Readable.from(input === undefined ? [] : [JSON.stringify(input)]);
  Object.assign(req, { method, url, headers: { host: '127.0.0.1:10001', origin: ORIGIN, 'content-type': 'application/json', ...headers }, socket: { remoteAddress: '127.0.0.1' } });
  const res = new EventEmitter(); res.writableEnded = false; res.destroyed = false;
  res.writeHead = (status, values) => { res.status = status; res.headers = values; };
  res.end = value => { res.text = value === undefined ? '' : Buffer.isBuffer(value) ? value.toString() : value; res.writableEnded = true; };
  await app.handler(req, res);
  if (res.headers?.['Content-Type']?.startsWith('application/json') && res.text) res.body = JSON.parse(res.text);
  return res;
}
async function login(app, f) {
  const response = await request(app, 'POST', '/api/login', { username: f.actor.username, password: PASSWORD });
  assert.equal(response.status, 200);
  const cookie = response.headers['Set-Cookie'].split(';')[0];
  return { headers: { cookie, 'x-csrf-token': response.body.csrfToken }, tokenHash: digest(cookie.slice(cookie.indexOf('=') + 1)) };
}

test('terminal profile revision returns a controlled error without changing any saved row or the caller draft', async t => {
  const f = await fixture(t), terminal = setProfileVersion(f, Number.MAX_SAFE_INTEGER);
  const input = profileInput(terminal, { businessName: 'Rejected synthetic correction' });
  input.facts.services = { verified: true, answer: 'Synthetic lighting work' };
  const draft = structuredClone(input), before = snapshot(f);
  assert.throws(() => f.store.updateProfile(f.actor, input), code('version_exhausted', 409));
  assert.deepEqual(snapshot(f), before); assert.deepEqual(input, draft);
  assert.deepEqual(f.store.getProfile(f.actor), terminal);
  assert.doesNotThrow(() => inspect(f, validateDatabase));
  f.reopen();
  assert.deepEqual(f.store.getProfile(f.actor), terminal);
});

test('the final safe profile increment remains readable and recoverable before later edits are rejected', async t => {
  const f = await fixture(t), prior = setProfileVersion(f, Number.MAX_SAFE_INTEGER - 1);
  const input = profileInput(prior, { businessName: 'Final synthetic correction' });
  input.facts.services = { verified: true, answer: 'Retain this approved answer.' };
  const saved = f.store.updateProfile(f.actor, input);
  assert.equal(saved.version, Number.MAX_SAFE_INTEGER);
  assert.equal(saved.business.name, input.businessName); assert.deepEqual(saved.facts, input.facts);
  const audit = inspect(f, db => db.prepare("SELECT * FROM audit WHERE action='profile.updated'").all());
  assert.equal(audit.length, 1); assert.equal(audit[0].version, Number.MAX_SAFE_INTEGER);
  assert.doesNotThrow(() => inspect(f, validateDatabase));
  const before = snapshot(f);
  assert.throws(() => f.store.updateProfile(f.actor, input), code('version_conflict', 409));
  assert.throws(() => f.store.updateProfile(f.actor, profileInput(saved)), code('version_exhausted', 409));
  assert.deepEqual(snapshot(f), before);
});

test('terminal profile guards preserve stale-version and tenant authorization behavior', async t => {
  const f = await fixture(t), terminal = setProfileVersion(f, Number.MAX_SAFE_INTEGER);
  const other = f.store.createBusinessOwner({ businessName: 'Other Synthetic Account', username: 'other@example.test', passwordHash: await HASH });
  const before = snapshot(f);
  assert.throws(() => f.store.updateProfile(f.actor, profileInput(terminal, { version: 1 })), code('version_conflict', 409));
  assert.throws(() => f.store.updateProfile(other, profileInput(terminal)), code('version_conflict', 409));
  assert.throws(() => f.store.updateProfile({ ...f.actor, businessId: other.businessId }, profileInput(terminal)), code('unauthorized', 401));
  assert.deepEqual(snapshot(f), before);
});

test('fixed callback profile API returns the final safe revision and a controlled terminal rejection', async t => {
  const f = await fixture(t), app = appFor(t, f), signed = await login(app, f);
  const profile = setProfileVersion(f, Number.MAX_SAFE_INTEGER - 1);
  const updated = await request(app, 'PATCH', '/api/profile', profileInput(profile, { businessName: 'API terminal profile' }), signed.headers);
  assert.equal(updated.status, 200); assert.equal(updated.body.version, Number.MAX_SAFE_INTEGER);
  const before = snapshot(f);
  const rejected = await request(app, 'PATCH', '/api/profile', profileInput(updated.body), signed.headers);
  assert.equal(rejected.status, 409); assert.equal(rejected.body.error.code, 'version_exhausted');
  assert.doesNotMatch(rejected.text, /RangeError|ERR_OUT_OF_RANGE|stack|password|token_hash/);
  assert.deepEqual(snapshot(f), before);
  assert.deepEqual((await request(app, 'GET', '/api/profile', undefined, signed.headers)).body, updated.body);
});

test('session clock rollback before creation preserves authorization and every saved timestamp', async t => {
  const f = await fixture(t), before = snapshot(f), saved = sessionRow(f);
  f.setClock(TIME - 1000);
  assert.deepEqual(f.store.session(f.tokenHash), f.actor);
  assert.deepEqual(snapshot(f), before);
  assert.equal(sessionRow(f).last_seen, saved.created_at);
  assert.equal(sessionRow(f).expires_at, saved.expires_at);
});

test('session activity remains monotonic across rollback and reopen and expires at the saved idle boundary', async t => {
  const f = await fixture(t), absoluteExpiry = sessionRow(f).expires_at;
  f.setClock(TIME + 10 * MINUTE);
  assert.deepEqual(f.store.session(f.tokenHash), f.actor);
  const recent = sessionRow(f);
  f.setClock(TIME + MINUTE);
  assert.deepEqual(f.store.session(f.tokenHash), f.actor);
  assert.deepEqual(sessionRow(f), recent);
  f.reopen();
  assert.deepEqual(f.store.session(f.tokenHash), f.actor);
  assert.deepEqual(sessionRow(f), recent);
  assert.equal(sessionRow(f).expires_at, absoluteExpiry);
  f.setClock(TIME + 40 * MINUTE);
  assert.equal(f.store.session(f.tokenHash), null);
  assert.equal(sessionRow(f), undefined);
  f.setClock(TIME);
  assert.equal(f.store.session(f.tokenHash), null);
});

test('rollback does not change the stored absolute expiry of an active session', async t => {
  const f = await fixture(t), absoluteExpiry = sessionRow(f).expires_at;
  for (let offset = 25; offset < 480; offset += 25) {
    f.setClock(TIME + offset * MINUTE);
    assert.deepEqual(f.store.session(f.tokenHash), f.actor);
  }
  const recent = sessionRow(f);
  f.setClock(TIME + 450 * MINUTE);
  assert.deepEqual(f.store.session(f.tokenHash), f.actor);
  assert.deepEqual(sessionRow(f), recent);
  assert.equal(sessionRow(f).expires_at, absoluteExpiry);
  f.setClock(absoluteExpiry);
  assert.equal(f.store.session(f.tokenHash), null);
  f.setClock(TIME);
  assert.equal(f.store.session(f.tokenHash), null);
});

test('session checks sample one clock reading and reject invalid readings without a database write', async t => {
  const f = await fixture(t);
  f.sequence([TIME + 1000, TIME + 8 * 60 * MINUTE]);
  assert.deepEqual(f.store.session(f.tokenHash), f.actor);
  assert.equal(f.clockReads, 1); assert.equal(sessionRow(f).last_seen, TIME + 1000);
  const before = snapshot(f);
  for (const value of [-1, 0.5, NaN, Infinity, 8640000000000001]) {
    f.setClock(value);
    assert.throws(() => f.store.session(f.tokenHash), code('clock_unavailable', 503));
    assert.deepEqual(snapshot(f), before);
  }
  f.setClock(TIME + 1000);
  assert.deepEqual(f.store.session(f.tokenHash), f.actor);
});

test('both fixed product APIs preserve valid sessions during rollback and reject unavailable clocks without changing records', async t => {
  for (const product of ['callback', 'spreadsheet']) {
    const f = await fixture(t, product), app = appFor(t, f), signed = await login(app, f);
    const before = snapshot(f);
    f.setClock(TIME - 1000);
    const active = await request(app, 'GET', '/api/session', undefined, signed.headers);
    assert.equal(active.status, 200); assert.equal(active.body.product.id, product);
    assert.deepEqual(active.body.user, f.actor); assert.deepEqual(snapshot(f), before);
    f.setClock(NaN);
    const unavailable = await request(app, 'GET', '/api/session', undefined, signed.headers);
    assert.equal(unavailable.status, 503); assert.equal(unavailable.body.error.code, 'clock_unavailable');
    assert.deepEqual(snapshot(f), before);
    f.setClock(TIME);
    assert.equal((await request(app, 'POST', '/api/logout', {}, signed.headers)).status, 204);
    f.setClock(TIME - 1000);
    assert.equal((await request(app, 'GET', '/api/session', undefined, signed.headers)).status, 401);
    assert.equal(sessionRow(f, signed.tokenHash), undefined);
  }
});

test('terminal profile and rollback-safe source sessions preserve encrypted recovery without reviving authorization', async t => {
  const f = await fixture(t), profile = setProfileVersion(f, Number.MAX_SAFE_INTEGER);
  assert.throws(() => f.store.updateProfile(f.actor, profileInput(profile)), code('version_exhausted', 409));
  f.setClock(TIME - 1000);
  assert.deepEqual(f.store.session(f.tokenHash), f.actor);
  const before = snapshot(f), archive = path.join(f.root, 'account.prbk'), destination = path.join(f.root, 'restored');
  const created = await createEncryptedBackup({ dataDir: f.dataDir, outputFile: archive, passphrase: PASSPHRASE, product: f.product });
  const restored = await restoreEncryptedBackup({ backupFile: archive, dataDir: destination, passphrase: PASSPHRASE, product: f.product });
  assert.equal(created.sessionsIncluded, false); assert.equal(restored.sessionsRestored, false);
  assert.equal(restored.passwordResetRequired, true);
  const copy = openProductStore({ dataDir: destination, product: f.product, create: false });
  try {
    assert.deepEqual(copy.getProfile(f.actor), profile);
    assert.equal(copy.session(f.tokenHash), null);
    assert.equal(copy.findUser(f.actor.username).password_hash, RESTORE_DISABLED_PASSWORD);
  } finally { copy.close(); }
  assert.deepEqual(snapshot(f), before);
  assert.deepEqual(f.store.session(f.tokenHash), f.actor);
});
