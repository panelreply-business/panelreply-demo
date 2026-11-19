'use strict';

// Disabled unless an approved caller supplies configuration AND a transport.
// This module never reads process.env, files, credentials or global fetch.
const { PreviewError, validateState, previewMessage } = require('./conversation.cjs');
const { providerInput, parseOutput, OUTPUT_SCHEMA, CONTRACT_VERSION } = require('./assistant.cjs');

const ENDPOINT = 'https://api.openai.com/v1/responses';
const MAX_RESPONSE_BYTES = 128 * 1024;
const MAX_REQUEST_BYTES = 128 * 1024;
function problem(code, status = 502) {
  return new PreviewError(status, code, 'The assisted provider request could not complete. Review the draft fields or try again.');
}
function compatibleSchema(value) {
  if (Array.isArray(value)) return value.map(compatibleSchema);
  if (!value || typeof value !== 'object') return value;
  // These are enforced independently by parseOutput. Omit optional constraints
  // not shared by all approved Structured Outputs model variants.
  return Object.fromEntries(Object.entries(value).filter(([key]) => !['uniqueItems', 'maxLength'].includes(key)).map(([key, entry]) => [key, compatibleSchema(entry)]));
}
function normalizeContext(context) {
  try {
    if (!context || context.contractVersion !== CONTRACT_VERSION || !context.data) throw new Error('version');
    const { data } = context;
    const state = validateState({ ...data.fields, issues: data.clarificationFields, conversation: data.history });
    previewMessage(data.message, state, {}); // Same input and transcript bounds.
    return { context: providerInput(data.message, state, { facts: data.approvedBusinessFacts }), state };
  } catch (_) { throw problem('invalid_assistant_context', 400); }
}
function responseText(body) {
  if (!body || body.status !== 'completed' || body.error || body.incomplete_details || !Array.isArray(body.output) || !body.output.length || body.output.length > 16) throw problem('invalid_assistant_output');
  const texts = [];
  for (const item of body.output) {
    if (item?.type === 'reasoning') continue;
    if (item?.type !== 'message' || item.role !== 'assistant' || (item.status !== undefined && item.status !== 'completed') || !Array.isArray(item.content) || !item.content.length || item.content.length > 8) throw problem('invalid_assistant_output');
    for (const part of item.content) {
      if (part?.type !== 'output_text' || typeof part.text !== 'string') throw problem('invalid_assistant_output');
      texts.push(part.text);
    }
  }
  const value = texts.join('');
  if (!value.trim() || Buffer.byteLength(value) > 16 * 1024) throw problem('invalid_assistant_output');
  return value;
}

