'use strict';

// Independent regression review of apostrophe comparison and name authority.
// These complement, rather than repeat, the four punctuation acceptance
// controls in release-assistant-matrix.test.cjs. No real provider is used.
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseOutput, createConversationOrchestrator } = require('../workspace/assistant.cjs');
const { blankState } = require('../workspace/conversation.cjs');
const FIELDS = ['customerName', 'phone', 'job', 'zip', 'callbackWindow', 'requestedWorkDate'];
const LABELS = { phone: 'callback number', job: 'electrical work', zip: 'job ZIP',
  callbackWindow: 'callback window', requestedWorkDate: 'requested work date' };
const initial = () => ({ ...blankState(), customerName: 'Jamie Stone', phone: '+15865550123',
  job: 'Install an EV charger', zip: '48315', callbackWindow: 'Monday afternoon', requestedWorkDate: 'Friday' });
const proposal = (value, evidence = value, operation = 'set') => ({
  changes: [{ field: 'customerName', value, evidence, operation }], clarify: [], answerTopics: [], intent: 'continue'
});
const invalid = error => error.code === 'invalid_assistant_output';

async function accepted(message, value, state, operation = 'set') {
  const raw = proposal(value, value, operation), before = structuredClone(state);
  assert.deepEqual(parseOutput(raw, message, state), raw, 'comparison must not rewrite source spelling');
  let calls = 0;
  const assistant = createConversationOrchestrator({ provider: { kind: 'fake', generate: async () => { calls++; return raw; } } });
  try {
    const result = await assistant.previewMessage(message, state, {}, { scope: 'synthetic-independent-name-regression' });
    assert.equal(result.assistance.mode, 'fake-provider');
    assert.equal(result.state.customerName, value);
    for (const field of FIELDS.filter(field => field !== 'customerName')) assert.equal(result.state[field], before[field]);
    assert.equal(result.state.issues.includes('customerName'), false);
    assert.deepEqual(state, before, 'the caller draft must remain unchanged');
    assert.equal(calls, 1);
  } finally { assistant.close(); }
}

test('RNG.correction.explicit-curly | field-specific correction preserves original apostrophe spelling', async () => {
  await accepted('Actually my name is O’Neil', 'O’Neil', initial(), 'correct');
});
for (const [id, message, value] of [
  ['actually-first-person', 'Actually I’m O’Neil', 'O’Neil'],
  ['correction-first-person', 'Correction: I am D’Arcy', 'D’Arcy']
]) test(`RNG.correction.${id} | explicit personal correction remains bound to the name field`, async () => {
  await accepted(message, value, initial(), 'correct');
});

for (const [id, message, value] of [
  ['first-person', 'I am D’Arcy', 'D’Arcy'],
  ['greeting-first-person', 'Hello, I’m O’Neil', 'O’Neil']
]) test(`RNG.personal-cue.${id} | accepted personal-name introductions retain their existing behavior`, async () => {
  const state = initial(); state.customerName = '';
  await accepted(message, value, state);
});

const denials = [
  ['correction-unapproved', 'My name is O’Neil', 'O’Neil', 'O’Neil', 'correct'],
  ['correction-other-field', 'Actually my job is replace an outlet. My name is O’Neil', 'O’Neil', 'O’Neil', 'correct'],
  ['site-name', 'The site name is O’Neil', 'O’Neil'],
  ['manufacturer-name', 'The manufacturer name is O’Neil', 'O’Neil'],
  ['business-name', 'The business name is O’Neil', 'O’Neil'],
  ['project-name', 'My project name is O’Neil', 'O’Neil'],
  ['different-person', 'My name is Jamie Stone. The manufacturer is O’Neil', 'O’Neil'],
  ['name-prefix-only', 'My name is O’Neil-Smith', 'O’Neil'],
  ['canonical-value-in-curly-message', 'My name is O’Neil', "O'Neil", 'My name is O’Neil'],
  ['curly-value-in-straight-message', "My name is O'Neil", 'O’Neil', "My name is O'Neil"],
  ['canonical-evidence-only', 'My name is O’Neil', 'O’Neil', "My name is O'Neil"]
];
for (const [id, message, value, evidence = value, operation = 'set'] of denials) {
  test(`RNG.reject.${id} | apostrophe comparison cannot invent evidence or customer-name authority`, async () => {
    const raw = proposal(value, evidence, operation), state = initial(), before = structuredClone(state);
    assert.throws(() => parseOutput(raw, message, state), invalid);
    const assistant = createConversationOrchestrator({ provider: { kind: 'fake', generate: async () => raw } });
    try {
      const result = await assistant.previewMessage(message, state, {}, { scope: 'synthetic-name-denial/' + id });
      assert.equal(result.assistance.mode, 'unavailable'); assert.equal(result.assistance.code, 'invalid_assistant_output');
      for (const field of FIELDS) assert.equal(result.state[field], before[field]);
      assert.deepEqual(state, before);
    } finally { assistant.close(); }
  });
}

test('RNG.context.name-question | a bare name answers the sole active customer-name question', async () => {
  const state = initial(); state.issues = ['customerName'];
  state.conversation = [{ role: 'assistant', text: 'What is the customer name?' }];
  await accepted('O’Neil', 'O’Neil', state);
});
for (const [field, label] of Object.entries(LABELS)) {
  test(`RNG.context.wrong-question-${field} | another field question cannot authorize a bare customer name`, () => {
    const state = initial(); state.issues = [field];
    state.conversation = [{ role: 'assistant', text: 'What is the ' + label + '?' }];
    const before = structuredClone(state);
    assert.throws(() => parseOutput(proposal('O’Neil'), 'O’Neil', state), invalid);
    assert.deepEqual(state, before);
  });
}
for (const [id, conversation] of [
  ['multiple-fields', [{ role: 'assistant', text: 'What is the customer name and callback number?' }]],
  ['superseded-question', [{ role: 'assistant', text: 'What is the customer name?' }, { role: 'assistant', text: 'What is the job ZIP?' }]]
]) test(`RNG.context.${id} | ambiguous or obsolete name questions do not supply extraction authority`, () => {
  const state = initial(); state.issues = ['customerName']; state.conversation = conversation;
  assert.throws(() => parseOutput(proposal('O’Neil'), 'O’Neil', state), invalid);
});
