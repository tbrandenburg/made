"""System utilization and optional Linux Pressure Stall Information (PSI)."""

import math
from pathlib import Path
from typing import Callable

import psutil


def read_pressure(path: Path) -> float | None:
    """Return PSI's some/avg10 percentage, or None when unavailable."""
    try:
        for line in path.read_text().splitlines():
            if line.startswith("some "):
                fields = dict(field.split("=", 1) for field in line.split()[1:])
                value = float(fields["avg10"])
                return value if math.isfinite(value) and 0 <= value <= 100 else None
    except (OSError, ValueError, KeyError):
        pass
    return None


def _percentage(read: Callable[[], float]) -> float | None:
    try:
        return read()
    except (OSError, psutil.Error):
        return None


def get_system_metrics(workspace: Path) -> dict[str, float | None]:
    """Read overall system metrics, never MADE process usage.

    A short CPU sample avoids psutil's meaningless first nonblocking reading.
    The synchronous API route runs this in FastAPI's worker thread pool.
    Disk usage describes the filesystem containing the workspace. System
    readings reflect the OS visible to the backend, not container quotas.
    """
    pressure = Path("/proc/pressure")
    return {
        "cpuUtilization": _percentage(lambda: psutil.cpu_percent(interval=0.1)),
        "cpuPressure": read_pressure(pressure / "cpu"),
        "ramUtilization": _percentage(lambda: psutil.virtual_memory().percent),
        "memoryPressure": read_pressure(pressure / "memory"),
        "diskUtilization": _percentage(lambda: psutil.disk_usage(workspace).percent),
        "ioPressure": read_pressure(pressure / "io"),
    }
