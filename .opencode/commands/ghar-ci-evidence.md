---
description: Collect issue-focused CI and deployment evidence, classify failures, and publish an audit trail
argument-hint: <issue-number>
---

# CI Evidence

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

Fetch and check out the latest shared branch read-only. Determine repository-native CI commands from workflow files, build metadata, and contributor documentation. Run the narrow relevant suite plus the feasible standard lint/type/test/build checks. Continue collecting independent failures instead of stopping after the first command. Keep the report issue-focused: include only evidence that affects closure, deployment readiness, or the next repair step.

When the branch has reported deployment, hosting, runtime, or delivery-environment failures, inspect the available GitHub check-run output, status contexts, details URLs, and any reachable logs first. If those logs do not expose enough evidence, reproduce the reported behavior with the closest repository-native command or script for that environment (for example the matching build, start, test, or npm script) and capture the same failure class locally.

Do not treat CI as verified until the latest shared branch head has reached a terminal state. Poll GitHub check runs and status contexts for the current branch head until every required repository-native item is completed, or until you hit a clear timeout. Report terminal external status failures separately; do not imply success if anything is still pending at timeout.

Before running checks, bootstrap the required toolchain for the current context. Discover what the repository expects, then install or enable only the missing tools needed for the selected commands in this job. Do not assume tools installed by another workflow step or another sub-workflow are present here. If a required tool is unavailable, report it as an environment limitation rather than skipping the check.

Also inspect GitHub check runs for the shared branch or its pull request when available, and re-check them until they stop moving. Publish `<!-- ci-evidence -->` as the human-readable issue-comment audit trail for the branch head, then return a concise report in your final output containing:

1. Branch and tested commit SHA
2. Every exact command run, exit status, and short relevant error excerpt
3. GitHub check status observed, without claiming success unless verified
4. Distinction between test failures and environment/tooling limitations
5. Deployment/runtime log excerpts, target URLs, or other evidence for external failures when available
6. Links or identifiers for available Actions/check runs

Publish `<!-- ci-evidence -->` with:

1. `# CI Evidence and Classification`
2. Branch and tested commit SHA
3. Repository-native commands run and exit statuses
4. Reported deployment/runtime environment errors, logs, target URLs, or check output
5. Local reproduction attempts for external failures when logs are missing or insufficient
6. Failure classification and recommended next repair step
7. Explicit `no failures observed` statement when evidence is green

## Boundaries

Do not modify files, create commits/comments, install untrusted project-global tooling, or fabricate green status. Test commands may generate ignored build artifacts; remove them before finishing and leave the worktree clean.
