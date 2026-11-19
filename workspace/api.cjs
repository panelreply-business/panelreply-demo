'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { createAuth } = require('./auth.cjs');
const { StoreError, object, normalizePhone, FACT_KEYS } = require('./store.cjs');
const { PreviewError } = require('./conversation.cjs');
const intake = require('../src/intake.js');
const panels = require('./panels.cjs');

// Accommodates valid bounded transcripts even when JSON escapes Unicode.
const MAX_BODY_BYTES = 192 * 1024;
const MAX_PANEL_BODY_BYTES = 3 * 1024 * 1024;
const ROOT = path.resolve(__dirname, '..');
const ASSETS = Object.freeze({
  '/assets/styles.css': ['workspace/styles.css', 'text/css; charset=utf-8'],
  '/assets/app.js': ['workspace/app.js', 'application/javascript; charset=utf-8'],
  '/assets/preview.js': ['workspace/preview.js', 'application/javascript; charset=utf-8'],
  '/assets/login.js': ['workspace/login.js', 'application/javascript; charset=utf-8'],
  '/assets/panels.js': ['workspace/panels.js', 'application/javascript; charset=utf-8'],
  '/assets/dashboard.js': ['workspace/dashboard.js', 'application/javascript; charset=utf-8'],
  '/assets/platform.css': ['workspace/platform.css', 'text/css; charset=utf-8'],
  '/assets/brand-mark.svg': ['design-preview/mark.svg', 'image/svg+xml'],
  '/assets/brand-mark-light.svg': ['design-preview/mark-on-light.svg', 'image/svg+xml']
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
const EXPORTED_LEAD_FIELDS = Object.freeze(['id', 'version', 'createdAt', 'updatedAt', 'customerName', 'phone', 'job', 'zip', 'callbackWindow', 'requestedWorkDate', 'contactPermission', 'notes', 'status', 'safetyHold', 'optedOut', 'contactAllowed']);
const EXPORTED_CHANGE_FIELDS = Object.freeze(['customerName', 'phone', 'job', 'zip', 'callbackWindow', 'requestedWorkDate', 'contactPermission', 'notes', 'status', 'conversation']);

function businessExport(store, actor) {
  const { profile, leads } = store.exportBusiness(actor);
  // Keep the download contract independent of internal store additions. In
  // particular, accounts, password hashes, session tokens and counters have no
  // route into this export. It is a readable record copy, not a restore backup.
  return {
    format: 'panelreply-business-export', version: 1, exportedAt: new Date().toISOString(),
    profile: {
      business: { id: profile.business.id, name: profile.business.name }, version: profile.version,
      facts: Object.fromEntries(FACT_KEYS.map(key => [key, { verified: profile.facts[key].verified, answer: profile.facts[key].answer }]))
    },
    leads: leads.map(lead => ({
      ...Object.fromEntries(EXPORTED_LEAD_FIELDS.map(key => [key, lead[key]])),
      conversation: lead.conversation.map(entry => ({ role: entry.role, text: entry.text })),
      audit: lead.audit.map(entry => ({
        id: entry.id, actorId: entry.actorId, action: entry.action, version: entry.version, createdAt: entry.createdAt,
        details: {
          ...(Array.isArray(entry.details?.fields) ? { fields: entry.details.fields.filter(field => EXPORTED_CHANGE_FIELDS.includes(field)) } : {}),
          ...(Number.isSafeInteger(entry.details?.messageCount) ? { messageCount: entry.details.messageCount } : {}),
          ...(['preview', 'lead'].includes(entry.details?.source) ? { source: entry.details.source } : {})
        }
      }))
    }))
  };
}

function validateOrigin(origin) {
  if (typeof origin !== 'string') throw new Error('An exact workspace origin is required.');
  let parsed;
  try { parsed = new URL(origin); } catch (_) { throw new Error('An exact workspace origin is required.'); }
  const local = ['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname);
  if (parsed.origin !== origin || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash || (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && local))) throw new Error('Use an exact HTTPS or loopback HTTP workspace origin.');
  return parsed;
}

async function readJson(req, maxBytes = MAX_BODY_BYTES) {
  if (typeof req.headers['content-type'] !== 'string' || !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers['content-type'])) throw new StoreError(415, 'json_required', 'Send application/json.');
  if (req.headers['content-encoding'] && req.headers['content-encoding'] !== 'identity') throw new StoreError(415, 'unsupported_encoding', 'Compressed request bodies are not supported.');
  const length = req.headers['content-length'];
  if (length !== undefined && (typeof length !== 'string' || !/^\d+$/.test(length))) throw new StoreError(400, 'invalid_length', 'The request length was not accepted.');
  if (length !== undefined && Number(length) > maxBytes) throw new StoreError(413, 'body_too_large', 'The request is too large.');
  const chunks = []; let bytes = 0;
  try {
    // Keep the connection available long enough to return a bounded-body error.
    for await (const chunk of req.iterator({ destroyOnReturn: false })) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buffer.length;
      if (bytes > maxBytes) throw new StoreError(413, 'body_too_large', 'The request is too large.');
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

function createWorkspaceApp({ store, origin, previewMessage, conversationProvider = null, allowExternalProvider = false, recognizeImage, getOcrStatus } = {}) {
  if (!store) throw new Error('A workspace store is required.');
  const originUrl = validateOrigin(origin);
  const auth = createAuth(store, { secure: originUrl.protocol === 'https:' });
  const assistant = require('./assistant.cjs').createConversationOrchestrator({ provider: conversationProvider, allowExternal: allowExternalProvider });
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
    const pinnedSession = req.headers['x-workspace-session'];
    // A page can outlive its cookie when another tab signs into a different
    // business. Pin reads as well as writes to the page's original session.
    // Older clients remain compatible, while the browser includes this header
    // after bootstrap. The cookie is still required and no new token is issued.
    if (pinnedSession !== undefined && !auth.verifyCsrf(session, pinnedSession)) throw new StoreError(401, 'session_changed', 'The signed-in workspace changed. Sign in again before continuing.');
    return session;
  }
  function mutationRequired(req, session) {
    if (req.headers.origin !== origin) throw new StoreError(403, 'origin_rejected', 'The request origin was not accepted.');
    if (session && !auth.verifyCsrf(session, req.headers['x-csrf-token'])) throw new StoreError(403, 'csrf_rejected', 'Refresh this page before saving.');
  }
  function currentSession(req, expected) {
    const current = sessionRequired(req);
    if (current.token !== expected.token || current.user.id !== expected.user.id || current.user.businessId !== expected.user.businessId) {
      throw new StoreError(401, 'unauthorized', 'Sign in to continue.');
    }
    return current;
  }
  function currentMutationSession(req, expected) {
    const current = currentSession(req, expected);
    mutationRequired(req, current);
    return current;
  }
  async function withMutationBody(req, expected, mutate, maxBytes = MAX_BODY_BYTES) {
    const input = await readJson(req, maxBytes);
    // Reading a slow request body yields control. Password recovery, sign-out
    // or session expiry during that wait must invalidate the pending write.
    // Call the synchronous store mutation in this same continuation so another
    // awaited helper cannot reopen the gap between checking and writing.
    return mutate(input, currentMutationSession(req, expected));
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
      if (read && route === '/health') return send(res, 200, { ok: true, mode: 'private-local', aiEnabled: assistant.status().liveEnabled, bookingEnabled: false }, {}, req.method === 'HEAD');
      if (read && Object.hasOwn(ASSETS, route)) return await staticFile(req, res, ...ASSETS[route]);
      if (read && route === '/login') return await staticFile(req, res, 'workspace/login.html', 'text/html; charset=utf-8');
      if (read && ['/', '/preview', '/panels', '/dashboard'].includes(route)) {
        if (!auth.session(req)) {
          res.writeHead(303, { ...BASE_HEADERS, Location: '/login', 'Content-Type': 'text/plain; charset=utf-8' });
          return res.end();
        }
        const page = { '/': 'index', '/preview': 'preview', '/panels': 'panels', '/dashboard': 'dashboard' }[route];
        return await staticFile(req, res, 'workspace/' + page + '.html', 'text/html; charset=utf-8');
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
      if (req.method === 'GET' && route === '/api/assistant') {
        const { mode, liveEnabled } = assistant.status();
        return send(res, 200, { mode, liveEnabled });
      }
      if (req.method === 'GET' && route === '/api/profile') return send(res, 200, store.getProfile(session.user));
      if (req.method === 'GET' && route === '/api/leads') return send(res, 200, { leads: store.listLeads(session.user) });
      if (req.method === 'GET' && route === '/api/panel-projects') return send(res, 200, { projects: store.listPanelProjects(session.user) });
      if (req.method === 'GET' && route === '/api/panel-ocr') {
        const status = await (getOcrStatus || require('./ocr.cjs').getOcrStatus)();
        currentSession(req, session);
        return send(res, 200, status);
      }
      const panelMatch = /^\/api\/panel-projects\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/(export\.(?:csv|xlsx)|sources)(?:\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(\/ocr)?)?)?$/.exec(route);
      if (req.method === 'GET' && panelMatch) {
        const [, id, section, sourceId, ocrAction] = panelMatch;
        if (!section) return send(res, 200, { project: store.getPanelProject(session.user, id) });
        if (section === 'export.csv' && !sourceId) {
          const csv = store.exportPanelProject(session.user, id);
          res.writeHead(200, { ...BASE_HEADERS, 'Content-Type': 'text/csv; charset=utf-8', 'Content-Length': Buffer.byteLength(csv), 'Content-Disposition': 'attachment; filename="panelreply-parts-' + id + '.csv"', 'Cross-Origin-Resource-Policy': 'same-origin' });
          return res.end(csv);
        }
        if (section === 'export.xlsx' && !sourceId) {
          // The database and session choose the export content. Unsaved browser
          // fields, supplied business IDs and provider text cannot enter it.
          const { exportProjectXlsx, XLSX_MIME } = require('./xlsx.cjs');
          const workbook = exportProjectXlsx(store.getPanelProject(session.user, id));
          res.writeHead(200, { ...BASE_HEADERS, 'Content-Type': XLSX_MIME, 'Content-Length': workbook.length, 'Content-Disposition': 'attachment; filename="panelreply-parts-' + id + '.xlsx"', 'Cross-Origin-Resource-Policy': 'same-origin' });
          return res.end(workbook);
        }
        if (section === 'sources' && sourceId && !ocrAction) {
          const source = store.getPanelSource(session.user, id, sourceId);
          res.writeHead(200, { ...BASE_HEADERS, 'Content-Type': source.mime, 'Content-Length': source.data.length, 'Content-Disposition': 'inline; filename="source-' + sourceId + (source.mime === 'image/png' ? '.png' : '.jpg') + '"', 'Cross-Origin-Resource-Policy': 'same-origin' });
          return res.end(source.data);
        }
      }
      if (req.method === 'GET' && route === '/api/export') {
        const exported = businessExport(store, session.user);
        return send(res, 200, exported, {
          'Content-Disposition': 'attachment; filename="panelreply-records-' + exported.exportedAt.slice(0, 10) + '.json"',
          'Cross-Origin-Resource-Policy': 'same-origin'
        });
      }
      const match = /^\/api\/leads\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/.exec(route);
      if (req.method === 'GET' && match) return send(res, 200, { lead: store.getLead(session.user, match[1]) });
      if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method)) mutationRequired(req, session);
      if (req.method === 'POST' && route === '/api/logout') {
        assistant.cancel(session.token);
        auth.logout(currentMutationSession(req, session));
        return send(res, 204, undefined, { 'Set-Cookie': auth.cookie('', true) });
      }
      if (req.method === 'PATCH' && route === '/api/profile') {
        const result = await withMutationBody(req, session, (input, current) => store.updateProfile(current.user, input));
        return send(res, 200, result);
      }
      if (req.method === 'POST' && route === '/api/leads') {
        const result = await withMutationBody(req, session, (input, current) => store.createLead(current.user, input, req.headers['idempotency-key']));
        return send(res, result.created ? 201 : 200, result);
      }
      if (req.method === 'POST' && route === '/api/panel-projects') {
        const result = await withMutationBody(req, session, (input, current) => store.createPanelProject(current.user, input, req.headers['idempotency-key']), MAX_PANEL_BODY_BYTES);
        return send(res, result.created ? 201 : 200, result);
      }
      if (req.method === 'PATCH' && panelMatch && !panelMatch[2]) {
        const project = await withMutationBody(req, session, (input, current) => store.updatePanelProject(current.user, panelMatch[1], input), MAX_PANEL_BODY_BYTES);
        return send(res, 200, { project });
      }
      if (req.method === 'POST' && panelMatch && panelMatch[2] === 'sources' && !panelMatch[3]) {
        const result = await withMutationBody(req, session, (input, current) => store.addPanelSource(current.user, panelMatch[1], input, req.headers['idempotency-key']), MAX_PANEL_BODY_BYTES);
        return send(res, result.created ? 201 : 200, result);
      }
      if (req.method === 'POST' && panelMatch && panelMatch[2] === 'sources' && panelMatch[3] && panelMatch[4]) {
        const input = object(await readJson(req), ['version']);
        panels.validateVersion(input.version);
        const current = currentMutationSession(req, session);
        const id = panelMatch[1], sourceId = panelMatch[3];
        const project = store.getPanelProject(current.user, id);
        if (project.version !== input.version) throw new StoreError(409, 'version_conflict', 'This panel project changed. Reload it before extracting text.');
        const source = store.getPanelSource(current.user, id, sourceId);
        const controller = new AbortController();
        const cancel = () => controller.abort();
        req.once('aborted', cancel);
        res.once('close', cancel);
        if (req.aborted || res.destroyed || res.writableEnded) controller.abort();
        try {
          const result = await (recognizeImage || require('./ocr.cjs').recognizeImage)(source.data, { signal: controller.signal });
          const stillCurrent = currentMutationSession(req, current);
          const after = store.getPanelProject(stillCurrent.user, id);
          if (after.version !== input.version) throw new StoreError(409, 'version_conflict', 'This panel project changed while text was extracted. Reload it before continuing.');
          // OCR produces candidates only. The user must review and explicitly
          // save rows through the versioned project update route.
          return send(res, 200, { ...result, projectId: id, version: after.version, sourceImageId: sourceId, candidates: result.candidates.map(candidate => ({ ...candidate, sourceImageId: sourceId, reviewStatus: 'unreviewed' })) });
        } finally {
          req.removeListener('aborted', cancel);
          res.removeListener('close', cancel);
          source.data.fill(0);
        }
      }
      if (req.method === 'PATCH' && match) {
        const result = await withMutationBody(req, session, (input, current) => store.updateLead(current.user, match[1], input));
        return send(res, 200, { lead: result });
      }
      if (req.method === 'POST' && route === '/api/preview') {
        const input = object(await readJson(req), ['message', 'state']);
        const current = { session: currentMutationSession(req, session) };
        const profile = store.getProfile(current.session.user);
        const preview = previewMessage || assistant.previewMessage;
        const controller = new AbortController();
        const cancel = () => controller.abort();
        req.once('aborted', cancel);
        res.once('close', cancel);
        if (req.aborted || res.destroyed || res.writableEnded) controller.abort();
        try {
        async function runPreview(suppressed) {
          let result;
          try { result = await preview(input.message, input.state, profile, {
            suppressed, signal: controller.signal, scope: current.session.token,
            isCurrent: () => {
              try { currentMutationSession(req, current.session); return true; }
              catch (_) { return false; }
            }
          }); } catch (error) {
            // Expiry/revocation remains an authentication failure even when a
            // cancelled adapter also reports a draft cancellation.
            currentMutationSession(req, current.session);
            throw error;
          }
          // The preview hook can also yield. Recheck before any phone opt-out
          // write or response containing the authenticated business answers.
          currentMutationSession(req, current.session);
          if (store.getProfile(current.session.user).version !== profile.version) {
            throw new StoreError(409, 'profile_changed', 'The approved business information changed while this message was processed. Your draft is unchanged. Try the message again.');
          }
          return result;
        }
        const phoneBefore = knownPhone(input.state);
        const wasSuppressed = !!phoneBefore && store.isSuppressed(current.session.user, phoneBefore);
        let result = await runPreview(wasSuppressed);
        const phoneAfter = knownPhone(result.state);
        if (phoneAfter && !wasSuppressed && store.isSuppressed(current.session.user, phoneAfter)) result = await runPreview(true);
        const resultingPhone = knownPhone(result.state);
        const optOutHistory = result.state.conversation.some(item => item.role === 'customer' && intake.isOptOut(item.text));
        if (resultingPhone && (result.state.stopped || optOutHistory)) store.suppressPhone(currentMutationSession(req, current.session).user, resultingPhone);
        if (resultingPhone && store.isSuppressed(current.session.user, resultingPhone) && !result.state.stopped) result = await runPreview(true);
        return send(res, 200, result);
        } finally {
          req.removeListener('aborted', cancel);
          res.removeListener('close', cancel);
        }
      }
      throw new StoreError(404, 'not_found', 'The requested operation was not found.');
    } catch (error) {
      if (res.writableEnded || res.destroyed) return;
      const expected = error instanceof StoreError || error instanceof panels.PanelError || (typeof PreviewError === 'function' && error instanceof PreviewError) || (error && error.name === 'OcrError' && error instanceof require('./ocr.cjs').OcrError);
      const status = expected ? error.status : 500;
      const detail = expected ? { code: error.code, message: error.message, ...(error.fields ? { fields: error.fields } : {}) } : { code: 'internal_error', message: 'The request could not be completed. Try again.' };
      const extra = status === 429 ? { 'Retry-After': '900' } : {};
      if (status === 413) { extra.Connection = 'close'; req.resume(); }
      return send(res, status, { error: detail }, extra);
    }
  }
  return { handler, auth, close: () => assistant.close() };
}

module.exports = { createWorkspaceApp, validateOrigin, MAX_BODY_BYTES, MAX_PANEL_BODY_BYTES, readJson };
