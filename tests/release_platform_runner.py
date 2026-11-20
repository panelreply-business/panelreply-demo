"""Record actual unittest executions without counting assertions or reruns.

The portable suite serves copied static files on loopback. Its results do not
establish Windows/macOS support for the private Linux SQLite/OCR server. The
mobile suite uses the private Linux server with emulated browser contexts, not
physical iOS/Android devices. All test data is synthetic and external browser
requests remain blocked by the existing test harnesses.
"""

import argparse
import importlib
import importlib.metadata
import json
import os
from pathlib import Path
import platform
import subprocess
import sys
import time
import unittest

from browser_engine import browser_evidence


ROOT = Path(__file__).resolve().parent.parent
SUITES = {
    "portable": ["browser_test", "intake_browser_test", "ui_browser_test", "design_browser_test"],
    "portable-extra": ["browser_test", "intake_browser_test", "ui_browser_test"],
    "baseline": ["browser_test", "intake_browser_test", "ui_browser_test", "workspace_browser_test",
                 "workspace_recovery_browser_test", "design_browser_test", "panel_browser_test",
                 "platform_visual_browser_test", "assistant_browser_test", "lifecycle_browser_test",
                 "xlsx_browser_test"],
    "private": ["design_browser_test", "workspace_browser_test", "panel_browser_test",
                "workspace_recovery_browser_test", "platform_visual_browser_test",
                "assistant_browser_test", "xlsx_browser_test", "lifecycle_browser_test"],
    "mobile": ["release_mobile_browser_test"],
    "callback": ["product_browser_test"],
    "spreadsheet": ["product_browser_test"],
}
SELECTED_PRODUCT_CLASSES = {"callback": "CallbackProductBrowserTests", "spreadsheet": "SpreadsheetProductBrowserTests"}
CLASSES = {
    "browser_test": "DemoBrowserTests", "intake_browser_test": "IntakeBrowserTests",
    "ui_browser_test": "WorkspaceBrowserTests", "design_browser_test": "DesignBrowserTests",
    "workspace_browser_test": "PrivateWorkspaceBrowserTests",
    "workspace_recovery_browser_test": "WorkspaceRecoveryBrowserTests",
    "panel_browser_test": "PanelWorkspaceBrowserTests", "platform_visual_browser_test": "PlatformVisualTests",
    "assistant_browser_test": "AssistantBrowserTests", "lifecycle_browser_test": "LifecycleBrowserTests",
    "xlsx_browser_test": "XlsxBrowserTests", "release_mobile_browser_test": "MobileWorkspaceTests",
}


def command(*args):
    result = subprocess.run(args, cwd=ROOT, text=True, capture_output=True,
                            timeout=20, check=False)
    if result.returncode:
        raise RuntimeError(f"Provenance command failed: {args[0]}")
    return result.stdout.strip()


def source_evidence():
    # One implementation hashes both Node and Python inputs, including binary
    # fixtures. A second hashing algorithm would make cross-OS evidence differ.
    evidence = json.loads(command("node", "scripts/test-evidence.cjs", "--source"))
    required = {"sourceCommit", "gitTreeHash", "dirty", "workingTreeStatus", "sourceManifest", "sourceTreeSha256"}
    if not isinstance(evidence, dict) or not required.issubset(evidence):
        raise RuntimeError("Shared source evidence is incomplete")
    return evidence


def flatten(suite):
    for item in suite:
        if isinstance(item, unittest.TestSuite):
            yield from flatten(item)
        else:
            yield item


def browser_variant():
    return os.environ.get("PANELREPLY_BROWSER_CHANNEL") or (
        "explicit-executable" if os.environ.get("PANELREPLY_CHROMIUM_EXECUTABLE") else "bundled")


def platform_key(profile="desktop"):
    return "/".join((platform.system().lower(), platform.machine().lower(),
                     os.environ.get("PANELREPLY_BROWSER", "chromium"),
                     browser_variant(), profile))


