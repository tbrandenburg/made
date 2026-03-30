from __future__ import annotations

import logging
import shutil
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock, Thread

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger

from agent_service import get_agent_cli
from config import get_workspace_home
from task_service import get_tasks_directory, list_scheduled_tasks, read_task
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
_last_stdout_by_job: dict[str, str] = {}
_last_stderr_by_job: dict[str, str] = {}
_running_process_by_job: dict[str, subprocess.Popen[str]] = {}
_job_start_times: dict[str, datetime] = {}

DEFAULT_MAX_RUNTIME_MINUTES = 120  # 2 hours default
_workflow_max_runtime: dict[str, int] = {}
WORKFLOW_LOG_PREFIX = "made-"
WORKFLOW_LOG_LOCATIONS: dict[str, Path] = {
    "var": Path("/var/log"),
    "tmp": Path("/tmp/made-harness-logs"),
}


def _terminate_running_job_unlocked(workflow_id: str) -> None:
    """Internal version that assumes _state_lock is already held."""
    running_process = _running_process_by_job.get(workflow_id)
    if running_process is None or running_process.poll() is not None:
        _running_process_by_job.pop(workflow_id, None)  # Clean stale entries
        return

    # Terminate outside lock to avoid blocking
    logger.info("Stopping previous cron workflow run for '%s'", workflow_id)
    running_process.terminate()

    try:
        running_process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        logger.warning("Force killing previous cron workflow run for '%s'", workflow_id)
        try:
            running_process.kill()
            running_process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            logger.error("Process '%s' became zombie - continuing anyway", workflow_id)

    # Clean up tracking (already under lock)
    _running_process_by_job.pop(workflow_id, None)


def _terminate_running_job(workflow_id: str) -> None:
    # Get process reference under lock
    with _state_lock:
        _terminate_running_job_unlocked(workflow_id)


def _resolve_script_path(repo_path: Path, shell_script_path: str) -> Path:
    script_path = Path(shell_script_path)
    if script_path.is_absolute():
        return script_path
    return repo_path / script_path


def _build_agent_cli_command(prompt: str) -> list[str]:
    agent_cli = get_agent_cli()
    return agent_cli.build_prompt_command(prompt)


def _uses_stdin_prompt() -> bool:
    return get_agent_cli().prompt_via_stdin()


def _resolve_executable(command: list[str]) -> list[str]:
    if not command:
        raise ValueError("Empty command")

    executable = command[0]
    resolved = shutil.which(executable)
    if resolved is None:
        raise FileNotFoundError(f"Executable not found: {executable}")
    return [resolved, *command[1:]]


def _tail_output(value: str, max_lines: int = 20) -> str:
    lines = [line for line in value.strip().splitlines() if line.strip()]
    if not lines:
        return ""
    return "\n".join(lines[-max_lines:])


def _is_workflow_log_file(file_path: Path) -> bool:
    return (
        file_path.is_file()
        and file_path.name.startswith(WORKFLOW_LOG_PREFIX)
        and file_path.suffix == ".log"
    )


def _validate_log_name(log_name: str) -> bool:
    return (
        bool(log_name)
        and "/" not in log_name
        and "\\" not in log_name
        and log_name.startswith(WORKFLOW_LOG_PREFIX)
        and log_name.endswith(".log")
    )


def list_workflow_logs() -> list[dict[str, object]]:
    log_files: list[tuple[float, dict[str, object]]] = []
    for location, log_dir in WORKFLOW_LOG_LOCATIONS.items():
        if not log_dir.exists() or not log_dir.is_dir():
            continue
        for file_path in log_dir.iterdir():
            if not _is_workflow_log_file(file_path):
                continue
            stat = file_path.stat()
            modified_at = datetime.fromtimestamp(stat.st_mtime, timezone.utc)
            log_files.append(
                (
                    stat.st_mtime,
                    {
                        "name": file_path.name,
                        "location": location,
                        "path": str(file_path),
                        "sizeBytes": stat.st_size,
                        "modifiedAt": modified_at.isoformat(),
                    },
                )
            )

    return [
        entry for _, entry in sorted(log_files, key=lambda item: item[0], reverse=True)
    ]


def read_workflow_log_tail(
    location: str, log_name: str, max_lines: int = 20
) -> dict[str, object]:
    log_dir = WORKFLOW_LOG_LOCATIONS.get(location)
    if log_dir is None:
        raise FileNotFoundError("Unknown log location")
    if not _validate_log_name(log_name):
        raise FileNotFoundError("Invalid log filename")

    file_path = log_dir / log_name
    if not file_path.exists() or not file_path.is_file():
        raise FileNotFoundError("Workflow log file not found")

    content = file_path.read_text(encoding="utf-8", errors="replace")
    return {
        "name": log_name,
        "location": location,
        "path": str(file_path),
        "tail": _tail_output(content, max_lines=max_lines),
    }


