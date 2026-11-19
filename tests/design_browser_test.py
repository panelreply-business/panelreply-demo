"""CI browser verification for the isolated PanelReply design preview.

Only synthetic data is used. A temporary directory containing design-preview
assets is served on loopback. Every request outside that origin is blocked and
fails the test. No production app, external integration, or account is used.

Run this suite in the approved CI browser environment, not in a restricted
local environment. PANELREPLY_EMIT_DESIGN_PREVIEWS=1 emits JPEG log markers.
"""

from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Thread
import base64
import csv
import io
import os
import shutil
import unittest

from playwright.sync_api import sync_playwright, expect


class QuietHandler(SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/favicon.ico":
            self.send_response(204)
            self.end_headers()
            return
        super().do_GET()

    def log_message(self, *_args):
        pass


class DesignBrowserTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.directory = TemporaryDirectory(prefix="panelreply-design-browser-")
        source = Path(__file__).resolve().parent.parent / "design-preview"
        for filename in ("index.html", "styles.css", "demo-core.js", "app.js", "mark.svg", "mark-on-dark.svg", "mark-on-light.svg", "sample-label.svg"):
            shutil.copy2(source / filename, Path(cls.directory.name) / filename)
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), partial(QuietHandler, directory=cls.directory.name))
        cls.thread = Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.origin = f"http://127.0.0.1:{cls.server.server_port}"
        cls.playwright = sync_playwright().start()
        executable = os.environ.get("PANELREPLY_CHROMIUM_EXECUTABLE")
        cls.browser = cls.playwright.chromium.launch(headless=True, **({"executable_path": executable} if executable else {}))
        print(f"DESIGN_CHROMIUM_VERSION={cls.browser.version}", flush=True)

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=5)
        cls.directory.cleanup()

    def setUp(self):
        self.context = self.browser.new_context(viewport={"width": 1440, "height": 1000}, accept_downloads=True)
        self.external_requests = []
        self.unexpected_submissions = []
        self.errors = []
        self.context.route("**/*", self.route)
        self.page = self.context.new_page()
        self.page.set_default_timeout(7000)
        self.page.on("pageerror", lambda error: self.errors.append(str(error)))
        self.page.on("console", lambda message: self.errors.append(message.text) if message.type == "error" else None)
        response = self.page.goto(self.origin + "/")
        self.assertEqual(response.status, 200)
        expect(self.page.locator("body")).to_have_attribute("data-demo-ready", "true")

    def tearDown(self):
        self.context.close()
        self.assertEqual(self.external_requests, [], "Preview attempted an external request")
        self.assertEqual(self.unexpected_submissions, [], "Preview attempted a network submission")
        self.assertEqual(self.errors, [], "Browser console or script errors")

    def route(self, route):
        request = route.request
        if request.method not in ("GET", "HEAD"):
            self.unexpected_submissions.append(request.method + " " + request.url)
            route.abort()
        elif request.url.startswith(self.origin + "/") or request.url.startswith("blob:" + self.origin + "/"):
            route.continue_()
        else:
            self.external_requests.append(request.url)
            route.abort()

    def go(self, route):
        self.page.evaluate("route => { location.hash = route; }", route)
        expected = route if route not in ("products", "workflow", "not-a-page") else "home"
        expect(self.page.locator("body")).to_have_attribute("data-current-route", expected)

    def open_request_form(self):
        self.page.locator("#intake-tab").click()
        self.page.locator("#new-request-button").click()
        expect(self.page.locator("#job")).to_be_focused()

    def add_request(self, job="Add sample workshop lighting", zip_code="00000", callback="Evening"):
        self.open_request_form()
        self.page.locator("#job").fill(job)
        self.page.locator("#zip").fill(zip_code)
        self.page.locator("#callback").select_option(callback)
        self.page.locator("#requested-date").fill("2028-02-29")
        self.page.locator("#add-request").click()

    def parts_view(self):
        self.page.locator("#parts-tab").click()
        expect(self.page.locator("#parts-panel")).to_be_visible()

    def download_csv(self):
        with self.page.expect_download() as download_info:
            self.page.locator("#export").click()
        download = download_info.value
        self.assertEqual(download.suggested_filename, "panelreply-sample-parts.csv")
        raw = Path(download.path()).read_bytes()
        self.assertTrue(raw.startswith(b"\xef\xbb\xbf"))
        return raw, list(csv.reader(io.StringIO(raw.decode("utf-8-sig"), newline="")))

    def assert_no_page_overflow(self):
        dimensions = self.page.evaluate("""() => ({
            route: location.hash || '#home',
            tab: document.querySelector('[role="tab"][aria-selected="true"]')?.id,
            viewport: document.documentElement.clientWidth,
            html: document.documentElement.scrollWidth,
            body: document.body.scrollWidth
        })""")
        if max(dimensions["html"], dimensions["body"]) > dimensions["viewport"] + 1:
            dimensions["overflowing_elements"] = self.page.evaluate("""() => {
                const viewport = document.documentElement.clientWidth;
                return [...document.querySelectorAll('body *')]
                    .filter(node => node.getClientRects().length)
                    .map(node => {
                        const rect = node.getBoundingClientRect();
                        const parent = node.parentElement;
                        return {
                            element: node.id ? '#' + node.id : node.tagName.toLowerCase() + '.' + String(node.className).trim().replace(/\\s+/g, '.'),
                            left: Math.round(rect.left), right: Math.round(rect.right), width: Math.round(rect.width),
                            parent: parent?.id || parent?.className || parent?.tagName,
                            parentWidth: parent ? Math.round(parent.getBoundingClientRect().width) : null,
                            overflow: getComputedStyle(node).overflowX,
                            inTableScroller: Boolean(node.closest('.table-scroll'))
                        };
                    })
                    .filter(node => node.right > viewport + 1 || node.left < -1)
                    .sort((a, b) => b.width - a.width)
                    .slice(0, 24);
            }""")
        self.assertLessEqual(dimensions["html"], dimensions["viewport"] + 1, dimensions)
        self.assertLessEqual(dimensions["body"], dimensions["viewport"] + 1, dimensions)

    def test_homepage_describes_both_products_and_boundaries(self):
        expect(self.page.locator("#home-heading")).to_have_text("Less paperwork.More work done.")
        expect(self.page.locator("#products")).to_contain_text("Customer intake")
        expect(self.page.locator("#products")).to_contain_text("Panel scanning")
        expect(self.page.locator(".demo-disclosure")).to_contain_text("synthetic data")
        expect(self.page.locator("#intake-tab")).to_have_attribute("aria-selected", "true")
        expect(self.page.locator("#req-count")).to_have_text("3")

    def test_all_product_information_routes_and_history(self):
        routes = {
            "customer-intake": "intake-heading", "panel-scanning": "panels-heading",
            "features": "features-heading", "pricing": "pricing-heading",
            "login": "login-heading", "contact": "contact-heading",
            "privacy": "privacy-heading", "terms": "terms-heading", "demo": "demo-page-heading"
        }
        for route, heading in routes.items():
            with self.subTest(route=route):
                self.go(route)
                expect(self.page.locator("#" + heading)).to_be_visible()
                expect(self.page.locator("#" + heading)).to_be_focused()
                self.assertEqual(self.page.locator("h1:visible").count(), 1)
        self.page.go_back()
        expect(self.page.locator("body")).to_have_attribute("data-current-route", "terms")
        self.page.go_forward()
        expect(self.page.locator("body")).to_have_attribute("data-current-route", "demo")
        self.go("not-a-page")
        expect(self.page.locator("#home-heading")).to_be_visible()

    def test_product_links_select_the_matching_workflow(self):
        self.go("panel-scanning")
        expect(self.page.locator("#parts-tab")).to_have_attribute("aria-selected", "true")
        self.page.get_by_role("link", name="Review the sample parts").click()
        expect(self.page.locator("body")).to_have_attribute("data-current-route", "demo")
        expect(self.page.locator("#parts-tab")).to_have_attribute("aria-selected", "true")
        self.go("customer-intake")
        expect(self.page.locator("#intake-tab")).to_have_attribute("aria-selected", "true")
        self.go("features")
        self.page.locator(".faq-list summary").first.click()
        expect(self.page.locator(".faq-list details").first).to_have_attribute("open", "")

    def test_tabs_support_roving_focus_arrows_home_end(self):
        self.page.locator("#intake-tab").focus()
        self.page.keyboard.press("ArrowRight")
        expect(self.page.locator("#parts-tab")).to_be_focused()
        expect(self.page.locator("#parts-tab")).to_have_attribute("aria-selected", "true")
        expect(self.page.locator("#intake-tab")).to_have_attribute("tabindex", "-1")
        expect(self.page.locator("#intake-panel")).to_be_hidden()
        self.page.keyboard.press("Home")
        expect(self.page.locator("#intake-tab")).to_be_focused()
        self.page.keyboard.press("End")
        expect(self.page.locator("#parts-tab")).to_be_focused()
        self.page.keyboard.press("ArrowLeft")
        expect(self.page.locator("#intake-tab")).to_be_focused()
        self.page.keyboard.press("ArrowDown")
        expect(self.page.locator("#parts-tab")).to_be_focused()
        self.assertEqual(self.page.locator("#parts-tab").evaluate("node => getComputedStyle(node).outlineStyle"), "solid")
        self.page.keyboard.press("Tab")
        expect(self.page.locator("#parts-panel")).to_be_focused()

    def test_request_form_validation_and_single_submission(self):
        self.open_request_form()
        self.page.locator("#add-request").click()
        expect(self.page.locator("#job")).to_have_attribute("aria-invalid", "true")
        expect(self.page.locator("#zip")).to_have_attribute("aria-invalid", "true")
        expect(self.page.locator("#job")).to_be_focused()
        expect(self.page.locator("#req-count")).to_have_text("3")
        self.page.locator("#job").fill("   ")
        self.page.locator("#zip").fill("1234a")
        self.page.locator("#add-request").click()
        expect(self.page.locator("#request-form-error")).to_contain_text("No sample request has been added")
        self.add_request()
        expect(self.page.locator("#req-count")).to_have_text("4")
        expect(self.page.locator("#review-count")).to_have_text("3")
        expect(self.page.locator("#detail-heading")).to_have_text("Add sample workshop lighting")
        expect(self.page.locator("#detail-date")).to_have_text("2028-02-29")
        expect(self.page.locator("#request-status")).to_contain_text("no appointment was booked")
        expect(self.page.locator("#job")).to_have_value("")
        expect(self.page.locator("#zip")).to_have_value("")
        self.page.locator("#add-request").click()
        expect(self.page.locator("#req-count")).to_have_text("4")

    def test_request_search_filters_empty_state_and_reset(self):
        self.page.locator("#request-search").fill("MORGAN")
        expect(self.page.locator(".request-item")).to_have_count(1)
        expect(self.page.locator("#detail-customer")).to_have_text("Morgan Sample")
        self.page.locator("#request-filter").select_option("New")
        expect(self.page.locator("#request-empty")).to_be_visible()
        expect(self.page.locator("#request-detail")).to_be_hidden()
        self.page.locator("#clear-request-filters").click()
        expect(self.page.locator(".request-item")).to_have_count(3)
        expect(self.page.locator("#request-search")).to_be_focused()
        self.add_request()
        self.page.locator("#reset-requests").click()
        expect(self.page.locator("#req-count")).to_have_text("3")
        expect(self.page.locator("#review-count")).to_have_text("2")
        expect(self.page.locator("#new-request")).not_to_have_attribute("open", "")
        expect(self.page.locator("#request-form-error")).to_have_text("")

    def test_internal_notes_status_and_activity_remain_sample_only(self):
        self.page.locator("#request-note").fill("Ask about panel access.\nReview photos before quoting.")
        self.page.locator("#detail-status").select_option("In review")
        self.page.locator("#save-request").click()
        expect(self.page.locator("#review-count")).to_have_text("1")
        expect(self.page.locator("#in-review-count")).to_have_text("2")
        expect(self.page.locator("#detail-badge")).to_have_text("In review")
        self.page.locator("[data-request-id='REQ-1041']").click()
        self.page.locator("[data-request-id='REQ-1042']").click()
        expect(self.page.locator("#request-note")).to_have_value("Ask about panel access.\nReview photos before quoting.")
        self.page.locator(".history-disclosure summary").click()
        expect(self.page.locator("#request-history")).to_contain_text("No communication sent")
        expect(self.page.locator(".history-disclosure")).to_contain_text("Consent is not collected here")
        self.page.locator("#reset-requests").click()
        expect(self.page.locator("#request-note")).to_have_value("")
        expect(self.page.locator("#detail-badge")).to_have_text("New")

    def test_markup_in_requests_notes_and_parts_is_literal_text(self):
        value = '<img src=x onerror="window.__designXss=1"> Sample job'
        self.add_request(value)
        expect(self.page.locator("#detail-heading")).to_have_text(value)
        expect(self.page.locator("#request-list img")).to_have_count(0)
        expect(self.page.locator("#request-detail img")).to_have_count(0)
        self.page.locator("#request-note").fill(value)
        self.page.locator("#save-request").click()
        expect(self.page.locator("#request-note")).to_have_value(value)
        self.parts_view()
        self.page.get_by_label("Description row 1", exact=True).fill(value)
        expect(self.page.locator("#parts-body img")).to_have_count(0)
        self.assertIsNone(self.page.evaluate("window.__designXss || null"))

    def test_review_state_clears_when_a_corrected_field_changes(self):
        self.parts_view()
        self.page.locator("#sample-part-1-review").click()
        expect(self.page.locator("#sample-part-1-review")).to_have_attribute("aria-pressed", "true")
        expect(self.page.locator("#review-progress-text")).to_have_text("1 of 3 rows reviewed")
        self.page.get_by_label("Part number row 1", exact=True).fill("DEMO-CORRECTED")
        expect(self.page.locator("#sample-part-1-review")).to_have_attribute("aria-pressed", "false")
        expect(self.page.locator("#review-progress-text")).to_have_text("0 of 3 rows reviewed")
        self.page.locator("#reset-parts").click()
        expect(self.page.get_by_label("Part number row 1", exact=True)).to_have_value("DEMO-101")

    def test_csv_contains_current_values_and_review_status(self):
        self.parts_view()
        self.page.get_by_label("Description row 1", exact=True).fill('Corrected, "quoted" sample Ω')
        self.page.get_by_label("Quantity row 1", exact=True).fill("7")
        self.page.locator("#sample-part-1-review").click()
        raw, rows = self.download_csv()
        self.assertEqual(rows[0], ["Part number", "Manufacturer", "Description", "Quantity", "Source image", "Review status"])
        self.assertEqual(len(rows), 4)
        self.assertEqual(rows[1][2], 'Corrected, "quoted" sample Ω')
        self.assertEqual(rows[1][3], "7")
        self.assertEqual(rows[1][5], "Reviewed")
        self.assertEqual(rows[2][5], "Unreviewed")
        self.assertIn(b"\r\n", raw)
        expect(self.page.locator("#parts-status")).to_contain_text("2 rows remain unreviewed")

    def test_csv_formula_prefixes_remain_inert_in_downloaded_data(self):
        self.parts_view()
        self.page.get_by_label("Part number row 1", exact=True).fill("=1+1")
        self.page.get_by_label("Manufacturer row 1", exact=True).fill("  +SUM(A1:A2)")
        self.page.get_by_label("Description row 1", exact=True).fill("\ufeff@SUM(A1)")
        _, rows = self.download_csv()
        self.assertEqual(rows[1][0], "'=1+1")
        self.assertEqual(rows[1][1], "'  +SUM(A1:A2)")
        self.assertEqual(rows[1][2], "'\ufeff@SUM(A1)")

    def test_part_validation_blank_values_and_unknown_fields(self):
        self.parts_view()
        self.page.get_by_label("Quantity row 1", exact=True).fill("0")
        self.page.locator("#export").click()
        expect(self.page.get_by_label("Quantity row 1", exact=True)).to_have_attribute("aria-invalid", "true")
        expect(self.page.locator("#parts-errors")).to_contain_text("whole quantity from 1 to 9999")
        expect(self.page.get_by_label("Quantity row 1", exact=True)).to_be_focused()
        self.page.get_by_label("Quantity row 1", exact=True).fill("1")
        self.page.get_by_label("Manufacturer row 1", exact=True).fill("")
        self.page.locator("#sample-part-1-review").click()
        expect(self.page.locator("#sample-part-1-review")).to_have_attribute("aria-pressed", "false")
        expect(self.page.locator("#parts-errors")).to_contain_text("before marking this row reviewed")
        _, rows = self.download_csv()
        self.assertEqual(rows[1][1], "")
        self.assertEqual(rows[1][5], "Unreviewed")

    def test_manual_part_add_remove_empty_and_reset(self):
        self.parts_view()
        self.page.locator("#add-part").click()
        expect(self.page.get_by_label("Part number row 4", exact=True)).to_be_focused()
        expect(self.page.locator("#part-count")).to_have_text("4")
        self.page.locator("#export").click()
        expect(self.page.locator("#parts-errors")).to_contain_text("Add at least one part detail")
        self.page.get_by_label("Description row 4", exact=True).fill("Sample manual component")
        _, rows = self.download_csv()
        self.assertEqual(rows[4][2], "Sample manual component")
        self.assertEqual(rows[4][4], "Manual entry")
        for _ in range(4):
            self.page.locator(".row-remove").first.click()
            if self.page.locator("#remove-part-dialog").is_visible():
                self.page.locator("#confirm-remove-part").click()
        expect(self.page.locator("#parts-empty")).to_be_visible()
        expect(self.page.locator("#export")).to_be_disabled()
        expect(self.page.locator("#empty-add-part")).to_be_focused()
        self.page.locator("#empty-add-part").click()
        expect(self.page.locator("#parts-body tr")).to_have_count(1)
        self.page.locator("#reset-parts").click()
        expect(self.page.locator("#parts-body tr")).to_have_count(3)
        expect(self.page.locator("#parts-errors")).to_be_hidden()

    def test_guided_sample_reveals_predetermined_rows_then_continues_to_edit_and_export(self):
        self.parts_view()
        self.page.locator("#start-parts-walkthrough").click()
        expect(self.page.locator("#parts-walkthrough")).to_be_visible()
        expect(self.page.locator("#parts-walkthrough")).to_have_attribute("data-stage", "source")
        expect(self.page.locator("#walkthrough-source")).to_be_visible()
        expect(self.page.locator("#walkthrough-description")).to_contain_text("predetermined sample values")
        expect(self.page.locator("#walkthrough-description")).to_contain_text("does not analyze the image or run OCR")
        expect(self.page.locator("#walkthrough-next")).to_be_focused()
        state = self.page.evaluate("""() => {
            document.getElementById('walkthrough-next').click();
            return {stage: document.getElementById('parts-walkthrough').dataset.stage,
                    busy: document.getElementById('walkthrough-output').getAttribute('aria-busy'),
                    disabled: document.getElementById('walkthrough-next').disabled};
        }""")
        self.assertEqual(state, {"stage": "demonstration", "busy": "true", "disabled": True})
        expect(self.page.locator("#parts-walkthrough")).to_have_attribute("data-stage", "ready")
        expect(self.page.locator("#walkthrough-preview-body tr")).to_have_count(3)
        expect(self.page.locator("#walkthrough-progress-text")).to_have_text("3 of 3 prepared rows shown")
        expect(self.page.locator("#walkthrough-source")).to_be_hidden()
        expect(self.page.locator("#walkthrough-next")).to_be_focused()
        self.page.locator("#walkthrough-next").click()
        expect(self.page.locator("#parts-walkthrough")).to_be_hidden()
        expect(self.page.get_by_label("Part number row 1", exact=True)).to_be_focused()
        self.page.get_by_label("Description row 1", exact=True).fill("Corrected after the guided sample")
        _, rows = self.download_csv()
        self.assertEqual(rows[1][2], "Corrected after the guided sample")

    def test_walkthrough_replay_preserves_corrected_parts_review_marks_and_requests(self):
        self.add_request("Preserve this sample request")
        self.page.locator("#request-note").fill("Keep this sample note.")
        self.page.locator("#save-request").click()
        self.parts_view()
        self.page.get_by_label("Part number row 1", exact=True).fill("CORRECTED-KEEP")
        self.page.locator("#sample-part-1-review").click()
        self.page.locator("#start-parts-walkthrough").click()
        expect(self.page.locator("#walkthrough-preserved")).to_be_visible()
        self.page.locator("#walkthrough-next").click()
        expect(self.page.locator("#parts-walkthrough")).to_have_attribute("data-stage", "ready")
        expect(self.page.locator("#walkthrough-preview-body")).to_contain_text("DEMO-101")
        self.page.locator("#walkthrough-next").click()
        expect(self.page.get_by_label("Part number row 1", exact=True)).to_have_value("CORRECTED-KEEP")
        expect(self.page.locator("#sample-part-1-review")).to_have_attribute("aria-pressed", "true")
        self.page.locator("#intake-tab").click()
        expect(self.page.locator("#req-count")).to_have_text("4")
        expect(self.page.locator("#detail-heading")).to_have_text("Preserve this sample request")
        expect(self.page.locator("#request-note")).to_have_value("Keep this sample note.")

    def test_walkthrough_skip_cancels_reveal_and_escape_restores_focus(self):
        self.parts_view()
        self.page.locator("#start-parts-walkthrough").click()
        self.page.evaluate("""() => {
            document.getElementById('walkthrough-next').click();
            document.getElementById('walkthrough-skip').click();
        }""")
        expect(self.page.locator("#parts-walkthrough")).to_be_hidden()
        expect(self.page.get_by_label("Part number row 1", exact=True)).to_be_focused()
        self.page.wait_for_timeout(650)
        expect(self.page.locator("#walkthrough-preview-body tr")).to_have_count(0)
        expect(self.page.get_by_label("Part number row 1", exact=True)).to_have_value("DEMO-101")
        self.page.locator("#start-parts-walkthrough").click()
        self.page.keyboard.press("Escape")
        expect(self.page.locator("#parts-walkthrough")).to_be_hidden()
        expect(self.page.locator("#start-parts-walkthrough")).to_be_focused()

    def test_reduced_motion_reveals_the_sample_without_timed_steps(self):
        self.page.emulate_media(reduced_motion="reduce")
        self.parts_view()
        self.page.locator("#start-parts-walkthrough").click()
        state = self.page.evaluate("""() => {
            document.getElementById('walkthrough-next').click();
            return {stage: document.getElementById('parts-walkthrough').dataset.stage,
                    rows: document.querySelectorAll('#walkthrough-preview-body tr').length,
                    disabled: document.getElementById('walkthrough-next').disabled};
        }""")
        self.assertEqual(state, {"stage": "ready", "rows": 3, "disabled": False})
        self.page.locator("#walkthrough-skip").click()
        expect(self.page.locator("#parts-walkthrough")).to_be_hidden()

    def test_row_removal_confirmation_protects_edits_and_review_marks(self):
        self.parts_view()
        self.page.get_by_label("Part number row 1", exact=True).fill("KEEP-UNTIL-CONFIRMED")
        self.page.locator(".row-remove").first.click()
        expect(self.page.locator("#remove-part-dialog")).to_be_visible()
        expect(self.page.locator("#remove-part-label")).to_have_text("KEEP-UNTIL-CONFIRMED")
        expect(self.page.locator("#cancel-remove-part")).to_be_focused()
        self.page.locator("#cancel-remove-part").click()
        expect(self.page.locator("#parts-body tr")).to_have_count(3)
        expect(self.page.get_by_label("Part number row 1", exact=True)).to_have_value("KEEP-UNTIL-CONFIRMED")
        self.page.locator("#sample-part-2-review").click()
        self.page.locator("[data-remove-part='sample-part-2']").click()
        expect(self.page.locator("#remove-part-dialog")).to_be_visible()
        self.page.keyboard.press("Escape")
        expect(self.page.locator("#sample-part-2-review")).to_have_attribute("aria-pressed", "true")
        self.page.locator(".row-remove").first.click()
        self.page.locator("#confirm-remove-part").click()
        expect(self.page.locator("#parts-body tr")).to_have_count(2)
        expect(self.page.get_by_label("Part number row 1", exact=True)).to_have_value("DEMO-202")
        expect(self.page.get_by_label("Part number row 1", exact=True)).to_be_focused()

    def test_guided_dialog_fits_each_requested_viewport(self):
        self.parts_view()
        for width in (360, 390, 430, 768, 1024, 1440):
            with self.subTest(width=width):
                self.page.set_viewport_size({"width": width, "height": 1000})
                self.page.locator("#start-parts-walkthrough").click()
                box = self.page.locator("#parts-walkthrough").bounding_box()
                self.assertGreaterEqual(box["x"], 0)
                self.assertLessEqual(box["x"] + box["width"], width)
                self.page.locator("#walkthrough-next").click()
                expect(self.page.locator("#parts-walkthrough")).to_have_attribute("data-stage", "ready")
                self.assert_no_page_overflow()
                self.page.locator("#walkthrough-skip").click()

    def test_download_loading_and_browser_failure_path(self):
        self.parts_view()
        self.page.evaluate("() => { URL.createObjectURL = () => { throw new Error('Synthetic download failure'); }; }")
        busy = self.page.evaluate("""() => {
            const button = document.getElementById('export');
            button.click();
            return {disabled: button.disabled, busy: button.getAttribute('aria-busy'), label: button.textContent};
        }""")
        self.assertTrue(busy["disabled"])
        self.assertEqual(busy["busy"], "true")
        self.assertIn("Preparing CSV", busy["label"])
        expect(self.page.locator("#parts-status")).to_contain_text("could not be prepared")
        expect(self.page.locator("#export")).to_be_enabled()
        expect(self.page.locator("#export-label")).to_have_text("Download CSV")
        expect(self.page.get_by_label("Part number row 1", exact=True)).to_have_value("DEMO-101")

    def test_reload_discards_sample_changes_without_browser_storage(self):
        self.add_request()
        self.parts_view()
        self.page.get_by_label("Part number row 1", exact=True).fill("CHANGED")
        self.page.reload()
        expect(self.page.locator("body")).to_have_attribute("data-demo-ready", "true")
        expect(self.page.locator("#req-count")).to_have_text("3")
        self.parts_view()
        expect(self.page.get_by_label("Part number row 1", exact=True)).to_have_value("DEMO-101")
        self.assertEqual(self.page.evaluate("({local: Object.keys(localStorage), session: Object.keys(sessionStorage)})"), {"local": [], "session": []})
        self.assertEqual(self.context.cookies(), [])

    def test_mobile_navigation_expansion_escape_and_route_focus(self):
        self.page.set_viewport_size({"width": 390, "height": 844})
        expect(self.page.locator("#site-navigation")).to_be_hidden()
        self.page.locator("#menu-toggle").click()
        expect(self.page.locator("#site-navigation")).to_be_visible()
        expect(self.page.locator("#menu-toggle")).to_have_attribute("aria-expanded", "true")
        self.page.keyboard.press("Escape")
        expect(self.page.locator("#menu-toggle")).to_be_focused()
        expect(self.page.locator("#site-navigation")).to_be_hidden()
        self.page.locator("#menu-toggle").click()
        self.page.locator("#site-navigation").get_by_role("link", name="Pricing", exact=True).click()
        expect(self.page.locator("#pricing-heading")).to_be_focused()
        expect(self.page.locator("#menu-toggle")).to_have_attribute("aria-expanded", "false")
        expect(self.page.locator("#site-navigation")).to_be_hidden()
        self.assert_no_page_overflow()

    def test_layout_at_all_six_requested_widths(self):
        for width in (360, 390, 430, 768, 1024, 1440):
            with self.subTest(width=width):
                self.page.set_viewport_size({"width": width, "height": 1000})
                for route in ("home", "customer-intake", "panel-scanning", "features", "pricing", "login", "contact", "privacy", "terms"):
                    self.go(route)
                    self.assert_no_page_overflow()
                self.go("demo")
                for tab in ("intake", "parts"):
                    self.page.locator("#" + tab + "-tab").click()
                    self.assert_no_page_overflow()
                table = self.page.locator(".table-scroll")
                geometry = table.evaluate("node => ({client: node.clientWidth, scroll: node.scrollWidth})")
                if width <= 1024:
                    self.assertGreater(geometry["scroll"], geometry["client"])

    def test_mobile_controls_have_touch_targets_and_no_clipped_buttons(self):
        self.page.set_viewport_size({"width": 360, "height": 800})
        self.go("demo")
        for tab in ("intake", "parts"):
            self.page.locator("#" + tab + "-tab").click()
            undersized = self.page.evaluate("""() => [...document.querySelectorAll('button, input, select, textarea, summary, nav a, .button, .text-link')]
                .filter(node => node.getClientRects().length && !node.closest('[hidden]'))
                .map(node => ({id: node.id || node.textContent.trim().slice(0, 45), height: node.getBoundingClientRect().height}))
                .filter(node => node.height < 43.5)""")
            self.assertEqual(undersized, [])
            self.assert_no_page_overflow()
        self.page.locator(".table-scroll").evaluate("node => { node.scrollLeft = node.scrollWidth; }")
        remove_box = self.page.locator(".row-remove").first.bounding_box()
        table_box = self.page.locator(".table-scroll").bounding_box()
        self.assertLessEqual(remove_box["x"] + remove_box["width"], table_box["x"] + table_box["width"] + 1)

    def test_reduced_motion_and_skip_navigation(self):
        self.page.emulate_media(reduced_motion="reduce")
        self.page.locator(".skip-link").focus()
        self.page.keyboard.press("Enter")
        expect(self.page.locator("#main-content")).to_be_focused()
        self.assertEqual(self.page.locator(".button").first.evaluate("node => getComputedStyle(node).transitionDuration"), "0s")
        self.go("panel-scanning")
        self.assertEqual(self.page.evaluate("matchMedia('(prefers-reduced-motion: reduce)').matches"), True)

    def test_pricing_contact_login_and_legal_do_not_activate_services(self):
        self.go("pricing")
        expect(self.page.locator("main")).to_contain_text("Pricing has not been set")
        self.go("contact")
        expect(self.page.locator("main")).to_contain_text("does not collect or submit your details")
        expect(self.page.locator("[data-route='contact'] form")).to_have_count(0)
        self.go("login")
        expect(self.page.locator("[data-route='login'] input[type='password']")).to_have_count(0)
        expect(self.page.locator("[data-route='login']")).to_contain_text("does not accept passwords")
        for route in ("privacy", "terms"):
            self.go(route)
            expect(self.page.locator("[data-route='" + route + "'] .review-banner")).to_contain_text("requires review")
        csp = self.page.locator("meta[http-equiv='Content-Security-Policy']").get_attribute("content")
        self.assertIn("connect-src 'none'", csp)
        self.assertIn("form-action 'none'", csp)

    def test_preview_capture_and_initial_visual_state(self):
        # Emitting screenshots is optional, but the visual-state assertions run
        # on every CI pass. No preview is published or remotely hosted.
        self.go("home")
        expect(self.page.locator("#home-heading")).to_be_visible()
        expect(self.page.locator(".hero-workspace")).to_be_visible()
        self.assert_no_page_overflow()
        if os.environ.get("PANELREPLY_EMIT_DESIGN_PREVIEWS") != "1":
            return
        captures = [("desktop-home", 1440, "home", "intake"), ("desktop-parts", 1440, "demo", "parts"), ("mobile-home", 390, "home", "intake"), ("mobile-parts", 390, "demo", "parts"), ("desktop-walkthrough", 1440, "demo", "parts"), ("mobile-walkthrough", 390, "demo", "parts")]
        for label, width, route, tab in captures:
            self.page.set_viewport_size({"width": width, "height": 1000})
            self.go(route)
            self.page.locator("#" + tab + "-tab").click()
            self.page.evaluate("window.scrollTo(0, 0)")
            staged = label.endswith("walkthrough")
            if staged:
                self.page.locator("#start-parts-walkthrough").click()
                self.page.locator("#walkthrough-next").click()
                expect(self.page.locator("#parts-walkthrough")).to_have_attribute("data-stage", "ready")
                image = self.page.locator("#parts-walkthrough").screenshot(type="jpeg", quality=70)
            else:
                image = self.page.screenshot(type="jpeg", quality=70, full_page=route == "demo")
            print("PANELREPLY_DESIGN_PREVIEW_BEGIN=" + label, flush=True)
            encoded = base64.b64encode(image).decode("ascii")
            for offset in range(0, len(encoded), 10000):
                print(encoded[offset:offset + 10000], flush=True)
            print("PANELREPLY_DESIGN_PREVIEW_END=" + label, flush=True)
            if staged:
                self.page.locator("#walkthrough-close").click()


if __name__ == "__main__":
    unittest.main(verbosity=2)
