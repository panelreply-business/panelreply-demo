"""Native Safari evidence-harness checks, never product-goal executions.

No driver, browser, server, network or Safari is started. The outcome tests use
in-memory doubles and temporary reports to verify fail-closed accounting.
"""

import contextlib
import io
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import types
import unittest
from unittest.mock import patch

import release_safari_runner as runner


SOURCE = {"sourceCommit": "a" * 40, "gitTreeHash": "b" * 40, "dirty": True,
          "workingTreeStatus": ["synthetic harness fixture"], "sourceManifest": [],
          "sourceTreeSha256": "c" * 64}


class SafariRunnerHarnessTests(unittest.TestCase):
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
