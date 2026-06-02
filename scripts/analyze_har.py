#!/usr/bin/env python3
"""HAR file performance analyzer - identifies loading bottlenecks by category."""

import json
import sys
from pathlib import Path
from collections import defaultdict

CRITICAL_MS = 3000
HIGH_MS = 1000
MEDIUM_MS = 300

def severity(duration_ms: float) -> str:
    if duration_ms >= CRITICAL_MS:
        return "CRITICAL"
    if duration_ms >= HIGH_MS:
        return "HIGH"
    if duration_ms >= MEDIUM_MS:
        return "MEDIUM"
    return "LOW"


def classify_entry(entry: dict) -> dict:
    req = entry.get("request", {})
    resp = entry.get("response", {})
    timings = entry.get("timings", {})
    
    url = req.get("url", "")
    method = req.get("method", "")
    status = resp.get("status", 0)
    mime = resp.get("content", {}).get("mimeType", "")
    total_ms = entry.get("time", 0)
    
    # Blocking time = wait + send (before first byte)
    blocked = timings.get("blocked", 0) or 0
    dns = timings.get("dns", 0) or 0
    connect = timings.get("connect", 0) or 0
    ssl = timings.get("ssl", 0) or 0
    send = timings.get("send", 0) or 0
    wait = timings.get("wait", 0) or 0  # TTFB
    receive = timings.get("receive", 0) or 0

    # Determine resource type
    if "/api/" in url or method in ("POST", "PUT", "PATCH", "DELETE"):
        rtype = "api"
    elif any(url.endswith(ext) for ext in (".js", ".mjs", ".ts")):
        rtype = "script"
    elif any(url.endswith(ext) for ext in (".css",)):
        rtype = "style"
    elif any(url.endswith(ext) for ext in (".png", ".jpg", ".jpeg", ".svg", ".ico", ".webp")):
        rtype = "image"
    elif "font" in mime or any(url.endswith(ext) for ext in (".woff", ".woff2", ".ttf")):
        rtype = "font"
    elif "html" in mime or url.endswith(".html") or url.endswith("/"):
        rtype = "document"
    else:
        rtype = "other"

    # Identify session-picker related
    tags = []
    url_lower = url.lower()
    if any(k in url_lower for k in ("session", "picker", "workspace", "project")):
        tags.append("session-picker")
    if wait > 500:
        tags.append("high-ttfb")
    if blocked > 200:
        tags.append("blocked")
    if total_ms >= CRITICAL_MS:
        tags.append("render-blocking-candidate")

    return {
        "url": url,
        "method": method,
        "status": status,
        "type": rtype,
        "total_ms": round(total_ms, 1),
        "blocked_ms": round(blocked, 1),
        "dns_ms": round(dns, 1),
        "connect_ms": round(connect, 1),
        "ssl_ms": round(ssl, 1),
        "send_ms": round(send, 1),
        "wait_ms": round(wait, 1),
        "receive_ms": round(receive, 1),
        "severity": severity(total_ms),
        "tags": tags,
    }


def shorten_url(url: str, max_len: int = 80) -> str:
    if len(url) <= max_len:
        return url
    return url[:40] + "…" + url[-(max_len - 41):]


def print_table(entries: list[dict], title: str, limit: int = 20) -> None:
    if not entries:
        return
    print(f"\n{'=' * 100}")
    print(f"  {title}  (top {min(limit, len(entries))} of {len(entries)})")
    print(f"{'=' * 100}")
    print(f"{'SEV':<10} {'TOTAL':>8} {'WAIT':>8} {'BLOCKED':>8} {'TYPE':<10} {'ST':>4}  {'URL'}")
    print("-" * 100)
    for e in sorted(entries, key=lambda x: -x["total_ms"])[:limit]:
        tags = " [" + ",".join(e["tags"]) + "]" if e["tags"] else ""
        print(
            f"{e['severity']:<10} {e['total_ms']:>7.0f}ms {e['wait_ms']:>7.0f}ms "
            f"{e['blocked_ms']:>7.0f}ms {e['type']:<10} {e['status']:>4}  "
            f"{shorten_url(e['url'])}{tags}"
        )


