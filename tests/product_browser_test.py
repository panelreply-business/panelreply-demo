"""Selected callback/spreadsheet programs on their fixed entrypoints.

Each class initializes a fresh product-bound synthetic data directory and uses
its own product environment variables. Existing combined-workspace suites do
not substitute for these product-specific browser journeys. External requests
remain blocked. No live calls, messages, provider, deployment or customer data.
"""

import json
import re
import subprocess
import unittest
import uuid
from pathlib import Path

from playwright.sync_api import expect
from panel_browser_test import PanelWorkspaceBrowserTests, FIXTURES
from workspace_browser_test import PrivateWorkspaceBrowserTests, FIXTURE_PASSWORD, ROOT


class SelectedProductHarness:
    @classmethod
    def setUpClass(cls):
        cls.product_initialized = False
        super().setUpClass()

    @classmethod
    def start_server(cls):
        prefix = cls.product_id.upper()
        cls.node_env.update({prefix + "_DATA_DIR": str(cls.data_dir),
                             prefix + "_ORIGIN": cls.origin, prefix + "_PORT": str(cls.port)})
        if not cls.product_initialized:
            result = subprocess.run(["node", cls.server_entry, "--init"], cwd=ROOT, env=cls.node_env,
                                    capture_output=True, text=True, timeout=20, check=False)
            if result.returncode:
                raise AssertionError("Synthetic product initialization failed: " + result.stderr)
            initialized = json.loads(result.stdout)
            if initialized.get("product") != cls.product_id or initialized.get("initialized") is not True:
                raise AssertionError("The fixed entrypoint initialized the wrong product")
            cls.product_initialized = True
        super().start_server()

    def setUp(self):
        self.app_requests = []
        super().setUp()
        expect(self.page.locator("body")).to_have_attribute("data-product-id", self.product_id)
        expect(self.page).to_have_title("Sign in · " + self.product_label)

    def route(self, route):
        self.app_requests.append(route.request.url.split("?", 1)[0])
        super().route(route)

    def tearDown(self):
        super().tearDown()
        forbidden = ("/api/panel-projects", "/api/panel-ocr") if self.product_id == "callback" else (
            "/api/leads", "/api/profile", "/api/preview", "/api/assistant")
        unexpected = [url for url in self.app_requests
                      if any(url.startswith(self.origin + prefix) for prefix in forbidden)]
        self.assertEqual(unexpected, [], "The selected UI requested another product's API")

    def login(self, username=None, keyboard=False):
        self.page.goto(self.origin + "/login")
        self.page.get_by_label("Username", exact=True).fill(username or self.username)
        password = self.page.get_by_label("Password", exact=True)
        password.fill(FIXTURE_PASSWORD)
        if keyboard:
            password.press("Enter")
        else:
            self.page.get_by_role("button", name="Sign in", exact=True).click()
        expect(self.page).to_have_url(self.origin + self.home_path)
        expect(self.page.locator("body")).to_have_attribute("data-product-id", self.product_id)
        if self.product_id == "callback":
            expect(self.page.locator("#nav-inbox")).to_be_visible()
            expect(self.page.locator("#business-display")).to_have_text("Example Electric")
        else:
            expect(self.page.locator("#new-project")).to_be_enabled()
        self.assert_product_navigation()

    def assert_product_navigation(self):
        expect(self.page.locator("body")).to_have_attribute("data-product-id", self.product_id)
        self.assertIn(self.product_label, self.page.title())
        self.assertEqual(self.page.locator('a[href^="/dashboard"]').count(), 0)
        if self.product_id == "callback":
            self.assertEqual(self.page.locator('a[href^="/panels"]').count(), 0)
        else:
            self.assertEqual(self.page.locator('a[href="/"], a[href^="/preview"], a[href="/#settings"]').count(), 0)

    def assert_routes_denied(self, paths):
        for path in paths:
            response = self.context.request.get(self.origin + path)
            self.assertEqual(response.status, 404, path)

    def assert_no_overflow(self):
        try:
            super().assert_no_overflow()
        except AssertionError as error:
            # Report geometry only after a failure. Do not log field values or
            # text, change the page, or filter the original viewport assertions.
            try:
                geometry = self.page.evaluate("""() => {
                  const round = value => Math.round(value * 100) / 100;
                  const measure = element => {
                    const rect = element.getBoundingClientRect();
                    const style = getComputedStyle(element);
                    if (!element.getClientRects().length || !rect.width || !rect.height ||
                        style.visibility === 'hidden' || element.matches('.sr-only, .skip-link')) return null;
                    const outside = Math.max(0, rect.right - innerWidth, -rect.left);
                    const inside = Math.max(0, element.scrollWidth - element.clientWidth);
                    const control = element.matches('input, select, textarea') ? element :
                      element.matches('.form-field, .select-control') ?
                        element.querySelector('input, select, textarea') : null;
                    return {tag: element.tagName.toLowerCase(), id: element.id,
                      controlId: control ? control.id : null,
                      classes: element.getAttribute('class') || '', type: element.getAttribute('type'),
                      left: round(rect.left), right: round(rect.right), width: round(rect.width),
                      clientWidth: element.clientWidth, scrollWidth: element.scrollWidth,
                      outside: round(outside), inside, fontSize: style.fontSize,
                      minWidth: style.minWidth, maxWidth: style.maxWidth,
                      display: style.display, gridColumns: style.gridTemplateColumns,
                      appearance: style.appearance, boxSizing: style.boxSizing,
                      overflowX: style.overflowX, whiteSpace: style.whiteSpace};
                  };
                  const overflow = [...document.querySelectorAll('body *')].map(measure)
                    .filter(item => item && (item.outside > 1 || item.inside > 1))
                    .sort((a, b) => b.outside - a.outside || b.inside - a.inside).slice(0, 24);
                  const controls = [...document.querySelectorAll(
                    '.inbox-grid input, .inbox-grid select, .inbox-grid textarea, .inbox-grid .select-control')]
                    .map(measure).filter(Boolean).slice(0, 24);
                  return {overflow, controls};
                }""")
            except Exception as diagnostic_error:
                geometry = {"diagnosticError": type(diagnostic_error).__name__}
            self.fail(str(error) + "\nOverflow geometry: " + json.dumps(geometry))


