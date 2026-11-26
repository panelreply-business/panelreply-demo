'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { create, localInstants, localValue } = require('../workspace/schedule.js');
const { webcrypto } = require('node:crypto');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const SOURCE = fs.readFileSync(path.join(__dirname, '../workspace/schedule.js'), 'utf8');
const NOW = '2026-11-23T15:00:00.000Z';
const LEAD = { id: '11111111-1111-4111-8111-111111111111', version: 1, customerName: 'Synthetic Customer',
  phone: '+15865550101', job: 'Synthetic electrical work', zip: '48315', callbackWindow: 'Afternoon', requestedWorkDate: '', notes: '',
  createdAt: NOW, updatedAt: NOW, conversation: [], audit: [],
  contactAllowed: true, contactPermission: 'requested_callback', status: 'new', optedOut: false, safetyHold: false };
const SECOND = { ...LEAD, id: '22222222-2222-4222-8222-222222222222', customerName: 'Other Customer' };
const TASK = { id: '33333333-3333-4333-8333-333333333333', leadId: LEAD.id, leadVersion: 2,
  customerName: LEAD.customerName, phone: '+15865550101', requestStatus: 'new', contactAllowed: true, blockReason: null,
  kind: 'callback', dueAt: '2026-11-23T14:00:00.000Z', timeZone: 'America/Detroit', status: 'scheduled',
  dueState: 'overdue', isDue: true, notes: 'Synthetic task', outcome: '', version: 1,
  createdAt: NOW, updatedAt: NOW, completedAt: null, cancelledAt: null };

function savedReceipt(call, parent = LEAD, prior = TASK) {
  const input = call.body, lead = { ...parent, version: input.leadVersion + 1, updatedAt: NOW };
  if (lead.optedOut) lead.contactPermission = 'opted_out';
  lead.contactAllowed = !lead.optedOut && !lead.safetyHold && lead.contactPermission === 'requested_callback';
  const blockReason = lead.optedOut ? 'contact_blocked' : lead.safetyHold ? 'safety_review_required'
    : lead.contactPermission !== 'requested_callback' ? 'contact_permission_required'
      : lead.status === 'closed' ? 'request_closed' : lead.status === 'needs_review' ? 'request_review_required' : null;
  const status = input.action === 'complete' ? 'completed' : input.action === 'cancel' ? 'cancelled' : 'scheduled';
  const task = { ...prior, leadId: lead.id, leadVersion: lead.version, customerName: lead.customerName, phone: lead.phone,
    requestStatus: lead.status, contactAllowed: blockReason === null, blockReason,
    kind: input.kind || prior.kind, dueAt: input.dueAt || prior.dueAt, timeZone: input.timeZone || prior.timeZone,
    notes: input.notes.trim(), status, version: call.method === 'POST' ? 1 : input.version + 1, updatedAt: NOW,
    outcome: input.action === 'complete' ? input.outcome : '', completedAt: status === 'completed' ? NOW : null,
    cancelledAt: status === 'cancelled' ? NOW : null, dueState: status === 'scheduled' ? 'upcoming' : null, isDue: false };
  return { task, lead, created: call.method === 'POST', replayed: false };
}

