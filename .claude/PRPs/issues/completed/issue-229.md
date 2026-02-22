# Investigation: Architecture: Unify live chat and export parsing logic to prevent inconsistencies

**Issue**: #229 (https://github.com/tbrandenburg/made/issues/229)
**Type**: REFACTOR
**Investigated**: 2026-02-22T20:43:15Z

### Assessment

| Metric     | Value  | Reasoning                                                                                                   |
| ---------- | ------ | ----------------------------------------------------------------------------------------------------------- |
| Priority   | HIGH   | Architectural debt causing user-visible bugs (empty messages) and blocking maintainability of parsing logic |
| Complexity | HIGH   | 15+ files affected across backend/frontend, dual parsing logic removal, breaking changes to 5 agent CLIs   |
| Confidence | HIGH   | Clear evidence of inconsistency from tests, well-defined architecture problem with concrete solution path    |

---

## Problem Statement

The OpenCode database agent CLI currently maintains two separate parsing paths for the same conversation data: live chat parsing (via `responses` field) and export parsing (via `export_session()` API). This architectural duplication causes inconsistencies where empty `[agent:final]` messages appear in live chat but not in export mode, creating user confusion and maintenance burden.

---

## Analysis

### Root Cause / Change Rationale

The dual-parsing architecture was introduced in commit `26d677bd` on 2026-02-21 when the OpenCode database agent CLI was first implemented. The architecture creates two completely separate code paths for processing the same agent conversation data, leading to divergent parsing logic that handles edge cases differently.

### Evidence Chain

**SYMPTOM**: Empty `[agent:final]` messages in live chat vs correct content in export

**↓ BECAUSE**: Different reasoning content handling between parsing paths

Evidence: `packages/pybackend/opencode_database_agent_cli.py:430` - Live parsing maps reasoning to "thinking"
```python
elif part_type_raw in ["thinking", "reasoning"]:
    part_type = "thinking"
```

**↓ BECAUSE**: Export parsing extracts reasoning text while live parsing discards it

Evidence: `packages/pybackend/opencode_database_agent_cli.py:293-297` - Export parsing includes reasoning in text
```python
elif part_type == "reasoning":
    # Assistant reasoning steps - add as text content
    part_content = part_data.get("text", "")
    if part_content:
        text_parts.append(part_content)
```

**↓ ROOT CAUSE**: Two separate parsing implementations with different logic

Evidence: `packages/pybackend/opencode_database_agent_cli.py:402-448` vs `175-371` - Completely separate functions with divergent content extraction logic

### Affected Files

| File                                                         | Lines    | Action | Description                                          |
| ------------------------------------------------------------ | -------- | ------ | ---------------------------------------------------- |
| `packages/pybackend/agent_service.py`                       | 434-435  | UPDATE | Remove responses field processing                    |
| `packages/pybackend/agent_results.py`                       | 45-70    | UPDATE | Simplify RunResult, remove ResponsePart conversion   |
| `packages/pybackend/opencode_database_agent_cli.py`         | 402-448  | DELETE | Remove _parse_opencode_output method                 |
| `packages/pybackend/copilot_agent_cli.py`                   | FULL     | UPDATE | Simplify to process management only                  |
| `packages/pybackend/codex_agent_cli.py`                     | FULL     | UPDATE | Simplify to process management only                  |
| `packages/pybackend/kiro_agent_cli.py`                      | FULL     | UPDATE | Simplify to process management only                  |
| `packages/pybackend/agent_cli.py`                           | FULL     | UPDATE | Remove response parsing from base class              |
| `packages/frontend/src/hooks/useApi.ts`                     | 147-159  | UPDATE | Remove responses field from AgentReply               |
| `packages/frontend/src/utils/chat.ts`                       | 60-88    | UPDATE | Simplify mapAgentReplyToMessages                     |
| `packages/frontend/src/pages/RepositoryPage.tsx`            | 830      | UPDATE | Remove immediate response processing                  |
| `packages/frontend/src/pages/TaskPage.tsx`                  | FULL     | UPDATE | Remove immediate response processing                  |
| `packages/frontend/src/pages/KnowledgeArtefactPage.tsx`     | FULL     | UPDATE | Remove immediate response processing                  |
| `packages/frontend/src/pages/ConstitutionPage.tsx`          | FULL     | UPDATE | Remove immediate response processing                  |
| All test files                                               | MULTIPLE | UPDATE | Update assertions to reflect single parsing path     |

### Integration Points

- `packages/pybackend/agent_service.py:435` - Converts ResponsePart[] to frontend format
- `packages/frontend/src/utils/chat.ts:60` - Processes AgentReply.responses in live chat
- `packages/frontend/src/utils/chat.ts:105` - Processes export API responses separately
- All 4 frontend pages use both `mapAgentReplyToMessages()` and `mapHistoryToMessages()`

### Git History

- **Introduced**: `26d677bd` - 2026-02-21 - "fix(impl): add missing OpenCodeDatabaseAgentCLI implementation and tests"
- **Recent fixes**: `5dad034` - 2026-02-21 - "fix(opencode): handle reasoning content in live chat parsing"
- **Implication**: Recent architecture with already identified parsing inconsistency bugs

