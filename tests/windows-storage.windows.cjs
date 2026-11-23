'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { test } = require('node:test');
const { fork } = require('node:child_process');
const { Worker } = require('node:worker_threads');
const { loadCandidate } = require('../workspace/native/windows-storage/load.cjs');
const { CASES } = require('./windows-storage-cases.cjs');
const { fixture, startFixture, stopChild } = require('./windows-storage-support.cjs');

const candidate = loadCandidate(process.env.PANELREPLY_WINDOWS_COMPONENT_BUILD, {
  sourceCommit: process.env.PANELREPLY_WINDOWS_COMPONENT_COMMIT,
  sourceTreeSha256: process.env.PANELREPLY_WINDOWS_COMPONENT_SOURCE
});
const { addon, fixtureExecutable } = candidate;
const ROOT = process.env.PANELREPLY_WINDOWS_TEST_ROOT;
const OBSERVATIONS = process.env.PANELREPLY_WINDOWS_COMPONENT_OBSERVATIONS;
if (!ROOT || !path.isAbsolute(ROOT) || !OBSERVATIONS || !path.isAbsolute(OBSERVATIONS)) throw new Error('The component runner must provide a disposable root and observation path.');
const fixtureBytes = Buffer.from('Synthetic private storage fixture. No customer data.\n');
const bytes = Buffer.concat([Buffer.from('Electrical label Ω / 🔌\n'), Buffer.from(Array.from({ length: 256 }, (_, index) => index))]);
const MAX_BYTES = 1024 * 1024;
const code = (operation, codes, windowsCodes) => assert.throws(operation, error => {
  assert.ok(codes.includes(error.code), 'Expected ' + codes.join('/') + ', observed ' + error.code + ': ' + error.message);
  if (windowsCodes) assert.ok(windowsCodes.includes(error.win32Code), 'Unexpected Windows error ' + error.win32Code);
  return true;
});
const rejectDacl = operation => assert.throws(operation, error =>
  error.code === 'UNSAFE_DACL' || (error.code === 'NATIVE_OPEN_FAILED' && error.win32Code === 5));
