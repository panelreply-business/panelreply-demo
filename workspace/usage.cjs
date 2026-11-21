'use strict';

// The ledger records conservative reservations, not provider invoices. Every
// started attempt keeps its reservation, including failed or interrupted calls.
// No message text, provider response, credential or session token is stored.
const crypto = require('node:crypto');

const USAGE_TABLE_SQL = Object.freeze({
  assistant_usage: 'CREATE TABLE assistant_usage (id TEXT PRIMARY KEY, business_id TEXT NOT NULL REFERENCES businesses(id), actor_id TEXT NOT NULL REFERENCES users(id), request_hash TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, finished_at INTEGER, status TEXT NOT NULL, input_bytes INTEGER NOT NULL, output_token_limit INTEGER NOT NULL, reserved_micros INTEGER NOT NULL, UNIQUE(business_id, request_hash)) STRICT'
});
const USAGE_INDEX_SQL = Object.freeze({
  assistant_usage_business_created: 'CREATE INDEX assistant_usage_business_created ON assistant_usage(business_id, created_at)',
  assistant_usage_status_expiry: 'CREATE INDEX assistant_usage_status_expiry ON assistant_usage(status, expires_at)'
});
const USAGE_AUTO_INDEXES = Object.freeze(['sqlite_autoindex_assistant_usage_1', 'sqlite_autoindex_assistant_usage_2']);
const USAGE_SCHEMA_COLUMNS = Object.freeze(['id', 'business_id', 'actor_id', 'request_hash', 'created_at', 'expires_at', 'finished_at', 'status', 'input_bytes', 'output_token_limit', 'reserved_micros']);
const TERMINAL = Object.freeze(['succeeded', 'failed', 'cancelled', 'timeout', 'abandoned']);
const POLICY_KEYS = Object.freeze(['perMinute', 'perDay', 'lifetimeAttempts', 'globalConcurrent', 'businessConcurrent', 'perAttemptReserveMicros', 'dailyReserveLimitMicros', 'lifetimeReserveLimitMicros']);
const SYNTHETIC_POLICY = Object.freeze({ perMinute: 20, perDay: 500, lifetimeAttempts: 10000, globalConcurrent: 2, businessConcurrent: 2, perAttemptReserveMicros: 0, dailyReserveLimitMicros: 0, lifetimeReserveLimitMicros: 0 });
const INPUT_BYTES = 96 * 1024;
const OUTPUT_TOKENS = 2048;
const LEASE_MS = 60000;
const MAX_ROWS = 50000;
const DAY_MS = 86400000;

function validateUsagePolicy(value, { external = false } = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== POLICY_KEYS.length || !POLICY_KEYS.every(key => Object.hasOwn(value, key))) throw new Error('Supply all trusted assistant usage limits.');
  const limits = { perMinute: [1, 60], perDay: [1, 10000], lifetimeAttempts: [1, MAX_ROWS], globalConcurrent: [1, 4], businessConcurrent: [1, 4], perAttemptReserveMicros: [external ? 1 : 0, 1000000000], dailyReserveLimitMicros: [external ? 1 : 0, 1000000000000], lifetimeReserveLimitMicros: [external ? 1 : 0, 1000000000000] };
  for (const key of POLICY_KEYS) {
    const [min, max] = limits[key];
    if (!Number.isSafeInteger(value[key]) || value[key] < min || value[key] > max) throw new Error('Assistant usage limits are invalid.');
  }
  if (value.businessConcurrent > value.globalConcurrent || value.perMinute > value.perDay || value.perDay > value.lifetimeAttempts || value.perAttemptReserveMicros > value.dailyReserveLimitMicros || value.dailyReserveLimitMicros > value.lifetimeReserveLimitMicros) throw new Error('Assistant usage limits must fit their enclosing budgets.');
  return Object.freeze(Object.fromEntries(POLICY_KEYS.map(key => [key, value[key]])));
}

function usageRequestHash(scope, fingerprint) {
  if (typeof scope !== 'string' || !scope || scope.length > 256 || typeof fingerprint !== 'string' || !/^[0-9a-f]{64}$/.test(fingerprint)) throw new Error('A bounded session and request digest are required.');
  return crypto.createHash('sha256').update(scope).update('\0').update(fingerprint).digest('hex');
}

