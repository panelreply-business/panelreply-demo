'use strict';

// In-process API + actual SQLite only. This suite does not open a listener,
// activate a provider, execute native OCR, or establish browser/device support.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { Readable } = require('node:stream');
const { EventEmitter } = require('node:events');
const { openStore, digest } = require('../workspace/store.cjs');
const { hashPassword, csrfFor } = require('../workspace/auth.cjs');
const { createWorkspaceApp } = require('../workspace/api.cjs');
const { previewMessage } = require('../workspace/conversation.cjs');
const { cases } = require('./fixtures/release-api-matrix.cjs');

const ORIGIN = 'http://127.0.0.1:10001';
const HASH = hashPassword('Synthetic API matrix fixture password 2026!');
const IMAGE = fs.readFileSync(path.join(__dirname, 'fixtures/panels/blank.png'));
const uuid = () => crypto.randomUUID();
const markers = ['PRIVATE_MATRIX_A', 'PRIVATE_MATRIX_B', 'PRIVATE_MATRIX_OCR'];
const row = marker => ({ partNumber: marker + '_PART', manufacturer: marker + '_MANUFACTURER',
  description: marker + '_DESCRIPTION', quantity: 2, reviewStatus: 'reviewed', notes: marker + '_ROW_NOTE', sourceImageId: null });
const projectInput = marker => ({ name: marker + '_PROJECT', notes: marker + '_PROJECT_NOTE', rows: [row(marker)] });
const leadInput = marker => ({ customerName: marker + '_CUSTOMER', phone: '+15865550101',
  job: 'Replace the panel ' + marker, zip: '48315', callbackWindow: 'Monday after four',
  requestedWorkDate: 'Friday', contactPermission: 'requested_callback',
  conversation: [{ role: 'customer', text: 'Please call me. ' + marker + '_TRANSCRIPT' }] });
const sourceInput = (version, name = 'fixture.png') => ({ version, name, mime: 'image/png', dataBase64: IMAGE.toString('base64') });
const clone = value => structuredClone(value);

async function fixture(t) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'panelreply-release-api-'));
  const passwordHash = await HASH;
  let now = Date.UTC(2026, 10, 20, 12);
  let store = openStore({ dataDir, now: () => now });
  const calls = { ocr: 0, ocrStatus: 0, preview: 0 };
  let app;
  const createApp = () => createWorkspaceApp({ store, origin: ORIGIN,
    recognizeImage: async () => { calls.ocr++; return { rawText: 'PRIVATE_MATRIX_OCR', candidates: [], warnings: [] }; },
    getOcrStatus: async () => { calls.ocrStatus++; return { available: false, engine: 'tesseract', version: null, reason: 'synthetic fixture' }; },
    previewMessage: (...args) => { calls.preview++; return previewMessage(...args); }
  });
  app = createApp();
  function seed(marker, username) {
    const actor = store.createBusinessOwner({ businessName: marker + '_BUSINESS', username, passwordHash });
    let lead = store.createLead(actor, leadInput(marker), uuid()).lead;
    lead = store.updateLead(actor, lead.id, { version: lead.version, status: 'closed', notes: marker + '_LEAD_NOTE' });
    let project = store.createPanelProject(actor, projectInput(marker), uuid()).project;
    const upload = store.addPanelSource(actor, project.id, sourceInput(project.version, marker + '.png'), uuid());
    const input = projectInput(marker); input.rows[0].sourceImageId = upload.source.id;
    project = store.updatePanelProject(actor, project.id, { version: upload.project.version, ...input });
    let profile = store.getProfile(actor);
    profile.facts.hours = { verified: true, answer: marker + '_APPROVED_HOURS' };
    profile = store.updateProfile(actor, { version: profile.version, businessName: marker + '_BUSINESS', facts: profile.facts });
    return { actor, lead, project, source: upload.source, profile };
  }
  const a = seed(markers[0], 'matrix-a@example.test');
  const b = seed(markers[1], 'matrix-b@example.test');
  function login(actor = a.actor) {
    const token = crypto.randomBytes(32).toString('base64url');
    store.createSession(actor.id, digest(token));
    return { token, headers: { cookie: app.auth.cookie(token).split(';')[0],
      'x-csrf-token': csrfFor(token), 'x-workspace-session': csrfFor(token), 'idempotency-key': uuid() } };
  }
  const owner = login(), other = login(b.actor);
  t.after(() => { app.close(); store.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });
  return { a, b, owner, other, login, calls, passwordHash,
    get app() { return app; }, get store() { return store; },
    expire() { now += 31 * 60 * 1000; },
    revoke() { store.resetOwnerPassword({ username: a.actor.username, passwordHash }); },
    reopen() { app.close(); store.close(); store = openStore({ dataDir, now: () => now, create: false }); app = createApp(); }
  };
}

