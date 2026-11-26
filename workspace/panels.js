(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const CORE = ['partNumber', 'manufacturer', 'description'];
  const FIELDS = [['partNumber', 'Part number', 128], ['manufacturer', 'Manufacturer', 120], ['description', 'Description', 1000], ['quantity', 'Quantity'], ['reviewStatus', 'Review status'], ['sourceImageId', 'Source image'], ['notes', 'Notes', 1000]];
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  const PROJECT_FIELDS = ['id', 'name', 'notes', 'rows', 'version', 'createdAt', 'updatedAt', 'sources'];
  const SOURCE_FIELDS = ['id', 'name', 'mime', 'bytes', 'width', 'height', 'createdAt'];
  let csrfToken = '';
  let identity = null;
  let ready = false;
  let expired = false;
  let busy = false;
  let projects = [];
  let project = null;
  let rows = [];
  let baseline = '';
  let conflict = false;
  let pendingNavigation = null;
  let pendingSave = null;
  let pendingUpload = null;
  let selectedFile = null;
  let savingSource = false;
  let createKey = '';
  let ocrStatus = { available: false };
  let ocrResult = null;
  const downloadUrls = new Set();
  const deletion = window.PanelReplyDeletion.create({ api, onChange: updateControls, onDeleted: deletedPanelRecord });

  class ApiError extends Error {
    constructor(message, status = 0, code = 'network_error') { super(message); this.status = status; this.code = code; }
  }
  function node(tag, text, className) { const result = document.createElement(tag); if (text !== undefined) result.textContent = String(text); if (className) result.className = className; return result; }
  function error(id, message) { $(id).textContent = message; $(id).hidden = !message; }
  function appError(message) { $('panel-app-error-text').textContent = message; $('panel-app-error').hidden = !message; }
  function date(value) { const d = new Date(value); return Number.isNaN(d.getTime()) ? 'Date unavailable' : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(d); }
  function revoke(set) { for (const url of set) URL.revokeObjectURL(url); set.clear(); }
  function expire() {
    expired = true;
    deletion.expire();
    ready = false;
    csrfToken = '';
    identity = null;
    project = null;
    rows = [];
    projects = [];
    pendingSave = null;
    pendingUpload = null;
    savingSource = false;
    clearSourceSelection();
    $('source-status').textContent = '';
    error('source-error', '');
    $('source-progress').hidden = true;
    baseline = '';
    revoke(downloadUrls);
    $('project-form').reset();
    $('panel-parts-body').replaceChildren();
    $('source-list').replaceChildren();
    $('project-list').replaceChildren();
    $('ocr-raw-text').textContent = '';
    $('ocr-warnings').replaceChildren();
    for (const id of ['signed-in-name', 'sidebar-business-name', 'project-saved-meta', 'project-version', 'ocr-summary']) $(id).textContent = '';
    $('project-content').hidden = true;
    window.location.replace('/login');
  }
  async function response(path, options = {}) {
    const method = options.method || 'GET';
    const headers = { Accept: options.binary ? '*/*' : 'application/json' };
    if (csrfToken) headers['X-Workspace-Session'] = csrfToken;
    if (method !== 'GET') headers['X-CSRF-Token'] = csrfToken;
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    if (options.key) headers['Idempotency-Key'] = options.key;
    let res;
    try { res = await fetch(path, { method, headers, credentials: 'same-origin', cache: 'no-store', body: options.body === undefined ? undefined : JSON.stringify(options.body) }); }
    catch (_) { throw new ApiError('Could not reach the workspace. Your draft is still here. Try again.'); }
    if (res.status === 401) { expire(); throw new ApiError('Your session ended. Please sign in again.', 401, 'session_expired'); }
    if (!res.ok) { const data = await res.json().catch(() => null); throw new ApiError(data?.error?.message || 'The request could not be completed. Try again.', res.status, data?.error?.code || 'request_failed'); }
    return res;
  }
  async function api(path, options = {}) {
    const res = await response(path, options);
    if (res.status === 204) return null;
    const data = await res.json().catch(() => null);
    if (!data) throw new ApiError('The workspace returned an incomplete response. Retry to confirm the result.', 502, 'invalid_response');
    return data;
  }
  function draft() { return { name: $('project-name').value, notes: $('project-notes').value, rows: rows.map(row => ({ ...row })) }; }
  function dirty() { return Boolean(project && baseline && JSON.stringify(draft()) !== baseline); }
  function unresolved() { return Boolean(pendingSave || pendingUpload); }
  function updateControls() {
    const locked = busy || !ready || expired || unresolved() || deletion.isOpen();
    $('new-project').disabled = locked;
    $('create-first-project').disabled = locked;
    $('retry-panel-load').disabled = busy || expired || unresolved();
    $('project-fields').disabled = busy || !ready || expired;
    for (const field of $('project-fields').querySelectorAll('input,select,textarea')) field.disabled = locked;
    for (const button of $('panel-parts-body').querySelectorAll('button')) button.disabled = locked;
    $('add-part').disabled = locked || rows.length >= 200;
    $('save-project').disabled = locked || conflict;
    $('reload-project').disabled = locked || !project?.id;
    $('retry-project-save').disabled = busy || !ready || !pendingSave;
    $('project-retry').hidden = !pendingSave;
    $('project-conflict').hidden = !conflict;
    $('project-dirty').hidden = !dirty();
    const saved = Boolean(project?.id);
    $('delete-project').disabled = locked || !saved || dirty() || conflict;
    for (const button of $('source-list').querySelectorAll('[data-delete-source]')) button.disabled = locked || !saved || dirty() || conflict;
    const sourceAllowed = saved && !locked && !dirty() && !conflict && project.sources.length < 5;
    $('panel-image').disabled = !sourceAllowed;
    $('upload-source').disabled = busy || !ready || Boolean(pendingSave) || (!pendingUpload && (!sourceAllowed || !selectedFile));
    $('upload-source').textContent = pendingUpload ? 'Retry image save' : 'Save image';
    $('clear-source-selection').disabled = locked;
    // The file picker and retry action have different availability. Do not
    // disable their shared ancestor, which would also disable a valid retry.
    $('source-dropzone').dataset.disabled = String(!sourceAllowed);
    $('source-dropzone').setAttribute('aria-busy', String(savingSource));
    $('source-progress').hidden = !savingSource;
    $('source-save-help').textContent = unresolved() ? 'Confirm the pending save before continuing.' : !saved ? 'Save the project before adding an image.' : dirty() ? 'Save your changes before uploading an image or extracting text.' : conflict ? 'Reload the saved project before adding images or extracting text.' : project.sources.length >= 5 ? 'This project has five source images. You can still review the saved images and edit parts.' : 'Images stay with this project. Text extraction runs locally when the OCR engine is available.';
    for (const button of $('source-list').querySelectorAll('[data-ocr]')) button.disabled = locked || !saved || dirty() || conflict || !ocrStatus.available;
    for (const button of $('source-list').querySelectorAll('[data-view]')) button.disabled = busy || !ready || expired;
    $('add-ocr-rows').disabled = locked || !ocrResult?.candidates?.length || rows.length + (ocrResult?.candidates?.length || 0) > 200;
    $('export-project').disabled = locked || !saved;
    $('export-project-xlsx').disabled = locked || !saved;
    $('sign-out').disabled = busy || unresolved() || !ready;
    for (const button of $('project-list').querySelectorAll('button')) button.disabled = locked;
    $('parts-review-count').textContent = rows.length ? `${rows.length} ${rows.length === 1 ? 'part' : 'parts'} · ${rows.filter(row => row.reviewStatus !== 'reviewed').length} need review` : 'No parts yet';
    $('parts-empty').hidden = rows.length > 0;
  }
  function guarded(action) {
    if (busy || unresolved() || deletion.isOpen()) { appError('Wait for the current operation, or retry the unconfirmed save before leaving.'); return; }
    if (!dirty()) { action(); return; }
    pendingNavigation = action;
    $('panel-navigation-guard').hidden = false;
    $('panel-keep-editing').focus();
  }
  function renderList() {
    $('project-list').replaceChildren();
    const query = $('project-search').value.trim().toLocaleLowerCase();
    const visible = projects.filter(p => p.name.toLocaleLowerCase().includes(query));
    $('project-list-count').textContent = `${projects.length} saved ${projects.length === 1 ? 'project' : 'projects'}`;
    $('project-list-message').hidden = visible.length > 0;
    $('project-list-message').textContent = projects.length ? 'No projects match this search.' : 'No projects saved yet.';
    for (const p of visible) {
      const li = node('li');
      const button = node('button', undefined, 'project-choice');
      button.type = 'button';
      button.setAttribute('aria-current', String(project?.id === p.id));
      button.append(node('strong', p.name), node('span', `${p.rowCount} parts · ${p.unreviewedCount} to review`), node('span', date(p.updatedAt)));
      button.addEventListener('click', () => guarded(() => openProject(p.id)));
      li.append(button); $('project-list').append(li);
    }
    updateControls();
  }
  function rowControl(field, label, max, row, index) {
    let control;
    if (field === 'reviewStatus' || field === 'sourceImageId') {
      control = node('select');
      const options = field === 'reviewStatus' ? [['unreviewed', 'Unreviewed'], ['reviewed', 'Reviewed']] : [['', 'Manual entry'], ...project.sources.map(s => [s.id, s.name])];
      for (const [value, text] of options) { const option = node('option', text); option.value = value; control.append(option); }
    } else {
      control = node(field === 'description' || field === 'notes' ? 'textarea' : 'input');
      if (field === 'quantity') { control.type = 'number'; control.min = '1'; control.max = '9999'; control.step = '1'; control.required = true; }
      else { control.maxLength = max; control.autocomplete = 'off'; if (control.tagName === 'TEXTAREA') control.rows = 1; }
    }
    control.value = row[field] ?? '';
    control.setAttribute('aria-label', `${label} row ${index + 1}`);
    control.dataset.field = field;
    const eventName = control.tagName === 'SELECT' ? 'change' : 'input';
    control.addEventListener(eventName, () => {
      error('project-error', '');
      $('project-save-status').textContent = '';
      row[field] = field === 'quantity' ? (control.value === '' ? '' : Number(control.value)) : field === 'sourceImageId' ? (control.value || null) : control.value;
      if (field === 'reviewStatus' && row.reviewStatus === 'reviewed' && CORE.some(key => !String(row[key]).trim())) {
        row.reviewStatus = 'unreviewed'; control.value = 'unreviewed';
        error('project-error', `Row ${index + 1}: fill part number, manufacturer and description before marking it reviewed. Leave unknown values unreviewed.`);
      }
      if (field !== 'reviewStatus') {
        row.reviewStatus = 'unreviewed';
        control.closest('tr').querySelector('[data-field="reviewStatus"]').value = 'unreviewed';
      }
      updateRowReview(control.closest('tr'), row);
      updateControls();
    });
    return control;
  }
  function updateRowReview(tr, row) {
    tr.dataset.reviewed = String(row.reviewStatus === 'reviewed');
    const missing = FIELDS.filter(([field]) => CORE.includes(field) && !String(row[field] || '').trim()).map(([, label]) => label.toLowerCase());
    const note = tr.querySelector('[data-review-note]');
    if (note) note.textContent = missing.length ? `Missing ${missing.join(', ')}` : '';
  }
  function renderRows() {
    $('panel-parts-body').replaceChildren();
    rows.forEach((row, index) => {
      const tr = node('tr'); tr.dataset.reviewed = String(row.reviewStatus === 'reviewed');
      const number = node('td'); number.append(node('span', index + 1, 'row-number')); tr.append(number);
      for (const [field, label, max] of FIELDS) {
        const td = node('td'); const control = rowControl(field, label, max, row, index); td.append(control);
        if (field === 'reviewStatus') {
          const note = node('p', '', 'row-review-note'); note.id = `row-review-note-${index}`; note.dataset.reviewNote = 'true';
          control.setAttribute('aria-describedby', note.id); td.append(note);
        }
        tr.append(td);
      }
      const td = node('td'); const remove = node('button', 'Remove', 'remove-row'); remove.type = 'button'; remove.setAttribute('aria-label', `Remove row ${index + 1}`);
      remove.addEventListener('click', () => {
        const containsWork = CORE.some(field => String(row[field] || '').trim()) || String(row.notes || '').trim() || row.sourceImageId || row.reviewStatus === 'reviewed';
        if (containsWork && !window.confirm(`Remove row ${index + 1} from this draft? Save the project to apply the removal.`)) return;
        rows.splice(index, 1); renderRows(); $('project-save-status').textContent = 'Row removed from the draft. Save to update the project.';
        const controls = $('panel-parts-body').querySelectorAll('[data-field="partNumber"]'); (controls[Math.min(index, controls.length - 1)] || $('add-part')).focus();
      });
      td.append(remove); tr.append(td); $('panel-parts-body').append(tr);
      updateRowReview(tr, row);
    });
    updateControls();
  }
  function responseObject(value, fields) {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === fields.length && fields.every(field => Object.hasOwn(value, field)));
  }
  function responseText(value, limit) {
    // Unicode mode rejects lone surrogates without rejecting valid pairs.
    return typeof value === 'string' && value.length <= limit && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\ud800-\udfff]/u.test(value);
  }
  function responseTime(value) {
    const time = typeof value === 'string' ? Date.parse(value) : NaN;
    return Number.isSafeInteger(time) && time >= 0 && time <= 8640000000000000 && new Date(time).toISOString() === value;
  }
  function responseSource(value) {
    return responseObject(value, SOURCE_FIELDS) && typeof value.id === 'string' && UUID.test(value.id)
      && responseText(value.name, 160) && value.name.trim() === value.name && Boolean(value.name) && !/[\/\\\r\n\t]/.test(value.name) && !['.', '..'].includes(value.name)
      && ['image/png', 'image/jpeg'].includes(value.mime) && Number.isSafeInteger(value.bytes) && value.bytes >= 1 && value.bytes <= 2 * 1024 * 1024
      && Number.isSafeInteger(value.width) && value.width >= 1 && value.width <= 6000 && Number.isSafeInteger(value.height) && value.height >= 1 && value.height <= 6000
      && value.width * value.height <= 16000000 && responseTime(value.createdAt);
  }
  function invalidProjectResponse() { throw new ApiError('The project response was incomplete or invalid. Retry to confirm the saved project.', 502, 'invalid_response'); }
  function validateProjectResponse(value, { expectedId, emptyDraft = false } = {}) {
    if (emptyDraft) {
      if (!responseObject(value, ['id', 'name', 'notes', 'rows', 'sources', 'version']) || value.id !== null || value.name !== '' || value.notes !== '' || value.version !== 0 || !Array.isArray(value.rows) || value.rows.length || !Array.isArray(value.sources) || value.sources.length) invalidProjectResponse();
      return;
    }
    if (!responseObject(value, PROJECT_FIELDS) || typeof value.id !== 'string' || !UUID.test(value.id) || (expectedId && value.id !== expectedId)
      || !responseText(value.name, 120) || !value.name.trim() || value.name !== value.name.trim() || !responseText(value.notes, 2000)
      || !Number.isSafeInteger(value.version) || value.version < 1 || value.version >= Number.MAX_SAFE_INTEGER
      || !responseTime(value.createdAt) || !responseTime(value.updatedAt) || Date.parse(value.updatedAt) < Date.parse(value.createdAt)
      || !Array.isArray(value.rows) || value.rows.length > 200 || !Array.isArray(value.sources) || value.sources.length > 5) invalidProjectResponse();
    const sourceIds = new Set();
    for (const source of value.sources) {
      if (!responseSource(source) || sourceIds.has(source.id)) invalidProjectResponse();
      sourceIds.add(source.id);
    }
    for (const row of value.rows) {
      if (!responseObject(row, FIELDS.map(([field]) => field)) || !responseText(row.partNumber, 128) || !responseText(row.manufacturer, 120)
        || !responseText(row.description, 1000) || !responseText(row.notes, 1000) || !Number.isSafeInteger(row.quantity) || row.quantity < 1 || row.quantity > 9999
        || !['unreviewed', 'reviewed'].includes(row.reviewStatus) || (row.sourceImageId !== null && !sourceIds.has(row.sourceImageId))
        || CORE.every(field => !row[field].trim()) || (row.reviewStatus === 'reviewed' && CORE.some(field => !row[field].trim()))) invalidProjectResponse();
    }
  }
  function validateUploadResponse(result, operation) {
    validateProjectResponse(result?.project, { expectedId: operation.projectId });
    if (result.project.version <= operation.body.version) invalidProjectResponse();
    const source = result?.source;
    if (!responseSource(source) || operation.sourceIds.includes(source.id)) invalidProjectResponse();
    const member = result.project.sources.find(item => item.id === source.id);
    const encoded = operation.body.dataBase64;
    const bytes = encoded.length / 4 * 3 - (encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0);
    if (!member || SOURCE_FIELDS.some(field => member[field] !== source[field]) || source.name !== operation.body.name.trim() || source.mime !== operation.body.mime || source.bytes !== bytes) invalidProjectResponse();
  }
  function validateExtractionResponse(result, operation) {
    const invalid = () => { throw new ApiError('The extraction response was incomplete or invalid. Try extracting this image again.', 502, 'invalid_response'); };
    // Validate everything the extraction view and Add action consume before
    // installing any result. These limits match the local OCR adapter, which
    // emits zero or one unreviewed candidate and keeps unknown values blank.
    const warningList = value => Array.isArray(value) && value.length <= 20003 && value.every(message => responseText(message, 20000));
    if (!result || typeof result !== 'object' || Array.isArray(result)
      || result.projectId !== operation.projectId || result.sourceImageId !== operation.sourceImageId || result.version !== operation.version
      || !project || project.id !== operation.projectId || project.version !== operation.version || !project.sources.some(source => source.id === operation.sourceImageId)
      || !responseText(result.rawText, 20000) || !warningList(result.warnings) || !Array.isArray(result.candidates) || result.candidates.length > 1) invalid();
    for (const candidate of result.candidates) {
      if (!responseObject(candidate, [...CORE, 'confidence', 'reviewStatus', 'sourceImageId', 'warnings'])
        || !responseText(candidate.partNumber, 120) || !responseText(candidate.manufacturer, 120) || !responseText(candidate.description, 500)
        || candidate.sourceImageId !== operation.sourceImageId || candidate.reviewStatus !== 'unreviewed' || !warningList(candidate.warnings)
        || !responseObject(candidate.confidence, CORE)) invalid();
      for (const field of CORE) {
        const confidence = candidate.confidence[field];
        if ((confidence !== null && (!Number.isFinite(confidence) || confidence < 0 || confidence > 100))
          || (!candidate[field] && confidence !== null)) invalid();
      }
    }
    return [...new Set([...result.warnings, ...result.candidates.flatMap(candidate => candidate.warnings)])];
  }
  function setProject(value, message = '', options = {}) {
    validateProjectResponse(value, options);
    project = value;
    rows = value.rows.map(row => ({ ...row }));
    $('project-name').value = value.name;
    $('project-notes').value = value.notes;
    baseline = JSON.stringify(draft());
    conflict = false; pendingSave = null; pendingUpload = null; ocrResult = null;
    createKey = crypto.randomUUID();
    $('project-empty').hidden = true; $('project-content').hidden = false;
    $('project-saved-meta').textContent = value.id ? `Saved ${date(value.updatedAt)}` : 'New project · Not saved';
    $('project-version').textContent = value.id ? `Version ${value.version}` : '';
    $('project-save-status').textContent = message;
    $('source-status').textContent = ''; $('panel-export-status').textContent = '';
    $('ocr-result').hidden = true; $('ocr-raw-text').textContent = ''; $('ocr-warnings').replaceChildren();
    clearSourceSelection();
    for (const id of ['project-error', 'source-error', 'panel-export-error']) error(id, '');
    renderRows(); renderSources(); renderList();
  }
  function newProject() { setProject({ id: null, name: '', notes: '', rows: [], sources: [], version: 0 }, '', { emptyDraft: true }); $('project-name').focus(); }
  async function refreshProjects() {
    const result = await api('/api/panel-projects');
    if (expired) return;
    if (!Array.isArray(result.projects)) throw new ApiError('The project list was incomplete. Try again.', 502);
    projects = result.projects; renderList();
  }
  function refreshSummary(value) {
    const summary = { id: value.id, name: value.name, version: value.version, createdAt: value.createdAt, updatedAt: value.updatedAt, rowCount: value.rows.length, unreviewedCount: value.rows.filter(row => row.reviewStatus !== 'reviewed').length, sourceCount: value.sources.length };
    projects = [summary, ...projects.filter(p => p.id !== value.id)];
    projects.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    renderList();
  }
  async function openProject(id) {
    if (busy) return;
    busy = true; updateControls(); appError('');
    $('panel-load-status').textContent = 'Opening project…';
    try { const result = await api(`/api/panel-projects/${encodeURIComponent(id)}`); if (!expired) { setProject(result?.project, '', { expectedId: id }); $('panel-load-status').textContent = 'Project loaded.'; } }
    catch (cause) { if (!expired) { appError(cause.message); $('panel-load-status').textContent = 'Project could not be loaded.'; } }
    finally { busy = false; if (!expired) updateControls(); }
  }
  function normalDraft(value) {
    return JSON.stringify({ name: value.name.trim(), notes: value.notes, rows: value.rows.map(row => Object.fromEntries(FIELDS.map(([field]) => [field, row[field]]))) });
  }
  async function saveProject(event) {
    event?.preventDefault();
    if (busy || !project || conflict || pendingUpload) return;
    if (!pendingSave) {
      if (!$('project-form').reportValidity()) return;
      if (!$('project-name').value.trim()) { error('project-error', 'Enter a project name.'); $('project-name').focus(); return; }
      const blank = rows.findIndex(row => CORE.every(field => !String(row[field]).trim()));
      if (blank !== -1) { error('project-error', `Row ${blank + 1} is empty. Enter at least one part detail or remove the row.`); return; }
      pendingSave = { path: project.id ? `/api/panel-projects/${project.id}` : '/api/panel-projects', projectId: project.id, method: project.id ? 'PATCH' : 'POST', key: project.id ? null : createKey, body: project.id ? { version: project.version, ...draft() } : draft(), attempted: false, uncertain: false };
    }
    const operation = pendingSave;
    busy = true; updateControls(); error('project-error', ''); $('project-save-status').textContent = 'Saving project…';
    try {
      let result;
      if (operation.attempted && operation.method === 'PATCH') {
        const saved = await api(operation.path);
        validateProjectResponse(saved?.project, { expectedId: operation.projectId });
        // Equal values cannot confirm an unchanged save that never committed.
        if (saved.project.version > operation.body.version && normalDraft(saved.project) === normalDraft(operation.body)) result = saved;
      }
      operation.attempted = true;
      if (!result) result = await api(operation.path, operation);
      if (expired) return;
      if (operation.method === 'PATCH' && (!Number.isSafeInteger(result?.project?.version) || result.project.version <= operation.body.version)) invalidProjectResponse();
      setProject(result?.project, 'Project saved. Corrections are included in the saved CSV.', { expectedId: operation.projectId });
      refreshSummary(result.project);
    } catch (cause) {
      if (expired) return;
      $('project-save-status').textContent = '';
      const rejected = cause.status >= 400 && cause.status < 500 && cause.status !== 408 && cause.status !== 429;
      // A later refusal cannot establish whether an earlier request committed.
      // Keep its frozen command and editing lock until its result is confirmed.
      if (!rejected) operation.uncertain = true;
      if (rejected && !operation.uncertain) pendingSave = null;
      if (!pendingSave && cause.status === 409 && cause.code === 'version_conflict' && project?.id) conflict = true;
      error('project-error', cause.message);
    } finally { busy = false; if (!expired) updateControls(); }
  }
  async function viewSource(source, button, card) {
    if (busy) return;
    const existing = card.querySelector('img');
    if (existing) { existing.remove(); button.textContent = 'View image'; button.setAttribute('aria-expanded', 'false'); button.setAttribute('aria-label', `View image ${source.name}`); return; }
    busy = true; updateControls(); error('source-error', '');
    try {
      const img = node('img', undefined, 'source-image'); img.alt = `Source label: ${source.name}`;
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => { img.remove(); reject(new Error('The image took too long to load. Try again.')); }, 15000);
        img.addEventListener('load', () => { clearTimeout(timeout); resolve(); }, { once: true });
        img.addEventListener('error', () => { clearTimeout(timeout); img.remove(); reject(new Error('The saved image could not be displayed. Confirm the source image and try again.')); }, { once: true });
        img.src = `/api/panel-projects/${project.id}/sources/${source.id}`;
        card.append(img);
      });
      if (!expired) { button.textContent = 'Hide image'; button.setAttribute('aria-expanded', 'true'); button.setAttribute('aria-label', `Hide image ${source.name}`); }
    } catch (cause) {
      if (!expired) {
        try { await api('/api/session'); } catch (_) { /* A 401 clears the workspace through api(). */ }
        if (!expired) error('source-error', cause.message);
      }
    }
    finally { busy = false; if (!expired) updateControls(); }
  }
  function beginPanelDeletion(source = null) {
    if (!project?.id || busy || !ready || expired || unresolved() || dirty() || conflict) return;
    deletion.request({
      kind: source ? 'panel_source' : 'panel_project', id: source ? source.id : project.id,
      ...(source ? { parentId: project.id } : {}), version: project.version,
      url: `/api/panel-projects/${project.id}${source ? '/sources/' + source.id : ''}`,
      title: source ? 'Delete source image?' : 'Delete panel project?',
      description: source ? 'Remove this saved image. Corrected part values remain. Rows linked to this image return to Needs review without a source image.' : 'Remove this project, its parts and all saved source images from the active workspace.'
    });
  }
  async function deletedPanelRecord(operation) {
    if (expired) return;
    const id = operation.parentId || operation.id;
    projects = projects.filter(item => item.id !== id);
    project = null; rows = []; baseline = ''; conflict = false; ocrResult = null;
    $('project-form').reset(); $('panel-parts-body').replaceChildren(); $('source-list').replaceChildren();
    $('ocr-raw-text').textContent = ''; $('ocr-warnings').replaceChildren(); $('ocr-result').hidden = true;
    clearSourceSelection(); $('project-content').hidden = true; $('project-empty').hidden = false; renderList();
    if (operation.kind === 'panel_source') {
      await openProject(id);
      if (!expired && project?.id === id) { refreshSummary(project); $('source-status').textContent = 'Image deleted. Linked rows need review.'; }
    } else {
      const url = new URL(location.href); url.searchParams.delete('project'); window.history.replaceState(null, '', url.pathname + url.search + url.hash);
      $('panel-load-status').textContent = 'Project deletion confirmed.'; $('new-project').focus();
    }
  }
  function renderSources() {
    $('source-list').replaceChildren();
    for (const source of project.sources) {
      const li = node('li', undefined, 'source-card'); const header = node('div', undefined, 'source-card-header'); const info = node('div');
      info.append(node('strong', source.name), node('p', `${source.width} × ${source.height} px · ${Math.ceil(source.bytes / 1024)} KB · ${date(source.createdAt)}`));
      const actions = node('div', undefined, 'button-row');
      const view = node('button', 'View image', 'button button-secondary button-small'); view.type = 'button'; view.dataset.view = source.id; view.setAttribute('aria-expanded', 'false'); view.setAttribute('aria-label', `View image ${source.name}`);
      view.addEventListener('click', () => viewSource(source, view, li));
      const extract = node('button', 'Extract text', 'button button-secondary button-small'); extract.type = 'button'; extract.dataset.ocr = source.id; extract.setAttribute('aria-label', `Extract text ${source.name}`);
      extract.addEventListener('click', () => extractSource(source));
      const remove = node('button', 'Delete image', 'button button-danger button-small'); remove.type = 'button'; remove.dataset.deleteSource = source.id; remove.setAttribute('aria-label', `Delete image ${source.name}`);
      remove.addEventListener('click', () => beginPanelDeletion(source));
      actions.append(view, extract, remove); header.append(info, actions); li.append(header); $('source-list').append(li);
    }
    updateControls();
  }
  async function fileBase64(file) {
    const buffer = new Uint8Array(await file.arrayBuffer());
    if (buffer.byteLength !== file.size) throw new Error('Incomplete image read');
    let value = '';
    for (let i = 0; i < buffer.length; i += 8192) value += String.fromCharCode(...buffer.subarray(i, i + 8192));
    return btoa(value);
  }
  function clearSourceSelection() {
    selectedFile = null;
    $('panel-image').value = '';
    $('source-selection-text').textContent = '';
    $('source-selection').hidden = true;
    $('source-dropzone').dataset.dragging = 'false';
  }
  function chooseSource(files) {
    if ($('panel-image').disabled) return;
    const file = files?.[0];
    error('source-error', '');
    $('source-status').textContent = '';
    if (!file) { clearSourceSelection(); updateControls(); return; }
    const multiple = files.length !== 1;
    if (multiple || !['image/png', 'image/jpeg'].includes(file.type) || !file.size || file.size > 2 * 1024 * 1024) {
      clearSourceSelection();
      error('source-error', multiple ? 'Choose one image at a time.' : 'Choose a PNG or JPEG image no larger than 2 MB.');
      updateControls(); return;
    }
    selectedFile = file;
    $('source-selection-text').textContent = `${file.name} · ${Math.ceil(file.size / 1024)} KB · Selected on this device. Save, then view the image to check it.`;
    $('source-selection').hidden = false;
    updateControls();
  }
  async function uploadSource() {
    if (busy || pendingSave || !project?.id) return;
    error('source-error', '');
    if (!pendingUpload) {
      const file = selectedFile;
      if (!file) { error('source-error', 'Choose a PNG or JPEG image.'); return; }
      if (!['image/png', 'image/jpeg'].includes(file.type) || file.size > 2 * 1024 * 1024 || !file.size) { error('source-error', 'Choose a PNG or JPEG image no larger than 2 MB.'); return; }
      if (dirty() || conflict) { error('source-error', 'Save your changes before uploading an image.'); return; }
      busy = true;
      savingSource = true;
      let key;
      try {
        key = crypto.randomUUID();
        // Start reading while the selected file input is still enabled.
        const reading = fileBase64(file);
        updateControls();
        $('source-status').textContent = 'Reading selected image…';
        const dataBase64 = await reading;
        if (expired) return;
        pendingUpload = { projectId: project.id, sourceIds: project.sources.map(source => source.id),
          body: { version: project.version, name: file.name, mime: file.type, dataBase64 },
          key, method: 'POST', uncertain: false };
      } catch (_) {
        if (expired) return;
        busy = false;
        savingSource = false;
        $('source-status').textContent = '';
        if (key) clearSourceSelection();
        error('source-error', key ? 'The image could not be read. Choose the file again.' : 'The image save could not be prepared. Try Save image again.');
        updateControls();
        return;
      }
    }
    const operation = pendingUpload;
    busy = true; savingSource = true; updateControls(); $('source-status').textContent = 'Saving source image…';
    try {
      const result = await api(`/api/panel-projects/${operation.projectId}/sources`, operation);
      if (expired) return;
      validateUploadResponse(result, operation);
      setProject(result.project, '', { expectedId: operation.projectId }); refreshSummary(result.project);
      $('source-status').textContent = 'Source image saved. Extract text or enter the parts manually.';
    } catch (cause) {
      if (!expired) {
        const rejected = cause.status >= 400 && cause.status < 500 && cause.status !== 408 && cause.status !== 429;
        if (!rejected) operation.uncertain = true;
        if (rejected && !operation.uncertain) pendingUpload = null;
        if (!pendingUpload && cause.status === 409 && cause.code === 'version_conflict' && project?.id) conflict = true;
        $('source-status').textContent = pendingUpload ? 'Image save is unconfirmed. Retry the same image to check the result.' : '';
        error('source-error', cause.message);
      }
    } finally { busy = false; savingSource = false; if (!expired) updateControls(); }
  }
  async function extractSource(source) {
    if (busy || unresolved() || dirty() || conflict || !ocrStatus.available) return;
    const operation = { projectId: project.id, sourceImageId: source.id, version: project.version };
    busy = true; updateControls(); error('source-error', ''); $('source-status').textContent = 'Extracting text locally…';
    $('ocr-result').hidden = true; ocrResult = null;
    try {
      const result = await api(`/api/panel-projects/${operation.projectId}/sources/${operation.sourceImageId}/ocr`, { method: 'POST', body: { version: operation.version } });
      if (expired) return;
      const warnings = validateExtractionResponse(result, operation);
      const warningNodes = warnings.map(message => node('li', message));
      ocrResult = result;
      $('ocr-result').hidden = false;
      $('ocr-raw-text').textContent = result.rawText || 'No text was found.';
      $('ocr-summary').textContent = result.candidates.length ? `${result.candidates.length} candidate found. Values are unreviewed. OCR confidence describes the engine output, not the probability that a part is correct.` : 'No labelled part candidate was found. Read any extracted text and enter the fields manually.';
      $('ocr-warnings').replaceChildren(...warningNodes);
      $('ocr-warnings').hidden = !warnings.length;
      $('source-status').textContent = 'Text extraction completed. The saved parts have not changed.';
    } catch (cause) { if (!expired) { $('source-status').textContent = ''; error('source-error', cause.message); if (cause.status === 409 && cause.code === 'version_conflict' && project?.id) conflict = true; } }
    finally { busy = false; if (!expired) { updateControls(); if (ocrResult?.candidates?.length) $('add-ocr-rows').focus(); } }
  }
  async function exportProject(format = 'csv') {
    if (busy || unresolved() || !project?.id) return;
    const label = format === 'xlsx' ? 'XLSX' : 'CSV';
    const mime = format === 'xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'text/csv';
    let downloadUrl = null;
    busy = true; updateControls(); error('panel-export-error', ''); $('panel-export-status').textContent = `Preparing saved ${label}…`;
    try {
      const res = await response(`/api/panel-projects/${project.id}/export.${format}`, { binary: true });
      const blob = await res.blob(); if (expired) return;
      if ((res.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase() !== mime || !blob.size) throw new Error(`The workspace did not return a ${label} file. Try again.`);
      // The binary body may arrive after another tab changes its cookie. Keep
      // the download attached to this page's pinned session before exposing it.
      await api('/api/session'); if (expired) return;
      const url = URL.createObjectURL(blob); downloadUrls.add(url);
      downloadUrl = url;
      const a = node('a'); a.href = url; a.download = `panelreply-project-${project.id}.${format}`; document.body.append(a);
      try { a.click(); } finally { a.remove(); }
      setTimeout(() => { URL.revokeObjectURL(url); downloadUrls.delete(url); }, 60000);
      $('panel-export-status').textContent = dirty() ? `Saved ${label} prepared. Your unsaved edits are still here and are not included. Check your browser downloads.` : `Saved ${label} prepared. Check your browser downloads.`;
    } catch (cause) { if (downloadUrl) { URL.revokeObjectURL(downloadUrl); downloadUrls.delete(downloadUrl); } if (!expired) { $('panel-export-status').textContent = ''; error('panel-export-error', cause.message || `Could not prepare the ${label}. Try again.`); } }
    finally { busy = false; if (!expired) updateControls(); }
  }
  async function bootstrap() {
    if (busy) return;
    busy = true; updateControls(); appError('');
    try {
      const session = await api('/api/session');
      if (expired) return;
      if (!session.user || typeof session.csrfToken !== 'string') throw new ApiError('Sign-in could not be confirmed. Reload the workspace.', 502);
      if (document.body?.dataset?.productId && session.product?.id !== document.body.dataset.productId) throw new ApiError('The signed-in program could not be confirmed. Reload this page and sign in again.', 502);
      const nextIdentity = `${session.user.id}:${session.user.businessId}`;
      if ((identity && identity !== nextIdentity) || (csrfToken && csrfToken !== session.csrfToken)) { expire(); return; }
      identity = nextIdentity;
      csrfToken = session.csrfToken;
      $('signed-in-name').textContent = session.user.username;
      const spreadsheetOnly = session.product?.id === 'spreadsheet';
      const profile = spreadsheetOnly
        ? Promise.resolve({ business: { name: 'PanelReply Spreadsheets' } })
        : api('/api/profile');
      const results = await Promise.allSettled([profile, api('/api/panel-ocr'), refreshProjects()]);
      if (expired) return;
      const messages = [];
      if (results[0].status === 'fulfilled') $('sidebar-business-name').textContent = results[0].value.business.name;
      else { $('sidebar-business-name').textContent = 'Business unavailable'; messages.push('Business information could not be loaded.'); }
      if (results[1].status === 'fulfilled') ocrStatus = results[1].value;
      else { ocrStatus = { available: false }; messages.push('Text extraction availability could not be checked. You can still enter parts manually.'); }
      $('ocr-engine-status').textContent = ocrStatus.available ? `Local text extraction available · Tesseract ${ocrStatus.version} · English` : 'Local text extraction unavailable. Enter and review the parts manually.';
      if (results[2].status === 'rejected') { $('project-list-count').textContent = 'Unavailable'; $('project-list-message').hidden = false; $('project-list-message').textContent = 'Projects could not be loaded.'; messages.push(results[2].reason.message); }
      ready = true;
      if (messages.length) appError(messages.join(' '));
      $('panel-load-status').textContent = messages.length ? 'Some workspace information is unavailable.' : 'Panel workspace loaded.';
    } catch (cause) { if (!expired) appError(cause.message); }
    finally { busy = false; if (!expired) updateControls(); }
    if (ready && !project) {
      const id = new URL(window.location.href).searchParams.get('project');
      if (id) await openProject(id);
    }
    updateEmptyIntent();
  }
  function updateEmptyIntent() { $('export-empty-help').hidden = Boolean(project) || location.hash !== '#export'; }
  for (const id of ['new-project', 'create-first-project']) $(id).addEventListener('click', () => guarded(newProject));
  $('project-form').addEventListener('submit', saveProject);
  $('retry-project-save').addEventListener('click', saveProject);
  $('project-search').addEventListener('input', renderList);
  for (const id of ['project-name', 'project-notes']) $(id).addEventListener('input', () => { error('project-error', ''); $('project-save-status').textContent = ''; updateControls(); });
  $('add-part').addEventListener('click', () => { if (rows.length >= 200) return; rows.push({ partNumber: '', manufacturer: '', description: '', quantity: 1, reviewStatus: 'unreviewed', sourceImageId: null, notes: '' }); renderRows(); $('panel-parts-body').lastElementChild.querySelector('input').focus(); });
  $('panel-image').addEventListener('change', () => chooseSource($('panel-image').files));
  $('clear-source-selection').addEventListener('click', () => { clearSourceSelection(); error('source-error', ''); updateControls(); $('panel-image').focus(); });
  for (const name of ['dragenter', 'dragover']) $('source-dropzone').addEventListener(name, event => {
    event.preventDefault();
    const allowed = !$('panel-image').disabled;
    $('source-dropzone').dataset.dragging = String(allowed);
    if (event.dataTransfer) event.dataTransfer.dropEffect = allowed ? 'copy' : 'none';
  });
  $('source-dropzone').addEventListener('dragleave', event => { if (!$('source-dropzone').contains(event.relatedTarget)) $('source-dropzone').dataset.dragging = 'false'; });
  $('source-dropzone').addEventListener('drop', event => {
    event.preventDefault(); $('source-dropzone').dataset.dragging = 'false';
    if ($('panel-image').disabled) return;
    $('panel-image').value = '';
    chooseSource(event.dataTransfer?.files);
  });
  $('upload-source').addEventListener('click', uploadSource);
  $('add-ocr-rows').addEventListener('click', () => {
    if (!ocrResult || rows.length + ocrResult.candidates.length > 200) return;
    for (const candidate of ocrResult.candidates) rows.push({ partNumber: candidate.partNumber, manufacturer: candidate.manufacturer, description: candidate.description, quantity: 1, reviewStatus: 'unreviewed', sourceImageId: ocrResult.sourceImageId, notes: '' });
    ocrResult = null;
    $('ocr-result').hidden = true;
    renderRows();
    $('project-save-status').textContent = 'Unreviewed candidates added to the draft. Check the fields, then save.';
    $('panel-parts-body').lastElementChild?.querySelector('input')?.focus();
  });
  $('delete-project').addEventListener('click', () => beginPanelDeletion());
  $('export-project').addEventListener('click', () => exportProject('csv'));
  $('export-project-xlsx').addEventListener('click', () => exportProject('xlsx'));
  $('reload-project').addEventListener('click', () => guarded(() => openProject(project.id)));
  $('retry-panel-load').addEventListener('click', () => guarded(bootstrap));
  $('panel-keep-editing').addEventListener('click', () => { pendingNavigation = null; $('panel-navigation-guard').hidden = true; });
  $('panel-discard').addEventListener('click', () => { const action = pendingNavigation; pendingNavigation = null; $('panel-navigation-guard').hidden = true; if (project) setProject(project, '', { emptyDraft: project.id === null }); if (action) action(); });
  for (const link of document.querySelectorAll('a[href]:not(.skip-link)')) link.addEventListener('click', event => {
    const target = new URL(link.href, location.href);
    if (target.pathname === location.pathname && target.search === location.search) return;
    event.preventDefault(); guarded(() => { location.assign(link.getAttribute('href')); });
  });
  $('sign-out').addEventListener('click', () => guarded(async () => {
    busy = true; updateControls();
    try { await api('/api/logout', { method: 'POST' }); expire(); }
    catch (cause) { if (!expired) appError(`Could not sign out. ${cause.message}`); }
    finally { busy = false; if (!expired) updateControls(); }
  }));
  window.addEventListener('beforeunload', event => { if (!expired && (dirty() || busy || unresolved() || deletion.isPending())) { event.preventDefault(); event.returnValue = ''; } });
  window.addEventListener('pagehide', () => { revoke(downloadUrls); });
  window.addEventListener('hashchange', updateEmptyIntent);
  window.addEventListener('focus', () => { if (csrfToken && !expired) api('/api/session').catch(() => {}); });
  bootstrap();
})();
