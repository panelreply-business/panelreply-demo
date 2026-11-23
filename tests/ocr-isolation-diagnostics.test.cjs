'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { createReadinessDiagnostics, classify, fixedStage, MAX_STDERR_BYTES } = require('../scripts/ocr-isolation-diagnostics.cjs');

function fakeChild() { const child = new EventEmitter(); child.stderr = new PassThrough(); return child; }
function record(stderr, options = {}) { return { stage: 'engine_version', stderr, exitCode: 1, signal: null, spawnErrorCode: null, ...options }; }

test('readiness diagnostics observe exactly the existing invocation and bound split stderr chunks', () => {
  const calls = [], child = fakeChild();
  const observer = createReadinessDiagnostics({ spawnProcess: (...args) => { calls.push(args); return child; } });
  const args = ['/usr/bin/bwrap', '--', '/usr/bin/tesseract', '--version'], options = { shell: false };
  assert.equal(observer.spawnProcess('/usr/bin/prlimit', args, options), child);
  child.stderr.write(Buffer.alloc(MAX_STDERR_BYTES - 2, 65));
  child.stderr.write(Buffer.from('B'.repeat(10000)));
  child.emit('close', 1, null);
  const report = observer.snapshot('isolation_unavailable');
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1], args);
  assert.equal(calls[0][2], options);
  assert.equal(report.observedInvocations, 1);
  assert.equal(report.records[0].stage, 'engine_version');
  assert.equal(report.records[0].stderrBytesRetained, MAX_STDERR_BYTES);
  assert.equal(Buffer.byteLength(report.records[0].stderr), MAX_STDERR_BYTES);
  assert.ok(report.records[0].stderr.endsWith('BB'));
  assert.equal(report.records[0].stderrTruncated, true);
  assert.equal(report.records[0].closed, true);
  assert.equal(report.records[0].exitCode, 1);
});

test('only explicit namespace errors establish a confirmed host blocker', () => {
  for (const stderr of ['bwrap: Creating new namespace failed: Operation not permitted', 'bwrap: No permissions to create new namespace, likely because the kernel does not allow it', 'bwrap: loopback: Failed to create NETLINK_ROUTE socket: Operation not permitted']) {
    assert.deepEqual(classify([record(stderr)]), { kind: 'host_namespace_denied', confirmedExternalBlocker: true, status: 'BLOCKED' });
  }
  for (const stderr of ['Operation not permitted', '', 'bwrap: Could not set up seccomp: Permission denied', 'bwrap: loopback: Failed RTM_NEWADDR: Operation not permitted']) {
    assert.equal(classify([record(stderr)]).confirmedExternalBlocker, false);
    assert.equal(classify([record(stderr)]).status, 'BLOCKED');
  }
});

test('missing launcher, invalid worker configuration and SIGSYS fail without claiming a host restriction', () => {
  for (const row of [record('', { spawnErrorCode: 'ENOENT' }), record('bwrap: Unknown option --example'), record('bwrap: Invalid argument'), record('error while loading shared libraries: libexample.so'), record('', { signal: 'SIGSYS', exitCode: null })]) {
    const classification = classify([row]);
    assert.equal(classification.status, 'FAIL');
    assert.equal(classification.confirmedExternalBlocker, false);
  }
});

test('synchronous and asynchronous launch errors retain safe codes without error messages or retries', () => {
  const secretError = Object.assign(new Error('PRIVATE credential-like diagnostic'), { code: 'ENOENT' });
  let attempts = 0;
  const rejected = createReadinessDiagnostics({ spawnProcess: () => { attempts += 1; throw secretError; } });
  assert.throws(() => rejected.spawnProcess('/usr/bin/prlimit', ['--version'], {}), error => error === secretError);
  assert.equal(attempts, 1);
  assert.equal(rejected.snapshot().records[0].spawnErrorCode, 'ENOENT');
  assert.equal(JSON.stringify(rejected.snapshot()).includes('PRIVATE'), false);
  const child = fakeChild(), observer = createReadinessDiagnostics({ spawnProcess: () => child });
  observer.spawnProcess('/usr/bin/prlimit', ['--version'], {});
  child.emit('error', Object.assign(new Error('PRIVATE'), { code: 'UNRECOGNIZED_PRIVATE' }));
  child.emit('close', null, 'SIGKILL');
  assert.equal(observer.snapshot().records[0].spawnErrorCode, 'OTHER');
  assert.equal(observer.snapshot().records[0].signal, 'SIGKILL');
  assert.equal(JSON.stringify(observer.snapshot()).includes('PRIVATE'), false);
});

test('stage names are fixed and unexpected arguments or terminal controls cannot leak into the report', () => {
  assert.equal(fixedStage(['/usr/bin/bwrap', '--version']), 'isolation_version');
  assert.equal(fixedStage(['/usr/bin/tesseract', '--list-langs']), 'engine_languages');
  assert.equal(fixedStage(['/usr/bin/python3', '-I', '-B', '/app/ocr-preprocess.py', '--probe']), 'normalizer_probe');
  const child = fakeChild(), observer = createReadinessDiagnostics({ spawnProcess: () => child });
  observer.spawnProcess('/private/path', ['PRIVATE_ARGUMENT'], { env: { PRIVATE: 'secret' } });
  child.stderr.write('PRIVATE stderr');
  child.emit('close', 1, null);
  const report = observer.snapshot();
  assert.equal(report.records[0].stage, 'unexpected_readiness_stage');
  assert.equal(report.records[0].stderr, '');
  assert.equal(JSON.stringify(report).includes('PRIVATE'), false);
  const native = fakeChild(), known = createReadinessDiagnostics({ spawnProcess: () => native });
  known.spawnProcess('/usr/bin/prlimit', ['--version'], {});
  native.stderr.write(Buffer.from([65, 0, 27, 255, 10]));
  native.emit('close', 1, null);
  assert.equal(known.snapshot().records[0].stderr, 'A???\n');
});

