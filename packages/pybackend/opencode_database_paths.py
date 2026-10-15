"""Cache successful CLI path discovery across short-lived adapter instances."""

from functools import lru_cache
import os
from pathlib import Path
import subprocess


@lru_cache(maxsize=16)
def _discover(context: tuple[str, ...]) -> Path:
    # The key captures inputs that can change CLI path resolution.
    _ = context
    result = subprocess.run(
        ["opencode", "debug", "paths", "db"],
        capture_output=True,
        text=True,
        timeout=10,
    )
    if result.returncode:
        raise RuntimeError(
            (result.stderr or "Could not resolve OpenCode database path").strip()
        )
    path = Path(result.stdout.strip()).expanduser()
    if not path.is_absolute():
        raise ValueError("OpenCode returned a non-absolute database path")
    if not path.is_file():
        raise FileNotFoundError(f"OpenCode v2 database not found: {path}")
    return path


def discover_database() -> Path:
    context = tuple(
        os.environ.get(key, "")
        for key in ("PATH", "HOME", "XDG_DATA_HOME", "OPENCODE_DB")
    ) + (str(Path.cwd()),)
    path = _discover(context)
    if path.is_file():
        return path
    _discover.cache_clear()
    return _discover(context)
