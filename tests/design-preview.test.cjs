'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const core = require('../design-preview/demo-core.js');
const demoDirectory = path.join(__dirname, '..', 'design-preview');

test('sample request resets discard edits and isolate nested communication history', () => {
  const requests = core.freshRequests();
  requests[0].job = 'Changed locally';
  requests[0].history.push('Changed locally');
  requests.pop();
  const reset = core.freshRequests();
  assert.equal(reset.length, 3);
  assert.equal(reset[0].job, 'EV charger installation inquiry');
  assert.equal(reset[0].history.length, 1);
  assert.equal(reset[0].status, 'New');
});

test('request validation accepts a complete sample and trims input', () => {
  const result = core.validateRequest({ job: '  Add workshop lighting  ', zip: ' 00000 ', callback: 'Morning', workDate: '2028-02-29' });
  assert.equal(result.valid, true);
  assert.deepEqual(result.value, { job: 'Add workshop lighting', zip: '00000', callback: 'Morning', workDate: '2028-02-29' });
});

test('request validation reports missing, whitespace, invalid ZIP and unsupported callback values', () => {
  const result = core.validateRequest({ job: '    ', zip: '1234a', callback: 'Confirmed appointment', workDate: '2027-02-29' });
  assert.equal(result.valid, false);
  assert.deepEqual(Object.keys(result.errors).sort(), ['callback', 'job', 'workDate', 'zip']);
  assert.equal(core.validateRequest().valid, false);
});

test('request validation rejects punctuation-only, control characters and overlong descriptions', () => {
  for (const job of ['....', 'Work\nnow', 'Work\u0000now', 'A'.repeat(141)]) {
    assert.ok(core.validateRequest({ job, zip: '00000', callback: 'Morning' }).errors.job);
  }
});

test('request dates validate actual days without assigning appointment status', () => {
  assert.equal(core.validDate('2028-02-29'), true);
  for (const value of ['2026-02-29', '2026-04-31', '2026-13-01', '2026-00-01', '2026-12-00', '26-11-19', '1999-12-31', '2026-01-01T00:00:00Z']) assert.equal(core.validDate(value), false);
  assert.equal(core.validateRequest({ job: 'Sample job', zip: '00000', callback: 'Morning', workDate: '' }).valid, true);
});

test('literal HTML stays text data and is never treated as markup by the core', () => {
  const literal = '<img src=x onerror=alert(1)>';
  const result = core.validateRequest({ job: literal, zip: '00000', callback: 'Morning' });
  assert.equal(result.valid, true);
  assert.equal(result.value.job, literal);
  assert.equal(core.validateNote(literal).value, literal);
});

test('request counts reflect real statuses and filtered search has an empty result', () => {
  const requests = core.freshRequests();
  assert.deepEqual(core.requestCounts(requests), { total: 3, awaitingReview: 2, inReview: 1 });
  assert.equal(core.filterRequests(requests, ' MORGAN ', 'All').length, 1);
  assert.equal(core.filterRequests(requests, 'REQ-1041', 'In review').length, 1);
  assert.equal(core.filterRequests(requests, 'REQ-1041', 'New').length, 0);
  assert.equal(core.filterRequests(requests, 'unknown job', 'All').length, 0);
  requests[0].status = 'Closed';
  assert.equal(core.requestCounts(requests).awaitingReview, 1);
});

test('sample notes allow plain text and newlines but reject oversized or control content', () => {
  assert.equal(core.validateNote('  Ask about access.\nReview photos.  ').value, 'Ask about access.\nReview photos.');
  assert.equal(core.validateNote('x'.repeat(501)).valid, false);
  assert.equal(core.validateNote('Bad\u0000note').valid, false);
  assert.equal(core.validateNote('').valid, true);
});

test('part resets restore fictional sample data without sharing mutable rows', () => {
  const edited = core.freshParts();
  edited[0].manufacturer = 'Changed';
  edited[0].reviewed = true;
  edited.splice(1);
  const reset = core.freshParts();
  assert.equal(reset.length, 3);
  assert.equal(reset[0].manufacturer, 'Example Electric');
  assert.equal(reset[0].reviewed, false);
  assert.match(reset[0].partNumber, /^DEMO-/);
});

test('editing any permitted part field clears prior review without mutating the source', () => {
  const original = { ...core.freshParts()[0], reviewed: true };
  for (const field of core.PART_FIELDS) {
    const edited = core.editPart(original, field, 'Changed');
    assert.equal(edited.reviewed, false);
    assert.equal(original.reviewed, true);
  }
  assert.throws(() => core.editPart(original, 'source', 'Untrusted source'), TypeError);
  assert.throws(() => core.editPart(original, '__proto__', 'value'), TypeError);
});

