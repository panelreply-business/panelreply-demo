'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { openProductStore } = require('../workspace/products.cjs');
const { hashPassword } = require('../workspace/auth.cjs');
const { validateDatabase, createEncryptedBackup, restoreEncryptedBackup, MAX_DATABASE_BYTES } = require('../workspace/backup.cjs');
const { validateCallbackDatabase } = require('../workspace/callback-tasks.cjs');
const { seedCallbackCapacity, NOW } = require('./helpers/callback-capacity-fixture.cjs');

const HASH = hashPassword('Synthetic callback resource password 2026!');
async function fixture(t, options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'panelreply-callback-resources-')), dataDir = path.join(directory, 'source');
  const store = openProductStore({ dataDir, product: 'callback', now: () => NOW });
  const owner = store.createBusinessOwner({ businessName: 'Synthetic Callback Capacity', username: 'capacity-owner@example.test', passwordHash: await HASH });
  const other = store.createBusinessOwner({ businessName: 'Other Capacity Business', username: 'capacity-other@example.test', passwordHash: await HASH });
  const seeded = seedCallbackCapacity({ store, owner, leadCount: 10, taskCount: 40, revisions: 3, dense: false, ...options });
  t.after(() => { store.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  return { directory, dataDir, store, owner, other, ...seeded,
    db(fn) { const db = new DatabaseSync(store.filename, { readOnly: true }); try { return fn(db); } finally { db.close(); } } };
}

function callbackValidationQueries(db) {
  const queries = [], observed = { prepare(sql) { queries.push(sql); return db.prepare(sql); } };
  validateCallbackDatabase(observed, (code, message) => { throw Object.assign(new Error(message), { code }); });
  return queries;
}

test('callback queue reads no transcript or audit history and keeps current tenant/contact controls', async t => {
  const f = await fixture(t), saved = f.store.getLead(f.owner, f.leads[0].id), originalGetLead = f.store.getLead;
  f.store.getLead = () => { throw new Error('A callback queue must not materialize a full request history.'); };
  try {
    const all = f.store.listCallbackTasks(f.owner, { state: 'all', limit: 500 }); assert.equal(all.total, 40);
    assert.equal(f.store.listCallbackTasks(f.other, { state: 'all' }).total, 0);
    assert.throws(() => f.store.listCallbackTasks(f.other, { leadId: f.leads[0].id }), { code: 'not_found' });
    assert.throws(() => f.store.listCallbackTasks({ ...f.owner, businessId: f.other.businessId }), { code: 'unauthorized' });
    assert.throws(() => f.store.listCallbackTasks(null), { code: 'unauthorized' });
    for (const row of all.tasks) { assert.equal(Object.hasOwn(row, 'conversation'), false); assert.equal(Object.hasOwn(row, 'audit'), false); }
    f.store.suppressPhone(f.owner, f.leads[0].phone);
    const blocked = f.store.listCallbackTasks(f.owner, { leadId: f.leads[0].id, state: 'all' });
    assert.ok(blocked.tasks.length); assert.ok(blocked.tasks.every(task => task.blockReason === 'contact_blocked' && task.contactAllowed === false));
    assert.ok(blocked.tasks.every(task => task.leadVersion === saved.version + 1));
  } finally { f.store.getLead = originalGetLead; }
  const current = f.store.getLead(f.owner, f.leads[0].id);
  assert.deepEqual(current.conversation, saved.conversation); assert.ok(current.audit.length > saved.audit.length);
});

test('queue summary preserves every request restriction without changing the full request contract', async t => {
  const f = await fixture(t, { leadCount: 5, taskCount: 5, revisions: 1, mixedStates: false });
  f.store.holdPhone(f.owner, f.leads[0].phone);
  f.store.suppressPhone(f.owner, f.leads[1].phone);
  f.store.updateLead(f.owner, f.leads[2].id, { version: f.leads[2].version, status: 'needs_review', contactPermission: 'not_recorded' });
  f.store.updateLead(f.owner, f.leads[3].id, { version: f.leads[3].version, status: 'closed' });
  f.store.updateLead(f.owner, f.leads[4].id, { version: f.leads[4].version, status: 'needs_review' });
  const reasons = ['safety_review_required', 'contact_blocked', 'contact_permission_required', 'request_closed', 'request_review_required'];
  for (let index = 0; index < 5; index++) {
    const lead = f.store.getLead(f.owner, f.leads[index].id), task = f.store.listCallbackTasks(f.owner, { leadId: lead.id }).tasks[0];
    assert.equal(task.blockReason, reasons[index]); assert.equal(task.contactAllowed, false);
    assert.equal(task.customerName, lead.customerName); assert.equal(task.phone, lead.phone); assert.equal(task.leadVersion, lead.version); assert.equal(task.requestStatus, lead.status);
    assert.ok(lead.audit.length); assert.deepEqual(lead.conversation, f.transcript);
  }
});

test('task-only export materialization does not read request histories a second time', async t => {
  const f = await fixture(t), original = f.store.getLead;
  f.store.getLead = () => { throw new Error('Task export must not reload full histories.'); };
  try {
    const exported = f.store.exportBusiness(f.owner);
    assert.equal(exported.callbackTasks.length, 40); assert.equal(exported.leads.length, 10);
    for (const lead of exported.leads) { assert.deepEqual(lead.conversation, f.transcript); assert.equal(lead.audit.length, 13); }
    assert.deepEqual(f.store.exportBusiness(f.other).callbackTasks, []);
  } finally { f.store.getLead = original; }
});

test('callback recovery validation scans ledgers a bounded number of times as record count grows', async t => {
  const small = await fixture(t, { leadCount: 2, taskCount: 4, revisions: 2 });
  const large = await fixture(t, { leadCount: 50, taskCount: 200, revisions: 10 });
  const a = small.db(callbackValidationQueries), b = large.db(callbackValidationQueries);
  assert.equal(a.length, b.length, 'Database statement count must not grow per task or operation.');
  assert.ok(b.length <= 16, 'Recovery must use bounded ledger scans, not per-record database lookups.');
  large.db(db => validateDatabase(db));
});

test('near-capacity callback archive restores all task states, histories, restrictions and page boundaries', async t => {
  const f = await fixture(t, { leadCount: 500, taskCount: 2000, revisions: 10, dense: true });
  f.store.suppressPhone(f.owner, f.leads[0].phone);
  const expected = f.store.exportBusiness(f.owner);
  assert.equal(expected.callbackTasks.length, 2000); assert.equal(expected.leads.length, 500);
  const before = f.db(db => { const counts = validateDatabase(db); assert.equal(counts.callbackTasks, 2000); assert.equal(counts.callbackOperations, 20000); assert.ok(callbackValidationQueries(db).length <= 16); return counts; });
  assert.ok(fs.statSync(f.store.filename).size > MAX_DATABASE_BYTES * 0.85, 'The recovery fixture must exercise a database near the supported archive size.');
  const archive = path.join(f.directory, 'capacity.prbk'), destination = path.join(f.directory, 'restored'), passphrase = 'Synthetic callback capacity archive phrase 2026!';
  const backup = await createEncryptedBackup({ dataDir: f.dataDir, product: 'callback', outputFile: archive, passphrase });
  const restored = await restoreEncryptedBackup({ backupFile: archive, dataDir: destination, product: 'callback', passphrase });
  assert.deepEqual(backup.counts, before); assert.deepEqual(restored.counts, before);
  const recovered = openProductStore({ dataDir: destination, product: 'callback', now: () => NOW });
  try {
    assert.deepEqual(recovered.exportBusiness(f.owner), expected);
    assert.equal(recovered.findUser(f.owner.username).password_hash, 'disabled:restore-required');
    assert.equal(recovered.isSuppressed(f.owner, f.leads[0].phone), true);
    const ids = [];
    for (let offset = 0; offset < 2000; offset += 500) { const page = recovered.listCallbackTasks(f.owner, { state: 'all', limit: 500, offset }); assert.equal(page.tasks.length, 500); assert.equal(page.total, 2000); ids.push(...page.tasks.map(task => task.id)); }
    assert.equal(new Set(ids).size, 2000); assert.equal(recovered.listCallbackTasks(f.owner, { state: 'all', limit: 500, offset: 2000 }).tasks.length, 0);
    assert.equal(recovered.listCallbackTasks(f.other, { state: 'all' }).total, 0);
    const byState = ['open', 'completed', 'cancelled'].map(state => recovered.listCallbackTasks(f.owner, { state, limit: 1 }).total);
    assert.ok(byState.every(count => count > 0)); assert.equal(byState.reduce((sum, count) => sum + count, 0), 2000);
    assert.throws(() => recovered.createCallbackTask(f.owner, f.leads[0].id, { leadVersion: expected.leads.find(lead => lead.id === f.leads[0].id).version, kind: 'follow_up', dueAt: new Date(NOW).toISOString(), timeZone: 'UTC', notes: '' }, crypto.randomUUID()), { code: 'callback_history_limit' });
  } finally { recovered.close(); }
  assert.deepEqual(f.store.exportBusiness(f.owner), expected);
});
