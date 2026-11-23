'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { EventEmitter } = require('node:events');
const { PassThrough, Writable } = require('node:stream');
const { inspectImage, parseTsv, expandedImageSize, OcrError, LIMITS, createOcrService } = require('../workspace/ocr.cjs');

const fixture = name => fs.readFileSync(path.join(__dirname, 'fixtures/panels', name));
const ISOLATION_PRIVATE_DIR = path.join(__dirname, 'fixtures/panels');
const HEADER = 'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext';
function tsv(lines, confidence = 95) {
  return HEADER + '\n' + lines.flatMap((line, lineIndex) => line.split(' ').map((word, wordIndex) =>
    [5, 1, 1, 1, lineIndex + 1, wordIndex + 1, wordIndex * 20, lineIndex * 30, 20, 30, confidence, word].join('\t'))).join('\n') + '\n';
}
const GOOD_TSV = tsv(['PART NUMBER: DEMO-1234', 'MANUFACTURER: SAMPLE COMPONENTS', 'DESCRIPTION: SYNTHETIC LABEL']);

function crc(buffer) {
  let value = 0xFFFFFFFF;
  for (const byte of buffer) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xEDB88320 ^ (value >>> 1) : value >>> 1;
  }
  return (value ^ 0xFFFFFFFF) >>> 0;
}
function chunk(type, data = Buffer.alloc(0)) {
  const result = Buffer.alloc(data.length + 12);
  result.writeUInt32BE(data.length, 0);
  result.write(type, 4, 'ascii');
  data.copy(result, 8);
  result.writeUInt32BE(crc(result.subarray(4, -4)), result.length - 4);
  return result;
}
function tinyPng({ width = 1, height = 1, extra = [], depth = 8, colorType = 2 } = {}) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = depth;
  header[9] = colorType;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), ...extra, chunk('IDAT', zlib.deflateSync(Buffer.from([0, 255, 255, 255]))), chunk('IEND')]);
}

function flatDeskew(width, height) {
  return { candidateAngle: 0, angle: 0, scoreBefore: 0, scoreAfter: 0, analysisPixels: Math.min(width, 650) * Math.min(height, 650), width, height, reason: 'not_needed' };
}

function fakeSpawner({ recognize, normalize, normalizerProbe, probe, isolationProbe, isolationVersion = 'bubblewrap 0.12.0\n', version = 'tesseract 5.5.0\n', languages = 'List of available languages in private-path (1):\neng\n', spawnError, killDelay = 0 } = {}) {
  const calls = [];
  function spawnProcess(binary, args, options) {
    const processArgs = [...args];
    const isIsolationVersion = args.at(-2) === '/usr/bin/bwrap' && args.at(-1) === '--version';
    const isNormalizer = args.includes('/usr/bin/python3');
    args = isIsolationVersion ? ['--version'] : isNormalizer ? args.slice(args.indexOf('/usr/bin/python3') + 4) : args.slice(args.indexOf('/usr/bin/tesseract') + 1);
    const child = new EventEmitter();
    child.pid = spawnError ? undefined : 12345;
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    const call = { binary, args, processArgs, options, child, isNormalizer, isIsolationVersion, input: [], kills: [], closed: false };
    child.stdin = new Writable({ write(data, encoding, callback) { call.input.push(Buffer.from(data)); callback(); } });
    call.seccomp = [];
    child.stdio = [child.stdin, child.stdout, child.stderr];
    if (options.stdio.length === 4) child.stdio.push(new Writable({ write(data, encoding, callback) { call.seccomp.push(Buffer.from(data)); callback(); } }));
    call.finish = (output = '', code = 0) => {
      if (call.closed) return;
      call.closed = true;
      if (output) child.stdout.write(output);
      child.stdout.end();
      child.stderr.end();
      child.emit('close', code);
    };
    child.kill = signal => {
      call.kills.push(signal);
      setTimeout(() => call.finish('', null), killDelay);
      return true;
    };
    child.stdin.on('finish', () => queueMicrotask(() => {
      if (spawnError) return child.emit('error', Object.assign(new Error('PRIVATE PATH OR SECRET'), { code: spawnError }));
      if (isIsolationVersion) return isolationProbe ? isolationProbe(call) : call.finish(isolationVersion);
      if (isNormalizer) {
        if (args[0] === '--probe') return normalizerProbe ? normalizerProbe(call) : call.finish(JSON.stringify({ method: 'median3-deskew-small-text-v3', pillowVersion: '11.1.0' }));
        if (normalize) return normalize(call);
        const image = inspectImage(Buffer.concat(call.input));
        return call.finish(JSON.stringify({ method: 'median3-deskew-small-text-v3', pillowVersion: '11.1.0', applied: false,
          isolatedNoisePixels: 0, thresholdPixels: Math.max(32, Math.ceil(image.width * image.height / 1000)), imagePixels: image.width * image.height, inkBandCount: 0, medianInkBandHeight: 0, rescaleFactor: 1, deskew: flatDeskew(image.width, image.height) }) + '\n');
      }
      if (probe && args[0].startsWith('--')) return probe(call);
      if (args[0] === '--version') return call.finish(version);
      if (args[0] === '--list-langs') return call.finish(languages);
      if (recognize) recognize(call);
      else call.finish(GOOD_TSV);
    }));
    calls.push(call);
    return child;
  }
  return { spawnProcess, calls };
}

function isError(code, status) {
  return error => error instanceof OcrError && error.code === code && error.status === status && !error.message.includes('PRIVATE');
}

test('image inspection detects PNG and progressive JPEG bytes with bounded dimensions', () => {
  for (const [name, mime] of [['complete.png', 'image/png'], ['complete.jpg', 'image/jpeg']]) {
    const bytes = fixture(name);
    assert.deepEqual(inspectImage(bytes), { mime, width: 1600, height: 440, bytes: bytes.length });
  }
  assert.equal(inspectImage(tinyPng()).width, 1);
});

test('image inspection rejects paths, URLs, SVG, PDF, empty and unsupported bytes', () => {
  for (const input of ['/tmp/customer.png', 'https://example.invalid/image.png', 'data:image/png;base64,AAA', new Uint8Array([1]), null, Buffer.alloc(0), Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), Buffer.from('%PDF-1.7'), Buffer.from('GIF89a')]) {
    assert.throws(() => inspectImage(input), isError('IMAGE_INVALID', 400));
  }
});

test('image byte and pixel limits reject oversized uploads before recognition', () => {
  assert.throws(() => inspectImage(Buffer.alloc(LIMITS.imageBytes + 1)), isError('IMAGE_TOO_LARGE', 413));
  for (const [width, height] of [[6001, 1], [1, 6001], [4001, 4000]]) assert.throws(() => inspectImage(tinyPng({ width, height })), isError('IMAGE_DIMENSIONS', 413));
  assert.throws(() => inspectImage(tinyPng({ width: 0 })), isError('IMAGE_INVALID', 400));
});

test('PNG validation rejects corrupt CRCs, truncation, trailing bytes and missing image data', () => {
  const valid = tinyPng();
  const corrupt = Buffer.from(valid);
  corrupt[corrupt.length - 1] ^= 1;
  const noData = Buffer.concat([valid.subarray(0, 33), chunk('IEND')]);
  for (const bytes of [corrupt, valid.subarray(0, -1), valid.subarray(0, 30), Buffer.concat([valid, Buffer.from('hidden')]), noData]) assert.throws(() => inspectImage(bytes), isError('IMAGE_INVALID', 400));
});

test('PNG validation rejects animation, unsupported critical chunks, invalid palette and bit depth', () => {
  for (const bytes of [tinyPng({ extra: [chunk('acTL', Buffer.alloc(8))] }), tinyPng({ extra: [chunk('BADR')] }), tinyPng({ colorType: 3 }), tinyPng({ depth: 3 }), tinyPng({ extra: [chunk('PLTE', Buffer.alloc(4))] })]) assert.throws(() => inspectImage(bytes), isError('IMAGE_INVALID', 400));
});

test('JPEG validation rejects malformed framing, unsupported depth and appended content', () => {
  const original = fixture('complete.jpg');
  const marker = original.indexOf(Buffer.from([0xFF, 0xC2]));
  assert.ok(marker > 0);
  const depth = Buffer.from(original);
  depth[marker + 4] = 16;
  const width = Buffer.from(original);
  width.writeUInt16BE(6001, marker + 7);
  assert.throws(() => inspectImage(width), isError('IMAGE_DIMENSIONS', 413));
  for (const bytes of [original.subarray(0, -2), Buffer.concat([original, Buffer.from('x')]), depth, Buffer.from([0xFF, 0xD8, 0xFF, 0xE1, 0xFF, 0xFF, 0, 0, 0, 0, 0xFF, 0xD9])]) assert.throws(() => inspectImage(bytes), isError('IMAGE_INVALID', 400));
});

