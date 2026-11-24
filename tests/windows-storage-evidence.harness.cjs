'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { CASES, TEST_FILE } = require('./windows-storage-cases.cjs');
const { fixture } = require('./windows-storage-support.cjs');
const { completeOutcomes, rawLeafOutcomes, argumentsFor, collectComponent, main } = require('../scripts/run-windows-storage.cjs');
const { LIMITS, outputLocation, prepareOutputs } = require('./windows-storage-output-support.cjs');
const { PREFIX, CHANNEL_ENV, MAX_RECORD_BYTES, MAX_RECORDS, MAX_JOURNAL_BYTES, MAX_FRAME_BYTES, MAX_STREAM_BYTES,
  createObservationPublisher, createObservationReceiver } = require('./windows-storage-observation-protocol.cjs');
const { validateManifest, PINS, ARTIFACTS, REJECTED_OVERRIDES } = require('../workspace/native/windows-storage/load.cjs');
const ROOT = path.resolve(__dirname, '..');
const source = { sourceCommit: '1'.repeat(40), sourceTreeSha256: '2'.repeat(64) };

test('native fixture failures preserve their Windows reason without converting required success to a pass', () => {
  const diagnostic = { error: 'Could not inspect fixture security', win32Code: 5 };
  const args = ['-e', 'process.stdout.write(' + JSON.stringify(JSON.stringify(diagnostic)) + '); process.exit(2)'];
  assert.throws(() => fixture(process.execPath, args), error => {
    assert.equal(error.status, 2);
    assert.equal(error.win32Code, 5);
    assert.equal(error.fixtureDiagnostic, diagnostic.error);
    assert.match(error.message, /Could not inspect fixture security \(Windows 5\)/);
    return true;
  });
  assert.deepEqual(fixture(process.execPath, args, { allowFailure: true }), diagnostic);
  for (const output of ['{partial', JSON.stringify({ error: 'No numeric code' }),
    JSON.stringify({ error: 'x'.repeat(4097), win32Code: 5 }),
    JSON.stringify({ error: 'Invalid code', win32Code: -1 })]) {
    assert.throws(() => fixture(process.execPath,
      ['-e', 'process.stdout.write(' + JSON.stringify(output) + '); process.exit(2)'], { allowFailure: true }),
    error => error.status === 2 && error.win32Code === undefined);
  }
});

function manifest() {
  return {
    format: 'panelreply-windows-storage-build-v1', node: PINS.node, platform: 'win32', architecture: 'x64',
    ...source, nodeExecutableSha256: PINS.nodeExecutableSha256, windowsSdk: PINS.windowsSdk,
    environmentOverrides: { rejected: [...REJECTED_OVERRIDES], detected: [] },
    compiler: { path: 'C:/Compiler/cl.exe', version: '19.44.35222.0', sha256: '3'.repeat(64) },
    cmake: { path: 'C:/CMake/cmake.exe', version: '3.31.6', sha256: '4'.repeat(64) },
    tar: { path: 'C:/Windows/System32/tar.exe', sha256: '5'.repeat(64) },
    headers: { count: 2, sha256: '6'.repeat(64) },
    configuredToolchain: { sha256: '7'.repeat(64), observed: {
      generator: PINS.generator, platform: PINS.architecture, toolset: PINS.toolset, windowsSdk: PINS.windowsSdk,
      compiler: 'C:/Compiler/cl.exe', compilerId: 'MSVC', compilerVersion: '19.44.35222.0', cmakeVersion: '3.31.6'
    } },
    checksumManifest: { url: PINS.distribution + 'SHASUMS256.txt', sha256: '8'.repeat(64) },
    dependencies: PINS.dependencies.map(item => ({ ...item, bytes: 100, url: PINS.distribution + item.name })),
    artifacts: ARTIFACTS.map((name, index) => ({ name, target: name.replace(/\.(node|exe)$/, ''), bytes: 100,
      sha256: String(index + 1).repeat(64), projectSha256: '9'.repeat(64), testInstrumented: index === 1 }))
  };
}

test('component accounting retains every known method and marks only missing methods NOT_RUN', () => {
  const identity = { observed: ARTIFACTS.map((name, index) => ({ name, sha256: String(index + 1).repeat(64), testInstrumented: index === 1 })) };
  const actual = [{ name: CASES[0].id, status: 'PASS', durationMs: 12 }, { name: CASES[1].id, status: 'FAIL', diagnostic: 'real native failure' }];
  const result = completeOutcomes(actual, identity, 'windows/x86_64/node24');
  assert.equal(result.tests.length, CASES.length);
  assert.equal(result.tests[0].status, 'PASS'); assert.equal(result.tests[1].status, 'FAIL');
  assert.equal(result.tests[1].diagnostic, 'real native failure');
  assert.equal(result.tests.filter(item => item.status === 'NOT_RUN').length, CASES.length - 2);
  assert.ok(result.tests.every(item => item.releaseCredit === false && item.kind === 'component' && item.productScope === null));
  assert.ok(result.tests.filter(item => item.testInstrumented).every(item => item.artifacts.length === 2 && item.artifacts.some(artifact => artifact.testInstrumented)));
  assert.ok(result.tests.filter(item => !item.testInstrumented).every(item => item.artifacts.length === 1 && item.artifacts[0].name === ARTIFACTS[0]));
});

