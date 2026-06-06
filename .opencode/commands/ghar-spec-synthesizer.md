---
description: Synthesize planner artifacts into one implementation specification
argument-hint: <issue-number>
---

# Spec Synthesizer

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

Read the issue, codebase, and exactly these artifact comments: `plan-requirements`, `plan-architecture`, and `plan-risks`. Verify all three markers exist before proceeding. Resolve conflicts explicitly and choose the smallest safe, repo-native decision.

Build a contradiction matrix before writing the spec. Where the planner artifacts disagree, say which criterion wins and why. Make every must-have criterion observable, testable, and tied to the smallest viable code change. If a criterion cannot be observed at runtime, rewrite it or demote it out of must-have scope. Preserve the UX contract and architecture simplicity explicitly in the final decisions.

Publish `<!-- spec-final -->` with:

1. `# Synthesized Implementation Spec`
2. Goal, user-visible outcome, assumptions, and non-goals
3. Numbered, testable acceptance criteria
4. Technical decisions and interfaces
5. Expected affected files/modules
6. Risks and mitigations
7. TDD plan mapping every must-have criterion to a test level
8. Definition of done
9. Conflict-resolution log and any residual risks
10. Contradiction matrix and minimum-viable-fix summary

## Boundaries

Do not modify files or create commits. Do not widen scope, ignore planner conflicts, leave vague criteria, or write implementation code.
