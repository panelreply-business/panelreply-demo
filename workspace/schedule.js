(() => {
  'use strict';

  // Enumerate the actual instants represented by a wall-clock time. A repeated
  // DST hour requires an explicit choice; a skipped hour has no valid instant.
  // The offset candidates come from the requested IANA zone, never the device
  // offset or Date's implicit local-time normalization.
  function zoneFormatter(timeZone) {
    if (typeof timeZone !== 'string' || timeZone.length > 100 || !/^(?:UTC|[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+)+)$/.test(timeZone)) throw new Error('Enter a valid time zone, such as America/Detroit or UTC.');
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  }
  function partsAt(formatter, timestamp) {
    return Object.fromEntries(formatter.formatToParts(new Date(timestamp)).filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
  }
  function localValue(instant, timeZone) {
    const p = partsAt(zoneFormatter(timeZone), new Date(instant).getTime());
    return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
  }
  function localInstants(value, timeZone) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw new Error('Enter a date and time.');
    let formatter;
    try { formatter = zoneFormatter(timeZone); } catch (_) { throw new Error('Enter a valid time zone, such as America/Detroit or UTC.'); }
    const naive = Date.parse(value + ':00.000Z');
    if (!Number.isFinite(naive) || new Date(naive).toISOString().slice(0, 16) !== value) throw new Error('Enter a valid calendar date and time.');
    const offsets = new Set();
    // This also covers non-hour transitions and zones on either side of UTC.
    for (let hour = -36; hour <= 36; hour += 1) {
      const sample = naive + hour * 3600000;
      const p = partsAt(formatter, sample);
      offsets.add(Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}.000Z`) - sample);
    }
    return [...offsets].map(offset => naive - offset).filter(candidate => localValue(candidate, timeZone) === value)
      .sort((a, b) => a - b).map(candidate => new Date(candidate).toISOString());
  }
  function describeInstant(value, timeZone) {
    return new Intl.DateTimeFormat(undefined, { timeZone, year: 'numeric', month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit', timeZoneName: 'shortOffset' }).format(new Date(value)) + ` (${timeZone})`;
  }

  function create({ api, onChange, onLead, onOpenLead, onReloadLead, guard }) {
    const $ = id => document.getElementById(id);
    const kindLabel = value => value === 'follow_up' ? 'Follow-up' : 'Callback';
    const outcomeLabels = { reached: 'Reached customer', no_answer: 'No answer', voicemail: 'Left voicemail', other: 'Other' };
    const stateLabels = { scheduled: 'Scheduled', completed: 'Completed', cancelled: 'Cancelled', upcoming: 'Upcoming', due: 'Due now', overdue: 'Overdue' };
    let lead = null, task = null, mode = 'create', baseline = '', selectedInstant = '', lastTimeInput = '';
    let locked = true, expired = false, busy = false, pending = null, conflict = false;
    let tasks = [], taskTotal = 0, taskLoading = false, taskSerial = 0;
    let queueOffset = 0, queueTotal = 0, queueLoading = false, queueSerial = 0;
    const PAGE_SIZE = 50;
    const deviceZone = (() => {
      try {
        const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        zoneFormatter(zone);
        return zone;
      } catch (_) { return 'UTC'; }
    })();
    function node(tag, text, className) {
      const result = document.createElement(tag);
      if (text !== undefined) result.textContent = text;
      if (className) result.className = className;
      return result;
    }
    function error(id, message) { $(id).textContent = message; $(id).hidden = !message; }
    function draft() {
      return JSON.stringify({ mode, taskId: task?.id || null, kind: $('task-kind').value, local: $('task-local-time').value,
        zone: $('task-time-zone').value, occurrence: $('task-occurrence').value, notes: $('task-notes').value, outcome: $('task-outcome').value });
    }
    function dirty() { return Boolean(lead && baseline && (mode !== 'create' || draft() !== baseline)); }
    function blockMessage(record = lead) {
      if (!record) return 'Open a saved request to schedule a callback.';
      if (record.optedOut || record.blockReason === 'contact_blocked') return 'Contact is opted out. Open tasks remain visible and can be cancelled.';
      if (record.safetyHold || record.blockReason === 'safety_review_required') return 'A safety hold prevents callback scheduling and completion. Review the request.';
      if (record.status === 'closed' || record.requestStatus === 'closed' || record.blockReason === 'request_closed') return 'This request is closed. Reopen it before scheduling or completing a callback.';
      if (record.status === 'needs_review' || record.requestStatus === 'needs_review' || record.blockReason === 'request_review_required') return 'This request needs review. Resolve the review before scheduling or completing a callback.';
      if (record.contactAllowed !== true || record.blockReason) return 'A customer callback request is required before scheduling or completing a task.';
      return '';
    }
    function update() {
      const blocked = blockMessage();
      const disabled = expired || locked || !lead || busy || Boolean(pending) || taskLoading || conflict;
      $('callback-task-fields').disabled = disabled || Boolean(blocked && mode !== 'cancel');
      $('save-callback-task').disabled = disabled || Boolean(blocked && mode !== 'cancel');
      $('discard-task-draft').disabled = expired || busy || Boolean(pending) || !lead;
      $('refresh-lead-tasks').disabled = expired || busy || Boolean(pending) || taskLoading || !lead;
      $('more-lead-tasks').disabled = $('refresh-lead-tasks').disabled;
      $('retry-task-save').disabled = expired || busy || !pending;
      $('task-uncertain').hidden = !pending || busy;
      $('task-conflict').hidden = !conflict;
      $('task-dirty').hidden = !dirty();
      $('task-restriction').textContent = blocked;
      $('task-restriction').hidden = !blocked;
      for (const button of $('lead-task-list').querySelectorAll('button')) {
        button.disabled = disabled || button.dataset.blocked === 'true';
      }
    }
    function changed() { update(); onChange(); }
    function timePreview(preferredInstant) {
      const scheduling = mode === 'create' || mode === 'reschedule';
      $('task-local-time').required = scheduling;
      $('task-time-zone').required = scheduling;
      $('task-outcome').required = mode === 'complete';
      $('task-local-time').setCustomValidity('');
      $('task-time-zone').setCustomValidity('');
      $('task-occurrence').setCustomValidity('');
      $('task-occurrence').required = false;
      $('task-occurrence-field').hidden = true;
      if (!scheduling) { selectedInstant = ''; $('task-time-preview').textContent = ''; return; }
      const inputKey = $('task-local-time').value + '\0' + $('task-time-zone').value;
      const previous = preferredInstant || (inputKey === lastTimeInput ? $('task-occurrence').value : '');
      lastTimeInput = inputKey;
      selectedInstant = '';
      $('task-occurrence').replaceChildren();
      $('task-occurrence').value = '';
      if (!$('task-local-time').value) { $('task-time-preview').textContent = 'Choose a time to see the saved time zone and UTC instant.'; return; }
      try {
        const zone = $('task-time-zone').value.trim();
        const candidates = localInstants($('task-local-time').value, zone);
        if (!candidates.length) throw new Error('This local time does not exist in that time zone. Choose a time outside the clock change.');
        if (candidates.length > 1) {
          $('task-occurrence-field').hidden = false;
          $('task-occurrence').required = true;
          const placeholder = node('option', 'Choose the first or second occurrence'); placeholder.value = ''; $('task-occurrence').append(placeholder);
          for (const instant of candidates) { const option = node('option', `${describeInstant(instant, zone)} · ${instant}`); option.value = instant; $('task-occurrence').append(option); }
          $('task-occurrence').value = candidates.includes(previous) ? previous : '';
          selectedInstant = $('task-occurrence').value;
          if (!selectedInstant) { $('task-time-preview').textContent = 'The clock repeats this time. Choose which occurrence you mean.'; return; }
        } else selectedInstant = candidates[0];
        $('task-time-preview').textContent = `Will save ${describeInstant(selectedInstant, zone)}. UTC: ${selectedInstant}`;
      } catch (cause) {
        $('task-time-preview').textContent = cause.message;
        $('task-local-time').setCustomValidity(cause.message);
      }
    }
    function resetForm() {
      task = null; mode = 'create'; conflict = false; lastTimeInput = ''; selectedInstant = '';
      $('task-kind').value = 'callback'; $('task-kind').disabled = false;
      $('task-local-time').value = ''; $('task-time-zone').value = deviceZone;
      $('task-notes').value = ''; $('task-outcome').value = ''; $('task-occurrence').value = '';
      $('callback-task-heading').textContent = 'Schedule a task'; $('save-callback-task').textContent = 'Schedule task';
      for (const id of ['task-kind-field', 'task-time-field', 'task-zone-field', 'task-time-preview']) $(id).hidden = false;
      $('task-outcome-field').hidden = true;
      timePreview(); baseline = draft();
      error('task-error', ''); $('task-save-status').textContent = '';
    }
    function beginAction(record, action) {
      if (!lead || expired || locked || busy || pending || taskLoading) return;
      guard(() => {
        if (!lead || lead.id !== record.leadId || expired) return;
        resetForm(); task = record; mode = action;
        $('task-kind').value = record.kind; $('task-kind').disabled = true;
        $('task-notes').value = record.notes;
        const titles = { reschedule: 'Reschedule task', complete: 'Record call outcome', cancel: 'Cancel task' };
        $('callback-task-heading').textContent = titles[action]; $('save-callback-task').textContent = titles[action];
        const scheduling = action === 'reschedule';
        for (const id of ['task-time-field', 'task-zone-field', 'task-time-preview']) $(id).hidden = !scheduling;
        $('task-kind-field').hidden = !scheduling;
        $('task-outcome-field').hidden = action !== 'complete';
        if (scheduling) { $('task-time-zone').value = record.timeZone; $('task-local-time').value = localValue(record.dueAt, record.timeZone); }
        timePreview(record.dueAt); changed();
        (scheduling ? $('task-local-time') : action === 'complete' ? $('task-outcome') : $('task-notes')).focus();
      });
    }
    function taskCard(record, queue) {
      const item = node('li', undefined, 'callback-task-card');
      item.dataset.taskId = record.id;
      const header = node('div', undefined, 'callback-task-heading');
      const label = queue ? `${record.customerName} · ${kindLabel(record.kind)}` : kindLabel(record.kind);
      header.append(node(queue ? 'h3' : 'h4', label));
      const blocked = record.status === 'scheduled' ? blockMessage(record) : '';
      header.append(node('span', blocked ? 'Blocked' : stateLabels[record.status === 'scheduled' ? record.dueState : record.status] || 'Scheduled', `badge ${blocked ? 'badge-warning' : record.status === 'scheduled' && record.dueState === 'overdue' ? 'badge-danger' : 'badge-neutral'}`));
      const when = node('time', describeInstant(record.dueAt, record.timeZone), 'small-text'); when.setAttribute('datetime', record.dueAt);
      item.append(header, when);
      if (blocked) item.append(node('p', blocked, 'field-help'));
      if (record.outcome) item.append(node('p', outcomeLabels[record.outcome] || record.outcome, 'small-text'));
      if (record.notes) item.append(node('p', record.notes, 'callback-task-notes'));
      const controls = node('div', undefined, 'button-row');
      if (queue) {
        const open = node('button', 'Open request', 'button button-secondary button-small'); open.type = 'button';
        open.setAttribute('aria-label', `Open request for ${record.customerName}, ${kindLabel(record.kind).toLowerCase()}`);
        open.addEventListener('click', () => guard(() => onOpenLead(record.leadId))); controls.append(open);
      } else if (record.status === 'scheduled') {
        for (const [action, label] of [['complete', 'Record outcome'], ['reschedule', 'Reschedule'], ['cancel', 'Cancel task']]) {
          const button = node('button', label, 'button button-secondary button-small'); button.type = 'button';
          button.dataset.blocked = String(Boolean(blocked && action !== 'cancel'));
          button.addEventListener('click', () => beginAction(record, action)); controls.append(button);
        }
      }
      item.append(controls); return item;
    }
    function validateList(value) {
      if (!value || !Array.isArray(value.tasks) || !Number.isSafeInteger(value.total) || value.total < 0 || !Number.isFinite(Date.parse(value.generatedAt))
        || value.tasks.some(record => typeof record.id !== 'string' || typeof record.leadId !== 'string' || !Number.isSafeInteger(record.version)
          || !['scheduled', 'completed', 'cancelled'].includes(record.status) || !['callback', 'follow_up'].includes(record.kind)
          || typeof record.timeZone !== 'string' || !Number.isFinite(Date.parse(record.dueAt)))) throw new Error('The task list was incomplete. Refresh to try again.');
      return value;
    }
    async function loadTasks(append = false) {
      if (!lead || expired || busy || pending) return;
      const id = lead.id, serial = ++taskSerial, offset = append ? tasks.length : 0;
      taskLoading = true; changed();
      $('lead-task-status').textContent = 'Loading saved tasks…'; error('task-error', '');
      try {
        const result = validateList(await api(`/api/callback-tasks?state=all&leadId=${encodeURIComponent(id)}&limit=100&offset=${offset}`));
        if (expired || serial !== taskSerial || lead?.id !== id) return;
        if (result.tasks.some(record => record.leadId !== id)) throw new Error('The task list did not match this request. Reload the request.');
        tasks = append ? [...tasks, ...result.tasks] : result.tasks; taskTotal = result.total;
        const fragment = document.createDocumentFragment();
        for (const record of tasks) fragment.append(taskCard(record, false));
        if (!tasks.length) fragment.append(node('li', 'No tasks saved for this request.', 'history-empty'));
        $('lead-task-list').replaceChildren(fragment);
        $('lead-task-status').textContent = `${tasks.length} of ${taskTotal} saved task${taskTotal === 1 ? '' : 's'}.`;
        $('more-lead-tasks').hidden = tasks.length >= taskTotal;
      } catch (cause) {
        if (!expired && serial === taskSerial) { error('task-error', cause.message); $('lead-task-status').textContent = 'Tasks could not be refreshed. Previously shown tasks may have changed.'; }
      } finally { if (serial === taskSerial) { taskLoading = false; changed(); } }
    }
    async function loadQueue(offset = 0) {
      if (expired) return;
      const serial = ++queueSerial, filter = $('callback-queue-filter').value || 'open';
      queueLoading = true; $('refresh-callback-queue').disabled = true;
      $('callback-queue-previous').disabled = true; $('callback-queue-next').disabled = true;
      $('callback-queue-status').textContent = 'Loading callback queue…'; error('callback-queue-error', '');
      try {
        const result = validateList(await api(`/api/callback-tasks?state=${encodeURIComponent(filter)}&limit=${PAGE_SIZE}&offset=${offset}`));
        if (expired || serial !== queueSerial) return;
        queueOffset = offset; queueTotal = result.total;
        const fragment = document.createDocumentFragment();
        for (const record of result.tasks) fragment.append(taskCard(record, true));
        if (!result.tasks.length) fragment.append(node('li', 'No tasks match this view.', 'history-empty'));
        $('callback-queue-list').replaceChildren(fragment);
        $('callback-queue-page').textContent = result.tasks.length ? `${offset + 1}–${offset + result.tasks.length} of ${queueTotal}` : `0 of ${queueTotal}`;
        $('callback-queue-status').textContent = `Queue refreshed. Due status was checked at ${new Intl.DateTimeFormat(undefined, { timeStyle: 'short' }).format(new Date(result.generatedAt))}. Refresh to update it.`;
      } catch (cause) {
        if (!expired && serial === queueSerial) {
          error('callback-queue-error', cause.message); $('callback-queue-list').replaceChildren();
          queueOffset = 0; queueTotal = 0; $('callback-queue-page').textContent = '';
          $('callback-queue-status').textContent = 'The queue is unavailable. Refresh to try again.';
        }
      } finally {
        if (serial === queueSerial) { queueLoading = false; $('refresh-callback-queue').disabled = expired;
          $('callback-queue-previous').disabled = expired || queueOffset === 0;
          $('callback-queue-next').disabled = expired || queueOffset + PAGE_SIZE >= queueTotal; }
      }
    }
    function buildCommand() {
      timePreview();
      if (!$('callback-task-form').reportValidity()) return null;
      if ((mode === 'create' || mode === 'reschedule') && !selectedInstant) {
        error('task-error', 'Choose an exact callback time before saving.'); $('task-occurrence-field').hidden ? $('task-local-time').focus() : $('task-occurrence').focus(); return null;
      }
      const payload = { leadVersion: lead.version, notes: $('task-notes').value };
      if (mode === 'create' || mode === 'reschedule') { payload.dueAt = selectedInstant; payload.timeZone = $('task-time-zone').value.trim(); }
      if (mode === 'create') payload.kind = $('task-kind').value;
      else { payload.version = task.version; payload.action = mode; if (mode === 'complete') payload.outcome = $('task-outcome').value; }
      return { leadId: lead.id, url: mode === 'create' ? `/api/leads/${encodeURIComponent(lead.id)}/tasks` : `/api/callback-tasks/${encodeURIComponent(task.id)}`,
        method: mode === 'create' ? 'POST' : 'PATCH', body: payload, key: crypto.randomUUID() };
    }
    async function save(event) {
      event?.preventDefault();
      if (!lead || expired || busy || locked || taskLoading || conflict) return;
      if (!pending && blockMessage() && mode !== 'cancel') return;
      if (!pending) pending = buildCommand();
      if (!pending) return;
      const command = pending;
      busy = true; error('task-error', ''); $('task-save-status').textContent = 'Saving task…'; changed();
      try {
        const result = await api(command.url, { method: command.method, body: command.body, key: command.key });
        if (expired || pending !== command) return;
        if (!result?.lead || result.lead.id !== command.leadId || !Number.isSafeInteger(result.lead.version)
          || !result.task || result.task.leadId !== command.leadId || !Number.isSafeInteger(result.task.version)) throw new Error('The task save response was incomplete. Retry to confirm the result.');
        pending = null; busy = false; resetForm();
        onLead(result.lead);
        $('task-save-status').textContent = result.task.status === 'completed' ? 'Call outcome saved. Schedule a follow-up if another call is needed.' : result.task.status === 'cancelled' ? 'Task cancelled.' : 'Task scheduled. No call or message was sent.';
      } catch (cause) {
        if (expired) return;
        $('task-save-status').textContent = '';
        error('task-error', cause.message || 'Could not confirm the task save. Retry this action.');
        // Only a definitive client rejection releases the saved command. A
        // lost or malformed success response retries the same key and payload.
        if (!command.uncertain && cause.status >= 400 && cause.status < 500 && cause.status !== 408 && cause.status !== 429) {
          pending = null;
          if (cause.status === 409) conflict = true;
        } else command.uncertain = true;
      } finally { busy = false; if (!expired) changed(); }
    }
    function selectLead(value) {
      if (expired) return;
      lead = value; taskSerial++; taskLoading = false; tasks = []; taskTotal = 0;
      $('lead-task-list').replaceChildren(); $('more-lead-tasks').hidden = true;
      resetForm(); changed();
      if (value) void loadTasks();
    }
    function discard() { if (!busy && !pending) { resetForm(); changed(); } }
    function clear() {
      expired = true; lead = null; tasks = []; task = null; pending = null; taskSerial++; queueSerial++;
      $('lead-task-list').replaceChildren(); $('callback-queue-list').replaceChildren();
      $('task-notes').value = ''; $('task-local-time').value = ''; $('task-save-status').textContent = '';
      $('callback-queue-status').textContent = ''; $('lead-task-status').textContent = ''; $('callback-queue-page').textContent = '';
      error('task-error', ''); error('callback-queue-error', ''); update();
    }
    $('callback-task-form').addEventListener('submit', save);
    $('callback-task-form').addEventListener('input', () => { timePreview(); $('task-save-status').textContent = ''; changed(); });
    $('callback-task-form').addEventListener('change', () => { timePreview(); $('task-save-status').textContent = ''; changed(); });
    $('retry-task-save').addEventListener('click', save);
    $('discard-task-draft').addEventListener('click', () => guard(discard));
    $('reload-task-request').addEventListener('click', () => guard(onReloadLead));
    $('refresh-lead-tasks').addEventListener('click', () => guard(() => loadTasks()));
    $('more-lead-tasks').addEventListener('click', () => { if (!taskLoading) void loadTasks(true); });
    $('refresh-callback-queue').addEventListener('click', () => loadQueue(0));
    $('callback-queue-filter').addEventListener('change', () => loadQueue(0));
    $('callback-queue-previous').addEventListener('click', () => { if (!queueLoading && queueOffset > 0) void loadQueue(Math.max(0, queueOffset - PAGE_SIZE)); });
    $('callback-queue-next').addEventListener('click', () => { if (!queueLoading && queueOffset + PAGE_SIZE < queueTotal) void loadQueue(queueOffset + PAGE_SIZE); });
    resetForm(); update();
    return { selectLead, discard, clear, openQueue: () => loadQueue(0), isDirty: dirty,
      isBusy: () => busy, isPending: () => Boolean(pending), setLocked(value) { locked = value; update(); } };
  }

  const exported = { create, localInstants, localValue, describeInstant };
  if (typeof module === 'object' && module.exports) module.exports = exported;
  else window.PanelReplySchedule = Object.freeze(exported);
})();
