'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { exportProjectXlsx, XLSX_MIME, MAX_XLSX_BYTES } = require('../workspace/xlsx.cjs');
const { project, row, cases, SOURCE_ID } = require('./fixtures/xlsx-projects.cjs');

function entries(buffer) {
  const files = new Map();
  let offset = 0;
  while (buffer.readUInt32LE(offset) === 0x04034b50) {
    const compression = buffer.readUInt16LE(offset + 8), length = buffer.readUInt32LE(offset + 18);
    assert.equal(compression, 0, 'bounded stored ZIP entries');
    const nameLength = buffer.readUInt16LE(offset + 26), extraLength = buffer.readUInt16LE(offset + 28);
    const name = buffer.subarray(offset + 30, offset + 30 + nameLength).toString();
    const begin = offset + 30 + nameLength + extraLength;
    assert.ok(!files.has(name)); files.set(name, buffer.subarray(begin, begin + length).toString());
    offset = begin + length;
  }
  assert.equal(buffer.readUInt32LE(offset), 0x02014b50);
  assert.equal(buffer.readUInt32LE(buffer.length - 22), 0x06054b50);
  assert.equal(buffer.readUInt16LE(buffer.length - 12), files.size);
  assert.equal(buffer.readUInt32LE(buffer.length - 6), offset);
  return files;
}

