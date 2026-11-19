'use strict';

const { createEncryptedBackup, restoreEncryptedBackup, validPassphrase, BackupError } = require('../workspace/backup.cjs');

class BackupInputError extends Error {}

function parseArgs(args) {
  const [command, ...flags] = args;
  const allowed = command === 'create' ? ['--data-dir', '--output'] : command === 'restore' ? ['--backup', '--data-dir'] : [];
  if (!allowed.length || flags.length !== 4) throw new BackupInputError('Usage: workspace-backup.cjs create --data-dir ABSOLUTE_PATH --output NEW_ARCHIVE, or restore --backup ARCHIVE --data-dir NEW_DIRECTORY. Supply the passphrase through stdin.');
  const values = {};
  for (let index = 0; index < flags.length; index += 2) {
    const key = flags[index], value = flags[index + 1];
    if (!allowed.includes(key) || Object.hasOwn(values, key) || typeof value !== 'string' || !value || value.startsWith('--')) throw new BackupInputError('Use each supported option once. Passphrases are accepted only through stdin.');
    values[key] = value;
  }
  return command === 'create' ? { command, dataDir: values['--data-dir'], outputFile: values['--output'] }
    : { command, backupFile: values['--backup'], dataDir: values['--data-dir'] };
}

async function readPassphrase(input) {
  if (input.isTTY) throw new BackupInputError('Supply the passphrase through stdin from a secure prompt. Passphrase arguments and environment variables are not supported.');
  const chunks = []; let length = 0;
  for await (const chunk of input) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += buffer.length;
    if (length > 1024) throw new BackupInputError('The passphrase input was not accepted.');
    chunks.push(buffer);
  }
  let passphrase;
  try { passphrase = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)).replace(/\r?\n$/, ''); }
  catch (_) { throw new BackupInputError('The passphrase input was not accepted.'); }
  if (!validPassphrase(passphrase)) throw new BackupInputError('Use a backup passphrase of 15–128 characters without control characters.');
  return passphrase;
}

async function main(args = process.argv.slice(2), input = process.stdin) {
  const { command, ...config } = parseArgs(args);
  const passphrase = await readPassphrase(input);
  const result = command === 'create' ? await createEncryptedBackup({ ...config, passphrase }) : await restoreEncryptedBackup({ ...config, passphrase });
  return { operation: command, ...result };
}

if (require.main === module) main().then(result => console.log(JSON.stringify(result))).catch(error => {
  console.error(error instanceof BackupError || error instanceof BackupInputError ? error.message : 'The recovery operation could not be completed.');
  process.exitCode = 1;
});

module.exports = { main, parseArgs, readPassphrase };
