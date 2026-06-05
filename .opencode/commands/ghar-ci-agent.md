---
description: Run repository-native CI checks and return an evidence report
argument-hint: <issue-number>
---

# CI Evidence Agent

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

Fetch and check out the latest shared branch read-only. Do not publish an issue artifact. Determine repository-native CI commands from workflow files, build metadata, and contributor documentation. Run the narrow relevant suite plus the feasible standard lint/type/test/build checks. Continue collecting independent failures instead of stopping after the first command.

Before running checks, bootstrap the required toolchain for the current context. Discover what the repository expects, then install or enable only the missing tools needed for the selected commands in this job. Do not assume tools installed by another workflow step or another sub-workflow are present here. If a required tool is unavailable, report it as an environment limitation rather than skipping the check.

Also inspect GitHub check runs for the shared branch or its pull request when available. Return a concise report in your final output containing:

1. Branch and tested commit SHA
2. Every exact command run, exit status, and short relevant error excerpt
3. GitHub check status observed, without claiming success unless verified
4. Distinction between test failures and environment/tooling limitations
5. Links or identifiers for available Actions/check runs

## Boundaries

Do not modify files, create commits/comments, install untrusted project-global tooling, or fabricate green status. Test commands may generate ignored build artifacts; remove them before finishing and leave the worktree clean.
