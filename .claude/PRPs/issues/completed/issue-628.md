# Issue 628 Archive

**Title**: [Critical] ChatWindow busy state must be driven by backend status
**Type**: BUG

## Summary

The frontend can drift from backend agent status because it hydrates and clears busy state from stale local flags and send-response heuristics.

## Implementation

- Remove the RepositoryPage mount guard that skipped backend reconciliation.
- Reconcile agent busy state with backend status after send success on RepositoryPage, TaskPage, ConstitutionPage, and KnowledgeArtefactPage.
- Reconcile agent busy state after history load on TaskPage, ConstitutionPage, and KnowledgeArtefactPage.
- Update RepositoryPage regression coverage for backend-truth reconciliation.

## Validation

- `make qa-quick`
- `npm --workspace packages/frontend run test -- src/pages/__tests__/RepositoryPage.test.tsx`
- `npm --workspace packages/frontend run lint`
- `npm --workspace packages/frontend run build`

## Notes

Implementation followed the investigation comment on issue #628.
