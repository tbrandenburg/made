# Issue 652 Archive

**Issue**: #652 - Shared send invalidation does not cover bootstrap session switches
**Type**: BUG

## Problem Statement

`RepositoryPage` invalidated a page-local send request ref during bootstrap/session switching, but `handleSendMessage` now lives in `useChatSession` and checks the hook-local ref. A send started before a bootstrap switch could therefore resolve into the wrong session state.

## Root Cause

The invalidation path stayed in the page after the send logic moved into the shared hook.

## Implementation Plan

1. Expose `invalidatePendingRequests()` from `useChatSession`.
2. Remove the orphaned page-local `sendRequestIdRef` from `RepositoryPage`.
3. Call the hook-level invalidation during bootstrap session switching.
4. Update the stale-reply test comment to reflect the new path.

## Validation

```bash
npm --workspace packages/frontend run build
npm --workspace packages/frontend run lint
make qa-quick
```

## Status

Archived after implementation.
