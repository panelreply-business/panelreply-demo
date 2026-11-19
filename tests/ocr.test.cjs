'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { EventEmitter } = require('node:events');
const { PassThrough, Writable } = require('node:stream');
const { inspectImage, parseTsv, OcrError, LIMITS, createOcrService } = require('../workspace/ocr.cjs');

const fixture = name => fs.readFileSync(path.join(__dirname, 'fixtures/panels', name));
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

function fakeSpawner({ recognize, probe, version = 'tesseract 5.5.0\n', languages = 'List of available languages in private-path (1):\neng\n', spawnError, killDelay = 0 } = {}) {
  const calls = [];
  function spawnProcess(binary, args, options) {
    const processArgs = [...args];
    args = args.slice(args.indexOf('/usr/bin/tesseract') + 1);
    const child = new EventEmitter();
    child.pid = spawnError ? undefined : 12345;
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    const call = { binary, args, processArgs, options, child, input: [], kills: [], closed: false };
    child.stdin = new Writable({ write(data, encoding, callback) { call.input.push(Buffer.from(data)); callback(); } });
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
  assert.deepEqual(first, { available: true, engine: 'tesseract', version: '5.5.0', language: 'eng' });
  assert.deepEqual(first, concurrent);
  first.available = false;
  assert.equal((await service.getOcrStatus()).available, true);
  assert.equal(fake.calls.length, 2);
  clock += LIMITS.statusCacheMs + 1;
  assert.equal((await service.getOcrStatus()).available, true);
  assert.equal(fake.calls.length, 4);
  assert.deepEqual(fake.calls.map(call => call.args[0]), ['--version', '--list-langs', '--version', '--list-langs']);
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
    assert.deepEqual(call.processArgs.slice(0, 7), ['--as=1073741824:1073741824', '--cpu=10:10', '--core=0:0', '--fsize=0:0', '--nofile=64:64', '--', '/usr/bin/tesseract']);
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
