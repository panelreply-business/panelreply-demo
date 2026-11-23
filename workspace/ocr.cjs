'use strict';

const { spawn } = require('node:child_process');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { isolationSupported, restrictedInvocation } = require('./ocr-isolation.cjs');

const LIMITS = Object.freeze({
  imageBytes: 2 * 1024 * 1024,
  imageDimension: 6000,
  imagePixels: 16_000_000,
  processOutputBytes: 512 * 1024,
  normalizedImageBytes: 8 * 1024 * 1024,
  rawTextCharacters: 20_000,
  recognitionTimeoutMs: 15_000,
  statusTimeoutMs: 2000,
  statusCacheMs: 60_000,
  partNumberCharacters: 120,
  manufacturerCharacters: 120,
  descriptionCharacters: 500,
  nativeAddressSpaceBytes: 1024 * 1024 * 1024,
  nativeCpuSeconds: 10,
  nativeOpenFiles: 64,
});

const MESSAGES = Object.freeze({
  IMAGE_INVALID: [400, 'Choose a valid, non-animated PNG or JPEG image.'],
  IMAGE_TOO_LARGE: [413, 'The image must be no larger than 2 MiB.'],
  IMAGE_DIMENSIONS: [413, 'The image must be at most 6000 pixels per side and 16 million pixels in total.'],
  OCR_BUSY: [429, 'Local OCR is processing another image. Try again when it finishes.'],
  OCR_UNAVAILABLE: [503, 'Local OCR is unavailable. Enter and review the parts manually.'],
  OCR_CANCELLED: [499, 'Local OCR was cancelled. No extracted parts were saved.'],
  OCR_TIMEOUT: [504, 'Local OCR exceeded its time limit. Try a smaller image or enter the parts manually.'],
  OCR_FAILED: [422, 'Local OCR could not read this image. Try another image or enter the parts manually.'],
  OCR_OUTPUT_LIMIT: [422, 'Local OCR produced too much text. Crop the image to one component label.'],
  OCR_OUTPUT_INVALID: [422, 'Local OCR returned an unreadable result. Enter and review the parts manually.'],
});

class OcrError extends Error {
  constructor(code) {
    const safeCode = Object.hasOwn(MESSAGES, code) ? code : 'OCR_FAILED';
    super(MESSAGES[safeCode][1]);
    this.name = 'OcrError';
    this.code = safeCode;
    this.status = MESSAGES[safeCode][0];
  }
}

function fail(code = 'IMAGE_INVALID') { throw new OcrError(code); }

function checkDimensions(width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) fail();
  if (width > LIMITS.imageDimension || height > LIMITS.imageDimension || width * height > LIMITS.imagePixels) fail('IMAGE_DIMENSIONS');
}

const CRC_TABLE = new Uint32Array(256);
for (let index = 0; index < 256; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xEDB88320 ^ (value >>> 1) : value >>> 1;
  CRC_TABLE[index] = value >>> 0;
}