test('an unexpected method cannot erase an observed failure or pass', () => {
  const result = completeOutcomes([
    { name: CASES[0].id, status: 'FAIL', diagnostic: 'confirmed access failure' },
    { name: CASES[1].id, status: 'PASS' }, { name: 'unreviewed method', status: 'PASS' }
  ], null, 'windows/x86_64/node24');
  assert.equal(result.tests[0].status, 'FAIL'); assert.equal(result.tests[1].status, 'PASS');
  assert.equal(result.tests[0].diagnostic, 'confirmed access failure');
  assert.equal(result.accountingErrors.length, 1);
  assert.equal(result.unexpectedOutcomes[0].name, 'unreviewed method');
});

test('duplicate methods retain their observations and cannot erase another executed failure', () => {
  const result = completeOutcomes([
    { name: CASES[0].id, status: 'PASS' }, { name: CASES[0].id, status: 'FAIL', diagnostic: 'second execution failed' },
    { name: CASES[1].id, status: 'FAIL', diagnostic: 'separate failure' }
  ], null, 'windows/x86_64/node24');
  assert.equal(result.tests[0].status, 'FAIL');
  assert.deepEqual(result.tests[0].observedOutcomes.map(item => item.status), ['PASS', 'FAIL']);
  assert.equal(result.tests[1].status, 'FAIL'); assert.equal(result.tests[1].diagnostic, 'separate failure');
  assert.equal(result.accountingErrors.length, 1);
});

test('strict parser failure fallback preserves explicit native failure and unavailable capability statuses', () => {
  const results = rawLeafOutcomes([
    { type: 'test:fail', data: { name: CASES[0].id, line: 20, details: { error: { message: 'native fault' } } } },
    { type: 'test:pass', data: { name: CASES[1].id, line: 21, skip: 'token unavailable' } },
    { type: 'test:fail', data: { name: CASES[2].id, line: 22, details: { error: { failureType: 'cancelledByParent' } } } },
    { type: 'test:fail', data: { name: 'file wrapper' } }
  ]);
  assert.deepEqual(results.map(item => item.status), ['FAIL', 'SKIP', 'CANCELLED']);
  assert.equal(results[0].diagnostic, 'native fault');
});

test('native manifest requires observed SDK, compiler, dependencies and separate probe attribution', () => {
  validateManifest(manifest(), source);
  const invalid = [
    item => { delete item.compiler; }, item => { delete item.cmake; }, item => { delete item.tar; },
    item => { delete item.dependencies; }, item => { delete item.checksumManifest; }, item => { delete item.headers; },
    item => { item.windowsSdk = '10.0.99999.0'; },
    item => { item.configuredToolchain.observed.windowsSdk = '10.0.99999.0'; },
    item => { item.configuredToolchain.observed.compilerVersion = '19.45.1'; },
    item => { item.configuredToolchain.observed.compilerId = 'Clang'; },
    item => { item.cmake.version = '3.26.0'; item.configuredToolchain.observed.cmakeVersion = '3.26.0'; },
    item => { item.nodeExecutableSha256 = '0'.repeat(64); },
    item => { item.dependencies[0].sha256 = '0'.repeat(64); },
    item => { item.dependencies[1] = { ...item.dependencies[0] }; },
    item => { item.artifacts[0].testInstrumented = true; },
    item => { item.artifacts[1].testInstrumented = false; },
    item => { item.artifacts[1].target = item.artifacts[0].target; },
    item => { delete item.artifacts[0].projectSha256; },
    item => { item.environmentOverrides.detected.push('CL'); },
    item => { item.environmentOverrides.rejected = []; },
    item => { item.sourceTreeSha256 = 'f'.repeat(64); }
  ];
  for (const mutate of invalid) {
    const value = manifest(); mutate(value);
    assert.throws(() => validateManifest(value, source));
  }
});

test('component output paths cannot enter source manifests or masquerade as release evidence', () => {
  assert.throws(() => argumentsFor(['--build-directory', os.tmpdir(), '--output', path.join(ROOT, 'docs', 'native-report.json')]));
  assert.throws(() => argumentsFor(['--build-directory', os.tmpdir(), '--output', path.join(os.tmpdir(), 'release-windows.json')]));
  const accepted = argumentsFor(['--build-directory', os.tmpdir(), '--output', path.join(os.tmpdir(), 'windows-storage-component.json'), '--build-failed']);
  assert.equal(accepted.buildFailed, true);
});

for (const failedBuild of [true, false]) {
  test(failedBuild ? 'failed native build still writes all known NOT_RUN outcomes' : 'unavailable native build cannot silently omit component outcomes', t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'panelreply-windows-component-harness-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const output = path.join(root, 'windows-storage-component.json');
    const args = [path.join(ROOT, 'scripts/run-windows-storage.cjs'), '--build-directory', path.join(root, 'missing-build'), '--output', output];
    if (failedBuild) args.push('--build-failed');
    const result = spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024 });
    assert.equal(result.error, undefined); assert.equal(result.status, 1, result.stderr);
    const report = JSON.parse(fs.readFileSync(output, 'utf8'));
    assert.equal(report.format, 'panelreply-windows-storage-component-v1');
    assert.equal(report.tests.length, CASES.length);
    assert.ok(report.tests.every(item => item.status === 'NOT_RUN'));
    assert.equal(report.totals.notRun, CASES.length); assert.equal(report.totals.passed, 0);
    assert.ok(report.infrastructureErrors.length >= 1);
    assert.equal(report.summarySuccess, false); assert.equal(report.productPassing, 0); assert.equal(report.releaseCredit, false);
    assert.equal(report.sourceChanged, false); assert.match(report.sourceTreeSha256, /^[a-f0-9]{64}$/);
    assert.equal(report.buildFailed, failedBuild);
    assert.ok(fs.existsSync(report.logPath)); assert.ok(fs.existsSync(report.observationsPath));
  });
}

