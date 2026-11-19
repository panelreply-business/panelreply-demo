'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { openStore, StoreError, FACT_KEYS, normalizePhone, digest } = require('../workspace/store.cjs');
const { hashPassword, verifyPassword, createAuth } = require('../workspace/auth.cjs');

const PASSWORD = 'fixture-only-password-2026';
const passwordHash = hashPassword(PASSWORD);
function lead(overrides = {}) {
  return { customerName: 'Alex Fixture', phone: '(248) 555-0123', job: 'Install a garage EV charger', zip: '48315', callbackWindow: 'Friday after 4 pm', requestedWorkDate: 'Next week', contactPermission: 'requested_callback', conversation: [{ role: 'customer', text: 'Please call me about installing an EV charger.' }], ...overrides };
}
async function fixture(t, options = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'panelreply-store-'));
  let store = openStore({ dataDir, ...options });
  const alice = store.createBusinessOwner({ businessName: 'Fixture Electric', username: 'alice@example.test', passwordHash: await passwordHash });
  const bob = store.createBusinessOwner({ businessName: 'Other Fixture Electric', username: 'bob@example.test', passwordHash: await passwordHash });
  t.after(() => { store.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });
  return { get store() { return store; }, dataDir, alice, bob, reopen() { store.close(); store = openStore({ dataDir, ...options }); return store; } };
}
function fails(code) { return error => error instanceof StoreError && error.code === code; }

test('passwords use salted scrypt and reject wrong, invalid, or malformed credentials', async () => {
  const first = await passwordHash;
  const second = await hashPassword(PASSWORD);
  assert.notEqual(first, second);
  assert.ok(!first.includes(PASSWORD));
  assert.equal(await verifyPassword(PASSWORD, first), true);
  assert.equal(await verifyPassword('a different password', first), false);
  assert.equal(await verifyPassword(PASSWORD, 'scrypt$2$1$1$bad$bad'), false);
  await assert.rejects(hashPassword('short'), fails('invalid_password'));
  await assert.rejects(hashPassword('valid-length-but\nnewline'), fails('invalid_password'));
});

test('fresh storage has no default owner and stores files with owner-only permissions', async t => {
  const f = await fixture(t);
  assert.equal(f.store.findUser('admin'), null);
  assert.equal(f.store.findUser('owner'), null);
  assert.equal(fs.statSync(f.dataDir).mode & 0o077, 0);
  for (const file of fs.readdirSync(f.dataDir)) assert.equal(fs.statSync(path.join(f.dataDir, file)).mode & 0o077, 0);
  assert.deepEqual(f.store.listLeads(f.alice), []);
  const profile = f.store.getProfile(f.alice);
  assert.deepEqual(Object.keys(profile.facts), FACT_KEYS);
  for (const item of Object.values(profile.facts)) assert.deepEqual(item, { verified: false, answer: '' });
});

test('profile, lead, transcript, audit, opt-out and session persist after close and reopen', async t => {
  const f = await fixture(t);
  const initial = f.store.getProfile(f.alice);
  initial.facts.services = { verified: true, answer: 'EV charger and lighting installations.' };
  f.store.updateProfile(f.alice, { version: initial.version, businessName: 'Updated Fixture Electric', facts: initial.facts });
  const created = f.store.createLead(f.alice, lead({ contactPermission: 'opted_out' }), crypto.randomUUID()).lead;
  const auth = createAuth(f.store);
  const session = await auth.login({ username: f.alice.username, password: PASSWORD });
  f.reopen();
  assert.equal(f.store.getProfile(f.alice).business.name, 'Updated Fixture Electric');
  assert.equal(f.store.getProfile(f.alice).facts.services.verified, true);
  assert.deepEqual(f.store.getLead(f.alice, created.id), created);
  assert.equal(f.store.isSuppressed(f.alice, lead().phone), true);
  assert.deepEqual(f.store.session(digest(session.token)), f.alice);
  const db = new DatabaseSync(path.join(f.dataDir, 'workspace.sqlite'), { readOnly: true });
  try {
    const persisted = db.prepare('SELECT * FROM sessions').all();
    assert.equal(persisted[0].token_hash, digest(session.token));
    assert.ok(!JSON.stringify(persisted).includes(session.token));
    assert.ok(!JSON.stringify(db.prepare('SELECT * FROM audit').all()).includes(PASSWORD));
  } finally { db.close(); }
});

