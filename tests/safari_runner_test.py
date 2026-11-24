"""Native Safari evidence-harness checks, never product-goal executions.

No driver, browser, server, network or Safari is started. The outcome tests use
in-memory doubles and temporary reports to verify fail-closed accounting. One
metadata check reads the existing product definitions through the local Node
runtime. Keyboard doubles verify harness behavior, never native date entry.
"""

import contextlib
import errno
import hashlib
import io
import json
import copy
import os
from pathlib import Path
import stat
import subprocess
from tempfile import TemporaryDirectory
import types
import unittest
from unittest.mock import Mock, patch

import release_safari_runner as runner
import safari_product_browser_test as product_harness
import safari_fixture_observer as fixture_observer
from safari_product_browser_test import select_keyboard_plan, UPLOAD_READ_DIAGNOSTIC, \
    UPLOAD_EVENT_DIAGNOSTIC_BEGIN, UPLOAD_EVENT_DIAGNOSTIC_END


SOURCE = {"sourceCommit": "a" * 40, "gitTreeHash": "b" * 40, "dirty": True,
          "workingTreeStatus": ["synthetic harness fixture"], "sourceManifest": [],
          "sourceTreeSha256": "c" * 64}

CONTROL = {"type": "datetime-local", "step": "60", "lang": "en", "direction": "ltr",
           "writingMode": "horizontal-tb", "browserLanguage": "en-US", "browserLanguages": ["en-US"],
           "format": {"locale": "en", "calendar": "gregory", "numberingSystem": "latn", "hourCycle": "h12"},
           "fieldOrder": ["month", "day", "year", "hour", "minute", "dayPeriod"]}


def date_harness(value, *, observed=None, untrusted=False, send_error=None, control=None):
    """An in-memory protocol double. It cannot establish native behavior."""
    case = runner.SafariCallbackBrowserTests("test_contact_hold_and_keyboard_dirty_edit_guard")
    case.input_evidence = []
    case.native = types.SimpleNamespace(keys=types.SimpleNamespace(ARROW_LEFT="LEFT", ARROW_RIGHT="RIGHT", TAB="TAB"))
    case.fill = Mock()
    case.wait = types.SimpleNamespace(until=lambda predicate: predicate(None))
    element = Mock()
    element.is_enabled.return_value = True
    element.get_property.return_value = ""
    element.send_keys.side_effect = send_error
    case.element = Mock(return_value=element)
    final_value = value if observed is None else observed
    events = [{"type": kind, "key": "ArrowRight", "trusted": True, "value": ""}
              for _ in range(5) for kind in ("keydown", "keyup")]
    events.extend({"type": kind, "key": None, "trusted": not untrusted, "value": final_value}
                  for kind in ("input", "change"))
    trace = {"events": events, "overflow": False, "observedValue": final_value, "activeElementId": "task-time-zone"}
    case.driver = types.SimpleNamespace(execute_script=Mock(side_effect=[copy.deepcopy(control or CONTROL), None, trace]))
    return case, element


SELECT_CONTROL = {"tag": "SELECT", "multiple": False, "disabled": False, "size": 0,
                  "value": "unreviewed", "selectedIndex": 0, "options": [
                      {"value": "unreviewed", "label": "Unreviewed", "disabled": False, "hidden": False},
                      {"value": "reviewed", "label": "Reviewed", "disabled": False, "hidden": False}]}


def select_harness(*, observed="reviewed", untrusted=False, missing_change=False,
                   send_error=None, observation_error=None, control=None, focus=None):
    """No browser is launched. Doubles validate fail-closed evidence handling."""
    case = runner.SafariSpreadsheetBrowserTests("test_manual_corrections_persist_and_native_downloads_match")
    case.input_evidence = []
    actions = [Mock(), Mock()]
    for action in actions:
        action.send_keys.return_value = action
    actions[1].perform.side_effect = send_error
    case.native = types.SimpleNamespace(keys=types.SimpleNamespace(TAB="TAB", ESCAPE="ESCAPE"),
                                        select_type=Mock(), actions_type=Mock(side_effect=actions))
    case.action_doubles = actions
    case.wait = types.SimpleNamespace(until=lambda predicate: predicate(None))
    element = Mock()
    element.is_enabled.return_value = True
    element.get_property.return_value = "unreviewed"
    case.element = Mock(return_value=element)
    events = [{"type": kind, "key": "r", "trusted": True, "value": "unreviewed"}
              for kind in ("keydown", "keyup")]
    events.extend({"type": kind, "key": None, "trusted": not untrusted, "value": "reviewed"}
                  for kind in (("input",) if missing_change else ("input", "change")))
    trace = {"events": events, "overflow": False, "observedValue": observed, "activeElementId": None}
    prepared = {"active": True, "disabled": False, "value": "unreviewed", "selectedIndex": 0,
                "events": [{"type": "keydown", "key": "Escape", "trusted": True, "value": "unreviewed"}],
                "overflow": False}
    case.driver = types.SimpleNamespace(execute_script=Mock(
        side_effect=[copy.deepcopy(control or SELECT_CONTROL), None, prepared if focus is None else focus,
                     observation_error or trace]))
    return case, element


