'use strict';

// Runs bounded Linux process tests with synthetic data. Python helpers replace
// only the engine in this test injection seam. Application callers cannot select
// an executable, limits, environment or arguments.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { createOcrService, getOcrStatus, LIMITS } = require('../workspace/ocr.cjs');
const IMAGE = fs.readFileSync(path.join(__dirname, '../tests/fixtures/panels/complete.png'));
const HEADER = 'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext';
const TSV = HEADER + '\n5\t1\t1\t1\t1\t1\t0\t0\t1\t1\t95\tPART NUMBER: LIMITS-OK\n';

function syntheticBands(width, height, bandHeights, inverted = false) {
  const code = [
    'import sys', 'from PIL import Image,ImageDraw',
    `im=Image.new('RGB',(${width},${height}),${inverted ? "'black'" : "'white'"})`,
    'draw=ImageDraw.Draw(im)', 'y=8',
    `for h in ${JSON.stringify(bandHeights)}:`,
    ` draw.rectangle((8,y,${Math.min(width - 9, 100)},y+h-1),fill=${inverted ? "'white'" : "'black'"})`,
    ' y+=h+12', 'im.save(sys.stdout.buffer,format="PNG")',
  ].join('\n');
  const result = spawnSync('/usr/bin/prlimit', [
    `--as=${LIMITS.nativeAddressSpaceBytes}:${LIMITS.nativeAddressSpaceBytes}`, '--cpu=10:10', '--fsize=0:0', '--core=0:0', '--nofile=64:64', '--',
    '/usr/bin/python3', '-I', '-B', '-c', code,
  ], { maxBuffer: LIMITS.imageBytes, timeout: LIMITS.recognitionTimeoutMs, env: { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8' } });
  assert.equal(result.status, 0, result.stderr?.toString());
  return result.stdout;
}

async function verifyPixelNormalization({ width, height, bands, inverted = false, scale, median }) {
  const input = syntheticBands(width, height, bands, inverted), original = Buffer.from(input);
  const injection = injector({ code: [
    'import io,sys', 'from PIL import Image',
    'im=Image.open(io.BytesIO(sys.stdin.buffer.read()))',
    `assert im.size==(${width * scale},${height * scale})`,
    `sys.stdout.write(${JSON.stringify(TSV)})`,
  ].join('\n') });
  const service = createOcrService(injection);
  try {
    const result = await service.recognizeImage(input);
    assert.equal(result.processing.normalization.rescaleFactor, scale);
    assert.equal(result.processing.normalization.medianInkBandHeight, median);
    assert.equal(result.processing.normalization.inkBandCount, bands.filter(value => value >= 3).length);
    assert.equal(result.processing.normalization.applied, false);
    assert.deepEqual(input, original);
    assert.equal(result.candidates[0].reviewStatus, 'unreviewed');
    assert.equal(injection.calls.length, 1);
    assert.equal(isAlive(injection.calls[0]), false);
    return { width, height, scale, medianInkBandHeight: median };
  } finally { await service.shutdown(); }
}

function isAlive(child) {
  if (!child?.pid) return false;
  try { process.kill(child.pid, 0); return true; } catch (error) { if (error.code === 'ESRCH') return false; throw error; }
}
function injector({ code, cpuSeconds, onRecognition, stage = 'engine' } = {}) {
  const calls = [];
  return { calls, spawnProcess(binary, args, options) {
    let actual = [...args];
    const normalization = args.some(value => value.endsWith('/ocr-preprocess.py')) && !args.includes('--probe');
    const recognition = stage === 'normalizer' ? normalization : stage === 'orientation' ? args.includes('stdin') && args[args.indexOf('--psm') + 1] === '1' : args.includes('stdin');
    if (recognition && code) {
      const engine = actual.indexOf(stage === 'normalizer' ? '/usr/bin/python3' : '/usr/bin/tesseract');
      assert.ok(engine > 0);
      actual = [...actual.slice(0, engine), '/usr/bin/python3', '-c', code];
      if (cpuSeconds) actual[1] = `--cpu=${cpuSeconds}:${cpuSeconds}`;
    }
    const child = spawn(binary, actual, options);
    if (recognition) { calls.push(child); onRecognition?.(child); }
    return child;
  } };
}

async function main() {
  const status = await getOcrStatus();
  if (!status.available || !fs.existsSync('/usr/bin/python3')) {
    console.log(JSON.stringify({ status: 'BLOCKED', reason: status.reason || 'python_test_helper_unavailable', cases: 0 }));
    process.exitCode = 2;
    return;
  }
  const results = [];
  async function check(name, task) {
    try { const evidence = await task(); results.push({ test: name, status: 'PASS', ...evidence }); }
    catch (error) { results.push({ test: name, status: 'FAIL', code: error.code || 'ASSERTION_FAILED', detail: error.message }); }
  }
  await check('exact production resource ceilings and address-space allocation failure', async () => {
    const code = [
      'import errno, mmap, os, resource, sys, tempfile',
      'sys.stdin.buffer.read()',
      `assert resource.getrlimit(resource.RLIMIT_AS) == (${LIMITS.nativeAddressSpaceBytes}, ${LIMITS.nativeAddressSpaceBytes})`,
      `assert resource.getrlimit(resource.RLIMIT_CPU) == (${LIMITS.nativeCpuSeconds}, ${LIMITS.nativeCpuSeconds})`,
      `assert resource.getrlimit(resource.RLIMIT_NOFILE) == (${LIMITS.nativeOpenFiles}, ${LIMITS.nativeOpenFiles})`,
      'assert resource.getrlimit(resource.RLIMIT_CORE) == (0, 0)',
      'assert resource.getrlimit(resource.RLIMIT_FSIZE) == (0, 0)',
      'denied = False',
      'try:',
      ` allocation = mmap.mmap(-1, ${LIMITS.nativeAddressSpaceBytes} + 1)`,
      ' allocation.close()',
      'except (OSError, MemoryError):',
      ' denied = True',
      'assert denied',
      'fd, filename = tempfile.mkstemp(prefix="panelreply-resource-test-", dir="/tmp")',
      'try:',
      ' denied = False',
      ' try:',
      '  os.write(fd, b"x")',
      ' except OSError as error:',
      '  denied = error.errno == errno.EFBIG',
      ' assert denied',
      'finally:',
      ' os.close(fd)',
      ' os.unlink(filename)',
      `sys.stdout.write(${JSON.stringify(TSV)})`,
    ].join('\n');
    const injection = injector({ code });
    const service = createOcrService(injection);
    try {
      const result = await service.recognizeImage(IMAGE);
      assert.equal(result.candidates[0].partNumber, 'LIMITS-OK');
      assert.equal(isAlive(injection.calls[0]), false);
      return { addressSpaceBytes: LIMITS.nativeAddressSpaceBytes, cpuSeconds: LIMITS.nativeCpuSeconds, openFiles: LIMITS.nativeOpenFiles, coreBytes: 0, fileBytes: 0, allocationBeyondCeiling: 'REJECTED', fileWrite: 'REJECTED' };
    } finally { await service.shutdown(); }
  });
  await check('kernel CPU ceiling terminates and reaps an isolated one-second test workload', async () => {
    const injection = injector({ code: 'import sys\nsys.stdin.buffer.read()\nwhile True: pass', cpuSeconds: 1 });
    const service = createOcrService(injection);
    try {
      await assert.rejects(service.recognizeImage(IMAGE), error => error.code === 'OCR_FAILED');
      assert.equal(injection.calls[0].signalCode, 'SIGKILL');
      assert.equal(isAlive(injection.calls[0]), false);
      return { testCpuSeconds: 1, productionCpuSeconds: LIMITS.nativeCpuSeconds, signal: injection.calls[0].signalCode, processAliveAfterReturn: false };
    } finally { await service.shutdown(); }
  });
  await check('native crash returns a generic error and leaves no process', async () => {
    const injection = injector({ code: 'import os, signal, sys\nsys.stdin.buffer.read()\nos.kill(os.getpid(), signal.SIGSEGV)' });
    const service = createOcrService(injection);
    try {
      await assert.rejects(service.recognizeImage(IMAGE), error => error.code === 'OCR_FAILED' && !error.message.includes('SIGSEGV'));
      assert.equal(injection.calls[0].signalCode, 'SIGSEGV');
      assert.equal(isAlive(injection.calls[0]), false);
      return { processAliveAfterReturn: false, coreFileAllowed: false };
    } finally { await service.shutdown(); }
  });
  await check('service shutdown kills and reaps actual Tesseract before resolving', async () => {
    let started;
    const ready = new Promise(resolve => { started = resolve; });
    const injection = injector({ onRecognition: child => child.once('spawn', started) });
    const service = createOcrService(injection);
    const pending = service.recognizeImage(IMAGE);
    const rejected = assert.rejects(pending, error => error.code === 'OCR_CANCELLED');
    await ready;
    await service.shutdown();
    await rejected;
    assert.equal(isAlive(injection.calls[0]), false);
    await assert.rejects(service.recognizeImage(IMAGE), error => error.code === 'OCR_CANCELLED');
    assert.equal(injection.calls.length, 1);
    return { processAliveAfterShutdown: false, laterRecognition: 'REJECTED' };
  });
  await check('concurrent actual recognition is rejected without a second native engine', async () => {
    let started;
    const ready = new Promise(resolve => { started = resolve; });
    const injection = injector({ onRecognition: child => child.once('spawn', started) });
    const service = createOcrService(injection);
    try {
      const pending = service.recognizeImage(IMAGE);
      await ready;
      await assert.rejects(service.recognizeImage(IMAGE), error => error.code === 'OCR_BUSY');
      assert.equal((await pending).candidates[0].partNumber, 'DEMO-1001');
      assert.equal(injection.calls.length, 1);
      return { nativeRecognitions: 1, concurrentRequest: 'REJECTED' };
    } finally { await service.shutdown(); }
  });
  await check('the normalizer receives the same native resource ceilings as the OCR engine', async () => {
    const code = [
      'import json, resource, sys', 'from PIL import __version__', 'sys.stdin.buffer.read()',
      `assert resource.getrlimit(resource.RLIMIT_AS) == (${LIMITS.nativeAddressSpaceBytes}, ${LIMITS.nativeAddressSpaceBytes})`,
      `assert resource.getrlimit(resource.RLIMIT_CPU) == (${LIMITS.nativeCpuSeconds}, ${LIMITS.nativeCpuSeconds})`,
      `assert resource.getrlimit(resource.RLIMIT_NOFILE) == (${LIMITS.nativeOpenFiles}, ${LIMITS.nativeOpenFiles})`,
      'assert resource.getrlimit(resource.RLIMIT_CORE) == (0, 0)', 'assert resource.getrlimit(resource.RLIMIT_FSIZE) == (0, 0)',
      'print(json.dumps({"method":"median3-small-text-v2","pillowVersion":__version__,"applied":False,"isolatedNoisePixels":0,"imagePixels":704000,"thresholdPixels":704,"inkBandCount":0,"medianInkBandHeight":0,"rescaleFactor":1}))',
    ].join('\n');
    const injection = injector({ code, stage: 'normalizer' });
    const service = createOcrService(injection);
    try {
      assert.equal((await service.recognizeImage(IMAGE)).candidates[0].partNumber, 'DEMO-1001');
      assert.equal(injection.calls.length, 1);
      assert.equal(isAlive(injection.calls[0]), false);
      return { addressSpaceBytes: LIMITS.nativeAddressSpaceBytes, cpuSeconds: LIMITS.nativeCpuSeconds, openFiles: LIMITS.nativeOpenFiles, coreBytes: 0, fileBytes: 0, processAliveAfterReturn: false };
    } finally { await service.shutdown(); }
  });
  await check('cancellation kills and reaps the actual pixel-normalization child', async () => {
    const controller = new AbortController();
    const injection = injector({ stage: 'normalizer', onRecognition: child => child.once('spawn', () => controller.abort()) });
    const service = createOcrService(injection);
    try {
      await assert.rejects(service.recognizeImage(IMAGE, { signal: controller.signal }), error => error.code === 'OCR_CANCELLED');
      assert.equal(injection.calls.length, 1);
      assert.equal(isAlive(injection.calls[0]), false);
      return { processAliveAfterReturn: false, nextEngineStageStarted: false };
    } finally { await service.shutdown(); }
  });
  if (!status.orientationAvailable) results.push({ test: 'cancellation during actual orientation fallback', status: 'BLOCKED', code: 'OSD_MODEL_UNAVAILABLE' });
  else await check('cancellation during actual orientation fallback reaps its native child', async () => {
    // Rotate only this checked-in synthetic fixture in memory. No customer image
    // or filesystem output is involved, and the fixed helper remains bounded.
    const rotated = spawnSync('/usr/bin/prlimit', [
      `--as=${LIMITS.nativeAddressSpaceBytes}:${LIMITS.nativeAddressSpaceBytes}`, '--cpu=2:2', '--fsize=0:0', '--core=0:0', '--nofile=64:64', '--',
      '/usr/bin/python3', '-I', '-B', '-c', 'import io,sys\nfrom PIL import Image\nim=Image.open(io.BytesIO(sys.stdin.buffer.read())).rotate(90,expand=True)\nim.save(sys.stdout.buffer,format="PNG")',
    ], { input: IMAGE, maxBuffer: LIMITS.imageBytes, timeout: 2000, env: { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8' } });
    assert.equal(rotated.status, 0);
    const controller = new AbortController();
    const injection = injector({ stage: 'orientation', onRecognition: child => child.once('spawn', () => controller.abort()) });
    const service = createOcrService(injection);
    try {
      await assert.rejects(service.recognizeImage(rotated.stdout, { signal: controller.signal }), error => error.code === 'OCR_CANCELLED');
      assert.equal(injection.calls.length, 1);
      assert.equal(isAlive(injection.calls[0]), false);
      return { orientationPassStarted: true, processAliveAfterReturn: false };
    } finally { await service.shutdown(); }
  });
  await check('pixel-only small-band detection enlarges both dark and inverted synthetic images', async () => {
    const observations = [];
    for (const inverted of [false, true]) observations.push(await verifyPixelNormalization({ width: 220, height: 120, bands: [10, 12, 11], inverted, scale: 2, median: 11 }));
    return { observations, scope: 'Actual normalizer and decoded pixel dimensions. The engine is a test adapter, not an OCR accuracy assertion.' };
  });
  await check('blank, isolated punctuation and larger ink bands do not trigger enlargement', async () => {
    const observations = [];
    for (const [bands, median] of [[[], 0], [[1, 2], 0], [[16, 18, 20], 18]]) observations.push(await verifyPixelNormalization({ width: 220, height: 160, bands, scale: 1, median }));
    return { observations };
  });
  await check('normalizer preserves the maximum image dimension when selecting enlargement', async () => {
    const observations = [];
    for (const [width, scale] of [[3000, 2], [3001, 1]]) observations.push(await verifyPixelNormalization({ width, height: 100, bands: [11, 11], scale, median: 11 }));
    return { observations, dimensionCeiling: LIMITS.imageDimension };
  });
  await check('normalizer preserves the maximum pixel count when selecting enlargement', async () => {
    const observations = [];
    for (const [width, scale] of [[2000, 2], [2001, 1]]) observations.push(await verifyPixelNormalization({ width, height: 2000, bands: [11, 11], scale, median: 11 }));
    return { observations, pixelCeiling: LIMITS.imagePixels };
  });
  const failures = results.filter(result => result.status === 'FAIL').length;
  const blocked = results.filter(result => result.status === 'BLOCKED').length;
  console.log(JSON.stringify({ status: failures ? 'FAIL' : blocked ? 'BLOCKED' : 'PASS', cases: results.length, failures, blocked, engine: status, results,
    scope: 'Local Linux process limits and lifecycle. Resource ceilings are not an OS security sandbox or a production hosting approval.' }, null, 2));
  if (failures || blocked) process.exitCode = failures ? 1 : 2;
}

main().catch(error => { console.error(JSON.stringify({ status: 'FAIL', code: error.code || 'NATIVE_TEST_FAILED' })); process.exitCode = 1; });
