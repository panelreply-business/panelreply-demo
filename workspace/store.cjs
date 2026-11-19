'use strict';

const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const intake = require('../src/intake.js');
const { assertPrivateDirectory, assertUnusedPath, existingDatabasePath } = require('./file-safety.cjs');
const panels = require('./panels.cjs');

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
  const resolved = assertPrivateDirectory(dataDir, { create: true });
  const filename = path.join(resolved, 'workspace.sqlite');
  let present;
  try { fs.lstatSync(filename); present = true; }
  catch (error) { if (error.code !== 'ENOENT') throw error; present = false; }
  if (!present) {
    assertUnusedPath(filename);
    // Sidecars must not pre-exist a missing database. Opening SQLite must never
    // follow a linked WAL/SHM path or adopt an unrelated journal file.
    assertUnusedPath(filename + '-wal');
    assertUnusedPath(filename + '-shm');
    assertUnusedPath(filename + '-journal');
    const fd = fs.openSync(filename, 'wx', 0o600);
    fs.closeSync(fd);
  }
  return existingDatabasePath(resolved);
}

const SCHEMA_COLUMNS = Object.freeze({
  businesses: ['id', 'name', 'version', 'facts_json', 'created_at'],
  users: ['id', 'business_id', 'username', 'password_hash', 'created_at'],
  sessions: ['token_hash', 'user_id', 'created_at', 'last_seen', 'expires_at'],
  login_attempts: ['key', 'started_at', 'attempts'],
  leads: ['id', 'business_id', 'idempotency_key', 'request_hash', 'data_json', 'status', 'version', 'created_at', 'updated_at'],
  messages: ['lead_id', 'business_id', 'position', 'role', 'text'],
  audit: ['id', 'business_id', 'lead_id', 'actor_id', 'action', 'version', 'created_at', 'details_json'],
  suppression: ['business_id', 'phone', 'created_at'],
  panel_projects: ['id', 'business_id', 'idempotency_key', 'request_hash', 'name', 'notes', 'rows_json', 'version', 'created_at', 'updated_at'],
  panel_sources: ['id', 'project_id', 'business_id', 'idempotency_key', 'request_hash', 'name', 'mime', 'bytes', 'width', 'height', 'created_at']
});
const TABLE_SQL = Object.freeze({
  "businesses": "CREATE TABLE businesses (id TEXT PRIMARY KEY, name TEXT NOT NULL, version INTEGER NOT NULL, facts_json TEXT NOT NULL, created_at INTEGER NOT NULL) STRICT",
  "users": "CREATE TABLE users (id TEXT PRIMARY KEY, business_id TEXT NOT NULL REFERENCES businesses(id), username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, created_at INTEGER NOT NULL) STRICT",
  "sessions": "CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), created_at INTEGER NOT NULL, last_seen INTEGER NOT NULL, expires_at INTEGER NOT NULL) STRICT",
  "login_attempts": "CREATE TABLE login_attempts (key TEXT PRIMARY KEY, started_at INTEGER NOT NULL, attempts INTEGER NOT NULL) STRICT",
  "leads": "CREATE TABLE leads (id TEXT PRIMARY KEY, business_id TEXT NOT NULL REFERENCES businesses(id), idempotency_key TEXT NOT NULL, request_hash TEXT NOT NULL, data_json TEXT NOT NULL, status TEXT NOT NULL, version INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, UNIQUE(business_id, idempotency_key)) STRICT",
  "messages": "CREATE TABLE messages (lead_id TEXT NOT NULL REFERENCES leads(id), business_id TEXT NOT NULL REFERENCES businesses(id), position INTEGER NOT NULL, role TEXT NOT NULL, text TEXT NOT NULL, PRIMARY KEY(lead_id, position)) STRICT",
  "audit": "CREATE TABLE audit (id TEXT PRIMARY KEY, business_id TEXT NOT NULL REFERENCES businesses(id), lead_id TEXT, actor_id TEXT NOT NULL REFERENCES users(id), action TEXT NOT NULL, version INTEGER NOT NULL, created_at INTEGER NOT NULL, details_json TEXT NOT NULL) STRICT",
  "suppression": "CREATE TABLE suppression (business_id TEXT NOT NULL REFERENCES businesses(id), phone TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(business_id, phone)) STRICT"
});
const INDEX_SQL = Object.freeze({
  "leads_business_created": "CREATE INDEX leads_business_created ON leads(business_id, created_at DESC)",
  "audit_business_lead": "CREATE INDEX audit_business_lead ON audit(business_id, lead_id, created_at)"
});
const AUTO_INDEXES = new Set(['sqlite_autoindex_businesses_1', 'sqlite_autoindex_users_1', 'sqlite_autoindex_users_2', 'sqlite_autoindex_sessions_1', 'sqlite_autoindex_login_attempts_1', 'sqlite_autoindex_leads_1', 'sqlite_autoindex_leads_2', 'sqlite_autoindex_messages_1', 'sqlite_autoindex_audit_1', 'sqlite_autoindex_suppression_1']);
const PANEL_TABLE_SQL = Object.freeze({
  panel_projects: 'CREATE TABLE panel_projects (id TEXT PRIMARY KEY, business_id TEXT NOT NULL REFERENCES businesses(id), idempotency_key TEXT NOT NULL, request_hash TEXT NOT NULL, name TEXT NOT NULL, notes TEXT NOT NULL, rows_json TEXT NOT NULL, version INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, UNIQUE(business_id, idempotency_key), UNIQUE(id, business_id)) STRICT',
  panel_sources: 'CREATE TABLE panel_sources (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, business_id TEXT NOT NULL REFERENCES businesses(id), idempotency_key TEXT NOT NULL, request_hash TEXT NOT NULL, name TEXT NOT NULL, mime TEXT NOT NULL, bytes BLOB NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL, created_at INTEGER NOT NULL, FOREIGN KEY(project_id, business_id) REFERENCES panel_projects(id, business_id), UNIQUE(project_id, idempotency_key)) STRICT'
});
const PANEL_INDEX_SQL = Object.freeze({
  panel_projects_business_updated: 'CREATE INDEX panel_projects_business_updated ON panel_projects(business_id, updated_at DESC)',
  panel_sources_project: 'CREATE INDEX panel_sources_project ON panel_sources(project_id, business_id, created_at)'
});
const PANEL_AUTO_INDEXES = ['sqlite_autoindex_panel_projects_1', 'sqlite_autoindex_panel_projects_2', 'sqlite_autoindex_panel_projects_3', 'sqlite_autoindex_panel_sources_1', 'sqlite_autoindex_panel_sources_2'];
const SCHEMA_VERSION = 2;
const SCHEMAS = Object.freeze({
  1: Object.freeze({ tables: TABLE_SQL, indexes: INDEX_SQL, autoIndexes: AUTO_INDEXES }),
  2: Object.freeze({ tables: Object.freeze({ ...TABLE_SQL, ...PANEL_TABLE_SQL }), indexes: Object.freeze({ ...INDEX_SQL, ...PANEL_INDEX_SQL }), autoIndexes: new Set([...AUTO_INDEXES, ...PANEL_AUTO_INDEXES]) })
});
function normalizeSchemaSql(sql) { return sql.trim().replace(/\s+/g, ' ').replace(/\s*([(),])\s*/g, '$1').toLowerCase(); }
function assertWorkspaceSchema(db) {
  const fail = (code = 'unsupported_schema') => {
    const message = code === 'invalid_database' ? 'The workspace database integrity check failed.' : 'Use an existing workspace database with supported schema version 1 or 2.';
    throw Object.assign(new Error(message), { code });
  };
  const version = db.prepare('PRAGMA user_version').get().user_version;
  if (!Object.hasOwn(SCHEMAS, version)) fail();
  const { tables, indexes, autoIndexes } = SCHEMAS[version];
  const schema = db.prepare('SELECT type, name, sql FROM sqlite_schema ORDER BY type, name').all();
  if (schema.length !== Object.keys(tables).length + Object.keys(indexes).length + autoIndexes.size) fail();
  const seen = new Set();
  for (const row of schema) {
    if (seen.has(row.name)) fail();
    seen.add(row.name);
    const expected = row.type === 'table' && Object.hasOwn(tables, row.name) ? tables[row.name]
      : row.type === 'index' && Object.hasOwn(indexes, row.name) ? indexes[row.name] : undefined;
    if (expected) {
      if (typeof row.sql !== 'string' || normalizeSchemaSql(row.sql) !== normalizeSchemaSql(expected)) fail();
    } else if (row.type !== 'index' || row.sql !== null || !autoIndexes.has(row.name)) fail();
  }
  try {
    const check = db.prepare('PRAGMA quick_check').all();
    if (check.length !== 1 || check[0].quick_check !== 'ok' || db.prepare('PRAGMA foreign_key_check').all().length) fail('invalid_database');
  } catch (_) { fail('invalid_database'); }
  return version;
}

