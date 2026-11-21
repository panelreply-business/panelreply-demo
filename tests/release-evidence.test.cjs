'use strict';

// Evidence-harness tests. The release reporter labels this file kind=harness,
// so none of these cases contributes to the product's 10,000/20,000 goal.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { aggregateReports, validateReport, validateMilestones, readReportDirectory } = require('../scripts/aggregate-test-evidence.cjs');
const { collectNodeResults } = require('../scripts/test-evidence.cjs');

const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const FILE = 'tests/synthetic-product.test.cjs';
const NOW = '2026-11-20T17:00:00.000Z';
function source() {
  const sourceManifest = [{ path: 'workspace/example.cjs', sha256: sha('synthetic application source') }];
  const sourceTreeSha256 = sha(JSON.stringify(sourceManifest));
  return { sourceCommit: 'a'.repeat(40), gitTreeHash: 'b'.repeat(40), sourceManifest,
    sourceTreeSha256, sourceTreeSha256After: sourceTreeSha256, dirty: false };
}
function policy(overrides = {}) {
  return { initialTarget: 2, earlyTarget: 4, activeTarget: 2,
    deadline: '2026-12-31T00:00:00-05:00', releaseDate: '2026-12-31', timezone: 'America/Detroit', firstGoalAchievedAt: null,
    requiredPlatforms: [{ id: 'linux-node', kind: 'node', match: { os: 'linux', nodeMajor: 24 }, minimumCases: 1 }], ...overrides };
}
function node(statuses = ['PASS'], overrides = {}) {
  const platform = { os: 'linux', architecture: 'x86_64', node: 'v24.22.3', ...(overrides.platform || {}) };
  const system = { win32: 'windows', Windows: 'windows', Linux: 'linux', Darwin: 'darwin' }[platform.os] || platform.os.toLowerCase();
  const architecture = { x64: 'x86_64', AMD64: 'x86_64', aarch64: 'arm64' }[platform.architecture] || platform.architecture;
  const platformKey = `${system}/${architecture}/node${platform.node.replace(/^v/, '').split('.')[0]}`;
  return { format: 'panelreply-node-evidence-v1', ...source(), sourceChanged: false, suite: 'node-all', platform,
    infrastructureErrors: [], summarySuccess: statuses.every(status => ['PASS', 'SKIP', 'TODO', 'EXPECTED_FAILURE'].includes(status)),
    tests: statuses.map((status, index) => ({ id: `${FILE}::case-${index}`, file: FILE, name: 'case-' + index,
      status, platformKey, durationMs: 1, generated: false, caseFamily: null, kind: 'product' })),
    ...overrides, platform };
}
function browser(statuses = ['PASS'], overrides = {}) {
  const platform = { os: 'Linux', architecture: 'x86_64', node: 'v24.22.3', browserEngine: 'chromium', browserChannel: 'bundled',
    observedBrowsers: [{ engine: 'chromium', channel: 'bundled', version: '151.0.1' }], ...(overrides.platform || {}) };
  const system = { Windows: 'windows', Linux: 'linux', Darwin: 'darwin' }[platform.os] || platform.os.toLowerCase();
  const architecture = platform.architecture === 'AMD64' ? 'amd64' : platform.architecture.toLowerCase();
  const profile = overrides.profile || 'desktop';
  const result = { format: 'panelreply-platform-evidence-v1', ...source(), sourceChangedDuringRun: false, suite: 'portable',
    status: statuses.every(status => status === 'PASS') ? 'PASS' : 'FAIL', expectedMethods: statuses.length,
    platform, infrastructureErrors: [],
    tests: statuses.map((status, index) => ({ id: 'browser.Test.case_' + index, status, durationMs: 1,
      platformKey: `${system}/${architecture}/${platform.browserEngine}/${platform.browserChannel}/${profile}`, profile, emulated: profile !== 'desktop' })),
    ...overrides, platform };
  delete result.profile;
  return result;
}
function aggregate(reports, overrides = {}) { return aggregateReports(reports, { milestones: policy(), now: NOW, ...overrides }); }
function expectCode(action, code) { assert.throws(action, error => error.code === code); }

