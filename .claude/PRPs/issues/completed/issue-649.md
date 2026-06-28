# Issue 649 Archive

**Issue**: #649
**Title**: RepositoryPage: add working tree clean/dirty badge next to Git badge
**Type**: ENHANCEMENT

## Summary

Add a working-tree status badge in the RepositoryPage header. Show `Clean` in green when `RepositoryGitStatus.diff` is empty, and `Dirty` in red when diff entries exist.

## Implementation Plan

1. Add `.badge.danger` styling in `packages/frontend/src/styles/index.css`.
2. Render the clean/dirty badge next to the existing Git badge in `packages/frontend/src/pages/RepositoryPage.tsx`.
3. Add tests covering clean, dirty, and no-Git behavior in `packages/frontend/src/pages/__tests__/RepositoryPage.test.tsx`.

## Validation

- `make qa-quick`

## Notes

- The fix reuses existing `gitStatus` data already loaded by `RepositoryPage`.
- The initial implementation was adjusted to clear stale git status before loading a different repository.
