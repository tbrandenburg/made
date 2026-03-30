from unittest.mock import MagicMock, patch
from datetime import timedelta
import subprocess

import cron_service


def teardown_function():
    cron_service.stop_cron_clock()
    cron_service._running_process_by_job = {}
    cron_service._last_run_by_job = {}
    cron_service._last_finished_by_job = {}
    cron_service._last_duration_ms_by_job = {}
    cron_service._last_exit_code_by_job = {}
    cron_service._last_error_by_job = {}
    cron_service._last_stdout_by_job = {}
    cron_service._last_stderr_by_job = {}
    cron_service._job_start_times = {}
    cron_service._workflow_max_runtime = {}


@patch("cron_service.CronTrigger.from_crontab")
@patch("cron_service.BackgroundScheduler")
@patch("cron_service.list_scheduled_tasks")
@patch("cron_service.read_workflows")
@patch("cron_service.get_workspace_home")
def test_start_cron_clock_registers_only_enabled_workflows_with_existing_scripts(
    mock_workspace_home,
    mock_read_workflows,
    mock_list_scheduled_tasks,
    mock_scheduler_cls,
    mock_from_crontab,
    tmp_path,
):
    repo = tmp_path / "repo-a"
    repo.mkdir()
    script = repo / ".made" / "build.sh"
    script.parent.mkdir(parents=True)
    script.write_text("echo hi", encoding="utf-8")

    mock_workspace_home.return_value = tmp_path
    mock_list_scheduled_tasks.return_value = []
    mock_read_workflows.return_value = {
        "workflows": [
            {
                "id": "enabled",
                "enabled": True,
                "schedule": "*/5 * * * *",
                "shellScriptPath": ".made/build.sh",
            },
            {
                "id": "disabled",
                "enabled": False,
                "schedule": "*/5 * * * *",
                "shellScriptPath": ".made/build.sh",
            },
            {
                "id": "missing-script",
                "enabled": True,
                "schedule": "*/5 * * * *",
                "shellScriptPath": ".made/missing.sh",
            },
        ]
    }

    mock_scheduler = MagicMock()
    mock_scheduler_cls.return_value = mock_scheduler
    mock_from_crontab.return_value = object()

    cron_service.start_cron_clock()

    # Should add workflow job + timeout monitor job = 2 total
    assert mock_scheduler.add_job.call_count == 2

    # Check that the workflow job was added correctly
    workflow_calls = [
        call
        for call in mock_scheduler.add_job.call_args_list
        if call[1].get("id") == "repo-a:enabled"
    ]
    assert len(workflow_calls) == 1
    kwargs = workflow_calls[0][1]
    assert kwargs["id"] == "repo-a:enabled"
    assert kwargs["max_instances"] == 1
    assert kwargs["args"][0] == repo
    assert kwargs["args"][2] == script

    status = cron_service.get_cron_clock_status()
    assert status["running"] is True
    assert status["configuredJobs"] == 1
    assert status["trafficLight"] == "ok"


@patch("cron_service.BackgroundScheduler")
@patch("cron_service.list_scheduled_tasks")
@patch("cron_service.read_workflows")
@patch("cron_service.get_workspace_home")
def test_start_cron_clock_marks_invalid_cron_as_warning(
    mock_workspace_home,
    mock_read_workflows,
    mock_list_scheduled_tasks,
    mock_scheduler_cls,
    tmp_path,
):
    repo = tmp_path / "repo-a"
    repo.mkdir()
    script = repo / "run.sh"
    script.write_text("echo hi", encoding="utf-8")

    mock_workspace_home.return_value = tmp_path
    mock_list_scheduled_tasks.return_value = []
    mock_read_workflows.return_value = {
        "workflows": [
            {
                "id": "bad",
                "enabled": True,
                "schedule": "not-a-cron",
                "shellScriptPath": "run.sh",
            }
        ]
    }

    mock_scheduler = MagicMock()

    # Only fail for CronTrigger jobs (workflow jobs), not interval jobs (timeout monitor)
    def selective_add_job(*args, **kwargs):
        if (
            len(args) > 1
            and hasattr(args[1], "__class__")
            and "CronTrigger" in str(args[1].__class__)
        ):
            raise ValueError("bad cron")
        return None

    mock_scheduler.add_job.side_effect = selective_add_job
    mock_scheduler_cls.return_value = mock_scheduler

    cron_service.start_cron_clock()

    status = cron_service.get_cron_clock_status()
    assert status["running"] is True
    assert status["configuredJobs"] == 0
    assert status["invalidSchedules"] == 1
    assert status["trafficLight"] == "warning"


