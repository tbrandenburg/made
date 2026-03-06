from unittest.mock import MagicMock, patch

import cron_service


def teardown_function():
    cron_service.stop_cron_clock()


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


@patch("cron_service.subprocess.run")
def test_run_workflow_script_executes_from_repository_directory(mock_run, tmp_path):
    repo = tmp_path / "repo-a"
    repo.mkdir()
    script = repo / ".harness" / "news.sh"
    script.parent.mkdir(parents=True)
    script.write_text("echo hi", encoding="utf-8")

    mock_run.return_value = MagicMock(returncode=0, stdout="ok", stderr="")

    cron_service._run_workflow_script(repo, "repo-a:news", script)

    mock_run.assert_called_once_with(
        ["bash", str(script)],
        cwd=str(repo),
        capture_output=True,
        text=True,
        check=False,
    )


@patch("cron_service.subprocess.run")
def test_cron_status_tracks_successful_vs_started_jobs(mock_run, tmp_path):
    repo = tmp_path / "repo-a"
    repo.mkdir()
    script = repo / ".harness" / "news.sh"
    script.parent.mkdir(parents=True)
    script.write_text("echo hi", encoding="utf-8")

    cron_service._started_jobs = 0
    cron_service._successful_jobs = 0

    mock_run.side_effect = [
        MagicMock(returncode=0, stdout="ok", stderr=""),
        MagicMock(returncode=1, stdout="", stderr="boom"),
        MagicMock(returncode=127, stdout="", stderr="missing"),
    ]

    cron_service._run_workflow_script(repo, "repo-a:news", script)
    cron_service._run_workflow_script(repo, "repo-a:news", script)
    cron_service._run_workflow_script(repo, "repo-a:news", script)

    status = cron_service.get_cron_clock_status()
    assert status["startedJobsSinceStartup"] == 3
    assert status["successfulJobsSinceStartup"] == 1
