'use strict';

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
  const state = { actor: 'A', failSession: false, mutationError: null, holdReads: false, respond: options.respond || null };
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
  element('save-lead').textContent = 'Save changes';
  const pagePath = script === 'panels.js' ? '/panels' : script === 'dashboard.js' ? '/dashboard' : '/';
  let href = `http://127.0.0.1:10001${pagePath}`;
  if (options.project) href += `?project=${PROJECT_ID}`;
  if (options.lead) href += `?lead=${typeof options.lead === 'string' ? options.lead : LEAD_ID}`;
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
  return { element, state, calls, redirects, window, document, events };
}

async function settle() { for (let turn = 0; turn < 3; turn += 1) await new Promise(resolve => setImmediate(resolve)); }


module.exports = { client, settle, savedProject, savedLead, PROJECT_ID, LEAD_ID, TIME };
