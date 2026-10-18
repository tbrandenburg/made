"""Pagination boundaries and event-loop safety through production history paths."""

import asyncio
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

import pytest

import opencode_v2_http_history as history
from tests.unit.opencode_http_fixture import Reply, serve


@pytest.mark.parametrize("count", [5001, 10000, 10001])
def test_record_boundary_includes_empty_terminating_page(tmp_path: Path, count: int):
    with serve(tmp_path) as service:
        registration = tmp_path / "registration"
        service.register(registration)

        def respond(path: str, _count: int) -> Reply:
            if "/message" not in path:
                return Reply(
                    {
                        "data": {
                            "id": "ses_test",
                            "location": {"directory": str(tmp_path)},
                        }
                    }
                )
            query = parse_qs(urlsplit(path).query)
            position = int(query.get("cursor", ["0"])[0])
            end = min(position + 50, count)
            records = [{"id": f"msg_{index}"} for index in range(position, end)]
            return Reply(
                {"data": records, "cursor": {"next": str(end) if records else None}}
            )

        service.respond = respond
        if count == 10001:
            with pytest.raises(history.HistoryReadError, match="record limit"):
                history.read_session("ses_test", tmp_path, registration)
            assert len(service.requests) == 202
            assert service.requests[-1].endswith("cursor=10000")
            return
        records = history.read_session("ses_test", tmp_path, registration)
    assert [record["id"] for record in records] == [
        f"msg_{index}" for index in range(count)
    ]
    assert len(service.requests) == (104 if count == 5001 else 203)
    assert service.requests[-2].endswith(f"cursor={count}")


def test_sync_reader_rejects_event_loop_before_network_access(tmp_path: Path):
    with serve(tmp_path) as service:
        registration = tmp_path / "registration"
        service.register(registration)

        async def caller() -> None:
            with pytest.raises(history.HistoryReadError, match="worker thread"):
                history.read_session("ses_test", tmp_path, registration)

        asyncio.run(caller())
    assert service.requests == []
    assert service.authenticated == []
