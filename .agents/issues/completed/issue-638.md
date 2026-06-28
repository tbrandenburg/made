# Issue 638: Cancel path misses cleanup_key alias for live process lookup

Type: BUG

## Problem Statement

`cancel_agent_message()` can miss a live process after persisted-state fallback because process and event lookup only uses aliases derived from `lock_key`. When fallback resolves a distinct `cleanup_key`, that key is not searched. If cancel then fails to find a live process, cleanup only clears `cleanup_key`, leaving the seeded `lock_key` stale in memory and on disk.

## Implementation Plan

1. Add `cleanup_key` to the set of keys searched in `_active_processes` and `_cancel_events`.
2. Clear both `cleanup_key` and `lock_key` when cancel cannot find a live process.
3. Add regression tests for:
   - finding a live process under `cleanup_key`
   - clearing both aliases on stale process cleanup

## Validation

- `uv run --project packages/pybackend python -m pytest packages/pybackend/tests/unit/test_unit.py -x -v -k "cancel"`
- `uv run --project packages/pybackend ruff check packages/pybackend/agent_service.py packages/pybackend/tests/unit/test_unit.py`
- `make qa-quick`

## Notes

Archived from the issue investigation comment for #638.
