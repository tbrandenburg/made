---
description: Challenge timing-sensitive or async specs for race conditions, stale state, and lifecycle gaps
argument-hint: <issue-number>
---

# Timing Review

**Input**: $ARGUMENTS

---

## Runtime Contract

Extract the GitHub issue number from `$ARGUMENTS`. Set `ISSUE_NUMBER` to that numeric value and set:

```bash
: "${BRANCH:?BRANCH must be provided by the workflow}"
```

Use `gh api` with `GH_TOKEN` to read the issue and its comments. Never push to `main` or the repository default branch. Do not expose private reasoning; publish only the requested issue comment.

To publish an issue comment, write the complete Markdown body to a temporary file. Its first line must be the exact marker shown below. Find comments with `gh api --paginate "repos/$GITHUB_REPOSITORY/issues/$ISSUE_NUMBER/comments?per_page=100"`, selecting an exact first-line marker match. If one exists, update that comment with `gh api --method PATCH`; otherwise create it with `gh api --method POST`. If legacy duplicates exist, update the newest matching comment and delete the older matching duplicates. Do not create a second comment with the same marker.

## Mission

Read the issue, codebase, and exactly the `spec-final` issue comment. Verify its marker exists before proceeding. Attack any feature whose correctness depends on ordering, cancellation, retries, delayed callbacks, polling, debounce/throttle, cache invalidation, unmount, or other timing boundaries.

Every must-have criterion that is timing-sensitive or async must map to a runtime-observable test. Prefer behavior-level assertions over source inspection or private implementation probes whenever the behavior is observable through the public surface. If the behavior can be observed at runtime, a source-parsing test is not sufficient. Include explicit lifecycle and teardown tests when the issue mentions loading, clearing, stale content, cancellation, timeout behavior, or error feedback.

Require at least one behavior-level test, one negative case, and one regression case for each must-have criterion where applicable. For every async or timing-relevant operation introduced or modified by the spec: require at least one test where an invalidating concurrent event (second invocation, superseding request, abort, clear, timeout, or component unmount) occurs after the await and before any state mutation. If no such test exists in the TDD plan, add it to the required initial failing tests.

## Input Load Guard

Before judging the spec, build a compact traceability ledger with one row per must-have criterion and its behavior, negative, regression, fixture, and failure-message coverage. Use the todo tool to track each criterion cluster when the spec is large, and keep exactly one `in_progress` item. If a criterion cannot map to a runtime-observable test, mark it untestable immediately instead of carrying it in memory.

Publish `<!-- timing-review-findings -->` with:

1. `# Timing Review`
2. Criterion-to-test traceability table
3. Required initial failing tests, separated into unit/integration/smoke levels
4. Missing negative and regression cases
5. Fixture, isolation, determinism, and failure-message expectations
6. Explicit spec objections, each marked blocking or non-blocking
7. Timing, lifecycle, and teardown gaps that should remain visible to later stages
8. A verdict: ready for finalization or requires spec-finalizer corrections

## Boundaries

Do not modify files, commit, write repository tests, redesign architecture, or inspect future implementation comments. Every must-have criterion must be provable by a test or identified as untestable.
