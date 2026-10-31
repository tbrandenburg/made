"""Verify development artifacts stay out of built distributions."""

import shutil
import subprocess
import tarfile
import tempfile
import zipfile
from pathlib import Path


def test_build_artifacts_exclude_local_outputs_and_keep_lite_resources() -> None:
    backend = Path(__file__).resolve().parents[2]
    with tempfile.TemporaryDirectory(prefix="made-packaging-") as temporary:
        root = Path(temporary)
        project = root / "project"
        output = root / "output"
        shutil.copytree(
            backend,
            project,
            ignore=shutil.ignore_patterns(
                ".venv", ".made", "__pycache__", "*.pyc"
            ),
        )
        for relative in (
            ".made/logs/packaging-sentinel.log",
            ".flowsh/logs/packaging-sentinel.log",
            "logs/packaging-regression-sentinel.log",
            ".flowsh/runs/packaging-sentinel.json",
            ".coverage",
            ".coverage.integration",
            "coverage.json",
            "htmlcov/index.html",
            ".pytest_cache/v/cache/sentinel",
            ".ruff_cache/sentinel",
            "build/sentinel.txt",
            "dist/sentinel.txt",
        ):
            sentinel = project / relative
            sentinel.parent.mkdir(parents=True, exist_ok=True)
            sentinel.write_text("harmless packaging sentinel\n", encoding="utf-8")

        subprocess.run(
            ["uv", "build", "--directory", str(project), "--out-dir", str(output)],
            check=True,
            capture_output=True,
            text=True,
            timeout=120,
        )

        wheel = next(output.glob("*.whl"))
        sdist = next(output.glob("*.tar.gz"))
        with zipfile.ZipFile(wheel) as archive:
            wheel_members = set(archive.namelist())
        with tarfile.open(sdist) as archive:
            sdist_members = {
                str(Path(member.name.split("/", 1)[1]))
                for member in archive.getmembers()
                if "/" in member.name
            }

        required_wheel = {
            "./app.py",
            "./templates/lite_repo.html",
            "./static_lite/lite.css",
        }
        required_sdist = {member[2:] for member in required_wheel}
        forbidden_fragments = (
            ".made/",
            ".flowsh/",
            "logs/",
            ".coverage",
            "coverage.json",
            "htmlcov/",
            ".pytest_cache/",
            ".ruff_cache/",
            "build/sentinel",
            "dist/sentinel",
        )
        assert required_wheel <= wheel_members
        forbidden_wheel_members = sorted(
            member
            for member in wheel_members
            if any(fragment in member for fragment in forbidden_fragments)
        )
        assert not forbidden_wheel_members, forbidden_wheel_members
        assert required_sdist <= sdist_members
        forbidden_sdist_members = sorted(
            member
            for member in sdist_members
            if any(fragment in member for fragment in forbidden_fragments)
        )
        assert not forbidden_sdist_members, forbidden_sdist_members