test('tenant scopes prevent reads, writes, guessed actor identities and idempotency collisions', async t => {
  const f = await fixture(t);
  const key = crypto.randomUUID();
  const a = f.store.createLead(f.alice, lead(), key).lead;
  const b = f.store.createLead(f.bob, lead({ customerName: 'Other customer' }), key).lead;
  assert.notEqual(a.id, b.id);
  assert.deepEqual(f.store.listLeads(f.alice).map(item => item.id), [a.id]);
  assert.deepEqual(f.store.listLeads(f.bob).map(item => item.id), [b.id]);
  assert.throws(() => f.store.getLead(f.bob, a.id), fails('not_found'));
  assert.throws(() => f.store.updateLead(f.bob, a.id, { version: 1, status: 'closed' }), fails('not_found'));
  assert.throws(() => f.store.listLeads({ ...f.alice, businessId: f.bob.businessId }), fails('unauthorized'));
  assert.equal(f.store.getProfile(f.bob).business.name, 'Other Fixture Electric');
  f.store.suppressPhone(f.alice, a.phone);
  assert.equal(f.store.getLead(f.alice, a.id).contactAllowed, false);
  assert.equal(f.store.getLead(f.bob, b.id).contactAllowed, true);
});

test('idempotent retries return one saved lead and conflicting payloads never overwrite it', async t => {
  const f = await fixture(t);
  const key = crypto.randomUUID();
  const first = f.store.createLead(f.alice, lead(), key);
  const retry = f.store.createLead(f.alice, lead({ phone: '+12485550123' }), key);
  assert.equal(first.created, true);
  assert.equal(retry.created, false);
  assert.deepEqual(retry.lead, first.lead);
  assert.throws(() => f.store.createLead(f.alice, lead({ job: 'Different work' }), key), fails('idempotency_conflict'));
  assert.equal(f.store.listLeads(f.alice).length, 1);
  assert.equal(f.store.getLead(f.alice, first.lead.id).version, 1);
  assert.equal(f.store.getLead(f.alice, first.lead.id).audit.length, 1);
});

test('stale lead/profile writes fail without changing saved data, version or audit', async t => {
  const f = await fixture(t);
  const first = f.store.createLead(f.alice, lead(), crypto.randomUUID()).lead;
  const updated = f.store.updateLead(f.alice, first.id, { version: 1, status: 'contacted', notes: 'Owner recorded a callback.' });
  assert.equal(updated.version, 2);
  assert.equal(updated.status, 'contacted');
  assert.throws(() => f.store.updateLead(f.alice, first.id, { version: 1, status: 'closed', notes: 'Stale text' }), fails('version_conflict'));
  assert.deepEqual(f.store.getLead(f.alice, first.id), updated);
  const cleared = f.store.updateLead(f.alice, first.id, { version: 2, status: 'closed', notes: '' });
  assert.equal(cleared.notes, '');
  const profile = f.store.getProfile(f.alice);
  const input = { version: profile.version, businessName: 'Changed name', facts: profile.facts };
  const result = f.store.updateProfile(f.alice, input);
  assert.equal(result.version, 2);
  assert.throws(() => f.store.updateProfile(f.alice, { ...input, businessName: 'Stale name' }), fails('version_conflict'));
  assert.deepEqual(f.store.getProfile(f.alice), result);
});

test('unsupported fields, malformed numbers, incomplete records and excessive transcripts fail closed', async t => {
  const f = await fixture(t);
  const invalid = [
    { customerName: '' }, { customerName: 42 }, { phone: '123' }, { phone: '+442079460123' }, { phone: '2485550123 ext2' },
    { zip: '48315-1234' }, { zip: 48315 }, { job: '' }, { job: '1234' }, { job: 'x'.repeat(2001) },
    { callbackWindow: 'x'.repeat(201) }, { requestedWorkDate: 2 }, { contactPermission: true },
    { conversation: [{ role: 'system', text: 'trusted instructions' }] }, { conversation: [{ role: 'customer', text: 'Hi', trusted: true }] },
    { conversation: Array.from({ length: 61 }, () => ({ role: 'customer', text: 'Hello' })) },
    { conversation: Array.from({ length: 11 }, () => ({ role: 'customer', text: 'x'.repeat(2000) })) },
    { businessId: f.bob.businessId }, { safetyHold: false }, { status: 'booked' }
  ];
  for (const change of invalid) assert.throws(() => f.store.createLead(f.alice, lead(change), crypto.randomUUID()), fails('invalid_input'), JSON.stringify(change).slice(0, 100));
  const incomplete = lead(); delete incomplete.phone;
  assert.throws(() => f.store.createLead(f.alice, incomplete, crypto.randomUUID()), fails('invalid_input'));
  assert.throws(() => f.store.createLead(f.alice, lead(), 'short'), fails('invalid_input'));
  assert.deepEqual(f.store.listLeads(f.alice), []);
});