// These cases exercise evidence plumbing with owned files and synthetic Node
// children. They never load the native candidate or confer native/product credit.
function evidenceFixture(t) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'panelreply-component-output-harness-'));
  // RUNNER_TEMP can use an 8.3 alias on Windows. Fault hooks and FD maps use the
  // same canonical spelling as the output helper.
  const base = fs.realpathSync.native(temporary);
  const root = path.join(base, 'repository'), outside = path.join(base, 'outside');
  fs.mkdirSync(root); fs.mkdirSync(outside);
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  return { base, root, outside, output: path.join(outside, 'component.json') };
}
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const outputNames = output => [output, output.replace(/\.json$/, '.log'), output.replace(/\.json$/, '.observations.jsonl')];
const channel = 'a'.repeat(64);
function observation(index = 0, details = {}) {
  return JSON.stringify({ case: CASES[index].id, event: 'body-failed', at: '2026-11-24T00:00:00.000Z', details });
}
function recordFrame(value, index = 1, token = channel) {
  return PREFIX + token + ' RECORD ' + index + ' ' + Buffer.from(value).toString('base64') + '\n';
}
function transport(values, token = channel) {
  const journal = values.map(value => value + '\n').join('');
  return [PREFIX + token + ' START 0\n', ...values.map((value, index) => recordFrame(value, index + 1, token)),
    PREFIX + token + ' END ' + values.length + ' ' + Buffer.byteLength(journal) + ' ' + digest(journal) + '\n'];
}
function captureReceiver(token = channel) {
  const journal = [], log = [];
  return { journal, log, receiver: createObservationReceiver(token, {
    appendJournal: value => journal.push(value), appendLog: value => log.push(value),
  }) };
}
function nativeEvent(index, status, message = 'Owned synthetic native assertion') {
  return { type: status === 'PASS' ? 'test:pass' : 'test:fail', data: { name: CASES[index].id,
    file: path.join(ROOT, TEST_FILE), line: 100 + index, testId: index + 1, parentId: 0,
    details: { duration_ms: 1, ...(status === 'PASS' ? {} : { error: { message } }) } } };
}
function syntheticDependencies(fixture, generate) {
  const calls = { source: 0, load: 0, run: 0 };
  const identity = { root: fixture.outside, manifestSha256: '3'.repeat(64),
    observed: ARTIFACTS.map(name => ({ name, sha256: '4'.repeat(64) })) };
  return { calls, dependencies: {
    source() { calls.source++; return { ...source, sourceManifest: [], dirty: false }; },
    platform() { return { platformKey: 'synthetic/component-output-harness' }; },
    load() { calls.load++; return { identity, fixtureExecutable: 'synthetic-not-executed' }; },
    inspect() { return identity; }, selectParent() { return { path: fixture.outside }; },
    async *run(options) { calls.run++; yield* generate(process.env[CHANNEL_ENV], options); },
  } };
}

test('component canonical parent guards reject repository aliases, alias dot segments and unavailable parents', async t => {
  const fixture = evidenceFixture(t), inside = path.join(fixture.root, 'inside');
  fs.mkdirSync(inside);
  const alias = path.join(fixture.base, 'repository-alias');
  fs.symlinkSync(inside, alias, 'junction');
  const invalid = [path.join(fixture.root, 'report.json'), path.join(alias, 'report.json'),
    alias + path.sep + '..' + path.sep + 'report.json', path.join(fixture.base, 'report.json'),
    path.join(fixture.outside, 'missing', 'report.json'), 'relative.json', path.join(fixture.outside, 'release-component.json'),
    path.join(fixture.outside, 'CON.json'), path.join(fixture.outside, 'file:stream.json')];
  for (const output of invalid) assert.throws(() => outputLocation(output, { root: fixture.root }), /^Error: OUTPUT_/);
  assert.equal(fs.readdirSync(fixture.outside).length, 0);
  const sourceAlias = path.join(fixture.base, 'actual-source-alias');
  fs.symlinkSync(ROOT, sourceAlias, 'junction');
  let collected = false;
  await assert.rejects(main(['--build-directory', fixture.outside, '--output', path.join(sourceAlias, 'component-harness-probe.json')],
    { collect() { collected = true; } }), /OUTPUT_OVERLAP/);
  assert.equal(collected, false);
  assert.equal(fs.existsSync(path.join(ROOT, 'component-harness-probe.json')), false);
});

test('component exclusive preparation preserves every existing output leaf before creating any sibling', t => {
  const fixture = evidenceFixture(t);
  for (let index = 0; index < 4; index++) {
    const parent = path.join(fixture.outside, 'existing-' + index); fs.mkdirSync(parent);
    const output = path.join(parent, 'component.json'), names = outputNames(output);
    const existing = names[index % 3], sentinel = Buffer.from('Owned existing evidence.\n');
    if (index < 3) fs.writeFileSync(existing, sentinel);
    else fs.symlinkSync(path.join(fixture.base, 'missing-junction-target'), existing, 'junction');
    assert.throws(() => prepareOutputs(output, { root: fixture.root }), /OUTPUT_ALREADY_EXISTS/);
    assert.deepEqual(fs.readdirSync(parent), [path.basename(existing)]);
    if (index < 3) assert.deepEqual(fs.readFileSync(existing), sentinel);
    else assert.equal(fs.lstatSync(existing).isSymbolicLink(), true);
  }
});

