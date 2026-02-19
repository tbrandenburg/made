import asyncio
import contextlib
import fcntl
import json
import logging
import os
import pty
import struct
import subprocess
import termios
from copy import deepcopy
from pathlib import Path

from uvicorn.config import LOGGING_CONFIG

from fastapi import (
    Body,
    FastAPI,
    File,
    Form,
    HTTPException,
    Query,
    UploadFile,
    WebSocket,
    status,
)
from fastapi.websockets import WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from agent_service import (
    ChannelBusyError,
    cancel_agent_message,
    export_chat_history,
    get_channel_status,
    list_agents,
    list_chat_sessions,
    send_agent_message,
)
from constitution_service import (
    list_constitutions,
    read_constitution,
    write_constitution,
)
from task_service import list_tasks, read_task, write_task
from dashboard_service import get_dashboard_summary
from knowledge_service import (
    list_knowledge_artefacts,
    read_knowledge_artefact,
    write_knowledge_artefact,
)
from command_service import list_commands
from harness_service import is_process_running, list_harnesses, run_harness
from repository_service import (
    create_repository,
    create_repository_file,
    clone_repository,
    delete_repository_file,
    get_repository_info,
    list_repositories,
    list_repository_files,
    read_repository_file,
    rename_repository_file,
    write_repository_file,
    write_repository_file_bytes,
)
from settings_service import read_settings, write_settings
from config import (
    ensure_directory,
    ensure_made_structure,
    get_made_directory,
    get_workspace_home,
    get_backend_host,
    get_backend_port,
)

log_dir = ensure_directory(get_made_directory() / "logs")
log_file = log_dir / "backend.log"
LOG_FORMAT = "%(asctime)s %(levelname)s [%(name)s] %(message)s"
COLOR_LOG_FORMAT = "%(asctime)s %(levelprefix)s [%(name)s] %(message)s"
logging.basicConfig(
    level=logging.INFO,
    format=LOG_FORMAT,
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler(log_file, encoding="utf-8"),
    ],
)
logger = logging.getLogger("made.pybackend")

app = FastAPI(title="MADE Python Backend")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

TERMINAL_BUFFER_SIZE = 4096
DEFAULT_TERMINAL_COLUMNS = 120
DEFAULT_TERMINAL_ROWS = 32


def _repository_path(name: str) -> Path:
    repo_path = get_workspace_home() / name
    if not repo_path.exists() or not repo_path.is_dir():
        raise FileNotFoundError("Repository not found")
    return repo_path


def _resize_pty(fd: int, cols: int, rows: int) -> None:
    if cols <= 0 or rows <= 0:
        return
    try:
        size = struct.pack("HHHH", rows, cols, 0, 0)
        fcntl.ioctl(fd, termios.TIOCSWINSZ, size)
    except OSError as exc:  # pragma: no cover - defensive
        logger.debug("Failed to resize pty: %s", exc)


def _start_shell(repo_path: Path) -> tuple[int, subprocess.Popen, str]:
    master_fd, slave_fd = pty.openpty()
    env = os.environ.copy()
    env.setdefault("TERM", "xterm-256color")
    shell = env.get("SHELL", "/bin/bash")
    try:
        process = subprocess.Popen(
            [shell],
            cwd=repo_path,
            stdin=slave_fd,
            stdout=slave_fd,
            stderr=slave_fd,
            env=env,
            preexec_fn=os.setsid,
        )
    except Exception:
        os.close(master_fd)
        os.close(slave_fd)
        raise

    os.close(slave_fd)
    return master_fd, process, shell


@app.get("/api/health")
def health_check():
    return {
        "status": "ok",
        "workspace": str(get_workspace_home()),
        "made": str(get_made_directory()),
    }


@app.get("/api/dashboard")
def dashboard():
    try:
        logger.info("Fetching dashboard summary")
        return get_dashboard_summary()
    except Exception as exc:  # pragma: no cover - passthrough errors
        logger.exception("Failed to fetch dashboard summary")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)
        )


@app.get("/api/agents")
def list_available_agents():
    try:
        logger.info("Listing available agents")
        return {"agents": list_agents()}
    except Exception as exc:
        logger.exception("Failed to list available agents")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)
        )


@app.get("/api/repositories")
def repositories():
    try:
        logger.info("Listing repositories")
        return {"repositories": list_repositories()}
    except Exception as exc:
        logger.exception("Failed to list repositories")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)
        )


