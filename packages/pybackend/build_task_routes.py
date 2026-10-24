"""Repository-scoped Build & Tasks API."""

import logging
from collections.abc import Callable

from fastapi import APIRouter, Body, HTTPException, Query
from pydantic import ValidationError

from build_task_discovery import discover_build_tasks
from build_task_service import RunRequest, list_runs, read_run, start_run

router = APIRouter(prefix="/api/repositories/{name}/build-tasks")
logger = logging.getLogger("made.pybackend.build_tasks")


def _respond(operation: Callable[[], dict]) -> dict:
    try:
        return operation()
    except FileNotFoundError as error:
        raise HTTPException(404, str(error)) from error
    except ValidationError as error:
        raise HTTPException(
            400,
            "Invalid build run request: file, target and string parameters required",
        ) from error
    except ValueError as error:
        raise HTTPException(400, str(error)) from error
    except OSError as error:
        logger.exception("Build task filesystem operation failed")
        raise HTTPException(
            500, "Cannot access build run files; check backend permissions"
        ) from error


@router.get("")
def discovery(name: str) -> dict:
    return _respond(lambda: discover_build_tasks(name))


@router.post("/runs")
def launch(name: str, payload: dict = Body(...)) -> dict:
    return _respond(lambda: start_run(name, RunRequest.model_validate(payload)))


@router.get("/runs")
def history(name: str, limit: int = Query(default=10, ge=1, le=50)) -> dict:
    return _respond(lambda: list_runs(name, limit))


@router.get("/runs/{run_id}")
def detail(name: str, run_id: str) -> dict:
    return _respond(lambda: read_run(name, run_id))
