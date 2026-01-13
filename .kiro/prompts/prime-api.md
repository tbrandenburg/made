---
description: Prime context for API endpoint development
---

# Prime: API Context

## Objective

Load context specifically for API endpoint development.

## Process

### 1. Read the Guide

Read the API development guide:
- `.kiro/guides/api-endpoints.md`

### 2. Read Core API Files

```bash
# Main API file - endpoints and patterns
cat backend_agent_api/agent_api.py

# Database operations
cat backend_agent_api/db_utils.py

# Client initialization
cat backend_agent_api/clients.py
```

### 3. Understand Auth Pattern

Look at `verify_token` function in `agent_api.py` for:
- JWT validation flow
- How to extract user info
- Error handling for auth failures

### 4. Study Request/Response Models

In `agent_api.py`, note:
- `AgentRequest` - Input validation pattern
- `FileAttachment` - File handling pattern
- Streaming response format

### 5. Check Database Schema

Review Supabase operations in `db_utils.py`:
- `fetch_conversation_history`
- `store_message`
- `create_conversation`

### 6. Review Recent API Changes (Git Memory)

Check recent commits affecting API for patterns and decisions:
```bash
git log --oneline -10 -- backend_agent_api/agent_api.py backend_agent_api/db_utils.py
```

For commits with useful context, read the full message:
```bash
git log -3 --format="%h %s%n%b" -- backend_agent_api/agent_api.py backend_agent_api/db_utils.py
```

Look for:
- `Pattern:` - Established patterns to follow
- `Decision:` - Architecture choices made
- `Gotcha:` - Known issues to avoid

## Skip

- Frontend code
- Agent tool implementations
- Eval code

## Output

Summarize:
- Available global clients (supabase, http_client, etc.)
- Auth pattern understood
- Database operations available
- Ready to implement new endpoint
