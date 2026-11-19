'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const intake = require('../src/intake.js');

const empty = { job: '', zip: '', timing: '' };

test('bundled message captures job, ZIP and callback timing', () => {
  const result = intake.extractFields('I need an EV charger installed in my garage. My ZIP is 48315. Call me Friday after 4 pm.', empty);
  assert.equal(result.job, 'I need an EV charger installed in my garage');
  assert.equal(result.zip, '48315');
  assert.equal(result.timing, 'Call me Friday after 4 pm');
  assert.equal(result.ambiguous, false);
  assert.deepEqual(intake.missingFields(intake.mergeFields(empty, result)), []);
});

test('fields are accepted in a different order and on separate lines', () => {
  for (const message of [
    'Friday after 4 pm; ZIP: 48315; Job: install a new panel',
    'ZIP: 48315\nCall me Friday after 4 pm\nI need an EV charger installed',
    'Tomorrow I need an EV charger installed in 48315',
    'I need an EV charger installed in 48315 next week after 4pm'
  ]) {
    const result = intake.extractFields(message, empty);
    assert.ok(result.job, message);
    assert.equal(result.zip, '48315', message);
    assert.ok(result.timing, message);
    assert.equal(result.ambiguous, false, message);
  }
});

test('partial and ZIP-first requests only leave missing fields', () => {
  const first = intake.mergeFields(empty, intake.extractFields('48315', empty));
  assert.deepEqual(first, { job: '', zip: '48315', timing: '' });
  assert.deepEqual(intake.missingFields(first), ['job', 'timing']);
  const second = intake.mergeFields(first, intake.extractFields('Call me tomorrow afternoon', first));
  assert.deepEqual(intake.missingFields(second), ['job']);
  const final = intake.mergeFields(second, intake.extractFields('Replace the kitchen light switch', second));
  assert.deepEqual(intake.missingFields(final), []);
  assert.equal(final.zip, '48315');
  assert.equal(final.timing, 'Call me tomorrow afternoon');
});

test('one message can fill remaining ZIP and timing without replacing the job', () => {
  const current = { job: 'Install lights', zip: '', timing: '' };
  const fields = intake.mergeFields(current, intake.extractFields('My ZIP is 48315 and call me Friday after 4 pm', current));
  assert.equal(fields.job, 'Install lights');
  assert.equal(fields.zip, '48315');
  assert.equal(fields.timing, 'call me Friday after 4 pm');
});

test('explicit field corrections preserve unrelated supplied fields', () => {
  let fields = { job: 'Install lights', zip: '48315', timing: 'Friday after 4 pm' };
  fields = intake.mergeFields(fields, intake.extractFields('Actually my ZIP is 48154', fields));
  assert.deepEqual(fields, { job: 'Install lights', zip: '48154', timing: 'Friday after 4 pm' });
  fields = intake.mergeFields(fields, intake.extractFields('Job: replace the panel', fields));
  assert.deepEqual(fields, { job: 'replace the panel', zip: '48154', timing: 'Friday after 4 pm' });
  fields = intake.mergeFields(fields, intake.extractFields('Call me Saturday morning instead', fields));
  assert.equal(fields.job, 'replace the panel');
  assert.equal(fields.zip, '48154');
  assert.equal(fields.timing, 'Call me Saturday morning instead');
  fields = intake.mergeFields(fields, intake.extractFields('Actually the job ZIP is 48084', fields));
  assert.deepEqual(fields, { job: 'replace the panel', zip: '48084', timing: 'Call me Saturday morning instead' });
});

test('multiple distinct ZIP codes require clarification instead of choosing one', () => {
  for (const text of ['ZIP 48315 or 48154', 'Install lights in 48315 or 48154 on Friday', 'ZIP: 48315; ZIP: 48154']) {
    const result = intake.extractFields(text, empty);
    assert.equal(result.zip, null, text);
    assert.equal(result.ambiguous, true, text);
  }
  assert.equal(intake.extractFields('ZIP 48315, ZIP 48315', empty).zip, '48315');
});

test('malformed labelled ZIP and ZIP+4 are not silently accepted', () => {
  for (const text of ['ZIP 1234', 'ZIP 123456', 'ZIP abcde', 'ZIP 48315-1234', '48315-1234']) {
    const result = intake.extractFields(text, empty);
    assert.equal(result.zip, null, text);
    assert.equal(result.ambiguous, true, text);
  }
});

test('phone numbers, prices, power ratings and street numbers are not ZIPs', () => {
  for (const text of [
    'My phone is 5865551234', 'Call me at 586-555-1234', 'Phone: 12345',
    'My phone number is 12345', 'Call me at 12345 tomorrow',
    'My budget is $50000', 'Install a 50000 watt generator', 'I can pay 50000 dollars',
    'Install lights at 12345 Main Street', 'Address: 12345 Main St',
    'Replace the panel at 12345 Maple Avenue'
  ]) {
    assert.equal(intake.extractFields(text, empty).zip, null, text);
  }
  const combined = intake.extractFields('Install lights at 12345 Main Street. ZIP 48315. Call me Friday.', empty);
  assert.equal(combined.zip, '48315');
  assert.match(combined.job, /12345 Main Street/);
});

