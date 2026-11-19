'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { Worker } = require('node:worker_threads');
const { once } = require('node:events');
const { DatabaseSync } = require('node:sqlite');
const { openStore } = require('../workspace/store.cjs');
const { hashPassword } = require('../workspace/auth.cjs');
const { runConcurrent } = require('./helpers/concurrent-store.cjs');

const HASH = hashPassword('Synthetic concurrency fixture password 2026!');
const IMAGE = fs.readFileSync(path.join(__dirname, 'fixtures/panels/complete.png'));
const row = () => ({ partNumber: ' 000042 ', manufacturer: 'SYNTHETIC MAKER', description: 'Fixture Ω, "quoted"\nsecond line', quantity: 1, reviewStatus: 'unreviewed', notes: ' retain spaces ', sourceImageId: null });
const project = () => ({ name: 'Concurrent synthetic project', notes: ' before ', rows: [row()] });
const lead = () => ({ customerName: 'Synthetic Concurrent Customer', phone: '+15865550101', job: 'EV charger estimate', zip: '48315', callbackWindow: 'After 4 PM', requestedWorkDate: 'Saturday', contactPermission: 'requested_callback', conversation: [{ role: 'customer', text: 'I need an EV charger estimate.' }] });

async function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'panelreply-concurrent-'));
  const dataDir = path.join(root, 'source');
  const store = openStore({ dataDir });
  const hash = await HASH;
  const alice = store.createBusinessOwner({ businessName: 'Concurrent Fixture A', username: 'fixture-a@example.test', passwordHash: hash });
  const bob = store.createBusinessOwner({ businessName: 'Concurrent Fixture B', username: 'fixture-b@example.test', passwordHash: hash });
  t.after(() => { store.close(); fs.rmSync(root, { recursive: true, force: true }); });
  return { root, dataDir, store, alice, bob };
}

test('four simultaneous project creates on separate SQLite connections share one idempotent record', async t => {
  const f = await fixture(t), key = crypto.randomUUID(), input = project();
  const results = await runConcurrent(f.dataDir, Array.from({ length: 4 }, () => ({ operation: 'createProject', actor: f.alice, input, key })));
  assert.ok(results.every(result => result.ok), JSON.stringify(results));
  assert.equal(results.filter(result => result.result.created).length, 1);
  assert.equal(new Set(results.map(result => result.result.project.id)).size, 1);
  assert.equal(f.store.listPanelProjects(f.alice).length, 1);
  assert.deepEqual(f.store.getPanelProject(f.alice, results[0].result.project.id).rows, input.rows);
});

test('four simultaneous customer-request retries create one request, transcript and audit event', async t => {
  const f = await fixture(t), key = crypto.randomUUID(), input = lead();
  const results = await runConcurrent(f.dataDir, Array.from({ length: 4 }, () => ({ operation: 'createLead', actor: f.alice, input, key })));
  assert.ok(results.every(result => result.ok), JSON.stringify(results));
  assert.equal(results.filter(result => result.result.created).length, 1);
  const requests = f.store.listLeads(f.alice);
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0].conversation, input.conversation);
  assert.equal(requests[0].audit.filter(item => item.action === 'lead.created').length, 1);
  assert.equal(requests[0].requestedWorkDate, 'Saturday');
  assert.equal(requests[0].contactAllowed, true);
});

test('simultaneous project edits accept one version and reject the stale writer without lost data', async t => {
  const f = await fixture(t), saved = f.store.createPanelProject(f.alice, project(), crypto.randomUUID()).project;
  const results = await runConcurrent(f.dataDir, ['first correction', 'second correction'].map(notes => ({ operation: 'updateProject', actor: f.alice, id: saved.id, input: { ...project(), notes, version: saved.version } })));
  assert.equal(results.filter(result => result.ok).length, 1);
  assert.equal(results.find(result => !result.ok).code, 'version_conflict');
  const winner = results.find(result => result.ok).result;
  const latest = f.store.getPanelProject(f.alice, saved.id);
  assert.equal(latest.version, 2);
  assert.equal(latest.notes, winner.notes);
  assert.deepEqual(latest.rows, winner.rows);
});

test('simultaneous identical image retries attach one private source and increment version once', async t => {
  const f = await fixture(t), saved = f.store.createPanelProject(f.alice, project(), crypto.randomUUID()).project, key = crypto.randomUUID();
  const input = { version: 1, name: 'fixture.png', mime: 'image/png', dataBase64: IMAGE.toString('base64') };
  const results = await runConcurrent(f.dataDir, Array.from({ length: 4 }, () => ({ operation: 'addSource', actor: f.alice, id: saved.id, input, key })));
  assert.ok(results.every(result => result.ok), JSON.stringify(results));
  assert.equal(results.filter(result => result.result.created).length, 1);
  const latest = f.store.getPanelProject(f.alice, saved.id);
  assert.equal(latest.version, 2);
  assert.equal(latest.sources.length, 1);
  assert.deepEqual(f.store.getPanelSource(f.alice, saved.id, latest.sources[0].id).data, IMAGE);
});

test('concurrent businesses using the same retry key retain independent records and access boundaries', async t => {
  const f = await fixture(t), key = crypto.randomUUID();
  const results = await runConcurrent(f.dataDir, [f.alice, f.bob, f.alice, f.bob].map(actor => ({ operation: 'createProject', actor, input: project(), key })));
  assert.ok(results.every(result => result.ok), JSON.stringify(results));
  assert.equal(results.filter(result => result.result.created).length, 2);
  assert.equal(new Set(results.map(result => result.result.project.id)).size, 2);
  const own = f.store.listPanelProjects(f.alice), other = f.store.listPanelProjects(f.bob);
  assert.equal(own.length, 1); assert.equal(other.length, 1);
  assert.throws(() => f.store.getPanelProject(f.bob, own[0].id), error => error.code === 'not_found');
  assert.throws(() => f.store.exportPanelProject(f.alice, other[0].id), error => error.code === 'not_found');
});

test('terminating a writer with an uncommitted transaction rolls back without corrupting saved records', async t => {
  const f = await fixture(t), saved = f.store.createPanelProject(f.alice, project(), crypto.randomUUID()).project;
  const worker = new Worker(path.join(__dirname, 'helpers/concurrent-store.cjs'), { workerData: { dataDir: f.dataDir, task: { operation: 'uncommitted', actor: f.alice, id: saved.id }, barrier: new SharedArrayBuffer(4) } });
  t.after(() => worker.terminate());
  const [message] = await once(worker, 'message', { signal: AbortSignal.timeout(5000) });
  assert.equal(message.type, 'uncommitted');
  assert.deepEqual(f.store.getPanelProject(f.alice, saved.id), saved);
  await worker.terminate();
  const reopened = openStore({ dataDir: f.dataDir, create: false });
  try { assert.deepEqual(reopened.getPanelProject(f.alice, saved.id), saved); }
  finally { reopened.close(); }
  const db = new DatabaseSync(path.join(f.dataDir, 'workspace.sqlite'), { readOnly: true });
  try { assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok'); assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []); }
  finally { db.close(); }
});
