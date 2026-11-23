"""Fixed callback product journeys with browser-emulated phone/tablet touch.

These cases use the real private callback entrypoint, synthetic owners/requests,
and trusted Playwright touch input for task and navigation controls. They do not
establish physical-device, operating-system keyboard, or branded Safari/Chrome
acceptance. Existing request, console, CSP and product-boundary guards remain
active through the shared harnesses.
"""

from datetime import datetime, timedelta, timezone
import re
import unittest
from urllib.parse import parse_qs, urlsplit

from playwright.sync_api import expect
from product_browser_test import SelectedProductHarness
from release_mobile_browser_test import ENGINE, PROFILES, MobileWorkspaceTests


TOUCH_PAIR = [
    {"type": "touchstart", "trusted": True, "touches": 1, "changedTouches": 1},
    {"type": "touchend", "trusted": True, "touches": 0, "changedTouches": 1},
]


def relative_task_times(generated_at):
    """Use the server clock, UTC and whole-day margins for queue assertions."""
    anchor = datetime.fromisoformat(generated_at).astimezone(timezone.utc).replace(second=0, microsecond=0)
    return {name: (anchor + timedelta(days=days)).isoformat(timespec="milliseconds").replace("+00:00", "Z")
            for name, days in [("overdue", -2), ("upcoming", 2), ("follow_up", 3)]}


