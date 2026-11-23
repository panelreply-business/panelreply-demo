'use strict';

const crypto = require('node:crypto');
const panels = require('./panels.cjs');

// Tasks record an owner's plan and reported outcome. They never send a message,
// make a call, or reserve a customer appointment.
const TASK_TABLE_SQL = Object.freeze({
  callback_tasks: 'CREATE TABLE callback_tasks (id TEXT PRIMARY KEY, business_id TEXT NOT NULL REFERENCES businesses(id), lead_id TEXT NOT NULL REFERENCES leads(id), kind TEXT NOT NULL, due_at INTEGER NOT NULL, time_zone TEXT NOT NULL, status TEXT NOT NULL, notes TEXT NOT NULL, outcome TEXT NOT NULL, version INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, completed_at INTEGER, cancelled_at INTEGER, UNIQUE(id,business_id,lead_id), FOREIGN KEY(lead_id,business_id) REFERENCES leads(id,business_id)) STRICT',
  callback_operations: 'CREATE TABLE callback_operations (business_id TEXT NOT NULL REFERENCES businesses(id), operation_key TEXT NOT NULL, request_hash TEXT NOT NULL, task_id TEXT NOT NULL, lead_id TEXT NOT NULL REFERENCES leads(id), created_at INTEGER NOT NULL, PRIMARY KEY(business_id,operation_key), FOREIGN KEY(task_id,business_id,lead_id) REFERENCES callback_tasks(id,business_id,lead_id)) STRICT'
});
const TASK_INDEX_SQL = Object.freeze({ leads_id_business: 'CREATE UNIQUE INDEX leads_id_business ON leads(id,business_id)', callback_tasks_business_due: 'CREATE INDEX callback_tasks_business_due ON callback_tasks(business_id,status,due_at,id)', callback_tasks_lead: 'CREATE INDEX callback_tasks_lead ON callback_tasks(lead_id,business_id)' });
const TASK_AUTO_INDEXES = Object.freeze(['sqlite_autoindex_callback_tasks_1', 'sqlite_autoindex_callback_tasks_2', 'sqlite_autoindex_callback_operations_1']);
const TASK_COLUMNS = Object.freeze({
  callback_tasks: ['id', 'business_id', 'lead_id', 'kind', 'due_at', 'time_zone', 'status', 'notes', 'outcome', 'version', 'created_at', 'updated_at', 'completed_at', 'cancelled_at'],
  callback_operations: ['business_id', 'operation_key', 'request_hash', 'task_id', 'lead_id', 'created_at']
});
const KINDS = Object.freeze(['callback', 'follow_up']);
const OUTCOMES = Object.freeze(['reached', 'no_answer', 'voicemail', 'other']);
const STATUSES = Object.freeze(['scheduled', 'completed', 'cancelled']);
const MAX_TASKS_PER_BUSINESS = 2000;
const MAX_TASK_OPERATIONS = 20000;
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const timestamp = value => Number.isSafeInteger(value) && value >= 0 && value <= 8640000000000000;
const version = value => Number.isSafeInteger(value) && value >= 1 && value < Number.MAX_SAFE_INTEGER;
const note = value => typeof value === 'string' && value.length <= 2000 && value.isWellFormed() && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
function validTimeZone(value) {
  if (typeof value !== 'string' || value.length > 100 || !/^(?:UTC|[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+)+)$/.test(value)) return false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: value }).format(0); return true; } catch (_) { return false; }
}
function instant(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return null;
  const time = Date.parse(value);
  return timestamp(time) && new Date(time).toISOString() === value ? time : null;
}
function taskBlockReason(lead) {
  if (lead.optedOut || lead.contactPermission === 'opted_out') return 'contact_blocked';
  if (lead.safetyHold) return 'safety_review_required';
  if (lead.contactPermission !== 'requested_callback') return 'contact_permission_required';
  if (lead.status === 'closed') return 'request_closed';
  if (lead.status === 'needs_review') return 'request_review_required';
  return null;
}

