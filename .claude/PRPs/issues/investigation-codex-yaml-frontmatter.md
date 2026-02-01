# Investigation: Codex CLI YAML Frontmatter Argument Parsing Error

**Type**: BUG
**Investigated**: 2026-02-01T10:48:00Z

### Assessment

| Metric     | Value  | Reasoning                                                                                                               |
| ---------- | ------ | ----------------------------------------------------------------------------------------------------------------------- |
| Severity   | HIGH   | Prevents basic usage of codex agent functionality with no simple workaround for users                                  |
| Complexity | MEDIUM | Requires CLI interface change from arguments to stdin, plus test updates (3 files affected, established pattern exists) |
| Confidence | HIGH   | Clear evidence of CLI argument parsing failure with YAML frontmatter, reproducible error with known solution pattern   |

---

## Problem Statement

The `codex exec --json` command fails when processing a simple "Hello" message because it receives YAML frontmatter as part of the argument, causing an "unexpected argument" error that prevents the codex agent from functioning.

---

## Analysis

### Root Cause Analysis

WHY: The codex CLI fails with "unexpected argument" error
↓ BECAUSE: Message contains YAML frontmatter instead of just "Hello"
Evidence: Error shows `'---\nmode: restricted\nfile: dependable-workflow-stack.md\n...\n---\n\nHello'`

↓ BECAUSE: YAML frontmatter is being injected by the codex CLI automatically
Evidence: Frontmatter references project-specific file "dependable-workflow-stack.md" and contains access policies

↓ BECAUSE: The codex CLI injects context-aware system prompts but can't parse them as command arguments
Evidence: `packages/pybackend/codex_agent_cli.py:127` - Command structure passes message as CLI argument

↓ ROOT CAUSE: Codex CLI's automatic YAML frontmatter injection is incompatible with argument-based message passing
Evidence: `command.extend(["--json", message])` creates `codex exec --json "YAML+message"` which fails parsing

### Evidence Chain

**Current Implementation** (`codex_agent_cli.py:120-127`):
```python
command = ["codex", "exec"]
if session_id and self._session_matches_directory(session_id, cwd):
    command.extend(["resume", session_id])
command.extend(["--json", message])  # ← PROBLEM: message contains YAML frontmatter
```

**Expected vs Actual**:
- Expected: `codex exec --json "Hello"`
- Actual: `codex exec --json "---\nmode: restricted\n...\n---\n\nHello"`

**Comparison with Working CLIs**:
- **OpenCode CLI** (`opencode_agent_cli.py:379`): Uses `input=message` (stdin)
- **Kiro CLI** (`kiro_agent_cli.py:127`): Uses `input=message` (stdin)  
- **Codex CLI**: Uses command argument (fails with complex messages)

### Affected Files

| File                          | Lines   | Action | Description                       |
| ----------------------------- | ------- | ------ | --------------------------------- |
| `codex_agent_cli.py`          | 120-140 | UPDATE | Change from argument to stdin     |
| `test_codex_agent_cli.py`     | 91-96   | UPDATE | Update command structure tests    |
| `test_codex_agent_cli.py`     | 129-136 | UPDATE | Update session resume tests       |

### Integration Points

- `agent_service.py:406` calls `agent_cli.run_agent(message, ...)` - no changes needed
- `app.py:367` receives message from API payload - no changes needed
- Tests verify command structure matches expected format

### Git History

- **Introduced**: `af9e99d` - 2026-01-31 - "feat(agent): add Codex Agent CLI implementation"
- **Last modified**: `af9e99d` - Recent implementation
- **Implication**: New implementation that worked in unit tests but fails with real codex CLI due to frontmatter injection

---

## Implementation Plan

### Step 1: Switch CLI from Arguments to Stdin Pattern

**File**: `packages/pybackend/codex_agent_cli.py`
**Lines**: 120-140
**Action**: UPDATE

**Current code:**
```python
# Build command inline - following Codex CLI patterns
command = ["codex", "exec"]

# Add session resumption using 'resume' subcommand if session exists
if session_id and self._session_matches_directory(session_id, cwd):
    command.extend(["resume", session_id])

# Add JSON output flag and message
command.extend(["--json", message])

# ... subprocess execution
if cancel_event is None and on_process is None:
    process = subprocess.run(
        command, capture_output=True, text=True, cwd=cwd
    )
```

