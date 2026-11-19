"""Real-browser export and recovery drills, run only in CI.

Every account and request is a synthetic fixture in a temporary database.
The browser allows only the explicitly started loopback servers. No provider,
public deployment, customer contact or real credential is used.
"""

from pathlib import Path
from tempfile import TemporaryDirectory
from urllib.error import HTTPError, URLError
from urllib.request import HTTPRedirectHandler, build_opener
import base64
import json
import os
import re
import socket
import subprocess
import time
import unittest
import uuid

from playwright.sync_api import expect, sync_playwright
from browser_engine import launch_browser


ROOT = Path(__file__).resolve().parent.parent
PASSWORD = "Synthetic recovery browser password 2026!"
NEW_PASSWORD = "Replacement synthetic password 2026!"
OTHER_NEW_PASSWORD = "Second replacement synthetic password 2026!"
BACKUP_PASSPHRASE = "Synthetic archive passphrase 2026!"
OWNER = "recovery-owner@example.test"
LEAD = {
    "customerName": "Jamie Recovery",
    "phone": "+15865550101",
    "job": "Install a garage EV charger",
    "zip": "48315",
    "callbackWindow": "Monday after 4 pm",
    "requestedWorkDate": "Friday",
    "contactPermission": "requested_callback",
    "conversation": [
        {"role": "customer", "text": "Please call me about an EV charger."},
        {"role": "assistant", "text": "No appointment is booked."},
    ],
}


