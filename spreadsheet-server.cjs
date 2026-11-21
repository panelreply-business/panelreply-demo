'use strict';

const { separatedWorkspaceConfig, startSeparatedWorkspace, initializeSeparatedWorkspace } = require('./workspace-server.cjs');
const spreadsheetConfig = env => separatedWorkspaceConfig('spreadsheet', env);
const startSpreadsheet = (env, options) => startSeparatedWorkspace('spreadsheet', env, options);
const initializeSpreadsheet = env => initializeSeparatedWorkspace('spreadsheet', env);

if (require.main === module) {
  try {
    const args = process.argv.slice(2);
    if (args.length === 1 && args[0] === '--init') console.log(JSON.stringify(initializeSpreadsheet()));
    else {
      if (args.length) throw new Error('Usage: node spreadsheet-server.cjs [--init]. Product identity is fixed.');
      const spreadsheet = startSpreadsheet();
      process.once('SIGINT', spreadsheet.close);
      process.once('SIGTERM', spreadsheet.close);
    }
  } catch (error) {
    console.error(error && error.message || 'The spreadsheet program could not start.');
    process.exitCode = 1;
  }
}
module.exports = { spreadsheetConfig, startSpreadsheet, initializeSpreadsheet };
