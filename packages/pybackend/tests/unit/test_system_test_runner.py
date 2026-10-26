"""Exercise readiness over real HTTP and cleanup with owned subprocesses."""

from collections.abc import Iterator
from http.server import BaseHTTPRequestHandler, HTTPServer
import importlib.util
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
from threading import Event, Thread
import time

import pytest


ROOT = Path(__file__).resolve().parents[4]
SPEC = importlib.util.spec_from_file_location(
    "system_test_runner", ROOT / "scripts/system_test_runner.py"
)
assert SPEC and SPEC.loader
runner_module = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(runner_module)


@pytest.fixture
def http_service() -> Iterator[tuple[HTTPServer, list[tuple[str, str]]]]:
    requests: list[tuple[str, str]] = []

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:
            requests.append((self.command, self.path))
            self.send_response(
                200 if self.path == "/api/health" else int(self.path[1:])
            )
            self.end_headers()

        def log_message(self, format: str, *args: object) -> None:
            return

    server = HTTPServer(("127.0.0.1", 0), Handler)
    thread = Thread(target=server.serve_forever, kwargs={"poll_interval": 0.01})
    thread.start()
    try:
        yield server, requests
    finally:
        server.shutdown()
        thread.join(timeout=2)
        server.server_close()


def test_get_only_readiness(http_service) -> None:
    server, requests = http_service
    runner = runner_module.Runner({})
    started = time.monotonic()
    runner.wait_ready([f"http://127.0.0.1:{server.server_port}/api/health"], 3)
    assert requests == [("GET", "/api/health")]
    assert time.monotonic() - started < 3


@pytest.mark.parametrize("status", [404, 405, 500])
def test_http_errors_never_signal_ready(http_service, status: int) -> None:
    server, requests = http_service
    runner = runner_module.Runner({})
    started = time.monotonic()
    with pytest.raises(RuntimeError, match="Readiness timed out.*GET"):
        runner.wait_ready([f"http://127.0.0.1:{server.server_port}/{status}"], 3)
    assert requests and set(requests) == {("GET", f"/{status}")}
    assert len(requests) >= 2
    assert 3 <= time.monotonic() - started < 4.5


def test_unavailable_endpoint_has_bounded_timeout() -> None:
    with socket.socket() as reserved:
        reserved.bind(("127.0.0.1", 0))
        port = reserved.getsockname()[1]
        started = time.monotonic()
        with pytest.raises(
            RuntimeError, match=f"GET http://127.0.0.1:{port}/api/health"
        ):
            runner_module.Runner({}).wait_ready(
                [f"http://127.0.0.1:{port}/api/health"], 0.2
            )
        assert 0.2 <= time.monotonic() - started < 1
        assert reserved.getsockname() == ("127.0.0.1", port)


@pytest.mark.parametrize("complete", [True, False])
def test_slow_headers_obey_total_deadline(complete: bool) -> None:
    requests: list[bytes] = []
    disconnected = Event()
    stop = Event()
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        listener.listen()
        listener.settimeout(0.1)

        def serve() -> None:
            while not stop.is_set():
                try:
                    connection, _ = listener.accept()
                except TimeoutError:
                    continue
                with connection:
                    connection.settimeout(1)
                    requests.append(connection.recv(4096))
                    try:
                        connection.sendall(b"HTTP/1.1 200 OK\r\nX-Slow: ")
                        # Longer than the total budget, not just one socket read.
                        for _ in range(300 if complete else 600):
                            if stop.wait(0.02):
                                return
                            connection.sendall(b"x")
                        if complete:
                            connection.sendall(b"\r\nContent-Length: 0\r\n\r\n")
                    except (BrokenPipeError, ConnectionResetError):
                        disconnected.set()

        thread = Thread(target=serve)
        thread.start()
        try:
            started = time.monotonic()
            with pytest.raises(RuntimeError, match="Readiness timed out.*GET"):
                runner_module.Runner({}).wait_ready(
                    [f"http://127.0.0.1:{listener.getsockname()[1]}/api/health"],
                    3,
                )
            assert 3 <= time.monotonic() - started < 4.5
            assert requests and requests[0].startswith(b"GET /api/health HTTP/")
            assert disconnected.wait(1)
        finally:
            stop.set()
            thread.join(timeout=3)
        assert not thread.is_alive()


