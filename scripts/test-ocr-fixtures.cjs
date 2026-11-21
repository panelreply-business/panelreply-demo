'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { spawn } = require('node:child_process');
const { getOcrStatus, recognizeImage, createOcrService, inspectImage } = require('../workspace/ocr.cjs');

function corruptPixelStream(buffer) {
  const bytes = Buffer.from(buffer);
  for (let position = 8; position < bytes.length;) {
    const length = bytes.readUInt32BE(position);
    const end = position + 8 + length;
    if (bytes.toString('ascii', position + 4, position + 8) === 'IDAT') {
      bytes.fill(0, position + 8, end);
      let crc = 0xFFFFFFFF;
      for (const byte of bytes.subarray(position + 4, end)) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? 0xEDB88320 ^ (crc >>> 1) : crc >>> 1;
      }
      bytes.writeUInt32BE((crc ^ 0xFFFFFFFF) >>> 0, end);
    }
    position = end + 4;
  }
  return bytes;
}

async function verifyNativeStop(bytes, mode) {
  const controller = new AbortController();
  const children = [];
  let code = null;
  const service = createOcrService({
    recognitionTimeoutMs: mode === 'timeout' ? 5 : 15_000,
    spawnProcess: (binary, args, options) => {
      const spawned = spawn(binary, args, options);
      const normalization = args.some(value => value.endsWith('/ocr-preprocess.py')) && !args.includes('--probe');
      if (args.includes('stdin') || normalization) {
        children.push(spawned);
        if (mode === 'cancel' && args.includes('stdin')) spawned.once('spawn', () => controller.abort());
      }
      return spawned;
    },
  });
  try { await service.recognizeImage(bytes, { signal: controller.signal }); }
  catch (error) { code = error.code; }
  const alive = children.some(child => {
    if (!child.pid) return false;
    try { process.kill(child.pid, 0); return true; }
    catch (error) { if (error.code === 'ESRCH') return false; throw error; }
  });
  const expected = mode === 'timeout' ? 'OCR_TIMEOUT' : 'OCR_CANCELLED';
  const pass = code === expected && children.some(child => child.signalCode === 'SIGKILL') && !alive;
  await service.shutdown();
  return { test: `${mode} reaps every native OCR pipeline child`, status: pass ? 'PASS' : 'FAIL', code, observedChildren: children.length, processAliveAfterReturn: alive };
}

// This CLI uses only checked-in synthetic fixtures and the local Tesseract binary.
// Exit 2 means BLOCKED, not a passing OCR test. Exit 1 means a fixture assertion failed.
async function run() {
  const status = await getOcrStatus();
  if (!status.available) {
    console.log(JSON.stringify({ status: 'BLOCKED', reason: status.reason, engine: status.engine, version: status.version, cases: 0 }, null, 2));
    process.exitCode = 2;
    return;
  }
  const directory = path.join(__dirname, '../tests/fixtures/panels');
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8'));
  const results = [];
  let knownFields = 0, matchedFields = 0, emptyFields = 0, preservedEmptyFields = 0;
  for (const fixture of manifest.cases) {
    const started = performance.now();
    const result = await recognizeImage(fs.readFileSync(path.join(directory, fixture.file)));
    let pass = true;
    const fieldMatches = {};
    if (fixture.expected) {
      pass = result.candidates.length === 1;
      for (const field of ['partNumber', 'manufacturer', 'description']) {
        const actual = result.candidates[0]?.[field];
        fieldMatches[field] = actual === fixture.expected[field];
        pass &&= fieldMatches[field];
        if (fixture.expected[field]) { knownFields += 1; if (fieldMatches[field]) matchedFields += 1; }
        else { emptyFields += 1; if (fieldMatches[field]) preservedEmptyFields += 1; }
      }
      pass &&= result.candidates[0]?.reviewStatus === 'unreviewed';
    } else {
      pass = result.candidates.length === 0 && (fixture.lines.length ? result.rawText.length > 0 : result.rawText.length === 0);
    }
    const confidences = result.candidates.flatMap(candidate => Object.values(candidate.confidence));
    pass &&= confidences.every(value => value === null || (Number.isFinite(value) && value >= 0 && value <= 100));
    results.push({ file: fixture.file, status: pass ? 'PASS' : 'FAIL', durationMs: Math.round(performance.now() - started), candidates: result.candidates.length, fieldMatches });
  }
  const complete = fs.readFileSync(path.join(directory, 'complete.png'));
  const failurePathResults = [await verifyNativeStop(complete, 'timeout'), await verifyNativeStop(complete, 'cancel')];
  const corrupt = corruptPixelStream(complete);
  inspectImage(corrupt);
  let corruptCode = null;
  try { await recognizeImage(corrupt); }
  catch (error) { corruptCode = error.code; }
  failurePathResults.push({ test: 'structurally valid but undecodable pixels return a generic error', status: corruptCode === 'OCR_FAILED' ? 'PASS' : 'FAIL', code: corruptCode });
  const failures = [...results, ...failurePathResults].filter(result => result.status !== 'PASS').length;
  console.log(JSON.stringify({ status: failures ? 'FAIL' : 'PASS', engine: status.engine, version: status.version, language: status.language, cases: results.length + failurePathResults.length, fixtureCases: results.length, nativeFailureCases: failurePathResults.length, failures, knownFields, matchedFields, emptyFields, preservedEmptyFields, results, failurePathResults, scope: 'Synthetic printed text only. These measurements do not establish accuracy on real panel photographs or electrical specifications.' }, null, 2));
  if (failures) process.exitCode = 1;
}

run().catch(error => {
  console.error(JSON.stringify({ status: 'FAIL', code: typeof error?.code === 'string' && /^OCR_|^IMAGE_/.test(error.code) ? error.code : 'OCR_TEST_FAILED' }));
  process.exitCode = 1;
});