test('explicit OCR labels produce exact candidate text with per-field confidence', () => {
  const result = parseTsv(GOOD_TSV);
  assert.equal(result.rawText, 'PART NUMBER: DEMO-1234\nMANUFACTURER: SAMPLE COMPONENTS\nDESCRIPTION: SYNTHETIC LABEL');
  assert.deepEqual(result.candidates[0], { partNumber: 'DEMO-1234', manufacturer: 'SAMPLE COMPONENTS', description: 'SYNTHETIC LABEL', confidence: { partNumber: 95, manufacturer: 95, description: 95 }, reviewStatus: 'unreviewed', warnings: [] });
  assert.match(result.warnings[0], /Review every extracted field/);
});

test('missing labels stay blank and never infer a manufacturer from other words', () => {
  const result = parseTsv(tsv(['PART NUMBER: SAMPLE-42', 'DESCRIPTION: SAMPLE COMPONENTS TEST']));
  assert.equal(result.candidates[0].manufacturer, '');
  assert.equal(result.candidates[0].confidence.manufacturer, null);
  assert.match(result.candidates[0].warnings.join(' '), /No labelled manufacturer/);
});

test('unlabelled and empty output require manual entry without invented fields', () => {
  for (const text of [tsv(['DEMO-42', 'SAMPLE COMPONENTS', 'SYNTHETIC LABEL']), HEADER + '\n']) {
    const result = parseTsv(text);
    assert.deepEqual(result.candidates, []);
    assert.ok(result.warnings.length > 1);
  }
});

test('supported explicit label abbreviations are case insensitive', () => {
  const result = parseTsv(tsv(['P/N: abc-123', 'mfr.: example', 'Desc.: sample label']));
  assert.equal(result.candidates[0].partNumber, 'abc-123');
  assert.equal(result.candidates[0].manufacturer, 'example');
  assert.equal(result.candidates[0].description, 'sample label');
});

test('conflicting repeated fields are blanked instead of selecting a component', () => {
  const result = parseTsv(tsv(['PART NUMBER: FIRST-1', 'PART NUMBER: SECOND-2', 'MANUFACTURER: EXAMPLE']));
  assert.equal(result.candidates[0].partNumber, '');
  assert.equal(result.candidates[0].confidence.partNumber, null);
  assert.match(result.candidates[0].warnings.join(' '), /Ambiguous partNumber/);
  assert.match(result.rawText, /FIRST-1\nPART NUMBER: SECOND-2/);
});

test('repeated identical fields retain their text and require component confirmation', () => {
  const result = parseTsv(tsv(['PART NUMBER: DEMO-42', 'PART NUMBER: DEMO-42']));
  assert.equal(result.candidates[0].partNumber, 'DEMO-42');
  assert.match(result.candidates[0].warnings.join(' '), /Repeated partNumber/);
});

test('multiple labels on one line are treated as ambiguous', () => {
  const result = parseTsv(tsv(['PART NUMBER: DEMO-42 MANUFACTURER: EXAMPLE']));
  assert.equal(result.candidates[0].partNumber, '');
  assert.equal(result.candidates[0].manufacturer, '');
  assert.match(result.candidates[0].warnings.join(' '), /Ambiguous/);
});

test('overlong fields remain in raw text but are not silently truncated into candidates', () => {
  const result = parseTsv(tsv(['PART NUMBER: ' + 'A'.repeat(121)]));
  assert.equal(result.candidates[0].partNumber, '');
  assert.ok(result.rawText.endsWith('A'.repeat(121)));
});

test('low confidence and unavailable confidence never mark OCR values reviewed', () => {
  for (const confidence of [12.345, -1]) {
    const candidate = parseTsv(tsv(['PART NUMBER: DEMO-42'], confidence)).candidates[0];
    assert.equal(candidate.reviewStatus, 'unreviewed');
    assert.equal(candidate.confidence.partNumber, confidence === -1 ? null : 12.35);
    assert.match(candidate.warnings.join(' '), /Low or unavailable/);
  }
});

test('recognized HTML and spreadsheet expressions remain inert text for review', () => {
  const result = parseTsv(tsv(['PART NUMBER: =1+1', 'MANUFACTURER: <script>alert(1)</script>', 'DESCRIPTION: @SUM(A1:A2)']));
  assert.equal(result.candidates[0].partNumber, '=1+1');
  assert.equal(result.candidates[0].manufacturer, '<script>alert(1)</script>');
  assert.equal(result.candidates[0].description, '@SUM(A1:A2)');
  assert.equal(result.candidates[0].reviewStatus, 'unreviewed');
});

test('malformed TSV and confidence outside the engine scale are rejected', () => {
  for (const value of ['not tsv', HEADER + '\n1\t2', tsv(['PART NUMBER: TEST'], 101), tsv(['PART NUMBER: TEST'], -2), tsv(['PART NUMBER: BAD\u0000TEXT']), GOOD_TSV.replace('5\t1', '6\t1')]) assert.throws(() => parseTsv(value), isError('OCR_OUTPUT_INVALID', 422));
});

test('raw text and process-output bounds fail explicitly instead of discarding data silently', () => {
  assert.throws(() => parseTsv('a'.repeat(LIMITS.processOutputBytes + 1)), isError('OCR_OUTPUT_LIMIT', 422));
  assert.throws(() => parseTsv(tsv(['a'.repeat(LIMITS.rawTextCharacters + 1)])), isError('OCR_OUTPUT_LIMIT', 422));
});

test('readiness uses only fixed binary probes and caches a successful result', async () => {
  let clock = 1000;
  const fake = fakeSpawner();
  const service = createOcrService({ spawnProcess: fake.spawnProcess, now: () => clock });
  const [first, concurrent] = await Promise.all([service.getOcrStatus(), service.getOcrStatus()]);
  assert.deepEqual(first, { available: true, engine: 'tesseract', version: '5.5.0', language: 'eng', normalizer: { method: 'median3-deskew-small-text-v3', pillowVersion: '11.1.0' }, orientationAvailable: false });
  assert.deepEqual(first, concurrent);
  first.available = false;
  assert.equal((await service.getOcrStatus()).available, true);
  assert.equal(fake.calls.length, 3);
  clock += LIMITS.statusCacheMs + 1;
  assert.equal((await service.getOcrStatus()).available, true);
  assert.equal(fake.calls.length, 6);
  assert.deepEqual(fake.calls.map(call => call.args[0]), ['--version', '--list-langs', '--probe', '--version', '--list-langs', '--probe']);
});

test('expired readiness is rechecked before the next recognition', async () => {
  let clock = 1000;
  const fake = fakeSpawner();
  const service = createOcrService({ spawnProcess: fake.spawnProcess, now: () => clock });
  await service.recognizeImage(tinyPng());
  clock += LIMITS.statusCacheMs + 1;
  await service.recognizeImage(tinyPng());
  assert.equal(fake.calls.filter(call => call.args[0] === '--version').length, 2);
});

test('recognition uses shell-free stdin with fixed args and no inherited credentials', async () => {
  const fake = fakeSpawner();
  const service = createOcrService({ spawnProcess: fake.spawnProcess });
  const result = await service.recognizeImage(tinyPng());
  assert.equal(result.engine, 'tesseract');
  assert.equal(result.engineVersion, '5.5.0');
  assert.equal(result.candidates[0].reviewStatus, 'unreviewed');
  for (const call of fake.calls) {
    assert.equal(call.binary, '/usr/bin/prlimit');
    assert.deepEqual(call.processArgs.slice(0, 7), ['--as=1073741824:1073741824', '--cpu=10:10', '--core=0:0', '--fsize=0:0', '--nofile=64:64', '--', call.isNormalizer ? '/usr/bin/python3' : '/usr/bin/tesseract']);
    assert.equal(call.options.shell, false);
    assert.equal(call.options.cwd, '/');
    assert.deepEqual(Object.keys(call.options.env).sort(), ['LANG', 'LC_ALL', 'OMP_NUM_THREADS', 'OMP_THREAD_LIMIT', 'PATH']);
    assert.deepEqual(call.options.stdio, ['pipe', 'pipe', 'pipe']);
  }
  const call = fake.calls.at(-1);
  assert.deepEqual(call.args, ['stdin', 'stdout', '-l', 'eng', '--oem', '1', '--psm', '6', 'tsv']);
  assert.deepEqual(Buffer.concat(call.input), tinyPng());
});

