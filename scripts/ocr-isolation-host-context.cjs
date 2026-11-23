'use strict';

// Read-only test-host context. These observations cannot establish isolation,
// change its result, or substitute for the six native worker assertions.
const fs = require('node:fs');
const os = require('node:os');
const crypto = require('node:crypto');
const ERROR_CODES = new Set(['ENOENT', 'EACCES', 'EPERM', 'ELOOP', 'EIO', 'EMFILE', 'ENFILE', 'EINVAL']);
const FILES = Object.freeze({
  osRelease: Object.freeze({ path: '/usr/lib/os-release', limit: 8192 }),
  processStatus: Object.freeze({ path: '/proc/self/status', limit: 16384 }),
  processLabel: Object.freeze({ path: '/proc/self/attr/current', limit: 512 }),
  unprivilegedUsernsClone: Object.freeze({ path: '/proc/sys/kernel/unprivileged_userns_clone', limit: 32 }),
  apparmorRestrictUserns: Object.freeze({ path: '/proc/sys/kernel/apparmor_restrict_unprivileged_userns', limit: 32 }),
  apparmorRestrictUnconfined: Object.freeze({ path: '/proc/sys/kernel/apparmor_restrict_unprivileged_unconfined', limit: 32 }),
  maxUserNamespaces: Object.freeze({ path: '/proc/sys/user/max_user_namespaces', limit: 32 }),
  apparmorEnabled: Object.freeze({ path: '/sys/module/apparmor/parameters/enabled', limit: 16 }),
  apparmorProfiles: Object.freeze({ path: '/sys/kernel/security/apparmor/profiles', limit: 65536 }),
  bubblewrap: Object.freeze({ path: '/usr/bin/bwrap', limit: 8 * 1024 * 1024 }),
});
const PROFILE_FILES = Object.freeze(['/etc/apparmor.d/bwrap-userns-restrict', '/etc/apparmor.d/bwrap', '/etc/apparmor.d/usr.bin.bwrap']);
const unavailable = reason => ({ state: 'UNAVAILABLE', reason });
const safeCode = error => ERROR_CODES.has(error?.code) ? error.code : 'OTHER';
const sha256 = data => crypto.createHash('sha256').update(data).digest('hex');

function identity(stat) {
  return Object.fromEntries(['dev', 'ino', 'size', 'mode', 'mtimeNs', 'ctimeNs'].map(key => [key, String(stat[key])]));
}

