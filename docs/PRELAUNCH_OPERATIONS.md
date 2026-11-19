# Pre-launch operations and business preparation

Date: 2026-11-19. This is a review proposal. It does not authorize deployment, spending, customer data, outreach, subscriptions or a pilot. [Current engineering status](DEVELOPMENT_PROGRESS.md) and [release acceptance](RELEASE_ACCEPTANCE.md) are the decision records.

## Product position and competition

Proposed position: a contractor-controlled workspace for electrical request intake and component-label review. The operator checks uncertain information, saves the record and exports corrected parts. The value proposition must be measured in a later approved evaluation, not asserted as time or revenue savings now.

Official public pages checked on 2026-11-19:

| Product | Relevant documented capability | Observed pricing model | Implication for PanelReply |
| --- | --- | --- | --- |
| [Jobber](https://www.getjobber.com/pricing/) | Scheduling, quotes, invoices, payments, customer communication and an AI Receptionist. | Page lists one-user Core at USD49/month without commitment or USD29/month billed annually. Receptionist is shown as a USD99/month add-on. Team size and billing commitment change prices. | Conversational intake alone is not an established competitive advantage. Request accuracy, review and integration friction need evidence. |
| [Housecall Pro](https://www.housecallpro.com/pricing/) | Booking, scheduling/dispatch, estimates, payments, mobile workflows and AI offerings. | Page lists Basic for one user at USD79/month or USD59/month billed annually. Add-ons and promotional prices vary. | Competing as a complete field-service suite would create a much larger scope. Keep the two core workflows dependable. |
| [ServiceTitan](https://www.servicetitan.com/pricing) | Dispatch, scheduling, call booking, invoicing and pricebook, with further operational modules by package. | Per-technician packages with pricing requested from the vendor. No numeric quote was obtained. | Larger operational breadth already exists. Do not claim PanelReply replaces those functions. |

These are vendor descriptions, not independent quality measurements. No account, trial or sales conversation was opened. The research did not establish that competitors lack electrical-label OCR. That absence must not be used as a marketing claim.

The potential distinction is the combined workflow: electrical request details and source-linked parts review, with explicit uncertainty and portable corrected records. This is a product hypothesis. The smallest future study should compare completion time, correction effort and data errors on the same authorized tasks. No customer study has occurred.

Mandatory before claiming market readiness: reliable save/reopen, recovery, useful mobile controls, understandable error handling, support ownership, truthful integration labels and reviewed data handling. Dispatch, accounting, payroll, inventory procurement and marketing automation can wait. They do not resolve the current AI/OCR evidence gaps.

## Proposed subscription structure

No PanelReply price is approved or published. Consider a per-business workspace subscription with a stated user allowance, explicit storage limits and a separate bounded AI allowance after provider costs are measured. Avoid an unlimited-AI promise. A parts-only entry plan and a combined plan are possible packaging choices, not implemented billing products.

A future price decision should compare observed task value, support time and contribution margin. Competitor list prices are reference points, not a justification for selecting PanelReply's price. Discounting an unverified workflow does not fix its acceptance gaps.

## Hosting options

| Option | Application change | Benefits | Limits and approval gates |
| --- | --- | --- | --- |
| Current local workspace | None for local evaluation | Existing loopback/authentication/SQLite boundaries, no hosting purchase | Operator-only setup, no hosted service or customer pilot |
| One protected application instance with durable local storage | Reviewed HTTPS/private-access entry point, durable mount, service manager, backup job, resource policy | Smallest architecture change for a controlled evaluation | Single writer/instance, maintenance windows, offsite recovery and access control must be exercised before customer use |
| Application service plus managed relational storage and private objects | New storage adapters, migrations and transactional image/row ownership design | Can support a later multi-instance architecture | More cost and failure boundaries. Not justified before workload and adoption evidence |

Render's documentation says free web services lose local files on restart, redeploy or idle shutdown and cannot attach persistent disks. They are unsuitable for this workspace's durable SQLite records. [Free-service limitations](https://render.com/docs/free).

A Render persistent disk is attached to one service instance and cannot support multiple instances or zero-downtime deployment. Only its mount path persists. Render documents daily disk snapshots retained for seven days and cautions against using disk snapshots as custom-database recovery. Application-consistent encrypted database backups remain necessary. [Disk documentation](https://render.com/docs/disks).

Recommended next infrastructure design, after owner approval: retain one application instance and SQLite for the first controlled evaluation, behind reviewed private access, with an owner-only durable data directory and an independent encrypted backup destination. Keep OCR in a separate restricted process/container with no network and only required binaries/language files. Process ceilings in the current branch limit work but do not constitute a security sandbox.

The existing `workspaceConfig` intentionally rejects a public listener. This proposal does not change it. A future hosted entry point must be a separate reviewed change with exact HTTPS origin, secure cookies, trusted-proxy rules, TLS termination and an end-to-end authentication test. Merely changing PORT or adding a disk does not make the workspace deployable.

## Cost model for an approval decision

No infrastructure price is represented as an approved budget. The current Render pricing page did not expose enough compute/disk rate detail through the available reader to verify a complete hosted quote. Obtain a dated quote before selecting or activating infrastructure.

Monthly cost model:

`application compute + OCR compute + durable storage + encrypted backup storage + transfer + model usage + monitoring + support + applicable tax`

| Variable | Measurement or decision needed |
| --- | --- |
| Compute | Peak concurrent OCR and application memory, observed CPU time, recovery headroom and availability target |
| Storage | Saved row/image bytes, growth, backup cadence and retention. Current panel-content cap is32MiB per local workspace, not a SaaS capacity promise. |
| Model usage | Approved model, average input/output tokens per conversation, measured retry rate and per-business hard allowance |
| Support | Onboarding and recovery minutes per business, support hours and incident responsibility |
| Margin | Proposed price less all direct usage/support costs under expected and high-usage cases |

For a proposed provider, calculate input/output cost using its current quoted unit rates and measured token counts. Test a high-usage scenario at ten times expected volume. Refuse new provider calls before the approved cap, count failed attempts and enforce the allowance durably. Current process-local assistant limits reset on restart and are not a spending control.

No model, storage, monitoring or communication service was purchased for this work. Local synthetic timings are not a hosting quote or an SLA.

## Backup and restore proposal

The existing recovery tools create authenticated encrypted archives and restore into a fresh owner-only directory. Restored sessions are absent and passwords require operator reset. Existing source databases must never be overwritten by a restore attempt. See [recovery procedure](RECOVERY.md) and [bounded recovery evidence](STRESS_RECOVERY.md).

Proposed targets for review, not guarantees: recovery-point objective of24hours and recovery-time objective of4hours for an initial controlled evaluation. These require an approved scheduled offsite backup and a timed restore on the selected host. A disk snapshot is not an independent offsite recovery drill.

Proposed schedule after approval: one encrypted application backup each day, seven daily archives and four weekly archives, with a verified restore each month and before a schema release. Keep the encryption secret separately from the archives. Backups should be non-public, access logged and protected from accidental overwrite. Owner approval is needed for the destination, credentials, retention and costs.

Recovery steps: stop writes, preserve the failed data directory, identify the last authenticated archive, restore into a new location, compare integrity/counts/source hashes, reset owner access, perform request/project/export checks, then separately approve routing to the restored instance. Record any interval of data loss and reconcile it before reopening. Do not copy a restored password/session into service.

## Retention, deletion and account recovery

Decisions still required: how long to retain completed requests, conversations, source images, project rows, audit records and backup copies. Distinguish an image from the corrected text derived from it. A deletion workflow must validate tenant ownership, show affected records, prevent stale-version deletion and explain backup retention. No deletion endpoint is claimed in this release.

Operator-assisted owner reset exists. Self-service recovery requires identity verification, abuse controls, short-lived single-use recovery state, session revocation and an approved delivery channel. Email delivery is not connected. Do not add public signup/reset flows until their lifecycle and support ownership are reviewed.

## Monitoring and incident response

Proposed log allowlist: request correlation ID, route category, duration, status/error code and redacted operation counts. Exclude message text, contact numbers, source bytes, part notes, passwords, cookies, CSRF values and provider responses. Test the allowlist before sending any logs to an external service.

Monitor failed sign-ins, stale-version conflicts, source quota usage, provider rejection/timeout, native-process failures, backup age, restore outcomes and application health. Alerts require a named owner and an approved delivery channel. None was activated here.

Incident sequence: restrict the affected workflow, preserve evidence without spreading customer data, determine impacted businesses, revoke relevant sessions/keys if authorized, verify backup integrity, correct the defect in an isolated branch, retest and obtain reopening approval. Legal notification obligations require qualified review. Do not invent a notification deadline or send customer communications automatically.

Current configuration incident: read-only Render checks observed both existing services as `not_suspended`, although the brief requires suspension. Auto-deploy and PR previews remain off. Treat the configuration as a release FAIL until the owner resolves it. This session did not resume, deploy or change either service.

## Deployment and rollback checklist for later approval

1. Choose a verified commit and retain its exact application/test/evidence hashes.
2. Resolve all critical/high defects and required acceptance failures.
3. Approve hosting, private access, costs, data location, provider usage and backup destination.
4. Exercise restore on the chosen host with synthetic records before loading customer data.
5. Take a fresh authenticated backup and freeze writes before a schema change.
6. Run migration, authentication, tenant, OCR, export and recovery smoke checks in isolation.
7. Publish only after separate owner approval. Auto-deploy stays off until explicitly approved.
8. On failure, stop writes and preserve the new database. Roll back code only if schema compatibility is verified. Otherwise restore the pre-change archive into a fresh location and reconcile post-backup changes before any reopening.

No deployment manifest or public endpoint was created by this plan.

## Pilot, onboarding, support and legal preparation

A later pilot proposal is two or three authorized businesses, synthetic tasks first, then approved limited data only after acceptance review. The owner chooses participants and budget. No outreach or invitations are authorized by this document.

Onboarding sequence: establish business owner access, review supported workflows and limits, enter and confirm business facts, test intake, save/reopen a parts project, export corrected values, review opt-out/safety handling, perform a recovery drill and record the support contact. Do not import production data to demonstrate setup.

Support requires a named operator, a monitored channel, response-hour expectations, a reproducible bug template and a secure way to reference an affected record without copying sensitive content into public issues. Bug reports should include version, operation, error code, synthetic reproduction and expected outcome.

Legal review inputs: data categories and purposes, processors and locations, retention/deletion behavior, backup copies, model data handling, consent and opt-out records, security contact, service limits, ownership/export rights, acceptable-use rules and termination/recovery arrangements. These are product facts to review, not published legal terms or a compliance certification.

The owner must decide service-state correction, future hosting/budget, approved representative photos, provider/model and data-transfer terms, retention/deletion, support responsibility, legal text, pricing, merge and any pilot/public release. None is implied by a passing engineering check.
