---
description: Collect issue-focused CI/CD/CT and E2E evidence, classify failures, and publish an audit trail
argument-hint: <issue-number>
---

# E2E Evidence

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

### Phase 1 — CI/CD/CT Evidence

Fetch and check out the latest shared branch read-only. Determine repository-native CI commands from workflow files, build metadata, and contributor documentation. Run the narrow relevant suite plus the feasible standard lint/type/test/build checks. Continue collecting independent failures instead of stopping after the first command. Keep the report issue-focused: include only evidence that affects closure, deployment readiness, or the next repair step.

When the branch has reported deployment, hosting, runtime, or delivery-environment failures, inspect the available GitHub check-run output, status contexts, details URLs, and any reachable logs first. If those logs do not expose enough evidence, reproduce the reported behavior with the closest repository-native command or script for that environment (for example the matching build, start, test, or npm script) and capture the same failure class locally.

Do not treat CI as verified until the latest shared branch head has reached a terminal state. Poll GitHub check runs and status contexts for the current branch head until every required repository-native item is completed, or until you hit a clear timeout. Report terminal external status failures separately; do not imply success if anything is still pending at timeout.

Before running checks, bootstrap the required toolchain for the current context. Discover what the repository expects, then install or enable only the missing tools needed for the selected commands in this job. Do not assume tools installed by another workflow step or another sub-workflow are present here. If a required tool is unavailable, report it as an environment limitation rather than skipping the check.

Also inspect GitHub check runs for the shared branch or its pull request when available, and re-check them until they stop moving.

### Phase 2 — E2E Execution

After the CI/CD/CT checks, attempt to run the project end-to-end. The implementor may have already installed relevant tools (e.g. Playwright, Cypress, Puppeteer, Selenium, k6, or similar); check for them before assuming they are absent.

Discover E2E entry points in this order:
1. Explicit `e2e`, `test:e2e`, `test:integration`, or `playwright` scripts in `package.json`, `Makefile`, `Taskfile`, or equivalent build metadata.
2. Playwright or Cypress configuration files (`playwright.config.*`, `cypress.config.*`, `cypress.json`).
3. E2E test directories (`e2e/`, `tests/e2e/`, `cypress/`, `test/e2e/`, `spec/`).
4. A `make e2e`, `make test`, or `make run` target that exercises a running service.
5. A `README`-documented start + smoke-test sequence.

Run every discovered E2E entry point. For each:
- Start any required backing services (database, API server, etc.) using repository-native scripts; prefer `make run`, `docker compose up -d`, or the documented start command.
- Execute the test runner with full output captured.
- If a browser or headless runtime (Chromium, Firefox, WebKit, Electron) is missing, state the required package and motivate the installer to add it (e.g. `npx playwright install chromium`) rather than silently skipping.
- If a required tool is entirely absent and cannot be installed in this context, report the missing tool as a blocking environment limitation with the exact install command so the next agent or human can act on it.
- Capture exit code, stdout/stderr tail, and any generated artifacts (screenshots, videos, traces) by path.

If no E2E entry point is found, report that explicitly and include the discovery steps taken.

### Reporting

Publish `<!-- e2e-evidence -->` as the human-readable issue-comment audit trail for the branch head, then return a concise report in your final output containing:

1. Branch and tested commit SHA
2. Every exact command run (CI and E2E), exit status, and short relevant error excerpt
3. GitHub check status observed, without claiming success unless verified
4. Distinction between test failures and environment/tooling limitations
5. Deployment/runtime log excerpts, target URLs, or other evidence for external failures when available
6. E2E discovery path taken and entry points found or absent
7. Links or identifiers for available Actions/check runs

Publish `<!-- e2e-evidence -->` with:

1. `# E2E Evidence and Classification`
2. Branch and tested commit SHA
3. Repository-native CI commands run and exit statuses
4. E2E commands run, exit statuses, and relevant output excerpts or artifact paths
5. Reported deployment/runtime environment errors, logs, target URLs, or check output
6. Local reproduction attempts for external failures when logs are missing or insufficient
7. Missing tool report with exact install commands when E2E tools are absent
8. Failure classification and recommended next repair step
9. Explicit `no failures observed` statement when evidence is green

## Boundaries

Do not modify files, create commits/comments, install untrusted project-global tooling, or fabricate green status. Test commands may generate ignored build artifacts; remove them before finishing and leave the worktree clean.
