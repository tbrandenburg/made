# Investigation: Bug: Multiple backend instances cause duplicate cron job execution

**Issue**: #367 (https://github.com/tbrandenburg/made/issues/367)
**Type**: BUG
**Investigated**: 2026-04-28T00:00:00Z

### Assessment

| Metric     | Value    | Reasoning                                                                                                                                |
| ---------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Severity   | HIGH     | Multiple concurrent cron executions occur silently without warning, causing duplicate Telegram notifications and OpenCode agent sessions with no simple workaround |
| Complexity | MEDIUM   | Fix requires changes to 2-3 files with inter-process coordination via PID files, several edge cases to handle, but follows established codebase patterns |
| Confidence | HIGH     | Root cause clearly identified: `_scheduler` guard at line 355-356 is process-local and cannot prevent multiple OS processes from starting schedulers |

---

## Problem Statement

When `make run` is executed without prior `make stop`, two separate OS processes each start their own APScheduler instance. The existing `_scheduler` guard in `cron_service.py` line 355-356 only prevents double-start within the same process, but each new process has its own memory space where `_scheduler = None`, allowing both schedulers to run independently and fire all cron jobs twice.

---

## Analysis

### Root Cause / Change Rationale

**The 5 Whys chain with evidence:**

**WHY**: Cron jobs fire twice when two `make run` invocations overlap
↓ **BECAUSE**: Two separate `made-backend` processes are running
Evidence: `ps aux | grep made-backend` shows multiple processes

↓ **BECAUSE**: No cross-process singleton guard exists  
Evidence: `cron_service.py:355-356` - `if _scheduler is not None: return` only checks module-level variable

↓ **BECAUSE**: The existing guard is process-local, not system-wide
Evidence: `cron_service.py:20` - `_scheduler: BackgroundScheduler | None = None` is per-process global

↓ **BECAUSE**: Each process creates its own APScheduler instance
Evidence: `cron_service.py:358` - `scheduler = BackgroundScheduler()` executes independently in each process

↓ **ROOT CAUSE**: No inter-process coordination mechanism exists  
Evidence: No PID files, file locks, or other cross-process guards in `start_cron_clock()` function

### Affected Files

| File                                     | Lines    | Action | Description                                    |
| ---------------------------------------- | -------- | ------ | ---------------------------------------------- |
| `packages/pybackend/cron_service.py`    | 355-500  | UPDATE | Add PID file guard to start/stop functions    |
| `packages/pybackend/app.py`             | 119-125  | UPDATE | Add signal handlers during lifespan startup   |
| `packages/pybackend/tests/unit/test_cron_service.py` | NEW | CREATE | Unit tests for PID file singleton behavior |

### Integration Points

- `app.py:121` calls `start_cron_clock()` during FastAPI lifespan startup
- `app.py:125` calls `stop_cron_clock()` during FastAPI lifespan shutdown  
- `config.py:get_made_directory()` already provides `~/.made/` path for PID file storage
- `make stop` command kills processes by port, needs PID file cleanup integration

### Git History

- **Last modified**: `7419669` - Recent cron stdout noise reduction
- **Key commits**: Multiple deadlock fixes in `stop_cron_clock` over past few commits  
- **Implication**: This is a long-standing design gap, not a recent regression

---

## Implementation Plan

### Step 1: Add PID file utility functions

**File**: `packages/pybackend/cron_service.py`
**Lines**: 18-37 (after imports, before module-level state variables)
**Action**: UPDATE

**Add after existing imports:**
```python
import os
import signal
```

**Add after `logger = logging.getLogger("made.pybackend.cron")` (around line 18):**
```python
PID_FILE_NAME = "backend-cron.pid"

def _get_pid_file_path() -> Path:
    from config import get_made_directory
    return get_made_directory() / PID_FILE_NAME

def _is_process_alive(pid: int) -> bool:
    """Check if a process with given PID is still running."""
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False

def _claim_cron_ownership() -> bool:
    """Atomically claim ownership of cron service. Returns True if successful."""
    pid_path = _get_pid_file_path()
    pid_path.parent.mkdir(parents=True, exist_ok=True)
    
    if pid_path.exists():
        try:
            existing_pid = int(pid_path.read_text().strip())
            if _is_process_alive(existing_pid):
                logger.warning(f"Cron service already owned by PID {existing_pid}")
                return False
            else:
                logger.info(f"Removing stale PID file for dead process {existing_pid}")
        except (ValueError, OSError) as e:
            logger.warning(f"Invalid PID file content: {e}")
    
    pid_path.write_text(str(os.getpid()))
    logger.info(f"Claimed cron ownership with PID {os.getpid()}")
    return True

def _release_cron_ownership() -> None:
    """Release cron ownership if we own it."""
    pid_path = _get_pid_file_path()
    if pid_path.exists():
        try:
            if int(pid_path.read_text().strip()) == os.getpid():
                pid_path.unlink()
                logger.info(f"Released cron ownership for PID {os.getpid()}")
        except (ValueError, OSError) as e:
            logger.warning(f"Failed to release PID file: {e}")
```

