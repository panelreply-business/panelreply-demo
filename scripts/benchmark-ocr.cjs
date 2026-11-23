'use strict';

// Deliberately a measurement CLI, separate from pass/fail regression assertions.
// A complete run can expose poor accuracy. It must not turn mismatches into PASS.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { performance } = require('node:perf_hooks');
const { createProcessSampler } = require('./ocr-process-metrics.cjs');
const { createDependencyEvidence } = require('./ocr-dependency-evidence.cjs');
const FIELDS = ['partNumber', 'manufacturer', 'description'];

function percentile(values, quantile) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? Math.round(sorted[Math.ceil(quantile * sorted.length) - 1]) : null;
}
function metrics(results) {
  const fields = Object.fromEntries(FIELDS.map(field => [field, { known: 0, exact: 0, missed: 0, wrong: 0, expectedBlank: 0, preservedBlank: 0, falsePositive: 0 }]));
  for (const row of results) {
    for (const field of FIELDS) {
      const expected = row.expected?.[field] || '', actual = row.actual?.[field] || '';
      const count = fields[field];
      if (expected) {
        count.known += 1;
        if (expected === actual) count.exact += 1;
        else if (actual) count.wrong += 1;
        else count.missed += 1;
      } else {
        count.expectedBlank += 1;
        if (actual) count.falsePositive += 1;
        else count.preservedBlank += 1;
      }
    }
  }
  return { cases: results.length, exactCases: results.filter(row => row.exact).length, errors: results.filter(row => row.error).length,
    reviewViolations: results.filter(row => row.reviewViolation).length,
    fields, latencyMs: { median: percentile(results.map(row => row.durationMs), .5), p95: percentile(results.map(row => row.durationMs), .95), max: results.length ? Math.round(Math.max(...results.map(row => row.durationMs))) : null } };
}

