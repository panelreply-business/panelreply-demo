'use strict';

// Synthetic contract tests. Generated combinations are counted as cases, never
// as human-authored conversations or calls to a real language model.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { inspect } = require('node:util');
const { parseOutput, providerInput, createConversationOrchestrator } = require('../workspace/assistant.cjs');
const { blankState, validateState } = require('../workspace/conversation.cjs');
const { createResponsesProvider, ENDPOINT, MAX_RESPONSE_BYTES } = require('../workspace/assistant-provider.cjs');

const FIELDS = ['customerName', 'phone', 'job', 'zip', 'callbackWindow', 'requestedWorkDate'];
const LABELS = ['customer name', 'callback number', 'electrical work', 'job ZIP', 'callback window', 'requested work date'];
const TOPICS = ['services', 'pricing', 'estimates', 'hours', 'serviceArea', 'contact', 'qualifications', 'emergencyAvailability', 'permits', 'warranty', 'financing'];
const SYNTHETIC_KEY = 'synthetic-contract-tests-not-a-credential';
const FIXTURES = [
  ['name-ascii', 'customerName', 'My name is Jamie Stone', 'Jamie Stone'],
  ['name-accent', 'customerName', 'My name is René Moreau', 'René Moreau'],
  ['name-hyphen', 'customerName', 'Name: Ana-Maria Costa', 'Ana-Maria Costa'],
  ['name-apostrophe', 'customerName', 'My name is O’Neil', 'O’Neil'],
  ['phone-national', 'phone', 'My phone is 5865550101', '5865550101'],
  ['phone-country', 'phone', 'My phone is +15865550101', '+15865550101'],
  ['phone-grouped', 'phone', 'My phone is (586) 555-0101', '(586) 555-0101'],
  ['phone-dotted', 'phone', 'My phone is 586.555.0101', '586.555.0101'],
  ['job-rating', 'job', 'I need a 200 amp panel upgrade', '200 amp panel upgrade'],
  ['job-ev', 'job', 'I need to install an EV charger', 'install an EV charger'],
  ['job-location', 'job', 'I need to replace the kitchen outlets', 'replace the kitchen outlets'],
  ['job-multiple', 'job', 'I need garage lighting and a basement circuit', 'garage lighting and a basement circuit'],
  ['zip-standard', 'zip', 'Job ZIP: 48315', '48315'],
  ['zip-leading-zero', 'zip', 'Job ZIP: 02108', '02108'],
  ['zip-west', 'zip', 'Job ZIP: 90210', '90210'],
  ['zip-postal-label', 'zip', 'Postal code: 10001', '10001'],
  ['callback-day', 'callbackWindow', 'Callback: Monday', 'Monday'],
  ['callback-qualified', 'callbackWindow', 'Callback: Monday after 4 pm', 'Monday after 4 pm'],
  ['callback-range', 'callbackWindow', 'Callback: Tuesday morning', 'Tuesday morning'],
  ['callback-clock', 'callbackWindow', 'Callback: around 10 am', 'around 10 am'],
  ['work-day', 'requestedWorkDate', 'Work date: Friday', 'Friday'],
  ['work-relative', 'requestedWorkDate', 'Work date: next week', 'next week'],
  ['work-date', 'requestedWorkDate', 'Work date: 12/15', '12/15'],
  ['work-qualified', 'requestedWorkDate', 'Work date: Saturday afternoon', 'Saturday afternoon']
].map(([id, field, message, value]) => ({ id, field, message, value }));

function previousState() {
  return { ...blankState(), customerName: 'Prior Owner', phone: '+15865550123',
    job: 'Replace a garage outlet', zip: '48080', callbackWindow: 'Tuesday morning', requestedWorkDate: 'Monday' };
}
function stateFor(kind, field) {
  if (kind === 'blank') return blankState();
  const state = previousState();
  if (kind === 'clarifying') {
    state.issues = [field];
    state.conversation = [{ role: 'customer', text: 'Please review my existing request.' },
      { role: 'assistant', text: 'What is the ' + LABELS[FIELDS.indexOf(field)] + '?' }];
  }
  return state;
}
function proposal(fixture) {
  return { changes: [{ field: fixture.field, value: fixture.value, evidence: fixture.value, operation: 'set' }],
    clarify: [], answerTopics: [], intent: 'continue' };
}
const canonical = value => inspect(value, { sorted: true, depth: null, compact: true, breakLength: Infinity });
const seenIds = new Set();
function scenario(id, requirement, input, fn) {
  assert(!seenIds.has(id), 'Duplicate assistant matrix ID: ' + id);
  seenIds.add(id);
  const signature = createHash('sha256').update(canonical(input)).digest('hex');
  test('RAM.' + id + ' [' + signature.slice(0, 16) + '] ' + requirement, fn);
}
const invalidOutput = error => error.code === 'invalid_assistant_output';

