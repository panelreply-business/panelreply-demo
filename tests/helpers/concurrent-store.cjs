'use strict';

const { Worker, isMainThread, parentPort, workerData } = require('node:worker_threads');
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const { openStore } = require('../../workspace/store.cjs');

if (!isMainThread) {
  const { dataDir, task, barrier } = workerData;
  const gate = new Int32Array(barrier);
  if (task.operation === 'uncommitted') {
    const db = new DatabaseSync(path.join(dataDir, 'workspace.sqlite'));
    db.exec('PRAGMA busy_timeout=3000; BEGIN IMMEDIATE');
    db.prepare('UPDATE panel_projects SET notes=? WHERE id=? AND business_id=?').run('UNCOMMITTED SYNTHETIC NOTE', task.id, task.actor.businessId);
    parentPort.postMessage({ type: 'uncommitted' });
    // Parent terminates the worker while this real connection owns a write.
    // A bounded timeout prevents a stranded test worker if the parent fails.
    Atomics.wait(gate, 0, 0, 10_000);
    db.exec('ROLLBACK');
    db.close();
  } else {
    let store;
    try {
      store = openStore({ dataDir, create: false });
      parentPort.postMessage({ type: 'ready' });
      if (Atomics.wait(gate, 0, 0, 10_000) === 'timed-out') throw new Error('BARRIER_TIMEOUT');
      let result;
      if (task.operation === 'createProject') result = store.createPanelProject(task.actor, task.input, task.key);
      else if (task.operation === 'createLead') result = store.createLead(task.actor, task.input, task.key);
      else if (task.operation === 'updateProject') result = store.updatePanelProject(task.actor, task.id, task.input);
      else if (task.operation === 'addSource') result = store.addPanelSource(task.actor, task.id, task.input, task.key);
      else throw new Error('UNSUPPORTED_TEST_OPERATION');
      parentPort.postMessage({ type: 'result', ok: true, result });
    } catch (error) { parentPort.postMessage({ type: 'result', ok: false, code: error.code || error.message }); }
    finally { store?.close(); }
  }
}

async function runConcurrent(dataDir, tasks) {
  if (!isMainThread || !Array.isArray(tasks) || tasks.length < 1 || tasks.length > 8) throw new Error('Use one to eight isolated test workers.');
  const barrier = new SharedArrayBuffer(4), gate = new Int32Array(barrier), workers = [];
  const readiness = [], results = [], exits = [];
  try {
    for (const task of tasks) {
      const worker = new Worker(__filename, { workerData: { dataDir, task, barrier } });
      workers.push(worker);
      let markReady, rejectReady, resolveResult, rejectResult, seenResult = false;
      readiness.push(new Promise((resolve, reject) => { markReady = resolve; rejectReady = reject; }));
      results.push(new Promise((resolve, reject) => { resolveResult = resolve; rejectResult = reject; }));
      // Both readiness and result promises get handlers immediately so an early
      // worker initialization failure never creates an unhandled rejection.
      readiness.at(-1).catch(() => {});
      results.at(-1).catch(() => {});
      const timer = setTimeout(() => { const error = new Error('Concurrent test worker timed out.'); rejectReady(error); rejectResult(error); worker.terminate(); }, 15_000);
      worker.on('message', message => {
        if (message.type === 'ready') markReady();
        if (message.type === 'result') { seenResult = true; if (!message.ok) markReady(); resolveResult(message); }
      });
      worker.once('error', error => { rejectReady(error); rejectResult(error); });
      exits.push(new Promise(resolve => worker.once('exit', code => {
        clearTimeout(timer);
        if (!seenResult) { const error = new Error('Concurrent test worker exited before returning a result: ' + code); rejectReady(error); rejectResult(error); }
        resolve(code);
      })));
    }
    await Promise.all(readiness);
    Atomics.store(gate, 0, 1);
    Atomics.notify(gate, 0, workers.length);
    const result = await Promise.all(results);
    await Promise.all(exits);
    return result;
  } finally { await Promise.allSettled(workers.map(worker => worker.terminate())); }
}

module.exports = { runConcurrent };
