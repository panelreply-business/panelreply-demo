'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { Readable } = require('node:stream');
const { EventEmitter } = require('node:events');
const { openStore } = require('../workspace/store.cjs');
const { hashPassword } = require('../workspace/auth.cjs');
const { createWorkspaceApp } = require('../workspace/api.cjs');

const ORIGIN = 'http://127.0.0.1:10001';
const PASSWORD = 'Synthetic export password 2026!';
const HASH = hashPassword(PASSWORD);
const LEAD = { customerName: 'Jamie Export', phone: '+15865550101', job: 'Install a garage EV charger', zip: '48315', callbackWindow: 'Monday after 4 pm', requestedWorkDate: 'Friday', contactPermission: 'requested_callback', conversation: [{ role: 'customer', text: 'Please call me about an EV charger.' }, { role: 'assistant', text: 'No appointment is booked.' }] };

async function fixture(t) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'panelreply-export-'));
  let currentTime = Date.now();
  const store = openStore({ dataDir, now: () => currentTime });
  const hash = await HASH;
  const owner = store.createBusinessOwner({ businessName: 'Example Electric', username: 'export-owner@example.test', passwordHash: hash });
  const other = store.createBusinessOwner({ businessName: 'Other Electric', username: 'other-export@example.test', passwordHash: hash });
  const app = createWorkspaceApp({ store, origin: ORIGIN });
  t.after(() => { store.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });
  return { app, store, owner, other, hash, advance(ms) { currentTime += ms; } };
}

async function request(app, { method = 'GET', url = '/api/export', headers = {}, input } = {}) {
  const req = Readable.from(input === undefined ? [] : [JSON.stringify(input)]);
  Object.assign(req, { method, url, headers: { host: '127.0.0.1:10001', origin: ORIGIN, 'content-type': 'application/json', ...headers }, socket: { remoteAddress: '127.0.0.1' } });
  const res = new EventEmitter();
  res.writableEnded = false;
  res.destroyed = false;
  res.writeHead = (status, resultHeaders) => { res.status = status; res.headers = resultHeaders; };
  res.end = body => { res.text = body === undefined ? '' : String(body); res.writableEnded = true; };
  await app.handler(req, res);
  return { status: res.status, headers: res.headers, text: res.text, body: res.text ? JSON.parse(res.text) : null };
}

async function login(f, owner = f.owner) {
  const response = await request(f.app, { method: 'POST', url: '/api/login', input: { username: owner.username, password: PASSWORD } });
  assert.equal(response.status, 200);
  return { cookie: response.headers['Set-Cookie'].split(';')[0], csrf: response.body.csrfToken };
}

test('record export rejects anonymous and forged sessions without attachment or records', async t => {
  const f = await fixture(t);
  for (const headers of [{}, { cookie: 'PanelReplyLocalSession=invalid' }]) {
    const result = await request(f.app, { headers });
    assert.equal(result.status, 401);
    assert.equal(result.headers['Content-Disposition'], undefined);
    assert.equal(result.body.error.code, 'unauthorized');
    assert.equal(result.body.leads, undefined);
  }
});

