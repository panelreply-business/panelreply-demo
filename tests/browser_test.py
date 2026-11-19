"""Exercise the published demo files in real Chromium with synthetic input only.

Serve a temporary copy of index.html/robots.txt over localhost HTTP. Browser
requests outside that local origin are blocked and fail the test. No app code,
CSP, handlers or state are replaced by the test harness.
"""

from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Thread
import json
import os
import shutil
import unittest

from playwright.sync_api import sync_playwright, expect


class QuietHandler(SimpleHTTPRequestHandler):
    def do_GET(self):
        # Some Chromium builds probe for a favicon even when the app has none.
        if self.path == "/favicon.ico":
            self.send_response(204)
            self.end_headers()
            return
        super().do_GET()

    def log_message(self, *_args):
        pass


class DemoBrowserTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.directory = TemporaryDirectory(prefix="panelreply-browser-")
        root = Path(__file__).resolve().parent.parent
        for filename in ("index.html", "robots.txt"):
            shutil.copy2(root / filename, Path(cls.directory.name) / filename)
        handler = partial(QuietHandler, directory=cls.directory.name)
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        cls.thread = Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.origin = f"http://127.0.0.1:{cls.server.server_port}"
        cls.playwright = sync_playwright().start()
        executable = os.environ.get("PANELREPLY_CHROMIUM_EXECUTABLE")
        cls.browser = cls.playwright.chromium.launch(
            headless=True, **({"executable_path": executable} if executable else {})
        )
        print(f"CHROMIUM_VERSION={cls.browser.version}", flush=True)

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
        self.context.route("**/*", self.route)
        self.page = self.context.new_page()
        self.page.set_default_timeout(5000)
        self.page.on("pageerror", lambda error: self.errors.append(str(error)))
        self.page.on("console", lambda message: self.errors.append(message.text)
                     if message.type == "error" else None)
        response = self.page.goto(self.origin + "/")
        self.assertEqual(response.status, 200)
        expect(self.page.locator("#title")).to_have_text("Save the call.")

    def tearDown(self):
        self.context.close()
        self.assertEqual(self.external_requests, [], "Demo attempted an external request")
        self.assertEqual(self.errors, [], "Browser console or script errors")

    def route(self, route):
        if route.request.url.startswith(self.origin + "/"):
            route.continue_()
        else:
            self.external_requests.append(route.request.url)
            route.abort()

    def send(self, text):
        self.page.get_by_role("textbox", name="Customer message", exact=True).fill(text)
        self.page.get_by_role("button", name="Send sample reply", exact=True).click()

    def reset(self):
        self.page.get_by_role("button", name="Reset tour", exact=True).click()
        expect(self.page.locator("#title")).to_have_text("Save the call.")

    def test_sample_walkthrough_and_reset(self):
        self.page.get_by_role("button", name="Run the sample request", exact=True).click()
        expect(self.page.locator("#title")).to_have_text("Ready for callback.")
        expect(self.page.locator("#summary")).to_contain_text("ZIP: 48315")
        expect(self.page.locator("#summary")).to_contain_text("No appointment has been booked.")
        self.page.get_by_label("Contractor callback status", exact=True).select_option(label="Contacted")
        expect(self.page.locator("#outcome")).to_contain_text("demonstration data")
        self.reset()
        expect(self.page.locator("#events .event")).to_have_count(0)
        expect(self.page.locator("#callback")).to_have_value("New request")
        expect(self.page.locator("#reply")).to_have_value("")
        expect(self.page.locator("#call-status")).to_have_text("")

    def test_manual_intake_and_invalid_inputs(self):
        self.send("!!!")
        expect(self.page.locator("#title")).to_have_text("Save the call.")
        self.send("Install lights")
        for invalid in ("1234", "123456", "abcde", "48315-1234"):
            self.send(invalid)
            expect(self.page.locator("#title")).to_have_text("Collect the job ZIP.")
        self.send("48315")
        self.send("...")
        expect(self.page.locator("#title")).to_have_text("Collect timing.")
        self.send("Friday after 4 pm")
        expect(self.page.locator("#title")).to_have_text("Ready for callback.")

    def test_empty_form_is_blocked_by_browser_validation(self):
        self.page.get_by_role("button", name="Send sample reply", exact=True).click()
        expect(self.page.locator("#reply:invalid")).to_have_count(1)
        expect(self.page.locator("#events .event")).to_have_count(0)

    def test_opt_out_phrases_and_restart(self):
        for message in ("STOP", "Don’t text me again", "Please stop texting me, please."):
            with self.subTest(message=message):
                self.reset()
                self.send(message)
                expect(self.page.locator("#title")).to_have_text("Automated replies paused.")
                self.send("Install lights")
                expect(self.page.locator("#events .event").last).to_contain_text("without an automated reply")
                self.page.get_by_role("button", name="START", exact=True).click()
                expect(self.page.locator("#title")).to_have_text("Save the call.")

    def test_safety_holds_at_each_intake_stage(self):
        for stage in range(3):
            for message in ("My breaker\nis melting", "The power line is down in my yard"):
                with self.subTest(stage=stage, message=message):
                    self.reset()
                    if stage >= 1:
                        self.send("Install lights")
                    if stage >= 2:
                        self.send("48315")
                    self.send(message)
                    expect(self.page.locator("#title")).to_have_text("Urgent review required.")
                    expect(self.page.locator("#step")).to_have_text("SAFETY HOLD / HUMAN REVIEW")
                    self.page.get_by_role("button", name="START", exact=True).click()
                    expect(self.page.locator("#title")).to_have_text("Urgent review required.")

    def test_safety_hold_after_stop_sends_no_simulated_reply(self):
        self.page.get_by_role("button", name="STOP", exact=True).click()
        self.send("My breaker\nis melting")
        expect(self.page.locator("#title")).to_have_text("Urgent review required.")
        expect(self.page.locator("#events .event:not(.customer):not(.system)")).to_have_count(0)
        self.page.get_by_role("button", name="START", exact=True).click()
        expect(self.page.locator("#events .event").last).to_contain_text("does not release the safety hold")

    def test_normal_jobs_are_not_held_or_opted_out(self):
        for message in ("Install a smoke detector", "Wire a hot tub", "Please stop by Thursday, please."):
            with self.subTest(message=message):
                self.reset()
                self.send(message)
                expect(self.page.locator("#title")).to_have_text("Collect the job ZIP.")

    def test_markup_is_displayed_as_text(self):
        text = '<img src="https://example.invalid/test" onerror="alert(1)"> Install lights'
        self.send(text)
        expect(self.page.locator("#events .customer")).to_have_text(text)
        expect(self.page.locator("#events img")).to_have_count(0)

    def test_keyboard_access_to_every_control(self):
        controls = ["call", "example", "reply", None, "stop", "restart", "reset", "callback"]
        for identifier in controls:
            self.page.keyboard.press("Tab")
            selector = "button[type=submit]" if identifier is None else "#" + identifier
            expect(self.page.locator(selector)).to_be_focused()
        self.page.get_by_role("button", name="Run the sample request", exact=True).click()
        expect(self.page.locator("#title")).to_have_text("Ready for callback.")
        self.page.get_by_role("button", name="Reset tour", exact=True).focus()
        self.page.keyboard.press("Enter")
        expect(self.page.locator("#title")).to_have_text("Save the call.")

    def test_responsive_layout_and_maximum_length_input(self):
        for width in (320, 390, 768, 1280):
            with self.subTest(width=width):
                self.page.set_viewport_size({"width": width, "height": 900})
                self.reset()
                self.send("a" * 500)
                self.send("48315")
                self.send("b" * 500)
                expect(self.page.locator("#title")).to_have_text("Ready for callback.")
                dimensions = self.page.evaluate("""() => {
                    const summary = document.getElementById('summary');
                    const cards = [...document.querySelectorAll('.card')].map(e => e.getBoundingClientRect().toJSON());
                    return {viewport: innerWidth, pageWidth: document.documentElement.scrollWidth,
                            summaryWidth: summary.clientWidth, summaryScroll: summary.scrollWidth, cards};
                }""")
                self.assertLessEqual(dimensions["pageWidth"], width + 1, json.dumps(dimensions))
                self.assertLessEqual(dimensions["summaryScroll"], dimensions["summaryWidth"] + 1)
                first, second = dimensions["cards"]
                if width <= 650:
                    self.assertGreaterEqual(second["top"], first["bottom"])
                else:
                    self.assertAlmostEqual(first["top"], second["top"], delta=1)

    def test_no_customer_storage_after_reload(self):
        self.send("Install lights")
        self.page.reload()
        expect(self.page.locator("#title")).to_have_text("Save the call.")
        expect(self.page.locator("#events .event")).to_have_count(0)
        stored = self.page.evaluate("() => ({local: localStorage.length, session: sessionStorage.length, cookies: document.cookie})")
        self.assertEqual(stored, {"local": 0, "session": 0, "cookies": ""})


if __name__ == "__main__":
    unittest.main(verbosity=2)
