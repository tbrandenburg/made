---
description: Final code review, issue creation for unresolved gaps, PR approval and readiness report
argument-hint: <issue-number>
---

# PR Finalizer

**Input**: $ARGUMENTS

---

## Runtime Contract

Extract the GitHub issue number from `$ARGUMENTS`. Set `ISSUE_NUMBER` to that numeric value and set:

```bash
BRANCH="agent/issue-${ISSUE_NUMBER}-implementation"
```

Use `gh api` with `GH_TOKEN` to read the issue and its comments. Never push to `main` or the repository default branch. Do not expose private reasoning; publish only the requested issue comment.

To publish an issue comment, write the complete Markdown body to a temporary file. Its first line must be the exact marker shown below. Find comments with `gh api --paginate "repos/$GITHUB_REPOSITORY/issues/$ISSUE_NUMBER/comments?per_page=100"`, selecting an exact first-line marker match. If one exists, update that comment with `gh api --method PATCH`; otherwise create it with `gh api --method POST`. If legacy duplicates exist, update the newest matching comment and delete the older matching duplicates. Do not create a second comment with the same marker.

**Golden Rule**: Be constructive and actionable. Every issue should have a clear recommendation. Acknowledge good work too. Prefer the smallest correct change. Flag extra abstractions, wrappers, or implementation-coupled tests when a simpler behavior-based alternative exists.

---

## Phase 1: VERIFY — Artifact Chain

Require all required issue comments: `spec-approved`, `tests-created`, `implementation-done`, `implementation-review-findings`, `maintainer-review-findings`, `adversarial-review-findings`, `residual-gap-findings`, `pr-seeded`, `e2e-evidence`, and `fixer-summary`. If any are missing, stop and report which are absent.

**PHASE_1_CHECKPOINT:**
- [ ] All 10 artifact comments present

---

## Phase 2: FETCH — Get PR Context

Fetch the PR associated with `$BRANCH`:

```bash
# Get PR number for the branch
gh pr list --head "$BRANCH" --json number -q '.[0].number'

# Get comprehensive PR details
gh pr view {NUMBER} --json number,title,body,author,headRefName,baseRefName,state,additions,deletions,changedFiles,files,reviews,comments

# Get the diff
gh pr diff {NUMBER}

# List changed files
gh pr diff {NUMBER} --name-only
```

**Extract:**
- PR number, title, author
- Base and head branches
- Files changed with line counts
- Existing review comments

**Validate PR state:**

| State | Action |
|-------|--------|
| `MERGED` | STOP: "PR already merged." |
| `CLOSED` | WARN and continue as historical analysis |
| `DRAFT` | NOTE: focusing on direction, not polish |
| `OPEN` | PROCEED with full review |

**PHASE_2_CHECKPOINT:**
- [ ] PR number and metadata fetched
- [ ] PR state is reviewable

---

## Phase 3: CONTEXT — Understand the Change

### 3.1 Read Project Rules

Read and internalize project conventions (AGENTS.md, CLAUDE.md, or equivalent). Extract:
- Type safety requirements
- Code style rules
- Testing requirements
- Architecture patterns

### 3.2 Map Issue Comments to Implementation Artifacts

The pipeline artifact chain maps directly to implementation context:

| Concept | Issue comment |
|---------|---------------|
| Intent + acceptance criteria | `<!-- spec-approved -->` |
| What was built and why | `<!-- implementation-done -->` |
| Full review chain findings | `<!-- *-review-findings -->` |
| What the fixer resolved (with SHA proof) | `<!-- fixer-summary -->` |
| Gaps not yet resolved, no open issues yet | `<!-- residual-gap-findings -->` |

Read these comments before reviewing code. Findings the fixer marked as resolved are confirmed — do not re-raise them as new issues. Gaps listed in `residual-gap-findings` are candidates for follow-up issues; check `fixer-summary` to determine which were actually fixed.

### 3.3 Understand PR Intent

From the comments above:
- What problem does this solve?
- What approach was taken?
- What deviations from the spec occurred and why?
- What did the fixer address, and what remains?

### 3.4 Analyze Changed Files

For each changed file, determine:
- What type of file? (service, handler, util, test, config)
- What existing patterns should it follow?
- Scope of change? (new file, modification, deletion)