def product_scope(test):
    method = getattr(test, test._testMethodName)
    explicit = getattr(method, "product_scope", getattr(test, "product_scope", None))
    if explicit in {"callback", "spreadsheet", "shared"}:
        return explicit
    module = type(test).__module__
    name = test._testMethodName
    if module in {"browser_test", "intake_browser_test", "ui_browser_test", "assistant_browser_test"}:
        return "callback"
    if module == "xlsx_browser_test":
        return "spreadsheet"
    if module == "panel_browser_test":
        return "shared" if "dashboard" in name or "workspace_cannot_mix" in name else "spreadsheet"
    if module == "platform_visual_browser_test" and name.startswith("test_panel"):
        return "spreadsheet"
    if module == "lifecycle_browser_test":
        if "request_deletion" in name or "conversation_deletion" in name:
            return "callback"
        if "source_delete" in name:
            return "spreadsheet"
    if module == "workspace_browser_test" and any(word in name for word in (
            "request", "profile", "question", "hazard", "stop", "conversation", "customer", "appointment")):
        return "callback"
    return "shared"


class EvidenceResult(unittest.TextTestResult):
    """One record per unittest method; failing subtests affect their parent."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.records = {}
        self.infrastructure_errors = []
        self.started = {}

    def startTest(self, test):
        super().startTest(test)
        identifier = test.id()
        if identifier in self.records:
            raise RuntimeError("Duplicate test method in one platform run: " + identifier)
        self.started[identifier] = time.monotonic()
        method = getattr(test, test._testMethodName)
        profile = getattr(method, "device_profile_id", "desktop")
        self.records[identifier] = {"id": identifier, "platformKey": platform_key(profile),
                                    "productScope": product_scope(test),
                                    "profile": profile, "emulated": profile != "desktop",
                                    "emulatedDevice": getattr(method, "device_name", None),
                                    "status": "RUNNING", "durationMs": 0}

    def outcome(self, test, status, detail=None):
        identifier = test.id()
        record = self.records.get(identifier)
        if record is None:
            self.infrastructure_errors.append({"id": identifier, "status": status,
                                               "diagnostic": detail})
            return
        severity = {"RUNNING": 0, "PASS": 1, "SKIP": 2, "EXPECTED_FAILURE": 2,
                    "UNEXPECTED_SUCCESS": 3, "FAIL": 4, "ERROR": 5}
        if severity[status] >= severity[record["status"]]:
            record["status"] = status
        if detail:
            record.setdefault("diagnostics", []).append(detail[:8000])

    def addSuccess(self, test):
        super().addSuccess(test)
        self.outcome(test, "PASS")

    def addFailure(self, test, err):
        super().addFailure(test, err)
        self.outcome(test, "FAIL", self._exc_info_to_string(err, test))

    def addError(self, test, err):
        super().addError(test, err)
        self.outcome(test, "ERROR", self._exc_info_to_string(err, test))
        message = str(err[1])
        if test.id() not in self.records and err[0].__module__.startswith("playwright.") and \
                "BrowserType.launch" in message and any(reason in message for reason in
                    ["Executable doesn't exist", "Operation not permitted"]):
            self.infrastructure_errors[-1]["classification"] = "BROWSER_RUNTIME_UNAVAILABLE"

    def addSkip(self, test, reason):
        super().addSkip(test, reason)
        self.outcome(test, "SKIP", reason)

    def addExpectedFailure(self, test, err):
        super().addExpectedFailure(test, err)
        self.outcome(test, "EXPECTED_FAILURE", self._exc_info_to_string(err, test))

    def addUnexpectedSuccess(self, test):
        super().addUnexpectedSuccess(test)
        self.outcome(test, "UNEXPECTED_SUCCESS")

    def addSubTest(self, test, subtest, err):
        super().addSubTest(test, subtest, err)
        if err is not None:
            status = "FAIL" if issubclass(err[0], test.failureException) else "ERROR"
            self.outcome(test, status, subtest.id() + "\n" + self._exc_info_to_string(err, test))

    def stopTest(self, test):
        identifier = test.id()
        self.records[identifier]["durationMs"] = round((time.monotonic() - self.started[identifier]) * 1000, 3)
        if hasattr(test, "descriptor"):
            self.records[identifier]["emulation"] = test.descriptor
        super().stopTest(test)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--suite", choices=SUITES, required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--list", action="store_true", help="Collect method IDs only; no pass results")
    args = parser.parse_args()
    suite = unittest.TestSuite()
    for name in SUITES[args.suite]:
        module = importlib.import_module(name)
        class_name = SELECTED_PRODUCT_CLASSES[args.suite] if name == "product_browser_test" else CLASSES[name]
        cls = getattr(module, class_name)
        # Match each existing script's selected methods. Imported base classes
        # and inherited test methods must not inflate suite coverage.
        methods = sorted(method for method in cls.__dict__ if method.startswith("test_"))
        suite.addTests(cls(method) for method in methods)
    expected = list(flatten(suite))
    identifiers = [test.id() for test in expected]
    if not identifiers or len(identifiers) != len(set(identifiers)):
        raise RuntimeError("The selected suite has zero methods or duplicate method IDs")
    output = Path(args.output).resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    profiles = {getattr(getattr(test, test._testMethodName), "device_profile_id", "desktop"):
                getattr(getattr(test, test._testMethodName), "device_name", None) for test in expected}
    if args.list:
        output.write_text(json.dumps({"suite": args.suite, "status": "COLLECTED_ONLY",
                                      "ids": identifiers, "expectedProfiles": profiles}, indent=2) + "\n", encoding="utf-8")
        print(f"Collected {len(identifiers)} methods. No tests executed.")
        return 0
    source = source_evidence()
    started = time.monotonic()
    result = unittest.TextTestRunner(verbosity=2, resultclass=EvidenceResult).run(suite)
    records = []
    for test in expected:
        method = getattr(test, test._testMethodName)
        profile = getattr(method, "device_profile_id", "desktop")
        records.append(result.records.get(test.id(), {
            "id": test.id(), "platformKey": platform_key(profile), "profile": profile,
            "productScope": product_scope(test),
            "emulated": profile != "desktop", "emulatedDevice": getattr(method, "device_name", None),
            "status": "NOT_RUN", "durationMs": 0,
        }))
    totals = {label: sum(item["status"] == status for item in records) for label, status in {
        "passed": "PASS", "failed": "FAIL", "errors": "ERROR", "skipped": "SKIP",
        "expectedFailures": "EXPECTED_FAILURE", "unexpectedSuccesses": "UNEXPECTED_SUCCESS",
        "notRun": "NOT_RUN", "incomplete": "RUNNING",
    }.items()}
    after = source_evidence()
    source_changed = after["sourceTreeSha256"] != source["sourceTreeSha256"] or after["sourceCommit"] != source["sourceCommit"]
    passed = totals["passed"] == len(expected) and not result.infrastructure_errors and not source_changed
    blocked = not result.records and bool(result.infrastructure_errors) and all(
        item.get("classification") == "BROWSER_RUNTIME_UNAVAILABLE" for item in result.infrastructure_errors)
    report = {
        "format": "panelreply-platform-evidence-v1", "suite": args.suite, **source,
        "deploymentMode": args.suite if args.suite in SELECTED_PRODUCT_CLASSES else
                          "combined" if args.suite in {"baseline", "private", "mobile"} else "static-demo",
        "status": "PASS" if passed else "BLOCKED" if blocked else "FAIL", "expectedMethods": len(expected),
        "expectedProfiles": profiles,
        "sourceChangedDuringRun": source_changed,
        "sourceTreeSha256After": after["sourceTreeSha256"],
        "durationMs": round((time.monotonic() - started) * 1000, 3),
        "platform": {"os": platform.system(), "release": platform.release(),
                     "architecture": platform.machine(), "python": platform.python_version(),
                     "node": command("node", "--version"),
                     "playwright": importlib.metadata.version("playwright"),
                     "browserEngine": os.environ.get("PANELREPLY_BROWSER", "chromium"),
                     "browserChannel": browser_variant(),
                     "observedBrowsers": browser_evidence(),
                     "emulated": args.suite == "mobile"},
        "tests": records, "totals": totals,
        "infrastructureErrors": result.infrastructure_errors,
        "blocked": ["Browser runtime unavailable; no browser cases executed."] if blocked else [],
        "scope": "Private Linux server with emulated device contexts; no physical device evidence."
                 if args.suite == "mobile" else
                 f"Selected {args.suite} program on its fixed entrypoint and product-bound synthetic data; desktop engine only."
                 if args.suite in SELECTED_PRODUCT_CLASSES else
                 "Private Linux workflow integration; desktop engine only, no physical device evidence."
                 if args.suite in {"baseline", "private"} else
                 "Portable static/client UI on this OS/browser; no Windows/macOS private server or native OCR claim.",
        "counting": "One method per OS/architecture/browser/channel/device-profile. Subtests and assertions are not extra cases. Reruns of an identical key do not add coverage.",
    }
    output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print("PANELREPLY_PLATFORM_RESULT=" + json.dumps({"output": str(output), "status": report["status"],
          "suite": args.suite, "totals": totals, "infrastructureErrors": len(result.infrastructure_errors)}))
    return 0 if passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
