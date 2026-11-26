'use strict';

// Component evidence files only. The outside parent is trusted. These checks
// are not native ACL acceptance or an atomic hostile-parent/reparse boundary.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const ROOT = path.resolve(__dirname, '..');
const LIMITS = Object.freeze({ report: 4 * 1024 * 1024, log: 4 * 1024 * 1024, journal: 16 * 1024 * 1024 });
const SAFE_CODES = new Set(['ENOENT', 'EEXIST', 'EACCES', 'EPERM', 'ELOOP', 'EIO', 'EMFILE', 'ENFILE', 'EINVAL', 'ENOSPC']);
const safeCode = error => /^OUTPUT_[A-Z_]{1,64}$/.test(error?.code || '') ? error.code : SAFE_CODES.has(error?.code) ? error.code : 'OTHER';
const identity = stat => String(stat.dev) + ':' + String(stat.ino);
const stamp = stat => [String(stat.mtimeNs), String(stat.ctimeNs)].join(':');
const contains = (parent, child) => {
  const relative = path.relative(parent, child);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep));
};
function failure(code, cause) {
  const error = new Error(code, cause ? { cause } : undefined); error.code = code; return error;
}

function outputLocation(output, { root = ROOT, fsImpl = fs } = {}) {
  if (typeof output !== 'string' || !output.isWellFormed() || /[\x00-\x1f\x7f]/.test(output)
      || !path.isAbsolute(output) || !output.endsWith('.json')) throw failure('OUTPUT_PATH_INVALID');
  const name = path.basename(output);
  if (/^release-/i.test(name) || /[:\\/]/.test(name)
      || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) throw failure('OUTPUT_PATH_INVALID');
  const rawParent = path.dirname(output);
  let canonicalParent, canonicalRoot, parentStat, rootStat;
  try {
    // Keep raw alias/.. filesystem semantics before constructing canonical names.
    canonicalParent = fsImpl.realpathSync.native(rawParent);
    canonicalRoot = fsImpl.realpathSync.native(root);
    parentStat = fsImpl.lstatSync(canonicalParent, { bigint: true });
    rootStat = fsImpl.lstatSync(canonicalRoot, { bigint: true });
  } catch (error) { throw failure('OUTPUT_PARENT_UNAVAILABLE', error); }
  if (!parentStat.isDirectory() || !rootStat.isDirectory()) throw failure('OUTPUT_PARENT_UNAVAILABLE');
  if (contains(canonicalRoot, canonicalParent) || contains(canonicalParent, canonicalRoot)) throw failure('OUTPUT_OVERLAP');
  const report = path.join(canonicalParent, name);
  return { raw: output, rawParent, root, canonicalParent, canonicalRoot,
    parentIdentity: identity(parentStat), rootIdentity: identity(rootStat),
    report, log: report.replace(/\.json$/, '.log'), journal: report.replace(/\.json$/, '.observations.jsonl') };
}