test('evidence deduplicates same-source reruns and Node minor updates', () => {
  const report = aggregate([node(), node(['PASS'], { platform: { node: 'v24.23.0' } })]);
  assert.equal(report.observations, 2); assert.equal(report.duplicateObservationsExcluded, 1);
  assert.equal(report.product.total, 1); assert.equal(report.product.PASS, 1); assert.equal(report.distinctCases.total, 1);
  assert.deepEqual(report.executions[0].nodeVersions, ['v24.22.3', 'v24.23.0']);
});

test('evidence separates distinct cases from three actual OS executions', () => {
  const report = aggregate([node(), node(['PASS'], { platform: { os: 'windows', architecture: 'AMD64' } }), node(['PASS'], { platform: { os: 'Darwin', architecture: 'arm64' } })]);
  assert.equal(report.product.PASS, 3); assert.equal(report.distinctCases.total, 1); assert.equal(report.matrix.length, 3);
});

test('evidence normalizes Windows and architecture aliases without double counting', () => {
  const report = aggregate([node(['PASS'], { platform: { os: 'win32', architecture: 'AMD64' } }), node(['PASS'], { platform: { os: 'windows', architecture: 'x64' } })]);
  assert.equal(report.product.PASS, 1); assert.equal(report.executions[0].platformKey, 'node/windows/x86_64/node24');
});

test('evidence records different Node major runtimes as separate executions', () => {
  const report = aggregate([node(), node(['PASS'], { platform: { node: 'v26.0.0' } })]);
  assert.equal(report.product.PASS, 2); assert.equal(report.distinctCases.total, 1);
});

test('browser patch versions preserve provenance without increasing the count', () => {
  const second = browser(); second.platform.observedBrowsers[0].version = '151.0.2';
  const report = aggregate([browser(), second]);
  assert.equal(report.product.PASS, 1); assert.equal(report.matrix[0].browserVersions.length, 2);
});

test('browser emulation has a separate profile and never supplies manual evidence', () => {
  const requirements = [{ id: 'phone', kind: 'manual', match: { os: 'ios' }, status: 'PASS' }];
  const report = aggregate([browser(), browser(['PASS'], { profile: 'iphone-390', suite: 'mobile' })], { milestones: policy({ requiredPlatforms: requirements }) });
  assert.equal(report.product.PASS, 2); assert.equal(report.distinctCases.total, 1);
  assert.equal(report.requiredPlatforms[0].status, 'NOT_TESTED'); assert.equal(report.platformCoverageComplete, false);
  assert.equal(report.fullGoalAchieved, false);
});

test('explicitly generated cases are counted once across platforms and kept separate from unmarked cases', () => {
  const one = node(['PASS', 'PASS']); one.tests[0].generated = true; one.tests[0].caseFamily = 'REM';
  const two = structuredClone(one); two.platform.os = 'windows'; two.tests.forEach(item => { item.platformKey = 'windows/x86_64/node24'; });
  const report = aggregate([one, two]);
  assert.equal(report.product.PASS, 4); assert.equal(report.distinctCases.total, 2);
  assert.equal(report.distinctCases.generated, 1); assert.equal(report.distinctCases.notMarkedGenerated, 1);
});

test('harness cases do not contribute to the numeric product target', () => {
  const raw = node(['PASS', 'PASS', 'PASS']); raw.tests[1].kind = 'harness'; raw.tests[2].kind = 'harness';
  const report = aggregate([raw]);
  assert.equal(report.product.PASS, 1); assert.equal(report.harness.PASS, 2);
  assert.equal(report.distinctCases.total, 1); assert.equal(report.numericTargetReached, false);
});

test('the evidence test module cannot be relabeled as product coverage', () => {
  const raw = node(); raw.tests[0].file = 'tests/release-evidence.test.cjs'; raw.tests[0].id = raw.tests[0].file + '::counter';
  expectCode(() => validateReport(raw), 'HARNESS_MISCLASSIFIED');
});

test('same-source case classification cannot change between reports', () => {
  const other = node(); other.tests[0].kind = 'harness';
  expectCode(() => aggregate([node(), other]), 'CASE_CLASSIFICATION_CHANGED');
});