@app.post("/api/repositories", status_code=status.HTTP_201_CREATED)
def create_repo(payload: dict = Body(...)):
    name = payload.get("name")
    if not name:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Repository name is required",
        )
    try:
        logger.info("Creating repository '%s'", name)
        return create_repository(name)
    except ValueError as exc:
        logger.warning("Repository creation failed for '%s': %s", name, exc)
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))


@app.post("/api/repositories/clone", status_code=status.HTTP_201_CREATED)
def clone_repo(payload: dict = Body(...)):
    repo_url = payload.get("url")
    target_name = payload.get("name")
    branch = payload.get("branch")
    if not repo_url:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Repository URL is required",
        )
    try:
        logger.info(
            "Cloning repository from '%s' into '%s'",
            repo_url,
            target_name or "<derived>",
        )
        return clone_repository(repo_url, target_name, branch)
    except ValueError as exc:
        logger.warning(
            "Repository cloning failed from '%s' to '%s': %s",
            repo_url,
            target_name or "<derived>",
            exc,
        )
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))


@app.get("/api/repositories/{name}")
def repository_info(name: str):
    try:
        logger.info("Retrieving repository info for '%s'", name)
        return get_repository_info(name)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))


@app.get("/api/repositories/{name}/files")
def repository_files(name: str, path: str = Query(".")):
    try:
        logger.info("Listing files for repository '%s' at '%s'", name, path)
        return list_repository_files(name, path)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))


@app.get("/api/repositories/{name}/file")
def read_repository_file_endpoint(name: str, path: str = Query(...)):
    if not path:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="File path is required"
        )
    try:
        logger.info("Reading file '%s' from repository '%s'", path, name)
        content = read_repository_file(name, path)
        return {"content": content}
    except FileNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))


@app.put("/api/repositories/{name}/file")
def write_repository_file_endpoint(name: str, payload: dict = Body(...)):
    file_path = payload.get("path")
    if not file_path:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="File path is required"
        )
    try:
        logger.info("Writing to file '%s' in repository '%s'", file_path, name)
        write_repository_file(name, file_path, payload.get("content", ""))
        return {"success": True}
    except Exception as exc:
        logger.exception(
            "Failed to write file '%s' in repository '%s'", file_path, name
        )
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))


@app.post("/api/repositories/{name}/file", status_code=status.HTTP_201_CREATED)
def create_repository_file_endpoint(name: str, payload: dict = Body(...)):
    file_path = payload.get("path")
    if not file_path:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="File path is required"
        )
    try:
        logger.info("Creating file '%s' in repository '%s'", file_path, name)
        create_repository_file(name, file_path, payload.get("content", ""))
        return {"success": True}
    except Exception as exc:
        logger.exception(
            "Failed to create file '%s' in repository '%s'", file_path, name
        )
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))


@app.post("/api/repositories/{name}/file/upload", status_code=status.HTTP_201_CREATED)
async def upload_repository_file_endpoint(
    name: str,
    path: str | None = Form(None),
    file: UploadFile = File(...),
):
    if not path or not path.strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="File path is required"
        )
    try:
        logger.info("Uploading file '%s' to repository '%s'", path, name)
        content = await file.read()
        write_repository_file_bytes(name, path, content)
        return {"success": True}
    except Exception as exc:
        logger.exception(
            "Failed to upload file '%s' in repository '%s'", path, name
        )
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))


@app.post("/api/repositories/{name}/file/rename")
def rename_repository_file_endpoint(name: str, payload: dict = Body(...)):
    old = payload.get("from")
    new = payload.get("to")
    if not old or not new:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Both from and to paths are required",
        )
    try:
        logger.info(
            "Renaming file from '%s' to '%s' in repository '%s'", old, new, name
        )
        rename_repository_file(name, old, new)
        return {"success": True}
    except Exception as exc:
        logger.exception(
            "Failed to rename file from '%s' to '%s' in repository '%s'",
            old,
            new,
            name,
        )
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))


@app.delete("/api/repositories/{name}/file")
def delete_repository_file_endpoint(name: str, payload: dict = Body(...)):
    file_path = payload.get("path")
    if not file_path:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="File path is required"
        )
    try:
        logger.info("Deleting file '%s' from repository '%s'", file_path, name)
        delete_repository_file(name, file_path)
        return {"success": True}
    except Exception as exc:
        logger.exception(
            "Failed to delete file '%s' from repository '%s'", file_path, name
        )
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))


