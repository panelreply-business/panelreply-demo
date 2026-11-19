'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const intake = require('../src/intake.js');

const empty = { job: '', zip: '', timing: '' };

for (const message of [
  'There is a fire in my electrical panel',
  "There's a fire inside the breaker box",
  'The outlet is too hot to touch',
  'The breaker box feels hot',
  'The wire is glowing red',
  'There is water pouring into the energized panel',
  'The breaker box smells like burnt plastic',
  'The service cable is touching standing water'
]) test('hazard review holds explicit component heat/fire/water: ' + message, () => {
  assert.equal(intake.isUrgent(message), true);
});

for (const message of [
  'I need a smoke detector installed',
  'I need a fire alarm panel upgrade',
  'Install a hot tub control panel',
  'Replace the water heater electrical circuit',
  'I need a waterproof outdoor outlet installed',
  'The panel has a red indicator light'
]) test('routine installation remains outside new hazard rules: ' + message, () => {
  assert.equal(intake.isUrgent(message), false);
});

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
    'Please unsubscribe me', 'Please, unsubscribe me.', 'Unsubscribe me please',
    'Please opt out', 'Opt out please',
    'Please unsubscribe me. ZIP 48315. Call Friday.', 'Please opt out, ZIP 48315.'
  ]) {
    assert.equal(intake.isOptOut(message), true, message);
    assert.deepEqual(intake.extractFields(message, empty),
      { job: null, zip: null, timing: null, ambiguous: false }, message);
  }
  assert.equal(intake.isOptOut('Please review my opt out wiring'), false);
});

test('short street numbers and voltage values do not invent callback timing', () => {
  for (const text of [
    'Replace the panel at 12 Main Street. ZIP 48315.',
    'Install lights at 5 Oak Road, ZIP 48315.',
    'Wire the fixture at 12 volts. ZIP 48315.'
  ]) {
    const result = intake.extractFields(text, empty);
    assert.equal(result.timing, null, text);
    assert.equal(result.zip, '48315', text);
    assert.deepEqual(intake.missingFields(intake.mergeFields(empty, result)), ['timing']);
  }
  const withTime = intake.extractFields('Install lights at 12 Main Street after 4 pm. ZIP 48315.', empty);
  assert.match(withTime.job, /12 Main Street/);
  assert.equal(withTime.timing, 'after 4 pm');
  for (const text of ['Call me at 4 pm on Main Street', 'Call after 4 at Main Street']) {
    assert.ok(intake.extractFields(text, empty).timing, text);
  }
});

test('extended ZIP spellings never silently lose their final four digits', () => {
  for (const suffix of ['–1234', '—1234', '‑1234', ' 1234', '- 1234']) {
    for (const text of ['Install lights. ZIP 48315' + suffix + '. Call Friday.', '48315' + suffix]) {
      const result = intake.extractFields(text, empty);
      assert.equal(result.zip, null, text);
      assert.equal(result.ambiguous, true, text);
    }
  }
  const phone = intake.extractFields('Install lights. Phone 586–555–1234. ZIP 48315. Friday.', empty);
  assert.equal(phone.zip, '48315');
  assert.equal(phone.ambiguous, false);
});

test('unavailable days remain negated in callback preferences', () => {
  for (const [text, required] of [
    ['Not Friday, Monday after 4.', 'Not Friday'],
    ['I am not available on Friday. Call Monday.', 'not available on Friday'],
    ['I can’t answer calls Friday. Monday after 4 works.', 'can’t answer calls Friday'],
    ['Don’t call Friday. Call Monday.', 'Don’t call Friday']
  ]) {
    const result = intake.extractFields(text, empty);
    assert.equal(result.job, null, text);
    assert.ok(result.timing.includes(required), text + ' => ' + result.timing);
    assert.match(result.timing, /Monday/, text);
  }
  const withJob = intake.extractFields('Install lights, but not Friday. ZIP 48315. Call Monday.', empty);
  assert.equal(withJob.job, 'Install lights');
  assert.match(withJob.timing, /not Friday/);
});

