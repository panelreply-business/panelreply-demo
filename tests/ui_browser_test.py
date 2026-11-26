"""Exercise the redesigned workspace in Chromium using synthetic messages.

The runner serves copied static files locally. No provider or external website
requests are allowed. Clipboard fixtures model permission success/failure only.
Optional screenshots are written to PANELREPLY_CAPTURE_DIR for a reviewer.
"""

from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Thread
import base64
import json
import os
import re
import shutil
import unittest

from playwright.sync_api import expect, sync_playwright
from browser_engine import launch_browser, preview_available


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


class WorkspaceBrowserTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.directory = TemporaryDirectory(prefix="panelreply-workspace-browser-")
        root = Path(__file__).resolve().parent.parent
        target = Path(cls.directory.name)
        html = (root / "index.html").read_text(encoding="utf-8")
        if 'data-ai-enabled="false"' not in html:
            raise AssertionError("The static workspace must not activate AI")
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
        cls.browser = launch_browser(cls.playwright)

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=5)
        cls.directory.cleanup()

    def setUp(self):
        self.context = self.browser.new_context(viewport={"width": 1440, "height": 1000})
        self.external_requests = []
        self.errors = []
        self.api_requests = []
        self.context.route("**/*", self.route)
        self.page = self.context.new_page()
        self.page.set_default_timeout(5000)
        self.page.on("pageerror", lambda error: self.errors.append(str(error)))
        self.page.on("console", lambda message: self.errors.append(message.text)
                     if message.type == "error" else None)
        response = self.page.goto(self.origin + "/")
        self.assertEqual(response.status, 200)

    def tearDown(self):
        self.context.close()
        self.assertEqual(self.external_requests, [], "Workspace attempted an external request")
        self.assertEqual(self.api_requests, [], "UI-only checks must not call an AI adapter")
        self.assertEqual(self.errors, [], "Browser script or console errors")

    def route(self, route):
        url = route.request.url
        if not url.startswith(self.origin + "/"):
            self.external_requests.append(url)
            route.abort()
        elif url == self.origin + "/api/intake":
            self.api_requests.append(url)
            route.fulfill(status=200, content_type="application/json", body="{}")
        else:
            route.continue_()

    def send(self, text):
        self.page.get_by_role("textbox", name="Customer message", exact=True).fill(text)
        self.page.get_by_role("button", name="Send sample reply", exact=True).click()

    def reset(self):
        self.page.get_by_role("button", name="Reset tour", exact=True).click()

    def capture(self, filename):
        directory = os.environ.get("PANELREPLY_CAPTURE_DIR")
        emit_preview = os.environ.get("PANELREPLY_EMIT_PREVIEWS") == "1"
        if not directory and not emit_preview:
            return
        if not preview_available(self.browser, self.id(), filename):
            return
        self.page.evaluate("() => window.scrollTo({top: 0, left: 0, behavior: 'instant'})")
        options = {"type": "jpeg", "quality": 70, "full_page": True, "animations": "disabled"}
        if directory:
            target = Path(directory).resolve()
            target.mkdir(parents=True, exist_ok=True)
            options["path"] = str(target / filename)
        image = self.page.screenshot(**options)
        if directory:
            print(f"WORKSPACE_SCREENSHOT={options['path']}", flush=True)
        if emit_preview:
            print("PANELREPLY_PREVIEW_START:" + filename, flush=True)
            print(base64.b64encode(image).decode("ascii"), flush=True)
            print("PANELREPLY_PREVIEW_END", flush=True)

    def assert_no_horizontal_overflow(self):
        dimensions = self.page.evaluate("""() => {
            const values = ['detail-job', 'detail-zip', 'detail-timing'].map(id => {
                const element = document.getElementById(id);
                return {id, width: element.clientWidth, scroll: element.scrollWidth};
            });
            const outside = [...document.querySelectorAll('body *')].filter(element => {
                if (!element.getClientRects().length || getComputedStyle(element).visibility === 'hidden') return false;
                const rect = element.getBoundingClientRect();
                return rect.right > innerWidth + 1 || rect.left < -1;
            }).map(element => {
                const rect = element.getBoundingClientRect();
                return {tag: element.tagName, id: element.id, class: element.className,
                    left: rect.left, right: rect.right, width: rect.width,
                    scroll: element.scrollWidth, text: element.textContent.trim().slice(0, 80)};
            });
            return {viewport: innerWidth, page: document.documentElement.scrollWidth, values, outside};
        }""")
        self.assertLessEqual(dimensions["page"], dimensions["viewport"] + 1, json.dumps(dimensions))
        for item in dimensions["values"]:
            self.assertGreater(item["width"], 0, json.dumps(item))
            self.assertLessEqual(item["scroll"], item["width"] + 1, json.dumps(item))

    def test_progress_tracks_out_of_order_fields_and_reset(self):
        expect(self.page.locator("#request-state")).to_have_text("Not started")
        expect(self.page.locator("#field-count")).to_have_text("0 of 3")
        expect(self.page.locator("#field-progress")).to_have_attribute("max", "3")
        expect(self.page.locator("#field-progress")).to_have_attribute("value", "0")
        expect(self.page.locator("#copy-summary")).to_be_disabled()
        expect(self.page.locator("#conversation-empty")).to_be_visible()

        self.send("48315")
        expect(self.page.locator("#detail-zip")).to_have_text("48315")
        expect(self.page.locator("#detail-job")).to_have_text("Not collected")
        expect(self.page.locator("#field-count")).to_have_text("1 of 3")
        expect(self.page.locator("#request-state")).to_have_text("Collecting details")
        expect(self.page.locator("#conversation-empty")).to_be_hidden()
        self.send("Friday after 4 pm")
        expect(self.page.locator("#field-count")).to_have_text("2 of 3")
        self.send("Install an EV charger in my garage")
        expect(self.page.locator("#field-count")).to_have_text("3 of 3")
        expect(self.page.locator("#field-progress")).to_have_attribute("value", "3")
        expect(self.page.locator("#request-state")).to_have_text("Ready for callback")
        expect(self.page.locator("#copy-summary")).to_be_enabled()
        self.capture("desktop-ready.jpg")

        self.reset()
        expect(self.page.locator("#request-state")).to_have_text("Not started")
        expect(self.page.locator("#field-count")).to_have_text("0 of 3")
        expect(self.page.locator("#copy-summary")).to_be_disabled()
        expect(self.page.locator("#conversation-empty")).to_be_visible()
        for field in ("job", "zip", "timing"):
            expect(self.page.locator("#detail-" + field)).to_have_text("Not collected")

    def test_conflicts_reduce_confirmed_progress_until_the_correct_field_is_supplied(self):
        self.send(BUNDLED_MESSAGE)
        self.send("Actually the ZIP is 48315 or 48084")
        expect(self.page.locator("#request-state")).to_have_text("Needs confirmation")
        expect(self.page.locator("#field-count")).to_have_text("2 of 3")
        expect(self.page.locator("#field-progress")).to_have_attribute("value", "2")
        expect(self.page.locator("#detail-zip")).to_contain_text("needs confirmation")
        self.send("Call me Monday after 5 pm")
        expect(self.page.locator("#request-state")).to_have_text("Needs confirmation")
        expect(self.page.locator("#field-count")).to_have_text("2 of 3")
        self.send("The correct job ZIP is 48084")
        expect(self.page.locator("#detail-zip")).to_have_text("48084")
        expect(self.page.locator("#field-count")).to_have_text("3 of 3")
        expect(self.page.locator("#request-state")).to_have_text("Ready for callback")

    def test_summary_status_keeps_opt_out_and_safety_priority(self):
        self.send(BUNDLED_MESSAGE)
        self.page.locator("#stop").click()
        expect(self.page.locator("#request-state")).to_have_text("Replies paused")
        self.send("My breaker is melting")
        expect(self.page.locator("#request-state")).to_have_text("Safety hold")
        self.page.locator("#restart").click()
        expect(self.page.locator("#request-state")).to_have_text("Safety hold")
        expect(self.page.locator("#events .event").last).to_contain_text("does not release the safety hold")
        self.reset()
        expect(self.page.locator("#request-state")).to_have_text("Not started")

    def test_character_limit_counter_and_accessible_description_stay_in_sync(self):
        reply = self.page.get_by_role("textbox", name="Customer message", exact=True)
        observation = {"kind": "character-limit-native-input", "status": "ATTEMPTED",
                       "phase": "initial", "roleLocator": "textbox:Customer message:exact",
                       "actionTimeoutMs": 5000}
        self.interaction_evidence = [observation]
        try:
            expect(self.page.locator("#reply-count")).to_have_text("0 / 500")
            described_by = reply.get_attribute("aria-describedby") or ""
            self.assertIn("reply-count", described_by.split())
            expect(reply).to_have_attribute("maxlength", "500")
            try:
                self.page.locator("body").evaluate("""() => {
                    const element = document.getElementById('reply');
                    const types = ['keydown', 'keyup', 'beforeinput', 'input', 'change', 'focus', 'blur'];
                    const probe = {element, events: [], overflow: false, started: performance.now()};
                    probe.listener = event => {
                        if (event.target !== probe.element) return;
                        if (probe.events.length >= 16) { probe.overflow = true; return; }
                        probe.events.push({type: event.type, key: event.key || null,
                            inputType: event.inputType || null, trusted: event.isTrusted,
                            elapsedMs: Math.round(performance.now() - probe.started),
                            length: element.value.length, start: element.selectionStart, end: element.selectionEnd,
                            activeId: document.activeElement?.id || null});
                    };
                    for (const type of types) document.addEventListener(type, probe.listener, true);
                    window.__panelreplyCharacterLimitProbe = probe;
                }""", timeout=1000)
            except Exception as error:
                observation["installError"] = str(error)[:1000]
            reply.fill("x" * 500)
            expect(self.page.locator("#reply-count")).to_have_text("500 / 500")
            observation["phase"] = "full-value-observed"
            reply.press("End")
            observation["phase"] = "end-command-completed"
            reply.press_sequentially("y")
            observation["phase"] = "overflow-key-command-completed"
            expect(reply).to_have_value("x" * 500)
            expect(self.page.locator("#reply-count")).to_have_text("500 / 500")
            self.page.locator("#send").click()
            expect(reply).to_have_value("")
            expect(self.page.locator("#reply-count")).to_have_text("0 / 500")
            observation.update({"status": "OBSERVED", "phase": "submitted-and-cleared"})
        finally:
            # Read state before teardown. These listeners never change values,
            # focus, event defaults, requests, timeout or the input sequence.
            try:
                observation["state"] = self.page.locator("body").evaluate("""() => {
                    const probe = window.__panelreplyCharacterLimitProbe;
                    if (probe) {
                        for (const type of ['keydown', 'keyup', 'beforeinput', 'input', 'change', 'focus', 'blur'])
                            document.removeEventListener(type, probe.listener, true);
                        delete window.__panelreplyCharacterLimitProbe;
                    }
                    const element = document.getElementById('reply');
                    const rect = element?.getBoundingClientRect(), style = element ? getComputedStyle(element) : null;
                    return {url: location.href, readyState: document.readyState,
                        activeElement: {id: document.activeElement?.id || null, tag: document.activeElement?.tagName || null},
                        replyCount: document.querySelectorAll('#reply').length,
                        referenceConnected: probe?.element?.isConnected ?? null,
                        sameReference: probe ? probe.element === element : null,
                        control: element ? {tag: element.tagName, role: element.getAttribute('role'),
                            labels: [...element.labels].map(label => label.textContent.slice(0, 100)),
                            describedBy: element.getAttribute('aria-describedby'),
                            disabled: element.disabled, readOnly: element.readOnly, hidden: element.hidden,
                            length: element.value.length, maxLength: element.maxLength,
                            start: element.selectionStart, end: element.selectionEnd,
                            display: style.display, visibility: style.visibility,
                            rect: {x: rect.x, y: rect.y, width: rect.width, height: rect.height}} : null,
                        counter: document.getElementById('reply-count')?.textContent,
                        events: probe?.events || [], overflow: probe?.overflow ?? null};
                }""", timeout=1000)
            except Exception as error:
                observation["captureError"] = str(error)[:1000]
            if observation["status"] != "OBSERVED":
                try:
                    observation["roleSnapshot"] = reply.aria_snapshot(timeout=1000)[:1500]
                except Exception as error:
                    observation["roleSnapshotError"] = str(error)[:1000]
            observation["pageErrors"] = [str(error)[:1000] for error in self.errors[:5]]

    def test_sending_a_message_keeps_the_latest_reply_in_the_conversation_view(self):
        self.send(BUNDLED_MESSAGE)
        for number in range(8):
            self.send(
                f"Additional sample detail {number + 1}: the EV charger will be in the garage. "
                "Please keep the callback preference already provided."
            )
        latest = self.page.locator("#events .event").last
        expect(latest).to_contain_text("No notification sent")
        geometry = self.page.locator("#events").evaluate("""element => {
            const list = element.getBoundingClientRect();
            const reply = element.lastElementChild.getBoundingClientRect();
            return {height: element.clientHeight, total: element.scrollHeight,
                distanceFromBottom: element.scrollHeight - element.scrollTop - element.clientHeight,
                listTop: list.top, listBottom: list.bottom,
                replyTop: reply.top, replyBottom: reply.bottom};
        }""")
        self.assertGreater(geometry["total"], geometry["height"], json.dumps(geometry))
        self.assertLessEqual(abs(geometry["distanceFromBottom"]), 2, json.dumps(geometry))
        self.assertGreaterEqual(geometry["replyTop"], geometry["listTop"] - 1, json.dumps(geometry))
        self.assertLessEqual(geometry["replyBottom"], geometry["listBottom"] + 1, json.dumps(geometry))

    def test_copy_summary_reports_success_only_after_clipboard_resolves(self):
        self.page.evaluate("""() => {
            window.copiedSummary = null;
            window.finishCopy = null;
            Object.defineProperty(navigator, 'clipboard', {configurable: true, value: {
                writeText: text => new Promise(resolve => {
                    window.copiedSummary = text;
                    window.finishCopy = resolve;
                })
            }});
        }""")
        self.send(BUNDLED_MESSAGE)
        self.page.locator("#copy-summary").click()
        expect(self.page.locator("#copy-status")).not_to_contain_text(re.compile(r"copied", re.I))
        self.page.evaluate("() => window.finishCopy()")
        expect(self.page.locator("#copy-status")).to_contain_text(re.compile(r"copied", re.I))
        copied = self.page.evaluate("() => window.copiedSummary")
        self.assertIn("ZIP: 48315", copied)
        self.assertIn("Friday after 4 pm", copied)
        self.assertIn("No appointment has been booked", copied)

    def test_clipboard_denial_opens_and_selects_the_summary_without_false_success(self):
        self.page.evaluate("""() => Object.defineProperty(navigator, 'clipboard', {
            configurable: true, value: {writeText: async () => {throw new Error('Permission denied');}}
        })""")
        self.send(BUNDLED_MESSAGE)
        self.page.locator("#copy-summary").click()
        expect(self.page.locator("#summary-details")).to_have_attribute("open", "")
        expect(self.page.locator("#summary")).to_be_visible()
        expect(self.page.locator("#summary")).to_be_focused()
        expect(self.page.locator("#copy-status")).to_contain_text(re.compile(r"selected.*manually", re.I))
        expect(self.page.locator("#copy-status")).not_to_contain_text(re.compile(r"copied", re.I))
        selection = self.page.evaluate("() => window.getSelection().toString()")
        self.assertIn("ZIP: 48315", selection)
        self.assertIn("No appointment has been booked", selection)

    def test_reset_ignores_a_late_clipboard_result(self):
        self.page.evaluate("""() => Object.defineProperty(navigator, 'clipboard', {
            configurable: true, value: {writeText: () => new Promise(resolve => {window.finishCopy = resolve;})}
        })""")
        self.send(BUNDLED_MESSAGE)
        self.page.locator("#copy-summary").click()
        self.reset()
        self.page.evaluate("() => window.finishCopy()")
        expect(self.page.locator("#copy-status")).to_have_text("")
        expect(self.page.locator("#copy-summary")).to_be_disabled()
        expect(self.page.locator("#request-state")).to_have_text("Not started")

    def test_skip_link_and_workspace_navigation_have_real_targets(self):
        self.page.keyboard.press("Tab")
        skip_link = self.page.locator(".skip-link")
        try:
            expect(skip_link).to_be_focused()
        except AssertionError as failure:
            focus = self.page.evaluate("""() => ({
                documentFocused: document.hasFocus(),
                activeElement: document.activeElement?.outerHTML.slice(0, 1000),
                skipLinkTabIndex: document.querySelector('.skip-link')?.tabIndex
            })""")
            raise AssertionError(f"{failure}\nFirst Tab focus: {json.dumps(focus)}") from failure
        expect(skip_link).to_be_visible()
        target = skip_link.get_attribute("href")
        self.assertTrue(target and target.startswith("#"))
        self.page.keyboard.press("Enter")
        expect(self.page.locator(target)).to_be_focused()
        for anchor in ("#workspace", "#workflow", "#connections"):
            link = self.page.locator('nav a[href="' + anchor + '"]')
            expect(link).to_have_count(1)
            link.click()
            self.assertEqual(self.page.evaluate("() => location.hash"), anchor)
            expect(self.page.locator(anchor)).to_be_visible()
        self.assertEqual(self.page.get_by_role("main").count(), 1)
        self.assertEqual(self.page.get_by_role("heading", level=1).count(), 1)

    def test_mobile_controls_are_touch_sized_and_ai_controls_stay_gated(self):
        for width in (320, 390):
            with self.subTest(width=width):
                self.page.set_viewport_size({"width": width, "height": 900})
                self.assert_no_horizontal_overflow()
                sizes = self.page.evaluate("""() =>
                    [...document.querySelectorAll('button, textarea, input, select, nav a, details > summary')]
                    .filter(element => element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden')
                    .map(element => ({id: element.id || element.textContent.trim().slice(0, 40),
                        height: element.getBoundingClientRect().height,
                        width: element.getBoundingClientRect().width}))
                """)
                self.assertGreater(len(sizes), 8)
                for item in sizes:
                    self.assertGreaterEqual(item["height"], 44, json.dumps(item))
                    self.assertGreaterEqual(item["width"], 44, json.dumps(item))
                expect(self.page.locator("#ai-controls")).to_be_hidden()
        self.page.goto(self.origin + "/ai/")
        expect(self.page.get_by_label("AI test access code", exact=True)).to_be_visible()
        self.assert_no_horizontal_overflow()
        self.send(BUNDLED_MESSAGE)
        expect(self.page.locator("#request-state")).to_have_text("Ready for callback")
        self.assertEqual(self.api_requests, [], "No access code means no provider request")

    def test_long_details_and_two_hundred_percent_text_do_not_overflow(self):
        for width in (320, 390, 768, 1280, 1440):
            with self.subTest(width=width, text_scale=100):
                self.page.set_viewport_size({"width": width, "height": 1000})
                self.reset()
                self.send("a" * 500)
                self.send("48315")
                self.send("Timing: Friday after 4 pm " + "b" * 475)
                self.assert_no_horizontal_overflow()
                self.page.locator("#summary-details > summary").click()
                expect(self.page.locator("#summary")).to_be_visible()
                summary = self.page.locator("#summary").evaluate("e => ({width: e.clientWidth, scroll: e.scrollWidth})")
                self.assertLessEqual(summary["scroll"], summary["width"] + 1, json.dumps(summary))
        self.reset()
        self.send(BUNDLED_MESSAGE)
        for width in (320, 390, 1280):
            with self.subTest(width=width, text_scale=200):
                self.page.set_viewport_size({"width": width, "height": 1000})
                self.page.evaluate("() => document.documentElement.style.fontSize = '200%'")
                self.assert_no_horizontal_overflow()
                font_size = self.page.locator("body").evaluate("e => parseFloat(getComputedStyle(e).fontSize)")
                self.assertGreaterEqual(font_size, 30, "Body text must respond to the user's font scale")
                headings = self.page.locator('h1, h2').evaluate_all("""elements => elements.map(element => {
                    const rect = element.getBoundingClientRect();
                    return {text: element.textContent, left: rect.left, right: rect.right,
                        width: element.clientWidth, scroll: element.scrollWidth,
                        overflow: getComputedStyle(element).overflowX};
                })""")
                for heading in headings:
                    self.assertGreater(heading["width"], 0, json.dumps(heading))
                    self.assertLessEqual(heading["scroll"], heading["width"] + 1, json.dumps(heading))
                    self.assertGreaterEqual(heading["left"], -1, json.dumps(heading))
                    self.assertLessEqual(heading["right"], width + 1, json.dumps(heading))
                    self.assertNotIn(heading["overflow"], ["hidden", "clip"], "Text must wrap without clipping")
        self.page.evaluate("() => document.documentElement.style.fontSize = ''")
        self.page.set_viewport_size({"width": 390, "height": 900})
        self.capture("mobile-ready.jpg")

    def test_text_and_control_colors_have_readable_contrast(self):
        selectors = ["#send", "#example", "label[for=reply]", "#ai-mode", "#request-state", "nav a.nav-link"]
        ratios = self.page.evaluate("""selectors => {
            const rgba = color => {
                const parts = color.match(/[\\d.]+/g).map(Number);
                return [...parts.slice(0, 3), parts.length > 3 ? parts[3] : 1];
            };
            const over = (front, back) => front.slice(0, 3).map((channel, i) =>
                channel * front[3] + back[i] * (1 - front[3]));
            const luminance = rgb => rgb.map(channel => {
                const value = channel / 255;
                return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
            }).reduce((sum, value, i) => sum + value * [.2126, .7152, .0722][i], 0);
            return selectors.map(selector => {
                const element = document.querySelector(selector);
                if (!element) throw new Error('Missing contrast target ' + selector);
                const chain = [];
                for (let node = element; node; node = node.parentElement) chain.unshift(node);
                let background = [255, 255, 255];
                for (const node of chain) background = over(rgba(getComputedStyle(node).backgroundColor), background);
                const foreground = over(rgba(getComputedStyle(element).color), background);
                const a = luminance(foreground), b = luminance(background);
                return {selector, foreground, background, ratio: (Math.max(a, b) + .05) / (Math.min(a, b) + .05)};
            });
        }""", selectors)
        for item in ratios:
            self.assertGreaterEqual(item["ratio"], 4.5, json.dumps(item))


if __name__ == "__main__":
    unittest.main(verbosity=2)
