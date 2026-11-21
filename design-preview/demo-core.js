(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PanelReplyDemo = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';

  const CALLBACK_WINDOWS = Object.freeze(['Morning', 'Afternoon', 'Evening']);
  const REQUEST_STATUSES = Object.freeze(['New', 'In review', 'Ready for follow-up', 'Closed']);
  const PART_FIELDS = Object.freeze(['partNumber', 'manufacturer', 'description', 'quantity']);
  const PART_LIMITS = Object.freeze({ partNumber: 80, manufacturer: 80, description: 160 });
  const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/u;
  const REQUEST_SEED = [
    { id: 'REQ-1042', customer: 'Jordan Sample', job: 'EV charger installation inquiry', zip: '00000', callback: 'Evening', workDate: '', status: 'New', notes: '', createdLabel: 'Sample · 9:20 AM', history: ['Sample request created. No communication sent.'] },
    { id: 'REQ-1041', customer: 'Morgan Sample', job: 'Panel replacement estimate', zip: '00001', callback: 'Morning', workDate: '', status: 'In review', notes: 'Ask about the existing panel location before quoting.', createdLabel: 'Sample · 8:45 AM', history: ['Sample request created. No communication sent.', 'Sample note added for contractor review.'] },
    { id: 'REQ-1040', customer: 'Casey Sample', job: 'Add lighting in a workshop', zip: '00002', callback: 'Afternoon', workDate: '', status: 'New', notes: '', createdLabel: 'Sample · Yesterday', history: ['Sample request created. No communication sent.'] }
  ];
  const PART_SEED = [
    { id: 'sample-part-1', partNumber: 'DEMO-101', manufacturer: 'Example Electric', description: 'Sample component A', quantity: '2', source: 'Sample label A', reviewed: false },
    { id: 'sample-part-2', partNumber: 'DEMO-202', manufacturer: 'Example Electric', description: 'Sample component B', quantity: '1', source: 'Sample label A', reviewed: false },
    { id: 'sample-part-3', partNumber: 'DEMO-303', manufacturer: 'Sample Supply', description: 'Sample component C', quantity: '4', source: 'Sample label A', reviewed: false }
  ];

  function freshRequests() {
    return REQUEST_SEED.map(request => ({ ...request, history: request.history.slice() }));
  }

  function freshParts() {
    return PART_SEED.map(part => ({ ...part }));
  }

  function clean(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function validDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
    const [year, month, day] = value.split('-').map(Number);
    if (year < 2000 || year > 9999) return false;
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  }

  function validateRequest(input) {
    const value = {
      job: clean(input && input.job),
      zip: clean(input && input.zip),
      callback: clean(input && input.callback),
      workDate: clean(input && input.workDate)
    };
    const errors = {};
    if (value.job.length < 4 || !/[\p{L}\p{N}]/u.test(value.job)) errors.job = 'Enter at least 4 characters describing a sample job.';
    else if (value.job.length > 140) errors.job = 'Keep the sample job to 140 characters.';
    else if (CONTROL_CHARACTERS.test(value.job)) errors.job = 'Enter the sample job on one line without control characters.';
    if (!/^\d{5}$/u.test(value.zip)) errors.zip = 'Enter 5 digits, such as the sample ZIP 00000.';
    if (!CALLBACK_WINDOWS.includes(value.callback)) errors.callback = 'Choose a callback window.';
    if (value.workDate && !validDate(value.workDate)) errors.workDate = 'Choose a calendar date, or leave the requested date blank.';
    return { valid: Object.keys(errors).length === 0, value, errors };
  }

  function filterRequests(requests, query, status) {
    const needle = clean(query).toLocaleLowerCase('en-US');
    return requests.filter(request => {
      const statusMatches = !status || status === 'All' || request.status === status;
      const text = [request.id, request.customer, request.job, request.zip].join(' ').toLocaleLowerCase('en-US');
      return statusMatches && (!needle || text.includes(needle));
    });
  }

  function requestCounts(requests) {
    return {
      total: requests.length,
      awaitingReview: requests.filter(request => request.status === 'New').length,
      inReview: requests.filter(request => request.status === 'In review').length
    };
  }

  function validateNote(value) {
    const note = clean(value);
    if (note.length > 500) return { valid: false, value: note, error: 'Keep the sample note to 500 characters.' };
    if (/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/u.test(note)) return { valid: false, value: note, error: 'Remove control characters from the sample note.' };
    return { valid: true, value: note, error: '' };
  }

  function newPart(id) {
    return { id, partNumber: '', manufacturer: '', description: '', quantity: '1', source: 'Manual entry', reviewed: false };
  }

  function editPart(part, field, value) {
    if (!PART_FIELDS.includes(field)) throw new TypeError('This part field cannot be edited.');
    return { ...part, [field]: String(value), reviewed: false };
  }

  function partNeedsRemovalConfirmation(part) {
    if (part.reviewed) return true;
    const initial = PART_SEED.find(item => item.id === part.id);
    if (initial) return PART_FIELDS.some(field => String(part[field]) !== initial[field]);
    return ['partNumber', 'manufacturer', 'description'].some(field => typeof part[field] === 'string' && part[field].trim()) || String(part.quantity) !== '1';
  }

  function partsMatchSample(parts) {
    if (!Array.isArray(parts) || parts.length !== PART_SEED.length) return false;
    return PART_SEED.every((initial, index) => {
      const part = parts[index];
      return part.id === initial.id && !part.reviewed && PART_FIELDS.every(field => String(part[field]) === initial[field]);
    });
  }

  function validatePart(part, options = {}) {
    const errors = {};
    for (const [field, limit] of Object.entries(PART_LIMITS)) {
      const value = typeof part[field] === 'string' ? part[field] : '';
      if (value.length > limit) errors[field] = `Use ${limit} characters or fewer.`;
      else if (CONTROL_CHARACTERS.test(value)) errors[field] = 'Remove control characters from this field.';
      else if (options.requireComplete && !value.trim()) errors[field] = 'Enter a value before marking this row reviewed.';
    }
    if (!/^\d{1,4}$/u.test(String(part.quantity)) || Number(part.quantity) < 1 || Number(part.quantity) > 9999) errors.quantity = 'Enter a whole quantity from 1 to 9999.';
    if (!options.requireComplete && !['partNumber', 'manufacturer', 'description'].some(field => typeof part[field] === 'string' && part[field].trim())) errors.row = 'Add at least one part detail, or remove the empty row.';
    return { valid: Object.keys(errors).length === 0, errors };
  }

  function safeCsvCell(value) {
    const text = value == null ? '' : String(value);
    const formulaPrefix = /^[\s\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f]*[=+\-@＝＋－＠]/u;
    const safe = formulaPrefix.test(text) || /^[\t\r\n]/u.test(text) ? "'" + text : text;
    return '"' + safe.replace(/"/gu, '""') + '"';
  }

  function exportParts(parts) {
    if (!Array.isArray(parts) || parts.length === 0) return { valid: false, error: 'Add a sample part before exporting.', rowErrors: [] };
    const rowErrors = parts.map((part, index) => ({ index, ...validatePart(part) })).filter(result => !result.valid);
    if (rowErrors.length) return { valid: false, error: 'Correct the highlighted part details before exporting.', rowErrors };
    const headers = ['Part number', 'Manufacturer', 'Description', 'Quantity', 'Source image', 'Review status'];
    const rows = parts.map(part => [part.partNumber, part.manufacturer, part.description, part.quantity, part.source, part.reviewed ? 'Reviewed' : 'Unreviewed']);
    return {
      valid: true,
      csv: '\ufeff' + [headers, ...rows].map(row => row.map(safeCsvCell).join(',')).join('\r\n') + '\r\n',
      unreviewed: parts.filter(part => !part.reviewed).length,
      count: parts.length
    };
  }

  return Object.freeze({ CALLBACK_WINDOWS, REQUEST_STATUSES, PART_FIELDS, PART_LIMITS, freshRequests, freshParts, validDate, validateRequest, filterRequests, requestCounts, validateNote, newPart, editPart, partNeedsRemovalConfirmation, partsMatchSample, validatePart, safeCsvCell, exportParts });
});