test('additional explicit opt-out wording blocks bundled intake without false opt-outs', () => {
  for (const text of [
    'Please don’t send me any more texts.',
    'ZIP 48315. Do not send me more messages.',
    'I don’t want any more text messages. Call Friday.',
    'Please stop sending me any more texts.'
  ]) {
    assert.equal(intake.isOptOut(text), true, text);
    assert.deepEqual(intake.extractFields(text, empty), { job: null, zip: null, timing: null, ambiguous: false });
  }
  for (const text of [
    'Don’t stop sending me texts.',
    'I don’t want to stop receiving texts.',
    'Do not send me a quote until Friday.',
    'Please stop by with the text messages printed out.'
  ]) assert.equal(intake.isOptOut(text), false, text);
});

test('informational questions never become confirmed job, ZIP or timing details', () => {
  const current = { job: 'Replace the garage light', zip: '48315', timing: 'Friday after 4 pm' };
  for (const message of [
    'What are your hours?', 'Are you open Friday?', 'Can you install an EV charger?',
    'How much does it cost to install an EV charger?', 'Do you service 48084?',
    'Are you available tomorrow?', 'What time do you close on Friday?',
    'Does this book an appointment?', 'Do you cover 48084 or 48154?',
    'Is ZIP 1234 valid?', 'Is ZIP 48315-1234 in your service area?',
    'Friday?', 'Actually, do you service 48084?'
  ]) {
    for (const fields of [empty, current]) {
      const extracted = intake.extractFields(message, fields);
      assert.deepEqual(extracted, { job: null, zip: null, timing: null, ambiguous: false }, message);
      assert.deepEqual(intake.mergeFields(fields, extracted), fields, message);
    }
  }
});

test('questions without a question mark and information requests stay out of intake', () => {
  for (const message of [
    'are you open friday', 'do you service 48084', 'how much to install an EV charger',
    'when can you come tomorrow', 'please tell me your hours',
    'Explain how booking works', 'I would like to know if you serve 48084',
    'I’m wondering whether you are available tomorrow',
    'I was wondering if you service 48084', 'Hi, what are your hours?',
    'Hi, are you open Friday, after 4 pm', 'Do you cover 48084, 48154',
    'Are you open on Friday and Saturday'
  ]) {
    assert.deepEqual(intake.extractFields(message, empty),
      { job: null, zip: null, timing: null, ambiguous: false }, message);
    assert.ok(intake.partitionMessage(message).questions.length, message);
  }
});

test('partitioning preserves detail wording and separates mixed questions', () => {
  const message = 'I need an EV charger installed. My ZIP is 48315. Are you open tomorrow? Call me Friday after 4 pm.';
  const partition = intake.partitionMessage(message);
  assert.deepEqual(partition.questions, ['Are you open tomorrow?']);
  assert.ok(partition.details.includes('I need an EV charger installed.'));
  assert.ok(partition.details.includes('My ZIP is 48315.'));
  assert.ok(partition.details.includes('Call me Friday after 4 pm.'));
  assert.equal(partition.details.includes('tomorrow'), false);
  assert.deepEqual(intake.extractFields(message, empty), {
    job: 'I need an EV charger installed', zip: '48315', timing: 'Call me Friday after 4 pm', ambiguous: false
  });
});

test('mixed punctuation and conjunctions do not turn questions into fields', () => {
  for (const message of [
    'I need an EV charger installed, my ZIP is 48315, are you open tomorrow, and call me Friday after 4 pm',
    'I need an EV charger installed; my ZIP is 48315; are you open tomorrow; call me Friday after 4 pm',
    'I need an EV charger installed\nmy ZIP is 48315\nare you open tomorrow\ncall me Friday after 4 pm',
    'Are you open tomorrow?I need an EV charger installed. My ZIP is 48315. Call me Friday after 4 pm.'
  ]) {
    const result = intake.extractFields(message, empty);
    assert.equal(result.job, 'I need an EV charger installed', message);
    assert.equal(result.zip, '48315', message);
    assert.match(result.timing, /^call me Friday after 4 pm$/i, message);
    assert.equal(result.ambiguous, false, message);
  }
  assert.deepEqual(intake.extractFields('I need an EV charger installed in 48315 and are you open tomorrow?', empty), {
    job: 'I need an EV charger installed', zip: '48315', timing: null, ambiguous: false
  });
  assert.deepEqual(intake.extractFields('What are your hours and my ZIP is 48315', empty), {
    job: null, zip: '48315', timing: null, ambiguous: false
  });
});