function prepareOutputs(output, { root = ROOT, fsImpl = fs } = {}) {
  const location = outputLocation(output, { root, fsImpl });
  const entries = Object.fromEntries(Object.keys(LIMITS).map(name => [name, {
    path: location[name], fd: null, created: false, bytes: 0, written: 0,
    writeStarted: false, writeVerified: false, closed: false, closeError: null, failed: false,
    hash: crypto.createHash('sha256'),
  }]));
  const state = () => Object.fromEntries(Object.entries(entries).map(([name, item]) => [name, {
    state: item.created ? 'CREATED_RETAINED' : 'NOT_CREATED', bytesVerified: item.bytes, bytesWritten: item.written,
    byteLimit: LIMITS[name], sha256OfVerifiedBytes: item.hash.copy().digest('hex'),
    writeStarted: item.writeStarted, writeVerified: item.writeVerified, failed: item.failed,
    descriptorClosed: item.closed, ...(item.closeError ? { closeErrorCode: item.closeError } : {}),
  }]));
  function annotate(error) {
    const result = new Error(String(error?.message || error).slice(0, 4000), { cause: error });
    result.code = safeCode(error); result.outputState = state();
    if (error.componentOutcome) result.componentOutcome = error.componentOutcome;
    return result;
  }
  function close() {
    let primary = null;
    for (const item of Object.values(entries)) {
      if (item.fd !== null) {
        const held = item.fd; item.fd = null;
        try { fsImpl.closeSync(held); item.closed = true; }
        catch (error) { item.closeError = safeCode(error); }
      }
      if (item.closeError) primary ||= failure('OUTPUT_CLOSE_FAILED');
    }
    if (primary) throw primary;
  }
  function verifyParent() {
    const now = outputLocation(output, { root, fsImpl });
    if (now.canonicalParent !== location.canonicalParent || now.canonicalRoot !== location.canonicalRoot
        || now.parentIdentity !== location.parentIdentity || now.rootIdentity !== location.rootIdentity) throw failure('OUTPUT_IDENTITY_CHANGED');
  }
  function validStat(item, stat, bytes, expectedStamp) {
    return stat.isFile() && String(stat.nlink) === '1' && identity(stat) === identity(item.initial)
      && String(stat.mode) === String(item.initial.mode) && String(stat.size) === String(bytes)
      && (!expectedStamp || stamp(stat) === expectedStamp);
  }
  function verify(item, bytes = item.bytes, checkStamp = true) {
    verifyParent();
    if (item.fd === null) throw failure('OUTPUT_DESCRIPTOR_CLOSED');
    let held, named;
    try { held = fsImpl.fstatSync(item.fd, { bigint: true }); named = fsImpl.lstatSync(item.path, { bigint: true }); }
    catch (error) { throw failure('OUTPUT_IDENTITY_CHANGED', error); }
    if (!validStat(item, held, bytes, checkStamp ? item.stamp : null)
        || !validStat(item, named, bytes, checkStamp ? item.stamp : null)) throw failure('OUTPUT_IDENTITY_CHANGED');
    return held;
  }
  function readHash(item, start, length) {
    const hash = crypto.createHash('sha256'), buffer = Buffer.alloc(Math.min(65536, Math.max(1, length)));
    let used = 0;
    while (used < length) {
      const request = Math.min(buffer.length, length - used);
      const read = fsImpl.readSync(item.fd, buffer, 0, request, start + used);
      if (!Number.isInteger(read) || read < 1 || read > request) throw failure('OUTPUT_READBACK_FAILED');
      hash.update(buffer.subarray(0, read)); used += read;
    }
    return hash.digest('hex');
  }
  try {
    // Refuse every existing leaf before creating any output. Never truncate,
    // repair, unlink or reopen a report, log or journal pathname for writing.
    for (const item of Object.values(entries)) {
      try { fsImpl.lstatSync(item.path, { bigint: true }); throw failure('OUTPUT_ALREADY_EXISTS'); }
      catch (error) { if (error.code !== 'ENOENT') throw error.code === 'OUTPUT_ALREADY_EXISTS' ? error : failure('OUTPUT_OPEN_FAILED', error); }
    }
    for (const [name, item] of Object.entries(entries)) {
      verifyParent();
      try {
        item.fd = fsImpl.openSync(item.path, fs.constants.O_RDWR | fs.constants.O_CREAT | fs.constants.O_EXCL
          | (fs.constants.O_NOFOLLOW || 0) | (name === 'report' ? 0 : fs.constants.O_APPEND), 0o600);
        item.created = true; item.initial = fsImpl.fstatSync(item.fd, { bigint: true }); item.stamp = stamp(item.initial);
      } catch (error) { throw failure('OUTPUT_OPEN_FAILED', error); }
      verify(item);
    }
    for (const item of Object.values(entries)) verify(item);
  } catch (error) {
    try { close(); } catch { /* Keep the primary error and every close outcome. */ }
    throw annotate(error);
  }
  function write(name, text, append) {
    const item = entries[name];
    try {
      if (item.fd === null || item.failed || !append && item.writeStarted) throw failure('OUTPUT_NOT_WRITABLE');
      const buffer = Buffer.from(text, 'utf8');
      if (buffer.length > LIMITS[name] - item.bytes) throw failure('OUTPUT_' + name.toUpperCase() + '_LIMIT');
      verify(item); item.writeStarted = true; item.writeVerified = false;
      let used = 0;
      while (used < buffer.length) {
        const count = fsImpl.writeSync(item.fd, buffer, used, buffer.length - used, null);
        if (!Number.isInteger(count) || count < 1 || count > buffer.length - used) throw failure('OUTPUT_WRITE_FAILED');
        used += count; item.written += count;
      }
      fsImpl.fsyncSync(item.fd);
      const after = verify(item, item.bytes + buffer.length, false);
      if (readHash(item, item.bytes, buffer.length) !== crypto.createHash('sha256').update(buffer).digest('hex')) throw failure('OUTPUT_READBACK_FAILED');
      const confirmed = verify(item, item.bytes + buffer.length, false);
      if (stamp(after) !== stamp(confirmed)) throw failure('OUTPUT_IDENTITY_CHANGED');
      item.bytes += buffer.length; item.stamp = stamp(confirmed); item.hash.update(buffer); item.writeVerified = true;
    } catch (error) {
      item.failed = true;
      throw /^OUTPUT_/.test(error.code || '') ? error : failure('OUTPUT_WRITE_FAILED', error);
    }
  }
  function evidence() {
    for (const item of Object.values(entries)) {
      try { verify(item); }
      catch { item.failed = true; }
    }
    return state();
  }
  function finish() {
    let primary = null;
    for (const item of Object.values(entries)) {
      try {
        const before = verify(item);
        if (item.failed || readHash(item, 0, item.bytes) !== item.hash.copy().digest('hex')) throw failure('OUTPUT_NOT_VERIFIED');
        const after = verify(item);
        if (stamp(before) !== stamp(after)) throw failure('OUTPUT_IDENTITY_CHANGED');
      } catch (error) { item.failed = true; primary ||= error; }
    }
    try { close(); } catch (error) { primary ||= error; }
    try {
      verifyParent();
      for (const item of Object.values(entries)) {
        // Windows can publish the final write timestamp only when its writing
        // handle closes. Identity, type, links, mode and size must still match.
        if (!item.closed || !validStat(item, fsImpl.lstatSync(item.path, { bigint: true }), item.bytes, null)) throw failure('OUTPUT_IDENTITY_CHANGED');
      }
    } catch (error) { primary ||= error; }
    if (primary) throw primary;
  }
  return { reportPath: location.report, logPath: location.log, journalPath: location.journal,
    appendLog(text) { write('log', String(text), true); },
    appendJournal(text) { write('journal', text, true); },
    writeReport(report) { write('report', JSON.stringify(report, null, 2) + '\n', false); },
    state, evidence, finish, close, annotate };
}

module.exports = { LIMITS, outputLocation, prepareOutputs };
