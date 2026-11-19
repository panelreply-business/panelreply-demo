'use strict';

const intake = globalThis.PanelReplyIntake;
const $ = id => document.getElementById(id);
const aiEnabled = document.body.dataset.aiEnabled === 'true';
let stage = 0, stopped = false, hold = false, job = '', zip = '', timing = '';
let pending = false, requestVersion = 0, requestController = null;
let clarificationPending = false;
let clarificationFields = [];
let viewRevision = 0;

function fields() { return { job, zip, timing }; }

function event(text, type = '') {
  const list = $('events');
  const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 48;
  const node = document.createElement('div');
  node.className = 'event ' + type;
  node.textContent = text;
  list.append(node);
  $('conversation-empty').hidden = true;
  if (nearBottom || type === 'customer') list.scrollTop = list.scrollHeight;
}

function mode(text) {
  $('ai-mode').textContent = text || (aiEnabled
    ? 'AI test server available. Enter an access code to use AI. Without it, messages use demo parsing.'
    : 'Demo parsing. AI is not connected on this page.');
}

function setPending(value) {
  pending = value;
  $('send').disabled = value;
  $('reply').disabled = value;
  $('form').setAttribute('aria-busy', String(value));
}

function cancelPending() {
  requestVersion += 1;
  if (requestController) requestController.abort();
  requestController = null;
  setPending(false);
}

function nextQuestion() {
  if (clarificationPending) {
    const labels = { job: 'electrical work', zip: 'five-digit job ZIP', timing: 'callback timing' };
    return 'I found conflicting details. Please confirm the ' +
      clarificationFields.map(key => labels[key]).join(' and ') + '.';
  }
  const missing = intake.missingFields(fields());
  if (missing.includes('job')) return 'What electrical work do you need? You can include the ZIP and callback time in the same message. Reply STOP to unsubscribe.';
  if (missing.includes('zip')) return 'What is the five-digit job ZIP? Reply STOP to unsubscribe.';
  if (missing.includes('timing')) return 'When do you need the work, and when can we call?';
  return 'Your request is ready for a callback. No appointment is booked.';
}

function update() {
  viewRevision += 1;
  $('copy-status').textContent = '';
  stage = !job ? 0 : !zip ? 1 : !timing ? 2 : 3;
  const heads = ['Save the call.', 'Collect the job ZIP.', 'Collect timing.', 'Ready for callback.'];
  $('title').textContent = heads[stage];
  $('step').textContent = String(stage + 1).padStart(2, '0') + ' / ' +
    ['MISSED CALL', 'JOB LOCATION', 'CALLBACK TIME', 'READY FOR REVIEW'][stage];
  const details = job || zip || timing
    ? 'Job: ' + (job || 'Not collected') + '\nZIP: ' + (zip || 'Not collected') +
      '\nTiming: ' + (timing || 'Not collected') + '\nNo appointment has been booked.'
    : 'The sample callback summary updates as details are collected.';
  $('summary').textContent = details;
  if (clarificationPending) {
    $('title').textContent = 'Clarify the request.';
    $('step').textContent = 'DETAILS / CONFIRMATION NEEDED';
    $('summary').textContent = 'Conflicting details need confirmation before this request is ready.\n' + details;
  }
  if (stopped) {
    $('title').textContent = 'Automated replies paused.';
    $('step').textContent = 'STOP / SIMULATED OPT-OUT';
  }
  if (hold) {
    $('title').textContent = 'Urgent review required.';
    $('step').textContent = 'SAFETY HOLD / HUMAN REVIEW';
    $('summary').textContent = 'Demo safety hold. A human review is required, but no notification was sent.\n' + details;
  }
  const values = fields();
  const confirmed = ['job', 'zip', 'timing'].filter(key => values[key] && !clarificationFields.includes(key));
  for (const key of ['job', 'zip', 'timing']) {
    const needsConfirmation = clarificationFields.includes(key);
    $('detail-' + key).textContent = (values[key] || 'Not collected') + (needsConfirmation ? ' (needs confirmation)' : '');
    $('detail-' + key).setAttribute('data-state', needsConfirmation ? 'confirm' : values[key] ? 'collected' : 'missing');
  }
  $('field-count').textContent = confirmed.length + ' of 3';
  $('field-progress').value = confirmed.length;
  $('field-progress').setAttribute('aria-valuetext', confirmed.length + ' of 3 details confirmed');
  const state = hold ? 'Safety hold' : stopped ? 'Replies paused' : clarificationPending ? 'Needs confirmation'
    : stage === 3 ? 'Ready for callback' : confirmed.length ? 'Collecting details' : 'Not started';
  $('request-state').textContent = state;
  $('request-state').setAttribute('data-state', hold ? 'hold' : stopped ? 'paused' : clarificationPending ? 'confirm' : stage === 3 ? 'ready' : 'collecting');
  $('copy-summary').disabled = !(job || zip || timing || hold || stopped);
  $('conversation-empty').hidden = $('events').children.length > 0;
}

