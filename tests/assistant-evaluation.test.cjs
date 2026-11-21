'use strict';
const test = require('node:test');
const { loadCorpus, evaluateScenario } = require('../scripts/evaluate-assistant.cjs');
for (const scenario of loadCorpus().scenarios) test('synthetic assistant conversation: ' + scenario.id, () => evaluateScenario(scenario));
