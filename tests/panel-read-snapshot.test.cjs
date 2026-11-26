'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { Readable } = require('node:stream');
const { EventEmitter } = require('node:events');
const { digest } = require('../workspace/store.cjs');
const { openProductStore } = require('../workspace/products.cjs');
const { hashPassword } = require('../workspace/auth.cjs');
const { createWorkspaceApp } = require('../workspace/api.cjs');
const { exportProjectXlsx } = require('../workspace/xlsx.cjs');

const ORIGIN = 'http://127.0.0.1:10001';
const HASH = hashPassword('Synthetic panel snapshot password 2026!');
const IMAGE = fs.readFileSync(path.join(__dirname, 'fixtures/panels/complete.png'));
const key = () => crypto.randomUUID();
const confirmation = version => ({ version, confirmation: 'DELETE' });
const edit = (project, changes = {}) => ({ version: project.version, name: project.name, notes: project.notes, rows: project.rows, ...changes });
const source = (version, name = 'source-a.png') => ({ version, name, mime: 'image/png', dataBase64: IMAGE.toString('base64') });

async function request(app, headers, url) {
  const req = Readable.from([]);
  Object.assign(req, { method: 'GET', url, headers: { host: '127.0.0.1:10001', ...headers }, socket: { remoteAddress: '127.0.0.1' } });
  const res = new EventEmitter();
  res.writableEnded = false; res.destroyed = false;
  res.writeHead = (status, values) => { res.status = status; res.headers = values; };
  res.end = value => { res.buffer = value === undefined ? Buffer.alloc(0) : Buffer.from(value); res.writableEnded = true; };
  await app.handler(req, res);
  return { status: res.status, buffer: res.buffer, headers: res.headers,
    body: res.headers?.['Content-Type']?.startsWith('application/json') ? JSON.parse(res.buffer.toString('utf8')) : null };
}

async function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'panelreply-panel-snapshot-'));
  const dataDir = path.join(directory, 'data');
  const reader = openProductStore({ dataDir, product: 'spreadsheet' });
  let writer;
  t.after(() => { writer?.close(); reader.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  const passwordHash = await HASH;
  const actor = reader.createBusinessOwner({ businessName: 'Snapshot fixture', username: 'snapshot-a@example.test', passwordHash });
  const other = reader.createBusinessOwner({ businessName: 'Other snapshot fixture', username: 'snapshot-b@example.test', passwordHash });
  function savedProject(owner, name) {
    const project = reader.createPanelProject(owner, { name, notes: 'Preserve the saved snapshot.', rows: [
      { partNumber: ' 00120 ', manufacturer: 'Synthetic Maker', description: 'Corrected Ω, "value"\nsecond line', quantity: 2, reviewStatus: 'reviewed', notes: ' keep ', sourceImageId: null },
      { partNumber: '', manufacturer: '', description: 'Unidentified component', quantity: 1, reviewStatus: 'unreviewed', notes: 'Unknown values stay blank.', sourceImageId: null }
    ] }, key()).project;
    const uploaded = reader.addPanelSource(owner, project.id, source(project.version), key());
    return reader.updatePanelProject(owner, project.id, edit(uploaded.project, {
      rows: project.rows.map(row => ({ ...row, sourceImageId: uploaded.source.id }))
    }));
  }
  const saved = savedProject(actor, 'Snapshot project');
  const unrelated = savedProject(other, 'Unrelated project');
  writer = openProductStore({ dataDir, product: 'spreadsheet', create: false });
  const app = createWorkspaceApp({ store: reader, product: 'spreadsheet', origin: ORIGIN });
  function login(owner) {
    const token = crypto.randomBytes(32).toString('base64url');
    reader.createSession(owner.id, digest(token));
    return { cookie: app.auth.cookie(token).split(';')[0] };
  }
  return { reader, writer, actor, other, saved, unrelated, app, headers: login(actor), otherHeaders: login(other),
    url: '/api/panel-projects/' + saved.id };
}

// Pause only after SQLite has returned the real project row. The mutation uses
// another actual connection and the public store operation. No SQL result,
// transaction result, source metadata or export bytes are supplied by the hook.
function afterProjectRow(t, id, mutate) {
  const prepare = DatabaseSync.prototype.prepare;
  const observation = { commits: 0, result: null };
  let fired = false;
  t.mock.method(DatabaseSync.prototype, 'prepare', function (sql) {
    const statement = prepare.call(this, sql);
    if (!fired && sql === 'SELECT * FROM panel_projects WHERE id=? AND business_id=?') {
      const get = statement.get;
      statement.get = function (...args) {
        const row = get.apply(this, args);
        if (!fired && row?.id === id) {
          fired = true;
          observation.result = mutate();
          observation.commits += 1;
        }
        return row;
      };
    }
    return statement;
  });
  return observation;
}

function readerConnection(t, f) {
  const prepare = DatabaseSync.prototype.prepare;
  let connection;
  const mock = t.mock.method(DatabaseSync.prototype, 'prepare', function (sql) {
    connection ??= this;
    return prepare.call(this, sql);
  });
  try { f.reader.getPanelProject(f.actor, f.saved.id); }
  finally { mock.mock.restore(); }
  assert.ok(connection);
  return connection;
}

test('panel detail keeps source links and review state in one snapshot during a committed source deletion', async t => {
  const f = await fixture(t);
  const race = afterProjectRow(t, f.saved.id, () => f.writer.deletePanelSource(f.actor, f.saved.id, f.saved.sources[0].id, confirmation(f.saved.version), key()));
  const response = await request(f.app, f.headers, f.url);
  assert.equal(race.commits, 1);
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.project, f.saved);
  const latest = f.reader.getPanelProject(f.actor, f.saved.id);
  assert.equal(latest.version, f.saved.version + 1);
  assert.deepEqual(latest.sources, []);
  assert.deepEqual(latest.rows, f.saved.rows.map(row => ({ ...row, sourceImageId: null, reviewStatus: 'unreviewed' })));
  assert.throws(() => f.reader.updatePanelProject(f.actor, f.saved.id, edit(f.saved)), { code: 'version_conflict' });
  assert.throws(() => f.reader.getPanelSource(f.actor, f.saved.id, f.saved.sources[0].id), { code: 'not_found' });
  assert.deepEqual(f.reader.getPanelProject(f.other, f.unrelated.id), f.unrelated);
  assert.deepEqual(f.reader.getPanelSource(f.other, f.unrelated.id, f.unrelated.sources[0].id).data, IMAGE);
  assert.equal((await request(f.app, f.otherHeaders, f.url)).status, 404);
});

