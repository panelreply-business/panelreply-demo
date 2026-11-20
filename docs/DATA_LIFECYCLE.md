# Data lifecycle and deletion

This change adds explicit deletion to the existing authenticated SQLite workspace. It does not operate on a real customer database, enable a retention timer, activate a provider or change a public deployment. The verification uses disposable synthetic databases.

## Implemented behavior

| Operation | Removed from active storage | Preserved |
| --- | --- | --- |
| Delete a customer request | Request fields, internal notes, transcript rows and that request's earlier audit rows | Business/account records, other requests, independent opt-outs, safety restrictions and a content-free deletion receipt/audit event |
| Delete a conversation | That request's saved transcript | Request fields, notes, status, opt-out and safety state. The request version increments |
| Delete a panel project | Project name/notes, corrected parts rows and all source-image BLOBs attached to that project | Other projects and businesses, a retry tombstone and a content-free receipt/audit event |
| Delete one source image | The selected private image BLOB | Corrected parts values and other images. Rows using the removed source have their source link cleared and become `unreviewed`. The project version increments |

These are physical removals from the active application tables, not hidden rows in a recycle bin. A user cannot undo a committed deletion through the interface. Backups and previously downloaded exports have separate lifecycles. SQLite `secure_delete` is enabled, but the application makes no forensic-erasure claim about storage media, older WAL files, exported files or existing archives.

## Store contracts

All operations derive business scope from an authenticated actor. The caller supplies the currently saved version, an explicit confirmation and a retry key. A caller-supplied business identifier does not select a different tenant.

```javascript
deleteLead(actor, id, { version, confirmation: 'DELETE' }, operationKey)
deleteLeadConversation(actor, id, { version, confirmation: 'DELETE' }, operationKey)
deletePanelProject(actor, id, { version, confirmation: 'DELETE' }, operationKey)
deletePanelSource(actor, projectId, sourceId, { version, confirmation: 'DELETE' }, operationKey)
```

The confirmation object accepts only the two own properties shown above. `version` must be a safe positive integer below `Number.MAX_SAFE_INTEGER`. The retry key is 16–128 characters from letters, numbers, underscores or hyphens.

The stored result contains `deleted`, `kind`, `id`, the incremented `version`, `deletedAt` and one operation count. The count is `messagesDeleted`, `sourcesDeleted` or `referencesCleared`. A source result also contains `parentId`. Receipts contain no customer name, phone, notes, transcript, image or parts values.

| Case | Result |
| --- | --- |
| Same actor/business, key, record and confirmed version retried | Return the original receipt without another removal or audit entry |
| Key reused for another deletion or version | `409 idempotency_conflict` |
| Missing or another business's record | `404 not_found` |
| Saved version changed before the operation | `409 version_conflict`, with no deletion |
| Missing confirmation, unknown input field or invalid version | `400 deletion_confirmation_required` |
| Unsupported legacy schema | `409 upgrade_required` |
| 20,000 committed deletion operations already retained | `503 deletion_history_limit` for a new deletion. Existing exact retries still return their receipt |

The HTTP layer adds session, CSRF, bounded-body and post-read session checks. Its integration and browser results are reported in the current remediation report. Store tests do not alone prove those HTTP or UI controls.

## Transactions, retries and concurrent edits

The deletion, dependent-row changes, audit event, tombstone and receipt use one `BEGIN IMMEDIATE` transaction. An injected receipt-write failure rolls all of them back. Worker termination before commit leaves the original records. A repeated original create/upload key cannot recreate a deleted record because its digest and key remain in the tombstone table.

Every editable parent has an optimistic version. Two independent connections attempting an edit and deletion at the same version produce one winner. An edit that commits first changes the version and makes deletion stale. A deletion that commits first makes a later edit return not found. Source deletion and whole-project deletion use the same project version.

SQLite still has one writer at a time. The current busy wait is bounded at three seconds. Sustained contention can return a failed operation that the caller must handle. This work does not establish multi-host SQLite safety, network-filesystem support, large-scale throughput or a distributed transaction design. The worker tests use multiple local database connections, not multiple production machines.

## Retained restrictions

Deleting a request or transcript never clears STOP/opt-out suppression. The existing suppression table retains the normalized phone for that business.

A schema-3 safety ledger retains a SHA-256 digest of the business identifier and normalized phone. It stores no transcript or name. The digest is pseudonymous metadata, not encryption or a promise of irreversible anonymization. It prevents a later create, reset or delete/recreate sequence from discarding a known safety restriction at that contact point.

`holdPhone(actor, phone)` is a server-internal operation for a deterministic hazard at a known phone. It saves the restriction even if no request is saved. It moves existing unheld requests at that phone to `needs_review`, increments their versions and records content-free audit metadata. Repeating it makes no further change. It does not expose a clear-hold operation. The assistant model cannot authorize or clear this state. Correcting a held request's phone retains restrictions for both the old and new number.

A full valid preview transcript cannot discard a newly received STOP or hazard. The API preserves validated phone restrictions and cancels earlier same-session assistance even when it returns `413 conversation_limit`. It retains the original transcript and makes no provider call. Malformed, unauthorized, aborted or disconnected requests cannot use that handling to write a restriction.

Schema migration seeds this ledger from existing held records. Other legacy requests at the same business/phone move under review without losing corrected customer fields, notes or conversations. The new state makes any previously loaded version stale.