test('successful process exits or missing exit evidence never prove readiness or OS isolation', () => {
  for (const records of [[], [record('', { exitCode: 0 })]]) {
    assert.deepEqual(classify(records), { kind: 'readiness_contract_unconfirmed', confirmedExternalBlocker: false, status: 'BLOCKED' });
  }
  assert.equal(classify([record('')], 'normalizer_unavailable').kind, 'normalizer_failure_unconfirmed');
  const child = fakeChild(), observer = createReadinessDiagnostics({ spawnProcess: () => child });
  observer.spawnProcess('/usr/bin/prlimit', ['--version'], {});
  child.stderr.write(Buffer.alloc(MAX_STDERR_BYTES, 65));
  child.stderr.write('bwrap: Creating new namespace failed: Operation not permitted');
  child.emit('close', 1, null);
  assert.equal(observer.snapshot().classification.confirmedExternalBlocker, false);
});

test('a rejected dependency version is a prerequisite failure even when the version command exits zero', () => {
  for (const reason of ['isolation_dependency_unsupported', 'isolation_dependency_unavailable']) {
    assert.deepEqual(classify([record('', { stage: 'isolation_version', exitCode: 0 })], reason), { kind: reason, confirmedExternalBlocker: false, status: 'FAIL' });
  }
});

test('trusted path rejection is a configuration failure with no native denial or host blocker claimed', () => {
  for (const reason of ['isolation_path_overlap', 'isolation_path_context_unavailable']) {
    for (const records of [[], [record('', { stage: 'isolation_version', exitCode: 0 })]]) {
      assert.deepEqual(classify(records, reason), { kind: reason, confirmedExternalBlocker: false, status: 'FAIL' });
    }
  }
});

test('the observer retains all four fixed readiness stages after adding the version gate', () => {
  const children = [];
  const observer = createReadinessDiagnostics({ spawnProcess: () => { const child = fakeChild(); children.push(child); return child; } });
  for (const args of [['/usr/bin/bwrap', '--version'], ['/usr/bin/bwrap', '--', '/usr/bin/tesseract', '--version'], ['/usr/bin/bwrap', '--', '/usr/bin/tesseract', '--list-langs'], ['/usr/bin/bwrap', '--', '/usr/bin/python3', '-I', '-B', '/app/ocr-preprocess.py', '--probe']]) {
    observer.spawnProcess('/usr/bin/prlimit', args, {});
    children.at(-1).emit('close', 0, null);
  }
  const report = observer.snapshot();
  assert.equal(report.observedInvocations, 4);
  assert.equal(report.maxRecords, 4);
  assert.deepEqual(report.records.map(row => row.stage), ['isolation_version', 'engine_version', 'engine_languages', 'normalizer_probe']);
  assert.equal(report.records.every(row => row.closed), true);
});

// Host and wrapper checks remain harness-only through this file's existing
// evidence classification. They do not execute a namespace or native worker.
const crypto = require('node:crypto');
const hostFsConstants = require('node:fs').constants;
const path = require('node:path');
const { FILES: HOST_FILES, PROFILE_FILES, readHostFile, observeHostContext, observeBubblewrap } = require('../scripts/ocr-isolation-host-context.cjs');
const { STDOUT_LIMIT, STDERR_LIMIT, NATIVE_CASES, captureSource, executeNativeVerifier, validNativeResult, finishObservation, runObservation } = require('../scripts/observe-ocr-isolation.cjs');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');

function hostFiles(values = {}, options = {}) {
  const descriptors = new Map(), calls = { opened: [], readBytes: 0, readRequests: [], closed: [], listed: [] };
  let next = 20;
  const failure = code => Object.assign(new Error('PRIVATE host path and diagnostic'), { code });
  const impl = {
    openSync(filename, flags) {
      calls.opened.push({ filename, flags });
      if (!Object.hasOwn(values, filename)) throw failure('ENOENT');
      if (values[filename] instanceof Error) throw values[filename];
      const fd = next++;
      descriptors.set(fd, { filename, value: Buffer.from(values[filename]), offset: 0, statCalls: 0 });
      return fd;
    },
    fstatSync(fd) {
      const descriptor = descriptors.get(fd); descriptor.statCalls++;
      return { isFile: () => options.regular !== false, dev: 1n, ino: 2n, mode: 0o100755n,
        size: options.reportedSize ?? (options.reportSizeZero ? 0n : BigInt(descriptor.value.length)),
        mtimeNs: options.changeIdentity && descriptor.statCalls > 1 ? 2n : 1n, ctimeNs: 1n };
    },
    readSync(fd, buffer, offset, length) {
      calls.readRequests.push(length);
      if (options.readError) throw options.readError;
      const descriptor = descriptors.get(fd), count = Math.min(length, options.chunk || length, descriptor.value.length - descriptor.offset);
      descriptor.value.copy(buffer, offset, descriptor.offset, descriptor.offset + count);
      descriptor.offset += count; calls.readBytes += count;
      return count;
    },
    closeSync(fd) { calls.closed.push(fd); descriptors.delete(fd); },
    lstatSync(filename) {
      calls.listed.push(filename);
      const type = options.profiles?.[filename];
      if (!type) throw failure('ENOENT');
      return { isFile: () => type === 'file', isSymbolicLink: () => type === 'symlink' };
    },
  };
  return { impl, calls };
}
function sourceFixture(tag = 'a') {
  const sourceManifest = [{ path: 'scripts/test-ocr-isolation.cjs', sha256: tag.repeat(64) }];
  return { sourceCommit: '1'.repeat(40), gitTreeHash: '2'.repeat(40), dirty: false, sourceManifest,
    sourceTreeSha256: hash(JSON.stringify(sourceManifest)) };
}
function nativePass() {
  return { status: 'PASS', cases: 6, failures: 0, privilegedRetry: false,
    results: NATIVE_CASES.map(test => ({ test, status: 'PASS' })) };
}
function workerFixture(native = nativePass()) { return { native, execution: { attempts: 1, exitCode: { PASS: 0, FAIL: 1, BLOCKED: 2 }[native.status], signal: null } }; }
function observationFixture(worker = workerFixture()) {
  const source = captureSource(() => sourceFixture());
  const dependency = { state: 'OBSERVED', path: '/usr/bin/bwrap', sha256: 'b'.repeat(64), bytes: 123 };
  return { before: source, after: structuredClone(source), dependencyBefore: dependency, dependencyAfter: structuredClone(dependency),
    hostBefore: { state: 'OBSERVED' }, hostAfter: { state: 'OBSERVED' }, worker, buildOutcome: 'success' };
}
function nativeChild() {
  const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.killCalls = [];
  child.kill = signal => { child.killCalls.push(signal); setImmediate(() => child.emit('close', null, signal)); return true; };
  return child;
}

