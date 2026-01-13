# Feature: Remove Legacy Agent Methods

The following plan should be complete, but its important that you validate documentation and codebase patterns and task sanity before you start implementing.

Pay special attention to naming of existing utils types and models. Import from the right files etc.

## Feature Description

Remove redundant legacy methods from the AgentCLI interface and implementations while maintaining full backward compatibility. The current system has both new typed methods (run_agent, export_session, list_sessions, list_agents) and legacy methods (build_run_command, start_run, export_session_legacy, list_sessions_legacy, list_agents_legacy). The legacy methods are only used for test compatibility and can be removed by updating the tests to use the new interface.

## User Story

As a developer maintaining the MADE codebase
I want to remove redundant legacy methods from the AgentCLI interface
So that the codebase is cleaner, easier to maintain, and has a single consistent interface

## Problem Statement

The AgentCLI interface currently maintains two sets of methods that provide the same functionality:
1. New typed methods that return structured results (RunResult, ExportResult, etc.)
2. Legacy methods that return raw subprocess results requiring parsing

This duplication creates maintenance overhead, confusion for developers, and increases the surface area for bugs. The legacy methods are only used by tests through mock detection, making them candidates for removal.

## Solution Statement

Remove the legacy methods from the AgentCLI interface and update all tests to use the new typed interface. This will simplify the codebase while maintaining all existing functionality through the superior typed interface.

## Feature Metadata

**Feature Type**: Refactor
**Estimated Complexity**: Medium
**Primary Systems Affected**: agent_cli.py, agent_service.py, all AgentCLI implementations, test files
**Dependencies**: None (internal refactor only)

---

## CONTEXT REFERENCES

### Relevant Codebase Files IMPORTANT: YOU MUST READ THESE FILES BEFORE IMPLEMENTING!

- `packages/pybackend/agent_cli.py` (lines 28-95) - Why: Contains AgentCLI interface with both new and legacy methods
- `packages/pybackend/agent_service.py` (lines 208, 356, 455, 656) - Why: Contains mock detection logic that uses legacy methods
- `packages/pybackend/tests/unit/test_unit.py` (lines 162-300) - Why: Tests that mock legacy methods and need updating
- `packages/pybackend/tests/unit/test_kiro_agent_cli.py` (lines 75-105) - Why: Tests that verify legacy method functionality
- `packages/pybackend/kiro_agent_cli.py` (lines 61, 365-405) - Why: KiroAgentCLI implementation of legacy methods
- `packages/pybackend/agent_cli.py` (lines 490-530) - Why: OpenCodeAgentCLI implementation of legacy methods

### New Files to Create

None - this is a removal/refactor operation

### Relevant Documentation YOU SHOULD READ THESE BEFORE IMPLEMENTING!

- [Agent Interface Specification](packages/pybackend/AGENT_INTERFACE_SPEC.md)
  - Specific section: Required AgentCLI Result Types
  - Why: Defines the typed interface that will remain after legacy removal

### Patterns to Follow

**Mock Detection Pattern** (current):
```python
if hasattr(AGENT_CLI.start_run, 'side_effect') or hasattr(AGENT_CLI.start_run, '_mock_name'):
    # Use legacy interface for tests
```

**New Mock Detection Pattern** (target):
```python
if hasattr(AGENT_CLI.run_agent, 'side_effect') or hasattr(AGENT_CLI.run_agent, '_mock_name'):
    # Use mocked typed interface
```

**Test Mocking Pattern** (current):
```python
@patch('agent_service.AGENT_CLI.start_run')
def test_method(self, mock_start_run):
    mock_start_run.return_value = mock_process
```

**New Test Mocking Pattern** (target):
```python
@patch('agent_service.AGENT_CLI.run_agent')
def test_method(self, mock_run_agent):
    mock_run_agent.return_value = RunResult(success=True, ...)
```

---

## IMPLEMENTATION PLAN

### Phase 1: Test Migration

Update all tests to use the new typed interface instead of legacy methods. This ensures we can validate that the new interface works correctly before removing the legacy methods.

**Tasks:**
- Update test mocks to use typed methods (run_agent, export_session, etc.)
- Replace legacy return values with typed result objects
- Verify all tests pass with new mocking approach

