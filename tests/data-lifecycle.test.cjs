'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { Worker } = require('node:worker_threads');
const { once } = require('node:events');
const { openStore, SCHEMAS, SCHEMA_VERSION, assertWorkspaceSchema } = require('../workspace/store.cjs');
const { MAX_DELETION_OPERATIONS } = require('../workspace/lifecycle.cjs');
const { hashPassword, createAuth } = require('../workspace/auth.cjs');
const { createEncryptedBackup, restoreEncryptedBackup, validateDatabase, RESTORE_DISABLED_PASSWORD } = require('../workspace/backup.cjs');
const { runConcurrent } = require('./helpers/concurrent-store.cjs');

const PASSWORD = 'Synthetic lifecycle owner password 2026!';
const PASSPHRASE = 'Synthetic lifecycle archive passphrase 2026!';
const HASH = hashPassword(PASSWORD);
const IMAGE = fs.readFileSync(path.join(__dirname, 'fixtures/panels/complete.png'));
const key = () => crypto.randomUUID();
const confirm = version => ({ version, confirmation: 'DELETE' });
const errorCode = code => error => error.code === code;
const request = (change = {}) => ({ customerName: 'Synthetic Lifecycle Customer', phone: '+15865550101', job: 'Install a fixture EV charger', zip: '48315', callbackWindow: 'After 4 PM', requestedWorkDate: 'Saturday', contactPermission: 'requested_callback', conversation: [{ role: 'customer', text: 'Please call after four about an EV charger.' }], ...change });
const row = (change = {}) => ({ partNumber: '000042', manufacturer: 'Synthetic Maker', description: 'Corrected Ω, "quoted"\npart', quantity: 3, reviewStatus: 'reviewed', notes: 'Retain correction', sourceImageId: null, ...change });
const project = (change = {}) => ({ name: 'Synthetic Lifecycle Panel', notes: 'Project notes', rows: [row()], ...change });

async function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'panelreply-lifecycle-'));
  const dataDir = path.join(root, 'source');
  let store = openStore({ dataDir });
  const passwordHash = await HASH;
  const alice = store.createBusinessOwner({ businessName: 'Lifecycle Fixture A', username: 'lifecycle-a@example.test', passwordHash });
  const bob = store.createBusinessOwner({ businessName: 'Lifecycle Fixture B', username: 'lifecycle-b@example.test', passwordHash });
  t.after(() => { store?.close(); fs.rmSync(root, { recursive: true, force: true }); });
  return { root, dataDir, alice, bob, get store() { return store; }, reopen() { store.close(); store = openStore({ dataDir, create: false }); }, close() { store?.close(); store = null; } };
}
function snapshot(filename) {
  const db = new DatabaseSync(filename, { readOnly: true });
  try { return Object.fromEntries(Object.keys(SCHEMAS[SCHEMA_VERSION].tables).map(table => [table, db.prepare('SELECT * FROM ' + table + ' ORDER BY rowid').all().map(row => ({ ...row }))])); }
  finally { db.close(); }
}
function database(f, run) {
  const db = new DatabaseSync(f.store.filename);
  try { return run(db); } finally { db.close(); }
}
function addImage(f, saved, imageKey = key()) { return f.store.addPanelSource(f.alice, saved.id, { version: saved.version, name: 'synthetic.png', mime: 'image/png', dataBase64: IMAGE.toString('base64') }, imageKey); }
async function createArchive(f, name = 'after.prbk') { const outputFile = path.join(f.root, name); await createEncryptedBackup({ dataDir: f.dataDir, outputFile, passphrase: PASSPHRASE }); return outputFile; }
async function restoreArchive(f, archive, name = 'restored') {
  const dataDir = path.join(f.root, name);
  await restoreEncryptedBackup({ backupFile: archive, dataDir, passphrase: PASSPHRASE });
  return openStore({ dataDir, create: false });
}

