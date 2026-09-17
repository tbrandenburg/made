"""Unit tests for scripts/bump_version.py.

These tests exercise the pure version-sync logic (parsing, bumping,
validation, and file writing) against isolated temporary directories so
no real repository files or git tags are ever touched.
"""

from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[4]
SCRIPT_PATH = REPO_ROOT / "scripts" / "bump_version.py"

spec = importlib.util.spec_from_file_location("bump_version", SCRIPT_PATH)
bump_version_module = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(bump_version_module)


def _make_fake_repo(tmp_path: Path, version: str = "0.1.0", init_git: bool = True) -> Path:
    root = tmp_path / "repo"
    (root / "packages" / "frontend").mkdir(parents=True)
    (root / "packages" / "pybackend").mkdir(parents=True)

    (root / "package.json").write_text(
        json.dumps({"name": "made", "private": True, "version": version, "scripts": {}}, indent=2) + "\n"
    )
    (root / "packages" / "frontend" / "package.json").write_text(
        json.dumps({"name": "frontend", "version": version}, indent=2) + "\n"
    )
    (root / "packages" / "pybackend" / "pyproject.toml").write_text(
        f'[project]\nname = "made-pybackend"\nversion = "{version}"\nrequires-python = ">=3.12"\n'
    )

    if init_git:
        subprocess.run(["git", "init", "-q"], cwd=root, check=True)
        subprocess.run(["git", "config", "user.email", "test@example.com"], cwd=root, check=True)
        subprocess.run(["git", "config", "user.name", "Test"], cwd=root, check=True)

    return root


def _read_versions(root: Path) -> dict[str, str]:
    return bump_version_module.read_all_versions(root)


class TestParseAndBump:
    def test_parse_semver_extracts_components(self) -> None:
        assert bump_version_module.parse_semver("1.2.3") == (1, 2, 3)
        assert bump_version_module.parse_semver("0.1.0") == (0, 1, 0)

    def test_parse_semver_rejects_malformed_input(self) -> None:
        for bad in ["1.2", "v1.2.3", "1.2.3.4", "1.2.x", "not-a-version", ""]:
            with pytest.raises(bump_version_module.VersionError):
                bump_version_module.parse_semver(bad)

    def test_bump_patch_increments_only_patch(self) -> None:
        assert bump_version_module.bump_version("0.1.0", "patch") == "0.1.1"
        assert bump_version_module.bump_version("1.2.9", "patch") == "1.2.10"

    def test_bump_minor_resets_patch(self) -> None:
        assert bump_version_module.bump_version("0.1.5", "minor") == "0.2.0"

    def test_bump_major_resets_minor_and_patch(self) -> None:
        assert bump_version_module.bump_version("1.9.9", "major") == "2.0.0"

    def test_bump_rejects_unknown_kind(self) -> None:
        with pytest.raises(bump_version_module.VersionError):
            bump_version_module.bump_version("0.1.0", "revision")


class TestWriteAllVersions:
    def test_writes_identical_version_to_all_three_files(self, tmp_path: Path) -> None:
        root = _make_fake_repo(tmp_path, version="0.1.0")

        bump_version_module.write_all_versions(root, "0.2.0")

        versions = _read_versions(root)
        assert versions[bump_version_module.ROOT_PACKAGE_JSON] == "0.2.0"
        assert versions[bump_version_module.FRONTEND_PACKAGE_JSON] == "0.2.0"
        assert versions[bump_version_module.BACKEND_PYPROJECT_TOML] == "0.2.0"

    def test_pyproject_write_preserves_other_lines(self, tmp_path: Path) -> None:
        root = _make_fake_repo(tmp_path, version="0.1.0")
        pyproject = root / "packages" / "pybackend" / "pyproject.toml"

        bump_version_module.write_all_versions(root, "1.0.0")

        text = pyproject.read_text()
        assert 'name = "made-pybackend"' in text
        assert 'requires-python = ">=3.12"' in text
        assert 'version = "1.0.0"' in text


