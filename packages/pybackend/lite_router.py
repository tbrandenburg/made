import logging
from html import escape
from pathlib import Path
from urllib.parse import quote, urlencode

from fastapi import APIRouter, BackgroundTasks, Form, Query, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.templating import Jinja2Templates

from agent_service import (
    ChannelBusyError,
    export_chat_history,
    list_agents,
    list_chat_sessions,
)
from lite_submission_service import (
    SubmissionCapacityError,
    accept_submission,
    fail_scheduling,
    get_submission,
    run_submission,
    valid_session_id,
)
from model_options import MODEL_OPTIONS as _MODEL_OPTIONS
from repository_service import get_repository_info, list_repositories

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/lite")
templates = Jinja2Templates(directory=Path(__file__).parent / "templates")

# The lite template only needs (value, label) pairs; the canonical list with
# group metadata lives in model_options.py (single source of truth, also
# consumed by the /api/models endpoint used by the React frontend).
MODEL_OPTIONS = [(value, label) for value, label, _group in _MODEL_OPTIONS]


@router.get("/", response_class=HTMLResponse)
async def list_repos(request: Request):
    repos = sorted(list_repositories(), key=lambda r: r["name"].lower())
    return templates.TemplateResponse(request, "lite_repos.html", {"repos": repos})


@router.get("/repo/{name}", response_class=HTMLResponse)
def repo_chat(request: Request, name: str, session_id: str = Query(default="")):
    try:
        get_repository_info(name)
    except FileNotFoundError:
        return HTMLResponse(
            content=f"Repository '{escape(name)}' not found.", status_code=404
        )

    session_cookie_name = f"lite_session_{quote(name, safe='')}"
    # The Load form always sends session_id, including its explicit empty
    # option. Only requests without that key should restore the cookie.
    has_session_selection = "session_id" in request.query_params
    current_session_id = (
        session_id.strip()
        if has_session_selection
        else request.cookies.get(session_cookie_name, "")
    )

    messages = []
    history_error = False
    history_reduced = False
    if current_session_id:
        try:
            history = export_chat_history(current_session_id, channel=name)
            messages = history.get("messages", [])
            history_reduced = history.get("historyReduced") is True
        except Exception:
            history_error = True
            logger.warning("Unable to load Lite chat history")

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
            "history_error": history_error,
            "history_reduced": history_reduced,
            "history_retry_url": (
                f"/lite/repo/{quote(name, safe='')}?"
                f"{urlencode({'session_id': current_session_id})}"
            ),
            "agents": agents,
            "sessions": sessions,
            "current_session_id": current_session_id,
            "model_options": MODEL_OPTIONS,
        },
    )
    # Persist a selection for subsequent requests, or forget it when the user
    # explicitly chose New session. An absent query key preserves the cookie.
    if current_session_id:
        response.set_cookie(
            key=session_cookie_name, value=current_session_id, httponly=True
        )
    elif has_session_selection:
        response.delete_cookie(key=session_cookie_name, httponly=True)
    return response


@router.post("/repo/{name}/chat")
def post_chat(
    request: Request,
    background_tasks: BackgroundTasks,
    name: str,
    message: str = Form(..., max_length=100000),
    session_id: str = Form(default="", max_length=512),
    agent: str = Form(default="", max_length=256),
    model: str = Form(default="default", max_length=256),
):
    if name in {".", ".."} or Path(name).name != name:
        return HTMLResponse("Invalid repository name.", status_code=422)
    try:
        get_repository_info(name)
    except FileNotFoundError:
        return HTMLResponse(
            content=f"Repository '{escape(name)}' not found.", status_code=404
        )

    effective_session_id = session_id.strip() or None
    resolved_agent = agent.strip() or None
    resolved_model = model.strip() if model and model != "default" else None
    if not message.strip() or (
        effective_session_id and not valid_session_id(effective_session_id)
    ):
        return HTMLResponse("Enter a message and a valid session ID.", status_code=422)

    try:
        job, owner = accept_submission(name, effective_session_id)
    except ChannelBusyError:
        return HTMLResponse(content="Agent is busy, try again.", status_code=409)
    except SubmissionCapacityError:
        return HTMLResponse("Submission capacity is full; try later.", status_code=503)
    except Exception:
        return HTMLResponse(
            "Could not accept the request. Ask an operator to check backend setup.",
            status_code=503,
        )
    try:
        response = RedirectResponse(
            url=f"/lite/repo/{quote(name, safe='')}/wait/{job.id}?attempt=0",
            status_code=303,
        )
        background_tasks.add_task(
            run_submission,
            job,
            owner,
            message,
            effective_session_id,
            resolved_agent,
            resolved_model,
        )
    except Exception:
        fail_scheduling(job, owner)
        return HTMLResponse(
            "Could not schedule the request. Try again later.", status_code=503
        )
    return response


@router.get("/repo/{name}/wait/{msg_id}", response_class=HTMLResponse)
def wait_for_response(
    request: Request,
    name: str,
    msg_id: str,
    attempt: int = Query(default=0, ge=0, le=60),
):
    job = get_submission(name, msg_id)
    repo_url = f"/lite/repo/{quote(name, safe='')}"
    if job is not None and job.state == "succeeded":
        response = RedirectResponse(
            url=f"{repo_url}?{urlencode({'session_id': job.session_id})}",
            status_code=303,
        )
        response.set_cookie(
            key=f"lite_session_{quote(name, safe='')}",
            value=job.session_id,
            httponly=True,
        )
        return response
    pending = job is not None and job.state in {"queued", "running"}
    return templates.TemplateResponse(
        request,
        "lite_wait.html",
        {
            "name": name,
            "msg_id": msg_id,
            "attempt": attempt,
            "state": job.state if job else "unknown",
            "error": job.error if job else None,
            "repo_url": repo_url,
            "refresh_url": (
                f"{repo_url}/wait/{quote(msg_id, safe='')}?attempt={attempt + 1}"
                if pending and attempt < 60
                else None
            ),
        },
        status_code=200 if pending else 410 if job is None else 503,
    )
