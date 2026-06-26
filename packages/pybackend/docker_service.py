import json
import logging
import re
import subprocess
from typing import Any

logger = logging.getLogger(__name__)

_CONTAINER_ID_RE = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$")
CONTAINER_ID_PATTERN = r"^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$"


def list_running_containers() -> list[dict[str, Any]]:
    """Return running containers via `docker ps --format json`."""
    try:
        result = subprocess.run(
            ["docker", "ps", "--no-trunc", "--format", "{{json .}}"],
            capture_output=True,
            text=True,
            timeout=10,
        )
    except (subprocess.SubprocessError, FileNotFoundError) as exc:
        logger.warning("Failed to list Docker containers: %s", exc)
        return []

    containers: list[dict[str, Any]] = []
    for line in result.stdout.strip().splitlines():
        if not line:
            continue
        try:
            raw = json.loads(line)
        except json.JSONDecodeError:
            continue
        containers.append(
            {
                "id": raw.get("ID", ""),
                "shortId": raw.get("ID", "")[:12],
                "image": raw.get("Image", ""),
                "command": raw.get("Command", ""),
                "createdAt": raw.get("CreatedAt", ""),
                "status": raw.get("Status", ""),
                "ports": raw.get("Ports", ""),
                "names": raw.get("Names", ""),
            }
        )
    return containers


def stop_container(container_id: str) -> bool:
    """Stop a running container; returns True on success."""
    if not _CONTAINER_ID_RE.fullmatch(container_id):
        logger.warning("Rejecting invalid container_id: %r", container_id)
        return False
    try:
        result = subprocess.run(
            ["docker", "stop", container_id],
            capture_output=True,
            text=True,
            timeout=30,
        )
    except (subprocess.SubprocessError, FileNotFoundError):
        return False
    return result.returncode == 0