const raw = filename => fixture(fixtureExecutable, ['info', filename]);
function caseDirectory(id) {
  const directory = path.join(ROOT, id.replace(/^WNS\./, ''));
  fs.mkdirSync(directory);
  return directory;
}
function observe(id, event, details) {
  const value = JSON.stringify({ case: id, event, at: new Date().toISOString(), details });
  assert.ok(Buffer.byteLength(value) <= 256 * 1024, 'A component observation exceeded its bound.');
  fs.appendFileSync(OBSERVATIONS, value + '\n');
}
function componentCase(id, body) {
  assert.ok(CASES.some(item => item.id === id), 'A case is missing from the fixed component catalog.');
  test(id, { timeout: 20000 }, async t => {
    const base = caseDirectory(id);
    const record = (event, details) => observe(id, event, details);
    record('started', { testInstrumented: CASES.find(item => item.id === id).testInstrumented });
    try { await body(t, base, record); record('body-completed', {}); }
    catch (error) { record('body-failed', { code: error.code || null, message: error.message, win32Code: error.win32Code ?? null }); throw error; }
  });
}
function privateDirectory(t, base, name = 'private') {
  const directory = path.join(base, name);
  const lease = addon.createPrivateDirectory(directory);
  t.after(() => lease.close());
  return { directory, lease };
}
function reopen(t, directory, module = addon) {
  const lease = module.openPrivateDirectory(directory);
  t.after(() => lease.close());
  return lease;
}
function assertPrivate(metadata, type) {
  assert.equal(metadata.type, type);
  assert.equal(metadata.ownerSid, metadata.currentUserSid);
  assert.match(metadata.ownerSid, /^S-1-5-/);
  assert.equal(metadata.ownerOnly, true);
  assert.equal(metadata.protectedDacl, true);
  assert.match(metadata.fileId, /^[a-f0-9]{32}$/);
  assert.match(metadata.volumeSerial, /^\d+$/);
  if (type === 'file') assert.equal(metadata.links, 1);
}
function assertIndependent(metadata, expected) {
  assert.equal(metadata.ownerSid, metadata.processUserSid);
  assert.equal(metadata.ownerSid, expected.ownerSid);
  assert.equal(metadata.protectedDacl, true);
  assert.equal(metadata.daclPresent, true);
  assert.equal(metadata.nullDacl, false);
  assert.equal(metadata.aceCount, 1);
  assert.equal(metadata.filesystem, 'NTFS');
  assert.equal(metadata.persistentAcls, true);
  assert.equal(metadata.volumeType, 3);
  assert.equal(metadata.fileId, expected.fileId);
  assert.equal(metadata.volumeSerial, expected.volumeSerial);
}
function assertAbsent(observation) {
  assert.equal(observation.exists, false);
  assert.ok([2, 3].includes(observation.win32Code), 'Absence must be an actual not-found result, not an access/sharing failure.');
}
function assertEmptyDacl(metadata, kind) {
  assert.equal(metadata.ownerSid, metadata.processUserSid);
  assert.equal(metadata.protectedDacl, true);
  assert.equal(metadata.daclPresent, true);
  assert.equal(metadata.nullDacl, false);
  assert.equal(metadata.aceCount, 0);
  assert.match(metadata.fileId, /^[a-f0-9]{32}$/);
  assert.match(metadata.volumeSerial, /^\d+$/);
  assert.equal(metadata.filesystem, 'NTFS');
  assert.equal(metadata.persistentAcls, true);
  assert.equal(metadata.volumeType, 3);
  assert.ok(Number.isInteger(metadata.fileAttributes));
  assert.equal(metadata.fileAttributes & 0x400, 0);
  assert.equal(Boolean(metadata.fileAttributes & 0x10), kind === 'directory');
  if (kind === 'file') assert.equal(metadata.links, 1);
}
function trackEmptyFixture(t, filename, kind, record) {
  let expected;
  // Register before creation: a failed post-create metadata observation must
  // still attempt cleanup, without pretending an unknown identity is safe.
  t.after(() => {
    try {
      const parent = path.dirname(filename), name = path.basename(filename);
      if (!expected) {
        const observed = fixture(fixtureExecutable, ['info', filename], { allowFailure: true });
        if (observed.error && observed.win32Code === 2 && !fs.readdirSync(parent).includes(name)) {
          record('empty-dacl-cleanup-no-object', { kind, win32Code: 2 }); return;
        }
        record('empty-dacl-cleanup-identity-unestablished', { kind, observed });
        if (observed.error) throw Object.assign(new Error('Cleanup could not observe the unconfirmed fixture: ' + observed.error), { win32Code: observed.win32Code });
        throw new Error('Cleanup cannot adopt a present object without its original creation identity.');
      }
      const before = expected;
      assertEmptyDacl(before, kind);
      const wrongId = (before.fileId[0] === '0' ? '1' : '0') + before.fileId.slice(1);
      const mismatch = fixture(fixtureExecutable, ['remove-empty', filename, before.volumeSerial, wrongId, kind], { allowFailure: true });
      record('empty-dacl-cleanup-identity-control', { kind, result: mismatch });
      assert.equal(mismatch.win32Code, 13, 'Cleanup must reject an identity mismatch before deletion.');
      assert.deepEqual(raw(filename), before);
      const result = fixture(fixtureExecutable, ['remove-empty', filename, before.volumeSerial, before.fileId, kind]);
      assert.equal(result.deleteDispositionSet, true);
      assert.deepEqual(result.metadata, before);
      assert.equal(fs.readdirSync(parent).includes(name), false);
      record('empty-dacl-cleanup-verified', { kind, identityMismatch: mismatch, result, absentFromParent: true });
    } catch (error) {
      record('empty-dacl-cleanup-failed', { kind, code: error.code || null, message: error.message, win32Code: error.win32Code ?? null });
      throw error;
    }
  });
  return metadata => { expected = metadata; };
}

componentCase('WNS.private_create_roundtrip', (t, base, record) => {
  const { directory, lease } = privateDirectory(t, base, 'private-🔌');
  const directoryInfo = lease.inspect();
  assertPrivate(directoryInfo, 'directory');
  assert.equal(directoryInfo.filesystem, 'NTFS');
  const independent = raw(directory);
  assertIndependent(independent, directoryInfo);
  const name = 'label-Ω-🔌.bin';
  const created = lease.createFile(name, bytes);
  assertPrivate(created, 'file');
  assert.equal(created.bytes, bytes.length);
  assertIndependent(raw(path.join(directory, name)), created);
  assert.deepEqual(lease.readFile(name, bytes.length), bytes);
  code(() => lease.readFile(name, bytes.length - 1), ['FILE_TOO_LARGE']);
  const returned = lease.readFile(name, MAX_BYTES); returned.fill(0);
  assert.deepEqual(lease.readFile(name, MAX_BYTES), bytes);
  assert.deepEqual(lease.inspectFile(name), created);
  lease.createFile('empty.bin', Buffer.alloc(0));
  assert.deepEqual(lease.readFile('empty.bin', 0), Buffer.alloc(0));
  record('independent-owner-acl-and-identity', { directory: independent, file: raw(path.join(directory, name)) });
});