test('host context rejects arbitrary paths and caps short reads without retaining truncated values', () => {
  const target = HOST_FILES.processStatus, fixture = hostFiles({ [target.path]: 'A'.repeat(target.limit * 2) }, { reportSizeZero: true, chunk: 7 });
  assert.throws(() => readHostFile('/private/secret', fixture.impl), /Unknown host-context/);
  assert.equal(fixture.calls.opened.length, 0);
  assert.deepEqual(readHostFile('processStatus', fixture.impl), { state: 'UNAVAILABLE', reason: 'SIZE_LIMIT' });
  assert.equal(fixture.calls.readBytes, target.limit + 1);
  assert.equal(fixture.calls.closed.length, 1);
  assert.ok(fixture.calls.readRequests.every(length => length <= target.limit + 1));
  assert.equal(fixture.calls.opened[0].flags, hostFsConstants.O_RDONLY | hostFsConstants.O_NOFOLLOW);
});

test('host context retains only named OS and security fields and two bounded runner labels', () => {
  const fixture = hostFiles({
    [HOST_FILES.osRelease.path]: 'ID=ubuntu\nVERSION_ID="26.04"\nPRIVATE_TOKEN=PRIVATE\n',
    [HOST_FILES.processStatus.path]: 'Name:\tPRIVATE\nCapEff:\t0000000000000000\nNoNewPrivs:\t1\nSeccomp:\t2\nPrivate:\tPRIVATE\n',
    [HOST_FILES.processLabel.path]: 'unconfined\n',
  });
  const context = observeHostContext({ fsImpl: fixture.impl, platform: 'linux', architecture: 'x64', kernel: '7.0.0-test', node: 'v24.22.3',
    env: { ImageOS: 'ubuntu26', ImageVersion: '20261111.196.1', PRIVATE_TOKEN: 'PRIVATE' } });
  assert.deepEqual(context.fields.osRelease.value, { ID: 'ubuntu', VERSION_ID: '26.04' });
  assert.deepEqual(context.fields.processStatus.value, { CapEff: '0000000000000000', NoNewPrivs: '1', Seccomp: '2' });
  assert.equal(context.runnerImage.imageOs.value, 'ubuntu26');
  assert.equal(JSON.stringify(context).includes('PRIVATE'), false);
  assert.deepEqual(fixture.calls.opened.map(item => item.filename).sort(), Object.entries(HOST_FILES).filter(([key]) => key !== 'bubblewrap').map(([, value]) => value.path).sort());
  assert.deepEqual(fixture.calls.listed, [...PROFILE_FILES]);
});

test('sysfs attribute metadata size does not conceal a bounded observed control value', () => {
  const target = HOST_FILES.apparmorEnabled;
  const fixture = hostFiles({ [target.path]: 'Y\n' }, { reportedSize: 4096n, chunk: 1 });
  const context = observeHostContext({ fsImpl: fixture.impl, platform: 'linux', env: {} });
  assert.deepEqual(context.fields.apparmorEnabled, { state: 'OBSERVED', value: 'Y', bytes: 2 });
  assert.equal(fixture.calls.readBytes, 2);
  assert.equal(fixture.calls.closed.length, 1);
  const changed = hostFiles({ [target.path]: 'Y\n' }, { reportedSize: 4096n, changeIdentity: true });
  assert.deepEqual(readHostFile('apparmorEnabled', changed.impl), { state: 'UNAVAILABLE', reason: 'FILE_CHANGED' });
  assert.equal(changed.calls.closed.length, 1);
});

test('sysfs control reads retain their byte cap when metadata reports a page size', () => {
  const target = HOST_FILES.apparmorEnabled;
  const fixture = hostFiles({ [target.path]: 'Y'.repeat(4096) }, { reportedSize: 4096n, chunk: 3 });
  assert.deepEqual(readHostFile('apparmorEnabled', fixture.impl), { state: 'UNAVAILABLE', reason: 'SIZE_LIMIT' });
  assert.equal(fixture.calls.readBytes, target.limit + 1);
  assert.equal(fixture.calls.closed.length, 1);
  assert.ok(fixture.calls.readRequests.every(length => length <= target.limit + 1));
});

test('sysfs size handling preserves ordinary executable size rejection before any read', () => {
  const target = HOST_FILES.bubblewrap;
  const fixture = hostFiles({ [target.path]: 'synthetic' }, { reportedSize: BigInt(target.limit + 1) });
  assert.deepEqual(observeBubblewrap(fixture.impl), { state: 'UNAVAILABLE', reason: 'SIZE_LIMIT' });
  assert.equal(fixture.calls.readBytes, 0);
  assert.equal(fixture.calls.closed.length, 1);
});