// This oracle reads raw tables through a separate read-only connection. It
// does not ask the mutation implementation whether the mutation happened.
function snapshot(f) {
  const db = new DatabaseSync(f.store.filename, { readOnly: true });
  try {
    const names = db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(row => row.name);
    return Object.fromEntries(names.filter(name => name !== 'sessions').map(name => {
      assert.match(name, /^[a-z_]+$/);
      const rows = db.prepare('SELECT * FROM "' + name + '"').all().map(row => Object.fromEntries(
        Object.entries(row).map(([key, value]) => [key, value instanceof Uint8Array ? { base64: Buffer.from(value).toString('base64') } : value])
      ));
      return [name, rows.map(row => JSON.stringify(row)).sort()];
    }));
  } finally { db.close(); }
}
function operation(f, name, target = f.a) {
  const lead = '/api/leads/' + target.lead.id;
  const panel = '/api/panel-projects/' + target.project.id;
  const source = panel + '/sources/' + target.source.id;
  const deleteInput = version => ({ version, confirmation: 'DELETE' });
  const map = {
    'session-read': ['GET', '/api/session'], 'assistant-read': ['GET', '/api/assistant'],
    'usage-read': ['GET', '/api/assistant/usage'], 'profile-read': ['GET', '/api/profile'],
    'leads-list': ['GET', '/api/leads'], 'lead-read': ['GET', lead], 'business-export': ['GET', '/api/export'],
    'projects-list': ['GET', '/api/panel-projects'], 'project-read': ['GET', panel],
    'project-csv': ['GET', panel + '/export.csv'], 'project-xlsx': ['GET', panel + '/export.xlsx'],
    'source-read': ['GET', source], 'ocr-status': ['GET', '/api/panel-ocr'],
    'lead-create': ['POST', '/api/leads', leadInput('NEW_SYNTHETIC_LEAD')],
    'lead-update': ['PATCH', lead, { version: target.lead.version, status: 'closed', notes: 'NEW_SYNTHETIC_NOTE' }],
    'lead-delete': ['DELETE', lead, deleteInput(target.lead.version)],
    'conversation-delete': ['DELETE', lead + '/conversation', deleteInput(target.lead.version)],
    'profile-update': ['PATCH', '/api/profile', { version: target.profile.version, businessName: 'Updated fixture', facts: clone(target.profile.facts) }],
    'project-create': ['POST', '/api/panel-projects', projectInput('NEW_SYNTHETIC_PROJECT')],
    'project-update': ['PATCH', panel, { version: target.project.version, ...projectInput('NEW_SYNTHETIC_PROJECT') }],
    'project-delete': ['DELETE', panel, deleteInput(target.project.version)],
    'source-add': ['POST', panel + '/sources', sourceInput(target.project.version)],
    'source-delete': ['DELETE', source, deleteInput(target.project.version)],
    'source-ocr': ['POST', source + '/ocr', { version: target.project.version }],
    'preview': ['POST', '/api/preview', { message: 'What are your hours?', state: null }],
    'logout': ['POST', '/api/logout']
  };
  const [method, url, input] = map[name];
  return { method, url, ...(input === undefined ? {} : { input }) };
}
async function request(f, op, { headers = f.owner.headers, raw, stream, observe } = {}) {
  const body = raw === undefined ? op.input === undefined ? Buffer.alloc(0) : Buffer.from(JSON.stringify(op.input)) : Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
  const req = stream || Readable.from(body.length ? [body] : []);
  Object.assign(req, { method: op.method, url: op.url, headers: { host: '127.0.0.1:10001', origin: ORIGIN, 'content-type': 'application/json', ...headers }, socket: { remoteAddress: '127.0.0.1' } });
  if (observe) observe(req);
  const res = new EventEmitter(); res.writableEnded = false; res.destroyed = false;
  res.writeHead = (status, values) => { res.status = status; res.headers = values; };
  res.end = value => { res.buffer = value === undefined ? Buffer.alloc(0) : Buffer.from(value); res.writableEnded = true; };
  await f.app.handler(req, res);
  const text = res.buffer?.toString('utf8') || '';
  return { status: res.status, headers: res.headers, buffer: res.buffer, text,
    body: res.headers?.['Content-Type']?.startsWith('application/json') && text ? JSON.parse(text) : null };
}
function denied(f, response, before, status, code) {
  assert.equal(response.status, status, response.text);
  if (code) assert.equal(response.body?.error?.code, code);
  assert.deepEqual(Object.keys(response.body).sort(), ['error']);
  assert.equal(response.headers['Cache-Control'], 'no-store');
  assert.equal(response.headers['X-Content-Type-Options'], 'nosniff');
  for (const marker of markers) assert.equal(response.text.includes(marker), false, 'private record marker was disclosed');
  for (const value of [f.a.actor.id, f.a.actor.businessId, f.b.actor.id, f.b.actor.businessId,
    f.owner.token, f.other.token, f.passwordHash]) assert.equal(response.text.includes(value), false, 'private identity/credential was disclosed');
  assert.deepEqual(snapshot(f), before, 'a rejected request changed persisted business data');
  assert.deepEqual(f.calls, { ocr: 0, ocrStatus: 0, preview: 0 }, 'a denied operation invoked a private worker');
}