test('component CLI preserves pre-existing report log and journal bytes without source or native work', t => {
  const fixture = evidenceFixture(t), sentinel = Buffer.from('CLI sentinel.\n');
  for (const filename of outputNames(fixture.output)) fs.writeFileSync(filename, sentinel);
  const result = spawnSync(process.execPath, [path.join(ROOT, 'scripts/run-windows-storage.cjs'), '--build-directory', fixture.outside,
    '--output', fixture.output, '--build-failed'], { encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024 });
  assert.equal(result.error, undefined); assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stderr).code, 'OUTPUT_ALREADY_EXISTS');
  assert.equal(result.stdout, '');
  for (const filename of outputNames(fixture.output)) assert.deepEqual(fs.readFileSync(filename), sentinel);
});

test('component outputs hold exactly three exclusive descriptors and verify short writes and reads before closing', t => {
  const fixture = evidenceFixture(t), opened = [], closed = [];
  const fsImpl = { ...fs,
    openSync(filename, flags, mode) { const fd = fs.openSync(filename, flags, mode); opened.push({ filename, flags, mode, fd }); return fd; },
    writeSync(fd, buffer, offset, length, position) { return fs.writeSync(fd, buffer, offset, Math.min(length, 3), position); },
    readSync(fd, buffer, offset, length, position) { return fs.readSync(fd, buffer, offset, Math.min(length, 2), position); },
    closeSync(fd) { closed.push(fd); return fs.closeSync(fd); },
  };
  const outputs = prepareOutputs(fixture.output, { root: fixture.root, fsImpl });
  t.after(() => outputs.close());
  outputs.appendLog('first Ω\n'); outputs.appendLog('second\n');
  outputs.appendJournal(observation() + '\n'); outputs.writeReport({ owned: true });
  outputs.finish();
  assert.equal(opened.length, 3); assert.equal(new Set(opened.map(item => item.fd)).size, 3);
  assert.ok(opened.every(item => (item.flags & fs.constants.O_EXCL) !== 0 && (item.flags & fs.constants.O_CREAT) !== 0 && item.mode === 0o600));
  assert.deepEqual(closed.sort((a, b) => a - b), opened.map(item => item.fd).sort((a, b) => a - b));
  assert.equal(fs.readFileSync(outputs.logPath, 'utf8'), 'first Ω\nsecond\n');
  assert.equal(fs.readFileSync(outputs.journalPath, 'utf8'), observation() + '\n');
  assert.deepEqual(JSON.parse(fs.readFileSync(outputs.reportPath, 'utf8')), { owned: true });
  for (const [name, state] of Object.entries(outputs.state())) {
    const filename = { report: outputs.reportPath, log: outputs.logPath, journal: outputs.journalPath }[name];
    assert.equal(state.descriptorClosed, true); assert.equal(state.failed, false); assert.equal(state.writeVerified, true);
    assert.equal(state.sha256OfVerifiedBytes, digest(fs.readFileSync(filename)));
    assert.equal(state.bytesVerified, state.bytesWritten);
  }
});

test('component partial exclusive preparation closes created descriptors and preserves all created evidence', t => {
  const fixture = evidenceFixture(t), opened = [], closed = [];
  const fsImpl = { ...fs,
    openSync(filename, ...args) { if (opened.length === 2) throw Object.assign(new Error('Owned open fault'), { code: 'EACCES' });
      const fd = fs.openSync(filename, ...args); opened.push({ filename, fd }); return fd; },
    closeSync(fd) { closed.push(fd); fs.closeSync(fd); },
  };
  assert.throws(() => prepareOutputs(fixture.output, { root: fixture.root, fsImpl }), error => {
    assert.equal(error.code, 'OUTPUT_OPEN_FAILED'); assert.equal(error.outputState.report.descriptorClosed, true);
    assert.equal(error.outputState.log.descriptorClosed, true); assert.equal(error.outputState.journal.state, 'NOT_CREATED'); return true;
  });
  assert.deepEqual(closed, opened.map(item => item.fd));
  assert.deepEqual(fs.readdirSync(fixture.outside).sort(), ['component.json', 'component.log']);
  assert.ok(opened.every(item => fs.statSync(item.filename).size === 0));
});

test('component retargeted input parent is rejected while held output bytes and replacement parent remain untouched', t => {
  const fixture = evidenceFixture(t), other = path.join(fixture.base, 'other-parent'), alias = path.join(fixture.base, 'input-alias');
  fs.mkdirSync(other); fs.symlinkSync(fixture.outside, alias, 'junction');
  const outputs = prepareOutputs(path.join(alias, 'component.json'), { root: fixture.root });
  t.after(() => outputs.close());
  // Retarget the input junction. Do not rename a directory containing held
  // handles, which Windows may correctly deny before a helper can inspect it.
  fs.unlinkSync(alias); fs.symlinkSync(other, alias, 'junction');
  assert.throws(() => outputs.appendLog('must not be written'), /OUTPUT_IDENTITY_CHANGED/);
  assert.equal(fs.readFileSync(outputs.logPath).length, 0);
  assert.deepEqual(fs.readdirSync(other), []);
  assert.throws(() => outputs.finish(), /OUTPUT_IDENTITY_CHANGED/);
  assert.ok(Object.values(outputs.state()).every(item => item.descriptorClosed));
});

