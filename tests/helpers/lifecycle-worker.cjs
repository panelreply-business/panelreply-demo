'use strict';

// Synthetic fault-injection helper. It is never imported by application code.
const { parentPort, workerData } = require('node:worker_threads');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

function pause(stage) { parentPort.postMessage({ stage }); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 15000); throw new Error('Synthetic interruption test timed out.'); }

if (workerData.mode === 'uncommitted-delete') {
  const db = new DatabaseSync(path.join(workerData.dataDir, 'workspace.sqlite'));
  db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=3000; BEGIN IMMEDIATE');
  db.prepare('DELETE FROM messages WHERE lead_id=? AND business_id=?').run(workerData.id, workerData.actor.businessId);
  db.prepare('DELETE FROM audit WHERE lead_id=? AND business_id=?').run(workerData.id, workerData.actor.businessId);
  db.prepare('DELETE FROM leads WHERE id=? AND business_id=?').run(workerData.id, workerData.actor.businessId);
  pause('uncommitted-delete');
} else if (workerData.mode === 'restore') {
  const link = fs.linkSync, unlink = fs.unlinkSync;
  let stagedFile;
  fs.linkSync = (source, destination) => {
    if (destination === path.join(workerData.target, 'workspace.sqlite')) {
      stagedFile = source;
      if (workerData.stage === 'before-publication') pause('before-publication');
      link(source, destination);
      if (workerData.stage === 'after-link') pause('after-link');
      return;
    }
    return link(source, destination);
  };
  fs.unlinkSync = filename => {
    const result = unlink(filename);
    if (filename === stagedFile && workerData.stage === 'after-unlink') pause('after-unlink');
    return result;
  };
  require('../../workspace/backup.cjs').restoreEncryptedBackup({ backupFile: workerData.archive, dataDir: workerData.target, passphrase: workerData.passphrase }).then(() => parentPort.postMessage({ unexpectedCompletion: true }), error => parentPort.postMessage({ error: error.code || error.message }));
} else throw new Error('Unsupported synthetic lifecycle operation.');