test('a mixed coverage question cannot replace or conflict with an explicitly supplied job ZIP', () => {
  for (const message of [
    'I need lights installed. My ZIP is 48315. Do you serve 48084?',
    'I need lights installed. Do you serve 48084? My ZIP is 48315.',
    'I need lights installed in 48315 and do you also serve 48084'
  ]) {
    const result = intake.extractFields(message, empty);
    assert.equal(result.job, 'I need lights installed', message);
    assert.equal(result.zip, '48315', message);
    assert.equal(result.ambiguous, false, message);
  }
  const question = intake.extractFields('Do you serve 48084 or 48154?', { job: 'Install lights', zip: '48315', timing: 'Friday' });
  assert.equal(question.zip, null, 'A question cannot provide a ZIP clarification');
  assert.equal(question.ambiguous, false);
});

test('polite callback requests remain timing details even when phrased as questions', () => {
  for (const message of [
    'Can you call me Friday after 4 pm?', 'Could you please call me Friday after 4 pm?',
    'Please, can you stop by Thursday?', 'Would you be able to contact me Monday after 5 pm?',
    'Can you call me Friday after 4 pm, and how much does it cost?'
  ]) {
    const result = intake.extractFields(message, empty);
    assert.equal(result.job, null, message);
    assert.equal(result.zip, null, message);
    assert.ok(result.timing, message);
    assert.match(result.timing, /Friday|Thursday|Monday/, message);
    assert.doesNotMatch(result.timing, /how much|cost/i, message);
    assert.equal(result.ambiguous, false, message);
  }
});

test('partitioning leaves ordinary messages unchanged and handles absent input', () => {
  for (const message of [
    'I need lights installed in 48315. Call me at 4 p.m.',
    'ZIP 48315 or 48154', 'Not Friday, Monday after 4.',
    'Job: install a new panel; timing: once I get home',
    'Do not send me a quote until Friday.', '  Install lights.\n ZIP 48315.  '
  ]) assert.deepEqual(intake.partitionMessage(message), { details: message, questions: [] });
  for (const message of [null, undefined, 123, '', '   ']) {
    assert.deepEqual(intake.partitionMessage(message), { details: '', questions: [] });
  }
});

test('fronted question topics are not mistaken for supplied job facts', () => {
  for (const message of [
    'Friday, are you open?', '48084, do you serve there?',
    'For 48084, do you provide service', 'EV chargers, do you install them?',
    'EV chargers, 48084, are you available Friday?'
  ]) {
    assert.equal(intake.partitionMessage(message).details, '', message);
    assert.deepEqual(intake.extractFields(message, empty),
      { job: null, zip: null, timing: null, ambiguous: false }, message);
  }
  const mixed = intake.extractFields('Install lights, how much would it cost?', empty);
  assert.equal(mixed.job, 'Install lights');
  const explicit = intake.extractFields('My ZIP is 48315, are you open Friday?', empty);
  assert.equal(explicit.zip, '48315');
  assert.equal(explicit.timing, null);
});

test('can-light work descriptions and future statements are not modal questions', () => {
  for (const message of ['Can lights in the kitchen', 'Can light replacement', 'Will install lights tomorrow']) {
    assert.deepEqual(intake.partitionMessage(message), { details: message, questions: [] });
    assert.ok(intake.extractFields(message, empty).job, message);
  }
  assert.equal(intake.extractFields('Can lights in the kitchen', empty).job, 'Can lights in the kitchen');
});

