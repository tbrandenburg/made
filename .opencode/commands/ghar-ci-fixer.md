---
description: Repair CI failures, retrigger checks, and converge to green
argument-hint: <issue-number>
---

# CI Fixer

**Input**: $ARGUMENTS

---

## Runtime Contract

Extract the GitHub issue number from the first line of `$ARGUMENTS`. Set `ISSUE_NUMBER` to that numeric value and set:

```bash
BRANCH="agent/issue-${ISSUE_NUMBER}-implementation"
```

Use `gh api` with `GH_TOKEN` to read the issue, PR, and check data. Never push to `main` or the repository default branch. Do not expose private reasoning; publish only the requested issue comment.

To publish an issue comment, write the complete Markdown body to a temporary file. Its first line must be the exact marker shown below. Find comments with `gh api --paginate "repos/$GITHUB_REPOSITORY/issues/$ISSUE_NUMBER/comments?per_page=100"`, selecting an exact first-line marker match. If one exists, update that comment with `gh api --method PATCH`; otherwise create it with `gh api --method POST`. If legacy duplicates exist, update the newest matching comment and delete the older matching duplicates. Do not create a second comment with the same marker.

## Mission

Own the CI repair loop end-to-end: check the current branch and PR head, gather failing CI evidence, do RCA from the latest evidence, make a correction plan, implement the fix, validate it, commit and push, then retrigger CI using the PR head SHA. Repeat until the latest head is green or the loop cap is reached.

Do not do review-comment triage or rebuild the review findings ledger here. This command exists for CI repair only.

If a `<!-- fixer-summary -->` comment already exists from the review fixer, preserve its review-finding disposition section when updating the comment and append the CI repair details below it. The shared summary must remain complete for the PR finalizer.

Maintain the todo tool for the whole job. Keep exactly one `in_progress` item at a time:

1. Check the current PR and head SHA
2. Gather CI failure evidence
3. Do RCA and make a correction plan
4. Implement the fix
5. Validate locally
6. Commit and push
7. Retrigger CI by head SHA
8. Repeat until green

Production code and documentation may be changed. A small test correction is allowed only when the CI evidence proves the test is wrong; explain it explicitly. Never remove, skip, or weaken a valid test. Run narrow verification and the feasible full suite, commit integrated changes if any, and push only `HEAD:refs/heads/$BRANCH`.

## CI Context

You are invoked by the outer GHAR workflow only after CI has already run on the branch head and produced failures. The outer workflow is responsible for all PR retrigger operations (close/reopen via PAT); your sole responsibility is to diagnose the failures, implement a fix, validate it locally, and push the correction. Do not attempt to rerun, rerequest, or retrigger CI yourself — after you push, the outer workflow will close/reopen the PR to schedule a fresh CI run on your new commit.

Use the PR head SHA as the source of truth when reading CI results. Query existing workflow runs with:

```bash
SHA=$(git rev-parse HEAD)
gh api "repos/$GITHUB_REPOSITORY/actions/runs?head_sha=$SHA" \
  --jq '.workflow_runs[] | {id, name, status, conclusion}'
```

Before verification, bootstrap the tools needed for the checks you are about to run. Detect the repo’s test or validation expectations first, then install or enable only the missing tools required in this job’s context. Treat earlier sub-workflow environments as unrelated; a tool available to another agent is not guaranteed to exist here. If a tool is missing and cannot be installed, record that limitation explicitly instead of replacing the check with a weaker one.

Publish `<!-- fixer-summary -->` with:

1. `# CI Fixer Summary`
2. Root cause, correction plan, and latest SHA, plus the preserved review-finding disposition summary when one exists
3. Commit SHA(s) and files changed, or state no changes were needed
4. Exact verification commands and outcomes
5. CI rerun commands and results
6. Remaining risks or blockers, without hiding failures

## Boundaries

Do not change acceptance criteria, approved architecture, or scope; do not redesign, weaken evidence, or push elsewhere. Prefer surgical fixes. Do not hand off to `ghar-pr-finalizer` until the latest branch head is green.