class CallbackProductBrowserTests(SelectedProductHarness, PrivateWorkspaceBrowserTests):
    product_id = "callback"
    product_scope = "callback"
    product_label = "PanelReply Callback"
    home_path = "/"
    server_entry = "callback-server.cjs"

    def test_callback_login_navigation_and_server_boundaries(self):
        self.login(keyboard=True)
        product = self.api("GET", "/api/session")["product"]
        self.assertEqual(product["id"], "callback")
        self.assertEqual(product["homePath"], "/")
        self.assertTrue(product["capabilities"]["intake"])
        self.assertFalse(product["capabilities"]["panelProjects"])
        self.assert_routes_denied(["/panels", "/dashboard", "/assets/panels.js", "/assets/dashboard.js",
                                  "/api/panel-projects", "/api/panel-ocr"])

    def test_callback_review_save_and_reopen_without_spreadsheet_requests(self):
        self.login()
        self.open_preview()
        self.assert_product_navigation()
        self.fill_review(customerName="Synthetic Callback Owner", job="Replace the garage outlet")
        saved = self.save_review()
        self.page.locator("#saved-request-link").click()
        expect(self.page.get_by_label("Customer name", exact=True)).to_have_value("Synthetic Callback Owner")
        self.page.get_by_label("Internal notes", exact=True).fill("Callback program review")
        self.save_lead()
        self.page.reload()
        expect(self.page.get_by_label("Internal notes", exact=True)).to_have_value("Callback program review")
        self.assertEqual(self.api("GET", "/api/leads/" + saved["id"])["lead"]["notes"], "Callback program review")
        self.assert_product_navigation()

    def test_callback_request_receipts_retain_drafts_and_confirm_current_state(self):
        self.login()
        saved = self.create_request(customerName="Synthetic Request Receipt")
        self.open_callback_request(saved)
        url = self.origin + "/api/leads/" + saved["id"]
        commands = []
        for status in (403, 409, 503):
            self.allow_http_error(status)

        def interrupt_receipts(route):
            if route.request.method != "PATCH":
                route.continue_()
                return
            commands.append((route.request.headers.get("idempotency-key"), route.request.post_data_json))
            if len(commands) in (1, 4):
                response = route.fetch()
                self.assertEqual(response.status, 200)
                if len(commands) == 1:
                    delivered = response.json()
                    delivered["lead"]["id"] = str(uuid.uuid4())
                    route.fulfill(status=200, content_type="application/json", body=json.dumps(delivered))
                else:
                    route.fulfill(status=503, content_type="application/json", body=json.dumps({"error": {
                        "code": "synthetic_response_loss", "message": "Synthetic response lost after a committed request save."
                    }}))
            elif len(commands) == 2:
                route.fulfill(status=403, content_type="application/json", body=json.dumps({"error": {
                    "code": "forbidden", "message": "Synthetic later refusal."
                }}))
            else:
                route.continue_()

        self.page.route(url, interrupt_receipts)
        notes = self.page.get_by_label("Internal notes", exact=True)
        notes.fill("  Keep the first request draft  ")
        with self.page.expect_response(lambda response: response.url == url and response.request.method == "PATCH") as first:
            self.page.locator("#save-lead").click()
        self.assertEqual(first.value.status, 200)
        self.assertNotEqual(first.value.json()["lead"]["id"], saved["id"])
        expect(self.page.locator("#lead-error")).to_contain_text("did not confirm")
        expect(notes).to_have_value("  Keep the first request draft  ")
        expect(notes).to_be_disabled()
        expect(self.page.locator("#lead-version")).to_have_text("Revision " + str(saved["version"]))
        expect(self.page.locator("#lead-status")).to_be_empty()
        expect(self.page.locator("#save-lead")).to_have_text("Retry save")
        expect(self.page.locator("#export-records")).to_be_disabled()
        self.page.locator("#nav-profile").click()
        expect(self.page.locator("#inbox-view")).to_be_visible()
        expect(self.page.locator("#app-error")).to_contain_text("unconfirmed")
        with self.page.expect_response(lambda response: response.url == url and response.request.method == "PATCH") as refusal:
            self.page.locator("#save-lead").click()
        self.assertEqual(refusal.value.status, 403)
        expect(self.page.locator("#lead-error")).to_contain_text("Synthetic later refusal")
        expect(notes).to_have_value("  Keep the first request draft  ")
        expect(notes).to_be_disabled()
        with self.page.expect_response(lambda response: response.url == url and response.request.method == "PATCH") as retry:
            self.page.locator("#save-lead").click()
        self.assertEqual(retry.value.status, 409)
        expect(self.page.locator("#lead-status")).to_contain_text("Saved values confirmed")
        expect(notes).to_have_value("Keep the first request draft")
        expect(notes).to_be_enabled()
        expect(self.page.locator("#lead-dirty")).not_to_be_visible()
        expect(self.page.locator("#lead-version")).to_have_text("Revision " + str(saved["version"] + 1))
        self.assertEqual(len(commands), 3)
        self.assertIsNone(commands[0][0])
        self.assertEqual(commands, [commands[0]] * 3)
        confirmed = self.api("GET", "/api/leads/" + saved["id"])["lead"]
        self.assertEqual(confirmed["version"], saved["version"] + 1)
        self.assertEqual(sum(entry["action"] == "lead.updated" for entry in confirmed["audit"]), 1)

        notes.fill("  Keep the next draft until I review the saved record  ")
        self.save_lead(503)
        expect(notes).to_have_value("  Keep the next draft until I review the saved record  ")
        expect(notes).to_be_disabled()
        self.create_request(customerName="Synthetic Later Opt Out", phone=saved["phone"], contactPermission="opted_out")
        restricted = self.api("GET", "/api/leads/" + saved["id"])["lead"]
        self.assertEqual(restricted["contactPermission"], "opted_out")
        self.assertEqual(restricted["status"], "needs_review")
        self.assertFalse(restricted["contactAllowed"])
        with self.page.expect_response(lambda response: response.url == url and response.request.method == "PATCH") as conflict:
            self.page.locator("#save-lead").click()
        self.assertEqual(conflict.value.status, 409)
        expect(self.page.locator("#lead-conflict")).to_be_visible()
        expect(self.page.locator("#lead-error")).to_contain_text("now differs")
        expect(self.page.locator("#lead-version")).to_have_text("Revision " + str(saved["version"] + 1))
        expect(notes).to_have_value("  Keep the next draft until I review the saved record  ")
        expect(self.page.locator("#save-lead")).to_be_disabled()
        self.page.locator("#reload-lead").click()
        expect(self.page.locator("#navigation-guard")).to_be_visible()
        expect(self.page.locator("#guard-description")).to_contain_text("previous save may have completed")
        self.page.locator("#keep-editing").click()
        expect(notes).to_have_value("  Keep the next draft until I review the saved record  ")
        expect(notes).to_be_disabled()
        self.page.locator("#reload-lead").click()
        self.page.locator("#discard-changes").click()
        expect(self.page.locator("#lead-status")).to_contain_text("Previous save outcome not established")
        expect(self.page.locator("#lead-version")).to_have_text("Revision " + str(restricted["version"]))
        expect(notes).to_have_value(restricted["notes"])
        expect(self.page.locator("#lead-permission")).to_have_value("opted_out")
        expect(self.page.locator("#lead-dirty")).not_to_be_visible()
        expect(self.page.locator("#save-callback-task")).to_be_disabled()
        self.assertEqual(len(commands), 5)
        self.assertIsNone(commands[3][0])
        self.assertEqual(commands[3], commands[4])
        final = self.api("GET", "/api/leads/" + saved["id"])["lead"]
        self.assertEqual(final, restricted)
        self.assertEqual(sum(entry["action"] == "lead.updated" for entry in final["audit"]), 2)
        self.assert_product_navigation()

    def test_callback_uncertain_request_reload_requires_owner_choice_and_valid_current_record(self):
        self.login()
        saved = self.create_request(customerName="Synthetic Unconfirmed Reload")
        self.open_callback_request(saved)
        url = self.origin + "/api/leads/" + saved["id"]
        commands, reads = [], []
        for status in (403, 503):
            self.allow_http_error(status)

        def refuse_write_and_corrupt_one_read(route):
            if route.request.method == "PATCH":
                commands.append((route.request.headers.get("idempotency-key"), route.request.post_data_json))
                route.fulfill(status=503 if len(commands) == 1 else 403, content_type="application/json",
                              body=json.dumps({"error": {"code": "synthetic_refusal", "message": "Synthetic unconfirmed save refusal."}}))
                return
            self.assertEqual(route.request.method, "GET")
            reads.append(route.request.url)
            if len(reads) == 1:
                response = route.fetch()
                self.assertEqual(response.status, 200)
                delivered = response.json()
                delivered["lead"]["id"] = str(uuid.uuid4())
                route.fulfill(status=200, content_type="application/json", body=json.dumps(delivered))
            else:
                route.continue_()

        self.page.route(url, refuse_write_and_corrupt_one_read)
        notes = self.page.get_by_label("Internal notes", exact=True)
        notes.fill("Keep this draft until I choose the saved version")
        self.save_lead(503)
        expect(self.page.locator("#lead-uncertain")).to_be_visible()
        expect(self.page.locator("#lead-conflict")).not_to_be_visible()
        with self.page.expect_response(lambda response: response.url == url and response.request.method == "PATCH") as retry:
            self.page.locator("#save-lead").click()
        self.assertEqual(retry.value.status, 403)
        expect(self.page.locator("#lead-error")).to_contain_text("Synthetic unconfirmed save refusal")
        expect(notes).to_have_value("Keep this draft until I choose the saved version")
        expect(notes).to_be_disabled()
        self.page.locator("#reload-uncertain-lead").click()
        expect(self.page.locator("#navigation-guard")).to_be_visible()
        expect(self.page.locator("#guard-description")).to_contain_text("previous save may have completed")
        self.page.locator("#keep-editing").click()
        expect(self.page.locator("#navigation-guard")).not_to_be_visible()
        expect(notes).to_have_value("Keep this draft until I choose the saved version")
        self.assertEqual(reads, [])
        self.page.locator("#reload-uncertain-lead").click()
        self.page.locator("#discard-changes").click()
        expect(self.page.locator("#lead-error")).to_contain_text("saved request details were incomplete")
        expect(self.page.locator("#lead-uncertain")).to_be_visible()
        expect(notes).to_have_value("Keep this draft until I choose the saved version")
        expect(notes).to_be_disabled()
        expect(self.page.locator("#lead-version")).to_have_text("Revision " + str(saved["version"]))
        self.assertEqual(len(reads), 1)
        self.page.locator("#reload-uncertain-lead").click()
        self.page.locator("#discard-changes").click()
        expect(self.page.locator("#lead-status")).to_contain_text("Saved version loaded. Previous save outcome not established")
        expect(self.page.locator("#lead-uncertain")).not_to_be_visible()
        expect(self.page.locator("#lead-conflict")).not_to_be_visible()
        expect(notes).to_have_value(saved["notes"])
        expect(notes).to_be_enabled()
        expect(self.page.locator("#lead-version")).to_have_text("Revision " + str(saved["version"]))
        expect(self.page.locator("#lead-dirty")).not_to_be_visible()
        self.assertEqual(len(reads), 2)
        self.assertEqual(len(commands), 2)
        self.assertIsNone(commands[0][0])
        self.assertEqual(commands[0], commands[1])
        current = self.api("GET", "/api/leads/" + saved["id"])["lead"]
        self.assertEqual(current, saved)
        self.assertEqual(sum(entry["action"] == "lead.updated" for entry in current["audit"]), 0)
        self.assert_product_navigation()

    def test_callback_approved_business_answers_stay_in_this_program(self):
        PrivateWorkspaceBrowserTests.test_approved_profile_answer_persists_and_is_used_by_preview(self)
        self.assert_product_navigation()
        self.assert_routes_denied(["/api/panel-projects"])

    def test_callback_stop_persists_without_another_product_or_live_provider(self):
        PrivateWorkspaceBrowserTests.test_stop_before_save_survives_start_reset_and_later_request(self)
        self.assert_product_navigation()
        self.assertFalse(self.api("GET", "/api/assistant")["liveEnabled"])

    def test_callback_data_survives_fixed_entrypoint_restart(self):
        self.login()
        saved = self.create_request(customerName="Synthetic Callback Restart")
        type(self).stop_server()
        type(self).start_server()
        self.page.reload()
        self.assertEqual(self.api("GET", "/api/leads/" + saved["id"])["lead"]["customerName"], "Synthetic Callback Restart")
        self.assert_product_navigation()

    def test_callback_layout_and_navigation_at_phone_tablet_desktop_widths(self):
        self.login()
        for width in [360, 768, 1440]:
            with self.subTest(width=width):
                self.page.set_viewport_size({"width": width, "height": 900})
                self.assert_no_overflow()
                self.assert_product_navigation()
                self.page.locator("#nav-profile").click()
                expect(self.page.get_by_label("Business name", exact=True)).to_be_visible()
                self.page.locator("#nav-inbox").click()
                expect(self.page.locator("#inbox-view")).to_be_visible()

    def test_callback_sign_out_revokes_its_named_program_session(self):
        self.login()
        cookies = [item["name"] for item in self.context.cookies()]
        self.assertIn("PanelReplyCallbackLocalSession", cookies)
        self.assertNotIn("PanelReplySpreadsheetLocalSession", cookies)
        # A short desktop/tablet viewport must still expose the session control.
        # The sticky menu must scroll within the screen instead of placing the
        # sign-out button below a fixed minimum-height sidebar.
        self.page.set_viewport_size({"width": 1024, "height": 480})
        self.page.locator("#sign-out").click()
        expect(self.page).to_have_url(self.origin + "/login")
        self.api("GET", "/api/session", status=401)
        self.assertEqual(self.page.evaluate("localStorage.length + sessionStorage.length"), 0)

    def open_callback_request(self, saved):
        self.page.goto(self.origin + "/?lead=" + saved["id"])
        expect(self.page.locator("#lead-name")).to_have_value(saved["customerName"])
        expect(self.page.locator("#lead-task-status")).to_have_text(re.compile(r"^\d+ of \d+ saved tasks?\.$"))

    def fill_callback_time(self, local="2026-12-01T09:30", zone="America/Detroit"):
        self.page.get_by_label("Time zone", exact=True).fill(zone)
        self.page.get_by_label("Callback date and time", exact=True).fill(local)

    def submit_callback_task(self, expected_status=201):
        if expected_status >= 400:
            self.allow_http_error(expected_status)
        with self.page.expect_response(lambda response: response.request.method in ("POST", "PATCH")
                                       and ("/tasks" in response.url or "/api/callback-tasks/" in response.url)) as pending:
            self.page.locator("#save-callback-task").click()
        self.assertEqual(pending.value.status, expected_status, pending.value.text())
        result = pending.value.json()
        if expected_status < 400:
            expect(self.page.locator("#task-save-status")).not_to_be_empty()
            expect(self.page.locator("#lead-task-status")).to_have_text(re.compile(r"^\d+ of \d+ saved tasks?\.$"))
        return result

    def seed_callback_task(self, saved, due="2020-01-01T15:00:00.000Z", kind="callback"):
        return self.api("POST", "/api/leads/" + saved["id"] + "/tasks", {
            "leadVersion": saved["version"], "kind": kind, "dueAt": due,
            "timeZone": "America/Detroit", "notes": "Synthetic scheduled task"
        }, status=201, headers={"Idempotency-Key": uuid.uuid4().hex})

    def test_callback_schedule_reschedule_outcome_and_follow_up_persist(self):
        self.login()
        saved = self.create_request(customerName="Synthetic Scheduled Callback")
        self.open_callback_request(saved)
        self.fill_callback_time()
        self.page.get_by_label("Task notes", exact=True).fill("First callback plan")
        first = self.submit_callback_task()
        self.assertEqual(first["task"]["dueAt"], "2026-12-01T14:30:00.000Z")
        self.assertEqual(first["task"]["timeZone"], "America/Detroit")
        self.assertEqual(first["lead"]["version"], saved["version"] + 1)
        self.page.reload()
        card = self.page.locator("#lead-task-list > li").first
        expect(card).to_contain_text("First callback plan")
        card.get_by_role("button", name="Reschedule", exact=True).click()
        self.fill_callback_time("2026-12-02T10:15")
        updated = self.submit_callback_task(200)
        self.assertEqual(updated["task"]["dueAt"], "2026-12-02T15:15:00.000Z")
        self.assertEqual(updated["task"]["version"], 2)
        card.get_by_role("button", name="Record outcome", exact=True).click()
        self.page.get_by_label("Call outcome", exact=True).select_option("no_answer")
        self.page.get_by_label("Task notes", exact=True).fill("No answer during the operator's test call")
        complete = self.submit_callback_task(200)
        self.assertEqual(complete["task"]["status"], "completed")
        self.assertEqual(complete["task"]["outcome"], "no_answer")
        self.page.get_by_label("Task type", exact=True).select_option("follow_up")
        self.fill_callback_time("2026-12-03T11:00")
        follow = self.submit_callback_task()
        self.assertEqual(follow["task"]["kind"], "follow_up")
        self.assertNotEqual(follow["task"]["id"], first["task"]["id"])
        type(self).stop_server()
        type(self).start_server()
        self.page.reload()
        expect(self.page.locator("#lead-task-list > li")).to_have_count(2)
        tasks = self.api("GET", "/api/callback-tasks?state=all&leadId=" + saved["id"])["tasks"]
        self.assertEqual({task["status"] for task in tasks}, {"scheduled", "completed"})
        self.assert_product_navigation()
        self.capture("callback-scheduled-tasks.jpg")

    def test_callback_queue_filters_overdue_completed_and_open_requests(self):
        self.login()
        saved = self.create_request(customerName="Synthetic Queue Customer")
        first = self.seed_callback_task(saved)
        second = self.seed_callback_task(first["lead"], "2099-01-01T15:00:00.000Z", "follow_up")
        self.page.locator("#nav-schedule").click()
        expect(self.page).to_have_title("Callback queue · PanelReply Callback")
        expect(self.page.locator("#callback-queue-list > li")).to_have_count(2)
        self.page.get_by_label("Show tasks", exact=True).select_option("due")
        expect(self.page.locator("#callback-queue-list > li")).to_have_count(1)
        expect(self.page.locator("#callback-queue-list")).to_contain_text("Overdue")
        self.page.locator("#callback-queue-list").get_by_role("button", name="Open request", exact=False).click()
        expect(self.page.locator("#lead-name")).to_have_value(saved["customerName"])
        self.assertEqual(self.api("GET", "/api/leads/" + saved["id"])["lead"]["version"], second["lead"]["version"])
        self.page.locator("#nav-schedule").click()
        self.page.get_by_label("Show tasks", exact=True).select_option("completed")
        expect(self.page.locator("#callback-queue-list")).to_contain_text("No tasks match")
        self.assert_product_navigation()
        self.capture("callback-queue.jpg")

    def test_callback_task_clock_changes_require_an_exact_occurrence(self):
        self.login()
        saved = self.create_request()
        self.open_callback_request(saved)
        self.fill_callback_time("2026-03-08T02:30")
        expect(self.page.locator("#task-time-preview")).to_contain_text("does not exist")
        self.page.locator("#save-callback-task").click()
        self.assertEqual(self.api("GET", "/api/callback-tasks?state=all")["tasks"], [])
        self.fill_callback_time("2026-11-01T01:30")
        expect(self.page.get_by_label("Which occurrence?", exact=True)).to_be_visible()
        self.page.locator("#save-callback-task").click()
        self.assertEqual(self.api("GET", "/api/callback-tasks?state=all")["tasks"], [])
        self.page.get_by_label("Which occurrence?", exact=True).select_option("2026-11-01T06:30:00.000Z")
        expect(self.page.locator("#task-time-preview")).to_contain_text("2026-11-01T06:30:00.000Z")
        result = self.submit_callback_task()
        self.assertEqual(result["task"]["dueAt"], "2026-11-01T06:30:00.000Z")

    def test_callback_task_uncertain_save_retries_once_without_duplicate_task(self):
        self.login()
        saved = self.create_request()
        self.open_callback_request(saved)
        self.fill_callback_time()
        requests = []
        self.allow_http_error(503)
        def lose_first_reply(route):
            if route.request.method != "POST":
                route.continue_()
                return
            requests.append((route.request.headers.get("idempotency-key"), route.request.post_data_json))
            if len(requests) == 1:
                self.assertEqual(route.fetch().status, 201)
                route.fulfill(status=503, content_type="application/json", body=json.dumps({"error": {
                    "code": "synthetic_response_loss", "message": "Synthetic reply interrupted after the save."
                }}))
            else:
                route.continue_()
        self.page.route(self.origin + "/api/leads/" + saved["id"] + "/tasks", lose_first_reply)
        self.submit_callback_task(503)
        expect(self.page.locator("#task-uncertain")).to_be_visible()
        expect(self.page.get_by_label("Task notes", exact=True)).to_be_disabled()
        self.page.locator("#nav-profile").click()
        expect(self.page.locator("#inbox-view")).to_be_visible()
        expect(self.page.locator("#app-error")).to_contain_text("pending task save")
        self.page.locator("#retry-task-save").click()
        expect(self.page.locator("#task-uncertain")).not_to_be_visible()
        expect(self.page.locator("#task-save-status")).to_contain_text("Task scheduled")
        self.assertEqual(len(requests), 2)
        self.assertEqual(requests[0], requests[1])
        self.assertEqual(len(self.api("GET", "/api/callback-tasks?state=all")["tasks"]), 1)

    def test_callback_corrupt_task_receipts_preserve_drafts_until_matching_replays(self):
        self.login()
        saved = self.create_request(customerName="Synthetic Receipt Check")
        self.open_callback_request(saved)
        self.fill_callback_time()
        self.page.get_by_label("Task notes", exact=True).fill("Keep this creation draft")
        create_url = self.origin + "/api/leads/" + saved["id"] + "/tasks"
        create_commands, create_receipts = [], []

        def corrupt_parent_once(route):
            self.assertEqual(route.request.method, "POST")
            create_commands.append((route.request.headers.get("idempotency-key"), route.request.post_data_json))
            response = route.fetch()
            self.assertEqual(response.status, 201 if len(create_commands) == 1 else 200)
            actual = response.json()
            create_receipts.append(actual)
            delivered = json.loads(json.dumps(actual))
            if len(create_commands) == 1:
                delivered["lead"]["audit"] = [None]
            route.fulfill(status=response.status, content_type="application/json", body=json.dumps(delivered))

        self.page.route(create_url, corrupt_parent_once)
        with self.page.expect_response(lambda response: response.url == create_url and response.request.method == "POST") as first:
            self.page.locator("#save-callback-task").click()
        self.assertEqual(first.value.status, 201)
        expect(self.page.locator("#task-error")).to_contain_text("incomplete")
        expect(self.page.locator("#task-uncertain")).to_be_visible()
        expect(self.page.locator("#retry-task-save")).to_be_enabled()
        expect(self.page.get_by_label("Task notes", exact=True)).to_have_value("Keep this creation draft")
        expect(self.page.get_by_label("Callback date and time", exact=True)).to_have_value("2026-12-01T09:30")
        expect(self.page.locator("#lead-version")).to_have_text("Revision " + str(saved["version"]))
        expect(self.page.locator("#task-save-status")).to_be_empty()
        with self.page.expect_response(lambda response: response.url == create_url and response.request.method == "POST") as retry:
            self.page.locator("#retry-task-save").click()
        self.assertEqual(retry.value.status, 200)
        self.assertTrue(retry.value.json()["replayed"])
        expect(self.page.locator("#task-uncertain")).not_to_be_visible()
        expect(self.page.locator("#task-save-status")).to_contain_text("Task scheduled")
        self.assertEqual(len(create_commands), 2)
        self.assertTrue(create_commands[0][0])
        self.assertEqual(create_commands[0], create_commands[1])
        self.assertEqual(create_receipts[0]["task"]["id"], create_receipts[1]["task"]["id"])

        task_id = create_receipts[0]["task"]["id"]
        card = self.page.locator('#lead-task-list [data-task-id="' + task_id + '"]')
        expect(card).to_contain_text("Keep this creation draft")
        card.get_by_role("button", name="Record outcome", exact=True).click()
        self.page.get_by_label("Call outcome", exact=True).select_option("no_answer")
        self.page.get_by_label("Task notes", exact=True).fill("Keep this outcome draft")
        update_url = self.origin + "/api/callback-tasks/" + task_id
        update_commands, update_receipts = [], []

        def corrupt_task_once(route):
            self.assertEqual(route.request.method, "PATCH")
            update_commands.append((route.request.headers.get("idempotency-key"), route.request.post_data_json))
            response = route.fetch()
            self.assertEqual(response.status, 200)
            actual = response.json()
            update_receipts.append(actual)
            delivered = json.loads(json.dumps(actual))
            if len(update_commands) == 1:
                delivered["task"]["id"] = str(uuid.uuid4())
            route.fulfill(status=200, content_type="application/json", body=json.dumps(delivered))

        self.page.route(update_url, corrupt_task_once)
        with self.page.expect_response(lambda response: response.url == update_url and response.request.method == "PATCH") as update:
            self.page.locator("#save-callback-task").click()
        self.assertEqual(update.value.status, 200)
        self.assertNotEqual(update.value.json()["task"]["id"], task_id)
        expect(self.page.locator("#task-error")).to_contain_text("incomplete")
        expect(self.page.locator("#task-uncertain")).to_be_visible()
        expect(self.page.get_by_label("Task notes", exact=True)).to_have_value("Keep this outcome draft")
        expect(self.page.get_by_label("Call outcome", exact=True)).to_have_value("no_answer")
        expect(self.page.locator("#lead-version")).to_have_text("Revision " + str(saved["version"] + 1))
        expect(self.page.locator("#task-save-status")).to_be_empty()
        with self.page.expect_response(lambda response: response.url == update_url and response.request.method == "PATCH") as update_retry:
            self.page.locator("#retry-task-save").click()
        self.assertEqual(update_retry.value.status, 200)
        self.assertTrue(update_retry.value.json()["replayed"])
        expect(self.page.locator("#task-uncertain")).not_to_be_visible()
        expect(self.page.locator("#task-save-status")).to_contain_text("Call outcome saved")
        self.assertEqual(len(update_commands), 2)
        self.assertTrue(update_commands[0][0])
        self.assertEqual(update_commands[0], update_commands[1])
        self.assertEqual([receipt["task"]["id"] for receipt in update_receipts], [task_id, task_id])
        self.assertEqual([receipt["task"]["version"] for receipt in update_receipts], [2, 2])
        tasks = self.api("GET", "/api/callback-tasks?state=all&leadId=" + saved["id"])["tasks"]
        self.assertEqual(len(tasks), 1)
        self.assertEqual(tasks[0]["id"], task_id)
        self.assertEqual(tasks[0]["status"], "completed")
        self.assertEqual(tasks[0]["outcome"], "no_answer")
        self.assertEqual(tasks[0]["notes"], "Keep this outcome draft")
        self.assertEqual(self.api("GET", "/api/leads/" + saved["id"])["lead"]["version"], saved["version"] + 2)
        self.assert_product_navigation()

    def test_callback_task_concurrent_edit_keeps_draft_and_requires_reload(self):
        self.login()
        saved = self.create_request()
        self.open_callback_request(saved)
        self.fill_callback_time()
        self.page.get_by_label("Task notes", exact=True).fill("Retain this draft after the conflict")
        self.seed_callback_task(saved)
        self.submit_callback_task(409)
        expect(self.page.locator("#task-conflict")).to_be_visible()
        expect(self.page.get_by_label("Task notes", exact=True)).to_have_value("Retain this draft after the conflict")
        expect(self.page.locator("#save-callback-task")).to_be_disabled()
        self.page.locator("#reload-task-request").click()
        expect(self.page.locator("#navigation-guard")).to_be_visible()
        self.page.locator("#discard-changes").click()
        expect(self.page.locator("#task-conflict")).not_to_be_visible()
        expect(self.page.locator("#lead-task-list > li")).to_have_count(1)
        expect(self.page.locator("#lead-version")).to_have_text("Revision 2")

    def test_callback_closed_and_opted_out_tasks_can_be_cancelled_but_not_contacted(self):
        self.login()
        saved = self.create_request()
        self.seed_callback_task(saved)
        self.open_callback_request(saved)
        self.page.get_by_label("Contact permission", exact=True).select_option("opted_out")
        self.page.get_by_label("Request status", exact=True).select_option("closed")
        self.save_lead()
        card = self.page.locator("#lead-task-list > li").first
        expect(card).to_contain_text("Blocked")
        expect(card.get_by_role("button", name="Record outcome", exact=True)).to_be_disabled()
        expect(card.get_by_role("button", name="Reschedule", exact=True)).to_be_disabled()
        card.get_by_role("button", name="Cancel task", exact=True).click()
        self.page.get_by_label("Task notes", exact=True).fill("Cancelled after opt-out")
        cancelled = self.submit_callback_task(200)
        self.assertEqual(cancelled["task"]["status"], "cancelled")
        self.assertTrue(cancelled["lead"]["optedOut"])
        expect(self.page.locator("#save-callback-task")).to_be_disabled()
        self.page.locator("#nav-schedule").click()
        self.page.get_by_label("Show tasks", exact=True).select_option("cancelled")
        expect(self.page.locator("#callback-queue-list")).to_contain_text("Cancelled after opt-out")

    def test_callback_task_form_preserves_unsaved_edits_and_keyboard_labels(self):
        self.login()
        saved = self.create_request()
        self.open_callback_request(saved)
        self.fill_callback_time()
        zone = self.page.get_by_label("Time zone", exact=True)
        zone.focus()
        self.page.keyboard.press("Tab")
        expect(self.page.get_by_label("Task notes", exact=True)).to_be_focused()
        self.page.keyboard.type("Keyboard schedule draft")
        self.page.locator("#nav-schedule").click()
        expect(self.page.locator("#navigation-guard")).to_be_visible()
        self.page.locator("#keep-editing").click()
        expect(self.page.get_by_label("Task notes", exact=True)).to_have_value("Keyboard schedule draft")
        for width in [320, 768, 1440]:
            with self.subTest(width=width):
                self.page.set_viewport_size({"width": width, "height": 1000})
                self.assert_no_overflow()
        self.page.set_viewport_size({"width": 320, "height": 1000})
        original_font = self.page.locator("html").evaluate("e => parseFloat(getComputedStyle(e).fontSize)")
        original_body_font = self.page.locator("body").evaluate("e => parseFloat(getComputedStyle(e).fontSize)")
        control_selectors = ["#lead-permission", "#task-local-time", "#task-time-zone",
                             "#task-notes", "#save-callback-task"]
        control_fonts = {selector: self.page.locator(selector).evaluate(
            "e => parseFloat(getComputedStyle(e).fontSize)") for selector in control_selectors}
        # Use CSSOM to exercise font scaling without inserting an inline style
        # element that the application's strict stylesheet CSP must reject.
        self.page.evaluate("size => document.documentElement.style.fontSize = size + 'px'", original_font * 2)
        scaled_font = self.page.locator("html").evaluate("e => parseFloat(getComputedStyle(e).fontSize)")
        scaled_body_font = self.page.locator("body").evaluate("e => parseFloat(getComputedStyle(e).fontSize)")
        self.assertAlmostEqual(scaled_font, original_font * 2, places=2)
        self.assertAlmostEqual(scaled_body_font, original_body_font * 2, places=2)
        for selector, original_control_font in control_fonts.items():
            with self.subTest(control=selector):
                scaled_control_font = self.page.locator(selector).evaluate(
                    "e => parseFloat(getComputedStyle(e).fontSize)")
                self.assertAlmostEqual(scaled_control_font, original_control_font * 2, places=2)
        self.assert_no_overflow()
        # A clipped parent can hide an off-screen action without increasing
        # document width. Require the actual controls to stay on screen too.
        for selector in ["#refresh-requests", *control_selectors]:
            with self.subTest(enlarged_control=selector):
                bounds = self.page.locator(selector).bounding_box()
                self.assertIsNotNone(bounds)
                self.assertGreaterEqual(bounds["x"], 0)
                self.assertLessEqual(bounds["x"] + bounds["width"], 321)
        # A task draft deliberately locks request edits. Do not try to focus
        # disabled request fields before resolving that draft.
        expect(self.page.get_by_label("Contact permission", exact=True)).to_be_disabled()
        expect(self.page.get_by_label("Internal notes", exact=True)).to_be_disabled()
        self.page.locator("#nav-schedule").click()
        self.page.locator("#discard-changes").click()
        expect(self.page.locator("#schedule-view")).to_be_visible()
        self.assert_no_overflow()
        queue_refresh = self.page.locator("#refresh-callback-queue").bounding_box()
        self.assertIsNotNone(queue_refresh)
        self.assertGreaterEqual(queue_refresh["x"], 0)
        self.assertLessEqual(queue_refresh["x"] + queue_refresh["width"], 321)
        self.assertEqual(self.api("GET", "/api/callback-tasks?state=all")["tasks"], [])
        self.page.locator("#nav-inbox").click()
        expect(self.page.locator("#inbox-view")).to_be_visible()
        permission = self.page.get_by_label("Contact permission", exact=True)
        expect(permission).to_be_enabled()
        expect(self.page.get_by_label("Internal notes", exact=True)).to_be_enabled()
        self.assertAlmostEqual(permission.evaluate("e => parseFloat(getComputedStyle(e).fontSize)"),
                               control_fonts["#lead-permission"] * 2, places=2)
        permission.focus()
        expect(permission).to_be_focused()
        self.page.keyboard.press("Tab")
        expect(self.page.get_by_label("Internal notes", exact=True)).to_be_focused()
        self.page.keyboard.press("Shift+Tab")
        expect(permission).to_be_focused()
        focus_style = permission.evaluate("""e => {
          const style = getComputedStyle(e);
          return {visible: e.matches(':focus-visible'), outline: style.outlineStyle,
                  width: parseFloat(style.outlineWidth)};
        }""")
        self.assertTrue(focus_style["visible"])
        self.assertEqual(focus_style["outline"], "solid")
        self.assertGreaterEqual(focus_style["width"], 2)
        self.page.keyboard.press("Tab")
        expect(self.page.get_by_label("Internal notes", exact=True)).to_be_focused()

    def test_callback_export_and_request_deletion_include_task_records(self):
        self.login()
        saved = self.create_request()
        task = self.seed_callback_task(saved)
        self.open_callback_request(saved)
        with self.page.expect_download() as pending:
            self.page.locator("#export-records").click()
        download = pending.value
        self.assertIsNone(download.failure())
        content = json.loads(Path(download.path()).read_text())
        self.assertEqual(content["version"], 2)
        self.assertEqual(content["callbackTasks"][0]["id"], task["task"]["id"])
        self.page.locator("#delete-lead").click()
        dialog = self.page.get_by_role("dialog")
        expect(dialog).to_contain_text("callback tasks")
        dialog.get_by_label("Type DELETE to confirm").fill("DELETE")
        dialog.get_by_role("button", name="Delete", exact=True).click()
        expect(dialog).not_to_be_visible()
        expect(self.page.locator("#lead-detail")).not_to_be_visible()
        self.assertEqual(self.api("GET", "/api/callback-tasks?state=all")["tasks"], [])