---

## Implementation Plan

### Step 1: Remove responses field from AgentReply type (Breaking Change)

**File**: `packages/frontend/src/hooks/useApi.ts`
**Lines**: 147-159
**Action**: UPDATE

**Current code:**
```typescript
export type AgentReply = {
  messageId: string;
  sent: string;
  response: string;
  prompt?: string;
  responses?: AgentResponsePart[];  // REMOVE THIS
  sessionId?: string;
};

export type AgentResponsePart = {  // REMOVE THIS ENTIRE TYPE
  text: string;
  timestamp?: string;
  type?: "thinking" | "tool" | "final";
  partId?: string;
  callId?: string;
};
```

**Required change:**
```typescript
export type AgentReply = {
  messageId: string;
  sent: string;
  response: string;                 // Status message only
  prompt?: string;
  sessionId?: string;
  processing?: boolean;             // NEW: indicates polling needed
};

// AgentResponsePart type removed entirely
```

**Why**: Eliminates the dual-parsing architecture by removing structured responses from live API

---

### Step 2: Simplify backend AgentReply creation

**File**: `packages/pybackend/agent_service.py`
**Lines**: 434-435
**Action**: UPDATE

**Current code:**
```python
return {
    "messageId": str(int(time.time() * 1000)),
    "sent": sent_at,
    "prompt": message,
    "response": response,
    "responses": [part.to_frontend_format() for part in result.response_parts],
    "sessionId": session_id,
}
```

**Required change:**
```python
return {
    "messageId": str(int(time.time() * 1000)),
    "sent": sent_at,
    "prompt": message,
    "response": "Processing...",      # Status message only
    "sessionId": session_id,
    "processing": True,              # Indicates polling needed
}
```

**Why**: Removes complex response parsing from live API, making it process-management only

---

### Step 3: Remove live parsing from OpenCode agent CLI

**File**: `packages/pybackend/opencode_database_agent_cli.py`
**Lines**: 402-448
**Action**: DELETE

**Current code:**
```python
def _parse_opencode_output(
    self, stdout: str
) -> tuple[str | None, list[ResponsePart]]:
    """Parse opencode JSON output into structured response parts."""
    # Complex parsing logic with 47 lines
```

**Required change:**
```python
# Method removed entirely - export_session() becomes the only parsing path
```

**Why**: Eliminates the inconsistent live parsing logic, keeping only the consistent export parsing

---

### Step 4: Simplify frontend message mapping

**File**: `packages/frontend/src/utils/chat.ts`
**Lines**: 60-88
**Action**: UPDATE

**Current code:**
```typescript
export const mapAgentReplyToMessages = (reply: AgentReply): ChatMessage[] => {
  const parts: AgentReply["responses"] =
    reply.responses && reply.responses.length
      ? reply.responses
      : reply.response
        ? [{ text: reply.response, timestamp: reply.sent, type: "final" }]
        : [];

  return parts
    .filter((part) => part.text && part.text.trim() !== "")
    .map((part, index) => ({
      id: reply.messageId + "-" + index,
      role: "agent" as const,
      text: part.text,
      timestamp: part.timestamp || reply.sent,
      messageType:
        part.type === "thinking"
          ? "thinking"
          : part.type === "tool"
            ? "tool"
            : "final",
    }));
};
```

**Required change:**
```typescript
export const mapAgentReplyToMessages = (reply: AgentReply): ChatMessage[] => {
  if (reply.processing) {
    return []; // Empty - polling handles content via export API
  }
  
  // Fallback for error cases only
  return reply.response ? [{
    id: reply.messageId,
    role: "agent" as const,
    text: reply.response,
    timestamp: reply.sent,
    messageType: "final" as const
  }] : [];
};
```

**Why**: Dramatically simplifies live message processing since all content comes via polling

---

### Step 5: Update frontend page handlers

**File**: `packages/frontend/src/pages/RepositoryPage.tsx`
**Lines**: 830
**Action**: UPDATE

**Current code:**
```typescript
const handleSendMessage = async (prompt?: string) => {
  setChatLoading(true);
  const reply = await api.sendAgentMessage(name, message, sessionId, model);
  setChat(prev => [...prev, ...mapAgentReplyToMessages(reply)]);
  if (reply.sessionId) setSessionId(reply.sessionId);
  setChatLoading(false);
};
```

**Required change:**
```typescript
const handleSendMessage = async (prompt?: string) => {
  setChatLoading(true);
  const reply = await api.sendAgentMessage(name, message, sessionId, model);
  
  // No immediate message processing - polling handles everything
  if (reply.sessionId) setSessionId(reply.sessionId);
  
  // Keep chatLoading=true if processing (triggers existing polling)
  if (!reply.processing) setChatLoading(false);
};
```

**Why**: Removes immediate processing, letting existing polling mechanism handle all content

---

### Step 6: Simplify RunResult class

**File**: `packages/pybackend/agent_results.py`
**Lines**: 45-70
**Action**: UPDATE

