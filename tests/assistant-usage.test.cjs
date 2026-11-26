'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { Worker } = require('node:worker_threads');
const { openStore } = require('../workspace/store.cjs');
const { SYNTHETIC_POLICY, validateUsagePolicy, usageRequestHash, LEASE_MS, INPUT_BYTES } = require('../workspace/usage.cjs');
const { prepareExternalAssistant, resolveAssistantConfiguration } = require('../workspace/assistant-config.cjs');

const HASH = 'scrypt$32768$8$3$' + Buffer.alloc(16).toString('base64url') + '$' + Buffer.alloc(64).toString('base64url');
const input = { inputBytes: 1024, outputTokenLimit: 2048 };
const key = value => crypto.createHash('sha256').update(value || crypto.randomUUID()).digest('hex');
const monetary = { ...SYNTHETIC_POLICY, perAttemptReserveMicros: 5, dailyReserveLimitMicros: 10, lifetimeReserveLimitMicros: 15 };
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'panelreply-usage-'));
  let now = Date.UTC(2026, 10, 19, 12), store = openStore({ dataDir: dir, now: () => now });
  const a = store.createBusinessOwner({ businessName: 'Usage A Synthetic', username: 'usage-a', passwordHash: HASH });
  const b = store.createBusinessOwner({ businessName: 'Usage B Synthetic', username: 'usage-b', passwordHash: HASH });
  t.after(() => { store.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  return { dir, a, b, get store() { return store; }, get now() { return now; }, setNow(value) { now = value; }, advance(ms) { now += ms; }, reopen() { store.close(); store = openStore({ dataDir: dir, now: () => now }); }, reserve(actor = a, policy = SYNTHETIC_POLICY, hash = key()) { return store.reserveAssistantUsage(actor, hash, input, policy); } };
}

test('usage policy rejects absent, unknown, fractional, negative and inconsistent bounds', () => {
  for (const value of [null, {}, { ...SYNTHETIC_POLICY, extra: 1 }, { ...SYNTHETIC_POLICY, perMinute: 0 }, { ...SYNTHETIC_POLICY, perMinute: 1.5 }, { ...SYNTHETIC_POLICY, globalConcurrent: 1 }, { ...SYNTHETIC_POLICY, perDay: 1 }, { ...monetary, perAttemptReserveMicros: 11 }]) assert.throws(() => validateUsagePolicy(value));
  assert.deepEqual(validateUsagePolicy(SYNTHETIC_POLICY), SYNTHETIC_POLICY);
  assert.throws(() => validateUsagePolicy(SYNTHETIC_POLICY, { external: true }));
  assert.deepEqual(validateUsagePolicy(monetary, { external: true }), monetary);
});

test('approved external configuration requires separate execution and data-transfer approval without making a call', () => {
  let calls = 0;
  const options = { authorizationConfirmed: true, dataTransferApproved: true, apiKey: 'synthetic-key-not-a-real-credential', model: 'synthetic-model', fetchImpl: () => { calls++; throw new Error('Must not call during configuration'); }, usagePolicy: monetary };
  assert.throws(() => prepareExternalAssistant({ ...options, authorizationConfirmed: false }));
  assert.throws(() => prepareExternalAssistant({ ...options, dataTransferApproved: false }));
  assert.throws(() => prepareExternalAssistant({ ...options, usagePolicy: SYNTHETIC_POLICY }));
  assert.throws(() => prepareExternalAssistant({ ...options, fetchImpl: undefined }));
  assert.throws(() => resolveAssistantConfiguration({ ...options }));
  const config = prepareExternalAssistant(options);
  assert.equal(resolveAssistantConfiguration(config), config);
  assert.equal(config.conversationProvider.kind, 'external');
  assert.equal(config.assistantUsagePolicy.perAttemptReserveMicros, 5);
  assert.equal(calls, 0);
  assert.doesNotMatch(JSON.stringify(config), /synthetic-key|apiKey|Bearer/);
  assert.deepEqual(resolveAssistantConfiguration(null), {});
});

test('request digest binds the session and context without retaining either', () => {
  assert.equal(usageRequestHash('session-a', key('turn')), usageRequestHash('session-a', key('turn')));
  assert.notEqual(usageRequestHash('session-a', key('turn')), usageRequestHash('session-b', key('turn')));
  assert.notEqual(usageRequestHash('session-a', key('turn')), usageRequestHash('session-a', key('next-turn')));
  assert.throws(() => usageRequestHash('', key('turn')));
  assert.throws(() => usageRequestHash('scope', 'raw customer text'));
});

test('attempt ledger persists counts, bounded input metadata and finish state across restart', t => {
  const f = fixture(t), hash = key('recorded attempt'), reservation = f.reserve(f.a, monetary, hash);
  f.store.finishAssistantUsage(f.a, reservation.id, 'succeeded'); f.reopen();
  const summary = f.store.getAssistantUsage(f.a);
  assert.equal(summary.lifetimeAttempts, 1); assert.equal(summary.dailyReservedMicros, 5);
  assert.deepEqual(summary.statuses, { succeeded: 1 });
  assert.equal(f.store.getAssistantUsage(f.b).lifetimeAttempts, 0);
  const db = new DatabaseSync(f.store.filename, { readOnly: true });
  try { const row = db.prepare('SELECT * FROM assistant_usage').get(); assert.equal(row.request_hash, hash); assert.equal(row.input_bytes, 1024); assert.equal(row.output_token_limit, 2048); assert.equal(row.reserved_micros, 5); assert.equal(row.finished_at, f.now); assert.doesNotMatch(JSON.stringify(row), /raw customer|session-a|synthetic-key/); } finally { db.close(); }
});

test('failed and timed-out attempts retain monetary reservations after restart', t => {
  const f = fixture(t);
  const first = f.reserve(f.a, monetary); f.store.finishAssistantUsage(f.a, first.id, 'failed');
  const second = f.reserve(f.a, monetary); f.store.finishAssistantUsage(f.a, second.id, 'timeout'); f.reopen();
  assert.throws(() => f.reserve(f.a, monetary), { code: 'assistant_usage_limit' });
  assert.equal(f.store.getAssistantUsage(f.a).dailyReservedMicros, 10);
  assert.equal(f.store.getAssistantUsage(f.a).lifetimeAttempts, 2);
});

test('UTC day rollover renews daily quota while preserving the lifetime ceiling', t => {
  const f = fixture(t);
  for (let n = 0; n < 2; n++) { const r = f.reserve(f.a, monetary); f.store.finishAssistantUsage(f.a, r.id, 'cancelled'); }
  f.advance(86400000); f.reopen();
  const next = f.reserve(f.a, monetary); f.store.finishAssistantUsage(f.a, next.id, 'succeeded');
  assert.equal(f.store.getAssistantUsage(f.a).dailyAttempts, 1);
  assert.equal(f.store.getAssistantUsage(f.a).lifetimeReservedMicros, 15);
  assert.throws(() => f.reserve(f.a, monetary), { code: 'assistant_usage_limit' });
});

test('minute attempts survive process restart and do not count rejected attempts', t => {
  const f = fixture(t), policy = { ...SYNTHETIC_POLICY, perMinute: 1 };
  const r = f.reserve(f.a, policy); f.store.finishAssistantUsage(f.a, r.id, 'failed'); f.reopen();
  assert.throws(() => f.reserve(f.a, policy), { code: 'assistant_usage_limit' });
  assert.equal(f.store.getAssistantUsage(f.a).lifetimeAttempts, 1);
  f.advance(60000); assert.ok(f.reserve(f.a, policy).id);
});

test('duplicate request after restart cannot start or charge a second provider attempt', t => {
  const f = fixture(t), hash = key('same request');
  const r = f.reserve(f.a, monetary, hash); f.store.finishAssistantUsage(f.a, r.id, 'succeeded'); f.reopen();
  assert.throws(() => f.reserve(f.a, monetary, hash), { code: 'assistant_attempt_recorded' });
  assert.equal(f.store.getAssistantUsage(f.a).lifetimeAttempts, 1);
  assert.ok(f.reserve(f.b, monetary, hash).id);
});

test('global active ceiling spans businesses and completion releases only the active slot', t => {
  const f = fixture(t);
  const a = f.reserve(f.a), b = f.reserve(f.b);
  assert.throws(() => f.reserve(f.a), { code: 'assistant_usage_limit' });
  f.store.finishAssistantUsage(f.b, b.id, 'cancelled');
  const next = f.reserve(f.a); assert.ok(next.id);
  f.store.finishAssistantUsage(f.a, a.id, 'succeeded');
  assert.equal(f.store.getAssistantUsage(f.a).lifetimeAttempts, 2);
});

test('business active ceiling prevents one business filling otherwise available global slots', t => {
  const f = fixture(t), policy = { ...SYNTHETIC_POLICY, businessConcurrent: 1 };
  f.reserve(f.a, policy);
  assert.throws(() => f.reserve(f.a, policy), { code: 'assistant_usage_limit' });
  assert.ok(f.reserve(f.b, policy).id);
});

test('orphaned reservations expire their concurrency lease but retain attempt and cost records', t => {
  const f = fixture(t), policy = { ...monetary, globalConcurrent: 1, businessConcurrent: 1 };
  const r = f.reserve(f.a, policy); f.reopen();
  assert.throws(() => f.reserve(f.b, policy), { code: 'assistant_usage_limit' });
  f.advance(LEASE_MS); f.reserve(f.b, policy);
  assert.deepEqual(f.store.getAssistantUsage(f.a).statuses, { abandoned: 1 });
  assert.equal(f.store.getAssistantUsage(f.a).lifetimeReservedMicros, 5);
  f.store.finishAssistantUsage(f.a, r.id, 'succeeded');
  assert.deepEqual(f.store.getAssistantUsage(f.a).statuses, { abandoned: 1 });
});

test('ledger rejects a backwards or nonrepresentable clock without resetting budgets', t => {
  const f = fixture(t); f.reserve(); const original = f.now;
  f.setNow(original - 1); assert.throws(() => f.reserve(), { code: 'assistant_clock_changed' });
  f.setNow(Number.MAX_SAFE_INTEGER); assert.throws(() => f.reserve(), { code: 'assistant_clock_unavailable' });
  f.setNow(original); assert.equal(f.store.getAssistantUsage(f.a).lifetimeAttempts, 1);
});

test('cross-business actors cannot finish or inspect another business reservation', t => {
  const f = fixture(t), r = f.reserve();
  assert.throws(() => f.store.finishAssistantUsage(f.b, r.id, 'succeeded'), { code: 'assistant_usage_not_found' });
  assert.throws(() => f.store.getAssistantUsage({ ...f.a, businessId: f.b.businessId }), { code: 'unauthorized' });
  assert.deepEqual(f.store.getAssistantUsage(f.b).statuses, {});
  assert.deepEqual(f.store.getAssistantUsage(f.a).statuses, { pending: 1 });
});

test('invalid reservation metadata or finish state leaves existing counts unchanged', t => {
  const f = fixture(t);
  for (const invalid of [{ ...input, inputBytes: INPUT_BYTES + 1 }, { ...input, inputBytes: -1 }, { ...input, inputBytes: 0 }, { ...input, outputTokenLimit: 999999 }, { ...input, customerText: 'never stored' }]) assert.throws(() => f.store.reserveAssistantUsage(f.a, key(), invalid, SYNTHETIC_POLICY), { code: 'invalid_assistant_usage' });
  assert.equal(f.store.getAssistantUsage(f.a).lifetimeAttempts, 0);
  const r = f.reserve(); assert.throws(() => f.store.finishAssistantUsage(f.a, r.id, 'refunded'), { code: 'invalid_assistant_usage' });
  assert.deepEqual(f.store.getAssistantUsage(f.a).statuses, { pending: 1 });
});

test('repeated completion is idempotent and cannot refund or rewrite a recorded outcome', t => {
  const f = fixture(t), r = f.reserve(f.a, monetary);
  f.store.finishAssistantUsage(f.a, r.id, 'failed');
  assert.deepEqual(f.store.finishAssistantUsage(f.a, r.id, 'succeeded'), { recorded: true });
  assert.deepEqual(f.store.getAssistantUsage(f.a).statuses, { failed: 1 });
  assert.equal(f.store.getAssistantUsage(f.a).dailyReservedMicros, 5);
});

async function race(f, requests) {
  const shared = new SharedArrayBuffer(4), state = new Int32Array(shared), workers = [];
  const ready = [], outcomes = [];
  for (const request of requests) {
    const worker = new Worker(path.join(__dirname, 'helpers/usage-worker.cjs'), { workerData: { dir: f.dir, actor: f.a, now: f.now, input, shared, ...request } }); workers.push(worker);
    ready.push(new Promise((resolve, reject) => { worker.once('error', reject); worker.on('message', message => { if (message.ready) resolve(); }); }));
    outcomes.push(new Promise((resolve, reject) => { worker.once('error', reject); worker.on('message', message => { if (message.result) resolve(message.result); }); worker.once('exit', code => { if (code) reject(new Error('Usage worker exited ' + code)); }); }));
  }
  try { await Promise.all(ready); Atomics.store(state, 0, 1); Atomics.notify(state, 0); return await Promise.all(outcomes); }
  finally { await Promise.all(workers.map(worker => worker.terminate())); }
}

test('four simultaneous SQLite connections cannot overspend a one-attempt allowance', async t => {
  const f = fixture(t), policy = { ...SYNTHETIC_POLICY, perMinute: 1, perDay: 1, lifetimeAttempts: 1 };
  const results = await race(f, Array.from({ length: 4 }, () => ({ policy, hash: key() })));
  assert.equal(results.filter(r => r.ok).length, 1);
  assert.deepEqual(results.filter(r => !r.ok).map(r => r.code), ['assistant_usage_limit', 'assistant_usage_limit', 'assistant_usage_limit']);
  assert.equal(f.store.getAssistantUsage(f.a).lifetimeAttempts, 1);
});

test('simultaneous identical requests reserve exactly one ledger row across connections', async t => {
  const f = fixture(t), hash = key('shared retry');
  const results = await race(f, Array.from({ length: 3 }, () => ({ policy: SYNTHETIC_POLICY, hash })));
  assert.equal(results.filter(r => r.ok).length, 1);
  assert.ok(results.filter(r => !r.ok).every(r => r.code === 'assistant_attempt_recorded'));
  assert.equal(f.store.getAssistantUsage(f.a).lifetimeAttempts, 1);
});