class SpreadsheetProductBrowserTests(SelectedProductHarness, PanelWorkspaceBrowserTests):
    product_id = "spreadsheet"
    product_scope = "spreadsheet"
    product_label = "PanelReply Spreadsheets"
    home_path = "/panels"
    server_entry = "spreadsheet-server.cjs"

    def test_spreadsheet_login_navigation_and_callback_routes_are_absent(self):
        self.login(keyboard=True)
        product = self.api("GET", "/api/session")["product"]
        self.assertEqual(product["id"], "spreadsheet")
        self.assertEqual(product["homePath"], "/panels")
        self.assertTrue(product["capabilities"]["panelProjects"])
        self.assertFalse(product["capabilities"]["intake"])
        self.assert_routes_denied(["/preview", "/dashboard", "/assets/app.js", "/assets/preview.js",
                                  "/assets/dashboard.js", "/assets/schedule.js", "/api/leads", "/api/profile", "/api/assistant", "/api/callback-tasks"])

    def test_spreadsheet_save_reopen_correct_and_download_both_formats(self):
        PanelWorkspaceBrowserTests.test_manual_parts_save_reopen_edit_and_export_preserve_corrections(self)
        with self.page.expect_download() as pending:
            self.page.locator("#export-project-xlsx").click()
        download = pending.value
        self.assertIsNone(download.failure())
        self.assertTrue(download.suggested_filename.endswith(".xlsx"))
        self.assertTrue(Path(download.path()).read_bytes().startswith(b"PK\x03\x04"))
        self.assert_product_navigation()
        self.capture("spreadsheet-selected-project.jpg")

    def test_spreadsheet_source_upload_and_reopen_preserve_private_image(self):
        PanelWorkspaceBrowserTests.test_source_upload_preview_and_reopen_keep_private_image_bytes_intact(self)
        self.assert_product_navigation()
        self.assert_routes_denied(["/api/profile"])

    def test_spreadsheet_reselects_same_label_after_unreadable_file(self):
        self.login()
        saved = self.create_panel(rows=[])
        self.open_panels(saved["id"])
        picker = self.page.locator("#panel-image")
        picker.set_input_files(str(FIXTURES / "complete.png"))
        # Only the first selected File simulates an OS read failure.
        picker.evaluate("""input => {
            Object.defineProperty(input.files[0], 'arrayBuffer', {
                value: async () => { throw new DOMException('Synthetic unreadable image', 'NotReadableError'); }
            });
        }""")
        self.page.locator("#upload-source").click()
        expect(self.page.locator("#source-error")).to_contain_text("Choose the file again")
        expect(picker).to_have_value("")
        expect(self.page.locator("#upload-source")).to_be_disabled()
        self.assertEqual(self.saved_panel(saved["id"])["sources"], [])

        source = self.upload_ui()["source"]
        self.page.reload()
        expect(self.page.locator("#source-list li")).to_have_count(1)
        response = self.context.request.get(f"{self.origin}/api/panel-projects/{saved['id']}/sources/{source['id']}")
        self.assertEqual(response.status, 200)
        self.assertEqual(response.body(), (FIXTURES / "complete.png").read_bytes())

    def test_spreadsheet_malformed_project_receipts_preserve_drafts_and_reconcile_once(self):
        PanelWorkspaceBrowserTests.behavior_malformed_project_success_preserves_draft_and_reconciles_without_duplicate_writes(self)
        self.assert_product_navigation()

    def test_spreadsheet_inconsistent_source_receipt_retries_original_image_once(self):
        PanelWorkspaceBrowserTests.behavior_inconsistent_source_success_retries_original_image_without_duplicate_records(self)
        self.assert_product_navigation()

    def test_spreadsheet_actual_ocr_still_requires_manual_review(self):
        PanelWorkspaceBrowserTests.test_real_local_ocr_candidates_require_manual_add_review_and_save(self)
        self.assert_product_navigation()

    def test_spreadsheet_data_survives_fixed_entrypoint_restart(self):
        self.login()
        saved = self.create_panel(name="Synthetic Spreadsheet Restart")
        self.open_panels(saved["id"])
        type(self).stop_server()
        type(self).start_server()
        self.page.reload()
        expect(self.page.locator("#project-name")).to_have_value("Synthetic Spreadsheet Restart")
        self.assertEqual(self.saved_panel(saved["id"])["rows"], saved["rows"])
        self.assert_product_navigation()

    def test_spreadsheet_layout_and_controls_at_phone_tablet_desktop_widths(self):
        self.login()
        saved = self.create_panel()
        self.open_panels(saved["id"])
        for width in [360, 768, 1440]:
            with self.subTest(width=width):
                self.page.set_viewport_size({"width": width, "height": 900})
                self.assert_no_overflow()
                self.assert_product_navigation()
                expect(self.page.locator("#add-part")).to_be_enabled()
                expect(self.page.locator("#export-project")).to_be_enabled()
                expect(self.page.locator("#export-project-xlsx")).to_be_enabled()

    def test_spreadsheet_sign_out_revokes_its_named_program_session(self):
        self.login()
        cookies = [item["name"] for item in self.context.cookies()]
        self.assertIn("PanelReplySpreadsheetLocalSession", cookies)
        self.assertNotIn("PanelReplyCallbackLocalSession", cookies)
        self.page.locator("#sign-out").click()
        expect(self.page).to_have_url(self.origin + "/login")
        self.api("GET", "/api/session", status=401)
        self.assertEqual(self.page.evaluate("localStorage.length + sessionStorage.length"), 0)


def load_tests(_loader, _tests, _pattern):
    tests = []
    for cls in [CallbackProductBrowserTests, SpreadsheetProductBrowserTests]:
        tests.extend(cls(name) for name in sorted(cls.__dict__) if name.startswith("test_"))
    return unittest.TestSuite(tests)


if __name__ == "__main__":
    unittest.main(verbosity=2)
