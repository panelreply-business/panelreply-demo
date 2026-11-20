'use strict';

// Fresh adversarial fixtures from a reviewer who did not author the assistant
// implementation or its 334-case corpus. The provider deliberately mislabels
// customer text. These tests use no provider transport or network.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createConversationOrchestrator } = require('../workspace/assistant.cjs');
const { blankState } = require('../workspace/conversation.cjs');
const fields = ['customerName', 'phone', 'job', 'zip', 'callbackWindow', 'requestedWorkDate'];
const seed = () => ({ ...blankState(), customerName: 'Synthetic Review Customer', phone: '+15865550101', job: 'Install an EV charger', zip: '48315', callbackWindow: 'Monday', requestedWorkDate: 'Saturday' });
const fixtures = [
  { name: 'adding outlet replacement does not replace the EV charger request', message: 'I also need to change the kitchen outlet', field: 'job', value: 'change the kitchen outlet' },
  { name: 'lighting update is work, not an instruction to discard existing scope', message: 'I need to update the kitchen lighting', field: 'job', value: 'update the kitchen lighting' },
  { name: 'a work change does not authorize a callback correction', message: 'Call me Friday to discuss a lighting change', field: 'callbackWindow', value: 'Friday' },
  { name: 'an outlet change does not authorize a work-date correction', message: 'I need an outlet change on Friday', field: 'requestedWorkDate', value: 'on Friday' },
  { name: 'instead selecting a component is not instead selecting a work date', message: 'I need a replacement outlet instead of a switch on Friday', field: 'requestedWorkDate', value: 'on Friday' },
  { name: 'a correction of the job is not a correction of the callback', message: 'Actually job: update the lighting, call me Friday', field: 'callbackWindow', value: 'Friday' }
];
for (const fixture of fixtures) test('independent correction binding: ' + fixture.name, async t => {
  const state = seed(), before = JSON.stringify(state);
  const assistant = createConversationOrchestrator({ provider: { kind: 'fake', generate: async () => ({ changes: [{ field: fixture.field, value: fixture.value, evidence: fixture.message, operation: 'correct' }], clarify: [], answerTopics: [], intent: 'continue' }) } });
  t.after(() => assistant.close());
  const result = await assistant.previewMessage(fixture.message, state, {}, { scope: 'independent-correction-review' });
  assert.equal(result.state[fixture.field], state[fixture.field], 'new work or a different field correction must not silently replace the prior value');
  assert.equal(result.assistance.mode, 'unavailable');
  assert.equal(result.assistance.code, 'invalid_assistant_output');
  assert.equal(JSON.stringify(state), before, 'the input draft remains unchanged');
});

const valid = [
  ['customerName', 'Actually I am Taylor Reed', 'Taylor Reed'],
  ['phone', 'Update my mobile to 248-555-0105', '248-555-0105'],
  ['zip', 'Change my job ZIP to 48084', '48084'],
  ['job', 'Correction: job: Replace the electrical panel', 'Replace the electrical panel'],
  ['callbackWindow', 'Update my callback to Friday after 4 pm', 'Friday after 4 pm'],
  ['requestedWorkDate', 'Correction: work date: Tuesday', 'Tuesday']
];
for (const [field, message, value] of valid) test('independent correction binding preserves explicit ' + field + ' correction', async t => {
  const state = seed();
  const assistant = createConversationOrchestrator({ provider: { kind: 'fake', generate: async () => ({ changes: [{ field, value, evidence: message, operation: 'correct' }], clarify: [], answerTopics: [], intent: 'continue' }) } });
  t.after(() => assistant.close());
  const result = await assistant.previewMessage(message, state, {}, { scope: 'independent-valid-correction' });
  assert.equal(result.assistance.mode, 'fake-provider');
  assert.equal(result.state[field], field === 'phone' ? '+12485550105' : value);
  for (const other of fields.filter(name => name !== field)) assert.equal(result.state[other], state[other]);
  assert.deepEqual(result.state.issues, []);
});
