'use strict';

// Generated combinations of documented text domains, saved-field locations and
// row/source contexts. Every case validates one complete CSV/XLSX contract.
// Assertions, repeated exports and independent-reader passes are not extra tests.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { validateProject, exportProjectCsv } = require('../workspace/panels.cjs');
const { exportProjectXlsx, MAX_XLSX_BYTES } = require('../workspace/xlsx.cjs');

const ID = 'd9f941e2-7754-49b7-bf25-0c6872de1300';
const SOURCES = ['28fdb3d1-6f40-441f-a1ad-bf0db9441101', '28fdb3d1-6f40-441f-a1ad-bf0db9441102', '28fdb3d1-6f40-441f-a1ad-bf0db9441103'];
const HEADERS = ['Part number', 'Manufacturer', 'Description', 'Quantity', 'Source image', 'Review status', 'Notes'];
const domains = [
  ['plain-part', 'QO-120'], ['leading-zero', '000012345'], ['long-numeric', '123456789012345678901234567890'],
  ['scientific-looking', '1E10'], ['date-looking', '03/04/2026'], ['decimal-looking', '00001.200'],
  ['hex-looking', '0x0000FF'], ['boolean-looking', 'TRUE'], ['null-looking', 'null'],
  ['leading-space', '  QO-120'], ['trailing-space', 'QO-120  '], ['internal-space', 'QO  120'],
  ['tab', 'QO\t120'], ['line-feed', 'QO\n120'], ['carriage-return', 'QO\r120'], ['crlf', 'QO\r\n120'],
  ['double-quote', 'QO "120"'], ['comma', 'QO,120'], ['semicolon', 'QO;120'], ['apostrophe', "'QO-120"],
  ['ampersand', 'MFR & Co'], ['xml-brackets', '<part id="120">'], ['entity-literal', '&amp;&#13;&lt;'],
  ['backslash', 'QO\\120'], ['forward-slash', 'QO/120'], ['pipe', 'QO|120'], ['colon', 'QO:120'],
  ['accent-composed', 'Électricité'], ['accent-decomposed', 'E\u0301lectricite\u0301'], ['greek', 'Ω-Δ-230'],
  ['cyrillic', 'ПАНЕЛЬ-120'], ['cjk', '電気部品-120'], ['arabic', 'لوحة-120'], ['hebrew', 'לוח-120'],
  ['supplementary', 'Part-🔌-120'], ['nonbreaking-space', 'QO\u00a0120'], ['narrow-space', 'QO\u202f120'],
  ['zero-width', 'QO\u200b120'], ['word-joiner', 'QO\u2060120'], ['bom-interior', 'QO\ufeff120'],
  ['ooxml-letter', '_x0041_'], ['ooxml-cr', '_x000D_'], ['ooxml-control', '_x0000_'], ['ooxml-uppercase', '_X0041_'],
  ['ooxml-underscore', '_x005F_'], ['ooxml-nested', '_x005F_x0041_'], ['ooxml-bare-underscore', 'prefix-x005F_-suffix'],
  ['ooxml-adjacent', '_x0041__x0042_'], ['ooxml-text-around', 'left_x003C_right'],
  ['formula-equals', '=1+1', true], ['formula-plus', '+SUM(A1:A2)', true], ['formula-minus', '-1+2', true],
  ['formula-at', '@SUM(A1:A2)', true], ['formula-space', '  =1+1', true], ['formula-tab', '\t=1+1', true],
  ['formula-crlf', '\r\n=1+1', true], ['formula-nbsp', '\u00a0=1+1', true], ['formula-zero-width', '\u200b=1+1', true],
  ['formula-bidi', '\u202e=1+1', true], ['formula-isolate', '\u2066=1+1', true], ['formula-bom', '\ufeff=1+1', true],
  ['formula-quoted', '=HYPERLINK("https://invalid.example")', true], ['apostrophe-formula', "'=1+1"],
  ['embedded-formula', 'part =1+1'], ['csv-breakout', 'part",\r\n"=1+1'], ['xml-closing-text', '</t><f>1+1</f><t>']
].map(([id, value, guard = false]) => Object.freeze({ id, value, guard }));
const locations = ['partNumber', 'manufacturer', 'description', 'notes', 'projectName', 'projectNotes', 'sourceName'];
const contexts = ['one-unreviewed', 'one-reviewed', 'shared-text', 'adjacent-controls', 'source-order'];
const expectedCsv = new Map();
for (const domain of domains) {
  expectedCsv.set(domain.value, domain.guard ? "'" + domain.value : domain.value);
  // Source filenames are trimmed by the source validator before they are saved.
  expectedCsv.set(domain.value.trim(), domain.guard ? "'" + domain.value.trim() : domain.value.trim());
}
function modelCsv(value) { return typeof value === 'number' ? String(value) : expectedCsv.get(value) ?? value; }
function row(overrides = {}) { return { partNumber: 'CONTROL-001', manufacturer: 'Synthetic Parts', description: 'Synthetic component', quantity: 1, reviewStatus: 'unreviewed', notes: 'Control notes', sourceImageId: null, ...overrides }; }
function inputFor(domain, location, context) {
  let rows = [row()], sources = [], target = 0;
  if (context === 'one-reviewed') { sources = [{ id: SOURCES[0], name: 'source-one.png' }]; rows[0] = row({ reviewStatus: 'reviewed', quantity: 9999, sourceImageId: SOURCES[0] }); }
  if (context === 'shared-text') {
    sources = [{ id: SOURCES[0], name: 'source-one.png' }];
    rows = [row({ sourceImageId: SOURCES[0] }), row({ sourceImageId: SOURCES[0], quantity: 9999 })];
  }
  if (context === 'adjacent-controls') {
    rows = [row({ partNumber: 'CONTROL-BEFORE', quantity: 2 }), row(), row({ partNumber: 'CONTROL-AFTER', quantity: 9999 })]; target = 1;
  }
  if (context === 'source-order') {
    sources = [{ id: SOURCES[2], name: 'source-three.png' }, { id: SOURCES[0], name: 'source-one.png' }, { id: SOURCES[1], name: 'source-two.png' }];
    rows = [row({ sourceImageId: SOURCES[0] }), row({ sourceImageId: SOURCES[1], reviewStatus: 'reviewed', quantity: 27 }), row({ sourceImageId: SOURCES[2], quantity: 9999 })]; target = 1;
  }
  const input = { name: 'Synthetic matrix project', notes: 'Project notes', rows };
  if (location === 'projectName') input.name = domain.value;
  else if (location === 'projectNotes') input.notes = domain.value;
  else if (location === 'sourceName') {
    if (!sources.length) sources.push({ id: SOURCES[0], name: 'source-one.png' });
    const sourceId = rows[target].sourceImageId || SOURCES[0];
    sources.find(source => source.id === sourceId).name = domain.value.trim();
    rows[target].sourceImageId = sourceId;
    if (context === 'shared-text') rows[1].sourceImageId = sourceId;
  } else {
    rows[target][location] = domain.value;
    if (context === 'shared-text') rows[1][location] = domain.value;
  }
  return { input, sources };
}
function savedProject(input, sources = []) {
  return { id: ID, ...structuredClone(input), name: input.name.trim(), sources: structuredClone(sources), version: 3,
    createdAt: '2026-11-20T14:00:00.000Z', updatedAt: '2026-11-20T15:00:00.000Z',
    privateAccount: 'MUST-NOT-EXPORT-ACCOUNT', secretSession: 'MUST-NOT-EXPORT-SESSION' };
}
function readerExpected(saved) {
  const names = new Map(saved.sources.map(source => [source.id, source.name]));
  return {
    parts: saved.rows.map(value => [value.partNumber, value.manufacturer, value.description, value.quantity, value.sourceImageId ? names.get(value.sourceImageId) : '', value.reviewStatus, value.notes]),
    metadata: [
      ['Project', saved.name], ['Project ID', saved.id], ['Saved version', String(saved.version)],
      ['Created (UTC)', saved.createdAt], ['Saved (UTC)', saved.updatedAt], ['Project notes', saved.notes],
      ['Export contents', 'Saved project state only. Unsaved edits are not included.'],
      ['Review status', 'Reviewed records a human check. It does not establish part authenticity or electrical compatibility.']
    ]
  };
}