test('PNG compressed metadata is not passed to the native decoder and source is unchanged', async () => {
  const bytes = tinyPng({ extra: [chunk('zTXt', Buffer.from('private metadata'))] });
  const original = Buffer.from(bytes);
  const fake = fakeSpawner();
  await createOcrService({ spawnProcess: fake.spawnProcess }).recognizeImage(bytes);
  const sent = Buffer.concat(fake.calls.at(-1).input);
  assert.equal(sent.includes(Buffer.from('private metadata')), false);
  assert.deepEqual(bytes, original);
  assert.equal(inspectImage(sent).mime, 'image/png');
});

test('recognition snapshots validated source bytes before asynchronous readiness', async () => {
  const bytes = tinyPng(), expected = Buffer.from(bytes);
  const fake = fakeSpawner();
  const pending = createOcrService({ spawnProcess: fake.spawnProcess }).recognizeImage(bytes);
  bytes.fill(0);
  await pending;
  assert.deepEqual(Buffer.concat(fake.calls.at(-1).input), expected);
});

test('invalid files fail before any process starts', async () => {
  const fake = fakeSpawner();
  await assert.rejects(createOcrService({ spawnProcess: fake.spawnProcess }).recognizeImage(Buffer.from('https://example.invalid')), isError('IMAGE_INVALID', 400));
  assert.equal(fake.calls.length, 0);
});

test('missing engine is reported unavailable without leaking private process errors', async () => {
  const fake = fakeSpawner({ spawnError: 'ENOENT' });
  const service = createOcrService({ spawnProcess: fake.spawnProcess });
  assert.deepEqual(await service.getOcrStatus(), { available: false, engine: 'tesseract', version: null, language: 'eng', reason: 'engine_unavailable' });
  await assert.rejects(service.recognizeImage(tinyPng()), isError('OCR_UNAVAILABLE', 503));
  assert.equal(fake.calls.length, 1);
});

test('missing English data and unsupported engines keep manual review available', async () => {
  for (const [options, reason] of [[{ languages: 'osd\n' }, 'language_unavailable'], [{ version: 'tesseract 4.1.0\n' }, 'engine_unsupported'], [{ version: 'PRIVATE INVALID OUTPUT\n' }, 'engine_unsupported']]) {
    const fake = fakeSpawner(options);
    const service = createOcrService({ spawnProcess: fake.spawnProcess });
    assert.equal((await service.getOcrStatus()).reason, reason);
    await assert.rejects(service.recognizeImage(tinyPng()), isError('OCR_UNAVAILABLE', 503));
  }
});

test('readiness output is bounded and process details remain private', async () => {
  const fake = fakeSpawner({ version: 'PRIVATE'.repeat(3000) });
  const status = await createOcrService({ spawnProcess: fake.spawnProcess }).getOcrStatus();
  assert.equal(status.available, false);
  assert.equal(status.reason, 'engine_check_failed');
  assert.equal(JSON.stringify(status).includes('PRIVATE'), false);
  assert.deepEqual(fake.calls[0].kills, ['SIGKILL']);
});

test('readiness probes time out, reap the child and return a bounded unavailable state', async () => {
  const fake = fakeSpawner({ probe: () => {} });
  const status = await createOcrService({ spawnProcess: fake.spawnProcess, statusTimeoutMs: 10 }).getOcrStatus();
  assert.equal(status.available, false);
  assert.equal(status.reason, 'engine_check_failed');
  assert.deepEqual(fake.calls[0].kills, ['SIGKILL']);
  assert.equal(fake.calls[0].closed, true);
});

test('synchronous process launch errors return no implementation or credential details', async () => {
  const service = createOcrService({ spawnProcess: () => { throw new Error('PRIVATE launch error'); } });
  const status = await service.getOcrStatus();
  assert.equal(status.available, false);
  assert.equal(status.reason, 'engine_check_failed');
  assert.equal(JSON.stringify(status).includes('PRIVATE'), false);
});

test('nonzero recognition exits give generic failures and permit a later retry', async () => {
  let attempts = 0;
  const fake = fakeSpawner({ recognize: call => { attempts += 1; if (attempts === 1) { call.child.stderr.write('PRIVATE PATH / customer secret'); call.finish('', 1); } else call.finish(GOOD_TSV); } });
  const service = createOcrService({ spawnProcess: fake.spawnProcess });
  await assert.rejects(service.recognizeImage(tinyPng()), isError('OCR_FAILED', 422));
  assert.equal((await service.recognizeImage(tinyPng())).candidates.length, 1);
});

test('invalid UTF-8 and malformed engine output are rejected without exposing output', async () => {
  for (const output of [Buffer.from([0xFF]), 'PRIVATE invalid TSV']) {
    const fake = fakeSpawner({ recognize: call => call.finish(output) });
    await assert.rejects(createOcrService({ spawnProcess: fake.spawnProcess }).recognizeImage(tinyPng()), isError('OCR_OUTPUT_INVALID', 422));
  }
});

test('stdout and stderr share one output cap and overflow kills the child', async () => {
  for (const stream of ['stdout', 'stderr']) {
    const fake = fakeSpawner({ recognize: call => call.child[stream].write(Buffer.alloc(LIMITS.processOutputBytes + 1, 65)) });
    await assert.rejects(createOcrService({ spawnProcess: fake.spawnProcess }).recognizeImage(tinyPng()), isError('OCR_OUTPUT_LIMIT', 422));
    assert.deepEqual(fake.calls.at(-1).kills, ['SIGKILL']);
    assert.equal(fake.calls.at(-1).closed, true);
  }
});

test('recognition timeout kills and reaps the process before a retry', async () => {
  let attempts = 0;
  const fake = fakeSpawner({ recognize: call => { attempts += 1; if (attempts > 1) call.finish(GOOD_TSV); } });
  const service = createOcrService({ spawnProcess: fake.spawnProcess, recognitionTimeoutMs: 10 });
  await assert.rejects(service.recognizeImage(tinyPng()), isError('OCR_TIMEOUT', 504));
  assert.deepEqual(fake.calls.at(-1).kills, ['SIGKILL']);
  assert.equal(fake.calls.at(-1).closed, true);
  assert.equal((await service.recognizeImage(tinyPng())).candidates.length, 1);
});

test('already-cancelled recognition starts no child', async () => {
  const fake = fakeSpawner();
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(createOcrService({ spawnProcess: fake.spawnProcess }).recognizeImage(tinyPng(), { signal: controller.signal }), isError('OCR_CANCELLED', 499));
  assert.equal(fake.calls.length, 0);
});

test('cancellation kills the child and keeps the OCR slot occupied until it closes', async () => {
  let started;
  const ready = new Promise(resolve => { started = resolve; });
  const fake = fakeSpawner({ recognize: () => started(), killDelay: 20 });
  const service = createOcrService({ spawnProcess: fake.spawnProcess });
  const controller = new AbortController();
  const pending = service.recognizeImage(tinyPng(), { signal: controller.signal });
  await ready;
  controller.abort();
  await assert.rejects(service.recognizeImage(tinyPng()), isError('OCR_BUSY', 429));
  await assert.rejects(pending, isError('OCR_CANCELLED', 499));
  assert.deepEqual(fake.calls.at(-1).kills, ['SIGKILL']);
  assert.equal(fake.calls.at(-1).closed, true);
});

test('concurrent recognition is rejected without spawning a second OCR process', async () => {
  const fake = fakeSpawner();
  const service = createOcrService({ spawnProcess: fake.spawnProcess });
  const first = service.recognizeImage(tinyPng());
  await assert.rejects(service.recognizeImage(tinyPng()), isError('OCR_BUSY', 429));
  await first;
  assert.equal(fake.calls.filter(call => call.args[0] === 'stdin').length, 1);
});

test('stream failures terminate the recognition child without returning stream error details', async () => {
  const fake = fakeSpawner({ recognize: call => call.child.stdin.emit('error', new Error('PRIVATE stream error')) });
  await assert.rejects(createOcrService({ spawnProcess: fake.spawnProcess }).recognizeImage(tinyPng()), isError('OCR_FAILED', 422));
  assert.equal(fake.calls.at(-1).closed, true);
});

