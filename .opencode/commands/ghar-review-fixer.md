---
description: Repair and integrate review findings for an issue
argument-hint: <issue-number>
---

# Review Fixer

**Input**: $ARGUMENTS

---

## Runtime Contract

Extract the GitHub issue number from the first line of `$ARGUMENTS`. Set `ISSUE_NUMBER` to that numeric value and set:

```bash
BRANCH="agent/issue-${ISSUE_NUMBER}-implementation"
```

Use `gh api` with `GH_TOKEN` to read the issue and its comments. Never push to `main` or the repository default branch. Do not expose private reasoning; publish only the requested issue comment.

To publish an issue comment, write the complete Markdown body to a temporary file. Its first line must be the exact marker shown below. Find comments with `gh api --paginate "repos/$GITHUB_REPOSITORY/issues/$ISSUE_NUMBER/comments?per_page=100"`, selecting an exact first-line marker match. If one exists, update that comment with `gh api --method PATCH`; otherwise create it with `gh api --method POST`. If legacy duplicates exist, update the newest matching comment and delete the older matching duplicates. Do not create a second comment with the same marker.

## Mission

Require the issue comments with these exact HTML tags: `<!-- spec-approved -->`, `<!-- implementation-review-findings -->`, `<!-- maintainer-review-findings -->`, `<!-- adversarial-review-findings -->`, `<!-- residual-gap-findings -->`, and `<!-- e2e-evidence -->`. Fetch and check out the latest shared branch. Read the issue plus those tagged comments. 

**Spec Non-goals pre-check — mandatory before creating any todo**: Extract the Non-goals list from `spec-approved` and the `## Fixer Scope Lock` section if present. For every finding across all review inputs: if the finding touches something in that list, the disposition is **DEFERRED-NONGOAL** — record the exact Non-goal citation in the fixer-summary and do not create a resolve todo. This check overrides the medium/high severity tier and runs before the steps below.

Derive todos from all review inputs. Create todos for every high and critical finding. For every medium finding, create a todo and make an explicit disposition: either resolve it in this PR or document a concrete reason for deferral in the fixer-summary.

Own review finding resolution end-to-end: solve all reported review findings, run the feasible full test suite, commit and push the fix, and stop before any CI retry loop. Do not handle CI polling, reruns, or retry-loop control here.

Maintain the todo tool for the whole job. Keep exactly one `in_progress` item at a time:

1. Create todos for every high and critical finding
2. Solve all reported review findings
3. Run the feasible full test suite
4. Commit and push
5. Publish the review summary

Production code and documentation may be changed. A small test correction is allowed only when the evidence and review findings prove the test is wrong; explain it explicitly. Never remove, skip, or weaken a valid test. Run narrow verification and the feasible full suite, commit integrated changes if any, and push only `HEAD:refs/heads/$BRANCH`.

Publish `<!-- fixer-summary -->` with:

1. `# Review Fixer Summary`
2. Finding-by-finding disposition with proof and latest SHA
3. Commit SHA(s) and files changed, or state no changes were needed
4. Exact verification commands and outcomes
5. Any justified minor test correction
6. Remaining risks or deferred findings, without hiding failures

## Boundaries

Do not change acceptance criteria, approved architecture, or scope; do not redesign, weaken evidence, or push elsewhere. Prefer surgical fixes. Hand off to the CI fixer only after the review findings are resolved and the branch has been pushed.
