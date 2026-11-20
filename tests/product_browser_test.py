"""Selected callback/spreadsheet programs on their fixed entrypoints.

Each class initializes a fresh product-bound synthetic data directory and uses
its own product environment variables. Existing combined-workspace suites do
not substitute for these product-specific browser journeys. External requests
remain blocked. No live calls, messages, provider, deployment or customer data.
"""

import json
import subprocess
import unittest
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
        self.page.locator("#sign-out").click()
        expect(self.page).to_have_url(self.origin + "/login")
        self.api("GET", "/api/session", status=401)
        self.assertEqual(self.page.evaluate("localStorage.length + sessionStorage.length"), 0)


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
                                  "/assets/dashboard.js", "/api/leads", "/api/profile", "/api/assistant"])

    def test_spreadsheet_save_reopen_correct_and_download_both_formats(self):
        PanelWorkspaceBrowserTests.test_manual_parts_save_reopen_edit_and_export_preserve_corrections(self)
        with self.page.expect_download() as pending:
            self.page.locator("#export-project-xlsx").click()
        download = pending.value
        self.assertIsNone(download.failure())
        self.assertTrue(download.suggested_filename.endswith(".xlsx"))
        self.assertTrue(Path(download.path()).read_bytes().startswith(b"PK\x03\x04"))
        self.assert_product_navigation()

    def test_spreadsheet_source_upload_and_reopen_preserve_private_image(self):
        PanelWorkspaceBrowserTests.test_source_upload_preview_and_reopen_keep_private_image_bytes_intact(self)
        self.assert_product_navigation()
        self.assert_routes_denied(["/api/profile"])

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
