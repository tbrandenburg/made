"""Typed result classes for AgentCLI implementations."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Literal


@dataclass
class ResponsePart:
    """Individual response part from agent."""
    text: str
    timestamp: int | None  # Unix timestamp in milliseconds
    part_type: Literal["thinking", "tool", "final"]
    part_id: str | None = None
    call_id: str | None = None
    
    def to_frontend_format(self) -> dict[str, object]:
        """Convert to frontend AgentResponsePart format."""
        result = {
            "text": self.text,
            "type": self.part_type,
        }
        if self.timestamp is not None:
            dt = datetime.fromtimestamp(self.timestamp / 1000, tz=UTC)
            result["timestamp"] = dt.isoformat(timespec="milliseconds").replace("+00:00", "Z")
        if self.part_id:
            result["partId"] = self.part_id
        if self.call_id:
            result["callId"] = self.call_id
        return result


@dataclass
class RunResult:
    """Result of running an agent command."""
    success: bool
    session_id: str | None
    response_parts: list[ResponsePart]
    error_message: str | None = None
    
    @property
    def combined_response(self) -> str:
        """Get combined text response for display."""
        if not self.success and self.error_message:
            return self.error_message
        return "\n\n".join(part.text for part in self.response_parts if part.text)


@dataclass
class HistoryMessage:
    """Individual message in chat history."""
    message_id: str | None
    role: Literal["user", "assistant"]
    content_type: Literal["text", "tool", "tool_use"]
    content: str
    timestamp: int | None  # Unix timestamp in milliseconds
    part_id: str | None = None
    call_id: str | None = None
    
    def to_frontend_format(self) -> dict[str, object]:
        """Convert to frontend ChatHistoryMessage format."""
        result = {
            "role": self.role,
            "type": self.content_type,
            "content": self.content,
        }
        if self.message_id:
            result["messageId"] = self.message_id
        if self.timestamp is not None:
            dt = datetime.fromtimestamp(self.timestamp / 1000, tz=UTC)
            result["timestamp"] = dt.isoformat(timespec="milliseconds").replace("+00:00", "Z")
        else:
            result["timestamp"] = None
        if self.part_id:
            result["partId"] = self.part_id
        if self.call_id:
            result["callId"] = self.call_id
        return result


@dataclass
class ExportResult:
    """Result of exporting chat history."""
    success: bool
    session_id: str
    messages: list[HistoryMessage]
    error_message: str | None = None


@dataclass
class SessionInfo:
    """Information about a chat session."""
    session_id: str
    title: str
    updated: str  # Human-readable timestamp
    
    def to_frontend_format(self) -> dict[str, str]:
        """Convert to frontend ChatSession format."""
        return {
            "id": self.session_id,
            "title": self.title,
            "updated": self.updated,
        }


@dataclass
class SessionListResult:
    """Result of listing chat sessions."""
    success: bool
    sessions: list[SessionInfo]
    error_message: str | None = None


@dataclass
class AgentInfo:
    """Information about an available agent."""
    name: str
    agent_type: str
    details: list[str]
    
    def to_frontend_format(self) -> dict[str, object]:
        """Convert to frontend agent format."""
        return {
            "name": self.name,
            "type": self.agent_type,
            "details": self.details,
        }


@dataclass
class AgentListResult:
    """Result of listing available agents."""
    success: bool
    agents: list[AgentInfo]
    error_message: str | None = None
