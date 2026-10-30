"""Local HTTP history for OpenCode >= 2.0.18; never starts a service.

Limits cover both attempts together: 30s, 201 pages, 10,000 records, 32MiB.
Identity encoding prevents decompression bombs; raw reads are bounded to 64KiB.
JSON work limits are defined in opencode_v2_http_json. The async deadline covers
I/O and cooperative preflight; bounded stdlib decoding is not CPU-preemptible.
Pagination is best-effort, not an atomic snapshot of concurrent edits.
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
import ipaddress
import json
import os
from pathlib import Path
import time
from typing import cast
from urllib.parse import quote, urlsplit

import httpx

from opencode_v2_http_json import JsonBudget, JsonComplexityError

MAX_RECORDS = 10_000
MAX_BYTES = 32 * 1024 * 1024
DEADLINE_SECONDS = 30
PAGE_SIZE = 50
# Only used when full history fails the JSON complexity preflight.
RECENT_PAGE_SIZE = 10
RECENT_RECORD_LIMIT = 50
# Full final pages can advertise a cursor to an empty terminating page.
MAX_PAGES = (MAX_RECORDS + PAGE_SIZE - 1) // PAGE_SIZE + 1
CHUNK_BYTES = 64 * 1024
CONNECT_SECONDS = 2
READ_SECONDS = 5


class HistoryReadError(RuntimeError):
    """Sanitized failure reading service history."""


class HistoryComplexityError(HistoryReadError):
    """The JSON lexical preflight rejected an over-complex response."""


class SessionNotFound(HistoryReadError):
    """Verified SessionNotFoundError from the metadata endpoint."""


class SessionDirectoryMismatch(HistoryReadError):
    """The selected root session belongs to a different directory."""


class ServiceRetryableError(HistoryReadError):
    """Eligible for the single shared whole-read retry."""


class _Connection:
    """Public transport API, without AsyncClient's private-URL INFO logging.

    No logger filters/levels are changed. Pooling, Basic auth, timeout extensions,
    streaming and cleanup still use HTTPX; redirects/proxies are never enabled.
    """

    def __init__(
        self, url: str, password: str, transport: httpx.AsyncHTTPTransport
    ) -> None:
        self.url = httpx.URL(url)
        self.auth = httpx.BasicAuth("opencode", password)
        self.transport = transport

    @asynccontextmanager
    async def stream(
        self, path: str, params: dict[str, str], timeout: dict[str, float]
    ) -> AsyncIterator[httpx.Response]:
        request = httpx.Request(
            "GET",
            self.url.join(path),
            params=params,
            headers={"Accept-Encoding": "identity"},
            extensions={"timeout": timeout},
        )
        flow = self.auth.auth_flow(request)
        try:
            response = await self.transport.handle_async_request(next(flow))
            try:
                yield response
            finally:
                await response.aclose()
        finally:
            flow.close()


def object_value(value: object) -> dict[str, object]:
    if not isinstance(value, dict) or not all(isinstance(k, str) for k in value):
        raise HistoryReadError("OpenCode returned a malformed history object")
    return cast(dict[str, object], value)


def registration_path() -> Path:
    state = Path(os.environ.get("XDG_STATE_HOME", Path.home() / ".local/state"))
    return state / "opencode" / "service.json"


def _next_cursor(value: object) -> str | None:
    cursor = object_value(value)
    if (
        "next" not in cursor
        or set(cursor) - {"next", "previous"}
        or any(
            item is not None
            and (not isinstance(item, str) or not item or len(item) > CHUNK_BYTES)
            for item in cursor.values()
        )
    ):
        raise HistoryReadError("OpenCode returned invalid pagination metadata")
    return cast(str | None, cursor["next"])


def _service(path: Path) -> tuple[str, str]:
    try:
        if not path.is_file():
            raise ValueError
        with path.open("rb") as file:
            info = object_value(json.loads(file.read(CHUNK_BYTES + 1)))
        raw, password = info.get("url"), info.get("password")
        if not isinstance(raw, str) or not isinstance(password, str) or not password:
            raise ValueError
        parsed = urlsplit(raw)
        if (
            parsed.scheme != "http"
            or parsed.username is not None
            or parsed.password is not None
            or not parsed.hostname
            or parsed.port is None
            or not 1 <= parsed.port <= 65535
            or parsed.path not in {"", "/"}
            or "?" in raw
            or "#" in raw
            or any(character.isspace() for character in raw)
            or "%" in raw
            or not ipaddress.ip_address(parsed.hostname).is_loopback
        ):
            raise ValueError
        # Literal addresses only: no DNS lookup/rebinding or localhost aliases.
        return f"http://{parsed.netloc}", password
    except (OSError, ValueError, TypeError, RecursionError, HistoryReadError):
        raise HistoryReadError(
            "OpenCode local service registration is unavailable or invalid"
        ) from None


class _Read:
    def __init__(self, session: str, directory: Path | None) -> None:
        self.session = session
        self.route = f"/api/session/{quote(session, safe='')}"
        self.directory = str(directory.resolve()) if directory else None
        self.deadline = time.monotonic() + DEADLINE_SECONDS
        self.bytes = 0
        self.pages = 0
        self.records = 0

    def remaining(self) -> float:
        remaining = self.deadline - time.monotonic()
        if remaining <= 0:
            raise HistoryReadError("OpenCode history exceeded its total deadline")
        return remaining

    async def request(
        self, client: _Connection, path: str, params: dict[str, str]
    ) -> tuple[int, object]:
        remaining = self.remaining()
        timeout = {
            "connect": min(CONNECT_SECONDS, remaining),
            "read": min(READ_SECONDS, remaining),
            "write": min(READ_SECONDS, remaining),
            "pool": min(READ_SECONDS, remaining),
        }
        try:
            async with client.stream(path, params, timeout) as response:
                if response.headers.get("content-encoding", "identity") != "identity":
                    raise HistoryReadError(
                        "OpenCode returned unsupported history encoding"
                    )
                body = bytearray()
                budget = JsonBudget()
                async for chunk in response.aiter_raw(chunk_size=CHUNK_BYTES):
                    self.remaining()
                    self.bytes += len(chunk)
                    if self.bytes > MAX_BYTES:
                        raise HistoryReadError(
                            "OpenCode history exceeded its byte limit"
                        )
                    await budget.feed(chunk, self.remaining)
                    body.extend(chunk)
                self.remaining()
                try:
                    envelope: object = json.loads(body)
                except (ValueError, UnicodeError, RecursionError):
                    if response.status_code == 200:
                        raise HistoryReadError(
                            "OpenCode returned malformed history JSON"
                        ) from None
                    envelope = None
                self.remaining()
                return response.status_code, envelope
        except httpx.HTTPError:
            raise ServiceRetryableError(
                "Unable to read OpenCode session history"
            ) from None
        except JsonComplexityError as error:
            raise HistoryComplexityError(str(error)) from None

    @staticmethod
    def status(status: int, envelope: object) -> None:
        if status in {401, 403, 408, 429} or status >= 500:
            raise ServiceRetryableError("OpenCode history service request failed")
        if (
            status == 400
            and isinstance(envelope, dict)
            and envelope.get("_tag") == "InvalidCursorError"
            and isinstance(envelope.get("message"), str)
        ):
            raise ServiceRetryableError("OpenCode history cursor was invalidated")
        if status != 200:
            raise HistoryReadError("OpenCode history endpoint request failed")

    async def metadata(self, client: _Connection, *, initial: bool) -> None:
        status, envelope = await self.request(client, self.route, {})
        if (
            initial
            and status == 404
            and isinstance(envelope, dict)
            and set(envelope) == {"_tag", "sessionID", "message"}
            and envelope.get("_tag") == "SessionNotFoundError"
            and envelope.get("sessionID") == self.session
            and isinstance(envelope.get("message"), str)
        ):
            raise SessionNotFound("OpenCode session was not found")
        self.status(status, envelope)
        metadata = object_value(object_value(envelope).get("data"))
        location = object_value(metadata.get("location"))
        directory = location.get("directory")
        parent = metadata.get("parentID")
        if (
            metadata.get("id") != self.session
            or not isinstance(directory, str)
            or not directory
        ):
            raise HistoryReadError("OpenCode returned invalid session metadata")
        if "parentID" in metadata and (not isinstance(parent, str) or not parent):
            raise HistoryReadError("OpenCode returned invalid session parent")
        if parent or (self.directory is not None and directory != self.directory):
            raise SessionDirectoryMismatch("Session belongs to a different directory")

    async def attempt(self, client: _Connection) -> list[dict[str, object]]:
        await self.metadata(client, initial=True)
        messages: list[dict[str, object]] = []
        identifiers: set[str] = set()
        cursors: set[str] = set()
        params = {"limit": str(PAGE_SIZE), "order": "asc"}
        while True:
            self.pages += 1
            if self.pages > MAX_PAGES:
                raise HistoryReadError("OpenCode history exceeded its page limit")
            status, envelope = await self.request(
                client, f"{self.route}/message", params
            )
            self.status(status, envelope)
            page = object_value(envelope)
            records = page.get("data")
            if not isinstance(records, list) or len(records) > PAGE_SIZE:
                raise HistoryReadError("OpenCode returned invalid history records")
            for record in records:
                self.remaining()
                self.records += 1
                if self.records > MAX_RECORDS:
                    raise HistoryReadError("OpenCode history exceeded its record limit")
                message = object_value(record)
                identifier = message.get("id")
                if not isinstance(identifier, str) or not identifier.startswith("msg_"):
                    raise HistoryReadError("OpenCode returned an invalid message ID")
                if identifier in identifiers:
                    raise ServiceRetryableError("OpenCode history pages overlap")
                # The projection exposes no sequence field. Preserve the API's
                # ascending order; IDs and timestamps cannot establish order.
                identifiers.add(identifier)
                messages.append(message)
            following = _next_cursor(page.get("cursor"))
            if following is None:
                await self.metadata(client, initial=False)
                self.remaining()
                return messages
            if not records or following in cursors:
                raise ServiceRetryableError(
                    "OpenCode returned a repeated pagination cursor"
                )
            cursors.add(following)
            params = {"limit": str(PAGE_SIZE), "cursor": following}

    async def recent(self, client: _Connection) -> tuple[list[dict[str, object]], bool]:
        """Recover the newest records after a complexity failure, never a silent full snapshot."""
        await self.metadata(client, initial=True)
        messages: list[dict[str, object]] = []
        identifiers: set[str] = set()
        cursors: set[str] = set()
        size = RECENT_PAGE_SIZE
        params = {"limit": str(size), "order": "desc"}
        reduced = False
        while True:
            self.pages += 1
            if self.pages > MAX_PAGES:
                raise HistoryReadError("OpenCode history exceeded its page limit")
            try:
                status, envelope = await self.request(
                    client, f"{self.route}/message", params
                )
            except HistoryComplexityError:
                if size > 1:
                    size = max(1, size // 2)
                    params["limit"] = str(size)
                    continue
                # A single over-complex record cannot be skipped without its
                # cursor. Return only the newer records already validated.
                if not messages:
                    raise
                reduced = True
                break
            self.status(status, envelope)
            page = object_value(envelope)
            records = page.get("data")
            if not isinstance(records, list) or len(records) > size:
                raise HistoryReadError("OpenCode returned invalid history records")
            for record in records:
                self.remaining()
                self.records += 1
                if self.records > MAX_RECORDS:
                    raise HistoryReadError("OpenCode history exceeded its record limit")
                message = object_value(record)
                identifier = message.get("id")
                if not isinstance(identifier, str) or not identifier.startswith("msg_"):
                    raise HistoryReadError("OpenCode returned an invalid message ID")
                if identifier in identifiers:
                    raise ServiceRetryableError("OpenCode history pages overlap")
                identifiers.add(identifier)
                messages.append(message)
            following = _next_cursor(page.get("cursor"))
            if following is None:
                break
            if not records or following in cursors:
                raise ServiceRetryableError(
                    "OpenCode returned a repeated pagination cursor"
                )
            if len(messages) >= RECENT_RECORD_LIMIT:
                reduced = True
                break
            cursors.add(following)
            size = min(size, RECENT_RECORD_LIMIT - len(messages))
            # A cursor carries the ordering. Never combine it with order.
            params = {"limit": str(size), "cursor": following}
        # Apply the same before/after ownership checks as the full read.
        await self.metadata(client, initial=False)
        self.remaining()
        return list(reversed(messages)), reduced

    async def run(
        self, path: Path, *, allow_reduced: bool = False
    ) -> tuple[list[dict[str, object]], bool]:
        try:
            async with asyncio.timeout(self.remaining()):
                for attempt in range(2):
                    self.remaining()
                    url, password = _service(path)
                    try:
                        async with httpx.AsyncHTTPTransport(
                            trust_env=False, retries=0
                        ) as transport:
                            client = _Connection(url, password, transport)
                            try:
                                return await self.attempt(client), False
                            except HistoryComplexityError:
                                if not allow_reduced:
                                    raise
                                return await self.recent(client)
                    except ServiceRetryableError:
                        if attempt:
                            raise
        except TimeoutError:
            raise HistoryReadError(
                "OpenCode history exceeded its total deadline"
            ) from None
        raise HistoryReadError("Unable to read OpenCode history")


def _read_session(
    session_id: str,
    directory: Path | None,
    path: Path | None,
    *,
    allow_reduced: bool,
) -> tuple[list[dict[str, object]], bool]:
    # The public schema is ^ses, not a fixed alphanumeric UUID grammar.
    if not isinstance(session_id, str) or not session_id.startswith("ses"):
        raise HistoryReadError("Invalid OpenCode session ID")
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        read = _Read(session_id, directory)
        return asyncio.run(
            read.run(path or registration_path(), allow_reduced=allow_reduced)
        )
    raise HistoryReadError("OpenCode synchronous history must run in a worker thread")


def read_session(
    session_id: str, directory: Path | None, path: Path | None = None
) -> list[dict[str, object]]:
    """Full blocking history reader; async callers must use a worker thread."""
    return _read_session(session_id, directory, path, allow_reduced=False)[0]


def read_session_with_fallback(
    session_id: str, directory: Path | None, path: Path | None = None
) -> tuple[list[dict[str, object]], bool]:
    """Full history or recent records plus a true reduced-history indicator."""
    return _read_session(session_id, directory, path, allow_reduced=True)
