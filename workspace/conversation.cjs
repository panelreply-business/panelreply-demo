'use strict';

const intake = require('../src/intake.js');
const questions = require('../src/questions.js');

// This is a deterministic preview. No provider, calendar or messaging client is
// imported. Structured review remains the authority for the request being saved.
const LIMITS = Object.freeze({ customerName: 120, phone: 40, job: 2000, zip: 5, callbackWindow: 200, requestedWorkDate: 200 });
const FIELDS = Object.freeze(Object.keys(LIMITS));
const LABELS = Object.freeze({ customerName: 'customer name', phone: 'callback number', job: 'electrical work', zip: 'job ZIP', callbackWindow: 'callback window', requestedWorkDate: 'requested work date' });
const STATE_KEYS = [...FIELDS, 'stopped', 'hold', 'issues', 'conversation'];
const BAD_CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const CORRECTION = /^(?:(?:actually|correction)\s*[:,]?\s*|(?:change|update|correct)\s+(?:my|the)\s+)/i;
const BUSINESS_TOPICS = new Set(['services', 'pricing', 'estimates', 'hours', 'serviceArea', 'contact', 'qualifications', 'emergencyAvailability', 'permits', 'warranty', 'financing']);
const MAX_CONVERSATION_TEXT = 20000;

class PreviewError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
function invalid(message) { throw new PreviewError(400, 'invalid_input', message); }
function plainObject(value) { return !!value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value)); }
function clean(value) { return intake.normalize(value).replace(/^[\s,;:.!?]+|[\s,;:.!?]+$/g, '').trim(); }
function normalizePhone(value) {
  const input = value.trim();
  if (!/^\+?[\d\s().-]+$/.test(input) || (input.startsWith('+') && !input.startsWith('+1'))) return null;
  let digits = input.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);
  return /^[2-9]\d{2}[2-9]\d{6}$/.test(digits) ? '+1' + digits : null;
}
function blankState() {
  return { customerName: '', phone: '', job: '', zip: '', callbackWindow: '', requestedWorkDate: '', stopped: false, hold: false, issues: [], conversation: [] };
}
function validateState(value) {
  if (value === undefined || value === null) return blankState();
  if (!plainObject(value) || Object.keys(value).some(key => !STATE_KEYS.includes(key))) invalid('The preview draft contains unsupported fields.');
  const state = blankState();
  for (const key of FIELDS) {
    if (!Object.hasOwn(value, key)) continue;
    if (typeof value[key] !== 'string' || value[key].length > LIMITS[key] || BAD_CONTROL.test(value[key])) invalid('Check the ' + LABELS[key] + ' in the preview draft.');
    state[key] = value[key].trim();
  }
  if (state.zip && !/^\d{5}$/.test(state.zip)) invalid('The job ZIP must contain five digits.');
  if (state.phone) {
    const normalized = normalizePhone(state.phone);
    if (!normalized) invalid('The preview callback number must be a valid ten-digit US number.');
    state.phone = normalized;
  }
  for (const key of ['stopped', 'hold']) {
    if (Object.hasOwn(value, key) && typeof value[key] !== 'boolean') invalid('The preview status is invalid.');
    if (Object.hasOwn(value, key)) state[key] = value[key];
  }
  if (Object.hasOwn(value, 'issues')) {
    if (!Array.isArray(value.issues) || value.issues.some(key => !FIELDS.includes(key)) || value.issues.length > FIELDS.length) invalid('The preview clarification fields are invalid.');
    state.issues = [...new Set(value.issues)];
  }
  if (Object.hasOwn(value, 'conversation')) {
    if (!Array.isArray(value.conversation) || value.conversation.length > 60) invalid('The preview conversation is too long. Save this request before starting another draft.');
    state.conversation = value.conversation.map(item => {
      if (!plainObject(item) || Object.keys(item).some(key => !['role', 'text'].includes(key)) || !['customer', 'assistant'].includes(item.role)
        || typeof item.text !== 'string' || !item.text.trim() || item.text.length > 2000 || BAD_CONTROL.test(item.text)) invalid('The preview conversation contains an invalid message.');
      return { role: item.role, text: item.text };
    });
  }
  if (state.conversation.reduce((total, item) => total + item.text.length, 0) > MAX_CONVERSATION_TEXT) invalid('The preview conversation is too long. Save this request before starting another draft.');
  // A safety hold cannot be removed by changing a client-side boolean.
  if (intake.isUrgent(state.job) || state.conversation.some(item => item.role === 'customer' && intake.isUrgent(item.text))) state.hold = true;
  return state;
}

