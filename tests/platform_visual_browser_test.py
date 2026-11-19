"""CI-only responsive and interaction checks for the authenticated platform.

Reuses the existing synthetic owner/server harness, but runs only the tests in
this file. It never starts a public listener or calls a customer/provider.
"""
import base64
import json
import os
import re
import unittest
import uuid

from playwright.sync_api import expect
from workspace_browser_test import PrivateWorkspaceBrowserTests


class PlatformVisualTests(PrivateWorkspaceBrowserTests):
    def panel_fixture(self):
        return self.api("POST", "/api/panel-projects", {
            "name": "Workshop distribution panel", "notes": "Synthetic review fixture. Confirm the original label.",
            "rows": [
                {"partNumber": "DEMO-120", "manufacturer": "Example Electric", "description": "Sample labelled component", "quantity": 2, "reviewStatus": "unreviewed", "notes": "Check characters against label", "sourceImageId": None},
                {"partNumber": "DEMO-240", "manufacturer": "Fixture Components", "description": "Sample workshop component", "quantity": 1, "reviewStatus": "reviewed", "notes": "Synthetic reviewed row", "sourceImageId": None},
            ],
        }, status=201, headers={"Idempotency-Key": uuid.uuid4().hex})["project"]

    def capture(self, name):
        if os.environ.get("PANELREPLY_EMIT_PLATFORM_PREVIEWS") != "1":
            return
        metrics = self.page.evaluate("""() => {
            const entry = performance.getEntriesByType('navigation')[0];
            return { viewport: innerWidth, domContentLoadedMs: Math.round(entry.domContentLoadedEventEnd), loadMs: Math.round(entry.loadEventEnd), resourceCount: performance.getEntriesByType('resource').length };
        }""")
        print("PLATFORM_BROWSER_METRICS=" + json.dumps({"capture": name, **metrics}), flush=True)
        self.page.evaluate("() => scrollTo({top: 0, left: 0, behavior: 'instant'})")
        data = self.page.screenshot(type="jpeg", quality=78, full_page=True, animations="disabled")
        encoded = base64.b64encode(data).decode("ascii")
        print(f"PLATFORM_PREVIEW_START:{name}", flush=True)
        for index in range(0, len(encoded), 5800):
            print(encoded[index:index + 5800], flush=True)
        print(f"PLATFORM_PREVIEW_END:{name}", flush=True)

    def assert_layout(self, width):
        self.assertLessEqual(self.page.evaluate("document.documentElement.scrollWidth"), width + 1, "Page overflows horizontally")
        self.assertEqual(self.page.evaluate("document.querySelectorAll('img').length === 0 || [...document.images].every(image => image.complete && image.naturalWidth > 0)"), True)
        self.assertEqual(self.page.evaluate("localStorage.length + sessionStorage.length"), 0)
        self.assertEqual(self.page.evaluate("getComputedStyle(document.body).backgroundImage"), "none")
        for selector in [".sidebar .brand", "#sign-out", "h1"]:
            box = self.page.locator(selector).bounding_box()
            self.assertIsNotNone(box, selector)
            self.assertGreaterEqual(box["x"], -1, selector)
            self.assertLessEqual(box["x"] + box["width"], width + 1, selector)
        for item in self.page.locator(".main-nav .nav-item").all():
            box = item.bounding_box()
            self.assertIsNotNone(box)
            self.assertGreaterEqual(box["x"], -1, item.inner_text())
            self.assertLessEqual(box["x"] + box["width"], width + 1, item.inner_text())
            self.assertGreaterEqual(box["height"], 44)
        if width <= 880:
            geometry = self.page.evaluate("""() => {
                const sidebar = document.querySelector('.sidebar').getBoundingClientRect();
                const main = document.querySelector('.main-shell').getBoundingClientRect();
                return { sidebarHeight: sidebar.height, sidebarBottom: sidebar.bottom + scrollY,
                         mainTop: main.top + scrollY };
            }""")
            # Seven navigation links wrap into at most four 44px rows here.
            # 360px leaves room for the brand, row gaps and padding without
            # admitting the desktop sidebar's 760px minimum height.
            self.assertLessEqual(geometry["sidebarHeight"], 360, json.dumps(geometry))
            self.assertGreaterEqual(geometry["mainTop"], geometry["sidebarBottom"] - 1,
                                    "Main content overlaps the navigation topbar")
            self.assertLessEqual(geometry["mainTop"], geometry["sidebarBottom"] + 32,
                                 "Unexpected blank space follows the navigation topbar")

    def test_dashboard_counts_empty_and_saved_records(self):
        self.login()
        self.page.goto(self.origin + "/dashboard")
        expect(self.page.locator("#dashboard-status")).to_have_text("Workspace loaded.")
        expect(self.page.locator("#dashboard-projects")).to_have_text("0")
        expect(self.page.locator("#dashboard-requests")).to_have_text("0")
        expect(self.page.locator("#dashboard-project-list")).to_contain_text("No saved projects yet")
        self.panel_fixture()
        self.create_request()
        self.page.reload()
        expect(self.page.locator("#dashboard-projects")).to_have_text("1")
        expect(self.page.locator("#dashboard-requests")).to_have_text("1")
        expect(self.page.locator("#dashboard-unreviewed")).to_have_text("1")
        expect(self.page.locator("#account-name")).to_have_text(self.username)
        self.page.locator("#dashboard-project-list a").click()
        expect(self.page.locator("#project-name")).to_have_value("Workshop distribution panel")

    def test_dashboard_partial_failure_has_unknown_count_and_retry(self):
        self.login()
        self.allow_http_error(503)
        self.page.route("**/api/panel-projects", lambda route: route.fulfill(status=503, content_type="application/json", body='{"error":{"message":"Synthetic unavailable"}}'))
        self.page.goto(self.origin + "/dashboard")
        expect(self.page.locator("#dashboard-error")).to_be_visible()
        expect(self.page.locator("#dashboard-projects")).to_have_text("—")
        expect(self.page.locator("#dashboard-request-list")).to_contain_text("No requests yet")
        self.page.unroute("**/api/panel-projects")
        self.page.locator("#retry-dashboard").click()
        expect(self.page.locator("#dashboard-error")).to_be_hidden()
        expect(self.page.locator("#dashboard-projects")).to_have_text("0")

    def test_panel_bootstrap_failure_can_retry(self):
        self.login()
        self.allow_http_error(503)
        self.page.route("**/api/session", lambda route: route.fulfill(status=503, content_type="application/json", body='{"error":{"message":"Synthetic unavailable"}}'))
        self.page.goto(self.origin + "/panels")
        expect(self.page.locator("#panel-app-error")).to_be_visible()
        expect(self.page.locator("#retry-panel-load")).to_be_enabled()
        self.page.unroute("**/api/session")
        self.page.locator("#retry-panel-load").click()
        expect(self.page.locator("#panel-load-status")).to_have_text("Panel workspace loaded.")
        expect(self.page.locator("#create-first-project")).to_be_enabled()

    def test_dashboard_navigation_preserves_intake_profile(self):
        self.login()
        self.page.locator("#dashboard-link").click()
        expect(self.page.locator("h1")).to_have_text("Work in view.")
        self.page.get_by_role("link", name="Open business profile", exact=True).click()
        expect(self.page.locator("#profile-view")).to_be_visible()
        self.page.locator("#business-name").fill("Draft business name")
        self.page.locator("#panels-link").click()
        expect(self.page.locator("#navigation-guard")).to_be_visible()
        self.page.locator("#keep-editing").click()
        expect(self.page.locator("#business-name")).to_have_value("Draft business name")
        self.page.locator("#panels-link").click()
        self.page.locator("#discard-changes").click()
        expect(self.page.locator("h1")).to_have_text("From label to parts list.")

    def test_panel_keyboard_focus_review_invalidation_and_navigation_guard(self):
        self.login()
        project = self.panel_fixture()
        self.page.goto(self.origin + "/panels?project=" + project["id"])
        expect(self.page.locator("#project-name")).to_have_value(project["name"])
        field = self.page.get_by_label("Part number row 2", exact=True)
        field.focus()
        field.fill("CORRECTED-240")
        field.press("Tab")
        expect(self.page.get_by_label("Manufacturer row 2", exact=True)).to_be_focused()
        expect(self.page.get_by_label("Review status row 2", exact=True)).to_have_value("unreviewed")
        self.page.get_by_role("link", name="Dashboard", exact=True).click()
        expect(self.page.locator("#panel-navigation-guard")).to_be_visible()
        expect(self.page.locator("#panel-keep-editing")).to_be_focused()
        self.page.keyboard.press("Enter")
        expect(field).to_have_value("CORRECTED-240")
        self.page.get_by_role("link", name="Dashboard", exact=True).click()
        self.page.locator("#panel-discard").click()
        expect(self.page).to_have_url(self.origin + "/dashboard")

    def test_panel_reduced_motion_and_table_scrolling(self):
        self.login()
        project = self.panel_fixture()
        self.page.emulate_media(reduced_motion="reduce")
        self.page.set_viewport_size({"width": 390, "height": 844})
        self.page.goto(self.origin + "/panels?project=" + project["id"])
        expect(self.page.locator("#project-name")).to_have_value(project["name"])
        scroll = self.page.locator(".sheet-scroll")
        scroll.focus()
        self.page.keyboard.press("ArrowRight")
        self.page.wait_for_timeout(150)
        self.assertGreater(scroll.evaluate("el => el.scrollLeft"), 0)
        self.assertEqual(self.page.locator("#save-project").evaluate("el => getComputedStyle(el).transitionDuration"), "0s")
        self.assert_layout(390)

    def test_panel_navigation_keeps_the_project_and_explains_exports_without_a_selection(self):
        self.login()
        project = self.panel_fixture()
        project_url = self.origin + "/panels?project=" + project["id"]
        self.page.goto(project_url)
        expect(self.page.locator("#project-name")).to_have_value(project["name"])
        self.page.get_by_role("link", name="Exports", exact=True).click()
        expect(self.page).to_have_url(project_url + "#export")
        expect(self.page.locator("#project-content")).to_be_visible()
        expect(self.page.locator("#export-project")).to_be_enabled()
        self.page.get_by_role("link", name="Saved projects", exact=True).click()
        expect(self.page).to_have_url(project_url + "#projects")
        expect(self.page.locator("#project-name")).to_have_value(project["name"])
        self.page.get_by_role("link", name="Dashboard", exact=True).click()
        expect(self.page).to_have_url(self.origin + "/dashboard")
        self.page.get_by_role("link", name="Exports", exact=True).click()
        expect(self.page).to_have_url(self.origin + "/panels#export")
        expect(self.page.locator("#project-empty")).to_be_visible()
        help_text = self.page.locator("#export-empty-help")
        expect(help_text).to_be_visible()
        expect(help_text).to_contain_text(re.compile(r"(?:select|choose).*project", re.IGNORECASE))
        self.page.locator("#project-list button").filter(has_text=project["name"]).click()
        expect(self.page.locator("#project-name")).to_have_value(project["name"])
        expect(self.page.locator("#project-content")).to_be_visible()
        expect(self.page.locator("#export-project")).to_be_enabled()