for (const [id, value] of [['ascii', "O'Neil"], ['right-curly', 'O’Neil'],
  ['left-curly', 'O‘Neil'], ['mixed', "D’Angelo O'Neil"]]) {
  scenario('apostrophe.' + id, 'preserve the source spelling while comparing the independent name parser', { value }, async () => {
    const fixture = { field: 'customerName', value, message: 'My name is ' + value };
    const raw = proposal(fixture);
    assert.deepEqual(parseOutput(raw, fixture.message, blankState()), raw);
    const assistant = createConversationOrchestrator({ provider: { kind: 'fake', generate: async () => raw } });
    try {
      const result = await assistant.previewMessage(fixture.message, blankState(), {}, { scope: 'synthetic-name/' + id });
      assert.equal(result.assistance.mode, 'fake-provider');
      assert.equal(result.state.customerName, value);
    } finally { assistant.close(); }
    const invented = proposal({ ...fixture, value: value.replace(/[‘’]/g, "'") + ' Added' });
    assert.throws(() => parseOutput(invented, fixture.message, blankState()), invalidOutput);
    assert.throws(() => parseOutput(raw, 'My name is not ' + value, blankState()), invalidOutput);
    assert.throws(() => parseOutput(raw, 'The part label says ' + value, blankState()), invalidOutput);
  });
}

// Positive controls exercise actual blank/conflicting/clarifying state
// transitions, not repeated shape validation under unrelated prior states.
for (const fixture of FIXTURES) {
  for (const kind of ['blank', 'populated', 'clarifying']) {
    const state = stateFor(kind, fixture.field);
    const raw = proposal(fixture);
    scenario('valid.' + fixture.id + '.' + kind, 'grounded extraction preserves existing values on conflict', { raw, message: fixture.message, state }, async () => {
      const before = structuredClone(state);
      assert.deepEqual(parseOutput(raw, fixture.message, state), raw);
      assert.deepEqual(state, before);
      assert.deepEqual(parseOutput(JSON.stringify(raw), fixture.message, state), raw);
      const normalized = fixture.field === 'phone' ? '+15865550101' : fixture.value;
      const conflict = !!state[fixture.field] && state[fixture.field] !== normalized;
      const assistant = createConversationOrchestrator({ provider: { kind: 'fake', generate: async () => raw } });
      try {
        const result = await assistant.previewMessage(fixture.message, state, {}, { scope: 'synthetic-state/' + fixture.id + '/' + kind });
        assert.equal(result.assistance.mode, 'fake-provider');
        assert.equal(result.state[fixture.field], conflict ? state[fixture.field] : normalized);
        assert.equal(result.state.issues.includes(fixture.field), conflict);
        for (const field of FIELDS.filter(value => value !== fixture.field)) assert.equal(result.state[field], state[field]);
        assert.deepEqual(state, before);
      } finally { assistant.close(); }
    });
  }
}

