'use strict';

// Harness checks only. No Windows acceptance or product-counter credit.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { argumentsFor, verifyLive } = require('../scripts/observe-windows-sqlite.cjs');
const { spawnObserver } = require('./windows-sqlite-observer-process.cjs');
const { DATABASE, SCENARIOS, expectedData, equalData, forcedExitObserved, emptyScenario, setPhase, finishScenario,
  validateToken, aclObservation, fileObservation } = require('./windows-sqlite-observation-support.cjs');
const ROOT = path.resolve(__dirname, '..');

function token() {
  return { pid: 412, creationFiletime: '134398021234567890', imagePath: 'C:\\fixture\\node.exe',
    userSid: 'S-1-5-21-111-222-333-1001', defaultOwnerSid: 'S-1-5-32-544', observerUserSid: 'S-1-5-21-111-222-333-1001',
    tokenType: 'primary', elevated: true, elevationType: 2, tokenId: '12001', tokenModifiedId: '12002', authenticationId: '12000',
    processAccess: 'PROCESS_QUERY_LIMITED_INFORMATION', tokenAccess: 'TOKEN_QUERY' };
}
function metadata() {
  return { ownerSid: 'S-1-5-32-544', processUserSid: 'S-1-5-21-111-222-333-1001', tokenOwnerSid: 'S-1-5-32-544',
    sddl: 'O:BAG:BAD:AI(A;ID;FA;;;S-1-5-21-111-222-333-1001)', protectedDacl: false, daclPresent: true, nullDacl: false,
    aceCount: 1, filesystem: 'NTFS', persistentAcls: true, volumeType: 3, fileId: 'a'.repeat(32), volumeSerial: '123',
    fileAttributes: 0x20, bytes: 4096, links: 1 };
}

test('observation accounting preserves completed phases, errors and every missing phase without acceptance credit', () => {
  assert.equal(SCENARIOS.length, 8); assert.equal(new Set(SCENARIOS.map(item => item.id)).size, 8);
  const record = emptyScenario(SCENARIOS[0]);
  setPhase(record, 'prepared', { status: 'OBSERVED', actualFileId: 'fixture-id' });
  setPhase(record, 'opened', { status: 'ERROR', error: { message: 'actual SQLite open failed' } });
  record.errors.push({ stage: 'opened', message: 'actual SQLite open failed' });
  record.cleanup = { status: 'ERROR', message: 'actual owned-child cleanup failed' };
  finishScenario(record, 'Previous open failed.');
  assert.equal(record.status, 'ERROR'); assert.equal(record.phases[0].actualFileId, 'fixture-id');
  assert.equal(record.phases[0].status, 'OBSERVED'); assert.equal(record.phases[1].status, 'ERROR');
  assert.ok(record.phases.slice(2).every(item => item.status === 'NOT_RUN' && item.reason === 'Previous open failed.'));
  assert.equal(record.acceptance, 'NOT_ESTABLISHED'); assert.equal(record.productPassing, 0); assert.equal(record.releaseCredit, false);
  assert.throws(() => setPhase(record, 'prepared', { status: 'OBSERVED' }), /repeated/);
  assert.throws(() => setPhase(record, 'not-catalogued', { status: 'OBSERVED' }), /Unknown/);
});

test('token observations distinguish user/default-owner and reject PID reuse, token changes and another image', () => {
  const original = token(), expected = { pid: original.pid, imagePath: original.imagePath,
    creationFiletime: original.creationFiletime, token: original };
  assert.equal(validateToken(original, expected), original);
  assert.notEqual(original.userSid, original.defaultOwnerSid);
  for (const changed of [{ pid: 413 }, { creationFiletime: '134398021234567891' }, { imagePath: 'C:\\other\\node.exe' },
    { observerUserSid: 'S-1-5-7' }, { tokenModifiedId: '12003' }, { defaultOwnerSid: original.userSid },
    { elevated: false }, { processAccess: 'PROCESS_ALL_ACCESS' }, { tokenType: 'impersonation' }, { userSid: 'S-1--' }]) {
    assert.throws(() => validateToken({ ...original, ...changed }, expected));
  }
});