class TestResolveNewVersion:
    def test_bump_kind_resolves_expected_version(self, tmp_path: Path) -> None:
        root = _make_fake_repo(tmp_path, version="0.1.0")
        result = bump_version_module.resolve_new_version(root, bump="patch", explicit=None, check_tags=True)
        assert result == "0.1.1"

    def test_explicit_version_is_used_verbatim(self, tmp_path: Path) -> None:
        root = _make_fake_repo(tmp_path, version="0.1.0")
        result = bump_version_module.resolve_new_version(root, bump=None, explicit="2.5.1", check_tags=True)
        assert result == "2.5.1"

    def test_rejects_both_bump_and_explicit(self, tmp_path: Path) -> None:
        root = _make_fake_repo(tmp_path, version="0.1.0")
        with pytest.raises(bump_version_module.VersionError):
            bump_version_module.resolve_new_version(root, bump="patch", explicit="9.9.9", check_tags=True)

    def test_rejects_neither_bump_nor_explicit(self, tmp_path: Path) -> None:
        root = _make_fake_repo(tmp_path, version="0.1.0")
        with pytest.raises(bump_version_module.VersionError):
            bump_version_module.resolve_new_version(root, bump=None, explicit=None, check_tags=True)

    def test_rejects_malformed_explicit_version(self, tmp_path: Path) -> None:
        root = _make_fake_repo(tmp_path, version="0.1.0")
        with pytest.raises(bump_version_module.VersionError):
            bump_version_module.resolve_new_version(root, bump=None, explicit="not-semver", check_tags=True)

    def test_rejects_version_matching_existing_git_tag(self, tmp_path: Path) -> None:
        root = _make_fake_repo(tmp_path, version="0.1.0")
        subprocess.run(["git", "add", "."], cwd=root, check=True)
        subprocess.run(["git", "commit", "-q", "-m", "init"], cwd=root, check=True)
        subprocess.run(["git", "tag", "-a", "v0.2.0", "-m", "existing"], cwd=root, check=True)

        with pytest.raises(bump_version_module.VersionError, match="already exists"):
            bump_version_module.resolve_new_version(root, bump="minor", explicit=None, check_tags=True)

    def test_explicit_existing_tag_can_be_skipped_with_no_tag_check(self, tmp_path: Path) -> None:
        root = _make_fake_repo(tmp_path, version="0.1.0")
        subprocess.run(["git", "add", "."], cwd=root, check=True)
        subprocess.run(["git", "commit", "-q", "-m", "init"], cwd=root, check=True)
        subprocess.run(["git", "tag", "-a", "v0.2.0", "-m", "existing"], cwd=root, check=True)

        result = bump_version_module.resolve_new_version(root, bump="minor", explicit=None, check_tags=False)
        assert result == "0.2.0"

    def test_rejects_out_of_sync_package_versions(self, tmp_path: Path) -> None:
        root = _make_fake_repo(tmp_path, version="0.1.0")
        frontend_pkg = root / "packages" / "frontend" / "package.json"
        data = json.loads(frontend_pkg.read_text())
        data["version"] = "0.0.9"
        frontend_pkg.write_text(json.dumps(data, indent=2) + "\n")

        with pytest.raises(bump_version_module.VersionError, match="out of sync"):
            bump_version_module.resolve_new_version(root, bump="patch", explicit=None, check_tags=True)

    def test_rejects_new_version_identical_to_current(self, tmp_path: Path) -> None:
        root = _make_fake_repo(tmp_path, version="0.1.0")
        with pytest.raises(bump_version_module.VersionError):
            bump_version_module.resolve_new_version(root, bump=None, explicit="0.1.0", check_tags=True)


class TestCliEntrypoint:
    def test_cli_dry_run_prints_version_without_writing(self, tmp_path: Path) -> None:
        root = _make_fake_repo(tmp_path, version="0.1.0")

        result = subprocess.run(
            [sys.executable, str(SCRIPT_PATH), "--bump", "patch", "--root", str(root), "--dry-run"],
            capture_output=True,
            text=True,
            check=True,
        )

        assert result.stdout.strip() == "0.1.1"
        versions = _read_versions(root)
        assert versions[bump_version_module.ROOT_PACKAGE_JSON] == "0.1.0"

    def test_cli_writes_versions_and_exits_zero(self, tmp_path: Path) -> None:
        root = _make_fake_repo(tmp_path, version="0.1.0")

        result = subprocess.run(
            [sys.executable, str(SCRIPT_PATH), "--version", "3.0.0", "--root", str(root)],
            capture_output=True,
            text=True,
            check=True,
        )

        assert result.stdout.strip() == "3.0.0"
        versions = _read_versions(root)
        assert all(v == "3.0.0" for v in versions.values())

    def test_cli_exits_nonzero_on_invalid_semver(self, tmp_path: Path) -> None:
        root = _make_fake_repo(tmp_path, version="0.1.0")

        result = subprocess.run(
            [sys.executable, str(SCRIPT_PATH), "--version", "bogus", "--root", str(root)],
            capture_output=True,
            text=True,
        )

        assert result.returncode == 1
        assert "error" in result.stderr.lower()
