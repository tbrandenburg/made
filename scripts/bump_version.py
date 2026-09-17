#!/usr/bin/env python3
"""Synchronize the MADE project version across all package manifests.

Keeps the version fields in the following files identical:
  - package.json                       (root)
  - packages/frontend/package.json
  - packages/pybackend/pyproject.toml

Usage:
  python scripts/bump_version.py --bump patch|minor|major [--root DIR] [--no-tag-check]
  python scripts/bump_version.py --version 1.2.3 [--root DIR] [--no-tag-check]
  python scripts/bump_version.py --bump patch --dry-run

Exit codes:
  0 on success, 1 on any validation failure (invalid semver, tag exists, etc.)
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

SEMVER_RE = re.compile(
    r"^(?P<major>0|[1-9]\d*)\.(?P<minor>0|[1-9]\d*)\.(?P<patch>0|[1-9]\d*)"
    r"(?:-(?P<prerelease>[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?"
    r"(?:\+(?P<build>[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$"
)

ROOT_PACKAGE_JSON = "package.json"
FRONTEND_PACKAGE_JSON = "packages/frontend/package.json"
BACKEND_PYPROJECT_TOML = "packages/pybackend/pyproject.toml"

BUMP_KINDS = ("major", "minor", "patch")


class VersionError(ValueError):
    """Raised for any invalid version/release input."""


def parse_semver(version: str) -> tuple[int, int, int]:
    match = SEMVER_RE.match(version)
    if not match:
        raise VersionError(f"'{version}' is not a valid semantic version (expected MAJOR.MINOR.PATCH)")
    return int(match.group("major")), int(match.group("minor")), int(match.group("patch"))


def bump_version(current: str, kind: str) -> str:
    if kind not in BUMP_KINDS:
        raise VersionError(f"Unknown bump kind '{kind}', expected one of {BUMP_KINDS}")
    major, minor, patch = parse_semver(current)
    if kind == "major":
        return f"{major + 1}.0.0"
    if kind == "minor":
        return f"{major}.{minor + 1}.0"
    return f"{major}.{minor}.{patch + 1}"


def read_root_version(root: Path) -> str:
    data = json.loads((root / ROOT_PACKAGE_JSON).read_text())
    version = data.get("version")
    if not version:
        raise VersionError(f"No 'version' field found in {ROOT_PACKAGE_JSON}")
    return version


def read_all_versions(root: Path) -> dict[str, str]:
    root_pkg = json.loads((root / ROOT_PACKAGE_JSON).read_text())
    frontend_pkg = json.loads((root / FRONTEND_PACKAGE_JSON).read_text())
    pyproject_text = (root / BACKEND_PYPROJECT_TOML).read_text()
    pyproject_match = re.search(r'(?m)^version\s*=\s*"([^"]+)"', pyproject_text)
    if not pyproject_match:
        raise VersionError(f"No 'version' field found in {BACKEND_PYPROJECT_TOML}")
    return {
        ROOT_PACKAGE_JSON: root_pkg.get("version", ""),
        FRONTEND_PACKAGE_JSON: frontend_pkg.get("version", ""),
        BACKEND_PYPROJECT_TOML: pyproject_match.group(1),
    }


def tag_exists(version: str, root: Path) -> bool:
    tag = f"v{version}"
    try:
        result = subprocess.run(
            ["git", "tag", "--list", tag],
            cwd=root,
            capture_output=True,
            text=True,
            check=True,
        )
    except (subprocess.CalledProcessError, FileNotFoundError):
        return False
    return tag in result.stdout.splitlines()


def _write_package_json_version(path: Path, version: str) -> str:
    original = path.read_text()
    data = json.loads(original)
    data["version"] = version
    updated = re.sub(
        r'("version"\s*:\s*)"[^"]*"',
        lambda m: f'{m.group(1)}"{version}"',
        original,
        count=1,
    )
    # Fall back to full re-serialization only if the regex replacement failed
    # (e.g. unexpected formatting), keeping the original file style otherwise.
    if json.loads(updated).get("version") != version:
        updated = json.dumps(data, indent=2) + "\n"
    return updated


def _write_pyproject_toml_version(path: Path, version: str) -> str:
    original = path.read_text()
    updated, count = re.subn(
        r'(?m)^(version\s*=\s*)"[^"]*"',
        lambda m: f'{m.group(1)}"{version}"',
        original,
        count=1,
    )
    if count != 1:
        raise VersionError(f"Could not locate a 'version = \"...\"' line in {path}")
    return updated


def write_all_versions(root: Path, version: str) -> list[Path]:
    """Write the new version to all three files atomically (all-or-nothing)."""
    targets = {
        root / ROOT_PACKAGE_JSON: _write_package_json_version(root / ROOT_PACKAGE_JSON, version),
        root / FRONTEND_PACKAGE_JSON: _write_package_json_version(root / FRONTEND_PACKAGE_JSON, version),
        root / BACKEND_PYPROJECT_TOML: _write_pyproject_toml_version(root / BACKEND_PYPROJECT_TOML, version),
    }
    # Only touch disk once every render succeeded above.
    for path, content in targets.items():
        path.write_text(content)
    return list(targets.keys())


def resolve_new_version(root: Path, bump: str | None, explicit: str | None, check_tags: bool) -> str:
    if bump and explicit:
        raise VersionError("Specify either --bump or --version, not both")
    if not bump and not explicit:
        raise VersionError("One of --bump or --version is required")

    current = read_root_version(root)
    new_version = explicit if explicit else bump_version(current, bump)
    parse_semver(new_version)

    versions = read_all_versions(root)
    mismatched = {f: v for f, v in versions.items() if v != current}
    if mismatched:
        raise VersionError(
            f"Package versions are out of sync before bump (expected {current}): {mismatched}"
        )

    if new_version == current:
        raise VersionError(f"New version '{new_version}' is identical to current version '{current}'")

    if check_tags and tag_exists(new_version, root):
        raise VersionError(f"Tag v{new_version} already exists")

    return new_version


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--bump", choices=BUMP_KINDS, help="Semver part to bump")
    parser.add_argument("--version", help="Explicit target version (e.g. 1.2.3, no leading 'v')")
    parser.add_argument("--root", default=".", help="Repository root directory (default: current directory)")
    parser.add_argument(
        "--no-tag-check", action="store_true", help="Skip checking whether the target tag already exists"
    )
    parser.add_argument(
        "--dry-run", action="store_true", help="Print the resolved version without writing any files"
    )
    args = parser.parse_args(argv)

    root = Path(args.root).resolve()
    try:
        new_version = resolve_new_version(
            root, bump=args.bump, explicit=args.version, check_tags=not args.no_tag_check
        )
        if args.dry_run:
            print(new_version)
            return 0
        changed = write_all_versions(root, new_version)
    except VersionError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1

    print(new_version)
    for path in changed:
        print(f"updated {path.relative_to(root)}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