test('missing and denied host controls remain unavailable while an observed zero remains explicit', () => {
  const denied = Object.assign(new Error('PRIVATE error message'), { code: 'EACCES' });
  const fixture = hostFiles({ [HOST_FILES.unprivilegedUsernsClone.path]: '0\n', [HOST_FILES.apparmorEnabled.path]: denied });
  const context = observeHostContext({ fsImpl: fixture.impl, platform: 'linux', env: {} });
  assert.deepEqual(context.fields.unprivilegedUsernsClone, { state: 'OBSERVED', value: '0', bytes: 2 });
  assert.deepEqual(context.fields.apparmorEnabled, { state: 'UNAVAILABLE', reason: 'EACCES' });
  assert.deepEqual(context.fields.apparmorRestrictUserns, { state: 'UNAVAILABLE', reason: 'ENOENT' });
  assert.equal(JSON.stringify(context).includes('PRIVATE'), false);
  assert.equal(context.fields.apparmorProfiles.value, undefined);
  assert.ok(context.profileFiles.every(item => item.state === 'UNAVAILABLE' && item.attachment === 'NOT_ESTABLISHED'));
});

test('profile observations retain only bwrap names and never equate file presence with attachment', () => {
  const fixture = hostFiles({ [HOST_FILES.apparmorProfiles.path]: 'bwrap (unconfined)\nunpriv_bwrap (enforce)\nPRIVATE_PROCESS (enforce)\n' },
    { profiles: { [PROFILE_FILES[0]]: 'file', [PROFILE_FILES[1]]: 'symlink' } });
  const context = observeHostContext({ fsImpl: fixture.impl, platform: 'linux', env: {} });
  assert.deepEqual(context.fields.apparmorProfiles.value, [{ profile: 'bwrap', mode: 'unconfined' }, { profile: 'unpriv_bwrap', mode: 'enforce' }]);
  assert.equal(context.profileFiles[0].type, 'file');
  assert.equal(context.profileFiles[1].type, 'symlink');
  assert.ok(context.profileFiles.every(item => item.attachment === 'NOT_ESTABLISHED'));
  assert.equal(JSON.stringify(context).includes('PRIVATE_PROCESS'), false);
});

test('malformed or duplicated host fields and terminal controls cannot become observed values', () => {
  const fixture = hostFiles({
    [HOST_FILES.osRelease.path]: 'ID=ubuntu\nID=PRIVATE\n',
    [HOST_FILES.processStatus.path]: 'CapEff: PRIVATE\n',
    [HOST_FILES.processLabel.path]: 'PRIVATE\u001b[0m\n',
    [HOST_FILES.maxUserNamespaces.path]: '-1\n',
  });
  const context = observeHostContext({ fsImpl: fixture.impl, platform: 'linux', env: { ImageOS: 'PRIVATE\n', ImageVersion: 'X'.repeat(65) } });
  for (const key of ['osRelease', 'processStatus', 'processLabel', 'maxUserNamespaces']) assert.equal(context.fields[key].state, 'UNAVAILABLE');
  assert.equal(context.runnerImage.imageOs.state, 'UNAVAILABLE');
  assert.equal(context.runnerImage.imageVersion.state, 'UNAVAILABLE');
  assert.equal(JSON.stringify(context).includes('PRIVATE'), false);
});

test('fixed executable hashing uses one bounded held handle and rejects changing identity', () => {
  const data = Buffer.from('synthetic executable bytes');
  const fixture = hostFiles({ [HOST_FILES.bubblewrap.path]: data }, { chunk: 3 });
  const observed = observeBubblewrap(fixture.impl);
  assert.equal(observed.state, 'OBSERVED');
  assert.equal(observed.sha256, hash(data));
  assert.equal(observed.bytes, data.length);
  assert.equal(fixture.calls.opened.length, 1);
  assert.equal(fixture.calls.closed.length, 1);
  const changed = hostFiles({ [HOST_FILES.bubblewrap.path]: data }, { changeIdentity: true });
  assert.deepEqual(observeBubblewrap(changed.impl), { state: 'UNAVAILABLE', reason: 'FILE_CHANGED' });
  const notRegular = hostFiles({ [HOST_FILES.bubblewrap.path]: data }, { regular: false });
  assert.deepEqual(observeBubblewrap(notRegular.impl), { state: 'UNAVAILABLE', reason: 'NOT_REGULAR_FILE' });
  assert.equal(notRegular.calls.readBytes, 0);
});

test('host read failures close handles and redact unknown native error codes', () => {
  const fixture = hostFiles({ [HOST_FILES.processStatus.path]: 'CapEff: 0\n' },
    { readError: Object.assign(new Error('PRIVATE native read'), { code: 'PRIVATE_CODE' }) });
  assert.deepEqual(readHostFile('processStatus', fixture.impl), { state: 'UNAVAILABLE', reason: 'OTHER' });
  assert.equal(fixture.calls.closed.length, 1);
  assert.equal(fixture.calls.opened.length, 1);
});

test('source binding validates the manifest digest and redacts snapshot errors', () => {
  const source = sourceFixture();
  assert.equal(captureSource(() => source).state, 'OBSERVED');
  assert.deepEqual(captureSource(() => ({ ...source, sourceTreeSha256: '0'.repeat(64) })), { state: 'UNAVAILABLE', reason: 'INVALID_SOURCE_EVIDENCE' });
  assert.deepEqual(captureSource(() => { throw Object.assign(new Error('PRIVATE snapshot'), { code: 'PRIVATE_CODE' }); }), { state: 'UNAVAILABLE', reason: 'OTHER' });
});