@patch("cron_service.subprocess.Popen")
def test_run_workflow_script_executes_from_repository_directory(mock_popen, tmp_path):
    repo = tmp_path / "repo-a"
    repo.mkdir()
    script = repo / ".harness" / "news.sh"
    script.parent.mkdir(parents=True)
    script.write_text("echo hi", encoding="utf-8")

    process = MagicMock()
    process.communicate.return_value = ("ok", "")
    process.returncode = 0
    process.poll.return_value = 0  # Process finished successfully
    mock_popen.return_value = process

    cron_service._run_workflow_script(repo, "repo-a:news", script)

    mock_popen.assert_called_once_with(
        ["bash", str(script)],
        cwd=str(repo),
        stdout=cron_service.subprocess.PIPE,
        stderr=cron_service.subprocess.PIPE,
        text=True,
    )


@patch("cron_service.Thread")
@patch("cron_service.subprocess.Popen")
def test_cron_status_tracks_successful_vs_started_jobs(
    mock_popen, mock_thread, tmp_path
):
    repo = tmp_path / "repo-a"
    repo.mkdir()
    script = repo / ".harness" / "news.sh"
    script.parent.mkdir(parents=True)
    script.write_text("echo hi", encoding="utf-8")

    cron_service._started_jobs = 0
    cron_service._successful_jobs = 0

    def start_thread_immediately(*_args, **kwargs):
        thread = MagicMock()
        target = kwargs["target"]
        args = kwargs.get("args", ())
        thread.start.side_effect = lambda: target(*args)
        return thread

    mock_thread.side_effect = start_thread_immediately

    mock_popen.side_effect = [
        MagicMock(
            communicate=MagicMock(return_value=("ok", "")),
            returncode=0,
            poll=MagicMock(return_value=None),
        ),
        MagicMock(
            communicate=MagicMock(return_value=("", "boom")),
            returncode=1,
            poll=MagicMock(return_value=None),
        ),
        MagicMock(
            communicate=MagicMock(return_value=("", "missing")),
            returncode=127,
            poll=MagicMock(return_value=None),
        ),
    ]

    cron_service._run_workflow_script(repo, "repo-a:news", script)
    cron_service._run_workflow_script(repo, "repo-a:news", script)
    cron_service._run_workflow_script(repo, "repo-a:news", script)

    status = cron_service.get_cron_clock_status()
    assert status["startedJobsSinceStartup"] == 3
    assert status["successfulJobsSinceStartup"] == 1


@patch("cron_service.Thread")
@patch("cron_service.subprocess.Popen")
def test_new_run_terminates_previous_process_for_same_job(
    mock_popen, mock_thread, tmp_path
):
    repo = tmp_path / "repo-a"
    repo.mkdir()
    script = repo / "run.sh"
    script.write_text("echo hi", encoding="utf-8")

    previous_process = MagicMock()
    previous_process.poll.return_value = None

    next_process = MagicMock()
    next_process.communicate.return_value = ("ok", "")
    next_process.returncode = 0
    next_process.poll.return_value = 0  # Process finished successfully

    cron_service._running_process_by_job = {"repo-a:wf": previous_process}
    mock_popen.return_value = next_process

    mock_thread.return_value = MagicMock(start=MagicMock())

    cron_service._run_workflow_script(repo, "repo-a:wf", script)

    previous_process.terminate.assert_called_once_with()
    previous_process.wait.assert_called_once_with(timeout=5)


@patch("cron_service.get_cron_clock_status")
@patch("cron_service.start_cron_clock")
@patch("cron_service.stop_cron_clock")
def test_refresh_cron_clock_reloads_scheduler(
    mock_stop,
    mock_start,
    mock_status,
):
    mock_status.return_value = {"running": True}

    status = cron_service.refresh_cron_clock()

    mock_stop.assert_called_once_with()
    mock_start.assert_called_once_with()
    mock_status.assert_called_once_with()
    assert status == {"running": True}


