'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');

// Execute the shipped client scripts against synthetic DOM nodes and explicit
// API responses. These are state/authorization regressions, not browser or
// layout tests. No network socket, provider or customer data is used.
const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const LEAD_ID = '22222222-2222-4222-8222-222222222222';
const TIME = '2026-11-19T00:00:00.000Z';
const savedProject = { id: PROJECT_ID, name: 'Business A private project', notes: '', rows: [], sources: [], version: 1, createdAt: TIME, updatedAt: TIME };
const savedLead = { id: LEAD_ID, customerName: 'Synthetic customer A', phone: '2025550142', job: 'Synthetic request A', zip: '48103', callbackWindow: 'Afternoon', requestedWorkDate: '', contactPermission: 'requested_callback', status: 'new', notes: '', safetyHold: false, optedOut: false, contactAllowed: true, version: 1, createdAt: TIME, updatedAt: TIME, conversation: [], audit: [] };

function client(script, options = {}) {
  const nodes = new Map(), allNodes = new Set(), calls = [], redirects = [], events = new Map();
  const state = { actor: 'A', failSession: false, mutationError: null, holdReads: false, respond: null };
  let document;
  function make(tag = 'div', initialId = '') {
    const attributes = new Map();
    const classes = new Set();
    let id = '', content = '';
    const element = {
      tagName: tag.toUpperCase(), children: [], parentNode: null, value: '', checked: false,
      files: [], hidden: false, disabled: false, open: false, showModal() { this.open = true; }, close() { this.open = false; }, dataset: {}, listeners: new Map(), style: {},
      classList: { add: value => classes.add(value), remove: value => classes.delete(value), toggle(value, force) { const next = force ?? !classes.has(value); if (next) classes.add(value); else classes.delete(value); return next; } },
      append(...items) {
        for (const item of items) {
          if (item?.tagName === '#FRAGMENT') { this.append(...item.children); continue; }
          const child = typeof item === 'string' ? Object.assign(make('#text'), { textContent: item }) : item;
          child.parentNode = this;
          this.children.push(child);
        }
      },
      replaceChildren(...items) { content = ''; this.children = []; this.append(...items); },
      addEventListener(name, handler) { if (!this.listeners.has(name)) this.listeners.set(name, []); this.listeners.get(name).push(handler); },
      async emit(name, detail = {}) { for (const handler of this.listeners.get(name) || []) await handler({ preventDefault() {}, target: this, ...detail }); },
      setAttribute(name, value) { attributes.set(name, String(value)); },
      getAttribute(name) { return attributes.get(name) ?? null; },
      removeAttribute(name) { attributes.delete(name); },
      toggleAttribute(name, force) { if (force) attributes.set(name, ''); else attributes.delete(name); },
      setCustomValidity() {}, reportValidity() { return true; }, focus() { document.activeElement = this; }, scrollIntoView() {},
      contains(target) { return target === this || this.children.some(child => child.contains(target)); },
      reset() { for (const node of allNodes) { if (['INPUT', 'SELECT', 'TEXTAREA'].includes(node.tagName) || /^(?:project-|lead-|business-name)/.test(node.id)) { node.value = ''; node.checked = false; } } },
      querySelectorAll(selector) {
        const children = this.children.flatMap(child => [child, ...child.querySelectorAll('*')]);
        if (selector === '*') return children;
        return children.filter(child => selector.split(',').some(part => {
          const query = part.trim();
          if (/^[a-z]+$/.test(query)) return child.tagName === query.toUpperCase();
          const match = query.match(/^\[data-([a-z-]+)(?:="([^"]*)")?\]$/);
          if (!match) return false;
          const key = match[1].replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
          return key in child.dataset && (match[2] === undefined || child.dataset[key] === match[2]);
        }));
      },
      querySelector(selector) { return this.querySelectorAll(selector)[0] || null; },
    };
    Object.defineProperties(element, {
      id: { get: () => id, set(value) { if (id) nodes.delete(id); id = value; if (value) nodes.set(value, element); } },
      textContent: { get: () => content + element.children.map(child => child.textContent).join(''), set(value) { content = value === undefined || value === null ? '' : String(value); element.children = []; } },
      options: { get: () => element.children.filter(child => child.tagName === 'OPTION') },
      lastElementChild: { get: () => element.children.at(-1) || null },
    });
    element.id = initialId;
    allNodes.add(element);
    return element;
  }
  const element = id => nodes.get(id) || make('div', id);
  document = { getElementById: element, createElement: tag => make(tag), createDocumentFragment: () => make('#fragment'), querySelectorAll: () => [], body: make('body'), activeElement: null };
  if (script === 'panels.js') element('project-fields').append(make('input', 'project-name'), make('textarea', 'project-notes'), make('tbody', 'panel-parts-body'));
  if (options.productId) document.body.dataset.productId = options.productId;
  element('status-filter').value = 'all';
  const pagePath = script === 'panels.js' ? '/panels' : script === 'dashboard.js' ? '/dashboard' : '/';
  let href = `http://127.0.0.1:10001${pagePath}`;
  if (options.project) href += `?project=${PROJECT_ID}`;
  if (options.lead) href += `?lead=${LEAD_ID}`;
  const location = { get href() { return href; }, get pathname() { return new URL(href).pathname; }, get search() { return new URL(href).search; }, get hash() { return new URL(href).hash; }, replace(value) { redirects.push(value); }, assign(value) { redirects.push(value); } };
  const window = { location, history: { replaceState(_state, _title, value) { href = new URL(value, href).href; } }, addEventListener(name, handler) { if (!events.has(name)) events.set(name, []); events.get(name).push(handler); } };
  const fetch = async (requestPath, request = {}) => {
    const method = request.method || 'GET';
    calls.push({ path: requestPath, method, headers: request.headers, body: request.body });
    if (state.respond) {
      const custom = await state.respond(requestPath, request);
      if (custom !== undefined) return custom;
    }
    if (requestPath === '/api/session' && state.failSession) throw new Error('Synthetic network failure');
    if (state.holdReads && requestPath !== '/api/session') return new Promise(() => {});
    let status = 200, data;
    if (requestPath === '/api/session') data = { user: { id: `user-${state.actor}`, username: `owner-${state.actor}`, businessId: `business-${state.actor}` }, csrfToken: `csrf-${state.actor}`, ...(options.productId ? { product: { id: options.productId } } : {}) };
    else if (requestPath === '/api/profile') data = { business: { id: `business-${state.actor}`, name: `Business ${state.actor}` }, version: 1, facts: {} };
    else if (requestPath === '/api/panel-ocr') data = { available: false, engine: 'tesseract', version: null, language: 'eng', reason: 'engine_unavailable' };
    else if (method !== 'GET' && state.mutationError) { status = 409; data = { error: state.mutationError }; }
    else if (requestPath === '/api/panel-projects') data = { projects: state.actor === 'A' ? [{ ...savedProject, rowCount: 0, unreviewedCount: 0 }] : [] };
    else if (requestPath === `/api/panel-projects/${PROJECT_ID}` && state.actor === 'A') data = { project: savedProject };
    else if (requestPath === '/api/leads') data = { leads: state.actor === 'A' ? [savedLead] : [] };
    else if (requestPath.startsWith('/api/callback-tasks?')) data = { tasks: [], total: 0, limit: 100, offset: 0, generatedAt: TIME };
    else if (requestPath === `/api/leads/${LEAD_ID}` && state.actor === 'A') data = { lead: savedLead };
    else { status = 404; data = { error: { code: 'not_found', message: 'The record is not in this workspace.' } }; }
    return { status, ok: status >= 200 && status < 300, json: async () => structuredClone(data), headers: new Map() };
  };
  const source = fs.readFileSync(path.join(__dirname, '../workspace', script), 'utf8');
  const context = { document, window, location, history: window.history, URL, fetch, crypto: webcrypto, setTimeout, clearTimeout, Intl, Date, Blob, TextEncoder, btoa, console };
  if (options.failSession) state.failSession = true;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../workspace/deletion.js'), 'utf8'), context, { filename: 'deletion.js' });
  if (script === 'app.js') vm.runInContext(fs.readFileSync(path.join(__dirname, '../workspace/schedule.js'), 'utf8'), context, { filename: 'schedule.js' });
  vm.runInContext(source, context, { filename: script });
  return { element, state, calls, redirects, window, document };
}

async function settle() { for (let turn = 0; turn < 3; turn += 1) await new Promise(resolve => setImmediate(resolve)); }

for (const [productId, label] of [[undefined, 'PanelReply'], ['callback', 'PanelReply Callback']]) {
  test(`intake ${productId || 'combined'} navigation preserves its program title`, async () => {
    const page = client('app.js', { productId });
    await settle();
    assert.equal(page.element('signed-in-name').textContent, 'owner-A');
    assert.equal(page.element('app-error').hidden, true);
    await page.element('nav-profile').emit('click');
    assert.equal(page.document.title, 'Business profile · ' + label);
    assert.equal(page.element('page-title').textContent, 'Business profile');
    assert.equal(page.element('profile-view').hidden, false);
    await page.element('nav-inbox').emit('click');
    assert.equal(page.document.title, 'Request inbox · ' + label);
    assert.equal(page.element('page-title').textContent, 'Request inbox');
    assert.equal(page.element('inbox-view').hidden, false);
  });
}

test('panel initial network failure exposes an enabled retry that can recover', async () => {
  const page = client('panels.js', { failSession: true });
  await settle();
  assert.equal(page.element('panel-app-error').hidden, false);
  assert.equal(page.element('retry-panel-load').disabled, false);
  page.state.failSession = false;
  await page.element('retry-panel-load').emit('click');
  await settle();
  assert.equal(page.element('new-project').disabled, false);
  assert.equal(page.element('panel-load-status').textContent, 'Panel workspace loaded.');
});

test('new-project quota rejection keeps the draft editable without a false version conflict', async () => {
  const page = client('panels.js');
  await settle();
  await page.element('new-project').emit('click');
  page.element('project-name').value = 'Keep this unsaved project';
  page.state.mutationError = { code: 'project_limit', message: 'The local workspace supports up to 200 panel projects per business.' };
  await page.element('project-form').emit('submit');
  await settle();
  assert.match(page.element('project-error').textContent, /200 panel projects/);
  assert.equal(page.element('project-name').value, 'Keep this unsaved project');
  assert.equal(page.element('project-conflict').hidden, true);
  assert.equal(page.element('reload-project').disabled, true);
  assert.equal(page.element('save-project').disabled, false);
  assert.equal(page.calls.some(call => call.path.endsWith('/null')), false);
});

test('saved-project version conflict retains the draft and requires reload before saving', async () => {
  const page = client('panels.js', { project: true });
  await settle();
  assert.equal(page.element('project-name').value, savedProject.name);
  page.element('project-name').value = 'Keep this conflicting edit';
  page.state.mutationError = { code: 'version_conflict', message: 'This panel project changed. Reload it before saving.' };
  await page.element('project-form').emit('submit');
  await settle();
  assert.equal(page.element('project-name').value, 'Keep this conflicting edit');
  assert.equal(page.element('project-conflict').hidden, false);
  assert.equal(page.element('save-project').disabled, true);
  assert.equal(page.element('reload-project').disabled, false);
});

function panelReply(status, data) {
  return { status, ok: status >= 200 && status < 300, json: async () => structuredClone(data), headers: new Map() };
}

function assertPanelSaveLocked(page, { upload = false } = {}) {
  for (const id of ['project-name', 'project-notes', 'new-project', 'reload-project', 'delete-project', 'export-project', 'export-project-xlsx', 'sign-out']) {
    assert.equal(page.element(id).disabled, true, id + ' must stay locked while the first save is unconfirmed');
  }
  if (upload) {
    assert.match(page.element('source-status').textContent, /unconfirmed/);
    assert.equal(page.element('upload-source').disabled, false);
    assert.equal(page.element('upload-source').textContent, 'Retry image save');
  } else {
    assert.equal(page.element('project-retry').hidden, false);
    assert.equal(page.element('retry-project-save').disabled, false);
  }
  assert.equal(page.element('project-conflict').hidden, true);
}

test('panel create retains its first uncertain save after a later refusal and confirms the same command', async () => {
  const page = client('panels.js', { productId: 'spreadsheet' });
  await settle();
  await page.element('new-project').emit('click');
  page.element('project-name').value = 'Synthetic uncertain creation';
  let attempts = 0, committed;
  page.state.respond = (url, request) => {
    if (url !== '/api/panel-projects' || request.method !== 'POST') return;
    attempts += 1;
    if (attempts === 1) {
      committed = { ...structuredClone(savedProject), ...JSON.parse(request.body) };
      throw new Error('Synthetic lost response after commit');
    }
    if (attempts === 2) return panelReply(403, { error: { code: 'forbidden', message: 'Synthetic refusal on retry' } });
    return panelReply(200, { project: committed });
  };
  await page.element('project-form').emit('submit');
  assertPanelSaveLocked(page);
  await page.element('retry-project-save').emit('click');
  assertPanelSaveLocked(page);
  assert.match(page.element('project-error').textContent, /Synthetic refusal/);
  await page.element('retry-project-save').emit('click');
  assert.equal(page.element('project-retry').hidden, true);
  assert.match(page.element('project-save-status').textContent, /Project saved/);
  const writes = page.calls.filter(call => call.path === '/api/panel-projects' && call.method === 'POST');
  assert.equal(writes.length, 3);
  assert.ok(writes[0].headers['Idempotency-Key']);
  assert.equal(new Set(writes.map(call => call.headers['Idempotency-Key'])).size, 1);
  assert.equal(new Set(writes.map(call => call.body)).size, 1);
  assert.equal(page.element('project-name').value, committed.name);
});

test('panel update preserves uncertainty across a failed reconciliation read without another revision', async () => {
  const page = client('panels.js', { project: true, productId: 'spreadsheet' });
  await settle();
  page.element('project-notes').value = 'Retain this exact correction Ω';
  let reads = 0, committed;
  page.state.respond = (url, request) => {
    if (url !== '/api/panel-projects/' + PROJECT_ID) return;
    if (request.method === 'PATCH') {
      committed = { ...structuredClone(savedProject), ...JSON.parse(request.body), version: savedProject.version + 1 };
      return panelReply(200, { project: null });
    }
    if (++reads === 1) return panelReply(409, { error: { code: 'version_conflict', message: 'Synthetic rejected reconciliation' } });
    return panelReply(200, { project: committed });
  };
  await page.element('project-form').emit('submit');
  assertPanelSaveLocked(page);
  await page.element('retry-project-save').emit('click');
  assertPanelSaveLocked(page);
  await page.element('retry-project-save').emit('click');
  assert.equal(page.element('project-retry').hidden, true);
  assert.match(page.element('project-save-status').textContent, /Project saved/);
  assert.equal(page.element('project-notes').value, committed.notes);
  assert.equal(page.element('project-version').textContent, 'Version 2');
  assert.equal(page.calls.filter(call => call.method === 'PATCH').length, 1);
  assert.equal(reads, 2);
});

async function selectSyntheticSource(page, name = 'synthetic.png') {
  const bytes = Buffer.from('synthetic source bytes for client-state verification');
  page.element('panel-image').files = [{ name, type: 'image/png', size: bytes.length,
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) }];
  await page.element('panel-image').emit('change');
  return bytes;
}

