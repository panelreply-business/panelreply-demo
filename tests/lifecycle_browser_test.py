"""Deletion workflows against CI's synthetic loopback workspace only.

No real records, external integrations, public endpoints, or deployment.
"""
import json
import os
import base64
import re
import unittest
import uuid

from playwright.sync_api import expect
from panel_browser_test import PanelWorkspaceBrowserTests, part
from workspace_browser_test import DEFAULT_REQUEST


class LifecycleBrowserTests(PanelWorkspaceBrowserTests):
    def open_request(self, **changes):
        saved = self.api("POST", "/api/leads", {**DEFAULT_REQUEST, **changes}, status=201,
                         headers={"Idempotency-Key": uuid.uuid4().hex})["lead"]
        self.page.goto(self.origin + "/?lead=" + saved["id"])
        expect(self.page.locator("#lead-detail")).to_be_visible()
        return saved

    def dialog(self):
        return self.page.get_by_role("dialog")

    def confirm_delete(self):
        self.dialog().get_by_label("Type DELETE to confirm").fill("DELETE")
        self.dialog().get_by_role("button", name="Delete", exact=True).click()
        expect(self.dialog()).not_to_be_visible()

    def test_confirmation_cancel_keyboard_and_no_early_delete(self):
        self.login(keyboard=True)
        saved = self.create_panel()
        self.open_panels(saved["id"])
        self.page.locator("#delete-project").click()
        expect(self.dialog().get_by_role("button", name="Cancel", exact=True)).to_be_focused()
        expect(self.dialog().get_by_role("button", name="Delete", exact=True)).to_be_disabled()
        self.dialog().get_by_label("Type DELETE to confirm").fill("delete")
        expect(self.dialog().get_by_role("button", name="Delete", exact=True)).to_be_disabled()
        self.page.keyboard.press("Escape")
        expect(self.dialog()).not_to_be_visible()
        self.assertEqual(self.saved_panel(saved["id"]), saved)
        expect(self.page.locator("#project-name")).to_be_enabled()
        self.page.locator("#delete-project").focus()
        self.page.keyboard.press("Enter")
        self.confirm_delete()
        expect(self.page.locator("#project-content")).to_be_hidden()
        self.assertEqual(self.api("GET", "/api/panel-projects")["projects"], [])

    def test_request_deletion_clears_private_content_and_updates_list(self):
        self.login()
        saved = self.open_request(conversation=[{"role": "customer", "text": "Synthetic transcript for deletion."}])
        self.page.locator("#delete-lead").click()
        expect(self.dialog()).to_contain_text("Older encrypted backups")
        self.confirm_delete()
        expect(self.page.locator("#lead-detail")).to_be_hidden()
        expect(self.page.locator("#request-empty")).to_be_visible()
        self.assertEqual(self.api("GET", "/api/leads")["leads"], [])
        self.assertNotIn(saved["id"], self.page.url)
        self.assertNotIn("Synthetic transcript for deletion.", self.page.locator("body").text_content())

    def test_conversation_deletion_preserves_request_and_contact_hold(self):
        self.login()
        saved = self.open_request(job="The outlet is sparking", conversation=[{"role": "customer", "text": "The outlet is sparking."}])
        self.assertTrue(saved["safetyHold"])
        self.page.locator("#delete-conversation").click()
        self.confirm_delete()
        expect(self.page.locator("#lead-status")).to_contain_text("Conversation deleted")
        after = self.api("GET", "/api/leads/" + saved["id"])["lead"]
        self.assertEqual(after["conversation"], [])
        self.assertEqual(after["job"], saved["job"])
        self.assertTrue(after["safetyHold"])
        self.assertFalse(after["contactAllowed"])
        expect(self.page.locator("#delete-conversation")).to_be_disabled()
        expect(self.page.locator("#lead-name")).to_be_enabled()

    def test_source_delete_preserves_corrections_and_removes_reference(self):
        self.login()
        saved = self.create_panel()
        upload = self.upload_api(saved)
        p = upload["project"]
        p = self.api("PATCH", "/api/panel-projects/" + p["id"], self.project_body(p, rows=[part(partNumber="0000123", reviewStatus="reviewed", sourceImageId=upload["source"]["id"])]))["project"]
        self.open_panels(p["id"])
        self.page.locator("[data-delete-source]").click()
        self.confirm_delete()
        expect(self.page.locator("#source-status")).to_contain_text("Image deleted")
        after = self.saved_panel(p["id"])
        self.assertEqual(after["sources"], [])
        self.assertEqual(after["rows"][0]["partNumber"], "0000123")
        self.assertIsNone(after["rows"][0]["sourceImageId"])
        self.assertEqual(after["rows"][0]["reviewStatus"], "unreviewed")
        expect(self.page.locator("[data-delete-source]")).to_have_count(0)

    def test_lost_deletion_response_retries_same_body_and_key(self):
        self.login()
        saved = self.create_panel()
        self.open_panels(saved["id"])
        requests = []
        self.expected_console_errors.add("net::ERR_FAILED")
        def lose_once(route):
            if route.request.method != "DELETE":
                route.continue_()
                return
            requests.append((route.request.headers.get("idempotency-key"), route.request.post_data_json))
            if len(requests) == 1:
                response = route.fetch()
                self.assertEqual(response.status, 200)
                route.abort("failed")
            else:
                route.continue_()
        self.page.route(self.origin + "/api/panel-projects/" + saved["id"], lose_once)
        self.page.locator("#delete-project").click()
        self.dialog().get_by_label("Type DELETE to confirm").fill("DELETE")
        self.dialog().get_by_role("button", name="Delete", exact=True).click()
        retry = self.dialog().get_by_role("button", name="Retry same deletion", exact=True)
        expect(retry).to_be_enabled()
        expect(self.dialog().get_by_role("button", name="Cancel", exact=True)).to_be_disabled()
        self.page.keyboard.press("Escape")
        expect(self.dialog()).to_be_visible()
        retry.click()
        expect(self.dialog()).not_to_be_visible()
        self.assertEqual(len(requests), 2)
        self.assertEqual(requests[0], requests[1])
        self.assertTrue(requests[0][0])
        self.assertEqual(self.api("GET", "/api/panel-projects")["projects"], [])

    def test_retry_rejection_cannot_resolve_an_earlier_unknown_deletion(self):
        self.login()
        saved = self.create_panel()
        self.open_panels(saved["id"])
        requests = []
        self.expected_console_errors.add("net::ERR_FAILED")
        self.allow_http_error(403)
        def lost_then_rejected(route):
            if route.request.method != "DELETE":
                route.continue_()
                return
            requests.append((route.request.headers.get("idempotency-key"), route.request.post_data_json))
            if len(requests) == 1:
                self.assertEqual(route.fetch().status, 200)
                route.abort("failed")
            elif len(requests) == 2:
                route.fulfill(status=403, content_type="application/json", body=json.dumps({"error": {"code": "synthetic_rejection", "message": "Synthetic retry rejected"}}))
            else:
                route.continue_()
        self.page.route(self.origin + "/api/panel-projects/" + saved["id"], lost_then_rejected)
        self.page.locator("#delete-project").click()
        self.dialog().get_by_label("Type DELETE to confirm").fill("DELETE")
        self.dialog().get_by_role("button", name="Delete", exact=True).click()
        retry = self.dialog().get_by_role("button", name="Retry same deletion", exact=True)
        expect(retry).to_be_enabled()
        retry.click()
        expect(self.page.locator("#delete-confirm-error")).to_contain_text("Synthetic retry rejected")
        expect(self.dialog().get_by_role("button", name="Cancel", exact=True)).to_be_disabled()
        expect(retry).to_be_enabled()
        self.page.keyboard.press("Escape")
        expect(self.dialog()).to_be_visible()
        retry.click()
        expect(self.dialog()).not_to_be_visible()
        self.assertEqual(len(requests), 3)
        self.assertTrue(all(value == requests[0] for value in requests))
        self.assertEqual(self.api("GET", "/api/panel-projects")["projects"], [])

    def test_stale_delete_rejection_preserves_newer_saved_changes(self):
        self.login()
        saved = self.create_panel()
        self.open_panels(saved["id"])
        updated = self.api("PATCH", "/api/panel-projects/" + saved["id"], self.project_body(saved, notes="Second tab saved notes"))["project"]
        self.allow_http_error(409)
        self.page.locator("#delete-project").click()
        self.dialog().get_by_label("Type DELETE to confirm").fill("DELETE")
        self.dialog().get_by_role("button", name="Delete", exact=True).click()
        expect(self.page.locator("#delete-confirm-error")).to_contain_text("changed")
        self.dialog().get_by_role("button", name="Cancel", exact=True).click()
        self.assertEqual(self.saved_panel(saved["id"]), updated)
        expect(self.page.locator("#project-name")).to_be_enabled()

    def test_unsaved_edits_block_deletion_in_both_workspaces(self):
        self.login()
        self.open_request(conversation=[{"role": "customer", "text": "Synthetic history"}])
        self.page.locator("#lead-notes").fill("Unsaved note")
        expect(self.page.locator("#delete-lead")).to_be_disabled()
        expect(self.page.locator("#delete-conversation")).to_be_disabled()
        self.page.locator("#lead-notes").fill("")
        expect(self.page.locator("#delete-lead")).to_be_enabled()
        p = self.create_panel()
        self.open_panels(p["id"])
        self.page.locator("#project-notes").fill("Unsaved panel note")
        expect(self.page.locator("#delete-project")).to_be_disabled()
        self.page.locator("#project-notes").fill("")
        expect(self.page.locator("#delete-project")).to_be_enabled()

    def test_delete_after_session_change_clears_view_without_mutation(self):
        self.login()
        saved = self.create_panel()
        self.open_panels(saved["id"])
        self.page.locator("#delete-project").click()
        self.api("POST", "/api/logout", status=204)
        self.allow_http_error(401)
        self.dialog().get_by_label("Type DELETE to confirm").fill("DELETE")
        self.dialog().get_by_role("button", name="Delete", exact=True).click()
        expect(self.page).to_have_url(self.origin + "/login")
        self.login()
        self.assertEqual(self.saved_panel(saved["id"]), saved)

    def test_deletion_dialog_layout_at_six_widths_with_reduced_motion(self):
        self.login()
        saved = self.create_panel()
        self.open_panels(saved["id"])
        self.page.emulate_media(reduced_motion="reduce")
        for width in [360, 390, 430, 768, 1024, 1440]:
            with self.subTest(width=width):
                self.page.set_viewport_size({"width": width, "height": 800})
                self.page.locator("#delete-project").click()
                box = self.dialog().bounding_box()
                self.assertGreaterEqual(box["x"], 0)
                self.assertLessEqual(box["x"] + box["width"], width)
                self.assertLessEqual(self.page.evaluate("document.documentElement.scrollWidth"), width)
                for button in self.dialog().get_by_role("button").all():
                    self.assertGreaterEqual(button.bounding_box()["height"], 44)
                self.assertEqual(self.dialog().evaluate("el => getComputedStyle(el).animationName"), "none")
                if width in [360, 1440] and os.environ.get("PANELREPLY_EMIT_LIFECYCLE_PREVIEWS") == "1":
                    data = self.page.screenshot(type="jpeg", quality=75, animations="disabled")
                    encoded = base64.b64encode(data).decode("ascii")
                    print(f"LIFECYCLE_PREVIEW_START:deletion-{width}.jpg", flush=True)
                    for offset in range(0, len(encoded), 5800):
                        print(encoded[offset:offset + 5800], flush=True)
                    print(f"LIFECYCLE_PREVIEW_END:deletion-{width}.jpg", flush=True)
                self.dialog().get_by_role("button", name="Cancel", exact=True).click()


def load_tests(_loader, _tests, _pattern):
    names = sorted(name for name in LifecycleBrowserTests.__dict__ if name.startswith("test_"))
    return unittest.TestSuite(LifecycleBrowserTests(name) for name in names)

if __name__ == "__main__":
    unittest.main(verbosity=2)