class SafariRunnerHarnessTests(unittest.TestCase):
    def test_select_plan_handles_shared_initials_disabled_options_and_wraparound(self):
        values = [("open", "Open tasks", False), ("done", "Completed", True),
                  ("complete", "Completed tasks", False), ("cancel", "Cancelled", False)]
        control = {**SELECT_CONTROL, "value": "open", "selectedIndex": 0,
                   "options": [{"value": value, "label": label, "disabled": disabled, "hidden": False}
                               for value, label, disabled in values]}
        plan = select_keyboard_plan(control, "cancel")
        self.assertEqual((plan["character"], plan["cycles"], plan["targetIndex"]), ("c", 2, 3))
        self.assertEqual(select_keyboard_plan({**control, "value": "cancel", "selectedIndex": 3}, "complete")["cycles"], 1)
        self.assertEqual(select_keyboard_plan(control, "open")["cycles"], 0)

    def test_select_inventory_rejects_unusable_or_ambiguous_target_before_typing(self):
        invalid = [{**SELECT_CONTROL, "multiple": True}, {**SELECT_CONTROL, "disabled": True},
                   {**SELECT_CONTROL, "size": 3}, {**SELECT_CONTROL, "selectedIndex": -1},
                   {**SELECT_CONTROL, "value": "reviewed"}, {**SELECT_CONTROL, "options": []}]
        for field, value in [("disabled", True), ("hidden", True), ("label", "Ω unknown")]:
            control = copy.deepcopy(SELECT_CONTROL)
            control["options"][1][field] = value
            invalid.append(control)
        duplicate = copy.deepcopy(SELECT_CONTROL)
        duplicate["options"].append(dict(duplicate["options"][1]))
        invalid.append(duplicate)
        for control in invalid:
            case, element = select_harness(control=control)
            with self.assertRaises(AssertionError):
                case.select("#review", "reviewed")
            element.send_keys.assert_not_called()
            case.native.select_type.assert_not_called()
            case.native.actions_type.assert_not_called()
            self.assertEqual(case.input_evidence[0]["status"], "ATTEMPTED")

    def test_native_select_requires_trusted_change_and_preserves_application_rejection(self):
        for observed, expected in [("reviewed", None), ("unreviewed", "unreviewed")]:
            case, element = select_harness(observed=observed)
            case.select("#review", "reviewed", expected=expected)
            element.send_keys.assert_not_called()
            element.click.assert_called_once()
            case.action_doubles[0].send_keys.assert_called_once_with("ESCAPE")
            case.action_doubles[1].send_keys.assert_called_once_with("r", "TAB")
            self.assertEqual(case.native.actions_type.call_count, 2)
            case.native.select_type.assert_not_called()
            self.assertEqual(case.input_evidence[0]["status"], "OBSERVED")
            self.assertEqual(case.input_evidence[0]["observedValue"], observed)
        for options in [{"observed": "unreviewed"}, {"untrusted": True}, {"missing_change": True}]:
            case, element = select_harness(**options)
            with self.assertRaises(AssertionError):
                case.select("#review", "reviewed")
            element.send_keys.assert_not_called()
            case.action_doubles[1].send_keys.assert_called_once_with("r", "TAB")
            self.assertEqual(case.input_evidence[0]["status"], "ATTEMPTED")

    def test_select_transport_failure_keeps_trace_without_diagnostic_error_replacing_it(self):
        for observation_error in [None, RuntimeError("Synthetic observer failure")]:
            original = RuntimeError("Synthetic native input transport failure")
            case, element = select_harness(send_error=original, observation_error=observation_error)
            with self.assertRaisesRegex(RuntimeError, "Synthetic native input transport failure"):
                case.select("#review", "reviewed")
            element.send_keys.assert_not_called()
            case.action_doubles[1].perform.assert_called_once()
            self.assertEqual(case.input_evidence[0]["status"], "ATTEMPTED")
            if observation_error is not None:
                self.assertIn("Synthetic observer failure", case.input_evidence[0]["observationError"])
            else:
                self.assertTrue(case.input_evidence[0]["events"])

    def test_select_focus_preparation_must_preserve_enabled_target_before_selection_keys(self):
        prepared = {"active": True, "disabled": False, "value": "unreviewed", "selectedIndex": 0,
                    "events": [], "overflow": False}
        for field, value in [("active", False), ("disabled", True), ("value", "reviewed"),
                             ("selectedIndex", 1), ("overflow", True)]:
            case, element = select_harness(focus={**prepared, field: value})
            with self.assertRaises(AssertionError):
                case.select("#review", "reviewed")
            element.click.assert_called_once()
            element.send_keys.assert_not_called()
            case.action_doubles[0].send_keys.assert_called_once_with("ESCAPE")
            case.action_doubles[1].send_keys.assert_not_called()
            self.assertEqual(case.input_evidence[0]["status"], "ATTEMPTED")
            self.assertEqual(case.input_evidence[0]["focusPreparation"][field], value)

    def test_upload_diagnostics_retain_failure_and_original_native_actions(self):
        case = runner.SafariSpreadsheetBrowserTests("test_file_upload_source_links_and_unavailable_ocr")
        case.input_evidence = []
        element = Mock()
        element.is_enabled.return_value = True
        case.element = Mock(return_value=element)
        case.click = Mock()
        case.text_contains = Mock(side_effect=[None, RuntimeError("Synthetic upload did not save")])
        case.api = Mock()
        case.page_state = Mock(side_effect=[{"phase": "selected"}, {"phase": "failed"}])
        case.driver = types.SimpleNamespace(execute_script=Mock(side_effect=[None, {
            "events": [{"type": "click", "targetId": "upload-source", "trusted": True}], "overflow": False}]),
            execute_async_script=Mock(return_value={"format": "panelreply-after-failure-file-read-v1",
                                                   "originalExceptionCaptured": False}))
        with self.assertRaisesRegex(RuntimeError, "Synthetic upload did not save"):
            case.upload_source({"id": "synthetic-project"})
        element.send_keys.assert_called_once()
        self.assertEqual(Path(element.send_keys.call_args.args[0]), runner.ROOT / "tests/fixtures/panels/complete.png")
        case.click.assert_called_once_with("#upload-source")
        self.assertEqual(case.text_contains.call_args_list[-1].args, ("#source-status", "Source image saved"))
        case.api.assert_not_called()
        observation = case.input_evidence[0]
        self.assertEqual((observation["status"], observation["finalState"]), ("ATTEMPTED", {"phase": "failed"}))
        self.assertEqual(observation["events"][0]["trusted"], True)
        case.driver.execute_async_script.assert_called_once_with(UPLOAD_READ_DIAGNOSTIC, 2 * 1024 * 1024)
        self.assertFalse(observation["afterFailureRead"]["originalExceptionCaptured"])

    def test_later_upload_read_error_preserves_original_failure_and_success_never_reads_again(self):
        for succeeds in (False, True):
            case = runner.SafariSpreadsheetBrowserTests("test_file_upload_source_links_and_unavailable_ocr")
            case.input_evidence = []
            element = Mock()
            element.is_enabled.return_value = True
            case.element = Mock(return_value=element)
            case.click = Mock()
            case.text_contains = Mock(side_effect=[None, None if succeeds else RuntimeError("Original upload failure")])
            case.api = Mock(return_value={"project": {"sources": [{"id": "synthetic-source"}]}})
            case.page_state = Mock(return_value={"phase": "observed"})
            case.driver = types.SimpleNamespace(execute_script=Mock(side_effect=[None, {"events": [], "overflow": False}]),
                execute_async_script=Mock(side_effect=RuntimeError("Later read failed")))
            if succeeds:
                self.assertEqual(case.upload_source({"id": "synthetic-project"}), {"id": "synthetic-source"})
                case.driver.execute_async_script.assert_not_called()
                self.assertEqual(case.input_evidence[0]["status"], "OBSERVED")
            else:
                with self.assertRaisesRegex(RuntimeError, "Original upload failure"):
                    case.upload_source({"id": "synthetic-project"})
                self.assertEqual(case.input_evidence[0]["readDiagnosticError"], "Later read failed")
                self.assertEqual(case.input_evidence[0]["status"], "ATTEMPTED")
                case.api.assert_not_called()
            element.send_keys.assert_called_once()
            case.click.assert_called_once_with("#upload-source")

    def file_read_probe(self, mode):
        # Execute the exact diagnostic script with synthetic File APIs only.
        # No browser, native file, application request or upload is involved.
        script = r"""
            const vm = require('node:vm');
            const input = JSON.parse(require('node:fs').readFileSync(0, 'utf8'));
            const bytes = Uint8Array.from([1, 2, 3, 4]);
            const error = Object.assign(new Error('Synthetic unreadable file'), {name: 'NotReadableError', code: 0});
            let fileReads = 0, readerReads = 0, uuidCalls = 0, aborts = 0, timerMs;
            const file = {name: 'synthetic.png', type: 'image/png', size: input.mode === 'oversize' ? 2097153 : 4,
                lastModified: 1, arrayBuffer: async () => {
                    ++fileReads;
                    if (input.mode === 'error') throw error;
                    if (input.mode === 'timeout') return new Promise(() => {});
                    return bytes.buffer;
                }};
            class Reader {
                readAsArrayBuffer(selected) {
                    if (selected !== file) throw new Error('Unexpected diagnostic file');
                    ++readerReads; this.readyState = 1;
                    if (input.mode === 'timeout') return;
                    this.onprogress({loaded: 4, total: 4, lengthComputable: true});
                    if (input.mode === 'error') { this.error = error; this.onerror(); }
                    else { this.result = bytes.buffer; this.onload(); }
                    this.readyState = 2;
                }
                abort() { ++aborts; this.readyState = 2; this.onabort(); }
            }
            const context = {document: {querySelector: selector => {
                if (selector !== '#panel-image') throw new Error('Unexpected DOM query');
                return {files: input.mode === 'cleared' ? [] : [file]};
            }}, isSecureContext: true, crypto: {randomUUID: () => { ++uuidCalls; throw new Error('Must not call UUID'); }},
                FileReader: Reader, btoa: value => Buffer.from(value, 'binary').toString('base64'),
                setTimeout: (fn, ms) => { timerMs = ms; return setTimeout(fn, input.mode === 'timeout' ? 0 : ms); },
                clearTimeout, arguments: [2097152, result => {
                    setImmediate(() => process.stdout.write(JSON.stringify({result, fileReads, readerReads, uuidCalls, aborts, timerMs})));
                }]};
            if (input.mode === 'cleared') context.__panelreplyFailedFixture = file;
            vm.runInNewContext('(function(){' + input.script + '\n}).apply(null, arguments)', context, {timeout: 1000});
            if (context.__panelreplyFailedFixture) throw new Error('Diagnostic retained the fixture');
        """
        result = subprocess.run(["node", "-e", script], input=json.dumps({"script": UPLOAD_READ_DIAGNOSTIC, "mode": mode}),
                                text=True, capture_output=True, timeout=10, check=True)
        return json.loads(result.stdout)

    def test_after_failure_read_probe_records_only_counts_and_exact_native_error_fields(self):
        for mode in ("read", "error", "cleared"):
            result = self.file_read_probe(mode)
            report = result["result"]
            self.assertEqual((result["fileReads"], result["readerReads"], result["uuidCalls"]), (1, 1, 0))
            self.assertFalse(report["originalExceptionCaptured"])
            self.assertFalse(report["originalActionsRepeated"])
            self.assertEqual(report["file"]["size"], 4)
            for method in ("arrayBufferAndBase64", "fileReader"):
                observed = report["reads"][method]
                self.assertEqual(observed["status"], "ERROR" if mode == "error" else "READ")
                if mode == "error":
                    self.assertEqual(observed["error"], {"name": "NotReadableError", "code": 0,
                                                       "message": "Synthetic unreadable file"})
                else:
                    self.assertEqual(observed["bytes"], 4)
                    self.assertTrue(observed["matchesFileSize"])
                self.assertNotIn("data", observed)
                self.assertNotIn("content", observed)
            if mode != "error":
                self.assertEqual(report["reads"]["arrayBufferAndBase64"]["encodedLength"], 8)
            else:
                self.assertEqual(report["reads"]["arrayBufferAndBase64"]["stage"], "arrayBuffer")

    def test_after_failure_read_probe_bounds_size_and_time_without_upload_retries(self):
        too_large = self.file_read_probe("oversize")
        self.assertEqual(too_large["result"]["status"], "NOT_READ")
        self.assertEqual((too_large["fileReads"], too_large["readerReads"], too_large["uuidCalls"]), (0, 0, 0))
        timeout = self.file_read_probe("timeout")
        self.assertEqual((timeout["fileReads"], timeout["readerReads"], timeout["uuidCalls"], timeout["aborts"]), (1, 1, 0, 1))
        self.assertEqual(timeout["timerMs"], 4000)
        self.assertEqual({item["status"] for item in timeout["result"]["reads"].values()}, {"TIMEOUT"})

    def test_failure_snapshot_runs_before_teardown_and_never_changes_original_outcome(self):
        for diagnostic_error in [False, True]:
            order = []

            class SyntheticCase(unittest.TestCase):
                product_id = "spreadsheet"
                native = types.SimpleNamespace(evidence={"sessionSha256": "d" * 64})

                def test_failure(self):
                    order.append("method")
                    self.fail("Synthetic product assertion remains failed")

                def capture_failure_evidence(self):
                    order.append("capture")
                    if diagnostic_error:
                        raise RuntimeError("Synthetic diagnostic failure")
                    self.diagnostic_evidence = [{"kind": "failure-state", "synthetic": True}]

                def tearDown(self):
                    order.append("teardown")

            case = SyntheticCase("test_failure")
            result = runner.SafariResult(unittest.runner._WritelnDecorator(io.StringIO()), True, 0)
            case.run(result)
            self.assertEqual(order, ["method", "capture", "teardown"])
            record = result.records[case.id()]
            self.assertEqual(record["status"], "FAIL")
            self.assertIn("Synthetic product assertion remains failed", record["diagnostics"][0])
            self.assertEqual(len(result.failures), 1)
            self.assertEqual(len(result.errors), 0)
            if diagnostic_error:
                self.assertEqual(record["diagnosticCaptureErrors"], ["Synthetic diagnostic failure"])
            else:
                self.assertEqual(record["diagnosticEvidence"], [{"kind": "failure-state", "synthetic": True}])

    def test_product_title_contract_matches_existing_fixed_product_definitions(self):
        script = "const {productDefinition}=require('./workspace/products.cjs'); console.log(JSON.stringify(['callback','spreadsheet'].map(id=>productDefinition(id))))"
        result = subprocess.run(["node", "-e", script], cwd=runner.ROOT, check=True,
                                text=True, capture_output=True, timeout=10)
        definitions = {item["id"]: item for item in json.loads(result.stdout)}
        for suite in runner.SUITES.values():
            definition = definitions[suite.product_id]
            self.assertEqual(suite.product_label, definition["label"])
            self.assertEqual(suite.home_path, definition["homePath"])

    def test_segmented_keyboard_plan_preserves_midnight_noon_and_calendar_fields(self):
        for value, hour, period in [("2028-02-29T00:07", "12", "A"), ("2028-02-29T12:07", "12", "P")]:
            case, element = date_harness(value)
            case.task_time(value)
            element.clear.assert_called_once()
            element.send_keys.assert_called_once_with(*(["LEFT"] * 6), "2", "RIGHT", "29", "RIGHT", "2028",
                                                     "RIGHT", hour, "RIGHT", "7", "RIGHT", period, "TAB")
            self.assertEqual(case.input_evidence[0]["status"], "OBSERVED")
            self.assertEqual(case.input_evidence[0]["observedValue"], value)

    def test_incorrect_native_value_or_untrusted_events_preserve_failure_without_fallback(self):
        for options in [{"observed": ""}, {"observed": "2026-12-01T21:30"}, {"untrusted": True}]:
            case, element = date_harness("2026-12-01T09:30", **options)
            with self.assertRaises(AssertionError):
                case.task_time("2026-12-01T09:30")
            element.send_keys.assert_called_once()
            case.fill.assert_called_once_with("#task-time-zone", "America/Detroit")
            self.assertEqual(case.input_evidence[0]["status"], "ATTEMPTED")
            self.assertIn("observedValue", case.input_evidence[0])
            self.assertTrue(case.input_evidence[0]["events"])

    def test_keyboard_command_error_keeps_observation_and_propagates_original_failure(self):
        failure = RuntimeError("Synthetic native keyboard transport failure")
        case, element = date_harness("2026-12-01T09:30", observed="", send_error=failure)
        with self.assertRaisesRegex(RuntimeError, "Synthetic native keyboard transport failure"):
            case.task_time("2026-12-01T09:30")
        element.send_keys.assert_called_once()
        self.assertEqual(case.input_evidence[0]["observedValue"], "")
        self.assertEqual(case.input_evidence[0]["status"], "ATTEMPTED")

    def test_unsupported_language_layout_rejects_before_clearing_or_typing(self):
        unsupported = {**CONTROL, "fieldOrder": ["day", "month", "year", "hour", "minute", "dayPeriod"]}
        case, element = date_harness("2026-12-01T09:30", control=unsupported)
        with self.assertRaises(AssertionError):
            case.task_time("2026-12-01T09:30")
        element.clear.assert_not_called()
        element.send_keys.assert_not_called()
        self.assertEqual(case.input_evidence[0]["control"], unsupported)
        self.assertEqual(case.input_evidence[0]["status"], "ATTEMPTED")

    def test_native_identity_rejects_version_suffixes_and_contradictory_host_capabilities(self):
        version, build = "26.6", "20624.4.5.18.1"
        self.assertTrue(runner.driver_identity_matches(f"Included with Safari {version} ({build})", version, build))
        requested = {"browserName": "safari", "platformName": "mac",
                     "pageLoadStrategy": "normal", "browserVersion": version}
        self.assertTrue(runner.desktop_request_matches(requested, version))
        # Run85's installed macOS driver rejected this extension even as false.
        # Neither a simulator selector nor an altered desktop request is valid.
        for key, value in [("safari:useSimulator", False), ("safari:useSimulator", True),
                           ("safari:deviceType", "iPhone"), ("platformName", "ios"),
                           ("pageLoadStrategy", "none"), ("browserVersion", "26.5")]:
            self.assertFalse(runner.desktop_request_matches({**requested, key: value}, version))
        for output in [f"Included with Safari {version}.1 ({build})", f"Included with Safari {version} ({build}2)"]:
            self.assertFalse(runner.driver_identity_matches(output, version, build))
        installation = {"browser": {"version": version}, "host": {"osVersion": "15.7.9", "osBuild": "24G507"}}
        session = {"browserName": "Safari", "browserVersion": version, "platformName": "mac",
                   "safari:platformVersion": "15.7.9", "safari:platformBuildVersion": "24G507"}
        self.assertTrue(runner.session_identity_matches(session, installation, "synthetic-session"))
        for key, value in [("safari:platformVersion", "15.7.8"), ("safari:platformBuildVersion", "24G508"),
                           ("platformName", "ios"), ("safari:useSimulator", True)]:
            self.assertFalse(runner.session_identity_matches({**session, key: value}, installation, "synthetic-session"))
        del session["safari:platformVersion"]
        del session["safari:platformBuildVersion"]
        self.assertTrue(runner.session_identity_matches(session, installation, "synthetic-session"))

    def test_collection_has_exactly_six_without_runtime_or_source_calls(self):
        with TemporaryDirectory() as directory, patch.object(runner.NativeSafari, "start") as start, \
                patch.object(runner, "source_evidence") as source, \
                patch("sys.argv", ["runner", "--list", "--output-dir", directory]), \
                contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(runner.main(), 0)
            report = json.loads((Path(directory) / "collected.json").read_text())
            self.assertEqual(report["status"], "COLLECTED_ONLY")
            self.assertEqual([len(ids) for ids in report["suites"].values()], [3, 3])
            self.assertEqual(len({item for ids in report["suites"].values() for item in ids}), 6)
            start.assert_not_called()
            source.assert_not_called()

    def test_driver_unavailable_is_attempted_once_and_preserves_every_not_run_method(self):
        with TemporaryDirectory() as directory, \
                patch.object(runner.NativeSafari, "start", side_effect=runner.SafariUnavailable("fixture unavailable")) as start, \
                patch.object(runner.NativeSafari, "close") as close, \
                patch.object(runner, "source_evidence", return_value=SOURCE), \
                patch.object(runner, "command", return_value="v24.22.3"), \
                patch.object(runner.unittest.TextTestRunner, "run") as run, \
                patch("sys.argv", ["runner", "--output-dir", directory]), \
                contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(runner.main(), 1)
            for suite in runner.SUITES:
                report = json.loads((Path(directory) / (suite + ".json")).read_text())
                self.assertEqual(report["status"], "BLOCKED")
                self.assertEqual(report["expectedMethods"], 3)
                self.assertEqual([case["status"] for case in report["tests"]], ["NOT_RUN"] * 3)
                self.assertEqual(report["platform"]["observedBrowsers"], [])
                self.assertEqual(report["infrastructureErrors"][0]["classification"], "NATIVE_SAFARI_UNAVAILABLE")
            start.assert_called_once()
            close.assert_called_once()
            run.assert_not_called()

    def test_one_product_failure_does_not_skip_or_erase_the_other_product(self):
        native = runner.NativeSafari()
        native.evidence.update({"state": "OBSERVED", "stable": True, "session": {"browserVersion": "synthetic"},
                                "sessionSha256": "d" * 64})
        results = []
        for index, tests in enumerate(runner.collect().values()):
            records = {test.id(): {**runner.missing_record(test), "status": "FAIL" if index == 0 and number == 0 else "PASS"}
                       for number, test in enumerate(tests)}
            results.append(types.SimpleNamespace(records=records, infrastructure_errors=[]))
        with TemporaryDirectory() as directory, patch.object(runner, "NativeSafari", return_value=native), \
                patch.object(native, "start"), patch.object(native, "finish_observation"), patch.object(native, "close"), \
                patch.object(runner, "source_evidence", return_value=SOURCE), \
                patch.object(runner, "command", return_value="v24.22.3"), \
                patch.object(runner.unittest.TextTestRunner, "run", side_effect=results) as run, \
                patch("sys.argv", ["runner", "--output-dir", directory]), \
                contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(runner.main(), 1)
            self.assertEqual(run.call_count, 2)
            callback = json.loads((Path(directory) / "callback-safari.json").read_text())
            spreadsheet = json.loads((Path(directory) / "spreadsheet-manual-safari.json").read_text())
            self.assertEqual(callback["status"], "FAIL")
            self.assertEqual(callback["totals"]["FAIL"], 1)
            self.assertEqual(spreadsheet["status"], "PASS")
            self.assertEqual(spreadsheet["totals"]["PASS"], 3)