test('changed or dirty source cannot receive native PASS evidence', () => {
  const changed = observationFixture(); changed.after = captureSource(() => sourceFixture('c'));
  const report = finishObservation(changed);
  assert.equal(report.status, 'FAIL');
  assert.equal(report.nativeStatus, 'PASS');
  assert.equal(report.source.stable, false);
  assert.ok(report.evidenceErrors.includes('SOURCE_CHANGED'));
  const dirty = observationFixture(); dirty.before.dirty = true;
  assert.ok(finishObservation(dirty).evidenceErrors.includes('SOURCE_DIRTY'));
});

test('host context cannot promote BLOCKED or FAIL and unavailable context cannot erase a native result', () => {
  for (const native of [
    { status: 'BLOCKED', cases: 0, nativeDenyBehavior: 'NOT TESTED', privilegedRetry: false },
    { status: 'FAIL', code: 'NATIVE_ASSERTION_FAILED' },
  ]) {
    const input = observationFixture(workerFixture(native));
    input.hostBefore = { state: 'OBSERVED', status: 'PASS', profiles: 'allowed' };
    input.hostAfter = { state: 'UNAVAILABLE', reason: 'EACCES' };
    const report = finishObservation(input);
    assert.equal(report.status, native.status);
    assert.equal(report.nativeStatus, native.status);
    assert.equal(report.releaseCredit, false);
    assert.equal(report.productPassing, 0);
  }
  const pass = observationFixture(); pass.hostBefore = pass.hostAfter = { state: 'UNAVAILABLE', reason: 'ENOENT' };
  assert.equal(finishObservation(pass).status, 'PASS');
});

test('native acceptance requires all six distinct cases and the matching child exit result', () => {
  const pass = nativePass();
  assert.equal(validNativeResult(pass, workerFixture(pass).execution), true);
  for (const results of [pass.results.slice(0, 5), [...pass.results.slice(0, 5), pass.results[0]], [null], null]) {
    assert.equal(validNativeResult({ ...pass, results }, workerFixture(pass).execution), false);
  }
  assert.equal(validNativeResult(pass, { ...workerFixture(pass).execution, exitCode: 2 }), false);
  assert.equal(validNativeResult({ ...pass, privilegedRetry: true }, workerFixture(pass).execution), false);
  assert.equal(validNativeResult({ status: 'FAIL', results: null }, { attempts: 1, exitCode: 1 }), false);
});

test('changed or unreadable dependency identity cannot receive native PASS evidence', () => {
  const changed = observationFixture(); changed.dependencyAfter.sha256 = 'c'.repeat(64);
  assert.ok(finishObservation(changed).evidenceErrors.includes('DEPENDENCY_CHANGED'));
  const missing = observationFixture(); missing.dependencyAfter = { state: 'UNAVAILABLE', reason: 'EACCES' };
  const result = finishObservation(missing);
  assert.equal(result.status, 'FAIL');
  assert.ok(result.evidenceErrors.includes('DEPENDENCY_IDENTITY_UNAVAILABLE'));
});

test('the host wrapper executes exactly one fixed verifier and excludes raw child stderr', async () => {
  const calls = [], child = nativeChild(), native = nativePass();
  const pending = executeNativeVerifier({ spawnProcess: (...args) => { calls.push(args); return child; } });
  child.stdout.end(JSON.stringify(native)); child.stderr.end('PRIVATE child stderr'); child.emit('close', 0, null);
  const result = await pending;
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], process.execPath);
  assert.deepEqual(calls[0][1], [path.resolve(__dirname, '../scripts/test-ocr-isolation.cjs')]);
  assert.equal(calls[0][2].shell, false);
  assert.deepEqual(calls[0][2].stdio, ['ignore', 'pipe', 'pipe']);
  assert.equal(validNativeResult(result.native, result.execution), true);
  assert.equal(result.execution.attempts, 1);
  assert.equal(JSON.stringify(result).includes('PRIVATE'), false);
  assert.deepEqual(child.killCalls, []);
});

test('verifier output limits retain bounded bytes and kill only the one owned child once', async () => {
  for (const stream of ['stdout', 'stderr']) {
    const child = nativeChild();
    const pending = executeNativeVerifier({ spawnProcess: () => child });
    const limit = stream === 'stdout' ? STDOUT_LIMIT : STDERR_LIMIT;
    child[stream].write(Buffer.alloc(limit + 10, 65));
    child[stream].write(Buffer.alloc(30, 65));
    const result = await pending;
    assert.equal(result.execution.outputLimitExceeded, true);
    assert.equal(result.execution[stream + 'BytesRetained'], limit);
    assert.equal(result.native, null);
    assert.deepEqual(child.killCalls, ['SIGKILL']);
    assert.equal(result.execution.attempts, 1);
  }
});

test('malformed output and launch errors fail without leaking diagnostics or retrying', async () => {
  let attempts = 0;
  const launch = await executeNativeVerifier({ spawnProcess: () => { attempts++; throw Object.assign(new Error('PRIVATE launch'), { code: 'PRIVATE_CODE' }); } });
  assert.equal(attempts, 1);
  assert.equal(launch.execution.spawnErrorCode, 'OTHER');
  assert.equal(JSON.stringify(launch).includes('PRIVATE'), false);
  const child = nativeChild(), pending = executeNativeVerifier({ spawnProcess: () => child });
  child.stdout.end('PRIVATE malformed JSON'); child.emit('close', 0, null);
  const result = await pending;
  assert.equal(result.execution.parseError, true);
  assert.equal(result.native, null);
  assert.equal(JSON.stringify(result).includes('PRIVATE'), false);
});

