"""Convert public V2 projected records, preserving timeline and block identities."""

from collections.abc import Callable
import time
from typing import Literal

from agent_results import HistoryMessage
from opencode_v2_http_history import HistoryReadError, object_value


def _time(value: object) -> int:
    created = object_value(value).get("created")
    if (
        isinstance(created, bool)
        or not isinstance(created, (float, int))
        or not -62135596800000 <= created <= 253402300799999
    ):
        raise HistoryReadError("OpenCode returned an invalid message timestamp")
    return int(created)


def _alias(part: dict[str, object], keys: tuple[str, ...]) -> str | None:
    for key in keys:
        if key in part:
            value = part[key]
            if not isinstance(value, str) or not value:
                raise HistoryReadError("OpenCode returned an invalid part identity")
            return value
    return None


def _record_info(record: dict[str, object]) -> tuple[str, str]:
    identifier = record.get("id")
    kind = record.get("type")
    if not isinstance(identifier, str) or not identifier.startswith("msg_"):
        raise HistoryReadError("OpenCode returned an invalid message ID")
    if not isinstance(kind, str) or not kind:
        raise HistoryReadError("OpenCode returned an invalid message type")
    return identifier, kind


def _block(
    part: dict[str, object],
    identifier: str,
    timestamp: int,
    format_tool: Callable[[dict[str, object]], str],
) -> HistoryMessage | None:
    kind = part.get("type")
    if not isinstance(kind, str) or not kind:
        raise HistoryReadError("OpenCode returned an invalid content type")
    if kind not in {"text", "reasoning", "tool"}:
        # Unknown future blocks have no defined display semantics.
        return None
    part_id = _alias(part, ("partID", "partId"))
    call_id = _alias(part, ("callID", "callId", "id")) if kind == "tool" else None
    created = _time(part["time"]) if "time" in part else timestamp
    if kind == "tool":
        name = part.get("tool", part.get("name"))
        if not isinstance(name, str) or not name or not call_id:
            raise HistoryReadError("OpenCode returned malformed tool content")
        object_value(part.get("state"))
        text = format_tool(part)
    else:
        text = part.get("text")
        if not isinstance(text, str):
            raise HistoryReadError("OpenCode returned malformed assistant text")
    if not text:
        return None
    content_type: Literal["tool_use", "text", "reasoning"] = (
        "tool_use" if kind == "tool" else "text" if kind == "text" else "reasoning"
    )
    return HistoryMessage(
        identifier,
        "assistant",
        content_type,
        text,
        created,
        part_id,
        call_id,
    )


def _check_deadline(deadline: float | None) -> None:
    if deadline is not None and time.monotonic() >= deadline:
        raise HistoryReadError("OpenCode history exceeded its total deadline")


def convert_history(
    records: list[dict[str, object]],
    format_tool: Callable[[dict[str, object]], str],
    deadline: float | None = None,
) -> list[HistoryMessage]:
    messages: list[HistoryMessage] = []
    for record in records:
        _check_deadline(deadline)
        identifier, kind = _record_info(record)
        if kind not in {"user", "assistant"}:
            # Projected events (system/synthetic/skill/shell/compaction/idle,
            # agent/model/location switches) and future event types are not chat.
            continue
        timestamp = _time(record.get("time"))
        if kind == "user":
            text = record.get("text")
            if not isinstance(text, str):
                raise HistoryReadError("OpenCode returned malformed user text")
            if text:
                messages.append(
                    HistoryMessage(identifier, "user", "text", text, timestamp)
                )
            continue
        content = record.get("content")
        if not isinstance(content, list):
            raise HistoryReadError("OpenCode returned malformed assistant content")
        for index, value in enumerate(content):
            _check_deadline(deadline)
            message = _block(
                object_value(value), f"{identifier}:{index}", timestamp, format_tool
            )
            if message is not None:
                messages.append(message)
    _check_deadline(deadline)
    return messages