class RefuseRedirects(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class WorkspaceRecoveryBrowserTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.playwright = sync_playwright().start()
        cls.browser = launch_browser(cls.playwright)

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()

    def setUp(self):
        self.directory = TemporaryDirectory(prefix="panelreply-recovery-browser-")
        self.context = None
        self.servers = []
        self.addCleanup(self.cleanup)
        self.data_dir = Path(self.directory.name) / "data"
        self.data_dir.mkdir(mode=0o700)
        self.node_env = {key: value for key, value in os.environ.items()
                         if not key.startswith("OPENAI_")}
        self.allowed_origins = set()
        self.external_requests = []
        self.page_errors = []
        self.console_errors = []
        self.expected_console_errors = set()
        self.seed_owner()
        self.origin = self.start_server(self.data_dir)
        self.context = self.browser.new_context(
            viewport={"width": 1440, "height": 1000},
            timezone_id="America/New_York", accept_downloads=True,
        )
        self.context.route("**/*", self.route)
        self.page = self.context.new_page()
        self.page.set_default_timeout(7000)
        self.page.on("pageerror", lambda error: self.page_errors.append(str(error)))
        self.page.on("console", lambda message: self.console_errors.append(message.text)
                     if message.type == "error" else None)
        self.downloads = []
        self.page.on("download", lambda download: self.downloads.append(download))

    def cleanup(self):
        if self.context is not None:
            self.context.close()
            self.context = None
        for process, handle in reversed(self.servers):
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=5)
            handle.close()
        self.servers = []
        self.directory.cleanup()

    def tearDown(self):
        self.cleanup()
        self.assertEqual(self.external_requests, [], "Unexpected external browser request")
        self.assertEqual(self.page_errors, [], "Uncaught browser script error")
        unexpected = [message for message in self.console_errors
                      if not any(allowed in message for allowed in self.expected_console_errors)]
        self.assertEqual(unexpected, [], "Unexpected browser console error")

    def command(self, args, stdin):
        result = subprocess.run(
            ["node", *args], cwd=ROOT, env=self.node_env, input=stdin + "\n",
            capture_output=True, text=True, timeout=40, check=False,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        return json.loads(result.stdout)

    def seed_owner(self, username=OWNER, business="Example Electric"):
        return self.command([
            "scripts/workspace-admin.cjs", "--data-dir", str(self.data_dir),
            "--business", business, "--username", username,
        ], PASSWORD)

    def start_server(self, data_dir):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.bind(("127.0.0.1", 0))
            port = sock.getsockname()[1]
        origin = f"http://127.0.0.1:{port}"
        self.allowed_origins.add(origin)
        env = {**self.node_env, "WORKSPACE_DATA_DIR": str(data_dir),
               "WORKSPACE_ORIGIN": origin, "PORT": str(port)}
        log_path = Path(self.directory.name) / f"server-{port}.log"
        handle = log_path.open("ab")
        process = subprocess.Popen(
            ["node", "workspace-server.cjs"], cwd=ROOT, env=env,
            stdin=subprocess.DEVNULL, stdout=handle, stderr=subprocess.STDOUT,
        )
        self.servers.append((process, handle))
        opener = build_opener(RefuseRedirects())
        deadline = time.monotonic() + 20
        while time.monotonic() < deadline:
            if process.poll() is not None:
                break
            try:
                with opener.open(origin + "/login", timeout=0.5) as response:
                    if response.status == 200:
                        return origin
            except HTTPError as error:
                if 300 <= error.code < 400:
                    raise AssertionError("Private server startup probe must not redirect") from error
            except (URLError, OSError):
                pass
            time.sleep(0.1)
        raise AssertionError("Private server failed to start: " +
                             log_path.read_text(encoding="utf-8", errors="replace")[-4000:])

    def route(self, route):
        if not any(route.request.url.startswith(origin + "/") for origin in self.allowed_origins):
            self.external_requests.append(route.request.url)
            route.abort()
        elif route.request.url.split("?", 1)[0].endswith("/api/intake"):
            self.external_requests.append("AI adapter request")
            route.abort()
        else:
            route.continue_()

    def allow_error(self, code):
        self.expected_console_errors.add(f"status of {code}")

    def login(self, username=OWNER, password=PASSWORD, origin=None):
        origin = origin or self.origin
        self.page.goto(origin + "/login")
        self.page.get_by_label("Username", exact=True).fill(username)
        self.page.get_by_label("Password", exact=True).fill(password)
        self.page.get_by_role("button", name="Sign in", exact=True).click()
        expect(self.page).to_have_url(origin + "/")
        expect(self.page.get_by_role("button", name="Export records", exact=True)).to_be_enabled()

    def api(self, method, route, body=None, status=200, origin=None, context=None, headers=None):
        origin = origin or self.origin
        self.assertIn(origin, self.allowed_origins)
        context = context or self.context
        request_headers = {"Origin": origin, **(headers or {})}
        if method != "GET" and "X-CSRF-Token" not in request_headers:
            session = context.request.get(origin + "/api/session", max_redirects=0)
            self.assertEqual(session.status, 200, session.text())
            request_headers["X-CSRF-Token"] = session.json()["csrfToken"]
        response = context.request.fetch(origin + route, method=method, headers=request_headers,
                                         data=body, max_redirects=0)
        self.assertEqual(response.status, status, response.text())
        return None if response.status == 204 else response.json()

    def assert_login_rejected(self, username=OWNER, password=PASSWORD, origin=None):
        origin = origin or self.origin
        self.page.goto(origin + "/login")
        self.page.get_by_label("Username", exact=True).fill(username)
        self.page.get_by_label("Password", exact=True).fill(password)
        self.page.get_by_role("button", name="Sign in", exact=True).click()
        expect(self.page.locator("#login-error")).to_contain_text("not accepted")
        expect(self.page).to_have_url(origin + "/login")

    def create_lead(self, context=None, **changes):
        return self.api("POST", "/api/leads", {**LEAD, **changes}, status=201,
                        context=context, headers={"Idempotency-Key": uuid.uuid4().hex})["lead"]

    def open_lead(self, name="Jamie Recovery"):
        self.page.goto(self.origin + "/")
        self.page.get_by_role("button", name=f"Open request from {name}", exact=True).click()
        expect(self.page.locator("#lead-detail")).to_be_visible()
        expect(self.page.locator("#lead-notes")).to_be_enabled()

    def download_export(self, keyboard=False):
        button = self.page.get_by_role("button", name="Export records", exact=True)
        with self.page.expect_download() as pending:
            if keyboard:
                button.focus()
                button.press("Enter")
            else:
                button.click()
        download = pending.value
        self.assertIsNone(download.failure())
        self.assertRegex(download.suggested_filename, r"^panelreply-records-\d{4}-\d{2}-\d{2}\.json$")
        content = json.loads(Path(download.path()).read_text())
        expect(self.page.locator("#export-status")).to_contain_text("Export prepared")
        return content

    def emit_preview(self, filename):
        if os.environ.get("PANELREPLY_EMIT_RECOVERY_PREVIEWS") != "1":
            return
        self.page.evaluate("() => scrollTo({top: 0, left: 0, behavior: 'instant'})")
        data = self.page.screenshot(type="jpeg", quality=78, full_page=True, animations="disabled")
        encoded = base64.b64encode(data).decode("ascii")
        print(f"PANELREPLY_RECOVERY_PREVIEW_START:{filename}", flush=True)
        for offset in range(0, len(encoded), 6000):
            print(encoded[offset:offset + 6000], flush=True)
        print("PANELREPLY_RECOVERY_PREVIEW_END", flush=True)

    def test_export_download_contains_saved_records_without_losing_unsaved_edits(self):
        self.login()
        lead = self.create_lead()
        self.create_lead(customerName="Taylor Fixture", phone="+12485550102")
        self.open_lead()
        self.page.locator("#lead-notes").fill("Unsent owner note stays in this form.")
        self.page.get_by_label("Search requests", exact=True).fill("Jamie")
        content = self.download_export()
        self.assertEqual(content["format"], "panelreply-business-export")
        self.assertEqual(content["version"], 1)
        self.assertEqual(len(content["leads"]), 2, "Export includes all saved records, not the current search")
        saved = next(item for item in content["leads"] if item["id"] == lead["id"])
        self.assertEqual(saved["notes"], "")
        self.assertEqual(saved["conversation"], LEAD["conversation"])
        self.assertEqual(saved["callbackWindow"], "Monday after 4 pm")
        self.assertEqual(saved["requestedWorkDate"], "Friday")
        expect(self.page.locator("#lead-notes")).to_have_value("Unsent owner note stays in this form.")
        expect(self.page.locator("#lead-dirty")).to_be_visible()
        expect(self.page.locator("#navigation-guard")).to_be_hidden()
        serialized = json.dumps(content)
        for secret in [PASSWORD, "password_hash", "csrfToken", "token_hash", "login_attempts"]:
            self.assertNotIn(secret, serialized)
        self.emit_preview("recovery-inbox-desktop.jpg")

    def test_export_does_not_include_another_business(self):
        self.login()
        own = self.create_lead()
        other_owner = self.seed_owner("other-recovery@example.test", "Other Electric")
        other_context = self.browser.new_context()
        try:
            result = other_context.request.post(self.origin + "/api/login", headers={"Origin": self.origin},
                                                data={"username": "other-recovery@example.test", "password": PASSWORD},
                                                max_redirects=0)
            self.assertEqual(result.status, 200)
            other = self.create_lead(context=other_context, customerName="Other private customer", phone="+12485550102")
            content = self.download_export()
            self.assertEqual([item["id"] for item in content["leads"]], [own["id"]])
            serialized = json.dumps(content)
            for value in [other_owner["businessId"], other["id"], "Other private customer", "Other Electric"]:
                self.assertNotIn(value, serialized)
            attempted = self.api("GET", "/api/export?businessId=" + other_owner["businessId"])
            self.assertEqual(attempted["profile"]["business"]["id"], content["profile"]["business"]["id"])
        finally:
            other_context.close()

    def test_export_failure_keeps_draft_and_retry_downloads_once(self):
        self.login()
        self.create_lead()
        self.open_lead()
        self.page.locator("#lead-notes").fill("Keep this edit after export fails.")
        self.allow_error(503)
        endpoint = self.origin + "/api/export"
        self.page.route(endpoint, lambda route: route.fulfill(
            status=503, content_type="application/json",
            body=json.dumps({"error": {"code": "temporarily_unavailable", "message": "Export is temporarily unavailable."}}),
        ))
        self.page.get_by_role("button", name="Export records", exact=True).click()
        expect(self.page.locator("#export-error")).to_contain_text("temporarily unavailable")
        expect(self.page.locator("#export-status")).to_be_empty()
        expect(self.page.locator("#lead-notes")).to_have_value("Keep this edit after export fails.")
        self.assertEqual(self.downloads, [])
        self.page.unroute(endpoint)
        content = self.download_export()
        self.assertEqual(len(self.downloads), 1)
        self.assertEqual(len(content["leads"]), 1)
        expect(self.page.locator("#lead-notes")).to_have_value("Keep this edit after export fails.")

    def test_malformed_export_response_creates_no_download(self):
        self.login()
        self.page.route(self.origin + "/api/export", lambda route: route.fulfill(
            status=200, content_type="application/json", body='{"format":"wrong-format","leads":[]}',
        ))
        self.page.get_by_role("button", name="Export records", exact=True).click()
        expect(self.page.locator("#export-error")).to_contain_text("incomplete")
        expect(self.page.locator("#export-status")).to_be_empty()
        self.assertEqual(self.downloads, [])

    def test_expired_export_session_returns_to_login_without_a_download(self):
        self.login()
        self.create_lead()
        self.api("POST", "/api/logout", status=204)
        self.allow_error(401)
        self.page.get_by_role("button", name="Export records", exact=True).click()
        expect(self.page).to_have_url(self.origin + "/login")
        self.assertEqual(self.downloads, [])
        expect(self.page.get_by_label("Password", exact=True)).to_be_empty()

    def test_export_download_preparation_failure_reports_no_saved_file(self):
        self.login()
        self.create_lead()
        self.open_lead()
        self.page.locator("#lead-notes").fill("Keep this edit if downloads are blocked.")
        self.page.evaluate("() => { URL.createObjectURL = () => { throw new Error('Download preparation blocked.'); }; }")
        self.page.get_by_role("button", name="Export records", exact=True).click()
        expect(self.page.locator("#export-error")).to_contain_text("Download preparation blocked")
        expect(self.page.locator("#export-status")).to_be_empty()
        expect(self.page.locator("#lead-notes")).to_have_value("Keep this edit if downloads are blocked.")
        self.assertEqual(self.downloads, [])

    def test_mobile_keyboard_export_fits_and_downloads_the_saved_data(self):
        self.page.set_viewport_size({"width": 360, "height": 800})
        self.login()
        self.create_lead()
        self.open_lead()
        content = self.download_export(keyboard=True)
        self.assertEqual(content["leads"][0]["customerName"], "Jamie Recovery")
        self.assertTrue(self.page.evaluate("document.documentElement.scrollWidth <= innerWidth"))
        box = self.page.get_by_role("button", name="Export records", exact=True).bounding_box()
        # Preserve the 44 px target while removing sub-0.001 px coordinate
        # subtraction noise observed in Firefox (43.99998474121094 px).
        self.assertGreaterEqual(round(box["height"], 3), 44)
        self.emit_preview("recovery-inbox-mobile.jpg")

    def test_encrypted_restore_preserves_requests_and_restrictions_but_rejects_old_sessions(self):
        self.login()
        first = self.create_lead()
        self.seed_owner("other-restore@example.test", "Other Restored Electric")
        other_context = self.browser.new_context()
        try:
            result = other_context.request.post(self.origin + "/api/login", headers={"Origin": self.origin},
                                                data={"username": "other-restore@example.test", "password": PASSWORD},
                                                max_redirects=0)
            self.assertEqual(result.status, 200)
            other_lead = self.create_lead(context=other_context, customerName="Other restored business", phone="+17345550103")
            other_before = self.api("GET", "/api/export", context=other_context)
        finally:
            other_context.close()
        self.api("PATCH", "/api/leads/" + first["id"], {
            "version": first["version"], "status": "new", "notes": "Saved before the recovery drill.",
        })
        self.api("POST", "/api/preview", {"message": "STOP", "state": {"phone": LEAD["phone"], "conversation": []}})
        self.create_lead(customerName="Safety Review", phone="+12485550102", job="The panel is sparking")
        profile = self.api("GET", "/api/profile")
        profile["facts"]["hours"] = {"verified": True, "answer": "Office hours Monday through Friday, 8 am–5 pm."}
        self.api("PATCH", "/api/profile", {"version": profile["version"], "businessName": profile["business"]["name"], "facts": profile["facts"]})
        before = self.api("GET", "/api/export")
        archive = Path(self.directory.name) / "recovery.prbk"
        restored_dir = Path(self.directory.name) / "restored"
        self.command(["scripts/workspace-backup.cjs", "create", "--data-dir", str(self.data_dir), "--output", str(archive)], BACKUP_PASSPHRASE)
        self.assertTrue(archive.is_file())
        self.command(["scripts/workspace-backup.cjs", "restore", "--backup", str(archive), "--data-dir", str(restored_dir)], BACKUP_PASSPHRASE)
        restored_origin = self.start_server(restored_dir)
        # Cookies are host-scoped, so this context presents the original token
        # to the new loopback port. The restored database must reject it.
        self.api("GET", "/api/session", status=401, origin=restored_origin)
        self.api("GET", "/api/session", status=200, origin=self.origin)
        self.allow_error(401)
        self.assert_login_rejected(origin=restored_origin)
        self.assert_login_rejected(username="other-restore@example.test", origin=restored_origin)
        self.command(["scripts/workspace-reset-password.cjs", "--data-dir", str(restored_dir), "--username", OWNER], NEW_PASSWORD)
        self.login(password=NEW_PASSWORD, origin=restored_origin)
        after = self.api("GET", "/api/export", origin=restored_origin)
        self.assertEqual(after["profile"], before["profile"])
        self.assertEqual(after["leads"], before["leads"])
        self.api("GET", "/api/leads/" + other_lead["id"], status=404, origin=restored_origin)
        opted = next(item for item in after["leads"] if item["id"] == first["id"])
        self.assertTrue(opted["optedOut"])
        self.assertFalse(opted["contactAllowed"])
        self.assertEqual(opted["status"], "needs_review")
        held = next(item for item in after["leads"] if item["customerName"] == "Safety Review")
        self.assertTrue(held["safetyHold"])
        resumed = self.api("POST", "/api/preview", {"message": "START", "state": {"phone": LEAD["phone"], "conversation": []}}, origin=restored_origin)
        self.assertTrue(resumed["state"]["stopped"])
        self.assertEqual(resumed["replies"], [])
        self.page.get_by_role("button", name="Open request from Jamie Recovery", exact=True).click()
        expect(self.page.locator("#lead-notes")).to_have_value("Saved before the recovery drill.")
        self.api("POST", "/api/logout", status=204, origin=restored_origin)
        # Resetting one restored owner must not reactivate another owner's
        # archived credentials. Recover each business independently.
        self.assert_login_rejected(username="other-restore@example.test", origin=restored_origin)
        self.command([
            "scripts/workspace-reset-password.cjs", "--data-dir", str(restored_dir),
            "--username", "other-restore@example.test",
        ], OTHER_NEW_PASSWORD)
        self.login(username="other-restore@example.test", password=OTHER_NEW_PASSWORD, origin=restored_origin)
        other_after = self.download_export()
        self.assertEqual(other_after["profile"], other_before["profile"])
        self.assertEqual(other_after["leads"], other_before["leads"])
        self.assertEqual([item["id"] for item in other_after["leads"]], [other_lead["id"]])
        self.api("GET", "/api/leads/" + first["id"], status=404, origin=restored_origin)
        self.page.get_by_role("button", name="Open request from Other restored business", exact=True).click()
        expect(self.page.locator("#lead-name")).to_have_value("Other restored business")
        source_context = self.browser.new_context()
        try:
            for username in (OWNER, "other-restore@example.test"):
                original_login = source_context.request.post(
                    self.origin + "/api/login", headers={"Origin": self.origin},
                    data={"username": username, "password": PASSWORD}, max_redirects=0,
                )
                self.assertEqual(original_login.status, 200, "Recovery must not change source credentials")
        finally:
            source_context.close()

    def test_operator_password_reset_revokes_browser_session_and_preserves_records(self):
        self.login()
        lead = self.create_lead()
        self.command(["scripts/workspace-reset-password.cjs", "--data-dir", str(self.data_dir), "--username", OWNER], NEW_PASSWORD)
        self.allow_error(401)
        self.page.get_by_role("button", name="Export records", exact=True).click()
        expect(self.page).to_have_url(self.origin + "/login")
        self.assertEqual(self.downloads, [])
        self.page.get_by_label("Username", exact=True).fill(OWNER)
        self.page.get_by_label("Password", exact=True).fill(PASSWORD)
        self.page.get_by_role("button", name="Sign in", exact=True).click()
        expect(self.page).to_have_url(self.origin + "/login")
        expect(self.page.locator("#login-error")).to_contain_text("not accepted")
        self.login(password=NEW_PASSWORD)
        saved = self.api("GET", "/api/leads/" + lead["id"])["lead"]
        self.assertEqual(saved["customerName"], "Jamie Recovery")
        self.assertEqual(saved["conversation"], LEAD["conversation"])
        content = self.download_export()
        self.assertEqual(content["leads"][0]["id"], lead["id"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
