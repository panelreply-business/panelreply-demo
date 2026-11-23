'use strict';

// A single native-verifier execution with read-only evidence around it.
// This wrapper is not loaded by either product and receives no product credit.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { sourceEvidence } = require('./test-evidence.cjs');
const { observeHostContext, observeBubblewrap, safeCode } = require('./ocr-isolation-host-context.cjs');
const ROOT = path.resolve(__dirname, '..');
const STDOUT_LIMIT = 128 * 1024;
const STDERR_LIMIT = 4096;
const TIMEOUT_MS = 240000;
const BUILD_OUTCOMES = Object.freeze(['success', 'failure', 'cancelled', 'skipped']);
const NATIVE_CASES = Object.freeze([
  'host-only canary unreadable and runtime/root mounts read only',
  'separate network namespace and IPv4 IPv6 Unix socket creation denied',
  'nonroot identity no capabilities no privilege escalation no worker forks and process bounds',
  'actual image recognition and normalization execute inside the required worker',
  'cancel terminates the wrapper and its actual namespace child',
  'timeout terminates the wrapper and its actual namespace child',
]);
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');

function captureSource(readSource = () => sourceEvidence(ROOT)) {
  try {
    const value = readSource();
    if (!value || !/^[a-f0-9]{40}$/.test(value.sourceCommit) || !/^[a-f0-9]{40}$/.test(value.gitTreeHash)
      || typeof value.dirty !== 'boolean' || !Array.isArray(value.sourceManifest)
      || value.sourceManifest.length < 1 || value.sourceManifest.length > 5000
      || value.sourceManifest.some(item => !item || Object.keys(item).sort().join(',') !== 'path,sha256'
        || typeof item.path !== 'string' || item.path.length > 4096 || item.path.startsWith('/')
        || /[\\\x00-\x1f\x7f:]/.test(item.path) || item.path.split('/').some(part => !part || part === '.' || part === '..')
        || !/^[a-f0-9]{64}$/.test(item.sha256))
      || value.sourceTreeSha256 !== sha256(JSON.stringify(value.sourceManifest))) return { state: 'UNAVAILABLE', reason: 'INVALID_SOURCE_EVIDENCE' };
    return { state: 'OBSERVED', sourceCommit: value.sourceCommit, gitTreeHash: value.gitTreeHash, dirty: value.dirty,
      sourceTreeSha256: value.sourceTreeSha256, sourceManifest: value.sourceManifest.map(item => ({ path: item.path, sha256: item.sha256 })) };
  } catch (error) { return { state: 'UNAVAILABLE', reason: safeCode(error) }; }
}