test('panel source keeps its original bytes and retry key after an uncertain write and later conflict', async () => {
  const page = client('panels.js', { project: true, productId: 'spreadsheet' });
  await settle();
  await selectSyntheticSource(page);
  let attempts = 0, committed;
  page.state.respond = (url, request) => {
    if (url !== '/api/panel-projects/' + PROJECT_ID + '/sources' || request.method !== 'POST') return;
    attempts += 1;
    if (attempts === 1) {
      const body = JSON.parse(request.body);
      const source = { id: '33333333-3333-4333-8333-333333333333', name: body.name, mime: body.mime,
        bytes: Buffer.from(body.dataBase64, 'base64').length, width: 20, height: 20, createdAt: TIME };
      committed = { source, project: { ...structuredClone(savedProject), sources: [source], version: 2 } };
      return panelReply(500, { error: { code: 'internal_error', message: 'Synthetic error after commit' } });
    }
    if (attempts === 2) return panelReply(409, { error: { code: 'version_conflict', message: 'Synthetic retry conflict' } });
    return panelReply(200, committed);
  };
  await page.element('upload-source').emit('click');
  assertPanelSaveLocked(page, { upload: true });
  await page.element('upload-source').emit('click');
  assertPanelSaveLocked(page, { upload: true });
  await page.element('upload-source').emit('click');
  assert.match(page.element('source-status').textContent, /Source image saved/);
  assert.equal(page.element('project-version').textContent, 'Version 2');
  const writes = page.calls.filter(call => call.path.endsWith('/sources') && call.method === 'POST');
  assert.equal(writes.length, 3);
  assert.ok(writes[0].headers['Idempotency-Key']);
  assert.equal(new Set(writes.map(call => call.headers['Idempotency-Key'])).size, 1);
  assert.equal(new Set(writes.map(call => call.body)).size, 1);
  assert.equal(page.element('source-list').children.length, 1);
});