function updateCharacterCount() {
  $('reply-count').textContent = $('reply').value.length + ' / 500';
}

async function copySummary() {
  if ($('copy-summary').disabled) return;
  const revision = viewRevision;
  const text = 'PanelReply sample request\nStatus: ' + $('request-state').textContent + '\n' + $('summary').textContent;
  $('copy-status').textContent = 'Copying summary…';
  try {
    if (typeof navigator === 'undefined' || !navigator.clipboard || !navigator.clipboard.writeText) throw new Error('Clipboard unavailable');
    await navigator.clipboard.writeText(text);
    if (revision === viewRevision) $('copy-status').textContent = 'Summary copied.';
  } catch (_error) {
    if (revision !== viewRevision) return;
    $('summary-details').open = true;
    try {
      $('summary').focus();
      const selection = globalThis.getSelection();
      const range = document.createRange();
      range.selectNodeContents($('summary'));
      selection.removeAllRanges();
      selection.addRange(range);
      $('copy-status').textContent = 'Copy is unavailable here. The summary is selected. Copy it manually.';
    } catch (_selectionError) {
      $('copy-status').textContent = 'Copy is unavailable here. Open the full summary and copy it manually.';
    }
  }
}

function pauseReplies() {
  cancelPending();
  stopped = true;
  event('Demo STOP state: simulated automated replies paused. This page does not persist opt-out status.', 'system');
  mode(aiEnabled ? 'Replies paused. Any pending AI result has been cancelled.' : undefined);
  update();
}

function safetyHold() {
  cancelPending();
  hold = true;
  if (!stopped) event('If there is immediate danger, move away and call 911. This inbox is not emergency dispatch. No electrician has been dispatched.');
  event(stopped
    ? 'Demo urgent flag for human review. No reply or notification sent because of STOP.'
    : 'Demo urgent flag: human review required. No notification sent.', 'system');
  mode(aiEnabled ? 'Safety hold. AI intake is paused for human review.' : undefined);
  update();
}

function applyExtraction(extracted, fromAI = false) {
  const merged = intake.mergeFields(fields(), extracted);
  job = merged.job;
  zip = merged.zip;
  timing = merged.timing;
  if (extracted.ambiguous) {
    // The local parser flags ZIP conflicts. An AI conflict without a field name
    // is treated conservatively: re-confirm each field it could not extract.
    const unresolved = fromAI ? ['job', 'zip', 'timing'].filter(key => extracted[key] === null) : ['zip'];
    clarificationFields = [...new Set([...clarificationFields, ...(unresolved.length ? unresolved : ['job', 'zip', 'timing'])])];
  } else {
    clarificationFields = clarificationFields.filter(key => extracted[key] === null);
  }
  clarificationPending = clarificationFields.length > 0;
  update();
  event(nextQuestion());
  if (stage === 3 && !clarificationPending) event('Sample request ready for contractor review. No notification sent.', 'system');
}

function validExtraction(payload, body) {
  if (!payload || !['ai', 'local'].includes(payload.mode) || !payload.fields || !payload.flags) return false;
  if (Object.keys(payload.fields).sort().join(',') !== 'job,timing,zip') return false;
  if (Object.keys(payload.flags).sort().join(',') !== 'ambiguous,hazard,optOut') return false;
  if (!['optOut', 'hazard', 'ambiguous'].every(key => typeof payload.flags[key] === 'boolean')) return false;
  for (const key of ['job', 'zip', 'timing']) {
    const value = payload.fields[key];
    if (value !== null && (typeof value !== 'string' || !value.trim() || value.length > 500 || !body.includes(value))) return false;
  }
  if (payload.fields.job !== null && !/[a-z]/i.test(payload.fields.job)) return false;
  if (payload.fields.timing !== null && (!/[a-z0-9]/i.test(payload.fields.timing) || /^\d{5}(?:-\d{4})?$/.test(payload.fields.timing.trim()))) return false;
  return payload.fields.zip === null || /^\d{5}$/.test(payload.fields.zip);
}