test('production bounds cannot be relaxed through the injected service options', () => {
  assert.throws(() => createOcrService({ recognitionTimeoutMs: LIMITS.recognitionTimeoutMs + 1 }), /Invalid local OCR service options/);
  assert.throws(() => createOcrService({ statusTimeoutMs: 0 }), /Invalid local OCR service options/);
});

test('multiple conflicting component fields cannot borrow a remaining field from another component', () => {
  const result = parseTsv(tsv(['PART NUMBER: FIRST-1', 'MANUFACTURER: FIRST MAKER', 'DESCRIPTION: FIRST LABEL', 'PART NUMBER: SECOND-2', 'MANUFACTURER: SECOND MAKER']));
  assert.deepEqual(Object.fromEntries(['partNumber', 'manufacturer', 'description'].map(key => [key, result.candidates[0][key]])), { partNumber: '', manufacturer: '', description: '' });
  assert.match(result.rawText, /FIRST LABEL/);
  assert.equal(result.candidates[0].reviewStatus, 'unreviewed');
});

test('bullet-prefixed labelled conflicts remain unknown without correcting OCR field characters', () => {
  const result = parseTsv(tsv(['PART NUMBER: SAMPLE-2042 |', 'MANUFACTURER: INVENTED ZETALAB)', '-MANUFACTURER: FICTIONAL COMPONENTS', 'DESCRIPTION: SYNTHETIC LABEL ALPHA']));
  assert.equal(result.candidates[0].manufacturer, '');
  assert.equal(result.candidates[0].partNumber, 'SAMPLE-2042 |');
  assert.match(result.rawText, /-MANUFACTURER/);
  assert.match(result.candidates[0].warnings.join(' '), /Ambiguous manufacturer/);
  assert.deepEqual(parseTsv(tsv(['UNKNOWN MANUFACTURER: FICTIONAL COMPONENTS'])).candidates, []);
  assert.equal(parseTsv(tsv(['• PART NUMBER: TEST-1'])).candidates[0].partNumber, 'TEST-1');
});

test('shutdown cancels recognition and awaits native close before resolving', async () => {
  let started;
  const ready = new Promise(resolve => { started = resolve; });
  const fake = fakeSpawner({ recognize: () => started(), killDelay: 20 });
  const service = createOcrService({ spawnProcess: fake.spawnProcess });
  const pending = service.recognizeImage(tinyPng());
  const rejected = assert.rejects(pending, isError('OCR_CANCELLED', 499));
  await ready;
  const firstShutdown = service.shutdown();
  assert.equal(service.shutdown(), firstShutdown);
  assert.equal(fake.calls.at(-1).closed, false);
  await firstShutdown;
  assert.equal(fake.calls.at(-1).closed, true);
  assert.deepEqual(fake.calls.at(-1).kills, ['SIGKILL']);
  await rejected;
  await assert.rejects(service.recognizeImage(tinyPng()), isError('OCR_CANCELLED', 499));
});

test('shutdown during readiness prevents a recognition process from starting', async () => {
  let started;
  const ready = new Promise(resolve => { started = resolve; });
  const fake = fakeSpawner({ probe: () => started(), killDelay: 10 });
  const service = createOcrService({ spawnProcess: fake.spawnProcess });
  const pending = service.recognizeImage(tinyPng());
  const rejected = assert.rejects(pending, isError('OCR_CANCELLED', 499));
  await ready;
  await service.shutdown();
  await rejected;
  assert.equal(fake.calls.length, 1);
  assert.equal(fake.calls[0].closed, true);
  assert.equal((await service.getOcrStatus()).reason, 'service_shutdown');
});

test('shutting down an idle service starts no process and invalidates cached readiness', async () => {
  const fake = fakeSpawner();
  const service = createOcrService({ spawnProcess: fake.spawnProcess });
  await service.getOcrStatus();
  const count = fake.calls.length;
  await service.shutdown();
  assert.deepEqual(await service.getOcrStatus(), { available: false, engine: 'tesseract', version: null, language: 'eng', reason: 'service_shutdown' });
  assert.equal(fake.calls.length, count);
});

test('missing resource limiter never falls back to an unbounded engine', async () => {
  const fake = fakeSpawner({ spawnError: 'ENOENT' });
  const service = createOcrService({ spawnProcess: fake.spawnProcess });
  assert.equal((await service.getOcrStatus()).available, false);
  await assert.rejects(service.recognizeImage(tinyPng()), isError('OCR_UNAVAILABLE', 503));
  assert.ok(fake.calls.every(call => call.binary === '/usr/bin/prlimit'));
  await service.shutdown();
});

test('unexpected native crash releases the slot only after close and permits retry', async () => {
  let calls = 0;
  const fake = fakeSpawner({ recognize: call => {
    calls += 1;
    if (calls === 1) { call.closed = true; call.child.emit('close', null, 'SIGSEGV'); }
    else call.finish(GOOD_TSV);
  } });
  const service = createOcrService({ spawnProcess: fake.spawnProcess });
  await assert.rejects(service.recognizeImage(tinyPng()), isError('OCR_FAILED', 422));
  assert.equal((await service.recognizeImage(tinyPng())).candidates[0].partNumber, 'DEMO-1234');
  await service.shutdown();
});

test('orientation fallback uses a second fixed pass only after unlabelled text and preserves source bytes', async () => {
  const bytes = tinyPng(), original = Buffer.from(bytes);
  const fake = fakeSpawner({ languages: 'eng\nosd\n', recognize: call => call.finish(call.args.includes('6') ? tsv(['ROTATED TEXT']) : tsv(['PART NUMBER: O0-I1', 'DESCRIPTION: SOURCE LABEL'])) });
  const service = createOcrService({ spawnProcess: fake.spawnProcess });
  const result = await service.recognizeImage(bytes);
  assert.equal(result.processing.passes, 2);
  assert.equal(result.processing.orientationFallbackUsed, true);
  assert.equal(result.candidates[0].partNumber, 'O0-I1');
  assert.equal(result.candidates[0].manufacturer, '');
  assert.equal(result.candidates[0].reviewStatus, 'unreviewed');
  assert.match(result.warnings.join(' '), /orientation fallback/);
  assert.deepEqual(fake.calls.at(-1).args, ['stdin', 'stdout', '-l', 'eng', '--oem', '1', '--psm', '1', 'tsv']);
  assert.deepEqual(Buffer.concat(fake.calls.at(-1).input), original);
  assert.deepEqual(bytes, original);
  await service.shutdown();
});

test('orientation never replaces an existing partial or ambiguous candidate', async () => {
  for (const lines of [['PART NUMBER: O0-11'], ['PART NUMBER: A', 'PART NUMBER: B', 'MANUFACTURER: C', 'MANUFACTURER: D']]) {
    const fake = fakeSpawner({ languages: 'eng\nosd\n', recognize: call => call.finish(tsv(lines)) });
    const service = createOcrService({ spawnProcess: fake.spawnProcess });
    const result = await service.recognizeImage(tinyPng());
    assert.equal(result.processing.passes, 1);
  assert.equal(result.processing.orientationFallbackUsed, false);
    assert.equal(fake.calls.filter(call => call.args[0] === 'stdin').length, 1);
    assert.equal(result.candidates[0].reviewStatus, 'unreviewed');
    await service.shutdown();
  }
});

test('orientation fallback is unavailable without OSD and is unnecessary for blank text', async () => {
  for (const options of [{ languages: 'eng\n', text: tsv(['UNLABELLED TEXT']) }, { languages: 'eng\nosd\n', text: HEADER + '\n' }]) {
    const fake = fakeSpawner({ languages: options.languages, recognize: call => call.finish(options.text) });
    const service = createOcrService({ spawnProcess: fake.spawnProcess });
    const result = await service.recognizeImage(tinyPng());
    assert.equal(result.processing.passes, 1);
  assert.equal(result.processing.orientationFallbackUsed, false);
    assert.deepEqual(result.candidates, []);
    await service.shutdown();
  }
});

test('unsuccessful orientation preserves the original unlabelled text for manual entry', async () => {
  const fake = fakeSpawner({ languages: 'eng\nosd\n', recognize: call => call.finish(tsv([call.args.includes('6') ? 'FIRST READING' : 'OTHER READING'])) });
  const service = createOcrService({ spawnProcess: fake.spawnProcess });
  const result = await service.recognizeImage(tinyPng());
  assert.equal(result.rawText, 'FIRST READING');
  assert.deepEqual(result.candidates, []);
  assert.equal(result.processing.passes, 2);
  assert.equal(result.processing.orientationFallbackUsed, false);
  await service.shutdown();
});

