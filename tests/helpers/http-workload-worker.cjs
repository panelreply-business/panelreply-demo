'use strict';
const { workerData, parentPort, isMainThread } = require('node:worker_threads');
const { DatabaseSync } = require('node:sqlite');
if (isMainThread || process.env.CI !== 'true' || process.env.PANELREPLY_HTTP_STRESS !== '1') throw new Error('CI workload worker only.');
const db = new DatabaseSync(workerData.filename);
try {
  db.exec('PRAGMA busy_timeout=3000; BEGIN IMMEDIATE');
  const lockedAt = Date.now();
  parentPort.postMessage({ locked: true });
  if (Atomics.wait(new Int32Array(workerData.barrier), 0, 0, 5000) === 'timed-out') throw new Error('No HTTP request reached the lock barrier.');
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 350);
  db.exec('ROLLBACK');
  parentPort.postMessage({ lockedAt, releasedAt: Date.now() });
} finally { db.close(); }
