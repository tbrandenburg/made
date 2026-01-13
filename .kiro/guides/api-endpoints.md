# API Endpoints

## Architecture

- **Framework**: FastAPI
- **Main file**: `backend_agent_api/agent_api.py`
- **Database**: Supabase via `db_utils.py`
- **Auth**: JWT verification via `verify_token` dependency

## Endpoint Pattern

```python
from fastapi import Depends
from pydantic import BaseModel

class MyRequest(BaseModel):
    query: str
    user_id: str

@app.post("/api/my-endpoint")
async def my_endpoint(
    request: MyRequest,
    user: Dict[str, Any] = Depends(verify_token)
):
    # Access global clients: supabase, http_client, embedding_client
    result = await some_operation(request.query)
    return {"result": result}
```

## Streaming Response Pattern

```python
async def stream_generator():
    yield json.dumps({"text": "chunk"}) + "\n"
    yield json.dumps({"complete": True}) + "\n"

return StreamingResponse(stream_generator(), media_type='text/plain')
```

## Reference Examples

- Main agent endpoint: `agent_api.py` lines 201-400 (`pydantic_agent`)
- Health check: `agent_api.py` lines 443-470 (`health_check`)
- Database operations: `db_utils.py` (fetch_conversation_history, store_message)

## Key Points

- Use `Depends(verify_token)` for authenticated endpoints
- Global clients initialized at startup via `lifespan` context manager
- CORS enabled for all origins (dev setup)
- Errors: `HTTPException` or `stream_error_response()` for streaming