function executeNativeVerifier({ spawnProcess = spawn, timeoutMs = TIMEOUT_MS } = {}) {
  return new Promise(resolve => {
    const retained = [], stderr = [];
    let stdoutBytes = 0, stderrBytes = 0, stdoutRetained = 0, stderrRetained = 0;
    let outputLimitExceeded = false, timedOut = false, spawnErrorCode = null, killRequested = false, completed = false, timer, child;
    const finish = (exitCode, signal) => {
      if (completed) return;
      completed = true; clearTimeout(timer);
      const bytes = Buffer.concat(retained), errorBytes = Buffer.concat(stderr);
      let native = null, parseError = false;
      if (!outputLimitExceeded && !timedOut && !spawnErrorCode) {
        try { native = JSON.parse(bytes.toString('utf8')); }
        catch { parseError = true; }
      }
      resolve({ native, execution: { attempts: 1, exitCode: Number.isInteger(exitCode) ? exitCode : null,
        signal: typeof signal === 'string' && /^SIG[A-Z0-9]+$/.test(signal) ? signal : null,
        spawnErrorCode, timedOut, outputLimitExceeded, parseError, killRequested,
        stdoutBytes, stdoutBytesRetained: stdoutRetained, stdoutSha256: sha256(bytes),
        stderrBytes, stderrBytesRetained: stderrRetained, stderrSha256: sha256(errorBytes),
        rawStderrIncluded: false, stdoutLimitBytes: STDOUT_LIMIT, stderrLimitBytes: STDERR_LIMIT, timeoutMs } });
    };
    const stop = () => {
      if (killRequested) return;
      killRequested = true;
      try { child.kill('SIGKILL'); } catch { /* The report remains failed. No retry or PID sweep. */ }
    };
    try {
      child = spawnProcess(process.execPath, [path.join(ROOT, 'scripts/test-ocr-isolation.cjs')], {
        cwd: ROOT, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) { spawnErrorCode = safeCode(error); finish(null, null); return; }
    child.stdout.on('data', value => {
      const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
      stdoutBytes += bytes.length;
      const available = STDOUT_LIMIT - stdoutRetained;
      if (available > 0) { retained.push(Buffer.from(bytes.subarray(0, available))); stdoutRetained += Math.min(bytes.length, available); }
      if (stdoutBytes > STDOUT_LIMIT) { outputLimitExceeded = true; stop(); }
    });
    child.stderr.on('data', value => {
      const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
      stderrBytes += bytes.length;
      const available = STDERR_LIMIT - stderrRetained;
      if (available > 0) { stderr.push(Buffer.from(bytes.subarray(0, available))); stderrRetained += Math.min(bytes.length, available); }
      if (stderrBytes > STDERR_LIMIT) { outputLimitExceeded = true; stop(); }
    });
    for (const stream of [child.stdout, child.stderr]) stream.on('error', error => { spawnErrorCode = safeCode(error); stop(); });
    child.once('error', error => { spawnErrorCode = safeCode(error); });
    child.once('close', finish);
    timer = setTimeout(() => { timedOut = true; stop(); }, timeoutMs);
    timer.unref?.();
  });
}

function validNativeResult(native, execution) {
  if (!execution || !native || Array.isArray(native) || !['PASS', 'FAIL', 'BLOCKED'].includes(native.status)
    || execution.attempts !== 1 || execution.spawnErrorCode || execution.timedOut || execution.outputLimitExceeded
    || execution.parseError || execution.signal || execution.exitCode !== { PASS: 0, FAIL: 1, BLOCKED: 2 }[native.status]
    || native.privilegedRetry === true) return false;
  if (native.status === 'PASS') return native.privilegedRetry === false && native.cases === NATIVE_CASES.length
    && native.failures === 0 && Array.isArray(native.results) && native.results.length === NATIVE_CASES.length
    && native.results.every(item => item && typeof item.test === 'string')
    && new Set(native.results.map(item => item.test)).size === NATIVE_CASES.length
    && native.results.every(item => NATIVE_CASES.includes(item.test) && item.status === 'PASS');
  if (native.status === 'BLOCKED') return native.cases === 0 && native.nativeDenyBehavior === 'NOT TESTED' && native.privilegedRetry === false;
  if (native.results !== undefined) return Array.isArray(native.results) && Number.isInteger(native.cases) && native.cases === native.results.length
    && native.results.length <= NATIVE_CASES.length && native.results.every(item => item && typeof item.test === 'string')
    && new Set(native.results.map(item => item.test)).size === native.results.length
    && native.results.every(item => NATIVE_CASES.includes(item.test) && ['PASS', 'FAIL'].includes(item.status))
    && native.results.some(item => item.status === 'FAIL');
  return native.cases === undefined || native.cases === 0;
}

function finishObservation({ before, after, dependencyBefore, dependencyAfter, hostBefore, hostAfter, worker, buildOutcome }) {
  worker = worker && typeof worker === 'object' && worker.execution && typeof worker.execution === 'object'
    ? worker : { native: null, execution: { attempts: 1, reason: 'INVALID_WORKER_RESULT' } };
  const errors = [];
  const buildReady = buildOutcome === 'success';
  if (!buildReady) errors.push(BUILD_OUTCOMES.includes(buildOutcome) ? 'DEPENDENCY_BUILD_NOT_SUCCESSFUL' : 'DEPENDENCY_BUILD_OUTCOME_UNAVAILABLE');
  const sourceObserved = before.state === 'OBSERVED' && after.state === 'OBSERVED';
  const sourceStable = sourceObserved && JSON.stringify(before) === JSON.stringify(after);
  if (!sourceObserved) errors.push('SOURCE_UNAVAILABLE');
  else {
    if (before.dirty || after.dirty) errors.push('SOURCE_DIRTY');
    if (!sourceStable) errors.push('SOURCE_CHANGED');
  }
  const nativeValid = validNativeResult(worker.native, worker.execution);
  if (!nativeValid && buildReady) errors.push('NATIVE_RESULT_INVALID');
  const dependencyObserved = dependencyBefore.state === 'OBSERVED' && dependencyAfter.state === 'OBSERVED';
  const dependencyStable = dependencyObserved && JSON.stringify(dependencyBefore) === JSON.stringify(dependencyAfter);
  if (dependencyObserved && !dependencyStable) errors.push('DEPENDENCY_CHANGED');
  if (nativeValid && worker.native.status === 'PASS' && !dependencyObserved) errors.push('DEPENDENCY_IDENTITY_UNAVAILABLE');
  return { format: 'panelreply-ocr-isolation-host-evidence-v1', recordedAt: new Date().toISOString(),
    status: errors.length ? 'FAIL' : worker.native.status, evidenceErrors: errors,
    nativeStatus: !buildReady && worker.execution.attempts === 0 ? 'NOT_RUN' : nativeValid ? worker.native.status : 'NOT_ESTABLISHED',
    native: nativeValid ? worker.native : null,
    unexecutedCases: worker.execution.attempts === 0 ? NATIVE_CASES.map(test => ({ test, status: 'NOT_RUN' })) : [],
    source: { before, after, stable: sourceStable }, dependency: { buildOutcome: BUILD_OUTCOMES.includes(buildOutcome) ? buildOutcome : 'NOT_ESTABLISHED', before: dependencyBefore, after: dependencyAfter, stable: dependencyStable },
    host: { before: hostBefore, after: hostAfter }, execution: worker.execution,
    releaseCredit: false, productPassing: 0, nativeDenyBehavior: nativeValid && worker.native.status === 'PASS' && errors.length === 0 ? 'OBSERVED_ON_THIS_HOST' : 'NOT_ESTABLISHED',
    scope: 'One unprivileged six-case verifier attempt on this observed test host. Context does not change the native outcome. Failed source or dependency binding fails evidence. No other runner, production host or product release is accepted. No policy change, privileged retry or unconfined fallback.' };
}

function captureObservation(read) {
  try {
    const value = read();
    return value && typeof value === 'object' && !Array.isArray(value) ? value : { state: 'UNAVAILABLE', reason: 'INVALID_OBSERVATION' };
  } catch (error) { return { state: 'UNAVAILABLE', reason: safeCode(error) }; }
}

async function runObservation({ readSource, readContext = observeHostContext, readDependency = observeBubblewrap,
  runWorker = executeNativeVerifier, buildOutcome } = {}) {
  const before = captureSource(readSource), hostBefore = captureObservation(readContext), dependencyBefore = captureObservation(readDependency);
  let worker;
  if (buildOutcome !== 'success') {
    worker = { native: null, execution: { attempts: 0, reason: 'SUCCESSFUL_DEPENDENCY_BUILD_REQUIRED' } };
  } else if (before.state !== 'OBSERVED' || before.dirty) {
    worker = { native: null, execution: { attempts: 0, reason: 'CLEAN_SOURCE_REQUIRED' } };
  } else {
    try { worker = await runWorker(); }
    catch (error) { worker = { native: null, execution: { attempts: 1, reason: safeCode(error) } }; }
  }
  return finishObservation({ before, after: captureSource(readSource), hostBefore, hostAfter: captureObservation(readContext),
    dependencyBefore, dependencyAfter: captureObservation(readDependency), worker, buildOutcome });
}

const OUTPUT_ERROR_CODES = new Set([
  'OUTPUT_PATH_INVALID', 'OUTPUT_PARENT_UNAVAILABLE', 'OUTPUT_OVERLAP', 'OUTPUT_ALREADY_EXISTS',
  'OUTPUT_OPEN_FAILED', 'OUTPUT_IDENTITY_CHANGED', 'OUTPUT_WRITE_FAILED', 'OUTPUT_CLOSE_FAILED',
]);
function outputError(code, cause) {
  const error = new Error(code);
  error.code = code;
  if (cause) error.cause = cause;
  return error;
}
function outputCode(error) { return OUTPUT_ERROR_CODES.has(error?.code) ? error.code : safeCode(error); }
function directoryContains(parent, child) {
  const relative = path.relative(parent, child);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep));
}
function fileIdentity(stat) { return [String(stat.dev), String(stat.ino)].join(':'); }

