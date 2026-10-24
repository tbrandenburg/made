"""Explicit user-initiated Make/Task processes, supervised independently of PID reuse."""

from heapq import nlargest
from contextlib import suppress
import logging
import os
import stat
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock, Thread
from time import monotonic
from uuid import uuid4
from typing import Literal

from pydantic import BaseModel

from build_task_discovery import repository_path
from build_task_dispatch import RunRequest, prepare_run
from run_log_service import bounded_tail, scoped_log_directory

logger = logging.getLogger("made.pybackend.build_tasks")
_active: set[tuple[str, str]] = set()
_lock = Lock()


class Run(BaseModel):
    runId: str
    pid: int
    repository: str
    file: str
    kind: Literal["make", "task"]
    target: str
    startedAt: str
    finishedAt: str | None = None
    durationMs: int | None = None
    status: Literal["running", "succeeded", "failed", "unknown"] = "running"
    exitCode: int | None = None
    logLocation: str
    logName: str


def _persist(directory: int, run: Run) -> None:
    temporary = f".build-task-{run.runId}-{uuid4().hex}.tmp"
    descriptor = os.open(
        temporary,
        os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
        0o600,
        dir_fd=directory,
    )
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
            stream.write(run.model_dump_json())
        os.replace(
            temporary,
            f"build-task-{run.runId}.json",
            src_dir_fd=directory,
            dst_dir_fd=directory,
        )
    finally:
        with suppress(FileNotFoundError):
            os.unlink(temporary, dir_fd=directory)


def _wait(
    process: subprocess.Popen, root: Path, directory: int, run: Run, started: float
) -> None:
    try:
        code = process.wait()
        run.exitCode = code
        run.status = "succeeded" if code == 0 else "failed"
        run.finishedAt = datetime.now(timezone.utc).isoformat()
        run.durationMs = int((monotonic() - started) * 1000)
        try:
            descriptor = os.open(
                run.logName,
                os.O_WRONLY | os.O_APPEND | os.O_NOFOLLOW | os.O_NONBLOCK,
                dir_fd=directory,
            )
            with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
                if not stat.S_ISREG(os.fstat(stream.fileno()).st_mode):
                    raise OSError("Log is not a regular file")
                stream.write(
                    f"\nMADE finish {run.finishedAt} run={run.runId} pid={run.pid} status={run.status} durationMs={run.durationMs} exitCode={code}\n"
                )
        except OSError:
            logger.warning("Build task output unavailable run=%s", run.runId)
        _persist(directory, run)
        logger.info(
            "Build task finished repo=%s file=%s target=%s run=%s pid=%s finishedAt=%s status=%s durationMs=%s exitCode=%s",
            run.repository,
            run.file,
            run.target,
            run.runId,
            run.pid,
            run.finishedAt,
            run.status,
            run.durationMs,
            code,
        )
    except OSError:
        logger.exception("Build task completion persistence failed run=%s", run.runId)
    finally:
        os.close(directory)
        with _lock:
            _active.discard((str(root), run.runId))


def start_run(name: str, request: RunRequest) -> dict:
    path, entry, argv = prepare_run(name, request)
    root = repository_path(name)
    with scoped_log_directory(root, create=True) as directory:
        return _start_run(name, request, path, entry, argv, root, directory)


