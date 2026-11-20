# PanelReply dual-product development

Updated: November 19, 2026 (America/New_York). Branch: `feature/interactive-dual-product-site`. Review: [draft PR8](https://github.com/panelreply-business/panelreply-demo/pull/8). Current engineering evidence is in [remediation verification](REMEDIATION_VERIFICATION.md).

## Repository assessment

The starting design branch contained one standalone prototype in `design-preview/index.html`, based on `3fe946d6479c2b71f709e54463c0979da688c94e`. Main had already advanced through the recovery work to `c6152b38ae2e3a824e6a81199aa0d757d47a19ae`. The implementation continues that same design branch and incorporates the verified recovery code. It does not replace or duplicate the branch, authentication system, intake parser or data store.

The existing architecture is plain browser JavaScript, a Node HTTP server and built-in Node SQLite. It does not need a frontend framework or an application package installation. Existing boundaries include loopback-only serving, owner authentication, business-scoped records, consent and opt-out protections, safety holds, CSRF and origin checks, optimistic record versions, retry identifiers and encrypted recovery archives.

Main's prior baseline is 396 passing checks and three intentionally blocked public application checks in [run 56](https://github.com/panelreply-business/panelreply-demo/actions/runs/44519600580). That baseline is historical evidence for the recovery release, not a claim that new platform changes have passed those checks. New evidence is recorded separately in [platform verification](PLATFORM_VERIFICATION.md).

## Decisions and integration boundaries

| Concern | Decision and reason |
| --- | --- |
| Marketing website | Keep `design-preview/` separate from the private server. Ten hash-routed views share one design and a synthetic demo. No forms submit to an external endpoint. |
| Existing intake | Keep `/`, `/preview`, the parser, approved business answers, saved requests and original APIs. Add navigation and a shared navy/blue theme without replacing the backend. |
| Unified workspace | Add `/dashboard` and `/panels` behind the same session. No signup, second owner database or alternative authentication. |
| Dashboard | Read actual business-scoped request and project summaries. Missing data stays unavailable rather than showing invented zeroes. |
| Panel projects | Store versioned project rows and source image BLOBs in the existing private SQLite database. Atomic snapshots therefore cover both products and images. |
| Schema migration | Validate schema 1 or 2, then migrate transactionally to schema 3. Existing intake and panel data stay intact. Schema 3 adds deletion receipts/tombstones, safety restrictions and usage accounting. Read-only recovery accepts schemas 1, 2 and 3 without migrating. |
| Session changes | Frontends pin requests to the current session with an optional `X-Workspace-Session` header using the existing CSRF value. A stale tab receives 401 before adopting another session's data. Cookie authentication remains mandatory. |
| Image rendering | Use authenticated same-origin source URLs. Keep the existing CSP: no inline scripts, no third-party scripts, no remote resources and no `blob:` image allowance. |
| OCR | Optional local Tesseract 5, English data and fixed Python/Pillow normalization. OSD data enables bounded orientation fallback. Results are candidates, never automatic confirmation. No paid OCR provider or remote upload. See [OCR comparison and measurements](OCR_OPTIONS.md). |
| Spreadsheet format | Implement CSV first. UTF-8 BOM, CRLF, quote escaping and formula-prefix neutralization support spreadsheet import. Exact corrected field strings are retained apart from documented formula protection. |
| XLSX | A bounded dependency-free OOXML writer exports saved projects with explicit text cells, numeric quantities and no formulas or external relationships. Independent reader and native spreadsheet limits are documented in [XLSX verification](XLSX_EXPORT.md). |
| Deployment | No new deployment, automatic deployment, public preview, domain or live integration. Both existing Render services are suspended following the separately approved correction. Auto-deploy and previews remain off. Do not change their state without separate owner approval. |

## Product surfaces

The marketing homepage introduces intake and panel review, then links to product details, features, pricing preparation, workspace access, pilot preparation and legal-review placeholders. Pricing is not approved. Contact/pilot fields do not transmit information. The demo uses fictional customer and component records, resets in memory and makes no persistence or live OCR claim. An optional guided walkthrough shows prepared rows from a sample label, then returns to the existing editable table. Skip and reduced motion avoid waiting. Replaying the guide never resets corrected rows, review marks or requests. See [design decisions](DESIGN_SYSTEM.md).

The authenticated dashboard links to customer requests, panel scanning, saved projects, exports, business settings and account information. Customer requests and panel records have separate working areas. A callback preference or requested work date is not a booking. No interface action sends a call, SMS, email or calendar invitation.

## Panel workspace usage

1. Sign in using the existing local workspace account.
2. Open Panel scanning and choose New project.
3. Enter a project name and optional notes. Add rows manually, or save the project first to attach a source image.
4. Choose or drop one PNG or JPEG label photograph you are authorized to store, then choose Save image. Selection stays in browser memory until that explicit save. The UI shows the pending operation without inventing a percentage. After saving, use View image to preview the private source. Save existing edits before upload or OCR so a new project version cannot overwrite a draft.
5. If the local OCR readiness check passes, choose Extract text. Read the raw text, add candidates to the table, and correct each field against the original image.
6. Missing core fields are identified in the table. A row must contain part number, manufacturer and description before it can be marked reviewed. Unknown fields stay blank and unreviewed. Editing a row clears its previous review status.
7. Save the project. Reopen it from Saved projects. Export saved CSV or XLSX to include the current saved corrections.

Removing a populated row requires confirmation and changes only the draft until Save project. Exports and Saved projects links retain the current project. Arriving at Exports without a project explains how to select one.

Saving an image increments the project version. OCR itself does not change saved rows. The export reads saved rows only and tells the user when local draft changes are excluded. Download feedback says the file was prepared, not that the browser definitely wrote it to disk.

### Bounds

| Item | Limit |
| --- | --- |
| Projects | 200 per business |
| Parts | 200 rows per project |
| Quantity | Integer 1–9999 |
| Source images | Five per project, PNG/JPEG, maximum 2 MiB each |
| Dimensions | At most 6000 px per side and 16 million pixels |
| Stored panel content | 32 MiB across the local workspace database |
| Project name / notes | 120 / 2000 characters |
| Part number / manufacturer / description / row notes | 128 / 120 / 1000 / 1000 characters |
| OCR | One recognition per application process, 15-second processing limit, bounded output |

These are local development limits. They are not a hosted service plan or commercial quota promise.

## Failure behavior

- Validation errors keep the draft and identify the issue.
- Version conflicts keep the draft and require an explicit decision before reloading saved data.
- A lost create/upload response retries the same idempotency identifier rather than creating another project or image.
- An uncertain update checks the exact saved correction values before confirming success. Whitespace in notes or component fields is meaningful and must not be trimmed to manufacture a match.
- Capacity errors describe the capacity issue. They must not pretend that a new project has a stale saved version.
- A session change or expiry clears the client state and returns to sign-in. Existing server business scoping applies independently.
- Missing OCR support leaves manual entry, correction, persistence, CSV and XLSX available.
- Unsupported, oversized, malformed or undecodable images fail without a guessed result.
- Native OCR timeout/cancellation kills and reaps the child process before another recognition can start.

## Local setup and review

Use the existing [private workspace setup](PRIVATE_WORKSPACE.md). Node 22.18 or later is required. The private server binds to 127.0.0.1 and rejects a public origin.

For OCR, use an approved local Linux development machine with Tesseract 5, English language data, util-linux and system Pillow for fixed `/usr/bin/python3`. OSD language data enables the orientation fallback. The adapter runs the fixed normalizer and `/usr/bin/tesseract` behind `/usr/bin/prlimit`. Readiness fails closed if required executables or normalization dependencies are absent. It does not install packages or activate a provider at startup. Missing support leaves manual entry and exports available. Other operating systems or executable paths require a reviewed adapter change. The optional required-isolation mode also needs a supported unprivileged bubblewrap host and the [native isolation checks](OCR_ISOLATION.md).

The design website can be reviewed from the checked-out branch using a local-only static server:

```bash
python3 -m http.server 8080 --bind 127.0.0.1 --directory design-preview
```

Open `http://127.0.0.1:8080`. This command is for local review. It does not authorize a public preview or Render deployment. The marketing login view explains workspace access and does not collect credentials.

## Storage, recovery and retention

Uploaded images are private BLOBs, not files under a public directory. All image, project, OCR, CSV and XLSX requests require the existing authenticated business scope. The database retains owner-only filesystem permissions. It is not encrypted at rest by this change. Encrypted backups cover intake, projects and images together and retain the restore password-reset requirement.

Before opening an existing database with the new branch, take an encrypted backup and keep the original archive. Normal startup migrates schema 1 or 2 to schema 3. Use schema-3-capable code with the upgraded database. Do not point older main/recovery code at it as a rollback. To revert, restore a pre-migration archive into a fresh directory with matching code, reset passwords and reconcile restrictions, deletions and usage events that occurred after that snapshot before re-enabling access.

Explicit request, conversation, project and source-image deletion is implemented with ownership, version and retry checks. The private UI requires typed confirmation. See [data lifecycle and retention options](DATA_LIFECYCLE.md). Automatic expiry and offsite backup are not active. Keep development data synthetic or explicitly authorized. A customer pilot still needs approved retention, storage and recovery policies and verified host isolation before accepting live documents.

The existing JSON business-record export keeps its intake/profile contract. Per-project CSV and XLSX exports cover panel rows. Encrypted backups cover both modules and source images. These three outputs serve different purposes and are not interchangeable.

## Remaining product gates

This branch contains the design milestone and local authenticated workflows. It is not full commercial readiness. Pending gates include real-model evaluation, authorized real-photo OCR benchmarking, hosted private access and storage, selected-host isolation, approved automatic-retention policy, offsite restore drills, account recovery operations, reviewed legal text, pricing and any approved live integrations. No appointment is confirmed until an actual calendar integration is implemented and verified.

The owner must approve a merge into main and any later public exposure separately.
