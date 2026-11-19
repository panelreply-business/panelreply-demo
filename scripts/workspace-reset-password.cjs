'use strict';

const { openStore, StoreError, username } = require('../workspace/store.cjs');
const { hashPassword } = require('../workspace/auth.cjs');
const { existingDatabasePath } = require('../workspace/file-safety.cjs');
const { readPassword } = require('./workspace-admin.cjs');

class RecoveryInputError extends Error {}

function parseArgs(args) {
  const options = {};
  if (!Array.isArray(args) || args.length !== 4) throw new RecoveryInputError('Usage: node scripts/workspace-reset-password.cjs --data-dir /absolute/private/path --username existing-owner. Supply a new 15–128 character password through stdin.');
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index], value = args[index + 1];
    if (!['--data-dir', '--username'].includes(key) || Object.hasOwn(options, key) || typeof value !== 'string' || !value || value.startsWith('--')) throw new RecoveryInputError('Use each supported option once. Passwords are accepted only through stdin.');
    options[key] = value;
  }
  return { dataDir: options['--data-dir'], username: username(options['--username']) };
}

async function main(args = process.argv.slice(2), input = process.stdin) {
  const config = parseArgs(args);
  // Recovery must never turn a typo or an empty directory into a new workspace.
  try { existingDatabasePath(config.dataDir); }
  catch (_) { throw new RecoveryInputError('Use an existing owner-only workspace data directory. No database was created.'); }
  let store;
  try { store = openStore({ dataDir: config.dataDir, create: false }); }
  catch (_) { throw new RecoveryInputError('The existing workspace database could not be opened with a supported schema. No recovery was applied.'); }
  try {
    if (!store.findUser(config.username)) throw new StoreError(404, 'owner_not_found', 'The local owner was not found. No account was created.');
    let password;
    try { password = await readPassword(input); }
    catch (_) { throw new RecoveryInputError('Supply a new 15–128 character password through stdin without control characters. Password arguments and environment variables are not supported.'); }
    const passwordHash = await hashPassword(password);
    password = undefined;
    return store.resetOwnerPassword({ username: config.username, passwordHash });
  } finally { store.close(); }
}

function publicError(error) {
  return error instanceof RecoveryInputError || error instanceof StoreError
    ? error.message : 'The local owner could not be recovered. Check the workspace and try again.';
}

if (require.main === module) main().then(result => console.log(JSON.stringify(result))).catch(error => {
  console.error(publicError(error));
  process.exitCode = 1;
});

module.exports = { main, parseArgs, publicError, RecoveryInputError };