test('panel source first-attempt rejection releases the draft without inventing uncertainty', async () => {
  const page = client('panels.js', { project: true, productId: 'spreadsheet' });
  await settle();
  await selectSyntheticSource(page);
  page.state.respond = (url, request) => url.endsWith('/sources') && request.method === 'POST'
    ? panelReply(403, { error: { code: 'forbidden', message: 'Synthetic first-attempt refusal' } }) : undefined;
  await page.element('upload-source').emit('click');
  assert.match(page.element('source-error').textContent, /first-attempt refusal/);
  assert.equal(page.element('source-status').textContent, '');
  assert.equal(page.element('project-name').disabled, false);
  assert.equal(page.element('new-project').disabled, false);
  assert.equal(page.element('upload-source').textContent, 'Save image');
  assert.equal(page.element('project-version').textContent, 'Version 1');
  assert.equal(page.element('source-list').children.length, 0);
});

test('panel create rejects a missing name before changing its draft and confirms the original command on retry', async () => {
  const page = client('panels.js', { productId: 'spreadsheet' });
  await settle();
  await page.element('new-project').emit('click');
  page.element('project-name').value = 'Original create draft Ω';
  page.element('project-notes').value = 'Keep this exact note\r\n𝛀';
  let attempts = 0, committed;
  page.state.respond = (url, request) => {
    if (url !== '/api/panel-projects' || request.method !== 'POST') return;
    committed = { ...structuredClone(savedProject), ...JSON.parse(request.body) };
    if (++attempts === 1) { const incomplete = { ...committed }; delete incomplete.name; return panelReply(201, { project: incomplete }); }
    return panelReply(200, { project: committed, created: false });
  };
  await page.element('project-form').emit('submit');
  assert.equal(page.element('project-name').value, 'Original create draft Ω');
  assert.equal(page.element('project-notes').value, 'Keep this exact note\r\n𝛀');
  assert.equal(page.element('project-version').textContent, '');
  assertPanelSaveLocked(page);
  assert.match(page.element('project-error').textContent, /incomplete or invalid/);
  await page.element('retry-project-save').emit('click');
  const writes = page.calls.filter(call => call.path === '/api/panel-projects' && call.method === 'POST');
  assert.equal(writes.length, 2);
  assert.equal(writes[0].body, writes[1].body);
  assert.equal(writes[0].headers['Idempotency-Key'], writes[1].headers['Idempotency-Key']);
  assert.equal(page.element('project-name').value, committed.name);
  assert.equal(page.element('project-notes').value, committed.notes);
  assert.equal(page.element('project-retry').hidden, true);
  assert.match(page.element('project-save-status').textContent, /Project saved/);
});

async function rejectedPanelUpdate(change) {
  const page = client('panels.js', { productId: 'spreadsheet', project: true });
  await settle();
  const correction = 'Original correction Ω\r\nKeep surrounding spaces  ';
  page.element('project-notes').value = correction;
  let committed;
  page.state.respond = (url, request) => {
    if (url !== '/api/panel-projects/' + PROJECT_ID) return;
    if (request.method === 'PATCH') {
      committed = { ...structuredClone(savedProject), ...JSON.parse(request.body), version: 2 };
      const invalid = structuredClone(committed);
      change(invalid);
      return panelReply(200, { project: invalid });
    }
    return panelReply(200, { project: committed });
  };
  await page.element('project-form').emit('submit');
  assert.equal(page.element('project-name').value, savedProject.name);
  assert.equal(page.element('project-notes').value, correction);
  assert.equal(page.element('project-version').textContent, 'Version 1');
  assert.equal(page.element('panel-parts-body').children.length, 0);
  assert.equal(page.element('source-list').children.length, 0);
  assertPanelSaveLocked(page);
  assert.match(page.element('project-error').textContent, /incomplete or invalid/);
  await page.element('retry-project-save').emit('click');
  assert.equal(page.element('project-name').value, committed.name);
  assert.equal(page.element('project-notes').value, correction);
  assert.equal(page.element('project-version').textContent, 'Version 2');
  assert.equal(page.element('project-retry').hidden, true);
  assert.equal(page.calls.filter(call => call.method === 'PATCH').length, 1);
  return page;
}