componentCase('WNS.exclusive_create_preserves_existing', (t, base, record) => {
  const { directory, lease } = privateDirectory(t, base);
  const saved = lease.createFile('one.bin', bytes);
  const original = raw(directory);
  code(() => addon.createPrivateDirectory(directory), ['PATH_EXISTS', 'NATIVE_OPEN_FAILED']);
  code(() => addon.openPrivateDirectory(directory), ['NATIVE_OPEN_FAILED'], [32]);
  code(() => lease.createFile('one.bin', Buffer.from('replacement')), ['PATH_EXISTS']);
  assert.deepEqual(lease.readFile('one.bin', MAX_BYTES), bytes);
  assert.deepEqual(lease.inspectFile('one.bin'), saved);
  assert.equal(raw(directory).fileId, original.fileId);
  lease.close();
  const second = reopen(t, directory);
  assert.deepEqual(second.readFile('one.bin', MAX_BYTES), bytes);
  assert.equal(second.inspect().fileId, original.fileId);
  record('created-lease-exclusivity-and-reopen', { original, reopened: second.inspect() });
});

componentCase('WNS.root_security_rejection', (t, base, record) => {
  for (const policy of ['null', 'empty', 'unprotected', 'broad']) {
    const directory = path.join(base, policy);
    const remember = policy === 'empty' ? trackEmptyFixture(t, directory, 'directory', record) : null;
    const created = fixture(fixtureExecutable, ['create-dir', directory, policy]);
    assert.equal(created.created, true);
    if (remember) remember(created.metadata);
    const before = raw(directory);
    if (policy === 'empty') { assertEmptyDacl(before, 'directory'); assert.deepEqual(before, created.metadata); }
    const parentEntries = fs.readdirSync(base).sort();
    rejectDacl(() => addon.openPrivateDirectory(directory));
    const after = raw(directory);
    assert.deepEqual(after, before);
    assert.deepEqual(fs.readdirSync(base).sort(), parentEntries);
    record('unchanged-rejected-root', { policy, before, after });
  }
});

componentCase('WNS.different_owner_rejection', (t, base, record) => {
  const directory = path.join(base, 'different-owner');
  const created = fixture(fixtureExecutable, ['create-dir', directory, 'wrong-owner']);
  record('different-owner-capability', created);
  if (created.created === false && created.capability === 'different-owner-unavailable') {
    t.skip('The ordinary token has no assignable different owner SID. This requirement remains unverified.'); return;
  }
  assert.equal(created.created, true);
  const before = raw(directory);
  assert.notEqual(before.ownerSid, before.processUserSid);
  code(() => addon.openPrivateDirectory(directory), ['WRONG_OWNER']);
  assert.deepEqual(raw(directory), before);
  record('different-owner-preserved', before);
});

componentCase('WNS.child_security_and_hardlink_rejection', (t, base, record) => {
  const { directory, lease } = privateDirectory(t, base);
  for (const policy of ['null', 'empty', 'unprotected', 'broad']) {
    const name = policy + '.bin', filename = path.join(directory, name);
    const remember = policy === 'empty' ? trackEmptyFixture(t, filename, 'file', record) : null;
    const created = fixture(fixtureExecutable, ['create-file', filename, policy]);
    assert.equal(created.created, true);
    if (remember) remember(created.metadata);
    const before = raw(filename);
    if (policy === 'empty') { assertEmptyDacl(before, 'file'); assert.deepEqual(before, created.metadata); }
    rejectDacl(() => lease.inspectFile(name));
    rejectDacl(() => lease.readFile(name, MAX_BYTES));
    const after = raw(filename);
    assert.deepEqual(after, before);
    record('unchanged-rejected-child', { policy, metadata: before, after });
  }
  const saved = lease.createFile('original.bin', bytes);
  fs.linkSync(path.join(directory, 'original.bin'), path.join(directory, 'alias.bin'));
  const first = raw(path.join(directory, 'original.bin')), alias = raw(path.join(directory, 'alias.bin'));
  assert.equal(first.fileId, saved.fileId); assert.equal(alias.fileId, saved.fileId);
  assert.equal(first.links, 2); assert.equal(alias.links, 2);
  for (const name of ['original.bin', 'alias.bin']) {
    code(() => lease.readFile(name, MAX_BYTES), ['INVALID_OBJECT']);
    code(() => lease.inspectFile(name), ['INVALID_OBJECT']);
  }
  fs.unlinkSync(path.join(directory, 'alias.bin'));
  assert.deepEqual(lease.readFile('original.bin', MAX_BYTES), bytes);
  record('hardlink-identity-and-last-link-read', { first, alias, remaining: lease.inspectFile('original.bin') });
});