@app.post("/api/repositories/{name}/agent")
def repository_agent(name: str, payload: dict = Body(...)):
    message = payload.get("message")
    session_id = payload.get("sessionId")
    agent = payload.get("agent")
    model = payload.get("model")
    if not message:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Message is required"
        )
    try:
        logger.info(
            "Forwarding agent message for repository '%s' (session: %s, agent: %s)",
            name,
            session_id or "new",
            agent or "default",
        )
        return send_agent_message(name, message, session_id, agent, model)
    except ChannelBusyError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc))


@app.get("/api/repositories/{name}/agent/status")
def repository_agent_status(name: str):
    return get_channel_status(name)


@app.post("/api/repositories/{name}/agent/cancel")
def repository_agent_cancel(name: str):
    if not cancel_agent_message(name):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No active agent process to cancel",
        )
    return {"success": True}


@app.get("/api/repositories/{name}/commands")
def repository_commands(name: str):
    try:
        logger.info("Listing commands for repository '%s'", name)
        return {"commands": list_commands(name)}
    except Exception as exc:  # pragma: no cover - passthrough errors
        logger.exception("Failed to list commands for repository '%s'", name)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)
        )


@app.get("/api/repositories/{name}/harnesses")
def repository_harnesses(name: str):
    try:
        logger.info("Listing harnesses for repository '%s'", name)
        return {"harnesses": list_harnesses(name)}
    except Exception as exc:  # pragma: no cover - passthrough errors
        logger.exception("Failed to list harnesses for repository '%s'", name)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)
        )


@app.post("/api/repositories/{name}/harnesses/run")
def repository_harness_run(name: str, payload: dict = Body(...)):
    path = payload.get("path")
    if not path:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Harness path is required",
        )
    try:
        logger.info("Running harness for repository '%s': %s", name, path)
        return run_harness(name, path, payload.get("args"))
    except FileNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    except Exception as exc:  # pragma: no cover - passthrough errors
        logger.exception("Failed to run harness for repository '%s'", name)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)
        )


@app.get("/api/commands")
def global_commands():
    try:
        logger.info("Listing global commands")
        return {"commands": list_commands()}
    except Exception as exc:  # pragma: no cover - passthrough errors
        logger.exception("Failed to list global commands")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)
        )


@app.get("/api/harnesses")
def global_harnesses():
    try:
        logger.info("Listing global harnesses")
        return {"harnesses": list_harnesses()}
    except Exception as exc:  # pragma: no cover - passthrough errors
        logger.exception("Failed to list global harnesses")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)
        )


@app.post("/api/harnesses/run")
def global_harness_run(payload: dict = Body(...)):
    path = payload.get("path")
    if not path:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Harness path is required",
        )
    try:
        logger.info("Running global harness: %s", path)
        return run_harness(None, path, payload.get("args"))
    except FileNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    except Exception as exc:  # pragma: no cover - passthrough errors
        logger.exception("Failed to run global harness: %s", path)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)
        )


@app.get("/api/harnesses/{pid}/status")
def harness_status(pid: int):
    return {"pid": pid, "running": is_process_running(pid)}