def test_get_cron_job_last_runs_includes_only_registered_jobs():
    cron_service._scheduler = MagicMock()
    cron_service._scheduler.get_jobs.return_value = [
        MagicMock(id="repo-a:wf-1"),
        MagicMock(id="repo-a:wf-2"),
    ]
    cron_service._last_run_by_job = {
        "repo-a:wf-1": cron_service.datetime(
            2026, 1, 2, 3, 4, 5, tzinfo=cron_service.timezone.utc
        ),
        "repo-a:other": cron_service.datetime(
            2026, 1, 3, 3, 4, 5, tzinfo=cron_service.timezone.utc
        ),
    }

    result = cron_service.get_cron_job_last_runs()

    assert result["repo-a:wf-1"] == "2026-01-02T03:04:05+00:00"
    assert result["repo-a:wf-2"] is None
    assert "repo-a:other" not in result


def test_get_cron_job_diagnostics_includes_runtime_metadata():
    cron_service._scheduler = MagicMock()
    cron_service._scheduler.get_jobs.return_value = [
        MagicMock(
            id="repo-a:wf-1",
            next_run_time=cron_service.datetime(
                2026, 1, 2, 4, 5, 6, tzinfo=cron_service.timezone.utc
            ),
        ),
        MagicMock(id="repo-a:wf-2", next_run_time=None),
    ]

    active_process = MagicMock()
    active_process.poll.return_value = None
    cron_service._running_process_by_job = {"repo-a:wf-1": active_process}
    cron_service._last_run_by_job = {
        "repo-a:wf-1": cron_service.datetime(
            2026, 1, 2, 3, 4, 5, tzinfo=cron_service.timezone.utc
        ),
    }
    cron_service._last_finished_by_job = {
        "repo-a:wf-1": cron_service.datetime(
            2026, 1, 2, 3, 4, 8, tzinfo=cron_service.timezone.utc
        ),
    }
    cron_service._last_duration_ms_by_job = {"repo-a:wf-1": 3123}
    cron_service._last_exit_code_by_job = {"repo-a:wf-1": 0}
    cron_service._last_error_by_job = {"repo-a:wf-2": "boom"}
    cron_service._last_stdout_by_job = {"repo-a:wf-2": "line-1\nline-2"}
    cron_service._last_stderr_by_job = {"repo-a:wf-2": "boom"}

    result = cron_service.get_cron_job_diagnostics()

    assert result["repo-a:wf-1"]["lastStartedAt"] == "2026-01-02T03:04:05+00:00"
    assert result["repo-a:wf-1"]["lastFinishedAt"] == "2026-01-02T03:04:08+00:00"
    assert result["repo-a:wf-1"]["lastDurationMs"] == 3123


@patch("cron_service.CronTrigger.from_crontab")
@patch("cron_service.BackgroundScheduler")
@patch("cron_service.list_scheduled_tasks")
@patch("cron_service.read_workflows")
@patch("cron_service.get_workspace_home")
def test_start_cron_clock_registers_scheduled_tasks(
    mock_workspace_home,
    mock_read_workflows,
    mock_list_scheduled_tasks,
    mock_scheduler_cls,
    mock_from_crontab,
    tmp_path,
):
    repo = tmp_path / "repo-a"
    repo.mkdir()
    mock_workspace_home.return_value = tmp_path
    mock_read_workflows.return_value = {"workflows": []}
    mock_list_scheduled_tasks.return_value = [
        {"name": "daily-report.md", "schedule": "0 8 * * 1"}
    ]

    mock_scheduler = MagicMock()
    mock_scheduler_cls.return_value = mock_scheduler
    mock_from_crontab.return_value = object()

    cron_service.start_cron_clock()

    task_calls = [
        call
        for call in mock_scheduler.add_job.call_args_list
        if call[1].get("id") == "task:daily-report.md"
    ]
    assert len(task_calls) == 1
    kwargs = task_calls[0][1]
    assert kwargs["args"] == ["task:daily-report.md", "daily-report.md"]


