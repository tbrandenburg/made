"""Real provider CLI calls with bounded execution and retained failure evidence."""

import json
import os
from pathlib import Path
import subprocess
import time
import uuid

from diagnostics import collect
from service import ARTIFACTS, owned

REPOSITORY = Path("/workspace/repoA")
CLI_TIMEOUT = 240


def cli(prompt: str, session: str | None = None) -> str:
    owned()
    arguments = [
        "opencode",
        "run",
        "--format",
        "json",
        "--auto",
        "-m",
        os.environ.get("MADE_ACCEPTANCE_MODEL", "opencode/big-pickle"),
    ]
    if session:
        arguments.extend(["-s", session])
    ARTIFACTS.mkdir(parents=True, exist_ok=True, mode=0o700)
    name = f"cli-{uuid.uuid4().hex}"
    stdout = ARTIFACTS / f"{name}.stdout"
    stderr = ARTIFACTS / f"{name}.stderr"
    started = time.monotonic()
    collect(session, ARTIFACTS / f"{name}.before.json")
    try:
        with stdout.open("w") as output, stderr.open("w") as errors:
            result = subprocess.run(
                [*arguments, prompt],
                cwd=REPOSITORY,
                # Node execFile -> Python -> compose exec leaves stdin open.
                # V2 run reads stdin too, even with an argv prompt; send EOF.
                stdin=subprocess.DEVNULL,
                stdout=output,
                stderr=errors,
                text=True,
                timeout=CLI_TIMEOUT,
            )
    except subprocess.TimeoutExpired:
        collect(session, ARTIFACTS / f"{name}.timeout.json")
        raise RuntimeError(
            f"Real provider CLI exceeded {CLI_TIMEOUT}s; partial output and sanitized service state saved as {name}"
        ) from None
    events = [
        json.loads(line)
        for line in stdout.read_text().splitlines()
        if line.startswith("{")
    ]
    sessions = {event["sessionID"] for event in events if event.get("sessionID")}
    observed = session or (next(iter(sessions)) if len(sessions) == 1 else None)
    collect(observed, ARTIFACTS / f"{name}.after.json")
    (ARTIFACTS / f"{name}.result.json").write_text(
        json.dumps(
            {
                "elapsed_seconds": round(time.monotonic() - started, 3),
                "returncode": result.returncode,
                "event_types": [event.get("type") for event in events],
                "session": observed,
            }
        )
    )
    if result.returncode or any(event.get("type") == "error" for event in events):
        raise RuntimeError(f"Real provider CLI failed; inspect owned {name} artifacts")
    if len(sessions) != 1 or session and sessions != {session}:
        raise RuntimeError(
            f"Real CLI did not return the expected single session; inspect {name}"
        )
    return sessions.pop()
