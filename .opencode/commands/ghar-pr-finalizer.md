---
description: Create or update the human-ready pull request and final report
argument-hint: <issue-number>
---

# PR Finalizer

**Input**: $ARGUMENTS

---


## Runtime Contract

Extract the GitHub issue number from `$ARGUMENTS`. Set `ISSUE_NUMBER` to that numeric value and set:

```bash
BRANCH="agent/issue-${ISSUE_NUMBER}-implementation"
```

Use `gh api` with `GH_TOKEN` to read the issue and its comments. Never push to `main` or the repository default branch. Do not expose private reasoning; publish only the requested issue comment.

To publish an issue comment, write the complete Markdown body to a temporary file. Its first line must be the exact marker shown below. Find comments with `gh api --paginate "repos/$GITHUB_REPOSITORY/issues/$ISSUE_NUMBER/comments?per_page=100"`, selecting an exact first-line marker match. If one exists, update that comment with `gh api --method PATCH`; otherwise create it with `gh api --method POST`. If legacy duplicates exist, update the newest matching comment and delete the older matching duplicates. Do not create a second comment with the same marker.


## Mission

Require all required issue comments: `spec-approved`, `tests-created`, `implementation-done`, `implementation-review-findings`, `maintainer-review-findings`, `adversarial-review-findings`, `residual-gap-findings`, `pr-seeded`, `ci-evidence`, and `fixer-summary`. Fetch the latest shared branch read-only. Compare it with the repository default branch, inspect commit order, changed files, and available checks.

Treat any CI state older than the latest fixer push as stale. Inspect the latest branch head and report pending, failing, missing, or unobserved required repository-native checks clearly in the PR summary and issue comment. If the head is not fully green, keep the PR draft open and record the blockers; do not wait on a separate hard gate.

If the head is fully green, the PR may be marked ready; if not, leave it draft and make the outstanding status explicit. Terminal external deployment or preview statuses shown by GitHub must be reported, but they do not block updating or publishing the PR.

Create exactly one pull request from `$BRANCH` to the repository default branch, or update the existing open/closed-unmerged pull request for that head. Never create a duplicate. The PR body must link `Closes #$ISSUE_NUMBER` and summarize scope, implementation, TDD commit ordering, tests/checks, review, adversarial, residual-gap, and CI dispositions, plus unresolved risks. Do not enable auto-merge or merge the PR.

Publish `<!-- pr-final -->` with:

1. `# Final PR Readiness Report`
2. PR number and URL
3. Final commit and changed-file summary
4. Artifact-chain completeness
5. Exact verified tests/check status
6. Resolved and unresolved risk summary, including any tracked frontier gaps
7. Human review checklist and explicit merge decision request

## Boundaries

Do not modify files/code/tests/spec, create commits, claim unverified CI success, hide risks, approve, or merge. The human reviewer is the first required interaction and owns the final decision.
