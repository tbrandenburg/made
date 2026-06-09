---
description: Emit structured PR metadata after implementation (no PR creation)
argument-hint: <issue-number>
---

# PR Metadata Emitter

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

Read the current state of `$BRANCH` (latest commit SHA via `git ls-remote`, changed files, commit messages) and the issue and its existing comments to understand what was implemented.

Emit structured PR metadata as an issue comment — **do not create, update, or close any pull request**.

Collect and emit all of the following fields:

| Field | How to obtain |
|---|---|
| `branch` | `$BRANCH` variable |
| `sha` | latest commit on `$BRANCH` via `git ls-remote origin $BRANCH` |
| `title` | short imperative summary derived from issue title |
| `body` | brief Markdown PR body: closes clause + 2-3 sentence summary of what changed |
| `files` | files touched in `$BRANCH` since it diverged from the default branch (use `gh api` tree diff or commit file lists) |
| `validation` | summary of any test results, CI status, or lint outcomes visible in issue comments or workflow runs |

Publish `<!-- pr-seeded -->` with:

1. `# PR Metadata`
2. A fenced JSON block containing all fields above
3. A brief human-readable summary (3-5 sentences) of what was implemented

## Boundaries

Do not create, edit, reopen, or close pull requests. Do not modify files/code/tests/spec, create commits, claim CI success, or merge.
