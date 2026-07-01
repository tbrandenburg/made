from pathlib import Path

from fastapi import APIRouter, Form, Query, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.templating import Jinja2Templates

from agent_service import (
    ChannelBusyError,
    export_chat_history,
    get_channel_status,
    list_agents,
    list_chat_sessions,
    send_agent_message,
)
from repository_service import get_repository_info, list_repositories

router = APIRouter(prefix="/lite")
templates = Jinja2Templates(directory=Path(__file__).parent / "templates")

MODEL_OPTIONS = [
    ("default", "default"),
    ("claude-haiku-4.5", "claude-haiku-4.5"),
    ("claude-opus-4.5", "claude-opus-4.5"),
    ("claude-sonnet-4", "claude-sonnet-4"),
    ("claude-sonnet-4.5", "claude-sonnet-4.5"),
    ("opencode/big-pickle", "opencode/big-pickle"),
    ("opencode/glm-4.7-free", "opencode/glm-4.7-free"),
    ("opencode/gpt-5-nano", "opencode/gpt-5-nano"),
    ("opencode/grok-code", "opencode/grok-code"),
    ("github-copilot/claude-haiku-4.5", "github-copilot/claude-haiku-4.5"),
    ("github-copilot/claude-opus-4.5", "github-copilot/claude-opus-4.5"),
    ("github-copilot/claude-sonnet-4.5", "github-copilot/claude-sonnet-4.5"),
    ("github-copilot/claude-sonnet-4.6", "github-copilot/claude-sonnet-4.6"),
    ("github-copilot/gemini-2.5-pro", "github-copilot/gemini-2.5-pro"),
    ("github-copilot/gpt-4.1", "github-copilot/gpt-4.1"),
    ("openai/gpt-4o", "openai/gpt-4o"),
    ("openai/o3", "openai/o3"),
]


@router.get("/", response_class=HTMLResponse)
async def list_repos(request: Request):
    repos = sorted(list_repositories(), key=lambda r: r["name"].lower())
    return templates.TemplateResponse(request, "lite_repos.html", {"repos": repos})


@router.get("/repo/{name}", response_class=HTMLResponse)
async def repo_chat(request: Request, name: str, session_id: str = Query(default="")):
    try:
        get_repository_info(name)
    except FileNotFoundError:
        return HTMLResponse(content=f"Repository '{name}' not found.", status_code=404)

    session_cookie_name = f"lite_session_{name}"
    # query param takes priority over cookie (used by the Load button GET form)
    current_session_id = session_id.strip() or request.cookies.get(session_cookie_name) or ""

    messages = []
    if current_session_id:
        try:
            history = export_chat_history(current_session_id, name)
            messages = history.get("messages", [])
        except Exception:
            messages = []

    agents = []
    try:
        agents = list_agents(name)
    except Exception:
        agents = []

    sessions = []
    try:
        sessions = list_chat_sessions(name)
    except Exception:
        sessions = []

    response = templates.TemplateResponse(
        request,
        "lite_repo.html",
        {
            "name": name,
            "messages": messages,
            "agents": agents,
            "sessions": sessions,
            "current_session_id": current_session_id,
            "model_options": MODEL_OPTIONS,
        },
    )
    # persist the selected session into the cookie so subsequent POSTs pick it up
    if current_session_id:
        response.set_cookie(key=session_cookie_name, value=current_session_id, httponly=True)
    return response


@router.post("/repo/{name}/chat")
async def post_chat(
    request: Request,
    name: str,
    message: str = Form(...),
    session_id: str = Form(default=""),
    agent: str = Form(default=""),
    model: str = Form(default="default"),
):
    try:
        get_repository_info(name)
    except FileNotFoundError:
        return HTMLResponse(content=f"Repository '{name}' not found.", status_code=404)

    effective_session_id = session_id.strip() or None
    resolved_agent = agent.strip() or None
    resolved_model = model.strip() if model and model != "default" else None

    try:
        result = send_agent_message(
            channel=name,
            message=message,
            session_id=effective_session_id,
            agent=resolved_agent,
            model=resolved_model,
        )
    except ChannelBusyError:
        return HTMLResponse(content="Agent is busy, try again.", status_code=409)

    new_session_id = result.get("sessionId") or effective_session_id or ""
    msg_id = result.get("messageId", "")

    redirect_url = (
        f"/lite/repo/{name}/wait/{msg_id}?attempt=0&session_id={new_session_id}"
    )
    response = RedirectResponse(url=redirect_url, status_code=303)

    if new_session_id:
        response.set_cookie(
            key=f"lite_session_{name}",
            value=new_session_id,
            httponly=True,
        )

    return response


@router.get("/repo/{name}/wait/{msg_id}", response_class=HTMLResponse)
async def wait_for_response(
    request: Request,
    name: str,
    msg_id: str,
    attempt: int = Query(default=0),
    session_id: str = Query(default=""),
):
    lock_key = session_id if session_id else name
    status = get_channel_status(lock_key)
    running = status.get("running", False)

    if not running or attempt >= 60:
        return RedirectResponse(url=f"/lite/repo/{name}", status_code=303)

    return templates.TemplateResponse(
        request,
        "lite_wait.html",
        {
            "name": name,
            "msg_id": msg_id,
            "attempt": attempt,
            "session_id": session_id,
        },
    )