function createUsageLedger({ db, tx, now, getActor, StoreError }) {
  const fail = (status, code, message) => { throw new StoreError(status, code, message); };
  const time = () => {
    const value = now();
    if (!Number.isSafeInteger(value) || value < 0 || value > 8640000000000000 - LEASE_MS) fail(503, 'assistant_clock_unavailable', 'Assistance is unavailable. Review the request fields.');
    return value;
  };
  function totals(businessId, at) {
    const day = Math.floor(at / DAY_MS) * DAY_MS;
    return db.prepare('SELECT count(*) AS lifetimeAttempts, coalesce(sum(reserved_micros),0) AS lifetimeReservedMicros, coalesce(sum(CASE WHEN created_at>=? THEN 1 ELSE 0 END),0) AS dailyAttempts, coalesce(sum(CASE WHEN created_at>=? THEN reserved_micros ELSE 0 END),0) AS dailyReservedMicros, coalesce(sum(CASE WHEN created_at>? THEN 1 ELSE 0 END),0) AS minuteAttempts FROM assistant_usage WHERE business_id=?').get(day, day, at - 60000, businessId);
  }
  return {
    reserve(actor, requestHash, input, policy) {
      getActor(actor);
      const limits = validateUsagePolicy(policy);
      if (typeof requestHash !== 'string' || !/^[0-9a-f]{64}$/.test(requestHash) || !input || Object.keys(input).length !== 2 || !Number.isSafeInteger(input.inputBytes) || input.inputBytes < 1 || input.inputBytes > INPUT_BYTES || input.outputTokenLimit !== OUTPUT_TOKENS) fail(400, 'invalid_assistant_usage', 'The assistance request exceeds its configured limits.');
      return tx(() => {
        const at = time();
        const last = db.prepare('SELECT max(created_at) AS value FROM assistant_usage').get().value;
        if (last !== null && at < last) fail(503, 'assistant_clock_changed', 'Assistance is paused until the server clock is corrected.');
        if (db.prepare('SELECT 1 FROM assistant_usage WHERE business_id=? AND request_hash=?').get(actor.businessId, requestHash)) fail(409, 'assistant_attempt_recorded', 'This assistance attempt was already recorded. Review the existing draft before starting another attempt.');
        const total = totals(actor.businessId, at);
        const globalActive = db.prepare("SELECT count(*) AS n FROM assistant_usage WHERE status='pending' AND expires_at>?").get(at).n;
        const businessActive = db.prepare("SELECT count(*) AS n FROM assistant_usage WHERE business_id=? AND status='pending' AND expires_at>?").get(actor.businessId, at).n;
        if (total.minuteAttempts >= limits.perMinute || total.dailyAttempts >= limits.perDay || total.lifetimeAttempts >= limits.lifetimeAttempts || total.dailyReservedMicros + limits.perAttemptReserveMicros > limits.dailyReserveLimitMicros || total.lifetimeReservedMicros + limits.perAttemptReserveMicros > limits.lifetimeReserveLimitMicros || globalActive >= limits.globalConcurrent || businessActive >= limits.businessConcurrent) fail(429, 'assistant_usage_limit', 'The assistance allowance or active-call limit has been reached. Review the request fields or try later.');
        if (db.prepare('SELECT count(*) AS n FROM assistant_usage').get().n >= MAX_ROWS) fail(503, 'assistant_ledger_full', 'Assistance is paused for an operator storage review.');
        // Only expire the concurrency lease. Reservations and attempt counts
        // remain, so a crash, retry or restore does not refund possible spend.
        db.prepare("UPDATE assistant_usage SET status='abandoned',finished_at=? WHERE status='pending' AND expires_at<=?").run(at, at);
        const id = crypto.randomUUID();
        db.prepare('INSERT INTO assistant_usage VALUES (?,?,?,?,?,?,NULL,?,?,?,?)').run(id, actor.businessId, actor.id, requestHash, at, at + LEASE_MS, 'pending', input.inputBytes, OUTPUT_TOKENS, limits.perAttemptReserveMicros);
        return { id };
      });
    },
    finish(actor, id, status) {
      getActor(actor);
      if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/.test(id) || !TERMINAL.includes(status) || status === 'abandoned') fail(400, 'invalid_assistant_usage', 'The assistance result was not accepted.');
      return tx(() => {
        const row = db.prepare('SELECT status,created_at FROM assistant_usage WHERE id=? AND business_id=? AND actor_id=?').get(id, actor.businessId, actor.id);
        if (!row) fail(404, 'assistant_usage_not_found', 'The assistance attempt was not found.');
        if (row.status !== 'pending') return { recorded: true };
        db.prepare('UPDATE assistant_usage SET status=?,finished_at=? WHERE id=? AND business_id=? AND actor_id=?').run(status, Math.max(time(), row.created_at), id, actor.businessId, actor.id);
        return { recorded: true };
      });
    },
    summary(actor) {
      getActor(actor);
      return tx(() => {
        const at = time();
        const rows = db.prepare('SELECT status,count(*) AS attempts FROM assistant_usage WHERE business_id=? GROUP BY status').all(actor.businessId);
        return { day: new Date(at).toISOString().slice(0, 10), dayTimezone: 'UTC', ...totals(actor.businessId, at), statuses: Object.fromEntries(rows.map(row => [row.status, row.attempts])), accounting: 'Conservative reservations, not measured provider charges. Failed attempts are not refunded.' };
      });
    }
  };
}

module.exports = { USAGE_TABLE_SQL, USAGE_INDEX_SQL, USAGE_AUTO_INDEXES, USAGE_SCHEMA_COLUMNS, validateUsagePolicy, usageRequestHash, createUsageLedger, SYNTHETIC_POLICY, INPUT_BYTES, OUTPUT_TOKENS, LEASE_MS, MAX_ROWS };
