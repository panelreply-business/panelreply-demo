'use strict';

// Product identity is a trusted startup choice. Request headers, query strings,
// browser state and environment switches never change an app's fixed product.
const fs = require('node:fs');
const path = require('node:path');
const { assertPrivateDirectory, assertPrivateRegularFile } = require('./file-safety.cjs');

const MARKER = 'product-binding.json';
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const LEAD = new RegExp('^/api/leads/' + UUID + '$');
const CONVERSATION = new RegExp('^/api/leads/' + UUID + '/conversation$');
const LEAD_TASKS = new RegExp('^/api/leads/' + UUID + '/tasks$');
const CALLBACK_TASK = new RegExp('^/api/callback-tasks/' + UUID + '$');
const PANEL = new RegExp('^/api/panel-projects/' + UUID + '$');
const EXPORT = new RegExp('^/api/panel-projects/' + UUID + '/export\\.(?:csv|xlsx)$');
const SOURCES = new RegExp('^/api/panel-projects/' + UUID + '/sources$');
const SOURCE = new RegExp('^/api/panel-projects/' + UUID + '/sources/' + UUID + '$');
const OCR = new RegExp('^/api/panel-projects/' + UUID + '/sources/' + UUID + '/ocr$');
const SHARED_ASSETS = Object.freeze(['/assets/styles.css', '/assets/platform.css', '/assets/login.js',
  '/assets/deletion.js', '/assets/brand-mark.svg', '/assets/brand-mark-light.svg']);
const liveCapabilities = { liveCalls: false, liveMessages: false, booking: false };
const PRODUCTS = Object.freeze({
  combined: Object.freeze({ id: 'combined', label: 'PanelReply internal integration harness', homePath: '/',
    envPrefix: null, defaultPort: 10001, cookieStem: 'PanelReply',
    capabilities: Object.freeze({ intake: true, businessFacts: true, assistantUsage: true, callbackScheduling: true,
      panelProjects: true, ocr: true, csvExport: true, xlsxExport: true, ...liveCapabilities }) }),
  callback: Object.freeze({ id: 'callback', label: 'PanelReply Callback', homePath: '/',
    envPrefix: 'CALLBACK', defaultPort: 10001, cookieStem: 'PanelReplyCallback',
    capabilities: Object.freeze({ intake: true, businessFacts: true, assistantUsage: true, callbackScheduling: true,
      panelProjects: false, ocr: false, csvExport: false, xlsxExport: false, ...liveCapabilities }) }),
  spreadsheet: Object.freeze({ id: 'spreadsheet', label: 'PanelReply Spreadsheets', homePath: '/panels',
    envPrefix: 'SPREADSHEET', defaultPort: 10002, cookieStem: 'PanelReplySpreadsheet',
    capabilities: Object.freeze({ intake: false, businessFacts: false, assistantUsage: false, callbackScheduling: false,
      panelProjects: true, ocr: true, csvExport: true, xlsxExport: true, ...liveCapabilities }) })
});

function productDefinition(id = 'combined') {
  if (typeof id !== 'string' || !Object.hasOwn(PRODUCTS, id)) throw new Error('Use a supported, explicit workspace product.');
  return PRODUCTS[id];
}
function separatedProduct(id) {
  const product = productDefinition(id);
  if (product.id === 'combined') throw new Error('The combined workspace is an internal integration harness, not a release product.');
  return product;
}
function productMetadata(id) {
  const { id: product, label, homePath, capabilities } = productDefinition(id);
  return Object.freeze({ id: product, label, homePath, capabilities });
}
function productBinding(id) {
  const product = separatedProduct(id);
  return Object.freeze({ format: 'panelreply-product-binding', version: 1, product: product.id });
}
function productCookieName(id, secure) {
  const { cookieStem } = productDefinition(id);
  return secure ? '__Host-' + cookieStem + 'Session' : cookieStem + 'LocalSession';
}
function allowsProductRoute(id, route, method) {
  const product = productDefinition(id);
  if (product.id === 'combined') return true;
  const read = method === 'GET' || method === 'HEAD';
  if (read && ['/health', '/favicon.ico', '/login', ...SHARED_ASSETS].includes(route)) return true;
  if ((route === '/api/login' || route === '/api/logout') && method === 'POST') return true;
  if (route === '/api/session' && method === 'GET') return true;
  if (product.id === 'callback') {
    if (read && ['/', '/preview', '/assets/app.js', '/assets/preview.js', '/assets/schedule.js'].includes(route)) return true;
    if (method === 'GET' && ['/api/assistant', '/api/assistant/usage', '/api/profile', '/api/leads', '/api/export'].includes(route)) return true;
    if (route === '/api/profile' && method === 'PATCH') return true;
    if (['/api/leads', '/api/preview'].includes(route) && method === 'POST') return true;
    if (LEAD.test(route) && ['GET', 'PATCH', 'DELETE'].includes(method)) return true;
    if (route === '/api/callback-tasks' && method === 'GET') return true;
    if (LEAD_TASKS.test(route) && method === 'POST') return true;
    if (CALLBACK_TASK.test(route) && method === 'PATCH') return true;
    return CONVERSATION.test(route) && method === 'DELETE';
  }
  if (read && ['/', '/panels', '/assets/panels.js'].includes(route)) return true;
  if (route === '/api/panel-projects' && ['GET', 'POST'].includes(method)) return true;
  if (route === '/api/panel-ocr' && method === 'GET') return true;
  if (PANEL.test(route) && ['GET', 'PATCH', 'DELETE'].includes(method)) return true;
  if (EXPORT.test(route) && method === 'GET') return true;
  if (SOURCES.test(route) && method === 'POST') return true;
  if (SOURCE.test(route) && ['GET', 'DELETE'].includes(method)) return true;
  return OCR.test(route) && method === 'POST';
}

