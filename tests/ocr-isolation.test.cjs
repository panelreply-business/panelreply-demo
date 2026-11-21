'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { isolationSupported, restrictedInvocation, seccompProgram, DENIED_SYSCALLS } = require('../workspace/ocr-isolation.cjs');

// Interpret the small emitted cBPF instruction subset to catch jump/ABI errors.
// This does not claim the host kernel has applied the policy.
function evaluate(program, syscall, architecture = 0xC000003E) {
  let accumulator = 0;
  for (let instruction = 0; instruction < program.length / 8; instruction += 1) {
    const offset = instruction * 8, code = program.readUInt16LE(offset), jt = program[offset + 2], jf = program[offset + 3], value = program.readUInt32LE(offset + 4);
    if (code === 0x20) accumulator = value === 4 ? architecture : syscall;
    else if (code === 0x15) instruction += accumulator === value ? jt : jf;
    else if (code === 0x45) instruction += accumulator & value ? jt : jf;
    else if (code === 0x06) return value;
    else throw new Error('Unsupported policy instruction');
  }
  throw new Error('Policy has no terminal action');
}

test('restricted policy rejects other architectures, x32 ABI and forbidden kernel operations', () => {
  const program = seccompProgram('x64');
  for (const syscall of DENIED_SYSCALLS) assert.equal(evaluate(program, syscall), 0x00050001);
  for (const syscall of [0, 1, 3, 9, 11, 60, 257]) assert.equal(evaluate(program, syscall), 0x7FFF0000);
  assert.equal(evaluate(program, 0, 0x40000003), 0x80000000);
  assert.equal(evaluate(program, 0x40000000), 0x80000000);
  assert.throws(() => seccompProgram('arm64'), /Unsupported/);
});

test('required isolation permits only unprivileged Linux x64 hosts', () => {
  assert.equal(isolationSupported({ platform: 'linux', arch: 'x64', uid: 1000 }), true);
  for (const options of [{ platform: 'linux', arch: 'x64', uid: 0 }, { platform: 'linux', arch: 'arm64', uid: 1000 }, { platform: 'darwin', arch: 'x64', uid: 1000 }]) assert.equal(isolationSupported(options), false);
});

test('worker policy exposes only read-only runtime and a fixed normalizer script', () => {
  const tesseract = restrictedInvocation('/usr/bin/tesseract', ['--version']);
  assert.equal(tesseract.binary, '/usr/bin/bwrap');
  assert.equal(tesseract.args.includes('--bind'), false);
  assert.equal(tesseract.args.includes('--ro-bind-try'), false);
  assert.equal(tesseract.args.includes('--unshare-user-try'), false);
  assert.equal(tesseract.args.includes('--share-net'), false);
  assert.equal(tesseract.args.includes('--not-a-security-boundary'), false);
  assert.deepEqual(tesseract.args.slice(tesseract.args.indexOf('--uid'), tesseract.args.indexOf('--uid') + 4), ['--uid', '65534', '--gid', '65534']);
  assert.deepEqual(tesseract.args.slice(-3), ['--', '/usr/bin/tesseract', '--version']);
  const script = path.join(__dirname, '../workspace/ocr-preprocess.py');
  const python = restrictedInvocation('/usr/bin/python3', ['-I', '-B', script, '--probe']);
  assert.deepEqual(python.args.slice(-5), ['/usr/bin/python3', '-I', '-B', '/app/ocr-preprocess.py', '--probe']);
  assert.throws(() => restrictedInvocation('/usr/bin/python3', ['-c', 'untrusted']), /Unsupported/);
  assert.throws(() => restrictedInvocation('/tmp/custom-engine', []), /Unsupported/);
});
