"""Real macOS spreadsheet persistence and fail-closed native OCR checks.

The regular selected-product suite supplies its existing non-OCR cases, with
their original IDs. These cases add macOS's actual missing-engine behavior and
encrypted product recovery. There is no mocked OCR response or extraction pass.
All users, files and data are synthetic and stay on the disposable CI runner.
"""

import json
import platform
import subprocess
import unittest
from pathlib import Path

from playwright.sync_api import expect

from product_browser_test import SpreadsheetProductBrowserTests
from workspace_browser_test import FIXTURE_PASSWORD, ROOT


BACKUP_PASSPHRASE = "Synthetic Mac product recovery passphrase 2026!"


class MacSpreadsheetProductBrowserTests(SpreadsheetProductBrowserTests):
    @classmethod
    def setUpClass(cls):
        if platform.system() != "Darwin":
            raise RuntimeError("This suite requires actual macOS; no platform emulation is accepted")
        super().setUpClass()

    def command(self, args, stdin):
        result = subprocess.run(["node", *args], cwd=ROOT, env=self.node_env,
                                input=stdin + "\n", capture_output=True, text=True,
                                timeout=45, check=False)
        self.assertEqual(result.returncode, 0, result.stderr)
        return json.loads(result.stdout)

    def test_spreadsheet_native_ocr_unavailable_preserves_manual_rows_and_source(self):
        self.login()
        saved = self.create_panel(name="Synthetic Mac manual project")
        self.open_panels(saved["id"])
        availability = self.api("GET", "/api/panel-ocr")
        self.assertIs(availability["available"], False)
        self.assertEqual(availability["reason"], "engine_unavailable")
        expect(self.page.locator("#ocr-engine-status")).to_contain_text("unavailable")
        uploaded = self.upload_ui()
        expect(self.page.locator("#source-list [data-ocr]")).to_be_disabled()
        before = self.saved_panel(saved["id"])
        response = self.api("POST", "/api/panel-projects/" + saved["id"] +
                            "/sources/" + uploaded["source"]["id"] + "/ocr",
                            {"version": before["version"]}, status=503)
        self.assertEqual(response["error"]["code"], "OCR_UNAVAILABLE")
        self.assertEqual(self.saved_panel(saved["id"]), before)
        self.page.get_by_label("Description row 1", exact=True).fill("Human corrected on macOS")
        corrected = self.save_panel_ui()
        self.assertEqual(corrected["rows"][0]["description"], "Human corrected on macOS")
        self.assertEqual(self.download_csv()[1][2], "Human corrected on macOS")
        self.assert_product_navigation()
        self.capture("spreadsheet-macos-manual-and-unavailable-ocr.jpg")

    def test_spreadsheet_bound_restore_rejects_old_session_and_preserves_private_source(self):
        self.login()
        saved = self.create_panel(name="Synthetic Mac restored project")
        self.open_panels(saved["id"])
        uploaded = self.upload_ui()
        before = self.saved_panel(saved["id"])
        source_path = "/api/panel-projects/" + saved["id"] + "/sources/" + uploaded["source"]["id"]
        source_response = self.context.request.get(self.origin + source_path)
        self.assertEqual(source_response.status, 200)
        source_bytes = source_response.body()

        cls = type(self)
        original_dir = cls.data_dir
        archive = Path(cls.directory.name).resolve() / "spreadsheet-recovery.prbk"
        restored_dir = Path(cls.directory.name).resolve() / "restored-spreadsheet"
        cls.stop_server()
        try:
            created = self.command(["scripts/workspace-backup.cjs", "create", "--data-dir",
                                    str(original_dir), "--output", str(archive),
                                    "--product", "spreadsheet"], BACKUP_PASSPHRASE)
            self.assertEqual(created["product"], "spreadsheet")
            restored = self.command(["scripts/workspace-backup.cjs", "restore", "--backup",
                                     str(archive), "--data-dir", str(restored_dir),
                                     "--product", "spreadsheet"], BACKUP_PASSPHRASE)
            self.assertIs(restored["sessionsRestored"], False)
            self.assertIs(restored["passwordResetRequired"], True)
            binding = json.loads((restored_dir / "product-binding.json").read_text())
            self.assertEqual(binding["product"], "spreadsheet")
            self.assertEqual(restored_dir.stat().st_mode & 0o777, 0o700)

            cls.data_dir = restored_dir
            cls.start_server()
            self.api("GET", "/api/session", status=401)
            # Restored password hashes remain disabled until operator recovery.
            login = self.context.request.post(self.origin + "/api/login",
                                             headers={"Origin": self.origin},
                                             data={"username": self.username,
                                                   "password": FIXTURE_PASSWORD})
            self.assertEqual(login.status, 401)
            self.command(["scripts/workspace-reset-password.cjs", "--data-dir",
                          str(restored_dir), "--username", self.username], FIXTURE_PASSWORD)
            self.login()
            self.open_panels(saved["id"])
            expect(self.page.locator("#project-name")).to_have_value("Synthetic Mac restored project")
            self.assertEqual(self.saved_panel(saved["id"]), before)
            recovered = self.context.request.get(self.origin + source_path)
            self.assertEqual(recovered.status, 200)
            self.assertEqual(recovered.body(), source_bytes)
            self.assert_routes_denied(["/api/leads", "/api/profile", "/preview"])
            self.assert_product_navigation()
        finally:
            cls.stop_server()
            cls.data_dir = original_dir
            cls.start_server()


def load_tests(_loader, _tests, _pattern):
    return unittest.TestSuite(MacSpreadsheetProductBrowserTests(name)
                              for name in sorted(MacSpreadsheetProductBrowserTests.__dict__)
                              if name.startswith("test_"))


if __name__ == "__main__":
    unittest.main(verbosity=2)

