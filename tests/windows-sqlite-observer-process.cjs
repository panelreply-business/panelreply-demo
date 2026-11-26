'use strict';

const path = require('node:path');
const crypto = require('node:crypto');
const { fork } = require('node:child_process');
const CHILD = path.join(__dirname, 'windows-sqlite-observer-child.cjs');

function spawnObserver(config, options = {}) {
  const nonce = crypto.randomBytes(16).toString('hex');
  const child = fork(CHILD, [JSON.stringify({ ...config, nonce })], { execPath: process.execPath, execArgv: [],
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true,
    env: { ...process.env, NODE_OPTIONS: '', NODE_PATH: '', SQLITE_TMPDIR: config.directory } });
  const record = { role: config.role, pid: child.pid || null, startedAt: new Date().toISOString(),
    stdout: '', stderr: '', messages: [], tokenObservations: [], exit: null, cleanup: { status: 'NOT_RUN' } };
  let pending = null, nextSequence = 0, failure = null, intendedExit = false;
  let resolveClosed;
  const closed = new Promise(resolve => { resolveClosed = resolve; });
  const messageLimit = 16, outputLimit = 65536;
  function reject(error) {
    failure ||= error;
    if (pending) { const current = pending; pending = null; clearTimeout(current.timer); current.reject(error); }
  }
  const lifetime = setTimeout(() => reject(new Error('The owned SQLite observation child exceeded its lifetime.')), options.lifetimeMs || 45000);
  lifetime.unref();
  function observeOutput(name, bytes) {
    const next = record[name] + String(bytes);
    record[name] = next.slice(0, outputLimit);
    if (next.length > outputLimit) { record[name + 'Truncated'] = true; reject(new Error('The observation child exceeded its ' + name + ' bound.')); }
  }
  child.stdout.on('data', bytes => observeOutput('stdout', bytes));
  child.stderr.on('data', bytes => observeOutput('stderr', bytes));
  child.once('error', error => { record.spawnError = String(error.message).slice(0, 2000); reject(error); });
  child.once('exit', (code, signal) => {
    clearTimeout(lifetime);
    record.exit = { code, signal, observedAt: new Date().toISOString() };
    if (pending || !intendedExit) reject(new Error('The owned SQLite child exited before the expected protocol completion.'));
  });
  child.once('close', (code, signal) => {
    clearTimeout(lifetime);
    record.closed = { code, signal, observedAt: new Date().toISOString() };
    resolveClosed(record.exit || record.closed);
  });
  child.on('message', message => {
    let size;
    try { size = JSON.stringify(message).length; } catch { reject(new Error('The observation child emitted invalid IPC.')); return; }
    if (size > 65536 || record.messages.length >= messageLimit) { reject(new Error('The observation child exceeded its IPC bound.')); return; }
    record.messages.push(message);
    if (!message || message.nonce !== nonce || !pending || message.sequence !== pending.sequence
        || (message.type !== pending.type && message.type !== 'error')) {
      reject(new Error('The observation child emitted an unexpected or repeated phase.')); return;
    }
    if (message.type === 'error') { reject(new Error('The SQLite child reported: ' + (message.error?.message || 'unknown error'))); return; }
    const current = pending; pending = null; clearTimeout(current.timer); current.resolve(message);
  });
  function live() {
    if (failure) throw failure;
    if (record.exit || child.exitCode !== null || child.signalCode !== null || !child.pid) throw new Error('The owned SQLite child is no longer live.');
  }
  function wait(type, sequence, timeout) {
    if (pending) throw new Error('Only one observation command may be outstanding.');
    return new Promise((resolve, rejectPending) => {
      pending = { type, sequence, resolve, reject: rejectPending,
        timer: setTimeout(() => reject(new Error('The owned SQLite child did not reach phase: ' + type)), timeout) };
    });
  }
  const ready = wait('ready', 0, options.readyTimeoutMs || 10000);
  function request(command, type) {
    live();
    const sequence = ++nextSequence;
    const result = wait(type, sequence, options.phaseTimeoutMs || 6000);
    if (command === 'exit') intendedExit = true;
    try { child.send({ nonce, sequence, command }, error => { if (error) reject(error); }); }
    catch (error) { reject(error); }
    return result;
  }
  async function waitExit(timeout = 3000) {
    if (record.closed) return record.exit || record.closed;
    let timer;
    try { return await Promise.race([closed, new Promise((_, rejectWait) => { timer = setTimeout(() => rejectWait(new Error('The owned SQLite child did not exit within its bound.')), timeout); })]); }
    finally { clearTimeout(timer); }
  }
  async function terminate(reason) {
    if (record.exit || record.closed) return waitExit();
    intendedExit = true;
    record.termination = { reason, requestedAt: new Date().toISOString(), signal: 'SIGKILL' };
    // This exact ChildProcess retains the process launched for this scenario.
    // Never find another process by PID/name, run taskkill, or change rights.
    record.termination.requestAccepted = child.kill('SIGKILL');
    const result = await waitExit();
    if (!record.termination.requestAccepted) throw new Error('Termination was not accepted for the still-owned SQLite child.');
    return result;
  }
  async function cleanup() {
    try {
      if (!record.exit && !record.closed) await terminate('bounded fixture cleanup');
      else await waitExit();
      record.cleanup = { status: 'OBSERVED', exited: record.exit, closed: record.closed };
    } catch (error) {
      record.cleanup = { status: 'ERROR', message: String(error.message).slice(0, 2000) };
      // Do not let a broken child prevent publication of its cleanup failure.
      // Disconnect asks only this fixed child to close its DB. Its final exit
      // remains unverified; callers must retain the fixture and report error.
      if (child.connected) child.disconnect();
      child.stdout.destroy(); child.stderr.destroy(); child.unref();
    } finally { clearTimeout(lifetime); }
    return record.cleanup;
  }
  return { child, record, ready, request, live, waitExit, terminate, cleanup };
}

module.exports = { spawnObserver, CHILD };