function createCallbackTasks({ db, tx, now, getActor, store, StoreError, addAudit, readLeadSummary, enabled }) {
  const fail = (status, code, message, fields) => { throw new StoreError(status, code, message, fields); };
  const invalid = (message, fields) => fail(400, 'invalid_input', message, fields);
  function requireSchema(actor) { getActor(actor); if (!enabled) fail(409, 'upgrade_required', 'Start the current workspace version before scheduling callbacks.'); }
  function clock() { const time = now(); if (!timestamp(time)) fail(503, 'clock_unavailable', 'Check the workspace clock before scheduling callbacks.'); return time; }
  function validateId(id) { if (typeof id !== 'string' || !panels.UUID.test(id)) invalid('Use the saved record identifier.'); }
  function validateInput(input, action) {
    const fields = action === 'create' ? ['leadVersion', 'kind', 'dueAt', 'timeZone', 'notes']
      : action === 'reschedule' ? ['leadVersion', 'version', 'action', 'dueAt', 'timeZone', 'notes']
        : action === 'complete' ? ['leadVersion', 'version', 'action', 'outcome', 'notes']
          : action === 'cancel' ? ['leadVersion', 'version', 'action', 'notes'] : null;
    if (!fields || !input || typeof input !== 'object' || Array.isArray(input) || fields.length !== Object.keys(input).length || fields.some(field => !Object.hasOwn(input, field))) invalid('Send the required callback task fields.');
    if (!version(input.leadVersion) || (action !== 'create' && !version(input.version))) invalid('Use the current request and task versions.', ['version', 'leadVersion']);
    if (!note(input.notes)) invalid('Keep task notes within 2,000 characters.', ['notes']);
    const valid = { leadVersion: input.leadVersion, ...(action !== 'create' ? { version: input.version, action } : { kind: input.kind }), notes: input.notes.trim() };
    if (action === 'create' && !KINDS.includes(input.kind)) invalid('Choose callback or follow-up.', ['kind']);
    if (action === 'create' || action === 'reschedule') {
      const dueAt = instant(input.dueAt);
      if (dueAt === null) invalid('Use an exact UTC date and time for the task.', ['dueAt']);
      if (!validTimeZone(input.timeZone)) invalid('Choose a supported named time zone.', ['timeZone']);
      valid.dueAt = dueAt; valid.timeZone = input.timeZone;
    }
    if (action === 'complete') {
      if (!OUTCOMES.includes(input.outcome)) invalid('Choose the reported callback outcome.', ['outcome']);
      valid.outcome = input.outcome;
    }
    return valid;
  }
  function rowFor(actor, id) {
    const row = db.prepare('SELECT * FROM callback_tasks WHERE id=? AND business_id=?').get(id, actor.businessId);
    if (!row) fail(404, 'not_found', 'The callback task was not found.');
    return row;
  }
  function materialize(row, actor, at, lead = store.getLead(actor, row.lead_id)) {
    const blockReason = taskBlockReason(lead);
    const active = row.status === 'scheduled';
    return { id: row.id, leadId: row.lead_id, leadVersion: lead.version, customerName: lead.customerName, phone: lead.phone,
      requestStatus: lead.status, contactAllowed: !blockReason, blockReason,
      kind: row.kind, dueAt: new Date(row.due_at).toISOString(), timeZone: row.time_zone, status: row.status,
      notes: row.notes, outcome: row.outcome, version: row.version,
      createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString(),
      completedAt: row.completed_at === null ? null : new Date(row.completed_at).toISOString(),
      cancelledAt: row.cancelled_at === null ? null : new Date(row.cancelled_at).toISOString(),
      dueState: !active ? null : row.due_at > at ? 'upcoming' : at - row.due_at < 60000 ? 'due' : 'overdue',
      isDue: active && row.due_at <= at };
  }
  function assertLeadVersion(lead, expected) { if (lead.version !== expected) fail(409, 'version_conflict', 'This request changed. Reload it before changing a callback task.'); }
  function assertNextRevision(value) {
    // The final supported revision must remain representable and valid for
    // recovery. Never commit a task/audit version that this build cannot read.
    if (value >= Number.MAX_SAFE_INTEGER - 1) fail(409, 'version_exhausted', 'This record reached its revision limit. Ask the operator to review it before making more changes.');
  }
  function assertContact(lead) {
    const reason = taskBlockReason(lead);
    const messages = { contact_blocked: 'This number is opted out. Cancel the task or keep it for review.', safety_review_required: 'This request has a safety hold. It cannot be scheduled or marked contacted.', contact_permission_required: 'Record the callback request before scheduling contact.', request_closed: 'Reopen the request before scheduling contact.', request_review_required: 'Resolve the request review before scheduling contact.' };
    if (reason) fail(409, reason, messages[reason]);
  }
  function perform(actor, action, id, input, key, mutate) {
    requireSchema(actor); validateId(id); panels.validateIdempotencyKey(key);
    const valid = validateInput(input, action);
    const requestHash = hash(JSON.stringify({ action, id, ...valid }));
    return tx(() => {
      const at = clock();
      const prior = db.prepare('SELECT * FROM callback_operations WHERE business_id=? AND operation_key=?').get(actor.businessId, key);
      if (prior) {
        if (prior.request_hash !== requestHash) fail(409, 'idempotency_conflict', 'This retry identifier belongs to another callback task change.');
        const row = rowFor(actor, prior.task_id), lead = store.getLead(actor, row.lead_id);
        // Return current contact restrictions and versions, not a cached copy
        // that could conceal a later STOP, correction, or cancellation.
        return { task: materialize(row, actor, at, lead), lead, created: false, replayed: true };
      }
      if (db.prepare('SELECT count(*) AS n FROM callback_operations').get().n >= MAX_TASK_OPERATIONS) fail(503, 'callback_history_limit', 'Callback history requires an operator storage review.');
      const result = mutate(valid, at);
      db.prepare('INSERT INTO callback_operations VALUES (?,?,?,?,?,?)').run(actor.businessId, key, requestHash, result.taskId, result.leadId, at);
      const row = rowFor(actor, result.taskId), lead = store.getLead(actor, result.leadId);
      return { task: materialize(row, actor, at, lead), lead, created: action === 'create', replayed: false };
    });
  }
  function updateParent(actor, lead, taskId, action, fields, at) {
    if (at < Date.parse(lead.updatedAt)) fail(503, 'clock_unavailable', 'The workspace clock moved backwards. Check it before changing callback tasks.');
    const result = db.prepare('UPDATE leads SET version=version+1,updated_at=? WHERE id=? AND business_id=? AND version=?').run(at, lead.id, actor.businessId, lead.version);
    if (result.changes !== 1) fail(409, 'version_conflict', 'This request changed. Reload it before changing a callback task.');
    addAudit(actor, lead.id, 'callback.' + action, lead.version + 1, { taskId, fields }, at);
  }
  return {
    create(actor, leadId, input, key) {
      return perform(actor, 'create', leadId, input, key, (valid, at) => {
        const lead = store.getLead(actor, leadId); assertLeadVersion(lead, valid.leadVersion); assertContact(lead);
        assertNextRevision(lead.version);
        if (db.prepare('SELECT count(*) AS n FROM callback_tasks WHERE business_id=?').get(actor.businessId).n >= MAX_TASKS_PER_BUSINESS) fail(409, 'callback_task_limit', 'The local workspace supports up to 2,000 callback tasks per business.');
        const taskId = crypto.randomUUID();
        db.prepare('INSERT INTO callback_tasks VALUES (?,?,?,?,?,?,?,?,?,1,?,?,NULL,NULL)').run(taskId, actor.businessId, leadId, valid.kind, valid.dueAt, valid.timeZone, 'scheduled', valid.notes, '', at, at);
        updateParent(actor, lead, taskId, 'scheduled', ['kind', 'dueAt', 'timeZone', 'notes', 'status'], at);
        return { taskId, leadId };
      });
    },
    update(actor, taskId, input, key) {
      const action = input?.action;
      return perform(actor, action, taskId, input, key, (valid, at) => {
        const row = rowFor(actor, taskId), lead = store.getLead(actor, row.lead_id);
        assertLeadVersion(lead, valid.leadVersion);
        if (row.version !== valid.version) fail(409, 'version_conflict', 'This callback task changed. Reload it before saving.');
        assertNextRevision(lead.version); assertNextRevision(row.version);
        if (at < row.updated_at) fail(503, 'clock_unavailable', 'The workspace clock moved backwards. Check it before changing callback tasks.');
        if (row.status !== 'scheduled') fail(409, 'task_finished', 'This task is finished. Create a follow-up task to record another callback plan.');
        if (action !== 'cancel') assertContact(lead);
        if (action === 'reschedule') db.prepare('UPDATE callback_tasks SET due_at=?,time_zone=?,notes=?,version=version+1,updated_at=? WHERE id=? AND business_id=?').run(valid.dueAt, valid.timeZone, valid.notes, at, taskId, actor.businessId);
        else db.prepare('UPDATE callback_tasks SET status=?,notes=?,outcome=?,version=version+1,updated_at=?,completed_at=?,cancelled_at=? WHERE id=? AND business_id=?').run(action === 'complete' ? 'completed' : 'cancelled', valid.notes, valid.outcome || '', at, action === 'complete' ? at : null, action === 'cancel' ? at : null, taskId, actor.businessId);
        updateParent(actor, lead, taskId, action === 'reschedule' ? 'rescheduled' : action === 'complete' ? 'completed' : 'cancelled', action === 'reschedule' ? ['dueAt', 'timeZone', 'notes'] : action === 'complete' ? ['status', 'outcome', 'notes'] : ['status', 'notes'], at);
        return { taskId, leadId: row.lead_id };
      });
    },
    list(actor, input = {}) {
      requireSchema(actor);
      if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['state', 'leadId', 'limit', 'offset'].includes(key))) invalid('Use the supported callback queue filters.');
      const { state = 'open', leadId, limit = 100, offset = 0 } = input;
      if (!['open', 'due', 'all', 'completed', 'cancelled'].includes(state) || !Number.isSafeInteger(limit) || limit < 1 || limit > 500 || !Number.isSafeInteger(offset) || offset < 0 || offset > MAX_TASKS_PER_BUSINESS) invalid('Use a supported callback queue filter and page size from 1 to 500.');
      if (leadId !== undefined) validateId(leadId);
      const at = clock();
      db.exec('BEGIN');
      try {
        const leadCache = new Map();
        if (leadId !== undefined) leadCache.set(leadId, readLeadSummary(actor, leadId));
        const values = [actor.businessId], where = ['business_id=?'];
        if (leadId !== undefined) { where.push('lead_id=?'); values.push(leadId); }
        if (state !== 'all') { where.push('status=?'); values.push(['open', 'due'].includes(state) ? 'scheduled' : state); }
        if (state === 'due') { where.push('due_at<=?'); values.push(at); }
        const total = Number(db.prepare('SELECT count(*) AS n FROM callback_tasks WHERE ' + where.join(' AND ')).get(...values).n);
        const tasks = db.prepare('SELECT * FROM callback_tasks WHERE ' + where.join(' AND ') + ' ORDER BY due_at,id LIMIT ? OFFSET ?').all(...values, limit, offset).map(row => {
          if (!leadCache.has(row.lead_id)) leadCache.set(row.lead_id, readLeadSummary(actor, row.lead_id));
          return materialize(row, actor, at, leadCache.get(row.lead_id));
        });
        db.exec('COMMIT');
        return { tasks, total, limit, offset, generatedAt: new Date(at).toISOString() };
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    },
    export(actor) {
      requireSchema(actor);
      const at = clock();
      // Caller owns the export's consistent read transaction.
      const leadCache = new Map();
      return db.prepare('SELECT * FROM callback_tasks WHERE business_id=? ORDER BY due_at,id').all(actor.businessId).map(row => {
        if (!leadCache.has(row.lead_id)) leadCache.set(row.lead_id, readLeadSummary(actor, row.lead_id));
        return materialize(row, actor, at, leadCache.get(row.lead_id));
      });
    }
  };
}

