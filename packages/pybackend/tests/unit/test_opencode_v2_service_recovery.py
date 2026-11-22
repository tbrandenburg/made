"""Recovery uses an isolated executable and authenticated loopback service."""

import json
import os
from pathlib import Path
import socket
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import pytest

from opencode_v2_agent_cli import OpenCodeV2AgentCLI
from tests.unit.opencode_http_fixture import Reply, serve


def setup_cli(tmp_path, monkeypatch, registration):
    binary = tmp_path / "bin"
    binary.mkdir()
    command = binary / "opencode"
    command.write_text(
        "#!/usr/bin/python3\n"
        "import os, pathlib, shutil, sys, time\n"
        "with pathlib.Path(os.environ['CALLS']).open('a') as calls:\n"
        "    calls.write(' '.join(sys.argv[1:]) + '\\n')\n"
        "time.sleep(0.2)\n"
        "target = pathlib.Path(os.environ['XDG_STATE_HOME']) / 'opencode/service.json'\n"
        "target.parent.mkdir(parents=True, exist_ok=True)\n"
        "shutil.copyfile(os.environ['REGISTRATION'], target)\n"
    )
    command.chmod(0o755)
    monkeypatch.setenv("PATH", str(binary) + os.pathsep + os.environ["PATH"])
    monkeypatch.setenv("XDG_STATE_HOME", str(tmp_path))
    monkeypatch.setenv("CALLS", str(tmp_path / "calls"))
    monkeypatch.setenv("REGISTRATION", str(registration))


@pytest.mark.parametrize("stale", [False, True])
def test_missing_or_stale_service_recovers_real_history(tmp_path, monkeypatch, stale):
    registration = tmp_path / "source"
    setup_cli(tmp_path, monkeypatch, registration)
    with serve(tmp_path) as service:
        service.register(registration)
        service.respond = lambda path, _: (
            Reply(
                {
                    "data": [
                        {
                            "id": "msg_1",
                            "type": "user",
                            "text": "hello",
                            "time": {"created": 1700000000000},
                        }
                    ],
                    "cursor": {"next": None},
                }
            )
            if "/message" in path
            else Reply(
                {"data": {"id": "ses_test", "location": {"directory": str(tmp_path)}}}
            )
        )
        if stale:
            target = tmp_path / "opencode/service.json"
            target.parent.mkdir()
            with socket.socket() as sock:
                sock.bind(("127.0.0.1", 0))
                port = sock.getsockname()[1]
            target.write_text(
                json.dumps({"url": f"http://127.0.0.1:{port}", "password": "test"})
            )
        result = OpenCodeV2AgentCLI().export_session("ses_test", tmp_path)
    assert result.success
    assert [message.content for message in result.messages] == ["hello"]
    assert (tmp_path / "calls").read_text() == "api get /api/info\n"
    assert len(service.requests) == 3


def test_malformed_registration_does_not_start_service(tmp_path, monkeypatch):
    setup_cli(tmp_path, monkeypatch, tmp_path / "source")
    target = tmp_path / "opencode/service.json"
    target.parent.mkdir()
    target.write_text("{}")
    result = OpenCodeV2AgentCLI().export_session("ses_test", tmp_path)
    assert not result.success
    assert not (tmp_path / "calls").exists()


def test_healthy_service_does_not_start_cli(tmp_path, monkeypatch):
    setup_cli(tmp_path, monkeypatch, tmp_path / "source")
    with serve(tmp_path) as service:
        service.register(tmp_path / "opencode/service.json")
        result = OpenCodeV2AgentCLI().export_session("ses_test", tmp_path)
    assert result.success
    assert len(service.requests) == 3
    assert not (tmp_path / "calls").exists()


def test_failed_start_is_sanitized(tmp_path, monkeypatch):
    setup_cli(tmp_path, monkeypatch, tmp_path / "missing")
    result = OpenCodeV2AgentCLI().export_session("ses_test", tmp_path)
    assert not result.success
    assert result.error_message == "OpenCode service recovery failed"
    assert (tmp_path / "calls").read_text() == "api get /api/info\n"


def test_concurrent_requests_share_recovery(tmp_path, monkeypatch):
    registration = tmp_path / "source"
    setup_cli(tmp_path, monkeypatch, registration)
    barrier = Barrier(4)
    with serve(tmp_path) as service:
        service.register(registration)

        def export():
            barrier.wait(timeout=5)
            return OpenCodeV2AgentCLI().export_session("ses_test", tmp_path)

        with ThreadPoolExecutor(max_workers=4) as pool:
            results = list(pool.map(lambda _: export(), range(4)))
    assert all(result.success for result in results)
    assert (tmp_path / "calls").read_text() == "api get /api/info\n"
    assert len(service.requests) == 12
