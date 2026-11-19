'use strict';

const { PanelError, MAX_ROWS, MAX_SOURCES, UUID, validateProject, validateVersion } = require('./panels.cjs');

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const MAX_XLSX_BYTES = 4 * 1024 * 1024;
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const HEADERS = Object.freeze(['Part number', 'Manufacturer', 'Description', 'Quantity', 'Source image', 'Review status', 'Notes']);

function invalid(message = 'The saved project could not be exported. Review its fields before trying again.') {
  throw new PanelError(422, 'xlsx_invalid_data', message);
}

function xmlText(value, escapeTokens = true) {
  // Reject characters that XML 1.0 cannot represent. Never silently strip or
  // replace a corrected value. Other existing panel field limits still apply.
  if (typeof value !== 'string' || !value.isWellFormed() || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/u.test(value)) {
    invalid('A saved field contains a character that XLSX cannot preserve. Review the text or use CSV.');
  }
  // Protect literal OOXML escape syntax, such as a part named _x0041_.
  const escaped = escapeTokens ? value.replace(/_x[0-9a-f]{4}_/gi, match => '_x005F_' + match.slice(1)) : value;
  return escaped
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    // A character reference prevents XML line-ending normalization of CR.
    .replace(/\r/g, '&#13;');
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// This writer accepts only the fixed internal paths below. It never reads a ZIP,
// interpolates user paths, compresses untrusted content, or uses temporary files.
// Stored entries and a fixed DOS timestamp keep identical saved exports stable.
function packageFiles(files) {
  const local = [], central = [];
  let offset = 0;
  for (const [name, content] of files) {
    const filename = Buffer.from(name, 'utf8'), bytes = Buffer.from(XML + content, 'utf8');
    if (offset + bytes.length > MAX_XLSX_BYTES) invalid('The saved workbook exceeds the export size limit.');
    const crc = crc32(bytes);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0); header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x0800, 6); header.writeUInt16LE(0, 8);
    header.writeUInt16LE(0, 10); header.writeUInt16LE(33, 12);
    header.writeUInt32LE(crc, 14); header.writeUInt32LE(bytes.length, 18); header.writeUInt32LE(bytes.length, 22);
    header.writeUInt16LE(filename.length, 26);
    local.push(header, filename, bytes);
    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50, 0); directory.writeUInt16LE(20, 4); directory.writeUInt16LE(20, 6);
    directory.writeUInt16LE(0x0800, 8); directory.writeUInt16LE(0, 10);
    directory.writeUInt16LE(0, 12); directory.writeUInt16LE(33, 14);
    directory.writeUInt32LE(crc, 16); directory.writeUInt32LE(bytes.length, 20); directory.writeUInt32LE(bytes.length, 24);
    directory.writeUInt16LE(filename.length, 28); directory.writeUInt32LE(offset, 42);
    central.push(directory, filename);
    offset += header.length + filename.length + bytes.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  const result = Buffer.concat([...local, directory, end]);
  if (result.length > MAX_XLSX_BYTES) invalid('The saved workbook exceeds the export size limit.');
  return result;
}

function validateSavedProject(project) {
  if (!project || typeof project !== 'object' || typeof project.id !== 'string' || !UUID.test(project.id)) invalid();
  validateProject({ name: project.name, notes: project.notes, rows: project.rows });
  validateVersion(project.version);
  for (const field of ['createdAt', 'updatedAt']) {
    if (typeof project[field] !== 'string' || project[field].length > 40 || !/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(project[field]) || !Number.isFinite(Date.parse(project[field]))) invalid();
  }
  if (!Array.isArray(project.sources) || project.sources.length > MAX_SOURCES) invalid();
  const sourceNames = new Map();
  for (const source of project.sources) {
    if (!source || typeof source.id !== 'string' || !UUID.test(source.id) || sourceNames.has(source.id) || typeof source.name !== 'string' || !source.name.trim() || source.name.length > 160) invalid();
    xmlText(source.name);
    sourceNames.set(source.id, source.name);
  }
  if (project.rows.length > MAX_ROWS || project.rows.some(row => row.sourceImageId && !sourceNames.has(row.sourceImageId))) invalid();
  return sourceNames;
}

