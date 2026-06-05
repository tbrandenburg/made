---
description: Create and commit failing tests from the approved spec
argument-hint: <issue-number>
---

# Test Agent

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

Require the `spec-approved` artifact. Fetch and check out the shared branch with `git fetch origin "$BRANCH"` and `git checkout -B "$BRANCH" "origin/$BRANCH"`. Inspect existing tests, then encode the approved acceptance criteria as the smallest deterministic set of tests that fail for the intended missing behavior.

Classify the work before writing tests:

- `docs`: README, docs, comments, changelog, or other prose-only updates
- `code`: runtime behavior changes
- `config`: workflow, tool, or repo configuration changes
- `infra`: CI, release, or automation plumbing

For `docs` work, keep TDD lightweight and contract-level: verify the visible text outcome with the smallest possible mechanism, and default to **no new test files** unless the approved spec explicitly asks for tests or the spec clearly cannot be validated without one. Prefer direct diff checks and simple assertions inside the existing workflow artifacts over snapshot harnesses. Do not add snapshot files or multi-file scaffolds unless the approved spec explicitly requires them or the document is structurally unstable and you can justify that in the artifact.

Before editing, record the baseline changed-file list. Modify only files required by the approved spec and minimal verification. For docs work, prefer changing only the target prose file; if a test file is truly needed, justify it in the artifact and keep it singular and small. Run the narrow relevant checks and preserve evidence that the verification fails for the expected reason—not due to syntax, environment, or unrelated failures. Commit with a TDD-focused message and push only `HEAD:refs/heads/$BRANCH`.

Before writing or running tests, bootstrap the test toolchain needed for the current context. Detect what the repo expects first, then install or enable only the missing tools that are required for the current step. Treat runner, container, and sub-workflow contexts as potentially different: do not assume a tool installed in one job is available in another. If a required tool cannot be installed, stop and report the missing dependency explicitly rather than silently skipping the check.

Before committing, inspect `git diff --name-only` and fail fast if any new file or edited path is not required by the approved spec or your minimal test plan. If a docs test introduces extra scaffolding, remove it and retry with a narrower test.

Publish `<!-- tests-created -->` with:

1. `# Tests Created`
2. Commit SHA
3. Test-only files changed
4. Acceptance criteria and edge cases covered
5. Exact commands run and expected initial failures
6. Any untestable criterion or blocker

## Boundaries

Do not modify production code or the approved spec, weaken assertions, skip relevant failures, or add brittle tests. Before committing, inspect `git diff --name-only` and revert any file outside your allowed ownership.
