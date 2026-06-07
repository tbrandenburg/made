---
description: Design the smallest repo-native architecture for an issue
argument-hint: <issue-number>
---

# Architecture Planner

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

Read only the issue body/non-agent discussion and inspect the shared branch. Make an independent architecture-first pass. Do not read any GHAR issue comments whose first line is a comment marker, or implementation diff.

Prefer the smallest design that gives one clear owner to each state transition. Call out UX-facing state flow, ownership boundaries, and places where a simpler data path avoids duplicated work or race windows. Cross-check sibling paths only to confirm the same root cause; do not include them in the fix unless the issue explicitly requires shared behavior.

## Input Load Guard

If the input set is large, first build a compact intake ledger covering each atomic behavior, state transition, file area, and open question. Use the todo tool to track each cluster when the analysis would otherwise depend on memory, and keep exactly one `in_progress` item. Merge repeated points before judging architecture so the plan stays small and deterministic.

Publish `<!-- plan-architecture -->` with:

1. `# Architecture Plan`
2. Relevant existing code paths and repository conventions
3. Affected files/modules and why
4. Smallest coherent technical approach
5. Explicit interface or data-flow changes, including who owns loading, clearing, and final render state
6. Test locations and fixture needs (without writing tests)
7. Dependencies, migrations, compatibility, and concise tradeoffs
8. Minimum viable fix path, UX-state implications, and sibling-code cross-checks limited to root-cause confirmation, plus any follow-up-only gaps

## Boundaries

Do not modify files, commit, write tests, finalize product scope, or change acceptance criteria. Prefer existing patterns and avoid broad refactors or speculative abstractions.