function crc32(buffer) {
  let crc = 0xFFFFFFFF;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function inspectPng(buffer) {
  let position = 8, width = 0, height = 0, colorType = null;
  let sawHeader = false, sawPalette = false, sawData = false, endedData = false, dataBytes = 0;
  while (position < buffer.length) {
    if (buffer.length - position < 12) fail();
    const length = buffer.readUInt32BE(position);
    if (length > buffer.length - position - 12) fail();
    const type = buffer.toString('ascii', position + 4, position + 8);
    if (!/^[A-Za-z]{4}$/.test(type) || !/[A-Z]/.test(type[2])) fail();
    const dataStart = position + 8, end = dataStart + length;
    if (crc32(buffer.subarray(position + 4, end)) !== buffer.readUInt32BE(end)) fail();
    if (!sawHeader && type !== 'IHDR') fail();
    if (['acTL', 'fcTL', 'fdAT'].includes(type)) fail();
    if (type === 'IHDR') {
      if (sawHeader || length !== 13) fail();
      width = buffer.readUInt32BE(dataStart);
      height = buffer.readUInt32BE(dataStart + 4);
      checkDimensions(width, height);
      const depth = buffer[dataStart + 8];
      colorType = buffer[dataStart + 9];
      const depths = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
      if (!depths[colorType]?.includes(depth) || buffer[dataStart + 10] !== 0 || buffer[dataStart + 11] !== 0 || buffer[dataStart + 12] > 1) fail();
      sawHeader = true;
    } else if (type === 'PLTE') {
      if (sawPalette || sawData || length < 3 || length > 768 || length % 3 !== 0 || [0, 4].includes(colorType)) fail();
      sawPalette = true;
    } else if (type === 'IDAT') {
      if (endedData || (colorType === 3 && !sawPalette)) fail();
      sawData = true;
      dataBytes += length;
    } else if (type === 'IEND') {
      if (!sawData || !dataBytes || length !== 0 || end + 4 !== buffer.length) fail();
      return { mime: 'image/png', width, height, bytes: buffer.length };
    } else {
      // Unknown critical chunks and animation are not part of the supported image boundary.
      if (type[0] === type[0].toUpperCase()) fail();
      if (sawData) endedData = true;
    }
    position = end + 4;
  }
  fail();
}

function inspectJpeg(buffer) {
  if (buffer.length < 12 || buffer[buffer.length - 2] !== 0xFF || buffer[buffer.length - 1] !== 0xD9) fail();
  let position = 2, width = 0, height = 0, components = 0, sawScan = false;
  while (position < buffer.length) {
    if (buffer[position] !== 0xFF) fail();
    while (buffer[position] === 0xFF) position += 1;
    const marker = buffer[position++];
    if (marker === 0xD9) {
      if (!width || !sawScan || position !== buffer.length) fail();
      return { mime: 'image/jpeg', width, height, bytes: buffer.length };
    }
    if (marker === undefined || marker === 0 || marker === 0xD8 || marker === 0x01 || (marker >= 0xD0 && marker <= 0xD7) || marker === 0xDC) fail();
    if (position + 2 > buffer.length) fail();
    const length = buffer.readUInt16BE(position);
    if (length < 2 || position + length > buffer.length) fail();
    const end = position + length;
    const isFrame = marker >= 0xC0 && marker <= 0xCF && ![0xC4, 0xC8, 0xCC].includes(marker);
    if (isFrame) {
      if (width || ![0xC0, 0xC2].includes(marker) || length < 11 || buffer[position + 2] !== 8) fail();
      height = buffer.readUInt16BE(position + 3);
      width = buffer.readUInt16BE(position + 5);
      components = buffer[position + 7];
      if (![1, 3].includes(components) || length !== 8 + components * 3) fail();
      checkDimensions(width, height);
    }
    if (marker !== 0xDA) {
      position = end;
      continue;
    }
    const scanComponents = buffer[position + 2];
    if (!width || !scanComponents || scanComponents > components || length !== 6 + scanComponents * 2) fail();
    sawScan = true;
    position = end;
    // Entropy data may contain escaped 0xFF bytes and restart markers, never paths or URLs.
    while (position < buffer.length) {
      if (buffer[position] !== 0xFF) { position += 1; continue; }
      const markerStart = position;
      while (buffer[position] === 0xFF) position += 1;
      const next = buffer[position];
      if (next === 0 || (next >= 0xD0 && next <= 0xD7)) { position += 1; continue; }
      position = markerStart;
      break;
    }
  }
  fail();
}

function inspectImage(buffer) {
  // Strings, filesystem paths, data URLs and fetchable URLs are never accepted.
  if (!Buffer.isBuffer(buffer) || !buffer.length) fail();
  if (buffer.length > LIMITS.imageBytes) fail('IMAGE_TOO_LARGE');
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return inspectPng(buffer);
  if (buffer[0] === 0xFF && buffer[1] === 0xD8) return inspectJpeg(buffer);
  fail();
}

function pngRecognitionBytes(buffer) {
  // Only pixels, palette and transparency enter the native PNG decoder. Retain the
  // original private source separately. Do not decompress metadata such as ICC/text.
  const chunks = [buffer.subarray(0, 8)];
  let position = 8;
  while (position < buffer.length) {
    const end = position + 12 + buffer.readUInt32BE(position);
    const type = buffer.toString('ascii', position + 4, position + 8);
    if (['IHDR', 'PLTE', 'tRNS', 'IDAT', 'IEND'].includes(type)) chunks.push(buffer.subarray(position, end));
    position = end;
  }
  return Buffer.concat(chunks);
}

const TSV_HEADER = 'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext';
const FIELD_LABELS = [
  ['partNumber', /^(?:part\s*(?:number|no\.?|#)|p\s*\/\s*n)\s*[:=]\s*(.*)$/i],
  ['manufacturer', /^(?:manufacturer|mfr\.?)\s*[:=]\s*(.*)$/i],
  ['description', /^(?:description|desc\.?)\s*[:=]\s*(.*)$/i],
];
const REVIEW_WARNING = 'Review every extracted field against the source image before marking a part reviewed.';

function parseTsv(tsv) {
  if (typeof tsv !== 'string' || Buffer.byteLength(tsv) > LIMITS.processOutputBytes) fail('OCR_OUTPUT_LIMIT');
  const rows = tsv.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').split('\n');
  if (rows.shift() !== TSV_HEADER) fail('OCR_OUTPUT_INVALID');
  const lines = new Map();
  for (const row of rows) {
    if (!row) continue;
    const cells = row.split('\t');
    if (cells.length < 12 || cells.slice(0, 10).some(value => !/^\d+$/.test(value)) || !/^-?\d+(?:\.\d+)?$/.test(cells[10])) fail('OCR_OUTPUT_INVALID');
    const numbers = cells.slice(0, 10).map(Number);
    const confidence = Number(cells[10]);
    if (numbers.some(value => !Number.isSafeInteger(value)) || numbers[0] < 1 || numbers[0] > 5 || (confidence !== -1 && (confidence < 0 || confidence > 100))) fail('OCR_OUTPUT_INVALID');
    if (numbers[0] !== 5) continue;
    const word = cells.slice(11).join(' ').trim();
    if (!word) continue;
    if (/[\u0000-\u0008\u000B-\u001F\u007F]/.test(word)) fail('OCR_OUTPUT_INVALID');
    const key = cells.slice(1, 5).join('/');
    if (!lines.has(key)) lines.set(key, []);
    lines.get(key).push({ word, confidence: confidence < 0 ? null : confidence });
  }
  const recognizedLines = [...lines.values()].map(words => ({
    text: words.map(value => value.word).join(' '),
    confidence: words.some(value => value.confidence === null) ? null : Math.round(Math.min(...words.map(value => value.confidence)) * 100) / 100,
  }));
  const rawText = recognizedLines.map(line => line.text).join('\n');
  if (rawText.length > LIMITS.rawTextCharacters) fail('OCR_OUTPUT_LIMIT');
  const candidate = { partNumber: '', manufacturer: '', description: '', confidence: { partNumber: null, manufacturer: null, description: null }, reviewStatus: 'unreviewed', warnings: [] };
  const seen = new Map(), conflicts = new Set();
  let matched = false;
  for (const line of recognizedLines) {
    for (const [field, pattern] of FIELD_LABELS) {
      // A bullet/hyphen before an otherwise exact label is decoration, not a
      // reason to ignore a second conflicting field. Never alter field values.
      const match = line.text.replace(/^[-•]\s*/u, '').match(pattern);
      if (!match) continue;
      matched = true;
      const value = match[1].trim();
      const maxLength = LIMITS[`${field}Characters`];
      // Multiple labelled fields on one line have ambiguous boundaries. Preserve raw text for a person.
      if (value.length > maxLength || /\b(?:part\s*(?:number|no\.?)|p\s*\/\s*n|manufacturer|mfr\.?|description|desc\.?)\s*[:=]/i.test(value)) {
        conflicts.add(field);
      } else if (seen.has(field) && seen.get(field) !== value) {
        conflicts.add(field);
      } else if (seen.has(field)) {
        candidate.warnings.push(`Repeated ${field} label. Confirm it belongs to one component.`);
        candidate.confidence[field] = candidate.confidence[field] === null || line.confidence === null ? null : Math.min(candidate.confidence[field], line.confidence);
      } else {
        seen.set(field, value);
        candidate[field] = value;
        candidate.confidence[field] = value ? line.confidence : null;
      }
      break;
    }
  }
  for (const field of ['partNumber', 'manufacturer', 'description']) {
    // More than one conflicting field indicates different component records.
    // Retaining the one remaining value would silently associate it with an
    // unknown component. Preserve all source text for manual separation.
    if (conflicts.size > 1) conflicts.add(field);
    if (conflicts.has(field)) {
      candidate[field] = '';
      candidate.confidence[field] = null;
      candidate.warnings.push(`Ambiguous ${field}. Enter the value after reviewing the raw text and source image.`);
    } else if (!candidate[field]) {
      candidate.warnings.push(`No labelled ${field} value was recognized. Enter it manually if it is present on the source image.`);
    } else if (candidate.confidence[field] === null || candidate.confidence[field] < 80) {
      candidate.warnings.push(`Low or unavailable OCR confidence for ${field}. Check each character.`);
    }
  }
  const warnings = [REVIEW_WARNING];
  if (!rawText) warnings.push('No text was recognized. Use a clearer image or enter the fields manually.');
  else if (!matched) warnings.push('No explicit part-number, manufacturer or description labels were recognized. Enter the fields manually.');
  return { rawText, candidates: matched ? [candidate] : [], warnings };
}

const BINARY = '/usr/bin/tesseract';
const ISOLATION_BINARY = '/usr/bin/bwrap';
const NORMALIZER_BINARY = '/usr/bin/python3';
const NORMALIZER_SCRIPT = path.join(__dirname, 'ocr-preprocess.py');
const NORMALIZER_METHOD = 'median3-small-text-v2';
const PROCESS_BINARY = '/usr/bin/prlimit';
const PROCESS_PREFIX = Object.freeze([
  `--as=${LIMITS.nativeAddressSpaceBytes}:${LIMITS.nativeAddressSpaceBytes}`,
  `--cpu=${LIMITS.nativeCpuSeconds}:${LIMITS.nativeCpuSeconds}`,
  '--core=0:0', '--fsize=0:0',
  `--nofile=${LIMITS.nativeOpenFiles}:${LIMITS.nativeOpenFiles}`,
  '--',
]);
const OCR_ARGS = Object.freeze(['stdin', 'stdout', '-l', 'eng', '--oem', '1', '--psm', '6', 'tsv']);
const ORIENTATION_ARGS = Object.freeze(['stdin', 'stdout', '-l', 'eng', '--oem', '1', '--psm', '1', 'tsv']);
const CHILD_ENV = Object.freeze({ PATH: '/usr/bin:/bin', LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', OMP_THREAD_LIMIT: '1', OMP_NUM_THREADS: '1' });

function supportedIsolationVersion(output) {
  // CVE-2026-87766 is fixed upstream in 0.12.0. Reject prerelease, vendor,
  // malformed and ambiguous banners rather than inferring a backported fix.
  const match = /^bubblewrap (0|[1-9][0-9]{0,5})\.(0|[1-9][0-9]{0,5})\.(0|[1-9][0-9]{0,5})\r?\n?$/.exec(output);
  return Boolean(match && match[0] === output && (Number(match[1]) > 0 || Number(match[2]) >= 12));
}

function createOcrService({ spawnProcess = spawn, recognitionTimeoutMs = LIMITS.recognitionTimeoutMs, statusTimeoutMs = LIMITS.statusTimeoutMs, now = () => performance.now(), isolation = 'resource-limits' } = {}) {
  // Injection exists for isolated process-failure tests, not HTTP callers or application settings.
  if (typeof spawnProcess !== 'function' || typeof now !== 'function' || !Number.isInteger(recognitionTimeoutMs) || recognitionTimeoutMs < 1 || recognitionTimeoutMs > LIMITS.recognitionTimeoutMs || !Number.isInteger(statusTimeoutMs) || statusTimeoutMs < 1 || statusTimeoutMs > LIMITS.statusTimeoutMs || !['resource-limits', 'required'].includes(isolation)) throw new TypeError('Invalid local OCR service options.');
  let activeRecognition = false, processingImage = false, statusCache = null, statusPromise = null;
  let closed = false, shutdownPromise = null, orientationAvailable = false;
  const lifetime = new AbortController();
  const pendingProcesses = new Set();

  function runProcess(args, { input, signal, timeoutMs, maxOutputBytes, outputBudget, normalizer = false, binaryOutput = false, isolationVersionProbe = false } = {}) {
    signal = signal ? AbortSignal.any([signal, lifetime.signal]) : lifetime.signal;
    if (signal?.aborted) return Promise.reject(new OcrError('OCR_CANCELLED'));
    let markSettled;
    const settled = new Promise(resolve => { markSettled = resolve; });
    pendingProcesses.add(settled);
    return new Promise((resolve, reject) => {
      let child, timer, filter, outputBytes = 0, terminalError = null, finished = false;
      const chunks = [];
      const finish = (error, output) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', cancel);
        pendingProcesses.delete(settled);
        markSettled();
        if (error) reject(error); else resolve(output);
      };
      const stop = code => {
        if (finished || terminalError) return;
        terminalError = new OcrError(code);
        clearTimeout(timer);
        // Kill the direct, shell-free child and await close before releasing the single OCR slot.
        child.kill('SIGKILL');
      };
      const cancel = () => stop('OCR_CANCELLED');
      try {
        // prlimit execs the fixed engine in the same process. Missing limits or
        // an unsupported host fail closed, never fall back to unbounded OCR.
        const executable = normalizer ? NORMALIZER_BINARY : BINARY;
        const fixedArgs = normalizer ? ['-I', '-B', NORMALIZER_SCRIPT, ...args] : args;
        // The version-only read must precede all namespace/mount setup. It has
        // fixed arguments, no input, and the same process/output/time bounds.
        const command = isolationVersionProbe ? { binary: ISOLATION_BINARY, args: ['--version'] }
          : isolation === 'required' ? restrictedInvocation(executable, fixedArgs) : { binary: executable, args: fixedArgs };
        filter = command.seccomp;
        child = spawnProcess(PROCESS_BINARY, [...PROCESS_PREFIX, command.binary, ...command.args], { shell: false, cwd: '/', env: { ...CHILD_ENV }, stdio: filter ? ['pipe', 'pipe', 'pipe', 'pipe'] : ['pipe', 'pipe', 'pipe'], windowsHide: true });
      } catch (error) {
        finish(new OcrError(error?.code === 'ENOENT' ? 'OCR_UNAVAILABLE' : 'OCR_FAILED'));
        return;
      }
      child.on('error', error => {
        const safeError = new OcrError(error?.code === 'ENOENT' ? 'OCR_UNAVAILABLE' : 'OCR_FAILED');
        if (!child.pid) finish(safeError);
        else { terminalError ||= safeError; child.kill('SIGKILL'); }
      });
      child.once('close', code => {
        if (terminalError) return finish(terminalError);
        if (code !== 0) return finish(new OcrError('OCR_FAILED'));
        try {
          const bytes = Buffer.concat(chunks);
          const output = binaryOutput ? bytes : new TextDecoder('utf-8', { fatal: true }).decode(bytes);
          finish(null, output);
        } catch { finish(new OcrError('OCR_OUTPUT_INVALID')); }
      });
      const consume = (data, retain) => {
        if (finished || terminalError) return;
        const chunk = Buffer.isBuffer(data) ? data : Buffer.from(data);
        outputBytes += chunk.length;
        if (outputBudget) outputBudget.bytes += chunk.length;
        if ((outputBudget?.bytes ?? outputBytes) > maxOutputBytes) return stop('OCR_OUTPUT_LIMIT');
        if (retain) chunks.push(chunk);
      };
      child.stdout.on('data', data => consume(data, true));
      child.stderr.on('data', data => consume(data, false));
      child.stdout.on('error', () => stop('OCR_FAILED'));
      child.stderr.on('error', () => stop('OCR_FAILED'));
      child.stdin.on('error', () => stop('OCR_FAILED'));
      if (filter) child.stdio[3].on('error', () => stop('OCR_FAILED'));
      timer = setTimeout(() => stop('OCR_TIMEOUT'), timeoutMs);
      signal?.addEventListener('abort', cancel, { once: true });
      if (signal?.aborted) cancel();
      try { if (filter) child.stdio[3].end(filter); child.stdin.end(isolationVersionProbe ? undefined : input); }
      catch { stop('OCR_FAILED'); }
    });
  }

  async function getOcrStatus() {
    if (closed) return { available: false, engine: 'tesseract', version: null, language: 'eng', reason: 'service_shutdown' };
    if (isolation === 'required' && !isolationSupported()) return { available: false, engine: 'tesseract', version: null, language: 'eng', reason: 'isolation_unsupported' };
    if (statusCache && (now() - statusCache.at < LIMITS.statusCacheMs || processingImage)) return { ...statusCache.value };
    if (statusPromise) return { ...await statusPromise };
    statusPromise = (async () => {
      let version = null;
      try {
        if (isolation === 'required') {
          let dependencyVersion;
          try {
            dependencyVersion = await runProcess([], { isolationVersionProbe: true, timeoutMs: statusTimeoutMs, maxOutputBytes: 1024 });
          } catch {
            return { available: false, engine: 'tesseract', version, language: 'eng', reason: 'isolation_dependency_unavailable' };
          }
          if (!supportedIsolationVersion(dependencyVersion)) return { available: false, engine: 'tesseract', version, language: 'eng', reason: 'isolation_dependency_unsupported' };
        }
        const output = await runProcess(['--version'], { timeoutMs: statusTimeoutMs, maxOutputBytes: 16 * 1024 });
        const match = output.match(/^tesseract (\d+\.\d+(?:\.[A-Za-z0-9.+-]+)?)/m);
        version = match?.[1]?.slice(0, 40) || null;
        if (!version || !version.startsWith('5.')) return { available: false, engine: 'tesseract', version, language: 'eng', reason: 'engine_unsupported' };
        const languages = await runProcess(['--list-langs'], { timeoutMs: statusTimeoutMs, maxOutputBytes: 16 * 1024 });
        orientationAvailable = /^osd\s*$/m.test(languages);
        if (!/^eng\s*$/m.test(languages)) return { available: false, engine: 'tesseract', version, language: 'eng', reason: 'language_unavailable' };
        let normalizer;
        try {
          normalizer = JSON.parse(await runProcess(['--probe'], { normalizer: true, timeoutMs: statusTimeoutMs, maxOutputBytes: 1024 }));
          if (normalizer.method !== NORMALIZER_METHOD || !/^\d+\.\d+\.\d+$/.test(normalizer.pillowVersion)) throw new Error('normalizer unavailable');
        } catch {
          return { available: false, engine: 'tesseract', version, language: 'eng', reason: 'normalizer_unavailable' };
        }
        return { available: true, engine: 'tesseract', version, language: 'eng', normalizer: { method: NORMALIZER_METHOD, pillowVersion: normalizer.pillowVersion }, orientationAvailable,
          ...(isolation === 'required' ? { isolation: 'bubblewrap-seccomp' } : {}) };
      } catch (error) {
        return { available: false, engine: 'tesseract', version, language: 'eng', reason: isolation === 'required' ? 'isolation_unavailable' : error.code === 'OCR_UNAVAILABLE' ? 'engine_unavailable' : 'engine_check_failed' };
      }
    })();
    try {
      const value = await statusPromise;
      statusCache = { at: now(), value };
      return { ...value };
    } finally { statusPromise = null; }
  }

  async function recognizeImage(buffer, { signal } = {}) {
    if (closed) fail('OCR_CANCELLED');
    const image = inspectImage(buffer);
    const sourceBytes = Buffer.from(buffer);
    if (signal?.aborted) fail('OCR_CANCELLED');
    if (activeRecognition) fail('OCR_BUSY');
    activeRecognition = true;
    const start = now();
    try {
      const status = await getOcrStatus();
      if (signal?.aborted || closed) fail('OCR_CANCELLED');
      if (!status.available) fail('OCR_UNAVAILABLE');
      processingImage = true;
      let input = image.mime === 'image/png' ? pngRecognitionBytes(sourceBytes) : sourceBytes;
      // Both passes share one wall deadline, output budget and recognition slot.
      // The fallback only replaces a result with no labelled candidates, never
      // fills individual missing fields or silently reconciles different values.
      const deadline = now() + recognitionTimeoutMs;
      const outputBudget = { bytes: 0 };
      const normalized = await runProcess([], { normalizer: true, binaryOutput: true, input, signal,
        timeoutMs: recognitionTimeoutMs, maxOutputBytes: LIMITS.normalizedImageBytes + 1024 });
      const separator = normalized.indexOf(10);
      if (separator < 1 || separator > 1024) fail('OCR_OUTPUT_INVALID');
      let normalization;
      try { normalization = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(normalized.subarray(0, separator))); }
      catch { fail('OCR_OUTPUT_INVALID'); }
      if (normalization.method !== NORMALIZER_METHOD || normalization.pillowVersion !== status.normalizer.pillowVersion || typeof normalization.applied !== 'boolean'
        || !Number.isSafeInteger(normalization.isolatedNoisePixels) || normalization.isolatedNoisePixels < 0 || normalization.isolatedNoisePixels > image.width * image.height
        || normalization.imagePixels !== image.width * image.height || normalization.thresholdPixels !== Math.max(32, Math.ceil(image.width * image.height / 1000))
        || normalization.applied !== (normalization.isolatedNoisePixels >= normalization.thresholdPixels)
        || !Number.isSafeInteger(normalization.inkBandCount) || normalization.inkBandCount < 0 || normalization.inkBandCount > image.height
        || !Number.isSafeInteger(normalization.medianInkBandHeight) || normalization.medianInkBandHeight < 0 || normalization.medianInkBandHeight > image.height
        || (normalization.inkBandCount === 0 ? normalization.medianInkBandHeight !== 0 : normalization.medianInkBandHeight < 3)) fail('OCR_OUTPUT_INVALID');
      const expectedScale = normalization.medianInkBandHeight >= 3 && normalization.medianInkBandHeight < 16
        && image.width <= LIMITS.imageDimension / 2 && image.height <= LIMITS.imageDimension / 2 && image.width * image.height <= LIMITS.imagePixels / 4 ? 2 : 1;
      if (normalization.rescaleFactor !== expectedScale) fail('OCR_OUTPUT_INVALID');
      const normalizedBytes = normalized.subarray(separator + 1);
      if (normalization.applied || expectedScale !== 1) {
        if (!normalizedBytes.length || normalizedBytes.length > LIMITS.normalizedImageBytes
          || !normalizedBytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) fail('OCR_OUTPUT_INVALID');
        let dimensions;
        try { dimensions = inspectPng(normalizedBytes); } catch { fail('OCR_OUTPUT_INVALID'); }
        if (dimensions.width !== image.width * expectedScale || dimensions.height !== image.height * expectedScale) fail('OCR_OUTPUT_INVALID');
        input = pngRecognitionBytes(normalizedBytes);
      } else if (normalizedBytes.length) fail('OCR_OUTPUT_INVALID');
      const recognizePass = async args => {
        const remaining = deadline - now();
        if (remaining <= 0) fail('OCR_TIMEOUT');
        return parseTsv(await runProcess(args, { input, signal, timeoutMs: remaining, maxOutputBytes: LIMITS.processOutputBytes, outputBudget }));
      };
      let result = await recognizePass(OCR_ARGS);
      let passes = 1, orientationFallbackUsed = false;
      if (orientationAvailable && result.candidates.length === 0 && result.rawText) {
        const oriented = await recognizePass(ORIENTATION_ARGS);
        passes += 1;
        if (oriented.candidates.length) {
          result = oriented;
          orientationFallbackUsed = true;
          result.warnings.push('Automatic orientation fallback was used. Compare every character with the original source image.');
        }
      }
      if (expectedScale !== 1) result.warnings.push('Small text was enlarged for OCR. Review every character against the original source image.');
      return { engine: 'tesseract', engineVersion: status.version, ...result,
        processing: { passes, orientationFallbackUsed, normalization }, durationMs: Math.max(0, Math.round(now() - start)) };
    } finally { activeRecognition = false; processingImage = false; }
  }

  function shutdown() {
    if (shutdownPromise) return shutdownPromise;
    closed = true;
    lifetime.abort();
    shutdownPromise = (async () => {
      await Promise.allSettled([...pendingProcesses]);
      if (statusPromise) await statusPromise;
    })();
    return shutdownPromise;
  }

  return { getOcrStatus, recognizeImage, shutdown };
}

const localOcr = createOcrService();
module.exports = { inspectImage, parseTsv, OcrError, LIMITS, createOcrService, getOcrStatus: localOcr.getOcrStatus, recognizeImage: localOcr.recognizeImage, shutdown: localOcr.shutdown };
