"""Host orchestrator: disposable Compose project, free ports, no host OpenCode."""

import argparse
import json
import os
from pathlib import Path
import socket
import subprocess
import time
import urllib.error
import urllib.request
import uuid

REPOSITORY = Path(__file__).resolve().parents[2]
COMPOSE = REPOSITORY / "docker/docker-compose.opencode-v2.yml"


def run(
    arguments: list[str],
    environment: dict[str, str],
    timeout: int = 600,
    capture: bool = False,
) -> str:
    result = subprocess.run(
        arguments,
        cwd=REPOSITORY,
        env=environment,
        check=True,
        timeout=timeout,
        text=True,
        stdout=subprocess.PIPE if capture else None,
    )
    return result.stdout or ""


def free_port() -> int:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    if port in {3000, 5173}:
        return free_port()
    return port


def state(path: Path) -> tuple[dict, dict[str, str], list[str]]:
    data = json.loads(path.read_text())
    if not data["project"].startswith("made-779-"):
        raise RuntimeError("Refusing non-acceptance Compose project")
    environment = {
        **os.environ,
        "MADE_ACCEPTANCE_API_PORT": str(data["api"]),
        "MADE_ACCEPTANCE_WEB_PORT": str(data["web"]),
        "MADE_ACCEPTANCE_OPENCODE_VERSION": data["version"],
        "MADE_ACCEPTANCE_MODEL": data.get("model", "opencode/big-pickle"),
    }
    compose = ["docker", "compose", "-p", data["project"], "-f", str(COMPOSE)]
    return data, environment, compose


def ready(url: str) -> None:
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    for _ in range(90):
        try:
            with opener.open(url, timeout=2) as response:
                if response.status == 200:
                    return
        except (urllib.error.URLError, TimeoutError, ConnectionError):
            time.sleep(1)
    raise RuntimeError(f"Owned stack did not become ready: {url}")


def action(path: Path, name: str, control: str | None = None) -> None:
    data, environment, compose = state(path)
    execute = [*compose, "exec", "-T", "pybackend", ".venv/bin/python"]
    if name == "up":
        for port in (data["api"], data["web"]):
            if port in {3000, 5173}:
                raise RuntimeError("Standard development ports are forbidden")
            with socket.socket() as probe:
                probe.bind(("127.0.0.1", port))
        if run([*compose, "ps", "-q"], environment, capture=True).strip():
            raise RuntimeError("Refusing to reuse running acceptance resources")
        run([*compose, "up", "--build", "-d"], environment, timeout=1200)
        ready(f"http://127.0.0.1:{data['web']}/api/settings")
        ready(f"http://127.0.0.1:{data['web']}/")
        print(json.dumps(data), flush=True)
    elif name == "smoke":
        run(
            [*execute, "/acceptance-tools/scenario.py", "prepare", "--smoke"],
            environment,
        )
        run(
            [*execute, "/acceptance-tools/benchmark.py", "--transport-only"],
            environment,
        )
        run(
            [
                "npx",
                "--no-install",
                "playwright",
                "test",
                "--config",
                "tests/acceptance/playwright.config.ts",
                "--grep",
                "owned stack browser smoke",
            ],
            {**environment, "MADE_ACCEPTANCE_STATE": str(path.resolve())},
        )
    elif name == "prepare":
        run(
            [
                *compose,
                "exec",
                "-T",
                "pybackend",
                ".venv/bin/pytest",
                "-q",
                "tests/integration/test_opencode_v2_acceptance.py",
            ],
            environment,
        )
    elif name == "benchmark":
        run([*execute, "/acceptance-tools/benchmark.py"], environment)
    elif name == "browser":
        run(
            [
                "npx",
                "--no-install",
                "playwright",
                "test",
                "--config",
                "tests/acceptance/playwright.config.ts",
            ],
            {**environment, "MADE_ACCEPTANCE_STATE": str(path.resolve())},
        )
    elif name == "control":
        if control in {"stop", "start", "restart"}:
            run([*execute, "/acceptance-tools/service.py", control], environment)
            return
        if control in {"manifest", "resume", "snapshot"}:
            print(
                run(
                    [*execute, "/acceptance-tools/scenario.py", control],
                    environment,
                    capture=True,
                ),
                end="",
            )
            return
        raise RuntimeError("Unknown control action")
    elif name == "down":
        output = path.with_suffix(".artifacts")
        output.mkdir(parents=True, exist_ok=True, mode=0o700)
        containers = run(
            [*compose, "ps", "-aq", "pybackend"], environment, capture=True
        ).split()
        try:
            if len(containers) == 1:
                copied = subprocess.run(
                    [
                        "docker",
                        "cp",
                        f"{containers[0]}:/opencode-home/artifacts/.",
                        str(output),
                    ],
                    cwd=REPOSITORY,
                    env=environment,
                    capture_output=True,
                    text=True,
                    timeout=30,
                    check=False,
                )
                if copied.returncode:
                    # A boot failure can precede artifact initialization. Do
                    # not mask that failure or prevent teardown verification.
                    print(
                        f"Artifact collection unavailable (exit {copied.returncode}); cleanup continues",
                        flush=True,
                    )
        finally:
            run([*compose, "down", "-v", "--remove-orphans"], environment)
        remaining = run(
            [
                "docker",
                "ps",
                "-aq",
                "--filter",
                f"label=com.docker.compose.project={data['project']}",
            ],
            environment,
            capture=True,
        )
        if remaining.strip():
            raise RuntimeError("Owned acceptance containers remain after teardown")
        for resource in ("network", "volume"):
            remaining = run(
                [
                    "docker",
                    resource,
                    "ls",
                    "-q",
                    "--filter",
                    f"label=com.docker.compose.project={data['project']}",
                ],
                environment,
                capture=True,
            )
            if remaining.strip():
                raise RuntimeError(
                    f"Owned acceptance {resource} remains after teardown"
                )
        print(f"Teardown verified: {data['project']}; synthetic evidence: {output}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--state",
        required=True,
        type=Path,
        help="new private JSON file outside the repository; contains no credentials",
    )
    parser.add_argument(
        "action",
        choices=[
            "run",
            "up",
            "smoke",
            "prepare",
            "benchmark",
            "browser",
            "control",
            "down",
        ],
    )
    parser.add_argument("control", nargs="?")
    options = parser.parse_args()
    if options.action in {"run", "up"}:
        if options.state.exists():
            raise RuntimeError("Use a new state filename for each acceptance run")
        options.state.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        api = free_port()
        web = free_port()
        while web == api:
            web = free_port()
        options.state.write_text(
            json.dumps(
                {
                    "project": f"made-779-{uuid.uuid4().hex[:12]}",
                    "api": api,
                    "web": web,
                    "version": os.environ.get(
                        "MADE_ACCEPTANCE_OPENCODE_VERSION", "2.0.18"
                    ),
                    "model": os.environ.get(
                        "MADE_ACCEPTANCE_MODEL", "opencode/big-pickle"
                    ),
                }
            )
        )
        options.state.chmod(0o600)
    if options.action != "run":
        action(options.state, options.action, options.control)
    else:
        try:
            for phase in ("up", "prepare", "benchmark", "browser"):
                action(options.state, phase)
        finally:
            action(options.state, "down")
