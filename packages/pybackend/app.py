from fastapi import Body, FastAPI, HTTPException, Query, status
from fastapi.middleware.cors import CORSMiddleware

from agent_service import ChannelBusyError, get_channel_status, send_agent_message
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
    ensure_made_structure,
    get_made_directory,
    get_workspace_home,
    get_backend_host,
    get_backend_port,
)

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
        return get_dashboard_summary()
    except Exception as exc:  # pragma: no cover - passthrough errors
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)
        )


@app.get("/api/repositories")
def repositories():
    try:
        return {"repositories": list_repositories()}
    except Exception as exc:
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
        return create_repository(name)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))


@app.post("/api/repositories/clone", status_code=status.HTTP_201_CREATED)
def clone_repo(payload: dict = Body(...)):
    repo_url = payload.get("url")
    if not repo_url:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Repository URL is required",
        )
    try:
        return clone_repository(repo_url)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))


@app.get("/api/repositories/{name}")
def repository_info(name: str):
    try:
        return get_repository_info(name)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))


@app.get("/api/repositories/{name}/files")
def repository_files(name: str):
    try:
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
        write_repository_file(name, file_path, payload.get("content", ""))
        return {"success": True}
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))


@app.post("/api/repositories/{name}/file", status_code=status.HTTP_201_CREATED)
def create_repository_file_endpoint(name: str, payload: dict = Body(...)):
    file_path = payload.get("path")
    if not file_path:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="File path is required"
        )
    try:
        create_repository_file(name, file_path, payload.get("content", ""))
        return {"success": True}
    except Exception as exc:
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
        rename_repository_file(name, old, new)
        return {"success": True}
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))


@app.delete("/api/repositories/{name}/file")
def delete_repository_file_endpoint(name: str, payload: dict = Body(...)):
    file_path = payload.get("path")
    if not file_path:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="File path is required"
        )
    try:
        delete_repository_file(name, file_path)
        return {"success": True}
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))


@app.post("/api/repositories/{name}/agent")
def repository_agent(name: str, payload: dict = Body(...)):
    message = payload.get("message")
    if not message:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Message is required"
        )
    try:
        return send_agent_message(name, message)
    except ChannelBusyError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc))


@app.get("/api/repositories/{name}/agent/status")
def repository_agent_status(name: str):
    return get_channel_status(name)


@app.get("/api/repositories/{name}/commands")
def repository_commands(name: str):
    try:
        return {"commands": list_commands(name)}
    except Exception as exc:  # pragma: no cover - passthrough errors
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)
        )


@app.get("/api/knowledge")
def knowledge_list():
    try:
        return {"artefacts": list_knowledge_artefacts()}
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)
        )


@app.get("/api/knowledge/{name}")
def knowledge_item(name: str):
    try:
        return read_knowledge_artefact(name)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))


@app.put("/api/knowledge/{name}")
def knowledge_write(name: str, payload: dict = Body(...)):
    try:
        write_knowledge_artefact(
            name, payload.get("frontmatter", {}), payload.get("content", "")
        )
        return {"success": True}
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))


@app.post("/api/knowledge/{name}/agent")
def knowledge_agent(name: str, payload: dict = Body(...)):
    message = payload.get("message")
    if not message:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Message is required"
        )
    try:
        return send_agent_message(f"knowledge:{name}", message)
    except ChannelBusyError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc))


@app.get("/api/knowledge/{name}/agent/status")
def knowledge_agent_status(name: str):
    return get_channel_status(f"knowledge:{name}")


@app.get("/api/constitutions")
def constitutions():
    try:
        return {"constitutions": list_constitutions()}
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)
        )


@app.get("/api/constitutions/{name}")
def constitution_item(name: str):
    try:
        return read_constitution(name)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))


@app.put("/api/constitutions/{name}")
def constitution_write(name: str, payload: dict = Body(...)):
    try:
        write_constitution(
            name, payload.get("frontmatter", {}), payload.get("content", "")
        )
        return {"success": True}
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))


@app.post("/api/constitutions/{name}/agent")
def constitution_agent(name: str, payload: dict = Body(...)):
    message = payload.get("message")
    if not message:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Message is required"
        )
    try:
        return send_agent_message(f"constitution:{name}", message)
    except ChannelBusyError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc))


@app.get("/api/constitutions/{name}/agent/status")
def constitution_agent_status(name: str):
    return get_channel_status(f"constitution:{name}")


@app.get("/api/settings")
def settings_read():
    try:
        return read_settings()
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)
        )


@app.put("/api/settings")
def settings_write(payload: dict = Body(...)):
    try:
        return write_settings(payload)
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))


@app.post("/api/bootstrap")
def bootstrap():
    try:
        ensure_made_structure()
        return {"success": True}
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)
        )


def start():
    import uvicorn

    uvicorn.run(
        "app:app",
        host=get_backend_host(),
        port=get_backend_port(),
    )


def main():
    """Entry point for the made-backend script."""
    # Ensure MADE directory structure exists
    ensure_made_structure()
    start()


if __name__ == "__main__":
    main()
