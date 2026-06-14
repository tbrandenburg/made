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

Use `gh api` with `GH_TOKEN` to read the issue and its comments. Never push to `main` or the repository default branch. Do not expose private reasoning; publish only the requested issue comment.

To publish an issue comment, write the complete Markdown body to a temporary file. Its first line must be the exact marker shown below. Find comments with `gh api --paginate "repos/$GITHUB_REPOSITORY/issues/$ISSUE_NUMBER/comments?per_page=100"`, selecting an exact first-line marker match. If one exists, update that comment with `gh api --method PATCH`; otherwise create it with `gh api --method POST`. If legacy duplicates exist, update the newest matching comment and delete the older matching duplicates. Do not create a second comment with the same marker.


## Mission

Read the issue, codebase, `spec-final`, `spec-redteam`, and `spec-tdd-review`. Verify all markers exist. Resolve every objection by accepting it, rejecting it with evidence, or rewriting the spec so the objection disappears without weakening issue requirements.

Reject any spec that still contains untestable must-have criteria, unresolved contradictions, implementation-coupled test language, an unbounded affected-file list, or an unclear minimum viable fix. Keep the contract testable through observable behavior. Preserve the simplest architecture that still satisfies the UX contract.

## Input Load Guard

If there are many objections or long upstream notes, first build a compact disposition ledger with one row per objection, criterion, or residual risk. Use the todo tool to track each cluster when the decision load is high, and keep exactly one `in_progress` item. Resolve each row as accepted, rejected with evidence, or rewritten away so the final spec does not rely on memory.

Publish `<!-- spec-approved -->` with:

1. `# Approved TDD-Ready Implementation Spec`
2. Approved goal and non-goals
3. Final numbered acceptance criteria
4. Final technical decisions, interfaces, and affected areas
5. Required failing-test checklist mapped to acceptance criteria
6. Risk mitigations, preserved behavior, and UX-state expectations
7. Definition-of-done checklist
8. TDD-objection disposition table
9. Red-team objection disposition table
10. `## Fixer Scope Lock` — a bullet list of the exact identifiers, files, and constructs that are explicitly forbidden from being touched by any downstream agent. Derive this directly from the Non-goals section. Each bullet must be specific enough for a grep match (e.g. a variable name, file path, or CSS class). Label the section clearly so the fixer and residual-gap reviewer can find it without reading the full spec.

## Boundaries

Do not modify files, commit, create tests/code, expand scope, leave contradictions, or defer a required autonomous decision to a human. This comment becomes immutable once implementation starts.
