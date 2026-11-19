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

function startWorkspace(env = process.env) {
  const config = workspaceConfig(env);
  const store = openStore({ dataDir: config.dataDir });
  const app = createWorkspaceApp({ store, origin: config.origin });
  const server = http.createServer({ maxHeaderSize: 16 * 1024, requestTimeout: 20000, headersTimeout: 10000, keepAliveTimeout: 5000 }, app.handler);
  let storeClosed = false;
  const closeStore = () => { if (!storeClosed) { storeClosed = true; store.close(); } };
  server.maxRequestsPerSocket = 100;
  server.on('error', () => {
    console.error('The private workspace could not listen on its configured loopback address.');
    closeStore();
    process.exitCode = 1;
  });
  server.listen(config.port, config.host, () => console.log('Private workspace listening at ' + config.origin + '. AI and booking are disabled.'));
  let closing = false;
  const close = () => {
    if (closing) return;
    closing = true;
    server.close(closeStore);
    server.closeIdleConnections();
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
