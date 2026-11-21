'use strict';

// Finite event histories against the shipped client controller. These are
// generated model cases, not browser, visual, or operating-system tests.
// The oracle tracks the user-visible contract: a response that could have
// committed keeps uncertainty until a matching receipt or session expiry.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

const script = new vm.Script(fs.readFileSync(path.join(__dirname, '../workspace/deletion.js'), 'utf8'), { filename: 'workspace/deletion.js' });
const CHILD = '24fa6ab5-810b-4f16-8293-6cd9cc4d2212';
const PARENT = '4de839bb-fb03-4a91-b7a7-e470e9aeef39';
const OTHER = 'ecc1fe48-f4ea-4a89-8d57-e49abbfb2669';
const operations = [
  { kind: 'lead', id: CHILD, version: 3, url: '/api/leads/' + CHILD },
  { kind: 'lead_conversation', id: CHILD, version: 3, url: '/api/leads/' + CHILD + '/conversation' },
  { kind: 'panel_project', id: CHILD, version: 3, url: '/api/panel-projects/' + CHILD },
  { kind: 'panel_source', id: CHILD, parentId: PARENT, version: 3, url: '/api/panel-projects/' + PARENT + '/sources/' + CHILD }
].map(value => Object.freeze({ ...value, title: 'Delete synthetic record?', description: 'Synthetic model fixture' }));

function confirmed(op) {
  return { receipt: { deleted: true, kind: op.kind, id: op.id, version: op.version + 1, ...(op.parentId ? { parentId: op.parentId } : {}), deletedAt: '2026-11-20T15:00:00.000Z' } };
}
function rejected(status) { return Object.assign(new Error('Synthetic rejection'), status === undefined ? {} : { status }); }
const events = [
  { id: 'lost-response', uncertain: true, apply() { throw rejected(); } },
  { id: 'timeout-408', uncertain: true, apply() { throw rejected(408); } },
  { id: 'unavailable-503', uncertain: true, apply() { throw rejected(503); } },
  { id: 'unauthorized-401', uncertain: false, apply() { throw rejected(401); } },
  { id: 'forbidden-403', uncertain: false, apply() { throw rejected(403); } },
  { id: 'stale-409', uncertain: false, apply() { throw rejected(409); } },
  { id: 'validation-422', uncertain: false, apply() { throw rejected(422); } },
  { id: 'missing-receipt', uncertain: true, apply() { return {}; } },
  { id: 'wrong-record', uncertain: true, apply(op) { const r = confirmed(op); r.receipt.id = OTHER; return r; } },
  { id: 'wrong-kind', uncertain: true, apply(op) { const r = confirmed(op); r.receipt.kind = 'unrelated'; return r; } },
  { id: 'old-version', uncertain: true, apply(op) { const r = confirmed(op); r.receipt.version = op.version; return r; } },
  { id: 'not-deleted', uncertain: true, apply(op) { const r = confirmed(op); r.receipt.deleted = false; return r; } },
  { id: 'invalid-timestamp', uncertain: true, apply(op) { const r = confirmed(op); r.receipt.deletedAt = 'not-a-date'; return r; } }
];
const wrongParent = { id: 'wrong-parent', uncertain: true, apply(op) { const r = confirmed(op); r.receipt.parentId = OTHER; return r; } };
const names = new Set(), signatures = new Set();
let registered = 0;
function register(id, input, body) {
  const signature = crypto.createHash('sha256').update(JSON.stringify(input)).digest('hex');
  assert.ok(!names.has(id), 'duplicate model ID'); names.add(id);
  assert.ok(!signatures.has(signature), 'duplicate semantic model input'); signatures.add(signature);
  registered++;
  test(id + ' | deletion-state | input-sha256=' + signature, body);
}
function pendingPromise() {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}
function fixture(api) {
  const all = [], deliveries = [], requests = [];
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
  document.createElement = tag => new Element(tag);
  document.body = new Element('body');
  const window = {};
  script.runInNewContext({ window, document, crypto });
  const control = window.PanelReplyDeletion.create({
    api: async (url, options) => { requests.push(JSON.parse(JSON.stringify({ url, options }))); return api(url, options); },
    onChange() {},
    onDeleted(value, receipt) { deliveries.push(JSON.parse(JSON.stringify({ value, receipt }))); }
  });
  const input = all.find(e => e.id === 'delete-confirm-input');
  const cancel = all.find(e => e.tagName === 'button' && e.textContent === 'Cancel');
  const confirm = all.find(e => e.tagName === 'button' && e.textContent === 'Delete');
  const dialog = all.find(e => e.tagName === 'dialog');
  async function type(value) { input.value = value; await input.emit('input'); }
  return { control, requests, deliveries, input, cancel, confirm, dialog, all, type };
}
function assertUnsettled(f, uncertain, count) {
  assert.equal(f.control.isOpen(), true, 'unconfirmed deletion keeps the dialog');
  assert.equal(f.control.isPending(), uncertain, 'uncertainty cannot be discarded by a later refusal');
  assert.equal(f.cancel.disabled, uncertain);
  assert.equal(f.input.disabled, uncertain);
  assert.equal(f.confirm.disabled, false, 'the same operation can be retried');
  assert.equal(f.deliveries.length, 0, 'a refused or incomplete response never reports deletion');
  assert.equal(f.requests.length, count);
  for (const request of f.requests.slice(1)) assert.deepEqual(request, f.requests[0], 'retries preserve URL, operation key, version and confirmation');
}
function assertCleared(f) {
  assert.equal(f.control.isOpen(), false);
  assert.equal(f.control.isPending(), false);
  assert.equal(f.input.value, '');
  assert.equal(f.all.find(e => e.id === 'delete-confirm-description').textContent, '');
}

