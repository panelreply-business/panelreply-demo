'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const crypto = require('node:crypto');
const { isolationSupported, restrictedInvocation, seccompProgram, DENIED_SYSCALLS } = require('../workspace/ocr-isolation.cjs');
const baseline = require('./fixtures/ocr-seccomp-baseline.json');

// Interpret the small emitted cBPF instruction subset to catch jump/ABI errors.
// This does not claim the host kernel has applied the policy.
function evaluate(program, syscall, architecture = 0xC000003E, args = []) {
  const data = Buffer.alloc(64);
  data.writeUInt32LE(syscall >>> 0, 0); data.writeUInt32LE(architecture >>> 0, 4);
  args.forEach((value, index) => data.writeBigUInt64LE(BigInt.asUintN(64, BigInt(value)), 16 + index * 8));
  let accumulator = 0;
  for (let instruction = 0; instruction < program.length / 8; instruction += 1) {
    const offset = instruction * 8, code = program.readUInt16LE(offset), jt = program[offset + 2], jf = program[offset + 3], value = program.readUInt32LE(offset + 4);
    if (code === 0x20) {
      assert.equal(value % 4, 0); assert.ok(value <= data.length - 4);
      accumulator = data.readUInt32LE(value);
    }
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

test('FIOCLEX stays denied and only its exact zero-extended ioctl request receives EACCES', () => {
  const program = seccompProgram('x64');
  for (let request = 0; request <= 0xFFFF; request++) {
    const action = evaluate(program, 16, undefined, [3, request, 0]);
    assert.equal(action >>> 16, 0x0005, 'every ioctl remains a kernel-operation denial');
    assert.equal(action, request === 0x5451 ? 0x0005000D : 0x00050001, 'request ' + request);
  }
  for (const high of [1n, 2n, 0x80000000n, 0xFFFFFFFFn]) {
    for (const low of [0x5450n, 0x5451n, 0x5452n, 0xFFFFFFFFn]) {
      assert.equal(evaluate(program, 16, undefined, [3, (high << 32n) | low, 0]), 0x00050001);
    }
  }
  for (const descriptor of [0n, 1n, 3n, 31n, 0xFFFFFFFFFFFFFFFFn]) {
    for (const thirdArgument of [0n, 1n, 0xFFFFFFFFFFFFFFFFn]) {
      assert.equal(evaluate(program, 16, undefined, [descriptor, 0x5451, thirdArgument]), 0x0005000D);
    }
  }
  for (const request of [0x10000n, 0x80005451n, 0xFFFFFFFFn]) assert.equal(evaluate(program, 16, undefined, [3, request]), 0x00050001);
});

test('the compatibility branch preserves every other sampled decision from the frozen policy', () => {
  const previous = Buffer.from(baseline.bpfBase64, 'base64'), current = seccompProgram('x64');
  assert.equal(previous.length, 1112);
  assert.equal(crypto.createHash('sha256').update(previous).digest('hex'), '7760783e3ecbc4fde6c8ff7953dfac5a9a6490c0a9c60e81bb6bcd601925cb19');
  const numbers = [...Array(1025).keys(), 0x3FFFFFFF, 0x40000000, 0x40000010, 0x7FFFFFFF, 0x80000010, 0xFFFFFFFF];
  for (const syscall of numbers) {
    for (const request of [0n, 0x5450n, 0x5451n, 0x100005451n, 0xFFFFFFFFFFFFFFFFn]) {
      const args = [3, request, 0];
      const before = evaluate(previous, syscall, undefined, args);
      const after = evaluate(current, syscall, undefined, args);
      assert.equal(after, syscall === 16 && request === 0x5451n ? 0x0005000D : before, 'syscall ' + syscall + ', request ' + request);
      assert.equal(after === 0x7FFF0000, before === 0x7FFF0000, 'no new syscall permission');
    }
  }
  assert.deepEqual(restrictedInvocation('/usr/bin/tesseract', ['--version']).seccomp, current);
  const script = path.join(__dirname, '../workspace/ocr-preprocess.py');
  assert.deepEqual(restrictedInvocation('/usr/bin/python3', ['-I', '-B', script, '--probe']).seccomp, current);
});

test('FIOCLEX cannot bypass architecture or x32 rejection', () => {
  const program = seccompProgram('x64'), request = [3, 0x5451, 0];
  for (const architecture of [0, 0x40000003, 0xC00000B7, 0x80000015, 0x4000003E, 0xFFFFFFFF]) {
    assert.equal(evaluate(program, 16, architecture, request), 0x80000000);
  }
  for (const syscall of [0x40000000, 0x40000010, 0x40000210, 0xFFFFFFFF]) {
    assert.equal(evaluate(program, syscall, undefined, request), 0x80000000);
  }
  for (const architecture of ['arm64', 'ia32', 'arm', 'riscv64', 's390x', 'ppc64']) assert.throws(() => seccompProgram(architecture), /Unsupported/);
});

test('the tagged CPython descriptor-flag model reaches already-permitted fcntl after denied FIOCLEX', () => {
  // Source-backed model of CPython v3.14.4 Python/fileutils.c. This does not run
  // Python, install a filter, or prove native startup on a particular host.
  function closeOnExec(program) {
    const events = [], denied = evaluate(program, 16, undefined, [3, 0x5451, 0]);
    assert.equal(denied >>> 16, 0x0005);
    events.push({ operation: 'ioctl FIOCLEX', executed: false, errno: denied & 0xFFFF });
    if (![9, 25, 13].includes(denied & 0xFFFF)) return { result: 'ERROR', events };
    let flags = 0;
    for (const [command, argument] of [[1, 0], [2, 1]]) { // F_GETFD, F_SETFD(FD_CLOEXEC)
      const action = evaluate(program, 72, undefined, [3, command, argument]);
      if (action !== 0x7FFF0000) return { result: 'ERROR', events };
      events.push({ operation: command === 1 ? 'fcntl F_GETFD' : 'fcntl F_SETFD', executed: true });
      if (command === 2) flags = argument;
    }
    return { result: flags === 1 ? 'NON_INHERITABLE' : 'ERROR', events };
  }
  assert.deepEqual(closeOnExec(Buffer.from(baseline.bpfBase64, 'base64')), {
    result: 'ERROR', events: [{ operation: 'ioctl FIOCLEX', executed: false, errno: 1 }],
  });
  assert.deepEqual(closeOnExec(seccompProgram('x64')), { result: 'NON_INHERITABLE', events: [
    { operation: 'ioctl FIOCLEX', executed: false, errno: 13 },
    { operation: 'fcntl F_GETFD', executed: true }, { operation: 'fcntl F_SETFD', executed: true },
  ] });
});