@app.websocket("/api/repositories/{name}/terminal")
async def repository_terminal(name: str, websocket: WebSocket):
    client = websocket.client
    client_addr = (
        f"{getattr(client, 'host', 'unknown')}:{getattr(client, 'port', '0')}"
        if client
        else "unknown"
    )
    logger.info(
        "Terminal connection attempt for repository '%s' from %s", name, client_addr
    )
    try:
        repo_path = _repository_path(name)
    except FileNotFoundError:
        logger.warning(
            "Terminal connection refused; repository '%s' not found (client: %s)",
            name,
            client_addr,
        )
        await websocket.close(
            code=status.WS_1008_POLICY_VIOLATION, reason="Repository not found"
        )
        return

    await websocket.accept()
    try:
        master_fd, process, shell = _start_shell(repo_path)
    except Exception:  # pragma: no cover - passthrough errors
        logger.exception(
            "Failed to start terminal for '%s' (client: %s)", name, client_addr
        )
        await websocket.close(
            code=status.WS_1011_INTERNAL_ERROR,
            reason="Failed to start shell",
        )
        return

    logger.info(
        "Terminal session started for repository '%s' using %s (client: %s)",
        name,
        shell,
        client_addr,
    )
    loop = asyncio.get_running_loop()
    _resize_pty(master_fd, DEFAULT_TERMINAL_COLUMNS, DEFAULT_TERMINAL_ROWS)

    async def forward_output() -> None:
        try:
            while True:
                data = await loop.run_in_executor(
                    None, os.read, master_fd, TERMINAL_BUFFER_SIZE
                )
                if not data:
                    break
                await websocket.send_text(data.decode(errors="ignore"))
        except WebSocketDisconnect as exc:
            logger.info(
                "Terminal websocket disconnected during output for '%s' from %s (code=%s)",
                name,
                client_addr,
                exc.code,
            )
        except asyncio.CancelledError:
            logger.info(
                "Terminal output task cancelled for '%s' from %s", name, client_addr
            )
        except Exception as exc:  # pragma: no cover - defensive
            logger.error("Terminal output stopped for '%s': %s", name, exc)
        finally:
            with contextlib.suppress(Exception):
                await websocket.close()

    reader_task = asyncio.create_task(forward_output())

    try:
        await websocket.send_text(
            f"Connected to {repo_path} using {os.path.basename(shell)}.\n"
            "Type 'exit' to close the shell.\n"
        )
        while True:
            message = await websocket.receive_text()
            try:
                payload = json.loads(message)
            except json.JSONDecodeError:
                payload = {"type": "input", "data": message}

            if payload.get("type") == "resize":
                cols = int(payload.get("cols") or 0)
                rows = int(payload.get("rows") or 0)
                _resize_pty(master_fd, cols, rows)
                logger.info(
                    "Resized terminal for '%s' to cols=%s rows=%s", name, cols, rows
                )
                continue

            data = str(payload.get("data", ""))
            if not data:
                continue
            logger.debug(
                "Received terminal input for '%s' from %s (%s bytes)",
                name,
                client_addr,
                len(data),
            )
            try:
                os.write(master_fd, data.encode())
            except OSError as exc:  # pragma: no cover - defensive
                logger.error("Failed to write to terminal for '%s': %s", name, exc)
                break
    except WebSocketDisconnect as exc:
        logger.info(
            "Terminal websocket disconnected for '%s' from %s (code=%s)",
            name,
            client_addr,
            exc.code,
        )
    except Exception:  # pragma: no cover - defensive
        logger.exception("Unexpected terminal error for '%s'", name)
    finally:
        reader_task.cancel()
        with contextlib.suppress(asyncio.CancelledError, Exception):
            await reader_task
        with contextlib.suppress(Exception):
            os.close(master_fd)
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=2)
            except subprocess.TimeoutExpired:
                process.kill()
        logger.info("Terminal session closed for repository '%s'", name)


@app.get("/api/knowledge")
def knowledge_list():
    try:
        logger.info("Listing knowledge artefacts")
        return {"artefacts": list_knowledge_artefacts()}
    except Exception as exc:
        logger.exception("Failed to list knowledge artefacts")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)
        )


@app.get("/api/knowledge/{name}")
def knowledge_item(name: str):
    try:
        logger.info("Reading knowledge artefact '%s'", name)
        return read_knowledge_artefact(name)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))


@app.put("/api/knowledge/{name}")
def knowledge_write(name: str, payload: dict = Body(...)):
    try:
        logger.info("Updating knowledge artefact '%s'", name)
        write_knowledge_artefact(
            name, payload.get("frontmatter", {}), payload.get("content", "")
        )
        return {"success": True}
    except Exception as exc:
        logger.exception("Failed to update knowledge artefact '%s'", name)
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))


@app.post("/api/knowledge/{name}/agent")
def knowledge_agent(name: str, payload: dict = Body(...)):
    message = payload.get("message")
    session_id = payload.get("sessionId")
    agent = payload.get("agent")
    model = payload.get("model")
    if not message:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Message is required"
        )
    try:
        logger.info(
            "Forwarding agent message for knowledge '%s' (session: %s, agent: %s)",
            name,
            session_id or "new",
            agent or "default",
        )
        return send_agent_message(f"knowledge:{name}", message, session_id, agent, model)
    except ChannelBusyError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc))


@app.get("/api/knowledge/{name}/agent/status")
def knowledge_agent_status(name: str):
    return get_channel_status(f"knowledge:{name}")