// Independent RFC-4180-style state machine. It reads quoted fields, doubled
// quotes, delimiters and record boundaries instead of reversing the writer's
// replace/join operations. Embedded CR/LF remains part of its field.
function parseCsv(csv) {
  assert.equal(csv.codePointAt(0), 0xfeff, 'UTF-8 spreadsheet BOM');
  const rows = []; let cells = [], field = '', state = 'start';
  for (let i = 1; i < csv.length; i++) {
    const char = csv[i];
    if (state === 'start') { assert.equal(char, '"', 'every field begins quoted'); state = 'quoted'; }
    else if (state === 'quoted') { if (char === '"') state = 'after-quote'; else field += char; }
    else if (char === '"') { field += '"'; state = 'quoted'; }
    else if (char === ',') { cells.push(field); field = ''; state = 'start'; }
    else {
      assert.equal(char, '\r', 'record separator follows a closed field');
      assert.equal(csv[++i], '\n', 'CRLF record separator');
      cells.push(field); rows.push(cells); cells = []; field = ''; state = 'start';
    }
  }
  assert.equal(state, 'start'); assert.deepEqual(cells, []); assert.equal(field, '');
  return rows;
}

const cases = [], ids = new Set(), hashes = new Set();
function addCase(id, input, sources, category) {
  const semantic = { input, sources };
  const hash = crypto.createHash('sha256').update(JSON.stringify(semantic)).digest('hex');
  assert.ok(!ids.has(id), 'duplicate export ID'); ids.add(id);
  assert.ok(!hashes.has(hash), 'duplicate semantic export input: ' + id); hashes.add(hash);
  cases.push({ id, hash, input, sources, category });
}
for (const domain of domains) for (const location of locations) for (const context of contexts) {
  // This is a saved-record export test, so do not invent invalid filenames or
  // count several already-trimmed filenames as distinct export inputs.
  if (location === 'sourceName' && (domain.value !== domain.value.trim() || /[\/\\\r\n\t]/.test(domain.value) || ['.', '..'].includes(domain.value))) continue;
  const value = inputFor(domain, location, context);
  addCase(`REM-text-${domain.id}-${location}-${context}`, value.input, value.sources, 'text-domain');
}

