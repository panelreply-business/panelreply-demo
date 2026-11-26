# Shared account invariant repair

Recorded November 23, 2026. Candidate base: `1b35490335203348572e938bcc30dfc0f05d93e1`.

## Confirmed defects

A business profile at `Number.MAX_SAFE_INTEGER` was readable and archive-valid. An update attempted an unsafe increment, then returned an internal `RangeError`. The existing transaction rolled back, so the defect was the failed public error contract rather than committed profile corruption.

An authenticated session created at a synthetic time could later store `last_seen` before `created_at` when the host clock moved back one second. A rollback after later activity also reduced `last_seen`. The lookup read the clock separately for absolute expiry, idle expiry and activity storage.

## Boundary and compatibility decisions

- A business profile may retain the existing maximum safe revision. The final increment from `MAX_SAFE_INTEGER - 1` to `MAX_SAFE_INTEGER` remains supported. Another matching update returns HTTP 409 with `version_exhausted` before changing the business or audit. Stale inputs still return `version_conflict`. Actor and tenant checks remain in place.
- Session lookup takes one clock sample. It requires a safe integer from 0 through 8,640,000,000,000,000 milliseconds. An invalid sample returns HTTP 503 with `clock_unavailable` before any write.
- The original absolute and idle expiry comparisons remain in place. Active lookup records the maximum of the sampled time, saved activity time and creation time. During rollback, an existing valid token remains authorized and saved activity does not move backward.
- The stored absolute expiry remains unchanged. The idle deadline remains based on the saved activity point. Expired or revoked rows remain absent after the clock moves backward.

These guarantees concern stored wall-clock deadlines and monotonic `last_seen`. They do not establish real elapsed-time expiry during arbitrary host clock changes.

No schema or archive-acceptance rule changed. Account creation, session creation, password verification, login throttling, password reset, token generation and cookie settings were not changed. Existing login, reset, revocation and recovery regressions exercise their interaction with the corrected lookup.

## Verification

The exact 10 new cases ran against the unchanged base runtime. One passed and nine failed. The same cases all pass with the repair.

The selected regression passed 145 tests with zero failures, cancellations, skips or TODOs.

```bash
WORKSPACE_HTTP_TESTS=1 node --test --test-reporter=tap tests/account-invariants.test.cjs tests/workspace-store.test.cjs tests/workspace-api.test.cjs tests/workspace-revocation.test.cjs tests/workspace-recovery-auth.test.cjs tests/workspace-backup.test.cjs tests/product-backup.test.cjs
```

The new cases verify:

- Terminal profile rejection without changing any saved row or the caller's draft.
- Final safe profile increment, exact saved facts, safe audit revision and continued archive validation.
- Stale-version and tenant authorization behavior at the revision boundary.
- Controlled errors and safe revision serialization through the fixed callback API.
- Session rollback before creation and after later activity, including reopening the store.
- Unchanged stored absolute expiry and exact idle/absolute expiry boundaries after rollback.
- A single clock sample and no writes for invalid clock values.
- Authenticated session lookup, controlled clock failure and logout through both fixed product APIs.
- Product-bound encrypted recovery of a terminal profile, with source sessions unchanged and restored sessions and credentials disabled.

The selected existing suites also cover password reset, concurrent credential revocation, delayed-body session revalidation, login rotation, persistent throttling and both restored product HTTP entrypoints. These tests use synthetic data and local handlers or loopback only.

The callback agent reviewed both runtime hunks and all 10 new methods without editing them. No concrete defect was found.

Evidence is in [account-invariants-2026-11-23.json](evidence/account-invariants-2026-11-23.json). The overlapping focused and selected runs do not earn duplicate goal credit. These dirty-source local results require clean committed CI after integration.

## Integration

Only `session()` and `updateProfile()` in `workspace/store.cjs` changed. This patch is separate from the request/restriction timestamp and revision work, panel mutation guards, shared Unicode guard and archive-range validation.

No production, deployment, platform-support or release approval gate changed.
