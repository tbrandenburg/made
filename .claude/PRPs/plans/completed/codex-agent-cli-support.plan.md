# Codex Agent CLI Support Implementation Plan

## Overview

Transform MADE to support Codex Cloud as an AI agent option alongside existing OpenCode and GitHub Copilot integrations. This adds a third agent choice giving users access to Codex's specialized development capabilities with real-world tested implementation patterns.

**Feature Type**: NEW_CAPABILITY  
**Complexity**: MEDIUM  
**Implementation Pattern**: Mirror successful `copilot_agent_cli.py` → `codex_agent_cli.py`  
**Confidence Level**: 95% (PoC validated all core functionality)

## Current User Experience

```
┌─────────────────────────────────────────┐
│ MADE Agent Selection (Before)           │
├─────────────────────────────────────────┤
│ Settings → Agent CLI:                   │
│   ○ OpenCode (default)                  │
│   ○ GitHub Copilot                      │
│                                         │
│ Missing: Codex Cloud support            │
└─────────────────────────────────────────┘
```

## Target User Experience

```
┌─────────────────────────────────────────┐
│ MADE Agent Selection (After)            │
├─────────────────────────────────────────┤
│ Settings → Agent CLI:                   │
│   ○ OpenCode (default)                  │
│   ○ GitHub Copilot                      │
│   ○ Codex Cloud ← NEW OPTION            │
│                                         │
│ Seamless integration with existing UI   │
└─────────────────────────────────────────┘
```

## Key Implementation Insights