class CallbackMobileBrowserTests(SelectedProductHarness, MobileWorkspaceTests):
    product_id = "callback"
    product_scope = "callback"
    product_label = "PanelReply Callback"
    home_path = "/"
    server_entry = "callback-server.cjs"

    def setUp(self):
        super().setUp()
        self.touch_evidence["actions"] = []

    def login_touch(self):
        super().login_touch()
        self.assert_product_navigation()
        product = self.api("GET", "/api/session")["product"]
        self.assertEqual(product["id"], "callback")
        self.assertIs(product["capabilities"]["callbackScheduling"], True)
        self.assertIs(product["capabilities"]["panelProjects"], False)
        cookies = {item["name"] for item in self.context.cookies()}
        self.assertIn("PanelReplyCallbackLocalSession", cookies)
        self.assertNotIn("PanelReplySpreadsheetLocalSession", cookies)
        snapshot = self.api("GET", "/api/callback-tasks?state=all")
        self.times = relative_task_times(snapshot["generatedAt"])
        self.touch_evidence["timeFixtures"] = {"serverGeneratedAt": snapshot["generatedAt"],
                                               "timeZone": "UTC", **self.times}

    def tap_trusted(self, locator, action):
        """Observe the actual input path without dispatching synthetic events.

        Capture on document so a task-card re-render cannot erase its evidence.
        These controls change in-page state. Login and explicit reloads use the
        shared mobile harness and do not pretend to preserve a document probe.
        """
        expect(locator).to_be_enabled()
        locator.evaluate("""element => {
            const probe = {events: [], targetsMatched: true};
            window.__callbackTouchProbe = probe;
            for (const type of ['touchstart', 'touchend']) {
                document.addEventListener(type, event => {
                    probe.targetsMatched &&= element.contains(event.target);
                    probe.events.push({type: event.type, trusted: event.isTrusted,
                        touches: event.touches.length, changedTouches: event.changedTouches.length});
                }, {capture: true, once: true, passive: true});
            }
        }""")
        locator.tap()
        probe = self.page.evaluate("""() => {
            const probe = window.__callbackTouchProbe;
            delete window.__callbackTouchProbe;
            return probe;
        }""")
        self.touch_evidence["actions"].append({"action": action, "events": probe["events"]})
        self.assertIs(probe["targetsMatched"], True, action)
        self.assertEqual(probe["events"], TOUCH_PAIR, action)

    def wait_tasks(self, count):
        suffix = "task" if count == 1 else "tasks"
        expect(self.page.locator("#lead-task-status")).to_have_text(f"{count} of {count} saved {suffix}.")
        expect(self.page.locator("#lead-task-list .callback-task-card")).to_have_count(count)

    def open_saved_request(self, saved, task_count=0):
        self.page.goto(self.origin + "/?lead=" + saved["id"])
        expect(self.page.get_by_label("Customer name", exact=True)).to_have_value(saved["customerName"])
        self.wait_tasks(task_count)
        self.assert_no_overflow()

    def fill_task_time(self, instant):
        self.page.get_by_label("Time zone", exact=True).fill("UTC")
        self.page.get_by_label("Callback date and time", exact=True).fill(instant[:16])
        expect(self.page.locator("#task-time-preview")).to_contain_text("UTC: " + instant)
        expect(self.page.get_by_label("Which occurrence?", exact=True)).to_be_hidden()

    def save_task_touch(self, action, expected_status, task_count):
        with self.page.expect_response(lambda response:
                re.fullmatch(re.escape(self.origin) + r"/api/(?:leads/[0-9a-f-]+/tasks|callback-tasks/[0-9a-f-]+)", response.url)
                and response.request.method in {"POST", "PATCH"}) as pending:
            self.tap_trusted(self.page.locator("#save-callback-task"), action)
        response = pending.value
        self.assertEqual(response.status, expected_status, response.text())
        result = response.json()
        expect(self.page.locator("#task-save-status")).not_to_be_empty()
        expect(self.page.locator("#task-dirty")).to_be_hidden()
        self.wait_tasks(task_count)
        self.assert_no_overflow()
        return result

    def save_request_touch(self, saved, action):
        with self.page.expect_response(lambda response:
                response.url == self.origin + "/api/leads/" + saved["id"]
                and response.request.method == "PATCH") as pending:
            self.tap_trusted(self.page.get_by_role("button", name="Save changes", exact=True), action)
        response = pending.value
        self.assertEqual(response.status, 200, response.text())
        expect(self.page.locator("#lead-status")).to_contain_text("Changes saved")
        expect(self.page.locator("#lead-dirty")).to_be_hidden()
        expect(self.page.locator("#lead-task-status")).to_have_text(re.compile(r"^\d+ of \d+ saved tasks?\.$"))
        return response.json()["lead"]

    def queue_touch(self, state, task_ids, action):
        self.tap_trusted(self.page.locator("#nav-schedule"), action)
        expect(self.page).to_have_title("Callback queue · PanelReply Callback")
        expect(self.page.locator("#callback-queue-status")).to_contain_text("Queue refreshed.")
        with self.page.expect_response(lambda response:
                response.request.method == "GET"
                and response.url.split("?", 1)[0] == self.origin + "/api/callback-tasks"
                and parse_qs(urlsplit(response.url).query).get("state") == [state]) as pending:
            self.page.get_by_label("Show tasks", exact=True).select_option(state)
        self.assertEqual(pending.value.status, 200, pending.value.text())
        self.assertEqual(sorted(task["id"] for task in pending.value.json()["tasks"]), sorted(task_ids))
        # The filter can have the same number of rows as the preceding view.
        # Check the response and rendered IDs, not only the list length.
        expect(self.page.locator("#callback-queue-status")).to_contain_text("Queue refreshed.")
        cards = self.page.locator("#callback-queue-list .callback-task-card")
        expect(cards).to_have_count(len(task_ids))
        self.page.wait_for_function("""expected => {
            const actual = [...document.querySelectorAll('#callback-queue-list .callback-task-card')]
                .map(element => element.dataset.taskId).sort();
            return JSON.stringify(actual) === JSON.stringify(expected.slice().sort()) &&
                document.querySelector('#callback-queue-status').textContent.startsWith('Queue refreshed.');
        }""", arg=task_ids)
        self.assert_no_overflow()

    def open_queue_task_touch(self, task, action, task_count):
        card = self.page.locator('#callback-queue-list [data-task-id="' + task["id"] + '"]')
        self.tap_trusted(card.get_by_role("button", name="Open request", exact=False), action)
        expect(self.page.locator("#inbox-view")).to_be_visible()
        expect(self.page.get_by_label("Customer name", exact=True)).to_have_value(task["customerName"])
        self.wait_tasks(task_count)

    def behavior_scheduling_lifecycle(self):
        self.login_touch()
        saved = self.create_request(customerName="Synthetic Mobile Schedule")
        self.open_saved_request(saved)
        self.fill_task_time(self.times["overdue"])
        self.page.get_by_label("Task notes", exact=True).fill("First touch callback plan Ω")
        first = self.save_task_touch("schedule-task", 201, 1)
        self.assertEqual(first["task"]["dueAt"], self.times["overdue"])
        self.assertEqual(first["task"]["timeZone"], "UTC")
        self.assertEqual(first["task"]["dueState"], "overdue")
        self.assertEqual(first["lead"]["version"], saved["version"] + 1)

        self.queue_touch("due", [first["task"]["id"]], "open-due-queue")
        expect(self.page.locator("#callback-queue-list")).to_contain_text("Overdue")
        self.open_queue_task_touch(first["task"], "open-overdue-request", 1)
        card = self.page.locator('#lead-task-list [data-task-id="' + first["task"]["id"] + '"]')
        self.tap_trusted(card.get_by_role("button", name="Reschedule", exact=True), "reschedule-task")
        expect(self.page.get_by_label("Task notes", exact=True)).to_have_value("First touch callback plan Ω")
        self.fill_task_time(self.times["upcoming"])
        rescheduled = self.save_task_touch("save-rescheduled-task", 200, 1)
        self.assertEqual(rescheduled["task"]["dueAt"], self.times["upcoming"])
        self.assertEqual(rescheduled["task"]["dueState"], "upcoming")
        self.assertEqual(rescheduled["task"]["version"], first["task"]["version"] + 1)
        self.assertEqual(rescheduled["task"]["notes"], first["task"]["notes"])
        expect(card).to_contain_text("Upcoming")

        self.queue_touch("due", [], "check-rescheduled-due-queue")
        expect(self.page.locator("#callback-queue-list")).to_contain_text("No tasks match")
        self.queue_touch("open", [first["task"]["id"]], "open-upcoming-queue")
        self.open_queue_task_touch(rescheduled["task"], "open-upcoming-request", 1)
        self.tap_trusted(card.get_by_role("button", name="Record outcome", exact=True), "record-outcome")
        self.page.get_by_label("Call outcome", exact=True).select_option("no_answer")
        self.page.get_by_label("Task notes", exact=True).fill("Synthetic outcome only. No call made.")
        completed = self.save_task_touch("save-call-outcome", 200, 1)
        self.assertEqual(completed["task"]["status"], "completed")
        self.assertEqual(completed["task"]["outcome"], "no_answer")
        self.assertEqual(completed["task"]["version"], rescheduled["task"]["version"] + 1)
        self.assertIsNotNone(completed["task"]["completedAt"])
        self.assertEqual(card.get_by_role("button").count(), 0)

        self.page.get_by_label("Task type", exact=True).select_option("follow_up")
        self.fill_task_time(self.times["follow_up"])
        self.page.get_by_label("Task notes", exact=True).fill("Separate follow-up after synthetic no answer")
        follow = self.save_task_touch("schedule-follow-up", 201, 2)
        self.assertEqual(follow["task"]["kind"], "follow_up")
        self.assertEqual(follow["task"]["dueAt"], self.times["follow_up"])
        self.assertNotEqual(follow["task"]["id"], first["task"]["id"])
        self.assertEqual(follow["lead"]["version"], saved["version"] + 4)
        self.assertEqual(follow["lead"]["requestedWorkDate"], saved["requestedWorkDate"])
        self.assertEqual(follow["lead"]["callbackWindow"], saved["callbackWindow"])
        self.queue_touch("open", [follow["task"]["id"]], "check-open-follow-up")
        expect(self.page.locator("#callback-queue-list")).to_contain_text("Follow-up")
        self.queue_touch("completed", [completed["task"]["id"]], "check-completed-callback")
        expect(self.page.locator("#callback-queue-list")).to_contain_text("No answer")
        self.open_queue_task_touch(completed["task"], "reopen-completed-request", 2)

        type(self).stop_server()
        type(self).start_server()
        self.page.reload()
        self.wait_tasks(2)
        records = self.api("GET", "/api/callback-tasks?state=all&leadId=" + saved["id"])["tasks"]
        by_id = {task["id"]: task for task in records}
        for expected_task in [completed["task"], follow["task"]]:
            for field in ["status", "kind", "dueAt", "timeZone", "notes", "outcome", "version", "completedAt"]:
                self.assertEqual(by_id[expected_task["id"]][field], expected_task[field])
        self.assert_product_navigation()
        self.assert_no_overflow()

    def behavior_blocked_contact(self):
        self.login_touch()
        saved = self.create_request(customerName="Synthetic Mobile Opt Out")
        self.open_saved_request(saved)
        self.fill_task_time(self.times["upcoming"])
        self.page.get_by_label("Task notes", exact=True).fill("Existing callback before opt-out")
        scheduled = self.save_task_touch("schedule-before-opt-out", 201, 1)
        self.page.get_by_label("Contact permission", exact=True).select_option("opted_out")
        expect(self.page.get_by_label("Request status", exact=True)).to_have_value("needs_review")
        opted_out = self.save_request_touch(saved, "save-contact-opt-out")
        self.assertIs(opted_out["optedOut"], True)
        self.wait_tasks(1)
        card = self.page.locator('#lead-task-list [data-task-id="' + scheduled["task"]["id"] + '"]')
        expect(card).to_contain_text("Blocked")
        expect(self.page.locator("#task-restriction")).to_contain_text("Contact is opted out")
        expect(self.page.locator("#save-callback-task")).to_be_disabled()
        expect(card.get_by_role("button", name="Record outcome", exact=True)).to_be_disabled()
        expect(card.get_by_role("button", name="Reschedule", exact=True)).to_be_disabled()
        expect(card.get_by_role("button", name="Cancel task", exact=True)).to_be_enabled()

        # Editing the permission field cannot clear a stored suppression.
        self.page.get_by_label("Contact permission", exact=True).select_option("requested_callback")
        still_blocked = self.save_request_touch(saved, "save-permission-correction")
        self.assertIs(still_blocked["optedOut"], True)
        self.assertIs(still_blocked["contactAllowed"], False)
        expect(self.page.get_by_label("Contact permission", exact=True)).to_have_value("opted_out")
        self.wait_tasks(1)
        tasks = self.api("GET", "/api/callback-tasks?state=open&leadId=" + saved["id"])["tasks"]
        self.assertEqual(len(tasks), 1)
        self.assertEqual(tasks[0]["blockReason"], "contact_blocked")
        self.assertEqual(tasks[0]["version"], scheduled["task"]["version"])
        self.assertIs(tasks[0]["contactAllowed"], False)
        expect(card.get_by_role("button", name="Record outcome", exact=True)).to_be_disabled()
        expect(card.get_by_role("button", name="Reschedule", exact=True)).to_be_disabled()

        self.tap_trusted(card.get_by_role("button", name="Cancel task", exact=True), "cancel-blocked-task")
        expect(self.page.get_by_label("Task notes", exact=True)).to_have_value(scheduled["task"]["notes"])
        self.page.get_by_label("Task notes", exact=True).fill("Cancelled after saved opt-out")
        cancelled = self.save_task_touch("save-blocked-task-cancellation", 200, 1)
        self.assertEqual(cancelled["task"]["status"], "cancelled")
        self.assertIsNotNone(cancelled["task"]["cancelledAt"])
        self.assertEqual(cancelled["task"]["dueAt"], scheduled["task"]["dueAt"])
        self.assertIs(cancelled["lead"]["optedOut"], True)
        expect(self.page.locator("#save-callback-task")).to_be_disabled()
        self.queue_touch("open", [], "check-blocked-task-left-open-queue")
        self.queue_touch("cancelled", [cancelled["task"]["id"]], "open-cancelled-task-queue")
        expect(self.page.locator("#callback-queue-list")).to_contain_text("Cancelled after saved opt-out")
        self.open_queue_task_touch(cancelled["task"], "reopen-cancelled-request", 1)
        self.page.reload()
        self.wait_tasks(1)
        expect(self.page.locator("#task-restriction")).to_contain_text("Contact is opted out")
        expect(self.page.locator("#save-callback-task")).to_be_disabled()
        self.assertEqual(self.api("GET", "/api/callback-tasks?state=open")["tasks"], [])
        self.assert_product_navigation()
        self.assert_no_overflow()

    def behavior_unsaved_edits(self):
        self.login_touch()
        saved = self.create_request(customerName="Synthetic Mobile Draft")
        self.open_saved_request(saved)
        self.fill_task_time(self.times["upcoming"])
        self.page.get_by_label("Task notes", exact=True).fill("Keep the callback draft Ω")
        expect(self.page.locator("#task-dirty")).to_be_visible()
        expect(self.page.get_by_label("Internal notes", exact=True)).to_be_disabled()
        expect(self.page.get_by_role("button", name="Save changes", exact=True)).to_be_disabled()
        self.tap_trusted(self.page.locator("#nav-schedule"), "leave-unsaved-task")
        expect(self.page.locator("#navigation-guard")).to_be_visible()
        expect(self.page.locator("#schedule-view")).to_be_hidden()
        self.assert_no_overflow()
        self.tap_trusted(self.page.locator("#keep-editing"), "keep-task-draft")
        expect(self.page.locator("#navigation-guard")).to_be_hidden()
        expect(self.page.get_by_label("Task notes", exact=True)).to_have_value("Keep the callback draft Ω")
        expect(self.page.get_by_label("Callback date and time", exact=True)).to_have_value(self.times["upcoming"][:16])
        self.assertEqual(self.api("GET", "/api/callback-tasks?state=all")["tasks"], [])
        self.assertEqual(self.api("GET", "/api/leads/" + saved["id"])["lead"]["version"], saved["version"])

        self.tap_trusted(self.page.locator("#nav-schedule"), "leave-task-draft-again")
        expect(self.page.locator("#navigation-guard")).to_be_visible()
        self.tap_trusted(self.page.locator("#discard-changes"), "discard-task-draft")
        expect(self.page.locator("#schedule-view")).to_be_visible()
        expect(self.page.locator("#callback-queue-list")).to_contain_text("No tasks match")
        self.tap_trusted(self.page.locator("#nav-inbox"), "return-to-request")
        self.wait_tasks(0)
        expect(self.page.get_by_label("Task notes", exact=True)).to_have_value("")
        expect(self.page.get_by_label("Callback date and time", exact=True)).to_have_value("")

        self.page.get_by_label("Internal notes", exact=True).fill("Keep the request correction Ω")
        expect(self.page.locator("#lead-dirty")).to_be_visible()
        expect(self.page.get_by_label("Task notes", exact=True)).to_be_disabled()
        expect(self.page.locator("#save-callback-task")).to_be_disabled()
        self.tap_trusted(self.page.locator("#nav-profile"), "leave-unsaved-request")
        expect(self.page.locator("#navigation-guard")).to_be_visible()
        expect(self.page.locator("#profile-view")).to_be_hidden()
        self.assert_no_overflow()
        self.tap_trusted(self.page.locator("#keep-editing"), "keep-request-draft")
        expect(self.page.get_by_label("Internal notes", exact=True)).to_have_value("Keep the request correction Ω")
        self.assertEqual(self.api("GET", "/api/leads/" + saved["id"])["lead"]["notes"], saved["notes"])
        updated = self.save_request_touch(saved, "save-request-correction")
        self.assertEqual(updated["version"], saved["version"] + 1)
        self.assertEqual(updated["notes"], "Keep the request correction Ω")
        expect(self.page.locator("#save-callback-task")).to_be_enabled()
        self.page.reload()
        self.wait_tasks(0)
        expect(self.page.get_by_label("Internal notes", exact=True)).to_have_value(updated["notes"])
        self.assertEqual(self.api("GET", "/api/callback-tasks?state=all")["tasks"], [])
        self.assert_product_navigation()
        self.assert_no_overflow()


BEHAVIORS = ["scheduling_lifecycle", "blocked_contact", "unsaved_edits"]


def device_case(profile_id, device_name, behavior):
    def test(self):
        getattr(self, "behavior_" + behavior)()
    test.device_profile_id = profile_id
    test.device_name = device_name
    test.product_scope = "callback"
    return test


for profile_id, device_name in PROFILES[ENGINE]:
    for behavior in BEHAVIORS:
        setattr(CallbackMobileBrowserTests, f"test_{profile_id}_{behavior}",
                device_case(profile_id, device_name, behavior))


def load_tests(_loader, _tests, _pattern):
    # Do not collect inherited desktop methods or the combined mobile suite.
    names = sorted(name for name in CallbackMobileBrowserTests.__dict__ if name.startswith("test_"))
    return unittest.TestSuite(CallbackMobileBrowserTests(name) for name in names)


if __name__ == "__main__":
    unittest.main(verbosity=2)
