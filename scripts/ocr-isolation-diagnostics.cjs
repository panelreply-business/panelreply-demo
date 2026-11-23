'use strict';

// Test-runner observer only. It does not start an extra probe, alter commands,
// retry, or expose production stderr. Readiness uses no image/customer input.
const { spawn } = require('node:child_process');
const MAX_STDERR_BYTES = 4096;
const MAX_RECORDS = 4;
const ERROR_CODES = new Set(['ENOENT', 'EACCES', 'EAGAIN', 'ENOEXEC', 'EMFILE', 'ENFILE']);

function fixedStage(args) {
  if (args.at(-2) === '/usr/bin/bwrap' && args.at(-1) === '--version') return 'isolation_version';
  if (args.at(-1) === '--version') return 'engine_version';
  if (args.at(-1) === '--list-langs') return 'engine_languages';
  if (args.at(-1) === '--probe' && args.includes('/usr/bin/python3')) return 'normalizer_probe';
  return 'unexpected_readiness_stage';
}

function classify(records, reason) {
  if (['isolation_dependency_unsupported', 'isolation_dependency_unavailable', 'isolation_path_overlap', 'isolation_path_context_unavailable'].includes(reason)) return { kind: reason, confirmedExternalBlocker: false, status: 'FAIL' };
  const failed = records.find(row => row.spawnErrorCode || row.signal || row.exitCode !== 0);
  if (!failed) return { kind: 'readiness_contract_unconfirmed', confirmedExternalBlocker: false, status: 'BLOCKED' };
  const stderr = failed.stderr;
  if (/bwrap: (?:Creating new namespace failed: Operation not permitted|No permissions? to create (?:a )?new namespace|loopback: Failed to create NETLINK_ROUTE socket: Operation not permitted)/i.test(stderr)) {
    return { kind: 'host_namespace_denied', confirmedExternalBlocker: true, status: 'BLOCKED' };
  }
  if (['ENOENT', 'EACCES', 'ENOEXEC'].includes(failed.spawnErrorCode)) return { kind: 'launch_prerequisite_error', confirmedExternalBlocker: false, status: 'FAIL' };
  if (/bwrap:.*(?:Unknown option|Invalid option|Invalid argument|seccomp.*(?:invalid|failed)|execvp.*(?:No such file|Permission denied))|error while loading shared libraries/i.test(stderr)) {
    return { kind: 'worker_configuration_error', confirmedExternalBlocker: false, status: 'FAIL' };
  }
  if (failed.signal === 'SIGSYS') return { kind: 'native_syscall_policy_failure', confirmedExternalBlocker: false, status: 'FAIL' };
  return { kind: reason === 'normalizer_unavailable' ? 'normalizer_failure_unconfirmed' : 'worker_startup_cause_unconfirmed', confirmedExternalBlocker: false, status: 'BLOCKED' };
}

function createReadinessDiagnostics({ spawnProcess = spawn } = {}) {
  const records = [];
  let observedInvocations = 0;
  const safeErrorCode = error => ERROR_CODES.has(error?.code) ? error.code : 'OTHER';
  function observe(binary, args, options) {
    observedInvocations += 1;
    const stage = fixedStage(args);
    const record = { stage, exitCode: null, signal: null, spawnErrorCode: null, closed: false, stderrBytesObserved: 0, chunks: [], retainedBytes: 0 };
    if (records.length < MAX_RECORDS) records.push(record);
    let child;
    try { child = spawnProcess(binary, args, options); }
    catch (error) { record.spawnErrorCode = safeErrorCode(error); throw error; }
    child.stderr.on('data', data => {
      const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data);
      record.stderrBytesObserved += bytes.length;
      if (stage === 'unexpected_readiness_stage') return;
      const remaining = MAX_STDERR_BYTES - record.retainedBytes;
      if (remaining <= 0) return;
      const retained = Buffer.from(bytes.subarray(0, remaining));
      record.chunks.push(retained);
      record.retainedBytes += retained.length;
    });
    child.on('error', error => { record.spawnErrorCode = safeErrorCode(error); });
    child.once('close', (code, signal) => {
      record.closed = true;
      record.exitCode = Number.isInteger(code) ? code : null;
      record.signal = typeof signal === 'string' && /^SIG[A-Z0-9]+$/.test(signal) ? signal : null;
    });
    return child;
  }
  function snapshot(reason) {
    const safeRecords = records.map(({ chunks, retainedBytes, ...record }) => ({ ...record,
      stderr: Buffer.concat(chunks).toString('utf8').replace(/[^\x09\x0A\x0D\x20-\x7E]/g, '?'),
      stderrBytesRetained: retainedBytes, stderrTruncated: record.stderrBytesObserved > retainedBytes }));
    return { observedInvocations, maxRecords: MAX_RECORDS, stderrLimitPerStageBytes: MAX_STDERR_BYTES,
      records: safeRecords, classification: classify(safeRecords, reason),
      scope: 'Bounded stderr and exit metadata observed from the same required-mode readiness invocation. No extra command, customer input, environment dump, privileged retry or policy change.' };
  }
  return { spawnProcess: observe, snapshot };
}

module.exports = { createReadinessDiagnostics, classify, fixedStage, MAX_STDERR_BYTES };
