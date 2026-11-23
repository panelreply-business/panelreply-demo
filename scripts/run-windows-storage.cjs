'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { run } = require('node:test');
const { sourceEvidence, platformEvidence, collectNodeResults } = require('./test-evidence.cjs');
const { inspectBuild, loadCandidate, ARTIFACTS } = require('../workspace/native/windows-storage/load.cjs');
const { CASES, TEST_FILE } = require('../tests/windows-storage-cases.cjs');
const { selectNtfsParent } = require('../tests/windows-storage-support.cjs');
const ROOT = path.resolve(__dirname, '..');

function argumentsFor(args) {
  const result = { buildFailed: false };
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--build-directory' && args[index + 1]) result.buildDirectory = path.resolve(args[++index]);
    else if (args[index] === '--output' && args[index + 1]) result.output = path.resolve(args[++index]);
    else if (args[index] === '--build-failed') result.buildFailed = true;
    else throw new Error('Usage: node scripts/run-windows-storage.cjs --build-directory DIR --output FILE [--build-failed]');
  }
  if (!result.buildDirectory || !result.output) throw new Error('The component build directory and evidence output are required.');
  const relative = path.relative(ROOT, result.output);
  if (!relative.startsWith('..' + path.sep) && !path.isAbsolute(relative)
      && !relative.startsWith('artifacts' + path.sep)) throw new Error('Keep generated component evidence outside source files or within artifacts/.');
  if (path.basename(result.output).startsWith('release-')) throw new Error('Component-only evidence must not use a release-* report name.');
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

async function main(args) {
  const options = argumentsFor(args);
  const before = sourceEvidence(ROOT);
  const startedAt = new Date().toISOString();
  const platform = platformEvidence();
  const prefix = options.output.replace(/\.json$/, '');
  fs.mkdirSync(path.dirname(options.output), { recursive: true });
  const logPath = prefix + '.log', observationsPath = prefix + '.observations.jsonl';
  fs.writeFileSync(logPath, 'Windows native storage component. No product acceptance or release-counter credit.\n');
  fs.writeFileSync(observationsPath, '');
  const log = message => fs.appendFileSync(logPath, String(message).slice(0, 16000) + '\n');
  const failures = [];
  const events = [];
  let identity = null, identityAfter = null, fixtureParent = null, fixtureRoot = null;
  let actual = [], runnerSummary = null, nativeRuntimeChanged = false;
  const previous = new Map();
  const environment = (key, value) => { previous.set(key, process.env[key]); process.env[key] = value; };
  const failure = (stage, error) => {
    failures.push({ stage, status: 'ERROR', message: String(error.message || error).slice(0, 4000),
      ...(error.attempts ? { attempts: error.attempts } : {}) });
    log(stage + ': ' + String(error.stack || error));
  };
  try {
    if (options.buildFailed) throw new Error('The separate native build step did not complete. No component method was run.');
    const candidate = loadCandidate(options.buildDirectory, before);
    identity = candidate.identity;
    fixtureParent = selectNtfsParent(candidate.fixtureExecutable);
    fixtureRoot = fs.mkdtempSync(path.join(fixtureParent.path, 'panelreply-windows-storage-'));
    environment('PANELREPLY_WINDOWS_COMPONENT_BUILD', identity.root);
    environment('PANELREPLY_WINDOWS_COMPONENT_COMMIT', before.sourceCommit);
    environment('PANELREPLY_WINDOWS_COMPONENT_SOURCE', before.sourceTreeSha256);
    environment('PANELREPLY_WINDOWS_COMPONENT_OBSERVATIONS', observationsPath);
    environment('PANELREPLY_WINDOWS_TEST_ROOT', fixtureRoot);
    for await (const event of run({ files: [path.join(ROOT, TEST_FILE)], concurrency: 1,
      signal: AbortSignal.timeout(120000), timeout: 20000 })) {
      if (['test:enqueue', 'test:start', 'test:pass', 'test:fail', 'test:summary'].includes(event.type)) events.push(event);
      if (['test:stdout', 'test:stderr', 'test:diagnostic'].includes(event.type)) log(event.data.message || '');
      if (event.type === 'test:pass' || event.type === 'test:fail') {
        log(event.type + ' ' + event.data.name + (event.data.skip ? ' SKIP ' + event.data.skip : ''));
        if (event.type === 'test:fail') log(event.data.details?.error?.stack || event.data.details?.error?.message || 'Unknown component failure');
      }
    }
  } catch (error) { failure(identity ? 'component-execution-or-fixture' : 'build-or-loader', error); }
  finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    if (identity) {
      try {
        identityAfter = inspectBuild(options.buildDirectory, before);
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
  try {
    const result = collectNodeResults(events, ROOT, platform.platformKey);
    actual = result.tests; runnerSummary = result.runnerSummary;
    failures.push(...result.infrastructureErrors.map(item => ({ ...item, stage: 'node-runner' })));
  } catch (error) { failure('case-accounting', error); actual = rawLeafOutcomes(events); }
  const completed = completeOutcomes(actual, identity, platform.platformKey);
  const tests = completed.tests;
  failures.push(...completed.accountingErrors);
  const after = sourceEvidence(ROOT);
  const sourceChanged = before.sourceCommit !== after.sourceCommit || before.sourceTreeSha256 !== after.sourceTreeSha256;
  if (sourceChanged) failure('source-identity', new Error('The source changed during the component run.'));
  const totals = { passed: 0, failed: 0, skipped: 0, cancelled: 0, notRun: 0, todo: 0 };
  for (const item of tests) totals[{ PASS: 'passed', FAIL: 'failed', SKIP: 'skipped', CANCELLED: 'cancelled', NOT_RUN: 'notRun', TODO: 'todo' }[item.status]]++;
  const success = totals.passed === CASES.length && failures.length === 0 && !sourceChanged && !nativeRuntimeChanged
    && !!identityAfter && runnerSummary?.success === true;
  const report = { format: 'panelreply-windows-storage-component-v1', suite: 'windows-storage-component',
    startedAt, completedAt: new Date().toISOString(), ...before, sourceTreeSha256After: after.sourceTreeSha256, sourceChanged,
    platform, buildDirectory: options.buildDirectory, buildFailed: options.buildFailed,
    nativeIdentity: identity, nativeIdentityAfter: identityAfter, nativeRuntimeChanged,
    fixtureParent, fixtureRoot, fixtureCleaned: !!fixtureRoot && !fs.existsSync(fixtureRoot),
    tests, totals, unexpectedOutcomes: completed.unexpectedOutcomes, infrastructureErrors: failures, runnerSummary, summarySuccess: success,
    logPath, observationsPath, releaseCredit: false, productPassing: 0, realProviderCalls: 0,
    scope: 'Inactive Windows native storage component only. Probe cases use a separately hashed instrumented binary. No application, SQLite-sidecar, restore-publication, ordinary second-account, physical-device or release acceptance.' };
  fs.writeFileSync(options.output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ output: options.output, suite: report.suite, sourceTreeSha256: before.sourceTreeSha256,
    ...totals, infrastructureErrors: failures.length, sourceChanged, nativeRuntimeChanged, summarySuccess: success, productPassing: 0 }));
  if (!success) process.exitCode = 1;
  return report;
}

module.exports = { argumentsFor, completeOutcomes, rawLeafOutcomes, main };
if (require.main === module) main(process.argv.slice(2)).catch(error => { console.error(error.stack); process.exitCode = 1; });