test('project deletion removes its rows and private images without changing another business', async t => {
  const f = await fixture(t);
  const p = f.store.createPanelProject(f.alice, project(), key()).project;
  const uploaded = addImage(f, p);
  const saved = f.store.updatePanelProject(f.alice, p.id, { version: uploaded.project.version, ...project({ rows: [row({ sourceImageId: uploaded.source.id })] }) });
  const other = f.store.createPanelProject(f.bob, project(), key()).project;
  const result = f.store.deletePanelProject(f.alice, saved.id, confirm(saved.version), key());
  assert.equal(result.kind, 'panel_project'); assert.equal(result.deleted, true); assert.equal(result.sourcesDeleted, 1);
  assert.deepEqual(f.store.listPanelProjects(f.alice), []);
  assert.throws(() => f.store.getPanelProject(f.alice, saved.id), errorCode('not_found'));
  assert.throws(() => f.store.getPanelSource(f.alice, saved.id, uploaded.source.id), errorCode('not_found'));
  assert.throws(() => f.store.exportPanelProject(f.alice, saved.id), errorCode('not_found'));
  assert.deepEqual(f.store.getPanelProject(f.bob, other.id), other);
  database(f, db => { assert.equal(db.prepare('SELECT count(*) AS n FROM panel_sources').get().n, 0); assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []); });
});

test('source deletion preserves corrected cells, clears only matching links and requires review again', async t => {
  const f = await fixture(t), p = f.store.createPanelProject(f.alice, project(), key()).project;
  const one = addImage(f, p), two = addImage(f, one.project);
  const original = [row({ sourceImageId: one.source.id }), row({ partNumber: 'OTHER', sourceImageId: two.source.id }), row({ partNumber: 'MANUAL' })];
  const saved = f.store.updatePanelProject(f.alice, p.id, { version: two.project.version, ...project({ rows: original }) });
  const receipt = f.store.deletePanelSource(f.alice, p.id, one.source.id, confirm(saved.version), key());
  const current = f.store.getPanelProject(f.alice, p.id);
  assert.equal(receipt.referencesCleared, 1); assert.equal(receipt.parentId, p.id); assert.equal(receipt.version, current.version);
  assert.deepEqual(current.rows, [{ ...original[0], sourceImageId: null, reviewStatus: 'unreviewed' }, original[1], original[2]]);
  assert.equal(current.sources.length, 1); assert.equal(current.sources[0].id, two.source.id);
  assert.deepEqual(f.store.getPanelSource(f.alice, p.id, two.source.id).data, IMAGE);
  assert.throws(() => f.store.getPanelSource(f.alice, p.id, one.source.id), errorCode('not_found'));
  assert.ok(f.store.exportPanelProject(f.alice, p.id).includes('000042'));
  assert.throws(() => f.store.updatePanelProject(f.alice, p.id, { version: current.version, ...project({ rows: original }) }), errorCode('source_not_found'));
});

test('request deletion removes customer fields, notes and transcript and keeps a content-free receipt', async t => {
  const f = await fixture(t);
  let lead = f.store.createLead(f.alice, request(), key()).lead;
  lead = f.store.updateLead(f.alice, lead.id, { version: lead.version, status: 'new', notes: 'Synthetic private note to remove' });
  const receipt = f.store.deleteLead(f.alice, lead.id, confirm(lead.version), key());
  assert.equal(receipt.messagesDeleted, 1); assert.deepEqual(f.store.listLeads(f.alice), []);
  assert.deepEqual(f.store.exportBusiness(f.alice).leads, []);
  assert.throws(() => f.store.getLead(f.alice, lead.id), errorCode('not_found'));
  const saved = snapshot(f.store.filename);
  assert.equal(saved.messages.length, 0); assert.equal(saved.leads.length, 0);
  const encoded = JSON.stringify(saved);
  for (const value of [lead.customerName, lead.job, lead.phone, lead.notes, lead.conversation[0].text]) assert.equal(encoded.includes(value), false);
  assert.equal(saved.audit.filter(item => item.action === 'lead.deleted').length, 1);
});

test('conversation removal preserves the request, safety hold, opt-out and corrected fields', async t => {
  const f = await fixture(t), lead = f.store.createLead(f.alice, request({ conversation: [{ role: 'customer', text: 'The outlet is sparking. STOP texting me.' }] }), key()).lead;
  assert.equal(lead.safetyHold, true); assert.equal(lead.optedOut, true);
  const receipt = f.store.deleteLeadConversation(f.alice, lead.id, confirm(lead.version), key());
  const current = f.store.getLead(f.alice, lead.id);
  assert.equal(receipt.messagesDeleted, 1); assert.deepEqual(current.conversation, []);
  for (const field of ['customerName', 'phone', 'job', 'zip', 'callbackWindow', 'requestedWorkDate', 'safetyHold', 'optedOut', 'contactAllowed', 'status']) assert.deepEqual(current[field], lead[field]);
  assert.equal(current.version, lead.version + 1);
  assert.throws(() => f.store.updateLead(f.alice, lead.id, { version: lead.version, status: 'closed' }), errorCode('version_conflict'));
});

