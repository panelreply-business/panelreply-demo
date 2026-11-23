'use strict';

// Run only on an authorized, unprivileged Linux test host. A denied namespace
// probe returns BLOCKED and never retries with sudo or weaker host settings.
// All files, inputs and probes are synthetic. No network connection is made.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createOcrService, LIMITS } = require('../workspace/ocr.cjs');
const { isolationSupported } = require('../workspace/ocr-isolation.cjs');
const { createReadinessDiagnostics } = require('./ocr-isolation-diagnostics.cjs');
const IMAGE = fs.readFileSync(path.join(__dirname, '../tests/fixtures/panels/complete.png'));
const HEADER = 'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext';
const TSV = HEADER + '\n5\t1\t1\t1\t1\t1\t0\t0\t1\t1\t95\tPART NUMBER: ISOLATION-OK\n';

function alive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; }
  catch (error) { if (error.code === 'ESRCH') return false; throw error; }
}

function injectedWorker(code, onWorkerPid) {
  const records = [];
  return { records, spawnProcess(binary, args, options) {
    if (!args.includes('stdin')) return spawn(binary, args, options);
    const engine = args.lastIndexOf('/usr/bin/tesseract');
    assert.ok(engine > args.indexOf('/usr/bin/bwrap'));
    let command = [...args.slice(0, engine), '/usr/bin/python3', '-I', '-B', '-c', code];
    const wrapper = command.indexOf('/usr/bin/bwrap');
    command.splice(wrapper + 1, 0, '--info-fd', '4');
    const child = spawn(binary, command, { ...options, stdio: [...options.stdio, 'pipe'] });
    const record = { child, nativePid: null, closed: false };
    records.push(record);
    let info = '';
    child.stdio[4].on('data', bytes => {
      info += bytes.toString('utf8');
      if (info.length > 8192) { child.kill('SIGKILL'); return; }
      try {
        const data = JSON.parse(info);
        if (!record.nativePid && Number.isInteger(data['child-pid']) && data['child-pid'] > 0) {
          record.nativePid = data['child-pid'];
          onWorkerPid?.();
        }
      } catch { /* a bounded partial JSON message */ }
    });
    child.stdio[4].on('error', () => child.kill('SIGKILL'));
    child.once('close', () => { record.closed = true; });
    return child;
  } };
}

function pythonCheck(lines) {
  return ['import errno, os, resource, socket, sys', 'sys.stdin.buffer.read()', ...lines, `sys.stdout.write(${JSON.stringify(TSV)})`].join('\n');
}

async function workerAssertions(lines, privateDataDir) {
  const injection = injectedWorker(pythonCheck(lines));
  const service = createOcrService({ ...injection, isolation: 'required', privateDataDir });
  try {
    const result = await service.recognizeImage(IMAGE);
    assert.equal(result.candidates[0].partNumber, 'ISOLATION-OK');
    assert.equal(injection.records.length, 1);
    assert.ok(injection.records[0].nativePid);
    assert.equal(injection.records[0].closed, true);
    assert.equal(alive(injection.records[0].child.pid), false);
    assert.equal(alive(injection.records[0].nativePid), false);
    return { processAliveAfterReturn: false };
  } finally { await service.shutdown(); }
}

function output(report) {
  const encoded = JSON.stringify(report, null, 2) + '\n';
  if (process.argv[2]) fs.writeFileSync(process.argv[2], encoded);
  process.stdout.write(encoded);
}