def _monitor_job_timeouts() -> None:
    """Periodically check for jobs exceeding runtime limits."""
    current_time = datetime.now(timezone.utc)
    with _state_lock:
        for workflow_id, start_time in list(_job_start_times.items()):
            if workflow_id in _running_process_by_job:
                runtime_minutes = (current_time - start_time).total_seconds() / 60
                max_runtime = _workflow_max_runtime.get(
                    workflow_id, DEFAULT_MAX_RUNTIME_MINUTES
                )
                if runtime_minutes > max_runtime:
                    logger.warning(
                        "Job '%s' exceeded %d min limit, terminating",
                        workflow_id,
                        max_runtime,
                    )
                    _terminate_running_job_unlocked(workflow_id)


def _wait_for_workflow_process(
    workflow_id: str,
    process: subprocess.Popen[str],
    started_at: datetime,
    stdin_input: str | None = None,
) -> None:
    global _successful_jobs, _failed_jobs

    try:
        stdout, stderr = process.communicate(input=stdin_input)
    except ValueError:
        # Defensive fallback: stdin may already be closed by another thread/process
        # which makes communicate() attempt to flush a closed stream.
        logger.warning(
            "Cron workflow '%s' had closed stdin before communicate(); falling back to wait/read",
            workflow_id,
        )
        process.wait()
        stdout = process.stdout.read() if process.stdout is not None else ""
        stderr = process.stderr.read() if process.stderr is not None else ""
    stdout_tail = _tail_output(stdout)
    stderr_tail = _tail_output(stderr)
    returncode = process.returncode
    finished_at = datetime.now(timezone.utc)
    duration_ms = int((finished_at - started_at).total_seconds() * 1000)

    with _state_lock:
        if _running_process_by_job.get(workflow_id) is process:
            _running_process_by_job.pop(workflow_id, None)
        _job_start_times.pop(workflow_id, None)
        _last_finished_by_job[workflow_id] = finished_at
        _last_duration_ms_by_job[workflow_id] = duration_ms
        _last_exit_code_by_job[workflow_id] = returncode
        if stdout_tail:
            _last_stdout_by_job[workflow_id] = stdout_tail
        else:
            _last_stdout_by_job.pop(workflow_id, None)
        if stderr_tail:
            _last_stderr_by_job[workflow_id] = stderr_tail
        else:
            _last_stderr_by_job.pop(workflow_id, None)

    if returncode == 0:
        with _state_lock:
            _successful_jobs += 1
            _last_error_by_job.pop(workflow_id, None)
        logger.info("Cron workflow '%s' completed", workflow_id)
        if stdout_tail:
            logger.info("Cron workflow '%s' stdout: %s", workflow_id, stdout_tail)
        return

    with _state_lock:
        _failed_jobs += 1

    logger.warning(
        "Cron workflow '%s' failed with exit code %s", workflow_id, returncode
    )
    if stdout_tail:
        logger.warning("Cron workflow '%s' stdout: %s", workflow_id, stdout_tail)
    if stderr_tail:
        with _state_lock:
            _last_error_by_job[workflow_id] = stderr_tail
        logger.warning("Cron workflow '%s' stderr: %s", workflow_id, stderr_tail)
    else:
        with _state_lock:
            _last_error_by_job[workflow_id] = f"Exit code {returncode} without stderr"


def _run_workflow_script(repo_path: Path, workflow_id: str, script_path: Path) -> None:
    global _started_jobs

    started_at = datetime.now(timezone.utc)

    with _state_lock:
        _terminate_running_job_unlocked(workflow_id)
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
        _job_start_times[workflow_id] = started_at

    logger.info("Running cron workflow '%s' in '%s'", workflow_id, repo_path)
    Thread(
        target=_wait_for_workflow_process,
        args=(workflow_id, process, started_at),
        daemon=True,
    ).start()


