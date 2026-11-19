"""Browser checks for bundled intake and the optional AI adapter.

Only temporary local files are served. The AI fixture changes the server-owned
body feature flag, leaving the built script and CSP intact. Every API response
is a same-origin Playwright fixture. No request reaches an AI provider.
"""

from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Thread
import json
import os
import re
import shutil
import unittest

from playwright.sync_api import Error, expect, sync_playwright


ACCESS_CODE = "test-only-access-code-0123456789abcdef0123456789"
BUNDLED_MESSAGE = (
    "I need an EV charger installed in my garage. My ZIP is 48315. "
    "Call me Friday after 4 pm."
)


class QuietHandler(SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/favicon.ico":
            self.send_response(204)
            self.end_headers()
            return
        super().do_GET()

    def log_message(self, *_args):
        pass


class IntakeBrowserTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.directory = TemporaryDirectory(prefix="panelreply-intake-browser-")
        root = Path(__file__).resolve().parent.parent
        target = Path(cls.directory.name)
        html = (root / "index.html").read_text(encoding="utf-8")
        if 'data-ai-enabled="false"' not in html:
            raise AssertionError("The published static demo must keep AI disabled")
        (target / "index.html").write_text(html, encoding="utf-8")
        shutil.copy2(root / "robots.txt", target / "robots.txt")
        (target / "ai").mkdir()
        (target / "ai" / "index.html").write_text(
            html.replace('data-ai-enabled="false"', 'data-ai-enabled="true"', 1),
            encoding="utf-8",
        )
        cls.server = ThreadingHTTPServer(
            ("127.0.0.1", 0), partial(QuietHandler, directory=cls.directory.name)
        )
        cls.thread = Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.origin = f"http://127.0.0.1:{cls.server.server_port}"
        cls.playwright = sync_playwright().start()
        executable = os.environ.get("PANELREPLY_CHROMIUM_EXECUTABLE")
        cls.browser = cls.playwright.chromium.launch(
            headless=True, **({"executable_path": executable} if executable else {})
        )
        print(f"INTAKE_CHROMIUM_VERSION={cls.browser.version}", flush=True)

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=5)
        cls.directory.cleanup()

    def setUp(self):
        self.context = self.browser.new_context(viewport={"width": 1280, "height": 900})
        self.external_requests = []
        self.errors = []
        self.api_requests = []
        self.api_handler = None
        self.expected_api_http_error = False
        self.held_routes = []
        self.context.route("**/*", self.route)
        self.page = self.context.new_page()
        self.page.set_default_timeout(5000)
        self.page.on("pageerror", lambda error: self.errors.append(str(error)))
        self.page.on("console", self.console)
        response = self.page.goto(self.origin + "/")
        self.assertEqual(response.status, 200)

    def tearDown(self):
        self.context.close()
        self.assertEqual(self.external_requests, [], "An external request was attempted")
        self.assertEqual(self.errors, [], "Browser script or console errors")

    def console(self, message):
        if message.type != "error":
            return
        if (
            self.expected_api_http_error
            and message.location.get("url") == self.origin + "/api/intake"
            and "the server responded with a status of 503" in message.text
        ):
            return
        self.errors.append(message.text)

    def route(self, route):
        request = route.request
        if not request.url.startswith(self.origin + "/"):
            self.external_requests.append(request.url)
            route.abort()
            return
        if request.url == self.origin + "/api/intake":
            self.api_requests.append({
                "method": request.method,
                "headers": request.headers,
                "body": request.post_data_json,
            })
            if self.api_handler:
                self.api_handler(route)
            else:
                self.errors.append("Unexpected AI request")
                route.fulfill(status=200, content_type="application/json", body="{}")
            return
        route.continue_()

    def send(self, text):
        self.page.locator("#reply").fill(text)
        self.page.locator("#send").click()

    def enable_ai(self, with_access=True):
        response = self.page.goto(self.origin + "/ai/")
        self.assertEqual(response.status, 200)
        expect(self.page.locator("#ai-controls")).to_be_visible()
        if with_access:
            self.page.locator("#ai-access").fill(ACCESS_CODE)

    @staticmethod
    def answer(job=None, zip_code=None, timing=None, **flags):
        return {
            "mode": "ai",
            "fields": {"job": job, "zip": zip_code, "timing": timing},
            "flags": {
                "optOut": False,
                "hazard": False,
                "ambiguous": False,
                **flags,
            },
        }

    def fulfill(self, route, body, status=200):
        route.fulfill(status=status, content_type="application/json", body=json.dumps(body))

    def release_pending(self, answer):
        self.assertEqual(len(self.held_routes), 1)
        try:
            self.fulfill(self.held_routes.pop(), answer)
        except Error as error:
            # A real AbortController cancellation can discard the route before
            # the fixture releases its late response. Other failures still fail.
            if not re.search(r"already handled|closed|cancel|invalid interception", str(error), re.I):
                raise
        self.page.evaluate("""() => new Promise(resolve =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)))""")

    def assert_ready(self):
        expect(self.page.locator("#title")).to_have_text("Ready for callback.")
        expect(self.page.locator("#summary")).to_contain_text("No appointment has been booked.")

    def assistant_replies(self):
        return self.page.locator("#events .event:not(.customer):not(.system)")

    def assert_saved_answer(self):
        expect(self.page.locator("#ai-mode")).to_contain_text(re.compile(r"saved answer", re.I))

    def test_static_demo_collects_bundled_details_without_any_api_request(self):
        expect(self.page.locator("#ai-controls")).to_be_hidden()
        self.send(BUNDLED_MESSAGE)
        self.assert_ready()
        expect(self.page.locator("#summary")).to_contain_text("EV charger")
        expect(self.page.locator("#summary")).to_contain_text("ZIP: 48315")
        expect(self.page.locator("#summary")).to_contain_text("Friday after 4 pm")
        expect(self.page.locator("#events .customer")).to_have_count(1)
        self.assertEqual(self.api_requests, [])
        expect(self.page.locator("#ai-mode")).to_contain_text(re.compile(r"demo|local", re.I))

    def test_static_details_can_arrive_out_of_order(self):
        self.send("48315")
        self.send("Friday after 4 pm")
        self.send("Install an EV charger in my garage")
        self.assert_ready()
        expect(self.page.locator("#summary")).to_contain_text("ZIP: 48315")
        expect(self.page.locator("#summary")).to_contain_text("Friday after 4 pm")
        self.assertEqual(self.api_requests, [])

    def test_hours_question_answers_without_creating_job_or_callback_time(self):
        self.send("Are you open Friday?")
        expect(self.page.locator("#field-count")).to_have_text("0 of 3")
        for field in ("job", "zip", "timing"):
            expect(self.page.locator("#detail-" + field)).to_have_text("Not collected")
        reply = self.assistant_replies().last
        expect(reply).to_contain_text(re.compile(r"hours|opening", re.I))
        expect(reply).to_contain_text(re.compile(r"don.t have|do not have|not.*(?:verified|confirmed|available)|confirm|unknown", re.I))
        self.assert_saved_answer()
        self.assertEqual(self.api_requests, [])

    def test_questions_preserve_completed_request_and_do_not_repeat_ready_event(self):
        self.send(BUNDLED_MESSAGE)
        self.assert_ready()
        summary = self.page.locator("#summary").inner_text()
        ready_events = self.page.locator("#events .system").filter(
            has_text="Sample request ready for contractor review"
        )
        ready_count = ready_events.count()
        for question in ("Are you open Friday?", "Do you service 48084?"):
            with self.subTest(question=question):
                previous_replies = self.assistant_replies().count()
                self.send(question)
                expect(self.page.locator("#summary")).to_have_text(summary)
                expect(self.page.locator("#field-count")).to_have_text("3 of 3")
                expect(ready_events).to_have_count(ready_count)
                expect(self.assistant_replies()).to_have_count(previous_replies + 1)
                self.assert_saved_answer()
        self.assertEqual(self.api_requests, [])

    def test_mixed_job_and_price_question_records_only_the_stated_work(self):
        self.send("I need an EV charger installed. How much does it cost?")
        expect(self.page.locator("#detail-job")).to_have_text("I need an EV charger installed")
        expect(self.page.locator("#detail-zip")).to_have_text("Not collected")
        expect(self.page.locator("#detail-timing")).to_have_text("Not collected")
        expect(self.page.locator("#field-count")).to_have_text("1 of 3")
        replies = "\n".join(self.assistant_replies().all_inner_texts())
        self.assertRegex(replies, re.compile(r"price|pricing|cost|quote", re.I))
        self.assertRegex(replies, re.compile(r"don.t have|do not have|not.*(?:verified|confirmed|available)|confirm|unknown", re.I))
        self.assertNotRegex(replies, r"\$\s*\d")
        self.assertEqual(self.api_requests, [])

    def test_explicit_job_zip_survives_a_mixed_service_area_question(self):
        self.send("My ZIP is 48315. Do you serve that area?")
        expect(self.page.locator("#detail-zip")).to_have_text("48315")
        expect(self.page.locator("#detail-job")).to_have_text("Not collected")
        expect(self.page.locator("#detail-timing")).to_have_text("Not collected")
        expect(self.page.locator("#field-count")).to_have_text("1 of 3")
        replies = "\n".join(self.assistant_replies().all_inner_texts())
        self.assertRegex(replies, re.compile(r"coverage|service area|serve|area", re.I))
        self.assertRegex(replies, re.compile(r"don.t have|do not have|can.t confirm|cannot confirm|not.*(?:verified|confirmed)|confirm|unknown", re.I))
        self.assertEqual(self.api_requests, [])

    def test_service_area_question_cannot_resolve_an_existing_zip_conflict(self):
        self.send(BUNDLED_MESSAGE)
        self.assert_ready()
        self.send("Actually the job ZIP is 48315 or 48084")
        expect(self.page.locator("#title")).to_have_text("Clarify the request.")
        summary = self.page.locator("#summary").inner_text()
        self.send("Do you service 48084?")
        expect(self.page.locator("#title")).to_have_text("Clarify the request.")
        expect(self.page.locator("#summary")).to_have_text(summary)
        expect(self.page.locator("#detail-zip")).to_contain_text("needs confirmation")
        expect(self.page.locator("#field-count")).to_have_text("2 of 3")
        self.assert_saved_answer()
        self.assertEqual(self.api_requests, [])

    def test_question_can_recall_the_supplied_zip_without_changing_the_request(self):
        self.send(BUNDLED_MESSAGE)
        self.assert_ready()
        summary = self.page.locator("#summary").inner_text()
        self.send("What ZIP did I give you?")
        expect(self.assistant_replies().last).to_contain_text("48315")
        expect(self.assistant_replies().last).to_contain_text(re.compile(r"ZIP", re.I))
        expect(self.page.locator("#summary")).to_have_text(summary)
        self.assert_saved_answer()
        self.assertEqual(self.api_requests, [])

    def test_unknown_question_gets_a_limitation_without_inventing_request_details(self):
        self.send("Who won the chess championship?")
        expect(self.page.locator("#field-count")).to_have_text("0 of 3")
        for field in ("job", "zip", "timing"):
            expect(self.page.locator("#detail-" + field)).to_have_text("Not collected")
        expect(self.assistant_replies().last).to_contain_text(
            re.compile(r"don.t|do not|cannot|can.t|not.*(?:know|answer|available)|outside|only", re.I)
        )
        self.assert_saved_answer()
        self.assertEqual(self.api_requests, [])

    def test_multiple_questions_answer_each_topic_without_collecting_timing(self):
        self.send("What are your hours? How much does an estimate cost?")
        replies = "\n".join(self.assistant_replies().all_inner_texts())
        self.assertRegex(replies, re.compile(r"hours|opening", re.I))
        self.assertRegex(replies, re.compile(r"price|pricing|cost|quote|estimate", re.I))
        self.assertNotRegex(replies, r"\$\s*\d")
        expect(self.page.locator("#field-count")).to_have_text("0 of 3")
        self.assert_saved_answer()
        self.assertEqual(self.api_requests, [])

    def test_stop_in_a_question_message_prevents_a_saved_answer(self):
        self.enable_ai()
        self.send("STOP. What are your hours?")
        expect(self.page.locator("#title")).to_have_text("Automated replies paused.")
        expect(self.assistant_replies()).to_have_count(0)
        expect(self.page.locator("#field-count")).to_have_text("0 of 3")
        expect(self.page.locator("#ai-mode")).not_to_contain_text(re.compile(r"saved answer", re.I))
        self.assertEqual(self.api_requests, [])

    def test_hazard_in_a_question_message_takes_precedence_over_saved_answers(self):
        self.enable_ai()
        self.send("My outlet is sparking. Are you open Friday?")
        expect(self.page.locator("#title")).to_have_text("Urgent review required.")
        expect(self.assistant_replies()).to_have_count(1)
        expect(self.assistant_replies().last).to_contain_text("911")
        expect(self.page.locator("#detail-timing")).to_have_text("Not collected")
        expect(self.page.locator("#ai-mode")).not_to_contain_text(re.compile(r"saved answer", re.I))
        self.assertEqual(self.api_requests, [])

    def test_saved_questions_use_no_provider_even_with_ai_access_configured(self):
        self.enable_ai()
        self.send("are you open friday")
        self.assert_saved_answer()
        expect(self.assistant_replies().last).to_contain_text(re.compile(r"hours|opening", re.I))
        self.send("Does this book an appointment?")
        self.assert_saved_answer()
        expect(self.assistant_replies().last).to_contain_text(re.compile(r"does not|doesn't|cannot|can't|no appointment", re.I))
        expect(self.page.locator("#field-count")).to_have_text("0 of 3")
        expect(self.page.locator("#ai-access")).to_have_value(ACCESS_CODE)
        expect(self.page.locator("#send")).to_be_enabled()
        self.assertEqual(self.api_requests, [])

    def test_polite_callback_request_remains_a_preference_not_a_business_question(self):
        self.send("Install lights. My ZIP is 48315.")
        expect(self.page.locator("#field-count")).to_have_text("2 of 3")
        self.send("Can you call me Friday after 4 pm?")
        self.assert_ready()
        expect(self.page.locator("#detail-timing")).to_contain_text("Friday after 4 pm")
        expect(self.page.locator("#summary")).to_contain_text("No appointment has been booked.")
        self.assertEqual(self.api_requests, [])

    def test_a_street_address_is_not_a_callback_time(self):
        self.send("Replace the panel at 12 Main Street. ZIP 48315.")
        expect(self.page.locator("#title")).to_have_text("Collect timing.")
        expect(self.page.locator("#summary")).to_contain_text("Timing: Not collected")
        expect(self.page.locator("#summary")).to_contain_text("12 Main Street")
        self.send("Call me Friday after 4 pm")
        self.assert_ready()

    def test_extended_zip_spellings_require_five_digit_confirmation(self):
        for value in ("48315–1234", "48315 1234", "48315—1234"):
            with self.subTest(value=value):
                self.page.locator("#reset").click()
                self.send("Install lights. ZIP " + value + ". Call Monday after 4 pm.")
                expect(self.page.locator("#title")).to_have_text("Clarify the request.")
                expect(self.page.locator("#summary")).to_contain_text("ZIP: Not collected")
                self.send("The five-digit job ZIP is 48315")
                self.assert_ready()

    def test_negated_day_stays_with_timing_and_does_not_invent_a_job(self):
        self.send("Not Friday, Monday after 4")
        expect(self.page.locator("#summary")).to_contain_text("Job: Not collected")
        expect(self.page.locator("#summary")).to_contain_text("Not Friday")
        expect(self.page.locator("#summary")).to_contain_text("Monday after 4")
        self.send("Install lights. ZIP 48315")
        self.assert_ready()
        expect(self.page.locator("#summary")).to_contain_text("Not Friday")

    def test_explicit_no_more_texts_phrase_stops_bundled_intake(self):
        self.send("Please don’t send me any more texts. ZIP 48315.")
        expect(self.page.locator("#title")).to_have_text("Automated replies paused.")
        expect(self.page.locator("#events .event:not(.customer):not(.system)")).to_have_count(0)
        self.send("Install lights")
        expect(self.page.locator("#events .event").last).to_contain_text("without an automated reply")
        expect(self.page.locator("#title")).to_have_text("Automated replies paused.")

    def test_callback_only_phrase_keeps_the_job_missing(self):
        self.send("Please, stop by Thursday.")
        expect(self.page.locator("#title")).to_have_text("Save the call.")
        expect(self.page.locator("#summary")).to_contain_text("Job: Not collected")
        expect(self.page.locator("#summary")).to_contain_text("Thursday")
        expect(self.page.locator("#events .event").last).to_contain_text("What electrical work")
        self.assertEqual(self.api_requests, [])

    def test_static_zip_correction_preserves_other_collected_details(self):
        self.send(BUNDLED_MESSAGE)
        self.assert_ready()
        self.send("Actually the job ZIP is 48084")
        self.assert_ready()
        expect(self.page.locator("#summary")).to_contain_text("ZIP: 48084")
        expect(self.page.locator("#summary")).not_to_contain_text("ZIP: 48315")
        expect(self.page.locator("#summary")).to_contain_text("EV charger")
        expect(self.page.locator("#summary")).to_contain_text("Friday after 4 pm")

    def test_conflicting_zip_codes_require_clarification(self):
        self.send("Install lights. ZIP 48315 or 48084. Friday after 4 pm.")
        expect(self.page.locator("#title")).not_to_have_text("Ready for callback.")
        expect(self.page.locator("#summary")).not_to_contain_text(re.compile(r"ZIP: (48315|48084)"))
        expect(self.page.locator("#events .event").last).to_contain_text(re.compile(r"ZIP|confirm|which", re.I))
        self.send("My job ZIP is 48315")
        self.assert_ready()

    def test_timing_update_cannot_clear_an_unresolved_zip_correction(self):
        self.send(BUNDLED_MESSAGE)
        self.assert_ready()
        self.send("Actually the job ZIP is 48315 or 48084")
        expect(self.page.locator("#title")).not_to_have_text("Ready for callback.")
        self.send("Call me Monday morning")
        expect(self.page.locator("#title")).not_to_have_text("Ready for callback.")
        self.send("The correct job ZIP is 48084")
        self.assert_ready()
        expect(self.page.locator("#summary")).to_contain_text("ZIP: 48084")
        expect(self.page.locator("#summary")).to_contain_text("Monday morning")

    def test_opt_out_sentence_in_bundled_details_pauses_replies(self):
        self.send("No more texts. My ZIP is 48315.")
        expect(self.page.locator("#title")).to_have_text("Automated replies paused.")
        expect(self.page.locator("#events .event:not(.customer):not(.system)")).to_have_count(0)
        self.send("Install lights")
        expect(self.page.locator("#events .event").last).to_contain_text("without an automated reply")
        self.assertEqual(self.api_requests, [])

    def test_stop_and_hazard_in_one_message_preserve_both_protections(self):
        self.enable_ai()
        self.send("STOP. My breaker is melting.")
        expect(self.page.locator("#title")).to_have_text("Urgent review required.")
        expect(self.page.locator("#events .event:not(.customer):not(.system)")).to_have_count(0)
        expect(self.page.locator("#events")).to_contain_text("because of STOP")
        self.page.locator("#restart").click()
        expect(self.page.locator("#events .event").last).to_contain_text("does not release the safety hold")
        self.assertEqual(self.api_requests, [])

    def test_callback_status_is_a_sample_label_and_does_not_book(self):
        self.send(BUNDLED_MESSAGE)
        self.assert_ready()
        self.page.locator("#callback").select_option(label="Booked by contractor")
        expect(self.page.locator("#outcome")).to_contain_text(re.compile(r"sample|demonstration", re.I))
        expect(self.page.locator("#summary")).to_contain_text("No appointment has been booked.")
        self.assertEqual(self.api_requests, [])

    def test_ai_configuration_without_access_code_keeps_parsing_local(self):
        self.enable_ai(with_access=False)
        self.send(BUNDLED_MESSAGE)
        self.assert_ready()
        self.assertEqual(self.api_requests, [])
        expect(self.page.locator("#ai-mode")).to_contain_text(re.compile(r"demo|local|access code", re.I))

    def test_ai_request_has_expected_payload_and_preserves_missing_fields(self):
        self.enable_ai()
        answers = iter([
            self.answer(job="Install lights"),
            self.answer(zip_code="48315", timing="Friday after 4 pm"),
        ])
        self.api_handler = lambda route: self.fulfill(route, next(answers))
        self.send("Install lights")
        expect(self.page.locator("#summary")).to_contain_text("Install lights")
        expect(self.page.locator("#send")).to_be_enabled()
        self.send("48315, Friday after 4 pm")
        self.assert_ready()
        expect(self.page.locator("#summary")).to_contain_text("Install lights")
        expect(self.page.locator("#summary")).to_contain_text("ZIP: 48315")
        expect(self.page.locator("#ai-mode")).to_contain_text(re.compile(r"AI"))
        self.assertEqual(len(self.api_requests), 2)
        first, second = self.api_requests
        self.assertEqual(first["method"], "POST")
        self.assertEqual(first["headers"]["authorization"], "Bearer " + ACCESS_CODE)
        self.assertEqual(first["body"], {
            "message": "Install lights", "fields": {"job": "", "zip": "", "timing": ""}
        })
        self.assertEqual(second["body"]["fields"], {"job": "Install lights", "zip": "", "timing": ""})
        self.assertNotIn(ACCESS_CODE, self.page.locator("body").inner_text())

    def test_sample_request_uses_entered_ai_code_and_reset_clears_it(self):
        self.enable_ai()
        self.api_handler = lambda route: self.fulfill(
            route, self.answer(
                job="EV charger installed in the garage", zip_code="48315",
                timing="Next week. Call after 4 pm",
            )
        )
        self.page.get_by_role("button", name="Run the sample request", exact=True).click()
        self.assert_ready()
        expect(self.page.locator("#ai-mode")).to_contain_text("AI extracted these details")
        self.assertEqual(len(self.api_requests), 1)
        request = self.api_requests[0]
        self.assertEqual(request["headers"]["authorization"], "Bearer " + ACCESS_CODE)
        self.assertEqual(request["body"]["fields"], {"job": "", "zip": "", "timing": ""})
        expect(self.page.locator("#ai-access")).to_have_value(ACCESS_CODE)
        self.page.get_by_role("button", name="Reset tour", exact=True).click()
        expect(self.page.locator("#ai-access")).to_have_value("")
        expect(self.page.locator("#events .event")).to_have_count(0)
        self.page.get_by_role("button", name="Run the sample request", exact=True).click()
        self.assert_ready()
        self.assertEqual(len(self.api_requests), 1, "No code must keep the sample local")

    def test_provider_failure_uses_labelled_local_fallback(self):
        self.enable_ai()
        self.expected_api_http_error = True
        self.api_handler = lambda route: self.fulfill(
            route, {"error": {"code": "provider_unavailable", "message": "AI unavailable"}}, 503
        )
        self.send(BUNDLED_MESSAGE)
        self.assert_ready()
        expect(self.page.locator("#ai-mode")).to_contain_text(re.compile(r"fallback|local|demo", re.I))
        expect(self.page.locator("#ai-mode")).to_contain_text(re.compile(r"unavailable|failed|could not", re.I))
        self.assertEqual(len(self.api_requests), 1, "A failed provider must not trigger automatic retries")

    def test_ai_ambiguous_job_and_zip_require_both_fields_to_be_confirmed(self):
        self.enable_ai()
        answers = iter([
            self.answer(
                job="EV charger installed in my garage", zip_code="48315", timing="Friday after 4 pm"
            ),
            self.answer(timing="Friday", ambiguous=True),
            self.answer(job="Install lights"),
            self.answer(zip_code="48084"),
        ])
        self.api_handler = lambda route: self.fulfill(route, next(answers))
        self.send(BUNDLED_MESSAGE)
        self.assert_ready()
        self.send("Actually, install lights or replace outlets at 48315 or 48084. Friday.")
        expect(self.page.locator("#title")).not_to_have_text("Ready for callback.")
        expect(self.page.locator("#send")).to_be_enabled()
        self.send("Install lights")
        expect(self.page.locator("#summary")).to_contain_text("Install lights")
        expect(self.page.locator("#title")).not_to_have_text("Ready for callback.")
        self.send("48084")
        self.assert_ready()
        expect(self.page.locator("#summary")).to_contain_text("ZIP: 48084")
        expect(self.page.locator("#summary")).to_contain_text("Friday")
        self.assertEqual(len(self.api_requests), 4)

    def test_malformed_ai_response_does_not_invent_summary_fields(self):
        self.enable_ai()
        invalid = self.answer(job="Invented replacement work", zip_code="99999", timing="Wednesday at noon")
        invalid["flags"]["optOut"] = "false"
        self.api_handler = lambda route: self.fulfill(route, invalid)
        self.send(BUNDLED_MESSAGE)
        self.assert_ready()
        expect(self.page.locator("#summary")).to_contain_text("EV charger")
        expect(self.page.locator("#summary")).to_contain_text("ZIP: 48315")
        expect(self.page.locator("#summary")).not_to_contain_text("Invented replacement work")
        expect(self.page.locator("#summary")).not_to_contain_text("99999")
        expect(self.page.locator("#ai-mode")).to_contain_text(re.compile(r"fallback|local|demo", re.I))

    def test_ai_cannot_fill_job_and_timing_using_only_the_zip(self):
        self.enable_ai()
        self.api_handler = lambda route: self.fulfill(
            route, self.answer(job="48315", zip_code="48315", timing="48315")
        )
        self.send("48315")
        expect(self.page.locator("#summary")).to_contain_text("ZIP: 48315")
        expect(self.page.locator("#summary")).to_contain_text("Job: Not collected")
        expect(self.page.locator("#summary")).to_contain_text("Timing: Not collected")
        expect(self.page.locator("#title")).not_to_have_text("Ready for callback.")
        expect(self.page.locator("#ai-mode")).to_contain_text(re.compile(r"fallback|local|demo", re.I))

    def test_provider_opt_out_stops_follow_up_requests(self):
        self.enable_ai()
        self.api_handler = lambda route: self.fulfill(route, self.answer(optOut=True))
        self.send("Please leave my number out of future automated campaigns.")
        expect(self.page.locator("#title")).to_have_text("Automated replies paused.")
        self.send("Install lights")
        expect(self.page.locator("#events .event").last).to_contain_text("without an automated reply")
        self.assertEqual(len(self.api_requests), 1)

    def test_provider_hazard_flag_keeps_human_review_hold(self):
        self.enable_ai()
        self.api_handler = lambda route: self.fulfill(route, self.answer(hazard=True))
        self.send("The equipment may be unsafe.")
        expect(self.page.locator("#title")).to_have_text("Urgent review required.")
        self.page.locator("#restart").click()
        expect(self.page.locator("#title")).to_have_text("Urgent review required.")
        expect(self.page.locator("#events .event").last).to_contain_text("does not release the safety hold")
        self.assertEqual(len(self.api_requests), 1)

    def test_known_safety_and_opt_out_inputs_do_not_wait_for_ai(self):
        self.enable_ai()
        self.send("My breaker is melting")
        expect(self.page.locator("#title")).to_have_text("Urgent review required.")
        self.assertEqual(self.api_requests, [])
        self.page.locator("#reset").click()
        self.page.locator("#ai-access").fill(ACCESS_CODE)
        self.send("Don’t text me again")
        expect(self.page.locator("#title")).to_have_text("Automated replies paused.")
        self.assertEqual(self.api_requests, [])

    def test_reset_during_pending_ai_prevents_late_repopulation(self):
        self.enable_ai()
        self.api_handler = self.held_routes.append
        with self.page.expect_request(self.origin + "/api/intake"):
            self.send(BUNDLED_MESSAGE)
        expect(self.page.locator("#send")).to_be_disabled()
        expect(self.page.locator("#reset")).to_be_enabled()
        self.page.locator("#reset").click()
        self.release_pending(self.answer(
            job="EV charger installed in my garage", zip_code="48315", timing="Friday after 4 pm"
        ))
        expect(self.page.locator("#title")).to_have_text("Save the call.")
        expect(self.page.locator("#events .event")).to_have_count(0)
        expect(self.page.locator("#summary")).not_to_contain_text("EV charger")
        expect(self.page.locator("#send")).to_be_enabled()

    def test_stop_during_pending_ai_prevents_late_advancement(self):
        self.enable_ai()
        self.api_handler = self.held_routes.append
        with self.page.expect_request(self.origin + "/api/intake"):
            self.send(BUNDLED_MESSAGE)
        expect(self.page.locator("#send")).to_be_disabled()
        expect(self.page.locator("#stop")).to_be_enabled()
        self.page.locator("#stop").click()
        self.release_pending(self.answer(
            job="EV charger installed in my garage", zip_code="48315", timing="Friday after 4 pm"
        ))
        expect(self.page.locator("#title")).to_have_text("Automated replies paused.")
        expect(self.page.locator("#summary")).not_to_contain_text("ZIP: 48315")
        expect(self.page.locator("#events")).not_to_contain_text(re.compile(r"request is ready", re.I))
        expect(self.page.locator("#send")).to_be_enabled()

    def test_ai_access_code_and_intake_are_not_kept_after_reload(self):
        self.enable_ai()
        self.api_handler = lambda route: self.fulfill(route, self.answer(job="Install lights"))
        self.send("Install lights")
        expect(self.page.locator("#summary")).to_contain_text("Install lights")
        self.page.reload()
        expect(self.page.locator("#ai-access")).to_have_value("")
        expect(self.page.locator("#events .event")).to_have_count(0)
        stored = self.page.evaluate("""() => ({
            local: localStorage.length, session: sessionStorage.length, cookies: document.cookie
        })""")
        self.assertEqual(stored, {"local": 0, "session": 0, "cookies": ""})


    def test_polite_unsubscribe_and_opt_out_stop_demo_intake(self):
        for message in (
            "Please unsubscribe me", "Please, unsubscribe me.",
            "Unsubscribe me please", "Please opt out", "Opt out please",
            "Please opt out, ZIP 48315.",
        ):
            with self.subTest(message=message):
                self.page.locator("#reset").click()
                self.send(message)
                expect(self.page.locator("#title")).to_have_text("Automated replies paused.")
                expect(self.page.locator("#summary")).not_to_contain_text("ZIP: 48315")
                self.assertEqual(self.api_requests, [])

if __name__ == "__main__":
    unittest.main(verbosity=2)