const CHANGE_MUTATIONS = [
  ['missing-field', raw => { delete raw.changes[0].field; }],
  ['missing-value', raw => { delete raw.changes[0].value; }],
  ['missing-evidence', raw => { delete raw.changes[0].evidence; }],
  ['missing-operation', raw => { delete raw.changes[0].operation; }],
  ['extra-authority', raw => { raw.changes[0].consent = true; }],
  ['extra-tenant', raw => { raw.changes[0].businessId = 'other-business'; }],
  ['field-null', raw => { raw.changes[0].field = null; }],
  ['field-object', raw => { raw.changes[0].field = {}; }],
  ['field-unknown', raw => { raw.changes[0].field = 'appointmentStatus'; }],
  ['field-prototype', raw => { raw.changes[0].field = '__proto__'; }],
  ['operation-null', raw => { raw.changes[0].operation = null; }],
  ['operation-unknown', raw => { raw.changes[0].operation = 'overwrite'; }],
  ['operation-case', raw => { raw.changes[0].operation = 'SET'; }],
  ['unapproved-correction', raw => { raw.changes[0].operation = 'correct'; }],
  ['value-null', raw => { raw.changes[0].value = null; }],
  ['value-number', raw => { raw.changes[0].value = 48315; }],
  ['value-array', raw => { raw.changes[0].value = [raw.changes[0].value]; }],
  ['value-object', raw => { raw.changes[0].value = { value: raw.changes[0].value }; }],
  ['value-empty', raw => { raw.changes[0].value = ''; }],
  ['value-space-prefix', raw => { raw.changes[0].value = ' ' + raw.changes[0].value; }],
  ['value-space-suffix', raw => { raw.changes[0].value += ' '; }],
  ['value-invented', raw => { raw.changes[0].value = 'Not supplied by this customer'; }],
  ['evidence-null', raw => { raw.changes[0].evidence = null; }],
  ['evidence-object', raw => { raw.changes[0].evidence = {}; }],
  ['evidence-array', raw => { raw.changes[0].evidence = [raw.changes[0].evidence]; }],
  ['evidence-empty', raw => { raw.changes[0].evidence = ''; }],
  ['evidence-invented', raw => { raw.changes[0].evidence = 'not-present: ' + raw.changes[0].evidence; }],
  ['evidence-too-long', raw => { raw.changes[0].evidence = 'x'.repeat(501); }],
  ['duplicate-change', raw => { raw.changes.push({ ...raw.changes[0] }); }],
  ['change-and-clarify', raw => { raw.clarify = [raw.changes[0].field]; }]
];
// One semantic control per actual field branch. Generic shape rejections are
// not multiplied by equivalent strings or unrelated draft states.
for (const field of FIELDS) {
  const fixture = FIXTURES.find(item => item.field === field);
  for (const [mutation, apply] of CHANGE_MUTATIONS) {
    const raw = proposal(fixture); apply(raw);
    const state = previousState();
    scenario('change.' + fixture.field + '.' + mutation, 'reject malformed extraction without changing the draft', { raw, state, message: fixture.message }, () => {
      const before = structuredClone(state);
      assert.throws(() => parseOutput(raw, fixture.message, state), invalidOutput);
      assert.deepEqual(state, before);
    });
  }
}

// Root/schema corruption is tested once per distinct corruption. It is not
// multiplied across unrelated message wording to inflate the total.
const rootFixture = FIXTURES[0];
const ROOT_MUTATIONS = [
  ['null', () => null], ['array', () => []], ['number', () => 1], ['boolean', () => true],
  ['missing-changes', raw => { delete raw.changes; return raw; }],
  ['missing-clarify', raw => { delete raw.clarify; return raw; }],
  ['missing-topics', raw => { delete raw.answerTopics; return raw; }],
  ['missing-intent', raw => { delete raw.intent; return raw; }],
  ['changes-object', raw => ({ ...raw, changes: {} })],
  ['changes-null', raw => ({ ...raw, changes: null })],
  ['change-null', raw => ({ ...raw, changes: [null] })],
  ['change-array', raw => ({ ...raw, changes: [[]] })],
  ['changes-over-bound', raw => ({ ...raw, changes: Array.from({ length: 7 }, () => raw.changes[0]) })],
  ['clarify-string', raw => ({ ...raw, clarify: 'zip' })],
  ['clarify-null', raw => ({ ...raw, clarify: null })],
  ['clarify-unknown', raw => ({ ...raw, clarify: ['appointment'] })],
  ['clarify-duplicate', raw => ({ ...raw, clarify: ['zip', 'zip'] })],
  ['topics-string', raw => ({ ...raw, answerTopics: 'pricing' })],
  ['topics-null', raw => ({ ...raw, answerTopics: null })],
  ['topics-unknown', raw => ({ ...raw, answerTopics: ['secrets'] })],
  ['topics-duplicate', raw => ({ ...raw, answerTopics: ['pricing', 'pricing'] })],
  ['intent-null', raw => ({ ...raw, intent: null })],
  ['intent-tool', raw => ({ ...raw, intent: 'send_sms' })],
  ['intent-booking', raw => ({ ...raw, intent: 'booked' })],
  ['intent-summary-unasked', raw => ({ ...raw, intent: 'summary' })],
  ['intent-handoff-unasked', raw => ({ ...raw, intent: 'handoff' })]
];
for (const key of ['reply', 'tools', 'url', 'businessId', 'session', 'consent', 'stopped', 'hold', 'status', 'appointment', 'messageSent', 'apiKey']) {
  ROOT_MUTATIONS.push(['extra-' + key, raw => ({ ...raw, [key]: 'forbidden-authority' })]);
}
for (const [id, mutate] of ROOT_MUTATIONS) {
  const raw = mutate(proposal(rootFixture));
  scenario('root.' + id, 'provider schema cannot grant application authority', raw, () => {
    assert.throws(() => parseOutput(raw, rootFixture.message, blankState()), invalidOutput);
  });
}