@app.post("/api/knowledge/{name}/agent/cancel")
def knowledge_agent_cancel(name: str):
    if not cancel_agent_message(f"knowledge:{name}"):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No active agent process to cancel",
        )
    return {"success": True}


@app.get("/api/knowledge/{name}/agent/history")
def knowledge_agent_history(
    name: str,
    session_id: str | None = Query(default=None),
    start: int | str | None = Query(default=None),
):
    try:
        normalized_start = int(start) if start is not None else None
        logger.info(
            "Exporting agent history for knowledge '%s' (session: %s, start: %s)",
            name,
            session_id or "current",
            start,
        )
        return export_chat_history(session_id, normalized_start, f"knowledge:{name}")
    except ValueError as exc:
        logger.warning(
            "Bad request exporting agent history for knowledge '%s' (session: %s, start: %s): %s",
            name,
            session_id or "current",
            start,
            exc,
        )
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    except Exception as exc:  # pragma: no cover - passthrough errors
        logger.exception(
            "Unexpected error exporting history for knowledge '%s' (session: %s, start: %s)",
            name,
            session_id or "current",
            start,
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)
        )


@app.get("/api/knowledge/{name}/agent/sessions")
def knowledge_agent_sessions(
    name: str,
    limit: int = Query(default=10, ge=1, le=50),
):
    try:
        logger.info(
            "Listing agent sessions for knowledge '%s' (limit: %s)", name, limit
        )
        return {"sessions": list_chat_sessions(f"knowledge:{name}", limit)}
    except Exception as exc:  # pragma: no cover - passthrough errors
        logger.exception(
            "Unexpected error listing sessions for knowledge '%s' (limit: %s)",
            name,
            limit,
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)
        )


@app.get("/api/constitutions")
def constitutions():
    try:
        logger.info("Listing constitutions")
        return {"constitutions": list_constitutions()}
    except Exception as exc:
        logger.exception("Failed to list constitutions")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)
        )


@app.get("/api/constitutions/{name}")
def constitution_item(name: str):
    try:
        logger.info("Reading constitution '%s'", name)
        return read_constitution(name)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))


@app.put("/api/constitutions/{name}")
def constitution_write(name: str, payload: dict = Body(...)):
    try:
        logger.info("Updating constitution '%s'", name)
        write_constitution(
            name, payload.get("frontmatter", {}), payload.get("content", "")
        )
        return {"success": True}
    except Exception as exc:
        logger.exception("Failed to update constitution '%s'", name)
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))


@app.post("/api/constitutions/{name}/agent")
def constitution_agent(name: str, payload: dict = Body(...)):
    message = payload.get("message")
    session_id = payload.get("sessionId")
    agent = payload.get("agent")
    model = payload.get("model")
    if not message:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Message is required"
        )
    try:
        logger.info(
            "Forwarding agent message for constitution '%s' (session: %s, agent: %s)",
            name,
            session_id or "new",
            agent or "default",
        )
        return send_agent_message(
            f"constitution:{name}", message, session_id, agent, model
        )
    except ChannelBusyError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc))


@app.get("/api/constitutions/{name}/agent/status")
def constitution_agent_status(name: str):
    return get_channel_status(f"constitution:{name}")


@app.post("/api/constitutions/{name}/agent/cancel")
def constitution_agent_cancel(name: str):
    if not cancel_agent_message(f"constitution:{name}"):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No active agent process to cancel",
        )
    return {"success": True}


@app.get("/api/constitutions/{name}/agent/history")
def constitution_agent_history(
    name: str,
    session_id: str | None = Query(default=None),
    start: int | str | None = Query(default=None),
):
    try:
        normalized_start = int(start) if start is not None else None
        logger.info(
            "Exporting agent history for constitution '%s' (session: %s, start: %s)",
            name,
            session_id or "current",
            start,
        )
        return export_chat_history(session_id, normalized_start, f"constitution:{name}")
    except ValueError as exc:
        logger.warning(
            "Bad request exporting agent history for constitution '%s' (session: %s, start: %s): %s",
            name,
            session_id or "current",
            start,
            exc,
        )
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    except Exception as exc:  # pragma: no cover - passthrough errors
        logger.exception(
            "Unexpected error exporting history for constitution '%s' (session: %s, start: %s)",
            name,
            session_id or "current",
            start,
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)
        )