### Phase 2: Service Layer Cleanup

Remove mock detection logic for legacy methods and simplify agent_service.py to only use the typed interface.

**Tasks:**
- Remove legacy mock detection branches
- Remove legacy helper functions (_export_chat_history_legacy, etc.)
- Simplify service methods to only use typed interface

### Phase 3: Interface Cleanup

Remove legacy methods from the AgentCLI abstract base class and all implementations.

**Tasks:**
- Remove legacy method definitions from AgentCLI interface
- Remove legacy method implementations from OpenCodeAgentCLI
- Remove legacy method implementations from KiroAgentCLI

### Phase 4: Validation

Ensure all functionality works correctly and no regressions were introduced.

**Tasks:**
- Run full test suite to verify no regressions
- Test CLI selection functionality manually
- Verify both OpenCode and Kiro CLI backends work correctly

---

## STEP-BY-STEP TASKS

IMPORTANT: Execute every task in order, top to bottom. Each task is atomic and independently testable.

### UPDATE packages/pybackend/tests/unit/test_unit.py - replace start_run mocks

- **IMPLEMENT**: Replace all `@patch('agent_service.AGENT_CLI.start_run')` with `@patch('agent_service.AGENT_CLI.run_agent')`
- **PATTERN**: Mock typed methods instead of legacy subprocess methods
- **IMPORTS**: Import RunResult and other typed results for mock return values
- **GOTCHA**: Mock return values must be typed result objects, not subprocess results
- **VALIDATE**: `cd packages/pybackend && uv run pytest tests/unit/test_unit.py::TestAgentService::test_send_agent_message_success -v`

### UPDATE packages/pybackend/tests/unit/test_unit.py - update mock return values

- **IMPLEMENT**: Replace `mock_process` returns with `RunResult(success=True, session_id=None, response_parts=[ResponsePart(...)])`
- **PATTERN**: Use ResponsePart objects for structured responses
- **IMPORTS**: Import ResponsePart from agent_results
- **GOTCHA**: Ensure response_parts list matches expected output format
- **VALIDATE**: `cd packages/pybackend && uv run pytest tests/unit/test_unit.py::TestAgentService::test_send_agent_message_parses_json_output -v`

### UPDATE packages/pybackend/tests/unit/test_unit.py - remove build_run_command usage

- **IMPLEMENT**: Remove assertions that check `build_run_command` calls since run_agent is mocked directly
- **PATTERN**: Focus on testing the service logic, not CLI command construction
- **GOTCHA**: Tests should verify service behavior, not internal CLI implementation details
- **VALIDATE**: `cd packages/pybackend && uv run pytest tests/unit/test_unit.py::TestAgentService -v`

### UPDATE packages/pybackend/tests/unit/test_unit.py - update session list tests

- **IMPLEMENT**: Replace `list_sessions_legacy` mocks with `list_sessions` returning `SessionListResult`
- **PATTERN**: Use SessionInfo objects in SessionListResult.sessions
- **IMPORTS**: Import SessionListResult and SessionInfo from agent_results
- **GOTCHA**: Mock must return structured SessionListResult, not raw subprocess output
- **VALIDATE**: `cd packages/pybackend && uv run pytest tests/unit/test_unit.py::TestAgentService::test_list_chat_sessions_parses_table -v`

### UPDATE packages/pybackend/tests/unit/test_kiro_agent_cli.py - remove legacy method tests

- **IMPLEMENT**: Remove tests for `build_run_command` methods since they're being removed
- **PATTERN**: Keep only tests for the main typed interface methods
- **GOTCHA**: Ensure test coverage remains adequate for the remaining interface
- **VALIDATE**: `cd packages/pybackend && uv run pytest tests/unit/test_kiro_agent_cli.py -v`

### UPDATE packages/pybackend/tests/integration/test_kiro_integration.py - remove legacy method tests

- **IMPLEMENT**: Remove `test_cli_command_building` test that tests `build_run_command`
- **PATTERN**: Focus integration tests on the main typed interface
- **GOTCHA**: Keep tests that verify actual CLI functionality, remove tests of internal methods
- **VALIDATE**: `cd packages/pybackend && uv run pytest tests/integration/test_kiro_integration.py -v -m integration`