test('untouched sample rows can be removed without a correction confirmation', () => {
  for (const part of core.freshParts()) assert.equal(core.partNeedsRemovalConfirmation(part), false);
});

test('removing a corrected or reviewed row requires confirmation', () => {
  for (const field of core.PART_FIELDS) {
    const part = core.freshParts()[0];
    part[field] = field === 'quantity' ? '3' : 'Corrected value';
    assert.equal(core.partNeedsRemovalConfirmation(part), true, field);
  }
  assert.equal(core.partNeedsRemovalConfirmation({ ...core.freshParts()[0], reviewed: true }), true);
});

test('removal confirmation protects manual values but permits removing an empty new row', () => {
  const blank = core.newPart('new-part-1');
  assert.equal(core.partNeedsRemovalConfirmation(blank), false);
  assert.equal(core.partNeedsRemovalConfirmation({ ...blank, description: 'Manually entered sample' }), true);
  assert.equal(core.partNeedsRemovalConfirmation({ ...blank, manufacturer: 'Example manufacturer' }), true);
  assert.equal(core.partNeedsRemovalConfirmation({ ...blank, quantity: '2' }), true);
});

test('walkthrough change detection includes corrected, reviewed, removed and reordered rows', () => {
  assert.equal(core.partsMatchSample(core.freshParts()), true);
  const parts = core.freshParts();
  parts[0].partNumber = 'CORRECTED';
  assert.equal(core.partsMatchSample(parts), false);
  assert.equal(core.partsMatchSample(core.freshParts().slice(1)), false);
  assert.equal(core.partsMatchSample(core.freshParts().reverse()), false);
  assert.equal(core.partsMatchSample([{ ...core.freshParts()[0], reviewed: true }, ...core.freshParts().slice(1)]), false);
  assert.equal(core.partsMatchSample(null), false);
});

test('a blank manual part is unreviewed and cannot export until it contains a detail', () => {
  const part = core.newPart('new-1');
  assert.equal(part.source, 'Manual entry');
  assert.equal(part.reviewed, false);
  assert.equal(core.validatePart(part).valid, false);
  part.description = 'Unreadable identifier; manual review needed';
  assert.equal(core.validatePart(part).valid, true);
  assert.equal(core.validatePart(part, { requireComplete: true }).valid, false);
  assert.equal(core.exportParts([part]).valid, true);
  assert.match(core.exportParts([part]).csv, /"Unreviewed"/);
});

test('part validation rejects fractional, negative, zero, nonnumeric and excessive quantities', () => {
  for (const quantity of ['', '0', '-1', '1.5', '10000', '1e3', '=1+1', ' 2']) {
    assert.ok(core.validatePart({ ...core.freshParts()[0], quantity }).errors.quantity, quantity);
  }
  assert.equal(core.validatePart({ ...core.freshParts()[0], quantity: '9999' }).valid, true);
});

test('part validation checks lengths and control characters rather than truncating corrections', () => {
  const part = { ...core.freshParts()[0], partNumber: 'x'.repeat(81), manufacturer: 'A\u0000B', description: 'x'.repeat(161) };
  assert.deepEqual(Object.keys(core.validatePart(part).errors).sort(), ['description', 'manufacturer', 'partNumber']);
});

test('CSV cells preserve quotes, delimiters, line breaks, Unicode and zero', () => {
  assert.equal(core.safeCsvCell('part, "corrected"'), '"part, ""corrected"""');
  assert.equal(core.safeCsvCell('Line one\r\nLine two'), '"Line one\r\nLine two"');
  assert.equal(core.safeCsvCell('Échantillon Ω'), '"Échantillon Ω"');
  assert.equal(core.safeCsvCell(0), '"0"');
  assert.equal(core.safeCsvCell(null), '""');
});

test('CSV formula injection is neutralized through whitespace and invisible prefixes', () => {
  for (const value of ['=1+1', '+SUM(A1:A2)', '-2+3', '@SUM(A1)', '  =1+1', '\t=1+1', '\r=1+1', '\n=1+1', '\ufeff=1+1', '\u200b=1+1', '\u0000=1+1', '\u2066=1+1', '＝1+1', '\tplain text']) {
    assert.equal(core.safeCsvCell(value).slice(0, 2), '"\'', JSON.stringify(value));
  }
  assert.equal(core.safeCsvCell('DEMO-101'), '"DEMO-101"');
});

test('CSV export contains corrected data, review state, BOM and consistent CRLF records', () => {
  const parts = core.freshParts();
  parts[0].description = 'Corrected, "quoted" sample';
  parts[0].reviewed = true;
  const result = core.exportParts(parts);
  assert.equal(result.valid, true);
  assert.equal(result.count, 3);
  assert.equal(result.unreviewed, 2);
  assert.equal(result.csv.charCodeAt(0), 0xfeff);
  assert.match(result.csv, /"Corrected, ""quoted"" sample"/);
  assert.match(result.csv, /"Reviewed"/);
  assert.match(result.csv, /"Unreviewed"/);
  assert.equal(result.csv.split('\r\n').length, 5);
  assert.equal(result.csv.replace(/\r\n/gu, '').includes('\n'), false);
});

