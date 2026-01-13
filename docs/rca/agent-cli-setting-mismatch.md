# Root Cause Analysis: Agent CLI Setting Mismatch

## Issue Summary

- **Issue Type**: Configuration Bug
- **Title**: Agent CLI setting shows "kiro" but "opencode" still responds
- **Reporter**: User observation
- **Severity**: Medium
- **Status**: Identified

## Problem Description

Despite changing the `agentCli` setting to "kiro" in the frontend settings page, the system continues to use the OpenCode agent instead of the Kiro CLI agent.

**Expected Behavior:**
When `agentCli` is set to "kiro" in settings, the system should use KiroAgentCLI for agent interactions.

**Actual Behavior:**
The system continues to use OpenCodeAgentCLI even when the setting shows "kiro".

**Symptoms:**
- Settings page shows agentCli as "kiro-cli" 
- Agent responses still come from OpenCode instead of Kiro CLI
- No error messages or indication of the mismatch

## Reproduction

**Steps to Reproduce:**
1. Navigate to Settings page
2. Change agentCli dropdown from "opencode" to "kiro-cli"
3. Save settings
4. Send a message to any agent
5. Observe that OpenCode still responds instead of Kiro CLI

**Reproduction Verified:** Yes

## Root Cause

### Affected Components

- **Files**: 
  - `/packages/pybackend/agent_service.py` (line 26)
  - `/packages/frontend/src/pages/SettingsPage.tsx` (line 9)
  - `/packages/pybackend/settings_service.py` (line 19)

- **Functions/Classes**: 
  - `get_agent_cli()` in agent_service.py
  - Settings dropdown options in SettingsPage.tsx

### Analysis

The root cause is a **value mismatch** between the frontend and backend for the agentCli setting:

1. **Frontend sends**: `"kiro-cli"` (from dropdown options)
2. **Backend expects**: `"kiro"` (hardcoded in conditional check)
3. **Settings file contains**: `"kiro-cli"` (what frontend saved)
4. **Backend logic**: Falls back to OpenCode for any value != "kiro"

**Why This Occurs:**
The frontend dropdown uses `"kiro-cli"` as the option value, but the backend conditional logic only checks for `"kiro"`. This mismatch causes the backend to always fall through to the default OpenCode implementation.

**Code Location:**
```
packages/pybackend/agent_service.py:26
if agent_cli_setting == "kiro":  # Only matches "kiro", not "kiro-cli"
    return KiroAgentCLI()
else:
    # Default to OpenCode for any other value (including "kiro-cli")
    return OpenCodeAgentCLI()
```

**Frontend Code:**
```
packages/frontend/src/pages/SettingsPage.tsx:9
const agentCliOptions = ["opencode", "kiro-cli"];  # Sends "kiro-cli"
```

### Related Issues

This is a classic frontend-backend contract mismatch where the API consumer and provider have different expectations for valid values.

## Impact Assessment

**Scope:**
All agent interactions when user attempts to use Kiro CLI

**Affected Features:**
- Agent chat in repositories
- Agent chat in knowledge articles  
- Agent chat in constitutions
- Any feature that uses `get_agent_cli()`

**Severity Justification:**
Medium - Feature doesn't work as configured, but system remains stable and functional with OpenCode fallback.

**Data/Security Concerns:**
None - this is a configuration routing issue with no data corruption or security implications.

## Proposed Fix

### Fix Strategy

Standardize the agentCli value to use consistent naming between frontend and backend. The cleanest approach is to use `"kiro"` consistently since:
1. It's shorter and cleaner
2. Backend already expects this value
3. Minimal changes required

### Files to Modify

1. **packages/frontend/src/pages/SettingsPage.tsx**
   - Changes: Change `"kiro-cli"` to `"kiro"` in agentCliOptions array
   - Reason: Align frontend dropdown with backend expectations

2. **packages/pybackend/settings_service.py** 
   - Changes: Update comment to reflect supported values
   - Reason: Documentation accuracy

### Alternative Approaches

**Alternative 1**: Change backend to accept `"kiro-cli"`
- Pros: No frontend changes needed
- Cons: Less clean naming, requires backend logic change

**Alternative 2**: Support both values in backend
- Pros: Backward compatibility
- Cons: Unnecessary complexity for a simple mismatch

**Chosen approach is better because**: It's the minimal change that creates consistency and the backend logic is already correct.

### Risks and Considerations

- **Risk**: Users who manually edited settings.json to use "kiro-cli" will need to update
- **Mitigation**: This is likely a very small number since the issue was just discovered
- **Side effects**: None - this is a pure configuration value change
- **Breaking changes**: Minimal - only affects users who manually set "kiro-cli" in settings

### Testing Requirements

**Test Cases Needed:**
1. Verify dropdown shows "kiro" option
2. Verify selecting "kiro" saves correctly to settings.json
3. Verify agent_service.get_agent_cli() returns KiroAgentCLI when setting is "kiro"
4. Verify agent responses come from Kiro CLI when setting is "kiro"
5. Verify OpenCode still works when setting is "opencode"

**Validation Commands:**
```bash
# Check settings file after frontend change
cat workspace/.made/settings.json

# Test agent CLI selection in Python
cd packages/pybackend
uv run python -c "
from agent_service import get_agent_cli
from settings_service import read_settings
print('Settings:', read_settings())
cli = get_agent_cli()
print('Selected CLI:', cli.__class__.__name__)
"
```

## Implementation Plan

1. Update frontend dropdown to use "kiro" instead of "kiro-cli"
2. Update settings service comment for accuracy
3. Test the fix with both dropdown options
4. Verify agent responses switch correctly

This RCA document should be used by `/implement-fix` command.

## Next Steps

1. Review this RCA document
2. Implement the fix by updating the frontend dropdown value
3. Test the configuration switching works correctly
4. Update any existing settings.json files that contain "kiro-cli"
