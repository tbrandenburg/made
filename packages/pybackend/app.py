import logging
from copy import deepcopy
from uvicorn.config import LOGGING_CONFIG

from fastapi import Body, FastAPI, HTTPException, Query, status
from fastapi.middleware.cors import CORSMiddleware

from agent_service import (
    ChannelBusyError,
    export_chat_history,
    get_channel_status,
    send_agent_message,
)
from constitution_service import (
    list_constitutions,
    read_constitution,
    write_constitution,
)
from dashboard_service import get_dashboard_summary
from knowledge_service import (
    list_knowledge_artefacts,
    read_knowledge_artefact,
    write_knowledge_artefact,
)
from command_service import list_commands
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
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
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
        return clone_repository(repo_url, target_name)
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
def repository_files(name: str):
    try:
        logger.info("Listing files for repository '%s'", name)
        return list_repository_files(name)
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
    if not message:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Message is required"
        )
    try:
        logger.info(
            "Forwarding agent message for repository '%s' (session: %s)",
            name,
            session_id or "new",
        )
        return send_agent_message(name, message, session_id)
    except ChannelBusyError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc))


@app.get("/api/repositories/{name}/agent/status")
def repository_agent_status(name: str):
    return get_channel_status(name)


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
    if not message:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Message is required"
        )
    try:
        logger.info(
            "Forwarding agent message for knowledge '%s' (session: %s)",
            name,
            session_id or "new",
        )
        return send_agent_message(f"knowledge:{name}", message, session_id)
    except ChannelBusyError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc))


@app.get("/api/knowledge/{name}/agent/status")
def knowledge_agent_status(name: str):
    return get_channel_status(f"knowledge:{name}")


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
    if not message:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Message is required"
        )
    try:
        logger.info(
            "Forwarding agent message for constitution '%s' (session: %s)",
            name,
            session_id or "new",
        )
        return send_agent_message(f"constitution:{name}", message, session_id)
    except ChannelBusyError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc))


@app.get("/api/constitutions/{name}/agent/status")
def constitution_agent_status(name: str):
    return get_channel_status(f"constitution:{name}")


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
    log_config["formatters"]["default"]["fmt"] = (
        "%(asctime)s %(levelprefix)s %(message)s"
    )
    log_config["formatters"]["access"]["fmt"] = (
        '%(asctime)s %(levelprefix)s %(client_addr)s - "%(request_line)s" %(status_code)s'
    )

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