test('empty or invalid part exports fail with actionable row information', () => {
  assert.equal(core.exportParts([]).valid, false);
  assert.equal(core.exportParts(null).valid, false);
  const parts = core.freshParts();
  parts[1].quantity = '0';
  const result = core.exportParts(parts);
  assert.equal(result.valid, false);
  assert.equal(result.rowErrors.length, 1);
  assert.equal(result.rowErrors[0].index, 1);
  assert.ok(result.rowErrors[0].errors.quantity);
});

test('preview has a restrictive CSP and no external assets, browser storage or active submission', () => {
  const html = fs.readFileSync(path.join(demoDirectory, 'index.html'), 'utf8');
  const controller = fs.readFileSync(path.join(demoDirectory, 'app.js'), 'utf8');
  assert.match(html, /connect-src 'none'/);
  assert.match(html, /form-action 'none'/);
  assert.match(html, /object-src 'none'/);
  assert.match(html, /base-uri 'none'/);
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/iu);
  assert.doesNotMatch(html, /\s(?:style|on\w+)\s*=/iu);
  assert.doesNotMatch(html, /(?:src|href)=["']https?:\/\//iu);
  assert.doesNotMatch(controller, /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|localStorage|sessionStorage|indexedDB)\b|sendBeacon\s*\(/u);
  assert.doesNotMatch(controller, /innerHTML|outerHTML|insertAdjacentHTML|document\.write/u);
});

test('preview exposes accessible demo tabs and explicitly describes capability boundaries', () => {
  const html = fs.readFileSync(path.join(demoDirectory, 'index.html'), 'utf8');
  const css = fs.readFileSync(path.join(demoDirectory, 'styles.css'), 'utf8');
  const controller = fs.readFileSync(path.join(demoDirectory, 'app.js'), 'utf8');
  for (const id of ['intake-tab', 'parts-tab', 'intake-panel', 'parts-panel', 'request-form', 'request-list', 'parts-body', 'export', 'reset-parts', 'demo-status']) assert.ok(html.includes(`id="${id}"`), id);
  assert.match(html, /aria-controls="intake-panel"/u);
  assert.match(html, /aria-controls="parts-panel"/u);
  assert.match(html, /not an appointment/u);
  assert.match(html, /No live OCR/u);
  assert.match(html, /requires review/iu);
  assert.match(css, /prefers-reduced-motion/u);
  assert.match(controller, /ArrowRight/u);
  assert.match(controller, /ArrowLeft/u);
  assert.match(controller, /Home/u);
  assert.match(controller, /End/u);
});

test('guided sample states explain predetermined data and expose skip and confirmation controls', () => {
  const html = fs.readFileSync(path.join(demoDirectory, 'index.html'), 'utf8');
  const controller = fs.readFileSync(path.join(demoDirectory, 'app.js'), 'utf8');
  for (const id of ['start-parts-walkthrough', 'parts-walkthrough', 'walkthrough-source', 'walkthrough-output', 'walkthrough-next', 'walkthrough-skip', 'walkthrough-close', 'walkthrough-preserved', 'remove-part-dialog', 'cancel-remove-part', 'confirm-remove-part']) assert.ok(html.includes(`id="${id}"`), id);
  assert.match(html, /predetermined sample values/u);
  assert.match(html, /does not analyze the image or run OCR/u);
  assert.match(controller, /reducedMotion\.matches/u);
  assert.match(controller, /window\.clearTimeout\(walkthroughTimer\)/u);
});

test('light and dark mark assets use the same original geometry without external references', () => {
  const dark = fs.readFileSync(path.join(demoDirectory, 'mark-on-dark.svg'), 'utf8');
  const light = fs.readFileSync(path.join(demoDirectory, 'mark-on-light.svg'), 'utf8');
  const defaultMark = fs.readFileSync(path.join(demoDirectory, 'mark.svg'), 'utf8');
  assert.equal(defaultMark, dark);
  assert.deepEqual([...dark.matchAll(/\bd="([^"]+)"/gu)].map(match => match[1]), [...light.matchAll(/\bd="([^"]+)"/gu)].map(match => match[1]));
  assert.notEqual(dark, light);
  for (const svg of [dark, light]) {
    assert.match(svg, /viewBox="0 0 40 40"/u);
    assert.doesNotMatch(svg, /<script|<image|href=|onload=|font-family/iu);
  }
});
