"""Lifecycle operations restricted to this disposable acceptance container."""

import json
import os
from pathlib import Path
import socket
import subprocess
import sys

import httpx

ROOT = Path("/opencode-home")
ARTIFACTS = ROOT / "artifacts"


def owned() -> None:
    if os.environ.get("MADE_OPENCODE_V2_ACCEPTANCE") != "1":
        raise RuntimeError("Acceptance container opt-in is required")
    for variable in ("HOME", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME"):
        if not Path(os.environ[variable]).is_relative_to(ROOT):
            raise RuntimeError("Refusing lifecycle operation outside owned HOME/XDG")


def command(*arguments: str) -> str:
    result = subprocess.run(
        ["opencode", *arguments], capture_output=True, text=True, timeout=30
    )
    if result.returncode:
        raise RuntimeError(f"Owned OpenCode command failed: {arguments[0]}")
    return result.stdout.strip()


def client() -> httpx.Client:
    owned()
    registration = json.loads((ROOT / "state/opencode/service.json").read_text())
    # Never emit registration values, headers, or upstream errors.
    return httpx.Client(
        base_url=registration["url"],
        auth=("opencode", registration["password"]),
        trust_env=False,
        follow_redirects=False,
        timeout=30,
    )


def lifecycle(action: str) -> None:
    owned()
    if action not in {"start", "restart", "stop"}:
        raise RuntimeError("Unknown owned lifecycle action")
    if action == "stop":
        with client() as connection:
            command("service", action)
            try:
                connection.get("/api/info")
            except httpx.TransportError:
                return
        raise RuntimeError("Owned service still answers after stop")
    previous = None
    if action == "restart":
        previous = json.loads((ROOT / "state/opencode/service.json").read_text())
    # 2.0.18 retains endpoint/password on plain restart. Select and check a
    # new free port, avoiding old TIME_WAIT sockets too. Setting it stops only
    # this container's isolated service through its supported CLI.
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    if port in {3000, 5173}:
        raise RuntimeError("Refusing a standard development port")
    command("service", "set", "port", str(port))
    command("service", "start")
    if previous:
        replacement = json.loads((ROOT / "state/opencode/service.json").read_text())
        if (previous["url"], previous["password"]) == (
            replacement["url"],
            replacement["password"],
        ):
            raise RuntimeError(
                "Owned replacement did not rotate discovery credentials/URL"
            )
    with client() as connection:
        response = connection.get("/api/info")
        if response.status_code != 200:
            raise RuntimeError("Owned service failed readiness")


if __name__ == "__main__":
    owned()
    action = sys.argv[1]
    if action != "boot":
        lifecycle(action)
        print(f"Owned service {action} verified")
        sys.exit(0)
    ARTIFACTS.mkdir(parents=True, exist_ok=True, mode=0o700)
    for directory in ("config", "data", "state", "cache"):
        (ROOT / directory).mkdir(exist_ok=True)
    with socket.socket() as probe:
        probe.bind(("0.0.0.0", 13079))
    # The managed service requests an OS-assigned port, not a shared fixed port.
    lifecycle("start")
    os.execv(
        "/app/.venv/bin/uvicorn",
        ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "13079"],
    )
