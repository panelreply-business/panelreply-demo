'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { EventEmitter } = require('node:events');
const { PassThrough, Writable } = require('node:stream');
const { createOcrService, inspectImage } = require('../workspace/ocr.cjs');
const { startWorkspace } = require('../workspace-server.cjs');

const REPOSITORY = path.resolve(__dirname, '..');
const SCRIPT = path.join(REPOSITORY, 'workspace/ocr-preprocess.py');
const IMAGE = fs.readFileSync(path.join(__dirname, 'fixtures/panels/complete.png'));
const HEADER = 'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext';

// Only the child transport is simulated. All path resolution and link changes
// below use the real filesystem unless an error/projection is named explicitly.
function transport(beforeReply = () => {}) {
  const calls = [];
  function spawnProcess(binary, args, options) {
    const child = new EventEmitter();
    child.pid = 12345;
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    const stage = args.at(-2) === '/usr/bin/bwrap' && args.at(-1) === '--version' ? 'dependency'
      : args.at(-1) === '--version' ? 'engine' : args.at(-1) === '--list-langs' ? 'languages'
      : args.at(-1) === '--probe' ? 'normalizer_probe' : args.includes('/usr/bin/python3') ? 'normalize' : 'recognize';
    const call = { binary, args, options, stage, input: [], closed: false };
    child.stdin = new Writable({ write(bytes, encoding, callback) { call.input.push(Buffer.from(bytes)); callback(); } });
    child.stdio = [child.stdin, child.stdout, child.stderr];
    if (options.stdio.length === 4) child.stdio.push(new Writable({ write(bytes, encoding, callback) { callback(); } }));
    const finish = (output, code = 0) => {
      if (call.closed) return;
      call.closed = true;
      child.stdout.end(output);
      child.stderr.end();
      child.emit('close', code);
    };
    child.kill = () => { queueMicrotask(() => finish('', 1)); return true; };
    child.stdin.once('finish', () => queueMicrotask(() => {
      beforeReply(call);
      if (stage === 'dependency') return finish('bubblewrap 0.12.0\n');
      if (stage === 'engine') return finish('tesseract 5.5.0\n');
      if (stage === 'languages') return finish('eng\n');
      if (stage === 'normalizer_probe') return finish(JSON.stringify({ method: 'median3-deskew-small-text-v3', pillowVersion: '11.1.0' }));
      if (stage === 'normalize') {
        const { width, height } = inspectImage(Buffer.concat(call.input));
        return finish(JSON.stringify({ method: 'median3-deskew-small-text-v3', pillowVersion: '11.1.0', applied: false,
          isolatedNoisePixels: 0, thresholdPixels: Math.max(32, Math.ceil(width * height / 1000)), imagePixels: width * height,
          inkBandCount: 0, medianInkBandHeight: 0, rescaleFactor: 1,
          deskew: { candidateAngle: 0, angle: 0, scoreBefore: 0, scoreAfter: 0, analysisPixels: Math.min(width, 650) * Math.min(height, 650), width, height, reason: 'not_needed' } }) + '\n');
      }
      return finish(HEADER + '\n5\t1\t1\t1\t1\t1\t0\t0\t1\t1\t95\tPART NUMBER: SYNTHETIC-BOUNDARY\n');
    }));
    calls.push(call);
    return child;
  }
  return { calls, spawnProcess };
}

function directory(t) {
  const result = fs.mkdtempSync(path.join(os.tmpdir(), 'panelreply-ocr-path-'));
  t.after(() => fs.rmSync(result, { recursive: true, force: true }));
  return result;
}

function service(t, privateDataDir, fake = transport(), options = {}) {
  const instance = createOcrService({ isolation: 'required', privateDataDir, spawnProcess: fake.spawnProcess, ...options });
  t.after(() => instance.shutdown());
  return { instance, calls: fake.calls };
}

async function refused(instance, calls, reason) {
  assert.deepEqual(await instance.getOcrStatus(), { available: false, engine: 'tesseract', version: null, language: 'eng', reason });
  await assert.rejects(instance.recognizeImage(IMAGE), error => error.code === 'OCR_UNAVAILABLE' && error.status === 503);
  assert.equal(calls.length, 0, 'an invalid trusted path must fail before even the dependency probe');
}

test('required OCR refuses a private directory equal to, inside, or containing the runtime mount', async t => {
  for (const privateDataDir of ['/usr', '/usr/bin', '/']) {
    const { instance, calls } = service(t, privateDataDir);
    await refused(instance, calls, 'isolation_path_overlap');
  }
});

test('required OCR requires an absolute nonempty well-formed private directory without path coercion', async t => {
  for (const privateDataDir of [undefined, null, '', '.', 'relative/private', new URL('file:///tmp/'), '/tmp/PRIVATE\0value', '/tmp/\uD800']) {
    const { instance, calls } = service(t, privateDataDir);
    await refused(instance, calls, 'isolation_path_context_unavailable');
  }
});

