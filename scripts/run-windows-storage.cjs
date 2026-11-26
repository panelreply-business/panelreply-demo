'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { run } = require('node:test');
const { sourceEvidence, platformEvidence, collectNodeResults } = require('./test-evidence.cjs');
const { inspectBuild, loadCandidate, ARTIFACTS } = require('../workspace/native/windows-storage/load.cjs');
const { CASES, TEST_FILE } = require('../tests/windows-storage-cases.cjs');
const { selectNtfsParent } = require('../tests/windows-storage-support.cjs');
const { outputLocation, prepareOutputs } = require('../tests/windows-storage-output-support.cjs');
const { CHANNEL_ENV, createObservationReceiver } = require('../tests/windows-storage-observation-protocol.cjs');
const ROOT = path.resolve(__dirname, '..');

function argumentsFor(args) {
  const result = { buildFailed: false }, seen = new Set();
  for (let index = 0; index < args.length; index++) {
    const name = args[index];
    if (seen.has(name)) throw new Error('Repeated component argument: ' + name);
    seen.add(name);
    if (name === '--build-directory' && args[index + 1] && !args[index + 1].startsWith('--')) result.buildDirectory = path.resolve(args[++index]);
    else if (name === '--output' && args[index + 1] && !args[index + 1].startsWith('--')) result.output = args[++index];
    else if (name === '--build-failed') result.buildFailed = true;
    else throw new Error('Usage: node scripts/run-windows-storage.cjs --build-directory DIR --output FILE [--build-failed]');
  }
  if (!result.buildDirectory || !result.output) throw new Error('The component build directory and evidence output are required.');
  // Read-only validation preserves alias/.. semantics. Exclusive preparation
  // repeats this check before source observation or any native work.
  outputLocation(result.output, { root: ROOT });
  return result;
}

function completeOutcomes(actual, identity, platformKey) {
  const unexpected = actual.filter(item => !CASES.some(expected => expected.id === item.name));
  const accountingErrors = unexpected.map(item => ({ stage: 'case-accounting', status: 'ERROR',
    message: 'The component runner observed an unexpected method: ' + item.name, observedOutcome: item }));
  const tests = CASES.map(expected => {
    const matches = actual.filter(item => item.name === expected.id);
    if (matches.length > 1) accountingErrors.push({ stage: 'case-accounting', status: 'ERROR',
      message: 'The component runner observed a duplicate method: ' + expected.id });
    const item = matches[0];
    const names = expected.testInstrumented ? ARTIFACTS.slice(0, 2) : ARTIFACTS.slice(0, 1);
    return { id: TEST_FILE + '::' + expected.id, name: expected.id, purpose: expected.purpose,
      file: TEST_FILE, kind: 'component', productScope: null, releaseCredit: false, platformKey,
      status: matches.length > 1 ? 'FAIL' : item?.status || 'NOT_RUN', durationMs: item?.durationMs || 0,
      ...(item?.diagnostic ? { diagnostic: item.diagnostic } : {}),
      ...(matches.length > 1 ? { diagnostic: 'Repeated method outcomes make this execution ambiguous.', observedOutcomes: matches } : {}),
      testInstrumented: expected.testInstrumented,
      artifacts: identity ? identity.observed.filter(artifact => names.includes(artifact.name)) : [],
      fixtureArtifact: identity?.observed.find(artifact => artifact.name === ARTIFACTS[2]) || null };
  });
  return { tests, accountingErrors, unexpectedOutcomes: unexpected };
}

function rawLeafOutcomes(events) {
  // Retain observed failures if the shared strict parser rejects duplicate IDs.
  // This suite has only top-level known methods and no generated subtests.
  return events.filter(event => ['test:pass', 'test:fail'].includes(event.type) && event.data?.line).map(event => {
    const data = event.data, error = data.details?.error;
    return { name: data.name, status: data.skip ? 'SKIP' : data.todo ? 'TODO'
      : event.type === 'test:pass' ? 'PASS' : error?.failureType === 'cancelledByParent' ? 'CANCELLED' : 'FAIL',
    durationMs: data.details?.duration_ms || 0, ...(error ? { diagnostic: String(error.message || error).slice(0, 4000) } : {}) };
  });
}

function componentOutcome(report) {
  return { tests: report.tests.map(item => ({ id: item.id, status: item.status,
    ...(item.diagnostic ? { diagnostic: item.diagnostic } : {}) })), totals: report.totals,
    summarySuccess: false, productPassing: 0, releaseCredit: false,
    infrastructureErrors: report.infrastructureErrors.slice(0, 32) };
}

