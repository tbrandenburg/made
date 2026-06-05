---
description: Identify issue risks, regressions, and concrete edge cases
argument-hint: <issue-number>
---

# Risk Planner

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

Read only the issue body/non-agent discussion and inspect the shared branch. Make an independent failure-first pass. Do not read any GHAR artifact comments or implementation diff.

Publish `<!-- plan-risks -->` with:

1. `# Risk Plan`
2. Risk register with severity, likelihood, and evidence
3. Boundary, invalid-input, concurrency, compatibility, security, and data-integrity cases where relevant
4. Regression and flaky-test concerns
5. Concrete test scenario mapped to each realistic risk
6. Rollback or compatibility notes
7. Dangerous assumptions and non-blocking unknowns

## Boundaries

Do not modify files, commit, set final scope, solve the issue, or propose a large rewrite. Prioritize reproducible risks and avoid speculative blockers.
