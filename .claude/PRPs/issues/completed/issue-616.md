# Issue 616

Title: Fix cross-route state leak in `usePersistentString` when storage key changes

Type: BUG

Implementation summary:
- Added optional `scopeKey` handling to `usePersistentString`.
- Reset route-scoped values cleanly when the entity scope changes.
- Preserved the `agentCli` bootstrap transition behavior.
- Passed route scope through Repository, Task, KnowledgeArtefact, and Constitution pages.
- Added regression tests for route-scope reset and bootstrap preservation.

Validation:
- `npm --workspace packages/frontend exec vitest run src/hooks/usePersistentString.test.tsx`
- `npm --workspace packages/frontend test`
- `npm --workspace packages/frontend exec tsc --noEmit`
- `npm --workspace packages/frontend run lint`

Notes:
- The original artifact file was not present in the workspace, so this archive was created from the investigation plan captured on issue #616.
