'use strict';

const { separatedWorkspaceConfig, startSeparatedWorkspace, initializeSeparatedWorkspace } = require('./workspace-server.cjs');
const callbackConfig = env => separatedWorkspaceConfig('callback', env);
const startCallback = (env, options) => startSeparatedWorkspace('callback', env, options);
const initializeCallback = env => initializeSeparatedWorkspace('callback', env);

if (require.main === module) {
  try {
    const args = process.argv.slice(2);
    if (args.length === 1 && args[0] === '--init') console.log(JSON.stringify(initializeCallback()));
    else {
      if (args.length) throw new Error('Usage: node callback-server.cjs [--init]. Product identity is fixed.');
      const callback = startCallback();
      process.once('SIGINT', callback.close);
      process.once('SIGTERM', callback.close);
    }
  } catch (error) {
    console.error(error && error.message || 'The callback program could not start.');
    process.exitCode = 1;
  }
}
module.exports = { callbackConfig, startCallback, initializeCallback };