test('recognition passes share one text output limit including discarded stderr', async () => {
  const fake = fakeSpawner({ languages: 'eng\nosd\n', recognize: call => {
    call.child.stderr.write(Buffer.alloc(300 * 1024, 65));
    call.finish(tsv(['UNLABELLED']));
  } });
  const service = createOcrService({ spawnProcess: fake.spawnProcess });
  await assert.rejects(service.recognizeImage(tinyPng()), isError('OCR_OUTPUT_LIMIT', 422));
  assert.deepEqual(fake.calls.at(-1).kills, ['SIGKILL']);
  assert.equal(fake.calls.at(-1).closed, true);
  await service.shutdown();
});

test('second pass cannot obtain a new recognition wall deadline', async () => {
  let clock = 0;
  const fake = fakeSpawner({ languages: 'eng\nosd\n', recognize: call => {
    clock += 20;
    call.finish(tsv(['UNLABELLED']));
  } });
  const service = createOcrService({ spawnProcess: fake.spawnProcess, now: () => clock, recognitionTimeoutMs: 20 });
  await assert.rejects(service.recognizeImage(tinyPng()), isError('OCR_TIMEOUT', 504));
  assert.equal(fake.calls.filter(call => call.args[0] === 'stdin').length, 1);
  await service.shutdown();
});

test('cancellation during orientation retains the slot and reaps the second process', async () => {
  let started;
  const ready = new Promise(resolve => { started = resolve; });
  const fake = fakeSpawner({ languages: 'eng\nosd\n', killDelay: 20, recognize: call => {
    if (call.args.includes('6')) call.finish(tsv(['UNLABELLED']));
    else started();
  } });
  const service = createOcrService({ spawnProcess: fake.spawnProcess });
  const controller = new AbortController();
  const pending = service.recognizeImage(tinyPng(), { signal: controller.signal });
  const rejected = assert.rejects(pending, isError('OCR_CANCELLED', 499));
  await ready;
  controller.abort();
  await assert.rejects(service.recognizeImage(tinyPng()), isError('OCR_BUSY', 429));
  await rejected;
  assert.equal(fake.calls.at(-1).closed, true);
  assert.deepEqual(fake.calls.at(-1).kills, ['SIGKILL']);
  await service.shutdown();
});

test('failed orientation returns a generic failure instead of claiming recovered fields', async () => {
  const fake = fakeSpawner({ languages: 'eng\nosd\n', recognize: call => {
    if (call.args.includes('6')) call.finish(tsv(['UNLABELLED']));
    else { call.child.stderr.write('PRIVATE worker failure'); call.finish('', 1); }
  } });
  const service = createOcrService({ spawnProcess: fake.spawnProcess });
  await assert.rejects(service.recognizeImage(tinyPng()), isError('OCR_FAILED', 422));
  await service.shutdown();
});

test('missing or unsupported pixel normalizer fails readiness without unnormalized OCR fallback', async () => {
  for (const output of ['', 'PRIVATE invalid JSON', '{"method":"unknown","pillowVersion":"11.1.0"}']) {
    const fake = fakeSpawner({ normalizerProbe: call => call.finish(output, output ? 0 : 1) });
    const service = createOcrService({ spawnProcess: fake.spawnProcess });
    const status = await service.getOcrStatus();
    assert.equal(status.available, false);
    assert.equal(status.reason, 'normalizer_unavailable');
    await assert.rejects(service.recognizeImage(tinyPng()), isError('OCR_UNAVAILABLE', 503));
    assert.equal(fake.calls.some(call => call.args[0] === 'stdin'), false);
    assert.equal(JSON.stringify(status).includes('PRIVATE'), false);
    await service.shutdown();
  }
});

test('normalizer uses only the fixed installed interpreter and fixed isolated script', async () => {
  const fake = fakeSpawner();
  const service = createOcrService({ spawnProcess: fake.spawnProcess });
  const result = await service.recognizeImage(tinyPng());
  const normalizerCalls = fake.calls.filter(call => call.isNormalizer);
  assert.equal(normalizerCalls.length, 2);
  for (const call of normalizerCalls) {
    assert.deepEqual(call.processArgs.slice(6, 10), ['/usr/bin/python3', '-I', '-B', path.join(__dirname, '../workspace/ocr-preprocess.py')]);
    assert.equal(call.options.shell, false);
    assert.equal(call.options.cwd, '/');
  }
  assert.equal(result.processing.normalization.applied, false);
  assert.equal(result.processing.normalization.isolatedNoisePixels, 0);
  assert.deepEqual(Buffer.concat(fake.calls.at(-1).input), tinyPng());
  await service.shutdown();
});

test('conditional normalization sends bounded pixel output to OCR and never changes source bytes', async () => {
  const source = tinyPng({ width: 200, height: 200, extra: [chunk('tEXt', Buffer.from('source metadata'))] });
  const original = Buffer.from(source), normalized = tinyPng({ width: 200, height: 200 });
  const header = { method: 'median3-deskew-small-text-v3', pillowVersion: '11.1.0', applied: true, isolatedNoisePixels: 50, thresholdPixels: 40, imagePixels: 40000, inkBandCount: 0, medianInkBandHeight: 0, rescaleFactor: 1, deskew: flatDeskew(200, 200) };
  const fake = fakeSpawner({ normalize: call => call.finish(Buffer.concat([Buffer.from(JSON.stringify(header) + '\n'), normalized])) });
  const service = createOcrService({ spawnProcess: fake.spawnProcess });
  const result = await service.recognizeImage(source);
  assert.deepEqual(result.processing.normalization, header);
  assert.deepEqual(Buffer.concat(fake.calls.at(-1).input), normalized);
  assert.equal(Buffer.concat(fake.calls.find(call => call.isNormalizer && !call.args.length).input).includes(Buffer.from('source metadata')), false);
  assert.deepEqual(source, original);
  assert.equal(result.candidates[0].reviewStatus, 'unreviewed');
  await service.shutdown();
});

test('small ink bands select one bounded pixel enlargement without changing source bytes or review status', async () => {
  const source = tinyPng({ width: 200, height: 100 });
  const original = Buffer.from(source), enlarged = tinyPng({ width: 400, height: 200 });
  const header = { method: 'median3-deskew-small-text-v3', pillowVersion: '11.1.0', applied: false,
    isolatedNoisePixels: 0, thresholdPixels: 32, imagePixels: 20000, inkBandCount: 3, medianInkBandHeight: 11, rescaleFactor: 2, deskew: flatDeskew(200, 100) };
  const fake = fakeSpawner({ normalize: call => call.finish(Buffer.concat([Buffer.from(JSON.stringify(header) + '\n'), enlarged])) });
  const service = createOcrService({ spawnProcess: fake.spawnProcess });
  const result = await service.recognizeImage(source);
  assert.deepEqual(result.processing.normalization, header);
  assert.deepEqual(Buffer.concat(fake.calls.at(-1).input), enlarged);
  assert.deepEqual(source, original);
  assert.equal(result.processing.passes, 1);
  assert.equal(result.candidates[0].reviewStatus, 'unreviewed');
  assert.match(result.warnings.join(' '), /Small text was enlarged/);
  await service.shutdown();
});

test('enlargement never repairs recognized punctuation, case or confusable characters', async () => {
  const header = { method: 'median3-deskew-small-text-v3', pillowVersion: '11.1.0', applied: false,
    isolatedNoisePixels: 0, thresholdPixels: 32, imagePixels: 20000, inkBandCount: 3, medianInkBandHeight: 11, rescaleFactor: 2, deskew: flatDeskew(200, 100) };
  const fake = fakeSpawner({ normalize: call => call.finish(Buffer.concat([Buffer.from(JSON.stringify(header) + '\n'), tinyPng({ width: 400, height: 200 })])),
    recognize: call => call.finish(tsv(['PART NUMBER: 00-I1_o.7', 'MANUFACTURER: Test Maker.', 'DESCRIPTION: Mixed CASE'])) });
  const service = createOcrService({ spawnProcess: fake.spawnProcess });
  const result = await service.recognizeImage(tinyPng({ width: 200, height: 100 }));
  assert.equal(result.candidates[0].partNumber, '00-I1_o.7');
  assert.equal(result.candidates[0].manufacturer, 'Test Maker.');
  assert.equal(result.candidates[0].description, 'Mixed CASE');
  assert.match(result.rawText, /00-I1_o\.7/);
  await service.shutdown();
});