test('panel update rejects missing notes without erasing its correction and reconciles the saved command', async () => {
  await rejectedPanelUpdate(value => { delete value.notes; });
});

const RESPONSE_SOURCE_ID = '33333333-3333-4333-8333-333333333333';
const OTHER_PROJECT_ID = '99999999-9999-4999-8999-999999999999';
const responseRow = () => ({ partNumber: '', manufacturer: '', description: 'Unknown label Ω', quantity: 1, reviewStatus: 'unreviewed', sourceImageId: null, notes: '' });
const responseSource = () => ({ id: RESPONSE_SOURCE_ID, name: 'label.png', mime: 'image/png', bytes: 123, width: 20, height: 20, createdAt: TIME });

function extractionResponse() {
  return { engine: 'tesseract', engineVersion: '5.5.0', projectId: PROJECT_ID, version: 1, sourceImageId: RESPONSE_SOURCE_ID,
    rawText: 'Part number: Synthetic-Ω\nDescription: Keep this source label', warnings: ['Check every source character.'], durationMs: 1,
    candidates: [{ partNumber: 'Synthetic-Ω', manufacturer: '', description: 'Keep this source label',
      confidence: { partNumber: 91, manufacturer: null, description: 84 }, reviewStatus: 'unreviewed',
      sourceImageId: RESPONSE_SOURCE_ID, warnings: ['Manufacturer remains unknown.'] }] };
}
async function extractionPage(replies) {
  const initial = { ...structuredClone(savedProject), notes: 'Saved correction Ω  ', rows: [responseRow()], sources: [responseSource()] };
  const page = client('panels.js', { productId: 'spreadsheet', project: true });
  let attempt = 0;
  page.state.respond = (url, request) => {
    if (url === '/api/panel-ocr') return panelReply(200, { available: true, engine: 'tesseract', version: '5.5.0', language: 'eng' });
    if (url === '/api/panel-projects/' + PROJECT_ID && (!request.method || request.method === 'GET')) return panelReply(200, { project: initial });
    if (url === '/api/panel-projects/' + PROJECT_ID + '/sources/' + RESPONSE_SOURCE_ID + '/ocr') return panelReply(200, replies[attempt++]);
  };
  await settle();
  const button = page.element('source-list').querySelector('[data-ocr]');
  assert.equal(button.disabled, false);
  return { page, initial, extract: () => button.emit('click') };
}
function assertExtractionRejected(page, initial) {
  assert.equal(page.element('add-ocr-rows').disabled, true, 'An invalid extraction must not leave an enabled add action.');
  assert.equal(page.element('ocr-result').hidden, true);
  assert.match(page.element('source-error').textContent, /extraction response.*incomplete|extraction response.*invalid/i);
  assert.equal(page.element('project-notes').value, initial.notes);
  assert.equal(page.element('project-version').textContent, 'Version 1');
  assert.equal(page.element('panel-parts-body').children.length, initial.rows.length);
  assert.equal(page.element('panel-parts-body').querySelector('[data-field="description"]').value, initial.rows[0].description);
  assert.equal(page.element('project-dirty').hidden, true);
  assert.equal(page.element('save-project').disabled, false);
}

test('panel extraction rejects a response for another project before exposing its candidates', async () => {
  const invalid = extractionResponse(); invalid.projectId = OTHER_PROJECT_ID;
  const { page, initial, extract } = await extractionPage([invalid, extractionResponse()]);
  await extract();
  assertExtractionRejected(page, initial);
  await extract();
  assert.equal(page.element('ocr-result').hidden, false);
  assert.equal(page.element('add-ocr-rows').disabled, false);
  await page.element('add-ocr-rows').emit('click');
  assert.equal(page.element('panel-parts-body').children.length, 2);
  const added = page.element('panel-parts-body').children[1];
  assert.equal(added.querySelector('[data-field="partNumber"]').value, 'Synthetic-Ω');
  assert.equal(added.querySelector('[data-field="manufacturer"]').value, '');
  assert.equal(added.querySelector('[data-field="reviewStatus"]').value, 'unreviewed');
  assert.equal(added.querySelector('[data-field="sourceImageId"]').value, RESPONSE_SOURCE_ID);
  assert.equal(page.calls.filter(call => call.method !== 'GET').length, 2);
});

test('panel malformed extraction warnings cannot leave addable candidates after rendering fails', async () => {
  const invalid = extractionResponse(); invalid.warnings = { message: 'Malformed warning' };
  const { page, initial, extract } = await extractionPage([extractionResponse()]);
  await extract();
  assert.equal(page.element('add-ocr-rows').disabled, false);
  let reply;
  page.state.respond = url => {
    if (url.endsWith('/ocr')) return new Promise(resolve => { reply = resolve; });
  };
  const pending = extract();
  assert.equal(page.element('add-ocr-rows').disabled, true);
  assert.equal(page.element('ocr-result').hidden, true);
  await page.element('new-project').emit('click');
  assert.equal(page.element('project-name').value, initial.name);
  assert.equal(page.element('project-version').textContent, 'Version 1');
  assert.match(page.element('panel-app-error-text').textContent, /Wait for the current operation/);
  reply(panelReply(200, invalid));
  await pending;
  assertExtractionRejected(page, initial);
  await page.element('add-ocr-rows').emit('click');
  assert.equal(page.element('panel-parts-body').children.length, initial.rows.length);
  assert.equal(page.calls.filter(call => call.method !== 'GET').length, 2);
});

async function rejectedExtraction(change) {
  const invalid = extractionResponse(); change(invalid);
  const { page, initial, extract } = await extractionPage([invalid]);
  await extract();
  assertExtractionRejected(page, initial);
  assert.equal(page.calls.filter(call => call.method !== 'GET').length, 1);
}

test('panel extraction binds both receipt and candidate source identities to the requested image', async () => {
  for (const change of [
    result => { result.sourceImageId = OTHER_PROJECT_ID; },
    result => { delete result.sourceImageId; },
    result => { result.candidates[0].sourceImageId = OTHER_PROJECT_ID; },
    result => { delete result.candidates[0].sourceImageId; },
  ]) await rejectedExtraction(change);
});

