'use strict';

const crypto = require('node:crypto');
const panels = require('./panels.cjs');

// Tombstones retain retry identifiers and digests, not removed record contents.
// They prevent an interrupted pre-deletion create from recreating a record.
const LIFECYCLE_TABLE_SQL = Object.freeze({
  record_deletions: 'CREATE TABLE record_deletions (business_id TEXT NOT NULL REFERENCES businesses(id), kind TEXT NOT NULL, target_id TEXT NOT NULL, parent_id TEXT NOT NULL, create_key TEXT NOT NULL, create_hash TEXT NOT NULL, deleted_version INTEGER NOT NULL, deleted_at INTEGER NOT NULL, PRIMARY KEY(business_id,kind,target_id), UNIQUE(business_id,kind,parent_id,create_key)) STRICT',
  deletion_operations: 'CREATE TABLE deletion_operations (business_id TEXT NOT NULL REFERENCES businesses(id), operation_key TEXT NOT NULL, request_hash TEXT NOT NULL, result_json TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(business_id,operation_key)) STRICT',
  safety_holds: 'CREATE TABLE safety_holds (business_id TEXT NOT NULL REFERENCES businesses(id), phone_hash TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(business_id,phone_hash)) STRICT'
});
const LIFECYCLE_INDEX_SQL = Object.freeze({});
const LIFECYCLE_AUTO_INDEXES = Object.freeze(['sqlite_autoindex_record_deletions_1', 'sqlite_autoindex_record_deletions_2', 'sqlite_autoindex_deletion_operations_1', 'sqlite_autoindex_safety_holds_1']);
const LIFECYCLE_COLUMNS = Object.freeze({
  record_deletions: ['business_id', 'kind', 'target_id', 'parent_id', 'create_key', 'create_hash', 'deleted_version', 'deleted_at'],
  deletion_operations: ['business_id', 'operation_key', 'request_hash', 'result_json', 'created_at'],
  safety_holds: ['business_id', 'phone_hash', 'created_at']
});
const MAX_DELETION_OPERATIONS = 20000;
const KINDS = new Set(['lead', 'panel_project', 'panel_source']);
const OPERATION_KINDS = new Set([...KINDS, 'lead_conversation']);
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const phoneHash = (businessId, phone) => hash(businessId + '\0' + phone);