test('verifier deadline terminates its owned process once and never retries', async () => {
  const child = nativeChild(); let attempts = 0;
  const keepAlive = setTimeout(() => {}, 100);
  try {
    const result = await executeNativeVerifier({ spawnProcess: () => { attempts++; return child; }, timeoutMs: 5 });
    assert.equal(result.execution.timedOut, true);
    assert.equal(result.native, null);
    assert.equal(attempts, 1);
    assert.deepEqual(child.killCalls, ['SIGKILL']);
  } finally { clearTimeout(keepAlive); }
});

test('dirty preflight performs no native attempt and observer read errors remain redacted', async () => {
  let attempts = 0;
  const result = await runObservation({ buildOutcome: 'success', readSource: () => ({ ...sourceFixture(), dirty: true }),
    readContext: () => { throw Object.assign(new Error('PRIVATE context'), { code: 'EACCES' }); },
    readDependency: () => ({ state: 'UNAVAILABLE', reason: 'ENOENT' }), runWorker: () => { attempts++; return workerFixture(); } });
  assert.equal(attempts, 0);
  assert.equal(result.status, 'FAIL');
  assert.equal(result.execution.attempts, 0);
  assert.deepEqual(result.host.before, { state: 'UNAVAILABLE', reason: 'EACCES' });
  assert.equal(JSON.stringify(result).includes('PRIVATE'), false);
});

test('the wrapper brackets one native attempt with source dependency and context observations', async () => {
  const order = [], dependency = observationFixture().dependencyBefore;
  const report = await runObservation({
    buildOutcome: 'success', readSource: () => { order.push('source'); return sourceFixture(); },
    readContext: () => { order.push('context'); return { state: 'UNAVAILABLE', reason: 'EACCES' }; },
    readDependency: () => { order.push('dependency'); return dependency; },
    runWorker: async () => { order.push('native'); return workerFixture(); },
  });
  assert.deepEqual(order, ['source', 'context', 'dependency', 'native', 'source', 'context', 'dependency']);
  assert.equal(report.status, 'PASS');
  assert.equal(report.source.stable, true);
  assert.equal(report.dependency.stable, true);
  assert.equal(report.releaseCredit, false);
  assert.equal(report.productPassing, 0);
});


test('one LSM label terminator is supported while embedded or repeated NUL bytes stay invalid', () => {
  for (const [value, expected] of [['unconfined\0', 'OBSERVED'], ['uncon\0fined', 'UNAVAILABLE'], ['unconfined\0\0', 'UNAVAILABLE']]) {
    const fixture = hostFiles({ [HOST_FILES.processLabel.path]: value });
    const report = observeHostContext({ fsImpl: fixture.impl, platform: 'linux', env: {} });
    assert.equal(report.fields.processLabel.state, expected);
    if (expected === 'OBSERVED') assert.equal(report.fields.processLabel.value, 'unconfined');
  }
});

test('failed cancelled skipped or unknown dependency builds never execute an existing system binary', async () => {
  for (const buildOutcome of ['failure', 'cancelled', 'skipped', undefined, 'PRIVATE_OUTCOME']) {
    let attempts = 0;
    const dependency = observationFixture().dependencyBefore;
    const report = await runObservation({ buildOutcome, readSource: sourceFixture,
      readContext: () => ({ state: 'OBSERVED' }), readDependency: () => dependency,
      runWorker: () => { attempts++; return workerFixture(); } });
    assert.equal(attempts, 0);
    assert.equal(report.execution.attempts, 0);
    assert.equal(report.status, 'FAIL');
    assert.equal(report.nativeStatus, 'NOT_RUN');
    assert.equal(report.dependency.before.state, 'OBSERVED');
    assert.deepEqual(report.unexecutedCases, NATIVE_CASES.map(test => ({ test, status: 'NOT_RUN' })));
    assert.equal(report.native, null);
    assert.equal(report.productPassing, 0);
    assert.equal(report.releaseCredit, false);
    assert.equal(JSON.stringify(report).includes('PRIVATE_OUTCOME'), false);
  }
});

// Output boundary regressions use only owned temporary files and an injected
// observation callback. None starts the native verifier or changes host policy.
const outputFs = require('node:fs');
const outputOs = require('node:os');
const { prepareEvidenceOutput, runObservationToOutput } = require('../scripts/observe-ocr-isolation.cjs');
function outputFixture() {
  const directory = outputFs.mkdtempSync(path.join(outputOs.tmpdir(), 'panelreply-output-boundary-'));
  const root = path.join(directory, 'repository'), outside = path.join(directory, 'outside');
  outputFs.mkdirSync(root); outputFs.mkdirSync(outside);
  return { directory, root, outside, output: path.join(outside, 'observation.json'),
    cleanup: () => outputFs.rmSync(directory, { recursive: true, force: true }) };
}
function directoryAlias(target, filename) { outputFs.symlinkSync(target, filename, process.platform === 'win32' ? 'junction' : 'dir'); }
function injectedOutputFs(overrides) { return { ...outputFs, ...overrides }; }

test('output repository aliases are rejected before any source observation or verifier callback', async () => {
  const fixture = outputFixture(); let attempts = 0;
  try {
    const alias = path.join(fixture.outside, 'repository-alias'); directoryAlias(fixture.root, alias);
    await assert.rejects(runObservationToOutput(path.join(alias, 'observation.json'), { root: fixture.root, buildOutcome: 'success',
      observe: async () => { attempts++; return { status: 'PASS' }; } }), error => error.code === 'OUTPUT_OVERLAP' && error.outputState === 'NOT_CREATED');
    assert.equal(attempts, 0);
    assert.equal(outputFs.existsSync(path.join(fixture.root, 'observation.json')), false);
  } finally { fixture.cleanup(); }
});

