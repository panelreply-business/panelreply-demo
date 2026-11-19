'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { assertPrivateDirectory, assertPrivateRegularFile, existingDatabasePath, assertUnusedPath } = require('../workspace/file-safety.cjs');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'panelreply-file-safety-'));
  fs.chmodSync(root, 0o700);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test('private directory checks create only on request and never repair existing permissions', t => {
  const root = fixture(t), directory = path.join(root, 'data');
  assert.throws(() => assertPrivateDirectory(directory), /already exist/);
  assert.equal(fs.existsSync(directory), false);
  assert.equal(assertPrivateDirectory(directory, { create: true }), directory);
  assert.equal(fs.statSync(directory).mode & 0o777, 0o700);
  fs.chmodSync(directory, 0o755);
  assert.throws(() => assertPrivateDirectory(directory, { create: true }), /0700/);
  assert.equal(fs.statSync(directory).mode & 0o777, 0o755);
});

test('private path checks reject relative paths, null bytes and non-directory parents', t => {
  const root = fixture(t), file = path.join(root, 'parent');
  fs.writeFileSync(file, '', { mode: 0o600 });
  for (const input of ['relative', '', null, path.join(root, 'bad\0name')]) assert.throws(() => assertPrivateDirectory(input), /absolute/);
  assert.throws(() => assertUnusedPath(path.join(file, 'child')), /not a directory/);
});

test('directory and file symlinks including dangling links are rejected', t => {
  const root = fixture(t), data = path.join(root, 'data');
  assertPrivateDirectory(data, { create: true });
  const linked = path.join(root, 'linked');
  fs.symlinkSync(data, linked);
  assert.throws(() => assertPrivateDirectory(linked), /symbolic/);
  assert.throws(() => assertUnusedPath(path.join(linked, 'new')), /symbolic/);
  const dangling = path.join(root, 'dangling');
  fs.symlinkSync(path.join(root, 'missing'), dangling);
  assert.throws(() => assertUnusedPath(dangling), /symbolic/);
  assert.throws(() => assertPrivateRegularFile(dangling), /symbolic/);
});

test('regular-file checks reject hardlinks, shared modes and directories without altering files', t => {
  const root = fixture(t), file = path.join(root, 'private');
  fs.writeFileSync(file, 'fixture data', { mode: 0o600 });
  assert.equal(assertPrivateRegularFile(file), file);
  const alias = path.join(root, 'alias');
  fs.linkSync(file, alias);
  assert.throws(() => assertPrivateRegularFile(file), /hard links/);
  fs.unlinkSync(alias);
  fs.chmodSync(file, 0o644);
  assert.throws(() => assertPrivateRegularFile(file), /owner-only/);
  assert.equal(fs.readFileSync(file, 'utf8'), 'fixture data');
  assert.equal(fs.statSync(file).mode & 0o777, 0o644);
  fs.chmodSync(file, 0o700);
  assert.throws(() => assertPrivateRegularFile(file), /0600 or 0400/);
  fs.chmodSync(file, 0o400);
  assert.equal(assertPrivateRegularFile(file), file);
  assert.throws(() => assertPrivateRegularFile(root), /regular file/);
});

test('database lookup does not create storage or follow linked WAL, SHM or rollback journals', t => {
  const root = fixture(t), filename = path.join(root, 'workspace.sqlite');
  assert.throws(() => existingDatabasePath(root), /existing regular/);
  assert.equal(fs.existsSync(filename), false);
  fs.writeFileSync(filename, 'synthetic database marker', { mode: 0o600 });
  const external = path.join(root, 'unrelated');
  fs.writeFileSync(external, 'unchanged', { mode: 0o600 });
  for (const suffix of ['-wal', '-shm', '-journal']) {
    fs.symlinkSync(external, filename + suffix);
    assert.throws(() => existingDatabasePath(root), /symbolic/);
    assert.equal(fs.readFileSync(external, 'utf8'), 'unchanged');
    fs.unlinkSync(filename + suffix);
  }
  assert.equal(existingDatabasePath(root), filename);
});

test('unused destinations reject existing files and directories, even empty ones', t => {
  const root = fixture(t), file = path.join(root, 'archive.prbk'), missing = path.join(root, 'new');
  assert.equal(assertUnusedPath(missing), missing);
  fs.writeFileSync(file, 'original', { mode: 0o600 });
  assert.throws(() => assertUnusedPath(file), /already exists/);
  assert.throws(() => assertUnusedPath(root), /already exists/);
  assert.equal(fs.readFileSync(file, 'utf8'), 'original');
});
