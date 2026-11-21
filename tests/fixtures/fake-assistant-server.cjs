'use strict';

// Isolated browser fixture only. No environment key or network adapter is read.
if (process.env.PANELREPLY_SYNTHETIC_ASSISTANT_TEST !== '1') throw new Error('This fixture requires explicit synthetic-test mode.');
const { startWorkspace } = require('../../workspace-server.cjs');
const { createFakeAssistantProvider } = require('../helpers/fake-assistant.cjs');
const workspace = startWorkspace(process.env, { conversationProvider: createFakeAssistantProvider({ delayMs: 300 }) });
process.once('SIGINT', workspace.close);
process.once('SIGTERM', workspace.close);
