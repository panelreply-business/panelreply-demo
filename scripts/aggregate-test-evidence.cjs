'use strict';

// Evidence accounting, not a release approval. Identical source/case/platform
// reruns add no coverage. A same-source failure cannot disappear behind a pass.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { MILESTONE_POLICY_PATH } = require('./test-evidence.cjs');

const FORMATS = new Set(['panelreply-node-evidence-v1', 'panelreply-platform-evidence-v1']);
const STATUSES = Object.freeze(['PASS', 'SKIP', 'TODO', 'EXPECTED_FAILURE', 'BLOCKED', 'NOT_RUN', 'RUNNING', 'CANCELLED', 'UNEXPECTED_SUCCESS', 'FAIL', 'ERROR']);
const SEVERITY = new Map(STATUSES.map((status, index) => [status, index]));
const NODE_SUITES = new Set(['node-all', 'node-portable']);
const BROWSER_SUITES = new Set(['portable', 'portable-extra', 'portable-complement', 'baseline', 'private', 'mobile', 'callback', 'spreadsheet', 'spreadsheet-manual']);
const SHA1 = /^[a-f0-9]{40}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const MAX_REPORT_BYTES = 128 * 1024 * 1024;
const MAX_INPUT_BYTES = 512 * 1024 * 1024;
const MAX_REPORTS = 1000;
const MAX_TESTS = 100000;