function prepareEvidenceOutput(output, { root = ROOT, fsImpl = fs } = {}) {
  let fd = null, created = false, writeStarted = false, writeVerified = false, descriptorClosed = false, closeErrorCode = null;
  let canonicalRoot, canonicalParent, destination, parentIdentity, rootIdentity, initialFile;
  const rawParent = typeof output === 'string' ? path.dirname(output) : null;
  const state = () => ({ outputState: created ? 'CREATED_RETAINED' : 'NOT_CREATED', outputWriteStarted: writeStarted,
    outputWriteVerified: writeVerified, outputDescriptorClosed: descriptorClosed,
    ...(closeErrorCode ? { outputCloseErrorCode: closeErrorCode } : {}) });
  const annotate = error => {
    const failure = outputError(outputCode(error), error);
    Object.assign(failure, state());
    return failure;
  };
  function close() {
    if (fd === null) return;
    const held = fd; fd = null;
    try { fsImpl.closeSync(held); descriptorClosed = true; }
    catch (error) { closeErrorCode = safeCode(error); throw outputError('OUTPUT_CLOSE_FAILED', error); }
  }
  function canonicalDirectories() {
    let resolvedRoot, resolvedParent, parentStat, rootStat;
    try {
      // Resolve the raw existing parent first. Normalizing alias/.. beforehand
      // would change its filesystem meaning and recreate the original defect.
      resolvedParent = fsImpl.realpathSync.native(rawParent);
      resolvedRoot = fsImpl.realpathSync.native(root);
      parentStat = fsImpl.lstatSync(resolvedParent, { bigint: true });
      rootStat = fsImpl.lstatSync(resolvedRoot, { bigint: true });
    } catch (error) { throw outputError('OUTPUT_PARENT_UNAVAILABLE', error); }
    if (!parentStat.isDirectory() || !rootStat.isDirectory()) throw outputError('OUTPUT_PARENT_UNAVAILABLE');
    if (directoryContains(resolvedRoot, resolvedParent) || directoryContains(resolvedParent, resolvedRoot)) throw outputError('OUTPUT_OVERLAP');
    return { resolvedRoot, resolvedParent, parentStat, rootStat };
  }
  function verify(expectedBytes) {
    const directories = canonicalDirectories();
    if (directories.resolvedRoot !== canonicalRoot || directories.resolvedParent !== canonicalParent
      || fileIdentity(directories.parentStat) !== parentIdentity || fileIdentity(directories.rootStat) !== rootIdentity) throw outputError('OUTPUT_IDENTITY_CHANGED');
    let held, entry;
    try {
      held = fsImpl.fstatSync(fd, { bigint: true });
      entry = fsImpl.lstatSync(destination, { bigint: true });
    } catch (error) { throw outputError('OUTPUT_IDENTITY_CHANGED', error); }
    if (!held.isFile() || !entry.isFile() || String(held.nlink) !== '1' || String(entry.nlink) !== '1'
      || fileIdentity(held) !== fileIdentity(initialFile) || fileIdentity(entry) !== fileIdentity(initialFile)
      || String(held.mode) !== String(initialFile.mode) || String(entry.mode) !== String(initialFile.mode)
      || String(held.size) !== String(expectedBytes) || String(entry.size) !== String(expectedBytes)) throw outputError('OUTPUT_IDENTITY_CHANGED');
    if (!writeStarted && (String(held.mtimeNs) !== String(initialFile.mtimeNs) || String(held.ctimeNs) !== String(initialFile.ctimeNs))) throw outputError('OUTPUT_IDENTITY_CHANGED');
  }
  try {
    if (typeof output !== 'string' || !output.isWellFormed() || /[\x00-\x1f\x7f]/.test(output)
      || !path.isAbsolute(output) || !output.endsWith('.json') || path.basename(output).startsWith('release-')) throw outputError('OUTPUT_PATH_INVALID');
    const directories = canonicalDirectories();
    canonicalRoot = directories.resolvedRoot; canonicalParent = directories.resolvedParent;
    parentIdentity = fileIdentity(directories.parentStat); rootIdentity = fileIdentity(directories.rootStat);
    destination = path.join(canonicalParent, path.basename(output));
    try {
      fsImpl.lstatSync(destination, { bigint: true });
      throw outputError('OUTPUT_ALREADY_EXISTS');
    } catch (error) {
      if (error.code !== 'ENOENT') throw OUTPUT_ERROR_CODES.has(error.code) ? error : outputError('OUTPUT_OPEN_FAILED', error);
    }
    try {
      fd = fsImpl.openSync(destination, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW || 0), 0o600);
      created = true;
      initialFile = fsImpl.fstatSync(fd, { bigint: true });
    } catch (error) { throw outputError('OUTPUT_OPEN_FAILED', error); }
    // An exclusive descriptor prevents later leaf substitution from redirecting
    // writes. These checks bound parent replacement but require a trusted parent.
    verify(0);
  } catch (error) {
    try { close(); } catch { /* Preserve the original error and record close failure. */ }
    throw annotate(error);
  }
  return {
    write(encoded) {
      if (fd === null || writeStarted) throw outputError('OUTPUT_IDENTITY_CHANGED');
      verify(0);
      writeStarted = true;
      try { fsImpl.writeFileSync(fd, encoded, { encoding: 'utf8' }); fsImpl.fsyncSync(fd); }
      catch (error) { throw outputError('OUTPUT_WRITE_FAILED', error); }
      verify(Buffer.byteLength(encoded, 'utf8'));
      writeVerified = true;
    },
    close, annotate, state,
  };
}