@pytest.mark.parametrize("length", [0, 20000])
def test_diagnostics_redacts_overlapping_secrets_before_tail_cut(
    length: int, capsys
) -> None:
    secret = "SYNTHETIC" + "z" * length + "-CREDENTIAL-123456"
    runner = runner_module.Runner(
        {
            "API_TOKEN": "SYNTHETIC",
            "SECRET": "SYNTHETIC-CREDENTIAL-123456",
            "LONG_SECRET": secret,
        }
    )
    trailer = b"\nlatest failure SYNTHETIC-CREDENTIAL-123456 SYNTHETIC\n"
    with runner_module.tempfile.TemporaryFile() as log:
        runner.logs["backend"] = log
        log.seek(8 * 1024 * 1024)
        log.write(secret.encode() + b"x" * (16384 - 12 - len(trailer)))
        log.write(trailer)
        log.flush()
        runner.diagnostics()
    output = capsys.readouterr().err
    assert "CREDENTIAL" not in output and "123456" not in output
    assert "SYNTHETIC" not in output
    assert "latest failure [REDACTED] [REDACTED]\n" in output
    assert len(output) < 16500


def test_diagnostics_preserves_redaction_marker_at_output_boundary(capsys) -> None:
    runner = runner_module.Runner({"SECRET": "credential"})
    with runner_module.tempfile.TemporaryFile() as log:
        runner.logs["backend"] = log
        log.write(b"credential" + b"x" * 16380)
        log.flush()
        runner.diagnostics()
    output = capsys.readouterr().err
    assert output.startswith("--- backend startup output ---\n[REDACTED]")
    assert "credential" not in output and output.endswith("x" * 16380 + "\n")


@pytest.mark.parametrize("padding", [0, 16372])
def test_diagnostics_redacts_union_of_intersecting_credentials(
    padding: int, capsys
) -> None:
    runner = runner_module.Runner(
        {"API_TOKEN": "SYNTHETIC-CREDENTIAL", "SECRET": "CREDENTIAL-123456"}
    )
    with runner_module.tempfile.TemporaryFile() as log:
        runner.logs["backend"] = log
        log.write(b"SYNTHETIC-CREDENTIAL-123456" + b"x" * padding)
        log.flush()
        runner.diagnostics()
    output = capsys.readouterr().err
    assert output == "--- backend startup output ---\n[REDACTED]" + "x" * padding + "\n"
    assert "SYNTHETIC" not in output and "123456" not in output


@pytest.mark.parametrize("occupied", ["backend", "frontend"])
def test_occupied_port_refuses_launch_and_preserves_listener(
    http_service, occupied: str
) -> None:
    server, requests = http_service
    with socket.socket() as reserved:
        reserved.bind(("127.0.0.1", 0))
        ports = [server.server_port, reserved.getsockname()[1]]
        if occupied == "frontend":
            ports.reverse()
        result = subprocess.run(
            [
                shutil.which("make"),
                "system-test",
                f"PORT={ports[0]}",
                f"FRONTEND_PORT={ports[1]}",
            ],
            cwd=ROOT,
            env={"PATH": str(Path(sys.executable).parent)},
            capture_output=True,
            text=True,
            timeout=5,
        )
    assert result.returncode == 2
    assert "no services started" in result.stderr
    assert (
        "startup output" not in result.stderr
    )  # No service launch: both ports are checked before either process starts.
    runner_module.Runner({}).wait_ready(
        [f"http://127.0.0.1:{server.server_port}/api/health"], 3
    )
    assert requests == [("GET", "/api/health")]


@pytest.mark.parametrize("timeout", [0, float("nan"), float("inf")])
def test_invalid_timeout_refuses_launch(timeout: float, capsys) -> None:
    assert runner_module.run(0, 0, timeout) == 1
    output = capsys.readouterr()
    assert "Readiness timeout must be finite and positive" in output.err
    assert "startup output" not in output.err and "Services are ready" not in output.out


@pytest.mark.parametrize("launcher_exits", [False, True])
def test_cleanup_stops_owned_launcher_and_descendant(
    tmp_path: Path, launcher_exits: bool
) -> None:
    child = tmp_path / "child.py"
    address = tmp_path / "port"
    child.write_text(
        "from http.server import HTTPServer, BaseHTTPRequestHandler\n"
        "from pathlib import Path\n"
        "import sys\n"
        "server = HTTPServer(('127.0.0.1', 0), BaseHTTPRequestHandler)\n"
        "Path(sys.argv[1]).write_text(str(server.server_port))\n"
        "server.serve_forever()\n"
    )
    runner = runner_module.Runner({})
    launcher = runner.start(
        [
            sys.executable,
            "-c",
            "import subprocess, sys, signal; "
            "child = subprocess.Popen(sys.argv[1:]); "
            + (
                ""
                if launcher_exits
                else "signal.signal(signal.SIGTERM, lambda *args: None); child.wait()"
            ),
            sys.executable,
            str(child),
            str(address),
        ],
        tmp_path,
        "backend",
    )
    try:
        deadline = time.monotonic() + 3
        while not address.exists() and time.monotonic() < deadline:
            time.sleep(0.02)
        assert address.exists()
        if launcher_exits:
            assert launcher.wait(timeout=1) == 0
        port = int(address.read_text())
        with socket.create_connection(("127.0.0.1", port), timeout=1) as connection:
            assert connection.getpeername()[1] == port
    finally:
        runner.close()
    assert launcher.returncode == 0
    with pytest.raises(OSError):
        socket.create_connection(("127.0.0.1", port), timeout=0.2)


