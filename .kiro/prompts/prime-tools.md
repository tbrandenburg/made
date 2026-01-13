---
description: Prime context for agent tool development
---

# Prime: Agent Tools Context

## Objective

Load context specifically for adding or modifying agent tools.

## Process

### 1. Read the Guide

Read the tool development guide:
- `.kiro/guides/adding-tools.md`

### 2. Read Core Tool Files

```bash
# Tool implementations
cat backend_agent_api/tools.py

# Tool registration and agent definition
cat backend_agent_api/agent.py
```

### 3. Understand Dependencies

Check the AgentDeps dataclass in `agent.py` to understand available dependencies:
- `supabase` - Database client
- `embedding_client` - For RAG operations
- `http_client` - For external API calls
- `brave_api_key`, `searxng_base_url` - Search services

### 4. Review Existing Tools

Note the patterns in existing tools:
- `web_search` - Simple HTTP integration
- `rag_search` - Embedding + database query
- `execute_sql_query` - Safety validation pattern
- `analyze_image` - Sub-agent pattern

### 5. Check Tests

Review test patterns:
```bash
cat backend_agent_api/tests/test_tools.py
```

### 6. Review Recent Tool Changes (Git Memory)

Check recent commits affecting tools for patterns and decisions:
```bash
git log --oneline -10 -- backend_agent_api/tools.py backend_agent_api/agent.py
```

For commits with useful context, read the full message:
```bash
git log -3 --format="%h %s%n%b" -- backend_agent_api/tools.py backend_agent_api/agent.py
```

Look for:
- `Pattern:` - Established patterns to follow
- `Decision:` - Architecture choices made
- `Gotcha:` - Known issues to avoid

## Skip

- Frontend code
- Eval code
- API endpoint code (unless tool needs new endpoint)

## Output

Summarize:
- Available dependencies in AgentDeps
- Existing tool patterns identified
- Ready to implement new tool
