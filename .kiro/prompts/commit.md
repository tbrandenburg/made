---
description: Create descriptive commits that serve as memory for future AI agents
---

# Commit: Git Log as Memory

## Philosophy

Commit messages are **long-term memory** for AI agents. When future agents run `git log`, your commit messages help them understand:
- What was changed and why
- Patterns and conventions established
- Decisions made and their rationale
- Context that code alone doesn't convey

**Write commits for the next agent, not just for humans.**

## Process

### 1. Analyze Changes

First, understand what you're committing:

```bash
git status
git diff --staged
git diff
```

If nothing is staged, stage the relevant changes:
```bash
git add -A  # or selectively add files
```

### 2. Categorize the Change

Determine the commit type:

| Type | When to Use | Example |
|------|-------------|---------|
| `feat` | New functionality | `feat(auth): add JWT refresh token rotation` |
| `fix` | Bug fix | `fix(api): handle null response in user fetch` |
| `refactor` | Code restructure, no behavior change | `refactor(db): extract query builder to separate module` |
| `docs` | Documentation only | `docs(api): add OpenAPI examples for /users endpoint` |
| `test` | Adding/updating tests | `test(auth): add edge cases for token expiration` |
| `chore` | Maintenance, deps, config | `chore(deps): upgrade langfuse to v3.0` |
| `perf` | Performance improvement | `perf(search): add index for user lookups` |
| `style` | Formatting, no code change | `style: apply ruff formatting` |

### 3. Craft the Commit Message

**Format:**
```
type(scope): concise description (imperative mood)

[Body - 2-4 sentences explaining WHY and CONTEXT]

[Optional: Key decisions, patterns established, gotchas]
```

**Rules for AI-Readable Commits:**

1. **First line (subject):**
   - Use imperative mood: "add" not "added"
   - Include scope in parentheses: `feat(auth)`, `fix(api/users)`
   - Keep under 72 characters
   - Be specific: "add login form" not "update frontend"

2. **Body (critical for AI memory):**
   - Explain WHY the change was made, not just what
   - Mention patterns or conventions established
   - Note any non-obvious decisions
   - Reference related components affected

3. **Include context future agents need:**
   - "Following the existing pattern in src/services/"
   - "Using Langfuse v3 tracing decorator pattern"
   - "This replaces the previous approach of X because Y"

### 4. Example Commits (Good vs Bad)

**Bad (no context for future agents):**
```
update auth
```

**Good (rich context for AI memory):**
```
feat(auth): add JWT refresh token rotation with sliding window

Implement automatic token refresh using sliding window strategy.
Tokens refresh when 50% of TTL remains, preventing session drops
during active use.

Pattern: Uses the auth middleware decorator from src/middleware/auth.py
Decision: Chose sliding window over fixed refresh to improve UX
Related: Updates to frontend token handling in src/hooks/useAuth.ts
```

**Bad:**
```
fix bug
```

**Good:**
```
fix(api/users): handle race condition in concurrent profile updates

Multiple simultaneous profile updates could overwrite each other.
Added optimistic locking with version field check.

Gotcha: Must increment version in application code, not DB trigger
Pattern: Follows existing optimistic locking in src/models/base.py
```

### 5. Execute Commit

```bash
git commit -m "$(cat <<'EOF'
type(scope): description

Body explaining why and providing context for future agents.

Key decisions or patterns established.
EOF
)"
```

### 6. Push Changes

After committing:

```bash
git push
```

If no upstream is set:
```bash
git push -u origin $(git branch --show-current)
```

## Safety Checks

- **Never commit to main/master directly** without user confirmation
- **Check for secrets** in staged files (.env, API keys, credentials)
- **Verify you're on the correct branch** before pushing
- If there's no PR, ask the user if they want to create one

## Output

After committing, report:
- Commit hash
- Files changed summary
- Branch pushed to
- Link to PR if exists

