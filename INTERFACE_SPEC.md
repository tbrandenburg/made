# Agent Interface Specification (Frontend ↔ Backend)

This document captures the frontend-facing API contract for agent-related features.
It is derived from the frontend client expectations and backend routes to keep both
sides aligned when CLI adapters evolve.

## Base URL

The frontend issues requests relative to `VITE_API_BASE`, defaulting to `/api`.

## Agent Messaging Endpoints

### Send Agent Message (Repository)

`POST /api/repositories/{name}/agent`

**Request body**

```json
{
  "message": "string",
  "sessionId": "string (optional)"
}
```

**Response shape**

```json
{
  "messageId": "string",
  "sent": "ISO-8601 timestamp",
  "response": "string",
  "prompt": "string (optional)",
  "responses": [
    {
      "text": "string",
      "timestamp": "ISO-8601 timestamp (optional)",
      "type": "thinking | tool | final (optional)",
      "partId": "string (optional)",
      "callId": "string (optional)"
    }
  ],
  "sessionId": "string (optional)"
}
```

### Send Agent Message (Knowledge Artefact)

`POST /api/knowledge/{name}/agent`

Payload and response follow the same shape as repository messaging.

### Send Agent Message (Constitution)

`POST /api/constitutions/{name}/agent`

Payload and response follow the same shape as repository messaging.

## Agent Status Endpoints

### Get Agent Status (Repository)

`GET /api/repositories/{name}/agent/status`

**Response shape**

```json
{
  "processing": true,
  "startedAt": "ISO-8601 timestamp or null"
}
```

### Cancel Agent Request (Repository)

`POST /api/repositories/{name}/agent/cancel`

The response is empty (`204 No Content`) on success.

### Knowledge/Constitution Status + Cancel

`GET /api/knowledge/{name}/agent/status`, `POST /api/knowledge/{name}/agent/cancel`

`GET /api/constitutions/{name}/agent/status`, `POST /api/constitutions/{name}/agent/cancel`

Response shapes follow the repository status/cancel endpoints.

## Agent Session & History Endpoints

### List Sessions

`GET /api/repositories/{name}/agent/sessions?limit={number}`

Equivalent endpoints exist under `/api/knowledge/{name}/agent/sessions` and
`/api/constitutions/{name}/agent/sessions`.

**Response shape**

```json
{
  "sessions": [
    {
      "id": "string",
      "title": "string",
      "updated": "string"
    }
  ]
}
```

### Fetch Session History

`GET /api/repositories/{name}/agent/history?session_id={id}&start={timestamp}`

Equivalent endpoints exist under `/api/knowledge/{name}/agent/history` and
`/api/constitutions/{name}/agent/history`.

`start` is optional and, when provided, should be a millisecond timestamp.

**Response shape**

```json
{
  "sessionId": "string",
  "messages": [
    {
      "messageId": "string (optional)",
      "role": "user | assistant",
      "type": "text | tool | tool_use",
      "content": "string",
      "timestamp": "ISO-8601 timestamp or null",
      "partId": "string (optional)",
      "callId": "string (optional)"
    }
  ]
}
```

## Notes

- The frontend maps agent response parts into chat messages with `thinking`, `tool`,
  or `final` message types.
- History messages are normalized to match the chat UI expectations and deduped
  by message IDs or tool call IDs.
