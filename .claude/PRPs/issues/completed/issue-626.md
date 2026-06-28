# Investigation: [Critical] Agent status must reflect live CLI process for a session

**Issue**: #626
**Type**: BUG
**Investigated**: 2026-06-28

## Problem Statement

`GET /api/*/agent/status` reports whether an agent is processing based on bookkeeping state. That state can drift from the real OS process table, so a session can be reported as active even when the underlying agent CLI is no longer running.

## Root Cause

The status path trusted `_processing_channels`, `_conversation_sessions`, and persisted fallback state without verifying that a live process still existed for the session id.

## Implementation Plan

1. Add a helper in `packages/pybackend/agent_service.py` to check whether a process for a session id is running.
2. Update `get_channel_status()` to gate `processing: true` on that live-process lookup.
3. Add unit tests for stale bookkeeping, live process confirmation, and session-id resolution.

## Validation

- `uv run --project packages/pybackend python -m pytest packages/pybackend/tests/unit/test_unit.py -k "get_channel_status or is_process_running_for_session" -v`
- `uv run --project packages/pybackend python -m pytest packages/pybackend/tests/unit -x`

## Notes

The issue was fixed in `packages/pybackend/agent_service.py` and covered by unit tests in `packages/pybackend/tests/unit/test_unit.py`.
