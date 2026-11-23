'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { createRetentionReview } = require('../workspace/retention.cjs');
const { SCHEMAS, SCHEMA_VERSION, StoreError } = require('../workspace/store.cjs');

function fixture(t) {
  const db = new DatabaseSync(':memory:');
  for (const sql of Object.values(SCHEMAS[SCHEMA_VERSION].tables)) db.exec(sql);
  for (const sql of Object.values(SCHEMAS[SCHEMA_VERSION].indexes)) db.exec(sql);
  for (const id of ['a', 'b']) db.prepare('INSERT INTO businesses VALUES (?,?,1,?,0)').run(id, 'Synthetic business', '{}');
  t.after(() => db.close());
  let at = 10000;
  const actor = { id: 'owner-a', businessId: 'a' };
  const review = createRetentionReview({ db, now: () => at, StoreError, getActor(value) { if (value?.id !== actor.id || value.businessId !== actor.businessId) throw new StoreError(401, 'unauthorized', 'Sign in.'); } });
  function lead(id, { business = 'a', status = 'closed', time = 100, safetyHold = false } = {}) {
    db.prepare('INSERT INTO leads (id,business_id,status,data_json,version,created_at,updated_at,idempotency_key,request_hash) VALUES (?,?,?,?,1,?,?,?,?)').run(id, business, status, JSON.stringify({ safetyHold, customerName: 'PRIVATE CUSTOMER', phone: 'PRIVATE PHONE', job: 'PRIVATE JOB', notes: 'PRIVATE NOTES' }), time, time, id, 'hash');
  }
  function project(id, business = 'a', time = 100) {
    db.prepare('INSERT INTO panel_projects (id,business_id,name,notes,rows_json,version,created_at,updated_at,idempotency_key,request_hash) VALUES (?,?,?,?,?,1,?,?,?,?)').run(id, business, 'PRIVATE PROJECT', 'PRIVATE NOTES', '[]', time, time, id, 'hash');
  }
  return { db, actor, review, lead, project, setNow(value) { at = value; }, run(input = { before: 500, limit: 50 }) { return review(actor, input); } };
}

test('retention review excludes open, held, cutoff-equal, newer and other-tenant requests', t => {
  const f = fixture(t); f.lead('old'); f.lead('other', { business: 'b' }); f.lead('held', { safetyHold: true }); f.lead('equal', { time: 500 }); f.lead('recent', { time: 600 });
  for (const status of ['new', 'contacted', 'needs_review']) f.lead(status, { status });
  assert.deepEqual(f.run().requests.records.map(row => row.id), ['old']);
  assert.equal(f.run().requests.total, 1);
});

test('retention projects use last update and tenant scope with deterministic ordering', t => {
  const f = fixture(t); f.project('z'); f.project('a'); f.project('other', 'b'); f.project('equal', 'a', 500); f.project('recent', 'a', 600);
  const result = f.run();
  assert.deepEqual(result.projects.records.map(row => row.id), ['a', 'z']); assert.equal(result.projects.total, 2); assert.equal(result.projects.truncated, false);
});

test('retention result is content-free and marks bounded lists as truncated', t => {
  const f = fixture(t); for (let n = 0; n < 4; n++) { f.lead('lead-' + n); f.project('project-' + n); }
  const result = f.run({ before: 500, limit: 2 });
  for (const group of [result.requests, result.projects]) { assert.equal(group.total, 4); assert.equal(group.records.length, 2); assert.equal(group.truncated, true); }
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE|data_json|notes|phone|rows_json/);
  assert.equal(result.mode, 'review-only'); assert.equal(result.generatedAt, new Date(10000).toISOString());
});

test('retention review rejects missing, unknown, future and out-of-bounds policy inputs', t => {
  const f = fixture(t);
  for (const input of [undefined, null, [], {}, { before: 500 }, { before: 500, limit: 1, delete: true }, { before: -1, limit: 1 }, { before: 0.5, limit: 1 }, { before: 10001, limit: 1 }, { before: 500, limit: 0 }, { before: 500, limit: 501 }, { before: 500, limit: 1.1 }, { before: '500', limit: 1 }]) assert.throws(() => f.review(f.actor, input), { code: 'invalid_retention_review' });
  assert.equal(f.run({ before: 0, limit: 1 }).requests.total, 0);
});

test('retention review authenticates before reading and fails closed on invalid clocks', t => {
  const f = fixture(t); f.lead('old');
  for (const actor of [null, {}, { ...f.actor, businessId: 'b' }]) assert.throws(() => f.review(actor, { before: 500, limit: 1 }), { code: 'unauthorized' });
  for (const at of [NaN, -1, Infinity, 8640000000000001, 1.1]) { f.setNow(at); assert.throws(() => f.run(), { code: 'clock_unavailable' }); }
});

test('retention preview leaves every logical table and database change counter unchanged', t => {
  const f = fixture(t); f.lead('old'); f.project('panel');
  const snapshot = () => Object.fromEntries(Object.keys(SCHEMAS[SCHEMA_VERSION].tables).map(name => [name, f.db.prepare('SELECT * FROM ' + name).all()]));
  const before = snapshot(), changes = f.db.prepare('SELECT total_changes() AS n').get().n;
  f.run(); f.run(); assert.deepEqual(snapshot(), before); assert.equal(f.db.prepare('SELECT total_changes() AS n').get().n, changes);
});

test('retention read failures roll back and leave the connection usable', t => {
  const f = fixture(t); f.db.exec('ALTER TABLE messages RENAME TO missing_messages');
  assert.throws(() => f.run()); f.db.exec('ALTER TABLE missing_messages RENAME TO messages');
  assert.equal(f.run().requests.total, 0);
});

test('retention output keeps current versions and dependency counts for later manual confirmation', t => {
  const f = fixture(t); f.lead('old'); f.project('panel');
  f.db.prepare('UPDATE leads SET version=7 WHERE id=?').run('old');
  f.db.prepare('INSERT INTO messages (business_id,lead_id,position,role,text) VALUES (?,?,?,?,?)').run('a', 'old', 0, 'customer', 'PRIVATE TRANSCRIPT');
  const result = f.run(); assert.equal(result.requests.records[0].version, 7); assert.equal(result.requests.records[0].messageCount, 1); assert.equal(result.projects.records[0].sourceCount, 0);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE/);
});