function validateCallbackDatabase(db, fail) {
  const invalid = () => fail('invalid_database', 'The workspace contains invalid callback scheduling records.');
  if (db.prepare('SELECT 1 FROM callback_tasks t JOIN leads l ON l.id=t.lead_id WHERE t.business_id<>l.business_id LIMIT 1').get()) invalid();
  if (db.prepare('SELECT 1 FROM callback_tasks GROUP BY business_id HAVING count(*)>? LIMIT 1').get(MAX_TASKS_PER_BUSINESS)) invalid();
  const operationCount = db.prepare('SELECT count(*) AS n FROM callback_operations').get().n;
  if (operationCount > MAX_TASK_OPERATIONS) invalid();
  // Every task revision has exactly one operation and one audit event. These
  // bounds follow from the per-task checks below and keep validation maps
  // bounded even when an authenticated archive contains inconsistent records.
  if (db.prepare('SELECT count(*) AS n FROM callback_tasks').get().n > operationCount
    || db.prepare("SELECT count(*) AS n FROM audit WHERE action LIKE 'callback.%'").get().n !== operationCount) invalid();
  const tasksById = new Map();
  for (const row of db.prepare('SELECT t.id,t.business_id,t.lead_id,t.created_at,t.updated_at,l.version AS parent_version,l.business_id AS parent_business_id FROM callback_tasks t LEFT JOIN leads l ON l.id=t.lead_id').iterate()) {
    if (row.parent_business_id !== row.business_id) invalid();
    tasksById.set(row.id, row);
  }
  const operationStats = new Map();
  // Scan the bounded ledger once. A per-task query on its business/key index
  // would repeatedly scan every operation belonging to the same business.
  for (const row of db.prepare('SELECT * FROM callback_operations').iterate()) {
    const task = tasksById.get(row.task_id);
    if (!/^[A-Za-z0-9_-]{16,128}$/.test(row.operation_key) || !/^[a-f0-9]{64}$/.test(row.request_hash) || !timestamp(row.created_at) || !task || task.business_id !== row.business_id || task.lead_id !== row.lead_id || row.created_at < task.created_at || row.created_at > task.updated_at) invalid();
    const stats = operationStats.get(row.task_id) || { n: 0, first: Infinity, last: -Infinity };
    stats.n++; stats.first = Math.min(stats.first, row.created_at); stats.last = Math.max(stats.last, row.created_at);
    operationStats.set(row.task_id, stats);
  }
  const auditByTask = new Map();
  const actionFields = { 'callback.scheduled': ['kind', 'dueAt', 'timeZone', 'notes', 'status'], 'callback.rescheduled': ['dueAt', 'timeZone', 'notes'], 'callback.completed': ['status', 'outcome', 'notes'], 'callback.cancelled': ['status', 'notes'] };
  for (const entry of db.prepare("SELECT * FROM audit WHERE action LIKE 'callback.%' ORDER BY created_at,rowid").iterate()) {
    let details; try { details = JSON.parse(entry.details_json); } catch (_) { invalid(); }
    if (!Object.hasOwn(actionFields, entry.action) || !details || typeof details !== 'object' || Array.isArray(details) || Object.keys(details).length !== 2 || !panels.UUID.test(details.taskId) || JSON.stringify(details.fields) !== JSON.stringify(actionFields[entry.action]) || !timestamp(entry.created_at) || !version(entry.version)) invalid();
    const task = tasksById.get(details.taskId);
    if (!task || task.business_id !== entry.business_id || task.lead_id !== entry.lead_id) invalid();
    const entries = auditByTask.get(task.id) || []; entries.push({ action: entry.action, version: entry.version, created_at: entry.created_at }); auditByTask.set(task.id, entries);
  }
  for (const row of db.prepare('SELECT * FROM callback_tasks').iterate()) {
    if (!panels.UUID.test(row.id) || !KINDS.includes(row.kind) || !timestamp(row.due_at) || instant(new Date(row.due_at).toISOString()) === null || !validTimeZone(row.time_zone) || !STATUSES.includes(row.status) || !note(row.notes) || row.notes.trim() !== row.notes || !version(row.version) || !timestamp(row.created_at) || !timestamp(row.updated_at) || row.updated_at < row.created_at) invalid();
    if (row.status === 'completed' ? !OUTCOMES.includes(row.outcome) || row.completed_at !== row.updated_at || row.cancelled_at !== null : row.outcome !== '' || row.completed_at !== null || (row.status === 'cancelled' ? row.cancelled_at !== row.updated_at : row.cancelled_at !== null)) invalid();
    const operations = operationStats.get(row.id);
    if (!operations || operations.n !== row.version || operations.first !== row.created_at || operations.last !== row.updated_at) invalid();
    const entries = auditByTask.get(row.id) || [], parentVersion = tasksById.get(row.id)?.parent_version;
    if (entries.length !== row.version || entries[0]?.action !== 'callback.scheduled' || entries[0]?.created_at !== row.created_at || entries.at(-1)?.created_at !== row.updated_at) invalid();
    for (let index = 0; index < entries.length; index++) {
      const entry = entries[index], terminal = index === entries.length - 1 && row.status !== 'scheduled';
      const expected = index === 0 ? 'callback.scheduled' : terminal ? 'callback.' + row.status : 'callback.rescheduled';
      if (entry.action !== expected || entry.version < 2 || entry.version > parentVersion || (index && entry.version <= entries[index - 1].version)) invalid();
    }
    if (row.status !== 'scheduled' && entries.length < 2) invalid();
  }
}

module.exports = { TASK_TABLE_SQL, TASK_INDEX_SQL, TASK_AUTO_INDEXES, TASK_COLUMNS, KINDS, OUTCOMES, STATUSES, MAX_TASKS_PER_BUSINESS, MAX_TASK_OPERATIONS, validTimeZone, instant, taskBlockReason, createCallbackTasks, validateCallbackDatabase };
