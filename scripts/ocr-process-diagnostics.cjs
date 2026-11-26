'use strict';

// Test-observer metadata only. Never wait, retry, send a terminating signal,
// inspect unrelated PIDs, or turn a missing proc observation into a dead PID.
const fs = require('node:fs');
const { performance } = require('node:perf_hooks');
const LIMITS = Object.freeze({ statBytes: 8192, readCalls: 4, roles: 2, probesPerRole: 1, lifecycleEvents: 3 });
const MAX_PID = 0x7fffffff;
const ROLES = Object.freeze(['wrapper', 'native']);
const EVENTS = Object.freeze(['spawn', 'exit', 'close']);
const SAFE_ERRORS = new Set(['ENOENT', 'ESRCH', 'EACCES', 'EPERM', 'EIO', 'EINVAL', 'ELOOP', 'EMFILE', 'ENFILE']);
const SAFE_SIGNALS = new Set(['SIGHUP', 'SIGINT', 'SIGQUIT', 'SIGILL', 'SIGABRT', 'SIGFPE', 'SIGKILL', 'SIGSEGV', 'SIGPIPE', 'SIGTERM', 'SIGBUS', 'SIGSYS', 'SIGXCPU', 'SIGXFSZ']);
const validPid = pid => Number.isInteger(pid) && pid > 0 && pid <= MAX_PID;
const safeError = error => SAFE_ERRORS.has(error?.code) ? error.code : 'OTHER';
const identity = stat => [String(stat.dev), String(stat.ino)].join(':');
function malformed() { return Object.assign(new Error('PROC_STAT_MALFORMED'), { code: 'PROC_STAT_MALFORMED' }); }

function parseProcessStat(text, expectedPid) {
  if (typeof text !== 'string' || !validPid(expectedPid) || Buffer.byteLength(text) > LIMITS.statBytes) throw malformed();
  const prefix = /^(\d{1,10}) \(/.exec(text), end = text.lastIndexOf(') ');
  if (!prefix || Number(prefix[1]) !== expectedPid || end < prefix[0].length) throw malformed();
  // comm may contain whitespace and parentheses. It is never retained.
  const fields = text.slice(end + 2).trim().split(/\s+/);
  if (fields.length < 20 || fields.length > 64 || !/^[RSDZTtWXxKPI]$/.test(fields[0])
      || fields.slice(1).some(value => !/^-?\d{1,20}$/.test(value))) throw malformed();
  const ids = fields.slice(1, 4).map(value => /^\d{1,10}$/.test(value) ? Number(value) : NaN);
  if (ids.some(value => !Number.isInteger(value) || value < 0 || value > MAX_PID)
      || !/^\d{1,20}$/.test(fields[19]) || BigInt(fields[19]) > 0xffffffffffffffffn) throw malformed();
  return { pid: expectedPid, processState: fields[0], parentPid: ids[0], processGroup: ids[1], session: ids[2], startTimeTicks: fields[19] };
}

function readProcessStat(pid, { fsImpl = fs, platform = process.platform } = {}) {
  if (!validPid(pid)) return { state: 'UNAVAILABLE', reason: 'INVALID_PID', openAttempts: 0 };
  if (platform !== 'linux') return { state: 'UNAVAILABLE', reason: 'UNSUPPORTED_PLATFORM', openAttempts: 0 };
  let fd = null, result, readCalls = 0, observedBytes = 0, descriptorClosed = false, closeError = null;
  try {
    fd = fsImpl.openSync(`/proc/${pid}/stat`, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0));
    const before = fsImpl.fstatSync(fd, { bigint: true });
    if (!before.isFile() || !/^\d+:\d+$/.test(identity(before))) throw Object.assign(new Error('PROC_TYPE'), { code: 'PROC_TYPE' });
    const bytes = Buffer.alloc(LIMITS.statBytes + 1);
    let ended = false;
    while (readCalls < LIMITS.readCalls && observedBytes < bytes.length) {
      const request = bytes.length - observedBytes;
      readCalls++;
      const count = fsImpl.readSync(fd, bytes, observedBytes, request, null);
      if (!Number.isInteger(count) || count < 0 || count > request) throw Object.assign(new Error('PROC_READ'), { code: 'PROC_READ' });
      observedBytes += count;
      if (count === 0) { ended = true; break; }
    }
    if (observedBytes > LIMITS.statBytes) result = { state: 'UNAVAILABLE', reason: 'BYTE_LIMIT' };
    else if (!ended) result = { state: 'UNAVAILABLE', reason: 'READ_CALL_LIMIT' };
    else {
      const after = fsImpl.fstatSync(fd, { bigint: true });
      if (!after.isFile() || identity(before) !== identity(after)) result = { state: 'UNAVAILABLE', reason: 'IDENTITY_CHANGED' };
      else {
        let text;
        try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, observedBytes)); }
        catch { throw malformed(); }
        result = { state: 'OBSERVED', ...parseProcessStat(text, pid), procIdentity: identity(after) };
      }
    }
  } catch (error) {
    result = { state: 'UNAVAILABLE', reason: ['PROC_STAT_MALFORMED', 'PROC_TYPE', 'PROC_READ'].includes(error?.code) ? error.code : safeError(error) };
  } finally {
    if (fd !== null) {
      try { fsImpl.closeSync(fd); descriptorClosed = true; }
      catch (error) { closeError = safeError(error); }
    }
  }
  if (closeError) {
    if (result.state === 'OBSERVED') result = { state: 'UNAVAILABLE', reason: 'CLOSE_FAILED' };
    result.closeError = closeError;
  }
  return { ...result, openAttempts: 1, readCalls, observedBytes, closeAttempts: fd === null ? 0 : 1, descriptorClosed };
}