test('component changed leaf identity and hard links fail before appending without altering other bytes', t => {
  const fixture = evidenceFixture(t); let substitute = false;
  const foreign = path.join(fixture.outside, 'foreign.log'); fs.writeFileSync(foreign, 'foreign sentinel');
  const logPath = fixture.output.replace(/\.json$/, '.log');
  const fsImpl = { ...fs, lstatSync(filename, options) {
    return fs.lstatSync(substitute && filename === logPath ? foreign : filename, options);
  } };
  const outputs = prepareOutputs(fixture.output, { root: fixture.root, fsImpl }); t.after(() => outputs.close());
  substitute = true;
  assert.throws(() => outputs.appendLog('refuse changed named identity'), /OUTPUT_IDENTITY_CHANGED/);
  assert.equal(fs.readFileSync(logPath).length, 0); assert.equal(fs.readFileSync(foreign, 'utf8'), 'foreign sentinel');
  substitute = false;
  fs.linkSync(outputs.journalPath, path.join(fixture.outside, 'journal-alias'));
  assert.throws(() => outputs.appendJournal('refuse hard link'), /OUTPUT_IDENTITY_CHANGED/);
  assert.equal(fs.readFileSync(outputs.journalPath).length, 0);
  assert.throws(() => outputs.finish(), /OUTPUT_/);
});

test('component write sync and readback faults preserve bytes and cannot produce verified output', t => {
  const fixture = evidenceFixture(t);
  for (const fault of ['zero-write', 'write-error', 'sync-error', 'readback-corruption']) {
    const parent = path.join(fixture.outside, fault); fs.mkdirSync(parent);
    const output = path.join(parent, 'component.json'); let injected = false;
    const fsImpl = { ...fs,
      writeSync(fd, buffer, offset, length, position) {
        if (fault === 'zero-write') return 0;
        if (fault === 'write-error') throw Object.assign(new Error('Owned write fault'), { code: 'ENOSPC' });
        return fs.writeSync(fd, buffer, offset, length, position);
      },
      fsyncSync(fd) { if (fault === 'sync-error') throw Object.assign(new Error('Owned sync fault'), { code: 'EIO' }); return fs.fsyncSync(fd); },
      readSync(fd, buffer, offset, length, position) { const count = fs.readSync(fd, buffer, offset, length, position);
        if (fault === 'readback-corruption' && !injected && count) { buffer[offset] ^= 1; injected = true; } return count; },
    };
    const outputs = prepareOutputs(output, { root: fixture.root, fsImpl });
    assert.throws(() => outputs.appendLog('retained write attempt\n'), /OUTPUT_(?:WRITE|READBACK)_FAILED/);
    const state = outputs.state().log;
    assert.equal(state.failed, true); assert.equal(state.writeVerified, false); assert.equal(state.bytesVerified, 0);
    const expectedWritten = ['sync-error', 'readback-corruption'].includes(fault) ? Buffer.byteLength('retained write attempt\n') : 0;
    assert.equal(state.bytesWritten, expectedWritten); assert.equal(fs.statSync(outputs.logPath).size, expectedWritten);
    assert.throws(() => outputs.finish(), /OUTPUT_/);
    assert.ok(Object.values(outputs.state()).every(item => item.descriptorClosed));
  }
});

test('component report log and journal byte bounds reject excess data before the first write', t => {
  const fixture = evidenceFixture(t);
  for (const name of ['report', 'log', 'journal']) {
    const parent = path.join(fixture.outside, name); fs.mkdirSync(parent);
    const outputs = prepareOutputs(path.join(parent, 'component.json'), { root: fixture.root });
    const operations = { report: () => outputs.writeReport({ value: 'x'.repeat(LIMITS.report) }),
      log: () => outputs.appendLog('x'.repeat(LIMITS.log + 1)), journal: () => outputs.appendJournal('x'.repeat(LIMITS.journal + 1)) };
    assert.throws(operations[name], new RegExp('OUTPUT_' + name.toUpperCase() + '_LIMIT'));
    assert.equal(outputs.state()[name].bytesWritten, 0); assert.equal(outputs.state()[name].failed, true);
    outputs.close();
    assert.ok(outputNames(outputs.reportPath).every(filename => fs.statSync(filename).size === 0));
  }
});

test('component finalization allows post-close timestamp updates but rejects post-close identity replacement', t => {
  const fixture = evidenceFixture(t);
  for (const replace of [false, true]) {
    const parent = path.join(fixture.outside, String(replace)); fs.mkdirSync(parent);
    const output = path.join(parent, 'component.json'), held = new Map(), closed = new Set();
    const fsImpl = { ...fs,
      openSync(filename, ...args) { const fd = fs.openSync(filename, ...args); held.set(fd, filename); return fd; },
      closeSync(fd) { fs.closeSync(fd); closed.add(held.get(fd)); },
      lstatSync(filename, options) { const value = fs.lstatSync(filename, options);
        if (closed.has(filename)) { value.mtimeNs += 1n; value.ctimeNs += 1n; if (replace && filename === output) value.ino += 1n; }
        return value; },
    };
    const outputs = prepareOutputs(output, { root: fixture.root, fsImpl });
    outputs.writeReport({ retained: true }); outputs.appendLog('log\n'); outputs.appendJournal('journal\n');
    if (replace) assert.throws(() => outputs.finish(), /OUTPUT_IDENTITY_CHANGED/);
    else outputs.finish();
    assert.equal(closed.size, 3);
  }
});

