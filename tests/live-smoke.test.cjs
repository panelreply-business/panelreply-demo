'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const origin = 'https://panelreply-demo.onrender.com';

test('live Render demo responds with an explicit sample-only disclosure', { timeout: 25000 }, async () => {
  const response = await fetch(origin + '/', { signal: AbortSignal.timeout(20000) });
  assert.equal(response.status, 200, 'Expected the live site to return HTTP 200');
  const html = await response.text();
  assert.match(html, /PanelReply/);
  assert.match(html, /SAMPLE DATA/);
  assert.match(html, /No calls, texts or emails are sent/);
  assert.match(html, /does not (?:store customer requests|save requests to a customer database) or book appointments/);
});

test('live robots.txt is available and blocks search indexing', { timeout: 25000 }, async () => {
  const response = await fetch(origin + '/robots.txt', { signal: AbortSignal.timeout(20000) });
  assert.equal(response.status, 200, 'Expected robots.txt to return HTTP 200');
  const txt = await response.text();
  assert.match(txt, /User-agent:\s*\*/i);
  assert.match(txt, /Disallow:\s*\//i);
});

test('live Render demo CSP matches its delivered script and style', { timeout: 25000 }, async () => {
  const response = await fetch(origin + '/', { signal: AbortSignal.timeout(20000) });
  assert.equal(response.status, 200);
  const html = await response.text();
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  const style = html.match(/<style>([\s\S]*?)<\/style>/)?.[1];
  const csp = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)"/)?.[1];
  assert.ok(script && style && csp, 'Expected inline script, style and meta CSP');
  const sha = txt => crypto.createHash('sha256').update(txt).digest('base64');
  assert.ok(csp.includes("script-src 'sha256-" + sha(script) + "'"));
  assert.ok(csp.includes("style-src 'sha256-" + sha(style) + "'"));
  assert.match(csp, /connect-src '(?:none|self)'(?:;|$)/);
  if (csp.includes("connect-src 'self'")) {
    assert.match(html, /data-ai-enabled="false"/, 'The published static app must not activate the server AI mode');
    assert.match(script, /fetch\('\/api\/intake'/, 'The optional AI adapter must stay on the same origin');
    assert.doesNotMatch(script, /fetch\(['"]https?:/, 'No direct third-party provider calls from the browser');
  }
  assert.match(csp, /form-action 'none'/);
  assert.match(html, /name="robots" content="noindex,nofollow"/);
});

