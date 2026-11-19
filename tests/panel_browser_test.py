"""Panel workspace checks for CI's real loopback server and Chromium.

All files, owners and parts are synthetic. The inherited harness blocks remote
requests and live provider routes. Run this file only in the approved CI browser
environment. load_tests selects this class's new checks, not the inherited suite.
"""

from pathlib import Path
import base64
import csv
import io
import json
import re
import unittest
import uuid

from playwright.sync_api import expect
from workspace_browser_test import PrivateWorkspaceBrowserTests, ROOT, FIXTURE_PASSWORD


FIXTURES = ROOT / "tests" / "fixtures" / "panels"


def part(**changes):
    return {
        "partNumber": "DEMO-1001", "manufacturer": "SAMPLE COMPONENTS",
        "description": "Synthetic component for testing", "quantity": 1,
        "reviewStatus": "unreviewed", "notes": "", "sourceImageId": None,
        **changes,
    }


class PanelWorkspaceBrowserTests(PrivateWorkspaceBrowserTests):
    def open_panels(self, project_id=None):
        suffix = "?project=" + project_id if project_id else ""
        self.page.goto(self.origin + "/panels" + suffix)
        expect(self.page.locator("#new-project")).to_be_enabled()
        if project_id:
            expect(self.page.locator("#project-content")).to_be_visible()
            expect(self.page.locator("#project-version")).to_contain_text("Version")

    def create_panel(self, **changes):
        payload = {"name": "Synthetic workshop panel", "notes": "", "rows": [part()], **changes}
        return self.api("POST", "/api/panel-projects", payload, status=201,
                        headers={"Idempotency-Key": uuid.uuid4().hex})["project"]

    def saved_panel(self, project_id):
        return self.api("GET", "/api/panel-projects/" + project_id)["project"]

    def project_body(self, saved, **changes):
        return {"version": saved["version"], "name": saved["name"],
                "notes": saved["notes"], "rows": saved["rows"], **changes}

    def start_draft(self, name="Synthetic UI panel", with_part=True):
        self.page.locator("#new-project").click()
        self.page.locator("#project-name").fill(name)
        if with_part:
            self.page.locator("#add-part").click()
            for field, value in [("Part number", "DEMO-UI-1"), ("Manufacturer", "SAMPLE COMPONENTS"),
                                 ("Description", "Synthetic editable label")]:
                self.page.get_by_label(field + " row 1", exact=True).fill(value)

    def save_panel_ui(self, expected_status=200):
        if expected_status >= 400:
            self.allow_http_error(expected_status)
        with self.page.expect_response(lambda response:
                re.fullmatch(re.escape(self.origin) + r"/api/panel-projects(?:/[0-9a-f-]+)?", response.url)
                and response.request.method in ("POST", "PATCH")) as pending:
            self.page.locator("#save-project").click()
        self.assertEqual(pending.value.status, expected_status, pending.value.text())
        if expected_status < 400:
            expect(self.page.locator("#project-save-status")).to_contain_text("Project saved")
            expect(self.page.locator("#project-dirty")).to_be_hidden()
            return pending.value.json()["project"]
        expect(self.page.locator("#project-error")).to_be_visible()
        return None

    def upload_ui(self, filename="complete.png", expected_status=201):
        self.page.locator("#panel-image").set_input_files(str(FIXTURES / filename))
        with self.page.expect_response(lambda response:
                response.url.endswith("/sources") and response.request.method == "POST") as pending:
            self.page.locator("#upload-source").click()
        self.assertEqual(pending.value.status, expected_status, pending.value.text())
        expect(self.page.locator("#source-status")).to_contain_text("Source image saved")
        return pending.value.json()

    def upload_api(self, saved, filename="complete.png"):
        image = FIXTURES / filename
        return self.api("POST", "/api/panel-projects/" + saved["id"] + "/sources", {
            "version": saved["version"], "name": filename,
            "mime": "image/jpeg" if image.suffix == ".jpg" else "image/png",
            "dataBase64": base64.b64encode(image.read_bytes()).decode("ascii"),
        }, status=201, headers={"Idempotency-Key": uuid.uuid4().hex})

    def download_csv(self):
        with self.page.expect_download() as pending:
            self.page.locator("#export-project").click()
        download = pending.value
        self.assertIsNone(download.failure())
        data = Path(download.path()).read_bytes()
        self.assertTrue(data.startswith(b"\xef\xbb\xbf"))
        self.assertTrue(data.endswith(b"\r\n"))
        return list(csv.reader(io.StringIO(data.decode("utf-8-sig"), newline="")))

    def test_panel_pages_and_sources_require_the_existing_workspace_session(self):
        for path in ["/panels", "/dashboard"]:
            self.page.goto(self.origin + path)
            expect(self.page).to_have_url(self.origin + "/login")
        self.api("GET", "/api/panel-projects", status=401)
        self.api("GET", "/api/panel-ocr", status=401)

    def test_dropped_image_waits_for_save_and_exposes_real_pending_state(self):
        self.login()
        project = self.create_panel()
        self.open_panels(project["id"])
        data = base64.b64encode((FIXTURES / "complete.png").read_bytes()).decode("ascii")
        transfer = self.page.evaluate_handle("""encoded => {
            const transfer = new DataTransfer();
            transfer.items.add(new File([Uint8Array.from(atob(encoded), c => c.charCodeAt(0))], 'dropped-label.png', {type: 'image/png'}));
            return transfer;
        }""", data)
        self.page.dispatch_event("#source-dropzone", "drop", {"dataTransfer": transfer})
        transfer.dispose()
        expect(self.page.locator("#source-selection-text")).to_contain_text("dropped-label.png")
        expect(self.page.locator("#source-selection-text")).to_contain_text("Selected on this device")
        self.assertEqual(len(self.saved_panel(project["id"])["sources"]), 0)
        held = []
        self.page.route("**/api/panel-projects/*/sources", lambda route: held.append(route))
        with self.page.expect_request(lambda request: request.url.endswith("/sources") and request.method == "POST"):
            self.page.locator("#upload-source").click()
        expect(self.page.locator("#source-status")).to_have_text("Saving source image…")
        expect(self.page.locator("#source-progress")).to_be_visible()
        expect(self.page.locator("#source-dropzone")).to_have_attribute("aria-busy", "true")
        expect(self.page.locator("#clear-source-selection")).to_be_disabled()
        self.assertEqual(len(held), 1)
        actual = held[0].fetch()
        self.assertEqual(actual.status, 201)
        held[0].fulfill(response=actual)
        self.page.unroute("**/api/panel-projects/*/sources")
        expect(self.page.locator("#source-status")).to_contain_text("Source image saved")
        expect(self.page.locator("#source-progress")).to_be_hidden()
        expect(self.page.locator("#source-selection")).to_be_hidden()
        self.page.get_by_role("button", name="View image dropped-label.png", exact=True).click()
        expect(self.page.locator("#source-list img")).to_be_visible()
        self.page.wait_for_function("document.querySelector('#source-list img')?.complete && document.querySelector('#source-list img')?.naturalWidth > 0")
        self.assertTrue(self.page.locator("#source-list img").evaluate("image => image.complete && image.naturalWidth > 0"))

    def test_image_selection_rejects_type_size_and_multiple_files_without_saving(self):
        self.login()
        project = self.create_panel()
        self.open_panels(project["id"])
        for item in [
            {"name": "not-an-image.svg", "mimeType": "image/svg+xml", "buffer": b"<svg></svg>"},
            {"name": "too-large.png", "mimeType": "image/png", "buffer": b"x" * (2 * 1024 * 1024 + 1)},
            {"name": "empty.png", "mimeType": "image/png", "buffer": b""},
        ]:
            self.page.locator("#panel-image").set_input_files(item)
            expect(self.page.locator("#source-error")).to_contain_text("PNG or JPEG image no larger than 2 MB")
            expect(self.page.locator("#upload-source")).to_be_disabled()
            expect(self.page.locator("#source-selection")).to_be_hidden()
        transfer = self.page.evaluate_handle("""() => {
            const transfer = new DataTransfer();
            for (const name of ['one.png', 'two.png']) transfer.items.add(new File(['fixture'], name, {type: 'image/png'}));
            return transfer;
        }""")
        self.page.dispatch_event("#source-dropzone", "drop", {"dataTransfer": transfer})
        transfer.dispose()
        expect(self.page.locator("#source-error")).to_contain_text("one image at a time")
        expect(self.page.locator("#upload-source")).to_be_disabled()
        self.assertEqual(len(self.saved_panel(project["id"])["sources"]), 0)
        self.page.locator("#panel-image").set_input_files(str(FIXTURES / "complete.png"))
        expect(self.page.locator("#source-error")).to_be_hidden()
        expect(self.page.locator("#upload-source")).to_be_enabled()
        self.page.locator("#clear-source-selection").click()
        expect(self.page.locator("#panel-image")).to_be_focused()
        expect(self.page.locator("#upload-source")).to_be_disabled()
        self.assertEqual(len(self.saved_panel(project["id"])["sources"]), 0)

    def test_incomplete_row_indicates_missing_fields_and_removal_requires_confirmation(self):
        self.login()
        project = self.create_panel(rows=[part(manufacturer="", description="")])
        self.open_panels(project["id"])
        expect(self.page.locator(".row-review-note")).to_have_text("Missing manufacturer, description")
        self.page.get_by_label("Manufacturer row 1", exact=True).fill("SAMPLE COMPONENTS")
        self.page.get_by_label("Description row 1", exact=True).fill("Corrected component")
        expect(self.page.locator(".row-review-note")).to_have_text("")
        self.page.once("dialog", lambda dialog: dialog.dismiss())
        self.page.get_by_role("button", name="Remove row 1", exact=True).click()
        expect(self.page.locator("#panel-parts-body tr")).to_have_count(1)
        self.page.once("dialog", lambda dialog: dialog.accept())
        self.page.get_by_role("button", name="Remove row 1", exact=True).click()
        expect(self.page.locator("#panel-parts-body tr")).to_have_count(0)
        expect(self.page.locator("#add-part")).to_be_focused()
        self.assertEqual(len(self.saved_panel(project["id"])["rows"]), 1)
        self.save_panel_ui()
        self.assertEqual(len(self.saved_panel(project["id"])["rows"]), 0)

    def test_manual_parts_save_reopen_edit_and_export_preserve_corrections(self):
        self.login()
        self.open_panels()
        self.start_draft()
        self.page.get_by_label("Description row 1", exact=True).fill('Comma, "quote" and\nsecond line Ω')
        self.page.get_by_label("Quantity row 1", exact=True).fill("7")
        self.page.get_by_label("Notes row 1", exact=True).fill(" retain surrounding spaces ")
        self.page.get_by_label("Review status row 1", exact=True).select_option("reviewed")
        saved = self.save_panel_ui(201)
        self.page.reload()
        expect(self.page.locator("#project-list button")).to_have_count(1)
        self.page.locator("#project-list button").click()
        expect(self.page.get_by_label("Notes row 1", exact=True)).to_have_value(" retain surrounding spaces ")
        self.page.get_by_label("Part number row 1", exact=True).fill("CORRECTED-42")
        expect(self.page.get_by_label("Review status row 1", exact=True)).to_have_value("unreviewed")
        updated = self.save_panel_ui()
        self.assertEqual(updated["version"], saved["version"] + 1)
        self.assertEqual(self.saved_panel(saved["id"])["rows"][0]["partNumber"], "CORRECTED-42")
        exported = self.download_csv()
        self.assertEqual(exported[1], ["CORRECTED-42", "SAMPLE COMPONENTS", 'Comma, "quote" and\nsecond line Ω', "7", "", "unreviewed", " retain surrounding spaces "])

    def test_export_uses_saved_rows_and_protects_formulas_while_retaining_the_draft(self):
        self.login()
        saved = self.create_panel(rows=[part(partNumber=" \t=1+1", manufacturer="@formula", notes="-SUM(A1)")])
        self.open_panels(saved["id"])
        self.page.get_by_label("Description row 1", exact=True).fill("Unsaved description")
        exported = self.download_csv()
        self.assertEqual(exported[1][0], "' \t=1+1")
        self.assertEqual(exported[1][1], "'@formula")
        self.assertEqual(exported[1][2], saved["rows"][0]["description"])
        self.assertEqual(exported[1][6], "'-SUM(A1)")
        expect(self.page.get_by_label("Description row 1", exact=True)).to_have_value("Unsaved description")
        expect(self.page.locator("#panel-export-status")).to_contain_text("unsaved edits")

    def test_blank_rows_and_incomplete_reviewed_rows_stay_unsaved(self):
        self.login()
        self.open_panels()
        self.start_draft(with_part=False)
        self.page.locator("#add-part").click()
        self.page.locator("#save-project").click()
        expect(self.page.locator("#project-error")).to_contain_text("empty")
        self.assertEqual(self.api("GET", "/api/panel-projects")["projects"], [])
        self.page.get_by_label("Description row 1", exact=True).fill("Part number is unreadable")
        self.page.get_by_label("Review status row 1", exact=True).select_option("reviewed")
        expect(self.page.get_by_label("Review status row 1", exact=True)).to_have_value("unreviewed")
        expect(self.page.locator("#project-error")).to_contain_text("fill part number")
        saved = self.save_panel_ui(201)
        self.assertEqual(saved["rows"][0]["manufacturer"], "")
        self.assertEqual(saved["rows"][0]["reviewStatus"], "unreviewed")

    def test_row_controls_match_the_server_field_limits(self):
        self.login()
        self.open_panels()
        self.start_draft()
        self.assertEqual(self.page.get_by_label("Part number row 1", exact=True).get_attribute("maxlength"), "128")
        self.assertEqual(self.page.get_by_label("Notes row 1", exact=True).get_attribute("maxlength"), "1000")
        self.page.get_by_label("Part number row 1", exact=True).fill("P" * 128)
        self.page.get_by_label("Notes row 1", exact=True).fill("N" * 1000)
        saved = self.save_panel_ui(201)
        self.assertEqual(len(saved["rows"][0]["partNumber"]), 128)
        self.assertEqual(len(saved["rows"][0]["notes"]), 1000)

    def test_lost_create_response_retries_the_same_identifier_and_saves_once(self):
        self.login()
        self.open_panels()
        self.start_draft()
        keys = []
        self.expected_console_errors.add("net::ERR_FAILED")

        def lose_first(route):
            if route.request.method != "POST":
                route.continue_()
                return
            keys.append(route.request.headers.get("idempotency-key"))
            if len(keys) == 1:
                self.assertEqual(route.fetch().status, 201)
                route.abort("failed")
            else:
                route.continue_()

        self.page.route(self.origin + "/api/panel-projects", lose_first)
        self.page.locator("#save-project").click()
        expect(self.page.locator("#project-retry")).to_be_visible()
        expect(self.page.locator("#project-name")).to_be_disabled()
        expect(self.page.locator("#new-project")).to_be_disabled()
        self.assertEqual(len(self.api("GET", "/api/panel-projects")["projects"]), 1)
        self.page.locator("#retry-project-save").click()
        expect(self.page.locator("#project-save-status")).to_contain_text("Project saved")
        self.assertEqual(len(keys), 2)
        self.assertTrue(keys[0])
        self.assertEqual(keys[0], keys[1])
        self.assertEqual(len(self.api("GET", "/api/panel-projects")["projects"]), 1)

    def test_lost_update_response_confirms_saved_data_without_a_second_revision(self):
        self.login()
        saved = self.create_panel()
        self.open_panels(saved["id"])
        self.page.locator("#project-notes").fill("Confirmed corrected note")
        writes = []
        self.expected_console_errors.add("net::ERR_FAILED")

        def lose_update(route):
            if route.request.method != "PATCH":
                route.continue_()
                return
            writes.append(route.request.post_data_json)
            self.assertEqual(route.fetch().status, 200)
            route.abort("failed")

        self.page.route(self.origin + "/api/panel-projects/" + saved["id"], lose_update)
        self.page.locator("#save-project").click()
        expect(self.page.locator("#project-retry")).to_be_visible()
        self.page.locator("#retry-project-save").click()
        expect(self.page.locator("#project-save-status")).to_contain_text("Project saved")
        self.assertEqual(len(writes), 1)
        actual = self.saved_panel(saved["id"])
        self.assertEqual(actual["version"], saved["version"] + 1)
        self.assertEqual(actual["notes"], "Confirmed corrected note")

    def test_uncertain_whitespace_only_update_is_not_falsely_confirmed_by_trimming(self):
        self.login()
        saved = self.create_panel(notes="memo", rows=[part(notes="part note")])
        self.open_panels(saved["id"])
        self.page.locator("#project-notes").fill(" memo ")
        self.page.get_by_label("Notes row 1", exact=True).fill(" part note ")
        attempts = []
        self.expected_console_errors.add("net::ERR_FAILED")

        def fail_before_commit(route):
            if route.request.method != "PATCH":
                route.continue_()
                return
            attempts.append(route.request.post_data_json)
            if len(attempts) == 1:
                route.abort("failed")
            else:
                route.continue_()

        self.page.route(self.origin + "/api/panel-projects/" + saved["id"], fail_before_commit)
        self.page.locator("#save-project").click()
        expect(self.page.locator("#project-retry")).to_be_visible()
        self.assertEqual(self.saved_panel(saved["id"])["version"], saved["version"])
        self.page.locator("#retry-project-save").click()
        expect(self.page.locator("#project-save-status")).to_contain_text("Project saved")
        self.assertEqual(len(attempts), 2)
        actual = self.saved_panel(saved["id"])
        self.assertEqual(actual["notes"], " memo ")
        self.assertEqual(actual["rows"][0]["notes"], " part note ")

    def test_stale_save_preserves_the_local_draft_and_never_overwrites_the_saved_revision(self):
        self.login()
        saved = self.create_panel()
        self.open_panels(saved["id"])
        self.api("PATCH", "/api/panel-projects/" + saved["id"], self.project_body(saved, notes="Other window correction"))
        self.page.locator("#project-notes").fill("Unsaved local correction")
        self.save_panel_ui(409)
        expect(self.page.locator("#project-conflict")).to_be_visible()
        expect(self.page.locator("#project-notes")).to_have_value("Unsaved local correction")
        self.assertEqual(self.saved_panel(saved["id"])["notes"], "Other window correction")
        self.page.locator("#reload-project").click()
        expect(self.page.locator("#panel-navigation-guard")).to_be_visible()
        self.page.locator("#panel-keep-editing").click()
        expect(self.page.locator("#project-notes")).to_have_value("Unsaved local correction")
        self.page.locator("#reload-project").click()
        self.page.locator("#panel-discard").click()
        expect(self.page.locator("#project-notes")).to_have_value("Other window correction")

    def test_project_switch_and_navigation_require_an_unsaved_draft_decision(self):
        self.login()
        saved = self.create_panel()
        other = self.create_panel(name="Second synthetic panel")
        self.open_panels(saved["id"])
        self.page.locator("#project-notes").fill("Keep this local draft")
        self.page.locator("#project-list button").filter(has_text=other["name"]).click()
        expect(self.page.locator("#panel-navigation-guard")).to_be_visible()
        self.page.locator("#panel-keep-editing").click()
        expect(self.page.locator("#project-notes")).to_have_value("Keep this local draft")
        self.page.locator("#project-list button").filter(has_text=other["name"]).click()
        self.page.locator("#panel-discard").click()
        expect(self.page.locator("#project-name")).to_have_value(other["name"])
        self.assertEqual(self.saved_panel(saved["id"])["notes"], "")

    def test_source_upload_preview_and_reopen_keep_private_image_bytes_intact(self):
        self.login()
        saved = self.create_panel(rows=[])
        self.open_panels(saved["id"])
        uploaded = self.upload_ui()
        source = uploaded["source"]
        self.assertEqual(uploaded["project"]["version"], saved["version"] + 1)
        expect(self.page.locator("#source-list li")).to_have_count(1)
        self.page.locator("#source-list [data-view]").click()
        image = self.page.locator("#source-list img")
        expect(image).to_be_visible()
        self.page.wait_for_function("document.querySelector('#source-list img')?.naturalWidth > 0")
        self.assertTrue(image.get_attribute("src").startswith("/api/panel-projects/") or image.get_attribute("src").startswith(self.origin + "/api/panel-projects/"))
        url = self.origin + "/api/panel-projects/" + saved["id"] + "/sources/" + source["id"]
        response = self.context.request.get(url)
        self.assertEqual(response.status, 200)
        self.assertEqual(response.body(), (FIXTURES / "complete.png").read_bytes())
        self.assertEqual(response.headers["cache-control"], "no-store")
        self.assertEqual(response.headers["cross-origin-resource-policy"], "same-origin")
        self.open_panels(saved["id"])
        expect(self.page.locator("#source-list li")).to_have_count(1)

    def test_uncertain_image_save_retries_the_same_source_without_duplicates(self):
        self.login()
        saved = self.create_panel(rows=[])
        self.open_panels(saved["id"])
        self.page.locator("#panel-image").set_input_files(str(FIXTURES / "complete.png"))
        keys = []
        self.expected_console_errors.add("net::ERR_FAILED")

        def lose_upload(route):
            keys.append(route.request.headers.get("idempotency-key"))
            if len(keys) == 1:
                self.assertEqual(route.fetch().status, 201)
                route.abort("failed")
            else:
                route.continue_()

        self.page.route(self.origin + "/api/panel-projects/" + saved["id"] + "/sources", lose_upload)
        self.page.locator("#upload-source").click()
        expect(self.page.locator("#source-status")).to_contain_text("unconfirmed")
        expect(self.page.locator("#project-name")).to_be_disabled()
        expect(self.page.locator("#panel-image")).to_be_disabled()
        self.assertEqual(len(self.saved_panel(saved["id"])["sources"]), 1)
        self.page.locator("#upload-source").click()
        expect(self.page.locator("#source-status")).to_contain_text("Source image saved")
        self.assertEqual(len(keys), 2)
        self.assertEqual(keys[0], keys[1])
        actual = self.saved_panel(saved["id"])
        self.assertEqual(len(actual["sources"]), 1)
        self.assertEqual(actual["version"], saved["version"] + 1)

    def test_invalid_image_cannot_be_saved_and_a_fifth_source_reaches_the_limit(self):
        self.login()
        saved = self.create_panel(rows=[])
        self.open_panels(saved["id"])
        self.page.locator("#panel-image").set_input_files({"name": "fake.png", "mimeType": "image/png", "buffer": b"not a PNG"})
        self.allow_http_error(400)
        self.page.locator("#upload-source").click()
        expect(self.page.locator("#source-error")).to_contain_text("valid")
        self.assertEqual(self.saved_panel(saved["id"])["sources"], [])
        current = saved
        for _ in range(5):
            current = self.upload_api(current)["project"]
        self.open_panels(saved["id"])
        expect(self.page.locator("#source-list li")).to_have_count(5)
        expect(self.page.locator("#panel-image")).to_be_disabled()
        expect(self.page.locator("#upload-source")).to_be_disabled()
        expect(self.page.locator("#source-save-help")).to_contain_text("five source images")

    def test_real_local_ocr_candidates_require_manual_add_review_and_save(self):
        self.login()
        saved = self.create_panel(rows=[])
        self.open_panels(saved["id"])
        availability = self.api("GET", "/api/panel-ocr")
        self.assertTrue(availability["available"], "CI must provide local Tesseract and English data")
        uploaded = self.upload_ui()
        with self.page.expect_response(lambda response: response.url.endswith("/ocr") and response.request.method == "POST", timeout=25000) as pending:
            self.page.locator("#source-list [data-ocr]").click()
        self.assertEqual(pending.value.status, 200, pending.value.text())
        expect(self.page.locator("#ocr-result")).to_be_visible()
        self.assertEqual(self.saved_panel(saved["id"])["rows"], [])
        self.page.locator("#add-ocr-rows").click()
        expect(self.page.get_by_label("Part number row 1", exact=True)).to_have_value("DEMO-1001")
        expect(self.page.get_by_label("Manufacturer row 1", exact=True)).to_have_value("SAMPLE COMPONENTS")
        expect(self.page.get_by_label("Review status row 1", exact=True)).to_have_value("unreviewed")
        self.assertEqual(self.saved_panel(saved["id"])["rows"], [])
        self.page.get_by_label("Description row 1", exact=True).fill("Human-corrected synthetic label")
        self.page.get_by_label("Review status row 1", exact=True).select_option("reviewed")
        corrected = self.save_panel_ui()
        self.assertEqual(corrected["rows"][0]["sourceImageId"], uploaded["source"]["id"])
        self.assertEqual(corrected["rows"][0]["reviewStatus"], "reviewed")
        self.assertEqual(self.download_csv()[1][2], "Human-corrected synthetic label")

    def test_real_partial_ocr_never_invents_a_manufacturer(self):
        self.login()
        saved = self.create_panel(rows=[])
        self.open_panels(saved["id"])
        uploaded = self.upload_ui("missing-manufacturer.png")
        with self.page.expect_response(lambda response: response.url.endswith("/ocr") and response.request.method == "POST", timeout=25000) as pending:
            self.page.locator("#source-list [data-ocr]").click()
        self.assertEqual(pending.value.status, 200, pending.value.text())
        self.page.locator("#add-ocr-rows").click()
        expect(self.page.get_by_label("Part number row 1", exact=True)).to_have_value("DEMO-3053")
        expect(self.page.get_by_label("Manufacturer row 1", exact=True)).to_have_value("")
        self.page.get_by_label("Review status row 1", exact=True).select_option("reviewed")
        expect(self.page.get_by_label("Review status row 1", exact=True)).to_have_value("unreviewed")
        actual = self.save_panel_ui()
        self.assertEqual(actual["rows"][0]["manufacturer"], "")
        self.assertEqual(actual["rows"][0]["sourceImageId"], uploaded["source"]["id"])

    def test_ocr_unavailable_keeps_manual_parts_working(self):
        self.login()

        def unavailable(route):
            route.fulfill(status=200, content_type="application/json", body=json.dumps({
                "available": False, "engine": "tesseract", "version": None,
                "language": "eng", "reason": "OCR_UNAVAILABLE",
            }))

        self.page.route(self.origin + "/api/panel-ocr", unavailable)
        self.open_panels()
        expect(self.page.locator("#ocr-engine-status")).to_contain_text("unavailable")
        self.start_draft()
        saved = self.save_panel_ui(201)
        self.upload_ui()
        expect(self.page.locator("#source-list [data-ocr]")).to_be_disabled()
        self.assertEqual(len(self.saved_panel(saved["id"])["rows"]), 1)
        self.assertEqual(len(self.download_csv()), 2)

    def test_other_business_cannot_read_edit_extract_or_download_project_sources(self):
        self.login()
        saved = self.create_panel()
        uploaded = self.upload_api(saved)
        base = "/api/panel-projects/" + saved["id"]
        other = self.seed_owner()
        self.api("POST", "/api/logout", status=204)
        self.login(username=other)
        self.assertEqual(self.api("GET", "/api/panel-projects")["projects"], [])
        self.api("GET", base, status=404)
        self.api("PATCH", base, self.project_body(uploaded["project"], notes="Cross tenant attempt"), status=404)
        self.api("POST", base + "/sources/" + uploaded["source"]["id"] + "/ocr", {"version": uploaded["project"]["version"]}, status=404)
        for suffix in ["/export.csv", "/sources/" + uploaded["source"]["id"]]:
            response = self.context.request.get(self.origin + base + suffix)
            self.assertEqual(response.status, 404)
            self.assertNotIn("DEMO-1001", response.text())
        self.open_panels()
        expect(self.page.locator("#project-list button")).to_have_count(0)

    def test_expired_save_redirects_to_login_without_changing_saved_parts(self):
        self.login()
        saved = self.create_panel()
        self.open_panels(saved["id"])
        self.page.get_by_label("Part number row 1", exact=True).fill("Must not be saved")
        self.api("POST", "/api/logout", status=204)
        self.allow_http_error(401)
        self.page.locator("#save-project").click()
        expect(self.page).to_have_url(self.origin + "/login")
        self.login()
        self.assertEqual(self.saved_panel(saved["id"])["rows"], saved["rows"])

    def test_html_like_values_remain_text_and_do_not_make_external_requests(self):
        self.login()
        markup = '<img src="https://external.example.test/leak" onerror="window.injected=true">'
        saved = self.create_panel(name="Synthetic <script> label", rows=[part(description=markup)])
        self.open_panels(saved["id"])
        expect(self.page.get_by_label("Description row 1", exact=True)).to_have_value(markup)
        expect(self.page.locator("#panel-parts-body img")).to_have_count(0)
        self.assertIsNone(self.page.evaluate("window.injected"))
        self.assertEqual(self.download_csv()[1][2], markup)

    def test_dashboard_counts_keep_intake_and_panel_records_in_one_session(self):
        self.login()
        self.create_request()
        saved = self.create_panel(rows=[part(), part(reviewStatus="reviewed")])
        self.page.goto(self.origin + "/dashboard")
        expect(self.page.locator("#dashboard-projects")).to_have_text("1")
        expect(self.page.locator("#dashboard-unreviewed")).to_have_text("1")
        expect(self.page.locator("#dashboard-requests")).to_have_text("1")
        self.page.locator("#dashboard-project-list a").click()
        expect(self.page.locator("#project-name")).to_have_value(saved["name"])

    def test_an_open_workspace_cannot_mix_records_after_another_tab_switches_the_account(self):
        self.login()
        self.create_request(customerName="Account A synthetic customer")
        self.page.locator("#refresh-requests").click()
        self.open_request("Account A synthetic customer")
        other = self.seed_owner()
        # The request context shares browser cookies but leaves the visible page
        # and its original session pin untouched, as a second tab would.
        switched = self.context.request.post(
            self.origin + "/api/login", headers={"Origin": self.origin},
            data={"username": other, "password": FIXTURE_PASSWORD},
        )
        self.assertEqual(switched.status, 200)
        self.create_request(customerName="Account B synthetic customer")
        self.allow_http_error(401)
        actual_responses = []

        def record_actual_refresh(route):
            if route.request.method != "GET":
                route.continue_()
                return
            # Capture the real server response before forwarding it unchanged.
            # Navigation to login can evict Chromium's response body afterward.
            response = route.fetch()
            actual_responses.append({"status": response.status, "body": response.json()})
            route.fulfill(response=response)

        self.page.route(self.origin + "/api/leads", record_actual_refresh)
        with self.page.expect_response(lambda response:
                response.url == self.origin + "/api/leads" and response.request.method == "GET") as pending:
            self.page.locator("#refresh-requests").click()
        self.assertEqual(pending.value.status, 401)
        self.assertEqual(len(actual_responses), 1)
        self.assertEqual(actual_responses[0]["status"], 401)
        self.assertEqual(actual_responses[0]["body"]["error"]["code"], "session_changed")
        expect(self.page).to_have_url(self.origin + "/login")
        expect(self.page.locator("body")).not_to_contain_text("Account A synthetic customer")
        expect(self.page.locator("body")).not_to_contain_text("Account B synthetic customer")


def load_tests(_loader, _tests, _pattern):
    names = sorted(name for name in PanelWorkspaceBrowserTests.__dict__ if name.startswith("test_"))
    return unittest.TestSuite(PanelWorkspaceBrowserTests(name) for name in names)


if __name__ == "__main__":
    unittest.main(verbosity=2)