function harness(options = {}) {
  const nodes = new Map(), calls = [], opened = [], saved = [];
  const state = { rows: options.tasks || [], lead: options.lead || LEAD, total: options.total, behavior: null, reads: null, reloads: 0, changes: 0, guards: 0 };
  function make(tag = 'div') {
    const attributes = new Map(), listeners = new Map();
    let content = '';
    const element = { tagName: tag.toUpperCase(), children: [], value: '', hidden: false, disabled: false, required: false,
      dataset: {}, validityMessage: '', className: '',
      append(...items) { for (const item of items) { if (item.tagName === '#FRAGMENT') this.append(...item.children); else this.children.push(item); } },
      replaceChildren(...items) { content = ''; this.children = []; this.append(...items); },
      setAttribute(key, value) { attributes.set(key, String(value)); }, getAttribute(key) { return attributes.get(key) ?? null; },
      setCustomValidity(message) { this.validityMessage = message; }, focus() { state.focused = this; },
      addEventListener(name, handler) { if (!listeners.has(name)) listeners.set(name, []); listeners.get(name).push(handler); },
      async emit(name) { for (const listener of listeners.get(name) || []) await listener({ preventDefault() {}, target: this }); },
      querySelectorAll(selector) { return this.children.flatMap(child => [...(child.tagName === selector.toUpperCase() ? [child] : []), ...child.querySelectorAll(selector)]); },
      reportValidity() { return [...nodes.values()].every(item => (!item.required || Boolean(item.value)) && !item.validityMessage); }
    };
    Object.defineProperty(element, 'textContent', { get: () => content + element.children.map(item => item.textContent).join(''), set(value) { content = String(value ?? ''); element.children = []; } });
    return element;
  }
  const element = id => { if (!nodes.has(id)) nodes.set(id, make()); return nodes.get(id); };
  const document = { getElementById: element, createElement: make, createDocumentFragment: () => make('#fragment') };
  const window = {};
  vm.runInNewContext(SOURCE, { window, document, Intl, Date, crypto: webcrypto }, { filename: 'schedule.js' });
  let controller;
  const api = async (url, input = {}) => {
    const call = { url, ...structuredClone(input) }; calls.push(call);
    if (!input.method || input.method === 'GET') {
      if (state.reads) return state.reads(url);
      return { tasks: state.rows, total: state.total ?? state.rows.length, limit: 100, offset: 0, generatedAt: NOW };
    }
    if (state.behavior) return state.behavior(call);
    const receipt = savedReceipt(call, state.lead, state.rows.find(task => call.url.endsWith('/' + task.id)) || TASK);
    state.rows = [receipt.task];
    return receipt;
  };
  controller = window.PanelReplySchedule.create({ api, onChange() { state.changes++; },
    onLead(lead) { saved.push(lead); state.lead = lead; controller.selectLead(lead); },
    onOpenLead(id) { opened.push(id); }, onReloadLead() { state.reloads++; },
    guard(action) { state.guards++; return action(); }
  });
  controller.setLocked(false);
  if (options.lead !== false) controller.selectLead(options.lead || LEAD);
  return { controller, element, state, calls, saved, opened };
}
async function settle() { for (let count = 0; count < 4; count++) await new Promise(resolve => setImmediate(resolve)); }
async function fill(page, value = '2026-12-01T09:30', zone = 'America/Detroit') {
  page.element('task-local-time').value = value; page.element('task-time-zone').value = zone;
  page.element('task-notes').value = 'Synthetic follow-up plan';
  await page.element('callback-task-form').emit('input');
}
const mutations = page => page.calls.filter(call => call.method);

