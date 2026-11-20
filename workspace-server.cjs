'use strict';

const http = require('node:http');
const path = require('node:path');
const { openStore } = require('./workspace/store.cjs');
const { createWorkspaceApp, validateOrigin } = require('./workspace/api.cjs');

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

function startWorkspace(env = process.env, { conversationProvider = null, assistantConfiguration = null } = {}) {
  const config = workspaceConfig(env);
  if (conversationProvider && assistantConfiguration) throw new Error('Choose one explicit assistant configuration.');
  if (conversationProvider && (conversationProvider.kind !== 'fake' || typeof conversationProvider.generate !== 'function')) throw new Error('Use approved configuration for an external assistant.');
  const assistantOptions = require('./workspace/assistant-config.cjs').resolveAssistantConfiguration(assistantConfiguration);
  const store = openStore({ dataDir: config.dataDir });
  const ocr = require('./workspace/ocr.cjs').createOcrService();
  // Normal startup remains deterministic. An external adapter additionally
  // needs explicit approved configuration and durable bounded reservations.
  // Environment variables, profiles and browser input cannot activate it.
  const app = createWorkspaceApp({ store, origin: config.origin, conversationProvider, ...assistantOptions, recognizeImage: ocr.recognizeImage, getOcrStatus: ocr.getOcrStatus });
  const server = http.createServer({ maxHeaderSize: 16 * 1024, requestTimeout: 20000, headersTimeout: 10000, keepAliveTimeout: 5000 }, app.handler);
  let storeClosed = false;
  const closeStore = () => { if (!storeClosed) { storeClosed = true; store.close(); } };
  server.maxRequestsPerSocket = 100;
  server.on('error', () => {
    console.error('The private workspace could not listen on its configured loopback address.');
    close();
    process.exitCode = 1;
  });
  server.listen(config.port, config.host, () => console.log('Private workspace listening at ' + config.origin + '. Assistant mode: ' + (assistantOptions.allowExternalProvider ? 'approved external' : conversationProvider ? 'synthetic' : 'deterministic') + '. Booking is disabled.'));
  let closePromise = null;
  const close = () => {
    if (closePromise) return closePromise;
    app.close();
    const serverClosed = new Promise(resolve => server.close(resolve));
    server.closeIdleConnections();
    const deadline = setTimeout(() => server.closeAllConnections(), 5000);
    deadline.unref();
    closePromise = Promise.all([serverClosed, ocr.shutdown()]).finally(() => {
      clearTimeout(deadline);
      closeStore();
    });
    return closePromise;
  };
  return { server, store, config, close };
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

module.exports = { workspaceConfig, startWorkspace };