// Field-size boundaries, blank optional fields, 0/1/199/200 rows, source order,
// and numeric quantity endpoints are explicit cases outside the text product.
for (const [field, maximum] of [['partNumber', 128], ['manufacturer', 120], ['description', 1000], ['notes', 1000], ['projectName', 120], ['projectNotes', 2000], ['sourceName', 160]]) {
  for (const length of [1, maximum - 1, maximum]) {
    const domain = { value: 'Z'.repeat(length) };
    const value = inputFor(domain, field, 'one-unreviewed');
    addCase(`REM-boundary-${field}-${length}`, value.input, value.sources, 'field-length');
  }
}
for (const count of [0, 1, 199, 200]) for (const quantity of [1, 9999]) {
  // An empty project has no quantity input, so record it only once.
  if (count === 0 && quantity !== 1) continue;
  const rows = Array.from({ length: count }, (_, n) => row({ partNumber: 'COUNT-' + String(n).padStart(3, '0'), quantity, reviewStatus: n % 2 ? 'reviewed' : 'unreviewed' }));
  addCase(`REM-row-count-${count}-quantity-${quantity}`, { name: 'Row boundary project', notes: '', rows }, [], 'row-count');
}
for (const field of ['partNumber', 'manufacturer', 'description', 'notes', 'projectNotes']) for (const value of ['', ' ', '\t\r\n']) {
  const item = inputFor({ value }, field, 'one-unreviewed');
  addCase(`REM-optional-${field}-${value === '' ? 'empty' : value === ' ' ? 'space' : 'multiline'}`, item.input, item.sources, 'optional-field');
}

