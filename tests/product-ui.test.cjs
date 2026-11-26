'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { renderProductHtml } = require('../workspace/product-ui.cjs');
const root = path.resolve(__dirname, '..');
const template = name => fs.readFileSync(path.join(root, 'workspace', name + '.html'), 'utf8');

for (const name of ['index', 'preview', 'panels', 'login', 'dashboard']) {
  test(`PRODUCT-UI shared combined ${name} template remains unchanged`, () => {
    const html = template(name);
    assert.equal(renderProductHtml(html), html);
    assert.equal(renderProductHtml(html, { id: 'combined' }), html);
  });
}

for (const name of ['index', 'preview', 'login']) {
  test(`PRODUCT-UI callback ${name} exposes only callback navigation and branding`, () => {
    const html = renderProductHtml(template(name), { id: 'callback' });
    assert.match(html, /data-product-id="callback"/);
    assert.match(html, /data-product-home="\/"/);
    assert.match(html, /<title>[^<]*PanelReply Callback<\/title>/);
    assert.match(html, /CALLBACK WORKSPACE/);
    assert.doesNotMatch(html, /href="(?:\/panels|\/dashboard)|src="\/assets\/(?:panels|dashboard)\.js"/);
    assert.doesNotMatch(html, /Panel scanning|Saved projects|organize panel components|panel records stay here/);
    assert.doesNotMatch(html, /<!-- \/?product:/);
    if (name === 'index') {
      assert.match(html, /id="nav-inbox"/);
      assert.match(html, /id="nav-profile"/);
      assert.match(html, /id="nav-schedule"/);
      assert.match(html, /src="\/assets\/schedule\.js"/);
      assert.match(html, /id="preview-link" href="\/preview"/);
      for (const id of ['dashboard-link', 'panels-link', 'projects-link', 'exports-link']) assert.ok(!html.includes(`id="${id}"`));
    }
  });
}

for (const name of ['panels', 'login']) {
  test(`PRODUCT-UI spreadsheet ${name} exposes only spreadsheet navigation and branding`, () => {
    const html = renderProductHtml(template(name), { id: 'spreadsheet' });
    assert.match(html, /data-product-id="spreadsheet"/);
    assert.match(html, /data-product-home="\/panels"/);
    assert.match(html, /<title>[^<]*PanelReply Spreadsheets<\/title>/);
    assert.match(html, /SPREADSHEET WORKSPACE/);
    assert.doesNotMatch(html, /href="(?:\/(?:dashboard|preview)|\/#settings|\/")|src="\/assets\/(?:app|preview|dashboard|schedule)\.js"/);
    assert.doesNotMatch(html, /Customer requests|Business profile|review requests|business answers/);
    assert.doesNotMatch(html, /<!-- \/?product:/);
    if (name === 'panels') {
      for (const id of ['panel-image', 'new-project', 'add-ocr-rows', 'export-project', 'export-project-xlsx']) assert.ok(html.includes(`id="${id}"`));
      assert.match(html, /<a data-product-home href="\/panels"[^>]*aria-label="PanelReply Spreadsheets projects"/);
    }
  });
}

for (const [product, name] of [['callback', 'panels'], ['callback', 'dashboard'], ['spreadsheet', 'index'], ['spreadsheet', 'preview'], ['spreadsheet', 'dashboard']]) {
  test(`PRODUCT-UI ${product} rejects the ${name} page instead of exposing another program`, () => {
    assert.throws(() => renderProductHtml(template(name), { id: product }), /does not belong/);
  });
}

test('PRODUCT-UI shared caller labels and navigation cannot become HTML', () => {
  const expected = renderProductHtml(template('login'), { id: 'spreadsheet' });
  const attempted = renderProductHtml(template('login'), {
    id: 'spreadsheet', label: '<script>bad()</script>', homePath: '//external.example.test',
    caption: '<img src=x onerror=bad()>', capabilities: { intake: true },
  });
  assert.equal(attempted, expected);
});

for (const id of ['unknown', '__proto__', '"><script>bad()</script>']) {
  test(`PRODUCT-UI shared rejects unknown product identifier ${JSON.stringify(id)}`, () => {
    assert.throws(() => renderProductHtml(template('login'), { id }), /Unknown product/);
  });
}