// Control bytes below are tested in client fields and in the actual incoming
// message. A byte absent from the source would only test substring grounding.
const CONTROL_CODES = [...Array.from({ length: 9 }, (_, i) => i), 11, 12,
  ...Array.from({ length: 18 }, (_, i) => i + 14), 127];
for (const code of CONTROL_CODES) {
  const message = 'I need an outlet ' + String.fromCharCode(code) + ' replaced';
  scenario('message.control.' + code, 'reject prohibited message bytes before a provider can run', { message }, async () => {
    let calls = 0;
    const assistant = createConversationOrchestrator({ provider: { kind: 'fake', generate: async () => { calls++; return proposal(FIXTURES[0]); } } });
    try {
      await assert.rejects(assistant.previewMessage(message, blankState(), {}, { scope: 'synthetic-control/' + code }), error => error.code === 'invalid_input');
      assert.equal(calls, 0);
    } finally { assistant.close(); }
  });
}

// Correct evidence still cannot be extracted into an unrelated field role.
for (const fixture of FIXTURES) for (const target of FIELDS.filter(field => field !== fixture.field)) {
  const raw = proposal(fixture); raw.changes[0].field = target;
  scenario('role.' + fixture.id + '.as-' + target, 'reject text used under the wrong field role', { raw, message: fixture.message }, () => {
    assert.throws(() => parseOutput(raw, fixture.message, blankState()), invalidOutput);
  });
}

// Provider context contains only approved facts. Every topic is exercised at
// its own allowlist position, including type and approval boundary failures.
const BAD_FACTS = [
  ['unverified', { verified: false, answer: 'Unapproved answer' }],
  ['string-approval', { verified: 'true', answer: 'Unapproved answer' }],
  ['missing-approval', { answer: 'Unapproved answer' }],
  ['missing-answer', { verified: true }],
  ['empty-answer', { verified: true, answer: '' }],
  ['space-answer', { verified: true, answer: '   ' }],
  ['numeric-answer', { verified: true, answer: 100 }],
  ['array-answer', { verified: true, answer: ['Unapproved answer'] }],
  ['object-answer', { verified: true, answer: { text: 'Unapproved answer' } }],
  ['over-bound', { verified: true, answer: 'x'.repeat(1001) }],
  ['control-answer', { verified: true, answer: 'answer\u0000secret' }],
  ['null-fact', null], ['array-fact', []]
];
for (const topic of TOPICS) for (const [id, fact] of BAD_FACTS) {
  scenario('facts.' + topic + '.' + id, 'exclude unapproved or malformed business facts from provider context', { topic, fact }, () => {
    const context = providerInput('I need an outlet replaced', blankState(), { facts: { [topic]: structuredClone(fact) }, secret: 'synthetic-secret' });
    assert.deepEqual(context.data.approvedBusinessFacts, {});
    assert(!JSON.stringify(context).includes('synthetic-secret'));
    assert(Object.isFrozen(context.data));
  });
}
for (const topic of TOPICS) for (const length of [1, 1000]) {
  scenario('facts.valid.' + topic + '.' + length, 'include approved answer at documented length boundaries', { topic, length }, () => {
    const answer = 'x'.repeat(length);
    const context = providerInput('I need an outlet replaced', blankState(), { facts: { [topic]: { verified: true, answer } } });
    assert.deepEqual(context.data.approvedBusinessFacts, { [topic]: { verified: true, answer } });
    assert(Object.isFrozen(context.data.approvedBusinessFacts[topic]));
  });
}