class SafariFixtureObservationTests(unittest.TestCase):
    def test_host_fixture_records_identity_modes_and_hash_without_content_or_writes(self):
        with TemporaryDirectory() as directory:
            filename = Path(directory) / "owned-image.png"
            data = bytes(range(256)) + b"Owned synthetic fixture, never customer content."
            filename.write_bytes(data)
            before = fixture_observer.metadata(filename.lstat())
            with patch.object(fixture_observer.os, "open", wraps=os.open) as opened, \
                    patch.object(fixture_observer.os, "read", wraps=os.read) as read:
                result = fixture_observer.observe_fixture(filename)
            self.assertEqual(result["status"], "READ")
            self.assertEqual(result["sha256"], hashlib.sha256(data).hexdigest())
            self.assertEqual(result["bytesRead"], len(data))
            self.assertTrue(result["descriptorOpened"])
            self.assertTrue(result["descriptorClosed"])
            self.assertTrue(result["stableIdentityAndMetadata"])
            self.assertEqual(result["pathBefore"], before)
            self.assertEqual(result["pathAfter"], before)
            self.assertEqual(fixture_observer.metadata(filename.lstat()), before)
            self.assertEqual(filename.read_bytes(), data)
            opened.assert_called_once()
            self.assertEqual(opened.call_args.args[1] & (os.O_WRONLY | os.O_RDWR | os.O_CREAT | os.O_TRUNC), 0)
            self.assertTrue(all(0 < call.args[1] <= fixture_observer.READ_CHUNK for call in read.call_args_list))
            self.assertEqual(result["ancestors"][0]["metadata"]["mode"], oct(stat.S_IMODE(Path(directory).lstat().st_mode)))
            self.assertFalse(result["fileContentRecorded"])
            self.assertFalse(result["originalBrowserExceptionCaptured"])
            self.assertNotIn(data.decode("latin1"), json.dumps(result))

    def test_host_fixture_refuses_nonregular_empty_and_oversize_files_before_opening(self):
        with TemporaryDirectory() as directory:
            parent = Path(directory)
            empty = parent / "empty.png"
            empty.touch()
            too_large = parent / "large.png"
            too_large.write_bytes(b"x" * (fixture_observer.MAX_BYTES + 1))
            for filename, reason in [(parent, "NOT_A_REGULAR_FILE"), (empty, "FILE_SIZE_OUTSIDE_BOUND"),
                                     (too_large, "FILE_SIZE_OUTSIDE_BOUND")]:
                with patch.object(fixture_observer.os, "open") as opened:
                    result = fixture_observer.observe_fixture(filename)
                opened.assert_not_called()
                self.assertEqual(result["status"], "NOT_READ")
                self.assertEqual(result["reason"], reason)
                self.assertEqual(result["bytesRead"], 0)
                self.assertFalse(result["descriptorOpened"])
            with patch.object(fixture_observer.os, "open") as opened:
                missing = fixture_observer.observe_fixture(parent / "missing.png")
            opened.assert_not_called()
            self.assertEqual(missing["error"]["stage"], "path-metadata")
            self.assertEqual(missing["error"]["code"], "ENOENT")

    def test_host_fixture_preserves_open_read_identity_and_close_error_observations(self):
        with TemporaryDirectory() as directory:
            filename = Path(directory) / "owned.png"
            filename.write_bytes(b"owned fixture")
            with patch.object(fixture_observer.os, "open", side_effect=PermissionError(errno.EACCES, "Owned denial")):
                denied = fixture_observer.observe_fixture(filename)
            self.assertEqual((denied["status"], denied["error"]["stage"], denied["error"]["code"]), ("ERROR", "open", "EACCES"))
            self.assertFalse(denied["descriptorOpened"])
            close = os.close
            with patch.object(fixture_observer.os, "read", side_effect=OSError(errno.EIO, "Owned read failure")), \
                    patch.object(fixture_observer.os, "close", wraps=close) as closed:
                unreadable = fixture_observer.observe_fixture(filename)
            closed.assert_called_once()
            self.assertEqual((unreadable["status"], unreadable["error"]["stage"], unreadable["error"]["code"]), ("ERROR", "read", "EIO"))
            self.assertTrue(unreadable["descriptorClosed"])
            original = filename.lstat()
            changed = types.SimpleNamespace(**{key: getattr(original, key) for key in (
                "st_mode", "st_uid", "st_gid", "st_dev", "st_ino", "st_nlink", "st_size", "st_mtime_ns", "st_ctime_ns")})
            changed.st_size += 1
            with patch.object(fixture_observer.os, "fstat", side_effect=[original, changed]):
                moved = fixture_observer.observe_fixture(filename)
            self.assertEqual(moved["status"], "CHANGED")
            self.assertFalse(moved["stableIdentityAndMetadata"])
            self.assertNotIn("sha256", moved)
            self.assertTrue(moved["descriptorClosed"])

            def close_then_error(descriptor):
                close(descriptor)
                raise OSError(errno.EIO, "Owned uncertain close")

            with patch.object(fixture_observer.os, "close", side_effect=close_then_error) as closed:
                uncertain = fixture_observer.observe_fixture(filename)
            closed.assert_called_once()
            self.assertEqual(uncertain["status"], "ERROR")
            self.assertEqual(uncertain["closeError"]["code"], "EIO")
            self.assertFalse(uncertain["descriptorClosed"])
            self.assertEqual(filename.read_bytes(), b"owned fixture")

    def test_host_fixture_bounds_growing_file_reads_and_ancestor_inventory(self):
        with TemporaryDirectory() as directory:
            parent = Path(directory)
            for _ in range(fixture_observer.MAX_ANCESTORS + 2):
                parent /= "d"
                parent.mkdir()
            filename = parent / "owned.png"
            filename.write_bytes(b"tiny")
            requests = []

            def growing_file(_descriptor, count):
                requests.append(count)
                return b"x" * count

            with patch.object(fixture_observer.os, "read", side_effect=growing_file):
                result = fixture_observer.observe_fixture(filename)
            self.assertEqual(result["status"], "CHANGED")
            self.assertEqual(result["reason"], "READ_EXCEEDED_BYTE_BOUND")
            self.assertEqual(result["bytesRead"], fixture_observer.MAX_BYTES + 1)
            self.assertEqual(sum(requests), fixture_observer.MAX_BYTES + 1)
            self.assertTrue(all(0 < count <= fixture_observer.READ_CHUNK for count in requests))
            self.assertEqual(len(result["ancestors"]), fixture_observer.MAX_ANCESTORS)
            self.assertTrue(result["ancestorsTruncated"])
            self.assertTrue(result["descriptorClosed"])
            self.assertEqual(filename.read_bytes(), b"tiny")

    def test_host_diagnostic_errors_cannot_replace_original_upload_failure_or_success(self):
        for succeeds in (False, True):
            case = runner.SafariSpreadsheetBrowserTests("test_file_upload_source_links_and_unavailable_ocr")
            case.input_evidence = []
            element = Mock()
            element.is_enabled.return_value = True
            case.element = Mock(return_value=element)
            case.click = Mock()
            case.text_contains = Mock(side_effect=[None, None if succeeds else RuntimeError("Original upload assertion")])
            case.api = Mock(return_value={"project": {"sources": [{"id": "owned-source"}]}})
            case.page_state = Mock(return_value={"phase": "owned"})
            case.driver = types.SimpleNamespace(execute_script=Mock(side_effect=[None, {"events": [], "overflow": False}]),
                execute_async_script=Mock(return_value={"status": "ERROR", "originalExceptionCaptured": False}))
            with patch.object(product_harness, "observe_fixture", side_effect=RuntimeError("Owned observer failure")) as observe:
                if succeeds:
                    self.assertEqual(case.upload_source({"id": "owned-project"}), {"id": "owned-source"})
                    case.driver.execute_async_script.assert_not_called()
                else:
                    with self.assertRaisesRegex(RuntimeError, "Original upload assertion"):
                        case.upload_source({"id": "owned-project"})
                    case.api.assert_not_called()
                self.assertEqual(observe.call_count, 2)
                self.assertTrue(all(call.args == (product_harness.IMAGE,) for call in observe.call_args_list))
            element.send_keys.assert_called_once_with(str(product_harness.IMAGE))
            case.click.assert_called_once_with("#upload-source")
            self.assertEqual(case.text_contains.call_args_list[-1].args, ("#source-status", "Source image saved"))
            observation = case.input_evidence[0]
            self.assertEqual(observation["hostFixtureBeforeError"], "RuntimeError")
            self.assertEqual(observation["hostFixtureAfterError"], "RuntimeError")
            self.assertEqual(observation["status"], "OBSERVED" if succeeds else "ATTEMPTED")

    def test_upload_policy_listener_is_bounded_passive_and_omits_uris_policy_text_and_samples(self):
        script = r"""
            const vm = require('node:vm');
            const input = JSON.parse(require('node:fs').readFileSync(0, 'utf8'));
            const bindings = [], removals = [], listeners = new Map();
            function target(id) {
                return {id,
                    addEventListener(type, fn, options) { const key = id + ':' + type; listeners.set(key, fn); bindings.push({key, options}); },
                    removeEventListener(type, fn, options) { const key = id + ':' + type;
                        if (listeners.get(key) !== fn) throw new Error('Wrong observer removed');
                        listeners.delete(key); removals.push({key, options}); }};
            }
            const file = target('panel-image'), button = target('upload-source'), window = target('window');
            Object.defineProperty(file, 'value', {set() { throw new Error('No file value assignment permitted'); }});
            const context = {window, document: {querySelector(selector) {
                if (selector !== '#upload-source') throw new Error('Unexpected DOM query'); return button;
            }}, arguments: [file]};
            vm.runInNewContext('(function(){' + input.begin + '\n}).apply(null, arguments)', context, {timeout: 1000});
            for (const [key, type, target] of [['panel-image:input', 'input', file], ['panel-image:change', 'change', file], ['upload-source:click', 'click', button]])
                listeners.get(key)({type, target, isTrusted: true});
            for (let index = 0; index < 18; index++) {
                const event = {type: 'securitypolicyviolation', isTrusted: index !== 0,
                    effectiveDirective: index === 0 ? 'img-src https://SECRET_POLICY_URI' : 'img-src',
                    violatedDirective: index === 0 ? 'https://SECRET_DIRECTIVE_URI' : 'img-src',
                    disposition: index === 0 ? 'report SECRET_DISPOSITION_TEXT' : 'enforce',
                    blockedURI: 'data:image/png;base64,SECRET_FILE_BYTES', sourceFile: 'file:///private/SECRET_FILE_PATH',
                    statusCode: 200, lineNumber: 17, columnNumber: 3,
                    preventDefault() { throw new Error('No event cancellation permitted'); },
                    stopPropagation() { throw new Error('No event interference permitted'); }};
                for (const key of ['sample', 'originalPolicy']) Object.defineProperty(event, key, {get() { throw new Error('Sensitive policy field read'); }});
                listeners.get('window:securitypolicyviolation')(event);
            }
            context.arguments = [];
            const result = vm.runInNewContext('(function(){' + input.end + '\n}).apply(null, arguments)', context, {timeout: 1000});
            process.stdout.write(JSON.stringify({result, bindings, removals, listenersRemaining: listeners.size,
                probeRemoved: !Object.hasOwn(window, '__panelreplyNativeUploadProbe')}));
        """
        result = subprocess.run(["node", "-e", script], input=json.dumps({"begin": UPLOAD_EVENT_DIAGNOSTIC_BEGIN, "end": UPLOAD_EVENT_DIAGNOSTIC_END}),
                                text=True, capture_output=True, timeout=10, check=True)
        value = json.loads(result.stdout)
        report = value["result"]
        self.assertEqual([item["type"] for item in report["events"]], ["input", "change", "click"])
        self.assertTrue(all(item["trusted"] for item in report["events"]))
        self.assertEqual(len(report["policyEvents"]), 16)
        self.assertTrue(report["policyOverflow"])
        self.assertFalse(report["policyEvents"][0]["trusted"])
        self.assertEqual({item["blockedResourceKind"] for item in report["policyEvents"]}, {"data"})
        self.assertEqual({item["sourceResourceKind"] for item in report["policyEvents"]}, {"file"})
        self.assertEqual(report["policyEvents"][0]["effectiveDirective"], "UNKNOWN")
        self.assertEqual(report["policyEvents"][0]["violatedDirective"], "UNKNOWN")
        self.assertEqual(report["policyEvents"][0]["disposition"], "UNKNOWN")
        self.assertTrue(all(item["effectiveDirective"] == "img-src" and item["violatedDirective"] == "img-src"
                            and item["disposition"] == "enforce" for item in report["policyEvents"][1:]))
        policy_binding = next(item for item in value["bindings"] if item["key"] == "window:securitypolicyviolation")
        self.assertEqual(policy_binding["options"], {"capture": True, "passive": True})
        self.assertEqual(value["listenersRemaining"], 0)
        self.assertTrue(value["probeRemoved"])
        self.assertEqual(len(value["bindings"]), len(value["removals"]))
        self.assertNotIn("SECRET_FILE_BYTES", result.stdout)
        self.assertNotIn("SECRET_FILE_PATH", result.stdout)
        self.assertNotIn("SECRET_POLICY_URI", result.stdout)
        self.assertNotIn("SECRET_DIRECTIVE_URI", result.stdout)
        self.assertNotIn("SECRET_DISPOSITION_TEXT", result.stdout)
        self.assertFalse(report["policyObservation"]["originalBrowserExceptionCaptured"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
