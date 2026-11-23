'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { CASES } = require('./windows-storage-cases.cjs');
const { fixture } = require('./windows-storage-support.cjs');
const { completeOutcomes, rawLeafOutcomes, argumentsFor } = require('../scripts/run-windows-storage.cjs');
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
