'use strict';

// Independent event-state tests of the shipped confirmation component. This is
// a small DOM adapter, not a browser or visual/accessibility certification.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const SOURCE = fs.readFileSync(path.join(__dirname, '../workspace/deletion.js'), 'utf8');
const operation = () => ({ kind: 'panel_project', id: crypto.randomUUID(), version: 3, url: '/api/panel-projects/synthetic', title: 'Delete panel project?', description: 'Synthetic test project' });
const receipt = value => ({ receipt: { deleted: true, kind: value.kind, id: value.id, version: value.version + 1, deletedAt: '2026-11-20T00:00:00.000Z' } });
const error = status => Object.assign(new Error('Synthetic ' + status), { status });
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
function fixture(api) {
  const all = [], events = [];
  const document = { activeElement: null };
  class Element {
    constructor(tag) { this.tagName = tag; this.textContent = ''; this.children = []; this.listeners = {}; this.disabled = false; this.value = ''; this.open = false; this.hidden = false; all.push(this); }
    setAttribute(name, value) { this[name] = value; }
    append(...children) { this.children.push(...children); }
    addEventListener(name, listener) { (this.listeners[name] ||= []).push(listener); }
    focus() { document.activeElement = this; }
    showModal() { this.open = true; }
    close() { this.open = false; }
    async emit(name) { for (const listener of this.listeners[name] || []) await listener({ preventDefault() {} }); }
    async click() { if (!this.disabled) await this.emit('click'); }
  }
  document.createElement = tag => new Element(tag); document.body = new Element('body');
  const window = {};
  vm.runInNewContext(SOURCE, { window, document, crypto }, { filename: 'deletion.js' });
  const control = window.PanelReplyDeletion.create({ api, onChange: () => {}, onDeleted: (value, valueReceipt) => events.push({ value, receipt: valueReceipt }) });
  const byId = id => all.find(element => element.id === id);
  const button = name => all.find(element => element.tagName === 'button' && element.textContent === name);
  async function type(value) { byId('delete-confirm-input').value = value; await byId('delete-confirm-input').emit('input'); }
  return { control, all, events, byId, button, type, dialog: all.find(e => e.tagName === 'dialog') };
}

test('independent deletion review retains uncertainty when a retry receives403 after a lost commit response', async () => {
  let calls = 0;
  const f = fixture(async () => { throw error(++calls === 1 ? 0 : 403); });
  f.control.request(operation()); await f.type('DELETE'); await f.button('Delete').click();
  assert.equal(f.control.isPending(), true);
  await f.button('Retry same deletion').click();
  assert.equal(f.control.isPending(), true, 'a later rejection cannot establish whether the earlier attempt committed');
  assert.equal(f.button('Cancel').disabled, true);
  assert.equal(f.events.length, 0);
});

test('independent deletion review requires the typed word and cancellation sends nothing', async () => {
  let calls = 0; const f = fixture(async () => { calls++; });
  f.control.request(operation()); await f.type('delete'); await f.button('Delete').click();
  assert.equal(calls, 0); assert.equal(f.button('Delete').disabled, true);
  await f.button('Cancel').click(); assert.equal(f.control.isOpen(), false); assert.equal(calls, 0);
});

test('independent deletion review keeps the same key, version and body after a lost response', async () => {
  const op = operation(), sent = [];
  const f = fixture(async (url, options) => { sent.push(JSON.parse(JSON.stringify({ url, options }))); if (sent.length === 1) throw error(0); return receipt(op); });
  f.control.request(op); await f.type('DELETE'); await f.button('Delete').click();
  await f.dialog.emit('cancel'); assert.equal(f.control.isOpen(), true);
  await f.button('Retry same deletion').click();
  assert.equal(sent.length, 2); assert.deepEqual(sent[0], sent[1]); assert.ok(sent[0].options.key);
  assert.equal(f.control.isOpen(), false); assert.equal(f.events.length, 1);
});

for (const mismatch of ['id', 'kind', 'version', 'deletedAt', 'deleted']) test('independent deletion review refuses a mismatched receipt: ' + mismatch, async () => {
  const op = operation(), result = receipt(op); result.receipt[mismatch] = 'wrong';
  const f = fixture(async () => result); f.control.request(op); await f.type('DELETE'); await f.button('Delete').click();
  assert.equal(f.control.isPending(), true); assert.equal(f.events.length, 0); assert.equal(f.control.isOpen(), true);
});

test('independent deletion review prevents repeated clicks during the same outstanding request', async () => {
  const op = operation(), wait = deferred(); let calls = 0;
  const f = fixture(async () => { calls++; return wait.promise; }); f.control.request(op); await f.type('DELETE');
  const promise = f.button('Delete').click(); await Promise.resolve();
  assert.equal(f.control.isPending(), true); assert.equal(f.button('Deleting…').disabled, true);
  await f.button('Deleting…').click(); assert.equal(calls, 1);
  wait.resolve(receipt(op)); await promise; assert.equal(f.events.length, 1);
});

test('independent deletion review discards a late successful response after session expiry', async () => {
  const op = operation(), wait = deferred(); const f = fixture(async () => wait.promise);
  f.control.request(op); await f.type('DELETE'); const promise = f.button('Delete').click();
  f.control.expire(); wait.resolve(receipt(op)); await promise;
  assert.equal(f.events.length, 0); assert.equal(f.control.isOpen(), false); assert.equal(f.control.isPending(), false);
  assert.equal(f.byId('delete-confirm-description').textContent, '');
});

test('independent deletion review allows cancellation after the first explicit version rejection', async () => {
  const f = fixture(async () => { throw error(409); }); f.control.request(operation()); await f.type('DELETE'); await f.button('Delete').click();
  assert.equal(f.control.isPending(), false); assert.equal(f.button('Cancel').disabled, false);
  await f.button('Cancel').click(); assert.equal(f.control.isOpen(), false); assert.equal(f.events.length, 0);
});
