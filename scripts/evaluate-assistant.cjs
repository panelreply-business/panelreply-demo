'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createConversationOrchestrator, FIELDS } = require('../workspace/assistant.cjs');
const { blankState } = require('../workspace/conversation.cjs');

const corpusPath = path.join(__dirname, '..', 'tests', 'fixtures', 'assistant', 'corpus.json');
function loadCorpus() { return JSON.parse(fs.readFileSync(corpusPath, 'utf8')); }
async function evaluateScenario(scenario) {
  let nextOutput, calls = 0, state = { ...blankState(), ...scenario.initial };
  let turns = 0, fieldChecks = 0, contextChecks = 0, clarifications = 0, failuresRecovered = 0;
  const historySnapshots = [];
  const assistant = createConversationOrchestrator({ provider: { kind: 'fake', generate(context) { calls++; historySnapshots.push(context.data.history); return nextOutput; } } });
  for (const turn of scenario.turns) {
    nextOutput = turn.response;
    const original = JSON.stringify(state), history = state.conversation.map(entry => ({ ...entry }));
    const beforeCalls = calls;
    const result = await assistant.previewMessage(turn.message, state, { facts: scenario.facts }, { scope: 'synthetic-' + scenario.id });
    assert.equal(JSON.stringify(state), original, 'caller state mutated');
    for (const key of FIELDS) { assert.equal(result.state[key], turn.expected.fields[key], scenario.id + ': ' + key); fieldChecks++; }
    assert.deepEqual([...result.state.issues].sort(), [...turn.expected.issues].sort(), 'clarification fields');
    assert.equal(result.state.hold, turn.expected.hold, 'safety hold');
    assert.equal(result.state.stopped, turn.expected.stopped, 'opt-out');
    assert.equal(result.assistance.mode, turn.expected.mode, 'mode disclosure');
    if (calls > beforeCalls) { assert.deepEqual(historySnapshots.at(-1), history, 'context preservation'); contextChecks++; }
    if (turn.expected.stopped) assert.deepEqual(result.replies, [], 'suppressed reply');
    // Assertions concern assistant-authored text, not quoted customer messages.
    assert.doesNotMatch(result.replies.join(' '), /your appointment is confirmed|we have dispatched|we sent (?:you )?(?:an? )?(?:text|email)|Unapproved dollar amount/i);
    if (turn.expected.issues.length) { assert.match(result.replies.join(' '), /confirm/i); clarifications++; }
    if (turn.expected.mode === 'unavailable') { assert.match(result.replies.join(' '), /unchanged/); failuresRecovered++; }
    state = result.state; turns++;
  }
  assistant.close();
  return { id: scenario.id, turns, fieldChecks, contextChecks, clarifications, failuresRecovered, fakeProviderCalls: calls };
}
async function run() {
  const corpus = loadCorpus(), results = [], failures = [];
  const start = process.hrtime.bigint();
  for (const scenario of corpus.scenarios) {
    try { results.push(await evaluateScenario(scenario)); }
    catch (error) { failures.push({ id: scenario.id, message: error.message }); }
  }
  const total = key => results.reduce((sum, result) => sum + result[key], 0);
  const report = {
    kind: 'synthetic-orchestration-evaluation', corpusVersion: corpus.version,
    scenarios: corpus.scenarios.length, passed: results.length, failed: failures.length,
    turns: total('turns'), validatedFieldChecks: total('fieldChecks'), contextChecks: total('contextChecks'),
    clarificationCases: total('clarifications'), invalidOutputRecoveries: total('failuresRecovered'),
    fakeProviderCalls: total('fakeProviderCalls'), realProviderCalls: 0,
    elapsedMs: Number(process.hrtime.bigint() - start) / 1e6, failures,
    limitation: 'Predefined fake outputs test orchestration and deterministic guards. This does not measure language-model extraction accuracy, relevance or production reliability.'
  };
  console.log(JSON.stringify(report, null, 2));
  if (failures.length) process.exitCode = 1;
  return report;
}
if (require.main === module) run().catch(() => { console.error('Synthetic assistant evaluation could not complete.'); process.exitCode = 1; });
module.exports = { loadCorpus, evaluateScenario, run };
