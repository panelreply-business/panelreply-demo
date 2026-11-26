# Spreadsheet unconfirmed-save preservation

Recorded November 23, 2026. Parent commit `1b35490335203348572e938bcc30dfc0f05d93e1`.

## Reproduced defect

A project creation, project correction or source upload can commit before its response is lost. The client retains that command for retry. Previously, any later 4xx response cleared the pending command. A later refusal does not prove that the first write failed. Clearing the command released editing and navigation while the first outcome remained unknown. A source retry could then obtain a different key.

Three shipped-client regressions reproduced this failure. Project creation loses its first response and receives a later 403. Project correction receives incomplete success data and a rejected reconciliation read. Source upload receives a server error after the simulated commit and a later version conflict. The original code passes nine cases and fails these three.

## Correction

Each pending command records whether an earlier result became uncertain. Network errors, server errors and incomplete success data establish uncertainty. Later refusals retain the frozen body, retry key and editing/navigation locks. A later version-conflict response also preserves that pending command instead of disabling its retry through the ordinary conflict state.

A first-attempt 4xx still releases the draft for correction. A successful project/image receipt clears the pending command. Project PATCH retries retain the existing exact-value readback path so confirmation can avoid another revision. Session expiry clears private client state.

The command remains unconfirmed when the server cannot reconcile it. This patch does not invent a completed result or overwrite a conflicting saved revision.

## Verification

All twelve client-state cases pass after the change. Four are new: the three failure sequences and a first-attempt image refusal control. Existing quota/conflict, identity-change, load-retry and program-title checks also pass. The tests execute the shipped client with controlled responses and DOM state. They do not establish actual browser layout or server deduplication.

Three existing browser journeys now perform an actual server write, lose its response, inject a later 403/409 and retry again. They require the same key/body, retained controls, exactly one project/source and no extra project revision. No browser methods were added. These journeys still require source-bound CI execution.

[Before/after logs, hashes and scope](evidence/panel-uncertain-save-2026-11-23.json).

```sh
node --test tests/platform-client-state.test.cjs
python -m py_compile tests/panel_browser_test.py
```
