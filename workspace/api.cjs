'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { createAuth } = require('./auth.cjs');
const { StoreError, object, normalizePhone } = require('./store.cjs');
const { PreviewError } = require('./conversation.cjs');
const intake = require('../src/intake.js');

// Accommodates valid bounded transcripts even when JSON escapes Unicode.
const MAX_BODY_BYTES = 192 * 1024;
const ROOT = path.resolve(__dirname, '..');
const ASSETS = Object.freeze({
  '/assets/styles.css': ['workspace/styles.css', 'text/css; charset=utf-8'],
  '/assets/app.js': ['workspace/app.js', 'application/javascript; charset=utf-8'],
  '/assets/preview.js': ['workspace/preview.js', 'application/javascript; charset=utf-8'],
  '/assets/login.js': ['workspace/login.js', 'application/javascript; charset=utf-8']
});
const BASE_HEADERS = Object.freeze({
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex, nofollow',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; font-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; object-src 'none'"
});

function validateOrigin(origin) {
  if (typeof origin !== 'string') throw new Error('An exact workspace origin is required.');
  let parsed;
  try { parsed = new URL(origin); } catch (_) { throw new Error('An exact workspace origin is required.'); }
  const local = ['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname);
  if (parsed.origin !== origin || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash || (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && local))) throw new Error('Use an exact HTTPS or loopback HTTP workspace origin.');
  return parsed;
}

async function readJson(req) {
  if (typeof req.headers['content-type'] !== 'string' || !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers['content-type'])) throw new StoreError(415, 'json_required', 'Send application/json.');
  if (req.headers['content-encoding'] && req.headers['content-encoding'] !== 'identity') throw new StoreError(415, 'unsupported_encoding', 'Compressed request bodies are not supported.');
  const length = req.headers['content-length'];
  if (length !== undefined && (typeof length !== 'string' || !/^\d+$/.test(length))) throw new StoreError(400, 'invalid_length', 'The request length was not accepted.');
  if (length !== undefined && Number(length) > MAX_BODY_BYTES) throw new StoreError(413, 'body_too_large', 'The request is too large.');
  const chunks = []; let bytes = 0;
  try {
    // Keep the connection available long enough to return a bounded-body error.
    for await (const chunk of req.iterator({ destroyOnReturn: false })) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buffer.length;
      if (bytes > MAX_BODY_BYTES) throw new StoreError(413, 'body_too_large', 'The request is too large.');
      chunks.push(buffer);
    }
  } catch (error) {
    if (error instanceof StoreError) throw error;
    throw new StoreError(400, 'incomplete_body', 'The request body was interrupted. Try again.');
  }
  if (length !== undefined && Number(length) !== bytes) throw new StoreError(400, 'invalid_length', 'The request body was incomplete.');
  try {
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('object');
    return value;
  } catch (_) { throw new StoreError(400, 'invalid_json', 'Send a valid JSON object.'); }
}