// Stateful integration exercises the contract at the orchestrator boundary,
// preserving all six old fields when a provider returns invalid data.
for (const fixture of FIXTURES) for (const fault of ['wrong-role', 'invented-value', 'extra-authority', 'unauthorized-correction']) {
  scenario('recovery.' + fixture.id + '.' + fault, 'malformed proposal preserves prior fields and permits a valid retry', { fixture, fault }, async () => {
    const before = previousState();
    const raw = proposal(fixture);
    if (fault === 'wrong-role') raw.changes[0].field = FIELDS[(FIELDS.indexOf(fixture.field) + 1) % FIELDS.length];
    if (fault === 'invented-value') raw.changes[0].value = 'invented value';
    if (fault === 'extra-authority') raw.consent = true;
    if (fault === 'unauthorized-correction') raw.changes[0].operation = 'correct';
    let calls = 0;
    const assistant = createConversationOrchestrator({ provider: { kind: 'fake', generate: async () => (++calls === 1 ? raw : { changes: [], clarify: [], answerTopics: [], intent: 'continue' }) } });
    try {
      const result = await assistant.previewMessage(fixture.message, before, {}, { scope: 'synthetic-business/' + fixture.id });
      assert.equal(result.assistance.mode, 'unavailable');
      assert.equal(result.assistance.code, 'invalid_assistant_output');
      for (const field of FIELDS) assert.equal(result.state[field], before[field]);
      assert.deepEqual(before, previousState());
      const recovered = await assistant.previewMessage('Please review the existing draft', result.state, {}, { scope: 'synthetic-business/' + fixture.id });
      assert.equal(recovered.assistance.mode, 'fake-provider');
      for (const field of FIELDS) assert.equal(recovered.state[field], before[field]);
      assert.equal(calls, 2);
    } finally { assistant.close(); }
  });
}

const envelope = (text = JSON.stringify(proposal(FIXTURES[0]))) => ({ status: 'completed', error: null, incomplete_details: null,
  output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text }] }] });
