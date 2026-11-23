'use strict';

// Benchmark provenance only. Observe the existing fixed native invocations and
// read dependency files while the service is idle. Never change engine options,
// execute another probe, or infer model identity from an engine version.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const MAX_FILE_BYTES = 64 * 1024 * 1024;
const MAX_BANNER_BYTES = 16 * 1024;
const MAX_PROBES = 64;
const MAX_COMMANDS = 16;
const BINARIES = Object.freeze({ resourceLimiter: '/usr/bin/prlimit', engine: '/usr/bin/tesseract', normalizer: '/usr/bin/python3' });
const ENVIRONMENT_KEYS = Object.freeze(['PATH', 'LANG', 'LC_ALL', 'OMP_THREAD_LIMIT', 'OMP_NUM_THREADS', 'TESSDATA_PREFIX']);
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');

function unavailable(requestedPath, reason) {
  return { status: 'UNAVAILABLE', requestedPath, resolvedPath: null, bytes: null, sha256: null, reason };
}
function sameFile(a, b) {
  return ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs'].every(key => a[key] === b[key]);
}
function fingerprintFile(filename, maxBytes = MAX_FILE_BYTES) {
  if (typeof filename !== 'string' || !path.isAbsolute(filename) || filename.includes('\0')) return unavailable(null, 'invalid_path');
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0 || maxBytes > MAX_FILE_BYTES) return unavailable(filename, 'invalid_file_size_limit');
  let descriptor;
  try {
    const resolvedPath = fs.realpathSync(filename);
    const initial = fs.statSync(resolvedPath, { bigint: true });
    if (!initial.isFile()) return unavailable(filename, 'not_regular_file');
    if (initial.size > BigInt(maxBytes)) return unavailable(filename, 'file_size_limit');
    // Resolve package symlinks, then refuse a final symlink or FIFO substituted
    // between stat and open. O_NONBLOCK is irrelevant for a regular file.
    descriptor = fs.openSync(resolvedPath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0));
    const opened = fs.fstatSync(descriptor, { bigint: true });
    if (!opened.isFile() || !sameFile(initial, opened)) return unavailable(filename, 'file_changed_during_hash');
    const hash = crypto.createHash('sha256'), buffer = Buffer.alloc(64 * 1024);
    let total = 0;
    while (total < Number(opened.size)) {
      const count = fs.readSync(descriptor, buffer, 0, Math.min(buffer.length, Number(opened.size) - total), total);
      if (!count) return unavailable(filename, 'file_changed_during_hash');
      total += count;
      hash.update(buffer.subarray(0, count));
    }
    const grew = fs.readSync(descriptor, buffer, 0, 1, total) !== 0;
    const finished = fs.fstatSync(descriptor, { bigint: true });
    if (grew || !sameFile(opened, finished) || fs.realpathSync(filename) !== resolvedPath
      || !sameFile(finished, fs.statSync(resolvedPath, { bigint: true }))) return unavailable(filename, 'file_changed_during_hash');
    return { status: 'AVAILABLE', requestedPath: filename, resolvedPath, bytes: total, sha256: hash.digest('hex') };
  } catch (error) {
    return unavailable(filename, ['ENOENT', 'ENOTDIR'].includes(error.code) ? 'file_not_found'
      : ['EACCES', 'EPERM'].includes(error.code) ? 'file_not_readable' : 'file_read_failed');
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function parseLanguageDirectory(bytes) {
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { return { status: 'UNAVAILABLE', path: null, languages: null, reason: 'invalid_probe_utf8' }; }
  const missing = reason => ({ status: 'UNAVAILABLE', path: null, languages: null, reason });
  if (Buffer.byteLength(text) > MAX_BANNER_BYTES) return missing('probe_output_limit');
  const lines = text.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n');
  const header = /^List of available languages in "([^"\r\n]+)" \((\d{1,3})\):$/.exec(lines.shift() || '');
  if (!header || !path.posix.isAbsolute(header[1]) || header[1].length > 4096 || /[\x00-\x1f\x7f\\]/.test(header[1])
    || header[1].split('/').includes('..')) return missing('data_directory_not_reported');
  if (Number(header[2]) > 256 || lines.length !== Number(header[2]) || new Set(lines).size !== lines.length
    || lines.some(language => !/^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z][A-Za-z0-9_+-]*)?$/.test(language))) return missing('invalid_language_list');
  return { status: 'OBSERVED', path: path.posix.normalize(header[1]), languages: lines.sort() };
}

