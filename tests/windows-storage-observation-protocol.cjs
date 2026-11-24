'use strict';

const crypto = require('node:crypto');
const { CASES } = require('./windows-storage-cases.cjs');
const PREFIX = 'PANELREPLY_COMPONENT_OBSERVATION_V1 ';
const CHANNEL_ENV = 'PANELREPLY_WINDOWS_COMPONENT_OBSERVATION_CHANNEL';
const MAX_RECORD_BYTES = 256 * 1024;
const MAX_RECORDS = 4096;
const MAX_JOURNAL_BYTES = 16 * 1024 * 1024;
const MAX_FRAME_BYTES = 384 * 1024;
const MAX_STREAM_BYTES = 32 * 1024 * 1024;
function failure(message) { const error = new Error(message); error.code = 'COMPONENT_OBSERVATION_PROTOCOL'; return error; }
function validChannel(channel) { return typeof channel === 'string' && /^[a-f0-9]{64}$/.test(channel); }
function recordValue(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > MAX_RECORD_BYTES) throw failure('Observation record size is invalid.');
  let value;
  try { value = JSON.parse(text); } catch { throw failure('Observation record is not JSON.'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).sort().join(',') !== 'at,case,details,event'
      || !CASES.some(item => item.id === value.case) || typeof value.event !== 'string' || !/^[a-z][a-z0-9-]{0,99}$/.test(value.event)
      || typeof value.at !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value.at)
      || !Number.isFinite(Date.parse(value.at)) || new Date(value.at).toISOString() !== value.at
      || !value.details || typeof value.details !== 'object' || Array.isArray(value.details)) throw failure('Observation record shape is invalid.');
  return value;
}
// Use the stream API so Node's test-child stdout interception remains intact.
// Completion awaits every callback before publishing the terminal digest.
const writeStdout = (frame, callback) => process.stdout.write(frame, callback);
function createObservationPublisher(channel, write = writeStdout) {
  if (!validChannel(channel)) throw failure('A component observation channel is required.');
  let records = 0, bytes = 0, finished = false, failed = false;
  const hash = crypto.createHash('sha256'), writes = [];
  const emit = frame => {
    if (Buffer.byteLength(frame) > MAX_FRAME_BYTES) throw failure('Observation frame exceeded its bound.');
    const completion = new Promise((resolve, reject) => {
      try { write(frame, error => error ? reject(error) : resolve()); }
      catch (error) { reject(error); }
    }).catch(error => { failed = true; return { error }; });
    writes.push(completion);
    return completion;
  };
  emit(PREFIX + channel + ' START 0\n');
  return {
    record(id, event, details) {
      try {
        if (finished || failed) throw failure('The observation publisher is closed or failed.');
        const value = JSON.stringify({ case: id, event, at: new Date().toISOString(), details });
        recordValue(value);
        const encoded = value + '\n';
        if (records >= MAX_RECORDS || bytes + Buffer.byteLength(encoded) > MAX_JOURNAL_BYTES) throw failure('Observation record or journal limit exceeded.');
        emit(PREFIX + channel + ' RECORD ' + (records + 1) + ' ' + Buffer.from(value).toString('base64') + '\n');
        records++; bytes += Buffer.byteLength(encoded); hash.update(encoded);
      } catch (error) { failed = true; throw error; }
    },
    async finish() {
      if (finished || failed) throw failure('The observation publisher cannot finish twice or after failure.');
      finished = true;
      await Promise.all(writes);
      if (failed) throw failure('An observation stdout write failed.');
      await emit(PREFIX + channel + ' END ' + records + ' ' + bytes + ' ' + hash.digest('hex') + '\n');
      if (failed) throw failure('The observation terminal frame write failed.');
    },
  };
}

