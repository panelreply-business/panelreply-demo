'use strict';

const MAX_ROWS = 200;
const MAX_SOURCES = 5;
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const MAX_PANEL_DATA_BYTES = 32 * 1024 * 1024;
const MAX_PROJECTS_PER_BUSINESS = 200;
const REVIEW_STATUSES = Object.freeze(['unreviewed', 'reviewed']);
const ROW_FIELDS = Object.freeze(['partNumber', 'manufacturer', 'description', 'quantity', 'reviewStatus', 'notes', 'sourceImageId']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

class PanelError extends Error {
  constructor(status, code, message, fields) {
    super(message);
    this.status = status;
    this.code = code;
    if (fields) this.fields = fields;
  }
}
function invalid(message, fields) { throw new PanelError(400, 'invalid_input', message, fields); }
function object(value, allowed, required = allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key)) || required.some(key => !Object.hasOwn(value, key))) invalid('The panel request contains missing or unsupported fields.');
  return value;
}
function text(value, name, limit, required = false) {
  if (typeof value !== 'string' || value.length > limit || !value.isWellFormed() || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) invalid('Check the ' + name + ' field.', [name]);
  if (required && !value.trim()) invalid('The ' + name + ' field is required.', [name]);
  // Rows are a record of the user's corrections. Do not trim or otherwise
  // rewrite those values when saving or exporting them.
  return value;
}
function validateVersion(version) {
  if (!Number.isSafeInteger(version) || version < 1 || version >= Number.MAX_SAFE_INTEGER) invalid('Use the current panel project version.', ['version']);
  return version;
}
function nextVersion(version) {
  if (!Number.isSafeInteger(version) || version < 1 || version >= Number.MAX_SAFE_INTEGER - 1) throw new PanelError(409, 'version_exhausted', 'This panel project reached its revision limit. Export the saved project and ask the operator to review it.');
  return version + 1;
}
function writeTime(time, previous = 0) {
  if (!Number.isSafeInteger(time) || time < 0 || time > 8640000000000000) throw new PanelError(503, 'clock_unavailable', 'Check the workspace clock before changing panel projects.');
  if (time < previous) throw new PanelError(503, 'clock_unavailable', 'The workspace clock moved backwards. Check it before changing this panel project.');
  return time;
}
function validateIdempotencyKey(key) {
  if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(key)) invalid('A panel request retry identifier is required.');
  return key;
}
function validateProject(input, { update = false } = {}) {
  object(input, [...(update ? ['version'] : []), 'name', 'notes', 'rows']);
  if (!Array.isArray(input.rows) || input.rows.length > MAX_ROWS) invalid('Keep a panel project to ' + MAX_ROWS + ' rows.', ['rows']);
  const rows = input.rows.map(row => {
    object(row, ROW_FIELDS);
    if (!Number.isSafeInteger(row.quantity) || row.quantity < 1 || row.quantity > 9999) invalid('Enter a quantity from 1 to 9999.', ['quantity']);
    if (!REVIEW_STATUSES.includes(row.reviewStatus)) invalid('Select an unreviewed or reviewed row status.', ['reviewStatus']);
    if (row.sourceImageId !== null && (typeof row.sourceImageId !== 'string' || !UUID.test(row.sourceImageId))) invalid('Choose a source image from this project.', ['sourceImageId']);
    const result = {
      partNumber: text(row.partNumber, 'partNumber', 128), manufacturer: text(row.manufacturer, 'manufacturer', 120),
      description: text(row.description, 'description', 1000), quantity: row.quantity, reviewStatus: row.reviewStatus,
      notes: text(row.notes, 'notes', 1000), sourceImageId: row.sourceImageId
    };
    if (!result.partNumber.trim() && !result.manufacturer.trim() && !result.description.trim()) invalid('Enter at least one part field before saving a row.', ['rows']);
    if (result.reviewStatus === 'reviewed' && (!result.partNumber.trim() || !result.manufacturer.trim() || !result.description.trim())) invalid('Review requires a part number, manufacturer and description. Keep unknown fields unreviewed.', ['reviewStatus']);
    return result;
  });
  return { ...(update ? { version: validateVersion(input.version) } : {}), name: text(input.name, 'name', 120, true).trim(), notes: text(input.notes, 'notes', 2000), rows };
}
function validateSource(input, inspectImage) {
  object(input, ['version', 'name', 'mime', 'dataBase64']);
  const version = validateVersion(input.version);
  const name = text(input.name, 'name', 160, true).trim();
  if (/[\/\\\r\n\t]/.test(name) || name === '.' || name === '..') invalid('Use an image filename without a path.', ['name']);
  if (!['image/png', 'image/jpeg'].includes(input.mime)) invalid('Use a PNG or JPEG image.', ['mime']);
  const encoded = input.dataBase64;
  if (typeof encoded !== 'string' || encoded.length < 4 || encoded.length > 4 * Math.ceil(MAX_IMAGE_BYTES / 3) || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) invalid('Send a valid image of at most 2 MiB.', ['dataBase64']);
  const bytes = Buffer.from(encoded, 'base64');
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES || bytes.toString('base64') !== encoded) invalid('Send canonical base64 image data of at most 2 MiB.', ['dataBase64']);
  const inspected = inspectImage(bytes);
  if (inspected.mime !== input.mime) invalid('The image type does not match its contents.', ['mime']);
  return { version, name, mime: inspected.mime, bytes, width: inspected.width, height: inspected.height };
}
function csvCell(value) {
  let result = String(value ?? '');
  // Spreadsheet engines can ignore leading whitespace and control characters
  // before interpreting a formula. Prefix the entire original cell so the
  // corrected text, including that prefix, remains present as literal text.
  if (/^[\s\u0000-\u0020\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]*[=+@-]/u.test(result)) result = "'" + result;
  return '"' + result.replace(/"/g, '""') + '"';
}
function exportProjectCsv(project) {
  const sourceNames = new Map(project.sources.map(source => [source.id, source.name]));
  const records = [['Part number', 'Manufacturer', 'Description', 'Quantity', 'Source image', 'Review status', 'Notes']];
  for (const row of project.rows) records.push([row.partNumber, row.manufacturer, row.description, row.quantity, row.sourceImageId ? sourceNames.get(row.sourceImageId) || '' : '', row.reviewStatus, row.notes]);
  return '\ufeff' + records.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

module.exports = { PanelError, MAX_ROWS, MAX_SOURCES, MAX_IMAGE_BYTES, MAX_PANEL_DATA_BYTES, MAX_PROJECTS_PER_BUSINESS, REVIEW_STATUSES, ROW_FIELDS, UUID, validateProject, validateVersion, nextVersion, writeTime, validateIdempotencyKey, validateSource, csvCell, exportProjectCsv };
