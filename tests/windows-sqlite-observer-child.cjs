'use strict';

// Fixed synthetic SQLite protocol. No application modules, arbitrary SQL,
// network, token changes or permission repairs. Its only descendant is the
// verified query-only native helper for observing this child's primary token.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { fixture } = require('./windows-storage-support.cjs');
const { DATABASE, rowsFor, rowsDigest } = require('./windows-sqlite-observation-support.cjs');

let db = null, config = null, sequence = 0, state = 'starting', failed = false;
function send(message, done) {
  if (!process.connected || JSON.stringify(message).length > 65536) throw new Error('The bounded observation IPC channel is unavailable.');
  process.send({ nonce: config.nonce, sequence, ...message }, error => {
    if (error) { process.exitCode = 1; process.disconnect?.(); }
    else done?.();
  });
}
function fail(error) {
  if (failed) return;
  failed = true;
  const detail = { message: String(error.message || error).slice(0, 2000), code: error.code || null };
  try { db?.close(); } catch (closeError) { detail.closeError = String(closeError.message).slice(0, 1000); }
  db = null; process.exitCode = 1;
  if (config && process.connected) send({ type: 'error', state, error: detail }, () => process.disconnect());
  else { process.stderr.write(JSON.stringify(detail) + '\n'); process.disconnect?.(); }
}
function snapshot() {
  const rows = db.prepare('SELECT id,payload FROM entries ORDER BY id').all().map(row => ({ id: row.id, payload: row.payload }));
  const check = db.prepare('PRAGMA integrity_check').all();
  return { rows: rows.length, ids: rows.map(row => row.id), sha256: rowsDigest(rows),
    integrity: check.length === 1 ? check[0].integrity_check : 'unexpected integrity result' };
}
function pragma(name) { return Object.values(db.prepare('PRAGMA ' + name).get())[0]; }
function open() {
  const filename = path.join(config.directory, DATABASE);
  if (config.role === 'recovery' && !fs.statSync(filename).isFile()) throw new Error('Recovery requires the existing main database.');
  db = new DatabaseSync(filename, { enableForeignKeyConstraints: true, enableDoubleQuotedStringLiterals: false, allowExtension: false });
  db.exec('PRAGMA trusted_schema=OFF; PRAGMA temp_store=MEMORY; PRAGMA synchronous=FULL; PRAGMA busy_timeout=1000;');
  if (config.role === 'writer') db.exec('PRAGMA page_size=4096; PRAGMA cache_size=8; PRAGMA cache_spill=ON; PRAGMA journal_mode=' + config.mode + '; PRAGMA wal_autocheckpoint=0;');
  const mode = pragma('journal_mode');
  if (mode !== config.mode.toLowerCase()) throw new Error('SQLite did not enter the requested journal mode.');
  const sqlite = db.prepare('SELECT sqlite_version() AS version,sqlite_source_id() AS sourceId').get();
  if (sqlite.version !== process.versions.sqlite || typeof sqlite.sourceId !== 'string' || !sqlite.sourceId) throw new Error('SQLite runtime version observations disagree.');
  return { sqlite: { ...sqlite }, pragmas: Object.fromEntries(['journal_mode', 'locking_mode', 'page_size', 'cache_size', 'cache_spill',
    'temp_store', 'synchronous', 'wal_autocheckpoint', 'foreign_keys', 'trusted_schema'].map(name => [name, pragma(name)])) };
}
function command(message) {
  if (!message || Object.keys(message).sort().join(',') !== 'command,nonce,sequence' || message.nonce !== config.nonce
      || message.sequence !== sequence + 1 || typeof message.command !== 'string') throw new Error('Invalid or repeated observation command.');
  sequence = message.sequence;
  if (message.command === 'open' && state === 'ready') {
    const details = open();
    state = config.role === 'writer' ? 'opened' : 'reopened';
    send({ type: state, ...details, ...(config.role === 'recovery' ? { data: snapshot() } : {}) });
  } else if (message.command === 'baseline' && state === 'opened' && config.role === 'writer') {
    db.exec('BEGIN IMMEDIATE; CREATE TABLE entries (id INTEGER PRIMARY KEY,payload TEXT NOT NULL) STRICT;');
    const insert = db.prepare('INSERT INTO entries(id,payload) VALUES(?,?)');
    for (const row of rowsFor('baseline')) insert.run(row.id, row.payload);
    db.exec('COMMIT'); state = 'baseline-committed'; send({ type: state, data: snapshot() });
  } else if (message.command === 'begin' && state === 'baseline-committed') {
    db.exec('BEGIN IMMEDIATE');
    const update = db.prepare('INSERT INTO entries(id,payload) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload');
    for (const row of rowsFor('committed')) update.run(row.id, row.payload);
    state = 'transaction-open'; send({ type: state, data: snapshot() });
  } else if (message.command === 'commit' && state === 'transaction-open') {
    db.exec('COMMIT'); state = 'committed'; send({ type: state, data: snapshot() });
  } else if (message.command === 'close' && ['committed', 'reopened'].includes(state)) {
    db.close(); db = null; state = 'closed'; send({ type: state });
  } else if (message.command === 'exit' && state === 'closed') {
    state = 'exiting'; send({ type: state }, () => process.disconnect());
  } else throw new Error('The observation command does not follow the fixed SQLite protocol.');
}

try {
  if (!process.send || process.argv.length !== 3 || process.argv[2].length > 16384) throw new Error('Use the bounded observation parent IPC protocol.');
  config = JSON.parse(process.argv[2]);
  if (!config || Object.keys(config).sort().join(',') !== 'directory,fixtureExecutable,mode,nonce,role'
      || !path.isAbsolute(config.directory) || !['DELETE', 'WAL'].includes(config.mode)
      || !['writer', 'recovery'].includes(config.role) || !/^[a-f0-9]{32}$/.test(config.nonce)
      || !(config.fixtureExecutable === null || (typeof config.fixtureExecutable === 'string' && path.isAbsolute(config.fixtureExecutable)))) {
    throw new Error('Invalid fixed SQLite observation configuration.');
  }
  const stat = fs.lstatSync(config.directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('The observation directory is not an existing ordinary fixture.');
  const node = { pid: process.pid, execPath: process.execPath, version: process.versions.node, sqlite: process.versions.sqlite, platform: process.platform,
    architecture: process.arch, sha256: crypto.createHash('sha256').update(fs.readFileSync(process.execPath)).digest('hex') };
  // The child stays alive and owns this IPC channel after the helper query.
  // Its returned creation identity is rechecked independently by the parent.
  const token = config.fixtureExecutable ? fixture(config.fixtureExecutable, ['process-token', String(process.pid)]) : null;
  if (process.platform === 'win32' && !token) throw new Error('Windows observations require actual process-token metadata.');
  process.on('message', message => { try { command(message); } catch (error) { fail(error); } });
  process.on('disconnect', () => {
    if (db) { try { db.close(); } catch { process.exitCode = 1; } }
    db = null;
    if (state !== 'exiting' && !failed) process.exitCode = 1;
  });
  state = 'ready'; send({ type: 'ready', node, token, portableHarness: !config.fixtureExecutable });
} catch (error) { fail(error); }
