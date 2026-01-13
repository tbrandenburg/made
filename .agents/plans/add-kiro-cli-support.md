# Feature: Add Kiro CLI Support

The following plan should be complete, but its important that you validate documentation and codebase patterns and task sanity before you start implementing.

Pay special attention to naming of existing utils types and models. Import from the right files etc.

## Feature Description

Add KiroAgentCLI implementation alongside the existing OpenCodeAgentCLI to support Kiro CLI as an alternative agent interface. The CLI selection will be configurable through MADE's settings system using the existing `agentCli` setting. This implementation will follow the same AgentCLI interface specification and provide equivalent functionality for chat operations, session management, and agent listing.

## User Story

As a MADE user
I want to choose between OpenCode and Kiro CLI as my agent interface
So that I can use my preferred AI assistant tool while maintaining the same MADE functionality

## Problem Statement

MADE currently only supports OpenCode CLI for agent interactions. Users who prefer or require Kiro CLI cannot use it as their agent interface, limiting flexibility and adoption. The system needs to support multiple CLI backends while maintaining a consistent interface.

## Solution Statement

Implement a KiroAgentCLI class that follows the existing AgentCLI interface specification. The implementation will interact with Kiro CLI's SQLite database for session management and use subprocess calls for chat operations. Users can select between "opencode" and "kiro" via the settings interface.

## Feature Metadata

**Feature Type**: New Capability
**Estimated Complexity**: Medium
**Primary Systems Affected**: agent_service.py, settings_service.py, agent_cli.py
**Dependencies**: kiro-cli (external), sqlite3 (Python standard library)

---

## CONTEXT REFERENCES

### Relevant Codebase Files IMPORTANT: YOU MUST READ THESE FILES BEFORE IMPLEMENTING!

- `packages/pybackend/agent_cli.py` (lines 28-93) - Why: Contains AgentCLI abstract base class and OpenCodeAgentCLI implementation pattern to mirror
- `packages/pybackend/agent_results.py` (entire file) - Why: Contains all typed result classes that KiroAgentCLI must return
- `packages/pybackend/agent_service.py` (lines 1-20) - Why: Shows how AGENT_CLI is imported and used, needs modification for CLI selection
- `packages/pybackend/settings_service.py` (lines 15-20) - Why: Contains agentCli setting that controls CLI selection
- `packages/pybackend/AGENT_INTERFACE_SPEC.md` (entire file) - Why: Defines the exact interface contract that KiroAgentCLI must implement
- `examples/kiro-cli/kiro-types.ts` (entire file) - Why: Defines Kiro database schema and conversation data structures
- `examples/kiro-cli/kiro-analyzer.js` (lines 60-80) - Why: Shows SQL queries for accessing Kiro conversation data

### New Files to Create

- `packages/pybackend/kiro_agent_cli.py` - KiroAgentCLI implementation following AgentCLI interface
- `packages/pybackend/tests/unit/test_kiro_agent_cli.py` - Unit tests for KiroAgentCLI
- `packages/pybackend/tests/integration/test_kiro_integration.py` - Local integration tests assuming kiro-cli installation

### Relevant Documentation YOU SHOULD READ THESE BEFORE IMPLEMENTING!

- [Kiro CLI Database Analysis](examples/kiro-cli/kiro-database-analysis.md)
  - Specific section: Database schema and conversation structure
  - Why: Required for understanding how to query Kiro's SQLite database
- [Agent Interface Specification](packages/pybackend/AGENT_INTERFACE_SPEC.md)
  - Specific section: Required AgentCLI Result Types
  - Why: Defines exact return types and data structures required

### Patterns to Follow

**CLI Command Pattern** (from legacy KiroAgentCLI):
```python
def build_run_command(self, session_id: str | None, agent: str | None) -> list[str]:
    command = ["kiro-cli", "chat", "--no-interactive", "--trust-all-tools"]
    if session_id: command.append("--resume")
    if agent: command.extend(["--agent", agent])
    return command
```

**Database Path Resolution** (from legacy implementation):
```python
def _get_database_path(self) -> Path | None:
    configured = os.environ.get("KIRO_DATABASE_PATH")
    if configured and Path(configured).expanduser().exists():
        return Path(configured).expanduser()
    candidates = [
        Path.home() / ".local/share/kiro-cli/data.sqlite3",
        Path.home() / ".local/share/kiro/data.sqlite3",
        Path.home() / ".config/kiro/data.sqlite3"
    ]
    return next((c for c in candidates if c.exists()), None)
```

