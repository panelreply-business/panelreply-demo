"""Source-bound native Safari evidence for six independent product journeys.

No Playwright browser is started. One ordinary-user /usr/bin/safaridriver
session runs both fixed products sequentially. This runner never enables
automation, changes preferences, starts a simulator or retries an unavailable
driver. A failed preflight writes every planned method as NOT_RUN.
"""

import argparse
import hashlib
import importlib.metadata
import json
from pathlib import Path
import platform
import plistlib
import re
import subprocess
import sys
import time
import traceback
import unittest

# Reuse only the source-manifest and unittest outcome accounting. Its
# Playwright browser factory and suite loader are never invoked here.
from release_platform_runner import EvidenceResult, source_evidence, command
from safari_product_browser_test import SafariCallbackBrowserTests, SafariSpreadsheetBrowserTests


ROOT = Path(__file__).resolve().parent.parent
DRIVER = Path("/usr/bin/safaridriver")
SAFARI = Path("/Applications/Safari.app")
SELENIUM_VERSION = "4.54.0"
SUITES = {
    "callback-safari": SafariCallbackBrowserTests,
    "spreadsheet-manual-safari": SafariSpreadsheetBrowserTests,
}
METHODS = {
    "callback-safari": (
        "test_contact_hold_and_keyboard_dirty_edit_guard",
        "test_intake_status_persistence_and_sign_out",
        "test_schedule_reschedule_outcome_follow_up_and_cancel",
    ),
    "spreadsheet-manual-safari": (
        "test_bound_recovery_revokes_archived_sessions_and_credentials",
        "test_file_upload_source_links_and_unavailable_ocr",
        "test_manual_corrections_persist_and_native_downloads_match",
    ),
}


class SafariUnavailable(RuntimeError):
    pass


def driver_identity_matches(output, version, build):
    # GitHub's image report reads complete version/build tokens from the
    # installed command, e.g. Included with Safari 26.6 (20624.4.5.18.1).
    parsed = re.fullmatch(r"Included with Safari (\S+) \(([^()\s]+)\)", output)
    return parsed is not None and parsed.group(1) == version and parsed.group(2) == build


def session_identity_matches(session, installation, session_id):
    host = installation["host"]
    return isinstance(session_id, str) and bool(session_id) \
        and str(session.get("browserName", "")).lower() == "safari" \
        and session.get("browserVersion") == installation["browser"]["version"] \
        and str(session.get("platformName", "")).lower() in {"mac", "macos"} \
        and session.get("safari:useSimulator", False) is False \
        and all(key not in session or session[key] == host[host_key] for key, host_key in (
            ("safari:platformVersion", "osVersion"), ("safari:platformBuildVersion", "osBuild")))


def desktop_request_matches(requested, version):
    # macOS rejects safari:useSimulator even when false. platformName='mac'
    # selects the desktop host without sending any iOS-only capabilities.
    return requested == {"browserName": "safari", "platformName": "mac",
                         "pageLoadStrategy": "normal", "browserVersion": version}


def sha256_file(filename):
    result = hashlib.sha256()
    with filename.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            result.update(chunk)
    return result.hexdigest()


def installation_evidence():
    if platform.system() != "Darwin" or platform.machine().lower() != "x86_64":
        raise SafariUnavailable("This scope requires an actual Darwin x86_64 process")
    if not DRIVER.is_file():
        raise SafariUnavailable("The installed /usr/bin/safaridriver is absent")
    info_file = SAFARI / "Contents" / "Info.plist"
    info = plistlib.loads(info_file.read_bytes())
    version, build, bundle = (info.get(key) for key in (
        "CFBundleShortVersionString", "CFBundleVersion", "CFBundleIdentifier"))
    if bundle != "com.apple.Safari" or not all(isinstance(value, str) and value for value in (version, build)):
        raise RuntimeError("The installed app is not the expected release Safari bundle")
    executable_name = info.get("CFBundleExecutable")
    if not isinstance(executable_name, str) or not re.fullmatch(r"[A-Za-z0-9._-]+", executable_name):
        raise RuntimeError("The Safari executable metadata is invalid")
    executable = SAFARI / "Contents" / "MacOS" / executable_name
    driver_version = command(str(DRIVER), "--version")
    if not driver_identity_matches(driver_version, version, build):
        raise RuntimeError("The installed driver version does not match the Safari app bundle")
    return {
        "driver": {"path": str(DRIVER), "version": driver_version, "sha256": sha256_file(DRIVER)},
        "browser": {"path": str(SAFARI), "bundleIdentifier": bundle, "version": version,
                    "build": build, "infoPlistSha256": sha256_file(info_file),
                    "executablePath": str(executable), "executableSha256": sha256_file(executable)},
        "host": {"osVersion": command("/usr/bin/sw_vers", "-productVersion"),
                 "osBuild": command("/usr/bin/sw_vers", "-buildVersion"),
                 "architecture": platform.machine().lower()},
    }


