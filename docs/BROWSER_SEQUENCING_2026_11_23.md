# Browser journey sequencing corrections

## Verified run86 outcome

All six selected callback suites pass 15/15 on committed `13b8741`, including the corrected disabled/enabled focus sequence. Both emulated mobile engines pass the shared 40-method and fixed-callback 12-method suites. The WebKit completed-save/reopen case passes with all page-error assertions retained. [Final source-bound evidence](evidence/callback-scheduling-run86.json).

The original run85 failures remain below. The initiating interruption cause stays an inference. These passes verify the intended completed-save journey, not every interrupted browser request or physical-device behavior.

Run85 tests committed `76db2d6`. Two observed verification defects are described
here. The final full-run record preserves seven failed executions and six
unexecuted Safari cases. [Sequencing traces](evidence/browser-sequencing-run85.json)
and [verified final run](evidence/callback-scheduling-run85.json).

## Enlarged-text focus probe

The callback journey's new focus probe tried to focus Contact permission and
then Tab to Internal notes while a task draft was open. The application locks
request edits in this state. The Mac Chromium trace explicitly shows the
Internal notes textbox disabled. Five jobs reach the same assertion: Chromium
and Firefox on Linux and Intel Mac, plus Intel Mac WebKit. Linux WebKit fails
earlier at genuine 521px page overflow and must be tracked separately.
[Reflow evidence and candidate](CALLBACK_REFLOW_2026_11_23.md).

The correction first requires both request fields to be disabled while the
draft exists. It then discards through the navigation guard, checks that no
task was saved, verifies queue geometry, and returns to the request. Both
fields must now be enabled. The select must retain doubled text, accept focus
and pass native Tab to Internal notes. No application lock is removed and no
font, viewport or geometry assertion is relaxed.

The Mac WebKit trace reaches the focus probe after the earlier 320px reflow
assertion. The whole method still fails and receives no passing credit. Its
corrected complete journey remains pending actual browser execution.

## Mobile save and reopen

The WebKit emulated tablet-portrait request journey saves and reopens the
request, but teardown observes an uncaught error naming a task-list request
and access-control checks. The job records 39 passes and one failure in its
40-method suite. The separate fixed-callback touch suite passes 12/12.

The test previously reloaded immediately after receiving the PATCH response,
then returned once the notes field was visible. Both save rendering and
reopening start an asynchronous task-list read. An interrupted view read is a
supported inference from this ordering and the named request, but the trace
does not identify whether reload or teardown initiated the interruption.

The candidate waits for the initial task list before editing. Before reload it
requires the displayed completed-save message and completed task list. After
reload it requires the saved notes, another completed task list and the same
server readback. Existing page-error, console, request and provider assertions
remain. No timeout sleep, browser retry or error allowlist is added.

This defines the intended completed-save/reopen journey. It does not prove a
general guarantee for every interrupted browser request. Actual CI still must
verify the correction on the changed source.
