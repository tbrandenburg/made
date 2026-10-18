"""Secret-safe service observations, never prompts, URLs, credentials or raw logs."""

import json
import re
import time
from pathlib import Path

import httpx

from service import ARTIFACTS, ROOT, client, owned


def symbols(value: object) -> dict:
    if not isinstance(value, dict):
        return {}
    return {
        key: item
        for key, item in value.items()
        if key in {"name", "code", "type", "status", "statusCode", "attempt"}
        and (
            isinstance(item, (int, bool))
            or isinstance(item, str)
            and re.fullmatch(r"[A-Za-z0-9_.-]{1,80}", item)
        )
    }


def collect(session: str | None, destination: Path) -> None:
    owned()
    report: dict[str, object] = {
        "observed_monotonic": time.monotonic(),
        "session": session,
    }
    try:
        with client() as connection:
            paths = {"info": "/api/info", "active": "/api/session/active"}
            if session:
                paths.update(
                    {
                        "metadata": f"/api/session/{session}",
                        "messages": f"/api/session/{session}/message?limit=10&order=desc",
                        "inbox": f"/api/session/{session}/inbox",
                        "permissions": f"/api/session/{session}/permission",
                    }
                )
            for name, path in paths.items():
                try:
                    response = connection.get(path, timeout=3)
                    report[f"{name}_http"] = response.status_code
                    if response.status_code != 200:
                        continue
                    body = response.json()
                    data = body.get("data", body)
                    if name == "active":
                        report["session_active"] = (
                            symbols(data.get(session, {})) if session else len(data)
                        )
                    elif name == "metadata":
                        report["session_outcome"] = data.get("outcome")
                        report["session_time"] = data.get("time")
                    elif name == "messages":
                        report["recent_records"] = [
                            {
                                "id": item.get("id"),
                                "type": item.get("type"),
                                "time": item.get("time"),
                                "error": symbols(item.get("error")),
                                "retry": symbols(item.get("retry")),
                                "parts": [
                                    {
                                        "type": part.get("type"),
                                        "name": part.get("name"),
                                        "state": symbols(part.get("state")),
                                        "text_bytes": len(
                                            part.get("text", "").encode()
                                        ),
                                    }
                                    for part in item.get("content", [])
                                ],
                            }
                            for item in data
                        ]
                    elif name in {"permissions", "inbox"}:
                        report[f"{name}_count"] = len(data)
                    elif name == "info":
                        report["service"] = {
                            key: data[key]
                            for key in ("version", "pid", "ready")
                            if key in data
                        }
                except (httpx.HTTPError, ValueError, TypeError, AttributeError):
                    report[f"{name}_observation"] = "unavailable"
    except (OSError, ValueError, httpx.HTTPError):
        report["service_observation"] = "unavailable"
    log = ROOT / "data/opencode/log/opencode.log"
    if log.exists():
        with log.open("rb") as stream:
            stream.seek(max(0, log.stat().st_size - 256 * 1024))
            text = stream.read().decode(errors="replace")
        report["log_error_classes"] = sorted(
            set(re.findall(r"\b[A-Z][A-Za-z]+(?:Error|Exception)\b", text))
        )
        report["log_indicator_counts_not_causal_proof"] = {
            pattern: len(re.findall(pattern, text, re.I))
            for pattern in [
                "rate.limit",
                "retry",
                "timeout",
                "unauthoriz",
                "ECONN",
                "session.busy",
            ]
        }
    ARTIFACTS.mkdir(parents=True, exist_ok=True, mode=0o700)
    destination.write_text(json.dumps(report, indent=2))
