from unittest.mock import MagicMock, patch

import cron_service


def teardown_function():
    cron_service.stop_cron_clock()
    cron_service._running_process_by_job = {}
    cron_service._last_run_by_job = {}
    cron_service._last_finished_by_job = {}
    cron_service._last_duration_ms_by_job = {}
    cron_service._last_exit_code_by_job = {}
    cron_service._last_error_by_job = {}


@patch("cron_service.CronTrigger.from_crontab")
@patch("cron_service.BackgroundScheduler")
@patch("cron_service.read_workflows")
@patch("cron_service.get_workspace_home")
def test_start_cron_clock_registers_only_enabled_workflows_with_existing_scripts(
    mock_workspace_home,
    mock_read_workflows,
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

    assert mock_scheduler.add_job.call_count == 1
    _, kwargs = mock_scheduler.add_job.call_args
    assert kwargs["id"] == "repo-a:enabled"
    assert kwargs["max_instances"] == 2
    assert kwargs["args"][0] == repo
    assert kwargs["args"][2] == script

    status = cron_service.get_cron_clock_status()
    assert status["running"] is True
    assert status["configuredJobs"] == 1
    assert status["trafficLight"] == "ok"


@patch("cron_service.BackgroundScheduler")
@patch("cron_service.read_workflows")
@patch("cron_service.get_workspace_home")
def test_start_cron_clock_marks_invalid_cron_as_warning(
    mock_workspace_home,
    mock_read_workflows,
    mock_scheduler_cls,
    tmp_path,
):
    repo = tmp_path / "repo-a"
    repo.mkdir()
    script = repo / "run.sh"
    script.write_text("echo hi", encoding="utf-8")

    mock_workspace_home.return_value = tmp_path
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
    mock_scheduler.add_job.side_effect = ValueError("bad cron")
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
    process.poll.return_value = None
    mock_popen.return_value = process

    cron_service._run_workflow_script(repo, "repo-a:news", script)

    mock_popen.assert_called_once_with(
        ["bash", str(script)],
        cwd=str(repo),
        stdout=cron_service.subprocess.PIPE,
        stderr=cron_service.subprocess.PIPE,
        text=True,
    )


@patch("cron_service.subprocess.Popen")
def test_cron_status_tracks_successful_vs_started_jobs(mock_popen, tmp_path):
    repo = tmp_path / "repo-a"
    repo.mkdir()
    script = repo / ".harness" / "news.sh"
    script.parent.mkdir(parents=True)
    script.write_text("echo hi", encoding="utf-8")

    cron_service._started_jobs = 0
    cron_service._successful_jobs = 0

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


@patch("cron_service.subprocess.Popen")
def test_new_run_terminates_previous_process_for_same_job(mock_popen, tmp_path):
    repo = tmp_path / "repo-a"
    repo.mkdir()
    script = repo / "run.sh"
    script.write_text("echo hi", encoding="utf-8")

    previous_process = MagicMock()
    previous_process.poll.return_value = None

    next_process = MagicMock()
    next_process.communicate.return_value = ("ok", "")
    next_process.returncode = 0
    next_process.poll.return_value = None

    cron_service._running_process_by_job = {"repo-a:wf": previous_process}
    mock_popen.return_value = next_process

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
        "repo-a:wf-1": cron_service.datetime(2026, 1, 2, 3, 4, 5, tzinfo=cron_service.timezone.utc),
        "repo-a:other": cron_service.datetime(2026, 1, 3, 3, 4, 5, tzinfo=cron_service.timezone.utc),
    }

    result = cron_service.get_cron_job_last_runs()

    assert result["repo-a:wf-1"] == "2026-01-02T03:04:05+00:00"
    assert result["repo-a:wf-2"] is None
    assert "repo-a:other" not in result


def test_get_cron_job_diagnostics_includes_runtime_metadata():
    cron_service._scheduler = MagicMock()
    cron_service._scheduler.get_jobs.return_value = [
        MagicMock(id="repo-a:wf-1", next_run_time=cron_service.datetime(2026, 1, 2, 4, 5, 6, tzinfo=cron_service.timezone.utc)),
        MagicMock(id="repo-a:wf-2", next_run_time=None),
    ]

    active_process = MagicMock()
    active_process.poll.return_value = None
    cron_service._running_process_by_job = {"repo-a:wf-1": active_process}
    cron_service._last_run_by_job = {
        "repo-a:wf-1": cron_service.datetime(2026, 1, 2, 3, 4, 5, tzinfo=cron_service.timezone.utc),
    }
    cron_service._last_finished_by_job = {
        "repo-a:wf-1": cron_service.datetime(2026, 1, 2, 3, 4, 8, tzinfo=cron_service.timezone.utc),
    }
    cron_service._last_duration_ms_by_job = {"repo-a:wf-1": 3123}
    cron_service._last_exit_code_by_job = {"repo-a:wf-1": 0}
    cron_service._last_error_by_job = {"repo-a:wf-2": "boom"}

    result = cron_service.get_cron_job_diagnostics()

    assert result["repo-a:wf-1"]["lastStartedAt"] == "2026-01-02T03:04:05+00:00"
    assert result["repo-a:wf-1"]["lastFinishedAt"] == "2026-01-02T03:04:08+00:00"
    assert result["repo-a:wf-1"]["lastDurationMs"] == 3123
    assert result["repo-a:wf-1"]["lastExitCode"] == 0
    assert result["repo-a:wf-1"]["nextRunAt"] == "2026-01-02T04:05:06+00:00"
    assert result["repo-a:wf-1"]["running"] is True
    assert result["repo-a:wf-2"]["lastError"] == "boom"


def test_get_cron_job_diagnostics_returns_empty_when_scheduler_not_running():
    cron_service._scheduler = None

    result = cron_service.get_cron_job_diagnostics()

    assert result == {}
