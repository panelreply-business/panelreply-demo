'use strict';

// Diagnostic-only sampling. Read status only for children created by this
// wrapper, never inspect other application processes or their environment.
const fs = require('node:fs');
const { spawn } = require('node:child_process');

function readResidentBytes(text) {
  const rss = /^VmRSS:\s+(\d+) kB$/m.exec(text);
  const highWater = /^VmHWM:\s+(\d+) kB$/m.exec(text);
  return Math.max(Number(rss?.[1] || 0), Number(highWater?.[1] || 0)) * 1024;
}

function createProcessSampler() {
  const records = [];
  function spawnProcess(binary, args, options) {
    const child = spawn(binary, args, options);
    const record = { pid: child.pid || null, recognition: args.includes('stdin'), sampledPeakResidentBytes: 0, samples: 0, closed: false };
    records.push(record);
    const sample = () => {
      if (!child.pid) return;
      try {
        const residentBytes = readResidentBytes(fs.readFileSync(`/proc/${child.pid}/status`, 'utf8'));
        if (residentBytes) {
          record.samples += 1;
          record.sampledPeakResidentBytes = Math.max(record.sampledPeakResidentBytes, residentBytes);
        }
      } catch (error) {
        if (!['ENOENT', 'ESRCH', 'EACCES'].includes(error.code)) throw error;
      }
    };
    child.once('spawn', sample);
    const timer = setInterval(sample, 10);
    timer.unref();
    child.once('close', (code, signal) => { clearInterval(timer); record.closed = true; record.exitCode = code; record.signal = signal; });
    return child;
  }
  function summarize(selected = records) {
    return {
      processes: selected.length,
      processesWithSamples: selected.filter(row => row.samples).length,
      samples: selected.reduce((sum, row) => sum + row.samples, 0),
      sampledPeakResidentBytes: selected.length ? Math.max(...selected.map(row => row.sampledPeakResidentBytes)) : 0,
      allClosed: selected.every(row => row.closed),
      samplingIntervalMs: 10,
      scope: 'Linux /proc child VmRSS/VmHWM sampled every 10 ms. Observed lower bound, not a complete kernel peak. Does not sum concurrent descendants. Parent memory is separate.',
    };
  }
  return { spawnProcess, records, summarize };
}

module.exports = { readResidentBytes, createProcessSampler };
