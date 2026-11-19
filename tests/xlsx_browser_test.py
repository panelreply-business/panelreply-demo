"""Saved XLSX exports through the real private server and browser.

These tests inherit the isolated, synthetic workspace harness and independent
openpyxl reader. No public service, provider, or customer data is used.
"""

from pathlib import Path
import io
import unittest

from openpyxl import load_workbook
from playwright.sync_api import expect

from panel_browser_test import PanelWorkspaceBrowserTests, part
from workspace_browser_test import FIXTURE_PASSWORD


class XlsxBrowserTests(PanelWorkspaceBrowserTests):
    def workbook_download(self):
        with self.page.expect_download() as pending:
            self.page.locator("#export-project-xlsx").click()
        download = pending.value
        self.assertIsNone(download.failure())
        self.assertTrue(download.suggested_filename.endswith(".xlsx"))
        book = load_workbook(io.BytesIO(Path(download.path()).read_bytes()), data_only=False, keep_links=False)
        self.addCleanup(book.close)
        return book

    def test_saved_corrections_reopen_and_download_as_typed_values(self):
        self.login()
        saved = self.create_panel()
        self.open_panels(saved["id"])
        self.page.get_by_label("Part number row 1", exact=True).fill("000123")
        self.page.get_by_label("Manufacturer row 1", exact=True).fill("=SYNTHETIC()")
        self.page.get_by_label("Description row 1", exact=True).fill('Corrected, "quoted" Ω\nsecond line')
        self.page.get_by_label("Quantity row 1", exact=True).fill("7")
        self.page.get_by_label("Notes row 1", exact=True).fill(" _x005F_x0041_ ")
        updated = self.save_panel_ui()
        self.page.reload()
        expect(self.page.locator("#project-content")).to_be_visible()
        book = self.workbook_download()
        cells = list(book["Parts"][2])
        self.assertEqual([cell.value for cell in cells], ["000123", "=SYNTHETIC()", 'Corrected, "quoted" Ω\nsecond line', 7, "", "unreviewed", " _x005F_x0041_ "])
        self.assertEqual([cell.data_type for cell in cells], ["s", "s", "s", "n", "s", "s", "s"])
        self.assertEqual(book["Parts"].freeze_panes, "A2")
        self.assertEqual(book["Parts"].auto_filter.ref, "A1:G2")
        self.assertEqual(book["Project"]["B4"].value, str(updated["version"]))
        expect(self.page.locator("#panel-export-status")).to_contain_text("Saved XLSX prepared")

    def test_unsaved_edits_stay_in_editor_and_do_not_enter_saved_workbook(self):
        self.login()
        saved = self.create_panel(notes="Saved project note", rows=[part(partNumber="000001", notes="Saved row note")])
        self.open_panels(saved["id"])
        self.page.get_by_label("Part number row 1", exact=True).fill("UNSAVED-CHANGE")
        self.page.locator("#project-notes").fill("Unsaved note")
        book = self.workbook_download()
        self.assertEqual(book["Parts"]["A2"].value, "000001")
        self.assertEqual(book["Parts"]["G2"].value, "Saved row note")
        self.assertEqual(book["Project"]["B7"].value, "Saved project note")
        expect(self.page.get_by_label("Part number row 1", exact=True)).to_have_value("UNSAVED-CHANGE")
        expect(self.page.locator("#project-dirty")).to_be_visible()
        expect(self.page.locator("#panel-export-status")).to_contain_text("unsaved edits")

    def test_export_network_failure_is_visible_and_retry_preserves_project(self):
        self.login()
        saved = self.create_panel()
        self.open_panels(saved["id"])
        downloads = []
        self.page.on("download", downloads.append)
        self.expected_console_errors.add("net::ERR_FAILED")
        route_url = self.origin + "/api/panel-projects/" + saved["id"] + "/export.xlsx"
        self.page.route(route_url, lambda route: route.abort("failed"))
        self.page.locator("#export-project-xlsx").click()
        expect(self.page.locator("#panel-export-error")).to_contain_text("Could not reach")
        expect(self.page.locator("#export-project-xlsx")).to_be_enabled()
        self.assertEqual(downloads, [])
        self.page.unroute(route_url)
        book = self.workbook_download()
        self.assertEqual(book["Parts"]["A2"].value, saved["rows"][0]["partNumber"])
        self.assertEqual(self.saved_panel(saved["id"]), saved)

    def test_wrong_type_and_empty_binary_body_never_report_success(self):
        self.login()
        saved = self.create_panel()
        self.open_panels(saved["id"])
        downloads = []
        self.page.on("download", downloads.append)
        route_url = self.origin + "/api/panel-projects/" + saved["id"] + "/export.xlsx"
        for mime, body in [("application/json", '{}'), ("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "")]:
            self.page.route(route_url, lambda route, mime=mime, body=body: route.fulfill(status=200, content_type=mime, body=body))
            self.page.locator("#export-project-xlsx").click()
            expect(self.page.locator("#panel-export-error")).to_contain_text("did not return a XLSX file")
            expect(self.page.locator("#panel-export-status")).to_be_empty()
            self.assertEqual(downloads, [])
            self.page.unroute(route_url)

    def test_session_change_after_binary_response_prevents_stale_download(self):
        self.login()
        saved = self.create_panel()
        self.open_panels(saved["id"])
        other_username = self.seed_owner()
        downloads = []
        self.page.on("download", downloads.append)
        self.allow_http_error(401)

        def change_cookie_after_export(route):
            response = route.fetch()
            self.assertEqual(response.status, 200)
            login = self.context.request.post(self.origin + "/api/login", data={"username": other_username, "password": FIXTURE_PASSWORD}, headers={"Origin": self.origin})
            self.assertEqual(login.status, 200)
            route.fulfill(response=response)

        self.page.route(self.origin + "/api/panel-projects/" + saved["id"] + "/export.xlsx", change_cookie_after_export)
        self.page.locator("#export-project-xlsx").click()
        expect(self.page).to_have_url(self.origin + "/login")
        self.assertEqual(downloads, [])
        expect(self.page.locator("body")).not_to_contain_text(saved["name"])

    def test_download_trigger_failure_cleans_up_blob_and_allows_retry(self):
        self.login()
        saved = self.create_panel()
        self.open_panels(saved["id"])
        self.page.evaluate("""() => {
            window.exportOriginalClick = HTMLAnchorElement.prototype.click;
            window.exportOriginalCreate = URL.createObjectURL;
            window.exportOriginalRevoke = URL.revokeObjectURL;
            window.exportCreated = [];
            window.exportRevoked = [];
            URL.createObjectURL = value => { const url = window.exportOriginalCreate(value); window.exportCreated.push(url); return url; };
            URL.revokeObjectURL = url => { window.exportRevoked.push(url); window.exportOriginalRevoke(url); };
            HTMLAnchorElement.prototype.click = () => { throw new Error('Synthetic download trigger failure'); };
        }""")
        self.page.locator("#export-project-xlsx").click()
        expect(self.page.locator("#panel-export-error")).to_contain_text("Synthetic download trigger failure")
        urls = self.page.evaluate("() => ({created: window.exportCreated, revoked: window.exportRevoked})")
        self.assertEqual(len(urls["created"]), 1)
        self.assertEqual(urls["revoked"], urls["created"])
        self.page.evaluate("() => { HTMLAnchorElement.prototype.click = window.exportOriginalClick; }")
        self.workbook_download()

    def test_unrepresentable_xml_text_has_explicit_error_and_csv_fallback(self):
        self.login()
        saved = self.create_panel(rows=[part(notes="Preserve\ufffevalue")])
        self.open_panels(saved["id"])
        self.allow_http_error(422)
        self.page.locator("#export-project-xlsx").click()
        expect(self.page.locator("#panel-export-error")).to_contain_text("use CSV")
        expect(self.page.locator("#panel-export-status")).to_be_empty()
        rows = self.download_csv()
        self.assertEqual(rows[1][6], "Preserve\ufffevalue")
        self.assertEqual(self.saved_panel(saved["id"]), saved)


def load_tests(_loader, _tests, _pattern):
    names = sorted(name for name in XlsxBrowserTests.__dict__ if name.startswith("test_"))
    return unittest.TestSuite(XlsxBrowserTests(name) for name in names)


if __name__ == "__main__":
    unittest.main(verbosity=2)
