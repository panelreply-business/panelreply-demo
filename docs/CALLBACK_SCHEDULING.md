# Callback scheduling and follow-up

This milestone adds an operator-controlled schedule to the existing callback product. It uses the same development branch and draft PR8. It does not place calls, send messages, reserve a customer's work appointment, activate a provider or change public service state.

## Owner workflow

1. Open a saved request and review its contact permission and request status.
2. Choose Callback or Follow-up, enter a date and time, and specify a named time zone such as `America/Detroit`.
3. Review the displayed time zone and UTC instant before saving. A skipped clock-change time is rejected. A repeated time requires choosing its first or second occurrence.
4. Open Callback queue to see open tasks or filter due/overdue, completed, cancelled or all tasks. Open the linked request to act.
5. Reschedule an open task, record a call outcome, or cancel it. Recording an outcome describes a call the operator made. It does not initiate contact.
6. After recording an outcome, create a separate follow-up task if another call is needed.

The original requested callback window and requested work date stay separate from the operator's scheduled task. Completing a task does not automatically change the request status. The operator controls each status explicitly.

## State and contact controls

| Current task | Allowed operation | Result |
| --- | --- | --- |
| Scheduled | Reschedule | Same task, new due time and task revision |
| Scheduled | Record outcome | Completed task with reached, no answer, voicemail or other outcome |
| Scheduled | Cancel | Cancelled task with preserved or explicitly edited notes |
| Completed or cancelled | Create follow-up | Separate scheduled task attached to the same request |

STOP/opt-out, a safety hold, missing callback permission, a closed request or a request needing review prevents scheduling, rescheduling and completion. An existing task remains visible as blocked and can still be cancelled. A saved task never grants permission to contact someone. The server rechecks restrictions at each mutation and when returning a retried operation.

Due status is calculated against the server's read timestamp. A scheduled task becomes due at its saved instant, and overdue after one minute. The queue shows when its status was checked and offers Refresh queue. Past instants are accepted so an operator can record work already due.

## API contract

All routes require a callback-capable product, a session pinned to the signed-in business and existing HTTP security checks. Mutations also require the expected origin, CSRF token and `Idempotency-Key`.

- `GET /api/callback-tasks?state=open|due|all|completed|cancelled&leadId=UUID&limit=100&offset=0`
- `POST /api/leads/:leadId/tasks`
- `PATCH /api/callback-tasks/:taskId`

`leadId` is optional for queue reads. Limits are 1–500 and offsets are bounded by the business's 2,000-task quota. Reads return `tasks`, `total`, `limit`, `offset` and `generatedAt`. Task records include the saved UTC instant, named time zone, state, notes, outcome, revisions and timestamps. They also include current request/contact restrictions for display.

Creation accepts exactly `leadVersion`, `kind`, `dueAt`, `timeZone` and `notes`. `dueAt` is a canonical UTC timestamp such as `2026-12-01T14:30:00.000Z`. The server never guesses an offset from a timezone-free date.

Changes accept `leadVersion`, task `version`, `action` and `notes`. Rescheduling additionally requires `dueAt` and `timeZone`. Completion additionally requires `outcome`. Cancellation accepts neither a new due time nor an outcome.

Each successful change increments the parent request revision as well as the task revision, writes a content-free audit entry, and stores the retry operation in one transaction. A stale request/task revision fails without a write. A reused key with a changed payload fails. An exact retry returns the current task and request, including restrictions added since the original operation.

The browser retains a pending command and its key after an unknown save result. It freezes that draft and retries the same payload. A rejected retry cannot erase an earlier unknown result. Definitive input or version rejection preserves the operator's draft for correction or review. Navigation and deletion cannot silently discard a pending task save.

## Storage, export, deletion and recovery

Schema 4 adds callback tasks and operation metadata plus indexes. Composite foreign keys bind a task to its request and business. Existing schema 1–3 migrations remain supported. The new task tables are empty for an existing workspace until tasks are created. See [recovery](RECOVERY.md) before opening older data.

Business-record JSON export is now version 2 and includes `callbackTasks`. It excludes credentials, sessions, retry keys and unrelated businesses. It remains a readable record copy, not a restore archive. Spreadsheet CSV/XLSX contracts are unchanged.

Deleting a request removes its tasks and task operation metadata in the same transaction. Deleting only its conversation preserves the task plan and contact restrictions. Retention review excludes requests that still have scheduled tasks, including blocked tasks. It performs no deletion or scheduled purge.

Encrypted backup/restore validates task identities, business relationships, states, timestamps, revisions, operation metadata and matching audit history. It preserves tasks while stripping sessions and disabling restored passwords. A restore does not reconstruct later opt-outs, cancellations, outcomes or other events missing from that snapshot. Reconcile those events before reopening restored access.

## Reproducible verification

Component and API cases are in `tests/callback-tasks.test.cjs`, `tests/callback-tasks-api.test.cjs` and `tests/callback-schedule-client.test.cjs`. Selected-product browser journeys are in `tests/product_browser_test.py` and run through the source-bound release runner.

The required evidence covers the complete schedule/reschedule/outcome/follow-up/restart journey, due filters, clock changes, ambiguous saves, concurrent edits, contact restrictions, accessible labels/keyboard/reflow, export and deletion. Store/API tests additionally cover tenant boundaries, revoked sessions, transaction rollback, independent database connections, quotas, schema migration and malformed recovery archives.

Actual browser/platform status comes from the committed CI run. Local synthetic DOM tests do not establish browser layout, assistive-technology behavior or physical-device support. This milestone does not close actual model, selected-host, offsite recovery, operations or release approval gates.