@patch("cron_service.get_tasks_directory")
@patch("cron_service.read_task")
@patch("cron_service.get_agent_cli")
@patch("cron_service.shutil.which")
@patch("cron_service.Thread")
@patch("cron_service.subprocess.Popen")
def test_run_scheduled_task_uses_configured_agent_cli(
    mock_popen,
    mock_thread,
    mock_which,
    mock_get_agent_cli,
    mock_read_task,
    mock_get_tasks_directory,
    tmp_path,
):
    tasks_dir = tmp_path / ".made" / "tasks"
    tasks_dir.mkdir(parents=True)
    mock_get_tasks_directory.return_value = tasks_dir
    mock_cli = MagicMock()
    mock_cli.build_prompt_command.return_value = ["opencode", "run", "--format", "json"]
    mock_cli.prompt_via_stdin.return_value = True
    mock_get_agent_cli.return_value = mock_cli
    mock_read_task.return_value = {"content": "# check things\n- task body"}
    mock_which.return_value = "/usr/bin/opencode"

    process = MagicMock()
    process.stdin = MagicMock()
    process.communicate.return_value = ("ok", "")
    process.returncode = 0
    process.poll.return_value = 0
    mock_popen.return_value = process
    mock_thread.return_value = MagicMock(start=MagicMock())

    cron_service._run_scheduled_task("task:daily-report.md", "daily-report.md")

    mock_popen.assert_called_once_with(
        ["/usr/bin/opencode", "run", "--format", "json"],
        cwd=str(tasks_dir),
        stdout=cron_service.subprocess.PIPE,
        stderr=cron_service.subprocess.PIPE,
        text=True,
        stdin=cron_service.subprocess.PIPE,
    )
    mock_thread.assert_called_once()
    assert (
        mock_thread.call_args.kwargs["args"][3] == "# check things\n- task body"
    )


@patch("cron_service.get_tasks_directory")
@patch("cron_service.read_task")
@patch("cron_service.get_agent_cli")
@patch("cron_service.shutil.which")
@patch("cron_service.Thread")
@patch("cron_service.subprocess.Popen")
def test_run_scheduled_task_falls_back_to_filename_prompt_when_content_empty(
    mock_popen,
    mock_thread,
    mock_which,
    mock_get_agent_cli,
    mock_read_task,
    mock_get_tasks_directory,
    tmp_path,
):
    tasks_dir = tmp_path / ".made" / "tasks"
    tasks_dir.mkdir(parents=True)
    mock_get_tasks_directory.return_value = tasks_dir
    mock_cli = MagicMock()
    mock_cli.build_prompt_command.return_value = ["opencode", "run", "--format", "json"]
    mock_cli.prompt_via_stdin.return_value = True
    mock_get_agent_cli.return_value = mock_cli
    mock_read_task.return_value = {"content": "   "}
    mock_which.return_value = "/usr/bin/opencode"

    process = MagicMock()
    process.stdin = MagicMock()
    process.communicate.return_value = ("ok", "")
    process.returncode = 0
    process.poll.return_value = 0
    mock_popen.return_value = process
    mock_thread.return_value = MagicMock(start=MagicMock())

    cron_service._run_scheduled_task("task:daily-report.md", "daily-report.md")

    mock_thread.assert_called_once()
    assert (
        mock_thread.call_args.kwargs["args"][3]
        == "Follow the instructions in `daily-report.md`"
    )


@patch("cron_service.get_tasks_directory")
@patch("cron_service.read_task")
@patch("cron_service.get_agent_cli")
@patch("cron_service.shutil.which")
@patch("cron_service.Thread")
@patch("cron_service.subprocess.Popen")
def test_run_scheduled_task_records_failure_when_cli_not_found(
    mock_popen,
    mock_thread,
    mock_which,
    mock_get_agent_cli,
    mock_read_task,
    mock_get_tasks_directory,
    tmp_path,
):
    tasks_dir = tmp_path / ".made" / "tasks"
    tasks_dir.mkdir(parents=True)
    mock_get_tasks_directory.return_value = tasks_dir
    mock_cli = MagicMock()
    mock_cli.build_prompt_command.return_value = ["opencode", "run", "--format", "json"]
    mock_cli.prompt_via_stdin.return_value = True
    mock_get_agent_cli.return_value = mock_cli
    mock_read_task.return_value = {"content": "run report"}
    mock_which.return_value = None
    cron_service._failed_jobs = 0

    cron_service._run_scheduled_task("task:daily-report.md", "daily-report.md")

    mock_popen.assert_not_called()
    mock_thread.assert_not_called()
    assert cron_service._failed_jobs == 1
    assert (
        cron_service._last_error_by_job["task:daily-report.md"]
        == "Executable not found: opencode"
    )


