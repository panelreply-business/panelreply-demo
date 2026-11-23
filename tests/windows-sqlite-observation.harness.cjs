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

const { outputLocation, prepareOutputs, JOURNAL_LIMIT } = require('./windows-sqlite-output-support.cjs');
const { main: sqliteObservationMain } = require('../scripts/observe-windows-sqlite.cjs');
const crypto = require('node:crypto');
function outputFixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'panelreply-sqlite-output-'));
  const root = path.join(directory, 'repository'), outside = path.join(directory, 'outside');
  fs.mkdirSync(root); fs.mkdirSync(outside);
  return { directory, root, outside, output: path.join(outside, 'observation.json'),
    journal: path.join(outside, 'observation.observations.jsonl'), cleanup: () => fs.rmSync(directory, { recursive: true, force: true }) };
}
function aliasDirectory(target, filename) { fs.symlinkSync(target, filename, process.platform === 'win32' ? 'junction' : 'dir'); }
const outputIo = overrides => ({ ...fs, ...overrides });

test('SQLite output repository aliases fail before artifact preparation or native collection', async () => {
  const fixture = outputFixture(); let collects = 0, prepares = 0;
  try {
    const alias = path.join(fixture.outside, 'actual-repository-alias'); aliasDirectory(ROOT, alias);
    const target = path.join(alias, 'sqlite-output-boundary-probe.json');
    assert.throws(() => argumentsFor(['--build-directory', fixture.outside, '--output', target]), error => error.code === 'OUTPUT_OVERLAP');
    await assert.rejects(sqliteObservationMain(['--build-directory', fixture.outside, '--output', target], {
      prepare: () => { prepares++; throw new Error('Must not prepare'); }, collect: async () => { collects++; },
    }), error => error.code === 'OUTPUT_OVERLAP');
    assert.equal(prepares, 0); assert.equal(collects, 0);
    assert.equal(fs.existsSync(path.join(ROOT, 'sqlite-output-boundary-probe.json')), false);
  } finally { fixture.cleanup(); }
});

test('SQLite outputs resolve raw alias parent traversal and reject in-repository artifacts directories', () => {
  const fixture = outputFixture();
  try {
    const nested = path.join(fixture.root, 'nested'); fs.mkdirSync(nested);
    const alias = path.join(fixture.outside, 'nested-alias'); aliasDirectory(nested, alias);
    const raw = alias + path.sep + '..' + path.sep + 'observation.json';
    const nativeParent = fs.realpathSync.native(path.dirname(raw));
    if (nativeParent === fs.realpathSync.native(fixture.root)) assert.throws(() => outputLocation(raw, { root: fixture.root }), error => error.code === 'OUTPUT_OVERLAP');
    else assert.equal(outputLocation(raw, { root: fixture.root }).canonicalParent, nativeParent);
    const artifacts = path.join(fixture.root, 'artifacts'); fs.mkdirSync(artifacts);
    assert.throws(() => outputLocation(path.join(artifacts, 'observation.json'), { root: fixture.root }), error => error.code === 'OUTPUT_OVERLAP');
    assert.throws(() => outputLocation('relative.json', { root: fixture.root }), error => error.code === 'OUTPUT_PATH_INVALID');
    assert.throws(() => outputLocation(path.join(fixture.directory, 'ancestor.json'), { root: fixture.root }), error => error.code === 'OUTPUT_OVERLAP');
    assert.deepEqual(fs.readdirSync(fixture.outside), ['nested-alias']);
  } finally { fixture.cleanup(); }
});

test('SQLite output missing or unresolved parents create neither report nor journal', () => {
  const fixture = outputFixture();
  try {
    assert.throws(() => prepareOutputs(path.join(fixture.outside, 'missing', 'observation.json'), { root: fixture.root }), error => error.code === 'OUTPUT_PARENT_UNAVAILABLE');
    const realpathSync = Object.assign((...args) => fs.realpathSync(...args), { native: filename => {
      if (filename === fixture.outside) throw Object.assign(new Error('PRIVATE resolution failure'), { code: 'ELOOP' });
      return fs.realpathSync.native(filename);
    } });
    assert.throws(() => prepareOutputs(fixture.output, { root: fixture.root, fsImpl: outputIo({ realpathSync }) }), error => error.code === 'OUTPUT_PARENT_UNAVAILABLE');
    assert.deepEqual(fs.readdirSync(fixture.outside), []);
  } finally { fixture.cleanup(); }
});

