'use strict';

const { openStore } = require('../workspace/store.cjs');
const { hashPassword, validPassword } = require('../workspace/auth.cjs');

function parseArgs(args) {
  const valid = ['--data-dir', '--business', '--username'];
  const parsed = {};
  if (args.length !== 6) throw new Error('Usage: node scripts/workspace-admin.cjs --data-dir /absolute/private/path --business "Business name" --username owner-name. Supply a 15–128 character password through stdin.');
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i], value = args[i + 1];
    if (!valid.includes(key) || Object.hasOwn(parsed, key) || typeof value !== 'string' || !value || value.startsWith('--')) throw new Error('Use each supported option once. Passwords are accepted only through stdin.');
    parsed[key] = value;
  }
  return { dataDir: parsed['--data-dir'], businessName: parsed['--business'], username: parsed['--username'] };
}

async function readPassword(input) {
  if (input.isTTY) throw new Error('Supply the password through stdin from a secure prompt or password manager. Password arguments and environment variables are not supported.');
  const chunks = []; let bytes = 0;
  for await (const chunk of input) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > 1024) throw new Error('The password input was not accepted.');
    chunks.push(buffer);
  }
  let password;
  try { password = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)).replace(/\r?\n$/, ''); }
  catch (_) { throw new Error('The password input was not accepted.'); }
  if (!validPassword(password)) throw new Error('Use a password of 15–128 characters without line breaks or control characters.');
  return password;
}

async function main(args = process.argv.slice(2), input = process.stdin) {
  const config = parseArgs(args);
  const passwordHash = await hashPassword(await readPassword(input));
  const store = openStore({ dataDir: config.dataDir });
  try {
    const user = store.createBusinessOwner({ ...config, passwordHash });
    return { businessId: user.businessId, userId: user.id, username: user.username };
  } finally { store.close(); }
}

if (require.main === module) main().then(result => console.log(JSON.stringify(result))).catch(error => {
  console.error(error && error.message || 'The local owner could not be created.');
  process.exitCode = 1;
});

module.exports = { main, parseArgs, readPassword };
