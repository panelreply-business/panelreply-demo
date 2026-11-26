'use strict';
const { parentPort, workerData } = require('node:worker_threads');
const { openStore } = require('../../workspace/store.cjs');
const store = openStore({ dataDir: workerData.dir, create: false, now: () => workerData.now });
parentPort.postMessage({ ready: true });
Atomics.wait(new Int32Array(workerData.shared), 0, 0);
try {
  const reservation = store.reserveAssistantUsage(workerData.actor, workerData.hash, workerData.input, workerData.policy);
  parentPort.postMessage({ result: { ok: true, id: reservation.id } });
} catch (error) { parentPort.postMessage({ result: { ok: false, code: error.code || 'unexpected_error' } }); }
finally { store.close(); }