test('record export provides a versioned JSON attachment with saved profile and complete request details', async t => {
  const f = await fixture(t);
  const profile = f.store.getProfile(f.owner);
  profile.facts.hours = { verified: true, answer: 'Office hours Monday through Friday, 8 am–5 pm.' };
  const updated = f.store.updateProfile(f.owner, { version: profile.version, businessName: profile.business.name, facts: profile.facts });
  const { lead } = f.store.createLead(f.owner, LEAD, crypto.randomUUID());
  const signed = await login(f);
  const result = await request(f.app, { headers: { cookie: signed.cookie } });
  assert.equal(result.status, 200);
  assert.equal(result.body.format, 'panelreply-business-export');
  assert.equal(result.body.version, 2);
  assert.match(result.body.exportedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(result.body.profile, updated);
  assert.equal(result.body.leads.length, 1);
  assert.equal(result.body.leads[0].id, lead.id);
  assert.deepEqual(result.body.leads[0].conversation, LEAD.conversation);
  assert.equal(result.body.leads[0].callbackWindow, 'Monday after 4 pm');
  assert.equal(result.body.leads[0].requestedWorkDate, 'Friday');
  assert.equal(result.body.leads[0].audit[0].action, 'lead.created');
  assert.equal(result.headers['Content-Type'], 'application/json; charset=utf-8');
  assert.match(result.headers['Content-Disposition'], /^attachment; filename="panelreply-records-\d{4}-\d{2}-\d{2}\.json"$/);
  assert.equal(result.headers['Cache-Control'], 'no-store');
  assert.equal(result.headers['X-Content-Type-Options'], 'nosniff');
  assert.equal(result.headers['Cross-Origin-Resource-Policy'], 'same-origin');
});

test('record export scopes profile, leads and transcript to the authenticated business despite query parameters', async t => {
  const f = await fixture(t);
  f.store.createLead(f.owner, LEAD, crypto.randomUUID());
  const secret = 'Other business private transcript marker';
  const otherLead = f.store.createLead(f.other, { ...LEAD, customerName: 'Other customer', phone: '+12485550102', conversation: [{ role: 'customer', text: secret }] }, crypto.randomUUID()).lead;
  const first = await login(f);
  const result = await request(f.app, { url: '/api/export?businessId=' + f.other.businessId + '&lead=' + otherLead.id, headers: { cookie: first.cookie } });
  assert.equal(result.body.profile.business.id, f.owner.businessId);
  assert.equal(result.body.leads.length, 1);
  assert.equal(result.body.leads[0].customerName, 'Jamie Export');
  for (const forbidden of [f.other.businessId, otherLead.id, 'Other customer', secret]) assert.ok(!result.text.includes(forbidden));
  const second = await login(f, f.other);
  const secondResult = await request(f.app, { headers: { cookie: second.cookie } });
  assert.equal(secondResult.body.profile.business.id, f.other.businessId);
  assert.equal(secondResult.body.leads[0].id, otherLead.id);
  assert.ok(!secondResult.text.includes('Jamie Export'));
});

test('record export allowlist excludes internal additions, hashes, tokens and arbitrary audit metadata', async t => {
  const f = await fixture(t);
  f.store.createLead(f.owner, LEAD, crypto.randomUUID());
  const signed = await login(f);
  const exportBusiness = f.store.exportBusiness;
  f.store.exportBusiness = actor => {
    const snapshot = exportBusiness(actor);
    return {
      profile: { ...snapshot.profile, password_hash: f.hash, csrfToken: signed.csrf, sessions: [signed.cookie] },
      leads: snapshot.leads.map(lead => ({ ...lead, password_hash: f.hash, session: signed.cookie, login_attempts: 4, audit: lead.audit.map(entry => ({ ...entry, secret: signed.csrf, details: { ...entry.details, passwordHash: f.hash, sessionToken: signed.cookie } })) }))
    };
  };
  const result = await request(f.app, { headers: { cookie: signed.cookie } });
  assert.equal(result.status, 200);
  for (const secret of [PASSWORD, f.hash, signed.cookie, signed.csrf, 'password_hash', 'passwordHash', 'sessionToken', 'login_attempts']) assert.ok(!result.text.includes(secret), secret + ' was exported');
  assert.deepEqual(Object.keys(result.body), ['format', 'version', 'exportedAt', 'profile', 'leads', 'callbackTasks']);
  assert.equal(result.body.leads[0].audit[0].details.messageCount, 2);
});

test('record export leaves saved values, versions and audit unchanged', async t => {
  const f = await fixture(t);
  const { lead } = f.store.createLead(f.owner, LEAD, crypto.randomUUID());
  f.store.updateLead(f.owner, lead.id, { version: lead.version, status: 'contacted', notes: 'Saved internal note.' });
  const before = { profile: f.store.getProfile(f.owner), leads: f.store.listLeads(f.owner) };
  const signed = await login(f);
  const result = await request(f.app, { url: '/api/export?notes=Unsaved%20replacement', headers: { cookie: signed.cookie } });
  assert.equal(result.body.leads[0].notes, 'Saved internal note.');
  assert.deepEqual({ profile: f.store.getProfile(f.owner), leads: f.store.listLeads(f.owner) }, before);
});

test('record export reflects stored opt-outs and safety holds without a booking claim', async t => {
  const f = await fixture(t);
  const first = f.store.createLead(f.owner, LEAD, crypto.randomUUID()).lead;
  f.store.suppressPhone(f.owner, first.phone);
  f.store.createLead(f.owner, { ...LEAD, customerName: 'Safety Fixture', phone: '+12485550102', job: 'The panel is sparking' }, crypto.randomUUID());
  const signed = await login(f);
  const result = await request(f.app, { headers: { cookie: signed.cookie } });
  const opted = result.body.leads.find(lead => lead.id === first.id);
  assert.equal(opted.optedOut, true);
  assert.equal(opted.contactAllowed, false);
  assert.equal(opted.status, 'needs_review');
  const hold = result.body.leads.find(lead => lead.customerName === 'Safety Fixture');
  assert.equal(hold.safetyHold, true);
  assert.equal(hold.contactAllowed, false);
  assert.equal(hold.status, 'needs_review');
  assert.ok(result.body.leads.every(lead => !Object.hasOwn(lead, 'appointment')));
});

test('expired record export returns an authentication error rather than a customer download', async t => {
  const f = await fixture(t);
  const signed = await login(f);
  f.advance(31 * 60 * 1000);
  const result = await request(f.app, { headers: { cookie: signed.cookie } });
  assert.equal(result.status, 401);
  assert.equal(result.headers['Content-Disposition'], undefined);
  assert.equal(result.body.leads, undefined);
});

test('record export storage failure exposes no partial archive or database detail', async t => {
  const f = await fixture(t);
  const signed = await login(f);
  f.store.exportBusiness = () => { throw new Error('SELECT private password_hash and hidden customer data from /secret/file'); };
  const result = await request(f.app, { headers: { cookie: signed.cookie } });
  assert.equal(result.status, 500);
  assert.equal(result.headers['Content-Disposition'], undefined);
  assert.equal(result.body.error.code, 'internal_error');
  assert.doesNotMatch(result.text, /password_hash|hidden customer|SELECT|secret/);
});

test('record export works for an empty business without claiming a restorable backup', async t => {
  const f = await fixture(t);
  const signed = await login(f);
  const result = await request(f.app, { headers: { cookie: signed.cookie } });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.leads, []);
  assert.equal(result.body.profile.business.name, 'Example Electric');
  assert.ok(Object.values(result.body.profile.facts).every(fact => !fact.verified && fact.answer === ''));
  assert.equal(result.body.restore, undefined);
});

test('export is a named read route and cannot act as import or arbitrary file access', async t => {
  const f = await fixture(t);
  const signed = await login(f);
  const headers = { cookie: signed.cookie, 'x-csrf-token': signed.csrf };
  for (const options of [{ method: 'POST', url: '/api/export', input: { filename: '/secret/file' } }, { url: '/api/export/workspace.sqlite' }, { url: '/api/export/../../workspace.sqlite' }]) {
    const result = await request(f.app, { ...options, headers });
    assert.equal(result.status, 404);
    assert.equal(result.headers['Content-Disposition'], undefined);
  }
  assert.deepEqual(f.store.listLeads(f.owner), []);
});