function createWorkspaceApp({ store, origin, previewMessage } = {}) {
  if (!store) throw new Error('A workspace store is required.');
  const originUrl = validateOrigin(origin);
  const auth = createAuth(store, { secure: originUrl.protocol === 'https:' });
  function send(res, status, body, extra = {}, head = false) {
    const serialized = body === undefined ? '' : JSON.stringify(body);
    res.writeHead(status, { ...BASE_HEADERS, 'Content-Type': 'application/json; charset=utf-8', ...extra });
    res.end(head ? undefined : serialized);
  }
  async function staticFile(req, res, filename, type) {
    const content = await fs.readFile(path.join(ROOT, filename));
    res.writeHead(200, { ...BASE_HEADERS, 'Content-Type': type, 'Content-Length': content.length });
    res.end(req.method === 'HEAD' ? undefined : content);
  }
  function sessionRequired(req) {
    const session = auth.session(req);
    if (!session) throw new StoreError(401, 'unauthorized', 'Sign in to continue.');
    return session;
  }
  function mutationRequired(req, session) {
    if (req.headers.origin !== origin) throw new StoreError(403, 'origin_rejected', 'The request origin was not accepted.');
    if (session && !auth.verifyCsrf(session, req.headers['x-csrf-token'])) throw new StoreError(403, 'csrf_rejected', 'Refresh this page before saving.');
  }
  function knownPhone(state) {
    try { return normalizePhone(state && state.phone); } catch (_) { return null; }
  }
  async function handler(req, res) {
    try {
      if (typeof req.headers.host !== 'string' || req.headers.host.toLowerCase() !== originUrl.host) throw new StoreError(421, 'host_rejected', 'The request host was not accepted.');
      if (typeof req.url !== 'string' || !req.url.startsWith('/') || req.url.startsWith('//') || req.url.includes('\\') || req.url.length > 2048) throw new StoreError(400, 'invalid_path', 'The request path was not accepted.');
      // No path normalization or filesystem interpolation. Only exact routes are served.
      const route = req.url.split('?')[0];
      const read = req.method === 'GET' || req.method === 'HEAD';
      if (read && route === '/favicon.ico') return send(res, 204, undefined);
      if (read && route === '/health') return send(res, 200, { ok: true, mode: 'private-local', aiEnabled: false, bookingEnabled: false }, {}, req.method === 'HEAD');
      if (read && Object.hasOwn(ASSETS, route)) return await staticFile(req, res, ...ASSETS[route]);
      if (read && route === '/login') return await staticFile(req, res, 'workspace/login.html', 'text/html; charset=utf-8');
      if (read && ['/', '/preview'].includes(route)) {
        if (!auth.session(req)) {
          res.writeHead(303, { ...BASE_HEADERS, Location: '/login', 'Content-Type': 'text/plain; charset=utf-8' });
          return res.end();
        }
        return await staticFile(req, res, route === '/' ? 'workspace/index.html' : 'workspace/preview.html', 'text/html; charset=utf-8');
      }
      if (req.method === 'POST' && route === '/api/login') {
        mutationRequired(req);
        const input = object(await readJson(req), ['username', 'password']);
        if (typeof input.username !== 'string' || typeof input.password !== 'string' || input.username.length > 120 || input.password.length > 128) throw new StoreError(400, 'invalid_input', 'Check the username and password fields.');
        const session = await auth.login(input, req.socket && req.socket.remoteAddress || 'local');
        auth.logout(auth.session(req));
        return send(res, 200, { user: session.user, csrfToken: session.csrfToken }, { 'Set-Cookie': auth.cookie(session.token) });
      }
      if (!route.startsWith('/api/')) throw new StoreError(404, 'not_found', 'The page was not found.');
      const session = sessionRequired(req);
      if (req.method === 'GET' && route === '/api/session') return send(res, 200, { user: session.user, csrfToken: session.csrfToken });
      if (req.method === 'GET' && route === '/api/profile') return send(res, 200, store.getProfile(session.user));
      if (req.method === 'GET' && route === '/api/leads') return send(res, 200, { leads: store.listLeads(session.user) });
      const match = /^\/api\/leads\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/.exec(route);
      if (req.method === 'GET' && match) return send(res, 200, { lead: store.getLead(session.user, match[1]) });
      if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method)) mutationRequired(req, session);
      if (req.method === 'POST' && route === '/api/logout') {
        auth.logout(session);
        return send(res, 204, undefined, { 'Set-Cookie': auth.cookie('', true) });
      }
      if (req.method === 'PATCH' && route === '/api/profile') return send(res, 200, store.updateProfile(session.user, await readJson(req)));
      if (req.method === 'POST' && route === '/api/leads') {
        const result = store.createLead(session.user, await readJson(req), req.headers['idempotency-key']);
        return send(res, result.created ? 201 : 200, result);
      }
      if (req.method === 'PATCH' && match) return send(res, 200, { lead: store.updateLead(session.user, match[1], await readJson(req)) });
      if (req.method === 'POST' && route === '/api/preview') {
        const input = object(await readJson(req), ['message', 'state']);
        const profile = store.getProfile(session.user);
        let preview = previewMessage;
        if (!preview) {
          const conversation = require('./conversation.cjs');
          preview = conversation.previewMessage;
        }
        const phoneBefore = knownPhone(input.state);
        const wasSuppressed = !!phoneBefore && store.isSuppressed(session.user, phoneBefore);
        let result = await preview(input.message, input.state, profile, { suppressed: wasSuppressed });
        const phoneAfter = knownPhone(result.state);
        if (phoneAfter && !wasSuppressed && store.isSuppressed(session.user, phoneAfter)) result = await preview(input.message, input.state, profile, { suppressed: true });
        const resultingPhone = knownPhone(result.state);
        const optOutHistory = result.state.conversation.some(item => item.role === 'customer' && intake.isOptOut(item.text));
        if (resultingPhone && (result.state.stopped || optOutHistory)) store.suppressPhone(session.user, resultingPhone);
        if (resultingPhone && store.isSuppressed(session.user, resultingPhone) && !result.state.stopped) result = await preview(input.message, input.state, profile, { suppressed: true });
        return send(res, 200, result);
      }
      throw new StoreError(404, 'not_found', 'The requested operation was not found.');
    } catch (error) {
      if (res.writableEnded || res.destroyed) return;
      const expected = error instanceof StoreError || (typeof PreviewError === 'function' && error instanceof PreviewError);
      const status = expected ? error.status : 500;
      const detail = expected ? { code: error.code, message: error.message, ...(error.fields ? { fields: error.fields } : {}) } : { code: 'internal_error', message: 'The request could not be completed. Try again.' };
      const extra = status === 429 ? { 'Retry-After': '900' } : {};
      if (status === 413) { extra.Connection = 'close'; req.resume(); }
      return send(res, status, { error: detail }, extra);
    }
  }
  return { handler, auth };
}

module.exports = { createWorkspaceApp, validateOrigin, MAX_BODY_BYTES, readJson };
