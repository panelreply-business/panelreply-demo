# Native Safari upload file observations

Run 93 passed four of the six installed-Safari journeys. The three callback methods and the spreadsheet correction, persistence and native CSV/XLSX download method passed.

The two upload-dependent spreadsheet methods still errored. The file selection reported 26,973 bytes and trusted input, change and click events. Neither upload saved a source. Later `arrayBuffer` and `FileReader` probes returned `NotReadableError`, code 0. The application's original caught exception and the cause of the browser file-read failure remain unobserved.

These facts are bound to root's [run 93 record](evidence/native-safari-run93-independent-2026-11-23.json), SHA-256 `e789824884f565405bc325ae99289644211b42515c2f23bcd3a6b12ea0b6271d`, source commit `6b4964ff65c2cd8b904d5974382cb6c241e2c378`, and 202 verified source files.

## Diagnostic change

The harness now observes the fixed `IMAGE` fixture through Python before and after the original upload attempt. The observer records file identity, type, Unix mode, owner/group IDs, link count, size, modification/change timestamps and flags. It records the same metadata for at most 16 ancestors.

It opens one read-only descriptor and records a SHA-256 only when the file stays a regular file with matching metadata and a complete bounded read. It accepts files up to 2 MiB, reads in chunks of at most 64 KiB, and reads at most one extra byte to detect growth beyond that bound. It retains open, read, identity and close errors. It never records file contents or changes files or permissions.

A separate passive listener collects at most 16 `securitypolicyviolation` events while the original upload actions run. It records a Boolean trusted flag, directive-name-only tokens of at most 64 characters, disposition `enforce` or `report`, resource scheme categories and bounded numeric locations. Other directive or disposition shapes become `UNKNOWN`. It omits full URIs, policy text and samples. It removes the listener in the existing finalization path. It does not cancel, dispatch or replace browser events.

The observations are part of each upload's existing `inputEvidence` record. The native runner needs no new report format or method IDs.

## Preserved behavior

- All six native method bodies remain byte-identical.
- All nine statements inside the original upload `try` block remain byte-identical.
- The original `send_keys`, upload button click, success text assertion and stored-source assertion remain required.
- All 19 existing harness method bodies remain byte-identical.
- The existing after-failure browser read probe remains unchanged. It still runs only after the original upload fails.
- The select and date input helpers remain unchanged.
- Application code, CSP, browser preferences and host controls remain unchanged.

A host-observer exception is recorded separately and cannot replace the original upload result. A successful host read cannot make a failed native upload pass.

## Local verification

The source-bound harness run passed 25 cases with zero failures, errors or skips. Source remained unchanged during execution.

The first candidate also passed its original 25 checks. Root's source review then found that slicing a raw directive string did not prevent that string from containing URI or policy text. An extension to the existing policy-listener case reproduced that omission as one failure. The token and disposition guards now pass that same extended case within the complete 25-case suite. The original pass record and the failing counterexample remain separate in the evidence.

Six new cases check host identity/hash observations, nonregular and oversized file refusal, open/read/identity/close failures, byte and ancestor bounds, preservation of original upload failure/success, and bounded passive policy capture without URI or sample disclosure.

```sh
PYTHONPATH=tests python -m unittest safari_runner_test
```

Collection still contains exactly three callback and three spreadsheet native methods. No native Safari session or browser was started locally. These 25 results are harness evidence and contribute zero product or release credit.

Candidate source manifest: `ca54f9c7895fb7e396d799975381830e45472aa4f837dafd464d297a195c3890`.

[Validation, preservation proof and source bindings](evidence/native-safari-fixture-observation-2026-11-24.json)

## Remaining evidence

The next normal CI run must collect these observations on the installed Safari host. Compare the fixed fixture's metadata and bytes before and after each failed upload, then inspect any policy event alongside the original result.

Python readability does not establish access by Safari's sandbox or web process. Unix mode bits alone do not establish the cause. An empty policy-event list covers only this listener interval and does not exclude every browser or host restriction.

The observations add host I/O and timing. A later pass alone does not establish why an earlier run failed. No FileReader fallback is justified by the current record because both later native read APIs failed. Preserve the original timeout and previous failed run records until a demonstrated cause is repaired and the unchanged native upload assertions pass.
