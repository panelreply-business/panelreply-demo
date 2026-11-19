# PanelReply / Ringkeep

PanelReply is a contractor intake project. The next stage adds a local, authenticated inbox with saved requests, business settings and a customer-flow preview.

[Repository](https://github.com/panelreply-business/panelreply-demo) · [Private workspace setup](docs/PRIVATE_WORKSPACE.md) · [Verification](docs/PRIVATE_WORKSPACE_VERIFICATION.md)

## Current status

Both public Render demos are intentionally offline at the owner's request. They show `This service has been suspended by its owner.` Auto-deploy remains off. Do not resume, deploy, republish or create a replacement public preview without separate owner approval.

- Public static URL: https://panelreply-demo.onrender.com/
- Public server URL: https://panelreply-ai.onrender.com/
- The new workspace runs locally at `http://127.0.0.1:10001` after setup. It has no public URL.
- Live AI, calls, SMS and calendar booking remain disconnected.
- A customer pilot remains NO-GO until the remaining operational and integration gates are verified.

[Offline instruction and suspension evidence](docs/OFFLINE_MODE.md)

## Private workspace

The standalone workspace adds:

- Owner sign-in and session expiry, with no public signup or default account.
- Separate business profiles and requests. One business cannot read or edit another business's data.
- An inbox with search, status filters, request details, notes, conversation history and change records.
- SQLite records that survive reload and server restart when the same data directory is used.
- Eleven categories of business answers. Each answer must be confirmed before the preview uses it.
- A separate customer preview with structured review before Save request.
- Name, US callback number, electrical work, five-digit job ZIP, callback window and requested work date.
- Persistent phone opt-outs and safety holds that reset, START and status changes cannot remove.
- Duplicate prevention for save retries and version checks for conflicting edits.

[Desktop inbox](docs/evidence/private-inbox-desktop.jpg) · [Mobile preview](docs/evidence/private-customer-preview-mobile.jpg)

The callback window describes when a customer wants a call. The requested work date describes when they want the work done. Neither reserves an appointment. Contact permission is recorded separately. Saving a request sends no message.

The preview uses explicit field parsing and saved answers. It does not call an AI provider. Questions about hours, coverage or pricing must not overwrite the supplied job details. Unknown business facts stay unknown.

[Setup, behavior, limits and failure handling](docs/PRIVATE_WORKSPACE.md)

## Run locally

Use Node.js 22.18 or later. No application packages or API keys are required for the private workspace.

Create a local owner using the stdin-only setup described in [Private workspace setup](docs/PRIVATE_WORKSPACE.md#local-setup). Keep its database outside the repository in an owner-only directory. No real account is bundled with the source.

Then start it:

```bash
WORKSPACE_DATA_DIR="$HOME/.local/share/panelreply" node workspace-server.cjs
```

Open http://127.0.0.1:10001/login. The entry point binds only to the loopback interface. It rejects a public origin.

The earlier static demo remains in `index.html`. The separate optional AI server remains in `server.cjs`. They are historical demo surfaces and do not use the private workspace database. Their public Render services stay suspended.

## Verification

The private-workspace candidate passed 313 checks with zero failures in [CI run 44460315464](https://github.com/panelreply-business/panelreply-demo/actions/runs/44460315464). Three public application checks remain BLOCKED by intentional suspension. The desktop inbox and 360-pixel customer preview were inspected from that run.

The CI workflow checks the generated demo and CSP, pure intake and answer logic, private authentication and SQLite storage, real HTTP routes, existing demo browser behavior and the new private workspace through Chromium. Synthetic fixtures are isolated from real customers. No provider calls or outbound messages are used.

The recurring audit continues to review code and CI, safe external GET checks and accessible Render state. Three application checks are BLOCKED while the public services are intentionally offline. Offline guards must confirm the suspended response rather than report an outage to fix.

[Exact tested revision, results, reproduced defects and remaining gates](docs/PRIVATE_WORKSPACE_VERIFICATION.md)

## Next gates

- A hosted private-access plan with approved persistent storage, backup and restore verification, password recovery and retention controls.
- Secure API-key choice and approved provider usage before live AI tests.
- A verified calendar integration before appointment confirmations.
- Approved contact and messaging integration before any live call, SMS, email or notification test.
- Owner approval before either public demo reopens or a new public preview is created.

No deployment or live integration is implied by merging code.

## Project history

Historical release records describe their status at the time. Both public demos were suspended afterward.

| Stage | Evidence |
| --- | --- |
| Question answering | [PR4](https://github.com/panelreply-business/panelreply-demo/pull/4), [209-check run](https://github.com/panelreply-business/panelreply-demo/actions/runs/44452485870), [release record](docs/QUESTION_ANSWERS.md) |
| Public demos taken offline | [PR5](https://github.com/panelreply-business/panelreply-demo/pull/5), [offline CI](https://github.com/panelreply-business/panelreply-demo/actions/runs/44454520969), [offline record](docs/OFFLINE_MODE.md) |
| Optional AI server preparation | [PR3](https://github.com/panelreply-business/panelreply-demo/pull/3), [activation boundaries](docs/LIVE_AI_SETUP.md) |
| Static workspace redesign | [PR2](https://github.com/panelreply-business/panelreply-demo/pull/2), [release record](docs/WORKSPACE_REDESIGN.md) |

Other design records: [AI intake and appointment boundaries](docs/AI_INTAKE.md).