test('panel extraction requires the exact submitted revision without creating a false save conflict', async () => {
  for (const change of [
    result => { result.version = 0; },
    result => { result.version = 2; },
    result => { result.version = '1'; },
    result => { delete result.version; },
  ]) await rejectedExtraction(change);
});

test('panel extraction rejects incomplete, oversized or reviewed candidate data before draft mutation', async () => {
  const changes = [
    result => { result.candidates = [null]; },
    result => { result.candidates.push(structuredClone(result.candidates[0])); },
    result => { delete result.candidates[0].manufacturer; },
    result => { result.candidates[0].manufacturer = null; },
    result => { result.candidates[0].partNumber = 'N'.repeat(121); },
    result => { result.candidates[0].manufacturer = 'N'.repeat(121); },
    result => { result.candidates[0].description = 'N'.repeat(501); },
    result => { result.candidates[0].partNumber = '\ud800'; },
    result => { result.candidates[0].description = 'N\u0000'; },
    result => { result.candidates[0].reviewStatus = 'reviewed'; },
    result => { result.candidates[0].reviewStatus = 'approved'; },
    result => { result.candidates[0].suggestedCompatibility = 'Unsupported inference'; },
  ];
  for (const change of changes) await rejectedExtraction(change);
});

test('panel extraction validates raw text, warning lists and confidence before publishing its result', async () => {
  for (const change of [
    result => { result.rawText = 'N'.repeat(20001); },
    result => { result.rawText = '\udfff'; },
    result => { result.warnings = ['Check this', { unexpected: 'object' }]; },
    result => { delete result.warnings; },
    result => { result.candidates[0].warnings = 'This must be a list'; },
    result => { result.candidates[0].warnings = [null]; },
    result => { delete result.candidates[0].confidence; },
    result => { result.candidates[0].confidence.partNumber = 100.01; },
    result => { result.candidates[0].confidence.partNumber = -1; },
    result => { result.candidates[0].confidence.partNumber = '91'; },
    result => { result.candidates[0].confidence.manufacturer = 99; },
  ]) await rejectedExtraction(change);
});

test('panel extraction preserves valid Unicode and blank fields through explicit add and save', async () => {
  const result = extractionResponse();
  result.rawText = 'Ω'.repeat(19998) + '\r\n';
  result.candidates[0].partNumber = '𝛀'.repeat(60);
  result.candidates[0].manufacturer = '';
  result.candidates[0].description = '  ' + 'Ω'.repeat(496) + '\r\n';
  result.candidates[0].confidence = { partNumber: 100, manufacturer: null, description: null };
  const { page, initial, extract } = await extractionPage([result]);
  await extract();
  assert.equal(page.element('ocr-result').hidden, false);
  assert.equal(page.element('ocr-raw-text').textContent, result.rawText);
  assert.equal(page.element('panel-parts-body').children.length, initial.rows.length);
  assert.equal(page.element('project-dirty').hidden, true);
  await page.element('add-ocr-rows').emit('click');
  const added = page.element('panel-parts-body').children[1];
  for (const field of ['partNumber', 'manufacturer', 'description', 'sourceImageId', 'reviewStatus']) {
    assert.equal(added.querySelector('[data-field="' + field + '"]').value, result.candidates[0][field]);
  }
  assert.equal(page.element('project-dirty').hidden, false);
  let savedBody;
  page.state.respond = (url, request) => {
    if (url !== '/api/panel-projects/' + PROJECT_ID || request.method !== 'PATCH') return;
    savedBody = JSON.parse(request.body);
    return panelReply(200, { project: { ...initial, ...savedBody, version: 2 } });
  };
  await page.element('project-form').emit('submit');
  assert.equal(savedBody.rows.length, 2);
  assert.equal(savedBody.rows[1].partNumber, result.candidates[0].partNumber);
  assert.equal(savedBody.rows[1].manufacturer, '');
  assert.equal(savedBody.rows[1].description, result.candidates[0].description);
  assert.equal(savedBody.rows[1].reviewStatus, 'unreviewed');
  assert.equal(savedBody.rows[1].sourceImageId, RESPONSE_SOURCE_ID);
  assert.match(page.element('project-save-status').textContent, /Project saved/);
});

test('panel empty and ambiguous OCR results remain available for manual review without inferred values', async () => {
  for (const ambiguous of [false, true]) {
    const result = extractionResponse();
    result.rawText = ambiguous ? 'Part number: FIRST\nPart number: SECOND' : '';
    if (ambiguous) {
      Object.assign(result.candidates[0], { partNumber: '', manufacturer: '', description: '',
        confidence: { partNumber: null, manufacturer: null, description: null }, warnings: ['Ambiguous fields require manual entry.'] });
    } else result.candidates = [];
    const { page, initial, extract } = await extractionPage([result]);
    await extract();
    assert.equal(page.element('ocr-result').hidden, false);
    assert.equal(page.element('source-error').hidden, true);
    assert.equal(page.element('panel-parts-body').children.length, initial.rows.length);
    assert.equal(page.element('project-dirty').hidden, true);
    assert.equal(page.element('add-ocr-rows').disabled, !ambiguous);
  }
});

test('panel project response enforces public metadata limits before adopting any fields', async () => {
  const changes = [
    value => { value.id = 'not-a-project-id'; },
    value => { value.version = Number.MAX_SAFE_INTEGER; },
    value => { value.version = 0; },
    value => { value.name = ' '; },
    value => { value.name = ' Untrimmed name '; },
    value => { value.name = 'N'.repeat(121); },
    value => { value.notes = 'N'.repeat(2001); },
    value => { value.notes = 'broken\ud800'; },
    value => { value.notes = 'broken\udfff'; },
    value => { value.notes = 'control\u0000'; },
    value => { value.createdAt = '1969-12-31T23:59:59.999Z'; },
    value => { value.updatedAt = '2026-11-18T23:59:59.999Z'; },
    value => { value.updatedAt = '+275760-09-13T00:00:00.001Z'; },
    value => { value.updatedAt = '2026-11-19'; },
    value => { value.businessId = 'unexpected-public-field'; },
    value => { value.rows = Array.from({ length: 201 }, responseRow); },
    value => { value.sources = {}; },
  ];
  for (const change of changes) await rejectedPanelUpdate(change);
});

test('panel row responses preserve unknown-as-blank and reject malformed correction or review data', async () => {
  const changes = [
    row => { delete row.description; },
    row => { row.partNumber = 'N'.repeat(129); },
    row => { row.manufacturer = 'N'.repeat(121); },
    row => { row.description = 'N'.repeat(1001); },
    row => { row.notes = 'N'.repeat(1001); },
    row => { row.partNumber = '\ud800'; },
    row => { row.description = ''; },
    row => { row.quantity = '1'; },
    row => { row.quantity = 10000; },
    row => { row.quantity = 0.5; },
    row => { row.reviewStatus = 'reviewed'; },
    row => { row.reviewStatus = 'approved'; },
    row => { row.sourceImageId = RESPONSE_SOURCE_ID; },
    row => { row.suggestedCompatibility = 'unexpected'; },
  ];
  for (const change of changes) await rejectedPanelUpdate(value => { const row = responseRow(); change(row); value.rows = [row]; });
  await rejectedPanelUpdate(value => { value.rows = [null]; });
});