test('deleting an opted-out request never removes phone suppression or another business boundary', async t => {
  const f = await fixture(t), lead = f.store.createLead(f.alice, request({ contactPermission: 'opted_out' }), key()).lead;
  f.store.deleteLead(f.alice, lead.id, confirm(lead.version), key());
  f.reopen();
  const recreated = f.store.createLead(f.alice, request(), key()).lead;
  assert.equal(recreated.optedOut, true); assert.equal(recreated.contactAllowed, false); assert.equal(recreated.status, 'needs_review');
  assert.equal(f.store.createLead(f.bob, request(), key()).lead.contactAllowed, true);
});

test('deleting and recreating a hazardous request cannot clear its retained safety hold', async t => {
  const f = await fixture(t), lead = f.store.createLead(f.alice, request({ job: 'Sparking outlet' }), key()).lead;
  f.store.deleteLead(f.alice, lead.id, confirm(lead.version), key()); f.reopen();
  const recreated = f.store.createLead(f.alice, request(), key()).lead;
  assert.equal(f.store.isSafetyHeld(f.alice, lead.phone), true);
  assert.equal(recreated.safetyHold, true); assert.equal(recreated.contactAllowed, false); assert.equal(recreated.status, 'needs_review');
  assert.equal(f.store.isSafetyHeld(f.bob, lead.phone), false);
  assert.equal(f.store.createLead(f.bob, request(), key()).lead.safetyHold, false);
  const ledger = database(f, db => db.prepare('SELECT * FROM safety_holds').all());
  assert.equal(ledger.length, 1); assert.equal(JSON.stringify(ledger).includes(lead.phone), false);
});

test('preview safety holds persist without saving a request and cannot cross a business boundary', async t => {
  const f = await fixture(t), phone = request().phone;
  assert.equal(f.store.holdPhone(f.alice, phone), true);
  const saved = snapshot(f.store.filename);
  assert.equal(saved.leads.length, 0); assert.equal(saved.messages.length, 0);
  assert.equal(saved.safety_holds.length, 1); assert.equal(JSON.stringify(saved).includes(phone), false);
  f.store.holdPhone(f.alice, phone); assert.deepEqual(snapshot(f.store.filename), saved);
  assert.throws(() => f.store.holdPhone({ ...f.alice, businessId: f.bob.businessId }, phone), errorCode('unauthorized'));
  assert.throws(() => f.store.holdPhone(f.alice, 'not a phone'), errorCode('invalid_input'));
  f.reopen(); assert.equal(f.store.isSafetyHeld(f.alice, phone), true); assert.equal(f.store.isSafetyHeld(f.bob, phone), false);
  const created = f.store.createLead(f.alice, request(), key()).lead;
  assert.equal(created.safetyHold, true); assert.equal(created.contactAllowed, false); assert.equal(created.status, 'needs_review');
});

test('preview safety holds atomically update existing requests and invalidate stale contact edits', async t => {
  const f = await fixture(t), one = f.store.createLead(f.alice, request(), key()).lead, two = f.store.createLead(f.alice, request(), key()).lead;
  const other = f.store.createLead(f.bob, request(), key()).lead;
  f.store.holdPhone(f.alice, one.phone);
  for (const original of [one, two]) {
    const current = f.store.getLead(f.alice, original.id);
    assert.equal(current.version, original.version + 1); assert.equal(current.safetyHold, true); assert.equal(current.contactAllowed, false); assert.equal(current.status, 'needs_review');
    assert.equal(current.audit.at(-1).action, 'safety.held');
    assert.throws(() => f.store.updateLead(f.alice, original.id, { version: original.version, status: 'contacted' }), errorCode('version_conflict'));
  }
  assert.deepEqual(f.store.getLead(f.bob, other.id), other);
  const after = snapshot(f.store.filename); f.store.holdPhone(f.alice, one.phone); assert.deepEqual(snapshot(f.store.filename), after);
});

test('correcting a held request phone preserves both old and new contact safeguards', async t => {
  const f = await fixture(t), held = f.store.createLead(f.alice, request({ job: 'Sparking outlet' }), key()).lead;
  const nextPhone = '+15865550177';
  const corrected = f.store.updateLead(f.alice, held.id, { version: held.version, status: 'needs_review', phone: nextPhone });
  assert.equal(corrected.safetyHold, true); assert.equal(f.store.isSafetyHeld(f.alice, held.phone), true); assert.equal(f.store.isSafetyHeld(f.alice, nextPhone), true);
  f.store.deleteLead(f.alice, held.id, confirm(corrected.version), key()); f.reopen();
  for (const phone of [held.phone, nextPhone]) assert.equal(f.store.createLead(f.alice, request({ phone }), key()).lead.safetyHold, true);
});