const prepared = new Map(), readerResults = new Map();
test.before(() => {
  const readerInputs = [];
  for (const item of cases) {
    try {
      const saved = savedProject(item.input, item.sources);
      const savedBefore = structuredClone(saved);
      const expected = readerExpected(saved);
      const workbook = exportProjectXlsx(saved);
      prepared.set(item.id, { saved, savedBefore, expected, workbook, csv: exportProjectCsv(saved) });
      readerInputs.push({ id: item.id, workbook: workbook.toString('base64'), ...expected });
    } catch (error) { prepared.set(item.id, { error }); }
  }
  assert.ok(readerInputs.length, 'no export case reached the independent reader');
  // Harness negative controls are not application cases and do not contribute
  // to the test target. They make a permissive/broken reader fail this suite.
  const wrongExpected = structuredClone(readerInputs[0]);
  wrongExpected.id = 'HARNESS-reject-changed-expected-cell';
  wrongExpected.parts[0][0] = 'THIS-VALUE-WAS-NOT-EXPORTED';
  const corruptZip = structuredClone(readerInputs[0]);
  corruptZip.id = 'HARNESS-reject-invalid-crc';
  const corruptBytes = Buffer.from(corruptZip.workbook, 'base64');
  const payloadOffset = 30 + corruptBytes.readUInt16LE(26) + corruptBytes.readUInt16LE(28);
  corruptBytes[payloadOffset + 10] ^= 1;
  corruptZip.workbook = corruptBytes.toString('base64');
  readerInputs.push(wrongExpected, corruptZip);
  const python = process.env.PANELREPLY_TEST_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
  const run = spawnSync(python, [path.join(__dirname, 'helpers/release-xlsx-reader.py')], {
    input: JSON.stringify(readerInputs), encoding: 'utf8', timeout: 120000, maxBuffer: 128 * 1024 * 1024, shell: false,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' }
  });
  assert.ifError(run.error);
  assert.equal(run.status, 0, 'independent reader failed: ' + run.stderr.slice(0, 2000));
  const report = JSON.parse(run.stdout);
  assert.equal(report.format, 'panelreply-independent-xlsx-results-v1');
  assert.equal(report.results.length, readerInputs.length);
  for (const result of report.results) {
    if (result.id.startsWith('HARNESS-')) {
      assert.equal(result.status, 'FAIL', 'independent reader accepted its negative control: ' + result.id);
      continue;
    }
    assert.ok(!readerResults.has(result.id), 'duplicate independent result');
    readerResults.set(result.id, result);
  }
  assert.equal(report.results.filter(result => result.id.startsWith('HARNESS-')).length, 2);
});

for (const item of cases) test(item.id + ' | saved-export/' + item.category + ' | input-sha256=' + item.hash, () => {
  const ready = prepared.get(item.id);
  if (ready.error) throw ready.error;
  const inputBefore = structuredClone(item.input);
  const validated = validateProject(item.input);
  assert.deepEqual(validated, { ...inputBefore, name: inputBefore.name.trim() }, 'validation preserves row corrections and only trims the project name');
  assert.deepEqual(item.input, inputBefore, 'validation does not mutate caller data');
  assert.ok(ready.workbook.length < MAX_XLSX_BYTES);
  const reader = readerResults.get(item.id);
  assert.ok(reader, 'missing independent workbook outcome');
  assert.equal(reader.status, 'PASS', reader.error);
  const expectedRows = [HEADERS, ...ready.expected.parts].map(values => values.map(modelCsv));
  assert.deepEqual(parseCsv(ready.csv), expectedRows, 'CSV preserves each corrected field with only documented formula-literal protection');
  assert.doesNotMatch(ready.csv, /MUST-NOT-EXPORT/);
  assert.equal(ready.workbook.includes(Buffer.from('MUST-NOT-EXPORT')), false, 'workbook allowlist excludes private fields');
  assert.deepEqual(ready.saved, ready.savedBefore, 'CSV and XLSX generation do not mutate the saved record');
});

test.after(() => {
  assert.equal(cases.length, ids.size);
  assert.equal(cases.length, hashes.size);
});
