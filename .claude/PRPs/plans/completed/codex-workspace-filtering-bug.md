# Investigation: Codex CLI Session History Shows Sessions from All Directories

**Issue**: Workspace filtering bug - Free-form investigation
**Type**: BUG
**Investigated**: 2026-02-01T09:30:00Z

### Assessment

| Metric     | Value  | Reasoning                                                                                                        |
|------------|--------|------------------------------------------------------------------------------------------------------------------|
| Severity   | MEDIUM | Major feature partially broken (session workspace isolation), moderate user impact, workaround exists (manual session management) |
| Complexity | MEDIUM | 2-3 files affected, moderate integration points with session management system, some refactoring needed           |
| Confidence | HIGH   | Clear root cause identified with specific code evidence, well-understood session file structure and data flow    |

---

## Problem Statement

The Codex CLI agent abstraction is showing sessions from all directories in the session history instead of filtering sessions by the current workspace. Sessions created in `/home/tom/workspace/ai/made/workspace/.made/knowledge` appear in session lists for all other directories, breaking workspace isolation.

---

## Analysis

### Root Cause Analysis

**WHY 1**: Why do sessions from other workspaces appear in all directories?
→ BECAUSE: The `list_sessions` method doesn't filter sessions by workspace
→ Evidence: `packages/pybackend/codex_agent_cli.py:343-444` - No call to `_session_matches_directory`

**WHY 2**: Why doesn't `_session_matches_directory` work correctly?  
→ BECAUSE: It only checks if session file exists, not the actual workspace stored in session metadata
→ Evidence: `packages/pybackend/codex_agent_cli.py:85-104` - Method returns `True` if any session file contains the ID

**WHY 3**: Why isn't the stored workspace data being used for filtering?
→ BECAUSE: Implementation doesn't read session files to extract the `cwd` metadata for comparison  
→ Evidence: Session files contain `{"cwd":"/path/to/workspace"}` but method doesn't parse this

**ROOT CAUSE**: Two bugs in workspace filtering logic:
1. `_session_matches_directory` method doesn't read session metadata to verify workspace
2. `list_sessions` method doesn't call workspace filtering at all

### Evidence Chain

**WHY**: Sessions from other directories appear in session history  
↓ **BECAUSE**: `list_sessions` returns all sessions without workspace filtering  
Evidence: `packages/pybackend/codex_agent_cli.py:343-444` - Method scans all session files

↓ **BECAUSE**: `_session_matches_directory` has flawed implementation  
Evidence: `packages/pybackend/codex_agent_cli.py:85-104` - Only checks file existence, not content

↓ **ROOT CAUSE**: Session metadata parsing missing from workspace filtering  
Evidence: `packages/pybackend/codex_agent_cli.py:102` - `return True` without reading session `cwd`

### Affected Files

| File                                    | Lines   | Action | Description                           |
|-----------------------------------------|---------|--------|---------------------------------------|
| `packages/pybackend/codex_agent_cli.py` | 85-104  | UPDATE | Fix `_session_matches_directory` impl |
| `packages/pybackend/codex_agent_cli.py` | 343-444 | UPDATE | Add workspace filtering to `list_sessions` |
| `packages/pybackend/tests/unit/test_codex_agent_cli.py` | NEW | UPDATE | Add tests for workspace filtering |

### Integration Points

- `packages/pybackend/agent_service.py` calls `list_sessions` for session management
- Session files stored in `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` format
- Session metadata format: `{"type":"session_meta","payload":{"cwd":"/workspace/path"}}`
- Other CLI implementations (Kiro, Copilot) have similar `_session_matches_directory` patterns

### Git History

- **Session filtering logic**: Present since initial Codex CLI implementation
- **Last modified**: Multiple commits have touched session management
- **Implication**: Long-standing bug affecting workspace isolation

---

## Implementation Plan

### Step 1: Fix `_session_matches_directory` to Read Session Metadata

**File**: `packages/pybackend/codex_agent_cli.py`
**Lines**: 85-104
**Action**: UPDATE

**Current code:**
```python
def _session_matches_directory(self, session_id: str, cwd: Path) -> bool:
    """Check whether a session belongs to the provided working directory."""
    sessions_dir = self._get_codex_sessions_directory()
    if not sessions_dir:
        return False

    # Scan date-based directory structure for session files
    for year_dir in sessions_dir.iterdir():
        if not year_dir.is_dir():
            continue
        for month_dir in year_dir.iterdir():
            if not month_dir.is_dir():
                continue
            for day_dir in month_dir.iterdir():
                if not day_dir.is_dir():
                    continue
                for session_file in day_dir.glob("rollout-*.jsonl"):
                    if session_id in session_file.name:
                        return True
    return False
```