test('raw alias followed by parent traversal resolves before lexical normalization', async () => {
  const fixture = outputFixture(); let attempts = 0;
  try {
    const nested = path.join(fixture.root, 'nested'); outputFs.mkdirSync(nested);
    const alias = path.join(fixture.outside, 'nested-alias'); directoryAlias(nested, alias);
    const output = alias + path.sep + '..' + path.sep + 'observation.json';
    const rawParent = path.dirname(output), resolved = outputFs.realpathSync.native(rawParent), reads = [];
    const realpathSync = Object.assign((...args) => outputFs.realpathSync(...args), {
      native: filename => { reads.push(filename); return outputFs.realpathSync.native(filename); },
    });
    const options = { root: fixture.root, buildOutcome: 'success', fsImpl: injectedOutputFs({ realpathSync }),
      observe: async () => { attempts++; return { status: 'PASS' }; } };
    // The native filesystem is the oracle. Windows may resolve junction/..
    // differently from POSIX. Both must receive the unnormalized spelling.
    if (resolved === outputFs.realpathSync.native(fixture.root)) {
      await assert.rejects(runObservationToOutput(output, options), error => error.code === 'OUTPUT_OVERLAP');
      assert.equal(attempts, 0);
      assert.equal(outputFs.existsSync(fixture.output), false);
    } else {
      assert.equal(resolved, outputFs.realpathSync.native(fixture.outside));
      await runObservationToOutput(output, options);
      assert.equal(attempts, 1);
      assert.deepEqual(JSON.parse(outputFs.readFileSync(fixture.output, 'utf8')), { status: 'PASS' });
    }
    assert.equal(reads[0], rawParent);
    assert.equal(outputFs.existsSync(path.join(fixture.root, 'observation.json')), false);
  } finally { fixture.cleanup(); }
});

test('missing or unresolvable output parents fail closed before observing the source', async () => {
  const fixture = outputFixture(); let attempts = 0;
  try {
    const observe = async () => { attempts++; return { status: 'PASS' }; };
    await assert.rejects(runObservationToOutput(path.join(fixture.outside, 'missing', 'observation.json'), { root: fixture.root, observe }),
      error => error.code === 'OUTPUT_PARENT_UNAVAILABLE' && error.outputState === 'NOT_CREATED');
    const realpathSync = Object.assign((...args) => outputFs.realpathSync(...args), {
      native: filename => { if (filename === fixture.outside) throw Object.assign(new Error('PRIVATE resolution error'), { code: 'ELOOP' }); return outputFs.realpathSync.native(filename); },
    });
    await assert.rejects(runObservationToOutput(fixture.output, { root: fixture.root, observe, fsImpl: injectedOutputFs({ realpathSync }) }),
      error => error.code === 'OUTPUT_PARENT_UNAVAILABLE' && error.outputState === 'NOT_CREATED');
    assert.equal(attempts, 0);
    assert.equal(outputFs.existsSync(fixture.output), false);
  } finally { fixture.cleanup(); }
});

test('existing files and dangling output leaves remain untouched and never start observation', async () => {
  const fixture = outputFixture(); let attempts = 0;
  try {
    outputFs.writeFileSync(fixture.output, 'existing owner bytes');
    const observe = async () => { attempts++; return { status: 'PASS' }; };
    await assert.rejects(runObservationToOutput(fixture.output, { root: fixture.root, observe }), error => error.code === 'OUTPUT_ALREADY_EXISTS');
    assert.equal(outputFs.readFileSync(fixture.output, 'utf8'), 'existing owner bytes');
    const dangling = path.join(fixture.outside, 'dangling.json');
    outputFs.symlinkSync(path.join(fixture.directory, 'missing-target'), dangling, process.platform === 'win32' ? 'junction' : 'file');
    assert.equal(outputFs.existsSync(dangling), false);
    await assert.rejects(runObservationToOutput(dangling, { root: fixture.root, observe }), error => error.code === 'OUTPUT_ALREADY_EXISTS');
    assert.equal(outputFs.lstatSync(dangling).isSymbolicLink(), true);
    assert.equal(attempts, 0);
  } finally { fixture.cleanup(); }
});

test('ordinary outside output uses an exclusive held descriptor and closes before returning evidence', async () => {
  const fixture = outputFixture(), order = [];
  try {
    const io = injectedOutputFs({
      openSync: (...args) => { order.push('open'); assert.ok(args[1] & outputFs.constants.O_EXCL); return outputFs.openSync(...args); },
      writeFileSync: (fd, ...args) => { assert.equal(typeof fd, 'number'); order.push('write'); return outputFs.writeFileSync(fd, ...args); },
      fsyncSync: fd => { order.push('sync'); return outputFs.fsyncSync(fd); },
      closeSync: fd => { order.push('close'); return outputFs.closeSync(fd); },
    });
    const report = { status: 'BLOCKED', productPassing: 0, releaseCredit: false };
    const result = await runObservationToOutput(fixture.output, { root: fixture.root, fsImpl: io, buildOutcome: 'failure', observe: async () => {
      order.push('observe'); assert.equal(outputFs.statSync(fixture.output).size, 0); return report;
    } });
    assert.deepEqual(order, ['open', 'observe', 'write', 'sync', 'close']);
    assert.deepEqual(result.report, report);
    assert.deepEqual(JSON.parse(outputFs.readFileSync(fixture.output, 'utf8')), report);
    assert.deepEqual(outputFs.readdirSync(fixture.root), []);
  } finally { fixture.cleanup(); }
});