for (const kind of ['lead', 'panel_project', 'panel_source']) test(kind + ' deletion blocks a late original create retry from recreating data', async t => {
  const f = await fixture(t), createKey = key();
  let retry;
  if (kind === 'lead') {
    const saved = f.store.createLead(f.alice, request(), createKey).lead;
    f.store.deleteLead(f.alice, saved.id, confirm(saved.version), key());
    retry = () => f.store.createLead(f.alice, request(), createKey);
  } else {
    const saved = f.store.createPanelProject(f.alice, project(), kind === 'panel_project' ? createKey : key()).project;
    if (kind === 'panel_project') { f.store.deletePanelProject(f.alice, saved.id, confirm(saved.version), key()); retry = () => f.store.createPanelProject(f.alice, project(), createKey); }
    else {
      const upload = addImage(f, saved, createKey);
      f.store.deletePanelSource(f.alice, saved.id, upload.source.id, confirm(upload.project.version), key());
      retry = () => addImage(f, f.store.getPanelProject(f.alice, saved.id), createKey);
    }
  }
  assert.throws(retry, errorCode('record_deleted')); f.reopen(); assert.throws(retry, errorCode('record_deleted'));
});

async function deletionCase(t, kind) {
  const f = await fixture(t);
  let saved, invoke;
  if (kind.startsWith('lead')) {
    saved = f.store.createLead(f.alice, request(), key()).lead;
    invoke = (actor, input, operationKey) => f.store[kind === 'lead' ? 'deleteLead' : 'deleteLeadConversation'](actor, saved.id, input, operationKey);
  } else {
    saved = f.store.createPanelProject(f.alice, project(), key()).project;
    if (kind === 'panel_project') invoke = (actor, input, operationKey) => f.store.deletePanelProject(actor, saved.id, input, operationKey);
    else { const uploaded = addImage(f, saved); saved = uploaded.project; invoke = (actor, input, operationKey) => f.store.deletePanelSource(actor, saved.id, uploaded.source.id, input, operationKey); }
  }
  return { ...f, get store() { return f.store; }, saved, invoke };
}

for (const kind of ['lead', 'lead_conversation', 'panel_project', 'panel_source']) {
  test(kind + ' deletion retries return one stable receipt with one committed change', async t => {
    const f = await deletionCase(t, kind), operationKey = key(), input = confirm(f.saved.version);
    const result = f.invoke(f.alice, input, operationKey), after = snapshot(f.store.filename);
    assert.deepEqual(f.invoke(f.alice, input, operationKey), result); assert.deepEqual(snapshot(f.store.filename), after);
    assert.throws(() => f.invoke(f.alice, confirm(input.version + 1), operationKey), errorCode('idempotency_conflict'));
    assert.deepEqual(snapshot(f.store.filename), after);
  });
  test(kind + ' deletion refuses another business and an obsolete saved version', async t => {
    const f = await deletionCase(t, kind), before = snapshot(f.store.filename);
    assert.throws(() => f.invoke(f.bob, confirm(f.saved.version), key()), errorCode('not_found'));
    assert.throws(() => f.invoke(f.alice, confirm(f.saved.version + 1), key()), errorCode('version_conflict'));
    assert.deepEqual(snapshot(f.store.filename), before);
  });
  test(kind + ' transaction rolls back all removals when receipt persistence fails', async t => {
    const f = await deletionCase(t, kind), before = snapshot(f.store.filename);
    database(f, db => db.exec("CREATE TRIGGER synthetic_receipt_failure BEFORE INSERT ON deletion_operations BEGIN SELECT RAISE(ABORT,'synthetic persistence failure'); END"));
    assert.throws(() => f.invoke(f.alice, confirm(f.saved.version), key()), /synthetic persistence failure/);
    database(f, db => db.exec('DROP TRIGGER synthetic_receipt_failure'));
    assert.deepEqual(snapshot(f.store.filename), before);
    database(f, db => { assert.equal(assertWorkspaceSchema(db), SCHEMA_VERSION); assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []); });
  });
}