test('callback, spreadsheet and shared coverage stay separate without duplicating the portfolio count', () => {
  const raw = node(['PASS', 'PASS', 'PASS']);
  raw.tests[0].productScope = 'callback'; raw.tests[1].productScope = 'spreadsheet';
  const report = aggregate([raw, structuredClone(raw)]);
  assert.equal(report.product.PASS, 3);
  assert.equal(report.productScopes.callback.executions.PASS, 1);
  assert.equal(report.productScopes.spreadsheet.executions.PASS, 1);
  assert.equal(report.productScopes.shared.executions.PASS, 1);
  assert.deepEqual(report.productScopes.shared.availableTo, ['callback', 'spreadsheet']);
  assert.equal(report.milestones.scope, 'portfolio');
  assert.equal(report.productReleaseDecisions.callback, 'NOT_DETERMINED_BY_TEST_COUNT');
  assert.equal(report.productReleaseDecisions.spreadsheet, 'NOT_DETERMINED_BY_TEST_COUNT');
});

test('legacy cases default to shared evidence without claiming app-specific readiness', () => {
  const report = aggregate([node()]);
  assert.equal(report.productScopes.shared.distinctCases.total, 1);
  assert.equal(report.productScopes.callback.distinctCases.total, 0);
  assert.equal(report.productScopes.spreadsheet.distinctCases.total, 0);
});

test('same-source product-scope relabeling is rejected', () => {
  const callback = node(), spreadsheet = node(); callback.tests[0].productScope = 'callback'; spreadsheet.tests[0].productScope = 'spreadsheet';
  expectCode(() => aggregate([callback, spreadsheet]), 'CASE_CLASSIFICATION_CHANGED');
});

test('unknown product evidence scope is rejected', () => {
  const raw = node(); raw.tests[0].productScope = 'both-count-twice';
  expectCode(() => validateReport(raw), 'INVALID_PRODUCT_SCOPE');
});

test('an explicitly empty product scope is not treated as missing legacy metadata', () => {
  const raw = node(); raw.tests[0].productScope = '';
  expectCode(() => validateReport(raw), 'INVALID_PRODUCT_SCOPE');
});

test('an explicitly empty case kind cannot default to product coverage', () => {
  const raw = node(); raw.tests[0].kind = '';
  expectCode(() => validateReport(raw), 'INVALID_CASE_KIND');
});

test('an explicitly empty browser channel cannot default to a bundled browser', () => {
  const raw = browser(); raw.platform.browserChannel = '';
  expectCode(() => validateReport(raw), 'INVALID_PLATFORM');
});

test('selected-product browser reports require the matching deployment mode', () => {
  const raw = browser(['PASS'], { suite: 'callback', deploymentMode: 'combined' });
  expectCode(() => validateReport(raw), 'INVALID_DEPLOYMENT_MODE');
});

test('shared browser cases keep deployment provenance without double counting the portfolio', () => {
  const combined = browser(['PASS'], { deploymentMode: 'combined' });
  const callback = browser(['PASS'], { suite: 'callback', deploymentMode: 'callback' });
  const spreadsheet = browser(['PASS'], { suite: 'spreadsheet', deploymentMode: 'spreadsheet' });
  const report = aggregate([combined, callback, spreadsheet]);
  assert.equal(report.product.PASS, 1); assert.equal(report.productScopes.shared.executions.PASS, 1);
  assert.deepEqual(report.executions[0].deploymentModes, ['combined', 'callback', 'spreadsheet']);
});

test('duplicates inside one report are rejected rather than silently discarded', () => {
  const raw = node(); raw.tests.push(structuredClone(raw.tests[0]));
  expectCode(() => validateReport(raw), 'DUPLICATE_CASE');
});

for (const field of ['sourceCommit', 'gitTreeHash']) test('evidence rejects mixed ' + field, () => {
  const other = node(); other[field] = 'c'.repeat(40);
  expectCode(() => aggregate([node(), other]), 'MIXED_SOURCE');
});

test('evidence rejects differing source bytes even when the commit is unchanged', () => {
  const other = node(); other.sourceManifest[0].sha256 = sha('changed bytes');
  other.sourceTreeSha256 = sha(JSON.stringify(other.sourceManifest)); other.sourceTreeSha256After = other.sourceTreeSha256;
  expectCode(() => aggregate([node(), other]), 'MIXED_SOURCE');
});