componentCase('WNS.path_and_argument_boundaries', (t, base, record) => {
  const { directory, lease } = privateDirectory(t, base);
  const before = fs.readdirSync(directory);
  const invalidNames = ['', '.', '..', '..\\outside.bin', 'a/b', 'a:b', 'NUL', 'con.txt', 'COM¹', 'LPT2.txt',
    'CONIN$', 'ends.', 'ends ', 'a\0b', 'a\u007fb', 'lone-\ud800', 'lone-\udc00', 'a'.repeat(256)];
  for (const name of invalidNames) code(() => lease.createFile(name, bytes), ['INVALID_PATH']);
  for (const invalidPath of ['', 'relative', 'C:relative', directory.slice(0, 3), '\\\\server\\share\\private',
    '\\\\?\\' + directory, directory + '\\..\\other', directory + '\\', directory + '\\bad:stream']) {
    code(() => addon.createPrivateDirectory(invalidPath), ['INVALID_PATH']);
  }
  code(() => addon.createPrivateDirectory(null), ['INVALID_ARGUMENT']);
  code(() => lease.createFile('bad.bin', 'text'), ['INVALID_ARGUMENT']);
  code(() => lease.createFile('too-big.bin', Buffer.alloc(MAX_BYTES + 1)), ['FILE_TOO_LARGE']);
  for (const limit of [-1, 0.5, Infinity, NaN, MAX_BYTES + 1, '10']) code(() => lease.readFile('never.bin', limit), ['INVALID_ARGUMENT']);
  code(() => lease.inspect('extra'), ['INVALID_ARGUMENT']);
  code(() => lease.createFile('extra.bin', bytes, null, null, null), ['INVALID_ARGUMENT']);
  assert.deepEqual(fs.readdirSync(directory), before);
  record('no-path-or-argument-write', { rejectedNames: invalidNames.length, rootPathForms: 9, entries: before });
});

componentCase('WNS.held_parent_rename_barriers', (t, base, record) => {
  const ancestor = path.join(base, 'ancestor'), parent = path.join(ancestor, 'parent');
  fs.mkdirSync(parent, { recursive: true });
  const directory = path.join(parent, 'private');
  const created = addon.createPrivateDirectory(directory); created.createFile('proof.bin', bytes); created.close();
  const lease = reopen(t, directory);
  const checked = [ancestor, parent, directory].map(filename => ({ filename, metadata: raw(filename) }));
  for (const item of checked) {
    const result = fixture(fixtureExecutable, ['rename', item.filename, item.filename + '-moved']);
    assert.equal(result.renamed, false); assert.ok([5, 32].includes(result.win32Code));
    assert.equal(raw(item.filename).fileId, item.metadata.fileId);
    assert.equal(fs.existsSync(item.filename + '-moved'), false);
    record('held-rename-refused', { path: item.filename, result, fileId: item.metadata.fileId });
  }
  assert.deepEqual(lease.readFile('proof.bin', MAX_BYTES), bytes);
  lease.close();
  for (const item of [...checked].reverse()) {
    const renamed = fixture(fixtureExecutable, ['rename', item.filename, item.filename + '-moved']);
    assert.equal(renamed.renamed, true); assert.equal(renamed.win32Code, 0);
    assert.equal(raw(item.filename + '-moved').fileId, item.metadata.fileId);
    assert.equal(fixture(fixtureExecutable, ['rename', item.filename + '-moved', item.filename]).renamed, true);
    record('closed-rename-control-succeeded', { path: item.filename, fileId: item.metadata.fileId });
  }
});

