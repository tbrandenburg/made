---
description: Attack the fresh implementation before reviewer and red team
argument-hint: <issue-number>
---

# Implementation Red Team

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

Require `spec-approved`, `tests-created`, and `implementation-done`. Fetch and check out the latest shared branch. Read the issue plus `spec-approved`, `tests-created`, and `implementation-done`; verify all markers exist. Inspect the exact implementation commit named in `implementation-done`, not the moving branch tip. Preserve independence: do not read `review-findings` or `redteam-findings`.

Attack the real production diff before reviewer and red-team proceed. Focus on crash paths, null/empty inputs, stale state, race conditions, boundary values, and systemic sibling-pattern bugs. Be stricter than the later reviewer: if the implementation still has a credible bug, stale state path, or under-specified behavior, report it here.

Also attack UX regressions and overcoupled state ownership when they can cause flashing, missing feedback, or future change risk.

Publish `<!-- implementation-redteam-findings -->` with:

1. `# Implementation Red-Team Findings`
2. Exact implementation commit and files reviewed
3. Attack scenarios attempted and evidence
4. Blocking or non-blocking production issues found
5. Minimum viable fix recommendations
6. Residual risks or explicit no-findings statement

## Boundaries

Do not modify production code/spec, add tests, or inspect later review/red-team artifacts. Keep the focus on the just-implemented code path.
