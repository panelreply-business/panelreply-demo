'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createConversationOrchestrator, FIELDS } = require('../workspace/assistant.cjs');
const { blankState } = require('../workspace/conversation.cjs');

const corpusPath = path.join(__dirname, '..', 'tests', 'fixtures', 'assistant', 'corpus.json');
const remediationPath = path.join(__dirname, '..', 'tests', 'fixtures', 'assistant', 'remediation-corpus.json');
function loadCorpus() {
  const original = JSON.parse(fs.readFileSync(corpusPath, 'utf8'));
  const remediation = JSON.parse(fs.readFileSync(remediationPath, 'utf8'));
  const retained = original.scenarios.map(scenario => ({ ...scenario, category: 'original-baseline',
    intent: scenario.id.replaceAll('-', ' '), risk: 'Preserve the original regression fixture without altering its expected behavior.',
    source: 'Unmodified synthetic baseline corpus v1 in tests/fixtures/assistant/corpus.json.' }));
  const scenarios = [...retained, ...remediation.scenarios];
  assert.ok(scenarios.length >= 300, 'the checked-in synthetic corpus must retain at least 300 scenarios');
  assert.equal(new Set(scenarios.map(item => item.id)).size, scenarios.length, 'scenario IDs must be unique');
  const signatures = remediation.scenarios.map(({ id, category, intent, risk, source, ...fixture }) => JSON.stringify(fixture));
  assert.equal(new Set(signatures).size, signatures.length, 'remediation scenarios must exercise distinct fixtures');
  for (const item of scenarios) {
    for (const key of ['category', 'intent', 'risk', 'source']) assert.ok(typeof item[key] === 'string' && item[key].trim(), item.id + ' missing ' + key);
    assert.ok(item.turns.length, item.id + ' requires a conversation');
  }
  return { version: 2, originalVersion: original.version, remediationVersion: remediation.version, scenarios };
}
async function evaluateScenario(scenario) {
  let currentTurn, calls = 0, state = { ...blankState(), ...scenario.initial };
  let turns = 0, fieldChecks = 0, contextChecks = 0, clarifications = 0, failuresRecovered = 0, protectionChecks = 0;
  let timestamp = 1_000_000, current = true, controller;
  let facts = scenario.facts || {};
  const historySnapshots = [];
  const provider = { kind: 'fake', generate(context, { signal }) {
    calls++; historySnapshots.push(context.data.history);
    if (currentTurn.expireDuringCall) current = false;
    if (currentTurn.cancelDuringCall) controller.abort();
    if (currentTurn.providerFailure === 'error') throw new Error('Synthetic provider failure: private transport diagnostics must not appear.');
    if (currentTurn.providerFailure === 'timeout') return new Promise((resolve, reject) => {
      if (signal.aborted) reject(new Error('Synthetic cancelled timeout.'));
      else signal.addEventListener('abort', () => reject(new Error('Synthetic cancelled timeout.')), { once: true });
    });
    return currentTurn.response;
  } };
  const config = scenario.configuration || {};
  const assistant = createConversationOrchestrator({ ...config, provider: config.provider === 'disabled' ? null : provider, now: () => timestamp });
  try {
  for (const turn of scenario.turns) {
    currentTurn = turn;
    if (turn.resetBefore) { assistant.cancel(turn.scope || 'synthetic-' + scenario.id); state = blankState(); }
    if (turn.stateBefore) state = { ...state, ...structuredClone(turn.stateBefore) };
    if (turn.factsBefore) facts = structuredClone(turn.factsBefore);
    timestamp += turn.advanceTimeMs || 0;
    current = turn.sessionCurrent !== false;
    controller = new AbortController();
    if (turn.abortedBefore) controller.abort();
    const original = JSON.stringify(state), history = state.conversation.map(entry => ({ ...entry }));
    const beforeCalls = calls;
    const run = () => assistant.previewMessage(turn.message, state, { facts }, { scope: turn.scope || 'synthetic-' + scenario.id,
      suppressed: turn.suppressed === true, safetyHeld: turn.safetyHeld === true, isCurrent: () => current, signal: controller.signal });
    if (turn.expected.errorCode) {
      await assert.rejects(run(), error => error.code === turn.expected.errorCode, scenario.id + ': expected controlled failure');
      assert.equal(JSON.stringify(state), original, 'caller state mutated after failure');
      if (turn.expected.providerCallsDelta !== undefined) assert.equal(calls - beforeCalls, turn.expected.providerCallsDelta, 'provider invocation after rejected input/session');
      turns++; protectionChecks++; continue;
    }
    const result = await run();
    assert.equal(JSON.stringify(state), original, 'caller state mutated');
    for (const key of FIELDS) { assert.equal(result.state[key], turn.expected.fields[key], scenario.id + ': ' + key); fieldChecks++; }
    assert.deepEqual([...result.state.issues].sort(), [...turn.expected.issues].sort(), 'clarification fields');
    assert.equal(result.state.hold, turn.expected.hold, 'safety hold');
    assert.equal(result.state.stopped, turn.expected.stopped, 'opt-out');
    assert.equal(result.assistance.mode, turn.expected.mode, 'mode disclosure');
    if (turn.expected.code) assert.equal(result.assistance.code, turn.expected.code, 'failure classification');
    if (turn.expected.providerCallsDelta !== undefined) { assert.equal(calls - beforeCalls, turn.expected.providerCallsDelta, 'provider call count'); protectionChecks++; }
    if (calls > beforeCalls) { assert.deepEqual(historySnapshots.at(-1), history, 'context preservation'); contextChecks++; }
    if (turn.expected.stopped) assert.deepEqual(result.replies, [], 'suppressed reply');
    // Assertions concern assistant-authored text, not quoted customer messages.
    assert.doesNotMatch(result.replies.join(' '), /your appointment is confirmed|we have dispatched|we sent (?:you )?(?:an? )?(?:text|email)|Unapproved dollar amount/i);
    assert.doesNotMatch(result.replies.join(' '), /private transport diagnostics/);
    for (const fragment of turn.expected.replyIncludes || []) { assert.ok(result.replies.join('\n').includes(fragment), scenario.id + ': missing reply ' + fragment); protectionChecks++; }
    for (const fragment of turn.expected.replyExcludes || []) { assert.ok(!result.replies.join('\n').includes(fragment), scenario.id + ': unexpected reply ' + fragment); protectionChecks++; }
    if (turn.expected.issues.length) { assert.match(result.replies.join(' '), /confirm/i); clarifications++; }
    if (turn.expected.mode === 'unavailable') { assert.match(result.replies.join(' '), /unchanged/); failuresRecovered++; }
    state = result.state; turns++;
  }
  } catch (error) {
    error.scenarioTurn = turns + 1;
    error.scenarioInput = currentTurn?.message;
    throw error;
  } finally { assistant.close(); }
  return { id: scenario.id, category: scenario.category || 'original-baseline', intent: scenario.intent, source: scenario.source,
    status: 'PASS', turns, fieldChecks, contextChecks, clarifications, failuresRecovered, protectionChecks, fakeProviderCalls: calls };
}
async function run() {
  const corpus = loadCorpus(), results = [], failures = [];
  const start = process.hrtime.bigint();
  for (const scenario of corpus.scenarios) {
    try { results.push(await evaluateScenario(scenario)); }
    catch (error) { failures.push({ id: scenario.id, category: scenario.category || 'original-baseline', intent: scenario.intent, source: scenario.source,
      status: 'FAIL', turn: error.scenarioTurn, input: error.scenarioInput, message: error.message }); }
  }
  const total = key => results.reduce((sum, result) => sum + result[key], 0);
  const report = {
    kind: 'synthetic-orchestration-evaluation', corpusVersion: corpus.version,
    scenarios: corpus.scenarios.length, passed: results.length, failed: failures.length,
    turns: total('turns'), validatedFieldChecks: total('fieldChecks'), contextChecks: total('contextChecks'),
    clarificationCases: total('clarifications'), invalidOutputRecoveries: total('failuresRecovered'),
    protectionChecks: total('protectionChecks'),
    categories: Object.fromEntries([...new Set(corpus.scenarios.map(item => item.category || 'original-baseline'))].map(category => [category, {
      scenarios: corpus.scenarios.filter(item => (item.category || 'original-baseline') === category).length,
      passed: results.filter(item => item.category === category).length, failed: failures.filter(item => item.category === category).length
    }])),
    fakeProviderCalls: total('fakeProviderCalls'), realProviderCalls: 0,
    elapsedMs: Number(process.hrtime.bigint() - start) / 1e6, failures, results,
    limitation: 'Predefined fake outputs test orchestration and deterministic guards. This does not measure language-model extraction accuracy, relevance or production reliability.'
  };
  console.log(JSON.stringify(report, null, 2));
  if (failures.length) process.exitCode = 1;
  return report;
}
if (require.main === module) run().catch(() => { console.error('Synthetic assistant evaluation could not complete.'); process.exitCode = 1; });
module.exports = { loadCorpus, evaluateScenario, run };