**Required change:**
```python
# Build command inline - using stdin pattern like other CLIs  
command = ["codex", "exec"]

# Add session resumption using 'resume' subcommand if session exists
if session_id and self._session_matches_directory(session_id, cwd):
    command.extend(["resume", session_id])

# Add JSON output flag (no message argument)
command.append("--json")

# ... subprocess execution with stdin
if cancel_event is None and on_process is None:
    process = subprocess.run(
        command, capture_output=True, text=True, cwd=cwd, input=message
    )
```

**Why**: Matches the pattern used by opencode and kiro CLIs, handles complex messages with YAML frontmatter properly

---

### Step 2: Update Popen Branch for Stdin

**File**: `packages/pybackend/codex_agent_cli.py`  
**Lines**: 144-177
**Action**: UPDATE

**Required change**: Update the Popen branch to also use stdin instead of passing message as argument, and handle stdin communication properly with the cancel_event.

---

### Step 3: Update Command Structure Tests

**File**: `packages/pybackend/tests/unit/test_codex_agent_cli.py`
**Lines**: 91-96  
**Action**: UPDATE

**Current test expectation:**
```python
assert call_args[0][0] == [
    "codex", 
    "exec",
    "--json",
    "test message",  # ← Remove this
]
```

**Required change:**
```python
assert call_args[0][0] == [
    "codex",
    "exec", 
    "--json",
    # No message argument - passed via stdin
]
# Verify stdin usage
assert call_args[1]['input'] == "test message"
```

---

### Step 4: Update Session Resume Tests

**File**: `packages/pybackend/tests/unit/test_codex_agent_cli.py`
**Lines**: 129-136
**Action**: UPDATE

**Current test expectation:**
```python
assert call_args[0][0] == [
    "codex",
    "exec", 
    "resume",
    "session-123",
    "--json",
    "test message",  # ← Remove this
]
```

**Required change:**
```python
assert call_args[0][0] == [
    "codex",
    "exec",
    "resume", 
    "session-123",
    "--json",
    # No message argument - passed via stdin
]
assert call_args[1]['input'] == "test message"
```

---

## Patterns to Follow

**From codebase - mirror these exactly:**

```python
# SOURCE: opencode_agent_cli.py:379-384
# Pattern for stdin-based message passing
process = subprocess.run(
    command,
    input=message,  # ← Key pattern: use input parameter
    capture_output=True,
    text=True,
    cwd=cwd,
    timeout=600,
)
```

```python
# SOURCE: kiro_agent_cli.py:127-134  
# Pattern for stdin with cancel handling
process = subprocess.Popen(
    command,
    stdin=subprocess.PIPE,
    stdout=subprocess.PIPE, 
    stderr=subprocess.PIPE,
    text=True,
    cwd=cwd,
)
stdout, stderr = process.communicate(input=message)
```

---

## Edge Cases & Risks

| Risk/Edge Case              | Mitigation                                                          |
| --------------------------- | ------------------------------------------------------------------- |
| Codex CLI doesn't support stdin | Test with actual CLI to verify stdin compatibility                 |
| Session resume with stdin       | Verify session resumption still works with new command structure   |
| Message encoding issues         | Ensure proper UTF-8 encoding for stdin input                       |
| Large message performance       | Stdin should handle large messages better than command arguments   |
| Existing sessions affected      | Change is backward compatible - no session format changes          |

---

## Validation

### Automated Checks

```bash
cd packages/pybackend && uv sync
uv run --project packages/pybackend python -m pytest packages/pybackend/tests/unit/test_codex_agent_cli.py -v
python -m pytest  # Run full test suite
```

### Manual Verification

1. Start the backend and send a "Hello" message to the codex agent
2. Verify the command executes without "unexpected argument" errors  
3. Test session resumption still works with the new command structure
4. Test with messages containing special characters and YAML-like content

---

## Scope Boundaries  

**IN SCOPE:**
- Changing codex CLI invocation from arguments to stdin
- Updating related unit tests
- Ensuring compatibility with session resumption

**OUT OF SCOPE (do not touch):**
- Other CLI implementations (opencode, kiro, copilot)
- Agent service interface or API endpoints
- Session storage format or directory structure
- Frontend agent selection logic

---

## Metadata

- **Investigated by**: Claude
- **Timestamp**: 2026-02-01T10:48:00Z  
- **Artifact**: `.claude/PRPs/issues/investigation-codex-yaml-frontmatter.md`