class EvidenceError extends Error {
  constructor(code, message) { super(message); this.name = 'EvidenceError'; this.code = code; }
}
function requireValue(value, code, message) { if (!value) throw new EvidenceError(code, message); }
function object(value) { return !!value && typeof value === 'object' && !Array.isArray(value); }
function string(value, maximum = 4096) { return typeof value === 'string' && value.length > 0 && value.length <= maximum && !/[\u0000-\u001f]/.test(value); }
function hash(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function normalizeOs(value) {
  const normalized = String(value || '').toLowerCase();
  return ({ win32: 'windows', win64: 'windows', windows: 'windows', darwin: 'darwin', macos: 'darwin', 'mac os x': 'darwin', linux: 'linux', ios: 'ios', android: 'android' })[normalized] || normalized;
}
function normalizeArchitecture(value) {
  const normalized = String(value || '').toLowerCase();
  return ({ x64: 'x86_64', amd64: 'x86_64', x86_64: 'x86_64', aarch64: 'arm64', arm64: 'arm64', i386: 'x86', i686: 'x86', ia32: 'x86' })[normalized] || normalized;
}
function nodeMajor(value) {
  requireValue(typeof value === 'string' && /^v?\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(value), 'INVALID_PLATFORM', 'A measured Node version is required.');
  return Number(value.replace(/^v/, '').split('.')[0]);
}
function canonicalPlatform(report, item) {
  const raw = report.platform;
  requireValue(object(raw), 'MISSING_PLATFORM', 'Report platform metadata is missing.');
  requireValue(string(raw.os, 80) && string(raw.architecture, 80), 'INVALID_PLATFORM', 'Operating system and architecture are required.');
  const os = normalizeOs(raw.os), architecture = normalizeArchitecture(raw.architecture), major = nodeMajor(raw.node);
  requireValue(/^[a-z0-9_-]+$/.test(os) && /^[a-z0-9_-]+$/.test(architecture), 'INVALID_PLATFORM', 'Invalid platform identifier.');
  if (report.format === 'panelreply-node-evidence-v1') {
    return { kind: 'node', os, architecture, nodeMajor: major, profile: 'desktop', emulated: false,
      key: ['node', os, architecture, 'node' + major].join('/') };
  }
  requireValue(['chromium', 'firefox', 'webkit'].includes(raw.browserEngine), 'INVALID_PLATFORM', 'A supported observed browser engine is required.');
  const browserChannel = raw.browserChannel === undefined ? 'bundled' : raw.browserChannel;
  requireValue(['bundled', 'chrome', 'msedge', 'explicit-executable'].includes(browserChannel), 'INVALID_PLATFORM', 'Unknown browser channel.');
  requireValue(browserChannel === 'bundled' || raw.browserEngine === 'chromium', 'INVALID_PLATFORM', 'A Chromium channel cannot establish another engine.');
  requireValue(string(item.profile, 100) && /^[A-Za-z0-9_.-]+$/.test(item.profile), 'INVALID_PLATFORM', 'Every browser case needs an explicit profile.');
  requireValue(typeof item.emulated === 'boolean' && item.emulated === (item.profile !== 'desktop'), 'INVALID_PLATFORM', 'Emulated profiles must be identified explicitly.');
  return { kind: 'browser', os, architecture, browserEngine: raw.browserEngine, browserChannel,
    profile: item.profile, emulated: item.emulated,
    key: ['browser', os, architecture, raw.browserEngine, browserChannel, item.profile].join('/') };
}
function validateManifest(report) {
  requireValue(Array.isArray(report.sourceManifest) && report.sourceManifest.length > 0, 'MISSING_SOURCE_MANIFEST', 'A nonempty tested-source manifest is required.');
  const seen = new Set();
  const canonical = report.sourceManifest.map(entry => {
    requireValue(object(entry) && string(entry.path) && SHA256.test(entry.sha256), 'INVALID_SOURCE_MANIFEST', 'Malformed source manifest entry.');
    requireValue(!path.posix.isAbsolute(entry.path) && !entry.path.includes('\\') && !entry.path.split('/').some(part => part === '..' || part === '.' || part === ''), 'INVALID_SOURCE_MANIFEST', 'Source paths must be relative repository paths.');
    requireValue(!seen.has(entry.path), 'INVALID_SOURCE_MANIFEST', 'Duplicate source manifest path.'); seen.add(entry.path);
    return { path: entry.path, sha256: entry.sha256 };
  });
  requireValue(canonical.every((entry, index) => index === 0 || canonical[index - 1].path < entry.path), 'INVALID_SOURCE_MANIFEST', 'Source manifest must use deterministic path order.');
  requireValue(hash(JSON.stringify(canonical)) === report.sourceTreeSha256, 'SOURCE_HASH_MISMATCH', 'Tested-source hash does not match its manifest.');
}
function validateReport(report, label = 'report') {
  requireValue(object(report) && FORMATS.has(report.format), 'UNKNOWN_FORMAT', 'Unrecognized evidence format: ' + label);
  requireValue(SHA1.test(report.sourceCommit) && SHA1.test(report.gitTreeHash) && SHA256.test(report.sourceTreeSha256), 'MISSING_SOURCE', 'Complete source commit/tree/hash metadata is required: ' + label);
  requireValue(typeof report.dirty === 'boolean', 'MISSING_SOURCE', 'Working-tree cleanliness must be recorded: ' + label);
  validateManifest(report);
  const changeFlags = [report.sourceChanged, report.sourceChangedDuringRun].filter(value => value !== undefined);
  requireValue(changeFlags.length > 0 && changeFlags.every(value => typeof value === 'boolean'), 'MISSING_SOURCE', 'Source stability must be recorded: ' + label);
  requireValue(changeFlags.every(value => value === false), 'SOURCE_CHANGED', 'Source changed during execution: ' + label);
  requireValue(SHA256.test(report.sourceTreeSha256After) && report.sourceTreeSha256After === report.sourceTreeSha256, 'SOURCE_CHANGED', 'The post-run source hash must match the tested source: ' + label);
  const node = report.format === 'panelreply-node-evidence-v1';
  requireValue((node ? NODE_SUITES : BROWSER_SUITES).has(report.suite), 'INVALID_SUITE', 'Unknown evidence suite: ' + label);
  if (['callback', 'spreadsheet'].includes(report.suite)) requireValue(report.deploymentMode === report.suite, 'INVALID_DEPLOYMENT_MODE', 'Selected-product browser evidence must identify its actual deployment mode.');
  if (report.suite === 'spreadsheet-manual') {
    requireValue(report.deploymentMode === 'spreadsheet', 'INVALID_DEPLOYMENT_MODE', 'Manual spreadsheet evidence must use the fixed spreadsheet entrypoint.');
    requireValue(normalizeOs(report.platform?.os) === 'darwin', 'INVALID_PLATFORM', 'The macOS manual spreadsheet suite cannot establish another platform.');
  }
  requireValue(Array.isArray(report.tests) && report.tests.length <= MAX_TESTS, 'INVALID_TESTS', 'A bounded list of case outcomes is required: ' + label);
  requireValue(Array.isArray(report.infrastructureErrors), 'MISSING_INFRASTRUCTURE_STATUS', 'Infrastructure outcomes must be explicit: ' + label);
  if (node) requireValue(typeof report.summarySuccess === 'boolean', 'MISSING_RUN_STATUS', 'The Node runner summary is required: ' + label);
  else {
    requireValue(['PASS', 'FAIL', 'BLOCKED'].includes(report.status), 'INVALID_RUN_STATUS', 'Unknown browser run status: ' + label);
    requireValue(Number.isSafeInteger(report.expectedMethods) && report.expectedMethods > 0 && report.expectedMethods === report.tests.length, 'MISSING_CASES', 'Expected browser methods must all have recorded outcomes: ' + label);
  }
  requireValue(report.tests.length > 0 || report.infrastructureErrors.length > 0, 'EMPTY_REPORT', 'An empty successful report proves no coverage: ' + label);
  const ids = new Set();
  const tests = report.tests.map(item => {
    requireValue(object(item) && string(item.id), 'INVALID_CASE', 'Case identity is missing or malformed: ' + label);
    requireValue(!ids.has(item.id), 'DUPLICATE_CASE', 'Duplicate case ID within a report: ' + item.id); ids.add(item.id);
    requireValue(STATUSES.includes(item.status), 'UNKNOWN_STATUS', 'Unknown case status: ' + String(item.status));
    requireValue(typeof item.durationMs === 'number' && Number.isFinite(item.durationMs) && item.durationMs >= 0, 'INVALID_CASE', 'Case duration must be finite and nonnegative.');
    requireValue(string(item.platformKey, 500), 'INVALID_PLATFORM', 'Every case needs its recorded platform key.');
    const platform = canonicalPlatform(report, item);
    // Check the redundant recorded key instead of trusting a caller-supplied
    // alternate key that could count identical executions several times.
    const recorded = item.platformKey.split('/');
    requireValue(recorded.length === (node ? 3 : 5) && normalizeOs(recorded[0]) === platform.os && normalizeArchitecture(recorded[1]) === platform.architecture, 'PLATFORM_KEY_MISMATCH', 'Recorded case platform contradicts report metadata.');
    requireValue(node ? recorded[2] === 'node' + platform.nodeMajor : recorded[2] === platform.browserEngine && recorded[3] === platform.browserChannel && recorded[4] === platform.profile, 'PLATFORM_KEY_MISMATCH', 'Recorded case runtime/profile contradicts report metadata.');
    const kind = item.kind === undefined ? 'product' : item.kind;
    requireValue(['product', 'harness'].includes(kind), 'INVALID_CASE_KIND', 'Unknown case kind.');
    const productScope = item.productScope === undefined ? 'shared' : item.productScope;
    requireValue(['callback', 'spreadsheet', 'shared'].includes(productScope), 'INVALID_PRODUCT_SCOPE', 'Unknown product evidence scope.');
    if (node) {
      requireValue(typeof item.generated === 'boolean', 'INVALID_CASE', 'Node cases must identify generated coverage.');
      requireValue(string(item.file) && item.file.startsWith('tests/') && item.file.endsWith('.test.cjs') && !item.file.includes('..') && item.id.startsWith(item.file + '::'), 'INVALID_CASE', 'Node cases need their repository test-file identity.');
      requireValue(item.file !== 'tests/release-evidence.test.cjs' || kind === 'harness', 'HARNESS_MISCLASSIFIED', 'Evidence-harness tests cannot count as product tests.');
    }
    const generated = item.generated === true;
    requireValue(!generated || string(item.caseFamily, 80), 'INVALID_CASE', 'Generated cases need an explicit family.');
    if (!node && item.status === 'PASS') {
      requireValue(Array.isArray(report.platform.observedBrowsers) && report.platform.observedBrowsers.some(browser => object(browser) && browser.engine === platform.browserEngine && browser.channel === platform.browserChannel && string(browser.version, 100)), 'UNOBSERVED_BROWSER', 'A configured but unobserved browser cannot count as a pass.');
    }
    return { id: item.id, status: item.status, durationMs: item.durationMs, kind, productScope, generated,
      caseFamily: generated ? item.caseFamily : null, platform, suite: report.suite,
      deploymentMode: report.deploymentMode || 'unspecified' };
  });
  const allPass = tests.length > 0 && tests.every(item => item.status === 'PASS');
  const reportedSuccess = node ? report.summarySuccess : report.status === 'PASS';
  if (!node && report.status === 'PASS') requireValue(allPass && report.infrastructureErrors.length === 0, 'INCONSISTENT_RUN_STATUS', 'A PASS browser run contains unresolved outcomes.');
  if (node && report.summarySuccess) requireValue(!tests.some(item => ['FAIL', 'ERROR', 'CANCELLED', 'UNEXPECTED_SUCCESS', 'RUNNING', 'NOT_RUN', 'BLOCKED'].includes(item.status)) && report.infrastructureErrors.length === 0, 'INCONSISTENT_RUN_STATUS', 'A successful Node run contains failed or unexecuted work.');
  return { label, raw: report, tests, reportedSuccess, complete: reportedSuccess && allPass && report.infrastructureErrors.length === 0,
    source: { sourceCommit: report.sourceCommit, gitTreeHash: report.gitTreeHash, sourceTreeSha256: report.sourceTreeSha256, dirty: report.dirty } };
}
function validateMilestones(policy) {
  requireValue(object(policy), 'MISSING_POLICY', 'The milestone policy is required.');
  for (const key of ['initialTarget', 'earlyTarget', 'activeTarget']) requireValue(Number.isSafeInteger(policy[key]) && policy[key] > 0, 'INVALID_POLICY', 'A positive integer ' + key + ' is required.');
  requireValue(policy.earlyTarget === policy.initialTarget * 2 && [policy.initialTarget, policy.earlyTarget].includes(policy.activeTarget), 'INVALID_POLICY', 'The early target must double the initial target.');
  requireValue(string(policy.deadline, 80) && Number.isFinite(Date.parse(policy.deadline)) && /(?:Z|[+-]\d{2}:\d{2})$/.test(policy.deadline), 'INVALID_POLICY', 'The early-goal deadline needs an explicit timezone offset.');
  requireValue(string(policy.timezone, 100), 'INVALID_POLICY', 'The milestone timezone is required.');
  try { new Intl.DateTimeFormat('en', { timeZone: policy.timezone }).format(0); } catch { throw new EvidenceError('INVALID_POLICY', 'Unknown milestone timezone.'); }
  requireValue(policy.firstGoalAchievedAt === null || (typeof policy.firstGoalAchievedAt === 'string' && Number.isFinite(Date.parse(policy.firstGoalAchievedAt))), 'INVALID_POLICY', 'Invalid recorded first-goal timestamp.');
  requireValue(Array.isArray(policy.requiredPlatforms) && policy.requiredPlatforms.length > 0, 'INVALID_POLICY', 'Required platforms must be explicit and nonempty.');
  const ids = new Set();
  const allowed = new Set(['os', 'architecture', 'browserEngine', 'browserChannel', 'profile', 'suite', 'nodeMajor']);
  for (const entry of policy.requiredPlatforms) {
    requireValue(object(entry) && string(entry.id, 100) && !ids.has(entry.id), 'INVALID_POLICY', 'Required platform IDs must be unique.'); ids.add(entry.id);
    requireValue(['node', 'browser', 'manual'].includes(entry.kind) && object(entry.match), 'INVALID_POLICY', 'A platform requirement needs a kind and match object.');
    requireValue(Object.keys(entry.match).every(key => allowed.has(key)), 'INVALID_POLICY', 'Unknown required-platform match field.');
    requireValue(entry.minimumCases === undefined || Number.isSafeInteger(entry.minimumCases) && entry.minimumCases > 0, 'INVALID_POLICY', 'minimumCases must be a positive integer.');
    for (const [key, value] of Object.entries(entry.match)) requireValue(key === 'nodeMajor' ? Number.isSafeInteger(value) && value > 0 : string(value, 100), 'INVALID_POLICY', 'Invalid required-platform matcher.');
  }
  return policy;
}
function countStatuses(items) {
  const counts = Object.fromEntries(STATUSES.map(status => [status, 0]));
  for (const item of items) counts[item.status]++;
  return { total: items.length, ...counts };
}
function matches(requirement, execution) {
  if (requirement.kind !== execution.platform.kind) return false;
  for (const [key, value] of Object.entries(requirement.match)) {
    if (key === 'suite') { if (!execution.suites.includes(value)) return false; }
    else if (key === 'os') { if (execution.platform.os !== normalizeOs(value)) return false; }
    else if (key === 'architecture') { if (execution.platform.architecture !== normalizeArchitecture(value)) return false; }
    else if (execution.platform[key] !== value) return false;
  }
  return true;
}
function aggregateReports(inputs, { milestones, policySha256, source, now = new Date().toISOString() } = {}) {
  const policy = validateMilestones(milestones);
  requireValue(policySha256 !== undefined, 'MISSING_POLICY_HASH', 'The SHA256 of the milestone policy bytes is required.');
  requireValue(typeof policySha256 === 'string' && SHA256.test(policySha256), 'INVALID_POLICY_HASH', 'The milestone policy SHA256 must be a complete lowercase digest.');
  requireValue(Array.isArray(inputs) && inputs.length > 0 && inputs.length <= MAX_REPORTS, 'NO_REPORTS', 'No recognized evidence reports were supplied.');
  requireValue(Number.isFinite(Date.parse(now)), 'INVALID_TIME', 'Aggregation time must be valid.');
  if (source !== undefined) requireValue(SHA1.test(source), 'INVALID_SOURCE', 'The requested source must be a complete commit SHA.');
  const reports = inputs.map((value, index) => value && Object.hasOwn(value, 'report') ? validateReport(value.report, value.label || 'report-' + index) : validateReport(value, 'report-' + index));
  const reference = reports[0].source;
  for (const report of reports) {
    const recordedPolicy = report.raw.sourceManifest.find(entry => entry.path === MILESTONE_POLICY_PATH);
    requireValue(recordedPolicy, 'MISSING_POLICY_SOURCE', 'The tested-source manifest omits the milestone policy: ' + report.label);
    requireValue(recordedPolicy.sha256 === policySha256, 'POLICY_HASH_MISMATCH', 'The aggregation policy differs from the tested milestone policy: ' + report.label);
    requireValue(report.source.sourceCommit === reference.sourceCommit && report.source.gitTreeHash === reference.gitTreeHash && report.source.sourceTreeSha256 === reference.sourceTreeSha256, 'MIXED_SOURCE', 'Reports do not describe the same tested source.');
    if (source) requireValue(report.source.sourceCommit === source, 'UNEXPECTED_SOURCE', 'Report source does not match --source.');
  }
  const executions = new Map(), cases = new Map();
  let observations = 0;
  for (const report of reports) for (const item of report.tests) {
    observations++;
    const identity = JSON.stringify([item.id, item.platform.key]);
    const previousCase = cases.get(item.id);
    if (previousCase) requireValue(previousCase.kind === item.kind && previousCase.productScope === item.productScope && previousCase.generated === item.generated && previousCase.caseFamily === item.caseFamily, 'CASE_CLASSIFICATION_CHANGED', 'Case classification changed between same-source reports: ' + item.id);
    else cases.set(item.id, { id: item.id, kind: item.kind, productScope: item.productScope, generated: item.generated, caseFamily: item.caseFamily, executions: [] });
    let execution = executions.get(identity);
    if (!execution) {
      execution = { id: item.id, platformKey: item.platform.key, platform: item.platform, kind: item.kind, productScope: item.productScope, generated: item.generated, caseFamily: item.caseFamily,
        status: item.status, observedStatuses: [], suites: [], deploymentModes: [], reports: [], nodeVersions: [], browserVersions: [], observations: 0 };
      executions.set(identity, execution); cases.get(item.id).executions.push(execution);
    }
    if (SEVERITY.get(item.status) > SEVERITY.get(execution.status)) execution.status = item.status;
    execution.observations++;
    if (!execution.observedStatuses.includes(item.status)) execution.observedStatuses.push(item.status);
    if (!execution.suites.includes(item.suite)) execution.suites.push(item.suite);
    if (!execution.deploymentModes.includes(item.deploymentMode)) execution.deploymentModes.push(item.deploymentMode);
    if (!execution.reports.includes(report.label)) execution.reports.push(report.label);
    if (!execution.nodeVersions.includes(report.raw.platform.node)) execution.nodeVersions.push(report.raw.platform.node);
    for (const browser of report.raw.platform.observedBrowsers || []) if (browser.engine === item.platform.browserEngine && browser.channel === item.platform.browserChannel && !execution.browserVersions.includes(browser.version)) execution.browserVersions.push(browser.version);
  }
  const uniqueExecutions = [...executions.values()].sort((a, b) => a.platformKey.localeCompare(b.platformKey) || a.id.localeCompare(b.id));
  const productExecutions = uniqueExecutions.filter(item => item.kind === 'product');
  const harnessExecutions = uniqueExecutions.filter(item => item.kind === 'harness');
  const productCases = [...cases.values()].filter(item => item.kind === 'product');
  const productScopes = Object.fromEntries(['callback', 'spreadsheet', 'shared'].map(scope => {
    const scopedExecutions = productExecutions.filter(item => item.productScope === scope);
    const scopedCases = productCases.filter(item => item.productScope === scope);
    return [scope, { executions: countStatuses(scopedExecutions), distinctCases: {
      total: scopedCases.length, generated: scopedCases.filter(item => item.generated).length,
      passingOnEveryObservedPlatform: scopedCases.filter(item => item.executions.every(execution => execution.status === 'PASS')).length,
      withUnresolvedOutcome: scopedCases.filter(item => item.executions.some(execution => execution.status !== 'PASS')).length
    }, ...(scope === 'shared' ? { availableTo: ['callback', 'spreadsheet'], counting: 'Counted once in portfolio totals, not added to either app-specific bucket.' } : {}) }];
  }));
  const grouped = new Map();
  for (const item of uniqueExecutions) {
    if (!grouped.has(item.platformKey)) grouped.set(item.platformKey, { platformKey: item.platformKey, platform: item.platform, items: [] });
    grouped.get(item.platformKey).items.push(item);
  }
  const matrix = [...grouped.values()].map(group => ({ platformKey: group.platformKey, platform: group.platform,
    product: countStatuses(group.items.filter(item => item.kind === 'product')),
    harness: countStatuses(group.items.filter(item => item.kind === 'harness')),
    suites: [...new Set(group.items.flatMap(item => item.suites))].sort(),
    deploymentModes: [...new Set(group.items.flatMap(item => item.deploymentModes))].sort(),
    nodeVersions: [...new Set(group.items.flatMap(item => item.nodeVersions))].sort(),
    browserVersions: [...new Set(group.items.flatMap(item => item.browserVersions))].sort() }));
  const requiredPlatforms = policy.requiredPlatforms.map(requirement => {
    if (requirement.kind === 'manual') return { id: requirement.id, kind: 'manual', status: 'NOT_TESTED', complete: false, passingExecutions: 0,
      reason: 'Physical-device and actual Safari evidence is not ingested by this automated counter. A document status is not verification.' };
    const selected = productExecutions.filter(item => matches(requirement, item));
    const labels = new Set(selected.flatMap(item => item.reports));
    const selectedReports = reports.filter(report => labels.has(report.label));
    const counts = countStatuses(selected);
    const complete = selected.length >= (requirement.minimumCases || 1) && selected.every(item => item.status === 'PASS') && selectedReports.length > 0 && selectedReports.every(report => report.complete && !report.source.dirty);
    const status = complete ? 'PASS' : selected.length === 0 ? 'NOT_TESTED' : selected.some(item => ['FAIL', 'ERROR', 'UNEXPECTED_SUCCESS'].includes(item.status)) ? 'FAIL' : 'BLOCKED';
    return { id: requirement.id, kind: requirement.kind, match: requirement.match, minimumCases: requirement.minimumCases || 1,
      status, complete, counts, passingExecutions: counts.PASS,
      reason: complete ? 'Matching committed runs have no unresolved recorded outcomes.' : selected.length === 0 ? 'No matching automated execution report.' : 'Coverage, cleanliness, skipped work, infrastructure or other outcomes remain unresolved.' };
  });
  const counts = countStatuses(productExecutions);
  const cleanSource = reports.every(report => !report.source.dirty);
  const allObservedChecksPassed = uniqueExecutions.length > 0 && uniqueExecutions.every(item => item.status === 'PASS') && reports.every(report => report.complete);
  const platformCoverageComplete = requiredPlatforms.every(item => item.complete);
  const numericTargetReached = counts.PASS >= policy.activeTarget;
  const initialNumericTargetReached = counts.PASS >= policy.initialTarget;
  const initialGoalAchieved = initialNumericTargetReached && cleanSource && allObservedChecksPassed && platformCoverageComplete;
  const fullGoalAchieved = numericTargetReached && cleanSource && allObservedChecksPassed && platformCoverageComplete;
  const earlyTargetEligible = initialGoalAchieved && Date.parse(now) < Date.parse(policy.deadline);
  return { format: 'panelreply-aggregate-evidence-v1', valid: true, generatedAt: now,
    policy: { path: MILESTONE_POLICY_PATH, sha256: policySha256 },
    source: { ...reference, dirty: !cleanSource, cleanCommittedEvidence: cleanSource },
    counting: 'Product case/platform executions only. Reruns, assertions, container outcomes and evidence-harness tests do not increase the target. Any unresolved same-source observation prevents that execution from becoming PASS. Generated counts include explicitly marked generated cases; other cases are not assumed to be hand-authored.',
    reports: reports.map(report => ({ label: report.label, format: report.raw.format, suite: report.raw.suite, tests: report.tests.length,
      complete: report.complete, dirty: report.source.dirty, infrastructureErrors: report.raw.infrastructureErrors })),
    observations, duplicateObservationsExcluded: observations - uniqueExecutions.length,
    product: counts, productScopes, harness: countStatuses(harnessExecutions),
    distinctCases: { total: productCases.length, generated: productCases.filter(item => item.generated).length,
      notMarkedGenerated: productCases.filter(item => !item.generated).length,
      passingOnEveryObservedPlatform: productCases.filter(item => item.executions.every(execution => execution.status === 'PASS')).length,
      withAnyPass: productCases.filter(item => item.executions.some(execution => execution.status === 'PASS')).length,
      withUnresolvedOutcome: productCases.filter(item => item.executions.some(execution => execution.status !== 'PASS')).length },
    matrix, requiredPlatforms,
    milestones: { scope: 'portfolio', initialTarget: policy.initialTarget, earlyTarget: policy.earlyTarget, activeTarget: policy.activeTarget,
      deadline: policy.deadline, releaseDate: policy.releaseDate || null, timezone: policy.timezone,
      recordedFirstGoalAchievedAt: policy.firstGoalAchievedAt, numericTargetReached, initialNumericTargetReached,
      earlyNumericTargetReached: counts.PASS >= policy.earlyTarget,
      platformCoverageComplete, cleanCommittedEvidence: cleanSource, allObservedChecksPassed, initialGoalAchieved,
      fullGoalAchieved, earlyTargetEligible, suggestedTarget: earlyTargetEligible ? policy.earlyTarget : policy.activeTarget,
      policyChanged: false },
    numericTargetReached, platformCoverageComplete, fullGoalAchieved,
    releaseDecision: 'NOT_DETERMINED_BY_TEST_COUNT',
    productReleaseDecisions: { callback: 'NOT_DETERMINED_BY_TEST_COUNT', spreadsheet: 'NOT_DETERMINED_BY_TEST_COUNT' },
    releaseScope: 'Each app needs independent workflow, data-isolation, recovery, operating and owner-approval evidence. Callback model gates apply to its configured AI. Spreadsheet OCR gates apply to its configured recognition. Neither app inherits an unrelated integration requirement from the other.',
    executions: uniqueExecutions };
}
function readReportDirectory(directory) {
  const root = path.resolve(directory), reports = [], ignored = [];
  requireValue(fs.existsSync(root) && fs.statSync(root).isDirectory(), 'INVALID_INPUT_DIRECTORY', 'Evidence input must be an existing directory.');
  let bytes = 0, files = 0;
  function visit(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = path.join(current, entry.name), relative = path.relative(root, absolute).split(path.sep).join('/');
      if (entry.isSymbolicLink()) { ignored.push({ path: relative, reason: 'symbolic-link' }); continue; }
      if (entry.isDirectory()) { visit(absolute); continue; }
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      files++;
      requireValue(files <= MAX_REPORTS, 'INPUT_LIMIT', 'Evidence directory contains too many JSON files.');
      const size = fs.statSync(absolute).size; bytes += size;
      requireValue(size <= MAX_REPORT_BYTES && bytes <= MAX_INPUT_BYTES, 'INPUT_LIMIT', 'Evidence input byte limit exceeded.');
      let report;
      try { report = JSON.parse(fs.readFileSync(absolute, 'utf8')); } catch { throw new EvidenceError('INVALID_JSON', 'Invalid or truncated evidence JSON: ' + relative); }
      if (object(report) && FORMATS.has(report.format)) reports.push({ label: relative, report });
      else ignored.push({ path: relative, reason: 'unrecognized-format' });
    }
  }
  visit(root);
  return { reports, ignored, bytes };
}
function main(args) {
  let input, output, source;
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--input' && args[index + 1]) input = args[++index];
    else if (args[index] === '--output' && args[index + 1]) output = args[++index];
    else if (args[index] === '--source' && args[index + 1]) source = args[++index];
    else throw new EvidenceError('USAGE', 'Usage: node scripts/aggregate-test-evidence.cjs --input DIR --output FILE [--source SHA]');
  }
  requireValue(input && output, 'USAGE', 'An input directory and output file are required.');
  let result, policyEvidence;
  try {
    // Hash and parse one read. The CLI has no caller-supplied policy digest or
    // alternate path that could reinterpret earlier reports under new gates.
    const policyBytes = fs.readFileSync(path.join(__dirname, '..', MILESTONE_POLICY_PATH));
    policyEvidence = { path: MILESTONE_POLICY_PATH, sha256: hash(policyBytes) };
    const milestones = JSON.parse(policyBytes.toString('utf8'));
    const read = readReportDirectory(input);
    result = aggregateReports(read.reports, { milestones, policySha256: policyEvidence.sha256, source });
    result.ignoredFiles = read.ignored;
  } catch (error) {
    result = { format: 'panelreply-aggregate-evidence-v1', valid: false,
      ...(policyEvidence ? { policy: policyEvidence } : {}),
      errors: [{ code: error.code || 'AGGREGATION_ERROR', message: error.message }],
      numericTargetReached: false, platformCoverageComplete: false, fullGoalAchieved: false,
      releaseDecision: 'NOT_DETERMINED_BY_TEST_COUNT' };
    process.exitCode = 1;
  }
  fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
  fs.writeFileSync(path.resolve(output), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ output: path.resolve(output), valid: result.valid, sourceCommit: result.source?.sourceCommit,
    policySha256: result.policy?.sha256,
    product: result.product, distinctCases: result.distinctCases, harness: result.harness,
    numericTargetReached: result.numericTargetReached, platformCoverageComplete: result.platformCoverageComplete,
    fullGoalAchieved: result.fullGoalAchieved, errors: result.errors }));
  return result;
}

module.exports = { EvidenceError, FORMATS, STATUSES, normalizeOs, normalizeArchitecture, canonicalPlatform,
  validateReport, validateMilestones, aggregateReports, readReportDirectory, main };
if (require.main === module) {
  try { main(process.argv.slice(2)); } catch (error) { console.error(error.code + ': ' + error.message); process.exitCode = 1; }
}