async function collectComponent(options, outputs, dependencies = {}) {
  const source = dependencies.source || sourceEvidence, platformFor = dependencies.platform || platformEvidence;
  const load = dependencies.load || loadCandidate, inspect = dependencies.inspect || inspectBuild;
  const selectParent = dependencies.selectParent || selectNtfsParent, runTests = dependencies.run || run;
  const before = source(ROOT);
  const startedAt = new Date().toISOString();
  const platform = platformFor();
  const logPath = outputs.logPath, observationsPath = outputs.journalPath;
  outputs.appendLog('Windows native storage component. No product acceptance or release-counter credit.\n');
  const failures = [];
  const events = [];
  let logError = null;
  const log = message => {
    if (logError) throw logError;
    try { outputs.appendLog(String(message).slice(0, 16000) + '\n'); }
    catch (error) { logError = error; throw error; }
  };
  let identity = null, identityAfter = null, fixtureParent = null, fixtureRoot = null;
  let actual = [], runnerSummary = null, nativeRuntimeChanged = false;
  let receiver = null, observationTransport = { state: 'NOT_STARTED', records: 0, bytes: 0 }, transportFailed = false;
  const controller = new AbortController();
  const previous = new Map();
  const environment = (key, value) => { previous.set(key, process.env[key]); process.env[key] = value; };
  const failure = (stage, error) => {
    failures.push({ stage, status: 'ERROR', message: String(error.message || error).slice(0, 4000),
      ...(error.attempts ? { attempts: error.attempts } : {}) });
    try { log(stage + ': ' + String(error.stack || error)); }
    catch (logFailure) {
      if (!failures.some(item => item.stage === 'component-log-output')) failures.push({ stage: 'component-log-output', status: 'ERROR',
        message: String(logFailure.message || logFailure).slice(0, 4000), code: logFailure.code || null });
    }
  };
  try {
    if (options.buildFailed) throw new Error('The separate native build step did not complete. No component method was run.');
    const candidate = load(options.buildDirectory, before);
    identity = candidate.identity;
    fixtureParent = selectParent(candidate.fixtureExecutable);
    fixtureRoot = fs.mkdtempSync(path.join(fixtureParent.path, 'panelreply-windows-storage-'));
    environment('PANELREPLY_WINDOWS_COMPONENT_BUILD', identity.root);
    environment('PANELREPLY_WINDOWS_COMPONENT_COMMIT', before.sourceCommit);
    environment('PANELREPLY_WINDOWS_COMPONENT_SOURCE', before.sourceTreeSha256);
    const channel = crypto.randomBytes(32).toString('hex');
    environment(CHANNEL_ENV, channel);
    environment('PANELREPLY_WINDOWS_TEST_ROOT', fixtureRoot);
    receiver = createObservationReceiver(channel, {
      appendJournal: text => outputs.appendJournal(text), appendLog: text => outputs.appendLog(text),
    });
    for await (const event of runTests({ files: [path.join(ROOT, TEST_FILE)], concurrency: 1,
      signal: AbortSignal.any([AbortSignal.timeout(120000), controller.signal]), timeout: 20000 })) {
      // Retain native outcomes before any output operation can fail. Drain the
      // aborted runner so later reported failures/cancellations are retained.
      if (['test:enqueue', 'test:start', 'test:pass', 'test:fail', 'test:summary'].includes(event.type)) {
        if (events.length < 1024) events.push(event);
        else if (!failures.some(item => item.stage === 'component-event-bound')) {
          const error = new Error('The component event catalog exceeded its bound.');
          failure('component-event-bound', error); controller.abort(error);
        }
      }
      try {
        if (event.type === 'test:stdout' && !transportFailed) receiver.push(event.data.message || '');
        if (['test:stderr', 'test:diagnostic'].includes(event.type)) log(event.data.message || '');
        if (event.type === 'test:pass' || event.type === 'test:fail') {
          log(event.type + ' ' + event.data.name + (event.data.skip ? ' SKIP ' + event.data.skip : ''));
          if (event.type === 'test:fail') log(event.data.details?.error?.stack || event.data.details?.error?.message || 'Unknown component failure');
        }
      } catch (error) {
        if (!transportFailed) failure('component-evidence-output', error);
        transportFailed = true; controller.abort(error);
      }
    }
  } catch (error) { controller.abort(error); failure(identity ? 'component-execution-or-fixture' : 'build-or-loader', error); }
  finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    if (identity) {
      try {
        identityAfter = inspect(options.buildDirectory, before);
        nativeRuntimeChanged = identity.manifestSha256 !== identityAfter.manifestSha256
          || JSON.stringify(identity.observed) !== JSON.stringify(identityAfter.observed);
        if (nativeRuntimeChanged) throw new Error('The native build identity or loaded artifact bytes changed during the component run.');
      } catch (error) { nativeRuntimeChanged = true; failure('native-identity-after', error); }
    }
    if (fixtureRoot) {
      try {
        // No ACL repair or permission change is permitted during fixture cleanup.
        fs.rmSync(fixtureRoot, { recursive: true, force: true, maxRetries: 0 });
        if (fs.existsSync(fixtureRoot)) throw new Error('The disposable native fixture root remains after cleanup.');
      } catch (error) { failure('fixture-cleanup', error); }
    }
  }
  if (receiver) {
    try {
      observationTransport = receiver.finish();
      if (transportFailed) throw new Error('The component output stream failed before completion.');
    } catch (error) {
      observationTransport = { ...receiver.state(), state: 'ERROR', message: String(error.message).slice(0, 4000) };
      failure('component-observation-protocol', error);
    }
  }
  try {
    const result = collectNodeResults(events, ROOT, platform.platformKey);
    actual = result.tests; runnerSummary = result.runnerSummary;
    failures.push(...result.infrastructureErrors.map(item => ({ ...item, stage: 'node-runner' })));
  } catch (error) { failure('case-accounting', error); actual = rawLeafOutcomes(events); }
  const completed = completeOutcomes(actual, identity, platform.platformKey);
  const tests = completed.tests;
  failures.push(...completed.accountingErrors);
  let after = null, sourceChanged = true;
  try { after = source(ROOT); sourceChanged = before.sourceCommit !== after.sourceCommit || before.sourceTreeSha256 !== after.sourceTreeSha256; }
  catch (error) { failure('source-identity-after', error); }
  if (sourceChanged) failure('source-identity', new Error('The source changed during the component run.'));
  const outputStateBeforeReport = outputs.evidence();
  for (const [name, item] of Object.entries(outputStateBeforeReport)) {
    if (item.failed) failures.push({ stage: 'component-' + name + '-identity', status: 'ERROR', message: 'The retained component output could not verify its expected identity and bytes.' });
  }
  const totals = { passed: 0, failed: 0, skipped: 0, cancelled: 0, notRun: 0, todo: 0 };
  for (const item of tests) totals[{ PASS: 'passed', FAIL: 'failed', SKIP: 'skipped', CANCELLED: 'cancelled', NOT_RUN: 'notRun', TODO: 'todo' }[item.status]]++;
  const success = totals.passed === CASES.length && failures.length === 0 && !sourceChanged && !nativeRuntimeChanged
    && !!identityAfter && runnerSummary?.success === true;
  const report = { format: 'panelreply-windows-storage-component-v1', suite: 'windows-storage-component',
    startedAt, completedAt: new Date().toISOString(), ...before, sourceTreeSha256After: after?.sourceTreeSha256 || null, sourceChanged,
    platform, buildDirectory: options.buildDirectory, buildFailed: options.buildFailed,
    nativeIdentity: identity, nativeIdentityAfter: identityAfter, nativeRuntimeChanged,
    fixtureParent, fixtureRoot, fixtureCleaned: !!fixtureRoot && !fs.existsSync(fixtureRoot),
    tests, totals, unexpectedOutcomes: completed.unexpectedOutcomes, infrastructureErrors: failures, runnerSummary, summarySuccess: success,
    logPath, observationsPath, observationTransport, outputStateBeforeReport,
    outputCompletion: 'Final descriptor verification and closure require the runner completion receipt and successful process exit. This report cannot record its own later close.',
    outputScope: 'Exclusive held evidence descriptors in an existing trusted outside parent. No hostile-parent, reparse-race, native ACL or durability acceptance.',
    releaseCredit: false, productPassing: 0, realProviderCalls: 0,
    scope: 'Inactive Windows native storage component only. Probe cases use a separately hashed instrumented binary. No application, SQLite-sidecar, restore-publication, ordinary second-account, physical-device or release acceptance.' };
  try { outputs.writeReport(report); }
  catch (error) { error.componentOutcome = componentOutcome(report); throw error; }
  return report;
}

