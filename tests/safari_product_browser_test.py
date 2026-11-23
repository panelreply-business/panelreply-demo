"""Six fixed-product journeys for installed desktop Safari, not Playwright.

Run through release_safari_runner.py on the ordinary macOS Intel CI image.
The runner owns one native session. Each method has a fresh synthetic owner.
No provider, external customer, deployment or physical device is involved.
WebDriver provides no equivalent to Playwright's request/console interception.
API readbacks supplement UI actions and never stand in for a browser download.
"""

import base64
import csv
from datetime import datetime
import hashlib
import io
import json
import os
from pathlib import Path
import re
import socket
import subprocess
from tempfile import TemporaryDirectory
import time
import unittest
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen
import uuid


ROOT = Path(__file__).resolve().parent.parent
FIXTURE_PASSWORD = "Synthetic native Safari password 2026!"
BACKUP_PASSPHRASE = "Synthetic native Safari recovery passphrase 2026!"
IMAGE = ROOT / "tests" / "fixtures" / "panels" / "complete.png"
LEAD = {
    "customerName": "Synthetic Safari Customer", "phone": "+15865550101",
    "job": "Review the garage outlet", "zip": "48315",
    "callbackWindow": "After 4 pm", "requestedWorkDate": "Friday",
    "contactPermission": "requested_callback", "conversation": [],
}


def command(args, env, stdin=None):
    result = subprocess.run(["node", *args], cwd=ROOT, env=env,
                            input=None if stdin is None else stdin + "\n",
                            capture_output=True, text=True, timeout=45, check=False)
    if result.returncode:
        raise AssertionError("Synthetic fixture command failed: " + result.stderr[-2000:])
    return json.loads(result.stdout)


def select_keyboard_plan(control, value):
    """Plan native first-character cycling from the observed single select.

    WebKit's TypeAhead cycles matching initial characters after the currently
    selected option. No popup, option click, value setter or event dispatch is
    needed. This fixed-product scope uses ASCII initial characters only.
    """
    if control.get("tag") != "SELECT" or control.get("multiple") is not False \
            or control.get("disabled") is not False or control.get("size") not in (0, 1):
        raise AssertionError("A usable native single-select control is required")
    options = control.get("options")
    selected = control.get("selectedIndex")
    if not isinstance(options, list) or not 1 <= len(options) <= 32 \
            or type(selected) is not int or not 0 <= selected < len(options):
        raise AssertionError("The native select option inventory is invalid")
    if any(not isinstance(option, dict) or not isinstance(option.get("value"), str)
           or not isinstance(option.get("label"), str) or type(option.get("disabled")) is not bool
           or type(option.get("hidden")) is not bool for option in options):
        raise AssertionError("The native option metadata is incomplete")
    matches = [index for index, option in enumerate(options) if option["value"] == value]
    if len(matches) != 1 or options[matches[0]]["disabled"] or options[matches[0]]["hidden"]:
        raise AssertionError("Exactly one enabled, visible target option is required")
    target = matches[0]
    label = options[target]["label"].lstrip()
    if not label or not re.fullmatch(r"[A-Za-z0-9]", label[0]):
        raise AssertionError("This native keyboard plan requires an ASCII initial character")
    character = label[0].lower()
    if control.get("value") != options[selected]["value"]:
        raise AssertionError("The native select value and selected index disagree")
    cycles = 0
    if selected != target:
        for offset in range(1, len(options) + 1):
            index = (selected + offset) % len(options)
            option = options[index]
            if not option["disabled"] and not option["hidden"] \
                    and option["label"].lstrip().lower().startswith(character):
                cycles += 1
            if index == target:
                break
    return {"character": character, "cycles": cycles, "targetIndex": target,
            "initialValue": control["value"], "targetLabel": options[target]["label"]}


