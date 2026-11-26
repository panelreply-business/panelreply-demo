'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const { DatabaseSync, backup } = require('node:sqlite');
const { assertPrivateDirectory, assertPrivateRegularFile, assertUnusedPath, existingDatabasePath } = require('./file-safety.cjs');
const { validateLeadInput, validateProfileInput, normalizePhone, username, STATUSES, assertWorkspaceSchema } = require('./store.cjs');
const panels = require('./panels.cjs');
const { INPUT_BYTES, OUTPUT_TOKENS, LEASE_MS, MAX_ROWS } = require('./usage.cjs');
const { validateLifecycleDatabase } = require('./lifecycle.cjs');
const { validateCallbackDatabase } = require('./callback-tasks.cjs');
const { MARKER, separatedProduct, productBinding, readProductBinding } = require('./products.cjs');

const scrypt = promisify(crypto.scrypt);
const MAGIC = Buffer.from('PRKBK001');
const HEADER_BYTES = 64;
const TAG_BYTES = 16;
const MAX_DATABASE_BYTES = 64 * 1024 * 1024;
const MAX_ARCHIVE_BYTES = MAX_DATABASE_BYTES + HEADER_BYTES + TAG_BYTES;
const RESTORE_DISABLED_PASSWORD = 'disabled:restore-required';
const SCRYPT_OPTIONS = Object.freeze({ N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 });
const DB_OPTIONS = Object.freeze({ enableForeignKeyConstraints: true, enableDoubleQuotedStringLiterals: false, allowExtension: false });
const PRODUCT_CODES = Object.freeze({ callback: 1, spreadsheet: 2 });


