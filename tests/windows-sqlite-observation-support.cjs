'use strict';

// Observation protocol and synthetic data only. Never imported by a product.
const crypto = require('node:crypto');
const path = require('node:path');
const DATABASE = 'observation.sqlite';
const FILES = [DATABASE, DATABASE + '-wal', DATABASE + '-shm', DATABASE + '-journal'];
const DATA = Object.freeze({ rows: 32, payloadCharacters: 1536, pendingId: 999 });
const SCENARIOS = Object.freeze(['sqlite-created', 'precreated'].flatMap(creation => ['DELETE', 'WAL'].flatMap(mode =>
  ['close', 'crash'].map(ending => Object.freeze({ id: [creation, mode.toLowerCase(), ending].join('/'), creation, mode, ending,
    phases: Object.freeze(['prepared', 'opened', 'baseline-committed', 'transaction-open',
      ...(ending === 'close' ? ['committed', 'closed', 'writer-exited'] : ['writer-terminated']),
      'reopened', 'recovery-closed', 'recovery-exited']) })))));

function rowsFor(state) {
  const pending = state === 'committed';
  if (!pending && state !== 'baseline') throw new Error('Unknown synthetic row state.');
  const rows = Array.from({ length: DATA.rows }, (_, id) => ({ id,
    payload: (pending ? 'committed-' : 'baseline-') + String(id).padStart(3, '0') + ':' + (pending ? 'y' : 'x').repeat(DATA.payloadCharacters) }));
  if (pending) rows.push({ id: DATA.pendingId, payload: 'Synthetic pending marker. No customer data.' });
  return rows;
}
function rowsDigest(rows) { return crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex'); }
function expectedData(state) {
  const rows = rowsFor(state);
  return { rows: rows.length, ids: rows.map(row => row.id), sha256: rowsDigest(rows), integrity: 'ok' };
}
function equalData(actual, state) {
  const expected = expectedData(state);
  return !!actual && actual.rows === expected.rows && actual.sha256 === expected.sha256 && actual.integrity === 'ok'
    && JSON.stringify(actual.ids) === JSON.stringify(expected.ids);
}
function forcedExitObserved(exit) {
  return !!exit && (Number.isInteger(exit.code) || (exit.code === null && typeof exit.signal === 'string' && exit.signal.length > 0))
    && (exit.signal === null || typeof exit.signal === 'string') && !(exit.code === 0 && exit.signal === null);
}

function emptyScenario(spec) {
  return { id: spec.id, creation: spec.creation, mode: spec.mode, ending: spec.ending, status: 'NOT_RUN',
    acceptance: 'NOT_ESTABLISHED', releaseCredit: false, productPassing: 0,
    phases: spec.phases.map(id => ({ id, status: 'NOT_RUN', reason: 'The observation has not reached this phase.' })),
    children: [], cleanup: { status: 'NOT_RUN', reason: 'No scenario fixture was created.' }, errors: [] };
}
function setPhase(record, id, result) {
  const phase = record.phases.find(item => item.id === id);
  if (!phase || phase.status !== 'NOT_RUN') throw new Error('Unknown or repeated observation phase: ' + id);
  Object.assign(phase, result);
  if (!['OBSERVED', 'ERROR'].includes(phase.status)) throw new Error('An executed phase needs an observation or error.');
  delete phase.reason;
}
function finishScenario(record, reason) {
  for (const phase of record.phases) if (phase.status === 'NOT_RUN') phase.reason = reason || 'An earlier observation did not complete.';
  record.status = record.phases.every(item => item.status === 'OBSERVED') && !record.errors.length
    && record.cleanup.status === 'OBSERVED' ? 'OBSERVED'
    : record.phases.some(item => item.status !== 'NOT_RUN') || record.errors.length ? 'ERROR' : 'NOT_RUN';
  return record;
}

function sameWindowsPath(left, right) {
  return typeof left === 'string' && typeof right === 'string'
    && path.win32.normalize(left).toLowerCase() === path.win32.normalize(right).toLowerCase();
}
function validateToken(value, expected) {
  const decimal = text => typeof text === 'string' && /^(?:0|[1-9]\d{0,19})$/.test(text);
  const sid = text => typeof text === 'string' && /^S-1-\d{1,15}(?:-\d{1,10}){1,15}$/.test(text);
  if (!value || !Number.isSafeInteger(value.pid) || value.pid < 1 || value.pid > 0xffffffff || value.pid !== expected.pid
      || !decimal(value.creationFiletime) || value.creationFiletime === '0' || !sameWindowsPath(value.imagePath, expected.imagePath)
      || !sid(value.userSid) || !sid(value.defaultOwnerSid) || value.userSid !== value.observerUserSid
      || value.tokenType !== 'primary' || typeof value.elevated !== 'boolean' || ![1, 2, 3].includes(value.elevationType)
      || !['tokenId', 'tokenModifiedId', 'authenticationId'].every(key => decimal(value[key]))
      || value.processAccess !== 'PROCESS_QUERY_LIMITED_INFORMATION' || value.tokenAccess !== 'TOKEN_QUERY') {
    throw new Error('The actual Node process/token observation is incomplete or belongs to another process/image/user.');
  }
  if (expected.creationFiletime && value.creationFiletime !== expected.creationFiletime) throw new Error('The Node process creation identity changed.');
  if (expected.token) for (const key of ['creationFiletime', 'userSid', 'defaultOwnerSid', 'tokenType', 'elevated',
    'elevationType', 'tokenId', 'tokenModifiedId', 'authenticationId']) {
    if (value[key] !== expected.token[key]) throw new Error('The observed Node token identity changed: ' + key);
  }
  return value;
}

function aclObservation(sddl) {
  // Keep the native SDDL as primary evidence. This bounded summary understands
  // only ordinary six-field ACE strings, never conditional or object policies.
  if (typeof sddl !== 'string' || sddl.length > 65536) return { status: 'UNPARSED', reason: 'Missing or oversized native SDDL.' };
  const start = sddl.indexOf('D:');
  if (start < 0) return { status: 'UNPARSED', reason: 'No DACL was serialized.' };
  const dacl = sddl.slice(start + 2), entries = [...dacl.matchAll(/\(([^()]*)\)/g)];
  const flags = dacl.replace(/\([^()]*\)/g, '');
  if (/[()]/.test(flags) || !/^(?:P|AI|AR)*$/.test(flags)) return { status: 'UNPARSED', reason: 'Unsupported DACL syntax.' };
  const aces = [];
  for (const match of entries) {
    const parts = match[1].split(';');
    if (parts.length !== 6 || parts[1].length % 2 !== 0) return { status: 'UNPARSED', reason: 'Unsupported ACE syntax.' };
    const aceFlags = parts[1].match(/.{2}/g) || [];
    aces.push({ type: parts[0], flags: aceFlags, rights: parts[2], objectGuid: parts[3], inheritObjectGuid: parts[4],
      trustee: parts[5], inherited: aceFlags.includes('ID') });
  }
  return { status: 'PARSED', daclFlags: flags, aces };
}

function fileObservation(name, listing, native) {
  if (native?.error) {
    if (native.win32Code === 2 && !listing.includes(name)) return { name, status: 'ABSENT', win32Code: 2 };
    throw Object.assign(new Error('A metadata failure cannot establish file absence: ' + name), { observation: native });
  }
  if (!listing.includes(name) || !native || typeof native.ownerSid !== 'string' || typeof native.sddl !== 'string'
      || !/^[a-f0-9]{32}$/.test(native.fileId) || !/^\d+$/.test(native.volumeSerial)
      || !Number.isSafeInteger(native.bytes) || native.bytes < 0 || native.bytes > 1024 * 1024
      || !Number.isInteger(native.fileAttributes) || (native.fileAttributes & (0x10 | 0x400)) !== 0 || native.links !== 1
      || native.filesystem !== 'NTFS' || native.persistentAcls !== true || native.volumeType !== 3
      || typeof native.protectedDacl !== 'boolean' || typeof native.daclPresent !== 'boolean'
      || typeof native.nullDacl !== 'boolean' || !(Number.isInteger(native.aceCount) && native.aceCount >= 0
        || (native.nullDacl === true && native.aceCount === null))) {
    throw Object.assign(new Error('The file metadata is incomplete or not a bounded ordinary NTFS fixture: ' + name), { observation: native });
  }
  return { name, status: 'PRESENT', metadata: native, inheritance: aclObservation(native.sddl),
    ownerMatchesObserverUser: native.ownerSid === native.processUserSid,
    ownerMatchesObserverDefaultOwner: native.ownerSid === native.tokenOwnerSid };
}

module.exports = { DATABASE, FILES, DATA, SCENARIOS, rowsFor, rowsDigest, expectedData, equalData, forcedExitObserved,
  emptyScenario, setPhase, finishScenario, sameWindowsPath, validateToken, aclObservation, fileObservation };