**PHASE_3_CHECKPOINT:**
- [ ] Project rules read and understood
- [ ] All artifact comments read
- [ ] PR intent and resolved/unresolved gaps understood
- [ ] Changed files categorized

---

## Phase 4: REVIEW — Analyze the Code

Always run this phase unconditionally as a final safety net, regardless of how thorough the earlier review chain was.

### 4.1 Read Each Changed File

For each file in the diff:

1. **Read the full file** (not just the diff) to understand context
2. **Read similar files** to understand expected patterns
3. **Check specific changes** against those patterns

### 4.2 Review Checklist

**For EVERY changed file, check:**

#### Correctness
- [ ] Does the code do what the PR claims?
- [ ] Are there logic errors?
- [ ] Are edge cases handled?
- [ ] Is error handling appropriate?

#### Type Safety
- [ ] Are all types explicit (no implicit `any`)?
- [ ] Are return types declared?
- [ ] Are interfaces used appropriately?
- [ ] Are type guards used where needed?

#### Pattern Compliance
- [ ] Does it follow existing patterns in the codebase?
- [ ] Is naming consistent with project conventions?
- [ ] Is file organization correct?
- [ ] Are imports from the right places?

#### Security
- [ ] Any user input without validation?
- [ ] Any secrets that could be exposed?
- [ ] Any injection vulnerabilities (SQL, command, etc.)?
- [ ] Any unsafe operations?

#### Performance
- [ ] Any obvious N+1 queries or loops?
- [ ] Any unnecessary async/await?
- [ ] Any memory leaks (unclosed resources, growing arrays)?
- [ ] Any blocking operations in hot paths?

#### Completeness
- [ ] Are there tests for new code?
- [ ] Is documentation updated if needed?
- [ ] Are all TODOs addressed?
- [ ] Is error handling complete?

#### Maintainability
- [ ] Is the code readable?
- [ ] Is it over-engineered?
- [ ] Is it under-engineered (missing necessary abstractions)?
- [ ] Are there magic numbers/strings that should be constants?
- [ ] Are tests asserting behavior instead of private implementation details when behavior is observable?

### 4.3 Categorize Findings

**Issue Severity Levels:**

| Level | Criteria | Examples |
|-------|----------|----------|
| Critical | Must fix — blocks safety/data | Security vulnerabilities, data loss, crashes |
| High | Should fix before merge | Type safety violations, missing error handling, logic errors |
| Medium | Worth addressing | Pattern inconsistencies, missing edge cases |
| Low | Suggestions | Style preferences, minor optimizations, documentation |

Note: findings the fixer already resolved are **not** re-raised. Findings already in `residual-gap-findings` are cross-referenced, not duplicated.

**PHASE_4_CHECKPOINT:**
- [ ] All changed files reviewed
- [ ] Findings categorized by severity
- [ ] Fixer-resolved items excluded
- [ ] Positive aspects noted

---

## Phase 5: VALIDATE — Run Automated Checks

```bash
# Type checking (adapt to project)
npm run type-check || bun run type-check || npx tsc --noEmit

# Linting
npm run lint || bun run lint

# Tests
npm test || bun test

# Build
npm run build || bun run build
```

**Capture for each:**
- Pass/fail status
- Error count and warning count
- Any specific failures

**Change-type additional validation:**

| Change Type | Additional Check |
|-------------|-----------------|
| New API endpoint | Test with curl/httpie |
| Database changes | Check migration exists |
| Config changes | Verify .env.example updated |
| New dependencies | Check package.json/lock file |

**PHASE_5_CHECKPOINT:**
- [ ] Type check executed
- [ ] Lint executed
- [ ] Tests executed
- [ ] Build executed
- [ ] Results captured

---

## Phase 6: DECIDE — Recommendation and Follow-up Issues

### 6.1 Determine Unresolved Gaps

Compute the set of items that need follow-up issues:

```
unresolved = (residual-gap-findings critical/high/medium items)
             MINUS (fixer-summary confirmed-resolved items)
             PLUS  (Phase 4 new critical/high/medium findings not in any comment)
```

For each unresolved critical/high/medium item, create a GitHub follow-up issue if one does not already exist:

```bash
gh issue create \
  --title "{concise title}" \
  --body "Follow-up from #$ISSUE_NUMBER.\n\n{description, why it matters, suggested fix}" \
  --label "follow-up"
```