async function main() {
  const directory = path.resolve(process.argv[2] || '');
  const output = process.argv[3];
  if (!process.argv[2] || !output) throw new Error('Usage: node scripts/benchmark-ocr.cjs DATASET_DIRECTORY RESULT_JSON [TRUSTED_LOCAL_OCR_MODULE]');
  // A trusted, local baseline module can be measured without editing the
  // immutable baseline checkout. This is a diagnostic CLI, not an HTTP option.
  const engineModule = path.resolve(process.argv[4] || path.join(__dirname, '../workspace/ocr.cjs'));
  const engineModuleSha256 = crypto.createHash('sha256').update(fs.readFileSync(engineModule)).digest('hex');
  const pipelineSources = ['ocr.cjs', 'ocr-preprocess.py', 'ocr-isolation.cjs']
    .filter(file => fs.existsSync(path.join(path.dirname(engineModule), file)))
    .map(file => ({ file, sha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(path.dirname(engineModule), file))).digest('hex') }));
  const pipelineSha256 = crypto.createHash('sha256').update(JSON.stringify(pipelineSources)).digest('hex');
  const sampler = createProcessSampler();
  const dependencies = createDependencyEvidence({ spawnProcess: sampler.spawnProcess });
  const { createOcrService } = require(engineModule);
  const service = createOcrService({ spawnProcess: dependencies.spawnProcess });
  const manifestBytes = fs.readFileSync(path.join(directory, 'manifest.json'));
  const manifest = JSON.parse(manifestBytes);
  if (manifest.format !== 'panelreply-synthetic-ocr-benchmark' || manifest.version !== 1 || !Array.isArray(manifest.cases) || !manifest.cases.length || manifest.cases.length > 500) throw new Error('Invalid benchmark manifest');
  if (new Set(manifest.cases.map(fixture => fixture.sha256)).size !== manifest.cases.length) throw new Error('Duplicate image bytes would inflate benchmark case counts');
  const status = await service.getOcrStatus();
  if (!status.available) {
    const dependencySnapshot = dependencies.snapshot();
    const dependencyEvidence = dependencies.summarize(dependencySnapshot, structuredClone(dependencySnapshot));
    const report = { format: 'panelreply-ocr-benchmark-results', version: 1, status: 'BLOCKED', accuracyGate: 'BLOCKED', identityGate: dependencyEvidence.identityGate,
      engine: status, engineModuleSha256, pipelineSources, pipelineSha256, datasetSha256: crypto.createHash('sha256').update(manifestBytes).digest('hex'),
      dependencyEvidence, overall: metrics([]), results: [], failureCorpus: [] };
    await service.shutdown();
    fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({ status: 'BLOCKED', identityGate: report.identityGate, engine: status, cases: 0, output }));
    process.exitCode = 2;
    return;
  }
  const beforeHashStart = performance.now(), dependenciesBefore = dependencies.snapshot();
  const beforeHashMs = performance.now() - beforeHashStart;
  const results = [], start = performance.now(), cpuStart = process.cpuUsage(), rssStart = process.memoryUsage().rss;
  for (const fixture of manifest.cases) {
    if (!/^[a-z0-9.-]+\.(?:png|jpg)$/.test(fixture.file)) throw new Error('Unsafe fixture filename');
    const image = fs.readFileSync(path.join(directory, fixture.file));
    if (crypto.createHash('sha256').update(image).digest('hex') !== fixture.sha256) throw new Error('Fixture hash mismatch: ' + fixture.id);
    const began = performance.now();
    const processStart = sampler.records.length;
    let result, error = null;
    try { result = await service.recognizeImage(image); } catch (failure) { error = failure.code || 'OCR_FAILED'; }
    const candidate = result?.candidates[0];
    const actual = candidate ? Object.fromEntries(FIELDS.map(key => [key, candidate[key]])) : null;
    const exact = !error && FIELDS.every(key => (actual?.[key] || '') === (fixture.expected?.[key] || '')) && (!fixture.expected ? !candidate : !!candidate);
    results.push({ id: fixture.id, scenario: fixture.scenario, condition: fixture.condition, expected: fixture.expected, actual, exact, error,
      durationMs: Math.round(performance.now() - began), reviewViolation: !!candidate && candidate.reviewStatus !== 'unreviewed',
      rawText: result?.rawText || '', warnings: result?.warnings || [], candidateWarnings: candidate?.warnings || [],
      processing: result?.processing || null, nativeProcess: sampler.summarize(sampler.records.slice(processStart)) });
    if (results.length % 40 === 0) console.log(JSON.stringify({ status: 'MEASURING', completed: results.length, total: manifest.cases.length }));
  }
  const overall = metrics(results);
  const byCondition = Object.fromEntries([...new Set(results.map(row => row.condition))].map(condition => [condition, metrics(results.filter(row => row.condition === condition))]));
  const cpu = process.cpuUsage(cpuStart);
  const elapsedMs = Math.round(performance.now() - start), rssAfter = process.memoryUsage().rss;
  const afterHashStart = performance.now(), dependenciesAfter = dependencies.snapshot();
  const dependencyEvidence = dependencies.summarize(dependenciesBefore, dependenciesAfter);
  dependencyEvidence.collectionMs = Math.round(beforeHashMs + performance.now() - afterHashStart);
  const identityGate = dependencyEvidence.identityGate;
  const report = { format: 'panelreply-ocr-benchmark-results', version: 1, status: overall.errors || overall.reviewViolations || identityGate === 'FAIL' ? 'FAIL' : 'MEASURED',
    accuracyGate: overall.exactCases === results.length ? 'PASS' : 'FAIL',
    identityGate, dependencyEvidence,
    scope: 'Synthetic stress conditions only. Not a real-world accuracy estimate. Measurement completion is not a passing accuracy claim.',
    engine: status, engineModuleSha256, pipelineSources, pipelineSha256, datasetSha256: crypto.createHash('sha256').update(manifestBytes).digest('hex'), pillowVersion: manifest.pillowVersion, fonts: manifest.fonts,
    scenarios: manifest.scenarios, conditions: manifest.conditions, omittedDuplicateCases: manifest.omittedDuplicateCases || [], elapsedMs,
    nodeProcess: { rssBeforeBytes: rssStart, rssAfterBytes: rssAfter, cpuUserMs: Math.round(cpu.user / 1000), cpuSystemMs: Math.round(cpu.system / 1000), scope: 'Node parent only. Does not measure native child CPU or peak RSS. Dependency file snapshot collection is outside this measurement.' },
    nativeProcess: sampler.summarize(),
    overall, byCondition, failureCorpus: results.filter(row => !row.exact), results };
  await service.shutdown();
  fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ status: report.status, accuracyGate: report.accuracyGate, identityGate, output, overall, elapsedMs: report.elapsedMs }));
  // Accuracy mismatches remain explicit evidence and are not an arbitrary CI
  // threshold. Execution/contract failures fail the measurement command itself.
  if (overall.errors || overall.reviewViolations || identityGate === 'FAIL') process.exitCode = 1;
  else if (identityGate === 'BLOCKED') process.exitCode = 2;
}

if (require.main === module) main().catch(error => { console.error(JSON.stringify({ status: 'FAIL', error: error.message })); process.exitCode = 1; });
module.exports = { metrics, percentile };
