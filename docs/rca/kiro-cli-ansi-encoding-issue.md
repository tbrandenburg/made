# Root Cause Analysis: Kiro CLI ANSI Encoding Issue

## Issue Summary

- **Issue Type**: Bug - Strange encodings in frontend chat when using Kiro CLI
- **Severity**: Medium
- **Status**: Identified
- **Reporter**: User observation during testing
- **Affected Component**: Kiro CLI integration with MADE frontend

## Problem Description

When using Kiro CLI through the MADE frontend chat interface, responses containing colored text display ANSI escape sequences instead of properly formatted text. This results in responses like:

```
␛[38;5;141m> ␛[0mHere's a poem about the ␛[38;5;10m.made␛[0m directory:␛[0m␛[0m
```

Instead of clean, readable text.

**Expected Behavior:**
- Kiro CLI responses should display as clean, readable text in the frontend
- ANSI color codes should be stripped or converted to appropriate HTML/CSS styling
- Users should see properly formatted text without escape sequences

**Actual Behavior:**
- ANSI escape sequences (␛[38;5;141m, ␛[0m, etc.) are displayed as literal text
- Responses appear with strange encoding characters
- The same response may appear twice - once with encoding issues, once clean

**Symptoms:**
- Visible ANSI escape sequences in chat responses
- Duplicate responses (encoded and clean versions)
- Poor user experience with unreadable formatted text

## Reproduction

**Steps to Reproduce:**
1. Navigate to workspace/.made directory in terminal
2. Use Kiro CLI through MADE frontend chat
3. Send a message that triggers a response with colored output (e.g., "Tell me a poem about that")
4. Observe ANSI escape sequences in the response

**Reproduction Verified:** Yes

**Actual Kiro CLI Output (with ANSI codes):**
```
^[[38;5;141m> ^[[0mHere's a short poem for you:^[[0m^[[0m

Code flows like rivers through the night,^[[0m^[[0m
Terminal windows glowing bright,^[[0m^[[0m
Functions dance and variables play,^[[0m^[[0m
Building dreams in digital clay.^[[0m^[[0m
```

**Database Location:** `~/.local/share/kiro-cli/data.sqlite3` (not the examples directory)

## Root Cause

### Affected Components

- **Files**: 
  - `packages/pybackend/kiro_agent_cli.py` (lines 73-85)
  - `packages/frontend/src/utils/chat.ts` (response processing)
- **Functions/Classes**: 
  - `KiroAgentCLI.run_agent()` method
  - `subprocess.run()` call with `text=True`
- **Dependencies**: subprocess module, Kiro CLI output processing

### Analysis

The root cause is confirmed by direct testing of Kiro CLI output. When running `kiro-cli chat --no-interactive --trust-all-tools`, the stdout contains ANSI escape sequences like:
- `^[[38;5;141m` (set foreground color)  
- `^[[0m` (reset formatting)

The `KiroAgentCLI.run_agent()` method captures this output using `subprocess.run()` with `text=True`, which preserves these escape sequences as literal text characters. The frontend then displays these sequences as-is instead of interpreting them as formatting instructions.

**Why This Occurs:**
1. Kiro CLI outputs colored text using ANSI escape sequences for terminal display
2. `subprocess.run(text=True)` captures raw stdout including ANSI codes
3. Backend treats ANSI codes as regular text content
4. Frontend displays escape sequences literally instead of as formatting

**Evidence from Direct Testing:**
```bash
cd workspace/.made
echo "Tell me a short poem" | kiro-cli chat --no-interactive --trust-all-tools | cat -v
# Output: ^[[38;5;141m> ^[[0mHere's a short poem for you:^[[0m^[[0m
```

**Database Analysis:**
- Conversations are stored in `~/.local/share/kiro-cli/data.sqlite3`
- The stored conversation data appears clean (ANSI codes may be processed during storage)
- The issue occurs during live `run_agent()` execution, not during history retrieval

**Code Location:**
```
packages/pybackend/kiro_agent_cli.py:73-85
```

**Relevant code snippet showing the issue:**
```python
process = subprocess.run(
    command, input=message, capture_output=True, text=True, cwd=cwd
)

if process.returncode == 0:
    # Parse kiro-cli output - for now, treat as simple text response
    response_text = (process.stdout or "").strip()  # ANSI codes preserved here
    response_parts = (
        [
            ResponsePart(
                text=response_text, timestamp=None, part_type="final"
            )
        ]
        if response_text
        else []
    )
```

### Related Issues

- This affects all Kiro CLI responses that include colored output
- The issue is specific to the Kiro CLI integration; OpenCode CLI may not have the same problem
- Frontend chat display logic doesn't handle ANSI escape sequences

## Impact Assessment

**Scope:**
- All Kiro CLI interactions through MADE frontend
- Affects readability of agent responses
- Does not impact functionality, only display quality

**Affected Features:**
- Repository agent chat when using Kiro CLI
- Knowledge base agent chat when using Kiro CLI  
- Constitution agent chat when using Kiro CLI
- Any chat interface using KiroAgentCLI backend

**Severity Justification:**
Medium severity because:
- Functionality works but user experience is degraded
- Text is still readable but with visual noise
- Affects all Kiro CLI users but doesn't break core features

**Data/Security Concerns:**
- No data corruption or security implications
- Issue is purely cosmetic/display related

## Proposed Fix

### Fix Strategy

Strip ANSI escape sequences from Kiro CLI output before processing in the backend. This ensures clean text reaches the frontend while preserving all functionality.

### Files to Modify

1. **packages/pybackend/kiro_agent_cli.py**
   - Changes: Add ANSI escape sequence stripping in `run_agent()` method
   - Reason: Remove color codes at source before creating ResponsePart objects

2. **packages/pybackend/kiro_agent_cli.py** (optional enhancement)
   - Changes: Add utility function for ANSI stripping that can be reused
   - Reason: Centralize ANSI handling for maintainability

### Alternative Approaches

1. **Frontend ANSI Processing**: Handle ANSI codes in the frontend to convert to HTML/CSS
   - Pros: Could preserve formatting as HTML styling
   - Cons: More complex, requires ANSI parsing library, affects multiple components

2. **Kiro CLI Configuration**: Configure Kiro CLI to output plain text
   - Pros: Fixes at source
   - Cons: May not be configurable, affects all Kiro CLI usage

3. **Backend ANSI Stripping** (Recommended): Strip ANSI codes in backend
   - Pros: Simple, centralized, doesn't affect other components
   - Cons: Loses color formatting (acceptable trade-off)

### Risks and Considerations

- **Risk**: Stripping ANSI codes removes color formatting
  - **Mitigation**: Acceptable since web interface doesn't need terminal colors
- **Risk**: Regex for ANSI stripping might be incomplete
  - **Mitigation**: Use well-tested ANSI stripping pattern or library
- **Side Effects**: None expected - only affects display formatting

### Testing Requirements

**Test Cases Needed:**
1. **Verify ANSI Stripping**: Test that ANSI escape sequences are removed from responses
2. **Verify No Regression**: Ensure normal text responses still work correctly  
3. **Verify Edge Cases**: Test responses with mixed ANSI codes and regular text

**Validation Commands:**
```bash
# Test Kiro CLI direct output (shows ANSI codes)
cd workspace/.made
echo "Tell me a short poem" | kiro-cli chat --no-interactive --trust-all-tools | cat -v

# Test backend KiroAgentCLI processing (confirms ANSI preservation)
cd packages/pybackend
python3 -c "
from kiro_agent_cli import KiroAgentCLI
from pathlib import Path
cli = KiroAgentCLI()
result = cli.run_agent('Tell me a short poem', None, None, Path('workspace/.made'))
print('Contains ANSI codes:', '\\\\033[' in result.response_parts[0].text)
print('Sample:', repr(result.response_parts[0].text[:100]))
"

# Expected output: Contains ANSI codes: True
# Sample: '\\x1b[38;5;141m> \\x1b[0mHere's a short poem...'
```

## Implementation Plan

1. **Add ANSI stripping utility function** to `kiro_agent_cli.py`
2. **Modify `run_agent()` method** to strip ANSI codes from `response_text`
3. **Add unit tests** for ANSI stripping functionality
4. **Test integration** with frontend chat interface
5. **Verify no regression** in existing functionality

## Next Steps

1. Review this RCA document
2. Implement the ANSI stripping fix in `KiroAgentCLI.run_agent()`
3. Add comprehensive tests for the fix
4. Test the fix with actual Kiro CLI responses in the frontend
5. Commit the changes with appropriate test coverage