**Conversation Export Pattern** (from legacy implementation):
```python
def _export_conversation(self, db_path: Path, session_id: str, cwd: Path | None) -> dict[str, Any] | None:
    with sqlite3.connect(db_path) as conn:
        cursor = conn.cursor()
        key = str((cwd or Path.cwd()).resolve())
        cursor.execute("SELECT value FROM conversations_v2 WHERE key = ? AND conversation_id = ?", (key, session_id))
        row = cursor.fetchone()
        return json.loads(row[0]) if row else None
```

**Error Handling Pattern** (from OpenCodeAgentCLI):
```python
try:
    # CLI operation
    return SuccessResult(...)
except FileNotFoundError:
    return FailureResult(error_message=self.missing_command_error())
except Exception as e:
    return FailureResult(error_message=f"Error: {str(e)}")
```

**Database Query Pattern** (from examples):
```python
import sqlite3
cursor.execute("SELECT conversation_id, value, created_at FROM conversations_v2 WHERE key = ? ORDER BY created_at", [directory_path])
```

**Timestamp Conversion Pattern** (from agent_results.py):
```python
def _to_milliseconds(self, raw_value: object) -> int | None:
    try:
        return int(float(raw_value))
    except (TypeError, ValueError):
        return None
```

---

## IMPLEMENTATION PLAN

### Phase 1: Foundation

Create the KiroAgentCLI class structure and basic database connectivity. Establish the CLI command patterns and error handling framework.

**Tasks:**
- Create KiroAgentCLI class inheriting from AgentCLI
- Implement database connection and path resolution
- Set up basic CLI command building utilities
- Implement missing_command_error method

### Phase 2: Core Implementation

Implement the four required interface methods with proper parsing and error handling. Focus on database queries for session management and subprocess calls for chat operations.

**Tasks:**
- Implement run_agent method with subprocess management
- Implement export_session method with database queries
- Implement list_sessions method with database queries
- Implement list_agents method with CLI calls

### Phase 3: Integration

Modify the agent service to support CLI selection based on settings. Update the service to instantiate the correct CLI implementation.

**Tasks:**
- Modify agent_service.py to support dynamic CLI selection
- Update CLI instantiation based on settings
- Ensure backward compatibility with existing tests

### Phase 4: Testing & Validation

Create comprehensive unit tests covering all methods and error conditions. Validate integration with the existing system.

**Tasks:**
- Implement unit tests for each KiroAgentCLI method
- Test error handling and edge cases
- Validate settings integration
- Test CLI selection functionality

---

## STEP-BY-STEP TASKS

IMPORTANT: Execute every task in order, top to bottom. Each task is atomic and independently testable.

### CREATE packages/pybackend/kiro_agent_cli.py

- **IMPLEMENT**: KiroAgentCLI class with AgentCLI interface
- **PATTERN**: Mirror OpenCodeAgentCLI structure from agent_cli.py:94-200
- **IMPORTS**: `import sqlite3, subprocess, json, os, tempfile` from standard library, `from pathlib import Path`, `from agent_cli import AgentCLI`, `from agent_results import *`
- **GOTCHA**: Kiro database path is `~/.local/share/kiro-cli/data.sqlite3`, handle missing database gracefully
- **VALIDATE**: `python -c "from kiro_agent_cli import KiroAgentCLI; print('Import successful')"`

### CREATE packages/pybackend/kiro_agent_cli.py - cli_name property

- **IMPLEMENT**: `@property def cli_name(self) -> str: return "kiro-cli"`
- **PATTERN**: Exact same pattern as OpenCodeAgentCLI.cli_name from agent_cli.py:98
- **VALIDATE**: `python -c "from kiro_agent_cli import KiroAgentCLI; assert KiroAgentCLI().cli_name == 'kiro-cli'"`

### CREATE packages/pybackend/kiro_agent_cli.py - database utilities

- **IMPLEMENT**: `_get_database_path()` method with environment variable support and fallback paths
- **IMPLEMENT**: `_get_directory_key(cwd: Path)` method returning resolved absolute path string
- **PATTERN**: Use legacy pattern: check `KIRO_DATABASE_PATH` env var, then fallback to standard locations
- **GOTCHA**: Handle missing database file, return appropriate error messages, use Path.resolve() for consistent keys
- **VALIDATE**: `python -c "from kiro_agent_cli import KiroAgentCLI; cli = KiroAgentCLI(); print(cli._get_database_path())"`