test('panel CSV exports a complete saved revision when source deletion commits during the read', async t => {
  const f = await fixture(t);
  const expected = Buffer.from(f.reader.exportPanelProject(f.actor, f.saved.id));
  const race = afterProjectRow(t, f.saved.id, () => f.writer.deletePanelSource(f.actor, f.saved.id, f.saved.sources[0].id, confirmation(f.saved.version), key()));
  const response = await request(f.app, f.headers, f.url + '/export.csv');
  assert.equal(race.commits, 1);
  assert.equal(response.status, 200);
  assert.deepEqual(response.buffer, expected);
  assert.ok(response.buffer.toString('utf8').includes('"source-a.png","reviewed"'));
  const after = await request(f.app, f.headers, f.url + '/export.csv');
  assert.equal(after.status, 200);
  assert.notDeepEqual(after.buffer, expected);
  assert.ok(!after.buffer.toString('utf8').includes('source-a.png'));
  assert.ok(!after.buffer.toString('utf8').includes('"reviewed"'));
});

test('panel XLSX exports the complete source-linked snapshot instead of rejecting mixed revisions', async t => {
  const f = await fixture(t);
  const expected = exportProjectXlsx(f.saved);
  const race = afterProjectRow(t, f.saved.id, () => f.writer.deletePanelSource(f.actor, f.saved.id, f.saved.sources[0].id, confirmation(f.saved.version), key()));
  const response = await request(f.app, f.headers, f.url + '/export.xlsx');
  assert.equal(race.commits, 1);
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.deepEqual(response.buffer, expected);
  const latest = f.reader.getPanelProject(f.actor, f.saved.id);
  const after = await request(f.app, f.headers, f.url + '/export.xlsx');
  assert.equal(after.status, 200);
  assert.deepEqual(after.buffer, exportProjectXlsx(latest));
  assert.notDeepEqual(after.buffer, expected);
});

