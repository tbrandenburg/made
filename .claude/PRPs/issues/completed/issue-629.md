# Investigation: [Critical] Backend cancel should terminate by live session lookup

**Issue**: #629
**Type**: BUG
**Investigated**: 2026-06-28T08:35:00Z

### Problem Statement

`POST /api/*/agent/cancel` should cancel by `sessionId` using the same live-session truth as status, but `cancel_agent_message()` still depended on a stale in-memory membership check. If `_processing_channels` lost the entry, cancel returned `404` even when the CLI process was still live.

### Implementation Plan

1. Mirror the status resolution path in `cancel_agent_message()`.
2. Add reverse session lookup via `_conversation_sessions`.
3. Add persisted-state fallback via `_load_processing_state()`.
4. Return not-found when no live process can be resolved.
5. Add unit tests covering reverse lookup, persisted fallback, not-found behavior, and direct channel-key cancel.

### Validation

- `uv run --project packages/pybackend python -m pytest packages/pybackend/tests/unit/test_unit.py -x -v -k "cancel_agent_message"`
- `make qa-quick`

### Notes

- `get_channel_status()` already used the required fallback chain.
- The fix was kept local to `packages/pybackend/agent_service.py` and `packages/pybackend/tests/unit/test_unit.py`.
