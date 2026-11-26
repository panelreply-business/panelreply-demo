'use strict';

// Evidence verifiers, excluded from the numeric product test target.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { spawnSync } = require('node:child_process');
const { fingerprintFile, parseLanguageDirectory, createDependencyEvidence } = require('../scripts/ocr-dependency-evidence.cjs');
const { collectNodeResults } = require('../scripts/test-evidence.cjs');
const { validateReport } = require('../scripts/aggregate-test-evidence.cjs');

const LIMITS = ['--as=536870912:536870912', '--cpu=15:15', '--core=0:0', '--fsize=0:0', '--nofile=32:32', '--'];
const OPTIONS = { shell: false, cwd: '/', env: { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', OMP_THREAD_LIMIT: '1', OMP_NUM_THREADS: '1' } };
const digest = value => crypto.createHash('sha256').update(value).digest('hex');

function temporary(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'panelreply-dependency-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}
function fixtures(directory) {
  fs.mkdirSync(path.join(directory, 'configs'), { recursive: true });
  for (const [file, value] of Object.entries({ 'eng.traineddata': 'english-v1', 'osd.traineddata': 'orientation-v1', 'configs/tsv': 'tessedit_create_tsv 1\n', 'prlimit.bin': 'limiter-v1', 'tesseract.bin': 'engine-v1', 'python3.bin': 'python-v1' })) fs.writeFileSync(path.join(directory, file), value);
}
function observer(directory) {
  fixtures(directory);
  const calls = [];
  const evidence = createDependencyEvidence({
    spawnProcess: (...args) => {
      const child = new EventEmitter();
      child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
      calls.push({ args, child });
      return child;
    },
    hashFile: filename => {
      const normalized = filename.replace(/\\/g, '/');
      const fixture = normalized.startsWith('/usr/bin/') ? path.join(directory, path.posix.basename(normalized) + '.bin')
        : process.platform === 'win32' && normalized.startsWith('/synthetic/tessdata/') ? path.join(directory, normalized.slice('/synthetic/tessdata/'.length)) : filename;
      return fingerprintFile(fixture);
    },
  });
  function complete(binary, args, output = '', code = 0, options = OPTIONS) {
    const child = evidence.spawnProcess('/usr/bin/prlimit', [...LIMITS, binary, ...args], options);
    if (output.length) child.stdout.write(output);
    child.emit('close', code, null);
    return child;
  }
  function languages(target = directory, names = ['eng', 'osd']) {
    // The engine and fixed executable paths are POSIX even when verifier unit
    // fixtures run on another platform. A synthetic POSIX directory is enough
    // for banner-only cases. File hashing fixtures use the host path on Linux.
    const probeDirectory = process.platform === 'win32' ? '/synthetic/tessdata' + (target === directory ? '' : '-changed') : target;
    complete('/usr/bin/tesseract', ['--list-langs'], `List of available languages in "${probeDirectory}/" (${names.length}):\n${names.join('\n')}\n`);
  }
  function ready(names = ['eng', 'osd']) {
    complete('/usr/bin/tesseract', ['--version'], 'tesseract 5.5.0\n');
    languages(directory, names);
    complete('/usr/bin/python3', ['-I', '-B', '/synthetic/ocr-preprocess.py', '--probe'], '{}');
  }
  return { evidence, calls, complete, languages, ready };
}

test('dependency file snapshots hash bytes, including empty and multi-chunk files', t => {
  const directory = temporary(t), file = path.join(directory, 'model');
  for (const value of [Buffer.from('abc'), Buffer.alloc(0), Buffer.alloc(150000, 0xa7)]) {
    fs.writeFileSync(file, value);
    const actual = fingerprintFile(file);
    assert.equal(actual.status, 'AVAILABLE'); assert.equal(actual.sha256, digest(value));
    assert.equal(actual.bytes, value.length); assert.equal(actual.resolvedPath, fs.realpathSync(file));
  }
});

test('unavailable dependency files never receive guessed hashes', t => {
  const directory = temporary(t), large = path.join(directory, 'large');
  fs.writeFileSync(large, '12345');
  for (const [actual, reason] of [
    [fingerprintFile(path.join(directory, 'missing')), 'file_not_found'],
    [fingerprintFile(directory), 'not_regular_file'],
    [fingerprintFile(large, 4), 'file_size_limit'],
    [fingerprintFile('relative/model'), 'invalid_path'],
    [fingerprintFile(large, 65 * 1024 * 1024), 'invalid_file_size_limit'],
  ]) { assert.equal(actual.status, 'UNAVAILABLE'); assert.equal(actual.sha256, null); assert.equal(actual.reason, reason); }
});

test('a dependency changed during streaming is rejected without publishing a mixed hash', t => {
  const directory = temporary(t), file = path.join(directory, 'model');
  fs.writeFileSync(file, Buffer.alloc(150000, 0x61));
  const read = fs.readSync;
  let changed = false;
  t.mock.method(fs, 'readSync', (...args) => {
    const count = read(...args);
    if (!changed) { changed = true; fs.appendFileSync(file, 'changed'); }
    return count;
  });
  const actual = fingerprintFile(file);
  assert.equal(changed, true); assert.equal(actual.status, 'UNAVAILABLE');
  assert.equal(actual.reason, 'file_changed_during_hash'); assert.equal(actual.sha256, null);
});

test('language directory discovery uses the observed banner and validates its complete list', () => {
  assert.deepEqual(parseLanguageDirectory(Buffer.from('List of available languages in "/models/English data/" (2):\r\nosd\r\neng\r\n')),
    { status: 'OBSERVED', path: '/models/English data/', languages: ['eng', 'osd'] });
  for (const output of [
    'tesseract 5.5.0\neng\nosd\n',
    'List of available languages in "relative" (1):\neng\n',
    'List of available languages in "/models/../outside" (1):\neng\n',
    'List of available languages in "/models" (2):\neng\n',
    'List of available languages in "/models" (2):\neng\neng\n',
    'List of available languages in "/models" (1):\n../eng\n',
    'List of available languages in "/models" (1):\neng\nextra\n',
  ]) { const actual = parseLanguageDirectory(Buffer.from(output)); assert.equal(actual.status, 'UNAVAILABLE', output); assert.equal(actual.path, null); }
  assert.equal(parseLanguageDirectory(Buffer.from([0xff])).reason, 'invalid_probe_utf8');
  assert.equal(parseLanguageDirectory(Buffer.alloc(16385, 0x61)).reason, 'probe_output_limit');
});

test('the observer preserves original spawn arguments, child identity, and stdout bytes', t => {
  const directory = temporary(t), h = observer(directory);
  const args = [...LIMITS, '/usr/bin/tesseract', '--list-langs'];
  const child = h.evidence.spawnProcess('/usr/bin/prlimit', args, OPTIONS);
  assert.equal(child, h.calls[0].child); assert.equal(h.calls[0].args[1], args); assert.equal(h.calls[0].args[2], OPTIONS);
  const output = Buffer.from('List of available languages in "/models" (1):\neng\n'), consumed = [];
  child.stdout.on('data', bytes => consumed.push(bytes));
  child.stdout.write(output.subarray(0, 12)); child.stdout.write(output.subarray(12)); child.emit('close', 0, null);
  assert.deepEqual(Buffer.concat(consumed), output);
  assert.equal(h.evidence.snapshot().dataDirectory.path, '/models');
});

test('failed, excessive, and unfinished probes remain unavailable and keep stdout intact', t => {
  const directory = temporary(t), h = observer(directory);
  h.complete('/usr/bin/tesseract', ['--list-langs'], 'List of available languages in "/models" (1):\neng\n', 1);
  assert.equal(h.evidence.snapshot().dataDirectory.reason, 'probe_failed');
  const child = h.evidence.spawnProcess('/usr/bin/prlimit', [...LIMITS, '/usr/bin/tesseract', '--list-langs'], OPTIONS);
  assert.equal(h.evidence.snapshot().dataDirectory.reason, 'probe_not_closed');
  let consumed = 0; child.stdout.on('data', bytes => { consumed += bytes.length; });
  child.stdout.write(Buffer.alloc(20000, 0x61)); child.emit('close', 0, null);
  assert.equal(consumed, 20000); assert.equal(h.evidence.snapshot().dataDirectory.reason, 'probe_output_limit');
});

test('engine version alone cannot establish a data directory or model identity', t => {
  const directory = temporary(t), h = observer(directory);
  h.complete('/usr/bin/tesseract', ['--version'], 'tesseract 5.5.0\n');
  const snapshot = h.evidence.snapshot(), report = h.evidence.summarize(snapshot, snapshot);
  assert.equal(report.identityGate, 'BLOCKED'); assert.equal(snapshot.models.eng.sha256, null);
  assert.equal(snapshot.configuration.tsv.sha256, null); assert.equal(snapshot.dataDirectory.reason, 'probe_not_observed');
});

test('unsupported invocations pass through but cannot create dependency provenance', t => {
  const directory = temporary(t), h = observer(directory);
  const child = h.evidence.spawnProcess('/usr/bin/tesseract', ['--list-langs'], OPTIONS);
  child.stdout.write('List of available languages in "/models" (1):\neng\n'); child.emit('close', 0, null);
  const snapshot = h.evidence.snapshot(), report = h.evidence.summarize(snapshot, snapshot);
  assert.equal(h.calls.length, 1); assert.equal(report.identityGate, 'BLOCKED'); assert.equal(report.unsupportedInvocations, 1);
  assert.equal(snapshot.binaries.engine.sha256, null); assert.equal(snapshot.models.eng.sha256, null);
});

test('stable snapshots record model, TSV configuration, binary and invocation hashes', t => {
  const directory = temporary(t), h = observer(directory); h.ready();
  const before = h.evidence.snapshot();
  h.complete('/usr/bin/tesseract', ['stdin', 'stdout', '-l', 'eng', '--oem', '1', '--psm', '6', 'tsv']);
  h.complete('/usr/bin/tesseract', ['stdin', 'stdout', '-l', 'eng', '--oem', '1', '--psm', '1', 'tsv']);
  const report = h.evidence.summarize(before, h.evidence.snapshot());
  assert.equal(report.identityGate, 'PASS'); assert.equal(report.status, 'STABLE_SNAPSHOTS');
  assert.equal(report.before.models.eng.sha256, digest('english-v1')); assert.equal(report.before.models.osd.sha256, digest('orientation-v1'));
  assert.equal(report.before.configuration.tsv.sha256, digest('tessedit_create_tsv 1\n'));
  assert.equal(report.before.binaries.engine.sha256, digest('engine-v1'));
  assert.match(report.configurationSha256, /^[a-f0-9]{64}$/); assert.equal(report.invocationProfiles.length, 5);
  assert.deepEqual(report.changes, []); assert.deepEqual(report.unavailableFields, []);
  h.complete('/usr/bin/tesseract', ['stdin', 'stdout', '-l', 'eng', '--oem', '1', '--psm', '6', 'tsv']);
  const repeated = h.evidence.summarize(before, h.evidence.snapshot());
  assert.equal(repeated.configurationSha256, report.configurationSha256);
  assert.equal(repeated.invocationProfiles.find(profile => profile.args.includes('6')).count, 2);
});

test('same engine version with different weights produces a changed-identity failure', t => {
  const directory = temporary(t), h = observer(directory); h.ready();
  const before = h.evidence.snapshot(); fs.writeFileSync(path.join(directory, 'eng.traineddata'), 'english-v2');
  h.complete('/usr/bin/tesseract', ['--version'], 'tesseract 5.5.0\n');
  const report = h.evidence.summarize(before, h.evidence.snapshot());
  assert.equal(report.identityGate, 'FAIL'); assert.deepEqual(report.changes, ['models.eng']);
  assert.notEqual(report.before.models.eng.sha256, report.after.models.eng.sha256);
});

test('configuration and executable replacement invalidate provenance', t => {
  const directory = temporary(t), h = observer(directory); h.ready();
  const before = h.evidence.snapshot();
  fs.writeFileSync(path.join(directory, 'configs/tsv'), 'tessedit_create_tsv 0\n'); fs.writeFileSync(path.join(directory, 'tesseract.bin'), 'engine-v2');
  const report = h.evidence.summarize(before, h.evidence.snapshot());
  assert.equal(report.identityGate, 'FAIL'); assert.deepEqual(report.changes.sort(), ['binaries.engine', 'configuration.tsv']);
});

test('optional unreported orientation remains explicit without inventing an OSD hash', t => {
  const directory = temporary(t), h = observer(directory); h.ready(['eng']);
  const before = h.evidence.snapshot(), report = h.evidence.summarize(before, h.evidence.snapshot());
  assert.equal(before.models.osd.status, 'NOT_REPORTED'); assert.equal(before.models.osd.sha256, null);
  assert.equal(before.models.eng.status, 'AVAILABLE'); assert.equal(report.identityGate, 'PASS');
});

test('an unavailable configuration at both boundaries is blocked rather than a stable hash claim', t => {
  const directory = temporary(t), h = observer(directory); h.ready(); fs.rmSync(path.join(directory, 'configs/tsv'));
  const report = h.evidence.summarize(h.evidence.snapshot(), h.evidence.snapshot());
  assert.equal(report.identityGate, 'BLOCKED'); assert.deepEqual(report.changes, []);
  assert.equal(report.before.configuration.tsv.sha256, null); assert.equal(report.before.configuration.tsv.reason, 'file_not_found');
});

test('a transient model-directory change is retained even when the final directory returns', t => {
  const directory = temporary(t), h = observer(directory); h.ready(); const before = h.evidence.snapshot();
  h.languages(path.join(directory, 'different')); h.languages(directory);
  const report = h.evidence.summarize(before, h.evidence.snapshot());
  assert.equal(report.identityGate, 'FAIL'); assert.ok(report.changes.includes('dataDirectory')); assert.equal(report.probes.length, 3);
  assert.deepEqual(report.before.models.eng, report.after.models.eng);
});

test('changes to observed execution settings fail identity without mutating those settings', t => {
  const directory = temporary(t), h = observer(directory); h.ready(); const before = h.evidence.snapshot();
  const options = { ...OPTIONS, env: { ...OPTIONS.env, OMP_THREAD_LIMIT: '2' } };
  h.complete('/usr/bin/tesseract', ['--version'], 'tesseract 5.5.0\n', 0, options);
  const report = h.evidence.summarize(before, h.evidence.snapshot());
  assert.equal(report.identityGate, 'FAIL'); assert.deepEqual(report.changes, ['executionConfiguration']);
  assert.equal(options.env.OMP_THREAD_LIMIT, '2'); assert.equal(OPTIONS.env.OMP_THREAD_LIMIT, '1');
});

test('observation histories stay bounded and disclose an exhausted capture budget', t => {
  const directory = temporary(t), h = observer(directory); h.ready();
  for (let index = 0; index < 65; index += 1) h.languages();
  const report = h.evidence.summarize(h.evidence.snapshot(), h.evidence.snapshot());
  assert.equal(report.probes.length, 64); assert.equal(report.observationLimit, true);
  assert.equal(report.identityGate, 'BLOCKED'); assert.ok(report.unavailableFields.includes('observationLimit'));
});

test('dependency verifier cases receive no numeric product-goal credit', () => {
  const entry = { testId: 1, name: 'dependency hash verifier', file: __filename, entryFile: __filename, line: 1, details: {} };
  const report = collectNodeResults([{ type: 'test:pass', data: entry }, { type: 'test:summary', data: { success: true } }], path.resolve(__dirname, '..'), 'linux/x86_64/node24');
  assert.equal(report.tests[0].kind, 'harness'); assert.equal(report.totals.harnessPassed, 1);
  assert.equal(report.totals.passed - report.totals.harnessPassed, 0);
});

function verifierReport(file) {
  const sourceManifest = [{ path: 'workspace/example.cjs', sha256: digest('synthetic source') }], sourceTreeSha256 = digest(JSON.stringify(sourceManifest));
  return { format: 'panelreply-node-evidence-v1', sourceCommit: 'a'.repeat(40), gitTreeHash: 'b'.repeat(40), sourceManifest, sourceTreeSha256,
    sourceTreeSha256After: sourceTreeSha256, dirty: false, sourceChanged: false, suite: 'node-all',
    platform: { os: 'linux', architecture: 'x86_64', node: 'v24.22.3' }, infrastructureErrors: [], summarySuccess: true,
    tests: [{ id: file + '::counter', file, name: 'counter', status: 'PASS', platformKey: 'linux/x86_64/node24', durationMs: 1, generated: false, caseFamily: null, kind: 'product' }] };
}

test('a report cannot relabel dependency verifiers as product coverage', () => {
  const report = verifierReport('tests/ocr-dependency-evidence.test.cjs');
  assert.throws(() => validateReport(report), error => error.code === 'HARNESS_MISCLASSIFIED');
  report.tests[0].kind = 'harness';
  assert.doesNotThrow(() => validateReport(report));
});

test('existing OCR measurement and diagnostic checks are excluded and cannot be relabeled', () => {
  for (const name of ['ocr-benchmark.test.cjs', 'ocr-isolation-diagnostics.test.cjs']) {
    const file = path.join(__dirname, name);
    const entry = { testId: 1, name: 'evidence counter', file, entryFile: file, line: 1, details: {} };
    const collected = collectNodeResults([{ type: 'test:pass', data: entry }, { type: 'test:summary', data: { success: true } }], path.resolve(__dirname, '..'), 'linux/x86_64/node24');
    assert.equal(collected.tests[0].kind, 'harness'); assert.equal(collected.totals.passed - collected.totals.harnessPassed, 0);
    assert.throws(() => validateReport(verifierReport('tests/' + name)), error => error.code === 'HARNESS_MISCLASSIFIED');
  }
});

test('blocked native readiness writes a resumable benchmark report with unavailable identities', t => {
  const directory = temporary(t), modulePath = path.join(directory, 'ocr.cjs'), output = path.join(directory, 'report.json');
  fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify({ format: 'panelreply-synthetic-ocr-benchmark', version: 1, cases: [{ id: 'never-read', file: 'not-read.png', sha256: '0'.repeat(64) }] }));
  fs.writeFileSync(modulePath, "exports.createOcrService = () => ({ getOcrStatus: async () => ({ available: false, reason: 'engine_unavailable' }), shutdown: async () => {} });\n");
  const result = spawnSync(process.execPath, [path.resolve(__dirname, '../scripts/benchmark-ocr.cjs'), directory, output, modulePath], { encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 2, result.stderr); const report = JSON.parse(fs.readFileSync(output));
  assert.equal(report.status, 'BLOCKED'); assert.equal(report.accuracyGate, 'BLOCKED'); assert.equal(report.identityGate, 'BLOCKED');
  assert.equal(report.overall.cases, 0); assert.equal(report.dependencyEvidence.before.models.eng.sha256, null);
  assert.equal(report.dependencyEvidence.before.dataDirectory.reason, 'probe_not_observed');
});

test('completed extraction without dependency identity writes measurements but exits blocked', t => {
  const directory = temporary(t), modulePath = path.join(directory, 'ocr.cjs'), output = path.join(directory, 'report.json');
  const fixture = Buffer.from('synthetic trusted adapter fixture');
  fs.writeFileSync(path.join(directory, 'fixture.png'), fixture);
  fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify({ format: 'panelreply-synthetic-ocr-benchmark', version: 1, cases: [{ id: 'no-text', file: 'fixture.png', sha256: digest(fixture), expected: null }] }));
  fs.writeFileSync(modulePath, "exports.createOcrService = () => ({ getOcrStatus: async () => ({ available: true, version: '5.5.0' }), recognizeImage: async () => ({ candidates: [], rawText: '' }), shutdown: async () => {} });\n");
  const result = spawnSync(process.execPath, [path.resolve(__dirname, '../scripts/benchmark-ocr.cjs'), directory, output, modulePath], { encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 2, result.stderr); const report = JSON.parse(fs.readFileSync(output));
  assert.equal(report.status, 'MEASURED'); assert.equal(report.accuracyGate, 'PASS'); assert.equal(report.identityGate, 'BLOCKED');
  assert.equal(report.overall.cases, 1); assert.equal(report.overall.exactCases, 1); assert.equal(report.dependencyEvidence.before.models.eng.sha256, null);
});
