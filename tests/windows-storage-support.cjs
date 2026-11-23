'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawn } = require('node:child_process');

function fixture(executable, args, options = {}) {
  let output;
  try {
    output = execFileSync(executable, args, { encoding: 'utf8', timeout: 5000, maxBuffer: 1024 * 1024,
      windowsHide: true, env: options.env || process.env });
  } catch (error) {
    // The native helper writes its diagnostic to stdout before exiting with 2.
    // Preserve that observation even when this call requires success. The test
    // runner otherwise retains only execFileSync's command/exit message.
    let result;
    if (error.status === 2 && typeof error.stdout === 'string'
        && Buffer.byteLength(error.stdout) <= 65536) {
      try { result = JSON.parse(error.stdout); } catch { /* Keep the original process failure. */ }
    }
    if (result && typeof result.error === 'string' && result.error.length > 0 && result.error.length <= 4096
        && Number.isInteger(result.win32Code) && result.win32Code >= 0 && result.win32Code <= 0xffffffff) {
      if (options.allowFailure) return result;
      error.message += '\nNative fixture: ' + result.error + ' (Windows ' + result.win32Code + ')';
      error.win32Code = result.win32Code;
      error.fixtureDiagnostic = result.error;
    }
    throw error;
  }
  return JSON.parse(output);
}

function selectNtfsParent(executable) {
  const candidates = [...new Set([os.tmpdir(), process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Temp')].filter(Boolean))];
  const attempts = [];
  for (const candidate of candidates) {
    try {
      const observed = fixture(executable, ['info', candidate]);
      attempts.push({ path: candidate, observed });
      if (observed.filesystem !== 'NTFS' || observed.persistentAcls !== true || observed.volumeType !== 3
          || typeof observed.canonicalPath !== 'string' || !/^\\\\\?\\[A-Za-z]:\\/.test(observed.canonicalPath)
          || !observed.volumeGuidPath.startsWith('\\\\?\\Volume{')) continue;
      const canonicalPath = observed.canonicalPath.slice(4);
      if (!fs.statSync(canonicalPath).isDirectory()) continue;
      return { path: canonicalPath, observed, attempts };
    } catch (error) { attempts.push({ path: candidate, error: String(error.message).slice(0, 2000) }); }
  }
  const error = new Error('No ordinary temporary directory was observed on a fixed local NTFS volume with persistent ACLs.');
  error.attempts = attempts;
  throw error;
}

async function stopChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.stdin?.end();
  await new Promise(resolve => {
    const timer = setTimeout(resolve, 150);
    child.once('exit', () => { clearTimeout(timer); resolve(); });
  });
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill();
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('A disposable native helper did not exit after termination.')), 3000);
    child.once('exit', () => { clearTimeout(timer); resolve(); });
  });
}

async function startFixture(executable, args) {
  const child = spawn(executable, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  let stdout = '', stderr = '';
  const ready = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('A disposable native helper did not become ready.')), 5000);
    const fail = error => { clearTimeout(timer); reject(error); };
    child.once('error', fail);
    child.once('exit', code => fail(new Error('The disposable helper exited before readiness: ' + code + ' ' + stderr)));
    child.stderr.on('data', bytes => {
      stderr += String(bytes);
      if (stderr.length > 65536) fail(new Error('The disposable helper exceeded its stderr bound.'));
    });
    child.stdout.on('data', bytes => {
      stdout += String(bytes);
      if (stdout.length > 1024 * 1024) return fail(new Error('The disposable helper exceeded its stdout bound.'));
      const end = stdout.indexOf('\n');
      if (end < 0) return;
      try {
        const result = JSON.parse(stdout.slice(0, end));
        if (result.ready !== true) throw new Error('The disposable helper did not report readiness.');
        clearTimeout(timer); resolve(result);
      } catch (error) { fail(error); }
    });
  }).catch(async error => { await stopChild(child); throw error; });
  return { child, ready, stop: () => stopChild(child) };
}

module.exports = { fixture, selectNtfsParent, startFixture, stopChild };
