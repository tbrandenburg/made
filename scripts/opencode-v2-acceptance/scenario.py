"""Synthetic fixtures and real CLI acceptance; runs only inside the owned image."""

import json
import os
from pathlib import Path
import subprocess
import uuid

import httpx

from cli_execution import REPOSITORY, cli
from service import ARTIFACTS, ROOT, client, command, owned

FIRST = "MADE779_FIRST_COBALT"
LATE = "MADE779_RESUMED_COBALT"
TOOL = "MADE779_TOOL_COBALT"


def request(connection: httpx.Client, method: str, path: str, **kwargs: object) -> dict:
    response = connection.request(method, path, **kwargs)
    if response.status_code != 200:
        raise RuntimeError(
            f"Acceptance API {method} failed: HTTP {response.status_code}"
        )
    return response.json()


def records(connection: httpx.Client, session: str) -> tuple[list[dict], int, int]:
    result = []
    size = 0
    parameters = {"limit": "50", "order": "asc"}
    for page in range(1, 101):
        response = connection.get(f"/api/session/{session}/message", params=parameters)
        if response.status_code != 200:
            raise RuntimeError(f"Acceptance history HTTP {response.status_code}")
        size += len(response.content)
        envelope = response.json()
        result.extend(envelope["data"])
        cursor = envelope["cursor"].get("next")
        if cursor is None:
            return result, page, size
        parameters = {"limit": "50", "cursor": cursor}
    raise RuntimeError("Acceptance fixture exceeded page bound")


def contract(connection: httpx.Client) -> str:
    version = command("--version")
    expected = os.environ.get("MADE_OPENCODE_V2_EXPECTED_VERSION", "opencode v2.0.18")
    if version != expected:
        raise RuntimeError(f"Unexpected CLI version: {version}; expected {expected}")
    schema = request(connection, "GET", "/openapi.json")
    required = [
        "/api/session",
        "/api/session/{sessionID}",
        "/api/session/{sessionID}/message",
        "/api/experimental/session/import",
    ]
    if not set(required).issubset(schema["paths"]):
        raise RuntimeError("Pinned service lacks the acceptance HTTP contract")
    parameters = schema["paths"][required[2]]["get"]["parameters"]
    if not {"limit", "order", "cursor"}.issubset({item["name"] for item in parameters}):
        raise RuntimeError("Pinned service lacks ascending cursor pagination")
    with httpx.Client(
        base_url=str(connection.base_url), trust_env=False, timeout=5
    ) as anonymous:
        if anonymous.get("/api/session").status_code != 401:
            raise RuntimeError("Owned service did not enforce authentication")
    print(
        json.dumps(
            {
                "version": version,
                "authenticated_contract": required,
                "registration_fields": sorted(
                    json.loads((ROOT / "state/opencode/service.json").read_text())
                ),
            }
        )
    )
    return version


def fixture(connection: httpx.Client) -> str:
    template = request(
        connection,
        "POST",
        "/api/session",
        json={"location": {"directory": str(REPOSITORY)}},
    )["data"]
    template["id"] = f"ses_acceptance{uuid.uuid4().hex}"
    template["title"] = "Explicit synthetic pagination benchmark, not provider output"
    created = template["time"]["created"]
    messages = [
        {
            "id": f"msg_fixture{uuid.uuid4().hex}",
            "type": "user" if index in {0, 88} else "synthetic",
            "time": {"created": created + index},
            "text": "MADE779_PAGE_FIRST"
            if index == 0
            else "MADE779_PAGE_LAST"
            if index == 88
            else f"Explicit synthetic payload {index:02d}: " + "x" * 20080,
        }
        for index in range(89)
    ]
    request(
        connection,
        "POST",
        "/api/experimental/session/import",
        json={
            "info": template,
            "messages": messages,
            "location": {"directory": str(REPOSITORY)},
        },
    )
    metadata = request(connection, "GET", f"/api/session/{template['id']}")["data"]
    if metadata["location"]["directory"] != str(REPOSITORY):
        raise RuntimeError("Imported fixture did not preserve its explicit location")
    observed, pages, size = records(connection, template["id"])
    if (
        len(observed) != 89
        or observed[0]["text"] != "MADE779_PAGE_FIRST"
        or observed[-1]["text"] != "MADE779_PAGE_LAST"
    ):
        raise RuntimeError("Imported fixture is incomplete or unordered")
    if (
        len({item["id"] for item in observed}) != 89
        or pages < 2
        or not 1_700_000 < size < 1_900_000
    ):
        raise RuntimeError(
            "Fixture is not the expected complete ~1.76 MB paginated history"
        )
    return template["id"]


def child_fixture(
    connection: httpx.Client,
    parent: str | None,
    directory: Path,
    title: str,
    text: str,
) -> str:
    template = request(
        connection,
        "POST",
        "/api/session",
        json={"location": {"directory": str(directory)}},
    )["data"]
    template["id"] = f"ses_acceptance{uuid.uuid4().hex}"
    if parent is not None:
        template["parentID"] = parent
    template["title"] = title
    message = {
        "id": f"msg_fixture{uuid.uuid4().hex}",
        "type": "user",
        "time": template["time"],
        "text": text,
    }
    request(
        connection,
        "POST",
        "/api/experimental/session/import",
        json={
            "info": template,
            "messages": [message],
            "location": {"directory": str(directory)},
        },
    )
    observed = request(connection, "GET", f"/api/session/{template['id']}")["data"]
    if (
        observed["location"]["directory"] != str(directory)
        or observed.get("parentID") != parent
    ):
        raise RuntimeError("Imported child fixture did not preserve its ownership")
    return template["id"]