const context = () => providerInput(FIXTURES[0].message, blankState(), {});
function fakeResponse(bytes, headers = {}, split = 'whole') {
  const body = typeof bytes === 'string' ? Buffer.from(bytes) : bytes;
  const chunks = split === 'bytes' ? Array.from(body, byte => new Uint8Array([byte]))
    : split === 'halves' ? [body.subarray(0, Math.floor(body.length / 2)), body.subarray(Math.floor(body.length / 2))] : [body];
  return new Response(new ReadableStream({ start(controller) { for (const chunk of chunks) controller.enqueue(chunk); controller.close(); } }),
    { headers: { 'content-type': 'application/json', ...headers } });
}
function fakeProvider(fetchImpl) {
  return createResponsesProvider({ authorizationConfirmed: true, apiKey: SYNTHETIC_KEY,
    model: 'synthetic-model-only', fetchImpl, timeoutMs: 6000 });
}
const ENVELOPE_MUTATIONS = [
  ['null', () => null], ['empty-object', () => ({})], ['array', () => []],
  ['incomplete', body => ({ ...body, status: 'incomplete' })],
  ['failed', body => ({ ...body, status: 'failed' })],
  ['error', body => ({ ...body, error: { message: SYNTHETIC_KEY } })],
  ['incomplete-details', body => ({ ...body, incomplete_details: { reason: 'max_output_tokens' } })],
  ['output-empty', body => ({ ...body, output: [] })],
  ['output-object', body => ({ ...body, output: {} })],
  ['output-null', body => ({ ...body, output: null })],
  ['output-too-many', body => ({ ...body, output: Array.from({ length: 17 }, () => body.output[0]) })],
  ['reasoning-only', body => ({ ...body, output: [{ type: 'reasoning' }] })],
  ['tool-call', body => ({ ...body, output: [{ type: 'function_call', name: 'send_sms', arguments: '{}' }] })],
  ['message-system', body => { body.output[0].role = 'system'; return body; }],
  ['message-user', body => { body.output[0].role = 'user'; return body; }],
  ['message-incomplete', body => { body.output[0].status = 'incomplete'; return body; }],
  ['message-content-empty', body => { body.output[0].content = []; return body; }],
  ['message-content-null', body => { body.output[0].content = null; return body; }],
  ['message-content-too-many', body => { body.output[0].content = Array.from({ length: 9 }, () => ({ type: 'output_text', text: ' ' })); return body; }],
  ['refusal', body => { body.output[0].content = [{ type: 'refusal', refusal: SYNTHETIC_KEY }]; return body; }],
  ['text-number', body => { body.output[0].content[0].text = 42; return body; }],
  ['text-empty', body => { body.output[0].content[0].text = ''; return body; }],
  ['text-over-bound', body => { body.output[0].content[0].text = ' '.repeat(16385); return body; }],
  ['inner-invalid-json', () => envelope('{invalid')],
  ['inner-extra-key', () => envelope(JSON.stringify({ ...proposal(FIXTURES[0]), consent: true }))]
];
for (const [id, mutate] of ENVELOPE_MUTATIONS) {
  const split = 'whole';
  const body = JSON.stringify(mutate(envelope()));
  scenario('transport.envelope.' + id + '.' + split, 'malformed streamed response fails closed without retry or diagnostics', { body, split }, async () => {
    let calls = 0;
    const p = fakeProvider(async (url, options) => {
      calls++;
      assert.equal(url, ENDPOINT);
      assert.equal(options.redirect, 'error');
      return fakeResponse(body, {}, split);
    });
    await assert.rejects(p.generate(context()), error => invalidOutput(error) && !error.message.includes(SYNTHETIC_KEY));
    assert.equal(calls, 1);
  });
}
for (const encoding of ['identity', 'gzip', 'br', 'deflate']) for (const split of ['whole', 'halves', 'bytes']) {
  const fixture = FIXTURES[1]; // UTF-8 accent deliberately crosses byte chunks.
  const body = JSON.stringify(envelope(JSON.stringify(proposal(fixture))));
  const headers = { 'content-encoding': encoding,
    'content-length': String(encoding === 'identity' ? Buffer.byteLength(body) : 17) };
  scenario('transport.valid.' + encoding + '.' + split, 'decoded UTF-8 response respects wire encoding and byte boundaries', { body, headers, split }, async () => {
    const p = fakeProvider(async () => fakeResponse(body, headers, split));
    const actual = await p.generate(providerInput(fixture.message, blankState(), {}));
    assert.deepEqual(actual, proposal(fixture));
  });
}
for (const status of [201, 202, 204, 206, 301, 302, 307, 308, 400, 401, 403, 404, 408, 409, 413, 415, 422, 429, 500, 502, 503, 504]) {
  scenario('transport.status.' + status, 'non-200 provider response is redacted and never retried', { status }, async () => {
    let calls = 0;
    const p = fakeProvider(async () => {
      calls++;
      return new Response(status === 204 ? null : SYNTHETIC_KEY, { status });
    });
    await assert.rejects(p.generate(context()), error => error.code === 'assistant_unavailable' && !error.message.includes(SYNTHETIC_KEY));
    assert.equal(calls, 1);
  });
}
for (const [id, headers] of [
  ['non-json', { 'content-type': 'text/plain' }], ['json-prefix', { 'content-type': 'application/jsonp' }],
  ['negative-length', { 'content-length': '-1' }], ['decimal-length', { 'content-length': '1.5' }],
  ['exponent-length', { 'content-length': '1e3' }], ['oversize-length', { 'content-length': String(MAX_RESPONSE_BYTES + 1) }],
  ['identity-mismatch', { 'content-length': '1' }], ['unknown-encoding', { 'content-encoding': 'custom' }],
  ['stacked-encoding', { 'content-encoding': 'gzip, br' }]
]) {
  scenario('transport.header.' + id, 'response metadata cannot bypass the body contract', headers, async () => {
    const p = fakeProvider(async () => fakeResponse(JSON.stringify(envelope()), headers));
    await assert.rejects(p.generate(context()), invalidOutput);
  });
}

// A context error must be caught before the injected transport is reached.
const BAD_CONTEXT_VALUES = [['null', null], ['number', 7], ['boolean', true], ['array', []], ['object', {}]];
for (const field of FIELDS) for (const [id, value] of BAD_CONTEXT_VALUES) {
  scenario('context.field.' + field + '.' + id, 'reject malformed field types before transport', { field, value }, async () => {
    const input = structuredClone(context()); input.data.fields[field] = value;
    let calls = 0;
    const p = fakeProvider(async () => { calls++; return fakeResponse(JSON.stringify(envelope())); });
    await assert.rejects(p.generate(input), error => error.code === 'invalid_assistant_context');
    assert.equal(calls, 0);
  });
}
for (const field of FIELDS) for (const code of CONTROL_CODES) {
  scenario('state.control.' + field + '.' + code, 'client draft cannot smuggle prohibited control bytes', { field, code }, () => {
    const state = previousState(); state[field] += String.fromCharCode(code);
    assert.throws(() => validateState(state), error => error.code === 'invalid_input');
  });
}