test('callback local time resolves winter and summer offsets independently of the device zone', () => {
  assert.deepEqual(localInstants('2026-12-01T09:30', 'America/Detroit'), ['2026-12-01T14:30:00.000Z']);
  assert.deepEqual(localInstants('2026-07-01T09:30', 'America/Detroit'), ['2026-07-01T13:30:00.000Z']);
});
test('callback local time exposes both instants in the repeated fall hour', () => {
  assert.deepEqual(localInstants('2026-11-01T01:30', 'America/Detroit'), ['2026-11-01T05:30:00.000Z', '2026-11-01T06:30:00.000Z']);
});
test('callback local time rejects the skipped spring hour without normalizing it forward', () => {
  assert.deepEqual(localInstants('2026-03-08T02:30', 'America/Detroit'), []);
});
test('callback local time supports a half-hour clock transition', () => {
  assert.deepEqual(localInstants('2026-04-05T01:45', 'Australia/Lord_Howe'), ['2026-04-04T14:45:00.000Z', '2026-04-04T15:15:00.000Z']);
  assert.deepEqual(localInstants('2026-10-04T02:15', 'Australia/Lord_Howe'), []);
});
test('callback local time preserves quarter-hour offsets and date-boundary conversions', () => {
  assert.deepEqual(localInstants('2026-12-01T00:15', 'Asia/Kathmandu'), ['2026-11-30T18:30:00.000Z']);
  assert.equal(localValue('2026-12-01T10:00:00.000Z', 'Pacific/Kiritimati'), '2026-12-02T00:00');
});
test('callback local time rejects impossible dates and unsupported zone identifiers', () => {
  assert.throws(() => localInstants('2026-02-30T09:30', 'UTC'), /calendar date/);
  assert.throws(() => localInstants('2026-12-01 09:30', 'UTC'), /date and time/);
  assert.throws(() => localInstants('2026-12-01T09:30', 'Synthetic/Zone'), /valid time zone/);
  // Intl accepts abbreviations and fixed offsets that the saved named-zone
  // contract rejects. The form must reject them before offering a save.
  for (const zone of ['CET', 'GMT', '+05:30', 'utc']) {
    assert.throws(() => localInstants('2026-12-01T09:30', zone), /valid time zone/);
  }
  assert.deepEqual(localInstants('2026-12-01T09:30', 'Etc/GMT+5'), ['2026-12-01T14:30:00.000Z']);
});
test('callback leap-day conversion retains the saved wall-clock minute', () => {
  const instant = localInstants('2028-02-29T23:59', 'UTC')[0];
  assert.equal(instant, '2028-02-29T23:59:00.000Z');
  assert.equal(localValue(instant, 'UTC'), '2028-02-29T23:59');
});
test('callback schedule submits the reviewed UTC instant, zone and current parent revision', async () => {
  const page = harness(); await settle(); await fill(page);
  page.element('task-kind').value = 'follow_up';
  await page.element('callback-task-form').emit('submit'); await settle();
  assert.equal(mutations(page).length, 1);
  assert.equal(mutations(page)[0].url, `/api/leads/${LEAD.id}/tasks`);
  assert.deepEqual(mutations(page)[0].body, { leadVersion: 1, kind: 'follow_up', dueAt: '2026-12-01T14:30:00.000Z', timeZone: 'America/Detroit', notes: 'Synthetic follow-up plan' });
  assert.match(mutations(page)[0].key, /^[a-f0-9-]{36}$/);
  assert.equal(page.saved[0].version, 2);
  assert.equal(page.controller.isDirty(), false);
});
test('callback ambiguous time cannot save until the operator chooses an occurrence', async () => {
  const page = harness(); await settle(); await fill(page, '2026-11-01T01:30');
  assert.equal(page.element('task-occurrence-field').hidden, false);
  await page.element('callback-task-form').emit('submit');
  assert.equal(mutations(page).length, 0);
  page.element('task-occurrence').value = '2026-11-01T06:30:00.000Z';
  await page.element('callback-task-form').emit('change');
  assert.match(page.element('task-time-preview').textContent, /06:30:00.000Z/);
  await page.element('callback-task-form').emit('submit'); await settle();
  assert.equal(mutations(page)[0].body.dueAt, '2026-11-01T06:30:00.000Z');
});
test('callback changing the time zone clears an earlier ambiguous occurrence selection', async () => {
  const page = harness(); await settle(); await fill(page, '2026-11-01T01:30');
  page.element('task-occurrence').value = '2026-11-01T06:30:00.000Z'; await page.element('callback-task-form').emit('change');
  page.element('task-time-zone').value = 'America/Chicago'; await page.element('callback-task-form').emit('input');
  assert.equal(page.element('task-occurrence').value, '');
  await page.element('callback-task-form').emit('submit');
  assert.equal(mutations(page).length, 0);
});
test('callback nonexistent wall-clock time never reaches the mutation API', async () => {
  const page = harness(); await settle(); await fill(page, '2026-03-08T02:30');
  await page.element('callback-task-form').emit('submit');
  assert.equal(mutations(page).length, 0);
  assert.match(page.element('task-time-preview').textContent, /does not exist/);
});
test('callback lost save response retains the same idempotency key and payload for retry', async () => {
  const page = harness(); await settle(); await fill(page);
  page.state.behavior = async () => { throw Object.assign(new Error('Lost response'), { status: 0 }); };
  await page.element('callback-task-form').emit('submit');
  assert.equal(page.controller.isPending(), true);
  assert.equal(page.element('callback-task-fields').disabled, true);
  assert.equal(page.element('task-uncertain').hidden, false);
  const original = structuredClone(mutations(page)[0]);
  page.element('task-notes').value = 'Attempted modification while frozen';
  page.controller.discard();
  assert.equal(page.controller.isPending(), true);
  page.state.behavior = null;
  await page.element('retry-task-save').emit('click'); await settle();
  assert.deepEqual(mutations(page)[1], original);
  assert.equal(page.controller.isPending(), false);
  assert.equal(page.saved.length, 1);
});
test('callback malformed success is treated as an uncertain save instead of clearing the draft', async () => {
  const page = harness(); await settle(); await fill(page);
  page.state.behavior = async () => ({ task: TASK, lead: SECOND });
  await page.element('callback-task-form').emit('submit');
  assert.equal(page.controller.isPending(), true); assert.equal(page.saved.length, 0);
  assert.equal(page.element('task-notes').value, 'Synthetic follow-up plan');
});
test('callback a rejected retry cannot erase an earlier unknown save result', async () => {
  const page = harness(); await settle(); await fill(page);
  page.state.behavior = async () => { throw Object.assign(new Error('Unknown first result'), { status: 503 }); };
  await page.element('callback-task-form').emit('submit');
  const first = structuredClone(mutations(page)[0]);
  page.state.behavior = async () => { throw Object.assign(new Error('Retry rejected'), { status: 403 }); };
  await page.element('retry-task-save').emit('click');
  assert.equal(page.controller.isPending(), true);
  assert.equal(page.element('callback-task-fields').disabled, true);
  assert.deepEqual(mutations(page)[1], first);
  page.state.behavior = null;
  await page.element('retry-task-save').emit('click'); await settle();
  assert.deepEqual(mutations(page)[2], first);
  assert.equal(page.controller.isPending(), false);
});
test('callback version rejection retains edits and requires a reload before another mutation', async () => {
  const page = harness(); await settle(); await fill(page);
  page.state.behavior = async () => { throw Object.assign(new Error('Request changed'), { status: 409, code: 'version_conflict' }); };
  await page.element('callback-task-form').emit('submit');
  assert.equal(page.controller.isPending(), false); assert.equal(page.element('task-conflict').hidden, false);
  assert.equal(page.element('task-notes').value, 'Synthetic follow-up plan');
  await page.element('callback-task-form').emit('submit');
  assert.equal(mutations(page).length, 1);
  await page.element('reload-task-request').emit('click'); assert.equal(page.state.reloads, 1);
});
test('callback form correction remains possible after a definitive input rejection', async () => {
  const page = harness(); await settle(); await fill(page);
  page.state.behavior = async () => { throw Object.assign(new Error('Notes not accepted'), { status: 400, code: 'invalid_input' }); };
  await page.element('callback-task-form').emit('submit');
  assert.equal(page.controller.isPending(), false); assert.equal(page.element('callback-task-fields').disabled, false);
  assert.equal(page.element('task-conflict').hidden, true);
});
for (const [reason, change] of [['opt-out', { optedOut: true }], ['safety hold', { safetyHold: true }], ['closed request', { status: 'closed' }], ['review request', { status: 'needs_review' }], ['missing permission', { contactAllowed: false }]]) {
  test(`callback ${reason} blocks scheduling without hiding the saved request`, async () => {
    const page = harness({ lead: { ...LEAD, ...change } }); await settle(); await fill(page);
    await page.element('callback-task-form').emit('submit');
    assert.equal(mutations(page).length, 0); assert.equal(page.element('save-callback-task').disabled, true);
    assert.equal(page.element('task-restriction').hidden, false);
  });
}
test('callback blocked task retains cancellation while contact actions remain disabled', async () => {
  const page = harness({ lead: { ...LEAD, optedOut: true }, tasks: [{ ...TASK, contactAllowed: false, blockReason: 'contact_blocked' }] }); await settle();
  const buttons = page.element('lead-task-list').querySelectorAll('button');
  assert.equal(buttons[0].disabled, true); assert.equal(buttons[1].disabled, true); assert.equal(buttons[2].disabled, false);
  await buttons[2].emit('click');
  assert.equal(page.element('save-callback-task').disabled, false);
  page.element('task-notes').value = 'Cancelled after opt-out';
  await page.element('callback-task-form').emit('submit'); await settle();
  assert.equal(mutations(page)[0].body.action, 'cancel');
  assert.equal(mutations(page)[0].body.version, 1);
});
test('callback rescheduling restores the saved occurrence in a repeated clock hour', async () => {
  const page = harness({ tasks: [{ ...TASK, dueAt: '2026-11-01T06:30:00.000Z' }] }); await settle();
  await page.element('lead-task-list').querySelectorAll('button')[1].emit('click');
  assert.equal(page.element('task-local-time').value, '2026-11-01T01:30');
  assert.equal(page.element('task-occurrence').value, '2026-11-01T06:30:00.000Z');
  await page.element('callback-task-form').emit('submit'); await settle();
  assert.equal(mutations(page)[0].body.dueAt, '2026-11-01T06:30:00.000Z');
});
test('callback completion requires a reported outcome and removes date requirements', async () => {
  const page = harness({ tasks: [TASK] }); await settle();
  await page.element('lead-task-list').querySelectorAll('button')[0].emit('click');
  assert.equal(page.element('task-notes').value, TASK.notes);
  await page.element('callback-task-form').emit('submit'); assert.equal(mutations(page).length, 0);
  page.element('task-outcome').value = 'no_answer';
  await page.element('callback-task-form').emit('submit'); await settle();
  assert.equal(mutations(page)[0].body.action, 'complete'); assert.equal(mutations(page)[0].body.outcome, 'no_answer');
  assert.equal(mutations(page)[0].body.notes, TASK.notes);
  assert.equal('dueAt' in mutations(page)[0].body, false);
  assert.match(page.element('task-save-status').textContent, /Schedule a follow-up/);
});
test('callback completed and cancelled task cards expose no further mutation controls', async () => {
  const page = harness({ tasks: [{ ...TASK, status: 'completed', outcome: 'reached' }, { ...TASK, id: SECOND.id, status: 'cancelled' }] }); await settle();
  assert.equal(page.element('lead-task-list').querySelectorAll('button').length, 0);
  assert.match(page.element('lead-task-list').textContent, /Reached customer/);
});
test('callback task list rejects a record from another request', async () => {
  const page = harness({ tasks: [{ ...TASK, leadId: SECOND.id }] }); await settle();
  assert.equal(page.element('lead-task-list').children.length, 0);
  assert.match(page.element('task-error').textContent, /did not match/);
});
test('callback stale task read cannot repopulate the previous request', async () => {
  const page = harness({ lead: false }); let finish;
  page.state.reads = url => url.includes(LEAD.id) ? new Promise(resolve => { finish = resolve; }) : Promise.resolve({ tasks: [], total: 0, generatedAt: NOW });
  page.controller.selectLead(LEAD); page.controller.selectLead(SECOND); await settle();
  finish({ tasks: [TASK], total: 1, generatedAt: NOW }); await settle();
  assert.doesNotMatch(page.element('lead-task-list').textContent, /Synthetic task/);
  assert.match(page.element('lead-task-list').textContent, /No tasks/);
});
test('callback session expiration clears private task content and ignores in-flight queue results', async () => {
  const page = harness({ tasks: [TASK] }); await settle(); let finish;
  page.state.reads = () => new Promise(resolve => { finish = resolve; });
  const loading = page.controller.openQueue(); page.controller.clear();
  finish({ tasks: [TASK], total: 1, generatedAt: NOW }); await loading;
  assert.equal(page.element('callback-queue-list').children.length, 0);
  assert.equal(page.element('lead-task-list').children.length, 0);
  assert.equal(page.element('task-notes').value, '');
});
test('callback saved markup remains literal text in task notes and customer names', async () => {
  const text = '<img src=x onerror=synthetic()>', page = harness({ tasks: [{ ...TASK, notes: text, customerName: text }] }); await settle();
  await page.controller.openQueue();
  assert.match(page.element('callback-queue-list').textContent, /<img src=x/);
  assert.equal(page.element('callback-queue-list').querySelectorAll('img').length, 0);
});
test('callback queue paginates server totals and preserves the selected state filter', async () => {
  const page = harness({ tasks: [TASK], total: 51 }); await settle();
  page.element('callback-queue-filter').value = 'due'; await page.controller.openQueue();
  assert.equal(page.element('callback-queue-next').disabled, false);
  await page.element('callback-queue-next').emit('click'); await settle();
  assert.match(page.calls.at(-1).url, /state=due&limit=50&offset=50/);
  assert.equal(page.element('callback-queue-previous').disabled, false);
  await page.element('callback-queue-list').querySelectorAll('button')[0].emit('click');
  assert.deepEqual(page.opened, [LEAD.id]);
});
test('callback queue failure clears old cards instead of displaying them as refreshed', async () => {
  const page = harness({ tasks: [TASK] }); await settle(); await page.controller.openQueue();
  page.state.reads = async () => { throw new Error('Synthetic unavailable'); };
  await page.controller.openQueue();
  assert.equal(page.element('callback-queue-list').children.length, 0);
  assert.equal(page.element('callback-queue-error').hidden, false);
});

