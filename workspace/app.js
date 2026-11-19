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
    csrfToken = '';
    user = null;
    leads = [];
    selected = null;
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
    $('profile-form').reset();
    $('lead-conversation').replaceChildren();
    $('lead-audit').replaceChildren();
    $('lead-detail').hidden = true;
    $('profile-view').hidden = true;
    window.location.replace('/login');
  }

  async function api(path, options = {}) {
    const method = options.method || 'GET';
    const headers = { Accept: 'application/json' };
    if (csrfToken) headers['X-Workspace-Session'] = csrfToken;
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    if (method !== 'GET') headers['X-CSRF-Token'] = csrfToken;
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
  function hasDirty() { return leadDirty() || profileDirty(); }
  function updateDirty() {
    $('lead-dirty').hidden = !leadDirty();
    $('profile-dirty').hidden = !profileDirty();
    $('save-lead').disabled = !selected || leadSaving || leadLoading || refreshingRequests || leadConflict;
    $('save-profile').disabled = !profile || profileSaving || profileLoading || profileConflict;
    $('export-records').disabled = !user || expired || loading || leadSaving || profileSaving || exportBusy;
  }

  async function exportRecords() {
    if (!user || expired || loading || leadSaving || profileSaving || exportBusy) return;
    exportBusy = true;
    showError('export-error', '');
    $('export-status').textContent = 'Preparing a copy of the saved records…';
    $('export-records').textContent = 'Preparing export…';
    updateDirty();
    try {
      const data = await api('/api/export');
      if (expired || !user) return;
      if (data?.format !== 'panelreply-business-export' || data.version !== 1 || data.profile?.business?.id !== user.businessId
        || !Array.isArray(data.leads) || typeof data.exportedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(data.exportedAt)) {
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
    if (leadSaving || profileSaving) {
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
    $('profile-view').hidden = inbox;
    $('nav-inbox').classList.toggle('active', inbox);
    $('nav-profile').classList.toggle('active', !inbox);
    $('nav-inbox').toggleAttribute('aria-current', inbox);
    $('nav-profile').toggleAttribute('aria-current', !inbox);
    if (inbox) $('nav-inbox').setAttribute('aria-current', 'page');
    else $('nav-profile').setAttribute('aria-current', 'page');
    $('page-title').textContent = inbox ? 'Request inbox' : 'Business profile';
    $('page-subtitle').textContent = inbox ? 'A clear view of the work coming in.' : 'The information your customers can rely on.';
    document.title = `${inbox ? 'Request inbox' : 'Business profile'} · PanelReply`;
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
      const action = { 'lead.created': 'Request saved', 'lead.updated': 'Request updated', 'contact.opted_out': 'Contact opted out', 'contact.suppressed': 'Contact opted out' }[entry.action] || 'Request activity recorded';
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
      if (!data?.lead?.id) throw new Error('The request details were incomplete. Please try again.');
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

  async function saveLead(event) {
    event.preventDefault();
    if (!selected || leadSaving || leadLoading || refreshingRequests || leadConflict || !$('lead-form').reportValidity()) return;
    leadSaving = true;
    const id = selected.id;
    const payload = { version: selected.version, ...leadDraft() };
    showError('lead-error', '');
    $('lead-status').textContent = 'Saving changes…';
    $('lead-fields').disabled = true;
    updateDirty();
    try {
      const data = await api(`/api/leads/${encodeURIComponent(id)}`, { method: 'PATCH', body: payload });
      if (expired) return;
      if (!data?.lead?.id) throw new Error('The save response was incomplete. Reload the saved version before making another change.');
      const index = leads.findIndex(lead => lead.id === data.lead.id);
      if (index >= 0) leads[index] = data.lead;
      else leads.unshift(data.lead);
      renderLead(data.lead, `Changes saved · ${dateText(data.lead.updatedAt)}`);
    } catch (cause) {
      if (expired) return;
      $('lead-status').textContent = '';
      showError('lead-error', cause.message || 'Could not save the changes. Your edits are still here.');
      if (cause.status === 409 && cause.code === 'version_conflict') {
        leadConflict = true;
        $('lead-conflict').hidden = false;
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
    if (!profile || profileSaving || profileLoading || profileConflict || !$('profile-form').reportValidity()) return;
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
  $('nav-profile').addEventListener('click', () => { if (currentView !== 'profile') guarded(() => setView('profile')); });
  for (const id of ['preview-link', 'empty-preview-link', 'home-link', 'dashboard-link', 'panels-link', 'projects-link', 'exports-link']) $(id).addEventListener('click', event => { event.preventDefault(); guarded(() => { window.location.assign($(id).getAttribute('href')); }); });
  $('sign-out').addEventListener('click', () => guarded(async () => {
    $('sign-out').disabled = true;
    try { await api('/api/logout', { method: 'POST' }); if (!expired) clearSession(); }
    catch (cause) { if (!expired) { showAppError(`Could not sign out. ${cause.message}`); $('sign-out').disabled = false; } }
  }));
  $('keep-editing').addEventListener('click', () => { pendingNavigation = null; $('navigation-guard').hidden = true; });
  $('discard-changes').addEventListener('click', () => {
    const action = pendingNavigation;
    pendingNavigation = null;
    $('navigation-guard').hidden = true;
    if (selected) renderLead(selected);
    if (profile) renderProfile(profile);
    if (action) action();
  });
  $('request-search').addEventListener('input', renderList);
  $('status-filter').addEventListener('change', renderList);
  for (const button of document.querySelectorAll('[data-count-status]')) button.addEventListener('click', () => { $('status-filter').value = button.dataset.countStatus; renderList(); $('requests-title').scrollIntoView({ block: 'nearest' }); });
  $('refresh-requests').addEventListener('click', () => guarded(refreshRequests));
  $('export-records').addEventListener('click', exportRecords);
  $('retry-load').addEventListener('click', () => guarded(bootstrap));
  $('lead-form').addEventListener('submit', saveLead);
  $('profile-form').addEventListener('submit', saveProfile);
  $('lead-form').addEventListener('input', event => { event.target.removeAttribute('aria-invalid'); $('lead-status').textContent = ''; updateDirty(); });
  $('lead-form').addEventListener('change', () => { updateAllowedStatuses(); updateDirty(); });
  $('profile-form').addEventListener('input', event => { event.target.removeAttribute('aria-invalid'); $('profile-status').textContent = ''; updateApprovals(); updateDirty(); });
  $('profile-form').addEventListener('change', () => { $('profile-status').textContent = ''; updateApprovals(); updateDirty(); });
  $('reload-lead').addEventListener('click', () => guarded(() => { if (selected) selectLead(selected.id); }));
  $('reload-profile').addEventListener('click', () => guarded(loadProfile));
  window.addEventListener('beforeunload', event => { if (!expired && (hasDirty() || leadSaving || profileSaving)) { event.preventDefault(); event.returnValue = ''; } });
  window.addEventListener('focus', () => { if (csrfToken && !expired) api('/api/session').catch(() => {}); });
  bootstrap();
})();
