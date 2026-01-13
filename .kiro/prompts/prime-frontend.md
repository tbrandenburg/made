---
description: Prime context for frontend development
---

# Prime: Frontend Context

## Objective

Load context specifically for frontend component development.

## Process

### 1. Read the Guide

Read the frontend development guide:
- `.kiro/guides/frontend-components.md`

### 2. Explore Component Structure

```bash
ls -la frontend/src/components/
ls -la frontend/src/components/ui/
ls -la frontend/src/components/chat/
```

### 3. Read Reference Components

Study these well-structured examples:
```bash
# Form with file upload and validation
cat frontend/src/components/chat/ChatInput.tsx

# Complex rendering with markdown
cat frontend/src/components/chat/MessageItem.tsx
```

### 4. Check Utilities and Hooks

```bash
# Utility functions (cn, etc.)
cat frontend/src/lib/utils.ts

# API client
cat frontend/src/lib/api.ts

# Custom hooks
ls frontend/src/hooks/
```

### 5. Review Styling Config

```bash
cat frontend/tailwind.config.ts
```

### 6. Review Recent Frontend Changes (Git Memory)

Check recent commits affecting frontend for patterns and decisions:
```bash
git log --oneline -10 -- frontend/src/components/ frontend/src/hooks/
```

For commits with useful context, read the full message:
```bash
git log -3 --format="%h %s%n%b" -- frontend/src/components/
```

Look for:
- `Pattern:` - Established patterns to follow
- `Decision:` - Architecture choices made
- `Gotcha:` - Known issues to avoid

## Skip

- Backend code
- Agent/tools code
- Eval code

## Output

Summarize:
- Component patterns identified
- Available UI primitives (shadcn/ui)
- Styling conventions
- Ready to implement new component
