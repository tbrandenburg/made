"""Run system suites only after owned services answer GET readiness probes."""

import argparse
from contextlib import ExitStack
import math
import os
from pathlib import Path
import re
import signal
import socket
import ssl
import subprocess
import sys
import tempfile
import time
from types import FrameType
from typing import BinaryIO
from urllib.error import URLError
from urllib.request import HTTPSHandler, ProxyHandler, build_opener


def check_ports(ports: tuple[int, int]) -> None:
    """Refuse conflicts before launching either service; never evict listeners."""
    if ports[0] == ports[1] or any(not 1 <= port <= 65535 for port in ports):
        raise ValueError("Service ports must be distinct and between 1 and 65535")
    with ExitStack() as stack:
        for port in ports:
            listener = stack.enter_context(socket.socket())
            try:
                listener.bind(("127.0.0.1", port))
            except OSError as error:
                raise RuntimeError(
                    f"Port {port} unavailable; no services started"
                ) from error


class Runner:
    def __init__(self, env: dict[str, str]) -> None:
        self.env = env
        self.processes: list[subprocess.Popen[bytes]] = []
        self.logs: dict[str, BinaryIO] = {}

    def start(
        self, command: list[str], cwd: Path, name: str | None = None
    ) -> subprocess.Popen[bytes]:
        log = tempfile.TemporaryFile() if name else None
        if name and log:
            self.logs[name] = log
        process = subprocess.Popen(
            command,
            cwd=cwd,
            env=self.env,
            stdout=log,
            stderr=subprocess.STDOUT if log else None,
            start_new_session=True,
        )
        self.processes.append(process)
        return process

    def wait_ready(self, urls: list[str], timeout: float) -> None:
        # Only the loopback Vite development certificate is self-signed.
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
        context.check_hostname = False
        context.verify_mode = ssl.CERT_NONE
        opener = build_opener(ProxyHandler({}), HTTPSHandler(context=context))
        deadline = time.monotonic() + timeout
        pending = set(urls)
        while pending:
            for process in self.processes:
                if process.poll() is not None:
                    raise RuntimeError(
                        f"Service exited before readiness (exit {process.returncode})"
                    )
            for url in tuple(pending):
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise RuntimeError(
                        f"Readiness timed out waiting for GET {', '.join(sorted(pending))}"
                    )
                try:
                    with opener.open(url, timeout=min(1, remaining)) as response:
                        if 200 <= response.status < 300:
                            pending.remove(url)
                except (OSError, URLError):
                    # Connection failures and HTTP errors are not readiness.
                    continue
            if pending:
                time.sleep(min(0.1, max(0, deadline - time.monotonic())))

    def diagnostics(self) -> None:
        secrets = [
            value
            for key, value in self.env.items()
            if re.search(r"secret|token|pass|credential|key|auth|cookie", key, re.I)
            and value
        ]
        for name, log in self.logs.items():
            log.seek(0, os.SEEK_END)
            log.seek(max(0, log.tell() - 16384))
            output = log.read().decode(errors="replace")
            for secret in secrets:
                output = output.replace(secret, "[REDACTED]")
            print(f"--- {name} startup output ---\n{output}", file=sys.stderr)

    def close(self) -> None:
        # A launcher may exit before its descendants; signal its captured group anyway.
        for process in reversed(self.processes):
            signal_group(process.pid, signal.SIGTERM)
        deadline = time.monotonic() + 3
        while time.monotonic() < deadline:
            for process in self.processes:
                process.poll()
            if not any(signal_group(process.pid, 0) for process in self.processes):
                break
            time.sleep(0.05)
        for process in self.processes:
            signal_group(process.pid, signal.SIGKILL)
            process.wait(timeout=3)
        for log in self.logs.values():
            log.close()


def signal_group(pid: int, signum: int) -> bool:
    try:
        os.killpg(pid, signum)
        return True
    except ProcessLookupError:
        return False


def run(port: int, frontend_port: int, timeout: float) -> int:
    root = Path(__file__).resolve().parents[1]
    backend = root / "packages/pybackend"
    env = dict(
        os.environ,
        MADE_BACKEND_HOST="127.0.0.1",
        MADE_BACKEND_PORT=str(port),
        PLAYWRIGHT_BASE_URL=f"https://127.0.0.1:{frontend_port}",
    )
    runner = Runner(env)
    try:
        if not math.isfinite(timeout) or timeout <= 0:
            raise ValueError("Readiness timeout must be finite and positive")
        check_ports((port, frontend_port))
        runner.start(["uv", "run", "made-backend"], backend, "backend")
        runner.start(
            [
                "npm",
                "--workspace",
                "packages/frontend",
                "run",
                "dev",
                "--",
                "--host",
                "127.0.0.1",
                "--port",
                str(frontend_port),
                "--strictPort",
            ],
            root,
            "frontend",
        )
        runner.wait_ready(
            [
                f"http://127.0.0.1:{port}/api/health",
                f"https://127.0.0.1:{frontend_port}",
            ],
            timeout,
        )
        print("Services are ready (GET probes succeeded)", flush=True)
        frontend_status = runner.start(["npm", "run", "test:e2e"], root).wait()
        backend_status = runner.start(
            ["uv", "run", "pytest", "tests/system/", "-v"], backend
        ).wait()
        if frontend_status or backend_status:
            raise RuntimeError(
                f"System suites failed: frontend={frontend_status}, backend={backend_status}"
            )
        print("System suites passed", flush=True)
        return 0
    except (OSError, RuntimeError, ValueError, KeyboardInterrupt) as error:
        print(f"System tests failed: {error}", file=sys.stderr)
        runner.diagnostics()
        return 1
    finally:
        runner.close()


def interrupted(signum: int, frame: FrameType | None) -> None:
    raise KeyboardInterrupt(f"received signal {signum}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=3000)
    parser.add_argument("--frontend-port", type=int, default=5173)
    parser.add_argument("--timeout", type=float, default=120)
    args = parser.parse_args()
    signal.signal(signal.SIGTERM, interrupted)
    sys.exit(run(args.port, args.frontend_port, args.timeout))