componentCase('WNS.attribute_only_reparse_countertest', (t, base, record) => {
  const target = privateDirectory(t, base, 'target'); target.lease.close();
  const control = privateDirectory(t, base, 'unleased'); control.lease.close();
  const positive = fixture(fixtureExecutable, ['junction', control.directory, target.directory, 'attributes']);
  record('unleased-attribute-control', positive);
  if (!positive.mutated) { t.skip('The actual attribute-only FSCTL control did not mutate. The reparse countertest remains incomplete.'); return; }
  assert.equal(positive.opened, true); assert.equal(positive.requestedAccess, 'FILE_WRITE_ATTRIBUTES');
  const subject = privateDirectory(t, base, 'subject'); subject.lease.close();
  const lease = reopen(t, subject.directory), before = lease.inspect();
  const attempted = fixture(fixtureExecutable, ['junction', subject.directory, target.directory, 'attributes']);
  record('leased-attribute-attempt', attempted);
  if (attempted.mutated) {
    code(() => lease.inspect(), ['REPARSE_POINT']);
    code(() => lease.createFile('must-not-exist.bin', bytes), ['REPARSE_POINT']);
    assert.equal(fs.existsSync(path.join(target.directory, 'must-not-exist.bin')), false);
    assert.equal(raw(subject.directory).fileId, before.fileId);
  } else {
    assert.ok([5, 32].includes(attempted.win32Code));
    assert.equal(lease.inspect().fileId, before.fileId);
    lease.close();
    const afterClose = fixture(fixtureExecutable, ['junction', subject.directory, target.directory, 'attributes']);
    assert.equal(afterClose.mutated, true);
    record('same-subject-after-close-control', afterClose);
  }
});

componentCase('WNS.existing_reparse_paths_rejected', (t, base, record) => {
  const target = privateDirectory(t, base, 'target');
  target.lease.createFile('proof.bin', bytes);
  target.lease.close();
  const nested = addon.createPrivateDirectory(path.join(target.directory, 'nested')); nested.close();
  const alias = privateDirectory(t, base, 'junction'); alias.lease.close();
  const result = fixture(fixtureExecutable, ['junction', alias.directory, target.directory, 'write']);
  record('existing-junction-control', result);
  if (!result.mutated) { t.skip('The ordinary process could not create the existing-junction fixture. This scope remains incomplete.'); return; }
  code(() => addon.openPrivateDirectory(alias.directory), ['REPARSE_POINT']);
  code(() => addon.openPrivateDirectory(path.join(alias.directory, 'nested')), ['REPARSE_POINT']);
  code(() => addon.createPrivateDirectory(path.join(alias.directory, 'new-private')), ['REPARSE_POINT']);
  assert.equal(fs.existsSync(path.join(target.directory, 'new-private')), false);
  const parent = privateDirectory(t, base, 'parent');
  const child = path.join(parent.directory, 'linked-child'); fs.mkdirSync(child);
  assert.equal(fixture(fixtureExecutable, ['junction', child, target.directory, 'write']).mutated, true);
  code(() => parent.lease.readFile('linked-child', MAX_BYTES), ['REPARSE_POINT']);
  code(() => parent.lease.inspectFile('linked-child'), ['REPARSE_POINT']);
  assert.deepEqual(fs.readFileSync(path.join(target.directory, 'proof.bin')), bytes);
  record('target-preserved', raw(path.join(target.directory, 'proof.bin')));
});

function ipcMessage(child, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error('The competing process did not return its bounded IPC result.')), timeout);
    const onMessage = message => finish(null, message);
    const onError = error => finish(error);
    const onExit = value => finish(new Error('The competing process exited before its IPC result: ' + value));
    function finish(error, message) {
      clearTimeout(timer); child.off('message', onMessage); child.off('error', onError); child.off('exit', onExit);
      if (error) reject(error); else resolve(message);
    }
    child.once('message', onMessage); child.once('error', onError); child.once('exit', onExit);
  });
}

