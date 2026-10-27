"""Bounded, process-local tracking; not a durable queue or multi-worker service."""

from dataclasses import dataclass, field, replace
from threading import Lock
from time import monotonic
from typing import Literal
from uuid import uuid4

from agent_service import (
    MessageReservation,
    release_agent_message,
    reserve_agent_message,
    send_agent_message,
)

MAX_PENDING = 8  # Leave headroom in Starlette's shared default 40-token pool.
MAX_RECORDS = 128
RETENTION_SECONDS = 900
_lock = Lock()


class SubmissionCapacityError(RuntimeError):
    """Admission is temporarily full."""


@dataclass(frozen=True)
class Submission:
    id: str
    repository: str
    state: Literal["queued", "running", "succeeded", "failed"] = "queued"
    session_id: str | None = None
    error: Literal["execution", "scheduling", "cancelled"] | None = None
    accepted: float = field(default_factory=monotonic)
    started: float | None = None
    completed: float | None = None


_submissions: dict[str, Submission] = {}


def valid_session_id(session: object) -> bool:
    return (
        isinstance(session, str)
        and 0 < len(session) <= 512
        and session.isascii()
        and all(32 <= ord(char) < 127 for char in session)
    )


def _prune() -> None:
    now = monotonic()
    for key, job in list(_submissions.items()):
        if job.completed is not None and now - job.completed >= RETENTION_SECONDS:
            _submissions.pop(key)
    completed = sorted(
        (job for job in _submissions.values() if job.completed is not None),
        key=lambda job: job.completed or 0,
    )
    for job in completed[: max(0, len(_submissions) - MAX_RECORDS)]:
        _submissions.pop(job.id)


def accept_submission(
    repository: str, session_id: str | None
) -> tuple[Submission, MessageReservation]:
    with _lock:
        _prune()
        pending = sum(job.completed is None for job in _submissions.values())
        if pending >= MAX_PENDING:
            raise SubmissionCapacityError()
        owner = reserve_agent_message(repository, session_id)
        try:
            job = Submission(str(uuid4()), repository)
            _submissions[job.id] = job
            _prune()
            return job, owner
        except BaseException:
            release_agent_message(owner)
            raise


def get_submission(repository: str, job_id: str) -> Submission | None:
    with _lock:
        _prune()
        job = _submissions.get(job_id)
        return job if job is not None and job.repository == repository else None


def fail_scheduling(job: Submission, owner: MessageReservation) -> None:
    release_agent_message(owner)
    with _lock:
        _submissions[job.id] = replace(
            job, state="failed", error="scheduling", completed=monotonic()
        )
        _prune()


def run_submission(
    job: Submission,
    owner: MessageReservation,
    message: str,
    session_id: str | None,
    agent: str | None,
    model: str | None,
) -> None:
    with _lock:
        current = _submissions.get(job.id)
        if current is None or current.state != "queued":
            return
        running = replace(job, state="running", started=monotonic())
        _submissions[job.id] = running
    completed = replace(running, state="failed", error="execution")
    try:
        result = send_agent_message(
            job.repository, message, session_id, agent, model, reservation=owner
        )
        session = result.get("sessionId")
        if result.get("outcome") == "succeeded" and valid_session_id(session):
            completed = replace(running, state="succeeded", session_id=session)
        elif result.get("outcome") == "cancelled":
            completed = replace(running, state="failed", error="cancelled")
    except Exception:
        # Never retain/log raw adapter exceptions, prompts or CLI output.
        completed = replace(running, state="failed", error="execution")
    finally:
        release_agent_message(owner)
        with _lock:
            _submissions[job.id] = replace(completed, completed=monotonic())
            _prune()
