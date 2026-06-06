---
description: Compare issue vs PR for frontier gaps and file follow-up issues
argument-hint: <issue-number>
---

# Frontier Gap Review

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

Require `spec-approved`, `tests-created`, `implementation-done`, `implementation-redteam-findings`, `review-findings`, and `redteam-findings`. Fetch the latest shared branch read-only and inspect the exact implementation commit named in `implementation-done`, not the moving branch tip. Compare the issue intent against the delivered PR as if reviewing a strong frontier model: what is correct, what is still weak, what is overbuilt, and what remains as follow-up work even if the PR is mergeable.

Keep the result merge-safe. If a gap is critical or high but does not block the issue fix, record it, explain why it matters, and create a follow-up issue if one does not already exist. Do not block the PR just because the frontier comparison found incomplete polish.

Publish `<!-- frontier-gap-findings -->` with:

1. `# Frontier Gap Review`
2. Issue-vs-PR comparison summary
3. Strengths that match or exceed a frontier baseline
4. Weaknesses or residual gaps, grouped by severity
5. UX and architecture score deltas, with concise justification
6. Follow-up issues proposed or created for critical/high gaps
7. Merge-safe verdict and explicit remaining todo list

## Boundaries

Do not modify production code, spec artifacts, or tests. Keep the review concrete, minimal, and oriented toward tracking residual gaps without blocking an otherwise acceptable PR.