@app.get("/api/constitutions/{name}/agent/sessions")
def constitution_agent_sessions(
    name: str,
    limit: int = Query(default=10, ge=1, le=50),
):
    try:
        logger.info(
            "Listing agent sessions for constitution '%s' (limit: %s)", name, limit
        )
        return {"sessions": list_chat_sessions(f"constitution:{name}", limit)}
    except Exception as exc:  # pragma: no cover - passthrough errors
        logger.exception(
            "Unexpected error listing sessions for constitution '%s' (limit: %s)",
            name,
            limit,
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)
        )


@app.get("/api/tasks")
def tasks():
    try:
        logger.info("Listing tasks")
        return {"tasks": list_tasks()}
    except Exception as exc:
        logger.exception("Failed to list tasks")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)
        )


@app.get("/api/tasks/{name}")
def task_item(name: str):
    try:
        logger.info("Reading task '%s'", name)
        return read_task(name)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))


@app.put("/api/tasks/{name}")
def task_write(name: str, payload: dict = Body(...)):
    try:
        logger.info("Updating task '%s'", name)
        write_task(name, payload.get("frontmatter", {}), payload.get("content", ""))
        return {"success": True}
    except Exception as exc:
        logger.exception("Failed to update task '%s'", name)
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))


@app.get("/api/repositories/{name}/agent/history")
def repository_agent_history(
    name: str,
    session_id: str | None = Query(default=None),
    start: int | str | None = Query(default=None),
):
    try:
        normalized_start = int(start) if start is not None else None
        logger.info(
            "Exporting agent history for repository '%s' (session: %s, start: %s)",
            name,
            session_id or "current",
            start,
        )
        return export_chat_history(session_id, normalized_start, name)
    except ValueError as exc:
        logger.warning(
            "Bad request exporting agent history for '%s' (session: %s, start: %s): %s",
            name,
            session_id or "current",
            start,
            exc,
        )
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    except FileNotFoundError as exc:
        logger.warning(
            "Repository '%s' not found while exporting history (session: %s, start: %s)",
            name,
            session_id or "current",
            start,
        )
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    except Exception as exc:  # pragma: no cover - passthrough errors
        logger.exception(
            "Unexpected error exporting history for '%s' (session: %s, start: %s)",
            name,
            session_id or "current",
            start,
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)
        )


@app.get("/api/repositories/{name}/agent/sessions")
def repository_agent_sessions(
    name: str,
    limit: int = Query(default=10, ge=1, le=50),
):
    try:
        logger.info(
            "Listing agent sessions for repository '%s' (limit: %s)", name, limit
        )
        return {"sessions": list_chat_sessions(name, limit)}
    except Exception as exc:  # pragma: no cover - passthrough errors
        logger.exception(
            "Unexpected error listing sessions for '%s' (limit: %s)", name, limit
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)
        )


@app.get("/api/settings")
def settings_read():
    try:
        logger.info("Reading settings")
        return read_settings()
    except Exception as exc:
        logger.exception("Failed to read settings")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)
        )


@app.put("/api/settings")
def settings_write(payload: dict = Body(...)):
    try:
        logger.info("Writing settings update")
        return write_settings(payload)
    except Exception as exc:
        logger.exception("Failed to write settings")
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))


@app.post("/api/bootstrap")
def bootstrap():
    try:
        logger.info("Bootstrapping MADE workspace structure")
        ensure_made_structure()
        return {"success": True}
    except Exception as exc:
        logger.exception("Bootstrap failed")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)
        )


def start():
    import uvicorn

    host = get_backend_host()
    port = get_backend_port()
    logger.info("Starting MADE backend on %s:%s", host, port)

    log_config = deepcopy(LOGGING_CONFIG)
    log_config["formatters"]["default"]["fmt"] = COLOR_LOG_FORMAT
    log_config["formatters"]["access"]["fmt"] = (
        '%(asctime)s %(levelprefix)s [%(name)s] %(client_addr)s - "%(request_line)s" %(status_code)s'
    )
    log_config["formatters"]["access"]["use_colors"] = True
    log_config["formatters"]["default"]["use_colors"] = True

    uvicorn.run(
        "app:app",
        host=host,
        port=port,
        log_config=log_config,
    )


def main():
    """Entry point for the made-backend script."""
    # Ensure MADE directory structure exists
    logger.info("Initializing MADE backend")
    ensure_made_structure()
    start()


if __name__ == "__main__":
    main()
