---
description: Complete workflow - branch, commit, push, and create PR with rich context
---

# TASK: Commit & Push — Complete Git Workflow

## Task Contract

This section defines **what must be done**, not a mindset.

You are required to execute the full workflow below:
- Ensure work is on a non-main branch
- Commit the current changes using the specified commit structure
- Push the branch to the remote
- Create a pull request with a complete description

**The task is incomplete until the branch is pushed and a PR exists.**

_Context:_ Every change should tell a story that future agents can understand.

## Execution Procedure

Follow the steps below in order. Do not stop after committing — pushing and PR creation are required.

### 1. Check Current Branch Status

```bash
git status
git branch --show-current
```

**Decision Point:**
- If on `main` or `master`: Create a feature branch
- If on a feature branch: Continue with that branch
- If uncommitted changes exist: They'll move to the new branch

### 2. Create Feature Branch (if needed)

If on main/master, create a descriptive branch:

```bash
# Branch naming convention: type/short-description
# Examples: fix/kiro-timestamps, feat/add-auth, refactor/agent-cli
git checkout -b <type>/<short-description>
```

**Branch Types:**
- `fix/` - Bug fixes
- `feat/` - New features
- `refactor/` - Code restructuring
- `docs/` - Documentation
- `chore/` - Maintenance
- `perf/` - Performance improvements

### 3. Analyze and Stage Changes

```bash
git status
git diff
git add -A  # or selectively add files
git diff --staged
```

**Safety Checks:**
- ⚠️ Check for secrets (.env, API keys, credentials)
- ⚠️ Verify no unintended files are staged
- ⚠️ Ensure changes are related and cohesive

### 4. Categorize the Change

| Type | When to Use | Example |
|------|-------------|---------|
| `feat` | New functionality | `feat(auth): add JWT refresh token rotation` |
| `fix` | Bug fix | `fix(api): handle null response in user fetch` |
| `refactor` | Code restructure | `refactor(db): extract query builder to module` |
| `docs` | Documentation | `docs(api): add OpenAPI examples` |
| `test` | Tests | `test(auth): add edge cases for token expiration` |
| `chore` | Maintenance | `chore(deps): upgrade langfuse to v3.0` |
| `perf` | Performance | `perf(search): add index for user lookups` |
| `style` | Formatting | `style: apply ruff formatting` |

### 5. Craft Commit Message

**Format:**
```
type(scope): concise description (imperative mood)

[Body - 2-4 sentences explaining WHY and CONTEXT]

Changes:
- Key change 1
- Key change 2

Pattern: [Patterns or conventions followed]
Decision: [Key decisions made]
Related: [Related files or components]
```

**Rules:**
1. **Subject line:**
   - Imperative mood: "add" not "added"
   - Include scope: `feat(auth)`, `fix(api/users)`
   - Under 72 characters
   - Specific and descriptive

2. **Body:**
   - Explain WHY, not just what
   - Mention patterns established
   - Note non-obvious decisions
   - Reference related components

3. **Context for future agents:**
   - Database locations
   - File patterns followed
   - Architecture decisions
   - Gotchas or edge cases

### 6. Execute Commit

```bash
git commit -m "$(cat <<'EOF'
type(scope): description

Problem or context explaining why this change was needed.

Changes:
- Specific change 1
- Specific change 2

Pattern: Follows existing pattern in path/to/file
Decision: Chose approach X because Y
Related: Other files or components affected
EOF
)"
```

### 7. Push to Remote

```bash
git push -u origin $(git branch --show-current)
```

### 8. Create Pull Request

Use GitHub CLI to create PR with rich description:

```bash
gh pr create --title "Type: Brief description" --body "$(cat <<'EOF'
## Problem
[Describe the issue or need this PR addresses]

## Solution
[Explain the approach taken and why]

## Changes
- Modified file/component 1
- Added feature/fix 2
- Updated related component 3

## Testing
[How this was tested or validated]

## Example Output
```
[Show example of the fix/feature in action if applicable]
```

## Notes
[Any additional context, gotchas, or follow-up needed]
EOF
)"
```

