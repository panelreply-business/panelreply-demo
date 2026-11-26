'use strict';

const ID = '1b64e22f-7273-4c63-b4c8-62acbd2a7dc4';
const SOURCE_ID = '63c3dba1-e2b8-44f2-acd2-2c1337c51881';
function row(overrides = {}) {
  return { partNumber: '001234', manufacturer: 'SYNTHETIC PARTS', description: 'Synthetic component', quantity: 2, reviewStatus: 'unreviewed', sourceImageId: null, notes: '', ...overrides };
}
function project(overrides = {}) {
  return { id: ID, name: 'Synthetic export project', notes: '', rows: [row()], sources: [], version: 3, createdAt: '2026-11-19T10:00:00.000Z', updatedAt: '2026-11-19T11:00:00.000Z', ...overrides };
}

const cases = [
  { id: 'empty', project: project({ rows: [] }) },
  { id: 'leading-zero-and-number-like-identifiers', project: project({ rows: ['0000123', '12345678901234567890', '1E10', '03/04', '+000123', '-000123'].map(partNumber => row({ partNumber })) }) },
  { id: 'unicode-xml-whitespace', project: project({ name: 'Synthetic Ω panel', notes: '  Preserve\r\nthese\tspaces  ', rows: [row({ partNumber: '  000Ω-电-🔌  ', manufacturer: 'Ångström & <SYNTHETIC>', description: 'Quoted "description", with comma\nsecond line\rthird line\r\nfourth line', notes: '日本語 العربية e\u0301 \u200btext' })] }) },
  { id: 'formula-looking-values', project: project({ name: '=SYNTHETIC()', notes: '@text', rows: ['=1+1', '+SUM(A1:A2)', '-1+2', '@SUM(A1:A2)', '\t =HYPERLINK("https://invalid.example")', '=cmd|\'/C example\'!A1', '\u200b=1+1'].map(value => row({ partNumber: value, manufacturer: value, description: value, notes: value })) }) },
  { id: 'literal-ooxml-escape-syntax', project: project({ rows: ['_x0041_', '_x000D_', '_X0041_', '_x005f_', '_x005F_', '_x005F_x0041_', 'prefix-x005F_-suffix', '_x1234_ suffix'].map(value => row({ partNumber: value, notes: value })) }) },
  { id: 'source-names-and-review', project: project({ sources: [{ id: SOURCE_ID, name: '=synthetic-label.png' }], rows: [row({ sourceImageId: SOURCE_ID, reviewStatus: 'reviewed', quantity: 9999 })] }) },
  { id: 'missing-values-stay-blank', project: project({ rows: [row({ partNumber: '', manufacturer: '', description: 'Only a description is known' }), row({ description: '', manufacturer: '' })] }) },
  { id: 'maximum-saved-version', project: project({ version: Number.MAX_SAFE_INTEGER - 1 }) },
  { id: 'bounded-maximum-records', project: project({ notes: 'N'.repeat(2000), rows: Array.from({ length: 200 }, (_, index) => row({ partNumber: String(index).padStart(128, '0'), manufacturer: 'M'.repeat(120), description: '&'.repeat(1000), notes: '<'.repeat(1000), quantity: index + 1 })) }) }
];

module.exports = { project, row, cases, ID, SOURCE_ID };