test('SQLite report and journal existing or dangling leaves are rejected before either creation', () => {
  for (const kind of ['report', 'journal']) for (const dangling of [false, true]) {
    const fixture = outputFixture();
    try {
      const occupied = kind === 'report' ? fixture.output : fixture.journal;
      if (dangling) fs.symlinkSync(path.join(fixture.directory, 'missing'), occupied, process.platform === 'win32' ? 'junction' : 'file');
      else fs.writeFileSync(occupied, 'existing owner evidence');
      assert.throws(() => prepareOutputs(fixture.output, { root: fixture.root }), error => error.code === 'OUTPUT_ALREADY_EXISTS'
        && error.outputState.report.state === 'NOT_CREATED' && error.outputState.journal.state === 'NOT_CREATED');
      assert.equal(fs.existsSync(kind === 'report' ? fixture.journal : fixture.output), false);
      if (dangling) assert.equal(fs.lstatSync(occupied).isSymbolicLink(), true);
      else assert.equal(fs.readFileSync(occupied, 'utf8'), 'existing owner evidence');
    } finally { fixture.cleanup(); }
  }
});

test('a journal creation collision closes and retains the report without touching the collision file', () => {
  const fixture = outputFixture(); let closes = 0;
  try {
    const io = outputIo({ openSync: (filename, ...args) => {
      if (filename === fixture.journal) fs.writeFileSync(filename, 'raced journal bytes');
      return fs.openSync(filename, ...args);
    }, closeSync: fd => { closes++; fs.closeSync(fd); } });
    assert.throws(() => prepareOutputs(fixture.output, { root: fixture.root, fsImpl: io }), error => error.code === 'OUTPUT_OPEN_FAILED'
      && error.outputState.report.state === 'CREATED_RETAINED' && error.outputState.report.descriptorClosed
      && error.outputState.journal.state === 'NOT_CREATED');
    assert.equal(closes, 1); assert.equal(fs.statSync(fixture.output).size, 0);
    assert.equal(fs.readFileSync(fixture.journal, 'utf8'), 'raced journal bytes');
  } finally { fixture.cleanup(); }
});

test('SQLite report and journal use two exclusive held descriptors with UTF8 byte and hash evidence', () => {
  const fixture = outputFixture(), opens = [], writes = [], closes = []; let outputs;
  try {
    const io = outputIo({ openSync: (...args) => { opens.push(args); return fs.openSync(...args); },
      writeFileSync: (fd, ...args) => { writes.push(fd); assert.equal(typeof fd, 'number'); return fs.writeFileSync(fd, ...args); },
      closeSync: fd => { closes.push(fd); fs.closeSync(fd); } });
    outputs = prepareOutputs(fixture.output, { root: fixture.root, fsImpl: io });
    assert.equal(opens.length, 2); assert.ok(opens.every(args => args[1] & fs.constants.O_EXCL));
    assert.ok(opens.find(args => args[0] === fixture.journal)[1] & fs.constants.O_APPEND);
    const values = [{ phase: 'prepared' }, { text: 'Δ label' }];
    for (const value of values) outputs.appendJournal(value);
    const expected = values.map(value => JSON.stringify(value) + '\n').join('');
    const evidence = outputs.journalEvidence();
    assert.equal(evidence.bytesVerified, Buffer.byteLength(expected));
    assert.equal(evidence.sha256OfVerifiedAppends, crypto.createHash('sha256').update(expected).digest('hex'));
    assert.equal(evidence.verification, 'OBSERVED'); assert.equal(evidence.failed, false);
    outputs.writeReport({ status: 'INCOMPLETE', releaseCredit: false, productPassing: 0, journalEvidence: evidence });
    outputs.finish();
    assert.equal(new Set(writes).size, 2); assert.equal(closes.length, 2);
    assert.ok(Object.values(outputs.state()).every(row => row.descriptorClosed));
    assert.equal(fs.readFileSync(fixture.journal, 'utf8'), expected);
    assert.equal(JSON.parse(fs.readFileSync(fixture.output, 'utf8')).productPassing, 0);
    assert.deepEqual(fs.readdirSync(fixture.root), []);
  } finally { outputs?.close(); fixture.cleanup(); }
});

