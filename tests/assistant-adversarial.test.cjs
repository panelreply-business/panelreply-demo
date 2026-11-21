'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createConversationOrchestrator } = require('../workspace/assistant.cjs');
const { createResponsesProvider } = require('../workspace/assistant-provider.cjs');
const { providerInput } = require('../workspace/assistant.cjs');
const { blankState } = require('../workspace/conversation.cjs');
const { gzipSync } = require('node:zlib');

// An independent review of the trust boundary: a fake model intentionally
// assigns real text to the wrong field. Substring presence alone is not proof
// that the customer supplied that value for that field.
const wrongBindings = [
  { id: 'electrical work cannot become the customer name merely because the clause also contains my name', message: 'My name is Jamie Stone and I need a panel upgrade', field: 'customerName', wrong: 'panel upgrade' },
  { id: 'a part-number-shaped phone cannot replace the explicit callback number', message: 'My phone is 586-555-0101 and the part number is 248-555-0123', field: 'phone', wrong: '248-555-0123' },
  { id: 'a requested work date cannot become a callback window from another phrase', message: 'Call me after 4 pm and I need the work done Friday', field: 'callbackWindow', wrong: 'Friday' },
  { id: 'contracted negation cannot produce a positive electrical-work request', message: "I don't need a panel upgrade", field: 'job', wrong: 'panel upgrade' },
  { id: 'an explicitly unavailable day cannot become a requested work date', message: 'I need an EV charger, Saturday is unavailable', field: 'requestedWorkDate', wrong: 'Saturday' }
];

for (const fixture of wrongBindings) test('adversarial grounding: ' + fixture.id, async t => {
  const assistant = createConversationOrchestrator({ provider: { kind: 'fake', generate: async () => ({
    changes: [{ field: fixture.field, value: fixture.wrong, evidence: fixture.message, operation: 'set' }],
    clarify: [], answerTopics: [], intent: 'continue'
  }) } });
  t.after(() => assistant.close());
  const result = await assistant.previewMessage(fixture.message, undefined, {}, { scope: 'synthetic-grounding-scope' });
  assert.equal(result.state[fixture.field], '', 'a misbound or negated proposal must leave the previous field unchanged');
  assert.ok(result.assistance.mode === 'unavailable' || result.state.issues.includes(fixture.field), 'a rejected proposal must remain visible as failure or clarification');
});

for (const message of [
  'There is a fire in my electrical panel',
  "There's a fire inside the breaker box",
  'The outlet is too hot to touch',
  'The breaker box feels hot'
]) test('electrical hazard must block provider generation: ' + message, async t => {
  let calls = 0;
  const assistant = createConversationOrchestrator({ provider: { kind: 'fake', generate: async () => {
    calls += 1;
    return { changes: [], clarify: [], answerTopics: [], intent: 'continue' };
  } } });
  t.after(() => assistant.close());
  const result = await assistant.previewMessage(message, undefined, {}, { scope: 'synthetic-hazard-scope' });
  assert.equal(result.state.hold, true);
  assert.equal(calls, 0, 'hazard intake must stop before a provider is called');
  assert.match(result.replies.join(' '), /does not dispatch/);
});

test('provider accepts a bounded decoded JSON body when Content-Length describes compressed wire bytes', async () => {
  const proposal = {
    changes: [{ field: 'job', value: 'panel upgrade', evidence: 'I need a panel upgrade', operation: 'set' }],
    clarify: [], answerTopics: [], intent: 'continue'
  };
  const body = JSON.stringify({
    status: 'completed', error: null, incomplete_details: null,
    output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify(proposal) }] }]
  });
  const encodedLength = gzipSync(body).length;
  assert.notEqual(encodedLength, Buffer.byteLength(body));
  // Fetch exposes decompressed bytes while response headers can still describe
  // the encoded HTTP body. This fake transport makes no provider/network call.
  const provider = createResponsesProvider({
    authorizationConfirmed: true, apiKey: 'synthetic-not-a-real-provider-key', model: 'explicit-test-model',
    fetchImpl: async () => new Response(body, { headers: {
      'content-type': 'application/json', 'content-encoding': 'gzip', 'content-length': String(encodedLength)
    } })
  });
  assert.deepEqual(await provider.generate(providerInput('I need a panel upgrade', blankState(), {})), proposal);
});

test('provider cancels a response body that arrives after an uncooperative transport times out', async () => {
  let resolveFetch, cancelled = false;
  const provider = createResponsesProvider({
    authorizationConfirmed: true, apiKey: 'synthetic-not-a-real-provider-key', model: 'explicit-test-model', timeoutMs: 8,
    fetchImpl: () => new Promise(resolve => { resolveFetch = resolve; })
  });
  await assert.rejects(provider.generate(providerInput('I need a panel upgrade', blankState(), {})), error => error.code === 'assistant_timeout');
  const stream = new ReadableStream({ cancel() { cancelled = true; } });
  resolveFetch(new Response(stream, { headers: { 'content-type': 'application/json' } }));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(cancelled, true, 'late response bodies must be closed even after the caller has received timeout');
});
