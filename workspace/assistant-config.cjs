'use strict';

// Preparation only. Neither importing this module nor normal server startup
// selects a model, reads a credential or constructs a network transport.
const { createResponsesProvider } = require('./assistant-provider.cjs');
const { validateUsagePolicy } = require('./usage.cjs');
const approvedConfigurations = new WeakSet();

function prepareExternalAssistant({ authorizationConfirmed = false, dataTransferApproved = false, apiKey, model, fetchImpl, usagePolicy, timeoutMs = 6000 } = {}) {
  if (authorizationConfirmed !== true || dataTransferApproved !== true) throw new Error('Provider execution and data transfer require explicit owner approval.');
  const policy = validateUsagePolicy(usagePolicy, { external: true });
  const configuration = Object.freeze({
    conversationProvider: createResponsesProvider({ authorizationConfirmed, apiKey, model, fetchImpl, timeoutMs }),
    allowExternalProvider: true,
    assistantUsagePolicy: policy
  });
  approvedConfigurations.add(configuration);
  return configuration;
}

function resolveAssistantConfiguration(configuration) {
  if (configuration === null || configuration === undefined) return {};
  if (!approvedConfigurations.has(configuration)) throw new Error('Use the explicit approved assistant configuration procedure.');
  return configuration;
}

module.exports = { prepareExternalAssistant, resolveAssistantConfiguration };