function readHostFile(key, fsImpl = fs) {
  if (!Object.hasOwn(FILES, key)) throw new TypeError('Unknown host-context field.');
  const specification = FILES[key];
  let fd, result;
  try {
    fd = fsImpl.openSync(specification.path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    const before = fsImpl.fstatSync(fd, { bigint: true });
    if (!before.isFile()) result = unavailable('NOT_REGULAR_FILE');
    else if (before.size > BigInt(specification.limit)) result = unavailable('SIZE_LIMIT');
    else {
      const buffer = Buffer.alloc(specification.limit + 1);
      let used = 0;
      while (used < buffer.length) {
        const read = fsImpl.readSync(fd, buffer, used, Math.min(65536, buffer.length - used), null);
        if (!Number.isInteger(read) || read < 0 || read > Math.min(65536, buffer.length - used)) throw new TypeError('Invalid read result.');
        if (read === 0) break;
        used += read;
      }
      const after = fsImpl.fstatSync(fd, { bigint: true });
      if (used > specification.limit) result = unavailable('SIZE_LIMIT');
      else if (JSON.stringify(identity(before)) !== JSON.stringify(identity(after))) result = unavailable('FILE_CHANGED');
      else result = { state: 'OBSERVED', bytes: used, data: buffer.subarray(0, used), identity: identity(after) };
    }
  } catch (error) { result = unavailable(safeCode(error)); }
  finally {
    if (fd !== undefined) {
      try { fsImpl.closeSync(fd); }
      catch (error) { result = unavailable(safeCode(error)); }
    }
  }
  return result;
}

function textField(key, parse, fsImpl) {
  const result = readHostFile(key, fsImpl);
  if (result.state !== 'OBSERVED') return result;
  // Some LSMs terminate attr/current with one NUL. No other field or
  // embedded control receives this exception. The recorded byte count is raw.
  const data = key === 'processLabel' && result.data.at(-1) === 0 ? result.data.subarray(0, -1) : result.data;
  if (!/^[\x09\x0a\x0d\x20-\x7e]*$/.test(data.toString('latin1'))) return unavailable('INVALID_VALUE');
  const value = parse(data.toString('ascii'));
  return value === null ? unavailable('INVALID_VALUE') : { state: 'OBSERVED', value, bytes: result.bytes };
}

function keyValues(text, separator, patterns) {
  const values = {};
  for (const line of text.split(/\r?\n/)) {
    const at = line.indexOf(separator);
    if (at < 0) continue;
    const key = line.slice(0, at).trim();
    if (!Object.hasOwn(patterns, key)) continue;
    let value = line.slice(at + 1).trim();
    if (separator === '=' && /^"[^"\\]*"$/.test(value)) value = value.slice(1, -1);
    if (Object.hasOwn(values, key) || !patterns[key].test(value)) return null;
    values[key] = value;
  }
  return Object.keys(values).length ? values : null;
}

function observeHostContext({ fsImpl = fs, platform = process.platform, architecture = process.arch,
  kernel = os.release(), node = process.version, env = process.env } = {}) {
  const small = (value, pattern) => typeof value === 'string' && pattern.test(value)
    ? { state: 'OBSERVED', value } : unavailable('INVALID_OR_MISSING_VALUE');
  const integer = text => /^(0|[1-9][0-9]{0,15})$/.test(text.trim()) ? text.trim() : null;
  const boolean = text => /^(0|1)$/.test(text.trim()) ? text.trim() : null;
  const context = {
    platform: small(platform, /^[a-z0-9_]{1,32}$/),
    architecture: small(architecture, /^[a-z0-9_]{1,32}$/),
    kernel: small(kernel, /^[A-Za-z0-9._+~()-]{1,128}$/),
    node: small(node, /^v[0-9]+\.[0-9]+\.[0-9]+$/),
    runnerImage: {
      imageOs: small(env.ImageOS, /^[A-Za-z0-9._-]{1,64}$/),
      imageVersion: small(env.ImageVersion, /^[A-Za-z0-9._-]{1,64}$/),
      provenance: 'Two selected runner environment labels. Observed OS and kernel fields remain separate.',
    },
    fields: {}, profileFiles: [],
    scope: 'Read-only parent-process and host context. Missing or inaccessible data is not a disabled control. Profile-file presence does not prove it is loaded or attached. A parent-process label does not prove the worker label. No host setting, profile, capability or namespace is changed.',
  };
  if (platform !== 'linux') {
    context.state = 'UNAVAILABLE'; context.reason = 'LINUX_CONTEXT_REQUIRED';
    return context;
  }
  context.state = 'OBSERVED';
  context.fields.osRelease = textField('osRelease', text => keyValues(text, '=', {
    ID: /^[A-Za-z0-9._-]{1,64}$/, VERSION_ID: /^[A-Za-z0-9._-]{1,64}$/, BUILD_ID: /^[A-Za-z0-9._-]{1,64}$/,
  }), fsImpl);
  context.fields.processStatus = textField('processStatus', text => keyValues(text, ':', {
    CapInh: /^[0-9a-fA-F]{1,16}$/, CapPrm: /^[0-9a-fA-F]{1,16}$/, CapEff: /^[0-9a-fA-F]{1,16}$/,
    CapBnd: /^[0-9a-fA-F]{1,16}$/, CapAmb: /^[0-9a-fA-F]{1,16}$/, NoNewPrivs: /^[01]$/,
    Seccomp: /^[012]$/, Seccomp_filters: /^(0|[1-9][0-9]{0,8})$/,
  }), fsImpl);
  context.fields.processLabel = textField('processLabel', text => {
    const value = text.trim(); return /^[A-Za-z0-9_./:() +,=~-]{1,256}$/.test(value) ? value : null;
  }, fsImpl);
  for (const name of ['unprivilegedUsernsClone', 'apparmorRestrictUserns', 'apparmorRestrictUnconfined']) {
    context.fields[name] = textField(name, boolean, fsImpl);
  }
  context.fields.maxUserNamespaces = textField('maxUserNamespaces', integer, fsImpl);
  context.fields.apparmorEnabled = textField('apparmorEnabled', text => /^[YN01]$/.test(text.trim()) ? text.trim() : null, fsImpl);
  context.fields.apparmorProfiles = textField('apparmorProfiles', text => {
    const matches = [];
    for (const line of text.split(/\r?\n/)) {
      const match = /^(bwrap|unpriv_bwrap)(?:\/\/[A-Za-z0-9_.-]{1,64})? \((enforce|complain|kill|unconfined|prompt)\)$/.exec(line);
      if (match) matches.push({ profile: line.slice(0, line.lastIndexOf(' (')), mode: match[2] });
      if (matches.length > 16) return null;
    }
    return matches;
  }, fsImpl);
  for (const filename of PROFILE_FILES) {
    try {
      const stat = fsImpl.lstatSync(filename);
      context.profileFiles.push({ path: filename, state: 'OBSERVED', type: stat.isFile() ? 'file' : stat.isSymbolicLink() ? 'symlink' : 'other', attachment: 'NOT_ESTABLISHED' });
    } catch (error) { context.profileFiles.push({ path: filename, ...unavailable(safeCode(error)), attachment: 'NOT_ESTABLISHED' }); }
  }
  return context;
}

function observeBubblewrap(fsImpl = fs) {
  const result = readHostFile('bubblewrap', fsImpl);
  if (result.state !== 'OBSERVED') return result;
  return { state: 'OBSERVED', path: FILES.bubblewrap.path, bytes: result.bytes,
    sha256: sha256(result.data), identity: result.identity,
    scope: 'Fixed installed executable bytes read without execution. This is not an authenticity claim or proof of loaded memory pages.' };
}

module.exports = { FILES, PROFILE_FILES, readHostFile, observeHostContext, observeBubblewrap, safeCode };