function splitDetailClauses(details) {
  // Split only before explicit field phrases, preserving job prose and times.
  return details.replace(/\s+(?:and|also)\s+(?=(?:(?:my|our|the|job|correct|new)\s+)*zip\b)/gi, '\n')
    .replace(/\s+(?:and\s+|also\s+)?(?=(?:(?:my|our)\s+(?:name|phone|number)|(?:name|phone|job|callback|work date|requested work date)\s*:|(?:please\s+)?call\s+(?:me|us)\b|(?:i|we)\s+(?:need|want|require)\b))/gi, '\n')
    .split(/[.!?](?=\s|$)|[\n;,]+/).map(clean).filter(Boolean);
}

function collectContacts(clauses, state) {
  const remaining = [];
  const candidates = { customerName: [], phone: [] };
  const invalidFields = new Set();
  for (const clause of clauses) {
    const corrected = CORRECTION.test(clause) || /\binstead$/i.test(clause);
    const value = clause.replace(CORRECTION, '').replace(/\s+instead$/i, '').trim();
    const name = value.match(/^(?:(?:my|our)\s+)?name\s*(?:is\s+|[:=]\s*|to\s+)(.+)$/i);
    if (name) {
      const supplied = clean(name[1]);
      if (supplied.length > 120 || !/[\p{L}]/u.test(supplied) || /\d/.test(supplied)) invalidFields.add('customerName');
      else candidates.customerName.push({ value: supplied, corrected });
      continue;
    }
    const phone = value.match(/^(?:(?:(?:my|our)\s+)?(?:phone(?:\s+number)?|number|telephone|mobile)\s*(?:is\s+|[:=]\s*|to\s+)|(?:(?:can|could|would|will)\s+you\s+(?:please\s+)?)?(?:please\s+)?(?:call|reach|contact)\s+(?:me|us)\s+(?:at|on)\s+)(.+)$/i);
    const bareNumber = !phone && /^[+\d][\d\s().-]{8,}$/.test(value) && value.replace(/\D/g, '').length >= 10;
    if (phone || bareNumber) {
      const supplied = phone ? phone[1] : value;
      // A phone and callback time may share one explicit contact clause.
      const numberPart = supplied.match(/^([+\d(][\d\s().-]*\d)(?:\s+(?:on\s+)?(.*))?$/i);
      const normalized = normalizePhone(numberPart ? numberPart[1] : supplied);
      if (!normalized) invalidFields.add('phone');
      else candidates.phone.push({ value: normalized, corrected });
      if (normalized && numberPart && numberPart[2]) remaining.push('Callback: ' + numberPart[2]);
      continue;
    }
    remaining.push(clause);
  }
  for (const key of ['customerName', 'phone']) applyCandidates(key, candidates[key], invalidFields.has(key), state);
  return remaining;
}

function applyCandidates(key, candidates, invalidValue, state) {
  if (!candidates.length && !invalidValue) return;
  const explicitCorrection = candidates.findLastIndex(item => item.corrected);
  const relevant = explicitCorrection >= 0 ? candidates.slice(explicitCorrection) : candidates;
  const unique = [...new Set(relevant.map(item => item.value))];
  if (invalidValue || unique.length !== 1 || unique[0].length > LIMITS[key]) {
    state.issues = [...new Set([...state.issues, key])];
    return;
  }
  state[key] = unique[0];
  state.issues = state.issues.filter(item => item !== key);
}

function extractDetails(clauses, state) {
  const candidates = { callbackWindow: [], requestedWorkDate: [] };
  const rest = [];
  for (const clause of clauses) {
    const corrected = CORRECTION.test(clause) || /\binstead$/i.test(clause);
    const value = clause.replace(CORRECTION, '').replace(/\s+instead$/i, '').trim();
    const callback = value.match(/^(?:(?:(?:my|the|preferred)\s+)?(?:callback(?:\s+(?:time|window))?|preferred callback time)\s*(?:is\s+|[:=]\s*|to\s+)|(?:(?:can|could|would|will)\s+you\s+(?:please\s+)?)?(?:please\s+)?(?:call(?:\s+(?:me|us))?(?:\s+back)?|reach\s+me|contact\s+me)\s+)(.+)$/i);
    if (callback) {
      candidates.callbackWindow.push({ value: clean(callback[1]).replace(/^on\s+/i, ''), corrected });
      continue;
    }
    const workDate = value.match(/^(?:(?:(?:my|the|requested|preferred)\s+)*(?:work|service|job)\s+date\s*(?:is\s+|[:=]\s*|to\s+)|(?:i|we)\s+(?:need|want|prefer)\s+(?:the\s+)?(?:work|job|installation|repair)\s+(?:done|completed|finished)\s*|(?:please\s+)?(?:come\s+(?:by|over)|visit(?:\s+(?:me|us))?|stop\s+by)\s+)(.+)$/i);
    if (workDate) {
      candidates.requestedWorkDate.push({ value: clean(workDate[1]), corrected });
      continue;
    }
    rest.push(clause);
  }
  for (const key of Object.keys(candidates)) applyCandidates(key, candidates[key], false, state);
  const detailText = rest.join('. ');
  if (!detailText) return;
  const extracted = intake.extractFields(detailText, { job: state.job, zip: state.zip, timing: '' });
  if (extracted.ambiguous) state.issues = [...new Set([...state.issues, 'zip'])];
  if (extracted.zip) applyCandidates('zip', [{ value: extracted.zip, corrected: true }], false, state);
  if (extracted.job) applyCandidates('job', [{ value: extracted.job, corrected: true }], false, state);
  if (extracted.timing) {
    // A date attached to a job describes the requested work, not permission to
    // call. A bare date remains ambiguous until reviewed under a named field.
    const attachedToJob = /\b(?:(?:i|we)\s+(?:need|want|require)|install|repair|replace|fix|upgrade|wire|rewire|inspect|troubleshoot|add|move|(?:job|work)\s*:)\b/i.test(detailText);
    if (attachedToJob) applyCandidates('requestedWorkDate', [...candidates.requestedWorkDate, { value: extracted.timing, corrected: CORRECTION.test(detailText) }], false, state);
    else state.issues = [...new Set([...state.issues, 'callbackWindow', 'requestedWorkDate'])];
  }
}

function requestField(key, state) {
  const unclear = state.issues.includes(key) ? ' This still needs confirmation.' : '';
  return (state[key] ? 'Your recorded ' + LABELS[key] + ' is ' + state[key] + '.' : 'You have not provided the ' + LABELS[key] + ' yet.') + unclear
    + (['callbackWindow', 'requestedWorkDate'].includes(key) ? ' No appointment is booked.' : '');
}
function requestSummary(state) {
  return 'Here is the draft so far.\n' + FIELDS.map(key => LABELS[key][0].toUpperCase() + LABELS[key].slice(1) + ': ' + (state[key] || 'Not provided') + (state.issues.includes(key) ? ' (needs confirmation)' : '')).join('\n') + '\nReview the fields before saving. No appointment is booked.';
}
function answerQuestion(question, state, profile) {
  const lower = question.toLowerCase();
  const recall = /\b(?:my|our|i|recorded|supplied|provided|entered)\b/.test(lower) && /\b(?:what|which|when|recall|remember|did|have|tell|show)\b/.test(lower);
  if (recall && /\b(?:name|phone|number|work date|service date)\b/.test(lower)) {
    const fields = [];
    if (/\bname\b/.test(lower)) fields.push('customerName');
    if (/\b(?:phone|number)\b/.test(lower)) fields.push('phone');
    if (/\b(?:work date|service date)\b/.test(lower)) fields.push('requestedWorkDate');
    return fields.map(key => requestField(key, state));
  }
  if (recall && /\b(?:day|date|when)\b/.test(lower) && /\bwork\b/.test(lower)) return [requestField('requestedWorkDate', state)];
  const replies = [];
  for (const topic of questions.topicsFor(question)) {
    if (BUSINESS_TOPICS.has(topic)) {
      replies.push(questions.answerTopic(topic, {}, profile && profile.facts));
      continue;
    }
    switch (topic) {
      case 'requestJob': replies.push(requestField('job', state)); break;
      case 'requestZip': replies.push(requestField('zip', state)); break;
      case 'requestTiming': replies.push(requestField('callbackWindow', state)); break;
      case 'requestSummary': replies.push(requestSummary(state)); break;
      case 'booking': case 'availability': replies.push('This workspace records requests. It does not check a calendar, reserve a time or book an appointment. The callback window is when a customer wants a call. The requested work date is when they would like the work done. The contractor must confirm both.'); break;
      case 'messaging': replies.push('This workspace does not send calls, texts, emails or notifications. It does not dispatch an electrician or contact emergency services. Saving a request adds it to the contractor inbox only.'); break;
      case 'privacy': replies.push('Draft messages are processed in this private preview. Save request stores the reviewed details and conversation in the signed-in business workspace. Reset draft or reloading clears the unsaved draft, not saved requests. STOP for a known phone number is stored immediately as a contact restriction, even before a request is saved. No AI provider receives these messages.'); break;
      case 'reset': replies.push('Reset draft clears only this unsaved conversation and its review fields. Saved requests and stored phone opt-outs remain. Use the inbox to review saved requests.'); break;
      case 'controls': replies.push('STOP pauses automated replies. For a known phone number, it also saves a contact restriction for this business. START cannot clear a stored opt-out or a safety hold. Reset draft does not remove stored opt-outs.'); break;
      case 'bundled': replies.push('You can send explicit details together, up to 500 characters per message. For example: "My name is Jamie Stone. My phone is 586-555-0101. I need an EV charger installed. ZIP 48315. Call me Monday after 4 pm. I need the work done Friday." Review and correct each field before saving.'); break;
      case 'corrections': replies.push('Name the field to correct, such as "Actually my job ZIP is 48084", "Callback: Tuesday after 4 pm" or "Work date: Friday". You can also edit the review fields before saving. A callback window and a work date are separate preferences.'); break;
      case 'howItWorks': replies.push('Enter a customer name, US callback number, electrical-work request and five-digit job ZIP. You can add a callback window and a requested work date separately. Review the fields and record contact permission before saving. The request then appears in the contractor inbox. No appointment is booked.'); break;
      case 'answerMode': replies.push('This preview uses a local parser and saved business answers. Live AI is not connected. It can recognize explicit details, answer supported questions and show fields for review.'); break;
      case 'questionHelp': replies.push('I can answer supported questions about this draft, how the workspace works and business facts the contractor has confirmed. I will say when I do not have a confirmed answer.'); break;
      default: replies.push('I do not have a confirmed answer to that question. I can help with this request, the workspace controls and approved business details.');
    }
  }
  return replies;
}

function splitReply(value) {
  const result = [];
  let remaining = value;
  while (remaining.length > 2000) {
    const space = remaining.lastIndexOf(' ', 2000);
    const cut = space > 1000 ? space : 2000;
    result.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut).trimStart();
  }
  if (remaining) result.push(remaining);
  return result;
}
function finish(state, message, replies) {
  const uniqueReplies = [...new Set(replies)].flatMap(splitReply);
  const conversation = [...state.conversation, { role: 'customer', text: message }, ...uniqueReplies.map(text => ({ role: 'assistant', text }))];
  if (conversation.length > 60 || conversation.reduce((total, item) => total + item.text.length, 0) > MAX_CONVERSATION_TEXT) {
    throw new PreviewError(413, 'conversation_limit', 'This draft has reached its conversation limit. Save the reviewed request, then start another draft.');
  }
  state.conversation = conversation;
  return { state, replies: uniqueReplies };
}

