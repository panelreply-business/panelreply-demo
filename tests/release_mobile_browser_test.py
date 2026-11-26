"""Private workflows with explicit Playwright phone/tablet emulation.

These tests exercise touch input and mobile context settings on a synthetic
Linux loopback workspace. They do not exercise physical phones, the operating
system keyboard/camera/file picker, or branded Safari/Android Chrome. The file
upload uses synthetic fixture bytes. No external requests/providers are used.
"""

import csv
import io
import os
from pathlib import Path
import re
import unittest

from playwright.sync_api import expect
from panel_browser_test import PanelWorkspaceBrowserTests, FIXTURES, part
from workspace_browser_test import FIXTURE_PASSWORD


ENGINE = os.environ.get("PANELREPLY_BROWSER", "chromium")
PROFILES = {
    "chromium": [("phone_portrait", "Pixel 7"), ("phone_landscape", "Pixel 7 landscape"),
                 ("tablet_portrait", "Galaxy Tab S4"), ("tablet_landscape", "Galaxy Tab S4 landscape")],
    "webkit": [("phone_portrait", "iPhone 13"), ("phone_landscape", "iPhone 13 landscape"),
               ("tablet_portrait", "iPad Pro 11"), ("tablet_landscape", "iPad Pro 11 landscape")],
}
if ENGINE not in PROFILES:
    raise ValueError("Mobile verification requires Chromium or WebKit; Firefox has no mobile context fallback")


