"""Explicit browser selection for isolated CI checks. No silent fallback."""

import os


_launched_browsers = []


def browser_evidence():
    """Return observed versions only; configured but unlaunched browsers are absent."""
    return [dict(item) for item in _launched_browsers]


def launch_browser(playwright):
    engine = os.environ.get("PANELREPLY_BROWSER", "chromium")
    if engine not in {"chromium", "firefox", "webkit"}:
        raise ValueError("PANELREPLY_BROWSER must be chromium, firefox or webkit")
    executable = os.environ.get("PANELREPLY_CHROMIUM_EXECUTABLE")
    channel = os.environ.get("PANELREPLY_BROWSER_CHANNEL")
    if executable and engine != "chromium":
        raise ValueError("The Chromium executable override cannot select another engine")
    if channel and (engine != "chromium" or channel not in {"chrome", "msedge"}):
        raise ValueError("A browser channel must be chrome or msedge with Chromium")
    if channel and executable:
        raise ValueError("Select a browser channel or an executable, never both")
    options = {"headless": True}
    if executable:
        options["executable_path"] = executable
    if channel:
        options["channel"] = channel
    browser = getattr(playwright, engine).launch(
        **options
    )
    variant = channel or ("explicit-executable" if executable else "bundled")
    observed = {"engine": engine, "channel": variant,
                "version": browser.version,
                "executableOverride": bool(executable),
                "executablePath": executable}
    _launched_browsers.append(observed)
    print(f"PANELREPLY_BROWSER_ENGINE={engine};CHANNEL={variant};VERSION={browser.version}", flush=True)
    return browser