function openStore({ dataDir, now = Date.now, create = true } = {}) {
  if (typeof create !== 'boolean') throw new Error('The workspace creation option must be a boolean.');
  const filename = create ? ensurePrivateDirectory(dataDir) : existingDatabasePath(dataDir);
  if ((fs.statSync(filename).mode & 0o600) !== 0o600) throw new Error('The workspace database must permit owner read and write access (0600).');
  const db = new DatabaseSync(filename, { enableForeignKeyConstraints: true, enableDoubleQuotedStringLiterals: false, allowExtension: false });
  try {
    const version = db.prepare('PRAGMA user_version').get().user_version;
    const isEmpty = version === 0 && db.prepare('SELECT count(*) AS n FROM sqlite_schema').get().n === 0;
    // Existing databases must exactly match a supported schema before changing
    // pragmas or DDL. Recovery opens never initialize or migrate a database.
    if (!create || !isEmpty) assertWorkspaceSchema(db);
    db.exec('PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=3000;');
    if (create) {
      db.exec('PRAGMA journal_mode=WAL;');
      if (isEmpty || version === 1) {
        db.exec('BEGIN IMMEDIATE');
        try {
          // Another startup may have migrated while this connection waited for
          // the writer lock. Check the current schema inside the transaction.
          const lockedVersion = db.prepare('PRAGMA user_version').get().user_version;
          const lockedEmpty = lockedVersion === 0 && db.prepare('SELECT count(*) AS n FROM sqlite_schema').get().n === 0;
          if (!lockedEmpty) assertWorkspaceSchema(db);
          if (lockedEmpty || lockedVersion === 1) {
            const tables = lockedEmpty ? SCHEMAS[2].tables : PANEL_TABLE_SQL;
            const indexes = lockedEmpty ? SCHEMAS[2].indexes : PANEL_INDEX_SQL;
            db.exec([...Object.values(tables), ...Object.values(indexes), 'PRAGMA user_version=2'].join(';\n') + ';');
          }
          assertWorkspaceSchema(db);
          db.exec('COMMIT');
        } catch (error) { db.exec('ROLLBACK'); throw error; }
      }
    }
    existingDatabasePath(dataDir);
  } catch (error) {
    db.close();
    throw error;
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
  function sourceMetadata(row) {
    return { id: row.id, name: row.name, mime: row.mime, bytes: row.byte_count, width: row.width, height: row.height, createdAt: iso(row.created_at) };
  }
  function projectSources(actor, id) {
    return db.prepare('SELECT id,name,mime,length(bytes) AS byte_count,width,height,created_at FROM panel_sources WHERE project_id=? AND business_id=? ORDER BY created_at,rowid').all(id, actor.businessId).map(sourceMetadata);
  }
  function materializeProject(row, actor) {
    if (!row) throw new StoreError(404, 'not_found', 'The panel project was not found.');
    return { id: row.id, name: row.name, notes: row.notes, rows: JSON.parse(row.rows_json), version: row.version, createdAt: iso(row.created_at), updatedAt: iso(row.updated_at), sources: projectSources(actor, row.id) };
  }
  function assertProjectSources(actor, id, rows) {
    const sourceIds = new Set(projectSources(actor, id).map(source => source.id));
    if (rows.some(row => row.sourceImageId !== null && !sourceIds.has(row.sourceImageId))) throw new StoreError(400, 'source_not_found', 'Choose a source image saved in this project.', ['sourceImageId']);
  }
  function projectDataBytes(project) { return Buffer.byteLength(project.name) + Buffer.byteLength(project.notes) + Buffer.byteLength(JSON.stringify(project.rows)); }
  function assertPanelCapacity(extraBytes) {
    const rows = Number(db.prepare('SELECT coalesce(sum(length(CAST(name AS BLOB))+length(CAST(notes AS BLOB))+length(CAST(rows_json AS BLOB))),0) AS n FROM panel_projects').get().n);
    const images = Number(db.prepare('SELECT coalesce(sum(length(bytes)),0) AS n FROM panel_sources').get().n);
    if (rows + images + extraBytes > panels.MAX_PANEL_DATA_BYTES) throw new StoreError(413, 'panel_storage_limit', 'The local panel storage limit was reached. Export and review storage with the operator before adding more data.');
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
    resetOwnerPassword(input) {
      object(input, ['username', 'passwordHash']);
      const name = username(input.username);
      if (typeof input.passwordHash !== 'string' || !/^scrypt\$32768\$8\$3\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{86}$/.test(input.passwordHash)) throw new StoreError(400, 'invalid_password_hash', 'Use a password hash generated by this workspace.');
      return tx(() => {
        const row = db.prepare('SELECT * FROM users WHERE username = ?').get(name);
        if (!row) throw new StoreError(404, 'owner_not_found', 'The local owner was not found. No account was created.');
        db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(input.passwordHash, row.id);
        const revokedSessions = Number(db.prepare('DELETE FROM sessions WHERE user_id = ?').run(row.id).changes);
        db.prepare('DELETE FROM login_attempts WHERE key = ?').run('user:' + digest(name));
        addAudit(publicUser(row), null, 'owner.password_reset', 0, { source: 'local_operator', revokedSessions });
        return { reset: true, userId: row.id, businessId: row.business_id, username: row.username, revokedSessions };
      });
    },
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
    createSession(userId, tokenHash, expectedPasswordHash) {
      return tx(() => {
        const time = now();
        db.prepare('DELETE FROM sessions WHERE expires_at <= ? OR last_seen <= ?').run(time, time - 30 * 60 * 1000);
        if (expectedPasswordHash === undefined) {
          db.prepare('INSERT INTO sessions VALUES (?, ?, ?, ?, ?)').run(tokenHash, userId, time, time, time + 8 * 60 * 60 * 1000);
        } else {
          if (typeof expectedPasswordHash !== 'string') throw new StoreError(401, 'invalid_credentials', 'The username or password was not accepted.');
          const result = db.prepare('INSERT INTO sessions SELECT ?, id, ?, ?, ? FROM users WHERE id = ? AND password_hash = ?').run(tokenHash, time, time, time + 8 * 60 * 60 * 1000, userId, expectedPasswordHash);
          // Password verification awaits scrypt. A reset may commit while that
          // work is in progress, so the captured hash must still match here.
          if (result.changes !== 1) throw new StoreError(401, 'invalid_credentials', 'The username or password was not accepted.');
        }
      });
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
    exportBusiness(actor) {
      getActor(actor);
      // A deferred read transaction gives profile, requests, transcripts and
      // audit records one consistent snapshot while another connection writes.
      db.exec('BEGIN');
      try {
        const result = { profile: store.getProfile(actor), leads: store.listLeads(actor) };
        db.exec('COMMIT');
        return result;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
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
    },
    listPanelProjects(actor) {
      getActor(actor);
      return db.prepare('SELECT p.*, (SELECT count(*) FROM panel_sources s WHERE s.project_id=p.id AND s.business_id=p.business_id) AS source_count FROM panel_projects p WHERE p.business_id=? ORDER BY p.updated_at DESC,p.rowid DESC').all(actor.businessId).map(row => {
        const rows = JSON.parse(row.rows_json);
        return { id: row.id, name: row.name, version: row.version, createdAt: iso(row.created_at), updatedAt: iso(row.updated_at), rowCount: rows.length, unreviewedCount: rows.filter(item => item.reviewStatus === 'unreviewed').length, sourceCount: row.source_count };
      });
    },
    getPanelProject(actor, id) {
      getActor(actor);
      return materializeProject(db.prepare('SELECT * FROM panel_projects WHERE id=? AND business_id=?').get(id, actor.businessId), actor);
    },
    createPanelProject(actor, input, idempotencyKey) {
      getActor(actor);
      panels.validateIdempotencyKey(idempotencyKey);
      const valid = panels.validateProject(input);
      if (valid.rows.some(row => row.sourceImageId !== null)) throw new StoreError(400, 'source_not_found', 'Save a project before attaching its source images.', ['sourceImageId']);
      const requestHash = digest(JSON.stringify(valid));
      return tx(() => {
        const prior = db.prepare('SELECT * FROM panel_projects WHERE business_id=? AND idempotency_key=?').get(actor.businessId, idempotencyKey);
        if (prior) {
          if (prior.request_hash !== requestHash) throw new StoreError(409, 'idempotency_conflict', 'This retry identifier belongs to different panel project details.');
          return { project: materializeProject(prior, actor), created: false };
        }
        if (db.prepare('SELECT count(*) AS n FROM panel_projects WHERE business_id=?').get(actor.businessId).n >= panels.MAX_PROJECTS_PER_BUSINESS) throw new StoreError(409, 'project_limit', 'The local workspace supports up to 200 panel projects per business.');
        assertPanelCapacity(projectDataBytes(valid));
        const id = crypto.randomUUID(), time = now();
        db.prepare('INSERT INTO panel_projects VALUES (?,?,?,?,?,?,?,1,?,?)').run(id, actor.businessId, idempotencyKey, requestHash, valid.name, valid.notes, JSON.stringify(valid.rows), time, time);
        addAudit(actor, null, 'panel.created', 1, { projectId: id, rowCount: valid.rows.length });
        return { project: store.getPanelProject(actor, id), created: true };
      });
    },
    updatePanelProject(actor, id, input) {
      getActor(actor);
      const valid = panels.validateProject(input, { update: true });
      return tx(() => {
        const existing = store.getPanelProject(actor, id);
        if (existing.version !== valid.version) throw new StoreError(409, 'version_conflict', 'This panel project changed. Reload it before saving.');
        assertProjectSources(actor, id, valid.rows);
        assertPanelCapacity(projectDataBytes(valid) - projectDataBytes(existing));
        db.prepare('UPDATE panel_projects SET name=?,notes=?,rows_json=?,version=version+1,updated_at=? WHERE id=? AND business_id=? AND version=?').run(valid.name, valid.notes, JSON.stringify(valid.rows), now(), id, actor.businessId, valid.version);
        addAudit(actor, null, 'panel.updated', valid.version + 1, { projectId: id, fields: ['name', 'notes', 'rows'], rowCount: valid.rows.length });
        return store.getPanelProject(actor, id);
      });
    },
    addPanelSource(actor, id, input, idempotencyKey) {
      getActor(actor);
      panels.validateIdempotencyKey(idempotencyKey);
      // The image inspection runs locally without reading a client path or URL.
      const valid = panels.validateSource(input, require('./ocr.cjs').inspectImage);
      const requestHash = digest(JSON.stringify({ name: valid.name, mime: valid.mime, hash: digest(valid.bytes) }));
      return tx(() => {
        const project = store.getPanelProject(actor, id);
        const prior = db.prepare('SELECT id,request_hash FROM panel_sources WHERE project_id=? AND business_id=? AND idempotency_key=?').get(id, actor.businessId, idempotencyKey);
        if (prior) {
          if (prior.request_hash !== requestHash) throw new StoreError(409, 'idempotency_conflict', 'This retry identifier belongs to a different source image.');
          return { project, source: project.sources.find(source => source.id === prior.id), created: false };
        }
        if (project.version !== valid.version) throw new StoreError(409, 'version_conflict', 'This panel project changed. Reload it before attaching an image.');
        if (project.sources.length >= panels.MAX_SOURCES) throw new StoreError(409, 'source_limit', 'A panel project supports up to five source images.');
        assertPanelCapacity(valid.bytes.length);
        const sourceId = crypto.randomUUID(), time = now();
        db.prepare('INSERT INTO panel_sources VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(sourceId, id, actor.businessId, idempotencyKey, requestHash, valid.name, valid.mime, valid.bytes, valid.width, valid.height, time);
        db.prepare('UPDATE panel_projects SET version=version+1,updated_at=? WHERE id=? AND business_id=? AND version=?').run(time, id, actor.businessId, valid.version);
        addAudit(actor, null, 'panel.source_added', valid.version + 1, { projectId: id, sourceId });
        const updated = store.getPanelProject(actor, id);
        return { project: updated, source: updated.sources.find(source => source.id === sourceId), created: true };
      });
    },
    getPanelSource(actor, id, sourceId) {
      getActor(actor);
      const row = db.prepare('SELECT id,name,mime,length(bytes) AS byte_count,bytes,width,height,created_at FROM panel_sources WHERE id=? AND project_id=? AND business_id=?').get(sourceId, id, actor.businessId);
      if (!row) throw new StoreError(404, 'not_found', 'The source image was not found.');
      return { ...sourceMetadata(row), data: Buffer.from(row.bytes) };
    },
    exportPanelProject(actor, id) {
      return panels.exportProjectCsv(store.getPanelProject(actor, id));
    }
  };
  return store;
}

module.exports = { openStore, StoreError, FACT_KEYS, STATUSES, PERMISSIONS, LEAD_KEYS, SCHEMA_COLUMNS, SCHEMAS, SCHEMA_VERSION, assertWorkspaceSchema, normalizePhone, validateLeadInput, validateProfileInput, username, object, text, digest };