def prepare(real: bool = True) -> dict:
    owned()
    ARTIFACTS.mkdir(parents=True, exist_ok=True, mode=0o700)
    for name in ("repoA", "repoB"):
        directory = Path("/workspace") / name
        directory.mkdir(parents=True, exist_ok=True)
        subprocess.run(["git", "init", "-q"], cwd=directory, check=True, timeout=15)
    with httpx.Client(
        base_url="http://127.0.0.1:13079", trust_env=False, timeout=30
    ) as made:
        response = made.put("/api/settings", json={"agentCli": "opencode-v2"})
        if response.status_code != 200:
            raise RuntimeError("Could not select the isolated MADE adapter")
    with client() as connection:
        version = contract(connection)
        paginated = fixture(connection)
        session = (
            cli(
                f"Remember {FIRST}. Actually execute printf {TOOL} using your registered shell tool now. "
                f"Do not print a proposed command or JSON tool-call example. After the tool returns, reply exactly {FIRST}."
            )
            if real
            else paginated
        )
        metadata = request(connection, "GET", f"/api/session/{session}")["data"]
        if metadata["location"]["directory"] != str(REPOSITORY) or metadata.get(
            "parentID"
        ):
            raise RuntimeError("CLI root session has an incorrect location")
        if real:
            transcript, _, _ = records(connection, session)
            tools = [
                part
                for item in transcript
                for part in item.get("content", [])
                if part["type"] == "tool"
            ]
            if not tools or not any(
                TOOL in json.dumps(part.get("state", {})) for part in tools
            ):
                raise RuntimeError(
                    "Provider did not execute the required real shell tool"
                )
            if not any(
                FIRST in part.get("text", "")
                for item in transcript
                for part in item.get("content", [])
            ):
                raise RuntimeError(
                    "Provider did not return the initial assistant marker"
                )
        child = child_fixture(
            connection,
            session,
            Path("/workspace/repoA"),
            "Child acceptance session",
            "MADE800_CHILD_HISTORY_COBALT",
        )
        grandchild = child_fixture(
            connection,
            child,
            Path("/workspace/repoA"),
            "Grandchild acceptance session",
            "MADE800_GRANDCHILD_HISTORY_COBALT",
        )
        for index in range(11):
            child_fixture(
                connection,
                None,
                Path("/workspace/repoA"),
                f"Newer root acceptance session {index}",
                f"MADE800_ROOT_WINDOW_{index}",
            )
        foreign_parent = child_fixture(
            connection,
            None,
            Path("/workspace/repoB"),
            "Foreign parent acceptance session",
            "MADE800_FOREIGN_PARENT_COBALT",
        )
        foreign_child = child_fixture(
            connection,
            foreign_parent,
            Path("/workspace/repoB"),
            "Foreign child acceptance session",
            "MADE800_FOREIGN_CHILD_COBALT",
        )
        manifest = {
            "session": session,
            "fixture": paginated,
            "child": child,
            "grandchild": grandchild,
            "foreignChild": foreign_child,
            "version": version,
            "realProvider": real,
            "first": FIRST,
            "late": LATE,
            "tool": TOOL,
            "model": os.environ.get("MADE_ACCEPTANCE_MODEL", "opencode/big-pickle"),
        }
        (ARTIFACTS / "manifest.json").write_text(json.dumps(manifest))
        return manifest


if __name__ == "__main__":
    import sys

    action = sys.argv[1]
    if action == "prepare":
        print(json.dumps(prepare("--smoke" not in sys.argv)))
    elif action == "manifest":
        print((ARTIFACTS / "manifest.json").read_text())
    elif action == "snapshot":
        manifest = json.loads((ARTIFACTS / "manifest.json").read_text())
        with client() as connection:
            for key in ("fixture", "session"):
                transcript, _, _ = records(connection, manifest[key])
                (ARTIFACTS / f"transcript-{key}.json").write_text(
                    json.dumps(transcript)
                )
        print("Saved synthetic acceptance transcripts inside owned volume")
    elif action == "resume":
        manifest = json.loads((ARTIFACTS / "manifest.json").read_text())
        with client() as connection:
            before, _, _ = records(connection, manifest["session"])
        cli(f"Repeat the remembered marker, then reply {LATE}.", manifest["session"])
        with client() as connection:
            after, _, _ = records(connection, manifest["session"])
        identifiers = {item["id"] for item in before}
        if not identifiers.issubset({item["id"] for item in after}):
            raise RuntimeError(
                "Terminal resume lost existing public message identities"
            )
        replies = [
            part.get("text", "")
            for item in after
            if item["id"] not in identifiers
            for part in item.get("content", [])
            if part.get("type") == "text"
        ]
        if not any(LATE in text and FIRST in text for text in replies):
            raise RuntimeError(
                "Terminal resume did not recall the marker and return the late marker"
            )
        print("Real terminal resume completed")
    else:
        raise RuntimeError("Unknown acceptance action")