test('evidence enforces an explicit requested source commit', () => {
  expectCode(() => aggregate([node()], { source: 'd'.repeat(40) }), 'UNEXPECTED_SOURCE');
});

for (const flag of ['sourceChanged', 'sourceChangedDuringRun']) test('evidence rejects a source change reported by ' + flag, () => {
  const raw = node(); raw[flag] = true;
  expectCode(() => validateReport(raw), 'SOURCE_CHANGED');
});

test('a post-run hash mismatch rejects all outcomes from that report', () => {
  const raw = node(); raw.sourceTreeSha256After = 'c'.repeat(64);
  expectCode(() => validateReport(raw), 'SOURCE_CHANGED');
});

test('manifest bytes must substantiate the declared source hash', () => {
  const raw = node(); raw.sourceManifest[0].sha256 = sha('different input');
  expectCode(() => validateReport(raw), 'SOURCE_HASH_MISMATCH');
});

test('duplicate source paths cannot pad a provenance manifest', () => {
  const raw = node(); raw.sourceManifest.push(structuredClone(raw.sourceManifest[0]));
  expectCode(() => validateReport(raw), 'INVALID_SOURCE_MANIFEST');
});

test('missing source stability metadata is not assumed safe', () => {
  const raw = node(); delete raw.sourceChanged;
  expectCode(() => validateReport(raw), 'MISSING_SOURCE');
});

for (const bad of [-1, NaN, Infinity, '1']) test('invalid case duration is rejected: ' + String(bad), () => {
  const raw = node(); raw.tests[0].durationMs = bad;
  expectCode(() => validateReport(raw), 'INVALID_CASE');
});

test('unknown outcomes never count as a pass', () => {
  const raw = node(); raw.tests[0].status = 'OK';
  expectCode(() => validateReport(raw), 'UNKNOWN_STATUS');
});

test('a zero-case successful report cannot establish coverage', () => {
  expectCode(() => validateReport(node([])), 'EMPTY_REPORT');
});

test('an infrastructure-only failure remains visible without inventing test executions', () => {
  const raw = node([], { summarySuccess: false, infrastructureErrors: [{ id: 'load-file', status: 'ERROR' }] });
  const report = aggregate([raw]);
  assert.equal(report.product.total, 0); assert.equal(report.reports[0].infrastructureErrors.length, 1);
  assert.equal(report.fullGoalAchieved, false);
});

test('missing browser methods make the evidence invalid', () => {
  const raw = browser(); raw.expectedMethods = 2;
  expectCode(() => validateReport(raw), 'MISSING_CASES');
});

test('an unlaunched browser cannot supply a PASS case', () => {
  const raw = browser(); raw.platform.observedBrowsers = [];
  expectCode(() => validateReport(raw), 'UNOBSERVED_BROWSER');
});

test('a version observed for another engine does not prove this browser ran', () => {
  const raw = browser(); raw.platform.observedBrowsers[0].engine = 'firefox';
  expectCode(() => validateReport(raw), 'UNOBSERVED_BROWSER');
});

test('forged platform keys cannot multiply execution counts', () => {
  const raw = node(); raw.tests[0].platformKey = 'windows/x86_64/node24';
  expectCode(() => validateReport(raw), 'PLATFORM_KEY_MISMATCH');
});

test('a browser run labeled PASS cannot contain a skipped method', () => {
  const raw = browser(['SKIP']); raw.status = 'PASS';
  expectCode(() => validateReport(raw), 'INCONSISTENT_RUN_STATUS');
});

test('a Node runner success flag cannot override failed cases', () => {
  const raw = node(['FAIL']); raw.summarySuccess = true;
  expectCode(() => validateReport(raw), 'INCONSISTENT_RUN_STATUS');
});

test('a failed same-source execution cannot be overwritten by a later pass', () => {
  for (const inputs of [[node(['FAIL']), node()], [node(), node(['FAIL'])]]) {
    const report = aggregate(inputs);
    assert.equal(report.product.FAIL, 1); assert.equal(report.product.PASS, 0);
    assert.equal(report.distinctCases.withAnyPass, 0); assert.equal(report.fullGoalAchieved, false);
  }
});