**Required change:**
```python
def _session_matches_directory(self, session_id: str, cwd: Path) -> bool:
    """Check whether a session belongs to the provided working directory."""
    sessions_dir = self._get_codex_sessions_directory()
    if not sessions_dir:
        return False

    # Resolve the provided cwd to absolute path for comparison
    target_cwd = cwd.resolve()

    # Scan date-based directory structure for session files
    for year_dir in sessions_dir.iterdir():
        if not year_dir.is_dir():
            continue
        for month_dir in year_dir.iterdir():
            if not month_dir.is_dir():
                continue
            for day_dir in month_dir.iterdir():
                if not day_dir.is_dir():
                    continue
                for session_file in day_dir.glob("rollout-*.jsonl"):
                    if session_id in session_file.name:
                        # Found matching session file, now check workspace
                        try:
                            with open(session_file, "r", encoding="utf-8") as f:
                                # Read first line to get session metadata
                                first_line = f.readline().strip()
                                if first_line:
                                    event = json.loads(first_line)
                                    if event.get("type") == "session_meta":
                                        payload = event.get("payload", {})
                                        session_cwd = payload.get("cwd")
                                        if session_cwd:
                                            session_path = Path(session_cwd).resolve()
                                            # Check if session was created in target directory or subdirectory
                                            return (session_path == target_cwd or 
                                                   target_cwd in session_path.parents or
                                                   session_path in target_cwd.parents)
                        except (json.JSONDecodeError, FileNotFoundError, Exception):
                            # If we can't read the session metadata, don't include it
                            continue
                        return False
    return False
```

**Why**: Need to parse session metadata to compare actual workspace paths instead of just checking file existence.

---

### Step 2: Add Workspace Filtering to `list_sessions` Method

**File**: `packages/pybackend/codex_agent_cli.py`  
**Lines**: 343-444
**Action**: UPDATE

**Current code:**
```python
def list_sessions(self, cwd: Path | None) -> SessionListResult:
    """List available sessions and return structured result."""
    try:
        sessions_dir = self._get_codex_sessions_directory()
        if not sessions_dir:
            return SessionListResult(
                success=False,
                sessions=[],
                error_message="Codex session directory not found",
            )

        sessions = []

        # Scan date-based directory structure for session files
        if sessions_dir.exists():
            for year_dir in sessions_dir.iterdir():
                # ... existing session scanning logic ...
                for session_file in day_dir.glob("rollout-*.jsonl"):
                    # Extract session ID and create SessionInfo
                    session_id = session_file.stem
                    # ... existing session info creation ...
                    sessions.append(SessionInfo(...))
```

**Required change:**
```python  
def list_sessions(self, cwd: Path | None) -> SessionListResult:
    """List available sessions and return structured result."""
    try:
        sessions_dir = self._get_codex_sessions_directory()
        if not sessions_dir:
            return SessionListResult(
                success=False,
                sessions=[],
                error_message="Codex session directory not found",
            )

        sessions = []

        # Scan date-based directory structure for session files
        if sessions_dir.exists():
            for year_dir in sessions_dir.iterdir():
                # ... existing year/month/day iteration ...
                for session_file in day_dir.glob("rollout-*.jsonl"):
                    if not session_file.is_file():
                        continue

                    session_id = session_file.stem
                    
                    # Filter by workspace if cwd provided
                    if cwd and not self._session_matches_directory(session_id, cwd):
                        continue
                    
                    # ... existing session info creation logic ...
                    sessions.append(SessionInfo(...))
```

**Why**: Add workspace filtering to ensure only sessions from current workspace are shown.

---

### Step 3: Add Helper Method for Workspace Path Comparison

**File**: `packages/pybackend/codex_agent_cli.py`
**Lines**: After line 104
**Action**: CREATE

**New method:**
```python
def _paths_are_related(self, path1: Path, path2: Path) -> bool:
    """Check if two paths are the same or one is a parent/child of the other."""
    try:
        resolved_1 = path1.resolve()
        resolved_2 = path2.resolve()
        
        return (resolved_1 == resolved_2 or 
                resolved_2 in resolved_1.parents or
                resolved_1 in resolved_2.parents)
    except (OSError, ValueError):
        return False
```

**Why**: Centralize workspace path comparison logic for better maintainability and testing.

---

### Step 4: Update Tests for Workspace Filtering

**File**: `packages/pybackend/tests/unit/test_codex_agent_cli.py`
**Action**: UPDATE

