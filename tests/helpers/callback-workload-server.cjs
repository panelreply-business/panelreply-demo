'use strict';
const { monitorEventLoopDelay } = require('node:perf_hooks');
const path = require('node:path');
const { startSeparatedWorkspace } = require(path.join(process.env.PANELREPLY_BENCHMARK_ROOT || path.resolve(__dirname, '../..'), 'workspace-server.cjs'));
const histogram = monitorEventLoopDelay({ resolution: 10 }); histogram.enable();
const workspace = startSeparatedWorkspace('callback', process.env);
workspace.server.on('listening', () => process.send?.({ event: 'listening', address: workspace.server.address() }));
process.on('message', async message => {
  if (message.type === 'metrics') { process.send?.({ event: 'metrics', id: message.id, memory: process.memoryUsage(), usage: process.resourceUsage(), eventLoop: { minMs: histogram.min / 1e6, maxMs: histogram.max / 1e6, meanMs: histogram.mean / 1e6, p99Ms: histogram.percentile(99) / 1e6 } }); histogram.reset(); }
  if (message.type === 'stop') { histogram.disable(); await workspace.close(); process.exit(0); }
});
process.on('SIGTERM', async () => { histogram.disable(); await workspace.close(); process.exit(0); });
