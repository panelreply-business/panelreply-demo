'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const PINS = require('./toolchain.json');
const NODE_VERSION = PINS.node;
const SHA256 = /^[a-f0-9]{64}$/;
const ARTIFACTS = ['panelreply_windows_storage.node', 'panelreply_windows_storage_probe.node', 'panelreply_windows_storage_fixture.exe'];
const REJECTED_OVERRIDES = ['CL', '_CL_', 'CFLAGS', 'CXXFLAGS', 'LDFLAGS', 'CMAKE_TOOLCHAIN_FILE',
  'CMAKE_GENERATOR', 'CMAKE_GENERATOR_PLATFORM', 'CMAKE_GENERATOR_TOOLSET', 'CMAKE_PROJECT_INCLUDE',
  'CMAKE_PROJECT_INCLUDE_BEFORE', 'CMAKE_CXX_FLAGS', 'INCLUDE', 'LIB', 'LIBPATH', 'VCTargetsPath',
  'VCInstallDir', 'VCToolsInstallDir', 'WindowsSdkDir', 'WindowsSDKVersion'];
const hash = filename => crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex');

function checkedFile(filename, expected, maximum = 64 * 1024 * 1024, minimum = 1) {
  const stat = fs.lstatSync(filename);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < minimum || stat.size > maximum ||
      !SHA256.test(expected) || hash(filename) !== expected) throw new Error('A native provenance file is missing or changed: ' + path.basename(filename));
  return stat;
}
function isRecord(value) { return !!value && typeof value === 'object' && !Array.isArray(value); }
function validateManifest(build, source) {
  if (!isRecord(build) || build.format !== 'panelreply-windows-storage-build-v1' || build.node !== NODE_VERSION
      || build.platform !== 'win32' || build.architecture !== 'x64'
      || build.sourceCommit !== source.sourceCommit || build.sourceTreeSha256 !== source.sourceTreeSha256
      || !/^[a-f0-9]{40}$/.test(build.sourceCommit) || !SHA256.test(build.sourceTreeSha256)
      || build.nodeExecutableSha256 !== PINS.nodeExecutableSha256 || build.windowsSdk !== PINS.windowsSdk
      || !isRecord(build.environmentOverrides) || JSON.stringify(build.environmentOverrides.rejected) !== JSON.stringify(REJECTED_OVERRIDES)
      || !Array.isArray(build.environmentOverrides.detected) || build.environmentOverrides.detected.length !== 0
      || !isRecord(build.configuredToolchain) || !SHA256.test(build.configuredToolchain.sha256)
      || !isRecord(build.configuredToolchain.observed)
      || !isRecord(build.compiler) || typeof build.compiler.path !== 'string' || !SHA256.test(build.compiler.sha256)
      || !/^19\.\d+\.\d+(?:\.\d+)?$/.test(build.compiler.version)
      || !isRecord(build.cmake) || typeof build.cmake.path !== 'string' || !SHA256.test(build.cmake.sha256)
      || !/^\d+\.\d+\.\d+$/.test(build.cmake.version)
      || !isRecord(build.tar) || typeof build.tar.path !== 'string' || !SHA256.test(build.tar.sha256)
      || !isRecord(build.headers) || !Number.isInteger(build.headers.count) || build.headers.count < 1 || build.headers.count > 5000
      || !SHA256.test(build.headers.sha256)
      || !isRecord(build.checksumManifest) || build.checksumManifest.url !== PINS.distribution + 'SHASUMS256.txt'
      || !SHA256.test(build.checksumManifest.sha256)
      || !Array.isArray(build.dependencies) || build.dependencies.length !== PINS.dependencies.length
      || !Array.isArray(build.artifacts) || build.artifacts.length !== ARTIFACTS.length) {
    throw new Error('The native build identity is incomplete or does not match this source and toolchain.');
  }
  const [major, minor] = build.cmake.version.split('.').map(Number);
  if (major < 3 || (major === 3 && minor < 27)) throw new Error('The build did not use an exact-SDK-capable CMake version.');
  const observed = build.configuredToolchain.observed;
  if (observed.generator !== PINS.generator || observed.platform !== PINS.architecture || observed.toolset !== PINS.toolset
      || observed.windowsSdk !== PINS.windowsSdk || observed.compilerId !== 'MSVC'
      || observed.compiler !== build.compiler.path || observed.compilerVersion !== build.compiler.version
      || observed.cmakeVersion !== build.cmake.version) throw new Error('The configured toolchain does not match the observed build tools.');
  for (const pin of PINS.dependencies) {
    const records = build.dependencies.filter(item => item?.name === pin.name);
    if (records.length !== 1 || records[0].sha256 !== pin.sha256 || records[0].url !== PINS.distribution + pin.name
        || !Number.isInteger(records[0].bytes) || records[0].bytes < 1 || records[0].bytes > 64 * 1024 * 1024) {
      throw new Error('The build dependencies do not match the reviewed Node byte pins.');
    }
  }
  for (const name of ARTIFACTS) {
    const records = build.artifacts.filter(item => item?.name === name);
    if (records.length !== 1 || !SHA256.test(records[0].sha256) || !SHA256.test(records[0].projectSha256)
        || !Number.isInteger(records[0].bytes) || records[0].bytes < 1 || records[0].bytes > 32 * 1024 * 1024
        || records[0].target !== name.replace(/\.(node|exe)$/, '')
        || records[0].testInstrumented !== (name === ARTIFACTS[1])) {
      throw new Error('The normal, probe and fixture artifact identities are incomplete or ambiguous.');
    }
  }
}