class MobileWorkspaceTests(PanelWorkspaceBrowserTests):
    def setUp(self):
        method = getattr(self, self._testMethodName)
        self.device_name = method.device_name
        descriptor = dict(self.playwright.devices[self.device_name])
        self.assertEqual(descriptor.pop("default_browser_type"), ENGINE)
        self.assertIs(descriptor["has_touch"], True)
        self.assertIs(descriptor["is_mobile"], True)
        self.descriptor = descriptor
        self.username = self.seed_owner()
        self.context = self.browser.new_context(**descriptor, accept_downloads=True)
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
        actual = self.page.evaluate("""() => ({maxTouchPoints: navigator.maxTouchPoints,
            touchEvents: 'ontouchstart' in window && 'ontouchend' in window,
            ratio: devicePixelRatio, width: innerWidth, userAgent: navigator.userAgent})""")
        self.touch_evidence = {"observed": actual, "events": []}
        self.assertIs(actual["touchEvents"], True)
        self.assertAlmostEqual(actual["ratio"], descriptor["device_scale_factor"], places=2)
        self.assertEqual(actual["width"], descriptor["viewport"]["width"])
        self.assertEqual(actual["userAgent"], descriptor["user_agent"])
        # has_touch promises touch events, not a spoofed navigator hardware
        # count. WebKit on the Linux CI host reports maxTouchPoints=0. Verify
        # the actual browser input path instead of replacing it with a click.
        # https://playwright.dev/python/docs/api/class-touchscreen
        username = self.page.get_by_label("Username", exact=True)
        username.evaluate("""element => {
            element.__panelReplyTouchProbe = [];
            for (const type of ['touchstart', 'touchend']) {
                element.addEventListener(type, event => {
                    element.__panelReplyTouchProbe.push({type: event.type,
                        trusted: event.isTrusted, touches: event.touches.length,
                        changedTouches: event.changedTouches.length});
                }, {once: true, passive: true});
            }
        }""")
        username.tap()
        events = username.evaluate("""element => {
            const events = element.__panelReplyTouchProbe;
            delete element.__panelReplyTouchProbe;
            return events;
        }""")
        self.touch_evidence["events"] = events
        self.assertEqual(events, [
            {"type": "touchstart", "trusted": True, "touches": 1, "changedTouches": 1},
            {"type": "touchend", "trusted": True, "touches": 0, "changedTouches": 1},
        ])
        expect(username).to_be_focused()

    def login_touch(self):
        self.page.goto(self.origin + "/login")
        self.page.get_by_label("Username", exact=True).fill(self.username)
        self.page.get_by_label("Password", exact=True).fill(FIXTURE_PASSWORD)
        self.page.get_by_role("button", name="Sign in", exact=True).tap()
        expect(self.page).to_have_url(self.origin + "/")
        expect(self.page.locator("#business-display")).to_have_text("Example Electric")

    def draft_touch(self, name="Synthetic emulated panel"):
        self.page.locator("#new-project").tap()
        self.page.locator("#project-name").fill(name)
        self.page.locator("#add-part").tap()
        for label, value in [("Part number", "000123-Ω"), ("Manufacturer", "SAMPLE COMPONENTS"),
                             ("Description", "Synthetic component")]:
            self.page.get_by_label(label + " row 1", exact=True).fill(value)

    def save_touch(self, status=200):
        if status >= 400:
            self.allow_http_error(status)
        with self.page.expect_response(lambda response:
                re.fullmatch(re.escape(self.origin) + r"/api/panel-projects(?:/[0-9a-f-]+)?", response.url)
                and response.request.method in {"POST", "PATCH"}) as pending:
            self.page.locator("#save-project").tap()
        response = pending.value
        self.assertEqual(response.status, status, response.text())
        if status >= 400:
            expect(self.page.locator("#project-error")).to_be_visible()
            return None
        expect(self.page.locator("#project-save-status")).to_contain_text("Project saved")
        expect(self.page.locator("#project-dirty")).to_be_hidden()
        return response.json()["project"]

    def export_touch(self):
        with self.page.expect_download() as pending:
            self.page.locator("#export-project").tap()
        download = pending.value
        self.assertIsNone(download.failure())
        data = Path(download.path()).read_bytes()
        self.assertTrue(data.startswith(b"\xef\xbb\xbf"))
        return list(csv.reader(io.StringIO(data.decode("utf-8-sig"), newline="")))

    def behavior_login_logout(self):
        self.login_touch()
        self.page.locator("#sign-out").tap()
        expect(self.page).to_have_url(self.origin + "/login")
        self.api("GET", "/api/leads", status=401)
        self.page.goto(self.origin + "/panels")
        expect(self.page).to_have_url(self.origin + "/login")
        self.assertEqual(self.page.evaluate("localStorage.length + sessionStorage.length"), 0)

    def behavior_save_reopen_edit_export(self):
        self.login_touch()
        self.open_panels()
        self.draft_touch()
        self.page.get_by_label("Description row 1", exact=True).fill('Comma, "quote" and\nsecond line Ω')
        self.page.get_by_label("Quantity row 1", exact=True).fill("7")
        self.page.get_by_label("Review status row 1", exact=True).select_option("reviewed")
        saved = self.save_touch(201)
        self.page.reload()
        self.page.locator("#project-list button").tap()
        expect(self.page.get_by_label("Part number row 1", exact=True)).to_have_value("000123-Ω")
        self.page.get_by_label("Part number row 1", exact=True).fill("CORRECTED-0042")
        expect(self.page.get_by_label("Review status row 1", exact=True)).to_have_value("unreviewed")
        updated = self.save_touch()
        self.assertEqual(updated["version"], saved["version"] + 1)
        self.assertEqual(self.saved_panel(saved["id"])["rows"][0]["partNumber"], "CORRECTED-0042")
        self.assertEqual(self.export_touch()[1], ["CORRECTED-0042", "SAMPLE COMPONENTS",
                         'Comma, "quote" and\nsecond line Ω', "7", "", "unreviewed", ""])

    def behavior_request_save_and_reopen(self):
        def task_read_completed():
            expect(self.page.locator("#lead-task-status")).to_have_text("0 of 0 saved tasks.")
            expect(self.page.locator("#task-error")).not_to_be_visible()

        self.login_touch()
        self.open_preview()
        self.fill_review(customerName="Synthetic Mobile Owner", job="Replace a garage outlet")
        with self.page.expect_response(lambda response:
                response.url == self.origin + "/api/leads" and response.request.method == "POST") as pending:
            self.page.get_by_role("button", name="Save request", exact=True).tap()
        self.assertEqual(pending.value.status, 201)
        lead = pending.value.json()["lead"]
        self.page.goto(self.origin + "/")
        self.page.get_by_role("button", name="Open request from Synthetic Mobile Owner", exact=True).tap()
        task_read_completed()
        self.page.get_by_label("Internal notes", exact=True).fill("Synthetic mobile review")
        with self.page.expect_response(lambda response:
                response.url.endswith("/api/leads/" + lead["id"]) and response.request.method == "PATCH") as updated:
            self.page.get_by_role("button", name="Save changes", exact=True).tap()
        self.assertEqual(updated.value.status, 200)
        # This journey verifies a completed save and reopened view. Let both
        # rendered save state and its task read finish before navigation.
        expect(self.page.locator("#lead-status")).to_have_text(re.compile(r"^Changes saved · "))
        expect(self.page.get_by_label("Internal notes", exact=True)).to_be_enabled()
        task_read_completed()
        self.page.reload()
        expect(self.page.get_by_label("Internal notes", exact=True)).to_have_value("Synthetic mobile review")
        task_read_completed()
        self.assertEqual(self.api("GET", "/api/leads/" + lead["id"])["lead"]["notes"], "Synthetic mobile review")

    def behavior_upload_and_private_preview(self):
        self.login_touch()
        saved = self.create_panel(rows=[])
        self.open_panels(saved["id"])
        self.page.locator("#panel-image").set_input_files(str(FIXTURES / "complete.png"))
        with self.page.expect_response(lambda response: response.url.endswith("/sources")
                and response.request.method == "POST") as pending:
            self.page.locator("#upload-source").tap()
        self.assertEqual(pending.value.status, 201)
        source = pending.value.json()["source"]
        self.page.locator("#source-list [data-view]").tap()
        expect(self.page.locator("#source-list img")).to_be_visible()
        self.page.wait_for_function("() => document.querySelector('#source-list img')?.naturalWidth > 0")
        url = self.origin + "/api/panel-projects/" + saved["id"] + "/sources/" + source["id"]
        response = self.context.request.get(url)
        self.assertEqual(response.status, 200)
        self.assertEqual(response.body(), (FIXTURES / "complete.png").read_bytes())
        self.assertEqual(response.headers["cache-control"], "no-store")
        self.open_panels(saved["id"])
        expect(self.page.locator("#source-list li")).to_have_count(1)

    def behavior_navigation_preserves_draft(self):
        self.login_touch()
        saved = self.create_panel()
        other = self.create_panel(name="Second synthetic mobile panel")
        self.open_panels(saved["id"])
        self.page.locator("#project-notes").fill("Keep this mobile draft")
        self.page.locator("#project-list button").filter(has_text=other["name"]).tap()
        expect(self.page.locator("#panel-navigation-guard")).to_be_visible()
        self.page.locator("#panel-keep-editing").tap()
        expect(self.page.locator("#project-notes")).to_have_value("Keep this mobile draft")
        self.page.locator("#project-list button").filter(has_text=other["name"]).tap()
        self.page.locator("#panel-discard").tap()
        expect(self.page.locator("#project-name")).to_have_value(other["name"])
        self.assertEqual(self.saved_panel(saved["id"])["notes"], "")

    def behavior_failed_save_retains_draft(self):
        self.login_touch()
        self.open_panels()
        self.draft_touch()
        attempts = []

        def fail_once(route):
            if route.request.method != "POST":
                route.continue_()
                return
            attempts.append(route.request.headers.get("idempotency-key"))
            if len(attempts) == 1:
                route.fulfill(status=503, content_type="application/json",
                              body='{"error":{"code":"workspace_unavailable","message":"Synthetic temporary failure"}}')
            else:
                route.continue_()

        self.page.route(self.origin + "/api/panel-projects", fail_once)
        self.save_touch(503)
        expect(self.page.get_by_label("Part number row 1", exact=True)).to_have_value("000123-Ω")
        self.assertEqual(self.api("GET", "/api/panel-projects")["projects"], [])
        # The application treats an unconfirmed write as uncertain and exposes
        # its explicit retry control. Preserve the original operation key.
        expect(self.page.locator("#retry-project-save")).to_be_visible()
        self.page.locator("#retry-project-save").tap()
        expect(self.page.locator("#project-save-status")).to_contain_text("Project saved")
        self.assertEqual(len(attempts), 2)
        self.assertTrue(attempts[0])
        self.assertEqual(attempts[0], attempts[1])
        self.assertEqual(len(self.api("GET", "/api/panel-projects")["projects"]), 1)

    def behavior_expired_session_does_not_save(self):
        self.login_touch()
        saved = self.create_panel()
        self.open_panels(saved["id"])
        self.page.get_by_label("Part number row 1", exact=True).fill("MUST-NOT-SAVE")
        self.api("POST", "/api/logout", status=204)
        self.allow_http_error(401)
        self.page.locator("#save-project").tap()
        expect(self.page).to_have_url(self.origin + "/login")
        self.login_touch()
        self.assertEqual(self.saved_panel(saved["id"])["rows"], saved["rows"])

    def behavior_markup_remains_literal(self):
        self.login_touch()
        markup = '<img src="https://external.example.test/leak" onerror="window.injected=true">'
        saved = self.create_panel(name="Synthetic mobile <script>", rows=[part(description=markup)])
        self.open_panels(saved["id"])
        expect(self.page.get_by_label("Description row 1", exact=True)).to_have_value(markup)
        expect(self.page.locator("#panel-parts-body img")).to_have_count(0)
        self.assertIsNone(self.page.evaluate("window.injected"))
        self.assertEqual(self.export_touch()[1][2], markup)

    def behavior_row_removal_requires_confirmation(self):
        self.login_touch()
        saved = self.create_panel()
        self.open_panels(saved["id"])
        self.page.get_by_label("Notes row 1", exact=True).fill("Preserve this draft")
        self.page.once("dialog", lambda dialog: dialog.dismiss())
        self.page.get_by_role("button", name="Remove row 1", exact=True).tap()
        expect(self.page.locator("#panel-parts-body tr")).to_have_count(1)
        expect(self.page.get_by_label("Notes row 1", exact=True)).to_have_value("Preserve this draft")
        self.page.once("dialog", lambda dialog: dialog.accept())
        self.page.get_by_role("button", name="Remove row 1", exact=True).tap()
        expect(self.page.locator("#panel-parts-body tr")).to_have_count(0)
        self.assertEqual(len(self.saved_panel(saved["id"])["rows"]), 1)
        self.save_touch()
        self.assertEqual(self.saved_panel(saved["id"])["rows"], [])

    def behavior_orientation_retains_edits(self):
        self.login_touch()
        saved = self.create_panel()
        self.open_panels(saved["id"])
        self.page.locator("#project-notes").fill("Synthetic orientation draft Ω")
        self.page.emulate_media(reduced_motion="reduce")
        self.assert_no_overflow()
        viewport = self.descriptor["viewport"]
        self.page.set_viewport_size({"width": viewport["height"], "height": viewport["width"]})
        self.assert_no_overflow()
        expect(self.page.locator("#project-notes")).to_have_value("Synthetic orientation draft Ω")
        self.assertEqual(self.saved_panel(saved["id"])["notes"], "")
        updated = self.save_touch()
        self.assertEqual(updated["notes"], "Synthetic orientation draft Ω")


BEHAVIORS = [
    "login_logout", "save_reopen_edit_export", "request_save_and_reopen",
    "upload_and_private_preview", "navigation_preserves_draft", "failed_save_retains_draft",
    "expired_session_does_not_save", "markup_remains_literal",
    "row_removal_requires_confirmation", "orientation_retains_edits",
]


def device_case(profile_id, device_name, behavior):
    def test(self):
        getattr(self, "behavior_" + behavior)()
    test.device_profile_id = profile_id
    test.device_name = device_name
    test.product_scope = "callback" if behavior == "request_save_and_reopen" else "shared" if behavior == "login_logout" else "spreadsheet"
    return test


for profile_id, device_name in PROFILES[ENGINE]:
    for behavior in BEHAVIORS:
        setattr(MobileWorkspaceTests, f"test_{profile_id}_{behavior}",
                device_case(profile_id, device_name, behavior))


def load_tests(_loader, _tests, _pattern):
    names = sorted(name for name in MobileWorkspaceTests.__dict__ if name.startswith("test_"))
    return unittest.TestSuite(MobileWorkspaceTests(name) for name in names)


if __name__ == "__main__":
    unittest.main(verbosity=2)
