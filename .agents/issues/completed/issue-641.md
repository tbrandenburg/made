# Investigation: Fix stale cleanup_key lookup orphaning live agent process

**Issue**: #641
**Type**: BUG

## Problem Statement

`cancel_agent_message()` can trust a stale persisted cleanup alias and miss a live subprocess that is still registered under a different alias. When that happens, cleanup can orphan the live process.

## Implementation Plan

1. In `packages/pybackend/agent_service.py`, update the persisted-state fallback inside `cancel_agent_message()` to prefer the running alias when resolving cancel targets.
2. Add a regression test in `packages/pybackend/tests/unit/test_unit.py` for the stale cleanup alias plus live process case.

## Validation

- `uv run --project packages/pybackend python -m pytest packages/pybackend/tests/unit/test_unit.py -k "cancel_agent_message" -v`
- `uv run --project packages/pybackend ruff check packages/pybackend/agent_service.py packages/pybackend/tests/unit/test_unit.py`
- `make qa-quick`

## Test Cases

- stale persisted cleanup alias with a live process under another alias is resolved correctly