test('native file observations keep inherited DACL evidence separate from strict-policy acceptance', () => {
  const result = fileObservation(DATABASE, [DATABASE], metadata());
  assert.equal(result.status, 'PRESENT'); assert.equal(result.metadata.protectedDacl, false);
  assert.equal(result.ownerMatchesObserverUser, false); assert.equal(result.ownerMatchesObserverDefaultOwner, true);
  assert.equal(result.inheritance.status, 'PARSED'); assert.equal(result.inheritance.aces[0].inherited, true);
  assert.equal(result.acceptance, undefined);
  const nullDacl = fileObservation(DATABASE, [DATABASE], { ...metadata(), nullDacl: true, aceCount: null, sddl: 'O:BAD:NO_ACCESS_CONTROL' });
  assert.equal(nullDacl.status, 'PRESENT'); assert.equal(nullDacl.metadata.nullDacl, true);
  assert.equal(aclObservation('O:S-1-5-21-1D:P(A;;FA;;;S-1-5-21-1)').aces[0].inherited, false);
  assert.equal(aclObservation('D:(XA;;FA;;;S-1-5-7;(conditional))').status, 'UNPARSED');
  assert.deepEqual(fileObservation(DATABASE, [], { error: 'missing file', win32Code: 2 }), { name: DATABASE, status: 'ABSENT', win32Code: 2 });
  for (const code of [3, 5, 32, 1920]) assert.throws(() => fileObservation(DATABASE, [], { error: 'query failed', win32Code: code }), /cannot establish/);
  assert.throws(() => fileObservation(DATABASE, [DATABASE], { error: 'query failed', win32Code: 2 }), /cannot establish/);
});

test('diagnostic output cannot use source paths, duplicate arguments or release-report names', () => {
  const directory = os.tmpdir();
  for (const args of [
    ['--build-directory', directory, '--output', path.join(ROOT, 'docs', 'observation.json')],
    ['--build-directory', directory, '--output', path.join(directory, 'release-observation.json')],
    ['--build-directory', directory, '--output', path.join(directory, 'observation.json'), '--build-failed', '--build-failed']
  ]) assert.throws(() => argumentsFor(args));
  assert.equal(argumentsFor(['--build-directory', directory, '--output', path.join(directory, 'sqlite-observation.json')]).buildFailed, false);
});

test('forced termination observations cannot reinterpret a normal or missing exit as a crash', () => {
  assert.equal(forcedExitObserved({ code: 0, signal: null }), false);
  assert.equal(forcedExitObserved({ code: null, signal: null }), false);
  assert.equal(forcedExitObserved(undefined), false);
  assert.equal(forcedExitObserved({ code: 1, signal: null }), true);
  assert.equal(forcedExitObserved({ code: null, signal: 'SIGKILL' }), true);
});

test('unavailable build emits eight NOT_RUN scenarios with every missing phase and explicit cleanup scope', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'panelreply-sqlite-report-harness-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const output = path.join(directory, 'sqlite-observation.json');
  const result = spawnSync(process.execPath, [path.join(ROOT, 'scripts/observe-windows-sqlite.cjs'), '--build-directory',
    path.join(directory, 'missing-build'), '--output', output, '--build-failed'], { encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024 });
  assert.equal(result.error, undefined); assert.equal(result.status, 1, result.stderr);
  const report = JSON.parse(fs.readFileSync(output, 'utf8'));
  assert.equal(report.format, 'panelreply-windows-sqlite-observation-v1'); assert.equal(report.status, 'INCOMPLETE');
  assert.equal(report.scenarios.length, 8); assert.equal(report.totals.notRun, 8);
  assert.ok(report.scenarios.every(item => item.status === 'NOT_RUN' && item.phases.every(phase => phase.status === 'NOT_RUN' && phase.reason)));
  assert.ok(report.infrastructureErrors.length); assert.equal(report.cleanup.status, 'NOT_RUN');
  assert.equal(report.probeLoaded, false); assert.equal(report.acceptance, 'NOT_ESTABLISHED');
  assert.equal(report.releaseCredit, false); assert.equal(report.productPassing, 0); assert.equal(report.sourceChanged, false);
  assert.match(report.sourceTreeSha256, /^[a-f0-9]{64}$/); assert.equal(report.nativeIdentity, null);
});