test('panel source responses reject invalid metadata and duplicate identities before replacing the draft', async () => {
  const changes = [
    source => { delete source.mime; },
    source => { source.id = 'not-a-source-id'; },
    source => { source.name = '../label.png'; },
    source => { source.name = ' label.png '; },
    source => { source.name = 'N'.repeat(161); },
    source => { source.mime = 'image/svg+xml'; },
    source => { source.bytes = 2 * 1024 * 1024 + 1; },
    source => { source.width = 6001; },
    source => { source.height = 0; },
    source => { source.width = 4001; source.height = 4000; },
    source => { source.createdAt = 'invalid date'; },
    source => { source.dataBase64 = 'unexpected'; },
  ];
  for (const change of changes) await rejectedPanelUpdate(value => { const source = responseSource(); change(source); value.sources = [source]; });
  await rejectedPanelUpdate(value => { value.sources = [responseSource(), responseSource()]; });
  await rejectedPanelUpdate(value => { value.sources = Array.from({ length: 6 }, (_, i) => ({ ...responseSource(), id: `33333333-3333-4333-8333-${String(i).padStart(12, '0')}` })); });
});

test('panel update refuses a valid-shaped receipt for another project and recovers its own saved version', async () => {
  await rejectedPanelUpdate(value => { value.id = OTHER_PROJECT_ID; });
});

test('panel reconciliation checks the target identity before accepting matching contents', async () => {
  const page = client('panels.js', { productId: 'spreadsheet', project: true });
  await settle();
  page.element('project-notes').value = 'Keep this project target';
  let committed, reads = 0;
  page.state.respond = (url, request) => {
    if (url !== '/api/panel-projects/' + PROJECT_ID) return;
    if (request.method === 'PATCH') {
      committed = { ...structuredClone(savedProject), ...JSON.parse(request.body), version: 2 };
      throw new Error('Synthetic response lost after commit');
    }
    return panelReply(200, { project: ++reads === 1 ? { ...committed, id: OTHER_PROJECT_ID } : committed });
  };
  await page.element('project-form').emit('submit');
  await page.element('retry-project-save').emit('click');
  assertPanelSaveLocked(page);
  assert.equal(page.element('project-notes').value, 'Keep this project target');
  assert.equal(page.element('project-version').textContent, 'Version 1');
  assert.equal(page.calls.filter(call => call.method === 'PATCH').length, 1);
  await page.element('retry-project-save').emit('click');
  assert.equal(page.element('project-version').textContent, 'Version 2');
  assert.equal(page.element('project-retry').hidden, true);
  assert.equal(page.calls.filter(call => call.method === 'PATCH').length, 1);
});

test('panel reload rejects another project or a server-supplied empty draft while retaining the current project', async () => {
  for (const invalid of [{ ...savedProject, id: OTHER_PROJECT_ID, name: 'Wrong project' }, { id: null, name: '', notes: '', rows: [], sources: [], version: 0 }]) {
    const page = client('panels.js', { productId: 'spreadsheet', project: true });
    await settle();
    page.state.respond = (url, request) => url === '/api/panel-projects/' + PROJECT_ID && (!request.method || request.method === 'GET') ? panelReply(200, { project: invalid }) : undefined;
    await page.element('reload-project').emit('click');
    await settle();
    assert.equal(page.element('project-name').value, savedProject.name);
    assert.equal(page.element('project-version').textContent, 'Version 1');
    assert.match(page.element('panel-app-error-text').textContent, /incomplete or invalid/);
    page.state.respond = null;
    await page.element('reload-project').emit('click');
    await settle();
    assert.equal(page.element('project-name').value, savedProject.name);
    assert.equal(page.element('panel-load-status').textContent, 'Project loaded.');
  }
});

async function rejectedPanelUpload(change, initial = savedProject) {
  const page = client('panels.js', { productId: 'spreadsheet', project: true });
  page.state.respond = (url, request) => url === '/api/panel-projects/' + PROJECT_ID && (!request.method || request.method === 'GET') ? panelReply(200, { project: initial }) : undefined;
  await settle();
  const bytes = await selectSyntheticSource(page, '  synthetic Ω.png  ');
  let attempts = 0, committed;
  page.state.respond = (url, request) => {
    if (url !== '/api/panel-projects/' + PROJECT_ID + '/sources' || request.method !== 'POST') return;
    const body = JSON.parse(request.body);
    const source = { ...responseSource(), name: body.name.trim(), bytes: bytes.length };
    committed = { source: { ...source }, project: { ...structuredClone(initial), sources: [...initial.sources, source], version: initial.version + 1 } };
    if (++attempts === 1) { const invalid = structuredClone(committed); change(invalid); return panelReply(201, invalid); }
    return panelReply(200, committed);
  };
  await page.element('upload-source').emit('click');
  assertPanelSaveLocked(page, { upload: true });
  assert.equal(page.element('project-name').value, initial.name);
  assert.equal(page.element('project-notes').value, initial.notes);
  assert.equal(page.element('project-version').textContent, 'Version ' + initial.version);
  assert.equal(page.element('source-list').children.length, initial.sources.length);
  assert.match(page.element('source-error').textContent, /incomplete or invalid/);
  await page.element('upload-source').emit('click');
  assert.equal(page.element('project-version').textContent, 'Version ' + (initial.version + 1));
  assert.match(page.element('source-status').textContent, /Source image saved/);
  const writes = page.calls.filter(call => call.path.endsWith('/sources') && call.method === 'POST');
  assert.equal(writes.length, 2);
  assert.equal(writes[0].body, writes[1].body);
  assert.equal(writes[0].headers['Idempotency-Key'], writes[1].headers['Idempotency-Key']);
  assert.equal(JSON.parse(writes[0].body).name, '  synthetic Ω.png  ');
  return page;
}

test('panel upload rejects a valid-shaped receipt for another project without changing its original command', async () => {
  await rejectedPanelUpload(result => { result.project.id = OTHER_PROJECT_ID; });
});

test('panel upload binds source identity and metadata to the project and submitted command', async () => {
  const changes = [
    result => { result.source.id = OTHER_PROJECT_ID; },
    result => { delete result.source.bytes; },
    result => { result.source.width += 1; },
    result => { result.source.bytes += 1; result.project.sources[0].bytes += 1; },
    result => { result.source.name = 'another.png'; result.project.sources[0].name = 'another.png'; },
    result => { result.source.mime = 'image/jpeg'; result.project.sources[0].mime = 'image/jpeg'; },
  ];
  for (const change of changes) await rejectedPanelUpload(change);
});

