"""Explicit browser selection for isolated CI checks. No silent fallback."""

import os


def launch_browser(playwright):
    engine = os.environ.get("PANELREPLY_BROWSER", "chromium")
    if engine not in {"chromium", "firefox", "webkit"}:
        raise ValueError("PANELREPLY_BROWSER must be chromium, firefox or webkit")
    executable = os.environ.get("PANELREPLY_CHROMIUM_EXECUTABLE")
    if executable and engine != "chromium":
        raise ValueError("The Chromium executable override cannot select another engine")
    browser = getattr(playwright, engine).launch(
        headless=True, **({"executable_path": executable} if executable else {})
    )
    print(f"PANELREPLY_BROWSER_ENGINE={engine};VERSION={browser.version}", flush=True)
    return browser