test('panel project deletion cannot combine deleted sources with an earlier saved project response', async t => {
  const f = await fixture(t);
  const race = afterProjectRow(t, f.saved.id, () => f.writer.deletePanelProject(f.actor, f.saved.id, confirmation(f.saved.version), key()));
  const response = await request(f.app, f.headers, f.url);
  assert.equal(race.commits, 1);
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.project, f.saved);
  for (const suffix of ['', '/export.csv', '/export.xlsx', '/sources/' + f.saved.sources[0].id]) {
    assert.equal((await request(f.app, f.headers, f.url + suffix)).status, 404);
  }
  assert.deepEqual(f.reader.getPanelProject(f.other, f.unrelated.id), f.unrelated);
});

test('panel source upload cannot appear under the revision read before its commit', async t => {
  const f = await fixture(t);
  const race = afterProjectRow(t, f.saved.id, () => f.writer.addPanelSource(f.actor, f.saved.id, source(f.saved.version, 'source-b.png'), key()));
  const response = await request(f.app, f.headers, f.url);
  assert.equal(race.commits, 1);
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.project, f.saved);
  const latest = f.reader.getPanelProject(f.actor, f.saved.id);
  assert.deepEqual(latest, race.result.project);
  assert.equal(latest.version, f.saved.version + 1);
  assert.equal(latest.sources.length, 2);
  assert.deepEqual(f.reader.getPanelSource(f.actor, f.saved.id, race.result.source.id).data, IMAGE);
  assert.throws(() => f.reader.updatePanelProject(f.actor, f.saved.id, edit(f.saved)), { code: 'version_conflict' });
});

test('panel reads preserve an existing outer read transaction and its snapshot', async t => {
  const f = await fixture(t);
  const db = readerConnection(t, f);
  let uploaded;
  db.exec('BEGIN');
  try {
    assert.deepEqual(f.reader.getPanelProject(f.actor, f.saved.id), f.saved);
    assert.equal(db.isTransaction, true);
    uploaded = f.writer.addPanelSource(f.actor, f.saved.id, source(f.saved.version, 'later-source.png'), key());
    assert.throws(() => f.reader.getPanelProject(f.actor, key()), { code: 'not_found' });
    assert.equal(db.isTransaction, true);
    assert.deepEqual(f.reader.getPanelProject(f.actor, f.saved.id), f.saved);
    assert.equal(db.isTransaction, true);
  } finally { if (db.isTransaction) db.exec('ROLLBACK'); }
  assert.deepEqual(f.reader.getPanelProject(f.actor, f.saved.id), uploaded.project);
});

test('panel read failures end only their own snapshot without writes or a stale subsequent read', async t => {
  const f = await fixture(t);
  const db = readerConnection(t, f);
  const changes = db.prepare('SELECT total_changes() AS n').get().n;
  const prepare = DatabaseSync.prototype.prepare;
  let fail = true;
  const mock = t.mock.method(DatabaseSync.prototype, 'prepare', function (sql) {
    if (fail && sql.startsWith('SELECT id,name,mime,length(bytes) AS byte_count,width,height,created_at FROM panel_sources')) {
      fail = false;
      throw new Error('Synthetic source metadata read failure');
    }
    return prepare.call(this, sql);
  });
  try { assert.throws(() => f.reader.getPanelProject(f.actor, f.saved.id), /Synthetic source metadata read failure/); }
  finally { mock.mock.restore(); }
  assert.equal(fail, false);
  assert.equal(db.isTransaction, false);
  assert.equal(db.prepare('SELECT total_changes() AS n').get().n, changes);
  assert.throws(() => f.reader.getPanelProject(f.actor, key()), { code: 'not_found' });
  assert.equal(db.isTransaction, false);
  const updated = f.writer.updatePanelProject(f.actor, f.saved.id, edit(f.saved, { notes: 'Committed after a failed read.' }));
  assert.deepEqual(f.reader.getPanelProject(f.actor, f.saved.id), updated);
  const saved = f.reader.updatePanelProject(f.actor, f.saved.id, edit(updated, { notes: 'The reader can still write.' }));
  assert.equal(saved.version, updated.version + 1);
  assert.deepEqual(f.writer.getPanelSource(f.actor, f.saved.id, f.saved.sources[0].id).data, IMAGE);
});
