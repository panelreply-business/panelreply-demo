'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
const styleMatch = html.match(/<style>([\s\S]*?)<\/style>/);
assert.ok(scriptMatch, 'Expected one inline demo script');
assert.ok(styleMatch, 'Expected one inline stylesheet');
const script = scriptMatch[1];

function fixture() {
  const elements = new Map();
  const element = () => ({
    textContent: '',
    value: '',
    className: '',
    selectedIndex: 0,
    children: [],
    append(node) { this.children.push(node); },
    replaceChildren() { this.children = []; },
    click() { if (this.onclick) this.onclick(); },
  });
  const document = {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, element());
      return elements.get(id);
    },
    createElement: element,
  };
  const sandbox = { document };
  vm.runInNewContext(
    script + '\n;globalThis.__testApi = {send, reset, state: () => ({stage, stopped, hold, job, zip, timing})};',
    sandbox,
    { timeout: 1000 }
  );
  const node = id => document.getElementById(id);
  const messages = () => node('events').children.map(e => e.textContent);
  return { node, messages, ...sandbox.__testApi };
}

test('CSP authorizes the exact inline script and CSS, with network blocked', () => {
  const sh = crypto.createHash('sha256').update(script).digest('base64');
  const st = crypto.createHash('sha256').update(styleMatch[1]).digest('base64');
  assert.ok(html.includes("script-src 'sha256-" + sh + "'"));
  assert.ok(html.includes("style-src 'sha256-" + st + "'"));
  assert.match(html, /connect-src 'none'/);
  assert.match(html, /form-action 'none'/);
});

test('site identifies itself as a sample and does not promise actual dispatch', () => {
  assert.match(html, /SAMPLE DATA/);
  assert.match(html, /No calls, texts or emails are sent/);
  assert.match(html, /does not store customer requests or book appointments/);
});