function createObservationReceiver(channel, { appendJournal, appendLog }) {
  if (!validChannel(channel)) throw failure('A component observation channel is required.');
  let pending = '', streamBytes = 0, records = 0, bytes = 0, started = false, ended = false, failed = false;
  const hash = crypto.createHash('sha256');
  const fail = message => { failed = true; throw failure(message); };
  function line(text) {
    if (!text.startsWith(PREFIX)) { appendLog(text + '\n'); return; }
    const parts = text.slice(PREFIX.length).split(' ');
    if (parts[0] !== channel) fail('Observation channel mismatch.');
    if (parts[1] === 'START') {
      if (parts.length !== 3 || parts[2] !== '0' || started || ended) fail('Observation start frame is invalid.');
      started = true; return;
    }
    if (!started || ended) fail('Observation frame arrived outside its stream.');
    if (parts[1] === 'RECORD') {
      if (parts.length !== 4 || parts[2] !== String(records + 1) || records >= MAX_RECORDS
          || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(parts[3])) fail('Observation record sequence or encoding is invalid.');
      const data = Buffer.from(parts[3], 'base64');
      if (data.length > MAX_RECORD_BYTES || data.toString('base64') !== parts[3]) fail('Observation record encoding or size is invalid.');
      const value = data.toString('utf8');
      if (!Buffer.from(value).equals(data)) fail('Observation record is not valid UTF-8.');
      recordValue(value);
      const encoded = value + '\n';
      if (bytes + Buffer.byteLength(encoded) > MAX_JOURNAL_BYTES) fail('Observation journal limit exceeded.');
      appendJournal(encoded);
      records++; bytes += Buffer.byteLength(encoded); hash.update(encoded); return;
    }
    if (parts[1] === 'END') {
      if (parts.length !== 5 || parts[2] !== String(records) || parts[3] !== String(bytes)
          || parts[4] !== hash.copy().digest('hex')) fail('Observation end count, bytes or digest does not match.');
      ended = true; return;
    }
    fail('Unknown observation frame.');
  }
  return {
    push(chunk) {
      try {
        if (failed || typeof chunk !== 'string' || !chunk.isWellFormed()) fail('Observation stdout chunk is invalid.');
        streamBytes += Buffer.byteLength(chunk);
        if (streamBytes > MAX_STREAM_BYTES) fail('Observation stdout exceeded its total byte bound.');
        let cursor = 0;
        while (cursor < chunk.length) {
          const newline = chunk.indexOf('\n', cursor), end = newline < 0 ? chunk.length : newline;
          const piece = chunk.slice(cursor, end);
          if (Buffer.byteLength(pending) + Buffer.byteLength(piece) > MAX_FRAME_BYTES) fail('Observation stdout line exceeded its bound.');
          pending += piece;
          if (newline < 0) break;
          const current = pending; pending = ''; line(current); cursor = newline + 1;
        }
      } catch (error) { failed = true; throw error; }
    },
    finish() {
      if (failed) fail('Observation stream previously failed.');
      if (pending.startsWith(PREFIX) || PREFIX.startsWith(pending) && pending) fail('Observation stream ended with an incomplete frame.');
      if (pending) { appendLog(pending); pending = ''; }
      if (!started || !ended) fail('Observation stream is missing its start or end frame.');
      return { state: 'OBSERVED', records, bytes, sha256: hash.copy().digest('hex'), streamBytes,
        recordLimit: MAX_RECORDS, journalByteLimit: MAX_JOURNAL_BYTES, frameByteLimit: MAX_FRAME_BYTES, streamByteLimit: MAX_STREAM_BYTES };
    },
    state() { return { state: failed ? 'ERROR' : ended ? 'ENDED_UNVERIFIED' : started ? 'INCOMPLETE' : 'NOT_STARTED',
      records, bytes, sha256: hash.copy().digest('hex'), streamBytes }; },
  };
}

module.exports = { PREFIX, CHANNEL_ENV, MAX_RECORD_BYTES, MAX_RECORDS, MAX_JOURNAL_BYTES, MAX_FRAME_BYTES, MAX_STREAM_BYTES,
  recordValue, createObservationPublisher, createObservationReceiver };