componentCase('WNS.concurrent_exclusive_publication', async (t, base, record) => {
  const { directory, lease } = privateDirectory(t, base); lease.close();
  const payloads = [Buffer.from('First competing synthetic record\n'), Buffer.from('Second competing synthetic record\n')];
  const children = payloads.map(payload => fork(path.join(__dirname, 'windows-storage-child.cjs'),
    ['race-create', directory, 'only.bin', payload.toString('base64')], { stdio: ['pipe', 'pipe', 'pipe', 'ipc'], windowsHide: true }));
  t.after(async () => { for (const child of children) await stopChild(child); });
  for (const child of children) { child.stdout.resume(); child.stderr.resume(); }
  const ready = await Promise.all(children.map(child => ipcMessage(child)));
  assert.ok(ready.every(item => item.ready === true));
  const responses = children.map(child => ipcMessage(child));
  for (const child of children) child.send('create');
  const outcomes = await Promise.all(responses);
  assert.equal(outcomes.filter(item => item.created === true).length, 1);
  const loser = outcomes.find(item => !item.created);
  assert.ok(loser.code === 'PATH_EXISTS' || (loser.code === 'NATIVE_OPEN_FAILED' && loser.win32Code === 32));
  const winner = outcomes.findIndex(item => item.created);
  for (const child of children) await stopChild(child);
  const read = reopen(t, directory);
  assert.deepEqual(read.readFile('only.bin', MAX_BYTES), payloads[winner]);
  assert.deepEqual(fs.readdirSync(directory), ['only.bin']);
  assert.equal(read.inspectFile('only.bin').fileId, outcomes[winner].metadata.fileId);
  record('competing-processes-and-one-complete-file', { outcomes, stored: read.inspectFile('only.bin') });
});

componentCase('WNS.anonymous_io_denial', (t, base, record) => {
  // The control parent is a new test fixture with anonymous traverse/read
  // access. Moving an already-private file preserves its protected descriptor
  // and identity, so this experiment isolates actual file access checks.
  const parent = path.join(base, 'anonymous-parent');
  assert.equal(fixture(fixtureExecutable, ['create-dir', parent, 'anonymous-parent']).created, true);
  const { directory, lease } = privateDirectory(t, base);
  const saved = lease.createFile('private.bin', fixtureBytes); lease.close();
  fs.renameSync(path.join(directory, 'private.bin'), path.join(parent, 'private.bin'));
  const moved = raw(path.join(parent, 'private.bin'));
  assertIndependent(moved, saved);
  assert.equal(fixture(fixtureExecutable, ['create-file', path.join(parent, 'control.bin'), 'anonymous-control']).created, true);
  const result = fixture(fixtureExecutable, ['anonymous-read', parent, 'private.bin', 'control.bin'], { allowFailure: true });
  record('actual-anonymous-io-and-restoration', { privateFile: moved, result });
  if (result.error === 'Anonymous impersonation is unavailable') {
    t.skip('The ordinary process could not obtain the documented anonymous token. No different-identity IO claim is made.'); return;
  }
  assert.equal(result.error, undefined);
  assert.equal(result.beforeSid, saved.ownerSid);
  assert.equal(result.alternateSid, 'S-1-5-7');
  assert.equal(result.controlError, 0); assert.equal(result.controlRead, true);
  assert.equal(result.privateError, 5); assert.equal(result.privateRead, false);
  assert.equal(result.afterSid, result.beforeSid); assert.equal(result.restoredOwnerRead, true);
  assert.deepEqual(fs.readFileSync(path.join(parent, 'private.bin')), fixtureBytes);
});

componentCase('WNS.concurrent_writer_read_refusal', async (t, base, record) => {
  const { directory, lease } = privateDirectory(t, base);
  const saved = lease.createFile('written.bin', bytes);
  const writer = await startFixture(fixtureExecutable, ['hold-writer', path.join(directory, 'written.bin')]);
  t.after(() => writer.stop());
  assert.equal(writer.ready.ready, true);
  code(() => lease.readFile('written.bin', MAX_BYTES), ['NATIVE_OPEN_FAILED'], [32]);
  await writer.stop();
  assert.deepEqual(lease.readFile('written.bin', MAX_BYTES), bytes);
  assert.deepEqual(lease.inspectFile('written.bin'), saved);
  record('writer-sharing-refusal-and-read-after-close', { saved, readback: lease.inspectFile('written.bin') });
});

