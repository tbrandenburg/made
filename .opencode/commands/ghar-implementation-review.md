---
description: Attack the implementation for issue-focused correctness gaps before broader review
argument-hint: <issue-number>
---

# Implementation Review

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

Require `spec-approved`, `tests-created`, and `implementation-done`. Fetch and check out the latest shared branch. Read the issue plus `spec-approved`, `tests-created`, and `implementation-done`; verify all markers exist. Inspect the exact implementation commit named in `implementation-done`, not the moving branch tip. Preserve independence: do not read `maintainer-review-findings`, `adversarial-review-findings`, or `residual-gap-findings`.

Attack the real production diff before broader review proceeds. Focus on crash paths, null/empty inputs, stale state, race conditions, boundary values, and systemic sibling-pattern bugs only when they materially affect issue coverage and closure. Prefer the smallest credible defect over broad polish complaints. Compare the implementation commit against the spec's expected affected files; any extra production file or test file outside that scope is a defect unless the spec explicitly allowed it. Treat additional sibling defects as follow-up issues unless they share the same root cause and block closure. Avoid broad architectural critique unless it blocks the issue from being solved cleanly.

Publish `<!-- implementation-review-findings -->` with:

1. `# Implementation Review Findings`
2. Exact implementation commit and files reviewed
3. Attack scenarios attempted and evidence
4. Blocking or non-blocking production issues found
5. Minimum viable fix recommendations
6. Residual risks or explicit no-findings statement
7. Scope delta assessment: required issue files vs extra touched paths, with justification or follow-up

## Boundaries

Do not modify production code/spec, add tests, or inspect later review/red-team comments. Keep the focus on the just-implemented code path.
