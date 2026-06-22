---
description: Score the delivered issue against the embedded frontier-scoring rubric and report the minimum changes needed to reach 9/10 in each category
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

## Scoring Rubric

Score each of the 7 dimensions on a **1–10 scale** with a 1–2 sentence rationale.
Be honest — use the full range; don't cluster around 6–7.
The **total** is the sum of all 7 scores (out of 70).

### 1. `solves_issue`
Does the fix actually address what the issue asked for?

- **10** — exactly solves the stated problem
- **1** — doesn't solve it at all

### 2. `root_cause`
Structurally sound fix, or band-aid that papers over the symptom?

- **10** — true root cause addressed
- **1** — pure band-aid

### 3. `scope_discipline`
Touched only what was needed?

- **10** — surgical, only relevant files changed
- **1** — sprawling, lots of unrelated changes

If extra changes were necessary to make CI green or preserve compatibility, only treat them as acceptable when the expanded scope was explicitly approved in the linked issue/spec or review chain. Unapproved drift still scores low here, even if it happens to fix downstream failures.

### 4. `subtle_correctness`
Edge cases, async/await, types, no foot-guns introduced?

- **10** — thoughtful about subtle failure modes
- **1** — obvious bugs present

### 5. `code_quality`
Readable, well-named, idiomatic to the codebase?

- **10** — production-grade
- **1** — sloppy

### 6. `test_discipline`
Meaningful tests added for the change, or existing tests gamed?

- **10** — good targeted tests
- **1** — no tests, or tests modified to pass

### 7. `plan_impl_fidelity`
Compare the plan against what the diff actually delivered.

- **10** — implementation faithfully executes the plan
- **5** — partial drift (some items planned but not done, or done items not in the plan); also use **5** when no plan source is available, noting "not visible"
- **1** — plan and implementation diverge completely

If the implementation adds necessary follow-up changes beyond the original plan, score by the latest approved scope, not by the first draft alone. If that broader scope was never approved, keep the score low even if the final CI is green.

**Plan source — GHAR TDD workflow**: the plan is the `<!-- spec-approved -->`
issue comment produced by `ghar-spec-finalizer` on the issue linked in the PR
body (`Closes #N`). It contains the approved acceptance criteria, technical
decisions, required failing-test checklist, and definition-of-done that the
implementer was contractually bound to follow. Fetch it via:

```bash
gh api --paginate "repos/OWNER/REPO/issues/N/comments?per_page=100" \
  --jq '[.[] | select(.body | startswith("<!-- spec-approved -->"))] | last | .body'
```

**Plan source — Archon benchmark workflow**: `source-plan.md` written by the
benchmark's `plan` node and located via the `Source run-id:` marker in the PR body.

---

## Mission

Require `spec-approved`, `tests-created`, `implementation-done`, and `pr-seeded`. Fetch the latest shared branch read-only. Read the issue plus the approved spec, the implementation summary, and the PR. Score the delivered work against each frontier-scoring dimension above, but only publish the minimum changes needed to reach at least 9/10 in each category.

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
