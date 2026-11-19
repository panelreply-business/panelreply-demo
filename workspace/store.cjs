'use strict';

const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const intake = require('../src/intake.js');

const FACT_KEYS = Object.freeze(['services', 'pricing', 'estimates', 'hours', 'serviceArea', 'contact', 'qualifications', 'emergencyAvailability', 'permits', 'warranty', 'financing']);
const STATUSES = Object.freeze(['new', 'needs_review', 'contacted', 'closed']);
const PERMISSIONS = Object.freeze(['requested_callback', 'not_recorded', 'opted_out']);
const LEAD_KEYS = Object.freeze(['customerName', 'phone', 'job', 'zip', 'callbackWindow', 'requestedWorkDate', 'contactPermission', 'conversation']);

class StoreError extends Error {
  constructor(status, code, message, fields) {
    super(message);
    this.status = status;
    this.code = code;
    if (fields) this.fields = fields;
  }
}

function invalid(message, fields) { throw new StoreError(400, 'invalid_input', message, fields); }
function object(value, allowed, required = allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('Send a JSON object.');
  if (Object.keys(value).some(key => !allowed.includes(key)) || required.some(key => !Object.hasOwn(value, key))) invalid('The request contains missing or unsupported fields.');
  return value;
}
function text(value, name, limit, required = false) {
  if (typeof value !== 'string' || value.length > limit || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) invalid('Check the ' + name + ' field.', [name]);
  const result = value.trim();
  if (required && !result) invalid('The ' + name + ' field is required.', [name]);
  return result;
}
function username(value) {
  const result = text(value, 'username', 120, true).toLowerCase();
  if (!/^[a-z0-9][a-z0-9._+@-]{2,119}$/.test(result)) invalid('Use a username with 3–120 letters, numbers or . _ + @ - characters.', ['username']);
  return result;
}
function normalizePhone(value) {
  const input = text(value, 'phone', 40, true);
  if (!/^\+?[\d\s().-]+$/.test(input)) invalid('Enter a US callback number without an extension.', ['phone']);
  let digits = input.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);
  if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(digits)) invalid('Enter a valid ten-digit US callback number.', ['phone']);
  if (input.startsWith('+') && !input.startsWith('+1')) invalid('This workspace currently accepts US callback numbers.', ['phone']);
  return '+1' + digits;
}
function conversation(value) {
  if (!Array.isArray(value) || value.length > 60) invalid('Keep the conversation to 60 messages.', ['conversation']);
  let total = 0;
  return value.map(entry => {
    object(entry, ['role', 'text']);
    if (!['customer', 'assistant'].includes(entry.role)) invalid('Unsupported conversation role.', ['conversation']);
    const content = text(entry.text, 'conversation', 2000, true);
    total += content.length;
    if (total > 20000) invalid('Keep the conversation below 20,000 characters.', ['conversation']);
    return { role: entry.role, text: content };
  });
}
function validateLeadInput(input) {
  object(input, LEAD_KEYS);
  const result = {
    customerName: text(input.customerName, 'customerName', 120, true),
    phone: normalizePhone(input.phone),
    job: text(input.job, 'job', 2000, true),
    zip: text(input.zip, 'zip', 5, true),
    callbackWindow: text(input.callbackWindow, 'callbackWindow', 200),
    requestedWorkDate: text(input.requestedWorkDate, 'requestedWorkDate', 200),
    contactPermission: input.contactPermission,
    conversation: conversation(input.conversation)
  };
  if (!/^\d{5}$/.test(result.zip)) invalid('Enter a five-digit job ZIP.', ['zip']);
  if (!/[a-z]/i.test(result.job)) invalid('Describe the electrical work.', ['job']);
  if (!PERMISSIONS.includes(result.contactPermission)) invalid('Select the recorded contact permission.', ['contactPermission']);
  return result;
}
function validateProfileInput(input) {
  object(input, ['version', 'businessName', 'facts']);
  if (!Number.isSafeInteger(input.version) || input.version < 1) invalid('Use the current business profile version.', ['version']);
  object(input.facts, FACT_KEYS);
  const facts = {};
  for (const key of FACT_KEYS) {
    const entry = object(input.facts[key], ['verified', 'answer']);
    if (typeof entry.verified !== 'boolean') invalid('Use a confirmation checkbox for business answers.', ['facts']);
    const answer = text(entry.answer, 'facts', 1000);
    if (entry.verified && !answer) invalid('A confirmed business answer cannot be empty.', ['facts']);
    facts[key] = { verified: entry.verified, answer };
  }
  return { version: input.version, businessName: text(input.businessName, 'businessName', 100, true), facts };
}
function evidence(input) {
  const customerText = [input.job, ...input.conversation.filter(item => item.role === 'customer').map(item => item.text)];
  return { safetyHold: customerText.some(value => intake.isUrgent(value)), optedOut: input.contactPermission === 'opted_out' || customerText.some(value => intake.isOptOut(value)) };
}
function digest(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function ensurePrivateDirectory(dataDir) {
  if (typeof dataDir !== 'string' || !path.isAbsolute(dataDir)) throw new Error('WORKSPACE_DATA_DIR must be an absolute directory.');
  const resolved = path.resolve(dataDir);
  // Resolve each existing path component before any create/open, rejecting symlinks.
  let cursor = path.parse(resolved).root;
  for (const part of resolved.slice(cursor.length).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, part);
    if (fs.existsSync(cursor) && fs.lstatSync(cursor).isSymbolicLink()) throw new Error('Workspace data paths must not contain symbolic links.');
  }
  fs.mkdirSync(resolved, { recursive: true, mode: 0o700 });
  const stat = fs.statSync(resolved);
  if (!stat.isDirectory() || (typeof process.getuid === 'function' && stat.uid !== process.getuid())) throw new Error('Workspace data directory must be owned by the current user.');
  if ((stat.mode & 0o077) !== 0) throw new Error('Workspace data directory must have owner-only permissions (0700).');
  const filename = path.join(resolved, 'workspace.sqlite');
  if (fs.existsSync(filename)) {
    const info = fs.lstatSync(filename);
    if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o077) !== 0) throw new Error('Workspace database must be an owner-only regular file.');
  } else {
    const fd = fs.openSync(filename, 'wx', 0o600);
    fs.closeSync(fd);
  }
  return filename;
}