test('component protocol preserves original JSON across split and combined frames and separates ordinary stdout', async () => {
  const frames = [];
  const publisher = createObservationPublisher(channel, (frame, callback) => { frames.push(frame); callback(); });
  publisher.record(CASES[0].id, 'started', { label: 'Ω / synthetic fixture', bytes: 256 });
  publisher.record(CASES[0].id, 'body-failed', { code: 'OWNED_FAILURE', message: 'retained original outcome' });
  await publisher.finish();
  const captured = captureReceiver(), wire = 'ordinary stdout\n' + frames.join('') + 'last stdout';
  let cursor = 0, width = 1;
  while (cursor < wire.length) { const next = Math.min(wire.length, cursor + width); captured.receiver.push(wire.slice(cursor, next)); cursor = next; width = width === 137 ? 1 : width + 1; }
  const result = captured.receiver.finish();
  const original = frames.filter(frame => frame.includes(' RECORD ')).map(frame => Buffer.from(frame.trimEnd().split(' ').at(-1), 'base64').toString('utf8') + '\n').join('');
  assert.equal(captured.journal.join(''), original); assert.equal(captured.log.join(''), 'ordinary stdout\nlast stdout');
  assert.equal(result.state, 'OBSERVED'); assert.equal(result.records, 2); assert.equal(result.bytes, Buffer.byteLength(original));
  assert.equal(result.sha256, digest(original));
});

test('component protocol rejects malformed channels sequences encodings shapes and digests while retaining valid prefix records', () => {
  const first = observation(0, { failure: 'retained' }), second = observation(1);
  const invalid = [
    PREFIX + 'b'.repeat(64) + ' RECORD 2 ' + Buffer.from(second).toString('base64') + '\n',
    recordFrame(second, 3), recordFrame(second, 1),
    PREFIX + channel + ' RECORD 2 !!!!\n',
    PREFIX + channel + ' RECORD 2 /w==\n',
    recordFrame(JSON.stringify({ case: CASES[1].id, event: 'started', at: 'bad', details: {} }), 2),
    PREFIX + channel + ' END 1 ' + Buffer.byteLength(first + '\n') + ' ' + '0'.repeat(64) + '\n',
    PREFIX + channel + ' START 0\n',
  ];
  for (const corrupt of invalid) {
    const captured = captureReceiver(); captured.receiver.push(transport([first]).slice(0, 2).join(''));
    assert.throws(() => captured.receiver.push(corrupt), error => error.code === 'COMPONENT_OBSERVATION_PROTOCOL');
    assert.equal(captured.journal.join(''), first + '\n'); assert.equal(captured.receiver.state().state, 'ERROR');
    assert.throws(() => captured.receiver.finish(), /previously failed/);
  }
});

test('component protocol detects truncated missing and lost journal frames without erasing observations', () => {
  const value = observation();
  for (const tail of ['', PREFIX.slice(0, 12), PREFIX + channel + ' RECORD 2']) {
    const captured = captureReceiver(); captured.receiver.push(transport([value]).slice(0, 2).join('') + tail);
    assert.throws(() => captured.receiver.finish(), /incomplete frame|missing its start or end/);
    assert.equal(captured.journal.join(''), value + '\n');
  }
  const lost = captureReceiver(), frames = transport([value, observation(1)]);
  lost.receiver.push(frames[0] + frames[1]);
  assert.throws(() => lost.receiver.push(frames[3]), /end count, bytes or digest/);
  assert.equal(lost.journal.join(''), value + '\n');
  const empty = captureReceiver(); assert.throws(() => empty.receiver.finish(), /missing its start or end/);
});

test('component observation publisher waits for write callbacks and retains callback failures instead of ending successfully', async () => {
  const frames = [], callbacks = [];
  const publisher = createObservationPublisher(channel, (frame, callback) => { frames.push(frame); callbacks.push(callback); });
  publisher.record(CASES[0].id, 'started', {});
  const completion = publisher.finish();
  assert.equal(frames.length, 2); assert.equal(frames.some(frame => frame.includes(' END ')), false);
  callbacks[0](); callbacks[1]();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(frames.length, 3); assert.match(frames[2], / END /); callbacks[2](); await completion;
  const failingFrames = [];
  const failed = createObservationPublisher(channel, (frame, callback) => { failingFrames.push(frame); callback(new Error('Owned stream callback failure')); });
  await assert.rejects(failed.finish(), /stdout write failed|after failure/);
  assert.equal(failingFrames.some(frame => frame.includes(' END ')), false);
  const sink = createObservationReceiver(channel, { appendLog() {}, appendJournal() { throw new Error('Owned held journal failure'); } });
  assert.throws(() => sink.push(transport([observation()]).join('')), /Owned held journal failure/);
  assert.equal(sink.state().records, 0); assert.equal(sink.state().state, 'ERROR');
});