def responsive_dashboard(width):
    def test(self):
        self.login()
        self.panel_fixture()
        self.create_request()
        self.page.set_viewport_size({"width": width, "height": 960 if width > 768 else 844})
        self.page.goto(self.origin + "/dashboard")
        expect(self.page.locator("#dashboard-status")).to_have_text("Workspace loaded.")
        self.assert_layout(width)
        self.page.get_by_role("link", name="Open panel workspace", exact=True).click()
        expect(self.page.locator("#project-list-count")).to_have_text("1 saved project")
        if width in (360, 1440):
            self.page.goto(self.origin + "/dashboard")
            expect(self.page.locator("#dashboard-status")).to_have_text("Workspace loaded.")
            self.capture(f"platform-dashboard-{width}.jpg")
    return test


def responsive_panel(width):
    def test(self):
        self.login()
        project = self.panel_fixture()
        self.page.set_viewport_size({"width": width, "height": 960 if width > 768 else 844})
        self.page.goto(self.origin + "/panels?project=" + project["id"])
        expect(self.page.locator("#project-name")).to_have_value(project["name"])
        self.assert_layout(width)
        if width <= 760:
            grid = self.page.locator(".project-meta-panel .form-grid").bounding_box()
            name = self.page.locator("#project-name").bounding_box()
            notes = self.page.locator("#project-notes").bounding_box()
            for label, field in [("Project name", name), ("Project notes", notes)]:
                self.assertIsNotNone(field, label)
                self.assertGreaterEqual(field["width"], grid["width"] - 2,
                                        label + " must span the mobile form width")
                self.assertAlmostEqual(field["x"], grid["x"], delta=1, msg=label)
            self.assertGreaterEqual(notes["y"], name["y"] + name["height"] + 8,
                                    "Project notes must follow the name in one mobile column")
        expect(self.page.locator("#save-project")).to_be_enabled()
        for selector in ["#save-project", "#add-part", "#export-project"]:
            self.assertGreaterEqual(self.page.locator(selector).bounding_box()["height"], 44)
        self.page.get_by_label("Part number row 1", exact=True).fill("UPDATED-120")
        self.page.locator("#save-project").click()
        expect(self.page.locator("#project-save-status")).to_contain_text("Project saved.")
        self.page.reload()
        expect(self.page.get_by_label("Part number row 1", exact=True)).to_have_value("UPDATED-120")
        self.assert_layout(width)
        if width in (360, 1440):
            self.capture(f"platform-panels-{width}.jpg")
    return test


for viewport_width in [360, 390, 430, 768, 1024, 1440]:
    setattr(PlatformVisualTests, f"test_dashboard_responsive_{viewport_width}", responsive_dashboard(viewport_width))
    setattr(PlatformVisualTests, f"test_panel_responsive_{viewport_width}", responsive_panel(viewport_width))

if __name__ == "__main__":
    names = sorted(name for name in PlatformVisualTests.__dict__ if name.startswith("test_"))
    result = unittest.TextTestRunner(verbosity=2).run(unittest.TestSuite(PlatformVisualTests(name) for name in names))
    raise SystemExit(not result.wasSuccessful())
