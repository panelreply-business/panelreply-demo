'use strict';

// Real HTTP boundary checks run in CI. The provider is always injected and fake.
// Do not run this file in a local environment that disallows listening sockets.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const { createApp } = require('../server.cjs');

test('the HTTP server serves the demo and enforces intake gates with a fake provider', async () => {
  let app;
  let providerCalls = 0;
  const token = 'http-test-access-code-with-over-32-characters';
  const key = 'http-test-provider-secret-not-a-real-key';
  const server = http.createServer((req, res) => app.handler(req, res));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = 'http://127.0.0.1:' + server.address().port;
  app = createApp({
    env: {
      AI_DEMO_ENABLED: 'true', OPENAI_API_KEY: key, OPENAI_MODEL: 'fake-test-model',
      DEMO_ACCESS_TOKEN: token, PUBLIC_ORIGIN: origin, AI_MAX_REQUESTS_PER_PROCESS: '1'
    },
    fetchImpl: async () => {
      providerCalls += 1;
      return { ok: true, text: async () => JSON.stringify({
        status: 'completed',
        output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{
          type: 'output_text', text: JSON.stringify({
            job: 'EV charger', zip: '48315', timing: 'Friday after 4 pm',
            opt_out_evidence: null, hazard_evidence: null, ambiguous: false
          })
        }] }]
      }) };
    }
  });
  const input = JSON.stringify({
    message: 'I need an EV charger. My ZIP is 48315. Call Friday after 4 pm.',
    fields: { job: '', zip: '', timing: '' }
  });
  const headers = { Origin: origin, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
  try {
    const page = await fetch(origin + '/');
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /data-ai-enabled="true"/);
    assert.ok(!html.includes(key));
    assert.ok(!html.includes(token));
    assert.equal(page.headers.get('cache-control'), 'no-store');
    assert.equal(page.headers.get('content-security-policy'), "frame-ancestors 'none'");
    const health = await fetch(origin + '/health');
    assert.deepEqual(await health.json(), { ok: true, aiEnabled: true, bookingEnabled: false });
    const unauthenticated = await fetch(origin + '/api/intake', {
      method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: input
    });
    assert.equal(unauthenticated.status, 401);
    const foreign = await fetch(origin + '/api/intake', {
      method: 'POST', headers: { ...headers, Origin: 'https://untrusted.example' }, body: input
    });
    assert.equal(foreign.status, 403);
    assert.equal(foreign.headers.get('access-control-allow-origin'), null);
    const malformed = await fetch(origin + '/api/intake', { method: 'POST', headers, body: '{invalid' });
    assert.equal(malformed.status, 400);
    const oversized = await fetch(origin + '/api/intake', { method: 'POST', headers, body: 'x'.repeat(9000) });
    assert.equal(oversized.status, 413);
    assert.equal(providerCalls, 0);
    const extracted = await fetch(origin + '/api/intake', { method: 'POST', headers, body: input });
    assert.equal(extracted.status, 200);
    assert.deepEqual(await extracted.json(), {
      mode: 'ai', fields: { job: 'EV charger', zip: '48315', timing: 'Friday after 4 pm' },
      flags: { optOut: false, hazard: false, ambiguous: false }
    });
    const capped = await fetch(origin + '/api/intake', { method: 'POST', headers, body: input });
    assert.equal(capped.status, 429);
    assert.equal((await capped.json()).error.code, 'request_cap_reached');
    const stop = await fetch(origin + '/api/intake', {
      method: 'POST', headers, body: JSON.stringify({ message: 'STOP', fields: { job: '', zip: '', timing: '' } })
    });
    assert.equal(stop.status, 200);
    assert.equal((await stop.json()).flags.optOut, true);
    const hiddenFile = await fetch(origin + '/.env.example');
    assert.equal(hiddenFile.status, 404);
    assert.equal(providerCalls, 1);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