class BackupError extends Error {
  constructor(code, message) { super(message); this.name = 'BackupError'; this.code = code; }
}
function fail(code, message) { throw new BackupError(code, message); }
function validPassphrase(value) {
  return typeof value === 'string' && value.length >= 15 && value.length <= 128 && value.isWellFormed()
    && /\S/.test(value) && !/[\u0000-\u001f\u007f]/.test(value);
}
function requirePassphrase(value) {
  if (!validPassphrase(value)) fail('invalid_passphrase', 'Use a backup passphrase of 15–128 characters without control characters.');
}
function expectedProduct(value) {
  if (value === undefined) return null;
  try { return separatedProduct(value).id; }
  catch (_) { fail('invalid_product', 'Choose callback or spreadsheet explicitly for a product-bound backup or restore.'); }
}
function checkedBinding(dataDir) {
  try { return readProductBinding(dataDir); }
  catch (_) { fail('invalid_product_binding', 'The source product binding is invalid. Preserve the directory for operator review.'); }
}
function sourceProduct(dataDir, expected) {
  const binding = checkedBinding(dataDir);
  if (expected && !binding) fail('product_binding_required', 'An unmarked workspace cannot be assigned to a product by creating a backup.');
  if (binding && !expected) fail('product_required', 'Supply the matching product when backing up a bound workspace.');
  if (binding && binding.product !== expected) fail('product_mismatch', 'The source workspace belongs to another product.');
  return binding?.product || null;
}
function expectedPath(fn, ...args) {
  try { return fn(...args); }
  catch (_) { fail('unsafe_path', 'Use absolute, owner-only paths without links. The source must exist and the destination must be unused.'); }
}
function regularInfo(fd) {
  const info = fs.fstatSync(fd);
  if (!info.isFile() || info.nlink !== 1 || ![0o400, 0o600].includes(info.mode & 0o7777) || (typeof process.getuid === 'function' && info.uid !== process.getuid())) fail('unsafe_path', 'Use an owner-only regular file without links.');
  return info;
}
function readBoundedFile(filename, limit) {
  const fd = fs.openSync(filename, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const info = regularInfo(fd);
    if (info.size < 1 || info.size > limit) fail('size_limit', 'The file is empty or exceeds the 64 MiB local recovery limit.');
    const data = Buffer.alloc(info.size);
    let read = 0;
    while (read < data.length) {
      const count = fs.readSync(fd, data, read, data.length - read, read);
      if (!count) fail('changed_file', 'The file changed while it was being read. Try again with a stable copy.');
      read += count;
    }
    if (fs.fstatSync(fd).size !== info.size || fs.readSync(fd, Buffer.alloc(1), 0, 1, read) !== 0) fail('changed_file', 'The file changed while it was being read. Try again with a stable copy.');
    return data;
  } finally { fs.closeSync(fd); }
}
function syncFile(filename) {
  const fd = fs.openSync(filename, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
function syncDirectory(directory) {
  const fd = fs.openSync(directory, fs.constants.O_RDONLY | (fs.constants.O_DIRECTORY || 0));
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
function writeExclusive(filename, data) {
  const fd = fs.openSync(filename, 'wx', 0o600);
  try { fs.writeFileSync(fd, data); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
}
function temporaryDirectory(parent) {
  const directory = fs.mkdtempSync(path.join(parent, '.panelreply-recovery-'));
  fs.chmodSync(directory, 0o700);
  return directory;
}
function readJson(value) {
  try { return JSON.parse(value); } catch (_) { fail('invalid_database', 'The workspace contains an invalid saved record.'); }
}
function databaseSize(db) {
  const pages = db.prepare('PRAGMA page_count').get().page_count;
  const size = db.prepare('PRAGMA page_size').get().page_size;
  const bytes = pages * size;
  if (!Number.isSafeInteger(bytes) || bytes < 100 || bytes > MAX_DATABASE_BYTES) fail('size_limit', 'The database exceeds the 64 MiB local recovery limit.');
  return { pages, pageSize: size, bytes };
}

function validateDatabase(db) {
  db.exec('PRAGMA trusted_schema=OFF; PRAGMA foreign_keys=ON;');
  databaseSize(db);
  let schemaVersion;
  try { schemaVersion = assertWorkspaceSchema(db); }
  catch (error) {
    if (error && error.code === 'invalid_database') fail('invalid_database', 'The database integrity check failed.');
    fail('unsupported_schema', 'The workspace database schema is not supported.');
  }
  const integrity = db.prepare('PRAGMA integrity_check').all();
  if (integrity.length !== 1 || integrity[0].integrity_check !== 'ok' || db.prepare('PRAGMA foreign_key_check').all().length) fail('invalid_database', 'The database integrity check failed.');
  const badRelationships = [
    'SELECT 1 FROM messages m JOIN leads l ON l.id=m.lead_id WHERE m.business_id<>l.business_id LIMIT 1',
    'SELECT 1 FROM audit a JOIN users u ON u.id=a.actor_id WHERE a.business_id<>u.business_id LIMIT 1',
    'SELECT 1 FROM audit a LEFT JOIN leads l ON l.id=a.lead_id WHERE a.lead_id IS NOT NULL AND (l.id IS NULL OR l.business_id<>a.business_id) LIMIT 1'
  ];
  if (badRelationships.some(sql => db.prepare(sql).get())) fail('invalid_database', 'The database business-isolation check failed.');
  try {
    const timestamp = value => Number.isSafeInteger(value) && value >= 0 && value <= 8640000000000000;
    for (const row of db.prepare('SELECT * FROM businesses').iterate()) validateProfileInput({ version: row.version, businessName: row.name, facts: readJson(row.facts_json) });
    for (const row of db.prepare('SELECT username,password_hash FROM users').iterate()) {
      if (username(row.username) !== row.username || (row.password_hash !== RESTORE_DISABLED_PASSWORD && !/^scrypt\$32768\$8\$3\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{86}$/.test(row.password_hash))) fail('invalid_database', 'The workspace contains an invalid account record.');
    }
    const transcript = db.prepare('SELECT role,text FROM messages WHERE lead_id=? ORDER BY position');
    const suppression = db.prepare('SELECT 1 FROM suppression WHERE business_id=? AND phone=?');
    for (const row of db.prepare('SELECT * FROM leads').iterate()) {
      const record = readJson(row.data_json);
      if (!record || typeof record !== 'object' || Array.isArray(record) || typeof record.notes !== 'string' || record.notes.length > 2000 || !record.notes.isWellFormed() || typeof record.safetyHold !== 'boolean'
        || !Number.isSafeInteger(row.version) || row.version < 1 || !STATUSES.includes(row.status) || !/^[a-f0-9]{64}$/.test(row.request_hash)
        || !timestamp(row.created_at) || !timestamp(row.updated_at) || row.updated_at < row.created_at) fail('invalid_database', 'The workspace contains an invalid request record.');
      const { notes, safetyHold, ...fields } = record;
      validateLeadInput({ ...fields, conversation: transcript.all(row.id).map(item => ({ role: item.role, text: item.text })) });
      if (normalizePhone(record.phone) !== record.phone || (record.contactPermission === 'opted_out' && !suppression.get(row.business_id, record.phone))) fail('invalid_database', 'The workspace contains an invalid contact restriction.');
    }
    for (const row of db.prepare('SELECT phone,created_at FROM suppression').iterate()) if (normalizePhone(row.phone) !== row.phone || !timestamp(row.created_at)) fail('invalid_database', 'The workspace contains an invalid contact restriction.');
    for (const row of db.prepare('SELECT details_json FROM audit').iterate()) {
      const details = readJson(row.details_json);
      if (!details || typeof details !== 'object' || Array.isArray(details)) fail('invalid_database', 'The workspace contains an invalid audit record.');
    }
    if (schemaVersion >= 4) validateCallbackDatabase(db, fail);
    if (schemaVersion >= 3) {
      validateLifecycleDatabase(db, fail);
      if (db.prepare('SELECT 1 FROM assistant_usage a JOIN users u ON u.id=a.actor_id WHERE a.business_id<>u.business_id LIMIT 1').get()) fail('invalid_database', 'The database business-isolation check failed.');
      if (db.prepare('SELECT count(*) AS n FROM assistant_usage').get().n > MAX_ROWS) fail('invalid_database', 'The workspace contains too many assistance usage records.');
      const timestamp = n => Number.isSafeInteger(n) && n >= 0 && n <= 8640000000000000;
      for (const row of db.prepare('SELECT * FROM assistant_usage').iterate()) {
        if (!panels.UUID.test(row.id) || !/^[a-f0-9]{64}$/.test(row.request_hash) || !timestamp(row.created_at) || !timestamp(row.expires_at) || row.expires_at !== row.created_at + LEASE_MS || !['pending', 'succeeded', 'failed', 'cancelled', 'timeout', 'abandoned'].includes(row.status) || (row.status === 'pending' ? row.finished_at !== null : !timestamp(row.finished_at) || row.finished_at < row.created_at) || !Number.isSafeInteger(row.input_bytes) || row.input_bytes < 1 || row.input_bytes > INPUT_BYTES || row.output_token_limit !== OUTPUT_TOKENS || !Number.isSafeInteger(row.reserved_micros) || row.reserved_micros < 0 || row.reserved_micros > 1000000000) fail('invalid_database', 'The workspace contains invalid assistance usage records.');
      }
    }
    if (schemaVersion >= 2) {
      const { inspectImage } = require('./ocr.cjs');
      const sourceIds = db.prepare('SELECT id FROM panel_sources WHERE project_id=? AND business_id=?');
      let panelBytes = 0;
      for (const row of db.prepare('SELECT * FROM panel_projects').iterate()) {
        panels.validateIdempotencyKey(row.idempotency_key);
        const valid = panels.validateProject({ version: row.version, name: row.name, notes: row.notes, rows: readJson(row.rows_json) }, { update: true });
        const known = new Set(sourceIds.all(row.id, row.business_id).map(source => source.id));
        if (!panels.UUID.test(row.id) || !/^[a-f0-9]{64}$/.test(row.request_hash) || known.size > panels.MAX_SOURCES || valid.rows.some(item => item.sourceImageId !== null && !known.has(item.sourceImageId)) || !Number.isSafeInteger(row.created_at) || row.created_at < 0 || !Number.isSafeInteger(row.updated_at) || row.updated_at < row.created_at) fail('invalid_database', 'The workspace contains an invalid panel project.');
        panelBytes += Buffer.byteLength(row.name) + Buffer.byteLength(row.notes) + Buffer.byteLength(row.rows_json);
      }
      if (db.prepare('SELECT 1 FROM panel_projects GROUP BY business_id HAVING count(*)>? LIMIT 1').get(panels.MAX_PROJECTS_PER_BUSINESS)) fail('invalid_database', 'The workspace contains too many panel projects.');
      for (const row of db.prepare('SELECT * FROM panel_sources').iterate()) {
        panels.validateIdempotencyKey(row.idempotency_key);
        if (row.bytes.length > panels.MAX_IMAGE_BYTES) fail('invalid_database', 'The workspace contains an oversized panel source image.');
        const bytes = Buffer.from(row.bytes);
        const valid = panels.validateSource({ version: 1, name: row.name, mime: row.mime, dataBase64: bytes.toString('base64') }, inspectImage);
        const hash = crypto.createHash('sha256').update(bytes).digest('hex');
        const requestHash = crypto.createHash('sha256').update(JSON.stringify({ name: valid.name, mime: valid.mime, hash })).digest('hex');
        if (!panels.UUID.test(row.id) || row.width !== valid.width || row.height !== valid.height || row.name !== valid.name || row.request_hash !== requestHash || !Number.isSafeInteger(row.created_at) || row.created_at < 0) fail('invalid_database', 'The workspace contains an invalid panel source image.');
        panelBytes += bytes.length;
      }
      if (panelBytes > panels.MAX_PANEL_DATA_BYTES) fail('invalid_database', 'The workspace exceeds its panel storage limit.');
    }
  } catch (error) {
    if (error instanceof BackupError) throw error;
    fail('invalid_database', 'The workspace contains a record that failed validation.');
  }
  const count = table => Number(db.prepare('SELECT count(*) AS n FROM ' + table).get().n);
  return { businesses: count('businesses'), users: count('users'), leads: count('leads'), messages: count('messages'), audit: count('audit'), optOuts: count('suppression'), ...(schemaVersion >= 2 ? { panelProjects: count('panel_projects'), panelSources: count('panel_sources') } : {}), ...(schemaVersion >= 3 ? { deletedRecords: count('record_deletions'), deletionOperations: count('deletion_operations'), safetyHolds: count('safety_holds'), assistantUsage: count('assistant_usage') } : {}), ...(schemaVersion >= 4 ? { callbackTasks: count('callback_tasks'), callbackOperations: count('callback_operations') } : {}) };
}

function makeHeader(payloadBytes, schemaVersion, product) {
  const header = Buffer.alloc(HEADER_BYTES);
  MAGIC.copy(header);
  // V1 retains its exact reserved-byte contract. V2 binds an existing product
  // code into the authenticated header; the cipher/KDF and payload stay fixed.
  header.writeUInt16BE(product ? 2 : 1, 8);
  header.writeUInt16BE(schemaVersion, 10); // Actual snapshot schema, independent of archive format.
  header[12] = 1; // AES-256-GCM, 16-byte authentication tag.
  header[13] = 1; // scrypt N32768/r8/p3, 32-byte key.
  if (product) header.writeUInt16BE(PRODUCT_CODES[product], 14);
  header.writeBigUInt64BE(BigInt(Date.now()), 16);
  header.writeBigUInt64BE(BigInt(payloadBytes), 24);
  crypto.randomBytes(16).copy(header, 32);
  crypto.randomBytes(12).copy(header, 48);
  return header;
}
function parseHeader(archive) {
  if (archive.length < HEADER_BYTES + TAG_BYTES + 100 || !archive.subarray(0, 8).equals(MAGIC)) fail('invalid_archive', 'This is not a supported PanelReply encrypted backup.');
  const header = archive.subarray(0, HEADER_BYTES);
  const version = header.readUInt16BE(8), productCode = header.readUInt16BE(14);
  const product = version === 2 ? Object.keys(PRODUCT_CODES).find(key => PRODUCT_CODES[key] === productCode) : null;
  if (![1, 2].includes(version) || ![1, 2, 3, 4].includes(header.readUInt16BE(10)) || header[12] !== 1 || header[13] !== 1
    || (version === 1 ? productCode !== 0 : !product) || header.readUInt32BE(60) !== 0) fail('unsupported_format', 'This archive version or encryption format is not supported.');
  const size = header.readBigUInt64BE(24);
  const timestamp = header.readBigUInt64BE(16);
  if (size < 100n || size > BigInt(MAX_DATABASE_BYTES) || size !== BigInt(archive.length - HEADER_BYTES - TAG_BYTES) || timestamp > 8640000000000000n) fail('invalid_archive', 'The encrypted backup is incomplete or has invalid metadata.');
  return { header, version, product, schemaVersion: header.readUInt16BE(10), createdAt: new Date(Number(timestamp)).toISOString(), size: Number(size) };
}
async function deriveKey(passphrase, header) { return scrypt(passphrase, header.subarray(32, 48), 32, SCRYPT_OPTIONS); }
function normalizedFailure(error, code, message) { return error instanceof BackupError ? error : new BackupError(code, message); }

async function createEncryptedBackup({ dataDir, outputFile, passphrase, product: productOption } = {}) {
  requirePassphrase(passphrase);
  const selected = expectedProduct(productOption);
  const sourceFile = expectedPath(existingDatabasePath, dataDir);
  const product = sourceProduct(dataDir, selected);
  const destination = expectedPath(assertUnusedPath, outputFile);
  const parent = expectedPath(assertPrivateDirectory, path.dirname(destination));
  let temporary, source, snapshot, key, plaintext;
  try {
    source = new DatabaseSync(sourceFile, { ...DB_OPTIONS, readOnly: true });
    source.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=3000;');
    validateDatabase(source);
    const size = databaseSize(source);
    temporary = temporaryDirectory(parent);
    const snapshotFile = path.join(temporary, 'snapshot.sqlite');
    writeExclusive(snapshotFile, Buffer.alloc(0));
    const deadline = Date.now() + 30000;
    await backup(source, snapshotFile, {
      rate: 256,
      progress: ({ totalPages }) => {
        if (totalPages * size.pageSize > MAX_DATABASE_BYTES) fail('size_limit', 'The database exceeds the 64 MiB local recovery limit.');
        if (Date.now() > deadline) fail('workspace_busy', 'The workspace stayed busy during backup. Try again when writes are paused.');
      }
    });
    source.close(); source = null;
    if (fs.statSync(snapshotFile).size > MAX_DATABASE_BYTES) fail('size_limit', 'The database exceeds the 64 MiB local recovery limit.');
    snapshot = new DatabaseSync(snapshotFile, DB_OPTIONS);
    validateDatabase(snapshot);
    snapshot.exec('PRAGMA journal_mode=DELETE; PRAGMA secure_delete=ON; BEGIN IMMEDIATE; DELETE FROM sessions; DELETE FROM login_attempts; COMMIT; VACUUM;');
    const counts = validateDatabase(snapshot);
    const schemaVersion = snapshot.prepare('PRAGMA user_version').get().user_version;
    snapshot.close(); snapshot = null;
    plaintext = readBoundedFile(snapshotFile, MAX_DATABASE_BYTES);
    const header = makeHeader(plaintext.length, schemaVersion, product);
    key = await deriveKey(passphrase, header);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, header.subarray(48, 60), { authTagLength: TAG_BYTES });
    cipher.setAAD(header);
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const archive = Buffer.concat([header, encrypted, cipher.getAuthTag()]);
    const pendingFile = path.join(temporary, 'archive.pending');
    writeExclusive(pendingFile, archive);
    if ((checkedBinding(dataDir)?.product || null) !== product) fail('changed_product_binding', 'The source product binding changed during backup. No archive was published.');
    // link() fails with EEXIST instead of replacing a file created meanwhile.
    fs.linkSync(pendingFile, destination);
    fs.unlinkSync(pendingFile);
    syncDirectory(parent);
    expectedPath(assertPrivateRegularFile, destination);
    return { format: 'panelreply-encrypted-backup', version: product ? 2 : 1, ...(product ? { product } : {}), schemaVersion, createdAt: new Date(Number(header.readBigUInt64BE(16))).toISOString(), archiveBytes: archive.length, counts, sessionsIncluded: false };
  } catch (error) {
    throw normalizedFailure(error, error && error.code === 'EEXIST' ? 'destination_exists' : 'backup_failed', error && error.code === 'EEXIST' ? 'The backup destination already exists. Choose a new file.' : 'The encrypted backup could not be created and verified.');
  } finally {
    key?.fill(0); plaintext?.fill(0);
    source?.close(); snapshot?.close();
    if (temporary) fs.rmSync(temporary, { recursive: true, force: true });
  }
}

async function restoreEncryptedBackup({ backupFile, dataDir, passphrase, product: productOption } = {}) {
  requirePassphrase(passphrase);
  const selected = expectedProduct(productOption);
  const archiveFile = expectedPath(assertPrivateRegularFile, backupFile);
  const destination = expectedPath(assertUnusedPath, dataDir);
  const parent = expectedPath(assertPrivateDirectory, path.dirname(destination));
  let temporary, snapshot, key, plaintext, createdDirectory = false;
  try {
    const archive = readBoundedFile(archiveFile, MAX_ARCHIVE_BYTES);
    const { header, version, product, createdAt, schemaVersion } = parseHeader(archive);
    key = await deriveKey(passphrase, header);
    try {
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, header.subarray(48, 60), { authTagLength: TAG_BYTES });
      decipher.setAAD(header);
      decipher.setAuthTag(archive.subarray(archive.length - TAG_BYTES));
      const partial = decipher.update(archive.subarray(HEADER_BYTES, archive.length - TAG_BYTES));
      try { plaintext = Buffer.concat([partial, decipher.final()]); }
      finally { partial.fill(0); }
    } catch (_) { fail('authentication_failed', 'The backup passphrase is incorrect or the archive failed authentication.'); }
    // Product metadata is trusted only after authenticating the complete AAD.
    // A legacy archive is never reassigned to a release product during restore.
    if (product && !selected) fail('product_required', 'Supply the matching product when restoring a product-bound archive.');
    if (!product && selected) fail('legacy_product_binding_forbidden', 'A legacy unbound archive needs a separately reviewed migration. Restore it only as an unbound recovery copy.');
    if (product && product !== selected) fail('product_mismatch', 'The authenticated archive belongs to another product.');
    // No plaintext file is written until the complete authentication tag passes.
    temporary = temporaryDirectory(parent);
    const snapshotFile = path.join(temporary, 'workspace.sqlite');
    writeExclusive(snapshotFile, plaintext);
    plaintext.fill(0); plaintext = null;
    snapshot = new DatabaseSync(snapshotFile, DB_OPTIONS);
    validateDatabase(snapshot);
    if (snapshot.prepare('PRAGMA user_version').get().user_version !== schemaVersion) fail('invalid_archive', 'The backup schema does not match its authenticated metadata.');
    // Old archives must not revive a password that was changed after backup.
    // Every restored owner needs a local operator reset before sign-in works.
    snapshot.exec('PRAGMA journal_mode=DELETE; PRAGMA secure_delete=ON; BEGIN IMMEDIATE; DELETE FROM sessions; DELETE FROM login_attempts;');
    snapshot.prepare('UPDATE users SET password_hash=?').run(RESTORE_DISABLED_PASSWORD);
    snapshot.exec('COMMIT; VACUUM;');
    const counts = validateDatabase(snapshot);
    snapshot.close(); snapshot = null;
    syncFile(snapshotFile);
    const bindingFile = product ? path.join(temporary, MARKER) : null;
    if (bindingFile) writeExclusive(bindingFile, JSON.stringify(productBinding(product)) + '\n');
    // mkdir without recursive is exclusive: even an existing empty directory is
    // refused. The database hard link also refuses any racing database creator.
    // A product restore stays inaccessible to normal app startup even before
    // its first file is linked. Both apps require exactly 0700, not merely
    // absence of group/other permissions. Only this new directory is changed.
    fs.mkdirSync(destination, { mode: product ? 0o300 : 0o700 });
    createdDirectory = true;
    fs.linkSync(snapshotFile, path.join(destination, 'workspace.sqlite'));
    fs.unlinkSync(snapshotFile);
    if (bindingFile) {
      fs.linkSync(bindingFile, path.join(destination, MARKER));
      fs.unlinkSync(bindingFile);
      // Publish only after the validated database and authenticated marker are
      // both complete regular files with no remaining staging hard link.
      fs.chmodSync(destination, 0o700);
    }
    syncDirectory(destination);
    syncDirectory(parent);
    expectedPath(existingDatabasePath, destination);
    if (product && checkedBinding(destination)?.product !== product) fail('product_mismatch', 'The restored product binding could not be verified.');
    return { restored: true, format: 'panelreply-encrypted-backup', version, ...(product ? { product } : {}), schemaVersion, createdAt, counts, sessionsRestored: false, passwordResetRequired: true, ownersRequiringReset: counts.users };
  } catch (error) {
    // A failed restore never removes a competitor's file or an existing folder.
    if (createdDirectory) {
      try { fs.rmdirSync(destination); } catch (_) { /* Only remove our empty directory. */ }
    }
    throw normalizedFailure(error, error && error.code === 'EEXIST' ? 'destination_exists' : 'restore_failed', error && error.code === 'EEXIST' ? 'The restore destination already exists. Choose a new directory.' : 'The encrypted backup could not be restored and verified.');
  } finally {
    key?.fill(0); plaintext?.fill(0);
    snapshot?.close();
    if (temporary) fs.rmSync(temporary, { recursive: true, force: true });
  }
}

module.exports = { createEncryptedBackup, restoreEncryptedBackup, validateDatabase, validPassphrase, BackupError, MAX_DATABASE_BYTES, MAX_ARCHIVE_BYTES, HEADER_BYTES, TAG_BYTES, RESTORE_DISABLED_PASSWORD };
