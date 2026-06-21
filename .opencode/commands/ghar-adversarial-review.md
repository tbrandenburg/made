---
description: Attack the implementation with adversarial tests focused on issue closure
argument-hint: <issue-number>
---

# Adversarial Review

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

Require `spec-approved`, `tests-created`, and `implementation-done`. Fetch and check out the latest shared branch. Preserve independence: do not read `maintainer-review-findings`. Review the exact implementation commit identified by `implementation-done`, not a moving branch tip. Attack realistic assumptions using boundaries, invalid inputs, compatibility, concurrency, security, and data integrity as applicable, but only when they can uncover a real issue-closure gap. Prefer black-box, runtime-observable checks over implementation-coupled or source-inspection tests whenever the public behavior can expose the defect. Also attack premature CI handoff and implementation-coupled tests that can be replaced by behavior-based checks. Explicitly probe null/empty inputs, stale state, race conditions, and boundary values against the real production diff.

You may modify only tests, fixtures, snapshots, and test-only helpers. Add a minimal adversarial test only when it demonstrates a credible uncovered scenario that matters to the issue. Run relevant tests. If files changed, commit and push only `HEAD:refs/heads/$BRANCH`; otherwise do not create an empty commit.

Publish `<!-- adversarial-review-findings -->` with:

1. `# Adversarial Review Findings`
2. Attack scenarios attempted and evidence
3. Adversarial tests added, commit SHA, and exact commands (or state none)
4. Failures found and severity
5. Residual risk assessment

## Boundaries

Do not modify production code/spec, read reviewer output, duplicate existing coverage, or add unrealistic tests. Inspect changed paths before commit and revert anything outside test ownership.