def _run_scheduled_task(task_id: str, task_file_name: str) -> None:
    global _started_jobs, _failed_jobs

    started_at = datetime.now(timezone.utc)
    tasks_directory = get_tasks_directory()
    task_data = read_task(task_file_name)
    prompt = str(task_data.get("content") or "").strip()
    if not prompt:
        prompt = f"Follow the instructions in `{task_file_name}`"
    command = _build_agent_cli_command(prompt)
    use_stdin_prompt = _uses_stdin_prompt()
    try:
        command = _resolve_executable(command)
    except (ValueError, FileNotFoundError) as exc:
        with _state_lock:
            _started_jobs += 1
            _failed_jobs += 1
            _last_run_by_job[task_id] = datetime.now(timezone.utc)
            _last_finished_by_job[task_id] = datetime.now(timezone.utc)
            _last_error_by_job[task_id] = str(exc)
        logger.warning("Skipping scheduled task '%s': %s", task_id, exc)
        return

    popen_kwargs: dict[str, object] = {
        "cwd": str(tasks_directory),
        "stdout": subprocess.PIPE,
        "stderr": subprocess.PIPE,
        "text": True,
    }
    if use_stdin_prompt:
        popen_kwargs["stdin"] = subprocess.PIPE

    with _state_lock:
        _terminate_running_job_unlocked(task_id)
        _started_jobs += 1
        _last_run_by_job[task_id] = datetime.now(timezone.utc)
        process = subprocess.Popen(command, **popen_kwargs)  # type: ignore[arg-type]
        _running_process_by_job[task_id] = process
        _job_start_times[task_id] = started_at

    logger.info("Running scheduled task '%s' in '%s'", task_id, tasks_directory)
    stdin_input = prompt if use_stdin_prompt else None
    Thread(
        target=_wait_for_workflow_process,
        args=(task_id, process, started_at, stdin_input),
        daemon=True,
    ).start()


def start_cron_clock() -> None:
    global \
        _scheduler, \
        _started_jobs, \
        _successful_jobs, \
        _failed_jobs, \
        _configured_jobs, \
        _invalid_jobs, \
        _started_at

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
                logger.warning(
                    "Skipping workflow '%s' in '%s': missing schedule",
                    workflow_id,
                    repo_name,
                )
                continue
            if not isinstance(shell_script_path, str) or not shell_script_path.strip():
                logger.warning(
                    "Skipping workflow '%s' in '%s': missing shellScriptPath",
                    workflow_id,
                    repo_name,
                )
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

            # Configure runtime limits
            max_runtime = workflow.get("maxRuntimeMinutes", DEFAULT_MAX_RUNTIME_MINUTES)
            if max_runtime:
                _workflow_max_runtime[job_id] = max_runtime

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

    for task in list_scheduled_tasks():
        task_name = str(task.get("name") or "task.md")
        schedule = str(task.get("schedule") or "").strip()
        job_id = f"task:{task_name}"

        try:
            scheduler.add_job(
                _run_scheduled_task,
                CronTrigger.from_crontab(schedule),
                id=job_id,
                replace_existing=True,
                max_instances=1,
                coalesce=True,
                misfire_grace_time=300,
                args=[job_id, task_name],
            )
            configured_jobs += 1
        except ValueError:
            invalid_jobs += 1
            logger.warning("Skipping task '%s': invalid cron '%s'", task_name, schedule)

    scheduler.start()
    _scheduler = scheduler

    # Start job timeout monitor
    scheduler.add_job(
        _monitor_job_timeouts,
        "interval",
        minutes=1,
        id="_job_timeout_monitor",
        replace_existing=True,
    )

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
        _last_stdout_by_job.clear()
        _last_stderr_by_job.clear()
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

    # Wait for all scheduled jobs (including timeout monitor) to complete
    # before acquiring locks to prevent deadlock
    _scheduler.shutdown(wait=True)

    with _state_lock:
        for workflow_id in list(_running_process_by_job):
            _terminate_running_job_unlocked(workflow_id)
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
        stdout_by_job = dict(_last_stdout_by_job)
        stderr_by_job = dict(_last_stderr_by_job)
        start_times = dict(_job_start_times)
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

        runtime_minutes = None
        if job.id in start_times and job.id in running:
            runtime_minutes = int(
                (datetime.now(timezone.utc) - start_times[job.id]).total_seconds() / 60
            )

        diagnostics[job.id] = {
            "lastStartedAt": last_runs.get(job.id),
            "lastFinishedAt": finished_runs.get(job.id),
            "lastDurationMs": durations.get(job.id),
            "lastExitCode": exit_codes.get(job.id),
            "lastError": errors.get(job.id),
            "lastStdout": stdout_by_job.get(job.id),
            "lastStderr": stderr_by_job.get(job.id),
            "nextRunAt": next_run_time,
            "running": job.id in running,
            "runtimeMinutes": runtime_minutes,
        }

    return diagnostics


def force_terminate_job(workflow_id: str) -> bool:
    """Admin function to manually terminate a job."""
    with _state_lock:
        if workflow_id not in _running_process_by_job:
            return False

    _terminate_running_job(workflow_id)
    return True


def get_long_running_jobs(threshold_minutes: int = 60) -> list[dict]:
    """Get jobs running longer than threshold."""
    current_time = datetime.now(timezone.utc)
    long_running = []

    with _state_lock:
        for workflow_id, start_time in _job_start_times.items():
            if workflow_id in _running_process_by_job:
                runtime = (current_time - start_time).total_seconds() / 60
                if runtime > threshold_minutes:
                    long_running.append(
                        {
                            "workflow_id": workflow_id,
                            "runtime_minutes": int(runtime),
                            "started_at": start_time.isoformat(),
                        }
                    )

    return long_running