test('deletion requires explicit own-property confirmation, bounded version and retry key', async t => {
  const f = await deletionCase(t, 'lead'), before = snapshot(f.store.filename);
  const inherited = Object.assign(Object.create({ confirmation: 'DELETE' }), { version: 1, unexpected: true });
  for (const input of [undefined, null, [], { version: 1 }, { version: 1, confirmation: 'delete' }, { version: 1, confirmation: 'DELETE', extra: true }, { version: 0, confirmation: 'DELETE' }, { version: Number.MAX_SAFE_INTEGER, confirmation: 'DELETE' }, inherited]) assert.throws(() => f.invoke(f.alice, input, key()), errorCode('deletion_confirmation_required'));
  assert.throws(() => f.invoke(f.alice, confirm(1), 'bad'));
  assert.throws(() => f.invoke({ ...f.alice, businessId: f.bob.businessId }, confirm(1), key()), errorCode('unauthorized'));
  assert.deepEqual(snapshot(f.store.filename), before);
});

test('failed hazardous update does not leave an unintended persistent safety mutation', async t => {
  const f = await fixture(t), saved = f.store.createLead(f.alice, request(), key()).lead;
  const before = snapshot(f.store.filename);
  assert.throws(() => f.store.updateLead(f.alice, saved.id, { version: saved.version, status: 'new', job: 'Sparking outlet' }), errorCode('safety_review_required'));
  assert.equal(f.store.isSafetyHeld(f.alice, saved.phone), false); assert.deepEqual(snapshot(f.store.filename), before);
});

test('four simultaneous deletion retries across real connections commit one receipt', async t => {
  const f = await fixture(t), saved = f.store.createLead(f.alice, request(), key()).lead, operationKey = key();
  const results = await runConcurrent(f.dataDir, Array.from({ length: 4 }, () => ({ operation: 'deleteLead', actor: f.alice, id: saved.id, input: confirm(saved.version), key: operationKey })));
  assert.ok(results.every(item => item.ok), JSON.stringify(results));
  for (const item of results) assert.deepEqual(item.result, results[0].result);
  const data = snapshot(f.store.filename); assert.equal(data.leads.length, 0); assert.equal(data.messages.length, 0); assert.equal(data.deletion_operations.length, 1); assert.equal(data.record_deletions.length, 1);
});

for (const kind of ['lead', 'panel_project']) test(kind + ' simultaneous edit and deletion never loses an acknowledged edit', async t => {
  const f = await fixture(t), leadKind = kind === 'lead';
  const saved = leadKind ? f.store.createLead(f.alice, request(), key()).lead : f.store.createPanelProject(f.alice, project(), key()).project;
  const tasks = [{ operation: leadKind ? 'deleteLead' : 'deleteProject', actor: f.alice, id: saved.id, input: confirm(saved.version), key: key() }, { operation: leadKind ? 'updateLead' : 'updateProject', actor: f.alice, id: saved.id, input: leadKind ? { version: saved.version, status: 'new', notes: 'Acknowledged edit' } : { version: saved.version, ...project({ notes: 'Acknowledged edit' }) } }];
  const results = await runConcurrent(f.dataDir, tasks);
  assert.equal(results.filter(item => item.ok).length, 1, JSON.stringify(results));
  if (results[0].ok) {
    assert.equal(results[1].code, 'not_found');
    assert.throws(() => f.store[leadKind ? 'getLead' : 'getPanelProject'](f.alice, saved.id), errorCode('not_found'));
  } else {
    assert.equal(results[0].code, 'version_conflict');
    const current = f.store[leadKind ? 'getLead' : 'getPanelProject'](f.alice, saved.id);
    assert.equal(current.notes, 'Acknowledged edit'); assert.equal(current.version, saved.version + 1);
  }
});

test('simultaneous source and project deletions retain consistent source ownership', async t => {
  const f = await fixture(t), p = f.store.createPanelProject(f.alice, project(), key()).project, upload = addImage(f, p);
  const results = await runConcurrent(f.dataDir, [{ operation: 'deleteSource', actor: f.alice, id: p.id, sourceId: upload.source.id, input: confirm(upload.project.version), key: key() }, { operation: 'deleteProject', actor: f.alice, id: p.id, input: confirm(upload.project.version), key: key() }]);
  assert.equal(results.filter(item => item.ok).length, 1, JSON.stringify(results));
  assert.ok(['not_found', 'version_conflict'].includes(results.find(item => !item.ok).code));
  database(f, db => { assert.equal(db.prepare('SELECT count(*) AS n FROM panel_sources').get().n, 0); assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []); });
});