Record the created issue numbers for the PR body and `<!-- pr-final -->` comment.

### 6.2 Approval Decision

| Scenario | Action |
|----------|--------|
| CI green + no unresolved critical/high | **APPROVE** |
| CI green + unresolved items → issues opened | **APPROVE** (issues track the gaps) |
| CI not green | Keep **DRAFT**, record blockers — no approve yet |

Treat any CI state older than the latest fixer push as stale. For large PRs (>500 lines), note thoroughness limits in the review.

**PHASE_6_CHECKPOINT:**
- [ ] Unresolved items computed
- [ ] Follow-up issues created where needed
- [ ] Approval decision determined

---

## Phase 7: PUBLISH — PR, Review, and Report

### 7.1 Create or Update the Pull Request

Create exactly one pull request from `$BRANCH` to the repository default branch, or update the existing open/closed-unmerged PR for that head. Never create a duplicate. The PR body must:
- Link `Closes #$ISSUE_NUMBER`
- Summarize scope, implementation, TDD commit ordering, tests/checks, review, adversarial, residual-gap, and CI dispositions
- List all follow-up issues opened
- Note unresolved risks

Do not enable auto-merge or merge the PR.

### 7.2 Post GitHub Review

Write the review body to a temporary file and post it:

```bash
# When CI green and ready to approve
gh pr review {NUMBER} --approve --body-file /tmp/pr-review-body.md

# When still draft / CI not green — comment only
gh pr comment {NUMBER} --body-file /tmp/pr-review-body.md
```

The review body must include: summary, changes overview, findings by severity, validation results table, follow-up issues opened (with links), what's good, and recommendation.

### 7.3 Publish `<!-- pr-final -->` Issue Comment

Publish `<!-- pr-final -->` with:

1. `# Final PR Readiness Report`
2. PR number and URL
3. Final commit and changed-file summary
4. Artifact-chain completeness
5. Code review findings table (critical / high / medium / low counts)
6. Validation results table (type-check / lint / tests / build)
7. Follow-up issues opened (with links), or "None"
8. Resolved and unresolved risk summary, including any tracked frontier gaps
9. Human review checklist and explicit merge decision request

**PHASE_7_CHECKPOINT:**
- [ ] PR created or updated
- [ ] GitHub review posted (approve or comment)
- [ ] `<!-- pr-final -->` comment published

---

## Phase 8: OUTPUT — Report to User

```markdown
## PR Finalization Complete

**PR**: #{NUMBER} - {TITLE}
**URL**: {PR_URL}
**Recommendation**: {APPROVE / KEEP DRAFT}

### Findings

| Severity | Count |
|----------|-------|
| Critical | {N} |
| High | {N} |
| Medium | {N} |
| Suggestions | {N} |

### Validation

| Check | Result |
|-------|--------|
| Type Check | {PASS/FAIL} |
| Lint | {PASS/FAIL} |
| Tests | {PASS/FAIL} |
| Build | {PASS/FAIL} |

### Follow-up Issues Opened

{List URLs or "None"}

### Artifacts

- PR Comment: {pr-final comment URL}

### Next Steps

- APPROVE: PR is ready for human merge decision
- KEEP DRAFT: Address CI blockers listed above, then re-run
```

---

## Critical Reminders

1. **Understand before judging.** Read full context, not just the diff.

2. **Be specific.** "This could be better" is useless. "Use `execFile` instead of `exec` to prevent command injection at line 45" is helpful.

3. **Prioritize.** Not everything is critical. Use severity levels honestly.

4. **Be constructive.** Offer solutions, not just problems.

5. **Acknowledge good work.** If something is done well, say so.

6. **Run validation.** Don't skip automated checks.

7. **Check patterns.** Read existing similar code to understand expectations.

8. **Think about edge cases.** What happens with null, empty, very large, concurrent?

9. **Check implementation artifacts.** Findings the fixer resolved are not re-raised. Findings in residual-gap-findings are cross-referenced, not duplicated.

---

## Boundaries

Do not modify files/code/tests/spec, create commits, claim unverified CI success, hide risks, or merge. Do create follow-up GitHub issues for unresolved critical/high findings. Do approve the PR via `gh pr review --approve` when CI is green. The human reviewer is the first required interaction and owns the final merge decision.