// Ordered response pairs exercise both directions of transitions such as
// refusal -> lost response and lost response -> refusal. Ending actions are
// separate observable contracts, not another count of individual assertions.
for (const op of operations) {
  const alphabet = op.parentId ? [...events, wrongParent] : events;
  for (const first of alphabet) for (const second of alphabet) for (const ending of ['receipt', 'cancel', 'escape', 'expire']) {
    const input = { kind: op.kind, version: op.version, responses: [first.id, second.id], ending };
    register(`RDM-${op.kind}-${first.id}-${second.id}-${ending}`, input, async () => {
      let attempt = 0;
      const f = fixture(async () => (++attempt === 1 ? first.apply(op) : attempt === 2 ? second.apply(op) : confirmed(op)));
      f.control.request(op); await f.type('DELETE');
      await f.confirm.click(); assertUnsettled(f, first.uncertain, 1);
      await f.confirm.click();
      const uncertain = first.uncertain || second.uncertain;
      assertUnsettled(f, uncertain, 2);
      assert.match(f.requests[0].options.key, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      assert.equal(f.requests[0].options.method, 'DELETE');
      assert.deepEqual(f.requests[0].options.body, { version: 3, confirmation: 'DELETE' });
      if (ending === 'receipt') {
        await f.confirm.click();
        assertCleared(f); assert.equal(f.requests.length, 3); assert.equal(f.deliveries.length, 1);
        assert.deepEqual(f.requests[2], f.requests[0]);
        assert.deepEqual(f.deliveries[0].receipt, confirmed(op).receipt);
      } else if (ending === 'expire') {
        f.control.expire(); assertCleared(f); assert.equal(f.deliveries.length, 0);
      } else {
        if (ending === 'cancel') await f.cancel.click(); else await f.dialog.emit('cancel');
        if (uncertain) assertUnsettled(f, true, 2); else assertCleared(f);
        assert.equal(f.requests.length, 2); assert.equal(f.deliveries.length, 0);
      }
    });
  }
}

for (const op of operations) for (const prefix of ['none', 'lost-response', 'stale-409']) for (const interleaving of ['duplicate-click', 'cancel', 'escape', 'replace-open', 'expire-late-success', 'expire-late-failure', 'expire-new-operation']) {
  register(`RDM-pending-${op.kind}-${prefix}-${interleaving}`, { phase: 'pending', kind: op.kind, prefix, interleaving }, async () => {
    const wait = pendingPromise(); let count = 0;
    const f = fixture(async () => {
      count++;
      if (prefix !== 'none' && count === 1) return events.find(e => e.id === prefix).apply(op);
      return wait.promise;
    });
    f.control.request(op); await f.type('DELETE');
    if (prefix !== 'none') await f.confirm.click();
    const click = f.confirm.click();
    assert.equal(f.control.isPending(), true);
    assert.equal(f.confirm.disabled, true); assert.equal(f.cancel.disabled, true); assert.equal(f.input.disabled, true);
    const expectedCount = prefix === 'none' ? 1 : 2;
    if (interleaving === 'duplicate-click') await f.confirm.click();
    else if (interleaving === 'cancel') await f.cancel.click();
    else if (interleaving === 'escape') await f.dialog.emit('cancel');
    else if (interleaving === 'replace-open') f.control.request({ ...op, id: OTHER, version: 99, url: '/unrelated' });
    else {
      f.control.expire(); assertCleared(f);
      if (interleaving === 'expire-new-operation') f.control.request({ ...op, id: OTHER, version: 7, url: '/new-synthetic-record' });
    }
    assert.equal(f.requests.length, expectedCount, 'pending duplicate actions do not create a second API operation');
    if (interleaving === 'expire-late-failure') wait.reject(rejected(503)); else wait.resolve(confirmed(op));
    await click;
    if (interleaving.startsWith('expire')) {
      assert.equal(f.deliveries.length, 0, 'late response cannot complete an expired operation');
      assert.equal(f.control.isPending(), false);
      if (interleaving === 'expire-new-operation') {
        assert.equal(f.control.isOpen(), true); assert.equal(f.input.value, ''); assert.equal(f.confirm.disabled, true);
      } else assertCleared(f);
    } else {
      assertCleared(f); assert.equal(f.deliveries.length, 1); assert.equal(f.deliveries[0].value.id, op.id);
    }
  });
}

for (const op of operations) for (const [id, typed] of [['empty', ''], ['lowercase', 'delete'], ['title-case', 'Delete'], ['space-prefix', ' DELETE'], ['space-suffix', 'DELETE '], ['zero-width-suffix', 'DELETE\u200b']]) {
  register(`RDM-confirm-${op.kind}-${id}`, { phase: 'confirmation', kind: op.kind, typed }, async () => {
    const f = fixture(async () => confirmed(op)); f.control.request(op); await f.type(typed);
    await f.confirm.click(); assert.equal(f.requests.length, 0); assert.equal(f.deliveries.length, 0);
    assert.equal(f.confirm.disabled, true); assert.equal(f.control.isPending(), false);
    await f.cancel.click(); assertCleared(f);
  });
}

test.after(() => {
  assert.equal(registered, names.size);
  assert.equal(registered, signatures.size);
});