function createProcessDiagnostics({ fsImpl = fs, platform = process.platform, now = () => performance.now() } = {}) {
  let start;
  try { start = now(); } catch { start = null; }
  const records = new Map(), lifecycle = new Map();
  const issues = new Set();
  const elapsed = () => {
    try {
      const value = now() - start;
      if (!Number.isFinite(start) || !Number.isFinite(value) || value < 0 || value > 300000) { issues.add('CLOCK_UNAVAILABLE'); return null; }
      return Math.round(value * 1000) / 1000;
    } catch { issues.add('CLOCK_UNAVAILABLE'); return null; }
  };
  const read = pid => readProcessStat(pid, { fsImpl, platform });
  return {
    register(role, pid) {
      try {
        if (!ROLES.includes(role) || !validPid(pid)) { issues.add('INVALID_ROLE_OR_PID'); return; }
        if (records.has(role)) { if (records.get(role).pid !== pid) issues.add('ROLE_PID_CHANGED'); return; }
        records.set(role, { role, pid, registeredAtMs: elapsed(), initial: read(pid), probes: [] });
      } catch { issues.add('OBSERVER_ERROR'); }
    },
    event(event, code = null, signal = null) {
      try {
        if (!EVENTS.includes(event) || lifecycle.has(event)) { issues.add('INVALID_OR_REPEATED_EVENT'); return; }
        lifecycle.set(event, { event, atMs: elapsed(), exitCode: Number.isInteger(code) && code >= 0 && code <= 255 ? code : null,
          signal: signal === null ? null : SAFE_SIGNALS.has(signal) ? signal : 'OTHER' });
      } catch { issues.add('OBSERVER_ERROR'); }
    },
    recordProbe(pid, outcome) {
      try {
        const matches = [...records.values()].filter(record => record.pid === pid);
        if (matches.length !== 1) { issues.add('UNREGISTERED_OR_AMBIGUOUS_PID'); return; }
        const record = matches[0];
        if (record.probes.length >= LIMITS.probesPerRole) { issues.add('PROBE_LIMIT'); return; }
        if (!['PRESENT', 'ABSENT', 'ERROR'].includes(outcome?.state)) { issues.add('INVALID_PROBE'); return; }
        const atMs = elapsed(), current = read(pid);
        const comparable = record.initial.state === 'OBSERVED' && current.state === 'OBSERVED';
        record.probes.push({ atMs, signal: 0, result: outcome.state,
          ...(outcome.state === 'ERROR' ? { errorCode: safeError(outcome) } : {}), current,
          identityComparison: !comparable ? 'UNAVAILABLE' : record.initial.startTimeTicks === current.startTimeTicks
            && record.initial.procIdentity === current.procIdentity ? 'SAME_OBSERVED_FIELDS' : 'DIFFERENT_OBSERVED_FIELDS' });
      } catch { issues.add('OBSERVER_ERROR'); }
    },
    snapshot() {
      return { format: 'panelreply-ocr-process-diagnostics-v1', records: structuredClone([...records.values()]),
        lifecycle: structuredClone([...lifecycle.values()]), issues: [...issues].sort(), limits: LIMITS,
        probesAddedByObserver: 0, waitsAddedByObserver: 0, retriesAddedByObserver: 0,
        scope: 'Bounded test-process metadata. Only the existing signal-0 probe decides the existing assertion. Missing proc data, zombie state or a changed observed identity never converts PRESENT or an error into ABSENT. Proc reads and timestamps can affect scheduling. Observed fields are not a pidfd or proof against every PID reuse race. No command name, arguments, environment or unrelated process data is retained.' };
    },
  };
}

function probeAlive(pid, observer, { killProcess = (target, signal) => process.kill(target, signal) } = {}) {
  // Keep the original one-probe behavior: only ESRCH returns false. Observation
  // failure cannot replace the original result or original permission error.
  if (!pid) return false;
  const record = outcome => { try { observer?.recordProbe(pid, outcome); } catch { /* Metadata never controls the native assertion. */ } };
  try { killProcess(pid, 0); }
  catch (error) {
    if (error.code === 'ESRCH') { record({ state: 'ABSENT' }); return false; }
    record({ state: 'ERROR', code: error.code });
    throw error;
  }
  record({ state: 'PRESENT' });
  return true;
}

module.exports = { LIMITS, parseProcessStat, readProcessStat, createProcessDiagnostics, probeAlive };