### CREATE packages/pybackend/kiro_agent_cli.py - run_agent method

- **IMPLEMENT**: `run_agent(message: str, session_id: str | None, agent: str | None, cwd: Path) -> RunResult`
- **PATTERN**: Mirror OpenCodeAgentCLI.run_agent structure from agent_cli.py:100-130
- **IMPORTS**: Use subprocess.run with capture_output=True, text=True
- **GOTCHA**: Kiro CLI uses `--resume` for session continuation, not `-s`; use `--agent` for agent selection. **LIMITATION**: If session_id provided but not latest, may return "not supported" error or resume latest instead
- **VALIDATE**: `python -c "from kiro_agent_cli import KiroAgentCLI; from pathlib import Path; result = KiroAgentCLI().run_agent('test', None, None, Path('.')); print(result.success)"`

### CREATE packages/pybackend/kiro_agent_cli.py - build_run_command method

- **IMPLEMENT**: `build_run_command(session_id: str | None, agent: str | None) -> list[str]`
- **PATTERN**: Use legacy implementation pattern: `["kiro-cli", "chat", "--no-interactive", "--trust-all-tools"]`
- **IMPORTS**: Build command list with trust-all-tools flag for non-interactive execution
- **GOTCHA**: Add `--resume` flag only if session_id provided (no session_id value needed), add `--agent` only if agent provided. **LIMITATION**: kiro-cli only supports resuming latest session, not switching to specific session IDs
- **VALIDATE**: `python -c "from kiro_agent_cli import KiroAgentCLI; cmd = KiroAgentCLI().build_run_command('test-session', 'test-agent'); print(cmd)"`

### CREATE packages/pybackend/kiro_agent_cli.py - export_session method

- **IMPLEMENT**: `export_session(session_id: str, cwd: Path | None) -> ExportResult`
- **PATTERN**: Use legacy database query pattern: `SELECT value FROM conversations_v2 WHERE key = ? AND conversation_id = ?`
- **IMPORTS**: Parse conversation JSON and convert to HistoryMessage format using legacy conversion methods
- **GOTCHA**: Use resolved absolute path as database key, parse ISO timestamps to milliseconds, handle missing conversations
- **VALIDATE**: `python -c "from kiro_agent_cli import KiroAgentCLI; from pathlib import Path; result = KiroAgentCLI().export_session('test', Path('.')); print(type(result))"`

### CREATE packages/pybackend/kiro_agent_cli.py - list_sessions method

- **IMPLEMENT**: `list_sessions(cwd: Path | None) -> SessionListResult`
- **PATTERN**: Query database for conversations by directory key, mirror OpenCodeAgentCLI.list_sessions structure
- **IMPORTS**: SQL query: `SELECT conversation_id, value, created_at FROM conversations_v2 WHERE key = ? ORDER BY created_at DESC`
- **GOTCHA**: Parse JSON value to extract first user message as title, convert timestamps from milliseconds
- **VALIDATE**: `python -c "from kiro_agent_cli import KiroAgentCLI; from pathlib import Path; result = KiroAgentCLI().list_sessions(Path('.')); print(len(result.sessions))"`

### CREATE packages/pybackend/kiro_agent_cli.py - list_agents method

- **IMPLEMENT**: `list_agents() -> AgentListResult`
- **PATTERN**: Use subprocess to call `kiro-cli agent list`, parse output similar to OpenCodeAgentCLI.list_agents
- **IMPORTS**: Parse agent list output, extract agent names and types
- **GOTCHA**: Kiro output format: `agent_name    /path/to/agent` or `* agent_name    (Built-in)`, handle both formats
- **VALIDATE**: `python -c "from kiro_agent_cli import KiroAgentCLI; result = KiroAgentCLI().list_agents(); print(len(result.agents))"`

### CREATE packages/pybackend/kiro_agent_cli.py - missing_command_error method

- **IMPLEMENT**: `missing_command_error() -> str`
- **PATTERN**: Exact same pattern as OpenCodeAgentCLI.missing_command_error from agent_cli.py:202-203
- **IMPORTS**: Return f"Error: '{self.cli_name}' command not found. Please ensure it is installed and in PATH."
- **VALIDATE**: `python -c "from kiro_agent_cli import KiroAgentCLI; print(KiroAgentCLI().missing_command_error())"`

