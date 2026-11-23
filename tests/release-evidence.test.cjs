'use strict';

// Evidence-harness tests. The release reporter labels this file kind=harness,
// so none of these cases contributes to the product's 10,000/20,000 goal.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync, spawnSync } = require('node:child_process');
const { aggregateReports, validateReport, validateMilestones, readReportDirectory } = require('../scripts/aggregate-test-evidence.cjs');
const { collectNodeResults, productScope, sourceEvidence, MILESTONE_POLICY_PATH } = require('../scripts/test-evidence.cjs');

const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const FILE = 'tests/synthetic-product.test.cjs';
const NOW = '2026-11-20T17:00:00.000Z';
function source() {
  const sourceManifest = [{ path: MILESTONE_POLICY_PATH, sha256: sha(JSON.stringify(policy())) },
    { path: 'workspace/example.cjs', sha256: sha('synthetic application source') }];
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
const CALLBACK_MOBILE_PROFILES = ['phone_portrait', 'phone_landscape', 'tablet_portrait', 'tablet_landscape'];
const CALLBACK_MOBILE_BEHAVIORS = ['scheduling_lifecycle', 'blocked_contact', 'unsaved_edits'];
function touchPair() {
  return [{ type: 'touchstart', trusted: true, touches: 1, changedTouches: 1 },
    { type: 'touchend', trusted: true, touches: 0, changedTouches: 1 }];
}
function callbackMobile({ engine = 'chromium', profile = 'phone_portrait', statuses = ['PASS', 'PASS', 'PASS'] } = {}) {
  const raw = browser(statuses, { profile, suite: 'callback-mobile', deploymentMode: 'callback',
    platform: { browserEngine: engine, observedBrowsers: [{ engine, channel: 'bundled', version: '151.0.1' }] } });
  raw.tests.forEach((item, index) => Object.assign(item, {
    id: `callback_mobile_browser_test.CallbackMobileBrowserTests.test_${profile}_${CALLBACK_MOBILE_BEHAVIORS[index]}`,
    productScope: 'callback', emulation: { has_touch: true, is_mobile: true },
    touchEvidence: { observed: { touchEvents: true, maxTouchPoints: engine === 'webkit' ? 0 : 1 }, events: touchPair(),
      actions: [{ action: 'schedule-task', events: touchPair() }] }
  }));
  return raw;
}
function callbackMobileReports() {
  return ['chromium', 'webkit'].flatMap(engine => CALLBACK_MOBILE_PROFILES.map(profile => callbackMobile({ engine, profile })));
}
function callbackMobileRequirements() {
  return JSON.parse(fs.readFileSync(path.join(__dirname, '..', MILESTONE_POLICY_PATH), 'utf8'))
    .requiredPlatforms.filter(entry => entry.match.suite === 'callback-mobile');
}
const SAFARI_METHODS = {
  'callback-safari': ['test_contact_hold_and_keyboard_dirty_edit_guard', 'test_intake_status_persistence_and_sign_out', 'test_schedule_reschedule_outcome_follow_up_and_cancel'],
  'spreadsheet-manual-safari': ['test_bound_recovery_revokes_archived_sessions_and_credentials', 'test_file_upload_source_links_and_unavailable_ocr', 'test_manual_corrections_persist_and_native_downloads_match']
};
function safari(suite = 'callback-safari', statuses = ['PASS', 'PASS', 'PASS']) {
  const product = suite === 'callback-safari' ? 'callback' : 'spreadsheet';
  const name = product === 'callback' ? 'SafariCallbackBrowserTests' : 'SafariSpreadsheetBrowserTests';
  const installation = {
    driver: { path: '/usr/bin/safaridriver', version: 'Included with Safari 26.6 (20624.4.5.18.1)', sha256: sha('native Apple driver') },
    browser: { path: '/Applications/Safari.app', bundleIdentifier: 'com.apple.Safari', version: '26.6', build: '20624.4.5.18.1',
      infoPlistSha256: sha('installed Safari metadata'), executablePath: '/Applications/Safari.app/Contents/MacOS/Safari', executableSha256: sha('installed Safari executable') },
    host: { osVersion: '15.7.9', osBuild: '24G507', architecture: 'x86_64' }
  };
  const nativeSafari = { format: 'apple-safaridriver-v1', state: 'OBSERVED', before: installation,
    after: structuredClone(installation), stable: true,
    requestedCapabilities: { browserName: 'safari', platformName: 'mac', browserVersion: '26.6', 'safari:useSimulator': false, pageLoadStrategy: 'normal' },
    session: { browserName: 'Safari', browserVersion: '26.6', platformName: 'mac', 'safari:useSimulator': false,
      'safari:platformVersion': '15.7.9', 'safari:platformBuildVersion': '24G507' },
    unavailableSessionCapabilities: [], sessionSha256: sha('native session identity') };
  const raw = browser(statuses, { suite, deploymentMode: product, platform: {
    os: 'Darwin', architecture: 'x86_64', browserEngine: 'webkit', browserChannel: 'safari', emulated: false, selenium: '4.54.0',
    observedBrowsers: [{ engine: 'webkit', channel: 'safari', version: '26.6' }], nativeSafari
  } });
  raw.tests.forEach((item, index) => Object.assign(item, {
    id: 'safari_product_browser_test.' + name + '.' + SAFARI_METHODS[suite][index], productScope: product,
    nativeSessionSha256: nativeSafari.sessionSha256, observedViewport: { width: 1400, height: 850, devicePixelRatio: 2 },
    downloadEvidence: index === 2 && product === 'spreadsheet' ? ['csv', 'xlsx'].map(format => ({
      format, filename: `panelreply-project-00000000-0000-4000-8000-000000000001.${format}`, status: 'OBSERVED',
      trigger: 'native WebDriver export button', bytes: 200, expectedBytes: 200,
      sha256: sha(format + ' actual file'), expectedSha256: sha(format + ' actual file')
    })) : []
  }));
  return raw;
}
function safariRequirements() {
  return JSON.parse(fs.readFileSync(path.join(__dirname, '..', MILESTONE_POLICY_PATH), 'utf8'))
    .requiredPlatforms.filter(entry => Object.hasOwn(SAFARI_METHODS, entry.match.suite));
}
function refreshSourceHash(report) {
  report.sourceTreeSha256 = sha(JSON.stringify(report.sourceManifest));
  report.sourceTreeSha256After = report.sourceTreeSha256;
  return report;
}
function bindSyntheticPolicy(report, policySha256) {
  const result = structuredClone(report);
  result.sourceManifest = result.sourceManifest.filter(entry => entry.path !== MILESTONE_POLICY_PATH);
  result.sourceManifest.push({ path: MILESTONE_POLICY_PATH, sha256: policySha256 });
  result.sourceManifest.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  return refreshSourceHash(result);
}
function aggregate(reports, overrides = {}) {
  const milestones = overrides.milestones || policy(), policySha256 = sha(JSON.stringify(milestones));
  // Existing counter tests select synthetic policies before their synthetic
  // executions. Binding rejection tests supply their hashes/reports directly.
  const inputs = overrides.milestones ? reports.map(report => bindSyntheticPolicy(report, policySha256)) : reports;
  return aggregateReports(inputs, { milestones, policySha256, now: NOW, ...overrides });
}
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

test('callback mobile policy requires all eight fixed-product emulation scopes', () => {
  const requirements = callbackMobileRequirements();
  assert.equal(requirements.length, 8);
  for (const engine of ['chromium', 'webkit']) for (const profile of CALLBACK_MOBILE_PROFILES) {
    const requirement = requirements.find(entry => entry.match.browserEngine === engine && entry.match.profile === profile);
    assert.ok(requirement, engine + '/' + profile);
    assert.equal(requirement.kind, 'browser'); assert.equal(requirement.minimumCases, 3);
    assert.deepEqual(requirement.match, { os: 'linux', architecture: 'x86_64', browserEngine: engine,
      browserChannel: 'bundled', profile, suite: 'callback-mobile', deploymentMode: 'callback' });
  }
});

test('callback mobile counts 24 scoped executions once and leaves physical-device acceptance open', () => {
  const inputs = callbackMobileReports();
  const requirements = [...callbackMobileRequirements(), { id: 'physical-iphone', kind: 'manual', match: { os: 'ios' } }];
  const report = aggregate([...inputs, ...structuredClone(inputs)], { milestones: policy({ requiredPlatforms: requirements }) });
  assert.equal(report.product.PASS, 24); assert.equal(report.distinctCases.total, 12);
  assert.equal(report.observations, 48); assert.equal(report.duplicateObservationsExcluded, 24);
  assert.equal(report.productScopes.callback.executions.PASS, 24); assert.equal(report.productScopes.shared.executions.PASS, 0);
  assert.equal(report.requiredPlatforms.filter(entry => entry.complete).length, 8);
  assert.equal(report.requiredPlatforms.at(-1).status, 'NOT_TESTED'); assert.equal(report.fullGoalAchieved, false);
  assert.ok(report.executions.every(item => item.platform.emulated));
  assert.ok(report.executions.every(item => item.contexts.length === 1
    && item.contexts[0].suite === 'callback-mobile' && item.contexts[0].deploymentMode === 'callback'));
});

test('combined mobile and fixed desktop reports cannot satisfy callback mobile requirements', () => {
  const combined = callbackMobileReports().map(report => ({ ...report, suite: 'mobile', deploymentMode: 'combined' }));
  const desktop = browser(['PASS', 'PASS', 'PASS'], { suite: 'callback', deploymentMode: 'callback' });
  desktop.tests.forEach(item => { item.productScope = 'callback'; });
  const report = aggregate([...combined, desktop], { milestones: policy({ requiredPlatforms: callbackMobileRequirements() }) });
  assert.ok(report.requiredPlatforms.every(entry => entry.status === 'NOT_TESTED'));
  assert.equal(report.platformCoverageComplete, false);
});

test('callback mobile rejects absent or different product deployment metadata', () => {
  for (const deploymentMode of [undefined, 'combined', 'spreadsheet']) {
    const raw = callbackMobile(); raw.deploymentMode = deploymentMode;
    expectCode(() => validateReport(raw), 'INVALID_DEPLOYMENT_MODE');
  }
});

test('callback mobile rejects another host, engine, channel or desktop profile', () => {
  const mutations = [
    raw => { raw.platform.os = 'Windows'; },
    raw => { raw.platform.os = 'Darwin'; },
    raw => { raw.platform.browserEngine = 'firefox'; },
    raw => { raw.platform.browserChannel = 'chrome'; },
    raw => { raw.tests[0].emulated = false; },
    raw => { raw.tests[0].profile = 'desktop'; raw.tests[0].emulated = false; raw.tests[0].platformKey = 'linux/x86_64/chromium/bundled/desktop'; },
    raw => { raw.tests[0].profile = 'unknown-device'; raw.tests[0].platformKey = 'linux/x86_64/chromium/bundled/unknown-device'; }
  ];
  for (const mutate of mutations) {
    const raw = callbackMobile(); mutate(raw);
    expectCode(() => validateReport(raw), 'INVALID_PLATFORM');
  }
});

test('callback mobile cannot default to shared or spreadsheet product coverage', () => {
  for (const productScope of [undefined, 'shared', 'spreadsheet']) {
    const raw = callbackMobile(); raw.tests[0].productScope = productScope;
    expectCode(() => validateReport(raw), 'INVALID_PRODUCT_SCOPE');
  }
});

test('callback mobile rejects viewport-only, synthetic or missing workflow touch proof', () => {
  const mutations = [
    item => { delete item.touchEvidence; },
    item => { delete item.emulation; },
    item => { item.emulation.has_touch = false; },
    item => { item.emulation.is_mobile = false; },
    item => { item.touchEvidence.observed.touchEvents = false; },
    item => { item.touchEvidence.events = []; },
    item => { item.touchEvidence.events[0].trusted = false; },
    item => { item.touchEvidence.events[1].touches = 1; },
    item => { item.touchEvidence.actions = []; },
    item => { item.touchEvidence.actions[0].action = ''; },
    item => { item.touchEvidence.actions[0].events[0].trusted = false; },
    item => { item.touchEvidence.actions[0].events[0].type = 'mousedown'; },
    item => { item.touchEvidence.actions[0].events[1].changedTouches = 0; },
    item => { item.touchEvidence.actions[0].events.pop(); }
  ];
  for (const mutate of mutations) {
    const raw = callbackMobile(); mutate(raw.tests[0]);
    expectCode(() => validateReport(raw), 'MISSING_TRUSTED_TOUCH');
  }
});

test('callback mobile records failed and unexecuted cases without fabricated touch metadata', () => {
  for (const status of ['FAIL', 'NOT_RUN']) {
    const raw = callbackMobile({ statuses: [status, status, status] });
    raw.tests.forEach(item => { delete item.touchEvidence; delete item.emulation; });
    const report = aggregate([raw], { milestones: policy({ requiredPlatforms: callbackMobileRequirements().slice(0, 1) }) });
    assert.equal(report.product[status], 3); assert.equal(report.product.PASS, 0);
    assert.equal(report.requiredPlatforms[0].status, status === 'FAIL' ? 'FAIL' : 'BLOCKED');
    assert.equal(report.platformCoverageComplete, false);
  }
});

test('a missing callback profile cannot borrow coverage from another orientation or engine', () => {
  const report = aggregate(callbackMobileReports().slice(0, -1), { milestones: policy({ requiredPlatforms: callbackMobileRequirements() }) });
  assert.equal(report.product.PASS, 21);
  assert.equal(report.requiredPlatforms.filter(entry => entry.complete).length, 7);
  assert.equal(report.requiredPlatforms.at(-1).status, 'NOT_TESTED');
});

test('a failed or omitted callback journey leaves its profile requirement unresolved', () => {
  for (const omission of [false, true]) {
    const inputs = callbackMobileReports(), changed = inputs.at(-1);
    if (omission) { changed.tests.pop(); changed.expectedMethods--; }
    else { changed.tests[2].status = 'FAIL'; changed.status = 'FAIL'; }
    const report = aggregate(inputs, { milestones: policy({ requiredPlatforms: callbackMobileRequirements() }) });
    assert.equal(report.requiredPlatforms.filter(entry => entry.complete).length, 7);
    assert.equal(report.requiredPlatforms.at(-1).passingExecutions, 2);
    assert.equal(report.requiredPlatforms.at(-1).status, omission ? 'BLOCKED' : 'FAIL');
    assert.equal(report.platformCoverageComplete, false);
  }
});

test('suite and deployment matches must belong to the same execution observation', () => {
  const combined = browser(['PASS'], { suite: 'private', deploymentMode: 'combined' });
  const callback = browser(['PASS'], { suite: 'callback', deploymentMode: 'callback' });
  const requirements = [
    { id: 'invented-context', kind: 'browser', match: { suite: 'private', deploymentMode: 'callback' } },
    { id: 'actual-combined', kind: 'browser', match: { suite: 'private', deploymentMode: 'combined' } },
    { id: 'actual-callback', kind: 'browser', match: { suite: 'callback', deploymentMode: 'callback' } }
  ];
  const report = aggregate([combined, callback], { milestones: policy({ requiredPlatforms: requirements }) });
  assert.equal(report.product.PASS, 1);
  assert.deepEqual(report.requiredPlatforms.map(entry => entry.status), ['NOT_TESTED', 'PASS', 'PASS']);
  assert.deepEqual(report.executions[0].contexts, [
    { suite: 'private', deploymentMode: 'combined' }, { suite: 'callback', deploymentMode: 'callback' }
  ]);
});

test('manual spreadsheet evidence retains the fixed product and actual macOS boundary', () => {
  const raw = browser(['PASS'], { suite: 'spreadsheet-manual', deploymentMode: 'spreadsheet',
    platform: { os: 'Darwin', architecture: 'arm64' } });
  assert.equal(validateReport(raw).tests.length, 1);
  const wrongProduct = structuredClone(raw); wrongProduct.deploymentMode = 'combined';
  expectCode(() => validateReport(wrongProduct), 'INVALID_DEPLOYMENT_MODE');
  const wrongPlatform = browser(['PASS'], { suite: 'spreadsheet-manual', deploymentMode: 'spreadsheet' });
  expectCode(() => validateReport(wrongPlatform), 'INVALID_PLATFORM');
});

test('macOS manual spreadsheet passes cannot satisfy the extraction suite or full platform acceptance', () => {
  const raw = browser(['PASS'], { suite: 'spreadsheet-manual', deploymentMode: 'spreadsheet',
    platform: { os: 'Darwin', architecture: 'x86_64' } });
  const requirements = [
    { id: 'mac-manual', kind: 'browser', match: { os: 'darwin', suite: 'spreadsheet-manual' }, minimumCases: 1 },
    { id: 'mac-full', kind: 'browser', match: { os: 'darwin', suite: 'spreadsheet' }, minimumCases: 1 },
    { id: 'physical-and-native', kind: 'manual', match: {}, status: 'NOT_TESTED' }
  ];
  const report = aggregate([raw], { milestones: policy({ requiredPlatforms: requirements }) });
  assert.equal(report.requiredPlatforms[0].status, 'PASS');
  assert.equal(report.requiredPlatforms[1].status, 'NOT_TESTED');
  assert.equal(report.requiredPlatforms[2].status, 'NOT_TESTED');
  assert.equal(report.platformCoverageComplete, false);
});

test('reused spreadsheet method IDs count once per actual OS and architecture', () => {
  const linux = browser(['PASS'], { suite: 'spreadsheet', deploymentMode: 'spreadsheet' });
  const intel = browser(['PASS'], { suite: 'spreadsheet-manual', deploymentMode: 'spreadsheet',
    platform: { os: 'Darwin', architecture: 'x86_64' } });
  const arm = browser(['PASS'], { suite: 'spreadsheet-manual', deploymentMode: 'spreadsheet',
    platform: { os: 'Darwin', architecture: 'arm64' } });
  const report = aggregate([linux, intel, arm, structuredClone(arm)]);
  assert.equal(report.product.PASS, 3);
  assert.equal(report.distinctCases.total, 1);
  assert.equal(report.duplicateObservationsExcluded, 1);
});

test('native Safari product scopes count six observed journeys while all manual gates stay open', () => {
  const requiredPlatforms = [...safariRequirements(), { id: 'actual-safari-acceptance', kind: 'manual', match: {} },
    { id: 'physical-iphone', kind: 'manual', match: {} }];
  assert.equal(safariRequirements().length, 2);
  const report = aggregate([safari(), safari('spreadsheet-manual-safari')], { milestones: policy({ requiredPlatforms }) });
  assert.equal(report.product.PASS, 6);
  assert.deepEqual(report.requiredPlatforms.map(item => item.status), ['PASS', 'PASS', 'NOT_TESTED', 'NOT_TESTED']);
  assert.equal(report.platformCoverageComplete, false);
  assert.equal(report.productScopes.callback.executions.PASS, 3);
  assert.equal(report.productScopes.spreadsheet.executions.PASS, 3);
});

test('native Safari reruns add no cases and bundled WebKit cannot satisfy native requirements', () => {
  const requiredPlatforms = safariRequirements();
  const report = aggregate([safari(), safari(), safari('spreadsheet-manual-safari')], { milestones: policy({ requiredPlatforms }) });
  assert.equal(report.product.PASS, 6);
  assert.equal(report.duplicateObservationsExcluded, 3);
  const bundled = browser(['PASS'], { suite: 'callback', deploymentMode: 'callback',
    platform: { os: 'Darwin', browserEngine: 'webkit', observedBrowsers: [{ engine: 'webkit', channel: 'bundled', version: '26.6' }] } });
  const other = aggregate([bundled], { milestones: policy({ requiredPlatforms }) });
  assert.deepEqual(other.requiredPlatforms.map(item => item.status), ['NOT_TESTED', 'NOT_TESTED']);
});

test('native Safari rejects combined deployment, another product, invented methods and hidden methods', () => {
  const combined = safari(); combined.deploymentMode = 'combined';
  expectCode(() => validateReport(combined), 'INVALID_DEPLOYMENT_MODE');
  const wrong = safari(); wrong.tests[0].productScope = 'spreadsheet';
  expectCode(() => validateReport(wrong), 'INVALID_PRODUCT_SCOPE');
  const invented = safari(); invented.tests[0].id += '_duplicate';
  expectCode(() => validateReport(invented), 'INVALID_NATIVE_SAFARI_CASES');
  const missing = safari(); missing.tests.pop(); missing.expectedMethods--;
  expectCode(() => validateReport(missing), 'INVALID_NATIVE_SAFARI_CASES');
});

test('native Safari cannot be established by another OS, architecture, engine or emulated profile', () => {
  for (const [key, value] of [['os', 'Linux'], ['architecture', 'arm64'], ['browserEngine', 'chromium'], ['browserChannel', 'bundled'], ['emulated', true]]) {
    const raw = safari(); raw.platform[key] = value;
    expectCode(() => validateReport(raw), 'INVALID_PLATFORM');
  }
  const mobile = safari(); mobile.tests[0].profile = 'phone_portrait'; mobile.tests[0].emulated = true;
  expectCode(() => validateReport(mobile), 'INVALID_PLATFORM');
  const portable = safari(); portable.suite = 'portable';
  expectCode(() => validateReport(portable), 'INVALID_PLATFORM');
});

test('native Safari requires observed unchanged Apple driver and release app identity', () => {
  const missing = safari(); delete missing.platform.nativeSafari;
  expectCode(() => validateReport(missing), 'MISSING_NATIVE_SAFARI');
  const changed = safari(); changed.platform.nativeSafari.after.driver.sha256 = sha('replacement driver');
  expectCode(() => validateReport(changed), 'UNSTABLE_NATIVE_SAFARI');
  const unobserved = safari(); unobserved.platform.nativeSafari.state = 'UNAVAILABLE';
  expectCode(() => validateReport(unobserved), 'UNSTABLE_NATIVE_SAFARI');
  const driver = safari(); driver.platform.nativeSafari.before.driver.path = '/tmp/safaridriver';
  driver.platform.nativeSafari.after = structuredClone(driver.platform.nativeSafari.before);
  expectCode(() => validateReport(driver), 'INVALID_NATIVE_SAFARI_DRIVER');
  const preview = safari(); preview.platform.nativeSafari.before.browser.bundleIdentifier = 'com.apple.SafariTechnologyPreview';
  preview.platform.nativeSafari.after = structuredClone(preview.platform.nativeSafari.before);
  expectCode(() => validateReport(preview), 'INVALID_NATIVE_SAFARI_BROWSER');
  for (const version of ['Included with Safari 26.6.1 (20624.4.5.18.1)', 'Included with Safari 26.6 (20624.4.5.18.12)']) {
    const suffix = safari(); suffix.platform.nativeSafari.before.driver.version = version;
    suffix.platform.nativeSafari.after = structuredClone(suffix.platform.nativeSafari.before);
    expectCode(() => validateReport(suffix), 'INVALID_NATIVE_SAFARI_BROWSER');
  }
});

test('native Safari passes are bound to the requested desktop and measured native session', () => {
  for (const change of [
    raw => { raw.platform.nativeSafari.session.platformName = 'iOS'; },
    raw => { raw.platform.nativeSafari.session.browserName = 'Safari Technology Preview'; },
    raw => { raw.platform.nativeSafari.session.browserVersion = '26.5'; },
    raw => { raw.platform.nativeSafari.session['safari:useSimulator'] = true; },
    raw => { raw.platform.nativeSafari.session['safari:platformVersion'] = '15.7.8'; },
    raw => { raw.platform.nativeSafari.session['safari:platformBuildVersion'] = '24G508'; },
    raw => { raw.platform.nativeSafari.requestedCapabilities['safari:useSimulator'] = true; },
    raw => { raw.platform.nativeSafari.requestedCapabilities.browserName = 'Safari'; },
    raw => { delete raw.platform.nativeSafari.requestedCapabilities.browserVersion; },
    raw => { delete raw.platform.nativeSafari.session['safari:platformVersion']; },
    raw => { raw.tests[0].nativeSessionSha256 = sha('different session'); },
    raw => { raw.platform.observedBrowsers[0].version = '26.5'; },
    raw => { raw.platform.selenium = 'unmeasured'; }
  ]) {
    const raw = safari(); change(raw);
    expectCode(() => validateReport(raw), 'INVALID_NATIVE_SAFARI_SESSION');
  }
  const absent = safari();
  absent.platform.nativeSafari.unavailableSessionCapabilities = ['safari:platformVersion', 'safari:platformBuildVersion'];
  for (const key of absent.platform.nativeSafari.unavailableSessionCapabilities) delete absent.platform.nativeSafari.session[key];
  assert.equal(validateReport(absent).complete, true);
});

test('native Safari must report the actual desktop viewport without inventing narrow-screen coverage', () => {
  for (const viewport of [null, { width: 320, height: 1000, devicePixelRatio: 2 },
    { width: 1400, height: 850 }, { width: 1400, height: 850, devicePixelRatio: 0 }]) {
    const raw = safari(); raw.tests[0].observedViewport = viewport;
    expectCode(() => validateReport(raw), 'MISSING_NATIVE_SAFARI_VIEWPORT');
  }
});

test('native Safari export passes require both browser-created files rather than API-only data', () => {
  for (const change of [
    raw => { raw.tests[2].downloadEvidence = []; },
    raw => { raw.tests[2].downloadEvidence[1].format = 'csv'; },
    raw => { raw.tests[2].downloadEvidence[1].status = 'NOT_OBSERVED'; },
    raw => { raw.tests[2].downloadEvidence[1].trigger = 'HTTP readback'; },
    raw => { raw.tests[2].downloadEvidence[1].sha256 = sha('truncated bytes'); },
    raw => { raw.tests[2].downloadEvidence[1].bytes = 0; }
  ]) {
    const raw = safari('spreadsheet-manual-safari'); change(raw);
    expectCode(() => validateReport(raw), 'UNOBSERVED_NATIVE_DOWNLOAD');
  }
});

test('an unavailable native Safari driver leaves all product cases unexecuted', () => {
  const raw = safari('callback-safari', ['NOT_RUN', 'NOT_RUN', 'NOT_RUN']);
  raw.status = 'BLOCKED';
  raw.infrastructureErrors = [{ id: 'native-safari-session', status: 'ERROR', classification: 'NATIVE_SAFARI_UNAVAILABLE' }];
  raw.platform.observedBrowsers = [];
  raw.platform.nativeSafari = { format: 'apple-safaridriver-v1', state: 'UNAVAILABLE' };
  for (const item of raw.tests) { item.nativeSessionSha256 = null; item.observedViewport = null; }
  const report = aggregate([raw], { milestones: policy({ requiredPlatforms: safariRequirements() }) });
  assert.equal(report.product.PASS, 0);
  assert.equal(report.product.NOT_RUN, 3);
  assert.equal(report.requiredPlatforms[0].complete, false);
});

test('native Safari runner, cases and pinned dependency files enter the shared source manifest', () => {
  const manifest = new Map(sourceEvidence(path.join(__dirname, '..')).sourceManifest.map(item => [item.path, item.sha256]));
  for (const filename of ['tests/release_safari_runner.py', 'tests/safari_product_browser_test.py', 'tests/safari-requirements.txt']) {
    assert.equal(manifest.get(filename), sha(fs.readFileSync(path.join(__dirname, '..', filename))));
  }
});

test('callback scheduling and task cases stay in the callback product ledger', () => {
  for (const file of ['callback-schedule.test.cjs', 'callback-schedule-client.test.cjs',
    'callback-task-api.test.cjs', 'callback-tasks.test.cjs']) {
    assert.equal(productScope('tests/' + file, 'synthetic scheduled work'), 'callback', file);
  }
  assert.equal(productScope('tests/unrelated.test.cjs', 'callback'), 'shared');
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
  const other = node(); other.sourceManifest.find(entry => entry.path === 'workspace/example.cjs').sha256 = sha('changed bytes');
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

test('shared source evidence includes exact policy bytes and detects policy changes during execution', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'panelreply-policy-source-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.mkdirSync(path.join(directory, 'docs'));
  fs.mkdirSync(path.join(directory, 'workspace'));
  const policyFile = path.join(directory, MILESTONE_POLICY_PATH), bytes = JSON.stringify(policy(), null, 2) + '\n';
  fs.writeFileSync(policyFile, bytes);
  fs.writeFileSync(path.join(directory, 'docs/progress.md'), 'Synthetic progress.\n');
  fs.writeFileSync(path.join(directory, 'workspace/example.cjs'), 'module.exports = true;\n');
  const git = args => execFileSync('git', ['-c', 'core.autocrlf=false', '-c', 'commit.gpgsign=false',
    '-c', 'user.name=Evidence Fixture', '-c', 'user.email=evidence@example.test', ...args], { cwd: directory, encoding: 'utf8', windowsHide: true });
  git(['init', '--quiet']); git(['add', '.']); git(['commit', '--quiet', '-m', 'Synthetic evidence fixture']);
  const before = sourceEvidence(directory);
  assert.deepEqual(before.sourceManifest.find(entry => entry.path === MILESTONE_POLICY_PATH), { path: MILESTONE_POLICY_PATH, sha256: sha(bytes) });
  fs.writeFileSync(path.join(directory, 'docs/progress.md'), 'Synthetic progress changed.\n');
  assert.equal(sourceEvidence(directory).sourceTreeSha256, before.sourceTreeSha256);
  fs.writeFileSync(policyFile, JSON.stringify(policy()) + '\n');
  const after = sourceEvidence(directory);
  assert.equal(after.sourceCommit, before.sourceCommit);
  assert.notEqual(after.sourceTreeSha256, before.sourceTreeSha256);
  assert.notEqual(after.sourceManifest.find(entry => entry.path === MILESTONE_POLICY_PATH).sha256,
    before.sourceManifest.find(entry => entry.path === MILESTONE_POLICY_PATH).sha256);
  expectCode(() => validateReport({ ...node(), ...before, sourceTreeSha256After: after.sourceTreeSha256 }), 'SOURCE_CHANGED');
});

test('aggregation requires an explicit policy digest and records the matched policy identity', () => {
  expectCode(() => aggregateReports([node()], { milestones: policy() }), 'MISSING_POLICY_HASH');
  for (const policySha256 of [null, '', 'not-a-digest', 'A'.repeat(64)]) {
    expectCode(() => aggregateReports([node()], { milestones: policy(), policySha256 }), 'INVALID_POLICY_HASH');
  }
  const report = aggregate([node(), browser()]);
  assert.deepEqual(report.policy, { path: MILESTONE_POLICY_PATH, sha256: sha(JSON.stringify(policy())) });
});

test('every report must contain the policy even when the first report binds it', () => {
  const missing = browser();
  missing.sourceManifest = missing.sourceManifest.filter(entry => entry.path !== MILESTONE_POLICY_PATH);
  refreshSourceHash(missing);
  expectCode(() => aggregate([node(), missing]), 'MISSING_POLICY_SOURCE');
});

test('a policy mismatch in any report fails before combining its passing cases', () => {
  const mismatched = bindSyntheticPolicy(browser(), sha('different policy bytes'));
  expectCode(() => aggregate([node(), mismatched]), 'POLICY_HASH_MISMATCH');
  expectCode(() => aggregate([mismatched, node()]), 'POLICY_HASH_MISMATCH');
});

function policyCliFixture(t, { policyBytes = JSON.stringify(policy(), null, 2) + '\n', reports = [node(), browser()] } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'panelreply-policy-cli-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  for (const name of ['scripts', 'docs', 'input']) fs.mkdirSync(path.join(directory, name));
  for (const name of ['aggregate-test-evidence.cjs', 'test-evidence.cjs']) {
    fs.copyFileSync(path.join(__dirname, '../scripts', name), path.join(directory, 'scripts', name));
  }
  const policyFile = path.join(directory, MILESTONE_POLICY_PATH), output = path.join(directory, 'aggregate.json');
  fs.writeFileSync(policyFile, policyBytes);
  const boundReports = reports.map(report => bindSyntheticPolicy(report, sha(policyBytes)));
  const writeReport = (index, report) => fs.writeFileSync(path.join(directory, 'input', index + '.json'), JSON.stringify(report));
  boundReports.forEach((report, index) => writeReport(index, report));
  return { policyFile, policyBytes, reports: boundReports, writeReport,
    run() {
      const execution = spawnSync(process.execPath, [path.join(directory, 'scripts/aggregate-test-evidence.cjs'),
        '--input', path.join(directory, 'input'), '--output', output, '--source', 'a'.repeat(40)],
      { encoding: 'utf8', maxBuffer: 1024 * 1024, windowsHide: true });
      assert.ifError(execution.error);
      return { execution, result: JSON.parse(fs.readFileSync(output, 'utf8')) };
    } };
}

test('the CLI hashes the exact policy bytes it parses instead of a JSON reserialization', t => {
  const f = policyCliFixture(t), { execution, result } = f.run();
  assert.equal(execution.status, 0, execution.stderr); assert.equal(result.valid, true);
  assert.deepEqual(result.policy, { path: MILESTONE_POLICY_PATH, sha256: sha(f.policyBytes) });
  assert.notEqual(result.policy.sha256, sha(JSON.stringify(JSON.parse(f.policyBytes))));
  assert.equal(result.product.PASS, 2);
});

for (const missing of [true, false]) test('the CLI fails closed for a ' + (missing ? 'missing' : 'mismatched') + ' source-policy entry', t => {
  const f = policyCliFixture(t), report = f.reports[1];
  if (missing) report.sourceManifest = report.sourceManifest.filter(entry => entry.path !== MILESTONE_POLICY_PATH);
  else report.sourceManifest.find(entry => entry.path === MILESTONE_POLICY_PATH).sha256 = sha('other policy bytes');
  f.writeReport(1, refreshSourceHash(report));
  const { execution, result } = f.run();
  assert.equal(execution.status, 1); assert.equal(result.valid, false);
  assert.equal(result.errors[0].code, missing ? 'MISSING_POLICY_SOURCE' : 'POLICY_HASH_MISMATCH');
  assert.equal(result.policy.sha256, sha(f.policyBytes));
  assert.equal(result.numericTargetReached, false); assert.equal(result.platformCoverageComplete, false); assert.equal(result.fullGoalAchieved, false);
});

test('changing targets and platform gates cannot reinterpret earlier reports through the CLI', t => {
  const original = policy({ activeTarget: 4, requiredPlatforms: [{ id: 'actual-safari', kind: 'manual', match: { os: 'darwin' } }] });
  const f = policyCliFixture(t, { policyBytes: JSON.stringify(original) + '\n', reports: [node(['PASS', 'PASS'])] });
  const before = f.run();
  assert.equal(before.execution.status, 0); assert.equal(before.result.numericTargetReached, false); assert.equal(before.result.platformCoverageComplete, false);
  const changed = JSON.stringify(policy({ initialTarget: 1, earlyTarget: 2, activeTarget: 2 })) + '\n';
  fs.writeFileSync(f.policyFile, changed);
  const { execution, result } = f.run();
  assert.equal(execution.status, 1); assert.equal(result.valid, false); assert.equal(result.errors[0].code, 'POLICY_HASH_MISMATCH');
  assert.equal(result.policy.sha256, sha(changed)); assert.notEqual(result.policy.sha256, before.result.policy.sha256);
  assert.equal(result.numericTargetReached, false); assert.equal(result.platformCoverageComplete, false); assert.equal(result.fullGoalAchieved, false);
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
