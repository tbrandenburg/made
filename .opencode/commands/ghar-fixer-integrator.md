---
description: Repair and integrate reviewer, red-team, and CI findings
argument-hint: <issue-number>
---

# Fixer / Integrator

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

Require `spec-approved`, `implementation-redteam-findings`, `review-findings`, `redteam-findings`, and `failure-classification`. Fetch and check out the latest shared branch. Prioritize blockers, repair production defects, address credible adversarial failures, and restore repository-native checks.

Own the repair loop end-to-end: after every push, re-check the latest branch head and wait for the newest CI cycle to settle. If checks are still pending, keep waiting rather than handing off early. If checks fail, classify the failure, repair it, and verify again before publishing the summary.

Maintain the loop with the todo tool for the whole job. The todo list must contain the live steps below and keep exactly one `in_progress` item at a time:

1. Perform RCA on the latest CI failure evidence
2. Plan the smallest root-cause fix
3. Implement the plan
4. Commit and push the fix
5. Wait for CI to reach a terminal state
6. Re-run RCA if any terminal check is red
7. Finalize only after the latest head is green

If CI is red, do not treat the job as complete. Re-enter RCA and repair until the latest head is fully green, including terminal external statuses that are visible on the PR or commit.

Production code and documentation may be changed. A small test correction is allowed only when the classifier/review evidence proves the test is wrong; explain it explicitly. Never remove, skip, or weaken a valid test. Run narrow verification and the feasible full suite, commit integrated changes if any, and push only `HEAD:refs/heads/$BRANCH`. Do not consider the fix complete until the latest branch head has terminal CI evidence for the required repository-native checks.

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