test('component protocol bounds records journal frames and total stdout bytes before accepting excess data', async () => {
  const oversized = createObservationPublisher(channel, (frame, callback) => callback());
  assert.throws(() => oversized.record(CASES[0].id, 'started', { text: 'x'.repeat(MAX_RECORD_BYTES) }), /record size/);
  await assert.rejects(oversized.finish(), /after failure/);
  const counts = createObservationPublisher(channel, (frame, callback) => callback());
  for (let index = 0; index < MAX_RECORDS; index++) counts.record(CASES[0].id, 'started', {});
  assert.throws(() => counts.record(CASES[0].id, 'started', {}), /record or journal limit/);
  await assert.rejects(counts.finish(), /after failure/);
  const bounded = captureReceiver(); bounded.receiver.push(PREFIX + channel + ' START 0\n');
  const value = observation(0, { text: 'x'.repeat(MAX_RECORD_BYTES - 200) });
  const maximum = Math.floor(MAX_JOURNAL_BYTES / Buffer.byteLength(value + '\n'));
  for (let index = 1; index <= maximum; index++) bounded.receiver.push(recordFrame(value, index));
  assert.throws(() => bounded.receiver.push(recordFrame(value, maximum + 1)), /journal limit/);
  assert.equal(bounded.receiver.state().records, maximum);
  const frame = captureReceiver(); assert.throws(() => frame.receiver.push('x'.repeat(MAX_FRAME_BYTES + 1)), /line exceeded/);
  let logBytes = 0;
  const stream = createObservationReceiver(channel, { appendJournal() {}, appendLog(value) { logBytes += Buffer.byteLength(value); } });
  const chunk = 'x'.repeat(256 * 1024) + '\n', count = Math.floor(MAX_STREAM_BYTES / Buffer.byteLength(chunk));
  for (let index = 0; index < count; index++) stream.push(chunk);
  assert.throws(() => stream.push(chunk), /total byte bound/); assert.equal(logBytes, count * Buffer.byteLength(chunk));
});

test('component protocol traverses a real Node test child stdout channel and preserves its failure and cleanup observations', t => {
  const fixture = evidenceFixture(t), child = path.join(fixture.outside, 'synthetic-child.cjs');
  const helper = path.join(ROOT, 'tests/windows-storage-observation-protocol.cjs');
  fs.writeFileSync(child, "'use strict';\nconst { test, after } = require('node:test');\n"
    + 'const { createObservationPublisher } = require(' + JSON.stringify(helper) + ');\n'
    + 'const publisher = createObservationPublisher(' + JSON.stringify(channel) + ');\n'
    + 'after(() => publisher.finish(), { timeout: 5000 });\n'
    + 'test(' + JSON.stringify(CASES[0].id) + ', t => {\n'
    + 't.after(() => publisher.record(' + JSON.stringify(CASES[0].id) + ', "cleanup", { retained: true }));\n'
    + 'publisher.record(' + JSON.stringify(CASES[0].id) + ', "started", {});\n'
    + 'publisher.record(' + JSON.stringify(CASES[0].id) + ', "body-failed", { message: "owned synthetic assertion" });\n'
    + 'throw new Error("owned synthetic assertion");\n});\n');
  const script = 'const { run } = require("node:test"); const { createObservationReceiver } = require(' + JSON.stringify(helper) + ');\n'
    + 'const journal = [], log = [], outcomes = []; const receiver = createObservationReceiver(' + JSON.stringify(channel)
    + ', { appendJournal: v => journal.push(v), appendLog: v => log.push(v) });\n'
    + '(async () => { for await (const e of run({ files: [' + JSON.stringify(child) + '], concurrency: 1, timeout: 10000 })) {\n'
    + 'if (e.type === "test:stdout") receiver.push(e.data.message);\n'
    + 'if (["test:pass", "test:fail"].includes(e.type) && e.data.line) outcomes.push({ type: e.type, name: e.data.name, message: e.data.details?.error?.message || null });\n'
    + '} console.log(JSON.stringify({ transport: receiver.finish(), journal, log, outcomes })); })().catch(e => { console.error(e.stack); process.exitCode = 2; });';
  const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
  // Use the same file invocation as the component runner. Node 24 run() adds
  // process.execArgv even when options.execArgv is empty, so a node -e wrapper
  // would evaluate itself again in the child instead of this fixture file.
  const wrapper = path.join(fixture.outside, 'synthetic-runner.cjs'); fs.writeFileSync(wrapper, script);
  const result = spawnSync(process.execPath, [wrapper], { env, encoding: 'utf8', timeout: 25000, maxBuffer: 2 * 1024 * 1024 });
  assert.equal(result.error, undefined); assert.equal(result.status, 0, result.stderr);
  const observed = JSON.parse(result.stdout);
  assert.equal(observed.transport.state, 'OBSERVED'); assert.equal(observed.transport.records, 3);
  assert.deepEqual(observed.journal.map(value => JSON.parse(value).event), ['started', 'body-failed', 'cleanup']);
  assert.deepEqual(observed.outcomes, [{ type: 'test:fail', name: CASES[0].id, message: 'owned synthetic assertion' }]);
  assert.deepEqual(observed.log, []);
});

test('component runner retains native failure and pass outcomes when the child journal later fails validation', async t => {
  const fixture = evidenceFixture(t), value = observation(0, { message: 'native outcome remains retained' });
  const outputs = prepareOutputs(fixture.output, { root: fixture.root }); t.after(() => outputs.close());
  const synthetic = syntheticDependencies(fixture, function* (token, options) {
    yield nativeEvent(0, 'FAIL', 'native assertion before protocol failure');
    yield { type: 'test:stdout', data: { message: transport([value], token).slice(0, 2).join('') } };
    yield { type: 'test:stdout', data: { message: recordFrame(observation(1), 9, token) } };
    assert.equal(options.signal.aborted, true);
    yield nativeEvent(1, 'PASS'); yield { type: 'test:summary', data: { success: false } };
  });
  const report = await collectComponent({ buildDirectory: fixture.outside, buildFailed: false }, outputs, synthetic.dependencies);
  outputs.finish();
  assert.equal(report.tests[0].status, 'FAIL'); assert.equal(report.tests[0].diagnostic, 'native assertion before protocol failure');
  assert.equal(report.tests[1].status, 'PASS'); assert.equal(report.totals.notRun, CASES.length - 2);
  assert.equal(report.observationTransport.state, 'ERROR'); assert.equal(report.observationTransport.records, 1);
  assert.equal(fs.readFileSync(outputs.journalPath, 'utf8'), value + '\n');
  assert.equal(report.summarySuccess, false); assert.equal(report.productPassing, 0); assert.equal(report.releaseCredit, false);
  assert.equal(report.sourceChanged, false); assert.equal(report.fixtureCleaned, true); assert.equal(synthetic.calls.source, 2);
  assert.ok(report.infrastructureErrors.some(item => item.stage === 'component-observation-protocol'));
});

