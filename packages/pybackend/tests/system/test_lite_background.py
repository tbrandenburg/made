"""Real HTTP/process acceptance contract fixture, not a real-agent/browser E2E."""

import json
import os
import socket
import sys
from threading import Thread
from time import monotonic, sleep
from urllib.parse import parse_qs, urlsplit

from fastapi import FastAPI
import httpx
import pytest
import uvicorn

import agent_service as agents
import lite_router
import lite_submission_service as jobs


@pytest.fixture
def listener(tmp_path, monkeypatch):
    repository = tmp_path / "repository"
    (repository / ".made").mkdir(parents=True)
    (repository / ".made/settings.json").write_text('{"agentCli":"opencode-v2"}')
    binary = tmp_path / "opencode"
    binary.write_text(
        f"#!{sys.executable}\n"
        "import json, pathlib, sys, time\n"
        "arguments = sys.argv[1:]\n"
        "prompt = sys.stdin.read()\n"
        "selected = arguments[arguments.index('--session') + 1] if '--session' in arguments else None\n"
        "with pathlib.Path('received.jsonl').open('a') as stream:\n"
        "    stream.write(json.dumps({'arguments': arguments, 'prompt': prompt}) + '\\n')\n"
        "time.sleep(0.1 if selected else 8)\n"
        "print(json.dumps({'type':'text', 'sessionID':selected or 'ses_contract_new', 'part':{'text':'contract-reply'}}))\n"
    )
    binary.chmod(0o755)
    monkeypatch.setenv("PATH", f"{tmp_path}{os.pathsep}{os.environ['PATH']}")
    monkeypatch.setenv("MADE_WORKSPACE_HOME", str(tmp_path))
    monkeypatch.setenv("MADE_HOME", str(tmp_path))
    monkeypatch.setattr(agents, "_REGISTRY_PATH", tmp_path / "registry.json")
    for name in (
        "_processing_channels",
        "_processing_owners",
        "_process_registry",
        "_active_processes",
        "_cancel_events",
        "_conversation_sessions",
    ):
        monkeypatch.setattr(agents, name, {})
    monkeypatch.setattr(agents, "_cancelled_channels", set())
    monkeypatch.setattr(jobs, "_submissions", {})
    app = FastAPI()
    app.include_router(lite_router.router)

    @app.get("/health")
    def health():
        return {"status": "ok"}

    connection = socket.socket()
    connection.bind(("127.0.0.1", 0))
    connection.listen(128)
    server = uvicorn.Server(uvicorn.Config(app, log_level="error", lifespan="off"))
    thread = Thread(target=server.run, kwargs={"sockets": [connection]})
    thread.start()
    deadline = monotonic() + 10
    try:
        while not server.started and thread.is_alive() and monotonic() < deadline:
            sleep(0.01)
        assert server.started
        with httpx.Client(
            base_url=f"http://127.0.0.1:{connection.getsockname()[1]}", timeout=2
        ) as client:
            yield client, repository
    finally:
        server.should_exit = True
        thread.join(15)
        connection.close()
        assert not thread.is_alive()


def wait_for_completion(client, location):
    deadline = monotonic() + 15
    while monotonic() < deadline:
        response = client.get(location)
        if response.status_code != 200:
            return response
        sleep(0.05)
    pytest.fail("Submission did not complete within the contract fixture deadline")


@pytest.mark.system
def test_early_ack_health_duplicate_and_new_existing_handoff(listener):
    client, repository = listener
    started = monotonic()
    accepted = client.post("/lite/repo/repository/chat", data={"message": "new-marker"})
    acknowledgement = monotonic() - started
    assert accepted.status_code == 303 and acknowledgement < 2
    location = accepted.headers["location"]
    assert "session_id" not in location
    assert "set-cookie" not in accepted.headers
    pending = client.get(location)
    assert pending.status_code == 200 and "Waiting for agent response" in pending.text
    assert 'http-equiv="refresh"' in pending.text and "Go back" in pending.text
    before_health = monotonic()
    health = client.get("/health")
    assert health.json() == {"status": "ok"} and monotonic() - before_health < 1
    duplicate = client.post("/lite/repo/repository/chat", data={"message": "duplicate"})
    assert duplicate.status_code == 409
    assert agents.get_channel_status("repository") == {"running": True}
    completed = wait_for_completion(client, location)
    assert monotonic() - started >= 8
    assert (
        completed.status_code == 303 and "HttpOnly" in completed.headers["set-cookie"]
    )
    assert parse_qs(urlsplit(completed.headers["location"]).query) == {
        "session_id": ["ses_contract_new"]
    }
    assert agents._processing_channels == agents._processing_owners == {}
    selected = client.post(
        "/lite/repo/repository/chat",
        data={"message": "existing-marker", "session_id": "ses_contract_new"},
    )
    assert selected.status_code == 303
    resumed = wait_for_completion(client, selected.headers["location"])
    assert (
        resumed.status_code == 303
        and resumed.headers["location"] == completed.headers["location"]
    )
    received = [
        json.loads(line)
        for line in (repository / "received.jsonl").read_text().splitlines()
    ]
    assert [item["prompt"] for item in received] == ["new-marker", "existing-marker"]
    assert received[0]["arguments"] == ["run", "--format", "json"]
    assert received[1]["arguments"] == [
        "run",
        "--format",
        "json",
        "--session",
        "ses_contract_new",
    ]