function createLifecycle({ db, tx, now, getActor, store, StoreError, addAudit, assertLeadMutation, enabled, callbackTasksEnabled = false }) {
  function requireCurrentSchema() {
    if (!enabled) throw new StoreError(409, 'upgrade_required', 'Start the current workspace version before using deletion.');
  }
  function validateDelete(actor, id, input, operationKey, parentId = '') {
    getActor(actor); requireCurrentSchema();
    if (!panels.UUID.test(id) || (parentId && !panels.UUID.test(parentId))) throw new StoreError(400, 'invalid_input', 'Use the saved record identifier.');
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length !== 2 || !Object.hasOwn(input, 'confirmation') || input.confirmation !== 'DELETE' || !Number.isSafeInteger(input.version) || input.version < 1 || input.version >= Number.MAX_SAFE_INTEGER || !Object.hasOwn(input, 'version')) throw new StoreError(400, 'deletion_confirmation_required', 'Confirm deletion and use the current saved version.');
    panels.validateIdempotencyKey(operationKey);
  }
  function operation(actor, kind, id, parentId, input, key, mutate) {
    validateDelete(actor, id, input, key, parentId);
    const requestHash = hash(JSON.stringify({ kind, id, parentId, version: input.version, confirmation: input.confirmation }));
    return tx(() => {
      const prior = db.prepare('SELECT request_hash,result_json FROM deletion_operations WHERE business_id=? AND operation_key=?').get(actor.businessId, key);
      if (prior) {
        if (prior.request_hash !== requestHash) throw new StoreError(409, 'idempotency_conflict', 'This retry identifier belongs to a different deletion.');
        return JSON.parse(prior.result_json);
      }
      if (db.prepare('SELECT count(*) AS n FROM deletion_operations').get().n >= MAX_DELETION_OPERATIONS) throw new StoreError(503, 'deletion_history_limit', 'Deletion history requires an operator storage review before more records can be removed.');
      const time = now();
      if (!Number.isSafeInteger(time) || time < 0 || time > 8640000000000000) throw new StoreError(503, 'clock_unavailable', 'Check the workspace clock before deleting.');
      const details = mutate(time);
      const result = { deleted: true, kind, id, ...(parentId ? { parentId } : {}), version: input.version + 1, deletedAt: new Date(time).toISOString(), ...details };
      db.prepare('INSERT INTO deletion_operations VALUES (?,?,?,?,?)').run(actor.businessId, key, requestHash, JSON.stringify(result), time);
      return result;
    });
  }
  function assertVersion(record, version) {
    if (record.version !== version) throw new StoreError(409, 'version_conflict', 'This record changed. Reload it before deleting.');
  }
  function tombstone(actor, kind, row, parentId, version, time) {
    db.prepare('INSERT INTO record_deletions VALUES (?,?,?,?,?,?,?,?)').run(actor.businessId, kind, row.id, parentId, row.idempotency_key, row.request_hash, version, time);
  }
  const lifecycle = {
    assertNotDeleted(actor, kind, key, parentId = '') {
      if (!enabled) return;
      if (db.prepare('SELECT 1 FROM record_deletions WHERE business_id=? AND kind=? AND parent_id=? AND create_key=?').get(actor.businessId, kind, parentId, key)) throw new StoreError(409, 'record_deleted', 'This saved record was deleted. A previous create or upload retry cannot recreate it.');
    },
    isSafetyHeld(actor, phone) {
      return enabled && !!db.prepare('SELECT 1 FROM safety_holds WHERE business_id=? AND phone_hash=?').get(actor.businessId, phoneHash(actor.businessId, phone));
    },
    preserveSafetyHold(actor, phone, time = now()) {
      if (!enabled) return false;
      if (!Number.isSafeInteger(time) || time < 0 || time > 8640000000000000) throw new StoreError(503, 'clock_unavailable', 'Check the workspace clock before recording a safety hold.');
      return db.prepare('INSERT OR IGNORE INTO safety_holds VALUES (?,?,?)').run(actor.businessId, phoneHash(actor.businessId, phone), time).changes === 1;
    },
    deleteLead(actor, id, input, key) {
      return operation(actor, 'lead', id, '', input, key, time => {
        const lead = store.getLead(actor, id); assertVersion(lead, input.version);
        // The record is removed, so a safe terminal receipt is sufficient.
        assertLeadMutation(lead, time, false);
        const row = db.prepare('SELECT * FROM leads WHERE id=? AND business_id=?').get(id, actor.businessId);
        if (lead.safetyHold) lifecycle.preserveSafetyHold(actor, lead.phone, time);
        // STOP suppression is intentionally independent and is never removed.
        const messagesDeleted = Number(db.prepare('DELETE FROM messages WHERE lead_id=? AND business_id=?').run(id, actor.businessId).changes);
        if (callbackTasksEnabled) {
          db.prepare('DELETE FROM callback_operations WHERE lead_id=? AND business_id=?').run(id, actor.businessId);
          db.prepare('DELETE FROM callback_tasks WHERE lead_id=? AND business_id=?').run(id, actor.businessId);
        }
        db.prepare('DELETE FROM audit WHERE lead_id=? AND business_id=?').run(id, actor.businessId);
        tombstone(actor, 'lead', row, '', input.version, time);
        db.prepare('DELETE FROM leads WHERE id=? AND business_id=? AND version=?').run(id, actor.businessId, input.version);
        addAudit(actor, null, 'lead.deleted', input.version + 1, { recordId: id, messagesDeleted }, time);
        return { messagesDeleted };
      });
    },
    deleteLeadConversation(actor, id, input, key) {
      return operation(actor, 'lead_conversation', id, '', input, key, time => {
        const lead = store.getLead(actor, id); assertVersion(lead, input.version);
        assertLeadMutation(lead, time);
        const messagesDeleted = Number(db.prepare('DELETE FROM messages WHERE lead_id=? AND business_id=?').run(id, actor.businessId).changes);
        db.prepare('UPDATE leads SET version=version+1,updated_at=? WHERE id=? AND business_id=? AND version=?').run(time, id, actor.businessId, input.version);
        addAudit(actor, id, 'lead.conversation_deleted', input.version + 1, { messagesDeleted }, time);
        return { messagesDeleted };
      });
    },
    deletePanelProject(actor, id, input, key) {
      return operation(actor, 'panel_project', id, '', input, key, time => {
        const project = store.getPanelProject(actor, id); assertVersion(project, input.version);
        panels.writeTime(time, Date.parse(project.updatedAt));
        const row = db.prepare('SELECT * FROM panel_projects WHERE id=? AND business_id=?').get(id, actor.businessId);
        const sourcesDeleted = Number(db.prepare('DELETE FROM panel_sources WHERE project_id=? AND business_id=?').run(id, actor.businessId).changes);
        tombstone(actor, 'panel_project', row, '', input.version, time);
        db.prepare('DELETE FROM panel_projects WHERE id=? AND business_id=? AND version=?').run(id, actor.businessId, input.version);
        addAudit(actor, null, 'panel.deleted', input.version + 1, { projectId: id, sourcesDeleted }, time);
        return { sourcesDeleted };
      });
    },
    deletePanelSource(actor, projectId, sourceId, input, key) {
      return operation(actor, 'panel_source', sourceId, projectId, input, key, time => {
        const project = store.getPanelProject(actor, projectId); assertVersion(project, input.version);
        const version = panels.nextVersion(project.version);
        panels.writeTime(time, Date.parse(project.updatedAt));
        const row = db.prepare('SELECT * FROM panel_sources WHERE id=? AND project_id=? AND business_id=?').get(sourceId, projectId, actor.businessId);
        if (!row) throw new StoreError(404, 'not_found', 'The source image was not found.');
        let referencesCleared = 0;
        const rows = project.rows.map(item => {
          if (item.sourceImageId !== sourceId) return item;
          referencesCleared += 1;
          return { ...item, sourceImageId: null, reviewStatus: 'unreviewed' };
        });
        tombstone(actor, 'panel_source', row, projectId, input.version, time);
        db.prepare('UPDATE panel_projects SET rows_json=?,version=?,updated_at=? WHERE id=? AND business_id=? AND version=?').run(JSON.stringify(rows), version, time, projectId, actor.businessId, input.version);
        db.prepare('DELETE FROM panel_sources WHERE id=? AND project_id=? AND business_id=?').run(sourceId, projectId, actor.businessId);
        addAudit(actor, null, 'panel.source_deleted', version, { projectId, sourceId, referencesCleared }, time);
        return { referencesCleared };
      });
    }
  };
  return lifecycle;
}

