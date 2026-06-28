# Issue 634 Archive

Issue: [#634](https://github.com/tbrandenburg/made/issues/634)
Title: [Medium] Keep an optional durable session->process registry in the backend

Implementation summary:
- Replaced timestamp-only agent processing persistence with a durable registry.
- Recorded PID/session metadata at spawn time.
- Used the registry for restart-safe status and cancel fallbacks.
- Added unit tests for registry load/save, PID liveness, status, and cancel.

Validation:
- `uv run --project packages/pybackend python -m pytest packages/pybackend/tests/unit/test_unit.py -k "registry or process_registry or cancel_agent_message or get_channel_status or mark_channel_processing" -q`
- `uv run --project packages/pybackend python -m pytest packages/pybackend/tests/unit -q`
- `make qa-quick`

Source artifact:
- Investigation comment on issue #634