function previewMessage(message, value, profile, options = {}) {
  if (typeof message !== 'string' || !message.trim() || BAD_CONTROL.test(message)) invalid('Enter a message without control characters.');
  if (message.length > 500) throw new PreviewError(413, 'message_too_large', 'Keep each message to 500 characters.');
  message = message.trim();
  const state = validateState(value);
  const partition = intake.partitionMessage(message);
  // A request to use a particular phone is supplied contact information even
  // when it has a question mark and no time cue. Other questions stay excluded.
  partition.questions = partition.questions.filter(question => {
    const contact = clean(question).match(/^(?:(?:can|could|would|will)\s+you\s+(?:please\s+)?)?(?:please\s+)?(?:call|reach|contact)\s+(?:me|us)\s+(?:at|on)\s+([+\d(][\d\s().-]+)$/i);
    if (!contact || !normalizePhone(contact[1])) return true;
    partition.details += '\nPhone: ' + contact[1];
    return false;
  });
  const clauses = collectContacts(splitDetailClauses(partition.details), state);
  const optedOut = intake.isOptOut(message);
  const urgent = intake.isUrgent(message);
  if (urgent) state.hold = true;
  if (optedOut || options.suppressed === true) state.stopped = true;
  if (state.stopped) {
    if (intake.isStart(message) && !state.hold && options.suppressed !== true) {
      state.stopped = false;
      return finish(state, message, ['Draft replies resumed. Stored phone opt-outs cannot be cleared here. Review the request before saving.']);
    }
    return finish(state, message, []);
  }
  if (state.hold) return finish(state, message, urgent
    ? ['Stop this intake and move away from the electrical hazard. If anyone is in immediate danger, call 911. This workspace does not dispatch help. The request is on a safety hold for contractor review.']
    : ['This draft is on a safety hold and needs contractor review. This workspace does not dispatch help.']);
  if (intake.isStart(message)) return finish(state, message, ['Draft replies are already active. Stored opt-outs and safety holds cannot be cleared here.']);
  extractDetails(clauses, state);
  const replies = partition.questions.flatMap(question => answerQuestion(question, state, profile));
  if (clauses.length || (!partition.questions.length && !replies.length)) {
    if (state.issues.length) replies.push('Please confirm the ' + state.issues.map(key => LABELS[key]).join(', ') + '. Use a field label or edit the review fields. A callback window and a requested work date are separate preferences.');
    else {
      const missing = ['customerName', 'phone', 'job', 'zip'].filter(key => !state[key]);
      replies.push(missing.length
        ? 'Please provide the ' + missing.map(key => LABELS[key]).join(', ') + '. You can send these together or enter them in the review fields.'
        : 'The required request details are present. Review them, record contact permission and select Save request. Nothing has been booked or sent.');
    }
  }
  return finish(state, message, replies);
}

module.exports = { previewMessage, PreviewError, blankState, validateState };
