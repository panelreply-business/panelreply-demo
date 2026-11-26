'use strict';

// Observation artifacts only. This is not the native storage adapter and does
// not prove Windows ACL, reparse-race or hostile-parent security properties.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const ROOT = path.resolve(__dirname, '..');
const JOURNAL_LIMIT = 16 * 1024 * 1024;
const SAFE_CODES = new Set(['ENOENT', 'EEXIST', 'EACCES', 'EPERM', 'ELOOP', 'EIO', 'EMFILE', 'ENFILE', 'EINVAL', 'ENOSPC']);
const safeCode = error => SAFE_CODES.has(error?.code) ? error.code : 'OTHER';
const identity = stat => [String(stat.dev), String(stat.ino)].join(':');
const contains = (parent, child) => {
  const relative = path.relative(parent, child);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep));
};
function failure(code, cause) {
  const error = new Error(code); error.code = code;
  if (cause) error.cause = cause;
  return error;
}

function outputLocation(output, { root = ROOT, fsImpl = fs } = {}) {
  if (typeof output !== 'string' || !output.isWellFormed() || /[\x00-\x1f\x7f]/.test(output)
    || !path.isAbsolute(output) || !output.endsWith('.json') || path.basename(output).startsWith('release-')) throw failure('OUTPUT_PATH_INVALID');
  const rawParent = path.dirname(output);
  let canonicalParent, canonicalRoot, parentStat, rootStat;
  try {
    // Keep alias/.. filesystem semantics. Do not normalize the raw parent first.
    canonicalParent = fsImpl.realpathSync.native(rawParent);
    canonicalRoot = fsImpl.realpathSync.native(root);
    parentStat = fsImpl.lstatSync(canonicalParent, { bigint: true });
    rootStat = fsImpl.lstatSync(canonicalRoot, { bigint: true });
  } catch (error) { throw failure('OUTPUT_PARENT_UNAVAILABLE', error); }
  if (!parentStat.isDirectory() || !rootStat.isDirectory()) throw failure('OUTPUT_PARENT_UNAVAILABLE');
  if (contains(canonicalRoot, canonicalParent) || contains(canonicalParent, canonicalRoot)) throw failure('OUTPUT_OVERLAP');
  const report = path.join(canonicalParent, path.basename(output));
  return { raw: output, rawParent, root, canonicalParent, canonicalRoot, parentIdentity: identity(parentStat), rootIdentity: identity(rootStat),
    report, journal: report.replace(/\.json$/, '.observations.jsonl') };
}