test('bounded deletion metadata rejects further changes while exact retry receipts still work', async t => {
  const f = await fixture(t), saved = f.store.createLead(f.alice, request(), key()).lead, operationKey = key();
  const receipt = f.store.deleteLead(f.alice, saved.id, confirm(saved.version), operationKey);
  database(f, db => {
    const original = db.prepare('SELECT * FROM deletion_operations').get();
    const insert = db.prepare('INSERT INTO deletion_operations VALUES (?,?,?,?,?)');
    db.exec('BEGIN');
    for (let i = 1; i < MAX_DELETION_OPERATIONS; i++) insert.run(original.business_id, 'synthetic-limit-' + String(i).padStart(6, '0'), original.request_hash, original.result_json, original.created_at);
    db.exec('COMMIT');
  });
  const remaining = f.store.createLead(f.alice, request(), key()).lead;
  assert.throws(() => f.store.deleteLead(f.alice, remaining.id, confirm(remaining.version), key()), errorCode('deletion_history_limit'));
  assert.deepEqual(f.store.getLead(f.alice, remaining.id), remaining);
  assert.deepEqual(f.store.deleteLead(f.alice, saved.id, confirm(saved.version), operationKey), receipt);
});

test('new backups preserve deletion state, retry tombstones, holds, unrelated records and images', async t => {
  const f = await fixture(t), leadKey = key(), projectKey = key();
  const deletedLead = f.store.createLead(f.alice, request({ job: 'Sparking outlet', contactPermission: 'opted_out' }), leadKey).lead;
  const retainedLead = f.store.createLead(f.bob, request(), key()).lead;
  const deletedProject = f.store.createPanelProject(f.alice, project(), projectKey).project;
  addImage(f, deletedProject);
  const currentProject = f.store.getPanelProject(f.alice, deletedProject.id);
  const retainedProject = f.store.createPanelProject(f.alice, project({ name: 'Retained project' }), key()).project, retainedImage = addImage(f, retainedProject);
  const deletionKey = key();
  const receipt = f.store.deleteLead(f.alice, deletedLead.id, confirm(deletedLead.version), deletionKey);
  f.store.deletePanelProject(f.alice, currentProject.id, confirm(currentProject.version), key());
  const before = snapshot(f.store.filename), archive = await createArchive(f);
  const recovered = await restoreArchive(f, archive);
  try {
    assert.equal(recovered.findUser(f.alice.username).password_hash, RESTORE_DISABLED_PASSWORD);
    assert.throws(() => recovered.getLead(f.alice, deletedLead.id), errorCode('not_found'));
    assert.throws(() => recovered.getPanelProject(f.alice, deletedProject.id), errorCode('not_found'));
    assert.deepEqual(recovered.getLead(f.bob, retainedLead.id), retainedLead);
    assert.deepEqual(recovered.getPanelProject(f.alice, retainedProject.id), retainedImage.project);
    assert.deepEqual(recovered.getPanelSource(f.alice, retainedProject.id, retainedImage.source.id).data, IMAGE);
    assert.equal(recovered.isSafetyHeld(f.alice, deletedLead.phone), true); assert.equal(recovered.isSuppressed(f.alice, deletedLead.phone), true);
    assert.deepEqual(recovered.deleteLead(f.alice, deletedLead.id, confirm(deletedLead.version), deletionKey), receipt);
    assert.throws(() => recovered.createLead(f.alice, request(), leadKey), errorCode('record_deleted'));
    assert.throws(() => recovered.createPanelProject(f.alice, project(), projectKey), errorCode('record_deleted'));
    assert.throws(() => recovered.getLead(f.alice, retainedLead.id), errorCode('not_found'));
    const after = snapshot(recovered.filename);
    for (const table of ['leads', 'messages', 'panel_projects', 'panel_sources', 'record_deletions', 'deletion_operations', 'safety_holds', 'suppression', 'audit', 'assistant_usage']) assert.deepEqual(after[table], before[table]);
    await assert.rejects(createAuth(recovered).login({ username: f.alice.username, password: PASSWORD }), errorCode('invalid_credentials'));
  } finally { recovered.close(); }
  assert.deepEqual(snapshot(f.store.filename), before);
});

test('an older archive retains older records and restores with disabled access for reconciliation', async t => {
  const f = await fixture(t), lead = f.store.createLead(f.alice, request(), key()).lead;
  const archive = await createArchive(f, 'before-deletion.prbk');
  f.store.deleteLead(f.alice, lead.id, confirm(lead.version), key());
  const recovered = await restoreArchive(f, archive);
  try { assert.deepEqual(recovered.getLead(f.alice, lead.id), lead); assert.equal(recovered.findUser(f.alice.username).password_hash, RESTORE_DISABLED_PASSWORD); await assert.rejects(createAuth(recovered).login({ username: f.alice.username, password: PASSWORD }), errorCode('invalid_credentials')); }
  finally { recovered.close(); }
  assert.throws(() => f.store.getLead(f.alice, lead.id), errorCode('not_found'));
});