test('PRODUCT-UI shared fails closed for an unbalanced navigation region', () => {
  const changed = template('index').replace('<!-- /product:combined -->', '');
  assert.throws(() => renderProductHtml(changed, { id: 'callback' }), /Unbalanced/);
});
test('PRODUCT-UI shared fails closed for an unknown template marker', () => {
  const changed = template('login') + '<!-- product:unknown -->unsafe<!-- /product:unknown -->';
  assert.throws(() => renderProductHtml(changed, { id: 'callback' }), /Unknown or unbalanced/);
});
test('PRODUCT-UI shared requires a product title rather than returning ambiguous branding', () => {
  const changed = template('login').replace(/<!-- product:title -->.*?<!-- \/product:title -->/, '');
  assert.throws(() => renderProductHtml(changed, { id: 'callback' }), /Missing product/);
});

function loginHarness({ selected, data, status = 200 } = {}) {
  const nodes = new Map();
  const handlers = new Map();
  const redirects = [];
  const requests = [];
  for (const id of ['login-form', 'username', 'password', 'sign-in', 'login-error', 'login-status']) {
    nodes.set(id, { value: id === 'username' ? ' owner@example.test ' : id === 'password' ? 'synthetic-password' : '',
      disabled: false, hidden: true, textContent: '', reportValidity: () => true,
      addEventListener: (event, handler) => handlers.set(`${id}:${event}`, handler), focus() { this.focused = true; } });
  }
  const context = vm.createContext({
    document: { getElementById: id => nodes.get(id), body: { dataset: selected ? { productId: selected } : {} } },
    window: { location: { replace: value => redirects.push(value) } },
    fetch: async (url, options) => { requests.push({ url, options }); return { ok: status >= 200 && status < 300, status, json: async () => data }; },
  });
  vm.runInContext(fs.readFileSync(path.join(root, 'workspace/login.js'), 'utf8'), context);
  return { nodes, redirects, requests, submit: () => handlers.get('login-form:submit')({ preventDefault() {} }) };
}
const account = { user: { id: 'synthetic-user', username: 'owner@example.test' }, csrfToken: 'synthetic-token' };

for (const [selected, home] of [['callback', '/'], ['spreadsheet', '/panels'], [undefined, '/']]) {
  test(`PRODUCT-UI ${selected || 'shared'} login opens only its expected home`, async () => {
    const data = selected ? { ...account, product: { id: selected, homePath: home } } : account;
    const harness = loginHarness({ selected, data });
    await harness.submit();
    assert.deepEqual(harness.redirects, [home]);
    assert.equal(harness.nodes.get('password').value, '');
    assert.equal(harness.requests.length, 1);
    assert.equal(harness.requests[0].url, '/api/login');
    assert.equal(harness.requests[0].options.credentials, 'same-origin');
  });
}

const invalidLogins = [
  ['callback', undefined, 'missing product'],
  ['spreadsheet', null, 'null product'],
  ['callback', { id: 'spreadsheet', homePath: '/panels' }, 'another product'],
  ['spreadsheet', { id: 'spreadsheet', homePath: '/' }, 'wrong local home'],
  ['spreadsheet', { id: 'spreadsheet', homePath: '//external.example.test' }, 'protocol-relative home'],
  ['callback', { id: 'callback', homePath: 'https://external.example.test' }, 'external home'],
  ['callback', { id: '__proto__', homePath: '/' }, 'prototype name'],
  ['spreadsheet', { id: 'spreadsheet', homePath: '/panels?product=callback' }, 'unapproved query'],
];
for (const [selected, product, label] of invalidLogins) {
  test(`PRODUCT-UI ${selected} login rejects ${label}`, async () => {
    const harness = loginHarness({ selected, data: { ...account, product } });
    await harness.submit();
    assert.deepEqual(harness.redirects, []);
    assert.equal(harness.nodes.get('login-error').hidden, false);
    assert.match(harness.nodes.get('login-error').textContent, /program could not be confirmed/);
    assert.equal(harness.nodes.get('password').value, '');
    assert.equal(harness.nodes.get('sign-in').disabled, false);
  });
}

test('PRODUCT-UI callback rejected credentials never redirect into a program', async () => {
  const harness = loginHarness({ selected: 'callback', status: 401, data: { error: { message: 'Synthetic rejected sign-in' } } });
  await harness.submit();
  assert.deepEqual(harness.redirects, []);
  assert.match(harness.nodes.get('login-error').textContent, /Synthetic rejected sign-in/);
});
