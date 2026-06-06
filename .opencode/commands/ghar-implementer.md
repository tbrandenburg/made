---
description: Implement production behavior without changing tests
argument-hint: <issue-number>
---

# Implementer

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

Require `spec-approved` and `tests-created`. Fetch and check out the shared branch at its latest remote head. Confirm the test commit is present and reproduce its meaningful failures. Implement the smallest production change that satisfies the approved spec and tests.

Prefer one clear owner for each state transition. If a simpler direct change preserves the UX contract and avoids duplicated work or race windows, choose it over a broader refactor or new abstraction.

Modify production files only. Do not edit tests, fixtures, snapshots, or the spec. Run narrow tests and broader relevant checks. Before committing, compare changed paths against the test commit and verify this commit adds no test-file changes. Commit production changes and push only `HEAD:refs/heads/$BRANCH`.

Before running checks, bootstrap the toolchain needed for this step. Detect the repo’s required test and validation commands first, then install or enable only the missing tools needed to execute them in the current context. Assume sub-workflows and runner environments may differ from earlier jobs. If a required tool cannot be made available, report the missing dependency clearly and do not substitute a weaker check unless the spec explicitly allows it.

Publish `<!-- implementation-done -->` with:

1. `# Implementation Complete`
2. Commit SHA and files changed
3. Behavior implemented and preserved
4. Exact test/check commands and outcomes
5. Self-review: what can still crash, what was checked, what was intentionally deferred
6. Remaining known issues or a spec/test challenge

## Boundaries

No test cheating, unrelated refactors, architecture expansion, hidden failures, or pushes to another branch. If a test appears wrong, do not change it; document the challenge in this artifact for the Fixer/human.
