'use strict';

const http = require('node:http');
const path = require('node:path');
const { createWorkspaceApp, validateOrigin } = require('./workspace/api.cjs');
const { productDefinition, separatedProduct, openProductStore, openIntegrationStore } = require('./workspace/products.cjs');

// Legacy combined mode is retained for the historical integration tests only.
// Callback and spreadsheet releases use their fixed entrypoints below.

function workspaceConfig(env = process.env) {
  const rawPort = env.PORT === undefined ? '10001' : env.PORT;
  if (typeof rawPort !== 'string' || !/^\d+$/.test(rawPort) || Number(rawPort) < 1 || Number(rawPort) > 65535) throw new Error('PORT must be a number from 1 to 65535.');
  const port = Number(rawPort);
  const origin = env.WORKSPACE_ORIGIN || new URL('http://127.0.0.1:' + port).origin;
  const parsed = validateOrigin(origin);
  if (parsed.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(parsed.hostname) || Number(parsed.port || 80) !== port) throw new Error('This development server requires a matching loopback HTTP WORKSPACE_ORIGIN.');
  if (typeof env.WORKSPACE_DATA_DIR !== 'string' || !path.isAbsolute(env.WORKSPACE_DATA_DIR)) throw new Error('Set an absolute, owner-only WORKSPACE_DATA_DIR before starting.');
  return { port, origin, host: '127.0.0.1', dataDir: env.WORKSPACE_DATA_DIR };
}

function separatedWorkspaceConfig(productId, env = process.env) {
  const product = separatedProduct(productId), prefix = product.envPrefix;
  const rawPort = env[prefix + '_PORT'] === undefined ? String(product.defaultPort) : env[prefix + '_PORT'];
  if (typeof rawPort !== 'string' || !/^\d+$/.test(rawPort) || Number(rawPort) < 1 || Number(rawPort) > 65535) throw new Error(prefix + '_PORT must be a number from 1 to 65535.');
  const port = Number(rawPort);
  const origin = env[prefix + '_ORIGIN'] || new URL('http://127.0.0.1:' + port).origin;
  const parsed = validateOrigin(origin);
  if (parsed.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(parsed.hostname) || Number(parsed.port || 80) !== port) throw new Error('This product requires a matching loopback HTTP ' + prefix + '_ORIGIN.');
  const dataDir = env[prefix + '_DATA_DIR'];
  if (typeof dataDir !== 'string' || !path.isAbsolute(dataDir)) throw new Error('Set an absolute, owner-only ' + prefix + '_DATA_DIR before starting.');
  return { product: product.id, port, origin, host: '127.0.0.1', dataDir };
}

function startConfiguredWorkspace(config, { conversationProvider = null, assistantConfiguration = null } = {}) {
  const product = productDefinition(config.product || 'combined');
  if (!product.capabilities.intake && (conversationProvider || assistantConfiguration)) throw new Error('The spreadsheet product cannot activate callback assistance.');
  if (conversationProvider && assistantConfiguration) throw new Error('Choose one explicit assistant configuration.');
  if (conversationProvider && (conversationProvider.kind !== 'fake' || typeof conversationProvider.generate !== 'function')) throw new Error('Use approved configuration for an external assistant.');
  const assistantOptions = require('./workspace/assistant-config.cjs').resolveAssistantConfiguration(assistantConfiguration);
  const store = product.id === 'combined' ? openIntegrationStore({ dataDir: config.dataDir }) : openProductStore({ product: product.id, dataDir: config.dataDir });
  let ocr = null, app;
  // Normal startup remains deterministic. An external adapter additionally
  // needs explicit approved configuration and durable bounded reservations.
  // Environment variables, profiles and browser input cannot activate it.
  try {
    if (product.capabilities.ocr) ocr = require('./workspace/ocr.cjs').createOcrService({ privateDataDir: path.dirname(store.filename) });
    app = createWorkspaceApp({ store, origin: config.origin, product: product.id, conversationProvider, ...assistantOptions,
      ...(ocr ? { recognizeImage: ocr.recognizeImage, getOcrStatus: ocr.getOcrStatus } : {}) });
  } catch (error) {
    if (ocr) ocr.shutdown().catch(() => {});
    store.close();
    throw error;
  }
  const server = http.createServer({ maxHeaderSize: 16 * 1024, requestTimeout: 20000, headersTimeout: 10000, keepAliveTimeout: 5000 }, app.handler);
  let storeClosed = false;
  const closeStore = () => { if (!storeClosed) { storeClosed = true; store.close(); } };
  server.maxRequestsPerSocket = 100;
  let closePromise = null;
  const close = () => {
    if (closePromise) return closePromise;
    app.close();
    const serverClosed = new Promise(resolve => server.close(resolve));
    server.closeIdleConnections();
    const deadline = setTimeout(() => server.closeAllConnections(), 5000);
    deadline.unref();
    closePromise = Promise.all([serverClosed, ocr ? ocr.shutdown() : Promise.resolve()]).finally(() => {
      clearTimeout(deadline);
      closeStore();
    });
    return closePromise;
  };
  server.on('error', () => {
    console.error('The private workspace could not listen on its configured loopback address.');
    close();
    process.exitCode = 1;
  });
  server.listen(config.port, config.host, () => console.log(product.label + ' listening at ' + config.origin + '. Assistant mode: '
    + (!product.capabilities.intake ? 'disabled' : assistantOptions.allowExternalProvider ? 'approved external' : conversationProvider ? 'synthetic' : 'deterministic') + '. Booking is disabled.'));
  return { server, store, config, close };
}

function startWorkspace(env = process.env, options = {}) {
  return startConfiguredWorkspace(workspaceConfig(env), options);
}
function startSeparatedWorkspace(product, env = process.env, options = {}) {
  return startConfiguredWorkspace(separatedWorkspaceConfig(product, env), options);
}
function initializeSeparatedWorkspace(product, env = process.env) {
  const config = separatedWorkspaceConfig(product, env);
  const store = openProductStore({ product: config.product, dataDir: config.dataDir });
  store.close();
  return { product: config.product, dataDir: config.dataDir, origin: config.origin, initialized: true };
}

if (require.main === module) {
  try {
    const workspace = startWorkspace();
    process.once('SIGINT', workspace.close);
    process.once('SIGTERM', workspace.close);
  } catch (error) {
    console.error(error && error.message || 'The private workspace could not start.');
    process.exitCode = 1;
  }
}

module.exports = { workspaceConfig, startWorkspace, separatedWorkspaceConfig, startSeparatedWorkspace, initializeSeparatedWorkspace };
