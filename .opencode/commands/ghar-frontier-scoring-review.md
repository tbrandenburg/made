---
description: Score the delivered issue against dev/frontier-scoring.md and report the minimum changes needed to reach 9/10 in each category
argument-hint: <issue-number>
---

# Frontier Scoring Review

**Input**: $ARGUMENTS

---

## Runtime Contract

Extract the GitHub issue number from `$ARGUMENTS`. Set `ISSUE_NUMBER` to that numeric value and set:

```bash
: "${BRANCH:?BRANCH must be provided by the workflow}"
```

Use `gh api` with `GH_TOKEN` to read the issue and its comments. Never push to `main` or the repository default branch. Do not expose private reasoning; publish only the requested issue comment.

To publish an issue comment, write the complete Markdown body to a temporary file. Its first line must be the exact marker shown below. Find comments with `gh api --paginate "repos/$GITHUB_REPOSITORY/issues/$ISSUE_NUMBER/comments?per_page=100"`, selecting an exact first-line marker match. If one exists, update that comment with `gh api --method PATCH`; otherwise create it with `gh api --method POST`. If legacy duplicates exist, update the newest matching comment and delete the older matching duplicates. Do not create a second comment with the same marker.

## Mission

Require `spec-approved`, `tests-created`, `implementation-done`, and `pr-seeded`. Fetch the latest shared branch read-only. Read the issue plus the approved spec, the implementation summary, the PR, and `dev/frontier-scoring.md`. Score the delivered work against each frontier-scoring dimension, but only publish the minimum changes needed to reach at least 9/10 in each category.

Make the output a criticality-categorized list. For each item, say which scoring dimension it improves, what concrete change is needed, and why the change lifts the score. Keep the list issue-focused and anchored in the delivered diff, not generic advice.

Publish `<!-- frontier-scoring-findings -->` with:

1. `# Frontier Scoring Review`
2. Score table for all 7 dimensions with current score, target score, and gap
3. Critical items required to reach 9/10
4. High-priority items required to reach 9/10
5. Medium-priority items required to reach 9/10
6. Low-priority items required to reach 9/10
7. Explicit verdict: whether the current delivery can reach 9/10 in every category without more scope

## Boundaries

Do not modify files, commit, change tests/spec, or hand-wave the rubric. Prefer concrete file-level evidence and exact behavior changes over abstract scoring talk.
