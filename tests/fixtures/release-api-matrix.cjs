'use strict';

// Finite, named input partitions. One descriptor is one scenario, regardless
// of how many state/no-disclosure assertions its execution performs.
const OPERATIONS = Object.freeze([
  ['session-read', 'GET'], ['assistant-read', 'GET'], ['usage-read', 'GET'],
  ['profile-read', 'GET'], ['leads-list', 'GET'], ['lead-read', 'GET'],
  ['business-export', 'GET'], ['projects-list', 'GET'], ['project-read', 'GET'],
  ['project-csv', 'GET'], ['project-xlsx', 'GET'], ['source-read', 'GET'], ['ocr-status', 'GET'],
  ['lead-create', 'POST'], ['lead-update', 'PATCH'], ['lead-delete', 'DELETE'],
  ['conversation-delete', 'DELETE'], ['profile-update', 'PATCH'], ['project-create', 'POST'],
  ['project-update', 'PATCH'], ['project-delete', 'DELETE'], ['source-add', 'POST'],
  ['source-delete', 'DELETE'], ['source-ocr', 'POST'], ['preview', 'POST'], ['logout', 'POST']
].map(([id, method]) => Object.freeze({ id, method })));
const MUTATIONS = OPERATIONS.filter(operation => operation.method !== 'GET');
const BODY_OPERATIONS = MUTATIONS.filter(operation => operation.id !== 'logout');
const RESOURCE_OPERATIONS = OPERATIONS.filter(operation => [
  'lead-read', 'project-read', 'project-csv', 'project-xlsx', 'source-read', 'lead-update',
  'lead-delete', 'conversation-delete', 'project-update', 'project-delete', 'source-add',
  'source-delete', 'source-ocr'
].includes(operation.id));
const VERSION_OPERATIONS = MUTATIONS.filter(operation => [
  'lead-update', 'lead-delete', 'conversation-delete', 'profile-update', 'project-update',
  'project-delete', 'source-add', 'source-delete', 'source-ocr'
].includes(operation.id));
const IDEMPOTENT_OPERATIONS = MUTATIONS.filter(operation => [
  'lead-create', 'lead-delete', 'conversation-delete', 'project-create', 'project-delete',
  'source-add', 'source-delete'
].includes(operation.id));