def test_cleanup_escalates_for_unresponsive_owned_process(tmp_path: Path) -> None:
    runner = runner_module.Runner({})
    marker = tmp_path / "started"
    process = runner.start(
        [
            sys.executable,
            "-c",
            "import signal, time, pathlib, sys; "
            "signal.signal(signal.SIGTERM, signal.SIG_IGN); "
            "pathlib.Path(sys.argv[1]).touch(); time.sleep(60)",
            str(marker),
        ],
        tmp_path,
    )
    try:
        deadline = time.monotonic() + 3
        while not marker.exists() and time.monotonic() < deadline:
            time.sleep(0.02)
        assert marker.exists()
    finally:
        runner.close()
    assert process.returncode == -9
    with pytest.raises(ProcessLookupError):
        os.kill(process.pid, 0)


def test_exited_service_aborts_readiness_with_redacted_diagnostics(
    tmp_path: Path, capsys
) -> None:
    runner = runner_module.Runner({"API_TOKEN": "example-sensitive-token"})
    try:
        process = runner.start(
            [sys.executable, "-c", "print('startup failed example-sensitive-token')"],
            tmp_path,
            "backend",
        )
        process.wait(timeout=3)
        with pytest.raises(RuntimeError, match="Service exited before readiness"):
            runner.wait_ready(["http://127.0.0.1:1/api/health"], 1)
        runner.diagnostics()
        output = capsys.readouterr().err
        assert (
            "backend startup output" in output and "startup failed [REDACTED]" in output
        )
        assert "example-sensitive-token" not in output
    finally:
        runner.close()


@pytest.mark.parametrize(
    "frontend_status,backend_status,unready",
    [(0, 0, False), (7, 0, False), (0, 8, False), (0, 0, True)],
)
def test_process_invocation_contract(
    monkeypatch, capsys, frontend_status: int, backend_status: int, unready: bool
) -> None:
    """Mock launches explicitly to inspect argv/cwd/env, never inherited secrets."""
    calls = []
    probes = []

    class Process:
        def __init__(self, status: int) -> None:
            self.status = status

        def wait(self) -> int:
            return self.status

    def start(self, command, cwd, name=None):
        calls.append((command, cwd, dict(self.env)))
        return Process(
            frontend_status if command == ["npm", "run", "test:e2e"] else backend_status
        )

    def readiness(self, urls, timeout):
        probes.append((urls, timeout))
        if unready:
            raise RuntimeError("Readiness timed out")

    monkeypatch.setattr(
        runner_module.os, "environ", {"PATH": "/synthetic", "MADE_HOME": "/test-home"}
    )
    monkeypatch.setattr(runner_module.Runner, "start", start)
    monkeypatch.setattr(runner_module.Runner, "wait_ready", readiness)
    with socket.socket() as first, socket.socket() as second:
        first.bind(("127.0.0.1", 0))
        second.bind(("127.0.0.1", 0))
        port, frontend = first.getsockname()[1], second.getsockname()[1]
    result = runner_module.run(port, frontend, 2)
    assert result == (1 if frontend_status or backend_status or unready else 0)
    assert probes == [
        ([f"http://127.0.0.1:{port}/api/health", f"https://127.0.0.1:{frontend}"], 2)
    ]
    expected = [
        ["uv", "run", "made-backend"],
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
            str(frontend),
            "--strictPort",
        ],
        ["npm", "run", "test:e2e"],
        ["uv", "run", "pytest", "tests/system/", "-v"],
    ]
    assert [call[0] for call in calls] == (expected[:2] if unready else expected)
    directories = [ROOT / "packages/pybackend", ROOT, ROOT, ROOT / "packages/pybackend"]
    assert [call[1] for call in calls] == (directories[:2] if unready else directories)
    assert calls[1][2] == {
        "PATH": "/synthetic",
        "MADE_HOME": "/test-home",
        "MADE_BACKEND_HOST": "127.0.0.1",
        "MADE_BACKEND_PORT": str(port),
        "PLAYWRIGHT_BASE_URL": f"https://127.0.0.1:{frontend}",
    }
    output = capsys.readouterr()
    assert ("System suites passed" in output.out) == (result == 0)
    assert ("System tests failed" in output.err) == (result != 0)
    assert ("Services are ready" in output.out) == (not unready)