function prepareOutputs(output, { root = ROOT, fsImpl = fs } = {}) {
  const location = outputLocation(output, { root, fsImpl });
  const entries = {
    report: { path: location.report, fd: null, created: false, bytes: 0, writeStarted: false, writeVerified: false, closed: false, closeError: null, failed: false },
    journal: { path: location.journal, fd: null, created: false, bytes: 0, writeStarted: false, writeVerified: false, closed: false, closeError: null, failed: false },
  };
  const journalHash = crypto.createHash('sha256');
  const state = () => Object.fromEntries(Object.entries(entries).map(([name, entry]) => [name, {
    state: entry.created ? 'CREATED_RETAINED' : 'NOT_CREATED', bytesVerified: entry.bytes,
    writeStarted: entry.writeStarted, writeVerified: entry.writeVerified, failed: entry.failed,
    descriptorClosed: entry.closed, ...(entry.closeError ? { closeErrorCode: entry.closeError } : {}),
  }]));
  const annotate = error => {
    const ownCode = typeof error?.code === 'string' && /^OUTPUT_[A-Z_]{1,64}$/.test(error.code);
    const result = failure(ownCode ? error.code : safeCode(error), error);
    result.outputState = state();
    return result;
  };
  function close() {
    let first = null;
    for (const entry of Object.values(entries)) {
      if (entry.fd === null) continue;
      const held = entry.fd; entry.fd = null;
      try { fsImpl.closeSync(held); entry.closed = true; }
      catch (error) { entry.closeError = safeCode(error); first ||= failure('OUTPUT_CLOSE_FAILED', error); }
    }
    if (first) throw first;
  }
  function verifyParent() {
    const now = outputLocation(output, { root, fsImpl });
    if (now.canonicalParent !== location.canonicalParent || now.canonicalRoot !== location.canonicalRoot
      || now.parentIdentity !== location.parentIdentity || now.rootIdentity !== location.rootIdentity) throw failure('OUTPUT_IDENTITY_CHANGED');
  }
  function verify(entry, expectedBytes = entry.bytes, checkStamp = true) {
    verifyParent();
    let held, named;
    try {
      held = fsImpl.fstatSync(entry.fd, { bigint: true }); named = fsImpl.lstatSync(entry.path, { bigint: true });
    } catch (error) { throw failure('OUTPUT_IDENTITY_CHANGED', error); }
    if (!held.isFile() || !named.isFile() || String(held.nlink) !== '1' || String(named.nlink) !== '1'
      || identity(held) !== identity(entry.initial) || identity(named) !== identity(entry.initial)
      || String(held.mode) !== String(entry.initial.mode) || String(named.mode) !== String(entry.initial.mode)
      || String(held.size) !== String(expectedBytes) || String(named.size) !== String(expectedBytes)
      || checkStamp && (String(held.mtimeNs) !== entry.stamp.mtimeNs || String(held.ctimeNs) !== entry.stamp.ctimeNs)) throw failure('OUTPUT_IDENTITY_CHANGED');
    return held;
  }
  function stamp(stat) { return { mtimeNs: String(stat.mtimeNs), ctimeNs: String(stat.ctimeNs) }; }
  try {
    // Check both names before creating either. Exclusive open still handles a
    // leaf created after this read-only check, including a dangling symlink.
    for (const entry of Object.values(entries)) {
      try { fsImpl.lstatSync(entry.path, { bigint: true }); throw failure('OUTPUT_ALREADY_EXISTS'); }
      catch (error) { if (error.code !== 'ENOENT') throw error.code === 'OUTPUT_ALREADY_EXISTS' ? error : failure('OUTPUT_OPEN_FAILED', error); }
    }
    for (const [name, entry] of Object.entries(entries)) {
      verifyParent();
      try {
        entry.fd = fsImpl.openSync(entry.path, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL
          | (fs.constants.O_NOFOLLOW || 0) | (name === 'journal' ? fs.constants.O_APPEND : 0), 0o600);
        entry.created = true; entry.initial = fsImpl.fstatSync(entry.fd, { bigint: true }); entry.stamp = stamp(entry.initial);
      } catch (error) { throw failure('OUTPUT_OPEN_FAILED', error); }
      verify(entry);
    }
    for (const entry of Object.values(entries)) verify(entry);
  } catch (error) {
    try { close(); } catch { /* Keep the primary error and record each close outcome. */ }
    throw annotate(error);
  }
  function write(entry, encoded, append) {
    if (entry.fd === null || entry.failed || !append && entry.writeStarted) throw failure('OUTPUT_IDENTITY_CHANGED');
    const bytes = Buffer.byteLength(encoded, 'utf8');
    if (append && entry.bytes + bytes > JOURNAL_LIMIT) throw failure('OUTPUT_JOURNAL_LIMIT');
    try {
      verify(entry);
      entry.writeStarted = true; entry.writeVerified = false;
      // Both APIs use the existing descriptor. No report/journal pathname is
      // reopened for writes. The journal descriptor was opened with O_APPEND.
      fsImpl.writeFileSync(entry.fd, encoded, { encoding: 'utf8' });
      fsImpl.fsyncSync(entry.fd);
      const after = verify(entry, entry.bytes + bytes, false);
      entry.bytes += bytes; entry.stamp = stamp(after); entry.writeVerified = true;
      if (append) journalHash.update(encoded, 'utf8');
    } catch (error) { entry.failed = true; throw typeof error.code === 'string' && error.code.startsWith('OUTPUT_') ? error : failure('OUTPUT_WRITE_FAILED', error); }
  }
  return {
    reportPath: location.report, journalPath: location.journal,
    appendJournal(value) { write(entries.journal, JSON.stringify(value) + '\n', true); },
    writeReport(value) { write(entries.report, JSON.stringify(value, null, 2) + '\n', false); },
    journalEvidence() {
      let verification = 'OBSERVED', errorCode = null;
      try { verify(entries.journal); }
      catch (error) { entries.journal.failed = true; verification = 'ERROR'; errorCode = typeof error.code === 'string' && error.code.startsWith('OUTPUT_') ? error.code : safeCode(error); }
      return { bytesVerified: entries.journal.bytes, sha256OfVerifiedAppends: journalHash.copy().digest('hex'),
        failed: entries.journal.failed, verification, errorCode, byteLimit: JOURNAL_LIMIT,
        scope: 'Expected bytes from verified held-descriptor appends. Compare the retained journal after download. This is not native-storage or hostile-parent acceptance.' };
    },
    finish() {
      let primary = null;
      for (const entry of Object.values(entries)) {
        try { verify(entry); if (entry.failed) throw failure('OUTPUT_NOT_VERIFIED'); }
        catch (error) { primary ||= error; }
      }
      try { close(); } catch (error) { primary ||= error; }
      if (primary) throw primary;
    },
    state, close, annotate,
  };
}

module.exports = { JOURNAL_LIMIT, outputLocation, prepareOutputs };