componentCase('WNS.lease_receiver_close_and_worker_cleanup', async (t, base, record) => {
  const { directory, lease } = privateDirectory(t, base);
  const before = lease.inspect();
  for (const method of ['inspect', 'close']) code(() => lease[method].call({}), ['INVALID_RECEIVER']);
  code(() => lease.createFile.call({}, 'bad.bin', bytes), ['INVALID_RECEIVER']);
  lease.close(); lease.close();
  code(() => lease.inspect(), ['CLOSED_LEASE']);
  code(() => lease.readFile('none.bin', 1), ['CLOSED_LEASE']);
  code(() => lease.createFile('closed.bin', bytes), ['CLOSED_LEASE']);
  assert.equal(fs.existsSync(path.join(directory, 'closed.bin')), false);
  const worker = new Worker(`
    const { parentPort, workerData } = require('node:worker_threads');
    const lease = require(workerData.module).openPrivateDirectory(workerData.directory);
    parentPort.postMessage({ ready: true, metadata: lease.inspect() });
    parentPort.on('message', () => {});
  `, { eval: true, workerData: { module: candidate.identity.observed[0].path, directory } });
  const stop = () => Promise.race([worker.terminate(), new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('The native-lease worker did not terminate.')), 3000); timer.unref();
  })]);
  t.after(stop);
  const ready = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('The native-lease worker did not become ready.')), 5000);
    worker.once('message', value => { clearTimeout(timer); resolve(value); });
    worker.once('error', error => { clearTimeout(timer); reject(error); });
  });
  assert.equal(ready.ready, true); assert.equal(ready.metadata.fileId, before.fileId);
  assert.equal(fixture(fixtureExecutable, ['rename', directory, directory + '-moved']).renamed, false);
  await stop();
  assert.equal(fixture(fixtureExecutable, ['rename', directory, directory + '-moved']).renamed, true);
  assert.equal(raw(directory + '-moved').fileId, before.fileId);
  record('worker-environment-released-held-handles', { before, ready, after: raw(directory + '-moved') });
});

componentCase('WNS.instrumented_relative_create_race', async (t, base, record) => {
  const probe = candidate.loadProbe();
  const subject = privateDirectory(t, base, 'subject'); subject.lease.close();
  const target = privateDirectory(t, base, 'redirect-target'); target.lease.close();
  const control = privateDirectory(t, base, 'unleased-control'); control.lease.close();
  const controlResult = fixture(fixtureExecutable, ['junction', control.directory, target.directory, 'attributes']);
  record('race-unleased-positive-control', controlResult);
  if (!controlResult.mutated) { t.skip('The attribute-only reparse control is unavailable. The instrumented race is unverified.'); return; }
  const name = 'race.bin', pipe = 'panelreply-storage-' + crypto.randomUUID();
  const observer = await startFixture(fixtureExecutable, ['observe-server', subject.directory, target.directory, name, pipe]);
  t.after(() => observer.stop());
  record('independently-held-directories-before-race', observer.ready);
  const lease = reopen(t, subject.directory, probe);
  const sourceId = lease.inspect().fileId;
  assert.equal(sourceId, observer.ready.source.fileId);
  assert.notEqual(sourceId, observer.ready.target.fileId);
  const observed = [];
  let mutation, failure;
  try {
    lease.createFile(name, bytes, event => {
      assert.equal(Object.isFrozen(event), true);
      if (event.phase === 'beforeOpen') {
        mutation = fixture(fixtureExecutable, ['junction', subject.directory, target.directory, 'attributes']);
        record('after-validation-reparse-mutation', mutation);
        if (!mutation.mutated) throw Object.assign(new Error('The held-root reparse mutation was unavailable.'), { code: 'RACE_MUTATION_UNAVAILABLE' });
      } else {
        assert.equal(event.phase, 'opened');
        // The independent observer only opens existing handles. It cannot
        // create or remove a child and sees the target before native cleanup.
        const snapshot = fixture(fixtureExecutable, ['observe-client', pipe]);
        observed.push({ event, snapshot });
        record('opened-child-before-payload-write-or-cleanup', { event, snapshot });
        assert.equal(event.bytes, 0);
        assert.equal(snapshot.source.fileId, observer.ready.source.fileId);
        assert.equal(snapshot.target.fileId, observer.ready.target.fileId);
        assertAbsent(snapshot.targetChild);
        assert.equal(snapshot.targetDirectory.complete, true); assert.equal(snapshot.targetDirectory.present, false);
        assert.equal(snapshot.sourceDirectory.complete, true); assert.equal(snapshot.sourceDirectory.present, true);
        assert.equal(snapshot.sourceChild.exists, true);
        assert.equal(snapshot.sourceChild.metadata.fileId, event.fileId);
        assert.equal(snapshot.sourceChild.metadata.bytes, 0);
        assert.equal(event.canonicalPath.toLowerCase(), (observer.ready.source.volumeGuidPath + '\\' + name).toLowerCase());
      }
    });
  } catch (error) { failure = error; }
  if (failure?.code === 'RACE_MUTATION_UNAVAILABLE') {
    record('race-incomplete', { mutation });
    t.skip('The leased-root mutation did not occur. This run does not verify relative creation after root mutation.'); return;
  }
  assert.equal(mutation?.mutated, true);
  assert.ok(failure && ['REPARSE_POINT', 'NATIVE_OPEN_FAILED'].includes(failure.code), 'The operation must refuse the changed root, without hiding an observation assertion.');
  const after = fixture(fixtureExecutable, ['observe-client', pipe]);
  record('independent-directories-after-refusal-and-cleanup', { failure: { code: failure.code, win32Code: failure.win32Code }, after, openedObservations: observed.length });
  assertAbsent(after.targetChild);
  assert.equal(after.sourceDirectory.complete, true); assert.equal(after.sourceDirectory.present, false);
  assert.equal(after.targetDirectory.complete, true); assert.equal(after.targetDirectory.present, false);
  assert.equal(after.sourceChild.exists, false);
  // A rejected RootDirectory lookup is recorded as such. The separate complete
  // directory enumeration, not that access error, proves source-child absence.
  // ERROR_CANT_RESOLVE_FILENAME (1921) is the observed refusal after the
  // retained root becomes a reparse point. It is not evidence of absence by
  // itself: both complete held-directory enumerations above remain required.
  assert.ok([2, 3, 1920, 1921].includes(after.sourceChild.win32Code));
  assert.equal(fs.existsSync(path.join(target.directory, name)), false);
  code(() => lease.inspect(), ['REPARSE_POINT']);
});

