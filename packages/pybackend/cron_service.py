from __future__ import annotations

import logging
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger

from config import get_workspace_home
from workflow_service import read_workflows

logger = logging.getLogger("made.pybackend.cron")

_scheduler: BackgroundScheduler | None = None
_state_lock = Lock()
_started_jobs = 0
_successful_jobs = 0
_configured_jobs = 0
_invalid_jobs = 0
_started_at: datetime | None = None


def _resolve_script_path(repo_path: Path, shell_script_path: str) -> Path:
    script_path = Path(shell_script_path)
    if script_path.is_absolute():
        return script_path
    return repo_path / script_path


def _run_workflow_script(repo_path: Path, workflow_id: str, script_path: Path) -> None:
    global _started_jobs, _successful_jobs

    with _state_lock:
        _started_jobs += 1

    logger.info("Running cron workflow '%s' in '%s'", workflow_id, repo_path)
    result = subprocess.run(
        ["bash", str(script_path)],
        cwd=str(repo_path),
        capture_output=True,
        text=True,
        check=False,
    )

    if result.returncode == 0:
        with _state_lock:
            _successful_jobs += 1
        logger.info("Cron workflow '%s' completed", workflow_id)
        if result.stdout.strip():
            logger.info("Cron workflow '%s' stdout: %s", workflow_id, result.stdout.strip())
        return

    logger.warning(
        "Cron workflow '%s' failed with exit code %s", workflow_id, result.returncode
    )
    if result.stdout.strip():
        logger.warning("Cron workflow '%s' stdout: %s", workflow_id, result.stdout.strip())
    if result.stderr.strip():
        logger.warning("Cron workflow '%s' stderr: %s", workflow_id, result.stderr.strip())


def start_cron_clock() -> None:
    global _scheduler, _started_jobs, _successful_jobs, _configured_jobs, _invalid_jobs, _started_at

    if _scheduler is not None:
        return

    scheduler = BackgroundScheduler()
    configured_jobs = 0
    invalid_jobs = 0

    for repo_path in get_workspace_home().iterdir():
        if not repo_path.is_dir():
            continue

        repo_name = repo_path.name
        workflows = read_workflows(repo_name).get("workflows", [])
        for workflow in workflows:
            if not workflow.get("enabled"):
                continue

            schedule = workflow.get("schedule")
            shell_script_path = workflow.get("shellScriptPath")
            workflow_id = workflow.get("id") or "workflow"
            if not isinstance(schedule, str) or not schedule.strip():
                continue
            if not isinstance(shell_script_path, str) or not shell_script_path.strip():
                continue

            script_path = _resolve_script_path(repo_path, shell_script_path)
            if not script_path.exists() or not script_path.is_file():
                continue

            job_id = f"{repo_name}:{workflow_id}"
            try:
                scheduler.add_job(
                    _run_workflow_script,
                    CronTrigger.from_crontab(schedule),
                    id=job_id,
                    replace_existing=True,
                    max_instances=1,
                    coalesce=True,
                    args=[repo_path, job_id, script_path],
                )
                configured_jobs += 1
            except ValueError:
                invalid_jobs += 1
                logger.warning(
                    "Skipping workflow '%s' in '%s': invalid cron '%s'",
                    workflow_id,
                    repo_name,
                    schedule,
                )

    scheduler.start()
    _scheduler = scheduler

    with _state_lock:
        _started_jobs = 0
        _successful_jobs = 0
        _configured_jobs = configured_jobs
        _invalid_jobs = invalid_jobs
        _started_at = datetime.now(timezone.utc)

    logger.info(
        "Cron clock started with %s configured jobs (%s invalid schedules)",
        configured_jobs,
        invalid_jobs,
    )


def stop_cron_clock() -> None:
    global _scheduler

    if _scheduler is None:
        return

    _scheduler.shutdown(wait=False)
    _scheduler = None
    logger.info("Cron clock stopped")


def refresh_cron_clock() -> dict[str, object]:
    """Reload cron jobs from workflow definitions and return current status."""
    stop_cron_clock()
    start_cron_clock()
    return get_cron_clock_status()


def get_cron_clock_status() -> dict[str, object]:
    with _state_lock:
        started_jobs = _started_jobs
        successful_jobs = _successful_jobs
        configured_jobs = _configured_jobs
        invalid_jobs = _invalid_jobs
        started_at = _started_at

    running = _scheduler is not None
    if not running:
        traffic_light = "error"
        message = "Cron clock stopped"
    elif configured_jobs == 0:
        traffic_light = "warning"
        message = "No cron jobs configured"
    elif invalid_jobs > 0:
        traffic_light = "warning"
        message = "Cron clock running with invalid schedules"
    else:
        traffic_light = "ok"
        message = "Cron clock running"

    return {
        "running": running,
        "trafficLight": traffic_light,
        "message": message,
        "startedAt": started_at.isoformat() if started_at else None,
        "configuredJobs": configured_jobs,
        "invalidSchedules": invalid_jobs,
        "startedJobsSinceStartup": started_jobs,
        "successfulJobsSinceStartup": successful_jobs,
    }