test('component runner requires complete framing and stable source and native identities for a synthetic complete catalog', async t => {
  const fixture = evidenceFixture(t);
  for (const mode of ['complete', 'missing-footer', 'source-changed', 'native-changed']) {
    const parent = path.join(fixture.outside, mode); fs.mkdirSync(parent);
    const local = { ...fixture, outside: parent, output: path.join(parent, 'component.json') };
    const outputs = prepareOutputs(local.output, { root: fixture.root });
    const synthetic = syntheticDependencies(local, function* (token) {
      const frames = transport(CASES.map((item, index) => observation(index, { syntheticOnly: true })), token);
      yield { type: 'test:stdout', data: { message: (mode === 'missing-footer' ? frames.slice(0, -1) : frames).join('') } };
      for (let index = 0; index < CASES.length; index++) yield nativeEvent(index, 'PASS');
      yield { type: 'test:summary', data: { success: true } };
    });
    if (mode === 'source-changed') {
      const observe = synthetic.dependencies.source;
      synthetic.dependencies.source = () => { const result = observe();
        return { ...result, sourceTreeSha256: synthetic.calls.source > 1 ? '5'.repeat(64) : result.sourceTreeSha256 }; };
    }
    if (mode === 'native-changed') {
      const inspect = synthetic.dependencies.inspect;
      synthetic.dependencies.inspect = () => ({ ...inspect(), manifestSha256: '6'.repeat(64) });
    }
    const report = await collectComponent({ buildDirectory: parent, buildFailed: false }, outputs, synthetic.dependencies);
    outputs.finish();
    assert.equal(report.totals.passed, CASES.length); assert.equal(report.tests.length, CASES.length);
    assert.equal(report.summarySuccess, mode === 'complete');
    assert.equal(report.sourceChanged, mode === 'source-changed'); assert.equal(report.nativeRuntimeChanged, mode === 'native-changed');
    assert.equal(report.observationTransport.state, mode === 'missing-footer' ? 'ERROR' : 'OBSERVED');
    assert.equal(report.infrastructureErrors.length === 0, mode === 'complete');
    assert.equal(report.releaseCredit, false); assert.equal(report.productPassing, 0); assert.equal(report.realProviderCalls, 0);
  }
});

test('component runner report write and close failures keep the primary native outcome and never emit a completion receipt', async t => {
  const fixture = evidenceFixture(t);
  for (const fault of ['report-write', 'log-close']) {
    const parent = path.join(fixture.outside, fault); fs.mkdirSync(parent);
    const local = { ...fixture, outside: parent, output: path.join(parent, 'component.json') }, names = new Map(), closeCalls = [];
    const fsImpl = { ...fs,
      openSync(filename, ...args) { const fd = fs.openSync(filename, ...args); names.set(fd, filename); return fd; },
      writeSync(fd, ...args) { if (fault === 'report-write' && names.get(fd) === local.output) throw Object.assign(new Error('Owned report write failure'), { code: 'ENOSPC' });
        return fs.writeSync(fd, ...args); },
      closeSync(fd) { closeCalls.push(fd); fs.closeSync(fd);
        if (fault === 'log-close' && names.get(fd) === local.output.replace(/\.json$/, '.log')) throw Object.assign(new Error('Owned close uncertainty'), { code: 'EIO' }); },
    };
    const synthetic = syntheticDependencies(local, function* (token) {
      yield nativeEvent(0, 'FAIL', 'native assertion survives evidence failure');
      yield { type: 'test:stdout', data: { message: transport([observation()], token).join('') } };
      yield { type: 'test:summary', data: { success: false } };
    });
    const emitted = [];
    await assert.rejects(main(['--build-directory', parent, '--output', local.output], {
      prepare: output => prepareOutputs(output, { root: fixture.root, fsImpl }), dependencies: synthetic.dependencies, emit: value => emitted.push(value),
    }), error => {
      assert.equal(error.code, fault === 'report-write' ? 'OUTPUT_WRITE_FAILED' : 'OUTPUT_CLOSE_FAILED');
      assert.equal(error.componentOutcome.tests[0].status, 'FAIL');
      assert.equal(error.componentOutcome.tests[0].diagnostic, 'native assertion survives evidence failure');
      assert.equal(error.componentOutcome.summarySuccess, false); assert.equal(error.componentOutcome.releaseCredit, false);
      if (fault === 'log-close') assert.equal(error.outputState.log.closeErrorCode, 'EIO');
      return true;
    });
    assert.deepEqual(emitted, []); assert.equal(closeCalls.length, 3); assert.equal(new Set(closeCalls).size, 3);
    assert.ok(outputNames(local.output).every(filename => fs.existsSync(filename)));
    assert.match(fs.readFileSync(local.output.replace(/\.json$/, '.log'), 'utf8'), /native assertion survives evidence failure/);
    assert.equal(fs.readFileSync(local.output.replace(/\.json$/, '.observations.jsonl'), 'utf8'), observation() + '\n');
  }
});
