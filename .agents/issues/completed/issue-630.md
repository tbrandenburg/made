# Issue 630 Archive

## Issue

- #630: [Critical] Backend must report live running state per sessionId

## Investigation Source

- GitHub issue comment from `tbrandenburg`
- Live implementation plan from the issue thread

## Outcome

- `GET /api/*/agent/status?session_id=...` now returns `{ "running": boolean }`
- Backend history endpoints continue to expose their existing `processing` fields via a bridge from the new status boolean
- Frontend consumers now read `status.running`

## Validation

- `uv run python -m pytest tests/unit/test_unit.py -x -k "get_channel_status or cancel_agent_message" -v`
- `uv run python -m pytest tests/unit/test_api.py -x -k "status" -v`
- `npx tsc --noEmit`
- `npx vitest run src/hooks/useApi.test.ts src/pages/__tests__/RepositoryPage.test.tsx --reporter=verbose`
- `make qa-quick`