for (const status of ['SKIP', 'TODO', 'EXPECTED_FAILURE', 'BLOCKED', 'NOT_RUN', 'RUNNING', 'CANCELLED', 'UNEXPECTED_SUCCESS', 'ERROR']) test('an unresolved ' + status + ' observation cannot inflate passing coverage', () => {
  const raw = node([status], { summarySuccess: false });
  const report = aggregate([node(), raw]);
  assert.equal(report.product.PASS, 0); assert.equal(report.product[status], 1);
  assert.equal(report.distinctCases.withUnresolvedOutcome, 1); assert.equal(report.fullGoalAchieved, false);
});

test('numeric success remains distinct from an untested required OS', () => {
  const requirements = [...policy().requiredPlatforms, { id: 'windows', kind: 'node', match: { os: 'windows' } }];
  const report = aggregate([node(['PASS', 'PASS'])], { milestones: policy({ requiredPlatforms: requirements }) });
  assert.equal(report.numericTargetReached, true); assert.equal(report.platformCoverageComplete, false); assert.equal(report.fullGoalAchieved, false);
});

test('a platform report must meet its minimum case inventory', () => {
  const requirements = [{ id: 'linux', kind: 'node', match: { os: 'linux' }, minimumCases: 3 }];
  const report = aggregate([node(['PASS', 'PASS'])], { milestones: policy({ requiredPlatforms: requirements }) });
  assert.equal(report.requiredPlatforms[0].status, 'BLOCKED'); assert.equal(report.fullGoalAchieved, false);
});

test('dirty working-tree passes stay visible without becoming committed goal evidence', () => {
  const report = aggregate([node(['PASS', 'PASS'], { dirty: true })]);
  assert.equal(report.product.PASS, 2); assert.equal(report.numericTargetReached, true);
  assert.equal(report.source.cleanCommittedEvidence, false); assert.equal(report.fullGoalAchieved, false);
});

test('a previous infrastructure failure is not erased by a complete same-source rerun', () => {
  const failed = node([], { summarySuccess: false, infrastructureErrors: [{ id: 'runner', status: 'ERROR' }] });
  const report = aggregate([failed, node(['PASS', 'PASS'])]);
  assert.equal(report.product.PASS, 2); assert.equal(report.milestones.allObservedChecksPassed, false); assert.equal(report.fullGoalAchieved, false);
});

test('an early verified initial goal proposes doubling without mutating policy or claiming release', () => {
  const milestones = policy(), before = structuredClone(milestones);
  const report = aggregate([node(['PASS', 'PASS'])], { milestones });
  assert.equal(report.fullGoalAchieved, true); assert.equal(report.milestones.earlyTargetEligible, true);
  assert.equal(report.milestones.suggestedTarget, 4); assert.equal(report.milestones.earlyNumericTargetReached, false);
  assert.equal(report.milestones.policyChanged, false); assert.deepEqual(milestones, before);
  assert.equal(report.releaseDecision, 'NOT_DETERMINED_BY_TEST_COUNT');
});

test('the early rule uses the Detroit cutoff instant and excludes the cutoff itself', () => {
  const before = aggregate([node(['PASS', 'PASS'])], { now: '2026-12-31T04:59:59.999Z' });
  const at = aggregate([node(['PASS', 'PASS'])], { now: '2026-12-31T05:00:00.000Z' });
  assert.equal(before.milestones.earlyTargetEligible, true); assert.equal(at.milestones.earlyTargetEligible, false);
  assert.equal(at.fullGoalAchieved, true);
});

test('meeting the initial number does not satisfy an active doubled target', () => {
  const report = aggregate([node(['PASS', 'PASS'])], { milestones: policy({ activeTarget: 4 }) });
  assert.equal(report.milestones.initialGoalAchieved, true); assert.equal(report.numericTargetReached, false); assert.equal(report.fullGoalAchieved, false);
});

test('a recorded milestone date cannot bypass unverified physical platforms', () => {
  const milestones = policy({ firstGoalAchievedAt: '2026-11-19T12:00:00Z', requiredPlatforms: [{ id: 'actual-safari', kind: 'manual', match: { os: 'darwin' }, status: 'PASS' }] });
  const report = aggregate([node(['PASS', 'PASS'])], { milestones });
  assert.equal(report.milestones.earlyTargetEligible, false); assert.equal(report.milestones.suggestedTarget, 2); assert.equal(report.fullGoalAchieved, false);
});