def test_wait_for_workflow_process_keeps_last_stdout_lines_only():
    process = MagicMock()
    stdout = "\n".join(f"line-{index}" for index in range(1, 31))
    process.communicate.return_value = (stdout, "")
    process.returncode = 1
    process.poll.return_value = 1

    started_at = cron_service.datetime(
        2026, 1, 2, 3, 4, 5, tzinfo=cron_service.timezone.utc
    )
    cron_service._wait_for_workflow_process("repo-a:wf-1", process, started_at)

    stored_stdout = cron_service._last_stdout_by_job["repo-a:wf-1"]
    assert stored_stdout.startswith("line-11")
    assert stored_stdout.endswith("line-30")
    assert "line-10" not in stored_stdout


def test_wait_for_workflow_process_handles_closed_stdin_during_communicate():
    process = MagicMock()
    process.communicate.side_effect = ValueError("I/O operation on closed file")
    process.wait.return_value = 0
    process.stdout.read.return_value = "stdout line"
    process.stderr.read.return_value = ""
    process.returncode = 0
    process.poll.return_value = 0

    started_at = cron_service.datetime(
        2026, 1, 2, 3, 4, 5, tzinfo=cron_service.timezone.utc
    )
    cron_service._wait_for_workflow_process(
        "task:daily-report.md", process, started_at, "prompt text"
    )

    process.wait.assert_called_once_with()
    process.stdout.read.assert_called_once_with()
    assert cron_service._last_stdout_by_job["task:daily-report.md"] == "stdout line"


def test_get_cron_job_diagnostics_returns_empty_when_scheduler_not_running():
    cron_service._scheduler = None

    result = cron_service.get_cron_job_diagnostics()

    assert result == {}


def test_terminate_running_job_handles_double_timeout():
    """Test that _terminate_running_job handles timeout on kill() gracefully."""
    cron_service._state_lock = MagicMock()
    cron_service._running_process_by_job = {}

    mock_process = MagicMock()
    mock_process.poll.return_value = None
    mock_process.terminate.side_effect = None
    mock_process.wait.side_effect = subprocess.TimeoutExpired("cmd", 5)
    mock_process.kill.side_effect = subprocess.TimeoutExpired("cmd", 5)

    cron_service._running_process_by_job["test-wf"] = mock_process
    cron_service._terminate_running_job("test-wf")

    # Should not raise, zombie case handled
    assert "test-wf" not in cron_service._running_process_by_job


def test_force_terminate_job_returns_false_for_nonexistent():
    """Test force_terminate_job returns False when job not running."""
    cron_service._running_process_by_job = {}

    result = cron_service.force_terminate_job("nonexistent")

    assert result is False


@patch("cron_service._terminate_running_job")
def test_force_terminate_job_terminates_running(mock_terminate):
    """Test force_terminate_job terminates running job."""
    mock_process = MagicMock()
    cron_service._running_process_by_job = {"test-wf": mock_process}

    result = cron_service.force_terminate_job("test-wf")

    mock_terminate.assert_called_once_with("test-wf")
    assert result is True


def test_get_long_running_jobs_returns_running_jobs_above_threshold():
    """Test get_long_running_jobs returns jobs above threshold."""
    cron_service._running_process_by_job = {}
    cron_service._job_start_times = {
        "short": cron_service.datetime.now(cron_service.timezone.utc),  # Just started
        "long": cron_service.datetime.now(cron_service.timezone.utc)
        - timedelta(minutes=90),  # 90 min ago
    }
    cron_service._running_process_by_job = {
        "short": MagicMock(),
        "long": MagicMock(),
    }

    result = cron_service.get_long_running_jobs(threshold_minutes=60)

    assert len(result) == 1
    assert result[0]["workflow_id"] == "long"