### Proven PoC Learnings (dev/poc-codex-cli/)
- ✅ **CLI Command Structure**: `["codex", "exec", "--json", "--sandbox", "workspace-write"]`
- ✅ **Session Management**: `-s session_id` for resumption (different from copilot's `--resume`)  
- ✅ **JSON Event Streaming**: Parse `thread.started`, `item.completed`, `turn.completed` events
- ✅ **Session Discovery**: `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` pattern
- ✅ **Real Session Export**: 30+ sessions found and successfully parsed

### Architecture Pattern Match
**Follow Exact CopilotAgentCLI Pattern** (packages/pybackend/copilot_agent_cli.py:25-416):
- Class structure with `cli_name` property → `"codex"`
- `run_agent()` method with subprocess management
- `export_session()` with JSONL parsing  
- `list_sessions()` with directory scanning
- `list_agents()` returning agent info
- Identical error handling and result types

### Key Adaptations Required
| Aspect | Copilot Pattern | Codex Adaptation |
|--------|----------------|------------------|
| **CLI Command** | `["copilot", "-p", message, "--allow-all-tools", "--silent"]` | `["codex", "exec", "--json", "--sandbox", "workspace-write", message]` |
| **Session Resume** | `["--resume", session_id]` | `["-s", session_id]` |
| **Output Format** | Plain text with ANSI codes | JSON streaming events |
| **Response Parsing** | `stdout` directly → clean with `_strip_ansi_codes()` | Parse JSON: `item.completed.item.text` |
| **Session Discovery** | `~/.copilot/session-state/*/events.jsonl` | `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` |
| **Session Identification** | Extract from `thread.started.thread_id` | Parse session directory names |

## Implementation Tasks

### Task 1: Create CodexAgentCLI Class
**File**: `packages/pybackend/codex_agent_cli.py`  
**Pattern**: Mirror `packages/pybackend/copilot_agent_cli.py:25-416`  
**Validation**: `python -c "from codex_agent_cli import CodexAgentCLI; print(CodexAgentCLI().cli_name)"`

**Key Methods to Implement**:

```python
class CodexAgentCLI(AgentCLI):
    @property
    def cli_name(self) -> str:
        return "codex"
    
    def run_agent(self, message: str, session_id: str | None, agent: str | None, 
                  model: str | None, cwd: Path, cancel_event: Event | None = None,
                  on_process: Callable[[subprocess.Popen[str]], None] | None = None) -> RunResult:
        # Build command: ["codex", "exec", "--json", "--sandbox", "workspace-write", message]
        # Add ["-s", session_id] if session exists
        # Parse JSON events from stdout: thread.started, item.completed
        
    def _parse_codex_output(self, stdout: str) -> tuple[str | None, list[ResponsePart]]:
        # Parse JSON lines for thread.started.thread_id and item.completed.item.text
        
    def export_session(self, session_id: str, cwd: Path | None) -> ExportResult:
        # Scan ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl files
        # Parse response_item events into HistoryMessage objects
        
    def list_sessions(self, cwd: Path | None) -> SessionListResult:
        # Scan date-based directory structure for session files
        # Extract titles from first message in each session
        
    def _get_codex_sessions_directory(self) -> Path | None:
        # Return ~/.codex/sessions or None if not exists
```

**Critical JSON Parsing Logic**:
```python
def _parse_codex_output(self, stdout: str) -> tuple[str | None, list[ResponsePart]]:
    """Parse codex JSON event stream for session ID and responses."""
    session_id = None
    response_parts = []
    
    for line in stdout.strip().split('\n'):
        if not line.strip():
            continue
        try:
            event = json.loads(line)
            event_type = event.get("type", "")
            
            if event_type == "thread.started":
                session_id = event.get("thread_id")
            elif event_type == "item.completed":
                item = event.get("item", {})
                text = item.get("text", "")
                if text:
                    response_parts.append(ResponsePart(
                        text=text, 
                        timestamp=event.get("timestamp"), 
                        part_type="streaming"
                    ))
        except json.JSONDecodeError:
            continue
    
    return session_id, response_parts
```

### Task 2: Integration Point Update
**File**: `packages/pybackend/agent_service.py:24-40`  
**Change**: Add codex branch to `get_agent_cli()` function  
**Validation**: `python -c "from agent_service import get_agent_cli; print(type(get_agent_cli()))"`

```python
def get_agent_cli():
    """Get the appropriate AgentCLI implementation based on settings."""
    try:
        settings = read_settings()
        agent_cli_setting = settings.get("agentCli", "opencode")

        if agent_cli_setting == "kiro":
            return KiroAgentCLI()
        elif agent_cli_setting == "copilot":
            return CopilotAgentCLI()
        elif agent_cli_setting == "codex":          # ← NEW BRANCH
            return CodexAgentCLI()                  # ← NEW BRANCH
        else:
            # Default to OpenCode for any other value
            return OpenCodeAgentCLI()
    except Exception:
        # Fallback to OpenCode if settings can't be read
        return OpenCodeAgentCLI()
```

**Import Addition**:
```python
from codex_agent_cli import CodexAgentCLI  # ← ADD TO IMPORTS
```

### Task 3: Settings Service Update
**File**: `packages/pybackend/settings_service.py:17-22`  
**Change**: Update supported values comment  
**Validation**: `grep -A 5 "agentCli.*supported" packages/pybackend/settings_service.py`

```python
# Update comment from:
# "agentCli": "opencode" | "copilot" | "kiro"
# To:
# "agentCli": "opencode" | "copilot" | "kiro" | "codex"
```

### Task 4: Comprehensive Unit Tests
**File**: `packages/pybackend/tests/unit/test_codex_agent_cli.py`  
**Pattern**: Mirror `packages/pybackend/tests/unit/test_copilot_agent_cli.py:1-488`  
**Coverage**: >80% with codex-specific scenarios  
**Validation**: `python -m pytest packages/pybackend/tests/unit/test_codex_agent_cli.py -v --cov=codex_agent_cli --cov-report=term-missing`

**Key Test Categories**:
1. **Basic Properties**: `test_cli_name()`, `test_missing_command_error()`
2. **JSON Parsing**: `test_parse_codex_output_success()`, `test_parse_codex_output_malformed()`  
3. **Command Building**: `test_run_agent_command_structure()`, `test_run_agent_with_session_resume()`
4. **Session Management**: `test_list_sessions_date_structure()`, `test_export_session_success()`
5. **Error Handling**: `test_run_agent_command_not_found()`, `test_export_session_not_found()`
6. **Edge Cases**: `test_empty_json_output()`, `test_malformed_session_files()`

**Critical Test: JSON Event Stream Parsing**:
```python
def test_parse_codex_output_success(self, mock_run):
    """Test parsing of codex JSON event stream."""
    mock_stdout = '''{"type": "thread.started", "thread_id": "session-123"}
{"type": "item.completed", "item": {"text": "Hello from codex"}, "timestamp": 1736766000000}
{"type": "turn.completed", "usage": {"tokens": 150}}'''
    
    mock_run.return_value.returncode = 0
    mock_run.return_value.stdout = mock_stdout
    mock_run.return_value.stderr = ""
    
    cli = CodexAgentCLI()
    result = cli.run_agent("test message", None, None, None, Path("."))
    
    assert result.success is True
    assert result.session_id == "session-123"
    assert len(result.response_parts) == 1
    assert result.response_parts[0].text == "Hello from codex"
```

### Task 5: End-to-End Testing Strategy
**Real-World Validation Requirements**:

1. **Codex CLI Availability**: Verify `codex` command accessible in PATH
2. **Session Creation**: Test new session creation with actual codex CLI  
3. **Session Resumption**: Test `-s session_id` parameter with existing session
4. **Session Discovery**: Validate `~/.codex/sessions/YYYY/MM/DD/` scanning  
5. **Session Export**: Parse real JSONL files from codex sessions
6. **Error Scenarios**: Test with invalid session IDs, missing CLI, permission errors

**Test Commands**:
```bash
# Test basic functionality
cd packages/pybackend
python -c "
from codex_agent_cli import CodexAgentCLI
from pathlib import Path
cli = CodexAgentCLI()
result = cli.run_agent('List files in current directory', None, None, None, Path('.'))
print(f'Success: {result.success}')
print(f'Session: {result.session_id}')
print(f'Response: {result.combined_response[:100]}...')
"

# Test session listing
python -c "
from codex_agent_cli import CodexAgentCLI
from pathlib import Path
cli = CodexAgentCLI()
result = cli.list_sessions(Path('.'))
print(f'Sessions found: {len(result.sessions)}')
for session in result.sessions[:3]:
    print(f'  {session.session_id}: {session.title}')
"

# Test session export  
python -c "
from codex_agent_cli import CodexAgentCLI
from pathlib import Path
cli = CodexAgentCLI()
sessions = cli.list_sessions(Path('.')).sessions
if sessions:
    result = cli.export_session(sessions[0].session_id, Path('.'))
    print(f'Export success: {result.success}')
    print(f'Messages: {len(result.messages)}')
else:
    print('No sessions to export')
"
```

### Task 6: Integration Testing
**File**: `packages/pybackend/tests/unit/test_agent_cli_setting.py`  
**Addition**: Add codex configuration test  
**Pattern**: Follow existing kiro/copilot test patterns

```python
def test_codex_agent_cli_integration():
    """Test that codex setting returns CodexAgentCLI."""
    with patch("settings_service.read_settings") as mock_settings:
        mock_settings.return_value = {"agentCli": "codex"}
        
        from agent_service import get_agent_cli
        agent = get_agent_cli()
        
        assert agent.__class__.__name__ == "CodexAgentCLI"
        assert agent.cli_name == "codex"
```

## Risk Mitigation

### High Confidence Factors
- ✅ **Proven PoC**: All core functionality validated in `dev/poc-codex-cli/`
- ✅ **Clear Template**: Direct pattern match with working `copilot_agent_cli.py`  
- ✅ **Existing Architecture**: No new abstractions needed
- ✅ **Real Session Data**: 30+ codex sessions successfully parsed

### Potential Issues & Solutions
1. **JSON Malformation**: Robust error handling with `try/except json.JSONDecodeError`
2. **Session Directory Missing**: Graceful fallback with informative error messages  
3. **CLI Command Changes**: Parameterized command building for future updates
4. **Large Session Files**: Stream processing for memory efficiency

### Rollback Strategy
- All changes are additive (no existing functionality modified)
- Default remains "opencode" - codex is opt-in only
- Simple removal: delete `codex_agent_cli.py` and revert agent_service.py import

## Success Criteria

### Definition of Done
- [ ] `CodexAgentCLI` class implements all `AgentCLI` interface methods
- [ ] Integration point updated in `agent_service.py:32` for codex branch
- [ ] Settings service documentation updated to include codex option
- [ ] Unit tests achieve >80% coverage with codex-specific scenarios
- [ ] End-to-end testing validates real codex CLI integration
- [ ] All existing tests continue to pass (no regressions)

### Quality Gates
1. **Type Safety**: All methods return properly typed `Result` objects
2. **Error Handling**: Graceful degradation for all failure modes  
3. **Performance**: Session operations complete within 5 seconds
4. **Security**: No shell injection risks in subprocess calls
5. **Maintainability**: Code follows established patterns exactly

### User Acceptance
- Users can select "Codex Cloud" from agent settings
- Chat interface works identically to existing copilot/opencode flows
- Session history exports work for codex conversations  
- Session resumption functions correctly across browser sessions

## Implementation Order

**Phase 1: Core Implementation**
1. Create `CodexAgentCLI` class with JSON parsing logic
2. Add codex branch to `get_agent_cli()` function
3. Update settings service documentation

**Phase 2: Testing & Validation**  
4. Create comprehensive unit test suite
5. Perform end-to-end testing with real codex CLI
6. Add integration tests for agent selection

**Phase 3: Quality Assurance**
7. Run full test suite to ensure no regressions
8. Performance testing for large session files
9. Security review of subprocess command handling

## References

### Key Files Analysis
- **Template**: `packages/pybackend/copilot_agent_cli.py:25-416` - Direct pattern to mirror
- **Integration**: `packages/pybackend/agent_service.py:24-40` - Add codex branch  
- **Test Pattern**: `packages/pybackend/tests/unit/test_copilot_agent_cli.py:1-488` - Mirror for codex
- **PoC Validation**: `dev/poc-codex-cli/FINAL_EVALUATION.md` - Proven functionality

### Implementation Confidence
**95% Success Probability** based on:
- Complete PoC validation of all codex CLI interactions
- Exact pattern matching with proven copilot implementation  
- No new architectural patterns required
- Battle-tested subprocess and JSON parsing approaches
- Clear error handling and rollback strategies

This implementation plan provides the comprehensive roadmap for adding seamless Codex Cloud support to MADE, following established patterns while adapting for codex-specific requirements.