async function actionDraft(action = 'complete') {
  const page = harness({ tasks: [TASK] }); await settle();
  await page.element('lead-task-list').querySelectorAll('button')[action === 'reschedule' ? 1 : 0].emit('click');
  if (action === 'reschedule') await fill(page, '2026-12-02T10:15');
  else page.element('task-outcome').value = 'no_answer';
  page.element('task-notes').value = 'Keep this operator task draft';
  return page;
}
function assertUnconfirmedTask(page, notes = 'Keep this operator task draft') {
  assert.equal(page.controller.isPending(), true);
  assert.equal(page.controller.isDirty(), true);
  assert.equal(page.saved.length, 0);
  assert.equal(page.element('task-notes').value, notes);
  assert.equal(page.element('task-uncertain').hidden, false);
  assert.equal(page.element('retry-task-save').disabled, false);
  assert.equal(page.element('callback-task-fields').disabled, true);
  assert.equal(page.element('task-save-status').textContent, '');
  assert.match(page.element('task-error').textContent, /incomplete|rejected/i);
}
test('callback wrong-task receipt keeps the same command through a rejected retry until the matching receipt arrives', async () => {
  const page = await actionDraft();
  page.state.behavior = async call => { const receipt = savedReceipt(call); receipt.task.id = SECOND.id; return receipt; };
  await page.element('callback-task-form').emit('submit'); assertUnconfirmedTask(page);
  const original = structuredClone(mutations(page)[0]);
  assert.equal(original.url, `/api/callback-tasks/${TASK.id}`);
  page.state.behavior = async () => { throw Object.assign(new Error('Retry rejected'), { status: 403 }); };
  await page.element('retry-task-save').emit('click'); assertUnconfirmedTask(page);
  page.state.behavior = null;
  await page.element('retry-task-save').emit('click'); await settle();
  assert.deepEqual(mutations(page), [original, original, original]);
  assert.equal(page.controller.isPending(), false);
  assert.equal(page.saved.length, 1);
  assert.match(page.element('task-save-status').textContent, /Call outcome saved/);
});
test('callback fresh receipts require advancement of both the parent and the selected task revision', async () => {
  for (const stale of ['lead', 'task']) {
    const page = await actionDraft();
    page.state.behavior = async call => {
      const receipt = savedReceipt(call);
      if (stale === 'lead') { receipt.lead.version = call.body.leadVersion; receipt.task.leadVersion = call.body.leadVersion; }
      else receipt.task.version = call.body.version;
      return receipt;
    };
    await page.element('callback-task-form').emit('submit'); assertUnconfirmedTask(page);
  }
});
test('callback current-revision receipts must confirm the requested action and scheduling fields', async () => {
  const completion = await actionDraft();
  completion.state.behavior = async call => {
    const receipt = savedReceipt(call);
    Object.assign(receipt.task, { status: 'scheduled', outcome: '', completedAt: null, dueState: 'upcoming' });
    return receipt;
  };
  await completion.element('callback-task-form').emit('submit'); assertUnconfirmedTask(completion);
  const reschedule = await actionDraft('reschedule');
  reschedule.state.behavior = async call => {
    const receipt = savedReceipt(call); receipt.task.dueAt = '2026-12-09T20:00:00.000Z'; receipt.task.notes = 'Other saved task notes'; return receipt;
  };
  await reschedule.element('callback-task-form').emit('submit'); assertUnconfirmedTask(reschedule);
  assert.equal(reschedule.element('task-local-time').value, '2026-12-02T10:15');
});
test('callback incomplete task shape cannot erase a creation draft or report a saved schedule', async () => {
  const page = harness(); await settle(); await fill(page);
  page.state.behavior = async call => ({ ...savedReceipt(call), task: { leadId: LEAD.id, version: 1 } });
  await page.element('callback-task-form').emit('submit'); assertUnconfirmedTask(page, 'Synthetic follow-up plan');
  assert.equal(page.element('task-local-time').value, '2026-12-01T09:30');
});
test('callback consumed parent records are checked before handing a receipt to the request renderer', async () => {
  const page = harness(); await settle(); await fill(page);
  page.state.behavior = async call => { const receipt = savedReceipt(call); receipt.lead.audit = [null]; return receipt; };
  await page.element('callback-task-form').emit('submit'); assertUnconfirmedTask(page, 'Synthetic follow-up plan');
});
test('callback creation replay accepts later cancellation and current opt-out without repeating the write', async () => {
  const page = harness(); await settle(); await fill(page);
  page.state.behavior = async () => { throw Object.assign(new Error('Lost committed response'), { status: 503 }); };
  await page.element('callback-task-form').emit('submit');
  const original = structuredClone(mutations(page)[0]);
  page.state.behavior = async call => {
    const receipt = savedReceipt(call);
    Object.assign(receipt, { created: false, replayed: true });
    Object.assign(receipt.lead, { version: 5, optedOut: true, contactPermission: 'opted_out', contactAllowed: false, status: 'needs_review' });
    Object.assign(receipt.task, { version: 3, leadVersion: 5, status: 'cancelled', cancelledAt: NOW, dueState: null,
      notes: 'Later cancellation after STOP', contactAllowed: false, blockReason: 'contact_blocked', requestStatus: 'needs_review' });
    page.state.rows = [receipt.task]; return receipt;
  };
  await page.element('retry-task-save').emit('click'); await settle();
  assert.deepEqual(mutations(page), [original, original]);
  assert.equal(page.controller.isPending(), false); assert.equal(page.saved[0].version, 5);
  assert.equal(page.saved[0].optedOut, true); assert.equal(page.element('save-callback-task').disabled, true);
  assert.equal(page.element('task-save-status').textContent, 'Task cancelled.');
  assert.match(page.element('lead-task-list').textContent, /Later cancellation after STOP/);
});
test('callback reschedule replay accepts a later completed task while retaining its original identity', async () => {
  const page = await actionDraft('reschedule');
  page.state.behavior = async () => { throw Object.assign(new Error('Lost committed response'), { status: 503 }); };
  await page.element('callback-task-form').emit('submit');
  const original = structuredClone(mutations(page)[0]);
  page.state.behavior = async call => {
    const receipt = savedReceipt(call);
    Object.assign(receipt, { replayed: true }); receipt.lead.version = 5;
    Object.assign(receipt.task, { version: 4, leadVersion: 5, status: 'completed', completedAt: NOW, dueState: null,
      dueAt: '2026-12-10T16:00:00.000Z', notes: 'Operator completed a later plan', outcome: 'reached' });
    page.state.rows = [receipt.task]; return receipt;
  };
  await page.element('retry-task-save').emit('click'); await settle();
  assert.deepEqual(mutations(page), [original, original]);
  assert.equal(page.controller.isPending(), false); assert.equal(page.saved[0].version, 5);
  assert.match(page.element('task-save-status').textContent, /Call outcome saved/);
  assert.equal(page.element('lead-task-list').querySelectorAll('button').length, 0);
});