function exportProjectXlsx(project) {
  const sources = validateSavedProject(project);
  const strings = [], stringIndexes = new Map();
  let stringReferences = 0;
  function textCell(ref, value, style = 1) {
    const encoded = xmlText(value);
    if (value.includes('x005F_')) {
      // Some independent readers remove x005F_ from shared strings, even when
      // it is literal user text. Inline rich text avoids that path. Keep each
      // OOXML escape-looking token split across Text elements, so no individual
      // Text value contains an escape sequence to decode. Formatting is unchanged.
      const fragments = value.split(/(_)(x[0-9a-f]{4}_)/gi).filter(Boolean);
      return `<c r="${ref}" t="inlineStr" s="${style}"><is>${fragments.map(fragment => `<r><t xml:space="preserve">${xmlText(fragment, false)}</t></r>`).join('')}</is></c>`;
    }
    if (!stringIndexes.has(value)) { stringIndexes.set(value, strings.length); strings.push(encoded); }
    stringReferences += 1;
    return `<c r="${ref}" t="s" s="${style}"><v>${stringIndexes.get(value)}</v></c>`;
  }
  function numberCell(ref, value) { return `<c r="${ref}" t="n" s="2"><v>${value}</v></c>`; }
  const partRows = [`<row r="1" ht="28" customHeight="1">${HEADERS.map((value, index) => textCell(String.fromCharCode(65 + index) + '1', value, 3)).join('')}</row>`];
  for (const [index, row] of project.rows.entries()) {
    const n = index + 2;
    const values = [row.partNumber, row.manufacturer, row.description, row.quantity, row.sourceImageId ? sources.get(row.sourceImageId) : '', row.reviewStatus, row.notes];
    const cells = values.map((value, column) => column === 3 ? numberCell('D' + n, value) : textCell(String.fromCharCode(65 + column) + n, value));
    partRows.push(`<row r="${n}">${cells.join('')}</row>`);
  }
  const metadata = [
    ['Project', project.name], ['Project ID', project.id], ['Saved version', String(project.version)],
    ['Created (UTC)', project.createdAt], ['Saved (UTC)', project.updatedAt], ['Project notes', project.notes],
    ['Export contents', 'Saved project state only. Unsaved edits are not included.'],
    ['Review status', 'Reviewed records a human check. It does not establish part authenticity or electrical compatibility.']
  ];
  const projectRows = [`<row r="1" ht="28" customHeight="1">${textCell('A1', 'Project detail', 3)}${textCell('B1', 'Saved value', 3)}</row>`,
    ...metadata.map(([label, value], index) => `<row r="${index + 2}">${textCell('A' + (index + 2), label)}${typeof value === 'number' ? numberCell('B' + (index + 2), value) : textCell('B' + (index + 2), value)}</row>`)];
  const view = '<sheetViews><sheetView workbookViewId="0" showGridLines="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews>';
  const parts = `<worksheet xmlns="${NS}"><dimension ref="A1:G${project.rows.length + 1}"/>${view}<sheetFormatPr defaultRowHeight="18"/><cols>${[24, 25, 52, 12, 30, 19, 52].map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`).join('')}</cols><sheetData>${partRows.join('')}</sheetData><autoFilter ref="A1:G${project.rows.length + 1}"/></worksheet>`;
  const info = `<worksheet xmlns="${NS}"><dimension ref="A1:B9"/>${view}<sheetFormatPr defaultRowHeight="18"/><cols><col min="1" max="1" width="24" customWidth="1"/><col min="2" max="2" width="96" customWidth="1"/></cols><sheetData>${projectRows.join('')}</sheetData></worksheet>`;
  const styles = `<styleSheet xmlns="${NS}"><fonts count="2"><font><sz val="11"/><color rgb="FF172B40"/><name val="Arial"/><family val="2"/></font><font><b/><sz val="11"/><color rgb="FFF4F8FF"/><name val="Arial"/><family val="2"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF132236"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="1" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="top" horizontal="right"/></xf><xf numFmtId="49" fontId="1" fillId="2" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
  return packageFiles([
    ['[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>'],
    ['_rels/.rels', `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ['xl/workbook.xml', `<workbook xmlns="${NS}" xmlns:r="${REL}"><bookViews><workbookView/></bookViews><sheets><sheet name="Parts" sheetId="1" r:id="rId1"/><sheet name="Project" sheetId="2" r:id="rId2"/></sheets></workbook>`],
    ['xl/_rels/workbook.xml.rels', `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${REL}/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="${REL}/styles" Target="styles.xml"/><Relationship Id="rId4" Type="${REL}/sharedStrings" Target="sharedStrings.xml"/></Relationships>`],
    ['xl/styles.xml', styles], ['xl/worksheets/sheet1.xml', parts], ['xl/worksheets/sheet2.xml', info],
    ['xl/sharedStrings.xml', `<sst xmlns="${NS}" count="${stringReferences}" uniqueCount="${strings.length}">${strings.map(value => `<si><t xml:space="preserve">${value}</t></si>`).join('')}</sst>`]
  ]);
}

module.exports = { exportProjectXlsx, XLSX_MIME, MAX_XLSX_BYTES };