function createResponsesProvider({ authorizationConfirmed = false, apiKey, model, fetchImpl, timeoutMs = 6000 } = {}) {
  if (authorizationConfirmed !== true) throw new Error('External provider configuration requires owner approval.');
  if (typeof apiKey !== 'string' || apiKey.length < 20 || apiKey.length > 512 || /\s|[\u0000-\u001f\u007f]/.test(apiKey)
    || typeof model !== 'string' || !/^[a-zA-Z0-9._:-]{1,100}$/.test(model)
    || typeof fetchImpl !== 'function' || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 15000) throw new Error('Provider configuration is incomplete or invalid.');
  async function generate(untrustedContext, { signal } = {}) {
    if (signal?.aborted) throw problem('assistant_cancelled', 409);
    const { context, state } = normalizeContext(untrustedContext);
    const body = JSON.stringify({
      model, store: false, stream: false, service_tier: 'default', max_output_tokens: 2048,
      input: [{ role: 'system', content: context.instructions }, { role: 'user', content: JSON.stringify(context.data) }],
      text: { format: { type: 'json_schema', name: 'panelreply_assistant_v1', strict: true, schema: compatibleSchema(OUTPUT_SCHEMA) } }
    });
    if (Buffer.byteLength(body) > MAX_REQUEST_BYTES) throw problem('invalid_assistant_context', 400);
    const controller = new AbortController();
    let rejectAbort, reader, responseBody, timer, abortCode, finished = false;
    const interrupted = new Promise((_, reject) => { rejectAbort = reject; });
    const abort = code => { abortCode = code; controller.abort(); rejectAbort(problem(code, code === 'assistant_timeout' ? 504 : 409)); };
    const onAbort = () => abort('assistant_cancelled');
    signal?.addEventListener('abort', onAbort, { once: true });
    timer = setTimeout(() => abort('assistant_timeout'), timeoutMs);
    try {
      const extraction = await Promise.race([(async () => {
        if (signal?.aborted || controller.signal.aborted) throw problem('assistant_cancelled', 409);
        const response = await fetchImpl(ENDPOINT, { method: 'POST', redirect: 'error', signal: controller.signal,
          headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json', Accept: 'application/json' }, body });
        responseBody = response?.body;
        // A nonconforming injected transport may resolve after the timeout's
        // outer finally ran. Cancel its newly arrived body before acquiring a
        // reader, otherwise this late stream would escape cleanup.
        if (controller.signal.aborted) {
          if (responseBody?.cancel) void responseBody.cancel().catch(() => {});
          throw problem(abortCode || 'assistant_cancelled', abortCode === 'assistant_timeout' ? 504 : 409);
        }
        if (!response || response.status !== 200 || !response.ok || response.redirected || (response.url && response.url !== ENDPOINT)) {
          if (response?.body?.cancel) void response.body.cancel().catch(() => {});
          throw problem('assistant_unavailable');
        }
        const contentType = response.headers?.get('content-type') || '';
        if (!/^application\/json(?:\s*;|\s*$)/i.test(contentType)) throw problem('invalid_assistant_output');
        const declared = response.headers.get('content-length');
        if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > MAX_RESPONSE_BYTES)) throw problem('invalid_assistant_output');
        const encoding = (response.headers.get('content-encoding') || 'identity').trim().toLowerCase();
        if (!['identity', 'gzip', 'br', 'deflate'].includes(encoding)) throw problem('invalid_assistant_output');
        if (!response.body || typeof response.body.getReader !== 'function') throw problem('invalid_assistant_output');
        reader = response.body.getReader();
        const chunks = []; let length = 0;
        while (true) {
          if (controller.signal.aborted) throw problem('assistant_cancelled', 409);
          const part = await reader.read();
          if (part.done) break;
          if (!(part.value instanceof Uint8Array)) throw problem('invalid_assistant_output');
          length += part.value.byteLength;
          if (length > MAX_RESPONSE_BYTES) throw problem('invalid_assistant_output');
          chunks.push(part.value);
        }
        // Fetch returns decoded bytes. Content-Length refers to wire bytes for
        // compressed responses. The decoded byte cap above applies in all cases.
        if (declared !== null && encoding === 'identity' && Number(declared) !== length) throw problem('invalid_assistant_output');
        let parsed;
        try { parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); }
        catch (_) { throw problem('invalid_assistant_output'); }
        const proposal = responseText(parsed);
        return parseOutput(proposal, context.data.message, state);
      })(), interrupted]);
      finished = true;
      return extraction;
    } catch (error) {
      if (abortCode) throw problem(abortCode, abortCode === 'assistant_timeout' ? 504 : 409);
      if (error instanceof PreviewError) throw error;
      throw problem('assistant_unavailable');
    } finally {
      clearTimeout(timer); signal?.removeEventListener('abort', onAbort);
      if (!finished) controller.abort();
      if (reader) {
        if (!finished) void reader.cancel().catch(() => {});
        try { reader.releaseLock(); } catch (_) { /* Abort may still be unwinding the stream. */ }
      } else if (!finished && responseBody?.cancel) void responseBody.cancel().catch(() => {});
    }
  }
  return Object.freeze({ kind: 'external', generate });
}

module.exports = { createResponsesProvider, ENDPOINT, MAX_RESPONSE_BYTES };
