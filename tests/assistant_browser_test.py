"""Real browser/HTTP/SQLite checks with a disclosed synthetic assistant adapter."""

import json
import unittest

from playwright.sync_api import expect
from workspace_browser_test import PrivateWorkspaceBrowserTests


class AssistantBrowserTests(PrivateWorkspaceBrowserTests):
    server_entry = "tests/fixtures/fake-assistant-server.cjs"
    fixture_env = {"PANELREPLY_SYNTHETIC_ASSISTANT_TEST": "1"}

    def setUp(self):
        # Each scenario gets its own process-wide provider allowance. Production
        # limits stay unchanged, and the real database survives this restart.
        type(self).stop_server()
        type(self).start_server()
        super().setUp()

    def open_assistant(self):
        self.login()
        self.page.goto(self.origin + "/preview")
        expect(self.page.locator("#send-message")).to_be_enabled()
        expect(self.page.locator("#assistant-mode-status")).to_contain_text("Synthetic provider test")

    def say(self, message):
        self.page.locator("#customer-message").fill(message)
        with self.page.expect_response(lambda r: r.url.endswith("/api/preview") and r.request.method == "POST") as waiting:
            self.page.locator("#send-message").click()
        response = waiting.value
        self.assertEqual(response.status, 200, response.text())
        expect(self.page.locator("#send-message")).to_be_enabled()
        return response.json()

    def test_context_correction_review_save_and_reopen_use_real_private_storage(self):
        self.open_assistant()
        first = self.say("I'm Jamie Stone. I need a 200-amp panel upgrade.")
        self.assertEqual(first["assistance"]["mode"], "fake-provider")
        expect(self.page.locator("#preview-name")).to_have_value("Jamie Stone")
        expect(self.page.locator("#preview-job")).to_have_value("200-amp panel upgrade")
        self.say("48315. Can you do Saturday?")
        expect(self.page.locator("#preview-zip")).to_have_value("48315")
        expect(self.page.locator("#preview-work-date")).to_have_value("Saturday")
        self.say("My phone is 586-555-0101")
        self.say("Actually my phone is 586-555-0102")
        expect(self.page.locator("#preview-phone")).to_have_value("+15865550102")
        expect(self.page.locator("#conversation")).to_contain_text("No appointment is booked")
        self.assertEqual(self.api("GET", "/api/leads")["leads"], [])
        self.page.locator("#preview-permission").select_option("requested_callback")
        with self.page.expect_response(lambda r: r.url.endswith("/api/leads") and r.request.method == "POST") as waiting:
            self.page.locator("#save-request").click()
        self.assertEqual(waiting.value.status, 201)
        saved = waiting.value.json()["lead"]
        expect(self.page.locator("#save-success")).to_be_visible()
        self.page.reload()
        expect(self.page.locator("#send-message")).to_be_enabled()
        reopened = self.api("GET", "/api/leads/" + saved["id"])["lead"]
        self.assertEqual(reopened, saved)
        self.assertEqual(reopened["requestedWorkDate"], "Saturday")
        self.assertEqual(reopened["phone"], "+15865550102")
        self.assertIn("200-amp panel upgrade", reopened["job"])

    def test_provider_failure_and_invalid_output_preserve_validated_fields_and_recover(self):
        self.open_assistant()
        self.say("I'm Jamie Stone. I need a 200-amp panel upgrade.")
        for trigger in ["Simulate provider failure", "Simulate malformed provider output"]:
            response = self.say(trigger)
            self.assertEqual(response["assistance"]["mode"], "unavailable")
            expect(self.page.locator("#preview-name")).to_have_value("Jamie Stone")
            expect(self.page.locator("#preview-job")).to_have_value("200-amp panel upgrade")
            expect(self.page.locator("#preview-status")).to_contain_text("previous fields are unchanged")
            expect(self.page.locator("#save-success")).to_be_hidden()
        self.say("48315. Can you do Saturday?")
        expect(self.page.locator("#preview-zip")).to_have_value("48315")
        self.assertEqual(self.api("GET", "/api/leads")["leads"], [])

    def test_reset_during_assistance_discards_late_response_and_preserves_saved_records(self):
        self.open_assistant()
        self.page.locator("#customer-message").fill("I'm Jamie Stone. I need a 200-amp panel upgrade.")
        with self.page.expect_request(lambda r: r.url.endswith("/api/preview") and r.method == "POST"):
            self.page.locator("#send-message").click()
        self.page.locator("#reset-draft").click()
        expect(self.page.locator("#preview-navigation-guard")).to_be_visible()
        self.page.locator("#preview-discard").click()
        expect(self.page.locator("#preview-name")).to_have_value("")
        expect(self.page.locator("#conversation")).to_be_empty()
        self.say("48315. Can you do Saturday?")
        expect(self.page.locator("#preview-name")).to_have_value("")
        expect(self.page.locator("#preview-job")).to_have_value("")
        self.assertEqual(self.api("GET", "/api/leads")["leads"], [])

    def test_stop_blocks_followup_assistance_and_remains_after_reset(self):
        self.open_assistant()
        self.say("My phone is 586-555-0101")
        response = self.say("STOP")
        self.assertTrue(response["state"]["stopped"])
        self.assertEqual(response["assistance"]["mode"], "deterministic")
        self.page.locator("#reset-draft").click()
        self.page.locator("#preview-discard").click()
        response = self.say("My phone is 586-555-0101")
        self.assertTrue(response["state"]["stopped"])
        self.assertEqual(response["replies"], [])
        expect(self.page.locator("#preview-permission")).to_have_value("opted_out")
        self.assertEqual(self.api("GET", "/api/leads")["leads"], [])


def load_tests(loader, _tests, _pattern):
    return unittest.TestSuite(AssistantBrowserTests(name) for name in sorted(AssistantBrowserTests.__dict__) if name.startswith("test_"))


if __name__ == "__main__":
    unittest.main(verbosity=2)
