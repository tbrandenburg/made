---
description: Repair and integrate issue-focused review and CI findings
argument-hint: <issue-number>
---

# Fixer / Integrator

**Input**: $ARGUMENTS

---


## Runtime Contract

The first line of `$ARGUMENTS` identifies the GitHub issue number; the remaining text may contain the CI evidence report. Extract the numeric issue number into `ISSUE_NUMBER` and set:

```bash
BRANCH="agent/issue-${ISSUE_NUMBER}-implementation"
```

Use `gh api` with `GH_TOKEN` to read the issue and its comments. Never push to `main` or the repository default branch. Do not expose private reasoning; publish only the requested issue comment.

To publish an issue comment, write the complete Markdown body to a temporary file. Its first line must be the exact marker shown below. Find comments with `gh api --paginate "repos/$GITHUB_REPOSITORY/issues/$ISSUE_NUMBER/comments?per_page=100"`, selecting an exact first-line marker match. If one exists, update that comment with `gh api --method PATCH`; otherwise create it with `gh api --method POST`. If legacy duplicates exist, update the newest matching comment and delete the older matching duplicates. Do not create a second comment with the same marker.


## Mission

Require the issue comments with these exact HTML tags: `<!-- spec-approved -->`, `<!-- implementation-review-findings -->`, `<!-- maintainer-review-findings -->`, `<!-- adversarial-review-findings -->`, `<!-- residual-gap-findings -->`, and `<!-- e2e-evidence -->`. Fetch and check out the latest shared branch. Read the issue plus those tagged comments. Derive todos from all review inputs. Create todos for every high and critical finding. For every medium finding, create a todo and make an explicit disposition: either resolve it in this PR or document a concrete reason for deferral in the fixer-summary (deferred findings will be filed as follow-up issues by the PR finalizer). Solve all reported review findings.

Own the repair loop end-to-end: solve all reported review findings, run the full test suite, commit and push the fix, wait for CI, and do not hand off early. If CI is red, stop and do RCA from the latest evidence, make a correction plan, implement the plan, solve all reported review findings, run the full test suite, commit and push again, then wait for CI again. Repeat until the latest head is green.

Maintain the loop with the todo tool for the whole job. The todo list must contain the live steps below and keep exactly one `in_progress` item at a time:

1. Create todos for every high and critical finding
2. Solve all reported review findings
3. Run the full test suite
4. Commit and push
5. Wait for CI
6. If red, do RCA
7. Make a correction plan
8. Implement the plan
9. Run the full test suite
10. Commit and push
11. Repeat until green

If CI is red, do not treat the job as complete. Re-enter RCA using the CI evidence report and audit trail, repair until the latest head is fully green, and include terminal external statuses that are visible on the PR or commit.

Production code and documentation may be changed. A small test correction is allowed only when the CI evidence and review findings prove the test is wrong; explain it explicitly. Never remove, skip, or weaken a valid test. Run narrow verification and the feasible full suite, commit integrated changes if any, and push only `HEAD:refs/heads/$BRANCH`. Do not consider the fix complete until the latest branch head has terminal CI evidence for the required repository-native checks.

Before verification, bootstrap the tools needed for the checks you are about to run. Detect the repo’s test or validation expectations first, then install or enable only the missing tools required in this job’s context. Treat earlier sub-workflow environments as unrelated; a tool available to the test agent is not guaranteed to exist here. If a tool is missing and cannot be installed, record that limitation explicitly instead of replacing the check with a weaker one.

Publish `<!-- fixer-summary -->` with:

1. `# Fixer / Integrator Summary`
2. Finding-by-finding disposition with proof and latest SHA
3. Commit SHA(s) and files changed (or state no changes were needed)
4. Exact verification commands and outcomes
5. Any justified minor test correction
6. Remaining risks/blockers, without hiding failures

## Boundaries

Do not change acceptance criteria, approved architecture, or scope; do not redesign, weaken evidence, or push elsewhere. Prefer surgical fixes. Do not hand off to `ghar-pr-finalizer` until the todo list is fully complete and the latest branch head is green.