async function main(args, { prepare = prepareOutputs, collect = collectComponent, dependencies, emit = console.log } = {}) {
  const options = argumentsFor(args);
  // All three exclusive descriptors exist before any source/native work.
  const outputs = prepare(options.output, { root: ROOT });
  let report = null;
  try {
    report = await collect(options, outputs, dependencies);
    outputs.finish();
    emit(JSON.stringify({ output: outputs.reportPath, suite: report.suite, sourceTreeSha256: report.sourceTreeSha256,
      ...report.totals, infrastructureErrors: report.infrastructureErrors.length, sourceChanged: report.sourceChanged,
      nativeRuntimeChanged: report.nativeRuntimeChanged, summarySuccess: report.summarySuccess, productPassing: 0,
      outputState: outputs.state(), outputCompletion: 'VERIFIED_AND_CLOSED' }));
    if (!report.summarySuccess) process.exitCode = 1;
    return report;
  } catch (error) {
    if (report) error.componentOutcome = componentOutcome(report);
    try { outputs.close(); } catch { /* Preserve the primary failure and all close outcomes. */ }
    throw outputs.annotate(error);
  }
}

module.exports = { argumentsFor, completeOutcomes, rawLeafOutcomes, collectComponent, main };
if (require.main === module) main(process.argv.slice(2)).catch(error => {
  console.error(JSON.stringify({ status: 'INCOMPLETE', code: error.code || null, message: String(error.message || error).slice(0, 4000),
    ...(error.outputState ? { outputState: error.outputState } : {}),
    ...(error.componentOutcome ? { componentOutcome: error.componentOutcome } : {}), productPassing: 0, releaseCredit: false }));
  process.exitCode = 1;
});