test('SQLite journal limit rejects overflow before writing and preserves the verified prefix', () => {
  const fixture = outputFixture(); let outputs;
  try {
    outputs = prepareOutputs(fixture.output, { root: fixture.root }); outputs.appendJournal({ phase: 'prepared' });
    const before = fs.readFileSync(fixture.journal), evidence = outputs.journalEvidence();
    assert.throws(() => outputs.appendJournal({ oversized: 'x'.repeat(JOURNAL_LIMIT) }), error => error.code === 'OUTPUT_JOURNAL_LIMIT');
    assert.deepEqual(fs.readFileSync(fixture.journal), before);
    assert.equal(outputs.journalEvidence().bytesVerified, evidence.bytesVerified);
    outputs.writeReport({ status: 'INCOMPLETE', error: 'OUTPUT_JOURNAL_LIMIT' }); outputs.finish();
  } finally { outputs?.close(); fixture.cleanup(); }
});

test('parent replacement during output creation closes the report before journal or native work', () => {
  const fixture = outputFixture(); const parked = path.join(fixture.directory, 'parked'); let closes = 0;
  try {
    const io = outputIo({ openSync: (...args) => {
      const fd = fs.openSync(...args); fs.renameSync(fixture.outside, parked); aliasDirectory(fixture.root, fixture.outside); return fd;
    }, closeSync: fd => { closes++; fs.closeSync(fd); } });
    assert.throws(() => prepareOutputs(fixture.output, { root: fixture.root, fsImpl: io }), error => error.code === 'OUTPUT_OVERLAP'
      && error.outputState.report.descriptorClosed && error.outputState.journal.state === 'NOT_CREATED');
    assert.equal(closes, 1); assert.equal(fs.statSync(path.join(parked, 'observation.json')).size, 0);
    assert.deepEqual(fs.readdirSync(fixture.root), []);
  } finally { fixture.cleanup(); }
});

test('replaced journal leaves remain untouched while a separate retained report preserves the error', () => {
  const fixture = outputFixture(); let outputs;
  try {
    outputs = prepareOutputs(fixture.output, { root: fixture.root });
    const parked = path.join(fixture.outside, 'owned-journal.jsonl'); fs.renameSync(fixture.journal, parked); fs.writeFileSync(fixture.journal, 'replacement journal');
    assert.throws(() => outputs.appendJournal({ phase: 'opened' }), error => error.code === 'OUTPUT_IDENTITY_CHANGED');
    const evidence = outputs.journalEvidence(); assert.equal(evidence.failed, true); assert.equal(evidence.verification, 'ERROR');
    outputs.writeReport({ status: 'INCOMPLETE', journalEvidence: evidence });
    assert.throws(() => outputs.finish(), error => error.code === 'OUTPUT_IDENTITY_CHANGED');
    assert.ok(Object.values(outputs.state()).every(row => row.descriptorClosed));
    assert.equal(fs.readFileSync(fixture.journal, 'utf8'), 'replacement journal'); assert.equal(fs.statSync(parked).size, 0);
    assert.equal(JSON.parse(fs.readFileSync(fixture.output, 'utf8')).status, 'INCOMPLETE');
  } finally { outputs?.close(); fixture.cleanup(); }
});