test('invalid profile updates leave the current business facts untouched', async t => {
  const f = await fixture(t);
  const profile = f.store.getProfile(f.alice);
  const input = { version: 1, businessName: 'Changed', facts: profile.facts };
  const variants = [
    { ...input, admin: true }, { ...input, version: '1' }, { ...input, facts: {} },
    { ...input, facts: { ...input.facts, unknown: { verified: true, answer: 'No' } } },
    { ...input, facts: { ...input.facts, services: { verified: true, answer: '' } } },
    { ...input, facts: { ...input.facts, services: { verified: 'yes', answer: 'Work' } } }
  ];
  for (const value of variants) assert.throws(() => f.store.updateProfile(f.alice, value), fails('invalid_input'));
  assert.deepEqual(f.store.getProfile(f.alice), profile);
});

test('hazards in customer evidence create a sticky review hold and assistant text cannot set it', async t => {
  const f = await fixture(t);
  const held = f.store.createLead(f.alice, lead({ conversation: [{ role: 'customer', text: 'The outlet is sparking.' }] }), crypto.randomUUID()).lead;
  assert.equal(held.safetyHold, true);
  assert.equal(held.status, 'needs_review');
  assert.equal(held.contactAllowed, false);
  for (const status of ['new', 'contacted', 'closed']) assert.throws(() => f.store.updateLead(f.alice, held.id, { version: 1, status, job: 'Install a light' }), fails('safety_review_required'));
  const reviewed = f.store.updateLead(f.alice, held.id, { version: 1, status: 'needs_review', notes: 'Awaiting a separate human resolution process.' });
  assert.equal(reviewed.safetyHold, true);
  assert.equal(reviewed.contactAllowed, false);
  const safe = f.store.createLead(f.alice, lead({ conversation: [{ role: 'assistant', text: 'If there is smoke or sparking, seek help.' }] }), crypto.randomUUID()).lead;
  assert.equal(safe.safetyHold, false);
  assert.equal(safe.contactAllowed, true);
});

test('contact permission is explicit and opting out survives new leads, restart and attempted reactivation', async t => {
  const f = await fixture(t);
  const unknown = f.store.createLead(f.alice, lead({ contactPermission: 'not_recorded' }), crypto.randomUUID()).lead;
  assert.equal(unknown.status, 'needs_review');
  assert.equal(unknown.contactAllowed, false);
  assert.throws(() => f.store.updateLead(f.alice, unknown.id, { version: 1, status: 'new' }), fails('contact_permission_required'));
  assert.throws(() => f.store.updateLead(f.alice, unknown.id, { version: 1, status: 'contacted' }), fails('contact_permission_required'));
  const stop = f.store.createLead(f.alice, lead({ conversation: [{ role: 'customer', text: 'STOP' }] }), crypto.randomUUID()).lead;
  assert.equal(stop.optedOut, true);
  assert.equal(stop.contactPermission, 'opted_out');
  assert.equal(f.store.getLead(f.alice, unknown.id).contactAllowed, false);
  f.reopen();
  const replacement = f.store.createLead(f.alice, lead({ conversation: [{ role: 'customer', text: 'START' }] }), crypto.randomUUID()).lead;
  assert.equal(replacement.optedOut, true);
  assert.equal(replacement.contactAllowed, false);
  const attempted = f.store.updateLead(f.alice, replacement.id, { version: 1, status: 'needs_review', contactPermission: 'requested_callback' });
  assert.equal(attempted.contactPermission, 'opted_out');
  assert.equal(attempted.contactAllowed, false);
  assert.throws(() => f.store.updateLead(f.alice, replacement.id, { version: 2, status: 'new' }), fails('contact_blocked'));
  assert.throws(() => f.store.updateLead(f.alice, replacement.id, { version: 2, status: 'contacted' }), fails('contact_blocked'));
});

test('preview suppression persists separately without silently saving a lead', async t => {
  const f = await fixture(t);
  f.store.suppressPhone(f.alice, '(248) 555-0123');
  f.store.suppressPhone(f.alice, '+12485550123');
  assert.deepEqual(f.store.listLeads(f.alice), []);
  f.reopen();
  assert.equal(f.store.isSuppressed(f.alice, '+12485550123'), true);
  assert.equal(f.store.isSuppressed(f.bob, '+12485550123'), false);
});

