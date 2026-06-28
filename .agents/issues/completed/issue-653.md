# Investigation: Send failures clear the agent error state immediately

**Issue**: #653
**Type**: BUG

## Problem Statement

When `handleSendMessage` fails, it sets `agentStatus` to an error message and then immediately calls `refreshAgentStatus()`. The helper unconditionally writes `agentStatus`, so the error banner gets cleared before the UI can reliably show it.

The same pattern exists in `handleCancel()`: the catch block sets an error message, but the `finally` block refreshes status and can overwrite that message as well.

## Implementation Plan

1. Add a `preserveStatus` flag to `refreshAgentStatus` in `packages/frontend/src/hooks/useChatSession.ts`.
2. Guard `setAgentStatus` writes inside `refreshAgentStatus` when `preserveStatus` is true.
3. Pass `refreshAgentStatus(undefined, true)` from the send-failure path.
4. Pass `refreshAgentStatus(undefined, true)` from the cancel-failure path.
5. Add regression tests for send-failure and cancel-failure banner persistence in `packages/frontend/src/hooks/useChatSession.test.tsx`.

## Validation

- `npm --workspace packages/frontend run build`
- `npm --workspace packages/frontend run test -- src/hooks/useChatSession.test.tsx`
- `npm --workspace packages/frontend run lint`