async function send(body) {
  if (typeof body !== 'string') return;
  body = body.trim();
  if (!body) return;
  if (body.length > 500) {
    event('Please keep each sample message to 500 characters.', 'system');
    return;
  }
  event(body, 'customer');
  if (intake.isOptOut(body)) {
    pauseReplies();
    if (intake.isUrgent(body)) safetyHold();
    return;
  }
  if (intake.isStart(body)) {
    if (hold) {
      event('Demo paused for human review. START does not release the safety hold.', 'system');
      return;
    }
    cancelPending();
    stopped = false;
    event('Demo START state: simulated replies enabled.', 'system');
    mode();
    update();
    event(nextQuestion());
    return;
  }
  if (stopped) {
    if (intake.isUrgent(body)) safetyHold();
    else event('Message shown without an automated reply. This simulated caller is opted out.', 'system');
    return;
  }
  if (intake.isUrgent(body)) { safetyHold(); return; }
  if (hold) {
    event('Additional detail shown for human review. No data stored in a customer database.', 'system');
    return;
  }
  if (pending) {
    event('Please wait for the current reply, or use STOP or Reset tour.', 'system');
    return;
  }

  const accessCode = $('ai-access').value.trim();
  if (!aiEnabled || !accessCode) {
    mode();
    applyExtraction(intake.extractFields(body, fields()));
    return;
  }

  const version = ++requestVersion;
  const controller = new AbortController();
  requestController = controller;
  setPending(true);
  mode('AI is reading the sample message. STOP and Reset tour remain available.');
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch('/api/intake', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + accessCode },
      body: JSON.stringify({ message: body, fields: fields() }),
      signal: controller.signal,
      credentials: 'omit',
      cache: 'no-store',
    });
    if (!response.ok) throw new Error('AI unavailable');
    const payload = await response.json();
    if (!validExtraction(payload, body)) throw new Error('Invalid AI response');
    if (version !== requestVersion || stopped || hold) return;
    if (payload.flags.optOut) pauseReplies();
    if (payload.flags.hazard) safetyHold();
    if (payload.flags.optOut || payload.flags.hazard) return;
    mode(payload.mode === 'ai'
      ? 'AI extracted these details. Check the summary and correct anything it misunderstood.'
      : 'Demo parsing handled this message.');
    applyExtraction({ ...payload.fields, ambiguous: payload.flags.ambiguous }, payload.mode === 'ai');
  } catch (_error) {
    if (version !== requestVersion || stopped || hold) return;
    mode('AI is unavailable. This message used demo parsing. Check the summary before continuing.');
    applyExtraction(intake.extractFields(body, fields()));
  } finally {
    clearTimeout(timeout);
    if (version === requestVersion) {
      requestController = null;
      setPending(false);
    }
  }
}

function reset() {
  cancelPending();
  stage = 0;
  stopped = false;
  hold = false;
  job = '';
  zip = '';
  timing = '';
  clarificationPending = false;
  clarificationFields = [];
  $('reply').value = '';
  updateCharacterCount();
  $('ai-access').value = '';
  $('events').replaceChildren();
  $('call-status').textContent = '';
  $('callback').selectedIndex = 0;
  $('outcome').textContent = 'A completed intake does not book an appointment.';
  $('summary-details').open = false;
  mode();
  update();
}

$('call').onclick = () => {
  $('call-status').textContent = 'Simulated missed call recorded on this page. No text sent.';
  event('Demo missed call recorded. No actual call or text took place.', 'system');
};
$('example').onclick = () => {
  reset();
  $('call').click();
  send('I need an EV charger installed in the garage. My ZIP is 48315. Next week. Call after 4 pm.');
};
$('form').onsubmit = e => {
  e.preventDefault();
  const body = $('reply').value;
  $('reply').value = '';
  updateCharacterCount();
  send(body);
};
$('reply').oninput = updateCharacterCount;
$('copy-summary').onclick = copySummary;
$('stop').onclick = () => send('STOP');
$('restart').onclick = () => send('START');
$('reset').onclick = reset;
$('callback').onchange = () => {
  $('outcome').textContent = 'Sample contractor update: ' + $('callback').value + '. This is demonstration data. No calendar event was created.';
};
$('ai-controls').hidden = !aiEnabled;
$('ai-connection-status').textContent = aiEnabled ? 'Configured for testing' : 'Not enabled';
$('ai-connection-detail').textContent = aiEnabled
  ? 'Enter the test access code to use AI for sample messages.'
  : 'This workspace uses local parsing. AI requires a configured server.';
mode();
updateCharacterCount();
update();