for (const mode of ['DELETE', 'WAL']) for (const ending of ['close', 'crash']) {
  test('portable protocol ' + mode + ' ' + ending + ' preserves committed rows and releases its owned children', {
    skip: process.platform !== 'linux' ? 'This portable protocol control uses Linux fixtures. Native Windows observation requires verified component artifacts.' : false,
    timeout: 20000
  }, async t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'panelreply-sqlite-protocol-harness-'));
    const sessions = [];
    t.after(async () => { for (const session of sessions) await session.cleanup(); fs.rmSync(directory, { recursive: true, force: true }); });
    const writer = spawnObserver({ directory, mode, role: 'writer', fixtureExecutable: null }); sessions.push(writer);
    const ready = await writer.ready;
    assert.equal(ready.portableHarness, true); assert.equal(ready.token, null); assert.equal(ready.node.pid, writer.child.pid);
    const opened = await writer.request('open', 'opened');
    assert.equal(opened.pragmas.journal_mode, mode.toLowerCase()); assert.equal(opened.sqlite.version, process.versions.sqlite);
    assert.ok(equalData((await writer.request('baseline', 'baseline-committed')).data, 'baseline'));
    assert.ok(equalData((await writer.request('begin', 'transaction-open')).data, 'committed'));
    const openFiles = fs.readdirSync(directory);
    assert.ok(openFiles.includes(DATABASE + (mode === 'WAL' ? '-wal' : '-journal')));
    if (mode === 'WAL') assert.ok(openFiles.includes(DATABASE + '-shm'));
    if (ending === 'close') {
      assert.ok(equalData((await writer.request('commit', 'committed')).data, 'committed'));
      await writer.request('close', 'closed'); await writer.request('exit', 'exiting');
      assert.equal((await writer.waitExit()).code, 0);
    } else {
      await writer.terminate('portable controlled crash');
      assert.equal(writer.record.termination.requestAccepted, true);
      assert.equal(forcedExitObserved(writer.record.exit), true);
      assert.equal(writer.record.messages.at(-1).type, 'transaction-open');
    }
    const recovery = spawnObserver({ directory, mode, role: 'recovery', fixtureExecutable: null }); sessions.push(recovery);
    await recovery.ready;
    const read = await recovery.request('open', 'reopened');
    assert.deepEqual(read.data, expectedData(ending === 'close' ? 'committed' : 'baseline'));
    await recovery.request('close', 'closed'); await recovery.request('exit', 'exiting');
    assert.equal((await recovery.waitExit()).code, 0);
    for (const session of sessions) {
      assert.equal((await session.cleanup()).status, 'OBSERVED'); assert.ok(session.record.closed);
    }
  });
}

test('protocol failure still terminates and records only the already owned child', {
  skip: process.platform !== 'linux' ? 'Linux-only portable protocol control.' : false, timeout: 15000
}, async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'panelreply-sqlite-error-harness-'));
  const session = spawnObserver({ directory, mode: 'DELETE', role: 'writer', fixtureExecutable: null });
  t.after(async () => { await session.cleanup(); fs.rmSync(directory, { recursive: true, force: true }); });
  await session.ready;
  await assert.rejects(session.request('begin', 'transaction-open'), /does not follow/);
  const cleanup = await session.cleanup();
  assert.equal(cleanup.status, 'OBSERVED'); assert.equal(session.record.pid, session.child.pid);
  assert.ok(session.record.messages.some(message => message.type === 'error')); assert.ok(session.record.closed);
});

test('identity rejection still cleans the live ChildProcess without a process lookup or another launch', {
  skip: process.platform !== 'linux' ? 'Linux-only portable protocol control.' : false, timeout: 15000
}, async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'panelreply-sqlite-identity-harness-'));
  const session = spawnObserver({ directory, mode: 'DELETE', role: 'writer', fixtureExecutable: null });
  t.after(async () => { await session.cleanup(); fs.rmSync(directory, { recursive: true, force: true }); });
  const ready = await session.ready;
  assert.throws(() => verifyLive(session, ready, 'unused-native-helper', 'opened', 'ready'), error =>
    error.observationCategory === 'PROCESS_OR_IMAGE_IDENTITY');
  const cleanup = await session.cleanup();
  assert.equal(cleanup.status, 'OBSERVED');
  assert.equal(session.record.termination.reason, 'bounded fixture cleanup');
  assert.equal(session.record.termination.requestAccepted, true);
  assert.equal(session.record.pid, session.child.pid); assert.ok(session.record.closed);
});