test('saved XLSX output is deterministic and does not mutate project records', () => {
  const p = project(), before = structuredClone(p);
  const one = exportProjectXlsx(p), two = exportProjectXlsx(p);
  assert.ok(Buffer.isBuffer(one)); assert.deepEqual(one, two); assert.deepEqual(p, before);
  assert.equal(XLSX_MIME, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
});

test('workbook package includes only fixed internal workbook paths', () => {
  const files = entries(exportProjectXlsx(project()));
  assert.deepEqual([...files.keys()], ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml', 'xl/sharedStrings.xml']);
  for (const [name, data] of files) {
    assert.ok(!name.includes('..')); assert.ok(data.startsWith('<?xml version="1.0"'));
    assert.doesNotMatch(data, /<(?:f|hyperlink|externalLink|oleObject|vbaProject|definedNames)(?:\s|>)/);
    if (name.endsWith('.rels')) assert.doesNotMatch(data, /TargetMode="External"|Target="(?:https?:|file:|\/)/);
  }
});

test('part text and formula-looking strings use string cells without executable formulas', () => {
  const p = cases.find(x => x.id === 'formula-looking-values').project;
  const files = entries(exportProjectXlsx(p)), sheet = files.get('xl/worksheets/sheet1.xml');
  assert.equal((sheet.match(/ t="n"/g) || []).length, p.rows.length);
  assert.equal((sheet.match(/ t="s"/g) || []).length, 7 + 6 * p.rows.length);
  assert.match(sheet, /<c r="D2" t="n" s="2"><v>2<\/v><\/c>/);
  assert.doesNotMatch(sheet, /<f(?:\s|>)/);
  assert.match(files.get('xl/sharedStrings.xml'), /<t xml:space="preserve">=1\+1<\/t>/);
});

test('escaping preserves XML delimiters, carriage returns and literal OOXML escape tokens', () => {
  const p = project({ rows: [row({ description: '<tag> & "quoted"\r\nnew line', notes: '_x0041_' })] });
  const text = entries(exportProjectXlsx(p)).get('xl/sharedStrings.xml');
  assert.match(text, /&lt;tag&gt; &amp; "quoted"&#13;\nnew line/);
  assert.match(text, /_x005F_x0041_/);
  assert.doesNotMatch(text, /<tag>/);
});

test('parts sheet includes readable widths, filter, frozen header and typed styles', () => {
  const files = entries(exportProjectXlsx(project()));
  const sheet = files.get('xl/worksheets/sheet1.xml');
  assert.match(sheet, /<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"\/>/);
  assert.match(sheet, /<autoFilter ref="A1:G2"\/>/);
  assert.equal((sheet.match(/<col /g) || []).length, 7);
  assert.match(files.get('xl/styles.xml'), /numFmtId="49"/);
  assert.match(files.get('xl/styles.xml'), /wrapText="1"/);
});

test('empty project export retains both worksheets and column headers', () => {
  const files = entries(exportProjectXlsx(project({ rows: [] })));
  assert.match(files.get('xl/workbook.xml'), /sheet name="Parts"/);
  assert.match(files.get('xl/workbook.xml'), /sheet name="Project"/);
  assert.match(files.get('xl/worksheets/sheet1.xml'), /<dimension ref="A1:G1"\/>/);
  assert.match(files.get('xl/worksheets/sheet1.xml'), /<autoFilter ref="A1:G1"\/>/);
  assert.match(files.get('xl/sharedStrings.xml'), />Part number<\/t>/);
});

test('project metadata exports an allowlist without owner, session or image bytes', () => {
  const p = project({ private: 'secret-session-value', owner: { passwordHash: 'secret-hash-value' }, sources: [{ id: SOURCE_ID, name: 'synthetic.png', data: Buffer.from('private-image-bytes') }] });
  const xml = [...entries(exportProjectXlsx(p)).values()].join('\n');
  assert.match(xml, />Synthetic export project<\/t>/); assert.match(xml, />Saved version<\/t>/);
  assert.doesNotMatch(xml, /secret-session-value|secret-hash-value|private-image-bytes/);
});

test('maximum saved fields and 200 rows remain within the fixed workbook bound', () => {
  const p = cases.find(x => x.id === 'bounded-maximum-records').project;
  const result = exportProjectXlsx(p);
  assert.ok(result.length < MAX_XLSX_BYTES);
  const sheet = entries(result).get('xl/worksheets/sheet1.xml');
  assert.match(sheet, /<autoFilter ref="A1:G201"\/>/); assert.match(sheet, /r="G201"/);
});

test('invalid quantity, field types, oversized rows and invalid review states are rejected', () => {
  for (const change of [{ quantity: 0 }, { quantity: 10000 }, { quantity: '2' }, { quantity: NaN }, { partNumber: 123 }, { notes: 'x'.repeat(1001) }, { reviewStatus: 'verified' }, { sourceImageId: '../source' }]) {
    assert.throws(() => exportProjectXlsx(project({ rows: [row(change)] })), error => error.code === 'invalid_input');
  }
  assert.throws(() => exportProjectXlsx(project({ rows: Array.from({ length: 201 }, () => row()) })), error => error.code === 'invalid_input');
});

test('malformed project identity, version and timestamp cannot produce a workbook', () => {
  for (const change of [{ id: '../private' }, { id: null }, { version: 0 }, { version: '2' }, { createdAt: 'yesterday' }, { updatedAt: '<script>' }]) {
    assert.throws(() => exportProjectXlsx(project(change)));
  }
});

test('source metadata must be unambiguous and belong to the exported project', () => {
  assert.throws(() => exportProjectXlsx(project({ rows: [row({ sourceImageId: SOURCE_ID })] })), error => error.code === 'xlsx_invalid_data');
  assert.throws(() => exportProjectXlsx(project({ sources: [{ id: SOURCE_ID, name: 'one' }, { id: SOURCE_ID, name: 'two' }] })), error => error.code === 'xlsx_invalid_data');
  assert.throws(() => exportProjectXlsx(project({ sources: Array.from({ length: 6 }, () => ({ id: SOURCE_ID, name: 'one' })) })), error => error.code === 'xlsx_invalid_data');
  const p = cases.find(x => x.id === 'source-names-and-review').project;
  assert.match(entries(exportProjectXlsx(p)).get('xl/sharedStrings.xml'), />=synthetic-label.png<\/t>/);
});

test('unsupported XML characters fail explicitly instead of silently changing saved data', () => {
  for (const value of ['\ufffe', '\uffff']) {
    assert.throws(() => exportProjectXlsx(project({ rows: [row({ notes: value })] })), error => error.status === 422 && error.code === 'xlsx_invalid_data' && /CSV/.test(error.message));
  }
  assert.throws(() => exportProjectXlsx(project({ notes: '\ud800' })), error => error.code === 'invalid_input');
});

test('literal x005F_ values use inline rich text without an escape token in any Text element', () => {
  for (const value of ['_x005F_', '_x005F_x0041_', 'prefix-x005F_-suffix']) {
    const files = entries(exportProjectXlsx(project({ rows: [row({ partNumber: value })] })));
    const sheet = files.get('xl/worksheets/sheet1.xml');
    const cell = sheet.match(/<c r="A2" t="inlineStr" s="1"><is>(.*?)<\/is><\/c>/);
    assert.ok(cell);
    const fragments = [...cell[1].matchAll(/<t xml:space="preserve">(.*?)<\/t>/g)].map(match => match[1]);
    assert.ok(fragments.every(fragment => !/_x[0-9a-f]{4}_/i.test(fragment)));
    assert.equal(fragments.join(''), value);
  }
});