test('panel upload cannot confirm a pre-existing source as the new image even when its metadata matches', async () => {
  const existing = { ...responseSource(), id: OTHER_PROJECT_ID, name: 'synthetic Ω.png', bytes: Buffer.byteLength('synthetic source bytes for client-state verification') };
  await rejectedPanelUpload(result => { result.source = { ...existing }; result.project.sources = [existing]; }, { ...savedProject, sources: [existing] });
});

test('panel response accepts public limits and preserves Unicode, whitespace, blank unknown fields and review state', async () => {
  const value = {
    ...savedProject, name: 'N'.repeat(118) + '𝛀', notes: '𝛀'.repeat(1000), version: Number.MAX_SAFE_INTEGER - 1,
    createdAt: '1970-01-01T00:00:00.000Z', updatedAt: '+275760-09-13T00:00:00.000Z',
    sources: Array.from({ length: 5 }, (_, i) => ({ ...responseSource(), id: `33333333-3333-4333-8333-${String(i).padStart(12, '0')}`, name: '𝛀'.repeat(78) + '.png', bytes: 2 * 1024 * 1024, width: i ? 6000 : 4000, height: i ? 1 : 4000 })),
    rows: Array.from({ length: 200 }, responseRow),
  };
  value.rows[0] = { partNumber: ' ' + '𝛀'.repeat(63) + ' ', manufacturer: 'M'.repeat(118) + '\r\n', description: 'Ω'.repeat(998) + '\t ', quantity: 9999, reviewStatus: 'reviewed', sourceImageId: value.sources[0].id, notes: '𝛀'.repeat(500) };
  value.rows[1].sourceImageId = value.sources[1].id;
  const { validateProject } = require('../workspace/panels.cjs');
  assert.doesNotThrow(() => validateProject({ version: value.version, name: value.name, notes: value.notes, rows: value.rows }, { update: true }));
  const page = client('panels.js', { productId: 'spreadsheet', project: true });
  page.state.respond = (url, request) => url === '/api/panel-projects/' + PROJECT_ID && (!request.method || request.method === 'GET') ? panelReply(200, { project: value }) : undefined;
  await settle();
  assert.equal(page.element('project-name').value, value.name);
  assert.equal(page.element('project-notes').value, value.notes);
  assert.equal(page.element('project-version').textContent, 'Version ' + value.version);
  assert.equal(page.element('source-list').children.length, 5);
  const rows = page.element('panel-parts-body').children;
  assert.equal(rows.length, 200);
  for (const [field, expected] of Object.entries(value.rows[0])) assert.equal(rows[0].querySelector(`[data-field="${field}"]`).value, expected);
  for (const field of ['partNumber', 'manufacturer']) assert.equal(rows[1].querySelector(`[data-field="${field}"]`).value, '');
  assert.equal(rows[1].querySelector('[data-field="reviewStatus"]').value, 'unreviewed');
  assert.equal(page.element('project-name').disabled, false);
  assert.equal(page.element('project-retry').hidden, true);
  assert.equal(page.element('panel-load-status').textContent, 'Project loaded.');
});

test('panel local empty draft remains explicit and can be discarded before starting another draft', async () => {
  const page = client('panels.js', { productId: 'spreadsheet' });
  await settle();
  await page.element('new-project').emit('click');
  page.element('project-name').value = 'Discard this local draft';
  page.element('project-notes').value = 'Unsaved';
  await page.element('add-part').emit('click');
  await page.element('new-project').emit('click');
  assert.equal(page.element('panel-navigation-guard').hidden, false);
  await page.element('panel-discard').emit('click');
  assert.equal(page.element('project-name').value, '');
  assert.equal(page.element('project-notes').value, '');
  assert.equal(page.element('panel-parts-body').children.length, 0);
  assert.equal(page.element('project-version').textContent, '');
  assert.equal(page.element('project-name').disabled, false);
  assert.equal(page.element('project-retry').hidden, true);
  assert.equal(page.calls.some(call => call.method === 'POST'), false);
});

test('panel create replay still accepts the server-assigned project after a later saved correction', async () => {
  const page = client('panels.js', { productId: 'spreadsheet' });
  await settle();
  await page.element('new-project').emit('click');
  page.element('project-name').value = 'Original create name';
  let writes = 0;
  page.state.respond = (url, request) => {
    if (url !== '/api/panel-projects' || request.method !== 'POST') return;
    if (++writes === 1) throw new Error('Synthetic lost create receipt');
    return panelReply(200, { created: false, project: { ...savedProject, name: 'Later saved correction', notes: 'Changed after creation', version: 2 } });
  };
  await page.element('project-form').emit('submit');
  assertPanelSaveLocked(page);
  await page.element('retry-project-save').emit('click');
  assert.equal(page.element('project-name').value, 'Later saved correction');
  assert.equal(page.element('project-notes').value, 'Changed after creation');
  assert.equal(page.element('project-version').textContent, 'Version 2');
  assert.equal(page.element('project-retry').hidden, true);
  const commands = page.calls.filter(call => call.path === '/api/panel-projects' && call.method === 'POST');
  assert.equal(commands.length, 2);
  assert.equal(commands[0].body, commands[1].body);
  assert.equal(commands[0].headers['Idempotency-Key'], commands[1].headers['Idempotency-Key']);
});

test('panel unchanged update retries the original write when a matching readback has not advanced', async () => {
  for (const readVersion of [3, 2]) {
    const initial = { ...savedProject, version: 3 };
    const page = client('panels.js', { productId: 'spreadsheet', project: true });
    page.state.respond = (url, request) => url === '/api/panel-projects/' + PROJECT_ID && request.method !== 'PATCH' ? panelReply(200, { project: initial }) : undefined;
    await settle();
    const commands = [];
    let reads = 0;
    page.state.respond = (url, request) => {
      if (url !== '/api/panel-projects/' + PROJECT_ID) return;
      if (request.method === 'PATCH') {
        commands.push(request.body);
        if (commands.length === 1) throw new Error('Synthetic request failure before commit');
        return panelReply(200, { project: { ...initial, ...JSON.parse(request.body), version: 4 } });
      }
      reads += 1;
      return panelReply(200, { project: { ...initial, version: readVersion } });
    };
    await page.element('project-form').emit('submit');
    assertPanelSaveLocked(page);
    await page.element('retry-project-save').emit('click');
    assert.equal(commands.length, 2, 'equal values at an original or older revision do not confirm the update');
    assert.equal(commands[0], commands[1]);
    assert.equal(JSON.parse(commands[1]).version, initial.version);
    assert.equal(reads, 1);
    assert.equal(page.element('project-version').textContent, 'Version 4');
    assert.equal(page.element('project-retry').hidden, true);
    assert.match(page.element('project-save-status').textContent, /Project saved/);
  }
});

