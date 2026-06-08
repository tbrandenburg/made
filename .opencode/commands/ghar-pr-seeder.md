---
description: Create or refresh the draft pull request after implementation
argument-hint: <issue-number>
---

# PR Seeder

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

Fetch the latest shared branch read-only. Create or refresh exactly one real, non-draft pull request from `$BRANCH` to the repository default branch immediately after the implementation step. Reuse an existing open or closed-unmerged PR for the branch when present, but never create or preserve a draft PR. The PR body should be short, stable, and explicitly state that the branch is still in progress and will be updated by later workflow stages.

Use the early PR as the anchor for branch-based CI, deployment previews, and human review. Do not wait for final artifacts or terminal CI. Keep the PR open and non-draft while the branch is still under active repair.

Publish `<!-- pr-seeded -->` with:

1. `# Early PR Seeded`
2. PR number and URL
3. Branch and commit SHA used to open or refresh the PR
4. Whether the PR was created or refreshed
5. Any blocking repository setting or permission issue if PR creation failed

## Boundaries

Do not modify files/code/tests/spec, create commits, claim CI success, or merge.