test('parent replacement after exclusive creation closes the placeholder before any observation', async () => {
  const fixture = outputFixture(); let attempts = 0, closes = 0;
  const parked = path.join(fixture.directory, 'parked-outside');
  try {
    const io = injectedOutputFs({ openSync: (...args) => {
      const fd = outputFs.openSync(...args);
      outputFs.renameSync(fixture.outside, parked); directoryAlias(fixture.root, fixture.outside);
      return fd;
    }, closeSync: fd => { closes++; outputFs.closeSync(fd); } });
    await assert.rejects(runObservationToOutput(fixture.output, { root: fixture.root, fsImpl: io, observe: async () => { attempts++; return { status: 'PASS' }; } }),
      error => error.code === 'OUTPUT_OVERLAP' && error.outputState === 'CREATED_RETAINED' && error.outputDescriptorClosed === true);
    assert.equal(attempts, 0); assert.equal(closes, 1);
    assert.equal(outputFs.statSync(path.join(parked, 'observation.json')).size, 0);
    assert.equal(outputFs.existsSync(path.join(fixture.root, 'observation.json')), false);
  } finally { fixture.cleanup(); }
});

test('leaf replacement cannot redirect a report write or trigger deletion of replacement data', async () => {
  const fixture = outputFixture(); let closes = 0;
  const parked = path.join(fixture.outside, 'owned-placeholder.json');
  try {
    const io = injectedOutputFs({ closeSync: fd => { closes++; outputFs.closeSync(fd); } });
    await assert.rejects(runObservationToOutput(fixture.output, { root: fixture.root, fsImpl: io, observe: async () => {
      outputFs.renameSync(fixture.output, parked); outputFs.writeFileSync(fixture.output, 'replacement bytes'); return { status: 'PASS' };
    } }), error => error.code === 'OUTPUT_IDENTITY_CHANGED' && error.outputWriteStarted === false && error.outputDescriptorClosed === true);
    assert.equal(closes, 1);
    assert.equal(outputFs.readFileSync(fixture.output, 'utf8'), 'replacement bytes');
    assert.equal(outputFs.statSync(parked).size, 0);
  } finally { fixture.cleanup(); }
});

test('a replacement outside parent with the same spelling cannot receive the held report', async () => {
  const fixture = outputFixture(); const parked = path.join(fixture.directory, 'parked-parent');
  try {
    await assert.rejects(runObservationToOutput(fixture.output, { root: fixture.root, observe: async () => {
      outputFs.renameSync(fixture.outside, parked); outputFs.mkdirSync(fixture.outside); return { status: 'PASS' };
    } }), error => error.code === 'OUTPUT_IDENTITY_CHANGED' && error.outputDescriptorClosed === true);
    assert.equal(outputFs.statSync(path.join(parked, 'observation.json')).size, 0);
    assert.equal(outputFs.existsSync(fixture.output), false);
  } finally { fixture.cleanup(); }
});

test('an observation error remains primary when descriptor cleanup also reports an error', async () => {
  const fixture = outputFixture(); let closes = 0;
  const primary = Object.assign(new Error('PRIVATE observation error'), { code: 'EACCES' });
  try {
    const io = injectedOutputFs({ closeSync: fd => { closes++; outputFs.closeSync(fd); throw Object.assign(new Error('PRIVATE close error'), { code: 'EIO' }); } });
    await assert.rejects(runObservationToOutput(fixture.output, { root: fixture.root, fsImpl: io, observe: async () => { throw primary; } }),
      error => error.code === 'EACCES' && error.cause === primary && error.outputCloseErrorCode === 'EIO'
        && error.outputState === 'CREATED_RETAINED' && error.outputDescriptorClosed === false);
    assert.equal(closes, 1);
    assert.equal(outputFs.statSync(fixture.output).size, 0);
  } finally { fixture.cleanup(); }
});

test('write and close failures cannot return completed evidence and never delete the output', async () => {
  const fixture = outputFixture();
  try {
    let closes = 0;
    const writeIo = injectedOutputFs({ writeFileSync: () => { throw Object.assign(new Error('PRIVATE write error'), { code: 'EIO' }); },
      closeSync: fd => { closes++; outputFs.closeSync(fd); } });
    await assert.rejects(runObservationToOutput(fixture.output, { root: fixture.root, fsImpl: writeIo, observe: async () => ({ status: 'PASS' }) }),
      error => error.code === 'OUTPUT_WRITE_FAILED' && error.outputWriteStarted && !error.outputWriteVerified && error.outputDescriptorClosed);
    assert.equal(closes, 1); assert.equal(outputFs.statSync(fixture.output).size, 0);
    const second = path.join(fixture.outside, 'close-failed.json');
    const closeIo = injectedOutputFs({ closeSync: fd => { closes++; outputFs.closeSync(fd); throw Object.assign(new Error('PRIVATE close error'), { code: 'EIO' }); } });
    await assert.rejects(runObservationToOutput(second, { root: fixture.root, fsImpl: closeIo, observe: async () => ({ status: 'PASS' }) }),
      error => error.code === 'OUTPUT_CLOSE_FAILED' && error.outputWriteVerified && !error.outputDescriptorClosed);
    assert.equal(closes, 2); assert.ok(outputFs.statSync(second).size > 0);
  } finally { fixture.cleanup(); }
});

test('relative release-prefixed and repository-ancestor output destinations are rejected', async () => {
  const fixture = outputFixture(); let attempts = 0;
  try {
    const observe = async () => { attempts++; return { status: 'PASS' }; };
    for (const output of ['observation.json', path.join(fixture.outside, 'release-observation.json')]) {
      await assert.rejects(runObservationToOutput(output, { root: fixture.root, observe }), error => error.code === 'OUTPUT_PATH_INVALID');
    }
    await assert.rejects(runObservationToOutput(path.join(fixture.directory, 'ancestor.json'), { root: fixture.root, observe }), error => error.code === 'OUTPUT_OVERLAP');
    assert.equal(attempts, 0);
    assert.deepEqual(outputFs.readdirSync(fixture.outside), []);
  } finally { fixture.cleanup(); }
});