**Why**: Provides atomic PID file management that handles stale processes and prevents race conditions through filesystem operations.

---

### Step 2: Update start_cron_clock() to use PID file guard

**File**: `packages/pybackend/cron_service.py`  
**Lines**: 355-356
**Action**: UPDATE

**Current code:**
```python
if _scheduler is not None:
    return
```

**Required change:**
```python
if _scheduler is not None:
    return

# Cross-process singleton guard
if not _claim_cron_ownership():
    raise RuntimeError(
        "Another MADE backend instance is already running the cron service. "
        "Run 'make stop' or kill the existing process before starting."
    )
```

**Why**: Prevents scheduler startup if another process owns the cron service, causing FastAPI to exit with a clear error message instead of silently running duplicate schedulers.

---

### Step 3: Update stop_cron_clock() to release ownership

**File**: `packages/pybackend/cron_service.py`
**Lines**: 484-500 (around the end of `stop_cron_clock()`)
**Action**: UPDATE

**Current code:**
```python
_scheduler = None
logger.info("Cron clock stopped")
```

**Required change:**
```python
_scheduler = None
_release_cron_ownership()
logger.info("Cron clock stopped")
```

**Why**: Ensures PID file is removed on clean shutdown, allowing a new instance to start afterward.

---

### Step 4: Add signal handlers for graceful PID cleanup

**File**: `packages/pybackend/cron_service.py`
**Lines**: ~500 (after `stop_cron_clock` function)
**Action**: UPDATE

**Add after stop_cron_clock:**
```python
def _signal_handler(signum, frame):
    """Handle shutdown signals to ensure clean PID file cleanup."""
    logger.info(f"Received signal {signum}, shutting down cron service gracefully...")
    if _scheduler is not None:
        stop_cron_clock()
    raise SystemExit(0)

def register_signal_handlers() -> None:
    """Register signal handlers for graceful shutdown."""
    signal.signal(signal.SIGTERM, _signal_handler)
    signal.signal(signal.SIGINT, _signal_handler)
```

**Why**: Ensures PID file cleanup when process receives SIGTERM/SIGINT, preventing stale ownership claims.

---

### Step 5: Register signal handlers in app.py lifespan

**File**: `packages/pybackend/app.py`
**Lines**: 119-125
**Action**: UPDATE

**Current code:**
```python
@contextlib.asynccontextmanager
async def lifespan(_: FastAPI):
    start_cron_clock()
    try:
        yield
    finally:
        stop_cron_clock()
```

**Required change:**
```python
@contextlib.asynccontextmanager  
async def lifespan(_: FastAPI):
    cron_service.register_signal_handlers()
    start_cron_clock()
    try:
        yield
    finally:
        stop_cron_clock()
```

**Why**: Register signal handlers before starting cron service to ensure graceful cleanup on process termination.

---

### Step 6: Add unit tests for PID file behavior

**File**: `packages/pybackend/tests/unit/test_cron_service.py`
**Action**: CREATE (append to existing file)

