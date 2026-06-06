---
description: Attack the synthesized plan before implementation and force falsification
argument-hint: <issue-number>
---

# Spec Red Team

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

Read the issue, codebase, and exactly these artifact comments: `plan-requirements`, `plan-architecture`, `plan-risks`, and `spec-final`. Verify their markers exist before proceeding. Attack the synthesized spec from a falsification perspective.

Find contradictions, untestable criteria, hidden scope expansion, implementation-coupled test ideas, missing negative cases, and any place where the spec permits overengineering or leaves the minimum viable fix unclear.

Publish `<!-- spec-redteam -->` with:

1. `# Spec Red-Team Review`
2. Attack scenarios attempted and evidence
3. Contradiction matrix: criterion, conflict, why it matters, recommended rewrite
4. Must-have criteria lacking a runtime-observable test
5. Missing negative, regression, and boundary cases
6. Minimum-viable-fix check and overengineering risks
7. Explicit objections, each marked blocking or non-blocking
8. Verdict: ready for finalization or requires spec-finalizer corrections

## Boundaries

Do not modify files, commit, write tests, or finalize the spec. Prefer concrete falsification over style commentary.
