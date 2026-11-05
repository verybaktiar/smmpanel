"""
Standalone Proxy Parser — parse any proxy format into dict.
Used for Camoufox/Playwright browser automation.

Usage:
    from proxy.parser import parse_proxy

    proxy = parse_proxy("http://user:pass@host:port")
    proxy = parse_proxy("socks5://host:port")
    proxy = parse_proxy("host:port:user:pass")
"""

import re


def parse_proxy(proxy_str):
    """Parse any proxy format into Camoufox/Playwright proxy dict."""
    if not proxy_str:
        return None
    raw = proxy_str.strip()

    # URL format: http://user:pass@host:port or socks5://host:port
    url_match = re.match(
        r'^(socks[45]?|https?|http)://(?:([^:@]+):([^@]+)@)?([^:]+):(\d+)$',
        raw, re.I
    )
    if url_match:
        proto, user, password, host, port = url_match.groups()
        proxy = {"server": f"{proto}://{host}:{port}"}
        if user:
            proxy["username"] = user
        if password:
            proxy["password"] = password
        return proxy

    # Malformed URL: http://host:port:user:pass
    bad_url = re.match(
        r'^(https?|socks[45]?)://([^:]+):(\d+):([^:]+):(.+)$',
        raw, re.I
    )
    if bad_url:
        proto, host, port, user, password = bad_url.groups()
        return {"server": f"http://{host}:{port}", "username": user, "password": password}

    # Plain: host:port:user:pass
    parts = raw.split(":")
    if len(parts) == 4 and parts[1].isdigit():
        host, port, user, password = parts
        return {"server": f"http://{host}:{port}", "username": user, "password": password}

    # Plain: host:port
    if len(parts) == 2 and parts[1].isdigit():
        return {"server": f"http://{parts[0]}:{parts[1]}"}

    return None


def test_proxy(proxy_str):
    """Test proxy by launching Camoufox and checking IP."""
    import json
    import time

    proxy = parse_proxy(proxy_str)
    if not proxy:
        return {"ok": False, "error": "Invalid proxy format"}

    try:
        from camoufox.sync_api import Camoufox
    except ImportError:
        try:
            from camoufox import Camoufox
        except ImportError:
            return {"ok": False, "error": "Camoufox not installed"}

    result = {"ok": False, "server": proxy.get("server")}
    try:
        t0 = time.time()
        with Camoufox(headless=True, proxy=proxy, humanize=False) as browser:
            context = getattr(browser, "context", None) or browser
            page = context.new_page()
            page.goto("https://api.ipify.org?format=json", wait_until="domcontentloaded", timeout=20000)
            body = page.locator("body").inner_text(timeout=5000)
            info = json.loads(body)
            result["ok"] = True
            result["ip"] = info.get("ip")
            result["latency"] = round((time.time() - t0) * 1000)
    except Exception as e:
        result["error"] = str(e)[:300]

    return result


if __name__ == "__main__":
    import sys
    if len(sys.argv) < 2:
        print("Usage: python parser.py <proxy-string>")
        print("Examples:")
        print("  python parser.py http://user:pass@host:port")
        print("  python parser.py socks5://host:port")
        print("  python parser.py host:port:user:pass")
        sys.exit(1)

    result = test_proxy(sys.argv[1])
    print(json.dumps(result, indent=2))