**Test cases to add:**
```python
def test_session_matches_directory_reads_metadata(self):
    """Test that _session_matches_directory actually reads session metadata."""
    cli = CodexAgentCLI()
    
    # Create mock session file with metadata
    session_content = '''{"timestamp":"2026-02-01T08:15:19.387Z","type":"session_meta","payload":{"cwd":"/test/workspace"}}
{"timestamp":"2026-02-01T08:15:19.387Z","type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"Hello"}]}}'''
    
    with patch('pathlib.Path.open', mock_open(read_data=session_content)):
        with patch('pathlib.Path.glob') as mock_glob:
            mock_session_file = Mock()
            mock_session_file.name = "rollout-test-session.jsonl"
            mock_glob.return_value = [mock_session_file]
            
            # Should match when paths are same
            result = cli._session_matches_directory("test-session", Path("/test/workspace"))
            assert result is True
            
            # Should not match when paths are different
            result = cli._session_matches_directory("test-session", Path("/other/workspace"))
            assert result is False

def test_list_sessions_filters_by_workspace(self):
    """Test that list_sessions filters sessions by current workspace."""
    cli = CodexAgentCLI()
    
    # Mock two session files in different workspaces
    with patch.object(cli, '_get_codex_sessions_directory') as mock_sessions_dir:
        with patch.object(cli, '_session_matches_directory') as mock_matches:
            # Setup mock to return True for first session, False for second
            mock_matches.side_effect = lambda session_id, cwd: session_id == "matching-session"
            
            # Mock file system structure
            mock_sessions_dir.return_value = Path("/mock/.codex/sessions")
            
            # Should only return matching sessions
            result = cli.list_sessions(Path("/target/workspace"))
            
            # Verify filtering was applied
            assert mock_matches.call_count >= 1
            mock_matches.assert_any_call("matching-session", Path("/target/workspace"))
```

---

## Patterns to Follow

**From codebase - mirror these exactly:**

```python
# SOURCE: packages/pybackend/kiro_agent_cli.py:78-95
# Pattern for workspace filtering with database lookup
def _session_matches_directory(self, session_id: str, cwd: Path) -> bool:
    """Check whether a session belongs to the provided working directory."""
    db_path = self._get_kiro_database_path()
    if not db_path or not db_path.exists():
        return False

    try:
        import sqlite3
        with sqlite3.connect(db_path) as conn:
            cursor = conn.execute(
                "SELECT value FROM chat_history WHERE key = ?", 
                (str(cwd.resolve()),)
            )
            result = cursor.fetchone()
            return result is not None
    except Exception:
        return False
```

**Pattern demonstrates**: Workspace validation by reading stored session data rather than just checking existence.

---

## Edge Cases & Risks

| Risk/Edge Case | Mitigation |
|----------------|------------|
| Malformed JSON in session files | Catch `json.JSONDecodeError` and skip malformed sessions |
| Missing session metadata | Check for `session_meta` type before extracting `cwd` |
| File permission errors | Catch `FileNotFoundError` and continue scanning |
| Symlinks in workspace paths | Use `Path.resolve()` for consistent path comparison |
| Very large session files | Only read first line for metadata, don't parse entire file |

---

## Validation

### Automated Checks

```bash
# Run type checking
cd packages/pybackend && python -m mypy codex_agent_cli.py

# Run specific tests for this fix  
cd packages/pybackend && python -m pytest tests/unit/test_codex_agent_cli.py::test_session_matches_directory -v

# Run all CLI tests
cd packages/pybackend && python -m pytest tests/unit/test_*_agent_cli.py -v

# Run linting
cd packages/pybackend && python -m ruff check codex_agent_cli.py
```

### Manual Verification

1. Create test sessions in different directories and verify they only appear in their respective workspaces
2. Test session resumption still works correctly with the updated filtering
3. Verify existing sessions are properly categorized by their original workspace
4. Test edge cases with malformed session files don't break the listing

---

## Scope Boundaries

**IN SCOPE:**
- Fix `_session_matches_directory` method to read session metadata
- Add workspace filtering to `list_sessions` method  
- Add comprehensive tests for workspace filtering
- Handle JSON parsing errors gracefully

**OUT OF SCOPE (do not touch):**
- Other CLI implementations (Kiro, Copilot, OpenCode) - they have similar patterns but different bugs
- Session file format changes - work with existing session metadata structure
- Performance optimizations for session scanning - focus on correctness first
- Session migration or cleanup tools - separate concern

---

## Metadata

- **Investigated by**: Claude
- **Timestamp**: 2026-02-01T09:30:00Z  
- **Artifact**: `.claude/PRPs/issues/codex-workspace-filtering-bug.md`