test('no external network or browser storage interfaces are used by demo script', () => {
  assert.doesNotMatch(script, /\bfetch\s*\(/);
  assert.doesNotMatch(script, /\bXMLHttpRequest\b/);
  assert.doesNotMatch(script, /\blocalStorage\b/);
  assert.doesNotMatch(script, /\bnavigator\.sendBeacon\b/);
});

test('responsive layout rules exist (not a browser rendering test)', () => {
  assert.match(styleMatch[1], /@media\(max-width:650px\)/);
  assert.match(html, /name="viewport"/);
});

test('sample walkthrough collects job, ZIP and timing, but never books', () => {
  const f = fixture();
  f.node('example').onclick();
  const s = f.state();
  assert.equal(s.stage, 3);
  assert.equal(s.zip, '48315');
  assert.match(s.job, /EV charger/);
  assert.match(s.timing, /Next week/);
  assert.match(f.node('summary').textContent, /No appointment has been booked/);
});

test('missed call button is explicitly simulated, without sending texts', () => {
  const f = fixture();
  f.node('call').onclick();
  assert.match(f.node('call-status').textContent, /Simulated missed call/);
  assert.match(f.node('call-status').textContent, /No text sent/);
  assert.equal(f.state().stage, 0);
});

test('form input is trimmed and reset on submission', () => {
  const f = fixture();
  f.node('reply').value = '  Install EV charger  ';
  f.node('form').onsubmit({ preventDefault() {} });
  assert.equal(f.state().job, 'Install EV charger');
  assert.equal(f.node('reply').value, '');
});

test('empty and punctuation-only job descriptions do not advance', () => {
  const f = fixture();
  for (const value of [' ', '..', '!!!', '/???', '123456']) {
    f.send(value);
    assert.equal(f.state().stage, 0, 'Rejected ' + value);
  }
});

test('valid written job description advances to ZIP', () => {
  const f = fixture();
  f.send('Upgrade my service to 200 amps');
  assert.equal(f.state().stage, 1);
});

test('invalid ZIP values do not advance', () => {
  const f = fixture();
  f.send('Panel upgrade');
  for (const value of ['1234', '123456', 'AB123', '48084-1234', '!!!']) {
    f.send(value);
    assert.equal(f.state().stage, 1, 'Rejected ' + value);
  }
});

test('five-digit ZIP advances to callback time', () => {
  const f = fixture();
  f.send('Install lights');
  f.send('48084');
  assert.equal(f.state().stage, 2);
  assert.equal(f.state().zip, '48084');
});

test('punctuation-only callback time does not complete intake', () => {
  const f = fixture();
  f.send('Panel replacement');
  f.send('48084');
  f.send('!!!');
  assert.equal(f.state().stage, 2);
});

test('valid callback time completes simulated intake', () => {
  const f = fixture();
  f.send('Panel replacement');
  f.send('48084');
  f.send('Tomorrow at 5pm');
  assert.equal(f.state().stage, 3);
  assert.match(f.messages().join(' '), /No notification sent/);
});

test('STOP works for recognized opt-out commands', () => {
  for (const command of ['STOP', 'stop!', 'Please stop', 'stop please', 'UNSUBSCRIBE', 'CANCEL', 'QUIT', 'END']) {
    const f = fixture();
    f.send(command);
    assert.equal(f.state().stopped, true, 'Command ' + command);
    f.send('Install a generator');
    assert.equal(f.state().stage, 0, 'Blocked subsequent input for ' + command);
  }
});

test('natural-language text opt-outs pause simulated automated replies', () => {
  for (const command of [
    'Please stop texting me', 'Don\'t text me again', 'Do not contact me',
    'Remove me from your list', 'unsubscribe me', 'No more texts',
    'stop sending me messages', 'stop messaging me', 'opt out',
    'do not message me', 'dont text me', 'stop!!!'
  ]) {
    const f = fixture();
    f.send(command);
    assert.equal(f.state().stopped, true, 'Opt-out intent: ' + command);
    f.send('I need a breaker upgrade');
    assert.equal(f.state().stage, 0, 'No intake advancement after ' + command);
  }
});

test('ordinary text containing stop or cancel is not treated as opt-out', () => {
  for (const command of [
    'Stop by Thursday to look at my panel',
    'Can you stop by today?',
    'Please cancel my installation appointment',
    'I would like a quote for a stop switch',
    'Do not stop work on my panel'
  ]) {
    const f = fixture();
    f.send(command);
    assert.equal(f.state().stopped, false, 'Normal message: ' + command);
  }
});

test('smart-apostrophe opt-outs pause replies and preserve the displayed message', () => {
  for (const command of ['Don’t text me again', 'Please don’t contact me', 'Don‘t message me']) {
    const f = fixture();
    f.send(command);
    assert.equal(f.state().stopped, true, command);
    assert.equal(f.messages()[0], command, 'Keep the original customer message');
    f.send('Install lights');
    assert.equal(f.state().stage, 0, 'Do not continue intake after opt-out');
    assert.match(f.messages().at(-1), /without an automated reply/);
  }
});

test('commas around polite opt-out wording do not prevent opt-out', () => {
  for (const command of [
    'Please stop texting me, please.', 'Please, stop texting me.',
    'Don’t text me again, please!', 'Stop, please.', 'Remove me from your list, please.'
  ]) {
    const f = fixture();
    f.send(command);
    assert.equal(f.state().stopped, true, command);
    assert.equal(f.state().stage, 0);
    assert.equal(f.messages()[0], command);
  }
});

test('polite punctuation and smart apostrophes keep ordinary jobs in intake', () => {
  for (const message of ['Please, stop by Thursday.', 'Don’t stop work on my panel, please.']) {
    const f = fixture();
    f.send(message);
    assert.equal(f.state().stopped, false, message);
    assert.equal(f.state().stage, 1);
    assert.equal(f.state().job, message);
  }
});

test('START resumes without a safety hold', () => {
  const f = fixture();
  f.send('STOP');
  f.send('START');
  assert.equal(f.state().stopped, false);
  f.send('Upgrade breaker panel');
  assert.equal(f.state().stage, 1);
});

test('UNSTOP also resumes the simulated conversation', () => {
  const f = fixture();
  f.send('STOP');
  f.send('UNSTOP');
  assert.equal(f.state().stopped, false);
});

test('STOP and START update the visible stage heading', () => {
  const f = fixture();
  f.send('STOP');
  assert.match(f.node('step').textContent, /SIMULATED OPT-OUT/);
  f.send('START');
  assert.match(f.node('step').textContent, /MISSED CALL/);
});

test('urgent electrical situations trigger safety hold', () => {
  const cases = [
    'sparking','sparks at outlet','arcing at my panel','electrical fire',
    'There is smoke!', 'downed power line','downed wire',
    'I got an electric shock', 'electrocuted','exposed live wire',
    'burning odor', 'burning smell', 'hot panel',
    'My breaker is melting', 'The outlet is overheating', 'The wires are sizzling',
    'The outlet caught fire', 'A power line fell in my yard',
    'I just got zapped by an outlet', 'I smell something burning in the panel',
    'There are flames coming out of the breaker box',
    'The outlet smells like it\'s burning', 'My plug is smoldering',
  ];
  for (const message of cases) {
    const f = fixture();
    f.send(message);
    assert.equal(f.state().hold, true, 'Urgent message ' + message);
    assert.match(f.node('step').textContent, /SAFETY HOLD/);
    assert.match(f.node('summary').textContent, /no notification was sent/);
  }
});

test('ordinary smoke-detector installation does not trigger emergency hold', () => {
  const f = fixture();
  f.send('Install a smoke detector');
  assert.equal(f.state().hold, false);
  assert.equal(f.state().stage, 1);
});

test('normal electrical requests do not trigger a hazard hold', () => {
  for (const message of [
    'Install a smoke alarm', 'I need smoke detector replacement',
    'I want a hot tub outlet', 'My heating bill is burning through cash',
    'Install a fire alarm', 'I need a new outlet for a melting pot',
  ]) {
    const f = fixture();
    f.send(message);
    assert.equal(f.state().hold, false, 'Normal job: ' + message);
    assert.equal(f.state().stage, 1);
  }
});

test('emergency messages at ZIP and callback stages stop intake', () => {
  for (const stage of [1, 2]) {
    const f = fixture();
    f.send('Install a new panel');
    if (stage === 2) f.send('48315');
    assert.equal(f.state().stage, stage);
    f.send('My breaker is melting');
    assert.equal(f.state().hold, true);
    assert.equal(f.state().stage, stage, 'No advancement after hazard');
    assert.match(f.node('step').textContent, /SAFETY HOLD/);
  }
});

test('line breaks in hazard descriptions preserve the safety hold at every intake stage', () => {
  for (const stage of [0, 1, 2]) {
    for (const message of ['My breaker\nis melting', 'My breaker\r\nis melting', 'My breaker\t is melting']) {
      const f = fixture();
      if (stage >= 1) f.send('Install lights');
      if (stage === 2) f.send('48315');
      f.send(message);
      assert.equal(f.state().hold, true, JSON.stringify({ stage, message }));
      assert.equal(f.state().stage, stage, 'Hazard must not advance intake');
      assert.ok(f.messages().includes(message), 'Keep the original line breaks');
      assert.match(f.node('step').textContent, /SAFETY HOLD/);
    }
  }
});

test('multiline hazards after STOP raise a hold without resuming replies', () => {
  const f = fixture();
  f.send('STOP');
  f.send('My breaker\nis melting');
  assert.equal(f.state().hold, true);
  assert.equal(f.state().stopped, true);
  assert.doesNotMatch(f.messages().join(' '), /move away and call 911/);
  f.send('START');
  assert.equal(f.state().hold, true);
  assert.equal(f.state().stopped, true);
  assert.match(f.messages().at(-1), /does not release the safety hold/);
});

test('fallen power-line descriptions accept ordinary is, are, has and have wording', () => {
  for (const message of [
    'The power line is down in my yard', 'The power lines are down in my yard',
    'A power line has fallen', 'Power lines have fallen',
    'The power line is hanging in the yard', 'The power lines are collapsed'
  ]) {
    const f = fixture();
    f.send(message);
    assert.equal(f.state().hold, true, message);
    assert.equal(f.state().stage, 0);
  }
  for (const message of ['Install a power line for my workshop', 'The power line is overhead']) {
    const f = fixture();
    f.send(message);
    assert.equal(f.state().hold, false, message);
    assert.equal(f.state().stage, 1);
  }
});

test('STOP is honored even if an urgent message arrives afterward', () => {
  const f = fixture();
  f.send('STOP');
  f.send('There is smoke!');
  assert.equal(f.state().stopped, true);
  assert.equal(f.state().hold, true);
  assert.doesNotMatch(f.messages().join(' '), /move away and call 911/);
});

test('START cannot clear a safety hold', () => {
  const f = fixture();
  f.send('Live exposed wire!');
  f.send('START');
  assert.equal(f.state().hold, true);
  assert.match(f.node('step').textContent, /SAFETY HOLD/);
});

test('further input remains on human review after emergency', () => {
  const f = fixture();
  f.send('Burning smell in panel');
  f.send('My street is Main');
  assert.equal(f.state().stage, 0);
  assert.equal(f.state().hold, true);
  assert.match(f.messages().at(-1), /No data stored/);
});

test('reset clears stage, data, STOP, safety hold, conversation and status', () => {
  const f = fixture();
  f.send('Install a panel');
  f.send('STOP');
  f.send('There is smoke');
  f.node('callback').value = 'Contacted';
  f.node('callback').onchange();
  f.reset();
  assert.equal(f.state().stage, 0);
  assert.equal(f.state().stopped, false);
  assert.equal(f.state().hold, false);
  assert.equal(f.state().job, '');
  assert.equal(f.state().zip, '');
  assert.equal(f.state().timing, '');
  assert.equal(f.messages().length, 0);
  assert.equal(f.node('callback').selectedIndex, 0);
});

test('contractor callback status remains sample-only', () => {
  const f = fixture();
  f.node('callback').value = 'Contacted';
  f.node('callback').onchange();
  assert.match(f.node('outcome').textContent, /demonstration data/);
});

test('user input is placed in textContent, never HTML markup', () => {
  const f = fixture();
  const input = '<img src=x onerror=alert(1)> need a panel';
  f.send(input);
  assert.equal(f.messages()[0], input);
  assert.doesNotMatch(script, /\.innerHTML\s*=/);
});