for (const change of [
  { initialTarget: 0 }, { earlyTarget: 3 }, { activeTarget: 3 }, { deadline: '2026-12-31' },
  { timezone: 'Unknown/Place' }, { requiredPlatforms: [] },
  { requiredPlatforms: [{ id: 'linux', kind: 'node', match: { operating_system: 'linux' } }] }
]) test('malformed milestone policy is rejected: ' + JSON.stringify(change), () => {
  expectCode(() => validateMilestones(policy(change)), 'INVALID_POLICY');
});

test('recursive input discovery reads recognized reports and ignores other valid formats', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'panelreply-evidence-reader-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.mkdirSync(path.join(directory, 'nested'));
  fs.writeFileSync(path.join(directory, 'nested', 'report.json'), JSON.stringify(node()));
  fs.writeFileSync(path.join(directory, 'aggregate.json'), JSON.stringify({ format: 'panelreply-aggregate-evidence-v1' }));
  fs.writeFileSync(path.join(directory, 'details.txt'), 'not a report');
  const result = readReportDirectory(directory);
  assert.equal(result.reports.length, 1); assert.equal(result.reports[0].label, 'nested/report.json');
  assert.deepEqual(result.ignored, [{ path: 'aggregate.json', reason: 'unrecognized-format' }]);
});

test('truncated JSON cannot silently hide a failed report', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'panelreply-evidence-broken-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.writeFileSync(path.join(directory, 'broken.json'), '{"format":"panelreply-node-evidence-v1",');
  expectCode(() => readReportDirectory(directory), 'INVALID_JSON');
});

test('an empty recognized-report inventory cannot establish a goal', () => {
  expectCode(() => aggregate([]), 'NO_REPORTS');
});

function event(type, data) { return { type, data }; }
function nodeEvent(id, name, extras = {}) {
  return { testId: id, name, file: path.join(__dirname, 'synthetic-product.test.cjs'), entryFile: path.join(__dirname, 'synthetic-product.test.cjs'),
    line: 12, details: { duration_ms: 1 }, ...extras };
}
test('Node event collection excludes parent containers while retaining leaf lineage', () => {
  const parent = nodeEvent(1, 'parent');
  const child = nodeEvent(2, 'child', { parentId: 1 });
  const report = collectNodeResults([event('test:start', parent), event('test:start', child), event('test:pass', child), event('test:pass', parent), event('test:summary', { success: true })], path.resolve(__dirname, '..'), 'linux/x86_64/node24');
  assert.equal(report.tests.length, 1); assert.match(report.tests[0].id, /parent > child$/); assert.equal(report.summarySuccess, true);
});

test('an empty Node suite and successful file wrapper contribute no product cases', () => {
  const file = path.join(__dirname, 'synthetic-product.test.cjs');
  const empty = nodeEvent(1, 'empty suite', { details: { type: 'suite', duration_ms: 1 } });
  const wrapper = { testId: 2, name: file, file, entryFile: file, details: { duration_ms: 1 } };
  const report = collectNodeResults([event('test:pass', empty), event('test:pass', wrapper), event('test:summary', { success: true })], path.resolve(__dirname, '..'), 'linux/x86_64/node24');
  assert.equal(report.tests.length, 0); assert.equal(report.totals.passed, 0);
});

test('Node testId values reused by different files remain separate leaf identities', () => {
  const first = nodeEvent(1, 'same local name');
  const secondFile = path.join(__dirname, 'another-product.test.cjs');
  const second = nodeEvent(1, 'same local name', { file: secondFile, entryFile: secondFile });
  const report = collectNodeResults([event('test:pass', first), event('test:pass', second), event('test:summary', { success: true })], path.resolve(__dirname, '..'), 'linux/x86_64/node24');
  assert.equal(report.tests.length, 2); assert.notEqual(report.tests[0].id, report.tests[1].id);
});

test('a Node file crash is infrastructure failure rather than a passing phantom case', () => {
  const file = path.join(__dirname, 'synthetic-product.test.cjs');
  const crash = { testId: 1, name: file, file, entryFile: file, details: { error: new Error('synthetic file crash') } };
  const report = collectNodeResults([event('test:fail', crash), event('test:summary', { success: false })], path.resolve(__dirname, '..'), 'linux/x86_64/node24');
  assert.equal(report.tests.length, 0); assert.equal(report.infrastructureErrors.length, 1); assert.equal(report.summarySuccess, false);
});

