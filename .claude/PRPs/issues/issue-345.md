# PRP: Issue #345 - Enhance OpenCode database logging to include tool arguments/inputs

## Issue Information
- **Issue**: #345
- **Title**: Enhance OpenCode database logging to include tool arguments/inputs
- **Type**: ENHANCEMENT
- **Status**: Ready for Implementation

## Problem Statement
Currently, the OpenCode database version only logs tool names but not the tool arguments/inputs that were passed to those tools. This makes debugging and analysis more difficult compared to other agent implementations like Kiro.

## Root Cause Analysis
The issue is in two places:
1. `opencode_database_agent_cli.py:322-332` - Only stores tool name, not arguments
2. `agent_cli.py:99-103` - Only extracts tool name, not arguments

## Implementation Plan

### Files to Modify

#### 1. UPDATE: packages/pybackend/opencode_database_agent_cli.py:320-332

**Current Code (lines 320-332):**
```python
elif part_type == "tool":
    # Tool invocations - create separate tool message
    tool_name = part_data.get("tool", "")
    if tool_name:
        messages.append(
            HistoryMessage(
                message_id=f"{msg_id}_tool_{part['id']}",
                role=role,
                content_type="tool_use",
                content=tool_name,
                timestamp=part_timestamp,
            )
        )
```

**New Code:**
```python
elif part_type == "tool":
    # Tool invocations - create separate tool message
    tool_name = part_data.get("tool", "")
    tool_args = part_data.get("args", {})
    
    if tool_name:
        # Format tool call with arguments (following Kiro pattern)
        tool_info = [f"Tool: {tool_name}"]
        for key, value in tool_args.items():
            value_str = str(value)
            if len(value_str) > 200:
                value_str = value_str[:200] + "..."
            tool_info.append(f"  {key}: {value_str}")
        
        messages.append(
            HistoryMessage(
                message_id=f"{msg_id}_tool_{part['id']}",
                role=role,
                content_type="tool_use",
                content="\n".join(tool_info),
                timestamp=part_timestamp,
            )
        )
```

#### 2. UPDATE: packages/pybackend/agent_cli.py:99-103

**Current Code (lines 99-103):**
```python
if part_type in {"tool_use", "tool"}:
    for key in ("tool", "name", "id"):
        if part.get(key):
            return str(part[key])
    return ""
```

**New Code:**
```python
if part_type in {"tool_use", "tool"}:
    # Check for tool name first
    tool_name = None
    for key in ("tool", "name"):
        if part.get(key):
            tool_name = str(part[key])
            break
    
    if tool_name:
        # Format with arguments if available (following Kiro pattern)
        tool_args = part.get("args", {})
        if tool_args:
            tool_info = [f"Tool: {tool_name}"]
            for key, value in tool_args.items():
                value_str = str(value)
                if len(value_str) > 200:
                    value_str = value_str[:200] + "..."
                tool_info.append(f"  {key}: {value_str}")
            return "\n".join(tool_info)
        else:
            return f"Tool: {tool_name}"
    
    # Fallback to ID if no name found
    if part.get("id"):
        return str(part["id"])
    return ""
```

## Patterns to Follow
- Use the same formatting pattern as `kiro_agent_cli.py:332-338`
- Truncate values longer than 200 characters with "..."
- Format as "Tool: {name}" followed by "  {key}: {value}" for each argument

## Validation Commands
```bash
# Check Python syntax
cd packages/pybackend && python -m py_compile opencode_database_agent_cli.py
cd packages/pybackend && python -m py_compile agent_cli.py

# Run type check if available
cd packages/pybackend && python -m mypy opencode_database_agent_cli.py --ignore-missing-imports
cd packages/pybackend && python -m mypy agent_cli.py --ignore-missing-imports

# Test the changes
python -m pytest packages/pybackend/tests/ -v
```

## Test Cases to Add
No new test files needed - this is a display formatting change that should be manually verified by running the agent and checking log output.

## Success Criteria
- [ ] Tool arguments are displayed in OpenCode database logs
- [ ] Arguments are properly truncated for readability (200 char limit)
- [ ] Implementation follows Kiro agent pattern
- [ ] No syntax or type errors
- [ ] Existing functionality remains unchanged