### UPDATE packages/pybackend/agent_service.py - import KiroAgentCLI

- **IMPLEMENT**: Add `from kiro_agent_cli import KiroAgentCLI` import
- **PATTERN**: Add import after existing agent_cli import on line 8
- **VALIDATE**: `python -c "import agent_service; print('Import successful')"`

### UPDATE packages/pybackend/agent_service.py - dynamic CLI selection

- **IMPLEMENT**: Replace `AGENT_CLI = OpenCodeAgentCLI()` with dynamic selection based on settings
- **PATTERN**: Add function `def get_agent_cli() -> AgentCLI:` that reads settings and returns appropriate CLI
- **IMPORTS**: Import settings_service: `from settings_service import read_settings`
- **GOTCHA**: Default to OpenCodeAgentCLI if setting not found or invalid, handle import errors gracefully
- **VALIDATE**: `python -c "from agent_service import get_agent_cli; cli = get_agent_cli(); print(cli.cli_name)"`

### UPDATE packages/pybackend/agent_service.py - replace AGENT_CLI usage

- **IMPLEMENT**: Replace all `AGENT_CLI.method()` calls with `get_agent_cli().method()`
- **PATTERN**: Update lines 187, 192, 227 and any other AGENT_CLI references
- **GOTCHA**: Ensure mock detection still works for tests by checking the returned CLI instance
- **VALIDATE**: `python -c "import agent_service; print('Service updated successfully')"`

### UPDATE packages/pybackend/settings_service.py - add kiro option

- **IMPLEMENT**: Update default settings to document kiro option in comments
- **PATTERN**: Add comment above agentCli setting: `# Supported values: "opencode", "kiro"`
- **VALIDATE**: `python -c "from settings_service import read_settings; settings = read_settings(); print(settings.get('agentCli'))"`

### CREATE packages/pybackend/tests/unit/test_kiro_agent_cli.py

- **IMPLEMENT**: Unit tests for KiroAgentCLI following pytest patterns from existing tests
- **PATTERN**: Mirror test structure from test_unit.py, focus on method return types and error handling
- **IMPORTS**: `import pytest, unittest.mock, tempfile, sqlite3` for mocking and database testing
- **GOTCHA**: Mock subprocess calls and database connections, test both success and failure cases
- **VALIDATE**: `cd packages/pybackend && python -m pytest tests/unit/test_kiro_agent_cli.py -v`

### CREATE packages/pybackend/tests/unit/test_kiro_agent_cli.py - test_cli_name

- **IMPLEMENT**: Test that cli_name property returns "kiro-cli"
- **PATTERN**: Simple assertion test like existing property tests
- **VALIDATE**: `cd packages/pybackend && python -m pytest tests/unit/test_kiro_agent_cli.py::test_cli_name -v`

### CREATE packages/pybackend/tests/unit/test_kiro_agent_cli.py - test_missing_command_error

- **IMPLEMENT**: Test missing_command_error returns correct error message
- **PATTERN**: String assertion test checking error message format
- **VALIDATE**: `cd packages/pybackend && python -m pytest tests/unit/test_kiro_agent_cli.py::test_missing_command_error -v`

### CREATE packages/pybackend/tests/unit/test_kiro_agent_cli.py - test_run_agent_success

- **IMPLEMENT**: Test run_agent with mocked subprocess success
- **PATTERN**: Use @patch decorator to mock subprocess.run, return successful RunResult
- **IMPORTS**: Mock successful kiro-cli response with conversation output
- **VALIDATE**: `cd packages/pybackend && python -m pytest tests/unit/test_kiro_agent_cli.py::test_run_agent_success -v`

### CREATE packages/pybackend/tests/unit/test_kiro_agent_cli.py - test_run_agent_command_not_found

- **IMPLEMENT**: Test run_agent with FileNotFoundError from subprocess
- **PATTERN**: Mock subprocess.run to raise FileNotFoundError, verify error handling
- **VALIDATE**: `cd packages/pybackend && python -m pytest tests/unit/test_kiro_agent_cli.py::test_run_agent_command_not_found -v`

### CREATE packages/pybackend/tests/unit/test_kiro_agent_cli.py - test_list_sessions_with_database

