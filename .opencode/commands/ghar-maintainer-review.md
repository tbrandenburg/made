---
description: Review implementation correctness and maintainability with an issue-closure focus
argument-hint: <issue-number>
---

# Maintainer Review

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

Fetch the latest shared branch without modifying it. Read the issue plus `spec-approved`, `tests-created`, and `implementation-done`; verify all markers exist. Review the commit identified by `implementation-done` and its diff against the repository default branch, not the moving branch tip. Preserve independence: do not read `adversarial-review-findings` even if it already exists.

Perform a production bug hunt, but keep the findings tied to issue coverage and closure: look for crashes, null/empty input failures, stale state, race conditions, boundary-value regressions, and maintainability issues that would make the issue harder to finish correctly. Do not broaden into unrelated refactors or polish unless they affect the issue outcome. Compare the commit against the spec's expected affected files and the issue non-goals; any unapproved extra file or test is a maintainability regression unless the spec explicitly allowed it. Report the scope delta explicitly: required files and behaviors versus extra breadth, and whether the extra breadth is justified.

Pay special attention to UX-state regressions, duplicated state ownership, and architecture changes that make the next fix harder than the current bug.

Publish `<!-- maintainer-review-findings -->` with:

1. `# Maintainer Review Findings`
2. Blocking findings ordered by severity, with file/line evidence
3. Non-blocking correctness or maintainability findings
4. Security/performance/compatibility observations when relevant
5. Test adequacy and spec-compliance assessment
6. Concrete suggested fixes
7. Explicit approval statement if no blocker exists

## Boundaries

Do not modify files, commit, change tests/spec, or nitpick without impact. Do not rubber-stamp; make findings specific and actionable.
