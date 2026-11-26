'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { Readable } = require('node:stream');
const { EventEmitter } = require('node:events');
const { openStore, digest } = require('../workspace/store.cjs');
const { csrfFor } = require('../workspace/auth.cjs');
const { createWorkspaceApp } = require('../workspace/api.cjs');
const { PreviewError } = require('../workspace/conversation.cjs');
const { prepareExternalAssistant } = require('../workspace/assistant-config.cjs');
const { SYNTHETIC_POLICY } = require('../workspace/usage.cjs');
const { startWorkspace } = require('../workspace-server.cjs');

const ORIGIN = 'http://127.0.0.1:10001';
const HASH = 'scrypt$32768$8$3$' + Buffer.alloc(16).toString('base64url') + '$' + Buffer.alloc(64).toString('base64url');
const output = () => ({ changes: [], clarify: [], answerTopics: [], intent: 'continue' });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const fullTranscript = () => Array.from({ length: 60 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'customer', text: 'Synthetic bounded transcript entry ' + i + '.' }));
function fixture(t, generate = async () => output(), options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'panelreply-independent-'));
  const store = openStore({ dataDir: dir });
  const owner = store.createBusinessOwner({ businessName: 'Independent Synthetic Business', username: 'independent-owner', passwordHash: HASH });
  const other = store.createBusinessOwner({ businessName: 'Other Synthetic Business', username: 'independent-other', passwordHash: HASH });
  const app = createWorkspaceApp({ store, origin: ORIGIN, conversationProvider: { kind: 'fake', generate }, ...options });
  t.after(() => { app.close(); store.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const login = (actor = owner) => {
    const token = crypto.randomBytes(32).toString('base64url');
    store.createSession(actor.id, digest(token));
    return { cookie: app.auth.cookie(token).split(';')[0], 'x-csrf-token': csrfFor(token), 'x-workspace-session': csrfFor(token) };
  };
  return { store, owner, other, app, login };
}
async function request(f, { method = 'POST', url = '/api/preview', headers, input, stream, observe } = {}) {
  const req = stream || Readable.from(input === undefined ? [] : [JSON.stringify(input)]);
  Object.assign(req, { method, url, headers: { host: '127.0.0.1:10001', origin: ORIGIN, 'content-type': 'application/json', ...headers }, socket: { remoteAddress: '127.0.0.1' } });
  const res = new EventEmitter(); res.destroyed = false; res.writableEnded = false;
  res.writeHead = (status, values) => { res.status = status; res.headers = values; };
  res.end = value => { res.text = value ? String(value) : ''; res.writableEnded = true; };
  observe?.(req, res);
  await f.app.handler(req, res);
  return { status: res.status, body: res.text ? JSON.parse(res.text) : null };
}

test('provider-reported timeout is recorded as timeout without refunding its attempt', async t => {
  const f = fixture(t, async () => { throw new PreviewError(504, 'assistant_timeout', 'Synthetic provider timeout'); }, { assistantUsagePolicy: { ...SYNTHETIC_POLICY, perAttemptReserveMicros: 5, dailyReserveLimitMicros: 10, lifetimeReserveLimitMicros: 15 } });
  const result = await request(f, { headers: f.login(), input: { message: 'I need a panel upgrade', state: null } });
  assert.equal(result.status, 200); assert.equal(result.body.assistance.code, 'assistant_timeout');
  const usage = f.store.getAssistantUsage(f.owner);
  assert.equal(usage.lifetimeAttempts, 1);
  assert.equal(usage.lifetimeReservedMicros, 5);
  assert.deepEqual(usage.statuses, { timeout: 1 });
});

for (const kind of ['stop', 'safety']) test('a concurrent ' + kind + ' in another session controls the pending result and keeps accounting', async t => {
  const started = deferred(), release = deferred(); let calls = 0;
  const f = fixture(t, async () => { calls++; started.resolve(); await release.promise; return output(); });
  const state = { phone: '+15865550101' }, first = f.login(), second = f.login();
  const pending = request(f, { headers: first, input: { message: 'I need a panel upgrade', state } });
  await started.promise;
  try {
    const control = await request(f, { headers: second, input: { message: kind === 'stop' ? 'STOP' : 'The outlet is sparking.', state } });
    assert.equal(control.status, 200); assert.equal(control.body.state[kind === 'stop' ? 'stopped' : 'hold'], true);
  } finally { release.resolve(); }
  const result = await pending;
  assert.equal(result.status, 200); assert.equal(result.body.state[kind === 'stop' ? 'stopped' : 'hold'], true); assert.equal(result.body.assistance.mode, 'deterministic');
  assert.equal(calls, 1); assert.equal(f.store.getAssistantUsage(f.owner).lifetimeAttempts, 1); assert.equal(f.store.getAssistantUsage(f.other).lifetimeAttempts, 0);
  assert.equal(f.store[kind === 'stop' ? 'isSuppressed' : 'isSafetyHeld'](f.other, state.phone), false);
  assert.deepEqual(f.store.listLeads(f.owner), []);
});

for (const kind of ['stop', 'safety']) for (const phoneInMessage of [false, true]) test('a full valid transcript cannot discard a ' + kind + ' restriction with phone ' + (phoneInMessage ? 'in this message' : 'in the saved draft'), async t => {
  let calls = 0;
  const f = fixture(t, async () => { calls++; return output(); });
  const phone = '+15865550101';
  const conversation = fullTranscript();
  const control = kind === 'stop' ? 'STOP' : 'The outlet is sparking.';
  const result = await request(f, { headers: f.login(), input: { message: (phoneInMessage ? 'Phone: 5865550101\n' : '') + control, state: { phone: phoneInMessage ? '' : phone, conversation } } });
  assert.equal(result.status, 413); assert.equal(result.body.error.code, 'conversation_limit');
  assert.equal(calls, 0); assert.deepEqual(f.store.listLeads(f.owner), []);
  assert.equal(f.store[kind === 'stop' ? 'isSuppressed' : 'isSafetyHeld'](f.owner, phone), true);
});

const rejectedControls = [
  { name: 'unsupported state field', status: 400, state: state => ({ ...state, unexpected: true }) },
  { name: 'malformed transcript entry', status: 400, state: state => ({ ...state, conversation: [...state.conversation.slice(0, 59), { role: 'system', text: 'STOP' }] }) },
  { name: 'already oversized transcript', status: 400, state: state => ({ ...state, conversation: [...state.conversation, { role: 'customer', text: 'Earlier STOP' }] }) },
  { name: 'overlong new message', status: 413, message: 'STOP ' + 'x'.repeat(500) },
  { name: 'missing session', status: 401, headers: () => ({}) },
  { name: 'wrong CSRF token', status: 403, headers: headers => ({ ...headers, 'x-csrf-token': 'invalid' }) },
  { name: 'disconnected response', status: undefined, observe: (_req, res) => { res.destroyed = true; } },
  { name: 'aborted request', status: 413, observe: req => { req.aborted = true; } },
  { name: 'ordinary full transcript', status: 413, message: 'I need an EV charger installation.' }
];
for (const variant of rejectedControls) test('transcript-limit handling never writes a restriction for ' + variant.name, async t => {
  let calls = 0;
  const f = fixture(t, async () => { calls++; return output(); });
  const phone = '+15865550101', headers = f.login(), state = { phone, conversation: fullTranscript() };
  const result = await request(f, { headers: variant.headers ? variant.headers(headers) : headers, input: { message: variant.message || 'STOP. The outlet is sparking.', state: variant.state ? variant.state(state) : state }, observe: variant.observe });
  assert.equal(result.status, variant.status);
  assert.equal(f.store.isSuppressed(f.owner, phone), false); assert.equal(f.store.isSafetyHeld(f.owner, phone), false);
  assert.equal(f.store.isSuppressed(f.other, phone), false); assert.equal(f.store.isSafetyHeld(f.other, phone), false);
  assert.equal(calls, 0); assert.equal(f.store.getAssistantUsage(f.owner).lifetimeAttempts, 0); assert.deepEqual(f.store.listLeads(f.owner), []);
});

test('a full-transcript STOP cancels earlier same-session assistance before retaining the 413 result', async t => {
  const started = deferred(), release = deferred(); let aborted = false;
  const f = fixture(t, async (_context, { signal }) => { signal.addEventListener('abort', () => { aborted = true; }, { once: true }); started.resolve(); await release.promise; return output(); });
  const headers = f.login(), phone = '+15865550101';
  const pending = request(f, { headers, input: { message: 'I need a panel upgrade', state: { phone } } });
  await started.promise;
  try {
    const control = await request(f, { headers, input: { message: 'STOP', state: { phone, conversation: fullTranscript() } } });
    assert.equal(control.status, 413); assert.equal(control.body.error.code, 'conversation_limit');
    assert.equal(aborted, true); assert.equal(f.store.isSuppressed(f.owner, phone), true);
  } finally { release.resolve(); }
  assert.equal((await pending).status, 409);
  assert.equal(f.store.getAssistantUsage(f.owner).lifetimeAttempts, 1);
  assert.deepEqual(f.store.getAssistantUsage(f.owner).statuses, { cancelled: 1 });
});

test('usage completion failure hides the provider proposal and retains its pending reservation', async t => {
  let calls = 0;
  const f = fixture(t, async () => { calls++; return { ...output(), changes: [{ field: 'job', value: 'panel upgrade', evidence: 'I need a panel upgrade', operation: 'set' }] }; });
  const finish = f.store.finishAssistantUsage;
  f.store.finishAssistantUsage = () => { throw new Error('Synthetic ledger write failure with private details'); };
  try {
    const result = await request(f, { headers: f.login(), input: { message: 'I need a panel upgrade', state: null } });
    assert.equal(result.status, 200); assert.equal(result.body.assistance.code, 'assistant_usage_unavailable');
    assert.equal(result.body.state.job, ''); assert.doesNotMatch(JSON.stringify(result.body), /private details/);
    assert.equal(calls, 1); assert.equal(f.store.getAssistantUsage(f.owner).lifetimeAttempts, 1); assert.deepEqual(f.store.getAssistantUsage(f.owner).statuses, { pending: 1 });
    assert.deepEqual(f.store.listLeads(f.owner), []);
  } finally { f.store.finishAssistantUsage = finish; }
});

test('password reset during a deletion body prevents the deletion after the body completes', async t => {
  const f = fixture(t), headers = f.login();
  const saved = f.store.createLead(f.owner, { customerName: 'Synthetic Delete Customer', phone: '+15865550101', job: 'Install fixture lights', zip: '48315', callbackWindow: 'After four', requestedWorkDate: '', contactPermission: 'requested_callback', conversation: [{ role: 'customer', text: 'Please call about fixture lights' }] }, crypto.randomUUID()).lead;
  const entered = deferred(), release = deferred();
  const stream = Readable.from((async function* () { yield '{"version":'; entered.resolve(); await release.promise; yield '1,"confirmation":"DELETE"}'; })());
  const pending = request(f, { method: 'DELETE', url: '/api/leads/' + saved.id, headers: { ...headers, 'idempotency-key': crypto.randomUUID() }, stream });
  await entered.promise;
  f.store.resetOwnerPassword({ username: f.owner.username, passwordHash: HASH }); release.resolve();
  const result = await pending;
  assert.equal(result.status, 401); assert.deepEqual(f.store.getLead(f.owner, saved.id), saved);
});

test('copied or inherited external configuration cannot initialize a workspace or call a transport', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'panelreply-configuration-review-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let calls = 0;
  const approved = prepareExternalAssistant({ authorizationConfirmed: true, dataTransferApproved: true, apiKey: 'synthetic-key-never-a-real-credential', model: 'synthetic-review-model', fetchImpl: () => { calls++; throw new Error('Unexpected transport'); }, usagePolicy: { ...SYNTHETIC_POLICY, perAttemptReserveMicros: 1, dailyReserveLimitMicros: 10, lifetimeReserveLimitMicros: 20 } });
  for (const [index, configuration] of [{ ...approved }, Object.create(approved), { allowExternalProvider: true }].entries()) {
    const dir = path.join(root, 'rejected-' + index);
    assert.throws(() => startWorkspace({ PORT: '10001', WORKSPACE_DATA_DIR: dir }, { assistantConfiguration: configuration }), /approved/);
    assert.equal(fs.existsSync(dir), false);
  }
  assert.equal(calls, 0);
});