test('backup taken while a deletion commits never restores a partially deleted record', async t => {
  const f = await fixture(t), lead = f.store.createLead(f.alice, request(), key()).lead;
  const outputFile = path.join(f.root, 'concurrent.prbk');
  const pending = createEncryptedBackup({ dataDir: f.dataDir, outputFile, passphrase: PASSPHRASE });
  f.store.deleteLead(f.alice, lead.id, confirm(lead.version), key());
  await pending;
  const recovered = await restoreArchive(f, outputFile);
  try {
    const records = recovered.listLeads(f.alice), data = snapshot(recovered.filename);
    if (records.length) { assert.deepEqual(records, [lead]); assert.equal(data.record_deletions.length, 0); assert.equal(data.messages.length, 1); }
    else { assert.equal(data.record_deletions.length, 1); assert.equal(data.messages.length, 0); assert.equal(data.deletion_operations.length, 1); }
    const db = new DatabaseSync(recovered.filename, { readOnly: true }); try { validateDatabase(db); } finally { db.close(); }
  } finally { recovered.close(); }
});

test('legacy schema 2 archive remains readable and migrates transactionally with its existing held data', async t => {
  const f = await fixture(t); f.close();
  const legacyDir = path.join(f.root, 'legacy'); fs.mkdirSync(legacyDir, { mode: 0o700 });
  const filename = path.join(legacyDir, 'workspace.sqlite'); fs.writeFileSync(filename, '', { mode: 0o600 });
  let db = new DatabaseSync(filename);
  db.exec([...Object.values(SCHEMAS[2].tables), ...Object.values(SCHEMAS[2].indexes), 'PRAGMA user_version=2'].join(';') + ';'); db.close();
  let legacy = openStore({ dataDir: legacyDir, create: false });
  const owner = legacy.createBusinessOwner({ businessName: 'Schema Two Fixture', username: 'legacy-two@example.test', passwordHash: await HASH });
  const held = legacy.createLead(owner, request({ job: 'Sparking outlet' }), key()).lead;
  const olderUnheld = legacy.createLead(owner, request(), key()).lead;
  assert.equal(olderUnheld.safetyHold, false);
  const p = legacy.createPanelProject(owner, project(), key()).project;
  assert.throws(() => legacy.deleteLead(owner, held.id, confirm(held.version), key()), errorCode('upgrade_required')); legacy.close();
  const archive = path.join(f.root, 'schema-two.prbk'), restoredDir = path.join(f.root, 'schema-two-restored');
  const backup = await createEncryptedBackup({ dataDir: legacyDir, outputFile: archive, passphrase: PASSPHRASE }); assert.equal(backup.schemaVersion, 2);
  const result = await restoreEncryptedBackup({ backupFile: archive, dataDir: restoredDir, passphrase: PASSPHRASE }); assert.equal(result.schemaVersion, 2);
  db = new DatabaseSync(path.join(restoredDir, 'workspace.sqlite')); assert.equal(assertWorkspaceSchema(db), 2); db.close();
  legacy = openStore({ dataDir: restoredDir });
  try {
    assert.deepEqual(legacy.getLead(owner, held.id), held); assert.deepEqual(legacy.getPanelProject(owner, p.id), p); assert.equal(legacy.isSafetyHeld(owner, held.phone), true);
    const migrated = legacy.getLead(owner, olderUnheld.id);
    assert.equal(migrated.safetyHold, true); assert.equal(migrated.contactAllowed, false); assert.equal(migrated.status, 'needs_review'); assert.equal(migrated.version, olderUnheld.version + 1);
    for (const field of ['customerName', 'phone', 'job', 'zip', 'callbackWindow', 'requestedWorkDate', 'notes', 'conversation']) assert.deepEqual(migrated[field], olderUnheld[field]);
    assert.equal(migrated.audit.at(-1).details.source, 'migration');
  }
  finally { legacy.close(); }
  db = new DatabaseSync(path.join(restoredDir, 'workspace.sqlite')); assert.equal(assertWorkspaceSchema(db), SCHEMA_VERSION); db.close();
});