test('panel update rejects a receipt that does not advance and can reconcile a still-later revision', async () => {
  for (const receiptVersion of [3, 2]) {
    const initial = { ...savedProject, version: 3 };
    const page = client('panels.js', { productId: 'spreadsheet', project: true });
    page.state.respond = (url, request) => url === '/api/panel-projects/' + PROJECT_ID && request.method !== 'PATCH' ? panelReply(200, { project: initial }) : undefined;
    await settle();
    page.element('project-notes').value = 'Retain this correction Ω';
    let committed, writes = 0;
    page.state.respond = (url, request) => {
      if (url !== '/api/panel-projects/' + PROJECT_ID) return;
      if (request.method === 'PATCH') {
        writes += 1;
        committed = { ...initial, ...JSON.parse(request.body), version: 5 };
        return panelReply(200, { project: { ...committed, version: receiptVersion } });
      }
      return panelReply(200, { project: committed });
    };
    await page.element('project-form').emit('submit');
    assertPanelSaveLocked(page);
    assert.equal(page.element('project-notes').value, 'Retain this correction Ω');
    assert.equal(page.element('project-version').textContent, 'Version 3');
    assert.match(page.element('project-error').textContent, /incomplete or invalid/);
    await page.element('retry-project-save').emit('click');
    assert.equal(page.element('project-version').textContent, 'Version 5');
    assert.equal(page.element('project-retry').hidden, true);
    assert.equal(writes, 1);
  }
});

test('panel upload requires an advanced project revision and accepts a still-later same-key receipt', async () => {
  for (const receiptVersion of [3, 2]) {
    const initial = { ...savedProject, version: 3 };
    const page = client('panels.js', { productId: 'spreadsheet', project: true });
    page.state.respond = (url, request) => url === '/api/panel-projects/' + PROJECT_ID && request.method !== 'POST' ? panelReply(200, { project: initial }) : undefined;
    await settle();
    const bytes = await selectSyntheticSource(page);
    let attempts = 0;
    page.state.respond = (url, request) => {
      if (url !== '/api/panel-projects/' + PROJECT_ID + '/sources' || request.method !== 'POST') return;
      const source = { ...responseSource(), name: 'synthetic.png', bytes: bytes.length };
      const version = ++attempts === 1 ? receiptVersion : 5;
      return panelReply(200, { source, project: { ...initial, sources: [source], version } });
    };
    await page.element('upload-source').emit('click');
    assertPanelSaveLocked(page, { upload: true });
    assert.equal(page.element('project-version').textContent, 'Version 3');
    assert.equal(page.element('source-list').children.length, 0);
    assert.match(page.element('source-error').textContent, /incomplete or invalid/);
    await page.element('upload-source').emit('click');
    assert.equal(page.element('project-version').textContent, 'Version 5');
    assert.equal(page.element('source-list').children.length, 1);
    assert.match(page.element('source-status').textContent, /Source image saved/);
    const commands = page.calls.filter(call => call.path.endsWith('/sources') && call.method === 'POST');
    assert.equal(commands.length, 2);
    assert.equal(commands[0].body, commands[1].body);
    assert.equal(commands[0].headers['Idempotency-Key'], commands[1].headers['Idempotency-Key']);
  }
});

test('panel retry clears the previous business project when the authenticated identity changes', async () => {
  const page = client('panels.js', { project: true });
  await settle();
  assert.equal(page.element('project-content').hidden, false);
  assert.equal(page.element('project-name').value, savedProject.name);
  page.state.actor = 'B';
  await page.element('retry-panel-load').emit('click');
  await settle();
  assert.deepEqual(page.redirects, ['/login']);
  assert.equal(page.element('project-content').hidden, true);
  assert.equal(page.element('project-list').children.length, 0);
});

test('intake retry clears the previous business request when the authenticated identity changes', async () => {
  const page = client('app.js', { lead: true });
  await settle();
  assert.equal(page.element('lead-detail').hidden, false);
  assert.equal(page.element('lead-name').value, savedLead.customerName);
  page.state.actor = 'B';
  await page.element('retry-load').emit('click');
  await settle();
  assert.deepEqual(page.redirects, ['/login']);
  assert.equal(page.element('lead-detail').hidden, true);
  assert.equal(page.element('requests-list').children.length, 0);
});

test('dashboard retry clears old records before waiting on a different account data load', async () => {
  const page = client('dashboard.js');
  await settle();
  assert.match(page.element('dashboard-project-list').textContent, /Business A private project/);
  page.state.actor = 'B';
  page.state.holdReads = true;
  // The event intentionally leaves any incorrectly started scoped request pending.
  void page.element('retry-dashboard').emit('click');
  await settle();
  assert.deepEqual(page.redirects, ['/login']);
  assert.equal(page.element('dashboard-project-list').children.length, 0);
  assert.equal(page.element('dashboard-request-list').children.length, 0);
});

test('intake callback malformed parent history preserves the task draft, request and retry until a complete receipt arrives', async () => {
  const page = client('app.js', { lead: true, productId: 'callback' }); await settle();
  page.element('task-time-zone').value = 'America/Detroit'; page.element('task-local-time').value = '2026-12-01T09:30';
  page.element('task-notes').value = 'Keep the operator callback draft'; await page.element('callback-task-form').emit('input');
  let attempts = 0;
  page.state.respond = async (url, request) => {
    if (url !== `/api/leads/${LEAD_ID}/tasks` || request.method !== 'POST') return;
    attempts++;
    const body = JSON.parse(request.body), task = { id: PROJECT_ID, leadId: LEAD_ID, leadVersion: 2, version: 1,
      customerName: savedLead.customerName, phone: savedLead.phone, requestStatus: savedLead.status, contactAllowed: true, blockReason: null,
      kind: body.kind, dueAt: body.dueAt, timeZone: body.timeZone, notes: body.notes, status: 'scheduled', outcome: '',
      createdAt: TIME, updatedAt: TIME, completedAt: null, cancelledAt: null, dueState: 'upcoming', isDue: false };
    return panelReply(attempts === 1 ? 201 : 200, { task, lead: { ...savedLead, version: 2, audit: attempts === 1 ? [null] : [] },
      created: attempts === 1, replayed: attempts !== 1 });
  };
  await page.element('callback-task-form').emit('submit'); await settle();
  assert.equal(page.element('task-notes').value, 'Keep the operator callback draft');
  assert.equal(page.element('task-local-time').value, '2026-12-01T09:30');
  assert.equal(page.element('lead-name').value, savedLead.customerName);
  assert.equal(page.element('lead-version').textContent, 'Revision 1');
  assert.match(page.element('task-error').textContent, /incomplete/);
  assert.equal(page.element('task-uncertain').hidden, false); assert.equal(page.element('retry-task-save').disabled, false);
  assert.equal(page.element('task-save-status').textContent, '');
  const first = page.calls.find(call => call.method === 'POST');
  await page.element('retry-task-save').emit('click'); await settle();
  const writes = page.calls.filter(call => call.method === 'POST');
  assert.equal(writes.length, 2); assert.deepEqual(writes, [first, first]);
  assert.equal(page.element('lead-version').textContent, 'Revision 2');
  assert.equal(page.element('task-notes').value, ''); assert.equal(page.element('task-uncertain').hidden, true);
  assert.match(page.element('task-save-status').textContent, /Task scheduled/);
});

