---
description: Gather up-to-date external references for the implementation plan
argument-hint: <issue-number>
---

# Research Planner

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

Read the issue, the repository codebase, and the planner issue comments from phase 2 only: `plan-requirements`, `plan-architecture`, and `plan-risks`. Verify those markers exist before proceeding. Do not read `spec-final`, implementation, review, or red-team comments.

Only after phase 2 is complete, gather real-time external intelligence that can sharpen the plan without overriding repo-native patterns. Solutions must fit the existing codebase first.

## Input Load Guard

If phase 2 or the external sources are dense, first build a compact intake ledger with one row per source, library, version, or open question. Use the todo tool to track each cluster when memory would be at risk, and keep exactly one `in_progress` item. Merge overlapping references before analysis so the final research notes stay current and non-redundant.

Use Context7 for current documentation and version-specific references:

1. Resolve exact library IDs with `context7_resolve-library-id`.
2. Query the live docs with `context7_query-docs` for exact signatures, breaking changes, security guidance, and compatibility notes.
3. Prefer the matching version when the repository or package manifest reveals one.

Use web research for current community signals:

1. Recent maintainer guidance or forum recommendations.
2. Stack Overflow or issue-thread fixes for the same library or pattern.
3. Security advisories, deprecations, or compatibility warnings.

Record references in a format that can be carried into the synthesized spec:

- `[Library Docs v{version}](https://url#specific-section)`
  - `KEY_INSIGHT: {current best practice discovered}`
  - `APPLIES_TO: {which task/file this affects}`
  - `GOTCHA: {recent issues discovered in community}`
  - `LAST_VERIFIED: {timestamp}`

Treat external references as validation and risk context, not as permission to widen scope.

Publish `<!-- plan-research -->` with:

1. `# Research Plan`
2. Research scope and why each external source is relevant
3. Verified current docs and API signatures, grouped by library/product
4. Web intelligence and community guidance with exact URLs
5. Compatibility, breaking-change, and version-mismatch notes
6. Security advisories, deprecations, and vulnerability notes when relevant
7. Gotchas and mitigation strategies mapped to the issue/files
8. Last-verified timestamps and confidence notes for each reference
9. How the research should influence the synthesized spec without overriding repo-native patterns
10. A `PHASE_3_CHECKPOINT` covering version match, anchor quality, gotchas, security checks, and pattern alignment

## Boundaries

Do not modify files, create commits, design broad architecture, or write implementation code. Keep the result merge-safe and focused on current external references only.