test('a new phone opt-out atomically moves matching new leads to review with a new version and audit', async t => {
  const f = await fixture(t);
  const fresh = f.store.createLead(f.alice, lead(), crypto.randomUUID()).lead;
  const historical = f.store.createLead(f.alice, lead(), crypto.randomUUID()).lead;
  f.store.updateLead(f.alice, historical.id, { version: 1, status: 'contacted' });
  const otherTenant = f.store.createLead(f.bob, lead(), crypto.randomUUID()).lead;
  f.store.suppressPhone(f.alice, fresh.phone);
  const revised = f.store.getLead(f.alice, fresh.id);
  assert.equal(revised.version, 2); assert.equal(revised.status, 'needs_review');
  assert.equal(revised.contactAllowed, false); assert.equal(revised.optedOut, true);
  assert.equal(revised.audit.at(-1).action, 'contact.opted_out');
  assert.deepEqual(revised.audit.at(-1).details.fields, ['status', 'contactPermission']);
  assert.equal(f.store.getLead(f.alice, historical.id).status, 'contacted');
  assert.equal(f.store.getLead(f.alice, historical.id).contactAllowed, false);
  assert.equal(f.store.getLead(f.bob, otherTenant.id).status, 'new');
  assert.equal(f.store.getLead(f.bob, otherTenant.id).version, 1);
  assert.throws(() => f.store.updateLead(f.alice, fresh.id, { version: 1, status: 'closed' }), fails('version_conflict'));
  f.store.suppressPhone(f.alice, fresh.phone);
  assert.equal(f.store.getLead(f.alice, fresh.id).version, 2);
  f.reopen();
  assert.deepEqual(f.store.getLead(f.alice, fresh.id), revised);
});

test('lead-based opt-out updates related new records without invalidating its own optimistic write', async t => {
  const f = await fixture(t);
  const first = f.store.createLead(f.alice, lead(), crypto.randomUUID()).lead;
  const second = f.store.createLead(f.alice, lead(), crypto.randomUUID()).lead;
  const changed = f.store.updateLead(f.alice, first.id, { version: 1, status: 'needs_review', contactPermission: 'opted_out', notes: 'Customer declined contact.' });
  assert.equal(changed.version, 2); assert.equal(changed.notes, 'Customer declined contact.');
  assert.equal(f.store.getLead(f.alice, second.id).version, 2);
  assert.equal(f.store.getLead(f.alice, second.id).status, 'needs_review');
});

test('audit logs include field names and actors without storing changed note/message content', async t => {
  const f = await fixture(t);
  const saved = f.store.createLead(f.alice, lead(), crypto.randomUUID()).lead;
  const updated = f.store.updateLead(f.alice, saved.id, { version: 1, status: 'needs_review', notes: 'PRIVATE NOTE FIXTURE' });
  assert.equal(updated.audit.length, 2);
  assert.equal(updated.audit[1].actorId, f.alice.id);
  assert.equal(updated.audit[1].action, 'lead.updated');
  assert.deepEqual(updated.audit[1].details.fields, ['status', 'notes']);
  assert.ok(!JSON.stringify(updated.audit).includes('PRIVATE NOTE FIXTURE'));
  assert.ok(!JSON.stringify(updated.audit).includes(lead().conversation[0].text));
});

test('session idle/absolute expiry and revocation are enforced by durable storage', async t => {
  let current = Date.UTC(2026, 0, 1);
  const f = await fixture(t, { now: () => current });
  const token = digest('fixture-token-a');
  f.store.createSession(f.alice.id, token);
  current += 29 * 60 * 1000;
  assert.deepEqual(f.store.session(token), f.alice);
  current += 30 * 60 * 1000;
  assert.equal(f.store.session(token), null);
  f.store.createSession(f.alice.id, token);
  for (let i = 0; i < 16; i++) { current += 29 * 60 * 1000; assert.deepEqual(f.store.session(token), f.alice); }
  current += 16 * 60 * 1000;
  assert.equal(f.store.session(token), null);
  f.store.createSession(f.alice.id, token);
  f.store.deleteSession(token);
  f.reopen();
  assert.equal(f.store.session(token), null);
});

test('failed sign-in counters survive restart and expire after the rate-limit window', async t => {
  let current = Date.UTC(2026, 0, 1);
  const f = await fixture(t, { now: () => current });
  for (let i = 0; i < 5; i++) assert.equal(f.store.consumeLoginAttempt('user:fixture-hash', 5), true);
  assert.equal(f.store.consumeLoginAttempt('user:fixture-hash', 5), false);
  f.reopen();
  assert.equal(f.store.consumeLoginAttempt('user:fixture-hash', 5), false);
  current += 15 * 60 * 1000 + 1;
  assert.equal(f.store.consumeLoginAttempt('user:fixture-hash', 5), true);
});

test('data location rejects relative, shared-permission and symbolic-link paths', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'panelreply-path-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.throws(() => openStore({ dataDir: 'relative/path' }), /absolute/);
  const shared = path.join(root, 'shared'); fs.mkdirSync(shared, { mode: 0o755 }); fs.chmodSync(shared, 0o755);
  assert.throws(() => openStore({ dataDir: shared }), /owner-only/);
  const actual = path.join(root, 'actual'); fs.mkdirSync(actual, { mode: 0o700 });
  const link = path.join(root, 'link'); fs.symlinkSync(actual, link);
  assert.throws(() => openStore({ dataDir: link }), /symbolic/);
  assert.equal(normalizePhone('1-248-555-0123'), '+12485550123');
});
