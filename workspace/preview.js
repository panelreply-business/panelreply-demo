(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const FIELDS = { customerName: 'preview-name', phone: 'preview-phone', job: 'preview-job', zip: 'preview-zip', callbackWindow: 'preview-callback', requestedWorkDate: 'preview-work-date' };
  const LABELS = { customerName: 'customer name', phone: 'phone number', job: 'electrical work', zip: 'job ZIP', callbackWindow: 'callback window', requestedWorkDate: 'requested work date' };
  const newState = () => ({ customerName: '', phone: '', job: '', zip: '', callbackWindow: '', requestedWorkDate: '', stopped: false, hold: false, issues: [], conversation: [] });
  let state = newState();
  let csrfToken = '';
  let ready = false;
  let expired = false;
  let messageBusy = false;
  let saveBusy = false;
  let savedLead = null;
  let pendingSave = null;
  let idempotencyKey = null;
  let messageController = null;
  let generation = 0;
  let pendingNavigation = null;
  let limitReached = false;

  class RequestError extends Error {
    constructor(status, code, message, fields) { super(message); this.status = status; this.code = code; this.fields = fields; }
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
  }

  function error(message) { $('preview-error').textContent = message; $('preview-error').hidden = !message; }
  function textFields() { return Object.fromEntries(Object.entries(FIELDS).map(([key, id]) => [key, $(id).value])); }
  function hasDraft() {
    return !savedLead && (state.conversation.length > 0 || Object.values(textFields()).some(value => value.trim()) || $('customer-message').value.trim() || $('preview-permission').value !== 'not_recorded');
  }
  function uuid() {
    if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    const hex = Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  function clearSession() {
    expired = true;
    ready = false;
    csrfToken = '';
    generation += 1;
    messageController?.abort();
    state = newState();
    pendingSave = null;
    savedLead = null;
    idempotencyKey = null;
    $('request-form').reset();
    $('message-form').reset();
    $('conversation').replaceChildren();
    $('save-success').hidden = true;
    $('saved-request-summary').textContent = '';
    $('saved-request-link').href = '/';
    updateControls();
    window.location.replace('/login');
  }

  async function api(path, options = {}) {
    const method = options.method || 'GET';
    const headers = { Accept: 'application/json', ...(options.headers || {}) };
    if (csrfToken) headers['X-Workspace-Session'] = csrfToken;
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    if (method !== 'GET') headers['X-CSRF-Token'] = csrfToken;
    let response;
    try {
      response = await fetch(path, { method, headers, credentials: 'same-origin', cache: 'no-store', signal: options.signal, body: options.body === undefined ? undefined : JSON.stringify(options.body) });
    } catch (cause) {
      if (cause.name === 'AbortError') throw cause;
      throw new RequestError(0, 'network_error', 'Could not reach the workspace. Your draft is still here.');
    }
    const data = response.status === 204 ? null : await response.json().catch(() => null);
    if (response.status === 401) {
      clearSession();
      throw new RequestError(401, 'session_expired', 'Your session ended. Please sign in again.');
    }
    if (!response.ok) throw new RequestError(response.status, data?.error?.code || 'request_failed', data?.error?.message || 'The request could not be completed. Please try again.', data?.error?.fields || data?.fields);
    if (response.status !== 204 && !data) throw new RequestError(response.status, 'invalid_response', 'The workspace returned an incomplete response.');
    return data;
  }

  window.addEventListener('focus', () => { if (csrfToken && !expired) api('/api/session').catch(() => {}); });

  function updateControls() {
    const locked = !ready || expired || saveBusy || Boolean(savedLead) || Boolean(pendingSave);
    $('preview-fields').disabled = locked || messageBusy;
    $('customer-message').disabled = locked || messageBusy;
    $('send-message').disabled = locked || messageBusy || limitReached;
    $('save-request').disabled = locked || messageBusy;
    $('reset-draft').disabled = !ready || expired || saveBusy || Boolean(pendingSave);
    $('retry-save').disabled = saveBusy || !ready;
    $('confirm-review').disabled = locked || messageBusy;
    $('preview-permission').disabled = state.stopped;
    $('save-request').textContent = savedLead ? 'Request saved' : saveBusy ? 'Saving request…' : 'Save request';
    $('send-message').textContent = messageBusy ? 'Sending…' : 'Send message';
    $('reset-draft').textContent = savedLead ? 'Start new draft' : 'Reset draft';
    $('draft-badge').textContent = savedLead ? 'Saved to inbox' : pendingSave ? 'Save unconfirmed' : 'Unsaved draft';
    $('draft-badge').className = `badge ${savedLead ? 'badge-ok' : pendingSave ? 'badge-warning' : 'badge-neutral'}`;
    $('save-retry-notice').hidden = !pendingSave || saveBusy;
  }

  function renderIssues() {
    const issues = Array.isArray(state.issues) ? state.issues.filter(key => Object.hasOwn(FIELDS, key)) : [];
    $('preview-issues').hidden = !issues.length || Boolean(savedLead);
    $('preview-issues-text').textContent = issues.length ? `The conversation needs confirmation of the ${issues.map(key => LABELS[key]).join(', ')}. Check the fields, correct anything needed, then confirm these details.` : '';
  }

  function renderState() {
    for (const [key, id] of Object.entries(FIELDS)) $(id).value = state[key] || '';
    if (state.stopped) $('preview-permission').value = 'opted_out';
    const log = $('conversation');
    let rendered = log.children.length;
    if (rendered > state.conversation.length) { log.replaceChildren(); rendered = 0; }
    for (const entry of state.conversation.slice(rendered)) {
      const customer = entry.role === 'customer';
      const bubble = el('div', `chat-message${customer ? ' customer-message' : ''}`);
      bubble.append(el('span', 'message-author', customer ? 'Customer' : 'Request assistant'), el('p', 'message-text', entry.text));
      log.append(bubble);
    }
    if (state.conversation.length > rendered) log.scrollTop = log.scrollHeight;
    const messages = [];
    if (state.stopped) messages.push('Automated replies are stopped. A stored phone opt-out remains in effect after reset.');
    if (state.hold) messages.push('Safety hold. This request needs contractor review. No help has been dispatched.');
    if (limitReached) messages.push('This conversation has reached its limit. Review and save the current details before starting another draft.');
    $('chat-state-banner').textContent = messages.join(' ');
    $('chat-state-banner').hidden = !messages.length;
    $('message-helper').textContent = limitReached ? 'Clear any unsent text, then save this draft.' : state.stopped ? 'Replies stopped. Stored phone opt-outs remain.' : state.hold ? 'Safety hold. Review the details before saving.' : 'Use test details. Up to 500 characters per message.';
    renderIssues();
    updateControls();
  }

  function syncReview() {
    Object.assign(state, textFields());
  }

  function guarded(action, resetting = false) {
    if (saveBusy || pendingSave) {
      error('Finish confirming the current save before starting another draft. Use Retry save to check the same request.');
      if (!saveBusy) $('retry-save').focus();
      return;
    }
    if (hasDraft() || messageBusy) {
      pendingNavigation = action;
      $('preview-guard-title').textContent = resetting ? 'Reset this draft?' : 'This draft has not been saved';
      $('preview-guard-description').textContent = resetting ? 'Reset clears this draft and its unsaved details. Saved requests and phone opt-outs remain.' : 'Keep the draft, or discard it before leaving. Saved requests and opt-outs will remain.';
      $('preview-navigation-guard').hidden = false;
      $('preview-keep-editing').focus();
      $('preview-navigation-guard').scrollIntoView({ block: 'nearest' });
      return;
    }
    action();
  }

  function resetDraft() {
    generation += 1;
    messageController?.abort();
    messageController = null;
    messageBusy = false;
    savedLead = null;
    pendingSave = null;
    idempotencyKey = null;
    state = newState();
    limitReached = false;
    $('request-form').reset();
    $('message-form').reset();
    $('conversation').replaceChildren();
    $('save-success').hidden = true;
    $('saved-request-summary').textContent = '';
    $('saved-request-link').href = '/';
    $('preview-status').textContent = 'New draft ready. Saved requests and opt-outs remain in your workspace.';
    for (const input of $('request-form').querySelectorAll('[aria-invalid]')) input.removeAttribute('aria-invalid');
    error('');
    renderState();
    $('customer-message').focus();
  }

  async function sendMessage(event) {
    event.preventDefault();
    if (!ready || messageBusy || saveBusy || savedLead || pendingSave || limitReached || !$('message-form').reportValidity()) return;
    const message = $('customer-message').value.trim();
    if (!message) return;
    syncReview();
    const serial = generation;
    const requestState = JSON.parse(JSON.stringify(state));
    messageBusy = true;
    messageController = new AbortController();
    error('');
    $('preview-status').textContent = 'Processing the message…';
    updateControls();
    try {
      const result = await api('/api/preview', { method: 'POST', body: { message, state: requestState }, signal: messageController.signal });
      if (serial !== generation || expired) return;
      if (!result?.state || !Array.isArray(result.state.conversation) || !Array.isArray(result.replies)) throw new RequestError(200, 'invalid_response', 'The preview response was incomplete. Your message has not been added to this draft. Try again.');
      state = result.state;
      $('customer-message').value = '';
      limitReached = state.conversation.length >= 60 || state.conversation.reduce((sum, entry) => sum + entry.text.length, 0) >= 20000;
      $('preview-status').textContent = state.stopped ? 'Message recorded. Automated replies are stopped. This request has not been saved.' : result.assistance?.mode === 'unavailable' ? 'Assisted extraction did not complete. Your previous fields are unchanged. Review the fields or try again.' : 'Draft updated. Review the details before saving.';
      renderState();
    } catch (cause) {
      if (serial !== generation || expired || cause.name === 'AbortError') return;
      error(cause.message || 'Could not process the message. Your draft and message are still here.');
      $('preview-status').textContent = '';
      if (cause.code === 'conversation_limit') {
        limitReached = true;
        renderState();
      }
    } finally {
      if (serial === generation && !expired) {
        messageBusy = false;
        messageController = null;
        updateControls();
        if (!limitReached) $('customer-message').focus();
      }
    }
  }

  function validateReview() {
    if ($('customer-message').value.trim()) {
      error(limitReached ? 'Clear the unsent message before saving the current request. It is not part of the recorded conversation.' : 'Send or clear the unsent message before saving. Only recorded messages are included in the request.');
      $('customer-message').focus();
      return false;
    }
    if (!$('request-form').reportValidity()) return false;
    for (const key of ['customerName', 'phone', 'job', 'zip']) {
      if (!$(FIELDS[key]).value.trim()) {
        error(`Enter the ${LABELS[key]} before saving.`);
        $(FIELDS[key]).focus();
        return false;
      }
    }
    if (state.issues.length) {
      error('Confirm the details marked for review before saving this request.');
      $('confirm-review').focus();
      return false;
    }
    return true;
  }

  async function saveRequest(event) {
    if (event) event.preventDefault();
    if (!ready || saveBusy || messageBusy || savedLead || expired) return;
    if (!pendingSave) {
      if (!validateReview()) return;
      syncReview();
      if (!idempotencyKey) idempotencyKey = uuid();
      pendingSave = {
        payload: {
          ...textFields(),
          contactPermission: state.stopped ? 'opted_out' : $('preview-permission').value,
          conversation: state.conversation.map(entry => ({ role: entry.role, text: entry.text }))
        },
        key: idempotencyKey
      };
    }
    saveBusy = true;
    error('');
    $('preview-status').textContent = 'Saving request…';
    updateControls();
    try {
      const result = await api('/api/leads', { method: 'POST', headers: { 'Idempotency-Key': pendingSave.key }, body: pendingSave.payload });
      if (expired) return;
      if (!result?.lead?.id) throw new RequestError(200, 'invalid_response', 'The workspace did not confirm the saved request. Retry to check this same request.');
      savedLead = result.lead;
      pendingSave = null;
      idempotencyKey = null;
      $('save-success').hidden = false;
      const contactMessage = savedLead.optedOut ? 'Contact is opted out.' : savedLead.safetyHold ? 'The request is on a safety hold for review.' : savedLead.contactAllowed ? 'The callback request is recorded.' : 'Contact permission is not recorded.';
      $('saved-request-summary').textContent = `${savedLead.customerName} is now in your inbox. ${contactMessage} No appointment was booked and no message was sent.`;
      $('saved-request-link').href = `/?lead=${encodeURIComponent(savedLead.id)}`;
      $('preview-status').textContent = 'Request saved to your inbox. You can view it or start a new draft.';
      renderIssues();
      $('save-success').scrollIntoView({ block: 'nearest' });
      $('saved-request-link').focus();
    } catch (cause) {
      if (expired) return;
      $('preview-status').textContent = '';
      const definiteRejection = [400, 403, 404, 413, 422, 429].includes(cause.status) && cause.code !== 'invalid_response';
      if (definiteRejection) pendingSave = null;
      // An uncertain result retains both the original body and key. A retry can
      // recover the existing record without creating a second request.
      error(definiteRejection ? `${cause.message} Your draft has not been cleared.` : `${cause.message} The save is not confirmed. Retry the same request before starting another draft.`);
      if (Array.isArray(cause.fields)) {
        for (const field of cause.fields) {
          const id = FIELDS[field] || (field === 'contactPermission' ? 'preview-permission' : null);
          if (id) { $(id).setAttribute('aria-invalid', 'true'); break; }
        }
      }
    } finally {
      saveBusy = false;
      if (!expired) updateControls();
    }
  }

  async function initialize() {
    try {
      const session = await api('/api/session');
      if (expired) return;
      if (!session?.user || typeof session.csrfToken !== 'string') throw new Error('Your sign-in could not be confirmed. Reload and sign in again.');
      csrfToken = session.csrfToken;
      const profile = await api('/api/profile');
      if (expired) return;
      if (!profile?.business?.name) throw new Error('Could not load your business information. Reload this page to try again.');
      $('chat-heading').textContent = profile.business.name;
      const assistant = await api('/api/assistant');
      if (expired) return;
      if (!['deterministic', 'fake-provider', 'external-provider'].includes(assistant?.mode) || typeof assistant.liveEnabled !== 'boolean') throw new Error('The request assistant mode could not be confirmed. Reload the preview.');
      $('assistant-mode-status').textContent = assistant.mode === 'fake-provider'
        ? 'Synthetic provider test. This adapter uses prepared responses to test the AI integration. No live model receives these messages. No calls, messages, or bookings are sent.'
        : assistant.liveEnabled
          ? 'Provider-assisted draft. Review every extracted field. Business answers use approved information. No calls, messages, or bookings are sent.'
          : 'Private test conversation. Answers come from your approved business information. Live AI is not connected. No calls, messages, or bookings are sent.';
      ready = true;
      renderState();
    } catch (cause) { if (!expired) error(cause.message || 'Could not open the preview. Reload this page to try again.'); }
  }

  $('message-form').addEventListener('submit', sendMessage);
  $('request-form').addEventListener('submit', saveRequest);
  $('retry-save').addEventListener('click', () => saveRequest());
  $('reset-draft').addEventListener('click', () => guarded(resetDraft, true));
  $('confirm-review').addEventListener('click', () => {
    if (messageBusy || saveBusy || pendingSave || savedLead) return;
    syncReview();
    state.issues = [];
    renderIssues();
    error('');
    $('preview-status').textContent = 'Details confirmed for review. Save the request when the remaining fields are complete.';
  });
  $('request-form').addEventListener('input', event => {
    event.target.removeAttribute('aria-invalid');
    const key = Object.keys(FIELDS).find(field => FIELDS[field] === event.target.id);
    if (key) {
      state[key] = event.target.value;
      state.issues = state.issues.filter(field => field !== key);
      renderIssues();
    }
    $('preview-status').textContent = '';
  });
  $('preview-keep-editing').addEventListener('click', () => { pendingNavigation = null; $('preview-navigation-guard').hidden = true; });
  $('preview-discard').addEventListener('click', () => {
    const action = pendingNavigation;
    pendingNavigation = null;
    $('preview-navigation-guard').hidden = true;
    if (action) action();
  });
  for (const id of ['back-to-inbox', 'inbox-link']) $(id).addEventListener('click', event => {
    event.preventDefault();
    guarded(() => { generation += 1; messageController?.abort(); state = newState(); $('request-form').reset(); $('message-form').reset(); window.location.assign('/'); });
  });
  window.addEventListener('beforeunload', event => { if (!expired && (hasDraft() || messageBusy || saveBusy || pendingSave)) { event.preventDefault(); event.returnValue = ''; } });
  initialize();
})();
