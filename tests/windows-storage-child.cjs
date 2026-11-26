'use strict';

// A real competing process for the exclusive-publication case. This helper has
// no product entry point, provider calls or arbitrary command execution.
const { loadCandidate } = require('../workspace/native/windows-storage/load.cjs');
const candidate = loadCandidate(process.env.PANELREPLY_WINDOWS_COMPONENT_BUILD, {
  sourceCommit: process.env.PANELREPLY_WINDOWS_COMPONENT_COMMIT,
  sourceTreeSha256: process.env.PANELREPLY_WINDOWS_COMPONENT_SOURCE
});
if (!process.send || process.argv[2] !== 'race-create') throw new Error('Use the component test runner IPC protocol.');
const [directory, name, encoded] = process.argv.slice(3);
const bytes = Buffer.from(encoded, 'base64');
const lease = candidate.addon.openPrivateDirectory(directory);
process.send({ ready: true });
process.once('message', message => {
  try {
    if (message !== 'create') throw new Error('Invalid fixture command.');
    const metadata = lease.createFile(name, bytes);
    process.send({ created: true, metadata });
  } catch (error) {
    process.send({ created: false, code: error.code || null, win32Code: error.win32Code ?? null, message: error.message });
  } finally {
    lease.close();
    process.disconnect();
  }
});