### UPDATE packages/pybackend/agent_service.py - remove legacy mock detection

- **IMPLEMENT**: Remove all `hasattr(AGENT_CLI.start_run, 'side_effect')` checks and legacy branches
- **PATTERN**: Use only the typed interface methods directly
- **IMPORTS**: Remove imports of legacy helper functions
- **GOTCHA**: Ensure mock detection still works for the new typed methods
- **VALIDATE**: `cd packages/pybackend && uv run pytest tests/unit/test_unit.py::TestAgentService -v`

### UPDATE packages/pybackend/agent_service.py - remove legacy helper functions

- **IMPLEMENT**: Remove `_export_chat_history_legacy`, `_list_chat_sessions_legacy`, `_list_agents_legacy` functions
- **PATTERN**: Use typed interface methods directly in main functions
- **GOTCHA**: Ensure all functionality is preserved through the typed interface
- **VALIDATE**: `cd packages/pybackend && uv run pytest tests/unit/test_chat_history_service.py -v`

### UPDATE packages/pybackend/agent_service.py - simplify main functions

- **IMPLEMENT**: Remove legacy branches and use typed interface directly in all functions
- **PATTERN**: Direct calls to `get_agent_cli().method()` without legacy fallbacks
- **GOTCHA**: Maintain error handling and logging patterns
- **VALIDATE**: `cd packages/pybackend && uv run pytest tests/unit/test_api.py -v`

### UPDATE packages/pybackend/agent_cli.py - remove legacy methods from interface

- **IMPLEMENT**: Remove `build_run_command`, `start_run`, `export_session_legacy`, `list_sessions_legacy`, `list_agents_legacy` from AgentCLI
- **PATTERN**: Keep only the four main typed methods as abstract methods
- **GOTCHA**: This will break implementations until they're updated in next steps
- **VALIDATE**: `cd packages/pybackend && python3 -c "from agent_cli import AgentCLI; print('Interface updated')"`

### UPDATE packages/pybackend/agent_cli.py - remove legacy methods from OpenCodeAgentCLI

- **IMPLEMENT**: Remove implementations of legacy methods from OpenCodeAgentCLI class
- **PATTERN**: Keep only the typed method implementations
- **GOTCHA**: Ensure no internal code in OpenCodeAgentCLI uses the removed methods
- **VALIDATE**: `cd packages/pybackend && python3 -c "from agent_cli import OpenCodeAgentCLI; cli = OpenCodeAgentCLI(); print('OpenCode CLI updated')"`

### UPDATE packages/pybackend/kiro_agent_cli.py - remove legacy methods from KiroAgentCLI

- **IMPLEMENT**: Remove implementations of legacy methods from KiroAgentCLI class
- **PATTERN**: Keep only the typed method implementations
- **GOTCHA**: Ensure no internal code in KiroAgentCLI uses the removed methods (like build_run_command in run_agent)
- **VALIDATE**: `cd packages/pybackend && python3 -c "from kiro_agent_cli import KiroAgentCLI; cli = KiroAgentCLI(); print('Kiro CLI updated')"`

### UPDATE packages/pybackend/kiro_agent_cli.py - refactor run_agent implementation

- **IMPLEMENT**: Replace `build_run_command` usage in `run_agent` with direct command construction
- **PATTERN**: Inline the command building logic directly in the method
- **IMPORTS**: No additional imports needed
- **GOTCHA**: Maintain exact same command structure as before
- **VALIDATE**: `cd packages/pybackend && python3 -c "from kiro_agent_cli import KiroAgentCLI; result = KiroAgentCLI().run_agent('test', None, None, __import__('pathlib').Path('.')); print('Run agent works:', result.success)"`

---

## TESTING STRATEGY

### Unit Tests

Update all unit tests to use the new typed interface exclusively. Focus on:
- Mocking typed methods instead of legacy subprocess methods
- Using structured result objects as mock return values
- Testing service logic rather than CLI implementation details
- Maintaining test coverage for all functionality

### Integration Tests

Keep integration tests focused on end-to-end functionality:
- Test actual CLI command execution through typed interface
- Verify database operations work correctly
- Test error handling and edge cases
- Remove tests of internal legacy methods

### Edge Cases