function fixedInvocation(binary, args, options) {
  const flags = [/^--as=\d+:\d+$/, /^--cpu=\d+:\d+$/, /^--core=\d+:\d+$/, /^--fsize=\d+:\d+$/, /^--nofile=\d+:\d+$/];
  if (binary !== BINARIES.resourceLimiter || !Array.isArray(args) || args.length < 7 || args.length > 32 || args[5] !== '--'
    || flags.some((pattern, index) => !pattern.test(args[index])) || ![BINARIES.engine, BINARIES.normalizer].includes(args[6])
    || args.some(value => typeof value !== 'string' || value.length > 4096 || /[\x00-\x1f\x7f]/.test(value))
    || options?.shell !== false || options?.cwd !== '/') return null;
  const environment = Object.fromEntries(ENVIRONMENT_KEYS.map(key => [key, typeof options.env?.[key] === 'string' ? options.env[key] : null]));
  if (Object.values(environment).some(value => value !== null && (value.length > 4096 || /[\x00-\x1f\x7f]/.test(value)))) return null;
  return { binary: args[6], args: args.slice(7), resourceLimits: args.slice(0, 5), cwd: options.cwd, shell: options.shell, environment };
}

function createDependencyEvidence({ spawnProcess, hashFile = fingerprintFile }) {
  if (typeof spawnProcess !== 'function' || typeof hashFile !== 'function') throw new TypeError('Dependency evidence requires a spawn function and file hasher.');
  const observed = new Set(), probes = [], commands = new Map();
  let unsupportedInvocations = 0, observationLimit = false;

  function observeSpawn(binary, args, options) {
    const child = spawnProcess(binary, args, options);
    const invocation = fixedInvocation(binary, args, options);
    if (!invocation) { unsupportedInvocations += 1; return child; }
    const key = JSON.stringify(invocation);
    if (commands.has(key)) commands.get(key).count += 1;
    else if (commands.size < MAX_COMMANDS) commands.set(key, { ...invocation, count: 1 });
    else observationLimit = true;
    child.once('close', (code, signal) => {
      if (code === 0 && !signal) { observed.add(BINARIES.resourceLimiter); observed.add(invocation.binary); }
    });
    if (invocation.binary !== BINARIES.engine || invocation.args.length !== 1 || invocation.args[0] !== '--list-langs') return child;
    if (probes.length >= MAX_PROBES) { observationLimit = true; return child; }
    const probe = { status: 'UNAVAILABLE', path: null, languages: null, reason: 'probe_not_closed' };
    probes.push(probe);
    const chunks = [];
    let bytes = 0, overflow = false;
    child.stdout.on('data', data => {
      if (overflow) return;
      const chunk = Buffer.isBuffer(data) ? data : Buffer.from(data);
      bytes += chunk.length;
      if (bytes > MAX_BANNER_BYTES) { overflow = true; chunks.length = 0; return; }
      chunks.push(chunk);
    });
    child.once('close', (code, signal) => {
      const parsed = overflow ? { status: 'UNAVAILABLE', path: null, languages: null, reason: 'probe_output_limit' }
        : code !== 0 || signal ? { status: 'UNAVAILABLE', path: null, languages: null, reason: 'probe_failed' }
          : parseLanguageDirectory(Buffer.concat(chunks));
      for (const key of Object.keys(probe)) delete probe[key];
      Object.assign(probe, parsed);
    });
    return child;
  }

  function snapshot() {
    const directory = structuredClone(probes.at(-1) || { status: 'UNAVAILABLE', path: null, languages: null, reason: 'probe_not_observed' });
    const dataFile = (name, language) => {
      if (directory.status !== 'OBSERVED') return unavailable(null, 'data_directory_unavailable');
      if (language && !directory.languages.includes(language)) return { ...unavailable(null, 'language_not_reported'), status: language === 'osd' ? 'NOT_REPORTED' : 'UNAVAILABLE' };
      return hashFile(path.posix.join(directory.path, name));
    };
    return {
      dataDirectory: directory,
      binaries: Object.fromEntries(Object.entries(BINARIES).map(([name, filename]) => [name, observed.has(filename) ? hashFile(filename) : unavailable(filename, 'successful_invocation_not_observed')])),
      models: { eng: dataFile('eng.traineddata', 'eng'), osd: dataFile('osd.traineddata', 'osd') },
      configuration: { tsv: dataFile('configs/tsv') },
    };
  }

  function summarize(before, after) {
    const changes = [], unavailableFields = [];
    for (const group of ['binaries', 'models', 'configuration']) {
      for (const key of Object.keys(before[group])) {
        const first = before[group][key], last = after[group][key], field = group + '.' + key;
        if (first.status === 'AVAILABLE' && (last.status !== 'AVAILABLE' || first.sha256 !== last.sha256 || first.bytes !== last.bytes || first.resolvedPath !== last.resolvedPath)) changes.push(field);
        if ([first, last].some(item => item.reason === 'file_changed_during_hash')) changes.push(field + '.during_hash');
        if ([first, last].some(item => !['AVAILABLE', 'NOT_REPORTED'].includes(item.status))) unavailableFields.push(field);
      }
    }
    const directories = new Set(probes.filter(probe => probe.status === 'OBSERVED').map(probe => JSON.stringify({ path: probe.path, languages: probe.languages })));
    if (directories.size > 1) changes.push('dataDirectory');
    if (before.dataDirectory.status !== 'OBSERVED' || after.dataDirectory.status !== 'OBSERVED' || probes.some(probe => probe.status !== 'OBSERVED')) unavailableFields.push('dataDirectory');
    if (unsupportedInvocations) unavailableFields.push('unsupportedInvocations');
    if (observationLimit) unavailableFields.push('observationLimit');
    const settings = new Map();
    for (const command of commands.values()) {
      const variants = settings.get(command.binary) || new Set();
      variants.add(JSON.stringify({ resourceLimits: command.resourceLimits, cwd: command.cwd, shell: command.shell, environment: command.environment }));
      settings.set(command.binary, variants);
    }
    if ([...settings.values()].some(variants => variants.size > 1)) changes.push('executionConfiguration');
    const invocationProfiles = [...commands.values()].sort((a, b) => JSON.stringify(a) < JSON.stringify(b) ? -1 : JSON.stringify(a) > JSON.stringify(b) ? 1 : 0);
    const configurationSha256 = sha256(JSON.stringify(invocationProfiles.map(({ count, ...profile }) => profile)));
    const identityGate = changes.length ? 'FAIL' : unavailableFields.length ? 'BLOCKED' : 'PASS';
    return {
      format: 'panelreply-ocr-dependency-evidence', version: 1, identityGate,
      status: identityGate === 'PASS' ? 'STABLE_SNAPSHOTS' : identityGate === 'FAIL' ? 'CHANGED' : 'UNAVAILABLE',
      scope: 'Observed fixed resource-limited commands and engine language-directory output. SHA256 file snapshots before and after measurement, not continuous file-open attestation. Does not identify every shared library or Python package.',
      fileSizeLimitBytes: MAX_FILE_BYTES, discovery: 'Successful fixed-engine --list-langs stdout, never an engine-version lookup.',
      capturedEnvironmentKeys: ENVIRONMENT_KEYS, probes: structuredClone(probes), invocationProfiles, configurationSha256,
      unsupportedInvocations, observationLimit, before, after, changes, unavailableFields,
    };
  }
  return { spawnProcess: observeSpawn, snapshot, summarize };
}

module.exports = { fingerprintFile, parseLanguageDirectory, createDependencyEvidence };
