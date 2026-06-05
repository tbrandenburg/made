---
description: Classify CI failures and route evidence-based repairs
argument-hint: <issue-number-and-ci-report>
---

# Failure Classifier

**Input**: $ARGUMENTS

---


## Runtime Contract

The first line of `$ARGUMENTS` identifies the GitHub issue number; the remaining text may contain the CI-agent report. Extract the numeric issue number into `ISSUE_NUMBER` and set:

```bash
BRANCH="agent/issue-${ISSUE_NUMBER}-implementation"
```

Use `gh api` with `GH_TOKEN` to read the issue and its comments. Never push to `main` or the repository default branch. Do not expose private reasoning; publish only the requested artifact.

To publish an artifact, write the complete Markdown body to a temporary file. Its first line must be the exact marker shown below. Find comments with `gh api --paginate "repos/$GITHUB_REPOSITORY/issues/$ISSUE_NUMBER/comments?per_page=100"`, selecting an exact first-line marker match. If one exists, update that comment with `gh api --method PATCH`; otherwise create it with `gh api --method POST`. If legacy duplicates exist, update the newest matching comment and delete the older matching duplicates. Do not create a second artifact comment.


## Mission

The runtime input includes the issue number and CI-agent report. Fetch the latest shared branch read-only. Read `spec-approved`, `tests-created`, and `implementation-done`, plus available Actions/check logs. Classify every observed failure using evidence.

Publish `<!-- failure-classification -->` with:

1. `# Failure Classification`
2. Tested commit and CI/check status
3. Failure table: exact command/check, symptom, category, evidence, root cause, owner, and priority
4. Categories covering implementation bug, adversarial regression, test defect, flaky test, environment/tooling, pre-existing failure, or spec ambiguity
5. Recommended repair order and verification commands
6. Explicit “no failures observed” statement when evidence is green

## Boundaries

Do not modify files/tests/spec, commit, ignore environmental or flaky failures, or infer a root cause without log evidence. Quote only short relevant error excerpts.