function readBinding(filename, expected) {
  const marker = assertPrivateRegularFile(filename);
  if (fs.statSync(marker).size > 1024) throw new Error('The product binding is invalid. Preserve this directory for operator review.');
  let binding;
  try { binding = JSON.parse(fs.readFileSync(marker, 'utf8')); }
  catch (_) { throw new Error('The product binding is invalid. Preserve this directory for operator review.'); }
  if (!binding || typeof binding !== 'object' || Array.isArray(binding)
    || Object.keys(binding).length !== 3 || binding.format !== 'panelreply-product-binding'
    || binding.version !== 1 || !['callback', 'spreadsheet'].includes(binding.product)
    || (expected !== undefined && binding.product !== expected)) {
    throw new Error('This data directory is not bound to the requested product. Existing data was not migrated or reassigned.');
  }
  return productBinding(binding.product);
}
function readProductBinding(dataDir) {
  const directory = assertPrivateDirectory(dataDir);
  const marker = path.join(directory, MARKER);
  try { fs.lstatSync(marker); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  return readBinding(marker);
}
function bindProductDirectory(dataDir, id) {
  const product = separatedProduct(id);
  const directory = assertPrivateDirectory(dataDir, { create: true });
  const marker = path.join(directory, MARKER);
  const contents = fs.readdirSync(directory);
  if (contents.includes(MARKER)) {
    readBinding(marker, product.id);
    return directory;
  }
  if (contents.length) throw new Error('An unmarked nonempty data directory cannot be adopted. Initialize a fresh product directory; existing data needs a reviewed migration or restore procedure.');
  let descriptor;
  try {
    descriptor = fs.openSync(marker, 'wx', 0o600);
    fs.writeFileSync(descriptor, JSON.stringify(productBinding(product.id)) + '\n');
    fs.fsyncSync(descriptor);
  } catch (error) {
    // Simultaneous starts cannot assign the same fresh folder to two products.
    // An incomplete competing marker fails closed and is never overwritten.
    if (error.code !== 'EEXIST') throw error;
  } finally { if (descriptor !== undefined) fs.closeSync(descriptor); }
  readBinding(marker, product.id);
  return directory;
}
function openProductStore({ product, dataDir, ...options }) {
  const directory = bindProductDirectory(dataDir, product);
  const store = require('./store.cjs').openStore({ ...options, dataDir: directory });
  Object.defineProperty(store, 'product', { value: separatedProduct(product).id, enumerable: true, writable: false, configurable: false });
  return store;
}
function openIntegrationStore({ dataDir, ...options }) {
  const directory = assertPrivateDirectory(dataDir, { create: true });
  if (readProductBinding(directory)) throw new Error('The combined integration harness cannot open a product-bound data directory.');
  const store = require('./store.cjs').openStore({ ...options, dataDir: directory });
  Object.defineProperty(store, 'product', { value: 'combined', enumerable: true, writable: false, configurable: false });
  return store;
}
function assertStoreProduct(store, id) {
  const product = productDefinition(id);
  if (store.product !== undefined && store.product !== product.id) throw new Error('The workspace store belongs to a different product.');
  // Component-only test doubles have no filename. Every real SQLite-backed
  // API must honor the on-disk identity, including generic operator-tool stores.
  if (store.filename !== undefined) {
    if (typeof store.filename !== 'string' || !path.isAbsolute(store.filename)) throw new Error('Use a valid private workspace store.');
    const binding = readProductBinding(path.dirname(store.filename));
    if (product.id === 'combined' ? binding !== null : binding?.product !== product.id) {
      throw new Error('The API product must match its data binding. The combined integration harness cannot adopt product data.');
    }
  }
}

module.exports = { MARKER, productDefinition, separatedProduct, productMetadata, productBinding,
  productCookieName, allowsProductRoute, readProductBinding, bindProductDirectory, openProductStore,
  openIntegrationStore, assertStoreProduct };