def _start_run(
    name: str,
    request: RunRequest,
    path: Path,
    entry: dict,
    argv: list[str],
    root: Path,
    directory: int,
) -> dict:
    run_id = uuid4().hex
    log_name = f"build-task-{run_id}.log"
    descriptor = os.open(
        log_name,
        os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_APPEND | os.O_NOFOLLOW,
        0o600,
        dir_fd=directory,
    )
    started = monotonic()
    with os.fdopen(descriptor, "wb", buffering=0) as output:
        timestamp = datetime.now(timezone.utc).isoformat()
        output.write(
            f"MADE start {timestamp} repo={name} file={request.file} target={request.target} run={run_id} cwd={path.parent.relative_to(root).as_posix()}\n".encode()
        )
        try:
            process = subprocess.Popen(
                argv,
                cwd=path.parent,
                shell=False,
                stdin=subprocess.DEVNULL,
                stdout=output,
                stderr=subprocess.STDOUT,
                start_new_session=True,
            )
        except OSError as error:
            logger.warning("Build task launch failed repo=%s run=%s", name, run_id)
            raise ValueError(
                "Unable to start build tool; check backend installation and file permissions"
            ) from error
        run = Run(
            runId=run_id,
            pid=process.pid,
            repository=name,
            file=request.file,
            kind=entry["kind"],
            target=request.target,
            startedAt=timestamp,
            logLocation=name,
            logName=log_name,
        )
        output.write(f"MADE process run={run_id} pid={process.pid}\n".encode())
    # Supervise even if persisting the initial record fails; never leave an unreaped child.
    with _lock:
        _active.add((str(root), run_id))
    try:
        _persist(directory, run)
    finally:
        Thread(
            target=_wait,
            args=(process, root, os.dup(directory), run.model_copy(), started),
            daemon=True,
        ).start()
    logger.info(
        "Build task started repo=%s file=%s target=%s run=%s pid=%s startedAt=%s",
        name,
        request.file,
        request.target,
        run_id,
        process.pid,
        timestamp,
    )
    return run.model_dump()


def read_run(name: str, run_id: str, include_tail: bool = True) -> dict:
    root = repository_path(name)
    with scoped_log_directory(root) as directory:
        return _read_run(name, run_id, root, directory, include_tail)


def _read_run(
    name: str, run_id: str, root: Path, directory: int, include_tail: bool
) -> dict:
    if len(run_id) != 32 or any(c not in "0123456789abcdef" for c in run_id):
        raise FileNotFoundError("Run not found")
    # Snapshot ownership before opening metadata: completion persists before dropping
    # ownership. Reading an old record then checking ownership can falsely be unknown.
    with _lock:
        active = (str(root), run_id) in _active
    try:
        descriptor = os.open(
            f"build-task-{run_id}.json",
            os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK,
            dir_fd=directory,
        )
        with os.fdopen(descriptor, "rb") as stream:
            if not stat.S_ISREG(os.fstat(stream.fileno()).st_mode):
                raise FileNotFoundError("Run record is not a regular file")
            run = Run.model_validate_json(stream.read(16384))
    except (OSError, ValueError) as error:
        raise FileNotFoundError("Run record unavailable") from error
    if (
        run.runId != run_id
        or run.repository != name
        or run.logName != f"build-task-{run_id}.log"
    ):
        raise FileNotFoundError("Invalid run record")
    if run.status == "running" and not active:
        # Never attribute an unowned PID after restart, even if it happens to exist.
        run.status = "unknown"
    result = run.model_dump()
    if include_tail:
        try:
            result["tail"] = bounded_tail(Path(run.logName), directory=directory)
        except OSError:
            result["tail"] = (
                "Output unavailable: the run log is missing or cannot be read. Run status and exit code are retained."
            )
    return result


def list_runs(name: str, limit: int = 10) -> dict:
    root = repository_path(name)
    try:
        with scoped_log_directory(root) as directory:
            return _list_runs(name, root, directory, limit)
    except FileNotFoundError:
        return {"runs": []}


def _list_runs(name: str, root: Path, directory: int, limit: int) -> dict:
    paths = nlargest(
        50,
        (
            path
            for path in os.listdir(directory)
            if path.startswith("build-task-") and path.endswith(".json")
        ),
        key=lambda path: os.stat(
            path, dir_fd=directory, follow_symlinks=False
        ).st_mtime,
    )
    runs = []
    for path in paths:
        try:
            runs.append(
                _read_run(
                    name,
                    Path(path).stem.removeprefix("build-task-"),
                    root,
                    directory,
                    include_tail=False,
                )
            )
        except FileNotFoundError:
            logger.warning("Ignoring invalid build run record in repo=%s", name)
    return {
        "runs": sorted(runs, key=lambda run: run["startedAt"], reverse=True)[
            : max(1, min(limit, 50))
        ]
    }
