'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { EventEmitter } = require('node:events');
const { spawnSync } = require('node:child_process');
const { openStore } = require('../workspace/store.cjs');
const { MARKER, bindProductDirectory, readProductBinding, openProductStore } = require('../workspace/products.cjs');
const { callbackConfig, startCallback, initializeCallback } = require('../callback-server.cjs');
const { spreadsheetConfig, startSpreadsheet, initializeSpreadsheet } = require('../spreadsheet-server.cjs');
const { startWorkspace } = require('../workspace-server.cjs');
const { createWorkspaceApp } = require('../workspace/api.cjs');

function root(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'panelreply-product-config-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}
const products = [
  { id: 'callback', prefix: 'CALLBACK', port: 10001, config: callbackConfig, start: startCallback, initialize: initializeCallback, entry: 'callback-server.cjs' },
  { id: 'spreadsheet', prefix: 'SPREADSHEET', port: 10002, config: spreadsheetConfig, start: startSpreadsheet, initialize: initializeSpreadsheet, entry: 'spreadsheet-server.cjs' }
];
for (const product of products) {
  test(`PROD.config.${product.id}.fixed | fixed entrypoint ignores generic and competing product selectors`, () => {
    const dataDir = path.join(os.tmpdir(), 'synthetic-' + product.id);
    const env = { [product.prefix + '_DATA_DIR']: dataDir, WORKSPACE_DATA_DIR: '/must-not-use', PORT: '12345',
      WORKSPACE_ORIGIN: 'https://must-not-use.example.test', PRODUCT: 'combined', WORKSPACE_PRODUCT: 'combined' };
    assert.deepEqual(product.config(env), { product: product.id, port: product.port, origin: 'http://127.0.0.1:' + product.port, host: '127.0.0.1', dataDir });
    assert.throws(() => product.config({ WORKSPACE_DATA_DIR: dataDir, PORT: '10003' }), new RegExp(product.prefix + '_DATA_DIR'));
  });
  for (const value of ['0', '65536', '-1', '1.5', '1e3', '', ' 10001 ', 10001]) {
    test(`PROD.config.${product.id}.port-${JSON.stringify(value)} | invalid product port is rejected`, () => {
      assert.throws(() => product.config({ [product.prefix + '_DATA_DIR']: '/synthetic/private', [product.prefix + '_PORT']: value }), /PORT/);
    });
  }
  for (const origin of ['http://0.0.0.0:10003', 'http://127.0.0.1:10004', 'https://127.0.0.1:10003',
    'https://public.example.test', 'http://127.0.0.1:10003/path', 'http://127.0.0.1:10003?product=combined']) {
    test(`PROD.config.${product.id}.origin-${origin} | exact loopback origin restriction remains enforced`, () => {
      assert.throws(() => product.config({ [product.prefix + '_DATA_DIR']: '/synthetic/private', [product.prefix + '_PORT']: '10003', [product.prefix + '_ORIGIN']: origin }));
    });
  }
  test(`PROD.init.${product.id} | initialize binds a fresh folder without starting a listener`, t => {
    const dataDir = path.join(root(t), product.id);
    const result = product.initialize({ [product.prefix + '_DATA_DIR']: dataDir });
    assert.deepEqual(result, { product: product.id, dataDir, origin: 'http://127.0.0.1:' + product.port, initialized: true });
    assert.deepEqual(readProductBinding(dataDir), { format: 'panelreply-product-binding', version: 1, product: product.id });
    assert.equal(fs.statSync(dataDir).mode & 0o777, 0o700); assert.equal(fs.statSync(path.join(dataDir, MARKER)).mode & 0o777, 0o600);
    const marker = fs.readFileSync(path.join(dataDir, MARKER));
    const store = openProductStore({ product: product.id, dataDir, create: false }); store.close();
    assert.deepEqual(fs.readFileSync(path.join(dataDir, MARKER)), marker);
  });
  test(`PROD.init.${product.id}.cli | CLI initialization preserves its fixed product despite external selectors`, t => {
    const dataDir = path.join(root(t), product.id);
    const result = spawnSync(process.execPath, [path.join(__dirname, '..', product.entry), '--init'], {
      env: { ...process.env, [product.prefix + '_DATA_DIR']: dataDir, PRODUCT: 'combined', WORKSPACE_PRODUCT: 'combined' }, encoding: 'utf8', timeout: 10000
    });
    assert.equal(result.status, 0, result.stderr); assert.equal(JSON.parse(result.stdout).product, product.id);
    assert.equal(readProductBinding(dataDir).product, product.id);
  });
  test(`PROD.storage.${product.id}.mismatch | a product cannot open or reassign the other product's data`, t => {
    const dataDir = path.join(root(t), product.id);
    const store = openProductStore({ product: product.id, dataDir }); store.close();
    const before = fs.readFileSync(path.join(dataDir, 'workspace.sqlite'));
    const marker = fs.readFileSync(path.join(dataDir, MARKER));
    assert.throws(() => openProductStore({ product: product.id === 'callback' ? 'spreadsheet' : 'callback', dataDir }), /not bound/);
    assert.deepEqual(fs.readFileSync(path.join(dataDir, 'workspace.sqlite')), before);
    assert.deepEqual(fs.readFileSync(path.join(dataDir, MARKER)), marker);
  });
  test(`PROD.storage.${product.id}.legacy-harness | combined startup and direct API cannot adopt product data`, t => {
    const dataDir = path.join(root(t), product.id);
    const bound = openProductStore({ product: product.id, dataDir }); bound.close();
    const before = fs.readFileSync(path.join(dataDir, 'workspace.sqlite'));
    assert.throws(() => startWorkspace({ WORKSPACE_DATA_DIR: dataDir }), /combined integration harness/);
    // The generic store remains available to operator account/backup tools,
    // but cannot be used to bypass an API's product identity check.
    const operatorStore = openStore({ dataDir, create: false });
    try {
      assert.throws(() => createWorkspaceApp({ store: operatorStore, origin: 'http://127.0.0.1:10001' }), /API product must match/);
      assert.throws(() => createWorkspaceApp({ store: operatorStore, origin: 'http://127.0.0.1:10001', product: product.id === 'callback' ? 'spreadsheet' : 'callback' }), /API product must match/);
    } finally { operatorStore.close(); }
    assert.deepEqual(fs.readFileSync(path.join(dataDir, 'workspace.sqlite')), before);
  });
  test(`PROD.storage.${product.id}.immutable | the opened store product cannot be reassigned`, t => {
    const dataDir = path.join(root(t), product.id), store = openProductStore({ product: product.id, dataDir });
    try {
      assert.equal(store.product, product.id);
      assert.throws(() => { store.product = 'combined'; }, TypeError);
      assert.throws(() => createWorkspaceApp({ store, origin: 'http://127.0.0.1:10001', product: 'combined' }), /different product/);
    } finally { store.close(); }
  });
  test(`PROD.storage.${product.id}.legacy | unmarked existing data is preserved and never adopted`, t => {
    const dataDir = path.join(root(t), product.id);
    const store = openStore({ dataDir }); store.close();
    const before = fs.readFileSync(path.join(dataDir, 'workspace.sqlite'));
    assert.equal(readProductBinding(dataDir), null);
    assert.throws(() => openProductStore({ product: product.id, dataDir }), /unmarked nonempty/);
    assert.deepEqual(fs.readFileSync(path.join(dataDir, 'workspace.sqlite')), before);
    assert.equal(fs.existsSync(path.join(dataDir, MARKER)), false);
  });
  test(`PROD.storage.${product.id}.linked | linked data locations and binding files remain refused`, t => {
    const base = root(t), dataDir = path.join(base, 'data'), link = path.join(base, 'linked');
    bindProductDirectory(dataDir, product.id); fs.symlinkSync(dataDir, link);
    assert.throws(() => bindProductDirectory(link, product.id), /symbolic/);
    const marker = path.join(dataDir, MARKER), outside = path.join(base, 'marker-copy');
    fs.renameSync(marker, outside); fs.symlinkSync(outside, marker);
    assert.throws(() => bindProductDirectory(dataDir, product.id), /symbolic/);
  });
  for (const invalid of ['broken-json', 'wrong-format', 'wrong-version', 'unknown-product', 'extra-field', 'over-bound', 'unsafe-permissions']) {
    test(`PROD.storage.${product.id}.${invalid} | invalid product binding is not repaired or overwritten`, t => {
      const dataDir = path.join(root(t), product.id); fs.mkdirSync(dataDir, { mode: 0o700 });
      const marker = path.join(dataDir, MARKER);
      let binding = { format: 'panelreply-product-binding', version: 1, product: product.id };
      if (invalid === 'wrong-format') binding.format = 'other';
      if (invalid === 'wrong-version') binding.version = 2;
      if (invalid === 'unknown-product') binding.product = 'combined';
      if (invalid === 'extra-field') binding.override = true;
      const raw = invalid === 'broken-json' ? '{' : invalid === 'over-bound' ? 'x'.repeat(1025) : JSON.stringify(binding);
      fs.writeFileSync(marker, raw, { mode: invalid === 'unsafe-permissions' ? 0o644 : 0o600 });
      assert.throws(() => bindProductDirectory(dataDir, product.id));
      assert.equal(fs.readFileSync(marker, 'utf8'), raw); assert.equal(fs.existsSync(path.join(dataDir, 'workspace.sqlite')), false);
    });
  }
}

for (const product of products) test(`PROD.start.${product.id} | only the selected product worker is initialized`, async t => {
  const dataDir = path.join(root(t), product.id);
  const ocr = require('../workspace/ocr.cjs'), assistant = require('../workspace/assistant.cjs');
  const originalServer = http.createServer, originalOcr = ocr.createOcrService, originalAssistant = assistant.createConversationOrchestrator;
  let ocrCreated = 0, ocrClosed = 0, assistantCreated = 0, bound, ocrOptions;
  class FakeServer extends EventEmitter {
    listen(port, host) { bound = { port, host }; }
    close(callback) { callback(); }
    closeIdleConnections() {}
    closeAllConnections() {}
  }
  http.createServer = () => new FakeServer();
  ocr.createOcrService = options => { ocrCreated++; ocrOptions = options; return { recognizeImage() { throw new Error('must not run'); }, getOcrStatus() { throw new Error('must not run'); }, shutdown: async () => { ocrClosed++; } }; };
  assistant.createConversationOrchestrator = options => { assistantCreated++; return originalAssistant(options); };
  t.after(() => { http.createServer = originalServer; ocr.createOcrService = originalOcr; assistant.createConversationOrchestrator = originalAssistant; });
  const running = product.start({ [product.prefix + '_DATA_DIR']: dataDir, PRODUCT: product.id === 'callback' ? 'spreadsheet' : 'callback' }, { product: 'combined' });
  try {
    assert.equal(running.config.product, product.id); assert.deepEqual(bound, { port: product.port, host: '127.0.0.1' });
    assert.equal(ocrCreated, product.id === 'spreadsheet' ? 1 : 0);
    assert.deepEqual(ocrOptions, product.id === 'spreadsheet' ? { privateDataDir: path.dirname(running.store.filename) } : undefined);
    assert.equal(assistantCreated, product.id === 'callback' ? 1 : 0);
  } finally { await running.close(); }
  assert.equal(ocrClosed, ocrCreated);
});

test('PROD.api.unbound | explicit product APIs refuse an unmarked real store', t => {
  const store = openStore({ dataDir: path.join(root(t), 'legacy') });
  try {
    for (const product of ['callback', 'spreadsheet']) assert.throws(() => createWorkspaceApp({ store, origin: 'http://127.0.0.1:10001', product }), /API product must match/);
  } finally { store.close(); }
});

test('PROD.start.spreadsheet.provider | assistant options fail before storage is initialized', t => {
  const dataDir = path.join(root(t), 'must-remain-absent');
  assert.throws(() => startSpreadsheet({ SPREADSHEET_DATA_DIR: dataDir }, { conversationProvider: { kind: 'fake', generate() {} } }), /cannot activate callback/);
  assert.equal(fs.existsSync(dataDir), false);
});
