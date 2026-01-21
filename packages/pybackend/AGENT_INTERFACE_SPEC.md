# Agent CLI Interface Specification

## Overview

This document defines the interface contract between the AgentCLI abstraction and the backend API responses. The frontend expects specific response formats that must be maintained regardless of the underlying CLI implementation.

## Frontend Expected Response Types

### AgentReply (Primary Response)
```typescript
type AgentReply = {
  messageId: string;           // Unique message identifier (timestamp-based)
  sent: string;                // ISO timestamp when message was sent
  response: string;            // Combined text response for display
  prompt?: string;             // Original user message (optional)
  responses?: AgentResponsePart[]; // Structured response parts
  sessionId?: string;          // Session identifier for conversation continuity
};
```

### AgentResponsePart (Streaming Parts)
```typescript
type AgentResponsePart = {
  text: string;                // Content text (may be empty string)
  timestamp?: string;          // ISO timestamp
  type?: "thinking" | "tool" | "final"; // Response type classification
  partId?: string;             // Unique part identifier
  callId?: string;             // Tool call identifier
};
```

**Note**: The `text` field may contain empty strings when the underlying LLM produces empty responses. The frontend handles this by displaying "Empty message" in italics for better user experience.

### ChatHistoryMessage (History Export)
```typescript
type ChatHistoryMessage = {
  messageId?: string;          // Message identifier
  role: "user" | "assistant";  // Message role
  type: "text" | "tool" | "tool_use"; // Content type
  content: string;             // Message content (may be empty string)
  timestamp?: string | null;   // ISO timestamp
  partId?: string;             // Part identifier
  callId?: string;             // Call identifier
};
```

**Note**: The `content` field may contain empty strings when the underlying LLM produces empty responses. The frontend handles this gracefully.

### ChatHistoryResponse (History Container)
```typescript
type ChatHistoryResponse = {
  sessionId: string;           // Session identifier
  messages: ChatHistoryMessage[]; // Array of history messages
};
```

### ChatSession (Session List)
```typescript
type ChatSession = {
  id: string;                  // Session identifier
  title: string;               // Session title/summary
  updated: string;             // Last updated timestamp
};
```

### AgentStatus (Processing Status)
```typescript
type AgentStatus = {
  processing: boolean;         // Whether agent is currently processing
  startedAt?: string | null;   // ISO timestamp when processing started
};
```

## Required AgentCLI Result Types

To eliminate parsing from agent_service, AgentCLI implementations must return structured results:

### RunResult
```python
@dataclass
class RunResult:
    """Result of running an agent command."""
    success: bool
    session_id: str | None
    response_parts: list[ResponsePart]
    error_message: str | None
    
    @property
    def combined_response(self) -> str:
        """Get combined text response for display."""
        if not self.success and self.error_message:
            return self.error_message
        return "\n\n".join(part.text for part in self.response_parts if part.text)
```

### ResponsePart
```python
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
```

### ExportResult
```python
@dataclass
class ExportResult:
    """Result of exporting chat history."""
    success: bool
    session_id: str
    messages: list[HistoryMessage]
    error_message: str | None = None
```

### HistoryMessage
```python
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
```

### SessionListResult
```python
@dataclass
class SessionListResult:
    """Result of listing chat sessions."""
    success: bool
    sessions: list[SessionInfo]
    error_message: str | None = None
```

### SessionInfo
```python
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
```

### AgentListResult
```python
@dataclass
class AgentListResult:
    """Result of listing available agents."""
    success: bool
    agents: list[AgentInfo]
    error_message: str | None = None
```

### AgentInfo
```python
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
```

## Interface Contract

### AgentCLI Abstract Methods (Updated)

```python
class AgentCLI(ABC):
    @abstractmethod
    def run_agent(
        self, 
        message: str, 
        session_id: str | None, 
        agent: str | None,
        model: str | None,
        cwd: Path
    ) -> RunResult:
        """Run agent with message and return structured result."""
        
    @abstractmethod
    def export_session(
        self, 
        session_id: str, 
        cwd: Path | None
    ) -> ExportResult:
        """Export session history and return structured result."""
        
    @abstractmethod
    def list_sessions(self, cwd: Path | None) -> SessionListResult:
        """List available sessions and return structured result."""
        
    @abstractmethod
    def list_agents(self) -> AgentListResult:
        """List available agents and return structured result."""
```

## Benefits of This Approach

1. **Clean Separation**: AgentCLI handles all CLI-specific parsing internally
2. **Type Safety**: Structured results with proper typing
3. **Maintainability**: Changes to CLI output format only affect the specific implementation
4. **Testability**: Easy to mock structured results for testing
5. **Consistency**: Guaranteed consistent frontend interface regardless of CLI changes
6. **Error Handling**: Structured error reporting with success/failure indicators

## Migration Strategy

1. Create new result types and update AgentCLI interface
2. Update OpenCodeAgentCLI to return structured results
3. Simplify agent_service to use structured results directly
4. Remove all parsing logic from agent_service
5. Ensure all tests continue to pass with the new implementation