def main(har_path: str) -> None:
    path = Path(har_path)
    print(f"Loading {path.name} ({path.stat().st_size / 1024 / 1024:.1f} MB)…")

    with open(path, encoding="utf-8") as f:
        har = json.load(f)

    entries_raw = har.get("log", {}).get("entries", [])
    print(f"Entries: {len(entries_raw)}")

    entries = [classify_entry(e) for e in entries_raw]

    # Global stats
    total_time_ms = sum(e["total_ms"] for e in entries)
    by_severity = defaultdict(list)
    by_type = defaultdict(list)
    for e in entries:
        by_severity[e["severity"]].append(e)
        by_type[e["type"]].append(e)

    print(f"\n{'=' * 100}")
    print("  SUMMARY")
    print(f"{'=' * 100}")
    print(f"  Total entries        : {len(entries)}")
    print(f"  Total transfer time  : {total_time_ms / 1000:.1f}s (sum of all request durations)")

    for sev in ("CRITICAL", "HIGH", "MEDIUM", "LOW"):
        grp = by_severity[sev]
        if grp:
            t = sum(e["total_ms"] for e in grp)
            print(f"  {sev:<10}: {len(grp):>4} requests  — {t / 1000:.1f}s total")

    print(f"\n  By type:")
    for rtype, grp in sorted(by_type.items(), key=lambda x: -sum(e["total_ms"] for e in x[1])):
        t = sum(e["total_ms"] for e in grp)
        print(f"    {rtype:<12}: {len(grp):>4} requests  — {t / 1000:.1f}s total")

    # Session picker analysis
    session_entries = [e for e in entries if "session-picker" in e.get("tags", [])]
    if session_entries:
        print_table(session_entries, "SESSION PICKER — All Requests", limit=30)

    # Critical issues
    print_table(by_severity["CRITICAL"], "CRITICAL (>= 3s)", limit=20)
    print_table(by_severity["HIGH"], "HIGH (1s–3s)", limit=20)

    # High TTFB (server-side bottlenecks)
    high_ttfb = [e for e in entries if e["wait_ms"] >= 500]
    print_table(high_ttfb, "HIGH SERVER WAIT / TTFB (>= 500ms)", limit=20)

    # Heavily blocked
    blocked = [e for e in entries if e["blocked_ms"] >= 100]
    print_table(blocked, "HEAVILY BLOCKED (>= 100ms block time)", limit=20)

    # API performance
    api_slow = [e for e in entries if e["type"] == "api" and e["total_ms"] >= MEDIUM_MS]
    print_table(api_slow, "SLOW API CALLS (>= 300ms)", limit=30)

    # Categorized recommendations
    print(f"\n{'=' * 100}")
    print("  PERFORMANCE BOTTLENECK ANALYSIS")
    print(f"{'=' * 100}")

    categories: dict[str, list[str]] = {"CRITICAL": [], "HIGH": [], "MEDIUM": [], "LOW": []}

    # Analyze each slow entry
    crit_apis = [e for e in entries if e["type"] == "api" and e["total_ms"] >= CRITICAL_MS]
    if crit_apis:
        categories["CRITICAL"].append(
            f"{len(crit_apis)} API endpoint(s) take >= 3s — likely synchronous DB queries or missing indexes"
        )
        for e in sorted(crit_apis, key=lambda x: -x["total_ms"])[:5]:
            categories["CRITICAL"].append(f"  → {e['method']} {shorten_url(e['url'], 70)}  ({e['total_ms']:.0f}ms, TTFB={e['wait_ms']:.0f}ms)")

    if session_entries:
        slow_session = [e for e in session_entries if e["total_ms"] >= HIGH_MS]
        if slow_session:
            worst = max(slow_session, key=lambda x: x["total_ms"])
            categories["CRITICAL"].append(
                f"Session picker has {len(slow_session)} slow request(s) — worst: {worst['total_ms']:.0f}ms "
                f"({shorten_url(worst['url'], 60)})"
            )

    high_ttfb_apis = [e for e in entries if e["type"] == "api" and e["wait_ms"] >= 1000]
    if high_ttfb_apis:
        categories["HIGH"].append(
            f"{len(high_ttfb_apis)} API call(s) with TTFB >= 1s — server processing too slow, consider caching"
        )

    blocking_scripts = [e for e in entries if e["type"] == "script" and e["total_ms"] >= HIGH_MS]
    if blocking_scripts:
        categories["HIGH"].append(
            f"{len(blocking_scripts)} script(s) >= 1s load time — consider code-splitting or lazy loading"
        )

    large_docs = [e for e in entries if e["type"] == "document" and e["total_ms"] >= HIGH_MS]
    if large_docs:
        categories["HIGH"].append(f"{len(large_docs)} document response(s) >= 1s — SSR or initial HTML too slow")

    medium_apis = [e for e in entries if e["type"] == "api" and MEDIUM_MS <= e["total_ms"] < HIGH_MS]
    if medium_apis:
        categories["MEDIUM"].append(
            f"{len(medium_apis)} API call(s) between 300ms–1s — review N+1 queries, add pagination"
        )

    many_requests = len(entries)
    if many_requests > 100:
        categories["MEDIUM"].append(
            f"High total request count ({many_requests}) — consider request bundling or HTTP/2 push"
        )

    blocked_entries = [e for e in entries if e["blocked_ms"] >= 200]
    if blocked_entries:
        categories["MEDIUM"].append(
            f"{len(blocked_entries)} request(s) blocked >= 200ms — likely browser connection limit or waterfall"
        )

    low_prio = [e for e in entries if e["type"] in ("image", "font") and e["total_ms"] >= MEDIUM_MS]
    if low_prio:
        categories["LOW"].append(
            f"{len(low_prio)} image/font resource(s) >= 300ms — consider preloading or CDN"
        )

    for sev in ("CRITICAL", "HIGH", "MEDIUM", "LOW"):
        items = categories[sev]
        if items:
            print(f"\n[{sev}]")
            for item in items:
                print(f"  • {item}")

    print(f"\n{'=' * 100}\n")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python analyze_har.py <path-to.har>")
        sys.exit(1)
    main(sys.argv[1])
