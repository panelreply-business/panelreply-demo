'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const origin = 'https://panelreply-demo.onrender.com';

test('live Render demo responds with an explicit sample-only disclosure', { timeout: 25000 }, async () => {
  const response = await fetch(origin + '/', { signal: AbortSignal.timeout(20000) });
  assert.equal(response.status, 200, 'Expected the live site to return HTTP 200');
  const html = await response.text();
  assert.match(html, /PanelReply/);
  assert.match(html, /SAMPLE DATA/);
  assert.match(html, /No calls, texts or emails are sent/);
  assert.match(html, /does not store customer requests or book appointments/);
});

test('live robots.txt is available and blocks search indexing', { timeout: 25000 }, async () => {
  const response = await fetch(origin + '/robots.txt', { signal: AbortSignal.timeout(20000) });
  assert.equal(response.status, 200, 'Expected robots.txt to return HTTP 200');
  const txt = await response.text();
  assert.match(txt, /User-agent:\s*\*/i);
  assert.match(txt, /Disallow:\s*\//i);
});