test('timing before the job is preserved and does not become the job itself', () => {
  const result = intake.extractFields('Next week. Call after 4 pm.', empty);
  assert.equal(result.job, null);
  assert.equal(result.timing, 'Next week. Call after 4 pm');
  assert.deepEqual(intake.missingFields(intake.mergeFields(empty, result)), ['job', 'zip']);
});

test('callback-only phrases do not become an invented job', () => {
  for (const text of ['Please, stop by Thursday.', 'Please stop by Thursday, please.', 'Can you stop by today?', 'Call me after 4', '4 p.m.']) {
    const result = intake.extractFields(text, empty);
    assert.equal(result.job, null, text);
    assert.ok(result.timing, text);
    assert.equal(intake.isOptOut(text), false, text);
  }
});

test('labelled timing retains supplied wording without requiring a known time phrase', () => {
  const result = intake.extractFields('Timing: once I get home; ZIP: 48315; Job: replace a ceiling fan', empty);
  assert.equal(result.timing, 'once I get home');
  assert.equal(result.job, 'replace a ceiling fan');
  assert.equal(result.zip, '48315');
});

test('empty, meaningless and greeting-only inputs do not create a job', () => {
  for (const text of ['', '  ', '!!!', '1234', 'hello', 'thank you', 'What ZIP do you need?']) {
    assert.equal(intake.extractFields(text, empty).job, null, text);
  }
});

test('STOP and START protections include punctuation and smart apostrophes', () => {
  for (const text of ['STOP', 'unsubscribe', 'Don’t text me again', 'Please stop texting me, please.', 'Please, no more texts']) {
    assert.equal(intake.isOptOut(text), true, text);
    assert.equal(intake.extractFields(text, empty).job, null);
  }
  assert.equal(intake.isStart('START'), true);
  assert.equal(intake.isStart('unstop!'), true);
  assert.equal(intake.isOptOut('Please stop by Thursday, please.'), false);
  assert.equal(intake.isOptOut('Cancel my appointment'), false);
});

test('opt-out in a bundled message takes precedence over intake and hazards', () => {
  for (const text of [
    'No more texts. My ZIP is 48315.',
    'STOP. My breaker is melting.',
    'Cancel my appointment. Don’t text me again.',
    'ZIP 48315\nSTOP\nCall me Friday',
    'Install lights; please stop texting me; ZIP 48315',
    'No more texts, my ZIP is 48315',
    'Call Friday, but do not text me again',
    'Cancel my appointment, please stop texting me.'
  ]) {
    assert.equal(intake.isOptOut(text), true, text);
    assert.deepEqual(intake.extractFields(text, empty), { job: null, zip: null, timing: null, ambiguous: false }, text);
  }
  for (const text of [
    'Please stop by Thursday, please.',
    'Please, stop by Thursday.',
    'stop, by Thursday',
    'Please, stop, by Thursday',
    'Cancel my appointment. My ZIP is 48315.',
    'Do not stop work. Call me Friday.',
    'I do not want to stop. My ZIP is 48315.',
    'End, that is my street name'
  ]) assert.equal(intake.isOptOut(text), false, text);
});

test('existing hazard safeguards work across whitespace and ordinary grammar', () => {
  for (const text of ['My breaker\nis melting', 'The power line is down in my yard', 'There is smoke', 'Burning smell in panel', 'Live exposed wire!']) {
    assert.equal(intake.isUrgent(text), true, text);
    assert.equal(intake.extractFields(text, empty).job, null);
  }
  for (const text of ['Install a smoke detector', 'Wire a hot tub', 'Add an outlet for a melting pot']) {
    assert.equal(intake.isUrgent(text), false, text);
  }
});

test('merge validates field shape and never erases fields with absent values', () => {
  const current = { job: 'Install lights', zip: '48315', timing: 'Friday' };
  assert.deepEqual(intake.mergeFields(current, { job: null, zip: 'abcde', timing: '' }), current);
  assert.deepEqual(intake.mergeFields({}, { job: '<img src=x> Replace panel', zip: '00123', timing: 'Tomorrow', unexpected: 'ignored' }), {
    job: '<img src=x> Replace panel', zip: '00123', timing: 'Tomorrow'
  });
  assert.deepEqual(intake.mergeFields(null, null), empty);
  assert.deepEqual(intake.missingFields({ zip: 48315 }), ['job', 'zip', 'timing']);
});

test('module runs in browser scope without Node modules', () => {
  const sandbox = {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/intake.js'), 'utf8'), sandbox, { timeout: 1000 });
  assert.equal(typeof sandbox.PanelReplyIntake.extractFields, 'function');
  assert.equal(sandbox.PanelReplyIntake.extractFields('ZIP 48315', {}).zip, '48315');
});

test('polite unsubscribe and opt-out requests inside bundled input stop the local intake', () => {
  for (const message of [
    'Please unsubscribe me',
    'Please, unsubscribe me.',
    'Unsubscribe me please',
    'Please opt out',
    'Opt out please',
    'Please unsubscribe me. ZIP 48315. Call Friday.',
    'Please opt out, ZIP 48315.'
  ]) {
    assert.equal(intake.isOptOut(message), true, message);
    assert.deepEqual(intake.extractFields(message, empty),
      { job: null, zip: null, timing: null, ambiguous: false }, message);
  }
  assert.equal(intake.isOptOut('Please review my opt out wiring'), false);
});