Ensure all edge cases are covered through the typed interface:
- Missing CLI commands (FileNotFoundError handling)
- Database connection failures
- Invalid session IDs
- Empty result sets
- Malformed CLI output

---

## VALIDATION COMMANDS

Execute every command to ensure zero regressions and 100% feature correctness.

### Level 1: Syntax & Style

```bash
cd packages/pybackend && uv run ruff check agent_cli.py kiro_agent_cli.py agent_service.py
cd packages/pybackend && uv run ruff format agent_cli.py kiro_agent_cli.py agent_service.py
```

### Level 2: Unit Tests

```bash
cd packages/pybackend && uv run pytest tests/unit/test_kiro_agent_cli.py -v
cd packages/pybackend && uv run pytest tests/unit/test_unit.py -v
cd packages/pybackend && uv run pytest tests/unit/test_chat_history_service.py -v
cd packages/pybackend && uv run pytest tests/unit/ -k "not system" -v
```

### Level 3: Integration Tests

```bash
cd packages/pybackend && uv run pytest tests/integration/test_kiro_integration.py -v -m integration
cd packages/pybackend && uv run pytest tests/unit/test_api.py -v
```

### Level 4: Manual Validation

```bash
# Test CLI selection functionality
cd packages/pybackend && python3 -c "
from settings_service import write_settings
from agent_service import get_agent_cli
write_settings({'agentCli': 'kiro'})
cli = get_agent_cli()
print(f'Kiro CLI: {cli.cli_name}')
assert cli.cli_name == 'kiro-cli'
write_settings({'agentCli': 'opencode'})
cli = get_agent_cli()
print(f'OpenCode CLI: {cli.cli_name}')
assert cli.cli_name == 'opencode'
print('✅ CLI selection works')
"

# Test agent operations
cd packages/pybackend && python3 -c "
from agent_service import get_agent_cli
from pathlib import Path
cli = get_agent_cli()
result = cli.list_agents()
print(f'List agents: {result.success}')
result = cli.list_sessions(Path('.'))
print(f'List sessions: {result.success}')
print('✅ Agent operations work')
"
```

### Level 5: Additional Validation (Optional)

```bash
# Test with actual kiro-cli if available
kiro-cli agent list
kiro-cli --help

# Run full test suite
cd packages/pybackend && uv run pytest -v
```

---

## ACCEPTANCE CRITERIA

- [ ] All legacy methods removed from AgentCLI interface
- [ ] All legacy method implementations removed from OpenCodeAgentCLI and KiroAgentCLI
- [ ] All tests updated to use typed interface exclusively
- [ ] All legacy helper functions removed from agent_service.py
- [ ] Mock detection logic simplified to use typed methods only
- [ ] Full test suite passes with zero failures
- [ ] CLI selection functionality works correctly
- [ ] Both OpenCode and Kiro backends function identically to before
- [ ] No regressions in existing functionality
- [ ] Code follows project formatting and linting standards

---

## COMPLETION CHECKLIST

- [ ] All legacy method definitions removed from interface
- [ ] All legacy method implementations removed from CLI classes
- [ ] All tests updated to use typed interface
- [ ] All legacy helper functions removed from service layer
- [ ] Mock detection logic simplified
- [ ] Full test suite passes (unit + integration)
- [ ] Manual testing confirms CLI selection works
- [ ] No linting or type checking errors
- [ ] Agent operations work correctly for both CLI backends
- [ ] Acceptance criteria all met

---

## NOTES

**Design Decisions:**
- Remove legacy methods entirely rather than deprecating them since they're only used internally
- Update tests to use typed interface to improve test quality and maintainability
- Maintain exact same functionality through the superior typed interface
- Simplify agent_service.py by removing dual-path logic

**Trade-offs:**
- Temporary test breakage during migration but cleaner final state
- Loss of legacy method tests but better coverage of actual interface
- Slightly more complex mock setup in tests but more realistic testing
- Reduced code surface area and maintenance burden

**Risk Mitigation:**
- Comprehensive validation at each step to catch regressions early
- Manual testing of CLI selection to ensure core functionality preserved
- Integration tests to verify end-to-end workflows still work
- Gradual removal approach (tests first, then service layer, then interface)