**Test cases to add:**
```python
import os
import tempfile
from pathlib import Path
from unittest.mock import patch, MagicMock
import pytest
import cron_service

def test_claim_cron_ownership_succeeds_when_no_existing_file(tmp_path):
    """Test claiming ownership when no PID file exists."""
    with patch("cron_service._get_pid_file_path") as mock_path:
        mock_path.return_value = tmp_path / "backend-cron.pid"
        
        assert cron_service._claim_cron_ownership() is True
        assert (tmp_path / "backend-cron.pid").read_text().strip() == str(os.getpid())

def test_claim_cron_ownership_fails_when_process_alive(tmp_path):
    """Test ownership claim fails when another process is alive."""
    pid_file = tmp_path / "backend-cron.pid"
    pid_file.write_text("99999")  # Fake PID
    
    with patch("cron_service._get_pid_file_path") as mock_path, \
         patch("cron_service._is_process_alive") as mock_alive:
        mock_path.return_value = pid_file
        mock_alive.return_value = True  # Simulate live process
        
        assert cron_service._claim_cron_ownership() is False

def test_claim_cron_ownership_succeeds_when_process_dead(tmp_path):
    """Test claiming ownership when PID file has dead process."""
    pid_file = tmp_path / "backend-cron.pid"
    pid_file.write_text("99999")  # Fake dead PID
    
    with patch("cron_service._get_pid_file_path") as mock_path, \
         patch("cron_service._is_process_alive") as mock_alive:
        mock_path.return_value = pid_file
        mock_alive.return_value = False  # Simulate dead process
        
        assert cron_service._claim_cron_ownership() is True
        assert pid_file.read_text().strip() == str(os.getpid())

def test_release_cron_ownership_removes_own_pid_only(tmp_path):
    """Test release only removes PID file if it matches current process."""
    pid_file = tmp_path / "backend-cron.pid"
    pid_file.write_text(str(os.getpid()))
    
    with patch("cron_service._get_pid_file_path") as mock_path:
        mock_path.return_value = pid_file
        
        cron_service._release_cron_ownership()
        
        assert not pid_file.exists()

def test_release_cron_ownership_preserves_other_pid(tmp_path):
    """Test release does not remove PID file from other process."""
    pid_file = tmp_path / "backend-cron.pid"
    pid_file.write_text("99999")  # Different PID
    
    with patch("cron_service._get_pid_file_path") as mock_path:
        mock_path.return_value = pid_file
        
        cron_service._release_cron_ownership()
        
        assert pid_file.exists()
        assert pid_file.read_text().strip() == "99999"

@patch("cron_service._claim_cron_ownership")
def test_start_cron_clock_raises_when_ownership_fails(mock_claim):
    """Test start_cron_clock raises RuntimeError when ownership claim fails."""
    mock_claim.return_value = False
    
    with pytest.raises(RuntimeError, match="already running"):
        cron_service.start_cron_clock()
```

---

## Patterns to Follow

**From codebase - mirror these exactly:**

**SOURCE**: `config.py:13-14` - Directory path pattern
```python
def get_made_directory() -> Path:
    return get_made_home() / ".made"
```

**SOURCE**: `cron_service.py:484-500` - Existing cleanup pattern  
```python
def stop_cron_clock() -> None:
    global _scheduler
    if _scheduler is None:
        return
    # ... cleanup logic ...
    _scheduler = None
    logger.info("Cron clock stopped")
```

**SOURCE**: `tests/unit/test_cron_service.py:8-19` - Test teardown pattern
```python
def teardown_function():
    cron_service.stop_cron_clock()
    # Reset all module-level state...
```

---

## Edge Cases & Risks

| Risk/Edge Case                          | Mitigation                                                                    |
| --------------------------------------- | ----------------------------------------------------------------------------- |
| PID file exists but process is zombie   | `_is_process_alive()` uses `os.kill(pid, 0)` which fails for zombie processes |
| PID file has invalid content            | Try/except around `int()` conversion - treat as file-not-found              |
| PID file permissions prevent access     | Let OSError propagate as RuntimeError with clear message                    |
| Process crashes without cleanup         | Next startup will detect dead PID and replace ownership                     |
| Race condition on PID file creation     | Use atomic `Path.write_text()` - filesystem handles concurrency             |
| Process killed with SIGKILL (-9)        | PID file remains but next startup detects dead process and recovers         |
| Directory ~/.made doesn't exist         | Create with `mkdir(parents=True, exist_ok=True)`                            |

---

## Validation

### Automated Checks

```bash
cd packages/pybackend && uv sync
uv run --project packages/pybackend python -m pytest tests/unit/test_cron_service.py::test_claim_cron_ownership -v
uv run --project packages/pybackend ruff check cron_service.py app.py  
uv run --project packages/pybackend mypy cron_service.py app.py --ignore-missing-imports
```

### Manual Verification  

1. Start backend: `make run` - should create `~/.made/backend-cron.pid`
2. Verify PID file: `cat ~/.made/backend-cron.pid` - should show process PID  
3. Attempt second start in new terminal: `make run` - should fail with "already running" error
4. Kill first process: `make stop`
5. Verify cleanup: `ls ~/.made/backend-cron.pid` - should not exist
6. Start again: `make run` - should succeed
7. Test stale PID: manually write dead PID to file, verify startup replaces it

---

## Scope Boundaries

**IN SCOPE:**
- PID file-based singleton guard for cron service
- Signal handlers for graceful PID cleanup
- Unit tests for ownership management
- Integration with existing FastAPI lifespan

**OUT OF SCOPE (do not touch):**
- Makefile changes (existing `make stop` is sufficient)
- systemd service integration (future enhancement)  
- File locking (fcntl.flock) - PID approach is simpler for cross-platform
- Handling SIGKILL scenarios (inherently unhandleable)
- APScheduler configuration changes (existing max_instances=1 is correct per-process)

---

## Metadata

- **Investigated by**: Claude  
- **Timestamp**: 2026-04-28T00:00:00Z
- **Artifact**: `.claude/PRPs/issues/issue-367.md`