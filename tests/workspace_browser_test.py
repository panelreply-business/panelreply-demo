"""Private workspace integration checks against the real Node/SQLite server.

Run in CI with Node 22.18+ and Playwright Chromium. All owners, business answers,
phone numbers and requests are synthetic. The browser blocks external requests.
No AI provider, messaging provider, calendar, public demo or deployment is used.

PANELREPLY_EMIT_WORKSPACE_PREVIEWS=1 emits two small JPEGs for visual review.
PANELREPLY_CAPTURE_DIR optionally writes the same screenshots as CI artifacts.
"""

from pathlib import Path
from tempfile import TemporaryDirectory
from urllib.error import HTTPError, URLError
from urllib.request import urlopen
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
FIXTURE_PASSWORD = "Synthetic workspace password 2026!"
FIXTURE_PHONE = "+15865550101"
BUNDLED_MESSAGE = (
    "My name is Jamie Stone. My phone is 586-555-0101. "
    "I need an EV charger installed. ZIP 48315. "
    "Call me Monday after 4 pm. I need the work done Friday."
)
REVIEW_LABELS = {
    "customerName": "Customer name",
    "phone": "Phone number",
    "job": "Electrical work",
    "zip": "Job ZIP",
    "callbackWindow": "Callback window",
    "requestedWorkDate": "Requested work date",
}
DEFAULT_REQUEST = {
    "customerName": "Jamie Stone",
    "phone": FIXTURE_PHONE,
    "job": "Install an EV charger in the garage",
    "zip": "48315",
    "callbackWindow": "Monday after 4 pm",
    "requestedWorkDate": "Friday",
    "contactPermission": "requested_callback",
    "conversation": [],
}


class PrivateWorkspaceBrowserTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.directory = TemporaryDirectory(prefix="panelreply-private-browser-")
        cls.data_dir = Path(cls.directory.name) / "data"
        cls.data_dir.mkdir(mode=0o700)
        cls.server_log = Path(cls.directory.name) / "server.log"
        cls.process = None
        cls.log_handle = None
        cls.playwright = None
        cls.browser = None
        cls.counter = 0
        # This runner executes in CI. The port is assigned by the OS and the
        # application itself enforces a loopback listener.
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
            listener.bind(("127.0.0.1", 0))
            cls.port = listener.getsockname()[1]
        cls.origin = f"http://127.0.0.1:{cls.port}"
        cls.node_env = {key: value for key, value in os.environ.items()
                        if not key.startswith("OPENAI_")}
        cls.node_env.update({
            "WORKSPACE_DATA_DIR": str(cls.data_dir),
            "WORKSPACE_ORIGIN": cls.origin,
            "PORT": str(cls.port),
        })
        cls.node_env.update(getattr(cls, "fixture_env", {}))
        cls.addClassCleanup(cls.cleanup)
        cls.start_server()
        cls.playwright = sync_playwright().start()
        cls.browser = launch_browser(cls.playwright)

    @classmethod
    def start_server(cls):
        cls.log_handle = cls.server_log.open("ab")
        cls.process = subprocess.Popen(
            ["node", getattr(cls, "server_entry", "workspace-server.cjs")], cwd=ROOT, env=cls.node_env,
            stdin=subprocess.DEVNULL, stdout=cls.log_handle,
            stderr=subprocess.STDOUT,
        )
        deadline = time.monotonic() + 20
        while time.monotonic() < deadline:
            if cls.process.poll() is not None:
                break
            try:
                with urlopen(cls.origin + "/login", timeout=0.5) as response:
                    if response.status == 200:
                        return
            except (HTTPError, URLError, OSError):
                pass
            time.sleep(0.1)
        log = cls.server_log.read_text(encoding="utf-8", errors="replace")[-8000:]
        raise AssertionError("Private workspace did not start: " + log)

    @classmethod
    def stop_server(cls):
        if cls.process is not None:
            if cls.process.poll() is None:
                cls.process.terminate()
                try:
                    cls.process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    cls.process.kill()
                    cls.process.wait(timeout=5)
            cls.process = None
        if cls.log_handle is not None:
            cls.log_handle.close()
            cls.log_handle = None

    @classmethod
    def cleanup(cls):
        if cls.browser is not None:
            cls.browser.close()
        if cls.playwright is not None:
            cls.playwright.stop()
        cls.stop_server()
        cls.directory.cleanup()

    def seed_owner(self):
        type(self).counter += 1
        name = f"fixture{type(self).counter}@example.test"
        result = subprocess.run(
            ["node", "scripts/workspace-admin.cjs", "--data-dir", str(self.data_dir),
             "--business", "Example Electric", "--username", name],
            cwd=ROOT, env=self.node_env, input=FIXTURE_PASSWORD + "\n",
            capture_output=True, text=True, timeout=20, check=False,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        owner = json.loads(result.stdout)
        self.assertEqual(owner["username"], name)
        return name

    def setUp(self):
        self.username = self.seed_owner()
        self.context = self.browser.new_context(viewport={"width": 1440, "height": 1000})
        self.external_requests = []
        self.provider_requests = []
        self.page_errors = []
        self.console_errors = []
        self.expected_console_errors = set()
        self.context.route("**/*", self.route)
        self.page = self.context.new_page()
        self.page.set_default_timeout(7000)
        self.page.on("pageerror", lambda error: self.page_errors.append(str(error)))
        self.page.on("console", lambda message: self.console_errors.append(message.text)
                     if message.type == "error" else None)
        self.page.goto(self.origin + "/login")

    def tearDown(self):
        self.context.close()
        self.assertEqual(self.external_requests, [], "Unexpected external browser request")
        self.assertEqual(self.provider_requests, [], "Private workspace called the AI adapter")
        self.assertEqual(self.page_errors, [], "Uncaught browser script error")
        unexpected = [message for message in self.console_errors
                      if not any(allowed in message for allowed in self.expected_console_errors)]
        self.assertEqual(unexpected, [], "Unexpected browser console error")

    def route(self, route):
        url = route.request.url
        if not url.startswith(self.origin + "/"):
            self.external_requests.append(url)
            route.abort()
        elif url.split("?", 1)[0] == self.origin + "/api/intake":
            self.provider_requests.append(url)
            route.abort()
        else:
            route.continue_()

    def allow_http_error(self, code):
        self.expected_console_errors.add(f"status of {code}")

    def login(self, username=None, keyboard=False):
        self.page.goto(self.origin + "/login")
        self.page.get_by_label("Username", exact=True).fill(username or self.username)
        password = self.page.get_by_label("Password", exact=True)
        password.fill(FIXTURE_PASSWORD)
        if keyboard:
            password.press("Enter")
        else:
            self.page.get_by_role("button", name="Sign in", exact=True).click()
        expect(self.page).to_have_url(self.origin + "/")
        expect(self.page.locator("#nav-inbox")).to_be_visible()
        expect(self.page.locator("#business-display")).to_have_text("Example Electric")

    def api(self, method, path, data=None, status=200, headers=None):
        request_headers = {"Origin": self.origin}
        if method not in ("GET", "HEAD"):
            session = self.context.request.get(self.origin + "/api/session")
            self.assertEqual(session.status, 200)
            request_headers["X-CSRF-Token"] = session.json()["csrfToken"]
        request_headers.update(headers or {})
        response = self.context.request.fetch(
            self.origin + path, method=method, headers=request_headers, data=data
        )
        self.assertEqual(response.status, status, response.text())
        return None if status == 204 else response.json()

    def create_request(self, **changes):
        payload = {**DEFAULT_REQUEST, **changes}
        result = self.api("POST", "/api/leads", payload, status=201,
                          headers={"Idempotency-Key": uuid.uuid4().hex})
        self.assertTrue(result["created"])
        return result["lead"]

    def open_preview(self):
        self.page.goto(self.origin + "/preview")
        expect(self.page.get_by_label("Customer message", exact=True)).to_be_enabled()
        expect(self.page.get_by_label("Customer name", exact=True)).to_be_enabled()

    def fill_review(self, **changes):
        values = {**DEFAULT_REQUEST, **changes}
        for key, label in REVIEW_LABELS.items():
            self.page.get_by_label(label, exact=True).fill(values[key])
        self.page.get_by_label("Contact permission", exact=True).select_option(
            values["contactPermission"]
        )

    def review_values(self):
        return {key: self.page.get_by_label(label, exact=True).input_value()
                for key, label in REVIEW_LABELS.items()}

    def send(self, message):
        self.page.get_by_label("Customer message", exact=True).fill(message)
        with self.page.expect_response(
            lambda response: response.url == self.origin + "/api/preview"
            and response.request.method == "POST"
        ) as pending:
            self.page.get_by_role("button", name="Send message", exact=True).click()
        response = pending.value
        self.assertEqual(response.status, 200, response.text())
        expect(self.page.get_by_label("Customer message", exact=True)).to_have_value("")
        return response.json()

    def save_review(self):
        with self.page.expect_response(
            lambda response: response.url == self.origin + "/api/leads"
            and response.request.method == "POST"
        ) as pending:
            self.page.get_by_role("button", name="Save request", exact=True).click()
        response = pending.value
        self.assertIn(response.status, (200, 201), response.text())
        expect(self.page.locator("#saved-request-link")).to_be_visible()
        return response.json()["lead"]

    def reset_draft(self):
        self.page.locator("#reset-draft").click()
        guard = self.page.locator("#preview-navigation-guard")
        if guard.is_visible():
            self.page.get_by_role("button", name="Discard draft", exact=True).click()
        expect(self.page.get_by_label("Customer name", exact=True)).to_have_value("")
        expect(self.page.get_by_label("Customer message", exact=True)).to_be_enabled()

    def open_request(self, name="Jamie Stone"):
        self.page.goto(self.origin + "/")
        self.page.get_by_role("button", name=f"Open request from {name}", exact=True).click()
        expect(self.page.locator("#lead-detail")).to_be_visible()

    def save_lead(self, expected_status=200):
        if expected_status >= 400:
            self.allow_http_error(expected_status)
        with self.page.expect_response(
            lambda response: "/api/leads/" in response.url
            and response.request.method == "PATCH"
        ) as pending:
            self.page.get_by_role("button", name="Save changes", exact=True).click()
        self.assertEqual(pending.value.status, expected_status, pending.value.text())
        if expected_status == 200:
            expect(self.page.locator("#lead-status")).to_contain_text("Changes saved")
        return pending.value.json()

    def profile_view(self):
        self.page.locator("#nav-profile").click()
        expect(self.page.get_by_label("Business name", exact=True)).to_be_enabled()

    def save_profile(self, expected_status=200):
        if expected_status >= 400:
            self.allow_http_error(expected_status)
        with self.page.expect_response(
            lambda response: response.url == self.origin + "/api/profile"
            and response.request.method == "PATCH"
        ) as pending:
            self.page.get_by_role("button", name="Save business profile", exact=True).click()
        self.assertEqual(pending.value.status, expected_status, pending.value.text())
        if expected_status == 200:
            expect(self.page.locator("#profile-status")).to_contain_text("Business profile saved")
        return pending.value.json()

    def assert_no_overflow(self):
        dimensions = self.page.evaluate("""() => ({
            viewport: innerWidth,
            document: document.documentElement.scrollWidth,
            body: document.body.scrollWidth
        })""")
        self.assertLessEqual(dimensions["document"], dimensions["viewport"] + 1,
                             json.dumps(dimensions))
        self.assertLessEqual(dimensions["body"], dimensions["viewport"] + 1,
                             json.dumps(dimensions))

    def capture(self, filename):
        directory = os.environ.get("PANELREPLY_CAPTURE_DIR")
        emit = os.environ.get("PANELREPLY_EMIT_WORKSPACE_PREVIEWS") == "1"
        if not directory and not emit:
            return
        if os.environ.get("PANELREPLY_BROWSER", "chromium") == "webkit":
            # Playwright's WebKit screenshot preparation inserts a stylesheet
            # even with animation/caret changes disabled. Only this optional
            # artifact is unavailable. Keep all workflow and console assertions.
            print("PANELREPLY_PREVIEW_UNAVAILABLE=" + json.dumps({
                "case": self.id(), "filename": filename, "engine": "webkit",
                "reason": "Playwright screenshot preparation injects an inline stylesheet under the workspace's strict CSP. No preview captured; product assertions remain active.",
            }), flush=True)
            return
        self.page.evaluate("() => scrollTo({top: 0, left: 0, behavior: 'instant'})")
        # Keep the page's animation and caret state unchanged during capture.
        options = {"type": "jpeg", "quality": 65, "full_page": True,
                   "animations": "allow", "caret": "initial"}
        if directory:
            target = Path(directory).resolve()
            target.mkdir(parents=True, exist_ok=True)
            options["path"] = str(target / filename)
        picture = self.page.screenshot(**options)
        if emit:
            print("PANELREPLY_WORKSPACE_PREVIEW_START:" + filename, flush=True)
            print(base64.b64encode(picture).decode("ascii"), flush=True)
            print("PANELREPLY_WORKSPACE_PREVIEW_END", flush=True)

    def test_private_pages_and_data_require_a_session(self):
        for path in ("/", "/preview"):
            self.page.goto(self.origin + path)
            expect(self.page).to_have_url(re.compile(r"/login(?:\?.*)?$"))
            expect(self.page.get_by_label("Password", exact=True)).to_be_visible()
        for path in ("/api/session", "/api/leads", "/api/profile"):
            response = self.context.request.get(self.origin + path)
            self.assertEqual(response.status, 401)
            self.assertNotIn("Example Electric", response.text())

    def test_rejected_login_does_not_create_a_session(self):
        self.allow_http_error(401)
        self.page.get_by_label("Username", exact=True).fill(self.username)
        self.page.get_by_label("Password", exact=True).fill("Incorrect synthetic password")
        self.page.get_by_role("button", name="Sign in", exact=True).click()
        expect(self.page.locator("#login-error")).to_be_visible()
        expect(self.page).to_have_url(self.origin + "/login")
        self.assertEqual(self.context.request.get(self.origin + "/api/session").status, 401)
        self.assertEqual(self.context.cookies(), [])

    def test_logout_revokes_cookie_and_browser_stores_no_request_data(self):
        self.login()
        self.create_request()
        self.open_request()
        self.page.get_by_role("button", name="Sign out", exact=True).click()
        expect(self.page).to_have_url(re.compile(r"/login(?:\?.*)?$"))
        self.assertEqual(self.context.request.get(self.origin + "/api/leads").status, 401)
        self.assertEqual(self.context.cookies(), [])
        stored = self.page.evaluate("() => ({local: {...localStorage}, session: {...sessionStorage}})")
        self.assertEqual(stored, {"local": {}, "session": {}})
        self.page.goto(self.origin + "/")
        expect(self.page.get_by_label("Password", exact=True)).to_be_visible()
        expect(self.page.get_by_text("Jamie Stone", exact=True)).to_have_count(0)

    def test_bundled_message_captures_contact_and_separates_callback_from_work_date(self):
        self.login()
        self.open_preview()
        result = self.send(BUNDLED_MESSAGE)
        fields = self.review_values()
        self.assertEqual(fields["customerName"], "Jamie Stone")
        self.assertEqual(re.sub(r"\D", "", fields["phone"])[-10:], "5865550101")
        self.assertIn("EV charger", fields["job"])
        self.assertEqual(fields["zip"], "48315")
        self.assertIn("Monday", fields["callbackWindow"])
        self.assertIn("4 pm", fields["callbackWindow"])
        self.assertIn("Friday", fields["requestedWorkDate"])
        self.assertNotIn("Friday", fields["callbackWindow"])
        self.assertFalse(result["state"]["stopped"])
        self.assertEqual(self.api("GET", "/api/leads")["leads"], [])

    def test_questions_preserve_reviewed_contact_job_zip_and_timing(self):
        self.login()
        self.open_preview()
        self.send(BUNDLED_MESSAGE)
        self.fill_review(job="Install a reviewed garage EV charger")
        before = self.review_values()
        self.send("Are you open Friday? Do you cover ZIP 48084?")
        self.assertEqual(self.review_values(), before)
        expect(self.page.locator("#conversation")).to_contain_text("Friday")

    def test_ambiguous_date_requires_review_without_overwriting_either_time(self):
        self.login()
        self.open_preview()
        self.send(BUNDLED_MESSAGE)
        before = self.review_values()
        result = self.send("Tuesday")
        self.assertEqual(self.review_values(), before)
        self.assertIn("callbackWindow", result["state"]["issues"])
        self.assertIn("requestedWorkDate", result["state"]["issues"])
        self.page.get_by_role("button", name="Save request", exact=True).click()
        expect(self.page.locator("#preview-error")).to_be_visible()
        self.assertEqual(self.api("GET", "/api/leads")["leads"], [])
        self.page.get_by_label("Callback window", exact=True).fill("Tuesday after 4 pm")
        self.page.get_by_label("Requested work date", exact=True).fill("Thursday")
        self.page.get_by_label("Contact permission", exact=True).select_option("requested_callback")
        lead = self.save_review()
        self.assertEqual(lead["callbackWindow"], "Tuesday after 4 pm")
        self.assertEqual(lead["requestedWorkDate"], "Thursday")

    def test_approved_profile_answer_persists_and_is_used_by_preview(self):
        self.login()
        self.profile_view()
        answer = "Example Electric test hours are Monday through Thursday, 9 am to 3 pm."
        self.page.get_by_label("Business hours answer", exact=True).fill(answer)
        self.page.get_by_label("Use Business hours answer in chat", exact=True).check()
        self.save_profile()
        self.page.reload()
        self.profile_view()
        expect(self.page.get_by_label("Business hours answer", exact=True)).to_have_value(answer)
        expect(self.page.get_by_label("Use Business hours answer in chat", exact=True)).to_be_checked()
        self.open_preview()
        result = self.send("What are your business hours?")
        self.assertIn(answer, " ".join(result["replies"]))
        expect(self.page.locator("#conversation")).to_contain_text(answer)

    def test_unapproved_profile_answer_is_not_presented_as_a_business_fact(self):
        self.login()
        self.profile_view()
        answer = "Unapproved fixture claim: open every Sunday at 3 am."
        self.page.get_by_label("Business hours answer", exact=True).fill(answer)
        self.page.get_by_label("Use Business hours answer in chat", exact=True).uncheck()
        self.save_profile()
        self.open_preview()
        result = self.send("What are your business hours?")
        self.assertNotIn(answer, " ".join(result["replies"]))
        expect(self.page.locator("#conversation")).not_to_contain_text(answer)

    def test_saved_request_survives_navigation_reload_and_keeps_transcript(self):
        self.login()
        self.open_preview()
        self.send(BUNDLED_MESSAGE)
        self.fill_review()
        lead = self.save_review()
        self.assertEqual(lead["phone"], FIXTURE_PHONE)
        self.assertEqual(lead["callbackWindow"], "Monday after 4 pm")
        self.assertEqual(lead["requestedWorkDate"], "Friday")
        self.page.locator("#saved-request-link").click()
        expect(self.page.get_by_label("Customer name", exact=True)).to_have_value("Jamie Stone")
        self.page.reload()
        expect(self.page.get_by_label("Electrical work", exact=True)).to_have_value(DEFAULT_REQUEST["job"])
        stored = self.api("GET", "/api/leads/" + lead["id"])["lead"]
        self.assertTrue(any(item["role"] == "customer" and item["text"] == BUNDLED_MESSAGE
                            for item in stored["conversation"]))
        self.assertTrue(stored["contactAllowed"])
        self.assertEqual(stored["status"], "new")
        self.assert_no_overflow()
        self.capture("private-inbox-desktop.jpg")

    def test_incomplete_and_invalid_contact_details_are_not_saved(self):
        self.login()
        self.open_preview()
        self.fill_review(customerName="", phone="")
        self.page.get_by_role("button", name="Save request", exact=True).click()
        self.assertEqual(self.api("GET", "/api/leads")["leads"], [])
        self.fill_review(phone="123")
        self.allow_http_error(400)
        self.page.get_by_role("button", name="Save request", exact=True).click()
        expect(self.page.locator("#preview-error")).to_be_visible()
        expect(self.page.get_by_label("Phone number", exact=True)).to_have_value("123")
        self.assertEqual(self.api("GET", "/api/leads")["leads"], [])
        self.page.get_by_label("Phone number", exact=True).fill(FIXTURE_PHONE)
        self.page.get_by_label("Job ZIP", exact=True).fill("4831")
        self.page.get_by_role("button", name="Save request", exact=True).click()
        self.assertEqual(self.api("GET", "/api/leads")["leads"], [])

    def test_lost_save_response_retries_same_identifier_without_duplicate_records(self):
        self.login()
        self.open_preview()
        self.fill_review()
        identifiers = []
        committed = []
        self.expected_console_errors.add("net::ERR_FAILED")

        def lose_first_response(route):
            if route.request.method != "POST":
                route.continue_()
                return
            identifiers.append(route.request.headers.get("idempotency-key"))
            if len(identifiers) == 1:
                response = route.fetch()
                self.assertEqual(response.status, 201)
                committed.append(response.json()["lead"]["id"])
                route.abort("failed")
            else:
                route.continue_()

        self.page.route(self.origin + "/api/leads", lose_first_response)
        self.page.get_by_role("button", name="Save request", exact=True).click()
        expect(self.page.locator("#save-retry-notice")).to_be_visible()
        expect(self.page.get_by_label("Customer name", exact=True)).to_have_value("Jamie Stone")
        expect(self.page.get_by_label("Customer name", exact=True)).to_be_disabled()
        expect(self.page.get_by_role("button", name="Reset draft", exact=True)).to_be_disabled()
        self.assertEqual(len(self.api("GET", "/api/leads")["leads"]), 1)
        self.page.get_by_role("button", name="Retry save", exact=True).click()
        expect(self.page.locator("#saved-request-link")).to_be_visible()
        self.assertEqual(len(identifiers), 2)
        self.assertTrue(identifiers[0])
        self.assertEqual(identifiers[0], identifiers[1])
        leads = self.api("GET", "/api/leads")["leads"]
        self.assertEqual([lead["id"] for lead in leads], committed)

    def test_service_failure_retains_draft_and_retry_saves_once(self):
        self.login()
        self.open_preview()
        self.fill_review()
        self.allow_http_error(503)
        attempts = []

        def fail_first_save(route):
            if route.request.method != "POST":
                route.continue_()
                return
            attempts.append(route.request.headers.get("idempotency-key"))
            if len(attempts) == 1:
                route.fulfill(status=503, content_type="application/json", body=json.dumps({
                    "error": {"code": "temporarily_unavailable", "message": "Test storage unavailable."}
                }))
            else:
                route.continue_()

        self.page.route(self.origin + "/api/leads", fail_first_save)
        self.page.get_by_role("button", name="Save request", exact=True).click()
        expect(self.page.locator("#preview-error")).to_be_visible()
        expect(self.page.locator("#save-retry-notice")).to_be_visible()
        self.assertEqual(self.review_values(), {key: DEFAULT_REQUEST[key] for key in REVIEW_LABELS})
        self.assertEqual(self.api("GET", "/api/leads")["leads"], [])
        self.page.get_by_role("button", name="Retry save", exact=True).click()
        expect(self.page.locator("#saved-request-link")).to_be_visible()
        self.assertEqual(attempts[0], attempts[1])
        self.assertEqual(len(self.api("GET", "/api/leads")["leads"]), 1)

    def test_conversation_limit_keeps_unsent_text_editable_and_current_draft_saveable(self):
        self.login()
        self.open_preview()
        self.send(BUNDLED_MESSAGE)
        self.fill_review()
        before = self.review_values()
        self.allow_http_error(413)
        unsent = "What else do you need from me?"

        def reach_conversation_limit(route):
            route.fulfill(status=413, content_type="application/json", body=json.dumps({
                "error": {
                    "code": "conversation_limit",
                    "message": "This draft has reached its conversation limit. Save the reviewed request."
                }
            }))

        self.page.route(self.origin + "/api/preview", reach_conversation_limit)
        message = self.page.get_by_label("Customer message", exact=True)
        message.fill(unsent)
        self.page.get_by_role("button", name="Send message", exact=True).click()
        expect(self.page.locator("#preview-error")).to_be_visible()
        expect(message).to_have_value(unsent)
        expect(message).to_be_enabled()
        expect(self.page.locator("#send-message")).to_be_disabled()
        self.assertEqual(self.review_values(), before)
        message.fill("")
        lead = self.save_review()
        self.assertEqual(lead["customerName"], "Jamie Stone")
        self.assertTrue(any(item["text"] == BUNDLED_MESSAGE for item in lead["conversation"]))
        self.assertFalse(any(item["text"] == unsent for item in lead["conversation"]))

    def test_saved_draft_cannot_be_resubmitted_until_reset(self):
        self.login()
        self.open_preview()
        self.fill_review()
        first = self.save_review()
        expect(self.page.locator("#save-request")).to_be_disabled()
        expect(self.page.get_by_label("Customer name", exact=True)).to_be_disabled()
        self.assertEqual(len(self.api("GET", "/api/leads")["leads"]), 1)
        self.reset_draft()
        expect(self.page.get_by_label("Customer name", exact=True)).to_be_enabled()
        self.fill_review(customerName="Morgan Example", phone="+15865550102")
        second = self.save_review()
        self.assertNotEqual(first["id"], second["id"])
        self.assertEqual(len(self.api("GET", "/api/leads")["leads"]), 2)

    def test_reset_clears_only_unsaved_draft_and_keeps_existing_requests(self):
        self.login()
        existing = self.create_request()
        self.open_preview()
        self.send("I need a ceiling fan installed. ZIP 48315.")
        self.reset_draft()
        self.assertTrue(all(not value for value in self.review_values().values()))
        expect(self.page.locator("#conversation")).not_to_contain_text("ceiling fan")
        self.assertEqual([item["id"] for item in self.api("GET", "/api/leads")["leads"]],
                         [existing["id"]])

    def test_status_and_notes_update_persist_with_audit_history(self):
        self.login()
        lead = self.create_request()
        self.open_request()
        self.page.get_by_label("Request status", exact=True).select_option("contacted")
        self.page.get_by_label("Internal notes", exact=True).fill("Synthetic follow-up recorded by owner.")
        self.save_lead()
        self.page.reload()
        expect(self.page.get_by_label("Request status", exact=True)).to_have_value("contacted")
        expect(self.page.get_by_label("Internal notes", exact=True)).to_have_value(
            "Synthetic follow-up recorded by owner."
        )
        stored = self.api("GET", "/api/leads/" + lead["id"])["lead"]
        self.assertEqual(stored["version"], lead["version"] + 1)
        self.assertTrue(any(event["action"] == "lead.updated" for event in stored["audit"]))

    def test_stale_request_save_preserves_draft_and_does_not_overwrite_newer_data(self):
        self.login()
        lead = self.create_request()
        self.open_request()
        self.api("PATCH", "/api/leads/" + lead["id"], {
            "version": lead["version"], "status": "new", "notes": "Saved in another session."
        })
        self.page.get_by_label("Internal notes", exact=True).fill("Unsaved local review.")
        self.save_lead(expected_status=409)
        expect(self.page.locator("#lead-conflict")).to_be_visible()
        expect(self.page.get_by_label("Internal notes", exact=True)).to_have_value("Unsaved local review.")
        stored = self.api("GET", "/api/leads/" + lead["id"])["lead"]
        self.assertEqual(stored["notes"], "Saved in another session.")
        self.page.get_by_role("button", name="Reload saved version", exact=True).click()
        expect(self.page.locator("#navigation-guard")).to_be_visible()
        self.page.get_by_role("button", name="Discard changes", exact=True).click()
        expect(self.page.get_by_label("Internal notes", exact=True)).to_have_value("Saved in another session.")

    def test_stale_business_profile_preserves_local_answer_and_saved_version(self):
        self.login()
        self.profile_view()
        profile = self.api("GET", "/api/profile")
        facts = profile["facts"]
        facts["hours"] = {"verified": True, "answer": "Example Electric fixture hours: 8 am to noon."}
        self.api("PATCH", "/api/profile", {
            "version": profile["version"], "businessName": "Example Electric", "facts": facts
        })
        local = "My unsaved fixture hours: 10 am to 2 pm."
        self.page.get_by_label("Business hours answer", exact=True).fill(local)
        self.save_profile(expected_status=409)
        expect(self.page.locator("#profile-conflict")).to_be_visible()
        expect(self.page.get_by_label("Business hours answer", exact=True)).to_have_value(local)
        self.assertEqual(self.api("GET", "/api/profile")["facts"]["hours"], facts["hours"])

    def test_other_business_cannot_list_read_or_update_saved_request(self):
        self.login()
        lead = self.create_request()
        other_username = self.seed_owner()
        self.api("POST", "/api/logout", status=204)
        self.login(username=other_username)
        self.assertEqual(self.api("GET", "/api/leads")["leads"], [])
        missing = self.api("GET", "/api/leads/" + lead["id"], status=404)
        self.assertNotIn("Jamie Stone", json.dumps(missing))
        self.api("PATCH", "/api/leads/" + lead["id"], {
            "version": lead["version"], "status": "closed"
        }, status=404)
        self.page.goto(self.origin + "/")
        expect(self.page.get_by_role("button", name="Open request from Jamie Stone", exact=True)).to_have_count(0)

    def test_stop_before_save_survives_start_reset_and_later_request(self):
        self.login()
        self.open_preview()
        self.send(BUNDLED_MESSAGE)
        self.send("STOP")
        self.send("START")
        self.reset_draft()
        self.fill_review()
        lead = self.save_review()
        self.assertTrue(lead["optedOut"])
        self.assertFalse(lead["contactAllowed"])
        self.assertEqual(lead["contactPermission"], "opted_out")
        self.assertEqual(lead["status"], "needs_review")
        later = self.create_request(customerName="Jamie Stone second test request")
        self.assertTrue(later["optedOut"])
        self.assertFalse(later["contactAllowed"])
        self.api("PATCH", "/api/leads/" + later["id"], {
            "version": later["version"], "status": "contacted",
            "contactPermission": "requested_callback"
        }, status=409)

    def test_hazard_hold_survives_editing_and_rejects_marking_contacted(self):
        self.login()
        self.open_preview()
        self.send("My electrical panel is smoking. My phone is 586-555-0101.")
        self.fill_review(job="Review the reported electrical panel problem")
        lead = self.save_review()
        self.assertTrue(lead["safetyHold"])
        self.assertFalse(lead["contactAllowed"])
        self.assertEqual(lead["status"], "needs_review")
        self.open_request()
        self.page.get_by_label("Electrical work", exact=True).fill("Owner still needs to review this request")
        expect(self.page.locator('#lead-status-select option[value="contacted"]')).to_be_disabled()
        expect(self.page.locator('#lead-status-select option[value="closed"]')).to_be_disabled()
        self.api("PATCH", "/api/leads/" + lead["id"], {
            "version": lead["version"], "status": "contacted",
            "job": "Owner still needs to review this request"
        }, status=409)
        stored = self.api("GET", "/api/leads/" + lead["id"])["lead"]
        self.assertTrue(stored["safetyHold"])
        self.assertEqual(stored["status"], "needs_review")
        self.assertEqual(stored["job"], lead["job"])

    def test_customer_text_and_notes_render_as_text_without_script_execution(self):
        self.login()
        payload = '<img src=x onerror="globalThis.fixtureXss=1"> Install a ceiling fan'
        lead = self.create_request(job=payload, conversation=[
            {"role": "customer", "text": payload}
        ])
        self.open_request()
        expect(self.page.get_by_label("Electrical work", exact=True)).to_have_value(payload)
        self.page.get_by_label("Internal notes", exact=True).fill(payload)
        self.save_lead()
        self.page.reload()
        self.assertIsNone(self.page.evaluate("() => globalThis.fixtureXss"))
        self.assertEqual(self.page.locator("#requests-list img, #lead-conversation img, #lead-audit img").count(), 0)
        self.assertEqual(self.api("GET", "/api/leads/" + lead["id"])["lead"]["job"], payload)

    def test_mobile_preview_and_saved_inbox_fit_360_pixels(self):
        self.page.set_viewport_size({"width": 360, "height": 800})
        self.assert_no_overflow()
        self.login()
        self.assert_no_overflow()
        self.open_preview()
        self.send(BUNDLED_MESSAGE)
        self.fill_review()
        self.assert_no_overflow()
        self.capture("private-customer-preview-mobile.jpg")
        self.save_review()
        self.page.locator("#saved-request-link").click()
        expect(self.page.get_by_label("Customer name", exact=True)).to_have_value("Jamie Stone")
        self.assert_no_overflow()
        self.profile_view()
        expect(self.page.get_by_label("Business hours answer", exact=True)).to_be_visible()
        self.assert_no_overflow()

    def test_keyboard_can_sign_in_open_profile_and_reach_preview(self):
        self.login(keyboard=True)
        navigation = self.page.locator("#nav-profile")
        navigation.focus()
        expect(navigation).to_be_focused()
        navigation.press("Enter")
        expect(self.page.get_by_label("Business name", exact=True)).to_be_visible()
        preview = self.page.locator("#preview-link")
        preview.focus()
        preview.press("Enter")
        expect(self.page).to_have_url(self.origin + "/preview")
        message = self.page.get_by_label("Customer message", exact=True)
        expect(message).to_be_enabled()
        message.focus()
        expect(message).to_be_focused()
        self.assertEqual(self.page.locator("#conversation").get_attribute("role"), "log")

    def test_expired_session_during_save_returns_to_login_without_saving(self):
        self.login()
        self.open_preview()
        self.fill_review()
        self.api("POST", "/api/logout", status=204)
        self.allow_http_error(401)
        self.page.get_by_role("button", name="Save request", exact=True).click()
        expect(self.page).to_have_url(re.compile(r"/login(?:\?.*)?$"))
        expect(self.page.get_by_label("Password", exact=True)).to_be_visible()
        expect(self.page.get_by_text("Jamie Stone", exact=True)).to_have_count(0)
        self.login()
        self.assertEqual(self.api("GET", "/api/leads")["leads"], [])

    def test_saved_requests_and_owner_account_survive_server_restart(self):
        self.login()
        lead = self.create_request()
        self.api("POST", "/api/logout", status=204)
        type(self).stop_server()
        type(self).start_server()
        self.login()
        self.open_request()
        expect(self.page.get_by_label("Customer name", exact=True)).to_have_value("Jamie Stone")
        stored = self.api("GET", "/api/leads/" + lead["id"])["lead"]
        self.assertEqual(stored["id"], lead["id"])
        self.assertEqual(stored["version"], lead["version"])
        self.assertEqual(stored["phone"], FIXTURE_PHONE)

    def test_search_and_status_filter_show_matching_saved_requests(self):
        self.login()
        self.create_request()
        closed = self.create_request(customerName="Morgan Example", phone="+15865550102", zip="48084")
        self.api("PATCH", "/api/leads/" + closed["id"], {
            "version": closed["version"], "status": "closed"
        })
        self.page.reload()
        expect(self.page.locator("#requests-list button")).to_have_count(2)
        self.page.get_by_label("Search requests", exact=True).fill("48084")
        expect(self.page.get_by_role("button", name="Open request from Morgan Example", exact=True)).to_be_visible()
        expect(self.page.get_by_role("button", name="Open request from Jamie Stone", exact=True)).to_have_count(0)
        self.page.get_by_label("Search requests", exact=True).fill("")
        self.page.get_by_label("Filter by status", exact=True).select_option("new")
        expect(self.page.get_by_role("button", name="Open request from Jamie Stone", exact=True)).to_be_visible()
        expect(self.page.get_by_role("button", name="Open request from Morgan Example", exact=True)).to_have_count(0)
        self.page.get_by_label("Filter by status", exact=True).select_option("closed")
        expect(self.page.get_by_role("button", name="Open request from Morgan Example", exact=True)).to_be_visible()

    def test_navigation_guard_keeps_or_discards_unsaved_owner_edits(self):
        self.login()
        lead = self.create_request()
        self.open_request()
        self.page.get_by_label("Internal notes", exact=True).fill("Unsaved review context")
        self.page.locator("#nav-profile").click()
        expect(self.page.locator("#navigation-guard")).to_be_visible()
        self.page.get_by_role("button", name="Keep editing", exact=True).click()
        expect(self.page.get_by_label("Internal notes", exact=True)).to_have_value("Unsaved review context")
        self.page.locator("#nav-profile").click()
        self.page.get_by_role("button", name="Discard changes", exact=True).click()
        expect(self.page.get_by_label("Business name", exact=True)).to_be_visible()
        self.assertEqual(self.api("GET", "/api/leads/" + lead["id"])["lead"]["notes"], "")

    def test_refresh_cannot_overwrite_edits_entered_while_the_list_is_loading(self):
        self.login()
        self.create_request()
        self.open_request()
        pending = []

        def hold_list_response(route):
            if route.request.method == "GET":
                pending.append(route)
            else:
                route.continue_()

        self.page.route(self.origin + "/api/leads", hold_list_response)
        self.page.get_by_role("button", name="Refresh", exact=True).click()
        expect(self.page.get_by_role("button", name="Refresh", exact=True)).to_be_disabled()
        self.assertEqual(len(pending), 1)
        notes = self.page.get_by_label("Internal notes", exact=True)
        entered_during_load = notes.is_enabled()
        if entered_during_load:
            notes.fill("Edits entered while refresh was pending.")
        pending[0].continue_()
        expect(self.page.get_by_role("button", name="Refresh", exact=True)).to_be_enabled()
        # Either freeze editing until the read completes or keep new local edits.
        # Both prevent a late read from silently replacing the owner's work.
        expect(notes).to_have_value(
            "Edits entered while refresh was pending." if entered_during_load else ""
        )

    def test_appointment_request_does_not_claim_a_booking_or_create_an_appointment(self):
        self.login()
        self.open_preview()
        self.send(BUNDLED_MESSAGE)
        result = self.send("Can you book me for Friday? Is my appointment confirmed?")
        answers = " ".join(result["replies"]).lower()
        self.assertRegex(answers, r"not (?:a )?(?:confirmed|booked)|cannot (?:book|confirm)|can.t (?:book|confirm)|does not\b[^.]*\bbook\b|no appointment")
        self.assertNotRegex(answers, r"\b(?:you(?:'re| are) booked|your appointment is confirmed)\b")
        self.assertEqual(self.api("GET", "/api/leads")["leads"], [])
        self.fill_review()
        saved = self.save_review()
        self.assertIn(saved["status"], ("new", "needs_review"))
        self.assertNotIn("appointmentId", saved)
        self.assertNotIn("bookingId", saved)

    def test_unrecorded_contact_permission_blocks_marking_request_contacted(self):
        self.login()
        lead = self.create_request(contactPermission="not_recorded")
        self.assertFalse(lead["contactAllowed"])
        self.assertEqual(lead["status"], "needs_review")
        self.open_request()
        expect(self.page.locator('#lead-status-select option[value="contacted"]')).to_be_disabled()
        self.api("PATCH", "/api/leads/" + lead["id"], {
            "version": lead["version"], "status": "contacted"
        }, status=409)
        self.assertEqual(self.api("GET", "/api/leads/" + lead["id"])["lead"]["status"], "needs_review")
        self.page.get_by_label("Contact permission", exact=True).select_option("requested_callback")
        expect(self.page.locator('#lead-status-select option[value="contacted"]')).to_be_enabled()
        self.page.get_by_label("Request status", exact=True).select_option("contacted")
        self.save_lead()
        self.assertEqual(self.api("GET", "/api/leads/" + lead["id"])["lead"]["status"], "contacted")


if __name__ == "__main__":
    unittest.main(verbosity=2)