Removal of restriction metadata requires a separately reviewed policy and implementation. It is not part of ordinary record deletion.

## Backup and restoration

Schema-3 encrypted backups include tombstones, receipts, restrictions and every assistance usage reservation along with both product modules. Backup validation checks exact schema, database integrity, foreign keys, tenant relationships, image bytes, source references, receipt hashes and receipt/tombstone agreement. A missing or contradictory safety restriction is rejected.

A backup taken while a deletion commits restores either the complete state before deletion or the complete state after it. It does not restore half the deleted record. A post-deletion archive preserves removal and blocks the original create key after restart.

An older archive can still contain later-deleted records. It can also lack later opt-outs, safety holds and assistance usage. Restore always uses a new directory and disables all restored passwords. Before restoring access, the operator must reconcile subsequent restrictions, deletions and usage against the surviving source or approved incident record. No automatic cross-archive reconciliation has been implemented. No existing archive is rewritten or silently deleted by a record operation.

Downloaded JSON, CSV and XLSX files remain in their owner's possession. The server cannot retract them. Full account/business removal, a legal erasure process, archive expiry, automatic compaction and offsite retention are not implemented by these record operations.

See [Recovery](RECOVERY.md) for commands, interruption behavior and the proposed offsite architecture.

## Retention options awaiting owner approval

### Read-only review implementation

`store.reviewRetention(actor, { before, limit })` now prepares a content-free review from one SQLite read snapshot. `before` is an explicit integer UTC epoch timestamp no later than the current clock. `limit` is 1–500 per category. There is no default retention age.

Requests qualify only when closed, explicitly not safety-held, and last updated strictly before the cutoff. Panel projects qualify by their last-update timestamp and remain review candidates, not approved deletions. Each category reports an exact total, an explicit truncation flag and stable ordering by update timestamp then identifier. Rows contain the saved version and message/source count. They omit names, phone numbers, notes, transcript text, parts values and image data.

The function uses the authenticated business scope. It neither writes an audit entry nor changes any application table. It exposes no new public or private HTTP route. Existing deletion operations still require a fresh version, typed confirmation and retry key. A review is not authorization to purge. Backup expiry, restriction metadata, accounting and legal holds need separate policies.

Eight real in-memory SQLite cases verify tenant/status/hold/cutoff filtering, bounded results, content exclusion, unchanged tables/change counter, failed-read rollback, invalid clocks and inputs, and current versions/dependency counts. A store-level integration case is included for Linux CI. The Windows host cannot pass the existing POSIX owner-permission checks, which remain unchanged.

No duration below is configured or presented as a legal requirement.

| Option | Proposed handling | Tradeoff and approval needed |
| --- | --- | --- |
| Explicit deletion only | Keep records until an owner confirms each deletion. Keep archives until reviewed operator removal | Current implementation. Storage grows and inactive personal data remains until someone acts |
| Reviewed archive window | Suggest closed requests/projects after 12 months of inactivity. Produce a review list before any deletion. Keep encrypted archives for a separately chosen period, for example 90 days | Owner must select age, what counts as inactivity, archive period and exceptions. Explicit-cutoff store review is implemented. Review UI and scheduled expiry remain unimplemented |
| Business policy by category | Choose separate request, transcript, source-image, project and backup durations with holds and documented exceptions | Requires policy review and tested scheduling, notices, authorization and reconciliation. No purge is authorized by this proposal |

All options need separate decisions for STOP/safety restriction records, audit/tombstone receipts, assistance accounting, exported files, incident holds and archived copies. A retention timer must never silently remove a restriction or refund usage. Before enabling any schedule, test dry-run output, tenant scope, version conflicts, interrupted execution, retries, backup reconciliation and the operator's review procedure on synthetic data.

## Evidence and limits

Run the focused data checks from the repository root:

```bash
node --test tests/data-lifecycle.test.cjs tests/panel-store.test.cjs tests/workspace-store.test.cjs tests/workspace-backup.test.cjs tests/workspace-recovery-auth.test.cjs tests/prelaunch-concurrency.test.cjs
```

`tests/data-lifecycle.test.cjs` covers four deletion operations, ownership, version races, exact retries, rollback, same-phone restrictions, schema-2 migration, newer and older archive behavior, metadata corruption, a terminated writer and three terminated-restore stages. Existing store, backup, recovery-auth and concurrency tests cover saved fields/transcripts, persistence, image bytes, exports, password/session recovery, corrupt archive rejection and independent businesses.

[Data reliability verification](DATA_RELIABILITY_VERIFICATION.md) records the 138-case focused data run, the added usage recovery checks, the 20-case independent follow-up and the final 1,117-case applicable offline suite. All those reported final runs passed with zero failures and zero skipped tests. The counts overlap and must not be added together.

That verification record also discloses two prior actual local listener attempts during shutdown testing, outside the delegated no-network instruction. They are excluded from offline evidence. The shutdown case now belongs to the CI/HTTP-gated file, which the permitted local suite excludes. It was not relaunched after the correction.

This document defines behavior and tested scope, not a claim that every environment or failure has been tested. Physical power loss, disk exhaustion at every write point, native Windows/macOS filesystems, selected-host disaster recovery and offsite restore remain NOT TESTED. Hosted/offsite implementation is BLOCKED on an approved host, destination and operating policy. Real customer deletion is NOT TESTED and was not performed.