class SafariProductHarness(unittest.TestCase):
    native = None  # Set only after the runner observes a native Safari session.

    @classmethod
    def setUpClass(cls):
        if cls.native is None or cls.native.driver is None:
            raise RuntimeError("An observed native Safari session is required")
        cls.directory = TemporaryDirectory(prefix="panelreply-native-safari-")
        cls.data_dir = Path(cls.directory.name).resolve() / "data"
        cls.data_dir.mkdir(mode=0o700)
        cls.server_log = Path(cls.directory.name).resolve() / "server.log"
        cls.process = None
        cls.log_handle = None
        cls.counter = 0
        cls.addClassCleanup(cls.cleanup)
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
            listener.bind(("127.0.0.1", 0))
            cls.port = listener.getsockname()[1]
        cls.origin = f"http://127.0.0.1:{cls.port}"
        # Do not inherit provider credentials or another product's settings.
        cls.node_env = {key: value for key, value in os.environ.items()
                        if not key.startswith(("OPENAI_", "WORKSPACE_", "CALLBACK_", "SPREADSHEET_"))}
        cls.set_product_env()
        initialized = command([cls.server_entry, "--init"], cls.node_env)
        if initialized.get("product") != cls.product_id or initialized.get("initialized") is not True:
            raise AssertionError("The fixed entrypoint initialized a different product")
        cls.start_server()

    @classmethod
    def set_product_env(cls):
        prefix = cls.product_id.upper()
        cls.node_env.update({prefix + "_DATA_DIR": str(cls.data_dir),
                             prefix + "_ORIGIN": cls.origin, prefix + "_PORT": str(cls.port)})

    @classmethod
    def start_server(cls):
        cls.set_product_env()
        cls.log_handle = cls.server_log.open("ab")
        cls.process = subprocess.Popen(["node", cls.server_entry], cwd=ROOT,
                                       env=cls.node_env, stdin=subprocess.DEVNULL,
                                       stdout=cls.log_handle, stderr=subprocess.STDOUT)
        deadline = time.monotonic() + 20
        while time.monotonic() < deadline and cls.process.poll() is None:
            try:
                with urlopen(cls.origin + "/login", timeout=0.5) as response:
                    if response.status == 200:
                        # Actual response policy remains intact in native Safari.
                        if "connect-src 'self'" not in response.headers.get("Content-Security-Policy", ""):
                            raise AssertionError("The private page lost its same-origin connection policy")
                        return
            except (HTTPError, URLError, OSError):
                pass
            time.sleep(0.1)
        raise AssertionError("Fixed product did not start: " + cls.server_log.read_text(errors="replace")[-2000:])

    @classmethod
    def stop_server(cls):
        if cls.process is not None:
            if cls.process.poll() is None:
                cls.process.terminate()
                try:
                    cls.process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    cls.process.kill()
                    cls.process.wait(timeout=5)
            cls.process = None
        if cls.log_handle is not None:
            cls.log_handle.close()
            cls.log_handle = None

    @classmethod
    def cleanup(cls):
        cls.stop_server()
        cls.directory.cleanup()

    def setUp(self):
        self.driver = self.native.driver
        self.wait = self.native.wait_type(self.driver, 10, poll_frequency=0.1)
        self.download_evidence = []
        self.readback_evidence = []
        self.input_evidence = []
        self.diagnostic_evidence = []
        self.failure_captured = False
        self.diagnostic_project_id = None
        self.driver.get(self.origin + "/login")
        self.driver.delete_all_cookies()
        type(self).counter += 1
        self.username = f"safari-{self.product_id}-{type(self).counter}@example.test"
        owner = command(["scripts/workspace-admin.cjs", "--data-dir", str(self.data_dir),
                         "--business", "Synthetic Safari Electric", "--username", self.username],
                        self.node_env, FIXTURE_PASSWORD)
        self.assertEqual(owner["username"], self.username)
        self.driver.get(self.origin + "/login")
        self.wait.until(lambda driver: driver.execute_script("return document.readyState") == "complete")
        self.assertEqual(self.element("body").get_attribute("data-product-id"), self.product_id)
        self.assertEqual(self.driver.title, "Sign in · " + self.product_label)
        self.viewport = self.driver.execute_script(
            "return {width: innerWidth, height: innerHeight, devicePixelRatio: devicePixelRatio}")
        self.assertGreaterEqual(self.viewport["width"], 900)
        self.assertGreaterEqual(self.viewport["height"], 500)

    def tearDown(self):
        self.driver.delete_all_cookies()
        self.driver.get("about:blank")

    def element(self, selector, visible=True):
        def find(driver):
            elements = driver.find_elements("css selector", selector)
            return next((element for element in elements if not visible or element.is_displayed()), False)
        return self.wait.until(find)

    def click(self, selector):
        element = self.element(selector)
        self.wait.until(lambda _driver: element.is_enabled())
        element.click()

    def fill(self, selector, value):
        element = self.element(selector)
        self.wait.until(lambda _driver: element.is_enabled())
        element.clear()
        if value:
            element.send_keys(value)
        self.assertEqual(element.get_property("value"), value)

    def select(self, selector, value, expected=None):
        element = self.element(selector)
        self.wait.until(lambda _driver: element.is_enabled())
        observation = {"selector": selector, "requestedValue": value,
                       "expectedValue": value if expected is None else expected,
                       "status": "ATTEMPTED", "transport": "native WebDriver character cycling and Tab"}
        self.input_evidence.append(observation)
        control = self.driver.execute_script("""
            const element = arguments[0];
            return {tag: element.tagName, multiple: element.multiple, disabled: element.disabled,
                size: element.size, value: element.value, selectedIndex: element.selectedIndex,
                options: [...element.options].slice(0, 33).map(option => ({
                    value: option.value, label: option.label,
                    disabled: option.disabled || !!option.closest('optgroup[disabled]'),
                    hidden: option.hidden || getComputedStyle(option).display === 'none'}))};
        """, element)
        observation["control"] = control
        plan = select_keyboard_plan(control, value)
        observation["plan"] = plan
        if plan["cycles"] == 0:
            self.assertEqual(element.get_property("value"), observation["expectedValue"])
            observation.update({"status": "UNCHANGED", "observedValue": value, "events": []})
            return
        self.driver.execute_script("""
            const element = arguments[0], events = [], types = ['keydown', 'keyup', 'input', 'change'];
            const probe = {element, events, overflow: false};
            probe.listener = event => {
                if (events.length >= 128) { probe.overflow = true; return; }
                events.push({type: event.type, key: event.key || null,
                    trusted: event.isTrusted, value: element.value});
            };
            for (const type of types) element.addEventListener(type, probe.listener, true);
            window.__panelreplyNativeSelectProbe = probe;
        """, element)
        try:
            element.send_keys(plan["character"] * plan["cycles"], self.native.keys.TAB)
        finally:
            # Observers do not focus, set values, dispatch or cancel events.
            # Diagnostic failure must not replace an original input failure.
            try:
                observation.update(self.driver.execute_script("""
                    const probe = window.__panelreplyNativeSelectProbe;
                    for (const type of ['keydown', 'keyup', 'input', 'change'])
                        probe.element.removeEventListener(type, probe.listener, true);
                    delete window.__panelreplyNativeSelectProbe;
                    return {events: probe.events, overflow: probe.overflow,
                        observedValue: probe.element.value,
                        activeElementId: document.activeElement?.id || null};
                """))
            except Exception as error:
                observation["observationError"] = str(error)[:1000]
        self.assertNotIn("observationError", observation, observation)
        self.assertEqual(observation["observedValue"], observation["expectedValue"], observation)
        self.assertFalse(observation["overflow"])
        self.assertTrue(observation["events"])
        self.assertTrue(all(event["trusted"] for event in observation["events"]))
        for kind in ("keydown", "keyup"):
            self.assertEqual(sum(event["type"] == kind and str(event["key"]).lower() == plan["character"]
                                 for event in observation["events"]), plan["cycles"], observation)
        # Capture-phase observations preserve the attempted reviewed value even
        # when the application rejects it because a required field is blank.
        for kind in ("input", "change"):
            self.assertTrue(any(event["type"] == kind and event["value"] == value
                                for event in observation["events"]), observation)
        observation["status"] = "OBSERVED"

    def capture_failure_evidence(self):
        """Read the synthetic page before teardown without changing its state."""
        if getattr(self, "failure_captured", False) or not hasattr(self, "driver"):
            return
        self.failure_captured = True
        if not hasattr(self, "diagnostic_evidence"):
            self.diagnostic_evidence = []
        observation = {"kind": "failure-state", "method": self._testMethodName}
        self.diagnostic_evidence.append(observation)
        try:
            observation["ui"] = self.page_state()
        except Exception as error:
            observation["uiError"] = str(error)[:1000]
        project_id = getattr(self, "diagnostic_project_id", None)
        if project_id:
            try:
                project = self.api("GET", "/api/panel-projects/" + project_id)["project"]
                observation["savedProject"] = {key: project[key] for key in ("id", "version", "rows", "sources")}
            except Exception as error:
                observation["readbackError"] = str(error)[:1000]
        try:
            directory = os.environ.get("PANELREPLY_CAPTURE_DIR")
            if directory:
                target = Path(directory).resolve() / (self.product_id + "-native-safari-" + self._testMethodName + "-failure.png")
                target.parent.mkdir(parents=True, exist_ok=True)
                if not self.driver.save_screenshot(str(target)):
                    raise RuntimeError("The native screenshot command returned false")
                observation["screenshot"] = {"filename": target.name, "bytes": target.stat().st_size,
                                             "sha256": hashlib.sha256(target.read_bytes()).hexdigest()}
        except Exception as error:
            observation["screenshotError"] = str(error)[:1000]

    def page_state(self):
        return self.driver.execute_script("""
            const selectors = ['#source-selection-text', '#source-status', '#source-error',
                '#project-error', '#project-save-status', '#project-dirty', '#project-version',
                '#upload-source', '#panel-image', '#save-project', '#lead-permission',
                '#lead-status-select', '#lead-status', '#lead-error', '#task-outcome', '#task-save-status',
                '#task-error', '[aria-label="Review status row 1"]'];
            const nodes = selectors.map(selector => {
                const element = document.querySelector(selector);
                if (!element) return {selector, exists: false};
                const rect = element.getBoundingClientRect(), style = getComputedStyle(element);
                const x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
                const hit = document.elementFromPoint(x, y);
                return {selector, exists: true, text: element.textContent.slice(0, 1200),
                    value: element.type === 'file' ? null : String(element.value ?? '').slice(0, 1200),
                    hidden: element.hidden, disabled: !!element.disabled, display: style.display,
                    visibility: style.visibility, rect: {x: rect.x, y: rect.y, width: rect.width, height: rect.height},
                    hit: hit ? {tag: hit.tagName, id: hit.id, inside: element === hit || element.contains(hit)} : null,
                    files: element.files ? [...element.files].slice(0, 2).map(file => ({
                        name: file.name, type: file.type, size: file.size, lastModified: file.lastModified})) : null};
            });
            return {url: location.href, readyState: document.readyState, title: document.title,
                activeElementId: document.activeElement?.id || null,
                viewport: {width: innerWidth, height: innerHeight, scrollX, scrollY}, nodes,
                sourceCount: document.querySelectorAll('#source-list > li').length,
                rows: [...document.querySelectorAll('#panel-parts-body tr')].slice(0, 10).map(row => ({
                    reviewed: row.dataset.reviewed,
                    controls: [...row.querySelectorAll('input,select,textarea')].map(control => ({
                        label: control.getAttribute('aria-label'), value: control.value.slice(0, 1200)}))}))};
        """)

    def text_contains(self, selector, text):
        return self.wait.until(lambda _driver: text in self.element(selector).text)

    def assert_value(self, selector, value):
        self.wait.until(lambda _driver: self.element(selector).get_property("value") == value)

    def fetch(self, method, path, data=None, binary=False, headers=None):
        self.assertTrue(path.startswith("/") and not path.startswith("//"))
        self.assertEqual(urlsplit(self.driver.current_url).netloc, urlsplit(self.origin).netloc)
        result = self.driver.execute_async_script("""
            const [method, path, data, binary, extra, done] = arguments;
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 7000);
            (async () => {
              const headers = {...extra};
              if (!['GET', 'HEAD'].includes(method)) {
                const session = await fetch('/api/session', {credentials: 'same-origin', signal: controller.signal});
                if (!session.ok) throw new Error('No authenticated fixture session');
                headers['X-CSRF-Token'] = (await session.json()).csrfToken;
              }
              if (data !== null) headers['Content-Type'] = 'application/json';
              const response = await fetch(path, {method, credentials: 'same-origin', headers,
                body: data === null ? undefined : JSON.stringify(data), signal: controller.signal});
              let body;
              if (binary) {
                const bytes = new Uint8Array(await response.arrayBuffer());
                let raw = '';
                for (let i = 0; i < bytes.length; i += 16384) raw += String.fromCharCode(...bytes.subarray(i, i + 16384));
                body = btoa(raw);
              } else body = await response.text();
              return {status: response.status, contentType: response.headers.get('Content-Type'), body};
            })().then(result => {clearTimeout(timer); done(result);}, error => {
              clearTimeout(timer); done({networkError: String(error)});
            });
        """, method, path, data, binary, headers or {})
        self.assertNotIn("networkError", result, result)
        return result

    def api(self, method, path, data=None, status=200, headers=None):
        result = self.fetch(method, path, data, headers=headers)
        self.assertEqual(result["status"], status, result["body"][:2000])
        return None if status == 204 else json.loads(result["body"])

    def binary(self, path):
        result = self.fetch("GET", path, binary=True)
        self.assertEqual(result["status"], 200)
        value = base64.b64decode(result["body"], validate=True)
        self.readback_evidence.append({"path": path, "bytes": len(value),
                                       "sha256": hashlib.sha256(value).hexdigest(),
                                       "transport": "Safari same-origin fetch readback"})
        return value

    def login(self):
        self.driver.get(self.origin + "/login")
        self.wait.until(lambda driver: driver.execute_script("return document.readyState") == "complete")
        self.fill("#username", self.username)
        self.fill("#password", FIXTURE_PASSWORD)
        self.element("#password").send_keys(self.native.keys.ENTER)
        self.wait.until(lambda driver: driver.current_url == self.origin + self.home_path)
        self.element("#nav-inbox" if self.product_id == "callback" else "#new-project")
        self.assert_navigation()

    def assert_navigation(self):
        self.assertEqual(self.element("body").get_attribute("data-product-id"), self.product_id)
        self.assertIn(self.product_label, self.driver.title)
        forbidden = 'a[href^="/panels"],a[href^="/dashboard"]' if self.product_id == "callback" else \
                    'a[href="/"],a[href^="/preview"],a[href^="/dashboard"],a[href="/#settings"]'
        self.assertEqual(self.driver.find_elements("css selector", forbidden), [])

    def assert_denied(self, paths):
        for path in paths:
            self.assertEqual(self.fetch("GET", path)["status"], 404, path)

    def screenshot(self, name):
        directory = os.environ.get("PANELREPLY_CAPTURE_DIR")
        if directory:
            target = Path(directory).resolve() / name
            target.parent.mkdir(parents=True, exist_ok=True)
            self.assertTrue(self.driver.save_screenshot(str(target)))

    def create_lead_fixture(self):
        return self.api("POST", "/api/leads", LEAD, status=201,
                        headers={"Idempotency-Key": uuid.uuid4().hex})["lead"]

    def open_lead(self, lead):
        self.driver.get(self.origin + "/?lead=" + lead["id"])
        self.assert_value("#lead-name", lead["customerName"])
        self.wait.until(lambda _driver: re.fullmatch(r"\d+ of \d+ saved tasks?\.", self.element("#lead-task-status").text))

    def tasks(self, lead):
        return self.api("GET", "/api/callback-tasks?state=all&leadId=" + lead["id"])["tasks"]

    def task_time(self, value):
        self.fill("#task-time-zone", "America/Detroit")
        self.assertRegex(value, r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$")
        local = datetime.fromisoformat(value)
        element = self.element("#task-local-time")
        self.wait.until(lambda _driver: element.is_enabled())
        observation = {"selector": "#task-local-time", "requestedValue": value,
                       "requestedTimeZone": "America/Detroit", "status": "ATTEMPTED",
                       "transport": "native WebDriver segmented keyboard entry"}
        self.input_evidence.append(observation)
        # Inspect the existing page contract. This does not change the browser's
        # locale, the control, or a value. Intl describes the language context;
        # the exact native-control readback below remains the acceptance check.
        control = self.driver.execute_script("""
            const element = arguments[0], style = getComputedStyle(element);
            const lang = element.closest('[lang]')?.getAttribute('lang') || '';
            const formatter = new Intl.DateTimeFormat(lang || undefined, {
                dateStyle: 'short', timeStyle: 'short', timeZone: 'UTC'
            });
            return {type: element.type, step: element.step, lang,
                direction: style.direction, writingMode: style.writingMode,
                browserLanguage: navigator.language, browserLanguages: navigator.languages,
                format: formatter.resolvedOptions(),
                fieldOrder: formatter.formatToParts(new Date('2006-11-22T23:45:00Z'))
                    .filter(part => part.type !== 'literal').map(part => part.type)};
        """, element)
        observation["control"] = control
        self.assertEqual({name: control[name] for name in ("type", "step", "lang", "direction", "writingMode")},
                         {"type": "datetime-local", "step": "60", "lang": "en",
                          "direction": "ltr", "writingMode": "horizontal-tb"})
        self.assertEqual(control["fieldOrder"], ["month", "day", "year", "hour", "minute", "dayPeriod"])
        self.assertEqual({name: control["format"][name] for name in ("calendar", "numberingSystem", "hourCycle")},
                         {"calendar": "gregory", "numberingSystem": "latn", "hourCycle": "h12"})
        element.clear()
        self.assertEqual(element.get_property("value"), "")
        # WebKit's datetime-local keyboard regression uses separate fields and
        # explicit Right keys. An ISO string is not a native field sequence.
        # One command preserves focus between fields. Left keys first select
        # the first field, even when a previous reschedule selected another one.
        keys = self.native.keys
        fields = [str(local.month), str(local.day), str(local.year),
                  str(local.hour % 12 or 12), str(local.minute), "A" if local.hour < 12 else "P"]
        sequence = [keys.ARROW_LEFT] * 6
        for index, field in enumerate(fields):
            if index:
                sequence.append(keys.ARROW_RIGHT)
            sequence.append(field)
        sequence.append(keys.TAB)
        observation["fields"] = fields
        self.driver.execute_script("""
            const element = arguments[0], events = [], types = ['keydown', 'keyup', 'input', 'change'];
            const probe = {events, overflow: false, element};
            probe.listener = event => {
                if (events.length >= 128) { probe.overflow = true; return; }
                events.push({type: event.type, key: event.key || null,
                    trusted: event.isTrusted, value: element.value});
            };
            for (const type of types) element.addEventListener(type, probe.listener, true);
            window.__panelreplyNativeDateProbe = probe;
        """, element)
        try:
            element.send_keys(*sequence)
        finally:
            # Preserve a failed attempt too. These listeners only observe
            # events. No value setters, synthetic events or fallback input.
            observation.update(self.driver.execute_script("""
                const probe = window.__panelreplyNativeDateProbe;
                for (const type of ['keydown', 'keyup', 'input', 'change'])
                    probe.element.removeEventListener(type, probe.listener, true);
                delete window.__panelreplyNativeDateProbe;
                return {events: probe.events, overflow: probe.overflow,
                    observedValue: probe.element.value, activeElementId: document.activeElement?.id || null};
            """))
        self.assertEqual(observation["observedValue"], value, json.dumps(observation, ensure_ascii=False))
        self.assertFalse(observation["overflow"])
        self.assertTrue(observation["events"])
        self.assertTrue(all(event["trusted"] for event in observation["events"]))
        for event_type in ("keydown", "keyup"):
            self.assertEqual(sum(event["type"] == event_type and event["key"] == "ArrowRight"
                                 for event in observation["events"]), 5)
        for event_type in ("input", "change"):
            self.assertTrue(any(event["type"] == event_type and event["value"] == value
                                for event in observation["events"]), event_type)
        observation["status"] = "OBSERVED"

    def save_task(self, lead, expected_count, task_id=None, version=None):
        self.click("#save-callback-task")
        self.wait.until(lambda _driver: self.element("#task-save-status").text not in ("", "Saving task…"))
        self.wait.until(lambda _driver: len(self.driver.find_elements("css selector", "#lead-task-list > li")) == expected_count)
        tasks = self.tasks(lead)
        self.assertEqual(len(tasks), expected_count)
        if task_id is not None:
            result = next(item for item in tasks if item["id"] == task_id)
            self.assertEqual(result["version"], version)
            return result
        return tasks

    def task_action(self, task_id, label):
        card = self.element(f'#lead-task-list > li[data-task-id="{task_id}"]')
        button = card.find_element("xpath", f'.//button[normalize-space()="{label}"]')
        self.assertTrue(button.is_enabled())
        button.click()

    def create_panel_ui(self, name, blank_manufacturer=False):
        self.click("#new-project")
        self.fill("#project-name", name)
        self.click("#add-part")
        self.fill('[aria-label="Part number row 1"]', "000123")
        self.fill('[aria-label="Manufacturer row 1"]', "" if blank_manufacturer else "SAMPLE COMPONENTS")
        self.fill('[aria-label="Description row 1"]', "Synthetic Safari component")
        self.save_panel()
        projects = self.api("GET", "/api/panel-projects")["projects"]
        self.assertEqual(len(projects), 1)
        self.assertEqual(projects[0]["name"], name)
        identifier = projects[0]["id"]
        self.open_panel(identifier)
        return self.api("GET", "/api/panel-projects/" + identifier)["project"]

    def save_panel(self):
        self.click("#save-project")
        self.text_contains("#project-save-status", "Project saved")
        self.wait.until(lambda _driver: not self.element("#project-dirty", visible=False).is_displayed())

    def open_panel(self, identifier):
        self.diagnostic_project_id = identifier
        self.driver.get(self.origin + "/panels?project=" + identifier)
        self.element("#project-content")
        self.text_contains("#project-version", "Version")

    def upload_source(self, project):
        file_input = self.element("#panel-image")
        self.assertTrue(file_input.is_enabled())
        observation = {"kind": "source-upload", "status": "ATTEMPTED",
                       "projectId": project["id"], "expectedFilename": IMAGE.name,
                       "expectedBytes": IMAGE.stat().st_size,
                       "expectedSha256": hashlib.sha256(IMAGE.read_bytes()).hexdigest()}
        self.input_evidence.append(observation)
        self.driver.execute_script("""
            const events = [], probe = {events, overflow: false};
            probe.listener = event => {
                if (events.length >= 48) { probe.overflow = true; return; }
                events.push({type: event.type, targetId: event.target?.id || null,
                    trusted: event.isTrusted,
                    message: String(event.message || event.reason || '').slice(0, 1000)});
            };
            probe.file = arguments[0]; probe.button = document.querySelector('#upload-source');
            for (const type of ['input', 'change']) probe.file.addEventListener(type, probe.listener, true);
            probe.button.addEventListener('click', probe.listener, true);
            for (const type of ['error', 'unhandledrejection']) window.addEventListener(type, probe.listener, true);
            window.__panelreplyNativeUploadProbe = probe;
        """, file_input)
        try:
            file_input.send_keys(str(IMAGE))
            self.text_contains("#source-selection-text", "complete.png")
            observation["selectedState"] = self.page_state()
            self.click("#upload-source")
            self.text_contains("#source-status", "Source image saved")
            saved = self.api("GET", "/api/panel-projects/" + project["id"])["project"]
            self.assertEqual(len(saved["sources"]), 1)
            observation["status"] = "OBSERVED"
            return saved["sources"][0]
        finally:
            try:
                observation.update(self.driver.execute_script("""
                    const probe = window.__panelreplyNativeUploadProbe;
                    for (const type of ['input', 'change']) probe.file.removeEventListener(type, probe.listener, true);
                    probe.button.removeEventListener('click', probe.listener, true);
                    for (const type of ['error', 'unhandledrejection']) window.removeEventListener(type, probe.listener, true);
                    delete window.__panelreplyNativeUploadProbe;
                    return {events: probe.events, overflow: probe.overflow};
                """))
                observation["finalState"] = self.page_state()
            except Exception as error:
                observation["observationError"] = str(error)[:1000]

    def download(self, project_id, extension):
        filename = f"panelreply-project-{project_id}.{extension}"
        target = Path.home() / "Downloads" / filename
        partial = target.with_name(filename + ".download")
        self.assertFalse(target.exists(), "A preexisting file cannot prove this UI download")
        self.assertFalse(partial.exists())
        expected = self.binary(f"/api/panel-projects/{project_id}/export.{extension}")
        observation = {"format": extension, "filename": filename, "status": "NOT_OBSERVED",
                       "trigger": "native WebDriver export button", "expectedBytes": len(expected),
                       "expectedSha256": hashlib.sha256(expected).hexdigest()}
        self.download_evidence.append(observation)
        self.click("#export-project-xlsx" if extension == "xlsx" else "#export-project")
        self.text_contains("#panel-export-status", "Saved " + extension.upper() + " prepared")
        deadline = time.monotonic() + 15
        while time.monotonic() < deadline:
            if target.is_file() and not target.is_symlink() and not partial.exists():
                actual = target.read_bytes()
                if actual == expected:
                    observation.update({"status": "OBSERVED", "bytes": len(actual),
                                        "sha256": hashlib.sha256(actual).hexdigest()})
                    # Only remove this method's UUID-named synthetic download.
                    target.unlink()
                    return actual
            time.sleep(0.1)
        self.fail("Native Safari UI download was not observed with the exact saved bytes: " + filename)


class SafariCallbackBrowserTests(SafariProductHarness):
    product_id = "callback"
    product_label = "PanelReply Callback"
    server_entry = "callback-server.cjs"
    home_path = "/"

    def test_intake_status_persistence_and_sign_out(self):
        self.login()
        product = self.api("GET", "/api/session")["product"]
        self.assertEqual(product["id"], "callback")
        self.assertTrue(product["capabilities"]["intake"])
        self.assertFalse(product["capabilities"]["panelProjects"])
        self.assert_denied(["/panels", "/dashboard", "/api/panel-projects", "/api/panel-ocr"])
        self.driver.get(self.origin + "/preview")
        for selector, value in [("#preview-name", LEAD["customerName"]), ("#preview-phone", LEAD["phone"]),
                                ("#preview-job", LEAD["job"]), ("#preview-zip", LEAD["zip"]),
                                ("#preview-callback", LEAD["callbackWindow"]),
                                ("#preview-work-date", LEAD["requestedWorkDate"])]:
            self.fill(selector, value)
        self.select("#preview-permission", "requested_callback")
        self.click('#request-form button[type="submit"]')
        self.click("#saved-request-link")
        self.assert_value("#lead-name", LEAD["customerName"])
        self.fill("#lead-notes", "Saved from actual Safari")
        self.select("#lead-status-select", "needs_review")
        self.click("#save-lead")
        self.text_contains("#lead-status", "Changes saved")
        self.driver.refresh()
        self.assert_value("#lead-notes", "Saved from actual Safari")
        self.assert_value("#lead-status-select", "needs_review")
        records = self.api("GET", "/api/leads")["leads"]
        self.assertEqual(len(records), 1)
        self.assertEqual(records[0]["customerName"], LEAD["customerName"])
        self.assertFalse(self.api("GET", "/api/assistant")["liveEnabled"])
        self.screenshot("callback-native-safari-intake.png")
        names = {item["name"] for item in self.driver.get_cookies()}
        self.assertIn("PanelReplyCallbackLocalSession", names)
        self.assertNotIn("PanelReplySpreadsheetLocalSession", names)
        self.click("#sign-out")
        self.wait.until(lambda driver: driver.current_url == self.origin + "/login")
        self.element("#sign-in")
        self.api("GET", "/api/session", status=401)
        self.assertEqual(self.driver.execute_script("return localStorage.length + sessionStorage.length"), 0)

    def test_schedule_reschedule_outcome_follow_up_and_cancel(self):
        self.login()
        lead = self.create_lead_fixture()
        self.open_lead(lead)
        self.task_time("2026-12-01T09:30")
        self.fill("#task-notes", "Native Safari callback plan")
        first = self.save_task(lead, 1)[0]
        self.assertEqual(first["dueAt"], "2026-12-01T14:30:00.000Z")
        self.assertEqual(first["timeZone"], "America/Detroit")
        self.task_action(first["id"], "Reschedule")
        self.task_time("2026-12-02T10:15")
        updated = self.save_task(lead, 1, first["id"], 2)
        self.assertEqual(updated["dueAt"], "2026-12-02T15:15:00.000Z")
        self.task_action(first["id"], "Record outcome")
        self.select("#task-outcome", "no_answer")
        self.fill("#task-notes", "Synthetic operator result, no call was made")
        completed = self.save_task(lead, 1, first["id"], 3)
        self.assertEqual((completed["status"], completed["outcome"]), ("completed", "no_answer"))
        self.select("#task-kind", "follow_up")
        self.task_time("2026-12-03T11:00")
        follow = next(item for item in self.save_task(lead, 2) if item["id"] != first["id"])
        self.assertEqual(follow["kind"], "follow_up")
        self.task_action(follow["id"], "Cancel task")
        self.fill("#task-notes", "Synthetic follow-up cancelled")
        cancelled = self.save_task(lead, 2, follow["id"], 2)
        self.assertEqual(cancelled["status"], "cancelled")
        type(self).stop_server()
        type(self).start_server()
        self.driver.refresh()
        self.assert_value("#lead-name", LEAD["customerName"])
        self.assertEqual({item["status"] for item in self.tasks(lead)}, {"completed", "cancelled"})
        self.click("#nav-schedule")
        self.select("#callback-queue-filter", "cancelled")
        self.text_contains("#callback-queue-list", "Synthetic follow-up cancelled")
        self.assert_navigation()
        self.screenshot("callback-native-safari-schedule.png")

    def test_contact_hold_and_keyboard_dirty_edit_guard(self):
        self.login()
        lead = self.create_lead_fixture()
        self.open_lead(lead)
        self.task_time("2026-12-04T09:00")
        zone = self.element("#task-time-zone")
        self.assertEqual(self.driver.execute_script("return arguments[0].labels[0].textContent", zone), "Time zone")
        zone.click()
        zone.send_keys(self.native.keys.TAB)
        notes = self.element("#task-notes")
        self.assertEqual(self.driver.switch_to.active_element, notes)
        notes.send_keys("Keep this native keyboard draft")
        self.click("#nav-schedule")
        self.element("#navigation-guard")
        self.click("#keep-editing")
        self.assert_value("#task-notes", "Keep this native keyboard draft")
        self.assertEqual(self.tasks(lead), [])
        task = self.save_task(lead, 1)[0]
        self.select("#lead-permission", "opted_out")
        self.select("#lead-status-select", "closed")
        self.click("#save-lead")
        self.text_contains("#lead-status", "Changes saved")
        self.text_contains("#lead-task-list", "Blocked")
        card = self.element(f'#lead-task-list > li[data-task-id="{task["id"]}"]')
        for label in ["Reschedule", "Record outcome"]:
            self.assertFalse(card.find_element("xpath", f'.//button[normalize-space()="{label}"]').is_enabled())
        self.assertFalse(self.element("#save-callback-task").is_enabled())
        saved = self.api("GET", "/api/leads/" + lead["id"])["lead"]
        self.assertTrue(saved["optedOut"])
        self.assertEqual(saved["status"], "closed")
        self.task_action(task["id"], "Cancel task")
        self.fill("#task-notes", "Cancelled because contact is blocked")
        self.assertEqual(self.save_task(lead, 1, task["id"], 2)["status"], "cancelled")
        self.driver.refresh()
        self.assert_value("#lead-permission", "opted_out")
        self.assertFalse(self.element("#save-callback-task").is_enabled())


class SafariSpreadsheetBrowserTests(SafariProductHarness):
    product_id = "spreadsheet"
    product_label = "PanelReply Spreadsheets"
    server_entry = "spreadsheet-server.cjs"
    home_path = "/panels"

    def test_manual_corrections_persist_and_native_downloads_match(self):
        from openpyxl import load_workbook

        self.login()
        saved = self.create_panel_ui("Synthetic native Safari export", blank_manufacturer=True)
        self.driver.refresh()
        self.assert_value('[aria-label="Manufacturer row 1"]', "")
        self.select('[aria-label="Review status row 1"]', "reviewed", expected="unreviewed")
        self.assert_value('[aria-label="Review status row 1"]', "unreviewed")
        self.fill('[aria-label="Manufacturer row 1"]', "=SYNTHETIC()")
        self.fill('[aria-label="Description row 1"]', 'Corrected, "quoted" Ω\nsecond line')
        self.fill('[aria-label="Quantity row 1"]', "7")
        self.select('[aria-label="Review status row 1"]', "reviewed")
        self.save_panel()
        self.driver.refresh()
        self.assert_value('[aria-label="Part number row 1"]', "000123")
        self.assert_value('[aria-label="Manufacturer row 1"]', "=SYNTHETIC()")
        self.assert_value('[aria-label="Review status row 1"]', "reviewed")
        csv_bytes = self.download(saved["id"], "csv")
        self.assertTrue(csv_bytes.startswith(b"\xef\xbb\xbf") and csv_bytes.endswith(b"\r\n"))
        rows = list(csv.reader(io.StringIO(csv_bytes.decode("utf-8-sig"), newline="")))
        self.assertEqual(rows[1], ["000123", "'=SYNTHETIC()", 'Corrected, "quoted" Ω\nsecond line', "7", "", "reviewed", ""])
        book = load_workbook(io.BytesIO(self.download(saved["id"], "xlsx")), data_only=False, keep_links=False)
        try:
            cells = list(book["Parts"][2])
            self.assertEqual([cell.value for cell in cells], ["000123", "=SYNTHETIC()", 'Corrected, "quoted" Ω\nsecond line', 7, "", "reviewed", ""])
            self.assertEqual([cell.data_type for cell in cells], ["s", "s", "s", "n", "s", "s", "s"])
            self.assertEqual(book["Parts"].freeze_panes, "A2")
        finally:
            book.close()
        self.assert_navigation()
        self.screenshot("spreadsheet-native-safari-corrections.png")

    def test_file_upload_source_links_and_unavailable_ocr(self):
        self.login()
        project = self.create_panel_ui("Synthetic native Safari source")
        source = self.upload_source(project)
        source_path = f'/api/panel-projects/{project["id"]}/sources/{source["id"]}'
        self.assertEqual(self.binary(source_path), IMAGE.read_bytes())
        self.select('[aria-label="Source image row 1"]', source["id"])
        self.fill('[aria-label="Description row 1"]', "Human checked against stored label")
        self.select('[aria-label="Review status row 1"]', "reviewed")
        self.save_panel()
        self.driver.refresh()
        self.assert_value('[aria-label="Source image row 1"]', source["id"])
        self.assert_value('[aria-label="Description row 1"]', "Human checked against stored label")
        self.click("#source-list [data-view]")
        self.wait.until(lambda driver: driver.execute_script(
            "const image = document.querySelector('#source-list img'); return !!image && image.complete && image.naturalWidth > 0;"))
        availability = self.api("GET", "/api/panel-ocr")
        self.assertIs(availability["available"], False)
        self.assertEqual(availability["reason"], "engine_unavailable")
        self.assertFalse(self.element("#source-list [data-ocr]").is_enabled())
        before = self.api("GET", "/api/panel-projects/" + project["id"])["project"]
        self.api("POST", source_path + "/ocr", {"version": before["version"]}, status=503)
        self.assertEqual(self.api("GET", "/api/panel-projects/" + project["id"])["project"], before)
        self.assertEqual(self.binary(source_path), IMAGE.read_bytes())
        self.assert_navigation()

    def test_bound_recovery_revokes_archived_sessions_and_credentials(self):
        self.login()
        project = self.create_panel_ui("Synthetic native Safari recovery")
        source = self.upload_source(project)
        source_path = f'/api/panel-projects/{project["id"]}/sources/{source["id"]}'
        before = self.api("GET", "/api/panel-projects/" + project["id"])["project"]
        source_bytes = self.binary(source_path)
        cookie = next(item for item in self.driver.get_cookies() if item["name"] == "PanelReplySpreadsheetLocalSession")
        original_dir = type(self).data_dir
        archive = Path(self.directory.name).resolve() / "spreadsheet.prbk"
        restored_dir = Path(self.directory.name).resolve() / "restored"
        type(self).stop_server()
        try:
            command(["scripts/workspace-backup.cjs", "create", "--data-dir", str(original_dir),
                     "--output", str(archive), "--product", "spreadsheet"], self.node_env, BACKUP_PASSPHRASE)
            restored = command(["scripts/workspace-backup.cjs", "restore", "--backup", str(archive),
                                "--data-dir", str(restored_dir), "--product", "spreadsheet"],
                               self.node_env, BACKUP_PASSPHRASE)
            self.assertIs(restored["sessionsRestored"], False)
            self.assertIs(restored["passwordResetRequired"], True)
            self.assertEqual(json.loads((restored_dir / "product-binding.json").read_text())["product"], "spreadsheet")
            self.assertEqual(restored_dir.stat().st_mode & 0o777, 0o700)
            type(self).data_dir = restored_dir
            type(self).start_server()
            # Readback checks the captured archived credential itself, even if
            # the page already redirected and cleared its own expired cookie.
            with self.assertRaises(HTTPError) as rejected:
                urlopen(Request(self.origin + "/api/session", headers={
                    "Cookie": cookie["name"] + "=" + cookie["value"]}), timeout=5)
            self.assertEqual(rejected.exception.code, 401)
            self.driver.get(self.origin + "/login")
            self.wait.until(lambda driver: driver.execute_script("return document.readyState") == "complete")
            self.fill("#username", self.username)
            self.fill("#password", FIXTURE_PASSWORD)
            self.click("#sign-in")
            self.element("#login-error")
            self.assertEqual(self.driver.current_url, self.origin + "/login")
            self.api("GET", "/api/session", status=401)
            command(["scripts/workspace-reset-password.cjs", "--data-dir", str(restored_dir),
                     "--username", self.username], self.node_env, FIXTURE_PASSWORD)
            self.login()
            self.open_panel(project["id"])
            self.assert_value("#project-name", "Synthetic native Safari recovery")
            self.assertEqual(self.api("GET", "/api/panel-projects/" + project["id"])["project"], before)
            self.assertEqual(self.binary(source_path), source_bytes)
            self.assert_denied(["/api/leads", "/api/profile", "/preview", "/dashboard"])
            self.assert_navigation()
        finally:
            type(self).stop_server()
            type(self).data_dir = original_dir
            type(self).start_server()