test('backup validation rejects cross-tenant or malformed deletion metadata before publishing an archive', async t => {
  const f = await fixture(t), lead = f.store.createLead(f.alice, request(), key()).lead;
  f.store.deleteLead(f.alice, lead.id, confirm(lead.version), key());
  const original = snapshot(f.store.filename);
  const mutations = [
    db => db.prepare("UPDATE record_deletions SET kind='unrecognized'").run(),
    db => db.prepare("UPDATE record_deletions SET parent_id='wrong'").run(),
    db => db.prepare('UPDATE record_deletions SET business_id=?').run(f.bob.businessId),
    db => db.prepare('UPDATE record_deletions SET deleted_at=deleted_at+1').run(),
    db => db.prepare('DELETE FROM deletion_operations').run(),
    db => db.prepare("UPDATE deletion_operations SET result_json='{}'").run(),
    db => db.prepare("UPDATE deletion_operations SET request_hash=?").run('f'.repeat(64)),
    db => db.prepare('UPDATE deletion_operations SET created_at=-1').run()
  ];
  for (const mutate of mutations) database(f, db => { db.exec('BEGIN'); try { mutate(db); assert.throws(() => validateDatabase(db), errorCode('invalid_database')); } finally { db.exec('ROLLBACK'); } });
  assert.deepEqual(snapshot(f.store.filename), original);
});

test('backup validation rejects a missing or contradictory retained safety restriction', async t => {
  const f = await fixture(t), lead = f.store.createLead(f.alice, request({ job: 'Sparking outlet' }), key()).lead;
  const original = snapshot(f.store.filename);
  const mutations = [
    db => db.prepare('DELETE FROM safety_holds').run(),
    db => db.prepare("UPDATE leads SET status='new' WHERE id=?").run(lead.id),
    db => db.prepare("UPDATE leads SET data_json=json_set(data_json,'$.safetyHold',json('false')) WHERE id=?").run(lead.id)
  ];
  for (const mutate of mutations) database(f, db => { db.exec('BEGIN'); try { mutate(db); assert.throws(() => validateDatabase(db), errorCode('invalid_database')); } finally { db.exec('ROLLBACK'); } });
  assert.deepEqual(snapshot(f.store.filename), original);
});

test('killing an uncommitted deletion writer preserves the original record and transcript', async t => {
  const f = await fixture(t), lead = f.store.createLead(f.alice, request(), key()).lead, before = snapshot(f.store.filename);
  const worker = new Worker(path.join(__dirname, 'helpers/lifecycle-worker.cjs'), { workerData: { mode: 'uncommitted-delete', dataDir: f.dataDir, actor: f.alice, id: lead.id } });
  t.after(() => worker.terminate());
  const [message] = await once(worker, 'message', { signal: AbortSignal.timeout(10000) }); assert.equal(message.stage, 'uncommitted-delete');
  assert.deepEqual(f.store.getLead(f.alice, lead.id), lead); await worker.terminate();
  f.reopen(); assert.deepEqual(snapshot(f.store.filename), before);
  database(f, db => { assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok'); assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []); });
});

for (const stage of ['before-publication', 'after-link', 'after-unlink']) test('restore interruption at ' + stage + ' never mutates the source or enables old credentials', async t => {
  const f = await fixture(t); f.store.createLead(f.alice, request(), key());
  const archive = await createArchive(f), before = snapshot(f.store.filename), target = path.join(f.root, 'interrupted');
  const worker = new Worker(path.join(__dirname, 'helpers/lifecycle-worker.cjs'), { workerData: { mode: 'restore', stage, archive, target, passphrase: PASSPHRASE } });
  t.after(() => worker.terminate());
  const [message] = await once(worker, 'message', { signal: AbortSignal.timeout(10000) }); assert.equal(message.stage, stage, JSON.stringify(message));
  await worker.terminate(); assert.deepEqual(snapshot(f.store.filename), before);
  if (stage === 'after-unlink') {
    const recovered = openStore({ dataDir: target, create: false });
    try { assert.equal(recovered.findUser(f.alice.username).password_hash, RESTORE_DISABLED_PASSWORD); assert.deepEqual(recovered.listLeads(f.alice), f.store.listLeads(f.alice)); }
    finally { recovered.close(); }
  } else {
    assert.throws(() => openStore({ dataDir: target, create: false }));
    if (stage === 'before-publication') assert.equal(fs.existsSync(path.join(target, 'workspace.sqlite')), false);
    else assert.equal(fs.statSync(path.join(target, 'workspace.sqlite')).nlink, 2);
  }
  await assert.rejects(restoreEncryptedBackup({ backupFile: archive, dataDir: target, passphrase: PASSPHRASE }));
});
