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
  const state = { actor: 'A', failSession: false, mutationError: null, holdReads: false };
  let document;
  function make(tag = 'div', initialId = '') {
    const attributes = new Map();
    const classes = new Set();
    let id = '', content = '';
    const element = {
      tagName: tag.toUpperCase(), children: [], parentNode: null, value: '', checked: false,
      files: [], hidden: false, disabled: false, dataset: {}, listeners: new Map(), style: {},
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
  element('status-filter').value = 'all';
  const pagePath = script === 'panels.js' ? '/panels' : script === 'dashboard.js' ? '/dashboard' : '/';
  let href = `http://127.0.0.1:10001${pagePath}`;
  if (options.project) href += `?project=${PROJECT_ID}`;
  if (options.lead) href += `?lead=${LEAD_ID}`;
  const location = { get href() { return href; }, get pathname() { return new URL(href).pathname; }, get search() { return new URL(href).search; }, get hash() { return new URL(href).hash; }, replace(value) { redirects.push(value); }, assign(value) { redirects.push(value); } };
  const window = { location, history: { replaceState(_state, _title, value) { href = new URL(value, href).href; } }, addEventListener(name, handler) { if (!events.has(name)) events.set(name, []); events.get(name).push(handler); } };
  const fetch = async (requestPath, request = {}) => {
    const method = request.method || 'GET';
    calls.push({ path: requestPath, method, headers: request.headers });
    if (requestPath === '/api/session' && state.failSession) throw new Error('Synthetic network failure');
    if (state.holdReads && requestPath !== '/api/session') return new Promise(() => {});
    let status = 200, data;
    if (requestPath === '/api/session') data = { user: { id: `user-${state.actor}`, username: `owner-${state.actor}`, businessId: `business-${state.actor}` }, csrfToken: `csrf-${state.actor}` };
    else if (requestPath === '/api/profile') data = { business: { id: `business-${state.actor}`, name: `Business ${state.actor}` }, version: 1, facts: {} };
    else if (requestPath === '/api/panel-ocr') data = { available: false, engine: 'tesseract', version: null, language: 'eng', reason: 'engine_unavailable' };
    else if (method !== 'GET' && state.mutationError) { status = 409; data = { error: state.mutationError }; }
    else if (requestPath === '/api/panel-projects') data = { projects: state.actor === 'A' ? [{ ...savedProject, rowCount: 0, unreviewedCount: 0 }] : [] };
    else if (requestPath === `/api/panel-projects/${PROJECT_ID}` && state.actor === 'A') data = { project: savedProject };
    else if (requestPath === '/api/leads') data = { leads: state.actor === 'A' ? [savedLead] : [] };
    else if (requestPath === `/api/leads/${LEAD_ID}` && state.actor === 'A') data = { lead: savedLead };
    else { status = 404; data = { error: { code: 'not_found', message: 'The record is not in this workspace.' } }; }
    return { status, ok: status >= 200 && status < 300, json: async () => structuredClone(data), headers: new Map() };
  };
  const source = fs.readFileSync(path.join(__dirname, '../workspace', script), 'utf8');
  const context = { document, window, location, URL, fetch, crypto: webcrypto, setTimeout, clearTimeout, Intl, Date, Blob, TextEncoder, console };
  if (options.failSession) state.failSession = true;
  vm.runInNewContext(source, context, { filename: script });
  return { element, state, calls, redirects, window };
}

async function settle() { for (let turn = 0; turn < 3; turn += 1) await new Promise(resolve => setImmediate(resolve)); }

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

