'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { run } = require('node:test');
const { sourceEvidence, platformEvidence, collectNodeResults } = require('./test-evidence.cjs');
const ROOT = path.resolve(__dirname, '..');

const PORTABLE = [
  'demo.test.cjs', 'intake.test.cjs', 'questions.test.cjs', 'design-preview.test.cjs',
  'workspace-conversation.test.cjs', 'workspace-assistant.test.cjs', 'assistant-adversarial.test.cjs',
  'assistant-provider.test.cjs', 'assistant-evaluation.test.cjs', 'deletion-client-review.test.cjs',
  'platform-client-state.test.cjs', 'release-assistant-matrix.test.cjs',
  'product-ui.test.cjs', 'callback-schedule-client.test.cjs',
  'release-deletion-model.test.cjs', 'release-export-matrix.test.cjs',
  'release-name-grounding.test.cjs', 'release-evidence.test.cjs'
];

async function main(args) {
  let portable = false, output;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--portable') portable = true;
    else if (args[i] === '--output' && args[i + 1]) output = path.resolve(args[++i]);
    else throw new Error('Usage: node scripts/run-release-node.cjs [--portable] --output FILE');
  }
  if (!output) throw new Error('An explicit evidence output path is required.');
  if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('The release evidence runner requires Node 24 or later.');
  process.chdir(ROOT);
  const filenames = portable ? PORTABLE : fs.readdirSync(path.join(ROOT, 'tests')).filter(name => name.endsWith('.test.cjs') && name !== 'live-smoke.test.cjs').sort();
  for (const filename of filenames) if (!fs.existsSync(path.join(ROOT, 'tests', filename))) throw new Error('Required test file is missing: ' + filename);
  const before = sourceEvidence(ROOT);
  const startedAt = new Date().toISOString();
  const platform = platformEvidence();
  const events = [];
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const log = fs.createWriteStream(output.replace(/\.json$/, '') + '.log', { flags: 'w' });
  console.log('Running ' + filenames.length + ' Node test files on ' + platform.platformKey + ' (' + process.version + ')');
  let completed = 0;
  for await (const event of run({ files: filenames.map(name => path.join(ROOT, 'tests', name)), concurrency: 4 })) {
    if (['test:enqueue', 'test:start', 'test:pass', 'test:fail', 'test:summary'].includes(event.type)) events.push(event);
    if (['test:stdout', 'test:stderr', 'test:diagnostic'].includes(event.type)) log.write(String(event.data.message || '') + '\n');
    if (event.type === 'test:pass' || event.type === 'test:fail') {
      completed++;
      if (event.type === 'test:fail') {
        const message = String(event.data.details?.error?.stack || event.data.details?.error?.message || 'Unknown test failure');
        log.write(event.data.name + '\n' + message + '\n');
        console.error('FAIL ' + event.data.name + ': ' + message.split('\n')[0]);
      } else if (completed % 1000 === 0) console.log('Completed ' + completed + ' test outcomes.');
    }
  }
  await new Promise(resolve => log.end(resolve));
  const results = collectNodeResults(events, ROOT, platform.platformKey);
  const after = sourceEvidence(ROOT);
  const sourceChanged = before.sourceTreeSha256 !== after.sourceTreeSha256 || before.sourceCommit !== after.sourceCommit;
  const evidence = { format: 'panelreply-node-evidence-v1', ...before, suite: portable ? 'node-portable' : 'node-all',
    startedAt, completedAt: new Date().toISOString(), platform, files: filenames.map(name => 'tests/' + name),
    sourceChanged, sourceTreeSha256After: after.sourceTreeSha256, ...results,
    scope: portable ? 'Portable application contracts and independent ZIP/XML export readback. No private Windows/macOS server, browser, physical-device, real-model or Excel claim.'
      : 'Linux Node/component/SQLite/API/HTTP scope, subject to explicit per-case statuses. Browser/native OCR/provider/physical-device results are separate.',
    realProviderCalls: 0 };
  fs.writeFileSync(output, JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify({ output, suite: evidence.suite, sourceCommit: evidence.sourceCommit,
    sourceTreeSha256: evidence.sourceTreeSha256, sourceChanged, ...results.totals,
    productPassing: results.totals.passed - results.totals.harnessPassed,
    summarySuccess: results.summarySuccess, infrastructureErrors: results.infrastructureErrors.length }));
  if (!results.summarySuccess || sourceChanged) process.exitCode = 1;
}

module.exports = { PORTABLE, main };
if (require.main === module) main(process.argv.slice(2)).catch(error => { console.error(error.stack); process.exitCode = 1; });