**Current code:**
```python
@dataclass
class RunResult:
    success: bool
    response_parts: list[ResponsePart] = field(default_factory=list)
    session_id: str | None = None
    error_message: str | None = None
```

**Required change:**
```python
@dataclass
class RunResult:
    success: bool
    session_id: str | None = None
    error_message: str | None = None
    response_parts: list[ResponsePart] = field(default_factory=list)  # Keep for compatibility
```

**Why**: Keeps compatibility while removing dependency on response_parts for live functionality

---

### Step 7: Update all agent CLI implementations

**File**: `packages/pybackend/copilot_agent_cli.py`, `codex_agent_cli.py`, `kiro_agent_cli.py`
**Lines**: FULL
**Action**: UPDATE

**Current pattern:**
```python
def run_agent(self, ...) -> RunResult:
    # Complex parsing logic
    parts = [ResponsePart(...)]
    return RunResult(success=True, response_parts=parts)
```

**Required change:**
```python
def run_agent(self, ...) -> RunResult:
    # Process management only
    session_id = self._start_subprocess_and_get_session_id()
    return RunResult(success=True, session_id=session_id, response_parts=[])
```

**Why**: Simplifies all agent CLIs to process management, unifying architecture

---

### Step 8: Update all test assertions

**File**: All test files in `packages/pybackend/tests/`
**Action**: UPDATE

**Current pattern:**
```python
assert result.response_parts[0].text == "Expected content"
assert result.response_parts[0].part_type == "final"
```

**Required change:**
```python
assert result.success == True
assert result.session_id is not None
# Test export consistency only
export_result = cli.export_session(result.session_id)
assert export_result.messages[0].content == "Expected content"
```

**Why**: Tests focus on single source of truth (export API) rather than dual parsing paths

---

## Patterns to Follow

**From codebase - existing polling mechanism:**
```typescript
// SOURCE: packages/frontend/src/pages/RepositoryPage.tsx:761
// Pattern for polling-based message retrieval
useEffect(() => {
  if (chatLoading && sessionId) {
    const interval = setInterval(async () => {
      const history = await api.exportChatHistory(sessionId);
      setChat(mapHistoryToMessages(history.messages));
    }, 2000);
    return () => clearInterval(interval);
  }
}, [chatLoading, sessionId]);
```

**Existing export API usage:**
```typescript
// SOURCE: packages/frontend/src/utils/chat.ts:105-134
// Pattern for processing export API responses
export const mapHistoryToMessages = (messages: ChatHistoryMessage[]): ChatMessage[] => {
  return messages
    .filter((msg) => msg.content && msg.content.trim() !== "")
    .map((msg) => ({
      id: msg.messageId || generateId(),
      role: msg.role === "user" ? "user" : "agent",
      text: msg.content,
      timestamp: msg.timestamp || new Date().toISOString(),
      messageType: msg.type === "tool" || msg.type === "tool_use" ? "tool" : "final",
    }));
};
```

---

## Edge Cases & Risks

| Risk/Edge Case                              | Mitigation                                                    |
| ------------------------------------------- | ------------------------------------------------------------- |
| Breaking change impacts API consumers       | Provide migration guide and version bump                      |
| Polling performance with many active chats | Existing polling already handles this efficiently             |
| Error handling without immediate feedback   | Status messages in response field provide immediate feedback  |
| Session ID not generated                    | Fallback error handling in response field                     |
| Export API failure during polling          | Existing error boundaries handle export API failures         |

---

## Validation

### Automated Checks

```bash
# Backend validation
cd packages/pybackend && uv run python -m pytest tests/unit/ -v
cd packages/pybackend && uv run python -m pytest tests/integration/ -v
cd packages/pybackend && uv run mypy . --strict

# Frontend validation  
npm run type-check
npm test -- --testPathPattern="chat" --verbose
npm run lint

# Integration validation
make run  # Start both services
# Manual test: Send message, verify polling retrieves content correctly
```

### Manual Verification

1. **Start services**: Verify both backend and frontend start without errors
2. **Send agent message**: Confirm immediate response has processing=true, no content
3. **Verify polling**: Confirm chat updates via export API polling with correct content
4. **Test error cases**: Verify fallback messages appear when export fails
5. **Check consistency**: Verify no empty message inconsistencies between live/export

---

## Scope Boundaries

**IN SCOPE:**

- Remove responses field from AgentReply type and all processing
- Simplify all agent CLI implementations to process management only
- Update frontend to use polling-only architecture
- Update all tests to reflect single parsing path
- Provide migration documentation

**OUT OF SCOPE (do not touch):**

- Export API implementation (keep unchanged - it works correctly)
- Polling mechanism in frontend (keep unchanged - it works correctly)
- Database schema changes (not needed)
- WebSocket implementation (future enhancement)
- Other agent types beyond the 5 CLI implementations

---

## Metadata

- **Investigated by**: Claude
- **Timestamp**: 2026-02-22T20:43:15Z
- **Artifact**: `.claude/PRPs/issues/issue-229.md`