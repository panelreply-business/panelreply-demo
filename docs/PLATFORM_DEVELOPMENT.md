# PanelReply dual-product development

Date: 2026-11-19. Branch: `feature/interactive-dual-product-site`. Review: [draft PR8](https://github.com/panelreply-business/panelreply-demo/pull/8).

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
| Schema migration | Validate schema 1, then add schema 2 tables and indexes in one transaction. Existing intake tables and data stay intact. Read-only recovery operations accept schema 1 and schema 2 without migrating. |
| Session changes | Frontends pin requests to the current session with an optional `X-Workspace-Session` header using the existing CSRF value. A stale tab receives 401 before adopting another session's data. Cookie authentication remains mandatory. |
| Image rendering | Use authenticated same-origin source URLs. Keep the existing CSP: no inline scripts, no third-party scripts, no remote resources and no `blob:` image allowance. |
| OCR | Optional local Tesseract 5 with English data. Results are candidates, never automatic confirmation. No paid OCR provider or remote upload. See [OCR comparison and measurements](OCR_OPTIONS.md). |
| Spreadsheet format | Implement CSV first. UTF-8 BOM, CRLF, quote escaping and formula-prefix neutralization support spreadsheet import. Exact corrected field strings are retained apart from documented formula protection. |
| XLSX | Evaluated and deferred. XLSX needs a ZIP/XML writer or a maintained library, plus type/formula/round-trip checks. CSV meets the first milestone without adding that dependency. XLSX is NOT IMPLEMENTED. |
| Deployment | No new deployment, automatic deployment, public preview, domain or live integration. Both existing Render services remain owner-suspended. |

## Product surfaces

The marketing homepage introduces intake and panel review, then links to product details, features, pricing preparation, workspace access, pilot preparation and legal-review placeholders. Pricing is not approved. Contact/pilot fields do not transmit information. The demo uses fictional customer and component records, resets in memory and makes no persistence or live OCR claim.

The authenticated dashboard links to customer requests, panel scanning, saved projects, exports, business settings and account information. Customer requests and panel records have separate working areas. A callback preference or requested work date is not a booking. No interface action sends a call, SMS, email or calendar invitation.

## Panel workspace usage

1. Sign in using the existing local workspace account.
2. Open Panel scanning and choose New project.
3. Enter a project name and optional notes. Add rows manually, or save the project first to attach a source image.
4. Upload a PNG or JPEG label photograph you are authorized to store. Save existing edits before upload or OCR so a new project version cannot overwrite a draft.
5. If the local OCR readiness check passes, choose Extract text. Read the raw text, add candidates to the table, and correct each field against the original image.
6. A row must contain part number, manufacturer and description before it can be marked reviewed. Unknown fields stay blank and unreviewed. Editing a row clears its previous review status.
7. Save the project. Reopen it from Saved projects. Export saved CSV to include the current saved corrections.

Saving an image increments the project version. OCR itself does not change saved rows. The export reads saved rows only and tells the user when local draft changes are excluded. Download feedback says the file was prepared, not that the browser definitely wrote it to disk.

### Bounds

| Item | Limit |
| --- | --- |
| Projects | 200 per business |
| Parts | 200 rows per project |
| Quantity | Integer 1–9999 |
| Source images | Five per project, PNG/JPEG, maximum 2 MiB each |
| Dimensions | At most6000px per side and 16 million pixels |
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
- Missing OCR support leaves manual entry, correction, persistence and CSV available.
- Unsupported, oversized, malformed or undecodable images fail without a guessed result.
- Native OCR timeout/cancellation kills and reaps the child process before another recognition can start.

## Local setup and review

Use the existing [private workspace setup](PRIVATE_WORKSPACE.md). Node 22.18 or later is required. The private server binds to 127.0.0.1 and rejects a public origin.

For OCR, install Tesseract 5 and English language data on an approved local Linux development machine. The current adapter uses `/usr/bin/tesseract`. It does not automatically install packages or activate a provider at application startup. If the executable is unavailable, the UI reports that OCR is unavailable. Other operating systems or executable paths require a reviewed adapter change.

The design website can be reviewed from the checked-out branch using a local-only static server:

```bash
python3 -m http.server 8080 --bind 127.0.0.1 --directory design-preview
```

Open `http://127.0.0.1:8080`. This command is for local review. It does not authorize a public preview or Render deployment. The marketing login view explains workspace access and does not collect credentials.

## Storage, recovery and retention

Uploaded images are private BLOBs, not files under a public directory. All image, project, OCR and CSV requests require the existing authenticated business scope. The database retains owner-only filesystem permissions. It is not encrypted at rest by this change. Encrypted backups cover intake, projects and images together and retain the restore password-reset requirement.

Before opening an existing database with the new branch, take an encrypted backup and keep the original archive. Normal startup migrates schema 1 to schema 2. A schema 2 database must be used with schema 2-capable code. Do not point older main/recovery code at the upgraded database as a rollback. To revert, restore a pre-migration archive into a fresh directory with the matching code and follow the existing password-reset process.

Project/image deletion, automatic retention and offsite backup are NOT IMPLEMENTED. Keep development data synthetic or explicitly authorized. A customer pilot needs an approved retention/deletion process, storage plan, restore objectives and resource isolation before accepting live documents.

The existing JSON business-record export keeps its intake/profile contract. Per-project CSV exports cover panel rows. Encrypted backups cover both modules and source images. These three outputs serve different purposes and are not interchangeable.

## Remaining product gates

This branch targets the first development milestone and a local authenticated panel workflow. It is not full commercial readiness. Pending gates include authorized real-photo OCR benchmarking, hosted private access and storage, resource isolation for native image processing, deletion/retention, offsite restore drills, account recovery operations, reviewed legal text, pricing and any approved live integrations. No appointment is confirmed until an actual calendar integration is implemented and verified.

The owner must approve a merge into main and any later public exposure separately.
