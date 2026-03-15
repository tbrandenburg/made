from __future__ import annotations

import logging
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock, Thread

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger

from config import get_workspace_home
from workflow_service import read_workflows

logger = logging.getLogger("made.pybackend.cron")

_scheduler: BackgroundScheduler | None = None
_state_lock = Lock()
_started_jobs = 0
_successful_jobs = 0
_failed_jobs = 0
_configured_jobs = 0
_invalid_jobs = 0
_started_at: datetime | None = None
_last_run_by_job: dict[str, datetime] = {}
_last_finished_by_job: dict[str, datetime] = {}
_last_duration_ms_by_job: dict[str, int] = {}
_last_exit_code_by_job: dict[str, int] = {}
_last_error_by_job: dict[str, str] = {}
_running_process_by_job: dict[str, subprocess.Popen[str]] = {}


def _terminate_running_job(workflow_id: str) -> None:
    running_process = _running_process_by_job.get(workflow_id)
    if running_process is None or running_process.poll() is not None:
        return

    logger.info("Stopping previous cron workflow run for '%s'", workflow_id)
    running_process.terminate()
    try:
        running_process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        logger.warning("Force killing previous cron workflow run for '%s'", workflow_id)
        running_process.kill()
        running_process.wait(timeout=5)


def _resolve_script_path(repo_path: Path, shell_script_path: str) -> Path:
    script_path = Path(shell_script_path)
    if script_path.is_absolute():
        return script_path
    return repo_path / script_path


def _wait_for_workflow_process(
    workflow_id: str,
    process: subprocess.Popen[str],
    started_at: datetime,
) -> None:
    global _successful_jobs, _failed_jobs

    stdout, stderr = process.communicate()
    returncode = process.returncode
    finished_at = datetime.now(timezone.utc)
    duration_ms = int((finished_at - started_at).total_seconds() * 1000)

    with _state_lock:
        if _running_process_by_job.get(workflow_id) is process:
            _running_process_by_job.pop(workflow_id, None)
        _last_finished_by_job[workflow_id] = finished_at
        _last_duration_ms_by_job[workflow_id] = duration_ms
        _last_exit_code_by_job[workflow_id] = returncode

    if returncode == 0:
        with _state_lock:
            _successful_jobs += 1
            _last_error_by_job.pop(workflow_id, None)
        logger.info("Cron workflow '%s' completed", workflow_id)
        if stdout.strip():
            logger.info("Cron workflow '%s' stdout: %s", workflow_id, stdout.strip())
        return

    with _state_lock:
        _failed_jobs += 1

    logger.warning("Cron workflow '%s' failed with exit code %s", workflow_id, returncode)
    if stdout.strip():
        logger.warning("Cron workflow '%s' stdout: %s", workflow_id, stdout.strip())
    if stderr.strip():
        with _state_lock:
            _last_error_by_job[workflow_id] = stderr.strip()
        logger.warning("Cron workflow '%s' stderr: %s", workflow_id, stderr.strip())
    else:
        with _state_lock:
            _last_error_by_job[workflow_id] = f"Exit code {returncode} without stderr"


def _run_workflow_script(repo_path: Path, workflow_id: str, script_path: Path) -> None:
    global _started_jobs

    started_at = datetime.now(timezone.utc)

    with _state_lock:
        _terminate_running_job(workflow_id)
        _started_jobs += 1
        _last_run_by_job[workflow_id] = datetime.now(timezone.utc)
        process = subprocess.Popen(
            ["bash", str(script_path)],
            cwd=str(repo_path),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        _running_process_by_job[workflow_id] = process

    logger.info("Running cron workflow '%s' in '%s'", workflow_id, repo_path)
    Thread(
        target=_wait_for_workflow_process,
        args=(workflow_id, process, started_at),
        daemon=True,
    ).start()


def start_cron_clock() -> None:
    global _scheduler, _started_jobs, _successful_jobs, _failed_jobs, _configured_jobs, _invalid_jobs, _started_at

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
                logger.warning("Skipping workflow '%s' in '%s': missing schedule", workflow_id, repo_name)
                continue
            if not isinstance(shell_script_path, str) or not shell_script_path.strip():
                logger.warning("Skipping workflow '%s' in '%s': missing shellScriptPath", workflow_id, repo_name)
                continue

            script_path = _resolve_script_path(repo_path, shell_script_path)
            if not script_path.exists() or not script_path.is_file():
                logger.warning(
                    "Skipping workflow '%s' in '%s': script not found at '%s'",
                    workflow_id,
                    repo_name,
                    script_path,
                )
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
                    misfire_grace_time=300,
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
        _failed_jobs = 0
        _configured_jobs = configured_jobs
        _invalid_jobs = invalid_jobs
        _started_at = datetime.now(timezone.utc)
        _last_run_by_job.clear()
        _last_finished_by_job.clear()
        _last_duration_ms_by_job.clear()
        _last_exit_code_by_job.clear()
        _last_error_by_job.clear()
        _running_process_by_job.clear()

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

    with _state_lock:
        for workflow_id in list(_running_process_by_job):
            _terminate_running_job(workflow_id)
            _running_process_by_job.pop(workflow_id, None)

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
        failed_jobs = _failed_jobs
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
        "failedJobsSinceStartup": failed_jobs,
    }


def get_cron_job_last_runs() -> dict[str, str | None]:
    if _scheduler is None:
        return {}

    with _state_lock:
        last_runs = {
            workflow_id: timestamp.isoformat()
            for workflow_id, timestamp in _last_run_by_job.items()
        }

    job_last_runs: dict[str, str | None] = {}
    for job in _scheduler.get_jobs():
        job_last_runs[job.id] = last_runs.get(job.id)

    return job_last_runs


def get_cron_job_diagnostics() -> dict[str, dict[str, object | None]]:
    if _scheduler is None:
        return {}

    with _state_lock:
        last_runs = {
            workflow_id: timestamp.isoformat()
            for workflow_id, timestamp in _last_run_by_job.items()
        }
        finished_runs = {
            workflow_id: timestamp.isoformat()
            for workflow_id, timestamp in _last_finished_by_job.items()
        }
        durations = dict(_last_duration_ms_by_job)
        exit_codes = dict(_last_exit_code_by_job)
        errors = dict(_last_error_by_job)
        running = {
            workflow_id
            for workflow_id, process in _running_process_by_job.items()
            if process.poll() is None
        }

    diagnostics: dict[str, dict[str, object | None]] = {}
    for job in _scheduler.get_jobs():
        next_run_time = None
        if job.next_run_time is not None:
            next_run_time = job.next_run_time.isoformat()

        diagnostics[job.id] = {
            "lastStartedAt": last_runs.get(job.id),
            "lastFinishedAt": finished_runs.get(job.id),
            "lastDurationMs": durations.get(job.id),
            "lastExitCode": exit_codes.get(job.id),
            "lastError": errors.get(job.id),
            "lastStderr": errors.get(job.id),
            "nextRunAt": next_run_time,
            "running": job.id in running,
        }

    return diagnostics