test('required OCR rejects missing leaves, dangling links, loops and nondirectory components', async t => {
  const root = directory(t), dangling = path.join(root, 'dangling'), loop = path.join(root, 'loop'), file = path.join(root, 'file');
  fs.symlinkSync('/usr/panelreply-nonexistent-synthetic-path', dangling);
  fs.symlinkSync(loop, loop);
  fs.writeFileSync(file, 'synthetic');
  for (const privateDataDir of [path.join(root, 'missing'), dangling + '/missing', loop, file, file + '/missing']) {
    const { instance, calls } = service(t, privateDataDir);
    await refused(instance, calls, 'isolation_path_context_unavailable');
  }
});

test('required OCR resolves symlink ancestors and dot-dot with filesystem semantics', async t => {
  const root = directory(t), alias = path.join(root, 'runtime');
  fs.symlinkSync('/usr/bin', alias);
  assert.equal(fs.realpathSync.native(alias + '/..'), fs.realpathSync.native('/usr'));
  for (const privateDataDir of [alias, alias + '/..']) {
    const { instance, calls } = service(t, privateDataDir);
    await refused(instance, calls, 'isolation_path_overlap');
  }
});

test('required OCR checks environment and OS account homes independently', async t => {
  const root = directory(t), actualUser = os.userInfo();
  for (const homeSource of ['environment', 'account']) {
    const envHome = t.mock.method(os, 'homedir', () => homeSource === 'environment' ? '/usr' : root);
    const accountHome = t.mock.method(os, 'userInfo', () => ({ ...actualUser, homedir: homeSource === 'account' ? '/usr' : root }));
    const { instance, calls } = service(t, root);
    await refused(instance, calls, 'isolation_path_overlap');
    envHome.mock.restore(); accountHome.mock.restore();
  }
});

test('required OCR rejects unresolved home metadata and inaccessible trusted paths without exposing errors', async t => {
  const root = directory(t), realpath = fs.realpathSync.native;
  const denied = t.mock.method(fs.realpathSync, 'native', (input, ...args) => {
    if (input === root) throw Object.assign(new Error('PRIVATE host path detail'), { code: 'EACCES' });
    return realpath(input, ...args);
  });
  let current = service(t, root);
  await refused(current.instance, current.calls, 'isolation_path_context_unavailable');
  denied.mock.restore();
  t.mock.method(os, 'userInfo', () => { throw new Error('PRIVATE account lookup failure'); });
  current = service(t, root);
  await refused(current.instance, current.calls, 'isolation_path_context_unavailable');
});

test('required OCR rejects a repository projected into the mounted runtime without accepting caller overrides', async t => {
  const root = directory(t), realpath = fs.realpathSync.native;
  t.mock.method(fs.realpathSync, 'native', (input, ...args) => input === REPOSITORY ? '/usr' : realpath(input, ...args));
  const { instance, calls } = service(t, root, transport(), { repositoryDir: root, homeDir: root });
  await refused(instance, calls, 'isolation_path_overlap');
});

test('required OCR rejects a redirected or nonregular normalizer bind before any worker starts', async t => {
  const root = directory(t), external = path.join(root, 'redirected.py'), realpath = fs.realpathSync.native;
  fs.writeFileSync(external, 'synthetic code, never executed');
  for (const target of [external, root, path.join(root, 'missing.py')]) {
    const redirected = t.mock.method(fs.realpathSync, 'native', (input, ...args) => input === SCRIPT ? target : realpath(input, ...args));
    const { instance, calls } = service(t, root);
    await refused(instance, calls, 'isolation_path_context_unavailable');
    redirected.mock.restore();
  }
});

test('required OCR accepts a nonoverlapping canonical directory and preserves the fixed worker contract', async t => {
  const root = directory(t), alias = path.join(root, 'alias'), privateDir = path.join(root, 'private');
  fs.mkdirSync(privateDir);
  fs.symlinkSync(privateDir, alias);
  const { instance, calls } = service(t, alias);
  assert.equal((await instance.getOcrStatus()).isolation, 'bubblewrap-seccomp');
  const result = await instance.recognizeImage(IMAGE);
  assert.equal(result.candidates[0].partNumber, 'SYNTHETIC-BOUNDARY');
  assert.equal(result.candidates[0].reviewStatus, 'unreviewed');
  assert.deepEqual(calls.map(call => call.stage), ['dependency', 'engine', 'languages', 'normalizer_probe', 'normalize', 'recognize']);
  assert.ok(calls.every(call => call.binary === '/usr/bin/prlimit' && call.options.shell === false && call.options.cwd === '/'));
  assert.ok(calls.slice(1).every(call => call.args.includes('--unshare-user') && call.args.includes('--unshare-net') && call.args.includes('--seccomp')));
  assert.equal(calls[0].input.length, 0);
  assert.equal(calls.some(call => call.args.includes(alias)), false, 'private paths are checked, never added to native arguments');
});