class NativeSafari:
    def __init__(self):
        self.driver = None
        self.service = None
        self.evidence = {"format": "apple-safaridriver-v1", "state": "UNAVAILABLE",
                         "before": None, "after": None, "stable": False,
                         "session": None, "sessionSha256": None,
                         "requestedCapabilities": None, "unavailableSessionCapabilities": None}

    def start(self):
        self.evidence["before"] = installation_evidence()
        if importlib.metadata.version("selenium") != SELENIUM_VERSION:
            raise RuntimeError("The native runner requires its pinned Selenium client")
        from selenium import webdriver
        from selenium.webdriver.common.keys import Keys
        from selenium.webdriver.remote.client_config import ClientConfig
        from selenium.webdriver.remote.file_detector import UselessFileDetector
        from selenium.webdriver.remote.remote_connection import RemoteConnection
        from selenium.webdriver.safari.service import Service
        from selenium.webdriver.support.ui import WebDriverWait

        self.keys, self.wait_type = Keys, WebDriverWait
        options = webdriver.SafariOptions()
        # Preserve the pinned Selenium native default browserName='safari'.
        options.set_capability("browserVersion", self.evidence["before"]["browser"]["version"])
        self.evidence["requestedCapabilities"] = dict(options.to_capabilities())
        if not desktop_request_matches(self.evidence["requestedCapabilities"],
                                       self.evidence["before"]["browser"]["version"]):
            raise RuntimeError("The pinned client's native desktop capabilities changed")
        self.service = Service(executable_path=str(DRIVER), enable_logging=False,
                               log_output=subprocess.DEVNULL)
        if self.service.path != str(DRIVER):
            raise RuntimeError("A driver environment override cannot replace installed Safari")
        try:
            self.service.start()
            # Explicit local service and client timeout avoid Selenium Manager,
            # downloads, remote grid selection, and an unbounded session call.
            connection = RemoteConnection(client_config=ClientConfig(
                remote_server_addr=self.service.service_url, timeout=25), ignore_proxy=True)
            # The service and browser are local. Do not send file uploads to a
            # Selenium Grid extension that Apple's native driver does not own.
            self.driver = webdriver.Remote(command_executor=connection, options=options,
                                           file_detector=UselessFileDetector())
        except Exception as error:
            raise SafariUnavailable("Native Safari session could not start: " + str(error)[:2000]) from error
        caps = self.driver.capabilities
        session = {key: caps[key] for key in (
            "browserName", "browserVersion", "platformName", "safari:platformVersion",
            "safari:platformBuildVersion", "safari:useSimulator", "safari:automationVersion") if key in caps}
        if not session_identity_matches(session, self.evidence["before"], self.driver.session_id):
            raise RuntimeError("The native session does not identify the installed desktop Safari")
        self.evidence.update({"state": "OBSERVED", "session": session,
                              "sessionSha256": hashlib.sha256(self.driver.session_id.encode()).hexdigest(),
                              "unavailableSessionCapabilities": [key for key in (
                                  "safari:platformVersion", "safari:platformBuildVersion") if key not in session]})
        self.driver.set_page_load_timeout(20)
        self.driver.set_script_timeout(10)
        self.driver.set_window_rect(width=1440, height=1000)

    def finish_observation(self):
        if self.evidence["before"] is None:
            return
        self.evidence["after"] = installation_evidence()
        self.evidence["stable"] = self.evidence["before"] == self.evidence["after"]
        if not self.evidence["stable"]:
            raise RuntimeError("Installed Safari or its driver changed during the test run")

    def close(self):
        try:
            if self.driver is not None:
                self.driver.quit()
        finally:
            self.driver = None
            if self.service is not None:
                self.service.stop()


def platform_key():
    return "/".join((platform.system().lower(), platform.machine().lower(), "webkit", "safari", "desktop"))


class SafariResult(EvidenceResult):
    def startTest(self, test):
        super().startTest(test)
        self.records[test.id()].update({"platformKey": platform_key(), "productScope": test.product_id,
                                       "nativeSessionSha256": test.native.evidence["sessionSha256"]})

    def capture_failure(self, test):
        # unittest records a method failure before tearDown clears the page.
        # Keep that state without replacing its original outcome if the
        # browser is already unavailable or diagnostic collection fails.
        capture = getattr(test, "capture_failure_evidence", None)
        if capture is not None:
            try:
                capture()
            except Exception as error:
                record = self.records.get(test.id())
                if record is not None:
                    record.setdefault("diagnosticCaptureErrors", []).append(str(error)[:1000])

    def addFailure(self, test, err):
        self.capture_failure(test)
        super().addFailure(test, err)

    def addError(self, test, err):
        self.capture_failure(test)
        super().addError(test, err)

    def stopTest(self, test):
        record = self.records[test.id()]
        record["observedViewport"] = getattr(test, "viewport", None)
        record["downloadEvidence"] = getattr(test, "download_evidence", [])
        record["readbackEvidence"] = getattr(test, "readback_evidence", [])
        record["inputEvidence"] = getattr(test, "input_evidence", [])
        record["diagnosticEvidence"] = getattr(test, "diagnostic_evidence", [])
        super().stopTest(test)