test('small-text enlargement metadata must agree with measured bands and output dimensions', async () => {
  const header = { method: 'median3-deskew-small-text-v3', pillowVersion: '11.1.0', applied: false,
    isolatedNoisePixels: 0, thresholdPixels: 32, imagePixels: 20000, inkBandCount: 3, medianInkBandHeight: 11, rescaleFactor: 2, deskew: flatDeskew(200, 100) };
  const invalid = [
    { inkBandCount: -1 }, { inkBandCount: 101 }, { inkBandCount: 0 }, { medianInkBandHeight: 0 },
    { medianInkBandHeight: 2 }, { medianInkBandHeight: 16 }, { medianInkBandHeight: 11.5 },
    { medianInkBandHeight: 101 }, { rescaleFactor: 1 }, { rescaleFactor: 3 },
  ];
  for (const change of invalid) {
    const fake = fakeSpawner({ normalize: call => call.finish(Buffer.concat([Buffer.from(JSON.stringify({ ...header, ...change }) + '\n'), tinyPng({ width: 400, height: 200 })])) });
    const service = createOcrService({ spawnProcess: fake.spawnProcess });
    await assert.rejects(service.recognizeImage(tinyPng({ width: 200, height: 100 })), isError('OCR_OUTPUT_INVALID', 422));
    assert.equal(fake.calls.some(call => call.args[0] === 'stdin'), false);
    await service.shutdown();
  }
  const fake = fakeSpawner({ normalize: call => call.finish(Buffer.concat([Buffer.from(JSON.stringify(header) + '\n'), tinyPng({ width: 200, height: 100 })])) });
  const service = createOcrService({ spawnProcess: fake.spawnProcess });
  await assert.rejects(service.recognizeImage(tinyPng({ width: 200, height: 100 })), isError('OCR_OUTPUT_INVALID', 422));
  await service.shutdown();
});

test('small-text enlargement cannot exceed the native image dimensions or pixel ceiling', async () => {
  for (const [width, height] of [[3001, 100], [100, 3001], [2001, 2000]]) {
    const source = tinyPng({ width, height });
    const base = { method: 'median3-deskew-small-text-v3', pillowVersion: '11.1.0', applied: false,
      isolatedNoisePixels: 0, thresholdPixels: Math.max(32, Math.ceil(width * height / 1000)), imagePixels: width * height,
      inkBandCount: 3, medianInkBandHeight: 11, rescaleFactor: 1, deskew: flatDeskew(width, height) };
    const valid = fakeSpawner({ normalize: call => call.finish(JSON.stringify(base) + '\n') });
    const service = createOcrService({ spawnProcess: valid.spawnProcess });
    assert.equal((await service.recognizeImage(source)).processing.normalization.rescaleFactor, 1);
    assert.deepEqual(Buffer.concat(valid.calls.at(-1).input), source);
    await service.shutdown();
    const invalid = fakeSpawner({ normalize: call => call.finish(JSON.stringify({ ...base, rescaleFactor: 2 }) + '\n') });
    const rejected = createOcrService({ spawnProcess: invalid.spawnProcess });
    await assert.rejects(rejected.recognizeImage(source), isError('OCR_OUTPUT_INVALID', 422));
    assert.equal(invalid.calls.some(call => call.args[0] === 'stdin'), false);
    await rejected.shutdown();
  }
});

test('rotation bounds match independently measured native corner expansion for odd, even and thin images', () => {
  // Expected dimensions were read from native Pillow expand=True results.
  for (const [width, height, angle, expectedWidth, expectedHeight] of [
    [200, 100, 3, 206, 112], [200, 100, -3, 206, 112], [201, 101, .25, 203, 103], [201, 101, -.25, 203, 103],
    [1, 1, 5, 3, 3], [6000, 10, 3, 5994, 326], [4000, 4000, 3, 4204, 4204], [320, 200, 1, 324, 206], [320, 200, -5, 338, 228], [40, 250, 2.5, 52, 252],
  ]) assert.deepEqual(expandedImageSize(width, height, angle), { width: expectedWidth, height: expectedHeight });
});

test('deskew uses the validated expanded image once and preserves original pixels and manual review', async () => {
  const source = tinyPng({ width: 200, height: 100 }), original = Buffer.from(source), normalized = tinyPng({ width: 206, height: 112 });
  const header = { method: 'median3-deskew-small-text-v3', pillowVersion: '11.1.0', applied: false,
    isolatedNoisePixels: 0, thresholdPixels: 32, imagePixels: 20000, inkBandCount: 3, medianInkBandHeight: 20, rescaleFactor: 1,
    deskew: { candidateAngle: 3, angle: 3, scoreBefore: 1000, scoreAfter: 1200, analysisPixels: 20000, width: 206, height: 112, reason: 'applied' } };
  const fake = fakeSpawner({ normalize: call => call.finish(Buffer.concat([Buffer.from(JSON.stringify(header) + '\n'), normalized])) });
  const service = createOcrService({ spawnProcess: fake.spawnProcess });
  const result = await service.recognizeImage(source);
  assert.deepEqual(result.processing.normalization, header);
  assert.deepEqual(Buffer.concat(fake.calls.at(-1).input), normalized);
  assert.deepEqual(source, original);
  assert.equal(result.processing.passes, 1);
  assert.equal(result.candidates[0].reviewStatus, 'unreviewed');
  assert.match(result.warnings.join(' '), /Tilt was corrected/);
  await service.shutdown();
});

test('small-text enlargement checks the deskewed dimensions and preserves both transformations', async () => {
  const source = tinyPng({ width: 200, height: 100 }), normalized = tinyPng({ width: 412, height: 224 });
  const header = { method: 'median3-deskew-small-text-v3', pillowVersion: '11.1.0', applied: false,
    isolatedNoisePixels: 0, thresholdPixels: 32, imagePixels: 20000, inkBandCount: 3, medianInkBandHeight: 11, rescaleFactor: 2,
    deskew: { candidateAngle: -3, angle: -3, scoreBefore: 1000, scoreAfter: 1200, analysisPixels: 20000, width: 206, height: 112, reason: 'applied' } };
  const fake = fakeSpawner({ normalize: call => call.finish(Buffer.concat([Buffer.from(JSON.stringify(header) + '\n'), normalized])) });
  const service = createOcrService({ spawnProcess: fake.spawnProcess });
  const result = await service.recognizeImage(source);
  assert.deepEqual(Buffer.concat(fake.calls.at(-1).input), normalized);
  assert.equal(result.processing.normalization.rescaleFactor, 2);
  assert.equal(result.processing.normalization.deskew.angle, -3);
  assert.match(result.warnings.join(' '), /Small text was enlarged/);
  await service.shutdown();
});

test('unsafe, inconsistent or unbounded deskew metadata fails before native recognition', async () => {
  const base = { method: 'median3-deskew-small-text-v3', pillowVersion: '11.1.0', applied: false,
    isolatedNoisePixels: 0, thresholdPixels: 32, imagePixels: 20000, inkBandCount: 3, medianInkBandHeight: 20, rescaleFactor: 1,
    deskew: { candidateAngle: 3, angle: 3, scoreBefore: 1000, scoreAfter: 1200, analysisPixels: 20000, width: 206, height: 112, reason: 'applied' } };
  const invalid = [
    null, [], false, '3', { angle: 6 }, { candidateAngle: -6 }, { angle: .1 }, { candidateAngle: '3' },
    { scoreBefore: -1 }, { scoreAfter: 1000000001 }, { scoreBefore: 0 }, { scoreAfter: 1099 },
    { analysisPixels: 0 }, { analysisPixels: 20001 }, { width: 200 }, { height: 100 }, { reason: 'not_needed' },
  ];
  for (const change of invalid) {
    const deskew = change && typeof change === 'object' && !Array.isArray(change) ? { ...base.deskew, ...change } : change;
    const fake = fakeSpawner({ normalize: call => call.finish(Buffer.concat([Buffer.from(JSON.stringify({ ...base, deskew }) + '\n'), tinyPng({ width: 206, height: 112 })])) });
    const service = createOcrService({ spawnProcess: fake.spawnProcess });
    await assert.rejects(service.recognizeImage(tinyPng({ width: 200, height: 100 })), isError('OCR_OUTPUT_INVALID', 422));
    assert.equal(fake.calls.some(call => call.args[0] === 'stdin'), false);
    await service.shutdown();
  }
});