**PR Description Template:**

```markdown
## Problem
[What issue does this solve? What was broken or missing?]

## Solution
[High-level approach and key decisions]

## Changes
- File/component changes
- New patterns introduced
- Related updates

## Testing
[Validation performed]

## Example Output
[Code examples, screenshots, or output samples]

## Notes
[Additional context, breaking changes, follow-up items]
```

### 9. Required Completion Report

After successful push and PR creation, report:

```
✅ Branch: <branch-name>
✅ Commit: <hash> - <subject>
✅ Files: <count> files changed (+X, -Y lines)
✅ Pushed: origin/<branch-name>
✅ PR: #<number> - <url>
```

## Example Workflow

**Scenario:** Fix missing timestamps in Kiro conversation history

```bash
# 1. Check status
git status
git branch --show-current  # Returns: main

# 2. Create branch
git checkout -b fix/kiro-timestamps

# 3. Stage changes
git add packages/pybackend/kiro_agent_cli.py

# 4. Commit with context
git commit -m "$(cat <<'EOF'
fix(kiro): extract timestamps and format tool usage in conversation history

Kiro CLI stores rich metadata in SQLite that wasn't being parsed, causing
"Unknown time" timestamps and empty tool messages in MADE chat history export.

Changes:
- Extract assistant timestamps from request_metadata.stream_end_timestamp_ms
- Parse tool_uses array to show tool name and arguments (truncated to 200 chars)
- Combine assistant explanation text with formatted tool information

Pattern: Follows existing HistoryMessage structure from agent_results.py
Database: Kiro stores conversations in ~/.local/share/kiro-cli/data.sqlite3
Format: Tool args displayed as "Tool: name\n  arg: value" for readability

Fixes missing timestamps on all assistant messages and provides context
for tool invocations instead of empty content.
EOF
)"

# 5. Push
git push -u origin fix/kiro-timestamps

# 6. Create PR
gh pr create --title "Fix: Extract timestamps and format tool usage in Kiro conversation history" --body "$(cat <<'EOF'
## Problem
Chat history export from Kiro CLI showed:
- Missing timestamps ("Unknown time") on assistant messages
- Empty/minimal content for tool usage messages

## Solution
Extract rich metadata from Kiro's SQLite database:
- Parse `request_metadata.stream_end_timestamp_ms` for timestamps
- Format `tool_uses` array with tool name and arguments
- Truncate long arguments to 200 chars for readability

## Changes
- Modified `packages/pybackend/kiro_agent_cli.py`
- Updated `_parse_conversation_history()` method

## Testing
Validated against conversation `b7cd2f67-ee9e-40db-a244-8cbdbf719630`:
- All 28 messages now have proper timestamps
- Tool invocations show formatted tool info

## Example Output
```
Tool: execute_bash
  command: git checkout main && git pull
  summary: Switch to main branch and pull latest changes
```

Fixes missing timestamps and provides context for tool invocations in chat history export.
EOF
)"
```

## Safety Checks

- ⚠️ **Never commit to main/master directly** without explicit user confirmation
- ⚠️ **Check for secrets** in staged files (.env, API keys, passwords)
- ⚠️ **Verify branch name** is descriptive and follows convention
- ⚠️ **Review diff** before committing to catch unintended changes
- ⚠️ **Test locally** if possible before pushing

## Output Format

After completion, provide:

```
✅ **Workflow Complete**

**Branch:** fix/kiro-timestamps
**Commit:** 5784230 - fix(kiro): extract timestamps and format tool usage
**Files Changed:** 1 file (+26, -6 lines)
**Pushed:** origin/fix/kiro-timestamps
**PR:** #165 - https://github.com/user/repo/pull/165

The changes are ready for review.
```
