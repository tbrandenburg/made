# Adding Agent Tools

## Architecture

- **Tool logic**: `backend_agent_api/tools.py` - async helper functions
- **Tool registration**: `backend_agent_api/agent.py` - `@agent.tool` decorator
- **Dependencies**: `AgentDeps` dataclass provides `supabase`, `embedding_client`, `http_client`, `brave_api_key`

## Pattern

1. **Add helper function** in `tools.py`:
```python
async def my_tool_helper(http_client: httpx.AsyncClient, param: str) -> str:
    # Implementation
    return result
```

2. **Register tool** in `agent.py`:
```python
@agent.tool
async def my_tool(ctx: RunContext[AgentDeps], param: str) -> str:
    """Clear docstring explaining what tool does and parameters."""
    return await my_tool_helper(ctx.deps.http_client, param)
```

## Reference Examples

- Simple HTTP tool: `agent.py` lines 76-91 (`web_search`)
- Database tool: `agent.py` lines 134-166 (`execute_sql_query`)
- Sub-agent tool: `agent.py` lines 168-186 (`analyze_image`)

## Key Points

- Docstring becomes the tool description for the agent
- Access dependencies via `ctx.deps.*`
- Return strings (agent consumes text)
- Handle errors gracefully, return error messages as strings
