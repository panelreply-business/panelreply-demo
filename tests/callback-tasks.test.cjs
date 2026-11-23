'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { openStore, SCHEMAS, SCHEMA_VERSION, assertWorkspaceSchema } = require('../workspace/store.cjs');
const { hashPassword } = require('../workspace/auth.cjs');
const { createEncryptedBackup, restoreEncryptedBackup, validateDatabase } = require('../workspace/backup.cjs');
const { TASK_TABLE_SQL, MAX_TASKS_PER_BUSINESS, MAX_TASK_OPERATIONS } = require('../workspace/callback-tasks.cjs');
const { validateSaveReceipt } = require('../workspace/schedule.js');

const PASSWORD = hashPassword('Synthetic callback schedule password 2026!');
const START = Date.parse('2026-11-23T15:00:00.000Z');
const LEAD = { customerName: 'Jamie Schedule', phone: '+12485550123', job: 'Install a garage EV charger', zip: '48315', callbackWindow: 'Monday afternoon', requestedWorkDate: 'Next month', contactPermission: 'requested_callback', conversation: [] };
const SCHEDULE = { kind: 'callback', dueAt: '2026-11-23T16:00:00.000Z', timeZone: 'America/Detroit', notes: 'Synthetic scheduling note.' };
async function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'panelreply-callback-tasks-'));
  const dataDir = path.join(directory, 'source');
  let at = START, store = openStore({ dataDir, now: () => at });
  const hash = await PASSWORD;
  const owner = store.createBusinessOwner({ businessName: 'Scheduling Fixture', username: 'schedule-owner@example.test', passwordHash: hash });
  const other = store.createBusinessOwner({ businessName: 'Other Fixture', username: 'other-schedule@example.test', passwordHash: hash });
  const lead = store.createLead(owner, LEAD, crypto.randomUUID()).lead;
  t.after(() => { store.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  return { directory, dataDir, owner, other, lead, get store() { return store; }, now: () => at,
    setNow(value) { at = value; }, advance(ms) { at += ms; },
    reopen() { store.close(); store = openStore({ dataDir, now: () => at }); },
    create(changes = {}, key = crypto.randomUUID(), id = lead.id, actor = owner) { return store.createCallbackTask(actor, id, { leadVersion: store.getLead(actor, id).version, ...SCHEDULE, ...changes }, key); },
    update(task, action, changes = {}, key = crypto.randomUUID()) { return store.updateCallbackTask(owner, task.id, { leadVersion: store.getLead(owner, task.leadId).version, version: task.version, action, notes: task.notes, ...(action === 'complete' ? { outcome: 'reached' } : action === 'reschedule' ? { dueAt: SCHEDULE.dueAt, timeZone: SCHEDULE.timeZone } : {}), ...changes }, key); },
    db(fn) { const database = new DatabaseSync(store.filename, { enableForeignKeyConstraints: true }); try { return fn(database); } finally { database.close(); } },
    snapshot() { return this.db(db => Object.fromEntries(Object.keys(SCHEMAS[SCHEMA_VERSION].tables).filter(name => !['sessions', 'login_attempts'].includes(name)).map(name => [name, db.prepare('SELECT * FROM ' + name + ' ORDER BY rowid').all().map(row => ({ ...row }))]))); }
  };
}

test('callback scheduling persists UTC instant, zone, notes and a parent revision without changing intake preferences', async t => {
  const f = await fixture(t); const result = f.create();
  assert.equal(result.created, true); assert.equal(result.replayed, false); assert.equal(result.task.status, 'scheduled'); assert.equal(result.task.kind, 'callback');
  assert.equal(result.task.version, 1); assert.equal(result.lead.version, 2); assert.equal(result.task.leadVersion, 2);
  assert.equal(result.task.dueAt, SCHEDULE.dueAt); assert.equal(result.task.timeZone, 'America/Detroit');
  assert.equal(result.task.contactAllowed, true); assert.equal(result.task.blockReason, null); assert.equal(result.task.dueState, 'upcoming');
  assert.equal(result.task.completedAt, null); assert.equal(result.task.cancelledAt, null);
  assert.equal(result.lead.callbackWindow, LEAD.callbackWindow); assert.equal(result.lead.requestedWorkDate, LEAD.requestedWorkDate);
  const before = f.snapshot(); f.reopen(); assert.deepEqual(f.snapshot(), before);
  assert.deepEqual(f.store.listCallbackTasks(f.owner).tasks, [result.task]);
});

test('callback schedule audit identifies actor, action and task without copying notes or contact data', async t => {
  const f = await fixture(t); const result = f.create();
  const entry = result.lead.audit.at(-1);
  assert.equal(entry.action, 'callback.scheduled'); assert.equal(entry.version, 2); assert.equal(entry.actorId, f.owner.id); assert.equal(entry.details.taskId, result.task.id);
  assert.deepEqual(entry.details.fields, ['kind', 'dueAt', 'timeZone', 'notes', 'status']);
  for (const privateValue of [SCHEDULE.notes, LEAD.customerName, LEAD.phone]) assert.ok(!JSON.stringify(entry).includes(privateValue));
});

test('callback client receipts preserve extended-year chronology for fresh writes and current-parent replays', async t => {
  const f = await fixture(t), key = crypto.randomUUID(), input = { leadVersion: 1, ...SCHEDULE };
  const createCommand = { method: 'POST', leadId: f.lead.id, body: input };
  const first = f.store.createCallbackTask(f.owner, f.lead.id, input, key);
  f.setNow(Date.parse('+010000-01-01T00:00:00.000Z'));
  f.store.updateLead(f.owner, f.lead.id, { version: first.lead.version, status: 'new', notes: 'Later supported clock' });
  const replay = f.store.createCallbackTask(f.owner, f.lead.id, input, key);
  assert.equal(replay.lead.updatedAt, '+010000-01-01T00:00:00.000Z');
  assert.equal(replay.task.updatedAt, first.task.updatedAt);
  assert.equal(validateSaveReceipt(replay, createCommand), replay);
  const updateInput = { leadVersion: replay.lead.version, version: first.task.version, action: 'reschedule',
    dueAt: SCHEDULE.dueAt, timeZone: 'UTC', notes: 'Updated task at the supported clock' };
  const changed = f.store.updateCallbackTask(f.owner, first.task.id, updateInput, crypto.randomUUID());
  assert.equal(changed.task.createdAt, first.task.createdAt);
  assert.equal(changed.task.updatedAt, replay.lead.updatedAt);
  assert.equal(validateSaveReceipt(changed, { method: 'PATCH', leadId: f.lead.id, taskId: first.task.id,
    taskBefore: first.task, body: updateInput }), changed);
  const nextInput = { ...input, leadVersion: changed.lead.version, kind: 'follow_up' };
  const next = f.store.createCallbackTask(f.owner, f.lead.id, nextInput, crypto.randomUUID());
  assert.equal(validateSaveReceipt(next, { ...createCommand, body: nextInput }), next);
  assert.equal(f.db(db => validateDatabase(db)).callbackTasks, 2);
});

test('callback client receipts accept archive-valid maximum parent history revisions without relaxing task limits', async t => {
  const f = await fixture(t), key = crypto.randomUUID(), input = { leadVersion: 1, ...SCHEDULE };
  const first = f.store.createCallbackTask(f.owner, f.lead.id, input, key);
  f.db(db => {
    db.prepare('UPDATE leads SET version=? WHERE id=?').run(Number.MAX_SAFE_INTEGER, f.lead.id);
    db.prepare('INSERT INTO audit VALUES (?,?,?,?,?,?,?,?)').run(crypto.randomUUID(), f.owner.businessId, f.lead.id, f.owner.id,
      'lead.updated', Number.MAX_SAFE_INTEGER, START, JSON.stringify({ fields: ['notes'] }));
    assert.equal(validateDatabase(db).callbackTasks, 1);
  });
  const before = f.snapshot(), replay = f.store.createCallbackTask(f.owner, f.lead.id, input, key);
  const command = { method: 'POST', leadId: f.lead.id, body: input };
  assert.equal(replay.replayed, true); assert.equal(replay.task.id, first.task.id);
  assert.equal(replay.lead.version, Number.MAX_SAFE_INTEGER);
  assert.equal(replay.lead.audit.at(-1).version, Number.MAX_SAFE_INTEGER);
  assert.equal(replay.task.version, 1);
  assert.equal(validateSaveReceipt(replay, command), replay);
  assert.throws(() => validateSaveReceipt({ ...replay, task: { ...replay.task, version: Number.MAX_SAFE_INTEGER } }, command), /incomplete/);
  assert.deepEqual(f.snapshot(), before);
});

test('lost create response replays once and reports current restrictions after a later STOP', async t => {
  const f = await fixture(t), key = crypto.randomUUID(), input = { leadVersion: 1, ...SCHEDULE };
  const first = f.store.createCallbackTask(f.owner, f.lead.id, input, key);
  f.store.suppressPhone(f.owner, f.lead.phone); const before = f.snapshot();
  const replay = f.store.createCallbackTask(f.owner, f.lead.id, input, key);
  assert.equal(replay.created, false); assert.equal(replay.replayed, true); assert.equal(replay.task.id, first.task.id);
  assert.equal(replay.task.contactAllowed, false); assert.equal(replay.task.blockReason, 'contact_blocked');
  assert.equal(replay.lead.version, 3); assert.deepEqual(f.snapshot(), before);
  assert.throws(() => f.store.createCallbackTask(f.owner, f.lead.id, { ...input, notes: 'Different intent' }, key), { code: 'idempotency_conflict' });
});

test('reschedule is versioned, idempotent and preserves callback kind', async t => {
  const f = await fixture(t); const first = f.create(); f.advance(1000);
  const input = { leadVersion: first.lead.version, version: first.task.version, action: 'reschedule', dueAt: '2026-12-01T18:30:00.000Z', timeZone: 'America/Chicago', notes: 'Revised plan' }, key = crypto.randomUUID();
  const changed = f.store.updateCallbackTask(f.owner, first.task.id, input, key);
  assert.equal(changed.task.version, 2); assert.equal(changed.lead.version, 3); assert.equal(changed.task.kind, 'callback');
  assert.equal(changed.task.dueAt, input.dueAt); assert.equal(changed.task.timeZone, input.timeZone); assert.equal(changed.lead.audit.at(-1).action, 'callback.rescheduled');
  const before = f.snapshot(); assert.equal(f.store.updateCallbackTask(f.owner, first.task.id, input, key).replayed, true); assert.deepEqual(f.snapshot(), before);
  assert.throws(() => f.store.updateCallbackTask(f.owner, first.task.id, { ...input, dueAt: SCHEDULE.dueAt }, key), { code: 'idempotency_conflict' });
});

for (const outcome of ['reached', 'no_answer', 'voicemail', 'other']) test('reported callback outcome ' + outcome + ' closes only its task and supports a separate follow-up', async t => {
  const f = await fixture(t); const first = f.create(); f.advance(1000);
  const completed = f.update(first.task, 'complete', { outcome, notes: 'Owner recorded ' + outcome });
  assert.equal(completed.task.status, 'completed'); assert.equal(completed.task.outcome, outcome); assert.equal(completed.task.completedAt, new Date(f.now()).toISOString()); assert.equal(completed.task.cancelledAt, null);
  assert.equal(completed.lead.status, 'new'); assert.equal(completed.lead.requestedWorkDate, LEAD.requestedWorkDate);
  const followup = f.create({ kind: 'follow_up', dueAt: '2026-11-24T18:00:00.000Z' });
  assert.equal(followup.task.kind, 'follow_up'); assert.notEqual(followup.task.id, first.task.id);
  assert.equal(f.store.listCallbackTasks(f.owner, { state: 'open' }).total, 1); assert.equal(f.store.listCallbackTasks(f.owner, { state: 'completed' }).total, 1);
  assert.throws(() => f.update(completed.task, 'reschedule'), { code: 'task_finished' });
});

test('cancel can resolve a blocked pending task and cannot be reopened through reschedule', async t => {
  const f = await fixture(t); const first = f.create(); f.store.suppressPhone(f.owner, f.lead.phone); f.advance(1000);
  const cancelled = f.update(first.task, 'cancel', { notes: 'Cancel after STOP' });
  assert.equal(cancelled.task.status, 'cancelled'); assert.equal(cancelled.task.cancelledAt, new Date(f.now()).toISOString()); assert.equal(cancelled.task.completedAt, null); assert.equal(cancelled.task.outcome, '');
  assert.equal(f.store.listCallbackTasks(f.owner).total, 0); assert.equal(f.store.listCallbackTasks(f.owner, { state: 'cancelled' }).total, 1);
  assert.throws(() => f.update(cancelled.task, 'reschedule'), { code: 'task_finished' });
});

test('create and task mutation retry identifiers share one business-scoped operation namespace', async t => {
  const f = await fixture(t), key = crypto.randomUUID(); const first = f.create({}, key), before = f.snapshot();
  assert.throws(() => f.update(first.task, 'cancel', {}, key), { code: 'idempotency_conflict' });
  const second = f.store.createLead(f.owner, { ...LEAD, phone: '+15865550124' }, crypto.randomUUID()).lead;
  assert.throws(() => f.create({}, key, second.id), { code: 'idempotency_conflict' });
  assert.equal(f.store.listCallbackTasks(f.owner, { state: 'all' }).total, 1);
  const otherLead = f.store.createLead(f.other, LEAD, crypto.randomUUID()).lead;
  assert.equal(f.create({}, key, otherLead.id, f.other).created, true); assert.equal(before.callback_tasks.length, 1);
});

test('parent and task revision conflicts preserve task, operation and audit records', async t => {
  const f = await fixture(t); const first = f.create();
  f.store.updateLead(f.owner, f.lead.id, { version: first.lead.version, status: 'new', notes: 'Another owner edit' });
  let before = f.snapshot();
  assert.throws(() => f.store.updateCallbackTask(f.owner, first.task.id, { leadVersion: first.lead.version, version: 1, action: 'cancel', notes: '' }, crypto.randomUUID()), { code: 'version_conflict' });
  assert.deepEqual(f.snapshot(), before);
  const changed = f.update(first.task, 'reschedule', { dueAt: '2026-11-24T16:00:00.000Z' }); before = f.snapshot();
  assert.throws(() => f.update(first.task, 'complete'), { code: 'version_conflict' }); assert.deepEqual(f.snapshot(), before);
  assert.throws(() => f.create({ leadVersion: changed.lead.version - 1 }), { code: 'version_conflict' }); assert.deepEqual(f.snapshot(), before);
});

test('separate store connections serialize callback plans against the reviewed parent version', async t => {
  const f = await fixture(t), otherConnection = openStore({ dataDir: f.dataDir, now: f.now }), key = crypto.randomUUID(), input = { leadVersion: 1, ...SCHEDULE };
  try {
    const first = f.store.createCallbackTask(f.owner, f.lead.id, input, key);
    assert.throws(() => otherConnection.createCallbackTask(f.owner, f.lead.id, input, crypto.randomUUID()), { code: 'version_conflict' });
    const replay = otherConnection.createCallbackTask(f.owner, f.lead.id, input, key); assert.equal(replay.replayed, true); assert.equal(replay.task.id, first.task.id);
    assert.equal(otherConnection.listCallbackTasks(f.owner).total, 1); assert.equal(f.store.getLead(f.owner, f.lead.id).version, 2);
  } finally { otherConnection.close(); }
});

test('operation persistence failure rolls back task, parent revision and audit in one transaction', async t => {
  const f = await fixture(t), before = f.snapshot();
  f.db(db => db.exec("CREATE TRIGGER callback_synthetic_failure BEFORE INSERT ON callback_operations BEGIN SELECT RAISE(ABORT,'synthetic callback write failure'); END"));
  assert.throws(() => f.create(), /synthetic callback write failure/); assert.deepEqual(f.snapshot(), before);
  f.db(db => db.exec('DROP TRIGGER callback_synthetic_failure')); assert.equal(f.create().created, true);
});

test('callback mutations reject an exhausted parent revision while preserving a valid recovery snapshot', async t => {
  const f = await fixture(t), task = f.create().task;
  f.db(db => { db.prepare('UPDATE leads SET version=? WHERE id=?').run(Number.MAX_SAFE_INTEGER - 1, f.lead.id); validateDatabase(db); });
  const before = f.snapshot();
  assert.throws(() => f.create(), { code: 'version_exhausted' });
  for (const action of ['reschedule', 'complete', 'cancel']) assert.throws(() => f.update(task, action), { code: 'version_exhausted' });
  assert.deepEqual(f.snapshot(), before); f.db(db => validateDatabase(db));
});

test('last supported parent increment stays recoverable and a further task mutation fails without writes', async t => {
  const f = await fixture(t);
  f.db(db => db.prepare('UPDATE leads SET version=? WHERE id=?').run(Number.MAX_SAFE_INTEGER - 2, f.lead.id));
  const created = f.create(); assert.equal(created.lead.version, Number.MAX_SAFE_INTEGER - 1);
  f.db(db => validateDatabase(db)); const before = f.snapshot();
  assert.throws(() => f.update(created.task, 'cancel'), { code: 'version_exhausted' }); assert.deepEqual(f.snapshot(), before);
});

test('task revision exhaustion rejects changes before arithmetic can overflow or alter parent state', async t => {
  const f = await fixture(t), first = f.create().task;
  // An operator-corrupted revision cannot arise through the bounded operation
  // ledger. The runtime still refuses to increment it if such a row is present.
  f.db(db => db.prepare('UPDATE callback_tasks SET version=? WHERE id=?').run(Number.MAX_SAFE_INTEGER - 1, first.id));
  const task = { ...first, version: Number.MAX_SAFE_INTEGER - 1 }, before = f.snapshot();
  assert.throws(() => f.update(task, 'reschedule'), { code: 'version_exhausted' }); assert.throws(() => f.update(task, 'cancel'), { code: 'version_exhausted' });
  assert.deepEqual(f.snapshot(), before);
});

test('tenant and forged-actor boundaries protect queue, creation and mutations', async t => {
  const f = await fixture(t); const first = f.create(), before = f.snapshot();
  assert.equal(f.store.listCallbackTasks(f.other).total, 0);
  assert.throws(() => f.store.listCallbackTasks(f.other, { leadId: f.lead.id }), { code: 'not_found' });
  assert.throws(() => f.store.createCallbackTask(f.other, f.lead.id, { leadVersion: 2, ...SCHEDULE }, crypto.randomUUID()), { code: 'not_found' });
  assert.throws(() => f.store.updateCallbackTask(f.other, first.task.id, { leadVersion: 2, version: 1, action: 'cancel', notes: '' }, crypto.randomUUID()), { code: 'not_found' });
  assert.throws(() => f.store.listCallbackTasks({ ...f.owner, businessId: f.other.businessId }), { code: 'unauthorized' });
  assert.throws(() => f.store.listCallbackTasks(null), { code: 'unauthorized' }); assert.deepEqual(f.snapshot(), before);
});

test('SQLite rejects task-to-request tenant and operation-to-task relationship corruption with foreign keys enabled', async t => {
  const f = await fixture(t); const first = f.create(), before = f.snapshot();
  const otherLead = f.store.createLead(f.other, LEAD, crypto.randomUUID()).lead;
  f.db(db => {
    assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
    assert.throws(() => db.prepare('UPDATE callback_tasks SET lead_id=? WHERE id=?').run(otherLead.id, first.task.id), /FOREIGN KEY constraint failed/);
    assert.throws(() => db.prepare('UPDATE callback_operations SET lead_id=? WHERE task_id=?').run(otherLead.id, first.task.id), /FOREIGN KEY constraint failed/);
  });
  assert.deepEqual(f.snapshot().callback_tasks, before.callback_tasks); assert.deepEqual(f.snapshot().callback_operations, before.callback_operations);
});

const restrictions = [
  ['STOP suppression', 'contact_blocked', f => f.store.suppressPhone(f.owner, f.lead.phone)],
  ['safety hold', 'safety_review_required', f => f.store.holdPhone(f.owner, f.lead.phone)],
  ['missing permission', 'contact_permission_required', f => f.store.updateLead(f.owner, f.lead.id, { version: f.store.getLead(f.owner, f.lead.id).version, status: 'needs_review', contactPermission: 'not_recorded' })],
  ['closed request', 'request_closed', f => f.store.updateLead(f.owner, f.lead.id, { version: f.store.getLead(f.owner, f.lead.id).version, status: 'closed' })],
  ['request under review', 'request_review_required', f => f.store.updateLead(f.owner, f.lead.id, { version: f.store.getLead(f.owner, f.lead.id).version, status: 'needs_review' })]
];
for (const [label, code, restrict] of restrictions) test(label + ' blocks scheduling, reschedule and completion while keeping cancellation available', async t => {
  const f = await fixture(t); const task = f.create().task; restrict(f); const before = f.snapshot();
  assert.throws(() => f.create(), { code });
  assert.throws(() => f.update(task, 'reschedule'), { code }); assert.throws(() => f.update(task, 'complete'), { code });
  assert.deepEqual(f.snapshot(), before);
  const visible = f.store.listCallbackTasks(f.owner).tasks[0]; assert.equal(visible.blockReason, code); assert.equal(visible.contactAllowed, false);
  assert.equal(f.update(task, 'cancel').task.status, 'cancelled');
});

test('due queue uses UTC instants across a DST fold and excludes future or terminal tasks', async t => {
  const f = await fixture(t); f.setNow(Date.parse('2026-11-01T05:30:00.000Z'));
  // The fixture was created later. Move its timestamp only in this synthetic
  // setup, preserving the production monotonic-write guard.
  f.db(db => db.prepare('UPDATE leads SET created_at=?,updated_at=? WHERE id=?').run(f.now(), f.now(), f.lead.id));
  const first = f.create({ dueAt: '2026-11-01T05:30:00.000Z' }).task;
  const second = f.create({ dueAt: '2026-11-01T06:30:00.000Z' }).task;
  let queue = f.store.listCallbackTasks(f.owner, { state: 'due' }); assert.deepEqual(queue.tasks.map(task => task.id), [first.id]); assert.equal(queue.tasks[0].dueState, 'due');
  f.advance(60000); assert.equal(f.store.listCallbackTasks(f.owner, { state: 'due' }).tasks[0].dueState, 'overdue');
  f.setNow(Date.parse('2026-11-01T06:30:00.000Z')); assert.equal(f.store.listCallbackTasks(f.owner, { state: 'due' }).total, 2);
  f.update(first, 'complete'); queue = f.store.listCallbackTasks(f.owner, { state: 'due' }); assert.deepEqual(queue.tasks.map(task => task.id), [second.id]);
});

test('queue paging is ordered, scoped and complete without mutating tasks', async t => {
  const f = await fixture(t);
  for (const hour of [19, 17, 18]) f.create({ dueAt: '2026-11-23T' + hour + ':00:00.000Z' });
  const otherLead = f.store.createLead(f.owner, { ...LEAD, phone: '+15865550125' }, crypto.randomUUID()).lead;
  f.create({ dueAt: '2026-11-23T16:00:00.000Z' }, crypto.randomUUID(), otherLead.id);
  const before = f.snapshot(), first = f.store.listCallbackTasks(f.owner, { state: 'all', leadId: f.lead.id, limit: 2 }), second = f.store.listCallbackTasks(f.owner, { state: 'all', leadId: f.lead.id, limit: 2, offset: 2 });
  assert.equal(first.total, 3); assert.equal(first.limit, 2); assert.equal(first.offset, 0); assert.equal(second.tasks.length, 1);
  assert.deepEqual([...first.tasks, ...second.tasks].map(task => task.dueAt), [17, 18, 19].map(hour => '2026-11-23T' + hour + ':00:00.000Z'));
  assert.equal(first.generatedAt, new Date(f.now()).toISOString()); assert.deepEqual(f.snapshot(), before);
});

const invalidSchedules = [
  ['local time without offset', { dueAt: '2026-12-01T09:00' }], ['offset string instead of UTC', { dueAt: '2026-12-01T09:00:00-05:00' }], ['missing milliseconds', { dueAt: '2026-12-01T14:00:00Z' }],
  ['nonexistent calendar date', { dueAt: '2026-02-30T14:00:00.000Z' }], ['leap second', { dueAt: '2026-12-31T23:59:60.000Z' }], ['out of range year', { dueAt: '+999999-12-01T14:00:00.000Z' }],
  ['unknown zone', { timeZone: 'America/Unknown' }], ['numeric offset zone', { timeZone: '+05:30' }], ['zone control character', { timeZone: 'UTC\n' }],
  ['unknown kind', { kind: 'appointment' }], ['notes too long', { notes: 'x'.repeat(2001) }], ['notes control', { notes: 'bad\u0000note' }], ['numeric notes', { notes: 4 }],
  ['unpaired high surrogate', { notes: 'before\ud800after' }], ['unpaired low surrogate', { notes: 'before\udc00after' }],
  ['missing lead version', { leadVersion: undefined }], ['fractional lead version', { leadVersion: 1.2 }], ['overflow lead version', { leadVersion: Number.MAX_SAFE_INTEGER }], ['unknown field', { externalCall: true }]
];
for (const [label, changes] of invalidSchedules) test('callback creation rejects ' + label + ' without writes', async t => {
  const f = await fixture(t), before = f.snapshot();
  assert.throws(() => f.create(changes), { code: 'invalid_input' }); assert.deepEqual(f.snapshot(), before);
});

test('callback mutations reject extra fields, invalid outcomes and absent retry identifiers without writes', async t => {
  const f = await fixture(t); const task = f.create().task, before = f.snapshot();
  for (const changes of [{ outcome: 'booked' }, { outcome: undefined }, { version: 0 }, { action: 'reopen' }, { booking: true }, { notes: 'before\ud800after' }, { notes: 'before\udc00after' }]) assert.throws(() => f.update(task, 'complete', changes), { code: 'invalid_input' });
  for (const key of [undefined, '', 'short', '../unsafe/key/value']) assert.throws(() => f.store.updateCallbackTask(f.owner, task.id, { leadVersion: 2, version: 1, action: 'cancel', notes: '' }, key));
  assert.deepEqual(f.snapshot(), before);
});

test('paired astral Unicode task notes survive SQLite, reopen and backup validation exactly', async t => {
  const f = await fixture(t), notes = '\ud83d\udd0c'.repeat(1000);
  const first = f.create({ notes }); assert.equal(first.task.notes, notes);
  f.reopen(); assert.equal(f.store.listCallbackTasks(f.owner).tasks[0].notes, notes); f.db(db => validateDatabase(db));
});

test('callback queue rejects invalid query fields, page bounds and invalid clocks without writes', async t => {
  const f = await fixture(t); f.create(); const before = f.snapshot();
  for (const query of [{ state: 'pending' }, { limit: 0 }, { limit: 501 }, { limit: '100' }, { offset: -1 }, { offset: 0.5 }, { offset: 2001 }, { leadId: '../other' }, { businessId: f.other.businessId }, null, []]) assert.throws(() => f.store.listCallbackTasks(f.owner, query), { code: 'invalid_input' });
  for (const time of [-1, NaN, 1.1, Infinity, 8640000000000001]) { f.setNow(time); assert.throws(() => f.store.listCallbackTasks(f.owner), { code: 'clock_unavailable' }); assert.throws(() => f.create(), { code: 'clock_unavailable' }); }
  assert.deepEqual(f.snapshot(), before);
});

test('backwards clock rejects callback edits atomically and leaves the connection usable', async t => {
  const f = await fixture(t); const task = f.create().task, before = f.snapshot(); f.advance(-1);
  assert.throws(() => f.update(task, 'complete'), { code: 'clock_unavailable' }); assert.throws(() => f.create(), { code: 'clock_unavailable' }); assert.deepEqual(f.snapshot(), before);
  f.advance(2); assert.equal(f.update(task, 'complete').task.status, 'completed');
});

test('closing a request with a pending task keeps it out of retention until cancellation', async t => {
  const f = await fixture(t); const task = f.create().task;
  f.store.updateLead(f.owner, f.lead.id, { version: 2, status: 'closed' }); f.advance(1000);
  const review = () => f.store.reviewRetention(f.owner, { before: f.now(), limit: 100 });
  assert.equal(review().requests.total, 0); f.update(task, 'cancel'); f.advance(1000);
  assert.equal(review().requests.total, 1);
});

test('deleting a request removes tasks and operation contents and blocks stale create retries', async t => {
  const f = await fixture(t), key = crypto.randomUUID(), input = { leadVersion: 1, ...SCHEDULE };
  const first = f.store.createCallbackTask(f.owner, f.lead.id, input, key);
  f.update(first.task, 'complete'); f.create({ kind: 'follow_up' });
  const lead = f.store.getLead(f.owner, f.lead.id), deletionKey = crypto.randomUUID();
  const receipt = f.store.deleteLead(f.owner, f.lead.id, { version: lead.version, confirmation: 'DELETE' }, deletionKey);
  assert.equal(receipt.deleted, true); assert.equal(f.store.listCallbackTasks(f.owner, { state: 'all' }).total, 0);
  const snapshot = f.snapshot(); assert.equal(snapshot.callback_tasks.length, 0); assert.equal(snapshot.callback_operations.length, 0);
  assert.throws(() => f.store.createCallbackTask(f.owner, f.lead.id, input, key), { code: 'not_found' });
  assert.deepEqual(f.store.deleteLead(f.owner, f.lead.id, { version: lead.version, confirmation: 'DELETE' }, deletionKey), receipt);
  assert.deepEqual(f.snapshot(), snapshot); assert.ok(!JSON.stringify(snapshot).includes(SCHEDULE.notes));
});

test('transcript deletion retains task plans and forces a fresh parent version for task changes', async t => {
  const f = await fixture(t); const first = f.create();
  f.store.deleteLeadConversation(f.owner, f.lead.id, { version: first.lead.version, confirmation: 'DELETE' }, crypto.randomUUID());
  assert.equal(f.store.listCallbackTasks(f.owner).tasks[0].id, first.task.id);
  assert.throws(() => f.store.updateCallbackTask(f.owner, first.task.id, { leadVersion: 2, version: 1, action: 'cancel', notes: '' }, crypto.randomUUID()), { code: 'version_conflict' });
});

test('callback task and operation quotas reject further writes without losing existing work', async t => {
  const f = await fixture(t); const first = f.create();
  f.db(db => {
    const row = db.prepare('SELECT * FROM callback_tasks WHERE id=?').get(first.task.id);
    const statement = db.prepare('INSERT INTO callback_tasks VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
    db.exec('BEGIN');
    for (let n = 1; n < MAX_TASKS_PER_BUSINESS; n++) statement.run(crypto.randomUUID(), f.owner.businessId, f.lead.id, row.kind, row.due_at, row.time_zone, row.status, row.notes, row.outcome, 1, row.created_at, row.updated_at, null, null);
    db.exec('COMMIT');
  });
  assert.throws(() => f.create(), { code: 'callback_task_limit' });
  f.db(db => {
    const statement = db.prepare('INSERT INTO callback_operations VALUES (?,?,?,?,?,?)'); db.exec('BEGIN');
    for (let n = 1; n < MAX_TASK_OPERATIONS; n++) statement.run(f.owner.businessId, crypto.randomUUID(), 'a'.repeat(64), first.task.id, f.lead.id, START);
    db.exec('COMMIT');
  });
  const before = f.snapshot(); assert.throws(() => f.update(first.task, 'cancel'), { code: 'callback_history_limit' }); assert.deepEqual(f.snapshot(), before);
});

test('schema3 migration adds scheduling while preserving all original records and schema3 read-only recovery', async t => {
  const f = await fixture(t); const original = f.snapshot();
  f.db(db => {
    for (const name of Object.keys(TASK_TABLE_SQL).reverse()) db.exec('DROP TABLE ' + name);
    db.exec('DROP INDEX leads_id_business; PRAGMA user_version=3;');
    assert.equal(assertWorkspaceSchema(db), 3);
  });
  const legacy = openStore({ dataDir: f.dataDir, create: false });
  assert.throws(() => legacy.listCallbackTasks(f.owner), { code: 'upgrade_required' });
  assert.deepEqual(legacy.exportBusiness(f.owner).callbackTasks, []); legacy.close();
  f.reopen(); f.db(db => assert.equal(assertWorkspaceSchema(db), 4));
  const migrated = f.snapshot(); assert.deepEqual(migrated, original); assert.equal(f.create().created, true);
});

test('schema4 encrypted recovery preserves callback state and replay metadata while disabling restored authentication', async t => {
  const f = await fixture(t), createKey = crypto.randomUUID(); const first = f.create({}, createKey); f.advance(1000);
  f.update(first.task, 'complete', { outcome: 'no_answer' }); const followup = f.create({ kind: 'follow_up' });
  f.store.suppressPhone(f.owner, f.lead.phone);
  const archive = path.join(f.directory, 'snapshot.prbk'), target = path.join(f.directory, 'restored'), passphrase = 'Synthetic callback backup passphrase 2026!';
  const backup = await createEncryptedBackup({ dataDir: f.dataDir, outputFile: archive, passphrase });
  assert.equal(backup.schemaVersion, 4); assert.equal(backup.counts.callbackTasks, 2); assert.equal(backup.counts.callbackOperations, 3);
  const restored = await restoreEncryptedBackup({ backupFile: archive, dataDir: target, passphrase }); assert.equal(restored.schemaVersion, 4);
  const store = openStore({ dataDir: target, now: f.now });
  try {
    assert.deepEqual(store.listCallbackTasks(f.owner, { state: 'all' }), f.store.listCallbackTasks(f.owner, { state: 'all' }));
    assert.equal(store.findUser(f.owner.username).password_hash, 'disabled:restore-required');
    const replay = store.createCallbackTask(f.owner, f.lead.id, { leadVersion: 1, ...SCHEDULE }, createKey); assert.equal(replay.replayed, true); assert.equal(replay.task.status, 'completed'); assert.equal(replay.task.contactAllowed, false);
    assert.equal(store.listCallbackTasks(f.owner).tasks[0].id, followup.task.id);
  } finally { store.close(); }
});

const corruptions = [
  ['task tenant mismatch', db => { db.exec('PRAGMA foreign_keys=OFF'); db.exec("UPDATE callback_tasks SET business_id=(SELECT id FROM businesses WHERE name='Other Fixture')"); }],
  ['unknown task kind', db => db.exec("UPDATE callback_tasks SET kind='appointment'")],
  ['unknown task status', db => db.exec("UPDATE callback_tasks SET status='sent'")],
  ['invalid zone', db => db.exec("UPDATE callback_tasks SET time_zone='Unknown/Zone'")],
  ['negative due time', db => db.exec('UPDATE callback_tasks SET due_at=-1')],
  ['completion without outcome', db => db.exec("UPDATE callback_tasks SET status='completed',completed_at=updated_at")],
  ['scheduled task with outcome', db => db.exec("UPDATE callback_tasks SET outcome='reached'")],
  ['incorrect terminal timestamp', db => db.exec("UPDATE callback_tasks SET status='cancelled',cancelled_at=updated_at+1")],
  ['version without operation history', db => db.exec('UPDATE callback_tasks SET version=2')],
  ['missing operation history', db => db.exec('DELETE FROM callback_operations')],
  ['operation after task update', db => db.exec('UPDATE callback_operations SET created_at=created_at+1')],
  ['missing task audit', db => db.exec("DELETE FROM audit WHERE action='callback.scheduled'")],
  ['task audit for another record', db => db.exec("UPDATE audit SET details_json='{}' WHERE action='callback.scheduled'")],
  ['task audit after update', db => db.exec("UPDATE audit SET created_at=created_at+1 WHERE action='callback.scheduled'")],
  ['malformed retry digest', db => db.exec("UPDATE callback_operations SET request_hash='not-a-digest'")],
  ['operation wrong parent', db => { db.exec('PRAGMA foreign_keys=OFF'); db.exec("UPDATE callback_operations SET lead_id='00000000-0000-0000-0000-000000000000'"); }]
];
for (const [label, corrupt] of corruptions) test('backup validation rejects ' + label, async t => {
  const f = await fixture(t); f.create();
  f.db(db => { validateDatabase(db); corrupt(db); assert.throws(() => validateDatabase(db), { code: 'invalid_database' }); });
});