- **IMPLEMENT**: Test list_sessions with mocked SQLite database
- **PATTERN**: Create temporary database with test data, verify SessionListResult
- **IMPORTS**: Use tempfile.NamedTemporaryFile for test database
- **VALIDATE**: `cd packages/pybackend && python -m pytest tests/unit/test_kiro_agent_cli.py::test_list_sessions_with_database -v`

### CREATE packages/pybackend/tests/unit/test_kiro_agent_cli.py - test_list_agents_success

- **IMPLEMENT**: Test list_agents with mocked subprocess output
- **PATTERN**: Mock kiro-cli agent list output, verify AgentListResult parsing
- **VALIDATE**: `cd packages/pybackend && python -m pytest tests/unit/test_kiro_agent_cli.py::test_list_agents_success -v`

### CREATE packages/pybackend/tests/integration/test_kiro_integration.py

- **IMPLEMENT**: Local integration tests assuming kiro-cli is installed and logged in
- **PATTERN**: Create integration test class with @pytest.mark.integration decorator
- **IMPORTS**: `import pytest, subprocess, tempfile` for real CLI testing
- **GOTCHA**: Skip tests if kiro-cli not available, use actual CLI commands for validation
- **VALIDATE**: `cd packages/pybackend && python -m pytest tests/integration/test_kiro_integration.py -v -m integration`

### CREATE packages/pybackend/tests/integration/test_kiro_integration.py - test_kiro_cli_available

- **IMPLEMENT**: Test that kiro-cli command is available and responsive
- **PATTERN**: Use subprocess.run to check `kiro-cli --help` returns successfully
- **VALIDATE**: `cd packages/pybackend && python -m pytest tests/integration/test_kiro_integration.py::test_kiro_cli_available -v -m integration`

### CREATE packages/pybackend/tests/integration/test_kiro_integration.py - test_agent_list_integration

- **IMPLEMENT**: Test KiroAgentCLI.list_agents() with real kiro-cli
- **PATTERN**: Call actual list_agents method, verify AgentListResult structure and content
- **GOTCHA**: Verify at least built-in agents are present, handle empty agent lists gracefully
- **VALIDATE**: `cd packages/pybackend && python -m pytest tests/integration/test_kiro_integration.py::test_agent_list_integration -v -m integration`

### CREATE packages/pybackend/tests/integration/test_kiro_integration.py - test_session_list_integration

- **IMPLEMENT**: Test KiroAgentCLI.list_sessions() with real database
- **PATTERN**: Call list_sessions for current directory, verify SessionListResult structure
- **GOTCHA**: Handle empty session lists, verify session data format matches interface spec
- **VALIDATE**: `cd packages/pybackend && python -m pytest tests/integration/test_kiro_integration.py::test_session_list_integration -v -m integration`

### CREATE packages/pybackend/tests/integration/test_kiro_integration.py - test_export_session_integration

- **IMPLEMENT**: Test KiroAgentCLI.export_session() with real conversation data
- **PATTERN**: Use existing session ID from list_sessions, verify ExportResult and message format
- **GOTCHA**: Skip if no sessions available, validate HistoryMessage structure matches interface spec
- **VALIDATE**: `cd packages/pybackend && python -m pytest tests/integration/test_kiro_integration.py::test_export_session_integration -v -m integration`

### CREATE packages/pybackend/tests/integration/test_kiro_integration.py - test_interface_spec_compliance

- **IMPLEMENT**: Test that all KiroAgentCLI methods return correct typed results per interface spec
- **PATTERN**: Call each method and verify return type matches AgentCLI interface specification
- **GOTCHA**: Validate all required fields are present in result objects, check to_frontend_format() methods
- **VALIDATE**: `cd packages/pybackend && python -m pytest tests/integration/test_kiro_integration.py::test_interface_spec_compliance -v -m integration`

---

## TESTING STRATEGY

### Unit Tests

Design unit tests with fixtures and mocked dependencies following existing testing approaches in the codebase. Focus on:

- Method return types match AgentCLI interface specification
- Error handling for missing CLI command
- Database connection and query error handling
- Subprocess call mocking and response parsing
- Edge cases like empty databases and malformed responses

### Integration Tests

Local integration testing with real kiro-cli installation:

- Test actual CLI command execution and response parsing
- Validate database queries with real Kiro SQLite database
- Verify interface specification compliance with live data
- Test error handling with actual CLI error conditions
- Use `@pytest.mark.integration` decorator for optional execution

### Edge Cases

