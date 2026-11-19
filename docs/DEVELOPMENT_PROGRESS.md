# PanelReply development progress

Authoritative current progress record. Date: 2026-11-19. Continue the existing `feature/interactive-dual-product-site` branch and draft [PR8](https://github.com/panelreply-business/panelreply-demo/pull/8). Do not create duplicate work or merge/deploy without approval.

## Baseline

- Starting commit: `41e31a8683bbf2e587b4dfcec8c5d2f2a65cffa8`, tree `aa173065035fbf8e2f8ff04334de9c4a6a48b0a5`.
- All 120 local file blobs were independently matched to the recursive GitHub tree before edits.
- Main remains `c6152b38ae2e3a824e6a81199aa0d757d47a19ae`.
- Historical [CI62](https://github.com/panelreply-business/panelreply-demo/actions/runs/44536934974) is successful on the starting commit: 590 PASS / 0 FAIL / 3 intentionally blocked public checks. These are historical results, not new-commit evidence.
- Fresh isolated baseline: 397 pure Node/SQLite/in-process API checks PASS, 0 FAIL, 0 SKIP. Generated-demo/CSP check PASS. Local listeners/Chromium remain unavailable, so actual HTTP/browser checks use CI.

## Current workstream

Pre-launch reliability. Application commit [c5a4754](https://github.com/panelreply-business/panelreply-demo/commit/c5a47542d665a7d5ffb202e1cde4669c85512243) is saved on the existing branch. Its full 155-file GitHub tree matched the local candidate exactly. The latest browser correction is in progress. The updated full isolated run passed 638 Node/SQLite/in-process API tests with zero failures or skips. This includes the two transport defects found after the first 636-check pass. The focused transport/adversarial run passed 42 tests and the overlapping seven-suite run passed 323. Full updated CI [run64](https://github.com/panelreply-business/panelreply-demo/actions/runs/44631944024) passed 645 Node/HTTP checks, the existing 175 Chromium cases and four new assistant browser cases. Four XLSX browser cases passed and three stopped at a test callback error. Firefox found one validation-focus failure, three sub-0.001 px geometry assertion failures and the same three callback errors. The corrections preserve the assertions and require a new CI run. WebKit is still executing. Native OCR and resource checks passed 14 cases. Independent XLSX readback passed nine fixtures. This is not a release approval.

| Work | Current state | Evidence/next action |
| --- | --- | --- |
| Existing website, dashboard, intake and panel projects | Previously verified, preserved | [Historical platform record](PLATFORM_VERIFICATION.md); run full regression after changes |
| Provider-independent conversation orchestration | Implemented; component, corpus and adversarial checks pass; browser CI pending | [AI boundary](AI_PRELAUNCH.md), assistant component/API/corpus tests |
| New AI safety/grounding defects | Reproduced and corrected; regression checks pass | `tests/assistant-adversarial.test.cjs` |
| XLSX export | Implemented with component and independent-reader checks; browser CI pending | [XLSX record](XLSX_EXPORT.md) |
| OCR benchmark/resource limits | Implemented, native checks run, benchmark records nonexact cases | [OCR benchmark](OCR_BENCHMARK.md) |
| Concurrent SQLite and recovery workload | Six parallel-worker tests and one bounded restore workload PASS | [Stress/recovery](STRESS_RECOVERY.md) |
| Firefox/WebKit test coverage | Harness and CI prepared; execution pending | Existing suite assertions retained, explicit engine selection |
| Production/business preparation | Review proposal prepared, no activation | [Operations and business](PRELAUNCH_OPERATIONS.md) |

## Configuration defect requiring owner action

HIGH: both existing Render services now report `not_suspended` in repeated read-only checks. Their updatedAt values are 2026-11-19T22:02:59.769174Z and 22:03:10.317358Z. Auto-deploy and PR previews remain off. The current brief requires suspended services and also forbids changing their state without new explicit approval.

- [Server service](https://dashboard.render.com/web/srv-dbv6do6tlv9c73fuvar0)
- [Static service](https://dashboard.render.com/static/srv-dbu5o8tckfvc73b6fb4g)

No infrastructure state was changed in this session. Run64 independently returned HTTP200 from both URLs and failed both required503 guards. The independent public-suspension CI job retains the existing GET-only assertions and must fail if the required state is absent. Separating that job lets isolated application tests continue, without hiding the deployment-state failure.

## Approval boundaries

No real-provider call, customer data, customer contact, paid service, account creation, public deployment, domain or main merge. Real AI quality, representative electrical photographs, hosted operations and any pilot remain separate acceptance gates.

Next action: run the updated full regression, capture actual browser evidence, commit to the same branch and update this document and [release acceptance](RELEASE_ACCEPTANCE.md) with exact results. See the [defect register](PRELAUNCH_DEFECTS.md) for reproduction and verification. Preserve all prior failures in the evidence history.