async function main() {
  if (!isolationSupported() || !fs.existsSync('/usr/bin/bwrap') || (fs.statSync('/usr/bin/bwrap').mode & 0o6000)) {
    output({ status: 'BLOCKED', reason: 'unprivileged_linux_x64_bubblewrap_required', cases: 0, nativeDenyBehavior: 'NOT TESTED', privilegedRetry: false });
    process.exitCode = 2;
    return;
  }
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'panelreply-isolation-synthetic-'));
  try {
    fs.chmodSync(directory, 0o700);
    const diagnostics = createReadinessDiagnostics();
    const readiness = createOcrService({ isolation: 'required', privateDataDir: directory, spawnProcess: diagnostics.spawnProcess });
    let engine;
    try { engine = await readiness.getOcrStatus(); }
    finally { await readiness.shutdown(); }
    if (!engine.available) {
      const diagnostic = diagnostics.snapshot(engine.reason);
      const status = diagnostic.classification.status;
      output({ status, reason: engine.reason, cases: 0, engine, diagnostic, nativeDenyBehavior: 'NOT TESTED', privilegedRetry: false,
        scope: 'Required readiness failed. Only an explicit namespace-denial diagnostic establishes an external host blocker. No policy change or unconfined fallback ran.' });
      process.exitCode = status === 'FAIL' ? 1 : 2;
      return;
    }
    const canary = path.join(directory, 'private-canary.txt');
    fs.writeFileSync(canary, 'Synthetic host-only canary. No customer information.\n', { mode: 0o600 });
    const parentNetworkNamespace = fs.readlinkSync('/proc/self/ns/net');
    const results = [];
    const check = async (name, task) => {
      try { results.push({ test: name, status: 'PASS', ...await task() }); }
      catch (error) { results.push({ test: name, status: 'FAIL', code: error.code || 'ASSERTION_FAILED', detail: error.message }); }
    };
    await check('host-only canary unreadable and runtime/root mounts read only', async () => ({ ...await workerAssertions([
      'denied = False', 'try:', ` open(${JSON.stringify(canary)}, "rb").read()`, 'except OSError as error:', ' denied = error.errno in (errno.ENOENT, errno.EACCES)', 'assert denied',
      'for target in ("/usr/panelreply-isolation-synthetic", "/tmp/panelreply-isolation-synthetic"):',
      ' denied = False', ' try:', '  fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)', '  os.close(fd)',
      ' except OSError as error:', '  denied = error.errno == errno.EROFS', ' assert denied',
    ], directory), hostCanaryRead: 'DENIED', writesToRuntimeAndRoot: 'DENIED_EROFS' }));
    await check('separate network namespace and IPv4 IPv6 Unix socket creation denied', async () => ({ ...await workerAssertions([
      `assert os.readlink('/proc/self/ns/net') != ${JSON.stringify(parentNetworkNamespace)}`,
      'for family in (socket.AF_INET, socket.AF_INET6, socket.AF_UNIX):', ' denied = False',
      ' try:', '  connection = socket.socket(family, socket.SOCK_STREAM)', '  connection.close()',
      ' except OSError as error:', '  denied = error.errno == errno.EPERM', ' assert denied',
    ], directory), networkNamespace: 'DIFFERENT', socketCreation: 'DENIED_EPERM', connectionAttempts: 0 }));
    await check('nonroot identity no capabilities no privilege escalation no worker forks and process bounds', async () => ({ ...await workerAssertions([
      'assert os.getuid() == 65534 and os.getgid() == 65534',
      'status = dict(line.split(":", 1) for line in open("/proc/self/status") if ":" in line)',
      'assert int(status["CapEff"].strip(), 16) == 0', 'assert status["NoNewPrivs"].strip() == "1"', 'assert status["Seccomp"].strip() == "2"',
      'for change in (lambda: os.setuid(0), lambda: os.setgid(0), os.fork):',
      ' denied = False', ' try:', '  change()', ' except OSError as error:', '  denied = error.errno == errno.EPERM', ' assert denied',
      `assert resource.getrlimit(resource.RLIMIT_AS) == (${LIMITS.nativeAddressSpaceBytes}, ${LIMITS.nativeAddressSpaceBytes})`,
      `assert resource.getrlimit(resource.RLIMIT_CPU) == (${LIMITS.nativeCpuSeconds}, ${LIMITS.nativeCpuSeconds})`,
      `assert resource.getrlimit(resource.RLIMIT_NOFILE) == (${LIMITS.nativeOpenFiles}, ${LIMITS.nativeOpenFiles})`,
      'assert resource.getrlimit(resource.RLIMIT_CORE) == (0, 0)', 'assert resource.getrlimit(resource.RLIMIT_FSIZE) == (0, 0)',
    ], directory), uid: 65534, gid: 65534, effectiveCapabilities: 0, noNewPrivileges: true, identityChanges: 'DENIED', workerFork: 'DENIED', resourceBounds: 'ENFORCED' }));
    await check('actual image recognition and normalization execute inside the required worker', async () => {
      const service = createOcrService({ isolation: 'required', privateDataDir: directory });
      try {
        const result = await service.recognizeImage(IMAGE);
        assert.equal(result.candidates[0].partNumber, 'DEMO-1001');
        assert.equal(result.candidates[0].reviewStatus, 'unreviewed');
        return { engine: result.engineVersion, reviewedAutomatically: false, normalizer: result.processing.normalization };
      } finally { await service.shutdown(); }
    });
    for (const mode of ['cancel', 'timeout']) {
      await check(`${mode} terminates the wrapper and its actual namespace child`, async () => {
        const controller = new AbortController();
        const injection = injectedWorker('import sys\nsys.stdin.buffer.read()\nwhile True: pass', mode === 'cancel' ? () => controller.abort() : undefined);
        const service = createOcrService({ ...injection, isolation: 'required', privateDataDir: directory, recognitionTimeoutMs: 2000 });
        try {
          await assert.rejects(service.recognizeImage(IMAGE, { signal: controller.signal }), error => error.code === (mode === 'cancel' ? 'OCR_CANCELLED' : 'OCR_TIMEOUT'));
          assert.equal(injection.records.length, 1);
          const record = injection.records[0];
          assert.ok(record.nativePid);
          assert.equal(record.closed, true);
          assert.equal(alive(record.child.pid), false);
          assert.equal(alive(record.nativePid), false);
          return { wrapperAliveAfterReturn: false, namespaceChildAliveAfterReturn: false };
        } finally { await service.shutdown(); }
      });
    }
    const failures = results.filter(result => result.status === 'FAIL').length;
    output({ status: failures ? 'FAIL' : 'PASS', cases: results.length, failures, engine, results,
      scope: 'Synthetic native deny tests on this test host only. Does not approve any hosted service or prove isolation on a different kernel/runtime.', privilegedRetry: false });
    if (failures) process.exitCode = 1;
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}

main().catch(error => { output({ status: 'FAIL', code: error.code || 'ISOLATION_TEST_FAILED', detail: error.message }); process.exitCode = 1; });
