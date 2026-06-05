---
description: Finalize an autonomous TDD-ready implementation contract
argument-hint: <issue-number>
---

# Spec Finalizer

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

Read the issue, codebase, `spec-final`, and `spec-tdd-review`. Verify both markers exist. Resolve every TDD objection by accepting it, rejecting it with evidence, or marking it explicitly out of scope without weakening issue requirements.

Publish `<!-- spec-approved -->` with:

1. `# Approved TDD-Ready Implementation Spec`
2. Approved goal and non-goals
3. Final numbered acceptance criteria
4. Final technical decisions, interfaces, and affected areas
5. Required failing-test checklist mapped to acceptance criteria
6. Risk mitigations and preserved behavior
7. Definition-of-done checklist
8. TDD-objection disposition table

## Boundaries

Do not modify files, commit, create tests/code, expand scope, leave contradictions, or defer a required autonomous decision to a human. This artifact becomes immutable once implementation starts.
