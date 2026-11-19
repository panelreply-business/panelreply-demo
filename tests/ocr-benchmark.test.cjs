'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { metrics, percentile } = require('../scripts/benchmark-ocr.cjs');

test('benchmark distinguishes exact, missed and wrong known values from false positives', () => {
  const result = metrics([
    { expected: { partNumber: '0001', manufacturer: 'EXAMPLE', description: '' }, actual: { partNumber: '0001', manufacturer: '', description: 'GUESS' }, durationMs: 10, exact: false },
    { expected: { partNumber: '0010', manufacturer: '', description: 'LABEL' }, actual: { partNumber: 'O010', manufacturer: '', description: 'LABEL' }, durationMs: 30, exact: false },
  ]);
  assert.deepEqual(result.fields.partNumber, { known: 2, exact: 1, missed: 0, wrong: 1, expectedBlank: 0, preservedBlank: 0, falsePositive: 0 });
  assert.equal(result.fields.manufacturer.missed, 1);
  assert.equal(result.fields.manufacturer.preservedBlank, 1);
  assert.equal(result.fields.description.falsePositive, 1);
  assert.equal(result.exactCases, 0);
});

test('benchmark counts blank and unlabelled fields without counting them as known accuracy', () => {
  const result = metrics([{ expected: null, actual: null, durationMs: 10, exact: true }]);
  assert.equal(result.exactCases, 1);
  for (const field of Object.values(result.fields)) {
    assert.equal(field.known, 0);
    assert.equal(field.expectedBlank, 1);
    assert.equal(field.preservedBlank, 1);
  }
});

test('benchmark reports execution errors and review violations separately from extraction misses', () => {
  const result = metrics([{ expected: { partNumber: 'A' }, actual: null, error: 'OCR_TIMEOUT', durationMs: 15, exact: false }, { expected: null, actual: null, reviewViolation: true, durationMs: 1, exact: false }]);
  assert.equal(result.errors, 1);
  assert.equal(result.reviewViolations, 1);
  assert.equal(result.fields.partNumber.missed, 1);
});

test('benchmark latency percentiles use ordered nearest ranks without modifying source data', () => {
  const source = [30, 10, 20, 40];
  assert.equal(percentile(source, .5), 20);
  assert.equal(percentile(source, .95), 40);
  assert.equal(percentile([], .5), null);
  assert.deepEqual(source, [30, 10, 20, 40]);
});