test('Node skip and todo event outcomes stay separate from passes', () => {
  const report = collectNodeResults([event('test:pass', nodeEvent(1, 'skipped', { skip: 'reason' })), event('test:pass', nodeEvent(2, 'future', { todo: 'pending' })), event('test:summary', { success: true })], path.resolve(__dirname, '..'), 'linux/x86_64/node24');
  assert.equal(report.totals.passed, 0); assert.equal(report.totals.skipped, 1); assert.equal(report.totals.todo, 1);
});

test('Node generated family and evidence-harness classification are explicit', () => {
  const generated = nodeEvent(1, 'REM-example | input-sha256=example');
  const evidenceFile = path.join(__dirname, 'release-evidence.test.cjs');
  const harness = nodeEvent(2, 'counter check', { file: evidenceFile, entryFile: evidenceFile });
  const report = collectNodeResults([event('test:pass', generated), event('test:pass', harness), event('test:summary', { success: true })], path.resolve(__dirname, '..'), 'linux/x86_64/node24');
  assert.equal(report.tests[0].generated, true); assert.equal(report.tests[0].caseFamily, 'REM');
  assert.equal(report.tests[1].kind, 'harness'); assert.equal(report.totals.harnessPassed, 1);
});

test('Node duplicate named leaf identities fail collection', () => {
  const items = [event('test:pass', nodeEvent(1, 'same')), event('test:pass', nodeEvent(2, 'same'))];
  assert.throws(() => collectNodeResults(items, path.resolve(__dirname, '..'), 'linux/x86_64/node24'), /Duplicate case identifier/);
});

test('selected program case labels retain their own product scope and shared boundaries count once', () => {
  const cases = [
    ['product-ui', 'PRODUCT-UI callback login opens only its expected home', 'callback'],
    ['product-ui', 'PRODUCT-UI spreadsheet panels exposes only spreadsheet navigation and branding', 'spreadsheet'],
    ['product-ui', 'PRODUCT-UI shared rejects unknown product identifier', 'shared'],
    ['product-backup', 'callback authenticated backup preserves binding and data', 'callback'],
    ['product-backup', 'spreadsheet fixed entrypoint starts its restored workspace', 'spreadsheet'],
    ['product-backup', 'backup CLI rejects ambiguous products and missing paths', 'shared'],
    ['product-config', 'PROD.storage.callback.mismatch | refuses spreadsheet data', 'callback'],
    ['product-config', 'PROD.start.spreadsheet.provider | assistant options fail before storage', 'spreadsheet'],
    ['product-config', 'PROD.api.unbound | explicit product APIs refuse an unmarked real store', 'shared'],
    ['product-boundaries', 'PROD.workflow.callback | intake works without panel capabilities', 'callback'],
    ['product-boundaries', 'PROD.workflow.spreadsheet | export works without callback routes', 'spreadsheet'],
    ['product-boundaries', 'PROD.cookies.localhost | both product cookies coexist', 'shared'],
    ['platform-client-state', 'intake callback navigation preserves its program title', 'callback'],
    ['platform-client-state', 'intake combined navigation preserves its program title', 'callback'],
    ['platform-client-state', 'panel initial network failure exposes an enabled retry', 'spreadsheet'],
    ['platform-client-state', 'new-project quota rejection keeps the draft editable', 'spreadsheet'],
    ['platform-client-state', 'saved-project version conflict retains the draft', 'spreadsheet'],
    ['platform-client-state', 'dashboard retry clears old records', 'shared']
  ];
  const items = cases.map(([file, name], index) => {
    const filename = path.join(__dirname, file + '.test.cjs');
    return event('test:pass', nodeEvent(index + 1, name, { file: filename, entryFile: filename }));
  });
  const report = collectNodeResults([...items, event('test:summary', { success: true })], path.resolve(__dirname, '..'), 'linux/x86_64/node24');
  assert.equal(report.tests.length, cases.length);
  assert.deepEqual(report.tests.map(item => item.productScope), cases.map(item => item[2]));
});