async function runCase(t, item) {
  const f = await fixture(t), op = operation(f, item.operation);
  let headers = { ...f.owner.headers }, raw, stream, status = 400, code = 'invalid_input';
  if (item.category === 'control') {
    const before = snapshot(f);
    const response = await request(f, op);
    const creates = ['lead-create', 'project-create', 'source-add'].includes(item.operation);
    assert.equal(response.status, item.operation === 'logout' ? 204 : creates ? 201 : 200, response.text);
    assert.equal(response.headers['Cache-Control'], 'no-store');
    assert.equal(response.headers['X-Content-Type-Options'], 'nosniff');
    assert.equal(response.text.includes(markers[1]), false, 'authorized response disclosed another business');
    const foreignRows = data => Object.fromEntries(Object.entries(data).map(([table, rows]) =>
      [table, rows.filter(value => { const row = JSON.parse(value); return row.business_id === f.b.actor.businessId || row.id === f.b.actor.businessId; })]));
    assert.deepEqual(foreignRows(snapshot(f)), foreignRows(before), 'authorized operation changed another business');
    if (op.method === 'GET' || ['source-ocr', 'preview', 'logout'].includes(item.operation)) {
      assert.deepEqual(snapshot(f), before, 'read/preview operation changed persisted business data');
    }
    if (item.operation === 'session-read') {
      assert.equal(response.body.user.id, f.a.actor.id); assert.equal(response.body.user.businessId, f.a.actor.businessId);
      assert.equal(response.body.csrfToken, headers['x-csrf-token']);
    } else if (item.operation === 'assistant-read') {
      assert.equal(response.body.liveEnabled, false); assert.equal(response.body.mode, 'deterministic');
    } else if (item.operation === 'usage-read') {
      for (const field of ['lifetimeAttempts', 'dailyAttempts', 'minuteAttempts', 'lifetimeReservedMicros', 'dailyReservedMicros']) assert.equal(response.body[field], 0);
      assert.deepEqual(response.body.statuses, {});
    } else if (item.operation === 'profile-read') assert.deepEqual(response.body, f.a.profile);
    else if (item.operation === 'leads-list') assert.deepEqual(response.body.leads, [f.a.lead]);
    else if (item.operation === 'lead-read') assert.deepEqual(response.body.lead, f.a.lead);
    else if (item.operation === 'business-export') {
      assert.equal(response.body.profile.business.id, f.a.actor.businessId); assert.equal(response.body.leads.length, 1);
      assert.equal(response.body.leads[0].id, f.a.lead.id); assert.equal(response.body.leads[0].job, f.a.lead.job);
      assert.equal(response.text.includes(f.passwordHash), false);
    } else if (item.operation === 'projects-list') {
      assert.equal(response.body.projects.length, 1); assert.equal(response.body.projects[0].id, f.a.project.id);
      assert.equal(response.body.projects[0].version, f.a.project.version);
    } else if (item.operation === 'project-read') assert.deepEqual(response.body.project, f.a.project);
    else if (item.operation === 'project-csv') {
      assert.equal(response.headers['Content-Type'], 'text/csv; charset=utf-8');
      assert.ok(response.text.includes(f.a.project.rows[0].partNumber));
      assert.equal(response.buffer.subarray(0, 3).toString('hex'), 'efbbbf');
    } else if (item.operation === 'project-xlsx') {
      assert.equal(response.headers['Content-Type'], 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      assert.equal(response.buffer.subarray(0, 4).toString('hex'), '504b0304');
      assert.equal(response.headers['Content-Length'], response.buffer.length);
    } else if (item.operation === 'source-read') {
      assert.deepEqual(response.buffer, IMAGE); assert.equal(response.headers['Content-Type'], 'image/png');
    } else if (item.operation === 'ocr-status') assert.equal(response.body.available, false);
    else if (item.operation === 'lead-create') {
      assert.equal(response.body.created, true); assert.equal(response.body.lead.version, 1);
      assert.equal(response.body.lead.job, op.input.job); assert.equal(f.store.listLeads(f.a.actor).length, 2);
      assert.deepEqual(f.store.getLead(f.a.actor, response.body.lead.id), response.body.lead);
    } else if (item.operation === 'lead-update') {
      assert.equal(response.body.lead.version, f.a.lead.version + 1); assert.equal(response.body.lead.notes, op.input.notes);
      assert.equal(response.body.lead.job, f.a.lead.job); assert.deepEqual(response.body.lead.conversation, f.a.lead.conversation);
      assert.deepEqual(f.store.getLead(f.a.actor, f.a.lead.id), response.body.lead);
    } else if (item.operation === 'profile-update') {
      assert.equal(response.body.version, f.a.profile.version + 1); assert.equal(response.body.business.name, op.input.businessName);
      assert.deepEqual(response.body.facts, op.input.facts); assert.deepEqual(f.store.getProfile(f.a.actor), response.body);
    } else if (item.operation === 'project-create') {
      assert.equal(response.body.created, true); assert.equal(response.body.project.version, 1);
      assert.deepEqual(response.body.project.rows, op.input.rows); assert.equal(f.store.listPanelProjects(f.a.actor).length, 2);
      assert.deepEqual(f.store.getPanelProject(f.a.actor, response.body.project.id), response.body.project);
    } else if (item.operation === 'project-update') {
      assert.equal(response.body.project.version, f.a.project.version + 1); assert.deepEqual(response.body.project.rows, op.input.rows);
      assert.equal(response.body.project.name, op.input.name); assert.equal(response.body.project.sources.length, 1);
      assert.deepEqual(f.store.getPanelProject(f.a.actor, f.a.project.id), response.body.project);
    } else if (item.operation === 'source-add') {
      assert.equal(response.body.created, true); assert.equal(response.body.project.version, f.a.project.version + 1);
      assert.equal(response.body.project.sources.length, 2); assert.deepEqual(response.body.project.rows, f.a.project.rows);
      assert.deepEqual(f.store.getPanelSource(f.a.actor, f.a.project.id, response.body.source.id).data, IMAGE);
    } else if (item.operation === 'source-ocr') {
      assert.equal(response.body.rawText, 'PRIVATE_MATRIX_OCR'); assert.equal(response.body.sourceImageId, f.a.source.id);
      assert.equal(response.body.projectId, f.a.project.id); assert.equal(response.body.version, f.a.project.version);
      assert.deepEqual(response.body.candidates, []);
    } else if (item.operation === 'preview') {
      assert.ok(response.body.replies.join(' ').includes(f.a.profile.facts.hours.answer));
      assert.equal(response.body.state.hold, false); assert.equal(response.body.state.stopped, false);
    } else if (item.operation === 'logout') {
      assert.equal(f.store.session(digest(f.owner.token)), null); assert.ok(f.store.session(digest(f.other.token)));
    } else if (op.method === 'DELETE') {
      const kind = { 'lead-delete': 'lead', 'conversation-delete': 'lead_conversation', 'project-delete': 'panel_project', 'source-delete': 'panel_source' }[item.operation];
      const receipt = response.body.receipt;
      assert.equal(receipt.deleted, true); assert.equal(receipt.kind, kind); assert.equal(receipt.version, op.input.version + 1);
      assert.equal(receipt.id, item.operation === 'source-delete' ? f.a.source.id : item.operation === 'project-delete' ? f.a.project.id : f.a.lead.id);
      if (item.operation === 'lead-delete') assert.throws(() => f.store.getLead(f.a.actor, f.a.lead.id), error => error.code === 'not_found');
      if (item.operation === 'project-delete') assert.throws(() => f.store.getPanelProject(f.a.actor, f.a.project.id), error => error.code === 'not_found');
      if (item.operation === 'conversation-delete') {
        const actual = f.store.getLead(f.a.actor, f.a.lead.id); assert.deepEqual(actual.conversation, []);
        assert.equal(actual.version, f.a.lead.version + 1); assert.equal(actual.job, f.a.lead.job);
      }
      if (item.operation === 'source-delete') {
        const actual = f.store.getPanelProject(f.a.actor, f.a.project.id); assert.deepEqual(actual.sources, []);
        assert.equal(actual.version, f.a.project.version + 1); assert.equal(actual.rows[0].sourceImageId, null);
        assert.equal(actual.rows[0].reviewStatus, 'unreviewed'); assert.equal(actual.rows[0].partNumber, f.a.project.rows[0].partNumber);
      }
    }
    assert.deepEqual(f.calls, { ocr: item.operation === 'source-ocr' ? 1 : 0,
      ocrStatus: item.operation === 'ocr-status' ? 1 : 0, preview: item.operation === 'preview' ? 1 : 0 });
    return;
  } else if (item.category === 'auth') {
    status = 401; code = 'unauthorized';
    switch (item.variant) {
      case 'missing-cookie': delete headers.cookie; break;
      case 'unknown-token': headers.cookie = f.app.auth.cookie('A'.repeat(43)).split(';')[0]; break;
      case 'short-token': headers.cookie = f.app.auth.cookie(f.owner.token.slice(1)).split(';')[0]; break;
      case 'long-token': headers.cookie = f.app.auth.cookie(f.owner.token + 'A').split(';')[0]; break;
      case 'duplicate-cookie': headers.cookie += '; ' + headers.cookie; break;
      case 'foreign-session-pin': headers['x-workspace-session'] = f.other.headers['x-workspace-session']; code = 'session_changed'; break;
      case 'empty-session-pin': headers['x-workspace-session'] = ''; code = 'session_changed'; break;
      case 'expired-session': f.expire(); break;
      case 'revoked-session': f.store.deleteSession(digest(f.owner.token)); break;
    }
  } else if (item.category === 'host') {
    status = 421; code = 'host_rejected';
    headers.host = { missing: undefined, empty: '', 'foreign-host': 'foreign.example.test', 'wrong-port': '127.0.0.1:10002',
      'trailing-dot': '127.0.0.1.:10001', 'authority-userinfo': 'attacker@127.0.0.1:10001', 'multiple-hosts': '127.0.0.1:10001,foreign.example.test' }[item.variant];
  } else if (item.category === 'origin') {
    status = 403; code = 'origin_rejected';
    headers.origin = { missing: undefined, empty: '', 'foreign-site': 'https://foreign.example.test', 'wrong-scheme': 'https://127.0.0.1:10001',
      'wrong-port': 'http://127.0.0.1:10002', 'trailing-slash': ORIGIN + '/', 'opaque-null': 'null' }[item.variant];
  } else if (item.category === 'csrf') {
    status = 403; code = 'csrf_rejected';
    const token = headers['x-csrf-token'];
    const flipped = token.replace(/[A-Za-z]/, value => value === value.toLowerCase() ? value.toUpperCase() : value.toLowerCase());
    headers['x-csrf-token'] = { missing: undefined, empty: '', 'foreign-session': f.other.headers['x-csrf-token'],
      truncated: token.slice(1), extended: token + 'A', 'wrong-case': flipped, 'array-value': [token], 'object-value': { token } }[item.variant];
  } else if (item.category === 'body') {
    const body = JSON.stringify(op.input), length = Buffer.byteLength(body);
    const limit = op.method === 'DELETE' ? 2048 : ['project-create', 'project-update', 'source-add'].includes(item.operation) ? 3 * 1024 * 1024 : 192 * 1024;
    code = 'invalid_json';
    switch (item.variant) {
      case 'empty-stream': raw = ''; break;
      case 'truncated-json': raw = body.slice(0, -1); break;
      case 'invalid-utf8': raw = Buffer.from([0x7b, 0x22, 0x78, 0x22, 0x3a, 0x22, 0xc3, 0x28, 0x22, 0x7d]); break;
      case 'array-root': raw = '[]'; break;
      case 'null-root': raw = 'null'; break;
      case 'string-root': raw = '"fixture"'; break;
      case 'boolean-root': raw = 'true'; break;
      case 'trailing-garbage': raw = body + ' x'; break;
      case 'missing-content-type': headers['content-type'] = undefined; status = 415; code = 'json_required'; break;
      case 'text-content-type': headers['content-type'] = 'text/plain'; status = 415; code = 'json_required'; break;
      case 'wrong-charset': headers['content-type'] = 'application/json; charset=iso-8859-1'; status = 415; code = 'json_required'; break;
      case 'gzip-encoding': headers['content-encoding'] = 'gzip'; status = 415; code = 'unsupported_encoding'; break;
      case 'deflate-encoding': headers['content-encoding'] = 'deflate'; status = 415; code = 'unsupported_encoding'; break;
      case 'negative-content-length': headers['content-length'] = '-1'; code = 'invalid_length'; break;
      case 'fractional-content-length': headers['content-length'] = '1.5'; code = 'invalid_length'; break;
      case 'nonnumeric-content-length': headers['content-length'] = '1e3'; code = 'invalid_length'; break;
      case 'array-content-length': headers['content-length'] = [String(length)]; code = 'invalid_length'; break;
      case 'declared-too-long': headers['content-length'] = String(length + 1); code = 'invalid_length'; break;
      case 'declared-too-short': headers['content-length'] = String(length - 1); code = 'invalid_length'; break;
      case 'declared-over-limit': headers['content-length'] = String(limit + 1); status = 413; code = 'body_too_large'; break;
      case 'stream-over-limit': raw = ' '.repeat(limit + 1); status = 413; code = 'body_too_large'; break;
      case 'interrupted-stream': stream = Readable.from((async function* () { yield body.slice(0, 5); throw new Error('Synthetic body interruption'); })()); code = 'incomplete_body'; break;
    }
  } else if (item.category === 'authority') {
    op.input[item.variant] = item.variant === 'role' ? 'admin' : f.b.actor.businessId;
    if (op.method === 'DELETE') code = 'deletion_confirmation_required';
  } else if (item.category === 'version') {
    const current = op.input.version;
    const values = { missing: undefined, null: null, boolean: true, 'numeric-string': String(current), 'empty-string': '',
      array: [current], object: { value: current }, negative: -1, zero: 0, fractional: 1.5,
      'unsafe-integer': Number.MAX_SAFE_INTEGER + 1, stale: current - 1, future: current + 1, 'maximum-safe': Number.MAX_SAFE_INTEGER };
    op.input.version = values[item.variant];
    if (item.variant === 'missing') delete op.input.version;
    if (item.variant === 'stale' || item.variant === 'future' || (item.variant === 'maximum-safe' && ['lead-update', 'profile-update'].includes(item.operation))) {
      status = 409; code = 'version_conflict';
    } else if (op.method === 'DELETE') code = 'deletion_confirmation_required';
  } else if (item.category === 'key') {
    headers['idempotency-key'] = { missing: undefined, empty: '', short: 'a'.repeat(15), long: 'a'.repeat(129),
      spaces: 'a'.repeat(16) + ' ', slash: 'a'.repeat(16) + '/', plus: 'a'.repeat(16) + '+', unicode: 'a'.repeat(16) + 'Ω',
      newline: 'a'.repeat(16) + '\n', array: ['a'.repeat(16)], object: { key: 'a'.repeat(16) } }[item.variant];
  } else if (item.category === 'tenant') {
    if (item.variant === 'other-business') {
      headers = { ...f.other.headers };
    } else {
      op.url = op.url.replace(f.a.source.id, f.b.source.id);
    }
    const before = snapshot(f);
    const foreign = await request(f, op, { headers });
    denied(f, foreign, before, 404, 'not_found');
    const unknown = { ...op, url: op.url.replace(item.variant === 'other-project-source' ? f.b.source.id :
      item.operation.startsWith('lead') || item.operation === 'conversation-delete' ? f.a.lead.id : f.a.project.id, uuid()) };
    const absent = await request(f, unknown, { headers });
    denied(f, absent, before, 404, 'not_found');
    assert.deepEqual(foreign.body, absent.body, 'foreign record existence changed the public error');
    return;
  } else if (item.category === 'delayed') {
    let release, started, reqRef;
    const wait = new Promise(resolve => { release = resolve; });
    const began = new Promise(resolve => { started = resolve; });
    const body = JSON.stringify(op.input);
    stream = Readable.from((async function* () { yield body.slice(0, 5); started(); await wait; yield body.slice(5); })());
    const pending = request(f, op, { headers, stream, observe: req => { reqRef = req; } });
    await began;
    if (item.variant === 'session-deleted') f.store.deleteSession(digest(f.owner.token));
    if (item.variant === 'password-reset') f.revoke();
    if (item.variant === 'idle-expiry') f.expire();
    if (item.variant === 'cookie-switch') reqRef.headers.cookie = f.other.headers.cookie;
    if (item.variant === 'pin-switch') reqRef.headers['x-workspace-session'] = f.other.headers['x-workspace-session'];
    const before = snapshot(f); release();
    denied(f, await pending, before, 401, ['cookie-switch', 'pin-switch'].includes(item.variant) ? 'session_changed' : 'unauthorized');
    return;
  } else if (item.category === 'replay') {
    const first = await request(f, op, { headers });
    const created = ['lead-create', 'project-create', 'source-add'].includes(item.operation);
    assert.equal(first.status, created ? 201 : 200, first.text);
    const committed = snapshot(f);
    if (item.variant === 'second-owner-session') headers = { ...f.login().headers, 'idempotency-key': headers['idempotency-key'] };
    if (item.variant === 'after-reopen') f.reopen();
    if (item.variant === 'conflicting-retry') {
      if (created) {
        if (item.operation === 'lead-create') op.input.job += ' and add an outlet';
        else op.input.name += '-different';
      } else op.input.version++;
      denied(f, await request(f, op, { headers }), committed, 409, 'idempotency_conflict');
    } else {
      const again = await request(f, op, { headers });
      assert.equal(again.status, 200, again.text);
      const expected = clone(first.body); if (created) expected.created = false;
      assert.deepEqual(again.body, expected, 'retry changed the original committed result');
      assert.deepEqual(snapshot(f), committed, 'retry wrote duplicate records, audit or receipts');
    }
    return;
  } else if (item.category === 'restricted-status') {
    let lead = leadInput('RESTRICTION_FIXTURE');
    if (item.restriction === 'permission-missing') lead.contactPermission = 'not_recorded';
    if (item.restriction === 'opted-out') lead.contactPermission = 'opted_out';
    if (item.restriction === 'safety-held') lead.job = 'The panel is sparking';
    const saved = f.store.createLead(f.a.actor, lead, uuid()).lead;
    const update = { method: 'PATCH', url: '/api/leads/' + saved.id, input: { version: saved.version, status: item.status } };
    const before = snapshot(f);
    const response = await request(f, update);
    const blocked = item.restriction === 'safety-held' ? item.status !== 'needs_review' :
      ['opted-out', 'permission-missing'].includes(item.restriction) && ['new', 'contacted'].includes(item.status);
    if (blocked) {
      const reason = { 'safety-held': 'safety_review_required', 'opted-out': 'contact_blocked', 'permission-missing': 'contact_permission_required' }[item.restriction];
      denied(f, response, before, 409, reason);
    } else {
      assert.equal(response.status, 200, response.text);
      const actual = f.store.getLead(f.a.actor, saved.id);
      assert.equal(actual.status, item.status); assert.equal(actual.version, saved.version + 1);
      assert.equal(actual.safetyHold, saved.safetyHold); assert.equal(actual.optedOut, saved.optedOut);
      assert.equal(actual.contactPermission, saved.contactPermission); assert.equal(actual.phone, saved.phone);
      assert.equal(actual.job, saved.job); assert.deepEqual(actual.conversation, saved.conversation);
      assert.deepEqual(f.store.getLead(f.b.actor, f.b.lead.id), f.b.lead);
    }
    return;
  } else throw new Error('Unsupported API matrix category: ' + item.category);
  const before = snapshot(f);
  denied(f, await request(f, op, { headers, raw, stream }), before, status, code);
}

for (const item of cases) test(item.id + ' | ' + item.risk, t => runCase(t, item));
