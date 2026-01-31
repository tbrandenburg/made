# Fix: Kiro Conversation History - Missing Timestamps and Tool Usage

## Issue Summary
- **Date**: 2026-01-15
- **Component**: `packages/pybackend/kiro_agent_cli.py`
- **Severity**: Medium
- **Status**: Fixed

## Problem Description

When exporting Kiro CLI conversation history through MADE, the following issues were observed:

1. **Missing timestamps for assistant messages**: All assistant responses showed `null` timestamps
2. **Empty content for tool usage**: Tool use messages only showed the thinking text, not the actual tool calls
3. **Inconsistent data**: Frontend displayed "Invalid timestamp" and empty messages for tool interactions

## Root Cause

The `_parse_conversation_history()` method in `kiro_agent_cli.py` was not extracting available metadata from the Kiro SQLite database:

1. **Timestamps**: The code set `timestamp=None` for assistant messages, but `request_metadata.stream_end_timestamp_ms` was available in the database
2. **Tool information**: The code only extracted `tool_data.get("content", "")` but ignored the rich `tool_uses` array containing tool names and arguments

### Database Structure (Kiro)

```json
{
  "history": [
    {
      "user": { "timestamp": "2026-01-15T08:43:02.140692324+01:00", ... },
      "assistant": {
        "ToolUse": {
          "message_id": "...",
          "content": "I'll switch to the main branch...",
          "tool_uses": [
            {
              "id": "tooluse_...",
              "name": "execute_bash",
              "args": {
                "command": "git checkout main && git pull",
                "summary": "Switch to main branch..."
              }
            }
          ]
        }
      },
      "request_metadata": {
        "request_start_timestamp_ms": 1768462982145,
        "stream_end_timestamp_ms": 1768462986492,
        ...
      }
    }
  ]
}
```

## Solution

Enhanced the `_parse_conversation_history()` method to:

1. **Extract timestamps from metadata**: Use `request_metadata.stream_end_timestamp_ms` for assistant messages
2. **Parse tool usage information**: Extract tool names and arguments from `tool_uses` array
3. **Format tool information**: Display tool calls in a readable format with tool name and arguments

### Code Changes

```python
# Extract timestamp from metadata
metadata = exchange.get("request_metadata", {})
assistant_timestamp_ms = metadata.get("stream_end_timestamp_ms")

# For tool use messages, format tool information
if "ToolUse" in assistant_msg:
    tool_data = assistant_msg["ToolUse"]
    tool_uses = tool_data.get("tool_uses", [])
    
    # Format tool usage information
    content_parts = [tool_data.get("content", "")]
    if tool_uses:
        tool_info = []
        for tool in tool_uses:
            tool_name = tool.get("name", "unknown")
            tool_args = tool.get("args", {})
            tool_info.append(f"Tool: {tool_name}")
            for key, value in tool_args.items():
                tool_info.append(f"  {key}: {value}")
        content_parts.append("\n".join(tool_info))
    
    messages.append(
        HistoryMessage(
            message_id=tool_data.get("message_id"),
            role="assistant",
            content_type="tool_use",
            content="\n\n".join(filter(None, content_parts)),
            timestamp=assistant_timestamp_ms,
        )
    )
```

## Verification

### Before Fix
- Messages with missing timestamps: 20+ (all assistant messages)
- Messages with empty content: 10+ (all tool use messages)
- Tool use messages: Showed only thinking text

### After Fix
- Messages with missing timestamps: 0
- Messages with empty content: 0
- Tool use messages: Show thinking text + formatted tool calls with arguments

### Sample Output

```
Role: assistant
Type: tool_use
Timestamp: 1768462986492
Content:
I'll switch to the main branch and pull the latest changes.

Tool: execute_bash
  command: git checkout main && git pull
  summary: Switch to main branch and pull latest changes
```

## Testing

All existing tests pass:
```bash
cd packages/pybackend
python3 -m pytest tests/unit/test_kiro_agent_cli.py -v
# 18 passed in 0.12s
```

## Impact

- ✅ Conversation history now shows accurate timestamps for all messages
- ✅ Tool usage information is properly displayed with tool names and arguments
- ✅ Frontend can correctly format and display conversation history
- ✅ No breaking changes to existing functionality
- ✅ All existing tests continue to pass

## Related Issues

- [kiro-cli-ansi-encoding-issue.md](./kiro-cli-ansi-encoding-issue.md) - ANSI escape sequence handling
