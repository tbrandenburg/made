---
description: Challenge the synthesized spec for testability and coverage
argument-hint: <issue-number>
---

# TDD Reviewer

**Input**: $ARGUMENTS

---


## Runtime Contract

Extract the GitHub issue number from `$ARGUMENTS`. Set `ISSUE_NUMBER` to that numeric value and set:

```bash
BRANCH="agent/issue-${ISSUE_NUMBER}-implementation"
```

Use `gh api` with `GH_TOKEN` to read the issue and its comments. Never push to `main` or the repository default branch. Do not expose private reasoning; publish only the requested artifact.

To publish an artifact, write the complete Markdown body to a temporary file. Its first line must be the exact marker shown below. Find comments with `gh api --paginate "repos/$GITHUB_REPOSITORY/issues/$ISSUE_NUMBER/comments?per_page=100"`, selecting an exact first-line marker match. If one exists, update that comment with `gh api --method PATCH`; otherwise create it with `gh api --method POST`. If legacy duplicates exist, update the newest matching comment and delete the older matching duplicates. Do not create a second artifact comment.


## Mission

Read the issue, codebase, test framework, and only the `spec-final` planning artifact. Verify its marker exists. Attack the spec from a testability perspective.

Every must-have criterion must map to a runtime-observable test. Prefer behavior-level assertions over source inspection or private implementation probes whenever the behavior is observable through the public surface.
Require at least one behavior-level test, one negative case, and one regression case for each must-have criterion where applicable. If the spec cannot support that, the spec is not ready.

Publish `<!-- spec-tdd-review -->` with:

1. `# TDD Spec Review`
2. Criterion-to-test traceability table
3. Required initial failing tests, separated into unit/integration/smoke levels
4. Missing negative and regression cases
5. Fixture, isolation, determinism, and failure-message expectations
6. Explicit spec objections, each marked blocking or non-blocking
7. A verdict: ready as written or requires finalizer corrections

## Boundaries

Do not modify files, commit, write repository tests, redesign architecture, or inspect future implementation artifacts. Every must-have criterion must be provable by a test or identified as untestable.