- Missing kiro-cli command in PATH
- Missing or corrupted SQLite database
- Invalid session IDs in database queries
- Malformed JSON in conversation data
- Empty agent list responses
- Network/subprocess timeout scenarios
- Integration test graceful skipping when kiro-cli unavailable

---

## VALIDATION COMMANDS

Execute every command to ensure zero regressions and 100% feature correctness.

### Level 1: Syntax & Style

```bash
cd packages/pybackend && uv run ruff check kiro_agent_cli.py
cd packages/pybackend && uv run ruff format kiro_agent_cli.py
```

### Level 2: Unit Tests

```bash
cd packages/pybackend && uv run pytest tests/unit/test_kiro_agent_cli.py -v
cd packages/pybackend && uv run pytest tests/unit/ -k "not system" -v
```

### Level 3: Integration Tests

```bash
cd packages/pybackend && uv run pytest tests/unit/test_unit.py -v
cd packages/pybackend && uv run pytest tests/integration/test_kiro_integration.py -v -m integration
python -c "from agent_service import get_agent_cli; cli = get_agent_cli(); print(f'Using CLI: {cli.cli_name}')"
```

### Level 4: Manual Validation

```bash
# Test CLI selection via settings
python -c "
from settings_service import write_settings, read_settings
write_settings({'agentCli': 'kiro'})
from agent_service import get_agent_cli
cli = get_agent_cli()
print(f'Selected CLI: {cli.cli_name}')
assert cli.cli_name == 'kiro-cli'
"

# Test fallback to opencode
python -c "
from settings_service import write_settings
write_settings({'agentCli': 'invalid'})
from agent_service import get_agent_cli
cli = get_agent_cli()
print(f'Fallback CLI: {cli.cli_name}')
assert cli.cli_name == 'opencode'
"
```

### Level 5: Additional Validation (Optional)

```bash
# Test with actual kiro-cli if available
kiro-cli agent list
kiro-cli chat --list-sessions

# Run integration tests with real kiro-cli
cd packages/pybackend && uv run pytest tests/integration/ -v -m integration
```

---

## ACCEPTANCE CRITERIA

- [ ] KiroAgentCLI class implements all four AgentCLI interface methods
- [ ] All methods return correct typed results (RunResult, ExportResult, etc.)
- [ ] Settings-based CLI selection works between "opencode" and "kiro"
- [ ] Error handling works for missing kiro-cli command
- [ ] Database queries work for session management
- [ ] Unit tests achieve >80% coverage for new code
- [ ] All existing tests continue to pass
- [ ] No regressions in OpenCodeAgentCLI functionality
- [ ] Code follows project formatting and linting standards
- [ ] Integration with agent_service maintains backward compatibility

---

## COMPLETION CHECKLIST

- [ ] KiroAgentCLI class created with all interface methods
- [ ] Database integration working for session queries
- [ ] CLI subprocess calls working for agent operations
- [ ] Settings integration enabling CLI selection
- [ ] Unit tests created and passing
- [ ] All validation commands executed successfully
- [ ] Existing test suite passes without regressions
- [ ] Code formatted and linted according to project standards
- [ ] Integration tests created and passing (when kiro-cli available)
- [ ] Interface specification compliance verified
- [ ] Manual testing confirms CLI selection works
- [ ] Error handling tested for edge cases

---

## NOTES

**Design Decisions:**
- KiroAgentCLI uses SQLite database directly for session management instead of CLI commands for better performance
- Subprocess calls used for run_agent and list_agents to maintain real-time interaction
- Settings-based selection allows runtime switching without code changes
- Error handling prioritizes graceful degradation over strict validation
- CLI parameters include `--trust-all-tools` and `--no-interactive` for automated execution
- Database path resolution supports environment variable override and multiple fallback locations
- **LIMITATION**: kiro-cli only supports resuming latest session, not switching to arbitrary session IDs - some operations may return "not supported"

**Trade-offs:**
- Direct database access couples implementation to Kiro's storage format but provides better performance
- Integration tests require kiro-cli installation but provide real-world validation
- Minimal abstraction layer as requested, focusing on direct CLI implementation rather than complex patterns
- Legacy conversation parsing patterns reused for consistency and proven reliability
- Session switching limitation accepted as kiro-cli architectural constraint

**Security Considerations:**
- SQLite database access is read-only for session queries
- Subprocess calls are parameterized to prevent injection attacks
- File path validation prevents directory traversal issues
- Trust-all-tools flag used only in controlled backend environment