test('question introductions do not become jobs or leave detail text for a provider', () => {
  const current = { job: 'Install lights', zip: '48315', timing: 'Friday after 4 pm' };
  for (const introduction of [
    'I have a question', 'I have questions', 'I have a few questions',
    'I have a couple of questions', 'We have some questions', 'I have one quick question',
    'I’ve got a question', 'I got a question', 'Quick question', 'Just a question'
  ]) {
    for (const message of [introduction, introduction + '. Do you service 48084?']) {
      assert.equal(intake.partitionMessage(message).details, '', message);
      const extracted = intake.extractFields(message, current);
      assert.deepEqual(extracted, { job: null, zip: null, timing: null, ambiguous: false }, message);
      assert.deepEqual(intake.mergeFields(current, extracted), current, message);
    }
  }
  const mixed = intake.extractFields('I have a question. I need lights installed. My ZIP is 48315. What are your hours?', empty);
  assert.deepEqual(mixed, { job: 'I need lights installed', zip: '48315', timing: null, ambiguous: false });
  const statement = 'I have a panel that needs replacing';
  assert.deepEqual(intake.partitionMessage(statement), { details: statement, questions: [] });
});

test('callback requests keep the requested time but exclude an embedded coverage question', () => {
  const current = { job: 'Install lights', zip: '48315', timing: 'Monday after 4 pm' };
  for (const message of [
    'Can you call me tomorrow about whether you serve 48084?',
    'Can you call me Friday after 4 pm to tell me if you serve 48084?',
    'Could you please call me tomorrow to let me know whether you cover 48084?'
  ]) {
    const partition = intake.partitionMessage(message);
    assert.match(partition.details, /tomorrow|Friday after 4 pm/, message);
    assert.doesNotMatch(partition.details, /48084|whether|serve|cover/i, message);
    assert.match(partition.questions.join(' '), /48084/, message);
    const extracted = intake.extractFields(message, current);
    assert.equal(extracted.job, null, message);
    assert.equal(extracted.zip, null, message);
    assert.match(extracted.timing, /tomorrow|Friday after 4 pm/, message);
    assert.doesNotMatch(extracted.timing, /48084|whether|serve|cover/i, message);
    assert.equal(extracted.ambiguous, false, message);
    const merged = intake.mergeFields(current, extracted);
    assert.equal(merged.job, current.job, message);
    assert.equal(merged.zip, current.zip, message);
  }
  const conditional = 'Can you call me Friday if you can?';
  assert.deepEqual(intake.partitionMessage(conditional), { details: conditional, questions: [] });
  const withoutTime = 'Can you call me to tell me whether you are open Friday?';
  assert.equal(intake.partitionMessage(withoutTime).details, '');
  assert.deepEqual(intake.extractFields(withoutTime, current),
    { job: null, zip: null, timing: null, ambiguous: false });
});

test('imperative job clauses after a question separator remain supplied details', () => {
  for (const [message, job] of [
    ['What are your hours\nInstall lights in 48315. Call me Friday.', 'Install lights'],
    ['What are your hours; replace the kitchen light. ZIP 48315. Call me Friday.', 'replace the kitchen light'],
    ['Do you service 48084\nPlease repair the outlet. My ZIP is 48315. Call me Friday.', 'Please repair the outlet']
  ]) {
    assert.deepEqual(intake.extractFields(message, empty),
      { job, zip: '48315', timing: 'Call me Friday', ambiguous: false }, message);
  }
  for (const question of ['Do you install panels and repair lights', 'Do you install panels, repair lights']) {
    assert.equal(intake.partitionMessage(question).details, '', question);
    assert.deepEqual(intake.extractFields(question, empty),
      { job: null, zip: null, timing: null, ambiguous: false }, question);
  }
});

test('original opt-out and hazard messages take precedence over question partitioning', () => {
  for (const message of [
    'Are you open Friday? STOP. My ZIP is 48315.',
    'I need lights installed. What should I do about a melting outlet?',
    'Do you serve 48084? Please do not send me more texts.'
  ]) {
    assert.ok(intake.isOptOut(message) || intake.isUrgent(message), message);
    assert.deepEqual(intake.extractFields(message, empty),
      { job: null, zip: null, timing: null, ambiguous: false }, message);
  }
});