def collect():
    result = {}
    for name, cls in SUITES.items():
        actual = sorted(method for method in cls.__dict__ if method.startswith("test_"))
        if actual != list(METHODS[name]):
            raise RuntimeError("The native Safari scope must contain exactly the six reviewed journeys")
        result[name] = [cls(method) for method in actual]
    return result


def missing_record(test):
    return {"id": test.id(), "status": "NOT_RUN", "durationMs": 0,
            "platformKey": platform_key(), "profile": "desktop", "emulated": False,
            "productScope": test.product_id, "nativeSessionSha256": None,
            "observedViewport": None, "downloadEvidence": [], "readbackEvidence": [], "inputEvidence": [],
            "diagnosticEvidence": []}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--list", action="store_true")
    args = parser.parse_args()
    output = Path(args.output_dir).resolve()
    output.mkdir(parents=True, exist_ok=True)
    suites = collect()
    if args.list:
        collected = {name: [test.id() for test in tests] for name, tests in suites.items()}
        (output / "collected.json").write_text(json.dumps({"status": "COLLECTED_ONLY", "suites": collected}, indent=2) + "\n")
        print("Collected six native Safari methods. No browser or product cases executed.")
        return 0
    source = source_evidence()
    started = time.monotonic()
    native = NativeSafari()
    results = {}
    infrastructure = []
    try:
        native.start()
        for name, tests in suites.items():
            SUITES[name].native = native
            results[name] = unittest.TextTestRunner(verbosity=2, resultclass=SafariResult).run(unittest.TestSuite(tests))
    except Exception as error:
        infrastructure.append({"id": "native-safari-session", "status": "ERROR",
                               "classification": "NATIVE_SAFARI_UNAVAILABLE" if isinstance(error, SafariUnavailable) else "NATIVE_SAFARI_IDENTITY_ERROR",
                               "diagnostic": traceback.format_exc()[-6000:]})
    finally:
        for action, name in [(native.finish_observation, "native-safari-final-identity"),
                             (native.close, "native-safari-cleanup")]:
            try:
                action()
            except Exception:
                infrastructure.append({"id": name, "status": "ERROR", "diagnostic": traceback.format_exc()[-4000:]})
    after = source_evidence()
    source_changed = source["sourceTreeSha256"] != after["sourceTreeSha256"] or source["sourceCommit"] != after["sourceCommit"]
    observed = [] if native.evidence["state"] != "OBSERVED" else [{
        "engine": "webkit", "channel": "safari", "version": native.evidence["session"]["browserVersion"]}]
    try:
        client_version = importlib.metadata.version("selenium")
    except importlib.metadata.PackageNotFoundError:
        client_version = None
    all_pass = True
    for name, tests in suites.items():
        result = results.get(name)
        records = [result.records.get(test.id(), missing_record(test)) if result else missing_record(test) for test in tests]
        errors = [*infrastructure, *(result.infrastructure_errors if result else [])]
        passed = all(item["status"] == "PASS" for item in records) and not errors and not source_changed \
            and native.evidence["state"] == "OBSERVED" and native.evidence["stable"] is True
        blocked = all(item["status"] == "NOT_RUN" for item in records) and bool(errors) and all(
            item.get("classification") == "NATIVE_SAFARI_UNAVAILABLE" for item in errors)
        totals = {status: sum(item["status"] == status for item in records)
                  for status in ["PASS", "FAIL", "ERROR", "NOT_RUN", "SKIP", "RUNNING"]}
        report = {
            "format": "panelreply-platform-evidence-v1", **source, "suite": name,
            "deploymentMode": SUITES[name].product_id,
            "status": "PASS" if passed else "BLOCKED" if blocked else "FAIL",
            "expectedMethods": len(tests), "sourceChangedDuringRun": source_changed,
            "sourceTreeSha256After": after["sourceTreeSha256"],
            "durationMs": round((time.monotonic() - started) * 1000, 3),
            "platform": {"os": platform.system(), "release": platform.release(),
                         "architecture": platform.machine(), "python": platform.python_version(),
                         "node": command("node", "--version"), "selenium": client_version,
                         "browserEngine": "webkit", "browserChannel": "safari", "emulated": False,
                         "observedBrowsers": observed, "nativeSafari": native.evidence},
            "tests": records, "totals": totals, "infrastructureErrors": errors,
            "scope": "Fixed " + SUITES[name].product_id + " program, installed release Safari on Intel macOS. Synthetic desktop data only. Spreadsheet extraction is unavailable and asserted fail-closed.",
            "limitations": ["No physical device, simulator, 320px or bundled WebKit coverage.",
                            "No Playwright-equivalent network interception or complete console observation.",
                            "API readbacks do not prove a native browser download. Each claimed download requires a newly observed UUID-named file with the exact saved bytes."],
            "counting": "One method per fixed product and actual Safari desktop platform. Six methods total. No assertion, setup, fixture, retry or harness credit.",
        }
        filename = output / (name + ".json")
        filename.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
        print("PANELREPLY_SAFARI_RESULT=" + json.dumps({"output": str(filename), "status": report["status"],
                                                       "suite": name, "totals": totals}))
        all_pass = all_pass and passed
    return 0 if all_pass else 1


if __name__ == "__main__":
    raise SystemExit(main())