test('required OCR compares path components rather than a shared usr prefix', async t => {
  const root = directory(t), realpath = fs.realpathSync.native, stat = fs.statSync;
  // A projected canonical name avoids writing to the host filesystem root.
  t.mock.method(fs.realpathSync, 'native', (input, ...args) => input === root ? '/usr-adjacent-panelreply' : realpath(input, ...args));
  t.mock.method(fs, 'statSync', (input, ...args) => stat(input === '/usr-adjacent-panelreply' ? root : input, ...args));
  const { instance } = service(t, root);
  assert.equal((await instance.getOcrStatus()).available, true);
});

test('required OCR rechecks redirected private paths before returning cached readiness or accepting image input', async t => {
  const root = directory(t), alias = path.join(root, 'alias'), safe = path.join(root, 'private');
  fs.mkdirSync(safe); fs.symlinkSync(safe, alias);
  const { instance, calls } = service(t, alias);
  assert.equal((await instance.getOcrStatus()).available, true);
  assert.equal(calls.length, 4);
  fs.unlinkSync(alias); fs.symlinkSync('/usr', alias);
  assert.equal((await instance.getOcrStatus()).reason, 'isolation_path_overlap');
  await assert.rejects(instance.recognizeImage(IMAGE), error => error.code === 'OCR_UNAVAILABLE');
  assert.equal(calls.length, 4);
  assert.ok(calls.every(call => call.input.length === 0));
  fs.unlinkSync(alias); fs.symlinkSync(safe, alias);
  assert.equal((await instance.getOcrStatus()).available, true);
});

test('required OCR preserves configuration failure when a path changes between readiness stages', async t => {
  for (const stage of ['before_dependency', 'dependency', 'engine', 'languages', 'normalizer_probe']) {
    const root = directory(t), alias = path.join(root, 'alias');
    fs.symlinkSync(root, alias);
    const realpath = fs.realpathSync.native;
    let checks = 0;
    const observer = t.mock.method(fs.realpathSync, 'native', (input, ...args) => {
      if (stage === 'before_dependency' && input === alias && ++checks === 2) { fs.unlinkSync(alias); fs.symlinkSync('/usr', alias); }
      return realpath(input, ...args);
    });
    const fake = transport(call => { if (call.stage === stage) { fs.unlinkSync(alias); fs.symlinkSync('/usr', alias); } });
    const { instance, calls } = service(t, alias, fake);
    const result = await instance.getOcrStatus();
    assert.equal(result.available, false);
    assert.equal(result.reason, 'isolation_path_overlap');
    assert.equal(calls.at(-1)?.stage, stage === 'before_dependency' ? undefined : stage);
    assert.ok(calls.every(call => call.closed && call.input.length === 0));
    observer.mock.restore();
  }
});

test('required OCR rechecks before recognition after normalization and does not start a later native stage', async t => {
  const root = directory(t), alias = path.join(root, 'alias');
  fs.symlinkSync(root, alias);
  const fake = transport(call => { if (call.stage === 'normalize') { fs.unlinkSync(alias); fs.symlinkSync('/usr', alias); } });
  const { instance, calls } = service(t, alias, fake);
  await assert.rejects(instance.recognizeImage(IMAGE), error => error.code === 'OCR_UNAVAILABLE');
  assert.equal(calls.at(-1).stage, 'normalize');
  assert.equal(calls.filter(call => call.stage === 'recognize').length, 0);
  assert.ok(calls.every(call => call.closed));
});

test('resource-limits OCR does not require or inspect trusted filesystem or home context', async t => {
  t.mock.method(os, 'homedir', () => { throw new Error('must not query home'); });
  t.mock.method(os, 'userInfo', () => { throw new Error('must not query account'); });
  t.mock.method(fs.realpathSync, 'native', () => { throw new Error('must not resolve isolation paths'); });
  for (const privateDataDir of [undefined, '/usr', '/missing/PRIVATE']) {
    const { instance, calls } = service(t, privateDataDir, transport(), { isolation: 'resource-limits' });
    assert.equal((await instance.getOcrStatus()).available, true);
    assert.equal((await instance.recognizeImage(IMAGE)).candidates[0].reviewStatus, 'unreviewed');
    assert.equal(calls.some(call => call.args.includes('/usr/bin/bwrap')), false);
  }
});

test('combined integration entrypoint supplies the opened store directory without activating required isolation', async t => {
  const root = directory(t), dataDir = path.join(root, 'combined'), ocr = require('../workspace/ocr.cjs');
  const received = [];
  class Server extends EventEmitter { listen() {} close(callback) { callback(); } closeIdleConnections() {} closeAllConnections() {} }
  t.mock.method(http, 'createServer', () => new Server());
  t.mock.method(ocr, 'createOcrService', options => { received.push(options); return { getOcrStatus() {}, recognizeImage() {}, async shutdown() {} }; });
  const running = startWorkspace({ WORKSPACE_DATA_DIR: dataDir });
  try { assert.deepEqual(received, [{ privateDataDir: path.dirname(running.store.filename) }]); }
  finally { await running.close(); }
});
