# Apple Silicon runner assignment review

Date: 2026-11-23

Result: no label or repository-visibility mismatch found. Cause remains unconfirmed. No workflow correction is supported by the examined evidence.

## Repository and documented labels

A current GitHub repository metadata read reports `panelreply-business/panelreply-demo` as public, not archived, and owned by a User account. No account billing or organization-policy settings were inspected.

GitHub's current [hosted-runner reference](https://docs.github.com/en/actions/reference/runners/github-hosted-runners) lists `macos-15` and `macos-26` as standard arm64 labels in both its public and private repository tables. It separately lists `macos-15-intel` and `macos-26-intel` for Intel. Public standard runners do not require a larger-runner label. The observed ARM labels match the documented standard labels.

## Recorded jobs

| Run | Job ID | Requested label | Last recorded runner ID | Recorded steps | Conclusion |
| --- | ---: | --- | ---: | ---: | --- |
| 83 | 137841954965 | macos-26 | 0 | 0 | cancelled |
| 84 | 137870996914 | macos-15 | 0 | 0 | cancelled |
| 85 | 137882485411 | macos-15 | 0 | 0 | cancelled |
| 86 | 137900160312 | macos-15 | 0 | 0 | cancelled in the fresh normalized read |

Run 83's runner ID comes from its preserved final evidence record because its normalized metadata file omits that field. Runs 84 and 85 preserve full metadata with empty runner names and step arrays. Their creation-to-completion intervals were 953 and 901 seconds. These timestamps do not establish native execution.

Run 86's full snapshot at 18:17:35.830 UTC still showed queued, runner ID zero and no steps. A subsequent read at approximately 18:24 UTC reports completed/cancelled and no step records. The fresh connector result omits labels, runner IDs and timestamps. It does not replace or retroactively alter the earlier full snapshot. Its cancellation cause and initiator are not present in the examined fields.

## Workflow inspection

The current `apple-silicon-release` job requests the single scalar label `macos-15` and has a 35-minute timeout. It retains explicit checks that Node reports Darwin and arm64. It does not add another runner label, runner group, container, environment approval, dependency or strategy matrix. Neither the workflow nor this job declares concurrency cancellation.

Those source settings do not establish why GitHub never assigned a runner. The architecture checks and later test steps cannot be responsible for a step failure before any runner or step is recorded. The recorded cancellations also do not supply evidence that the 35-minute job timeout expired.

GitHub's [Actions limits reference](https://docs.github.com/en/actions/reference/limits) documents macOS concurrency limits and potential start delays during demand. That general documentation does not prove a capacity incident or limit exhaustion for these jobs. No account-specific eligibility or quota cause was established. The 24-hour queue limit in that reference applies to self-hosted runners and is not evidence for these standard hosted jobs.

## Decision and remaining evidence

Keep the current standard label and actual-architecture assertions. There is no evidence-backed standard-label correction to propose. Switching aliases, retrying or cancelling jobs would not establish the cause.

The assignment blocker remains open. A future assigned runner must execute the architecture check and produce complete source-bound test reports before Apple Silicon receives coverage credit. This investigation establishes no physical-device testing or native macOS OCR support.

The adjacent JSON record contains the repository observation, workflow hash, historical source hashes, job URLs and fresh normalized result. No files in the primary checkout were edited. No job was cancelled or retried, no runner purchased, no policy changed, and no support message sent.