componentCase('WNS.instrumented_probe_cleanup_and_isolation', (t, base, record) => {
  const probe = candidate.loadProbe();
  assert.deepEqual(Object.getOwnPropertyNames(addon).sort(), ['createPrivateDirectory', 'openPrivateDirectory']);
  assert.deepEqual(Object.getOwnPropertyNames(probe).sort(), ['createPrivateDirectory', 'openPrivateDirectory']);
  const normal = privateDirectory(t, base, 'normal');
  const probeDirectory = path.join(base, 'probe');
  const lease = probe.createPrivateDirectory(probeDirectory); t.after(() => lease.close());
  let calls = 0;
  code(() => normal.lease.createFile('no-hook.bin', bytes, () => calls++), ['INVALID_ARGUMENT']);
  assert.equal(calls, 0); assert.equal(fs.existsSync(path.join(normal.directory, 'no-hook.bin')), false);
  code(() => normal.lease.createFile.call(lease, 'cross.bin', bytes), ['INVALID_RECEIVER']);
  code(() => lease.createFile.call(normal.lease, 'cross.bin', bytes, () => {}), ['INVALID_RECEIVER']);
  for (const phase of ['beforeOpen', 'opened']) {
    const sentinel = new Error('Deliberate ' + phase + ' observer failure');
    const events = [];
    assert.throws(() => lease.createFile(phase + '.bin', bytes, event => {
      events.push(event);
      if (event.phase === phase) throw sentinel;
    }), error => error === sentinel);
    assert.equal(fs.existsSync(path.join(probeDirectory, phase + '.bin')), false);
    assertPrivate(lease.inspect(), 'directory');
    record('throwing-probe-cleanup', { phase, events });
  }
  const input = Buffer.from(bytes), original = Buffer.from(input);
  const saved = lease.createFile('copied-input.bin', input, event => { if (event.phase === 'beforeOpen') input.fill(0); });
  assert.deepEqual(lease.readFile('copied-input.bin', MAX_BYTES), original);
  assert.equal(saved.bytes, bytes.length);
  for (const phase of ['beforeOpen', 'opened']) {
    const directory = path.join(base, 'close-' + phase), closing = probe.createPrivateDirectory(directory);
    t.after(() => closing.close());
    code(() => closing.createFile('closed.bin', bytes, event => { if (event.phase === phase) closing.close(); }), ['CLOSED_LEASE']);
    assert.equal(fs.existsSync(path.join(directory, 'closed.bin')), false);
    code(() => closing.inspect(), ['CLOSED_LEASE']);
    record('callback-closed-lease-cleanup', { phase, remaining: fs.readdirSync(directory) });
  }
});
