'use strict';

const fs = require('node:fs');
const path = require('node:path');

// These helpers protect operator-managed local paths. They do not grant access
// to a path, change an existing directory's permissions, or replace any file.
function absolutePath(value) {
  if (typeof value !== 'string' || !value || value.includes('\0') || !path.isAbsolute(value)) {
    throw new Error('Use an absolute local path.');
  }
  return path.resolve(value);
}

function maybeStat(filename) {
  try { return fs.lstatSync(filename); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

function assertNoLinkedComponents(filename) {
  const resolved = absolutePath(filename);
  let cursor = path.parse(resolved).root;
  const parts = resolved.slice(cursor.length).split(path.sep).filter(Boolean);
  for (let index = 0; index < parts.length; index += 1) {
    cursor = path.join(cursor, parts[index]);
    const stat = maybeStat(cursor);
    if (!stat) break;
    if (stat.isSymbolicLink()) throw new Error('Workspace paths must not contain symbolic links.');
    if (index < parts.length - 1 && !stat.isDirectory()) throw new Error('A workspace path component is not a directory.');
  }
  return resolved;
}

function ownedByCurrentUser(stat) {
  return typeof process.getuid !== 'function' || stat.uid === process.getuid();
}

function assertPrivateDirectory(directory, { create = false } = {}) {
  const resolved = assertNoLinkedComponents(directory);
  if (create && !maybeStat(resolved)) fs.mkdirSync(resolved, { recursive: true, mode: 0o700 });
  assertNoLinkedComponents(resolved);
  const stat = maybeStat(resolved);
  if (!stat || !stat.isDirectory()) throw new Error('The private workspace directory must already exist.');
  if (!ownedByCurrentUser(stat)) throw new Error('The private workspace directory must be owned by the current user.');
  if ((stat.mode & 0o777) !== 0o700) throw new Error('The private workspace directory must have owner-only permissions (0700).');
  return resolved;
}

function assertPrivateRegularFile(filename) {
  const resolved = assertNoLinkedComponents(filename);
  const stat = maybeStat(resolved);
  if (!stat || !stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) {
    throw new Error('Use an existing regular file without symbolic or hard links.');
  }
  if (!ownedByCurrentUser(stat)) throw new Error('The private file must be owned by the current user.');
  if (![0o600, 0o400].includes(stat.mode & 0o777)) throw new Error('The private file must have owner-only read permissions (0600 or 0400).');
  return resolved;
}

function existingDatabasePath(dataDir) {
  const directory = assertPrivateDirectory(dataDir);
  const filename = assertPrivateRegularFile(path.join(directory, 'workspace.sqlite'));
  for (const suffix of ['-wal', '-shm', '-journal']) {
    const sidecar = filename + suffix;
    if (maybeStat(sidecar)) assertPrivateRegularFile(sidecar);
  }
  return filename;
}

function assertUnusedPath(filename) {
  const resolved = assertNoLinkedComponents(filename);
  if (maybeStat(resolved)) throw new Error('The destination already exists. Choose a new path.');
  return resolved;
}

module.exports = { absolutePath, assertNoLinkedComponents, assertPrivateDirectory, assertPrivateRegularFile, existingDatabasePath, assertUnusedPath };