const domains = Object.freeze({
  auth: ['missing-cookie', 'unknown-token', 'short-token', 'long-token', 'duplicate-cookie',
    'foreign-session-pin', 'empty-session-pin', 'expired-session', 'revoked-session'],
  host: ['missing', 'empty', 'foreign-host', 'wrong-port', 'trailing-dot', 'authority-userinfo', 'multiple-hosts'],
  origin: ['missing', 'empty', 'foreign-site', 'wrong-scheme', 'wrong-port', 'trailing-slash', 'opaque-null'],
  csrf: ['missing', 'empty', 'foreign-session', 'truncated', 'extended', 'wrong-case', 'array-value', 'object-value'],
  body: ['empty-stream', 'truncated-json', 'invalid-utf8', 'array-root', 'null-root', 'string-root',
    'boolean-root', 'trailing-garbage', 'missing-content-type', 'text-content-type', 'wrong-charset',
    'gzip-encoding', 'deflate-encoding', 'negative-content-length', 'fractional-content-length',
    'nonnumeric-content-length', 'array-content-length', 'declared-too-long', 'declared-too-short',
    'declared-over-limit', 'stream-over-limit', 'interrupted-stream'],
  authority: ['businessId', 'tenantId', 'userId', 'actorId', 'role', 'ownerId'],
  version: ['missing', 'null', 'boolean', 'numeric-string', 'empty-string', 'array', 'object',
    'negative', 'zero', 'fractional', 'unsafe-integer', 'stale', 'future', 'maximum-safe'],
  key: ['missing', 'empty', 'short', 'long', 'spaces', 'slash', 'plus', 'unicode', 'newline', 'array', 'object'],
  replay: ['same-session', 'second-owner-session', 'after-reopen', 'conflicting-retry'],
  delayed: ['session-deleted', 'password-reset', 'idle-expiry', 'cookie-switch', 'pin-switch'],
  tenant: ['other-business', 'other-project-source'],
  status: ['new', 'needs_review', 'contacted', 'closed'],
  restriction: ['permitted', 'permission-missing', 'opted-out', 'safety-held']
});
const risks = Object.freeze({
  control: 'Authorized controls prove the denial matrix exercises working routes and correct state transitions.',
  auth: 'Private routes must reject missing, malformed, mismatched, expired and revoked identity.',
  host: 'An unexpected HTTP authority must not reach private reads or mutations.',
  origin: 'Cross-origin mutation attempts must not change workspace data.',
  csrf: 'A mutation must bind its CSRF proof to the authenticated session.',
  body: 'Body framing, encoding and JSON failures must not produce partial writes.',
  authority: 'Client-supplied tenant and actor fields must not override server identity.',
  version: 'Invalid or outdated revisions must not overwrite saved state.',
  key: 'Malformed retry identifiers must not create writes or deletion receipts.',
  replay: 'Repeated operations must preserve their committed result and reject changed intent.',
  delayed: 'Identity changes while reading a body must invalidate the pending operation.',
  tenant: 'Foreign and nonexistent records must be indistinguishable and remain unchanged.',
  'restricted-status': 'Contact permission, opt-outs and safety holds constrain state transitions.'
});
const cases = [];
function add(category, operation, variant, extra = {}) {
  cases.push(Object.freeze({ id: `RAP.${category}.${operation}.${variant}`, category,
    operation, variant, ...extra, risk: risks[category],
    oracle: category === 'control' ? 'Declared authorized response and state transition, preserved foreign-tenant SQL rows, exact worker invocation count.'
      : category === 'replay' ? 'Independent SQL snapshot and exact committed-result comparison.'
      : category === 'restricted-status' ? 'Declared contact/safety transition table and SQL before/after comparison.'
        : 'Declared HTTP contract, content-free error, all non-session SQL tables unchanged, no OCR/preview call.' }));
}
for (const operation of OPERATIONS) {
  add('control', operation.id, 'authorized');
  for (const variant of domains.auth) add('auth', operation.id, variant);
  for (const variant of domains.host) add('host', operation.id, variant);
}
for (const operation of MUTATIONS) {
  for (const variant of domains.origin) add('origin', operation.id, variant);
  for (const variant of domains.csrf) add('csrf', operation.id, variant);
}
for (const operation of BODY_OPERATIONS) {
  for (const variant of domains.body) add('body', operation.id, variant);
  for (const variant of domains.authority) add('authority', operation.id, variant);
  for (const variant of domains.delayed) add('delayed', operation.id, variant);
}
for (const operation of VERSION_OPERATIONS) for (const variant of domains.version) add('version', operation.id, variant);
for (const operation of IDEMPOTENT_OPERATIONS) {
  for (const variant of domains.key) add('key', operation.id, variant);
  for (const variant of domains.replay) add('replay', operation.id, variant);
}
for (const operation of RESOURCE_OPERATIONS) add('tenant', operation.id, 'other-business');
for (const operation of ['source-read', 'source-delete', 'source-ocr']) add('tenant', operation, 'other-project-source');
for (const restriction of domains.restriction) for (const status of domains.status) {
  add('restricted-status', 'lead-update', `${restriction}.${status}`, { restriction, status });
}

if (new Set(cases.map(item => item.id)).size !== cases.length) throw new Error('Duplicate release API case IDs.');
const summary = Object.freeze(Object.fromEntries(Object.keys(risks).map(category =>
  [category, cases.filter(item => item.category === category).length])));
module.exports = { OPERATIONS, MUTATIONS, BODY_OPERATIONS, RESOURCE_OPERATIONS, VERSION_OPERATIONS,
  IDEMPOTENT_OPERATIONS, domains, cases: Object.freeze(cases), summary };