test('deskew that would exceed a dimension or pixel ceiling retains the original image', async () => {
  for (const [width, height, reason] of [[6000, 1500, 'dimension_limit'], [4000, 4000, 'pixel_limit']]) {
    const source = tinyPng({ width, height });
    const base = { method: 'median3-deskew-small-text-v3', pillowVersion: '11.1.0', applied: false,
      isolatedNoisePixels: 0, thresholdPixels: Math.ceil(width * height / 1000), imagePixels: width * height, inkBandCount: 3, medianInkBandHeight: 20, rescaleFactor: 1,
      deskew: { candidateAngle: 3, angle: 0, scoreBefore: 1000, scoreAfter: 1200, analysisPixels: 650 * 650, width, height, reason } };
    const fake = fakeSpawner({ normalize: call => call.finish(JSON.stringify(base) + '\n') });
    const service = createOcrService({ spawnProcess: fake.spawnProcess });
    assert.equal((await service.recognizeImage(source)).processing.normalization.deskew.reason, reason);
    assert.deepEqual(Buffer.concat(fake.calls.at(-1).input), source);
    await service.shutdown();
    const bad = fakeSpawner({ normalize: call => call.finish(JSON.stringify({ ...base, deskew: { ...base.deskew, angle: 3, reason: 'applied' } }) + '\n') });
    const rejected = createOcrService({ spawnProcess: bad.spawnProcess });
    await assert.rejects(rejected.recognizeImage(source), isError('OCR_OUTPUT_INVALID', 422));
    assert.equal(bad.calls.some(call => call.args[0] === 'stdin'), false);
    await rejected.shutdown();
  }
});

test('native normalizer JSON primitives return the generic contract error instead of a property exception', async () => {
  for (const metadata of [null, false, 0, 'invalid', []]) {
    const fake = fakeSpawner({ normalize: call => call.finish(JSON.stringify(metadata) + '\n') });
    const service = createOcrService({ spawnProcess: fake.spawnProcess });
    await assert.rejects(service.recognizeImage(tinyPng()), isError('OCR_OUTPUT_INVALID', 422));
    assert.equal(fake.calls.some(call => call.args[0] === 'stdin'), false);
    await service.shutdown();
  }
});

test('invalid normalizer metadata or inconsistent pixel output is rejected before OCR', async () => {
  const base = { method: 'median3-deskew-small-text-v3', pillowVersion: '11.1.0', applied: false, isolatedNoisePixels: 0, thresholdPixels: 32, imagePixels: 1, inkBandCount: 0, medianInkBandHeight: 0, rescaleFactor: 1, deskew: flatDeskew(1, 1) };
  const invalid = [Buffer.from('PRIVATE unreadable'), Buffer.from(JSON.stringify({ ...base, pillowVersion: '1.0.0' }) + '\n'),
    Buffer.from(JSON.stringify({ ...base, applied: true }) + '\n'), Buffer.from(JSON.stringify({ ...base, isolatedNoisePixels: 2 }) + '\n'),
    Buffer.concat([Buffer.from(JSON.stringify(base) + '\n'), tinyPng()])];
  for (const output of invalid) {
    const fake = fakeSpawner({ normalize: call => call.finish(output) });
    const service = createOcrService({ spawnProcess: fake.spawnProcess });
    await assert.rejects(service.recognizeImage(tinyPng()), isError('OCR_OUTPUT_INVALID', 422));
    assert.equal(fake.calls.some(call => call.args[0] === 'stdin'), false);
    await service.shutdown();
  }
});

test('normalizer may not change dimensions or pass invalid PNG bytes to the engine', async () => {
  const header = { method: 'median3-deskew-small-text-v3', pillowVersion: '11.1.0', applied: true, isolatedNoisePixels: 50, thresholdPixels: 40, imagePixels: 40000, inkBandCount: 0, medianInkBandHeight: 0, rescaleFactor: 1, deskew: flatDeskew(200, 200) };
  for (const bytes of [Buffer.from('not pixels'), tinyPng(), Buffer.from([])]) {
    const fake = fakeSpawner({ normalize: call => call.finish(Buffer.concat([Buffer.from(JSON.stringify(header) + '\n'), bytes])) });
    const service = createOcrService({ spawnProcess: fake.spawnProcess });
    await assert.rejects(service.recognizeImage(tinyPng({ width: 200, height: 200 })), isError('OCR_OUTPUT_INVALID', 422));
    assert.equal(fake.calls.some(call => call.args[0] === 'stdin'), false);
    await service.shutdown();
  }
});

test('normalizer output overflow terminates and reaps the process before any OCR starts', async () => {
  const fake = fakeSpawner({ normalize: call => call.child.stdout.write(Buffer.alloc(LIMITS.normalizedImageBytes + 1025, 65)) });
  const service = createOcrService({ spawnProcess: fake.spawnProcess });
  await assert.rejects(service.recognizeImage(tinyPng()), isError('OCR_OUTPUT_LIMIT', 422));
  assert.deepEqual(fake.calls.at(-1).kills, ['SIGKILL']);
  assert.equal(fake.calls.at(-1).closed, true);
  assert.equal(fake.calls.some(call => call.args[0] === 'stdin'), false);
  await service.shutdown();
});

test('normalization consumes the same wall deadline as recognition', async () => {
  let clock = 0;
  const header = { method: 'median3-deskew-small-text-v3', pillowVersion: '11.1.0', applied: false, isolatedNoisePixels: 0, thresholdPixels: 32, imagePixels: 1, inkBandCount: 0, medianInkBandHeight: 0, rescaleFactor: 1, deskew: flatDeskew(1, 1) };
  const fake = fakeSpawner({ normalize: call => { clock += 20; call.finish(JSON.stringify(header) + '\n'); } });
  const service = createOcrService({ spawnProcess: fake.spawnProcess, now: () => clock, recognitionTimeoutMs: 20 });
  await assert.rejects(service.recognizeImage(tinyPng()), isError('OCR_TIMEOUT', 504));
  assert.equal(fake.calls.some(call => call.args[0] === 'stdin'), false);
  await service.shutdown();
});

test('shutdown cancels and reaps active normalization without starting an OCR engine', async () => {
  let started;
  const ready = new Promise(resolve => { started = resolve; });
  const fake = fakeSpawner({ normalize: () => started(), killDelay: 20 });
  const service = createOcrService({ spawnProcess: fake.spawnProcess });
  const pending = service.recognizeImage(tinyPng());
  const rejected = assert.rejects(pending, isError('OCR_CANCELLED', 499));
  await ready;
  await service.shutdown();
  await rejected;
  assert.equal(fake.calls.at(-1).closed, true);
  assert.deepEqual(fake.calls.at(-1).kills, ['SIGKILL']);
  assert.equal(fake.calls.some(call => call.args[0] === 'stdin'), false);
});

