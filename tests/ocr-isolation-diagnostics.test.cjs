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
  for (const stderr of ['Operation not permitted', '', 'bwrap: Could not set up seccomp: Permission denied']) {
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
