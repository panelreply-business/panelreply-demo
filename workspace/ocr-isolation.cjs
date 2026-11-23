'use strict';

// This policy is opt-in and fail closed. It has no privileged or unconfined
// fallback. Native deny tests must pass on the intended host before use there.
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const BWRAP = '/usr/bin/bwrap';
const RUNTIME_DIRECTORY = '/usr';
const REPOSITORY_DIRECTORY = path.resolve(__dirname, '..');
const NORMALIZER_SCRIPT = path.join(__dirname, 'ocr-preprocess.py');
const SANDBOX_SCRIPT = '/app/ocr-preprocess.py';
const ARCH_X86_64 = 0xC000003E;
const RET_KILL_PROCESS = 0x80000000;
const RET_ERRNO_EPERM = 0x00050001;
const RET_ALLOW = 0x7FFF0000;
// Linux x86_64 syscall numbers, not portable to a different architecture.
const DENIED_SYSCALLS = Object.freeze([
  16, // ioctl: this worker has pipes, no terminal or device ioctl use
  41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, // all socket operations
  56, 57, 58, // clone, fork, vfork: no worker-created processes or threads
  101, 103, // ptrace, syslog
  105, 106, 113, 114, 116, 117, 119, 122, 123, // identity/group changes
  155, 165, 166, 169, 175, 176, // pivot_root, mount, umount2, reboot, kernel modules
  246, 248, 249, 250, 272, 288, 298, 299, // kexec, keyring, unshare, accept4, perf, recvmmsg
  303, 304, 307, 308, 310, 311, 312, 313, // handles, sendmmsg, setns, cross-process access
  320, 321, 323, // kexec_file_load, bpf, userfaultfd
  425, 426, 427, 428, 429, 430, 431, 432, 433, 435, 442, // io_uring, mounts, clone3
]);

function isolationSupported({ platform = process.platform, arch = process.arch, uid = process.getuid?.() } = {}) {
  return platform === 'linux' && arch === 'x64' && Number.isInteger(uid) && uid > 0;
}

function canonicalDirectory(input) {
  if (typeof input !== 'string' || !input || !input.isWellFormed() || input.includes('\0') || !path.isAbsolute(input)) throw new TypeError('Invalid trusted directory.');
  // Resolve the original spelling. Collapsing '..' first would lose the
  // filesystem meaning of an earlier symlink. Missing paths fail closed.
  const canonical = fs.realpathSync.native(input);
  if (!fs.statSync(canonical).isDirectory()) throw new TypeError('Invalid trusted directory.');
  return canonical;
}

function containsDirectory(parent, child) {
  return parent === child || child.startsWith(parent.endsWith(path.sep) ? parent : parent + path.sep);
}

function requiredPathReason(privateDataDir) {
  try {
    const runtime = canonicalDirectory(RUNTIME_DIRECTORY);
    // These roots come from the opened store, loaded module and local account.
    // HTTP input cannot replace the repository or either source of home data.
    const protectedDirectories = [privateDataDir, REPOSITORY_DIRECTORY, os.homedir(), os.userInfo().homedir].map(canonicalDirectory);
    if (protectedDirectories.some(directory => containsDirectory(runtime, directory) || containsDirectory(directory, runtime))) return 'isolation_path_overlap';
    // This one intentional repository-file bind must not redirect to another
    // file. It does not grant access to the rest of the repository or home.
    const script = fs.realpathSync.native(NORMALIZER_SCRIPT);
    if (script !== path.join(protectedDirectories[1], 'workspace', 'ocr-preprocess.py') || !fs.statSync(script).isFile()) return 'isolation_path_context_unavailable';
    return null;
  } catch {
    // Do not expose paths, account details or native filesystem diagnostics.
    return 'isolation_path_context_unavailable';
  }
}

function seccompProgram(arch = process.arch) {
  if (arch !== 'x64') throw new TypeError('Unsupported OCR isolation architecture.');
  const instructions = [
    [0x20, 0, 0, 4], // load seccomp_data.arch
    [0x15, 1, 0, ARCH_X86_64],
    [0x06, 0, 0, RET_KILL_PROCESS],
    [0x20, 0, 0, 0], // load syscall number
    [0x45, 0, 1, 0x40000000], // x32 ABI uses different syscall semantics
    [0x06, 0, 0, RET_KILL_PROCESS],
  ];
  for (const syscall of DENIED_SYSCALLS) instructions.push([0x15, 0, 1, syscall], [0x06, 0, 0, RET_ERRNO_EPERM]);
  instructions.push([0x06, 0, 0, RET_ALLOW]);
  const bytes = Buffer.alloc(instructions.length * 8);
  instructions.forEach(([code, jt, jf, value], index) => {
    bytes.writeUInt16LE(code, index * 8);
    bytes[index * 8 + 2] = jt;
    bytes[index * 8 + 3] = jf;
    bytes.writeUInt32LE(value, index * 8 + 4);
  });
  return bytes;
}

function restrictedInvocation(binary, args) {
  if (!['/usr/bin/tesseract', '/usr/bin/python3'].includes(binary)) throw new TypeError('Unsupported OCR isolation executable.');
  const isNormalizer = binary === '/usr/bin/python3';
  const invocation = [
    '--unshare-user', '--unshare-pid', '--unshare-net', '--unshare-ipc', '--unshare-uts', '--unshare-cgroup',
    '--uid', '65534', '--gid', '65534', '--cap-drop', 'ALL', '--die-with-parent', '--new-session', '--clearenv',
    '--setenv', 'PATH', '/usr/bin:/bin', '--setenv', 'LANG', 'C.UTF-8', '--setenv', 'LC_ALL', 'C.UTF-8',
    '--setenv', 'OMP_THREAD_LIMIT', '1', '--setenv', 'OMP_NUM_THREADS', '1',
    '--ro-bind', RUNTIME_DIRECTORY, '/usr', '--symlink', 'usr/bin', '/bin', '--symlink', 'usr/lib', '/lib', '--symlink', 'usr/lib64', '/lib64',
    '--proc', '/proc', '--dev', '/dev', '--dir', '/tmp', '--dir', '/app',
  ];
  let engineArgs = args;
  if (isNormalizer) {
    const script = NORMALIZER_SCRIPT;
    if (args[0] !== '-I' || args[1] !== '-B' || args[2] !== script) throw new TypeError('Unsupported OCR normalizer invocation.');
    invocation.push('--ro-bind', script, SANDBOX_SCRIPT);
    engineArgs = ['-I', '-B', SANDBOX_SCRIPT, ...args.slice(3)];
  }
  invocation.push('--remount-ro', '/', '--chdir', '/', '--seccomp', '3', '--', binary, ...engineArgs);
  return { binary: BWRAP, args: invocation, seccomp: seccompProgram() };
}

module.exports = { isolationSupported, requiredPathReason, restrictedInvocation, seccompProgram, DENIED_SYSCALLS };
