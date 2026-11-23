'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const MILESTONE_POLICY_PATH = 'docs/test-milestones.json';

function git(root, ...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, windowsHide: true }).trim();
}
function sourceEvidence(root) {
  const sourceRoots = new Set(['src', 'workspace', 'design-preview', 'scripts', 'tests', '.github']);
  const sourceFiles = new Set(['index.html', 'robots.txt', 'server.cjs', 'workspace-server.cjs', 'callback-server.cjs', 'spreadsheet-server.cjs', '.env.example', '.gitignore', '.gitattributes', MILESTONE_POLICY_PATH]);
  const names = git(root, 'ls-files', '--cached', '--others', '--exclude-standard', '-z').split('\0');
  const manifest = [];
  for (const relative of [...new Set(names)].filter(Boolean).sort()) {
    const parts = relative.split('/');
    if (!sourceRoots.has(parts[0]) && !sourceFiles.has(relative)) continue;
    if (parts.some(part => ['__pycache__', 'node_modules', 'artifacts', '.git'].includes(part)) || relative.endsWith('.pyc')) continue;
    const filename = path.join(root, relative);
    if (!fs.statSync(filename).isFile()) continue;
    const bytes = fs.readFileSync(filename);
    manifest.push({ path: relative, sha256: crypto.createHash('sha256').update(bytes).digest('hex') });
  }
  const status = git(root, 'status', '--porcelain', '--untracked-files=normal');
  // Key order is intentionally shared with the Python report reader.
  return { sourceCommit: git(root, 'rev-parse', 'HEAD'), gitTreeHash: git(root, 'rev-parse', 'HEAD^{tree}'),
    dirty: !!status, workingTreeStatus: status ? status.split('\n') : [], sourceManifest: manifest,
    sourceTreeSha256: crypto.createHash('sha256').update(JSON.stringify(manifest)).digest('hex') };
}
function platformEvidence() {
  const os = require('node:os');
  const operatingSystem = { linux: 'linux', darwin: 'darwin', win32: 'windows' }[process.platform] || process.platform;
  const architecture = { x64: 'x86_64', arm64: 'arm64' }[process.arch] || process.arch;
  const major = process.versions.node.split('.')[0];
  return { os: operatingSystem, osRelease: os.release(), architecture, node: process.version,
    platformKey: [operatingSystem, architecture, 'node' + major].join('/') };
}
function relativeFile(root, filename) {
  return filename ? path.relative(root, filename).split(path.sep).join('/') : 'unknown-file';
}
function productScope(file, name) {
  if (file.endsWith('/platform-client-state.test.cjs')) {
    if (/^intake\b/.test(name)) return 'callback';
    if (/^(?:panel\b|new-project\b|saved-project\b)/.test(name)) return 'spreadsheet';
    return 'shared';
  }
  if (/\/product-(?:ui|backup|config|boundaries)\.test\.cjs$/.test(file)) {
    const selected = /^(?:PRODUCT-UI |PROD\.[a-z-]+\.)?(callback|spreadsheet)(?:[.\s]|$)/.exec(name);
    return selected ? selected[1] : 'shared';
  }
  if (file.endsWith('/release-deletion-model.test.cjs')) return /panel_(?:project|source)/.test(name) ? 'spreadsheet' : /lead(?:_conversation)?/.test(name) ? 'callback' : 'shared';
  if (/\/(?:panel[-_]|ocr[.-]|release-export-matrix)/.test(file)) return 'spreadsheet';
  if (/\/(?:callback-(?:schedule|task)[^/]*\.test\.cjs$|assistant-|workspace-(?:assistant|conversation|export)|intake[.]|questions[.]|demo[.]|release-(?:assistant-matrix|name-grounding))/.test(file)) return 'callback';
  return 'shared';
}
function collectNodeResults(events, root, platformKey) {
  const identities = new Map();
  const parents = new Set();
  const outcomes = [];
  const infrastructureErrors = [];
  let summary = null;
  function identity(data) { return (data.entryFile || data.file || '') + '\0' + data.testId; }
  for (const event of events) {
    const data = event.data || {};
    if (['test:enqueue', 'test:start', 'test:pass', 'test:fail'].includes(event.type)) {
      if (data.testId !== undefined) {
        identities.set(identity(data), { name: data.name, parentId: data.parentId, entryFile: data.entryFile || data.file });
        if (data.parentId) parents.add((data.entryFile || data.file || '') + '\0' + data.parentId);
      }
    }
    if (event.type === 'test:summary' && !data.file && !data.entryFile) summary = data;
    if (event.type !== 'test:pass' && event.type !== 'test:fail') continue;
    outcomes.push({ event: event.type, data });
  }
  function lineage(data) {
    const names = [data.name || 'unnamed'];
    let parent = data.parentId;
    const visited = new Set();
    while (parent) {
      const key = (data.entryFile || data.file || '') + '\0' + parent;
      if (visited.has(key)) throw new Error('Cyclic Node test lineage');
      visited.add(key);
      const item = identities.get(key);
      if (!item) break;
      names.unshift(item.name);
      parent = item.parentId;
    }
    return names.join(' > ');
  }
  const tests = [];
  const ids = new Set();
  for (const { event, data } of outcomes) {
    if (parents.has(identity(data)) || data.details?.type === 'suite') continue;
    const file = relativeFile(root, data.file || data.entryFile);
    // A file-level crash/empty-file wrapper is an infrastructure result, not a
    // passing product case. It still makes the run fail.
    const fileWrapper = !data.line && (data.name === data.file || data.name === data.entryFile || data.name === file);
    if (fileWrapper) {
      if (event === 'test:fail') infrastructureErrors.push({ id: file, status: 'ERROR', message: String(data.details?.error?.message || 'Test file failed') });
      continue;
    }
    const name = lineage(data);
    const id = file + '::' + name;
    if (ids.has(id)) throw new Error('Duplicate case identifier within a Node run: ' + id);
    ids.add(id);
    const error = data.details?.error;
    const status = data.skip ? 'SKIP' : data.todo ? 'TODO'
      : event === 'test:pass' ? 'PASS' : error?.failureType === 'cancelledByParent' ? 'CANCELLED' : 'FAIL';
    const family = /\b(RAM[.\-]|RAP[.\-]|RDM[.\-]|REM[.\-])/.exec(name)?.[1]?.slice(0, 3) || null;
    tests.push({ id, name, file, platformKey, status, durationMs: data.details?.duration_ms || 0,
      generated: !!family, caseFamily: family, productScope: productScope(file, name),
      kind: file === 'tests/release-evidence.test.cjs' ? 'harness' : 'product',
      ...(error ? { diagnostic: String(error.message || error).slice(0, 4000), code: error.code || null } : {}) });
  }
  const totals = { passed: 0, failed: 0, skipped: 0, todo: 0, cancelled: 0, harnessPassed: 0 };
  for (const item of tests) {
    const key = { PASS: 'passed', FAIL: 'failed', SKIP: 'skipped', TODO: 'todo', CANCELLED: 'cancelled' }[item.status];
    totals[key]++;
    if (item.status === 'PASS' && item.kind === 'harness') totals.harnessPassed++;
  }
  return { tests, totals, infrastructureErrors, runnerSummary: summary,
    summarySuccess: !!summary?.success && infrastructureErrors.length === 0
      && totals.failed === 0 && totals.cancelled === 0 };
}

module.exports = { sourceEvidence, platformEvidence, collectNodeResults, productScope, MILESTONE_POLICY_PATH };
if (require.main === module) {
  if (process.argv[2] !== '--source') throw new Error('Usage: node scripts/test-evidence.cjs --source');
  process.stdout.write(JSON.stringify(sourceEvidence(path.resolve(__dirname, '..'))) + '\n');
}