test('replaced report leaves cannot receive held writes or be deleted during cleanup', () => {
  const fixture = outputFixture(); let outputs;
  try {
    outputs = prepareOutputs(fixture.output, { root: fixture.root }); outputs.appendJournal({ phase: 'prepared' });
    const parked = path.join(fixture.outside, 'owned-report.json'); fs.renameSync(fixture.output, parked); fs.writeFileSync(fixture.output, 'replacement report');
    assert.throws(() => outputs.writeReport({ status: 'INCOMPLETE' }), error => error.code === 'OUTPUT_IDENTITY_CHANGED');
    assert.throws(() => outputs.finish(), error => error.code === 'OUTPUT_IDENTITY_CHANGED');
    assert.equal(fs.readFileSync(fixture.output, 'utf8'), 'replacement report'); assert.equal(fs.statSync(parked).size, 0);
    assert.equal(fs.readFileSync(fixture.journal, 'utf8'), '{"phase":"prepared"}\n');
    assert.ok(Object.values(outputs.state()).every(row => row.descriptorClosed));
  } finally { outputs?.close(); fixture.cleanup(); }
});

test('journal changes after the last append fail final evidence verification', () => {
  const fixture = outputFixture(); let outputs;
  try {
    outputs = prepareOutputs(fixture.output, { root: fixture.root }); outputs.appendJournal({ phase: 'closed' });
    fs.appendFileSync(fixture.journal, 'unplanned tail');
    const evidence = outputs.journalEvidence(); assert.equal(evidence.verification, 'ERROR'); assert.equal(evidence.failed, true);
    outputs.writeReport({ status: 'INCOMPLETE', journalEvidence: evidence });
    assert.throws(() => outputs.finish(), error => error.code === 'OUTPUT_IDENTITY_CHANGED');
    assert.ok(fs.readFileSync(fixture.journal, 'utf8').endsWith('unplanned tail'));
  } finally { outputs?.close(); fixture.cleanup(); }
});

test('partial journal write failures retain bytes and permit a separate incomplete report', () => {
  const fixture = outputFixture(); let outputs, journalFd;
  try {
    const io = outputIo({ openSync: (filename, ...args) => { const fd = fs.openSync(filename, ...args); if (filename === fixture.journal) journalFd = fd; return fd; },
      writeFileSync: (fd, value, ...args) => { if (fd === journalFd) { fs.writeFileSync(fd, String(value).slice(0, 2)); throw Object.assign(new Error('PRIVATE write failure'), { code: 'EIO' }); } return fs.writeFileSync(fd, value, ...args); } });
    outputs = prepareOutputs(fixture.output, { root: fixture.root, fsImpl: io });
    assert.throws(() => outputs.appendJournal({ phase: 'prepared' }), error => error.code === 'OUTPUT_WRITE_FAILED');
    const evidence = outputs.journalEvidence(); assert.equal(evidence.failed, true); assert.equal(evidence.bytesVerified, 0);
    outputs.writeReport({ status: 'INCOMPLETE', journalEvidence: evidence });
    assert.throws(() => outputs.finish(), error => error.code === 'OUTPUT_IDENTITY_CHANGED');
    assert.equal(fs.statSync(fixture.journal).size, 2);
    assert.equal(JSON.parse(fs.readFileSync(fixture.output, 'utf8')).status, 'INCOMPLETE');
    assert.ok(Object.values(outputs.state()).every(row => row.descriptorClosed));
  } finally { outputs?.close(); fixture.cleanup(); }
});

test('SQLite collection errors remain primary while both output descriptors close after a close error', async () => {
  const fixture = outputFixture(); let closes = 0, collects = 0;
  const primary = Object.assign(new Error('PRIVATE collection failure'), { code: 'EACCES' });
  try {
    const io = outputIo({ closeSync: fd => { closes++; fs.closeSync(fd); if (closes === 1) throw Object.assign(new Error('PRIVATE close failure'), { code: 'EIO' }); } });
    await assert.rejects(sqliteObservationMain(['--build-directory', fixture.outside, '--output', fixture.output, '--build-failed'], {
      prepare: output => prepareOutputs(output, { root: fixture.root, fsImpl: io }), collect: async () => { collects++; throw primary; },
    }), error => error.code === 'EACCES' && error.cause === primary && error.outputState.report.closeErrorCode === 'EIO'
      && !error.outputState.report.descriptorClosed && error.outputState.journal.descriptorClosed);
    assert.equal(collects, 1); assert.equal(closes, 2);
    assert.equal(fs.statSync(fixture.output).size, 0); assert.equal(fs.statSync(fixture.journal).size, 0);
  } finally { fixture.cleanup(); }
});
