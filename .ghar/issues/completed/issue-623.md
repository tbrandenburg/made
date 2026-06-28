# Investigation: [Critical] RepositoryPage does not auto-load saved session history on open

**Issue**: #623 (https://github.com/tbrandenburg/made/issues/623)
**Type**: BUG
**Investigated**: 2026-06-28T10:16:12Z

## Problem Statement

Opening `RepositoryPage` with a saved `sessionId` could render an empty chat until manual refresh. The initial load path used incremental merge behavior instead of the shared full-replace session loader used by the sibling pages.

## Implementation Summary

- `packages/frontend/src/pages/RepositoryPage.tsx`
  - Added `useSessionLoader` and `useAgentPolling`.
  - Replaced the custom initial-load effect with shared session loading.
  - Switched UI bindings to `sessionLoading`.
  - Surfaced `sessionError` alongside existing chat errors.
- `packages/frontend/src/pages/__tests__/RepositoryPage.test.tsx`
  - Added a regression test that verifies saved session history renders on mount.
  - Updated loading-state test names to match `sessionLoading`.
  - Extended two timing-sensitive AC496 tests to avoid environment timeout flakiness.

## Validation

- `make qa-quick`
- `npm exec vitest run src/pages/__tests__/RepositoryPage.test.tsx`

## Notes

Archived after implementation and validation on branch `fix/issue-623-repositorypage-auto-load`.