function validateLifecycleDatabase(db, fail) {
  const invalid = () => fail('invalid_database', 'The workspace contains invalid deletion or restriction metadata.');
  const integer = n => Number.isSafeInteger(n) && n >= 0;
  const timestamp = n => integer(n) && n <= 8640000000000000;
  if (db.prepare('SELECT count(*) AS n FROM deletion_operations').get().n > MAX_DELETION_OPERATIONS) invalid();
  const tombstones = new Map();
  const tombstoneKey = (businessId, kind, id) => [businessId, kind, id].join('\0');
  for (const row of db.prepare('SELECT * FROM record_deletions').iterate()) {
    if (!KINDS.has(row.kind) || !panels.UUID.test(row.target_id) || (row.kind === 'panel_source' ? !panels.UUID.test(row.parent_id) : row.parent_id !== '') || !/^[A-Za-z0-9_-]{16,128}$/.test(row.create_key) || !/^[a-f0-9]{64}$/.test(row.create_hash) || !integer(row.deleted_version) || row.deleted_version < 1 || row.deleted_version >= Number.MAX_SAFE_INTEGER || !timestamp(row.deleted_at)) invalid();
    const table = row.kind === 'lead' ? 'leads' : row.kind === 'panel_project' ? 'panel_projects' : 'panel_sources';
    if (db.prepare('SELECT 1 FROM ' + table + ' WHERE id=?').get(row.target_id)) invalid();
    tombstones.set(tombstoneKey(row.business_id, row.kind, row.target_id), { row, seen: false });
  }
  for (const row of db.prepare('SELECT * FROM deletion_operations').iterate()) {
    if (!/^[A-Za-z0-9_-]{16,128}$/.test(row.operation_key) || !/^[a-f0-9]{64}$/.test(row.request_hash) || !timestamp(row.created_at)) invalid();
    let result; try { result = JSON.parse(row.result_json); } catch (_) { invalid(); }
    if (!result || typeof result !== 'object' || Array.isArray(result) || result.deleted !== true || !OPERATION_KINDS.has(result.kind) || !panels.UUID.test(result.id) || !integer(result.version) || result.version < 2 || result.deletedAt !== new Date(row.created_at).toISOString()) invalid();
    const allowed = ['deleted', 'kind', 'id', 'version', 'deletedAt', ...(result.kind === 'panel_source' ? ['parentId', 'referencesCleared'] : result.kind === 'panel_project' ? ['sourcesDeleted'] : ['messagesDeleted'])];
    if (Object.keys(result).length !== allowed.length || Object.keys(result).some(key => !allowed.includes(key)) || allowed.some(key => !Object.hasOwn(result, key))) invalid();
    if (row.request_hash !== hash(JSON.stringify({ kind: result.kind, id: result.id, parentId: result.parentId || '', version: result.version - 1, confirmation: 'DELETE' }))) invalid();
    if (result.kind !== 'lead_conversation') {
      const deletion = tombstones.get(tombstoneKey(row.business_id, result.kind, result.id));
      if (!deletion || deletion.row.deleted_version !== result.version - 1 || deletion.row.parent_id !== (result.parentId || '') || deletion.row.deleted_at !== row.created_at) invalid();
      deletion.seen = true;
    }
    if (result.kind === 'panel_source' && (!panels.UUID.test(result.parentId) || !integer(result.referencesCleared) || result.referencesCleared > panels.MAX_ROWS)) invalid();
    if (result.kind === 'panel_project' && (!integer(result.sourcesDeleted) || result.sourcesDeleted > panels.MAX_SOURCES)) invalid();
    if ((result.kind === 'lead' || result.kind === 'lead_conversation') && (!integer(result.messagesDeleted) || result.messagesDeleted > 60)) invalid();
  }
  if ([...tombstones.values()].some(item => !item.seen)) invalid();
  for (const row of db.prepare('SELECT * FROM safety_holds').iterate()) if (!/^[a-f0-9]{64}$/.test(row.phone_hash) || !timestamp(row.created_at)) invalid();
  for (const row of db.prepare('SELECT business_id,status,data_json FROM leads').iterate()) {
    const data = JSON.parse(row.data_json);
    const retained = !!db.prepare('SELECT 1 FROM safety_holds WHERE business_id=? AND phone_hash=?').get(row.business_id, phoneHash(row.business_id, data.phone));
    if (data.safetyHold !== retained || (retained && row.status !== 'needs_review')) invalid();
  }
}

module.exports = { LIFECYCLE_TABLE_SQL, LIFECYCLE_INDEX_SQL, LIFECYCLE_AUTO_INDEXES, LIFECYCLE_COLUMNS, createLifecycle, validateLifecycleDatabase, phoneHash, MAX_DELETION_OPERATIONS };
