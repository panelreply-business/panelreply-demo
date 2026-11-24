(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const FACTS = [
    ['services', 'Services', 'The electrical work your business accepts, and any work you do not offer.'],
    ['pricing', 'Pricing', 'How pricing is agreed, including any confirmed minimum or callout fee.'],
    ['estimates', 'Estimate terms', 'How a customer can request an estimate and whether there is a charge.'],
    ['hours', 'Business hours', 'Your working hours and when customers can expect a response.'],
    ['serviceArea', 'Service area', 'The towns, ZIP codes, or areas your business covers.'],
    ['contact', 'Contact details', 'The phone number or other contact method you want customers to use.'],
    ['qualifications', 'Licensing and insurance', 'Only licensing and insurance statements you have checked and can support.'],
    ['emergencyAvailability', 'Emergency availability', 'Your confirmed availability for urgent work and how to reach your team.'],
    ['permits', 'Permits', 'How your business handles permits and inspection requirements.'],
    ['warranty', 'Warranty', 'The warranty terms your business has agreed to provide.'],
    ['financing', 'Payment terms', 'Accepted payment methods and any confirmed payment or financing terms.']
  ];
  const STATUS_LABELS = { new: 'New', needs_review: 'Needs review', contacted: 'Contacted', closed: 'Closed' };
  const FIELD_IDS = { customerName: 'lead-name', phone: 'lead-phone', job: 'lead-job', zip: 'lead-zip', callbackWindow: 'lead-callback', requestedWorkDate: 'lead-work-date', contactPermission: 'lead-permission', status: 'lead-status-select', notes: 'lead-notes' };
  const FIELD_LABELS = { customerName: 'Customer name', phone: 'Phone number', job: 'Electrical work', zip: 'Job ZIP', callbackWindow: 'Callback window', requestedWorkDate: 'Requested work date', contactPermission: 'Contact permission', status: 'Request status', notes: 'Internal notes' };
  let csrfToken = '';
  let user = null;
  let leads = [];
  let selected = null;
  let profile = null;
  let leadBaseline = '';
  let profileBaseline = '';
  let leadSaving = false;
  let pendingLeadSave = null;
  let pendingLeadReview = null;
  let leadLoading = false;
  let profileSaving = false;
  let profileLoading = false;
  let refreshingRequests = false;
  let loading = false;
  let selectionSerial = 0;
  let currentView = 'inbox';
  let pendingNavigation = null;
  let expired = false;
  let profileConflict = false;
  let leadConflict = false;
  let exportBusy = false;
  const exportUrls = new Set();
  const deletion = window.PanelReplyDeletion.create({ api, onChange: updateDirty, onDeleted: deletedLead });
  const schedule = window.PanelReplySchedule.create({ api, onChange: updateDirty, guard: guarded,
    onLead(lead) {
      const index = leads.findIndex(item => item.id === lead.id);
      if (index >= 0) leads[index] = lead; else leads.unshift(lead);
      renderLead(lead);
    },
    onOpenLead(id) { setView('inbox'); return selectLead(id); },
    onReloadLead() { if (selected) return selectLead(selected.id); }
  });

  class RequestError extends Error {
    constructor(status, code, message, fields) { super(message); this.status = status; this.code = code; this.fields = fields; }
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
  }

  function clearSession() {
    expired = true;
    deletion.expire();
    schedule.clear();
    csrfToken = '';
    user = null;
    leads = [];
    selected = null;
    pendingLeadSave = null;
    pendingLeadReview = null;
    pendingNavigation = null;
    profile = null;
    leadBaseline = '';
    profileBaseline = '';
    selectionSerial += 1;
    for (const url of exportUrls) URL.revokeObjectURL(url);
    exportUrls.clear();
    $('export-status').textContent = '';
    $('export-records').disabled = true;
    $('requests-list').replaceChildren();
    $('lead-form').reset();
    $('lead-status').textContent = '';
    $('profile-form').reset();
    $('lead-conversation').replaceChildren();
    $('lead-audit').replaceChildren();
    $('lead-detail').hidden = true;
    $('profile-view').hidden = true;
    $('schedule-view').hidden = true;
    window.location.replace('/login');
  }

  async function api(path, options = {}) {
    const method = options.method || 'GET';
    const headers = { Accept: 'application/json' };
    if (csrfToken) headers['X-Workspace-Session'] = csrfToken;
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    if (method !== 'GET') headers['X-CSRF-Token'] = csrfToken;
    if (options.key) headers['Idempotency-Key'] = options.key;
    let response;
    try {
      response = await fetch(path, { method, credentials: 'same-origin', cache: 'no-store', headers, body: options.body === undefined ? undefined : JSON.stringify(options.body) });
    } catch (_) {
      throw new RequestError(0, 'network_error', 'Could not reach the workspace. Your edits are still here. Try again when your connection is available.');
    }
    const data = response.status === 204 ? null : await response.json().catch(() => null);
    if (response.status === 401) {
      clearSession();
      throw new RequestError(401, 'session_expired', 'Your session ended. Please sign in again.');
    }
    if (!response.ok) throw new RequestError(response.status, data?.error?.code || 'request_failed', data?.error?.message || 'The request could not be completed. Try again.', data?.error?.fields || data?.fields);
    if (response.status !== 204 && !data) throw new RequestError(response.status, 'invalid_response', 'The workspace returned an incomplete response. Please try again.');
    return data;
  }

  function showError(id, message) { $(id).textContent = message; $(id).hidden = !message; }
  function showAppError(message) { $('app-error-text').textContent = message; $('app-error').hidden = !message; }
  function dateText(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? 'Date unavailable' : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
  }
  function shortDate(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date);
  }
  function leadDraft() { return Object.fromEntries(Object.entries(FIELD_IDS).map(([key, id]) => [key, $(id).value])); }
  function profileDraft() {
    return { businessName: $('business-name').value, facts: Object.fromEntries(FACTS.map(([key]) => [key, { answer: $(`fact-${key}`).value, verified: $(`approve-${key}`).checked }])) };
  }
  function leadDirty() { return Boolean(selected && leadBaseline && JSON.stringify(leadDraft()) !== leadBaseline); }
  function profileDirty() { return Boolean(profile && profileBaseline && JSON.stringify(profileDraft()) !== profileBaseline); }
  function hasDirty() { return Boolean(pendingLeadSave) || leadDirty() || profileDirty() || schedule.isDirty(); }
  function updateDirty() {
    const deleting = deletion.isOpen();
    const taskLocked = schedule.isBusy() || schedule.isPending();
    const requestPending = Boolean(pendingLeadSave);
    const deleteLocked = deleting || !selected || expired || leadSaving || leadLoading || refreshingRequests || exportBusy || hasDirty() || leadConflict || taskLocked;
    $('delete-lead').disabled = deleteLocked;
    $('delete-conversation').disabled = deleteLocked || !selected?.conversation?.length;
    $('lead-fields').disabled = deleting || expired || leadSaving || leadLoading || refreshingRequests || requestPending || taskLocked || schedule.isDirty();
    $('lead-dirty').hidden = !leadDirty();
    $('profile-dirty').hidden = !profileDirty();
    const saveButton = $('save-lead');
    saveButton.disabled = !selected || leadSaving || leadLoading || refreshingRequests || leadConflict || deleting || taskLocked || schedule.isDirty();
    const saveLabel = requestPending ? 'Retry save' : 'Save changes';
    // A field can dispatch change between pointer-down and click on Save.
    if (saveButton.textContent !== saveLabel) saveButton.textContent = saveLabel;
    $('lead-uncertain').hidden = expired || !pendingLeadSave?.uncertain || leadConflict;
    $('reload-uncertain-lead').disabled = expired || !pendingLeadSave?.uncertain || leadSaving || leadLoading || refreshingRequests;
    $('save-profile').disabled = !profile || profileSaving || profileLoading || profileConflict || deleting || requestPending;
    $('export-records').disabled = !user || expired || loading || leadSaving || profileSaving || exportBusy || deleting || taskLocked || requestPending;
    schedule.setLocked(deleting || expired || !user || leadSaving || leadLoading || refreshingRequests || profileSaving || exportBusy || requestPending || leadDirty() || profileDirty() || leadConflict);
  }

  async function exportRecords() {
    if (!user || expired || loading || leadSaving || profileSaving || exportBusy || pendingLeadSave || schedule.isBusy() || schedule.isPending()) return;
    exportBusy = true;
    showError('export-error', '');
    $('export-status').textContent = 'Preparing a copy of the saved records…';
    $('export-records').textContent = 'Preparing export…';
    updateDirty();
    try {
      const data = await api('/api/export');
      if (expired || !user) return;
      if (data?.format !== 'panelreply-business-export' || data.version !== 2 || data.profile?.business?.id !== user.businessId
        || !Array.isArray(data.leads) || !Array.isArray(data.callbackTasks) || typeof data.exportedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(data.exportedAt)) {
        throw new Error('The export response was incomplete. No download was prepared. Try again.');
      }
      const blob = new Blob([JSON.stringify(data, null, 2) + '\n'], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      exportUrls.add(url);
      const link = document.createElement('a');
      link.href = url;
      link.download = `panelreply-records-${data.exportedAt.slice(0, 10)}.json`;
      link.hidden = true;
      document.body.append(link);
      try { link.click(); }
      finally {
        link.remove();
        window.setTimeout(() => { URL.revokeObjectURL(url); exportUrls.delete(url); }, 1000);
      }
      // Browser download initiation does not prove the file was written to disk.
      $('export-status').textContent = 'Export prepared. Check your browser’s downloads. Your unsaved edits remain here.';
    } catch (cause) {
      if (!expired) {
        $('export-status').textContent = '';
        showError('export-error', cause.message || 'Could not prepare the export. Your edits remain here. Try again.');
      }
    } finally {
      exportBusy = false;
      if (!expired) { $('export-records').textContent = 'Export records'; updateDirty(); }
    }
  }

  function guarded(action) {
    if (expired) return;
    if (pendingLeadSave) {
      showAppError(leadConflict
        ? 'Review the saved request with Reload saved version before leaving this draft.'
        : 'The request save is unconfirmed. Use Retry save before leaving this draft.');
      return;
    }
    if (schedule.isPending()) {
      showAppError('Confirm the pending task save with Retry task save before leaving this request.');
      return;
    }
    if (leadSaving || profileSaving || deletion.isOpen() || schedule.isBusy()) {
      showAppError('A save is still in progress. Wait for its result before leaving this view.');
      return;
    }
    if (hasDirty()) {
      pendingNavigation = action;
      $('navigation-guard').hidden = false;
      $('keep-editing').focus();
      $('navigation-guard').scrollIntoView({ block: 'nearest' });
      return;
    }
    action();
  }

  function setView(view) {
    currentView = view;
    const inbox = view === 'inbox';
    $('inbox-view').hidden = !inbox;
    $('profile-view').hidden = view !== 'profile';
    $('schedule-view').hidden = view !== 'schedule';
    for (const name of ['inbox', 'profile', 'schedule']) {
      $(`nav-${name}`).classList.toggle('active', view === name);
      if (view === name) $(`nav-${name}`).setAttribute('aria-current', 'page');
      else $(`nav-${name}`).removeAttribute('aria-current');
    }
    const titles = { inbox: 'Request inbox', profile: 'Business profile', schedule: 'Callback queue' };
    $('page-title').textContent = titles[view];
    $('page-subtitle').textContent = inbox ? 'A clear view of the work coming in.' : view === 'schedule' ? 'Plan callbacks and track each follow-up.' : 'The information your customers can rely on.';
    const programLabel = document.body?.dataset?.productId === 'callback' ? 'PanelReply Callback' : 'PanelReply';
    document.title = `${titles[view]} · ${programLabel}`;
    if (view === 'schedule') void schedule.openQueue();
  }

  function updateBusiness() {
    if (!profile) return;
    const name = profile.business.name;
    $('business-display').textContent = name;
    $('sidebar-business-name').textContent = name;
  }

  function renderList() {
    const counts = { new: 0, needs_review: 0, contacted: 0, closed: 0 };
    for (const lead of leads) if (Object.hasOwn(counts, lead.status)) counts[lead.status] += 1;
    for (const [status, count] of Object.entries(counts)) $(`count-${status}`).textContent = String(count);
    $('nav-new-count').textContent = String(counts.new);
    const needle = $('request-search').value.trim().toLocaleLowerCase();
    const filter = $('status-filter').value;
    const visible = leads.filter(lead => (filter === 'all' || lead.status === filter) && (!needle || [lead.customerName, lead.phone, lead.job, lead.zip, lead.callbackWindow, lead.requestedWorkDate].some(value => String(value || '').toLocaleLowerCase().includes(needle))));
    const fragment = document.createDocumentFragment();
    for (const lead of visible) {
      const item = el('div', 'request-list-item');
      item.setAttribute('role', 'listitem');
      const button = el('button', `request-row${selected?.id === lead.id ? ' selected' : ''}`);
      button.type = 'button';
      button.setAttribute('aria-label', `Open request from ${lead.customerName}`);
      button.setAttribute('aria-pressed', String(selected?.id === lead.id));
      button.dataset.leadId = lead.id;
      const top = el('span', 'request-row-top');
      top.append(el('span', 'request-row-name', lead.customerName), el('span', `badge badge-${Object.hasOwn(STATUS_LABELS, lead.status) ? lead.status : 'neutral'}`, STATUS_LABELS[lead.status] || 'Unknown'));
      const bottom = el('span', 'request-row-bottom');
      bottom.append(el('span', '', `ZIP ${lead.zip}`), el('span', '', shortDate(lead.createdAt)));
      button.append(top, el('span', 'request-row-job', lead.job), bottom);
      if (lead.optedOut || lead.safetyHold) button.append(el('span', 'request-contact-indicator', lead.optedOut ? 'Contact opted out' : 'Safety hold · review needed'));
      button.addEventListener('click', () => {
        if (selected?.id === lead.id) return;
        guarded(() => selectLead(lead.id));
      });
      item.append(button);
      fragment.append(item);
    }
    $('requests-list').replaceChildren(fragment);
    $('list-empty').hidden = visible.length !== 0;
    $('empty-list-title').textContent = leads.length ? 'No matching requests' : 'Your inbox starts here';
    $('empty-list-copy').textContent = leads.length ? 'Try a different name, ZIP, or status filter.' : 'Save a test request from the customer preview to see the full review process.';
    $('empty-preview-link').hidden = leads.length > 0;
    $('list-count').textContent = `${visible.length} of ${leads.length} request${leads.length === 1 ? '' : 's'}`;
    $('list-status').textContent = `${visible.length} matching request${visible.length === 1 ? '' : 's'}`;
  }

  function renderHistory(lead) {
    const conversation = Array.isArray(lead.conversation) ? lead.conversation : [];
    const history = document.createDocumentFragment();
    for (const entry of conversation) {
      const item = el('li', 'history-item');
      item.append(el('p', 'history-heading', entry.role === 'customer' ? 'Customer' : 'Assistant'), el('p', 'history-text', entry.text));
      history.append(item);
    }
    if (!conversation.length) history.append(el('li', 'history-empty', 'No conversation was included with this request.'));
    $('lead-conversation').replaceChildren(history);
    $('conversation-count').textContent = `${conversation.length} message${conversation.length === 1 ? '' : 's'}`;
    const audit = Array.isArray(lead.audit) ? lead.audit : [];
    const activities = document.createDocumentFragment();
    for (const entry of audit.slice().reverse()) {
      const item = el('li', 'history-item');
      const action = { 'lead.created': 'Request saved', 'lead.updated': 'Request updated', 'contact.opted_out': 'Contact opted out', 'contact.suppressed': 'Contact opted out',
        'callback.scheduled': 'Callback task scheduled', 'callback.rescheduled': 'Callback task rescheduled', 'callback.completed': 'Callback outcome recorded', 'callback.cancelled': 'Callback task cancelled' }[entry.action] || 'Request activity recorded';
      item.append(el('p', 'history-heading', action), el('p', 'history-text', `${dateText(entry.createdAt)} · Revision ${entry.version}`));
      const fields = entry.details?.fields;
      if (entry.action === 'lead.updated' && Array.isArray(fields)) {
        const names = fields.map(key => FIELD_LABELS[key]).filter(Boolean);
        if (names.length) item.append(el('p', 'history-text', `Fields reviewed: ${names.join(', ')}`));
      }
      activities.append(item);
    }
    if (!audit.length) activities.append(el('li', 'history-empty', 'No activity has been recorded.'));
    $('lead-audit').replaceChildren(activities);
    $('audit-count').textContent = `${audit.length} event${audit.length === 1 ? '' : 's'}`;
  }

  function updateAllowedStatuses() {
    if (!selected) return;
    const permission = $('lead-permission').value;
    const allowed = selected.safetyHold
      ? ['needs_review']
      : selected.optedOut || permission !== 'requested_callback'
        ? ['needs_review', 'closed']
        : Object.keys(STATUS_LABELS);
    for (const option of $('lead-status-select').options) option.disabled = !allowed.includes(option.value);
    if (!allowed.includes($('lead-status-select').value)) $('lead-status-select').value = 'needs_review';
    $('lead-status-help').textContent = selected.safetyHold
      ? 'A safety hold keeps this request under review.'
      : selected.optedOut
        ? 'An opted-out request can remain under review or be closed.'
        : permission !== 'requested_callback'
          ? 'Record a callback request before using New or Contacted.'
          : 'Track follow-up here. No message is sent by changing status.';
  }

  function renderLead(lead, savedMessage = '') {
    selected = lead;
    leadConflict = false;
    $('request-empty').hidden = true;
    $('lead-detail').hidden = false;
    $('lead-title').textContent = lead.customerName;
    $('lead-meta').textContent = `Received ${dateText(lead.createdAt)}`;
    $('lead-version').textContent = `Revision ${lead.version}`;
    for (const [key, id] of Object.entries(FIELD_IDS)) $(id).value = String(lead[key] ?? '');
    $('lead-fields').disabled = refreshingRequests || leadLoading;
    updateAllowedStatuses();
    const badges = document.createDocumentFragment();
    badges.append(el('span', `badge badge-${Object.hasOwn(STATUS_LABELS, lead.status) ? lead.status : 'neutral'}`, STATUS_LABELS[lead.status] || 'Unknown'));
    if (lead.optedOut) badges.append(el('span', 'badge badge-danger', 'Contact opted out'));
    else if (lead.safetyHold) badges.append(el('span', 'badge badge-warning', 'Safety hold'));
    else if (lead.contactAllowed) badges.append(el('span', 'badge badge-ok', 'Callback requested'));
    else badges.append(el('span', 'badge badge-neutral', 'Contact permission not recorded'));
    $('lead-badges').replaceChildren(badges);
    const hold = [];
    if (lead.safetyHold) hold.push('This request contains a safety concern. Keep it under review. Automated follow-up is held.');
    if (lead.optedOut) hold.push('This phone number has opted out. Changing a field or creating another request does not remove that opt-out.');
    $('lead-safety-message').textContent = hold.join(' ');
    $('lead-safety-message').hidden = !hold.length;
    $('lead-permission-help').textContent = lead.optedOut ? 'A saved opt-out remains in effect even if the permission field is changed.' : 'Only record a callback request when the customer has asked for one.';
    showError('lead-error', '');
    $('lead-conflict').hidden = true;
    $('lead-status').textContent = savedMessage;
    renderHistory(lead);
    leadBaseline = JSON.stringify(leadDraft());
    schedule.selectLead(lead);
    renderList();
    updateDirty();
  }

  async function selectLead(id) {
    const serial = ++selectionSerial;
    leadLoading = true;
    updateDirty();
    $('list-status').textContent = 'Loading request details…';
    if (selected) $('lead-fields').disabled = true;
    try {
      const data = await api(`/api/leads/${encodeURIComponent(id)}`);
      if (serial !== selectionSerial || expired) return;
      if (!window.PanelReplySchedule.validLeadReceipt(data?.lead) || data.lead.id !== id) throw new Error('The request details were incomplete. Please try again.');
      renderLead(data.lead);
      const url = new URL(window.location.href);
      url.searchParams.set('lead', data.lead.id);
      window.history.replaceState(null, '', `${url.pathname}${url.search}`);
      $('list-status').textContent = `Opened request from ${data.lead.customerName}`;
    } catch (cause) {
      if (serial !== selectionSerial || expired) return;
      showAppError(cause.message || 'Could not load the request. Try again.');
    } finally {
      if (serial === selectionSerial && !expired) {
        leadLoading = false;
        if (selected) $('lead-fields').disabled = leadSaving || refreshingRequests;
        updateDirty();
      }
    }
  }

  function buildProfileFields() {
    const fragment = document.createDocumentFragment();
    for (const [key, label, description] of FACTS) {
      const card = el('section', 'panel fact-card');
      const heading = el('div', 'fact-card-header');
      const title = el('h3', '', label);
      title.id = `fact-title-${key}`;
      card.setAttribute('aria-labelledby', title.id);
      const badge = el('span', 'badge badge-neutral', 'Not approved');
      badge.id = `fact-badge-${key}`;
      heading.append(title, badge);
      const field = el('div', 'form-field');
      const fieldLabel = el('label', '', `${label} answer`);
      fieldLabel.htmlFor = `fact-${key}`;
      const textarea = el('textarea');
      textarea.id = `fact-${key}`;
      textarea.name = key;
      textarea.rows = 4;
      textarea.maxLength = 1000;
      textarea.placeholder = 'Add a checked business answer…';
      field.append(fieldLabel, textarea);
      const approval = el('label', 'approval-label');
      approval.htmlFor = `approve-${key}`;
      const checkbox = el('input');
      checkbox.id = `approve-${key}`;
      checkbox.type = 'checkbox';
      checkbox.name = `${key}-approved`;
      approval.append(checkbox, el('span', '', `Use ${label} answer in chat`));
      card.append(heading, el('p', 'fact-description', description), field, approval);
      fragment.append(card);
    }
    $('profile-facts').replaceChildren(fragment);
  }

  function updateApprovals() {
    let approved = 0;
    for (const [key] of FACTS) {
      const checked = $(`approve-${key}`).checked;
      const answer = $(`fact-${key}`);
      answer.required = checked;
      answer.setCustomValidity(checked && !answer.value.trim() ? 'Add an answer before approving this topic.' : '');
      const badge = $(`fact-badge-${key}`);
      badge.textContent = checked ? 'Approved' : 'Not approved';
      badge.className = `badge ${checked ? 'badge-ok' : 'badge-neutral'}`;
      if (checked && answer.value.trim()) approved += 1;
    }
    $('approved-count').textContent = `${approved} of ${FACTS.length}`;
  }

  function renderProfile(value, savedMessage = '') {
    profile = value;
    profileConflict = false;
    $('business-name').value = value.business.name;
    for (const [key] of FACTS) {
      $(`fact-${key}`).value = value.facts?.[key]?.answer || '';
      $(`approve-${key}`).checked = value.facts?.[key]?.verified === true;
    }
    $('profile-fields').disabled = profileLoading;
    $('profile-version').textContent = `Revision ${value.version}`;
    $('profile-status').textContent = savedMessage;
    $('profile-conflict').hidden = true;
    showError('profile-error', '');
    profileBaseline = JSON.stringify(profileDraft());
    updateBusiness();
    updateApprovals();
    updateDirty();
  }

  function markInvalid(cause, form, mapping) {
    if (!Array.isArray(cause.fields)) return;
    for (const field of cause.fields) {
      const target = mapping[field] ? $(mapping[field]) : null;
      if (target && form.contains(target)) {
        target.setAttribute('aria-invalid', 'true');
        target.focus();
        return;
      }
    }
  }

  function beginLeadDeletion(kind) {
    if (!selected || expired || leadSaving || leadLoading || refreshingRequests || exportBusy || hasDirty() || leadConflict || schedule.isBusy() || schedule.isPending()) return;
    const conversationOnly = kind === 'lead_conversation';
    deletion.request({
      kind, id: selected.id, version: selected.version,
      url: `/api/leads/${encodeURIComponent(selected.id)}${conversationOnly ? '/conversation' : ''}`,
      title: conversationOnly ? 'Delete conversation?' : 'Delete customer request?',
      description: conversationOnly
        ? 'Remove the saved conversation from this request. Request fields and contact restrictions stay in place.'
        : 'Remove this request, its callback tasks, notes and saved conversation from the active workspace.'
    });
  }
  async function deletedLead(operation) {
    if (expired) return;
    if (operation.kind === 'lead') {
      leads = leads.filter(item => item.id !== operation.id);
      selected = null; leadBaseline = ''; leadConflict = false; selectionSerial += 1;
      schedule.selectLead(null);
      $('lead-form').reset(); $('lead-conversation').replaceChildren(); $('lead-audit').replaceChildren();
      $('lead-detail').hidden = true; $('request-empty').hidden = false;
      const url = new URL(location.href); url.searchParams.delete('lead'); history.replaceState(null, '', url.pathname + url.search);
      renderList(); $('list-status').textContent = 'Request deletion confirmed.';
      $('request-search').focus(); updateDirty();
      return;
    }
    // Clear deleted text immediately, even if the follow-up read fails.
    if (selected?.id === operation.id) {
      selected = null; leadBaseline = ''; $('lead-conversation').replaceChildren(); $('lead-audit').replaceChildren();
      schedule.selectLead(null);
      $('lead-detail').hidden = true; $('request-empty').hidden = false;
    }
    $('list-status').textContent = 'Conversation deletion confirmed. Loading the remaining request…';
    await selectLead(operation.id);
    if (!expired && selected?.id === operation.id) $('lead-status').textContent = 'Conversation deleted. Contact restrictions remain.';
  }

  function receiptPhone(value) {
    if (typeof value !== 'string' || value.length > 40 || !value.isWellFormed()
      || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) return null;
    const input = value.trim();
    if (!/^\+?[\d\s().-]+$/.test(input)) return null;
    let digits = input.replace(/\D/g, '');
    if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);
    if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(digits) || (input.startsWith('+') && !input.startsWith('+1'))) return null;
    return '+1' + digits;
  }

  function savedLeadMatches(lead, command) {
    const limits = { customerName: 120, job: 2000, zip: 5, callbackWindow: 200, requestedWorkDate: 200, notes: 2000 };
    for (const [key, limit] of Object.entries(limits)) {
      const input = command.body[key];
      if (typeof input !== 'string' || input.length > limit || !input.isWellFormed()
        || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(input) || lead[key] !== input.trim()) return false;
    }
    const phone = receiptPhone(command.body.phone);
    if (!phone || lead.phone !== phone || lead.status !== command.body.status || !/[a-z]/i.test(command.body.job)) return false;
    // The public permission reflects the current phone suppression, including
    // restrictions discovered while saving or after an uncertain write.
    if (lead.contactPermission !== (lead.optedOut ? 'opted_out' : command.body.contactPermission)
      || (command.body.contactPermission === 'opted_out' && !lead.optedOut)
      || (command.optedOut && receiptPhone(command.phone) === phone && !lead.optedOut)
      || (command.safetyHold && !lead.safetyHold)
      || (lead.safetyHold && lead.status !== 'needs_review')
      || ((lead.optedOut || lead.contactPermission !== 'requested_callback') && ['new', 'contacted'].includes(lead.status))) return false;
    return true;
  }

  function validSavedLead(lead, command) {
    return selected?.id === command.id && selected.createdAt === command.createdAt
      && window.PanelReplySchedule.validLeadReceipt(lead) && lead.id === command.id && lead.createdAt === command.createdAt
      && Date.parse(lead.updatedAt) >= Date.parse(command.updatedAt);
  }

  function acceptLeadSave(lead, message) {
    const index = leads.findIndex(item => item.id === lead.id);
    if (index >= 0) leads[index] = lead; else leads.unshift(lead);
    renderLead(lead, `${message} · ${dateText(lead.updatedAt)}`);
    pendingLeadSave = null;
  }

  async function confirmLeadValues(command) {
    const data = await api(`/api/leads/${encodeURIComponent(command.id)}`);
    if (expired || pendingLeadSave !== command) return;
    if (!validSavedLead(data?.lead, command) || data.lead.version <= command.body.version) {
      throw new Error('The saved request could not be confirmed at a later revision. Your draft is still here. Use Retry save.');
    }
    if (!savedLeadMatches(data.lead, command)) {
      leadConflict = true;
      $('lead-conflict').hidden = false;
      showError('lead-error', 'The saved request now differs from this draft. Your previous save may have completed. Use Reload saved version to review it before making another change.');
      return;
    }
    // PATCH has no idempotency receipt. This confirms current saved values,
    // not which earlier command or writer produced them.
    acceptLeadSave(data.lead, 'Saved values confirmed');
  }

  function closeNavigationGuard() {
    pendingNavigation = null;
    pendingLeadReview = null;
    $('navigation-guard').hidden = true;
    $('guard-title').textContent = 'You have unsaved changes';
    $('guard-description').textContent = 'Keep editing, or discard these changes before leaving this view.';
  }

  async function reloadReviewedLead(command) {
    if (pendingLeadSave !== command || expired || leadSaving || leadLoading) return;
    leadLoading = true;
    updateDirty();
    try {
      const data = await api(`/api/leads/${encodeURIComponent(command.id)}`);
      if (expired || pendingLeadSave !== command) return;
      if (!validSavedLead(data?.lead, command) || data.lead.version < command.body.version) throw new Error('The saved request details were incomplete. Your draft is still here. Try Reload saved version again.');
      // The owner chose to discard this command after reviewing the conflict.
      // Do not discard it until a complete current record is available.
      acceptLeadSave(data.lead, 'Saved version loaded. Previous save outcome not established');
    } catch (cause) {
      if (!expired) showError('lead-error', cause.message || 'Could not load the saved request. Your draft is still here.');
    } finally {
      leadLoading = false;
      if (!expired) updateDirty();
    }
  }

  function reviewLeadReload() {
    if (!pendingLeadSave) return guarded(() => { if (selected) selectLead(selected.id); });
    if (!pendingLeadSave.uncertain || leadSaving || leadLoading || expired) return;
    pendingLeadReview = pendingLeadSave;
    pendingNavigation = null;
    $('guard-title').textContent = 'Load the current saved request?';
    $('guard-description').textContent = 'This discards your draft and stops retrying it. Your previous save may have completed. The saved request will load only after its details are confirmed.';
    $('navigation-guard').hidden = false;
    $('keep-editing').focus();
    $('navigation-guard').scrollIntoView({ block: 'nearest' });
  }

  async function saveLead(event) {
    event.preventDefault();
    if (!selected || expired || leadSaving || leadLoading || refreshingRequests || leadConflict || deletion.isOpen() || schedule.isBusy() || schedule.isPending() || schedule.isDirty()
      || (!pendingLeadSave && !$('lead-form').reportValidity())) return;
    leadSaving = true;
    const command = pendingLeadSave || { id: selected.id, createdAt: selected.createdAt, updatedAt: selected.updatedAt,
      phone: selected.phone, optedOut: selected.optedOut, safetyHold: selected.safetyHold,
      body: { version: selected.version, ...leadDraft() }, uncertain: false };
    pendingLeadSave = command;
    closeNavigationGuard();
    showError('lead-error', '');
    $('lead-status').textContent = 'Saving changes…';
    $('lead-fields').disabled = true;
    updateDirty();
    try {
      const data = await api(`/api/leads/${encodeURIComponent(command.id)}`, { method: 'PATCH', body: command.body });
      if (expired || pendingLeadSave !== command) return;
      if (!validSavedLead(data?.lead, command) || data.lead.version !== command.body.version + 1
        || data.lead.version >= Number.MAX_SAFE_INTEGER || !savedLeadMatches(data.lead, command)) {
        throw new Error('The save response did not confirm this request and its submitted values. Your draft is still here. Use Retry save.');
      }
      acceptLeadSave(data.lead, 'Changes saved');
    } catch (cause) {
      if (expired) return;
      $('lead-status').textContent = '';
      if (!cause.status || cause.status >= 500 || cause.status < 400 || cause.status === 408 || cause.status === 429) command.uncertain = true;
      if (!command.uncertain) pendingLeadSave = null;
      showError('lead-error', cause.message || 'Could not save the changes. Your edits are still here.');
      if (cause.status === 409 && cause.code === 'version_conflict') {
        if (command.uncertain) {
          try { await confirmLeadValues(command); }
          catch (readError) { if (!expired) showError('lead-error', readError.message || 'The saved request could not be confirmed. Your draft is still here. Use Retry save.'); }
        } else {
          leadConflict = true;
          $('lead-conflict').hidden = false;
        }
      }
      markInvalid(cause, $('lead-form'), FIELD_IDS);
    } finally {
      leadSaving = false;
      if (!expired) {
        $('lead-fields').disabled = false;
        updateDirty();
      }
    }
  }

  async function saveProfile(event) {
    event.preventDefault();
    updateApprovals();
    if (!profile || profileSaving || profileLoading || profileConflict || pendingLeadSave || !$('profile-form').reportValidity()) return;
    profileSaving = true;
    const payload = { version: profile.version, ...profileDraft() };
    showError('profile-error', '');
    $('profile-status').textContent = 'Saving business profile…';
    $('profile-fields').disabled = true;
    updateDirty();
    try {
      const data = await api('/api/profile', { method: 'PATCH', body: payload });
      if (expired) return;
      if (!data?.business || !data.facts) throw new Error('The save response was incomplete. Reload the saved version before making another change.');
      renderProfile(data, 'Business profile saved. Approved answers are ready in the customer preview.');
    } catch (cause) {
      if (expired) return;
      $('profile-status').textContent = '';
      showError('profile-error', cause.message || 'Could not save the profile. Your edits are still here.');
      if (cause.status === 409 && cause.code === 'version_conflict') {
        profileConflict = true;
        $('profile-conflict').hidden = false;
      }
      markInvalid(cause, $('profile-form'), { businessName: 'business-name' });
    } finally {
      profileSaving = false;
      if (!expired) {
        $('profile-fields').disabled = false;
        updateDirty();
      }
    }
  }

  async function refreshRequests() {
    if (loading) return;
    loading = true;
    refreshingRequests = true;
    $('lead-fields').disabled = true;
    updateDirty();
    $('refresh-requests').disabled = true;
    showAppError('');
    const id = selected?.id;
    $('list-status').textContent = 'Refreshing requests…';
    try {
      const data = await api('/api/leads');
      if (expired) return;
      if (!Array.isArray(data.leads)) throw new Error('The request list was incomplete. Please try again.');
      leads = data.leads;
      renderList();
      if (id && selected?.id === id && !leadDirty()) await selectLead(id);
      $('list-status').textContent = 'Request list refreshed.';
    } catch (cause) { if (!expired) showAppError(cause.message); }
    finally {
      loading = false;
      refreshingRequests = false;
      $('refresh-requests').disabled = false;
      if (!expired) { $('lead-fields').disabled = leadSaving || leadLoading; updateDirty(); }
    }
  }

  async function loadProfile() {
    if (profileLoading) return;
    profileLoading = true;
    $('profile-fields').disabled = true;
    updateDirty();
    showError('profile-error', '');
    try {
      const data = await api('/api/profile');
      if (!expired) renderProfile(data);
    } catch (cause) { if (!expired) showError('profile-error', cause.message); }
    finally {
      profileLoading = false;
      if (!expired) { $('profile-fields').disabled = !profile || profileSaving; updateDirty(); }
    }
  }

  async function bootstrap() {
    if (loading) return;
    loading = true;
    refreshingRequests = true;
    profileLoading = true;
    $('lead-fields').disabled = true;
    $('profile-fields').disabled = true;
    updateDirty();
    $('retry-load').disabled = true;
    showAppError('');
    try {
      const session = await api('/api/session');
      if (expired) return;
      if (!session?.user || typeof session.csrfToken !== 'string') throw new Error('Your sign-in could not be confirmed. Please reload and sign in again.');
      if (document.body?.dataset?.productId && session.product?.id !== document.body.dataset.productId) throw new Error('The signed-in program could not be confirmed. Reload this page and sign in again.');
      if (user && (user.id !== session.user.id || user.businessId !== session.user.businessId || csrfToken !== session.csrfToken)) { clearSession(); return; }
      user = session.user;
      csrfToken = session.csrfToken;
      $('signed-in-name').textContent = user.username || 'Workspace owner';
      const results = await Promise.allSettled([api('/api/profile'), api('/api/leads')]);
      if (expired) return;
      const messages = [];
      if (results[0].status === 'fulfilled') { renderProfile(results[0].value); if (window.location.hash === '#settings') setView('profile'); }
      else messages.push(`Business profile: ${results[0].reason.message}`);
      if (results[1].status === 'fulfilled' && Array.isArray(results[1].value.leads)) {
        leads = results[1].value.leads;
        renderList();
        const deepLink = new URL(window.location.href).searchParams.get('lead');
        if (deepLink) await selectLead(deepLink);
      } else {
        messages.push(`Requests: ${results[1].status === 'rejected' ? results[1].reason.message : 'The list was incomplete. Please try again.'}`);
        $('list-count').textContent = 'Requests could not be loaded';
      }
      if (messages.length) showAppError(messages.join(' '));
    } catch (cause) { if (!expired) showAppError(cause.message || 'Could not open the workspace. Please try again.'); }
    finally {
      loading = false;
      refreshingRequests = false;
      profileLoading = false;
      $('retry-load').disabled = false;
      if (!expired) {
        $('lead-fields').disabled = !selected || leadSaving || leadLoading;
        $('profile-fields').disabled = !profile || profileSaving;
        updateDirty();
      }
    }
  }

  buildProfileFields();
  $('nav-inbox').addEventListener('click', () => { if (currentView !== 'inbox') guarded(() => setView('inbox')); });
  $('nav-schedule').addEventListener('click', () => { if (currentView !== 'schedule') guarded(() => setView('schedule')); });
  $('nav-profile').addEventListener('click', () => { if (currentView !== 'profile') guarded(() => setView('profile')); });
  for (const id of ['preview-link', 'empty-preview-link', 'home-link', 'dashboard-link', 'panels-link', 'projects-link', 'exports-link']) {
    const link = $(id);
    if (link) link.addEventListener('click', event => { event.preventDefault(); guarded(() => { window.location.assign(link.getAttribute('href')); }); });
  }
  $('sign-out').addEventListener('click', () => guarded(async () => {
    $('sign-out').disabled = true;
    try { await api('/api/logout', { method: 'POST' }); if (!expired) clearSession(); }
    catch (cause) { if (!expired) { showAppError(`Could not sign out. ${cause.message}`); $('sign-out').disabled = false; } }
  }));
  $('keep-editing').addEventListener('click', closeNavigationGuard);
  $('discard-changes').addEventListener('click', () => {
    if (leadSaving || leadLoading || schedule.isBusy() || schedule.isPending()) return;
    if (pendingLeadSave) {
      if (pendingLeadReview !== pendingLeadSave) return;
      const command = pendingLeadSave;
      closeNavigationGuard();
      return reloadReviewedLead(command);
    }
    const action = pendingNavigation;
    closeNavigationGuard();
    if (selected) renderLead(selected);
    if (profile) renderProfile(profile);
    schedule.discard();
    if (action) action();
  });
  $('request-search').addEventListener('input', renderList);
  $('status-filter').addEventListener('change', renderList);
  for (const button of document.querySelectorAll('[data-count-status]')) button.addEventListener('click', () => { $('status-filter').value = button.dataset.countStatus; renderList(); $('requests-title').scrollIntoView({ block: 'nearest' }); });
  $('refresh-requests').addEventListener('click', () => guarded(refreshRequests));
  $('export-records').addEventListener('click', exportRecords);
  $('retry-load').addEventListener('click', () => guarded(bootstrap));
  $('delete-lead').addEventListener('click', () => beginLeadDeletion('lead'));
  $('delete-conversation').addEventListener('click', () => beginLeadDeletion('lead_conversation'));
  $('lead-form').addEventListener('submit', saveLead);
  $('profile-form').addEventListener('submit', saveProfile);
  $('lead-form').addEventListener('input', event => { event.target.removeAttribute('aria-invalid'); $('lead-status').textContent = ''; updateDirty(); });
  $('lead-form').addEventListener('change', () => { updateAllowedStatuses(); updateDirty(); });
  $('profile-form').addEventListener('input', event => { event.target.removeAttribute('aria-invalid'); $('profile-status').textContent = ''; updateApprovals(); updateDirty(); });
  $('profile-form').addEventListener('change', () => { $('profile-status').textContent = ''; updateApprovals(); updateDirty(); });
  $('reload-lead').addEventListener('click', reviewLeadReload);
  $('reload-uncertain-lead').addEventListener('click', reviewLeadReload);
  $('reload-profile').addEventListener('click', () => guarded(loadProfile));
  window.addEventListener('beforeunload', event => { if (!expired && (hasDirty() || leadSaving || profileSaving || deletion.isPending() || schedule.isPending() || schedule.isBusy())) { event.preventDefault(); event.returnValue = ''; } });
  window.addEventListener('focus', () => { if (csrfToken && !expired) api('/api/session').catch(() => {}); });
  bootstrap();
})();
