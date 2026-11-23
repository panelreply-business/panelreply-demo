"""Native Safari evidence-harness checks, never product-goal executions.

No driver, browser, server, network or Safari is started. The outcome tests use
in-memory doubles and temporary reports to verify fail-closed accounting. One
metadata check reads the existing product definitions through the local Node
runtime. Keyboard doubles verify harness behavior, never native date entry.
"""

import contextlib
import io
import json
import copy
from pathlib import Path
import subprocess
from tempfile import TemporaryDirectory
import types
import unittest
from unittest.mock import Mock, patch

import release_safari_runner as runner
from safari_product_browser_test import select_keyboard_plan


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
                   send_error=None, observation_error=None, control=None):
    """No browser is launched. Doubles validate fail-closed evidence handling."""
    case = runner.SafariSpreadsheetBrowserTests("test_manual_corrections_persist_and_native_downloads_match")
    case.input_evidence = []
    case.native = types.SimpleNamespace(keys=types.SimpleNamespace(TAB="TAB"), select_type=Mock())
    case.wait = types.SimpleNamespace(until=lambda predicate: predicate(None))
    element = Mock()
    element.is_enabled.return_value = True
    element.get_property.return_value = "unreviewed"
    element.send_keys.side_effect = send_error
    case.element = Mock(return_value=element)
    events = [{"type": kind, "key": "r", "trusted": True, "value": "unreviewed"}
              for kind in ("keydown", "keyup")]
    events.extend({"type": kind, "key": None, "trusted": not untrusted, "value": "reviewed"}
                  for kind in (("input",) if missing_change else ("input", "change")))
    trace = {"events": events, "overflow": False, "observedValue": observed, "activeElementId": None}
    case.driver = types.SimpleNamespace(execute_script=Mock(
        side_effect=[copy.deepcopy(control or SELECT_CONTROL), None, observation_error or trace]))
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
            self.assertEqual(case.input_evidence[0]["status"], "ATTEMPTED")

    def test_native_select_requires_trusted_change_and_preserves_application_rejection(self):
        for observed, expected in [("reviewed", None), ("unreviewed", "unreviewed")]:
            case, element = select_harness(observed=observed)
            case.select("#review", "reviewed", expected=expected)
            element.send_keys.assert_called_once_with("r", "TAB")
            case.native.select_type.assert_not_called()
            self.assertEqual(case.input_evidence[0]["status"], "OBSERVED")
            self.assertEqual(case.input_evidence[0]["observedValue"], observed)
        for options in [{"observed": "unreviewed"}, {"untrusted": True}, {"missing_change": True}]:
            case, element = select_harness(**options)
            with self.assertRaises(AssertionError):
                case.select("#review", "reviewed")
            element.send_keys.assert_called_once_with("r", "TAB")
            self.assertEqual(case.input_evidence[0]["status"], "ATTEMPTED")

    def test_select_transport_failure_keeps_trace_without_diagnostic_error_replacing_it(self):
        for observation_error in [None, RuntimeError("Synthetic observer failure")]:
            original = RuntimeError("Synthetic native input transport failure")
            case, element = select_harness(send_error=original, observation_error=observation_error)
            with self.assertRaisesRegex(RuntimeError, "Synthetic native input transport failure"):
                case.select("#review", "reviewed")
            element.send_keys.assert_called_once()
            self.assertEqual(case.input_evidence[0]["status"], "ATTEMPTED")
            if observation_error is not None:
                self.assertIn("Synthetic observer failure", case.input_evidence[0]["observationError"])
            else:
                self.assertTrue(case.input_evidence[0]["events"])

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
            "events": [{"type": "click", "targetId": "upload-source", "trusted": True}], "overflow": False}]))
        with self.assertRaisesRegex(RuntimeError, "Synthetic upload did not save"):
            case.upload_source({"id": "synthetic-project"})
        element.send_keys.assert_called_once()
        self.assertTrue(element.send_keys.call_args.args[0].endswith("/tests/fixtures/panels/complete.png"))
        case.click.assert_called_once_with("#upload-source")
        self.assertEqual(case.text_contains.call_args_list[-1].args, ("#source-status", "Source image saved"))
        case.api.assert_not_called()
        observation = case.input_evidence[0]
        self.assertEqual((observation["status"], observation["finalState"]), ("ATTEMPTED", {"phase": "failed"}))
        self.assertEqual(observation["events"][0]["trusted"], True)

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


if __name__ == "__main__":
    unittest.main(verbosity=2)