async function runObservationToOutput(output, { buildOutcome, observe = runObservation, root = ROOT, fsImpl = fs } = {}) {
  // Output preparation happens before source/context reads or any verifier call.
  const file = prepareEvidenceOutput(output, { root, fsImpl });
  try {
    const report = await observe({ buildOutcome });
    const encoded = JSON.stringify(report, null, 2) + '\n';
    file.write(encoded);
    file.close();
    return { report, encoded };
  } catch (error) {
    try { file.close(); } catch { /* Keep the primary outcome. No path-based deletion. */ }
    throw file.annotate(error);
  }
}

async function main() {
  if (process.argv.length !== 5 || process.argv[3] !== '--build-outcome') throw new TypeError('Evidence output and build outcome are required.');
  const { report, encoded } = await runObservationToOutput(process.argv[2], { buildOutcome: process.argv[4] });
  // Do not emit a report before its exclusive descriptor has written and closed.
  process.stdout.write(encoded);
  process.exitCode = report.status === 'PASS' ? 0 : report.status === 'BLOCKED' ? 2 : 1;
}

module.exports = { STDOUT_LIMIT, STDERR_LIMIT, TIMEOUT_MS, BUILD_OUTCOMES, NATIVE_CASES, captureSource, executeNativeVerifier, validNativeResult, finishObservation, runObservation, prepareEvidenceOutput, runObservationToOutput };
if (require.main === module) main().catch(error => {
  process.stderr.write(JSON.stringify({ status: 'FAIL', reason: outputCode(error), releaseCredit: false, productPassing: 0,
    ...(error.outputState ? { outputState: error.outputState, outputWriteStarted: error.outputWriteStarted, outputWriteVerified: error.outputWriteVerified,
      outputDescriptorClosed: error.outputDescriptorClosed, ...(error.outputCloseErrorCode ? { outputCloseErrorCode: error.outputCloseErrorCode } : {}) } : {}) }) + '\n');
  process.exitCode = 1;
});
