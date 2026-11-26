'use strict';

const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { validateLeadInput, LEAD_KEYS } = require('../../workspace/store.cjs');

const NOW = Date.parse('2026-11-23T15:00:00.000Z');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');

// A bounded synthetic recovery fixture, not an execution-count generator.
// Direct inserts keep the workload test focused on reads and archive recovery.
// The resulting records use the shipped schema and undergo full validation.
function seedCallbackCapacity({ store, owner, leadCount = 500, taskCount = 2000, revisions = 10, dense = true, mixedStates = true }) {
  if (taskCount % leadCount || !Number.isInteger(revisions) || revisions < 1) throw new Error('Use an even, bounded callback fixture layout.');
  const db = new DatabaseSync(store.filename, { enableForeignKeyConstraints: true });
  const leads = [], tasks = [];
  const taskNotes = dense ? '漢'.repeat(2000) : 'Synthetic task notes';
  const transcript = dense ? Array.from({ length: 10 }, () => ({ role: 'customer', text: '漢'.repeat(2000) })) : [{ role: 'customer', text: 'Please call about the garage lighting.' }];
  try {
    const insertLead = db.prepare('INSERT INTO leads VALUES (?,?,?,?,?,?,?,?,?)');
    const insertMessage = db.prepare('INSERT INTO messages VALUES (?,?,?,?,?)');
    const insertTask = db.prepare('INSERT INTO callback_tasks VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
    const insertOperation = db.prepare('INSERT INTO callback_operations VALUES (?,?,?,?,?,?)');
    const insertAudit = db.prepare('INSERT INTO audit VALUES (?,?,?,?,?,?,?,?)');
    db.exec('BEGIN IMMEDIATE');
    for (let index = 0; index < leadCount; index++) {
      const id = crypto.randomUUID(), key = crypto.randomUUID();
      const valid = validateLeadInput({ customerName: 'Synthetic capacity request ' + index, phone: '+1248555' + String(100 + index % 100).padStart(4, '0'), job: 'Install garage lighting', zip: '48315', callbackWindow: 'Next business day', requestedWorkDate: 'Next month', contactPermission: 'requested_callback', conversation: transcript });
      const { conversation, ...fields } = valid;
      const lead = { id, version: 1, phone: fields.phone };
      insertLead.run(id, owner.businessId, key, hash(JSON.stringify(valid)), JSON.stringify({ ...fields, notes: '', safetyHold: false }), 'new', 1, NOW, NOW);
      for (let position = 0; position < conversation.length; position++) insertMessage.run(id, owner.businessId, position, conversation[position].role, conversation[position].text);
      insertAudit.run(crypto.randomUUID(), owner.businessId, id, owner.id, 'lead.created', 1, NOW, JSON.stringify({ fields: LEAD_KEYS.filter(field => field !== 'conversation'), messageCount: conversation.length }));
      leads.push(lead);
    }
    for (let index = 0; index < taskCount; index++) {
      const task = { id: crypto.randomUUID(), leadId: leads[index % leadCount].id, kind: index < leadCount ? 'callback' : 'follow_up', dueAt: NOW - 3600000 + index * 1000, timeZone: 'America/Detroit', notes: taskNotes, status: 'scheduled', outcome: '', version: 1 };
      if (mixedStates && revisions > 1 && index % 7 < 2) { task.status = index % 7 === 0 ? 'completed' : 'cancelled'; task.outcome = task.status === 'completed' ? 'no_answer' : ''; }
      insertTask.run(task.id, owner.businessId, task.leadId, task.kind, task.dueAt, task.timeZone, task.status, task.notes, task.outcome, revisions, NOW, NOW, task.status === 'completed' ? NOW : null, task.status === 'cancelled' ? NOW : null);
      tasks.push(task);
    }
    for (let revision = 1; revision <= revisions; revision++) for (let index = 0; index < taskCount; index++) {
      const task = tasks[index], lead = leads[index % leadCount], terminal = revision === revisions && task.status !== 'scheduled';
      const action = revision === 1 ? 'create' : terminal ? task.status === 'completed' ? 'complete' : 'cancel' : 'reschedule';
      const valid = { leadVersion: lead.version, ...(revision === 1 ? { kind: task.kind } : { version: revision - 1, action }), notes: task.notes };
      if (action === 'create' || action === 'reschedule') { valid.dueAt = task.dueAt; valid.timeZone = task.timeZone; }
      if (action === 'complete') valid.outcome = task.outcome;
      const operationId = action === 'create' ? lead.id : task.id;
      const actionName = action === 'create' ? 'scheduled' : action === 'reschedule' ? 'rescheduled' : action === 'complete' ? 'completed' : 'cancelled';
      const fields = action === 'create' ? ['kind', 'dueAt', 'timeZone', 'notes', 'status'] : action === 'reschedule' ? ['dueAt', 'timeZone', 'notes'] : action === 'complete' ? ['status', 'outcome', 'notes'] : ['status', 'notes'];
      insertOperation.run(owner.businessId, crypto.randomUUID(), hash(JSON.stringify({ action, id: operationId, ...valid })), task.id, task.leadId, NOW);
      insertAudit.run(crypto.randomUUID(), owner.businessId, task.leadId, owner.id, 'callback.' + actionName, ++lead.version, NOW, JSON.stringify({ taskId: task.id, fields }));
    }
    const updateLead = db.prepare('UPDATE leads SET version=? WHERE id=? AND business_id=?');
    for (const lead of leads) updateLead.run(lead.version, lead.id, owner.businessId);
    db.exec('COMMIT');
    return { leads, tasks: tasks.map(task => ({ ...task, version: revisions })), taskNotes, transcript, operationCount: taskCount * revisions };
  } catch (error) { try { db.exec('ROLLBACK'); } catch (_) {} throw error; }
  finally { db.close(); }
}

module.exports = { seedCallbackCapacity, NOW };