test('required isolation checks the fixed dependency version before wrapping engine probes or image stages', async () => {
  const fake = fakeSpawner();
  const service = createOcrService({ spawnProcess: fake.spawnProcess, isolation: 'required', privateDataDir: ISOLATION_PRIVATE_DIR });
  assert.equal((await service.getOcrStatus()).isolation, 'bubblewrap-seccomp');
  const result = await service.recognizeImage(tinyPng());
  assert.equal(result.candidates[0].reviewStatus, 'unreviewed');
  const versionProbe = fake.calls[0];
  assert.equal(versionProbe.binary, '/usr/bin/prlimit');
  assert.deepEqual(versionProbe.processArgs, ['--as=1073741824:1073741824', '--cpu=10:10', '--core=0:0', '--fsize=0:0', '--nofile=64:64', '--', '/usr/bin/bwrap', '--version']);
  assert.deepEqual(versionProbe.options, { shell: false, cwd: '/', env: { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', OMP_THREAD_LIMIT: '1', OMP_NUM_THREADS: '1' }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  assert.equal(versionProbe.input.length, 0);
  assert.equal(versionProbe.closed, true);
  assert.equal(fake.calls.filter(call => call.isIsolationVersion).length, 1);
  for (const call of fake.calls.slice(1)) {
    assert.equal(call.processArgs[6], '/usr/bin/bwrap');
    assert.equal(call.processArgs.includes('--unshare-net'), true);
    assert.equal(call.processArgs.includes('--unshare-user'), true);
    assert.equal(call.processArgs.includes('--share-net'), false);
    assert.deepEqual(call.options.stdio, ['pipe', 'pipe', 'pipe', 'pipe']);
    assert.ok(Buffer.concat(call.seccomp).length > 0);
  }
  await service.shutdown();
});

test('a rejected isolation launcher fails closed without a privileged or resource-only retry', async () => {
  const fake = fakeSpawner({ probe: call => call.finish('', 1) });
  const service = createOcrService({ spawnProcess: fake.spawnProcess, isolation: 'required', privateDataDir: ISOLATION_PRIVATE_DIR });
  const status = await service.getOcrStatus();
  assert.equal(status.available, false);
  assert.equal(status.reason, 'isolation_unavailable');
  await assert.rejects(service.recognizeImage(tinyPng()), isError('OCR_UNAVAILABLE', 503));
  assert.equal(fake.calls.length, 2);
  assert.equal(fake.calls[0].isIsolationVersion, true);
  assert.equal(fake.calls[1].processArgs[6], '/usr/bin/bwrap');
  assert.throws(() => createOcrService({ isolation: 'try-then-unconfined' }), /Invalid local OCR service options/);
  await service.shutdown();
});

test('required isolation rejects vulnerable, prerelease and malformed versions before namespace setup', async () => {
  for (const isolationVersion of ['bubblewrap 0.9.0\n', 'bubblewrap 0.11.99\n', 'bubblewrap 0.12.0-rc1\n', 'bubblewrap 0.12.0+vendor\n', 'bubblewrap 0.12\n', 'bubblewrap 00.12.0\n', 'bubblewrap 0.12.0\n\n', 'bubblewrap 0.12.0\nPRIVATE EXTRA OUTPUT', 'PRIVATE INVALID OUTPUT', '']) {
    const fake = fakeSpawner({ isolationVersion });
    const service = createOcrService({ spawnProcess: fake.spawnProcess, isolation: 'required', privateDataDir: ISOLATION_PRIVATE_DIR });
    try {
      const status = await service.getOcrStatus();
      assert.equal(status.available, false);
      assert.equal(status.reason, 'isolation_dependency_unsupported');
      assert.equal(JSON.stringify(status).includes('PRIVATE'), false);
      await assert.rejects(service.recognizeImage(tinyPng()), isError('OCR_UNAVAILABLE', 503));
      assert.equal(fake.calls.length, 1);
      assert.equal(fake.calls[0].isIsolationVersion, true);
      assert.equal(fake.calls[0].processArgs.some(arg => arg.startsWith('--unshare') || arg.includes('bind')), false);
      assert.equal(fake.calls[0].closed, true);
    } finally { await service.shutdown(); }
  }
});

test('required isolation accepts the fixed upstream release and later stable numeric versions', async () => {
  for (const isolationVersion of ['bubblewrap 0.12.0\n', 'bubblewrap 0.12.1\r\n', 'bubblewrap 0.13.0', 'bubblewrap 1.0.0\n']) {
    const fake = fakeSpawner({ isolationVersion });
    const service = createOcrService({ spawnProcess: fake.spawnProcess, isolation: 'required', privateDataDir: ISOLATION_PRIVATE_DIR });
    try {
      assert.equal((await service.getOcrStatus()).available, true);
      assert.equal(fake.calls.length, 4);
      assert.equal(fake.calls[0].isIsolationVersion, true);
      assert.equal(fake.calls[0].closed, true);
      assert.ok(fake.calls.slice(1).every(call => call.processArgs.includes('--unshare-user')));
    } finally { await service.shutdown(); }
  }
});

test('a missing or failed isolation version read cannot reach the namespace launcher', async () => {
  for (const options of [{ spawnError: 'ENOENT' }, { isolationProbe: call => call.finish('', 1) }, { isolationProbe: call => call.finish(Buffer.from([0xff])) }]) {
    const fake = fakeSpawner(options);
    const service = createOcrService({ spawnProcess: fake.spawnProcess, isolation: 'required', privateDataDir: ISOLATION_PRIVATE_DIR });
    try {
      assert.equal((await service.getOcrStatus()).reason, 'isolation_dependency_unavailable');
      await assert.rejects(service.recognizeImage(tinyPng()), isError('OCR_UNAVAILABLE', 503));
      assert.equal(fake.calls.length, 1);
      assert.equal(fake.calls[0].isIsolationVersion, true);
    } finally { await service.shutdown(); }
  }
});

test('the isolation version read bounds combined stdout and stderr and reaps an oversized child', async () => {
  for (const isolationProbe of [call => call.child.stdout.write(Buffer.alloc(1025, 65)), call => { call.child.stdout.write('bubblewrap 0.12.0\n'); call.child.stderr.write(Buffer.alloc(1024, 65)); }]) {
    const fake = fakeSpawner({ isolationProbe, killDelay: 10 });
    const service = createOcrService({ spawnProcess: fake.spawnProcess, isolation: 'required', privateDataDir: ISOLATION_PRIVATE_DIR });
    try {
      assert.equal((await service.getOcrStatus()).reason, 'isolation_dependency_unavailable');
      assert.equal(fake.calls.length, 1);
      assert.deepEqual(fake.calls[0].kills, ['SIGKILL']);
      assert.equal(fake.calls[0].closed, true);
    } finally { await service.shutdown(); }
  }
});

test('the isolation version deadline kills and reaps the probe before returning unavailable', async () => {
  const fake = fakeSpawner({ isolationProbe: () => {}, killDelay: 10 });
  const service = createOcrService({ spawnProcess: fake.spawnProcess, isolation: 'required', privateDataDir: ISOLATION_PRIVATE_DIR, statusTimeoutMs: 10 });
  try {
    assert.equal((await service.getOcrStatus()).reason, 'isolation_dependency_unavailable');
    assert.equal(fake.calls.length, 1);
    assert.deepEqual(fake.calls[0].kills, ['SIGKILL']);
    assert.equal(fake.calls[0].closed, true);
  } finally { await service.shutdown(); }
});

test('shutdown cancels and reaps an in-flight isolation version read without starting namespaces', async () => {
  const fake = fakeSpawner({ isolationProbe: () => {}, killDelay: 10 });
  const service = createOcrService({ spawnProcess: fake.spawnProcess, isolation: 'required', privateDataDir: ISOLATION_PRIVATE_DIR });
  const pending = service.getOcrStatus();
  await new Promise(resolve => setImmediate(resolve));
  await service.shutdown();
  assert.equal((await pending).reason, 'isolation_dependency_unavailable');
  assert.equal(fake.calls.length, 1);
  assert.deepEqual(fake.calls[0].kills, ['SIGKILL']);
  assert.equal(fake.calls[0].closed, true);
});

test('readiness refresh rechecks the isolation dependency and rejects a downgraded version', async () => {
  let clock = 0, probes = 0;
  const fake = fakeSpawner({ isolationProbe: call => call.finish(probes++ === 0 ? 'bubblewrap 0.12.0\n' : 'bubblewrap 0.9.0\n') });
  const service = createOcrService({ spawnProcess: fake.spawnProcess, isolation: 'required', privateDataDir: ISOLATION_PRIVATE_DIR, now: () => clock });
  try {
    assert.equal((await service.getOcrStatus()).available, true);
    clock += LIMITS.statusCacheMs + 1;
    assert.equal((await service.getOcrStatus()).reason, 'isolation_dependency_unsupported');
    await assert.rejects(service.recognizeImage(tinyPng()), isError('OCR_UNAVAILABLE', 503));
    assert.equal(fake.calls.length, 5);
    assert.equal(fake.calls.at(-1).isIsolationVersion, true);
  } finally { await service.shutdown(); }
});

test('resource-limits mode does not query or require Bubblewrap', async () => {
  const fake = fakeSpawner({ isolationProbe: () => { throw new Error('Unexpected dependency query'); } });
  const service = createOcrService({ spawnProcess: fake.spawnProcess });
  try {
    assert.equal((await service.getOcrStatus()).available, true);
    assert.equal((await service.recognizeImage(tinyPng())).candidates[0].partNumber, 'DEMO-1234');
    assert.equal(fake.calls.some(call => call.processArgs.includes('/usr/bin/bwrap')), false);
  } finally { await service.shutdown(); }
});

test('default readiness age and shared recognition deadline do not depend on the host wall clock', async () => {
  const wallClock = Date.now;
  const fake = fakeSpawner();
  const service = createOcrService({ spawnProcess: fake.spawnProcess });
  try {
    Date.now = () => { throw new Error('Host wall clock must not measure elapsed OCR time'); };
    const result = await service.recognizeImage(tinyPng());
    assert.equal(result.candidates[0].partNumber, 'DEMO-1234');
    assert.ok(Number.isInteger(result.durationMs) && result.durationMs >= 0);
    assert.equal((await service.getOcrStatus()).available, true);
  } finally {
    Date.now = wallClock;
    await service.shutdown();
  }
});