function inspectBuild(directory, source) {
  if (process.platform !== 'win32' || process.arch !== 'x64' || process.versions.node !== NODE_VERSION) {
    throw new Error('The component requires an actual Windows x64 process with pinned Node ' + NODE_VERSION + '.');
  }
  if (typeof directory !== 'string' || !path.isAbsolute(directory)) throw new Error('Use an explicit absolute component build directory.');
  const root = fs.realpathSync(directory);
  const filename = path.join(root, 'build-identity.json');
  if (!fs.statSync(filename).isFile() || fs.statSync(filename).size > 1024 * 1024) throw new Error('The native build identity is not a bounded file.');
  const build = JSON.parse(fs.readFileSync(filename, 'utf8'));
  validateManifest(build, source);
  checkedFile(process.execPath, PINS.nodeExecutableSha256, 256 * 1024 * 1024);
  for (const tool of [build.compiler, build.cmake, build.tar]) {
    if (!path.isAbsolute(tool.path)) throw new Error('A build tool identity has no observed absolute path.');
    checkedFile(tool.path, tool.sha256, 256 * 1024 * 1024);
  }
  const configured = path.join(root, 'build', 'configured-toolchain.json');
  checkedFile(configured, build.configuredToolchain.sha256, 1024 * 1024);
  if (JSON.stringify(JSON.parse(fs.readFileSync(configured, 'utf8'))) !== JSON.stringify(build.configuredToolchain.observed)) {
    throw new Error('The configured toolchain file differs from the captured observations.');
  }
  const checksums = path.join(root, 'dependencies', 'SHASUMS256.txt');
  checkedFile(checksums, build.checksumManifest.sha256, 1024 * 1024);
  const lines = fs.readFileSync(checksums, 'utf8').split(/\r?\n/);
  for (const pin of PINS.dependencies) {
    const entries = lines.map(line => /^([a-f0-9]{64})\s+\*?(.+)$/.exec(line)).filter(match => match?.[2] === pin.name);
    if (entries.length !== 1 || entries[0][1] !== pin.sha256) throw new Error('The captured official manifest differs from the reviewed byte pins.');
    const stat = checkedFile(path.join(root, 'dependencies', path.basename(pin.name)), pin.sha256);
    if (stat.size !== build.dependencies.find(item => item.name === pin.name).bytes) throw new Error('A native dependency changed size.');
  }
  const headerManifest = path.join(root, 'headers-identity.json');
  checkedFile(headerManifest, build.headers.sha256, 2 * 1024 * 1024);
  const headers = JSON.parse(fs.readFileSync(headerManifest, 'utf8'));
  if (!Array.isArray(headers) || headers.length !== build.headers.count) throw new Error('The extracted header identity is incomplete.');
  const names = new Set();
  const headerRoot = path.join(root, 'headers', 'include', 'node');
  for (const item of headers) {
    if (!isRecord(item) || typeof item.path !== 'string' || !/^[A-Za-z0-9_.\/-]+$/.test(item.path)
        || item.path.split('/').some(part => !part || part === '.' || part === '..') || names.has(item.path)) {
      throw new Error('The header identity contains an invalid or repeated path.');
    }
    names.add(item.path);
    const stat = checkedFile(path.join(headerRoot, item.path), item.sha256, 8 * 1024 * 1024, 0);
    if (stat.size !== item.bytes) throw new Error('An extracted Node header changed size.');
  }
  const walk = directory => fs.readdirSync(directory, { withFileTypes: true }).flatMap(item => {
    if (item.isSymbolicLink()) throw new Error('A reparse entry appeared in the extracted header tree.');
    const next = path.join(directory, item.name);
    return item.isDirectory() ? walk(next) : [path.relative(headerRoot, next).split(path.sep).join('/')];
  });
  const actualHeaders = walk(headerRoot);
  if (actualHeaders.length !== names.size || actualHeaders.some(name => !names.has(name))) throw new Error('The extracted header tree changed after its capture.');
  const observed = [];
  for (const name of ARTIFACTS) {
    const records = build.artifacts.filter(item => item?.name === name);
    const artifact = path.join(root, 'build', 'Release', name);
    const stat = checkedFile(artifact, records[0].sha256, 32 * 1024 * 1024);
    if (stat.size !== records[0].bytes) {
      throw new Error('A native artifact does not match the captured build identity.');
    }
    const project = path.join(root, 'build', records[0].target + '.vcxproj');
    checkedFile(project, records[0].projectSha256, 4 * 1024 * 1024);
    const xml = fs.readFileSync(project, 'utf8');
    if (!xml.includes('<WindowsTargetPlatformVersion>' + PINS.windowsSdk + '</WindowsTargetPlatformVersion>')
        || !xml.includes('<PlatformToolset>' + PINS.toolset + '</PlatformToolset>')
        || xml.includes('PANELREPLY_STORAGE_TEST_PROBE=1') !== records[0].testInstrumented) {
      throw new Error('An actual generated target disagrees with the normal/probe or SDK attribution.');
    }
    observed.push({ name, path: artifact, bytes: stat.size, sha256: records[0].sha256,
      testInstrumented: records[0].testInstrumented, projectSha256: records[0].projectSha256 });
  }
  return { root, build, observed, manifestSha256: hash(filename) };
}

function loadCandidate(directory, source) {
  const identity = inspectBuild(directory, source);
  const addon = require(identity.observed[0].path);
  if (typeof addon.createPrivateDirectory !== 'function' || typeof addon.openPrivateDirectory !== 'function') {
    throw new Error('The candidate does not expose the reviewed component API.');
  }
  return { addon, identity, fixtureExecutable: identity.observed[2].path,
    loadProbe() { return require(identity.observed[1].path); } };
}

module.exports = { NODE_VERSION, ARTIFACTS, PINS, REJECTED_OVERRIDES, validateManifest, inspectBuild, loadCandidate };