function openStore({ dataDir, now = Date.now } = {}) {
  const filename = ensurePrivateDirectory(dataDir);
  const db = new DatabaseSync(filename, { enableForeignKeyConstraints: true, enableDoubleQuotedStringLiterals: false, allowExtension: false });
  if (db.prepare('PRAGMA user_version').get().user_version > 1) { db.close(); throw new Error('This workspace database needs a newer application version.'); }
  db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=3000;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS businesses (id TEXT PRIMARY KEY, name TEXT NOT NULL, version INTEGER NOT NULL, facts_json TEXT NOT NULL, created_at INTEGER NOT NULL) STRICT;
    CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, business_id TEXT NOT NULL REFERENCES businesses(id), username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, created_at INTEGER NOT NULL) STRICT;
    CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), created_at INTEGER NOT NULL, last_seen INTEGER NOT NULL, expires_at INTEGER NOT NULL) STRICT;
    CREATE TABLE IF NOT EXISTS login_attempts (key TEXT PRIMARY KEY, started_at INTEGER NOT NULL, attempts INTEGER NOT NULL) STRICT;
    CREATE TABLE IF NOT EXISTS leads (id TEXT PRIMARY KEY, business_id TEXT NOT NULL REFERENCES businesses(id), idempotency_key TEXT NOT NULL, request_hash TEXT NOT NULL, data_json TEXT NOT NULL, status TEXT NOT NULL, version INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, UNIQUE(business_id, idempotency_key)) STRICT;
    CREATE TABLE IF NOT EXISTS messages (lead_id TEXT NOT NULL REFERENCES leads(id), business_id TEXT NOT NULL REFERENCES businesses(id), position INTEGER NOT NULL, role TEXT NOT NULL, text TEXT NOT NULL, PRIMARY KEY(lead_id, position)) STRICT;
    CREATE TABLE IF NOT EXISTS audit (id TEXT PRIMARY KEY, business_id TEXT NOT NULL REFERENCES businesses(id), lead_id TEXT, actor_id TEXT NOT NULL REFERENCES users(id), action TEXT NOT NULL, version INTEGER NOT NULL, created_at INTEGER NOT NULL, details_json TEXT NOT NULL) STRICT;
    CREATE TABLE IF NOT EXISTS suppression (business_id TEXT NOT NULL REFERENCES businesses(id), phone TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(business_id, phone)) STRICT;
    CREATE INDEX IF NOT EXISTS leads_business_created ON leads(business_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS audit_business_lead ON audit(business_id, lead_id, created_at);
    PRAGMA user_version=1;
  `);
  for (const suffix of ['', '-wal', '-shm']) {
    const target = filename + suffix;
    if (fs.existsSync(target)) fs.chmodSync(target, 0o600);
  }
  const tx = fn => {
    db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  };
  const iso = value => new Date(value).toISOString();
  const getActor = actor => {
    if (!actor || typeof actor.id !== 'string' || typeof actor.businessId !== 'string') throw new StoreError(401, 'unauthorized', 'Sign in to continue.');
    const found = db.prepare('SELECT id FROM users WHERE id = ? AND business_id = ?').get(actor.id, actor.businessId);
    if (!found) throw new StoreError(401, 'unauthorized', 'Sign in to continue.');
    return actor;
  };
  const addAudit = (actor, leadId, action, version, details = {}) => db.prepare('INSERT INTO audit VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(crypto.randomUUID(), actor.businessId, leadId, actor.id, action, version, now(), JSON.stringify(details));
  function publicUser(row) { return row ? { id: row.id, username: row.username, businessId: row.business_id } : null; }
  function suppressed(businessId, phone) { return !!db.prepare('SELECT 1 FROM suppression WHERE business_id = ? AND phone = ?').get(businessId, phone); }
  function addSuppression(actor, phone, source, currentLeadId = '') {
    const inserted = db.prepare('INSERT OR IGNORE INTO suppression VALUES (?, ?, ?)').run(actor.businessId, phone, now()).changes === 1;
    if (!inserted) return false;
    const affected = db.prepare("SELECT id, version FROM leads WHERE business_id = ? AND status = 'new' AND json_extract(data_json, '$.phone') = ? AND id <> ?").all(actor.businessId, phone, currentLeadId);
    for (const row of affected) {
      db.prepare("UPDATE leads SET status = 'needs_review', version = version + 1, updated_at = ? WHERE id = ? AND business_id = ?").run(now(), row.id, actor.businessId);
      addAudit(actor, row.id, 'contact.opted_out', row.version + 1, { source, fields: ['status', 'contactPermission'] });
    }
    return true;
  }
  function materializeLead(row, actor) {
    if (!row) throw new StoreError(404, 'not_found', 'The request was not found.');
    const data = JSON.parse(row.data_json);
    const optedOut = suppressed(actor.businessId, data.phone);
    const transcript = db.prepare('SELECT role, text FROM messages WHERE lead_id = ? AND business_id = ? ORDER BY position').all(row.id, actor.businessId).map(item => ({ role: item.role, text: item.text }));
    const audit = db.prepare('SELECT * FROM audit WHERE business_id = ? AND lead_id = ? ORDER BY created_at, rowid').all(actor.businessId, row.id).map(item => ({ id: item.id, actorId: item.actor_id, action: item.action, version: item.version, createdAt: iso(item.created_at), details: JSON.parse(item.details_json) }));
    return { id: row.id, version: row.version, createdAt: iso(row.created_at), updatedAt: iso(row.updated_at), status: row.status, ...data, contactPermission: optedOut ? 'opted_out' : data.contactPermission, optedOut, contactAllowed: !optedOut && !data.safetyHold && data.contactPermission === 'requested_callback', conversation: transcript, audit };
  }
  const store = {
    filename,
    close() { db.close(); },
    createBusinessOwner({ businessName, username: name, passwordHash }) {
      const validName = text(businessName, 'businessName', 100, true);
      const validUsername = username(name);
      if (typeof passwordHash !== 'string' || !passwordHash.startsWith('scrypt$')) throw new Error('A hashed password is required.');
      return tx(() => {
        if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(validUsername)) throw new StoreError(409, 'username_exists', 'That username is already configured.');
        const businessId = crypto.randomUUID(), id = crypto.randomUUID();
        const facts = Object.fromEntries(FACT_KEYS.map(key => [key, { verified: false, answer: '' }]));
        db.prepare('INSERT INTO businesses VALUES (?, ?, 1, ?, ?)').run(businessId, validName, JSON.stringify(facts), now());
        db.prepare('INSERT INTO users VALUES (?, ?, ?, ?, ?)').run(id, businessId, validUsername, passwordHash, now());
        return { id, username: validUsername, businessId };
      });
    },
    findUser(name) { return db.prepare('SELECT * FROM users WHERE username = ?').get(name) || null; },
    publicUser,
    consumeLoginAttempt(key, maximum) {
      const time = now(), window = 15 * 60 * 1000;
      return tx(() => {
        db.prepare('DELETE FROM login_attempts WHERE started_at < ?').run(time - window);
        const row = db.prepare('SELECT * FROM login_attempts WHERE key = ?').get(key);
        if (row && row.attempts >= maximum) return false;
        db.prepare('INSERT INTO login_attempts VALUES (?, ?, 1) ON CONFLICT(key) DO UPDATE SET attempts = attempts + 1').run(key, time);
        return true;
      });
    },
    resetLoginAttempts(key) { db.prepare('DELETE FROM login_attempts WHERE key = ?').run(key); },
    createSession(userId, tokenHash) {
      const time = now();
      db.prepare('DELETE FROM sessions WHERE expires_at <= ? OR last_seen <= ?').run(time, time - 30 * 60 * 1000);
      db.prepare('INSERT INTO sessions VALUES (?, ?, ?, ?, ?)').run(tokenHash, userId, time, time, time + 8 * 60 * 60 * 1000);
    },
    session(tokenHash) {
      const row = db.prepare('SELECT s.*, u.id, u.username, u.business_id FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?').get(tokenHash);
      if (!row) return null;
      if (row.expires_at <= now() || row.last_seen <= now() - 30 * 60 * 1000) { store.deleteSession(tokenHash); return null; }
      db.prepare('UPDATE sessions SET last_seen = ? WHERE token_hash = ?').run(now(), tokenHash);
      return publicUser(row);
    },
    deleteSession(tokenHash) { db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash); },
    isSuppressed(actor, phone) {
      getActor(actor);
      return suppressed(actor.businessId, normalizePhone(phone));
    },
    suppressPhone(actor, phone) {
      getActor(actor);
      const normalized = normalizePhone(phone);
      return tx(() => {
        const inserted = addSuppression(actor, normalized, 'preview');
        if (inserted) addAudit(actor, null, 'contact.opted_out', 0, { source: 'preview' });
        return true;
      });
    },
    getProfile(actor) {
      getActor(actor);
      const row = db.prepare('SELECT * FROM businesses WHERE id = ?').get(actor.businessId);
      return { business: { id: row.id, name: row.name }, version: row.version, facts: JSON.parse(row.facts_json) };
    },
    updateProfile(actor, input) {
      getActor(actor); const valid = validateProfileInput(input);
      return tx(() => {
        const result = db.prepare('UPDATE businesses SET name = ?, facts_json = ?, version = version + 1 WHERE id = ? AND version = ?').run(valid.businessName, JSON.stringify(valid.facts), actor.businessId, valid.version);
        if (result.changes !== 1) throw new StoreError(409, 'version_conflict', 'The business profile changed. Reload it before saving.');
        addAudit(actor, null, 'profile.updated', valid.version + 1, { fields: ['businessName', 'facts'] });
        return store.getProfile(actor);
      });
    },
    listLeads(actor) {
      getActor(actor);
      return db.prepare('SELECT * FROM leads WHERE business_id = ? ORDER BY created_at DESC, rowid DESC').all(actor.businessId).map(row => materializeLead(row, actor));
    },
    getLead(actor, id) {
      getActor(actor);
      return materializeLead(db.prepare('SELECT * FROM leads WHERE id = ? AND business_id = ?').get(id, actor.businessId), actor);
    },
    createLead(actor, input, idempotencyKey) {
      getActor(actor);
      if (typeof idempotencyKey !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(idempotencyKey)) invalid('A request retry identifier is required.');
      const valid = validateLeadInput(input);
      const requestHash = digest(JSON.stringify(valid));
      return tx(() => {
        const prior = db.prepare('SELECT * FROM leads WHERE business_id = ? AND idempotency_key = ?').get(actor.businessId, idempotencyKey);
        if (prior) {
          if (prior.request_hash !== requestHash) throw new StoreError(409, 'idempotency_conflict', 'This retry identifier belongs to different request details.');
          return { lead: materializeLead(prior, actor), created: false };
        }
        const flags = evidence(valid);
        const { conversation: transcript, ...data } = valid;
        data.notes = ''; data.safetyHold = flags.safetyHold;
        if (flags.optedOut) addSuppression(actor, valid.phone, 'lead');
        const needsReview = flags.safetyHold || suppressed(actor.businessId, valid.phone) || valid.contactPermission !== 'requested_callback';
        const id = crypto.randomUUID(), time = now();
        db.prepare('INSERT INTO leads VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)').run(id, actor.businessId, idempotencyKey, requestHash, JSON.stringify(data), needsReview ? 'needs_review' : 'new', time, time);
        const statement = db.prepare('INSERT INTO messages VALUES (?, ?, ?, ?, ?)');
        transcript.forEach((item, index) => statement.run(id, actor.businessId, index, item.role, item.text));
        addAudit(actor, id, 'lead.created', 1, { fields: LEAD_KEYS.filter(key => key !== 'conversation'), messageCount: transcript.length });
        if (flags.optedOut) addAudit(actor, id, 'contact.opted_out', 1, {});
        return { lead: store.getLead(actor, id), created: true };
      });
    },
    updateLead(actor, id, input) {
      getActor(actor);
      const allowed = ['version', 'status', 'notes', ...LEAD_KEYS.filter(key => key !== 'conversation')];
      object(input, allowed, ['version', 'status']);
      if (!Number.isSafeInteger(input.version) || input.version < 1) invalid('Use the current request version.', ['version']);
      if (!STATUSES.includes(input.status)) invalid('Select a supported request status.', ['status']);
      return tx(() => {
        const existing = store.getLead(actor, id);
        if (existing.version !== input.version) throw new StoreError(409, 'version_conflict', 'This request changed. Reload it before saving.');
        const candidate = Object.fromEntries(LEAD_KEYS.map(key => [key, Object.hasOwn(input, key) ? input[key] : existing[key]]));
        const valid = validateLeadInput(candidate);
        const { conversation: transcript, ...data } = valid;
        const flags = evidence(valid);
        data.notes = Object.hasOwn(input, 'notes') ? text(input.notes, 'notes', 2000) : existing.notes;
        data.safetyHold = existing.safetyHold || flags.safetyHold;
        if (flags.optedOut) addSuppression(actor, valid.phone, 'lead', id);
        const optedOut = suppressed(actor.businessId, valid.phone);
        if (data.safetyHold && input.status !== 'needs_review') throw new StoreError(409, 'safety_review_required', 'This request has a safety hold and must remain under review.');
        if (optedOut && ['new', 'contacted'].includes(input.status)) throw new StoreError(409, 'contact_blocked', 'This number is opted out. Keep it under review or close the request.');
        if (valid.contactPermission !== 'requested_callback' && ['new', 'contacted'].includes(input.status)) throw new StoreError(409, 'contact_permission_required', 'Record the callback request before marking it new or contacted.');
        const next = input.version + 1;
        db.prepare('UPDATE leads SET data_json = ?, status = ?, version = ?, updated_at = ? WHERE id = ? AND business_id = ? AND version = ?').run(JSON.stringify(data), input.status, next, now(), id, actor.businessId, input.version);
        addAudit(actor, id, 'lead.updated', next, { fields: Object.keys(input).filter(key => key !== 'version') });
        if (flags.optedOut && !existing.optedOut) addAudit(actor, id, 'contact.opted_out', next, {});
        return store.getLead(actor, id);
      });
    }
  };
  return store;
}

module.exports = { openStore, StoreError, FACT_KEYS, STATUSES, PERMISSIONS, LEAD_KEYS, normalizePhone, validateLeadInput, validateProfileInput, username, object, text, digest };
