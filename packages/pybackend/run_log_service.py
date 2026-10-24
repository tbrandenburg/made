"""Small shared primitives for scoped log files and bounded tails."""

import os
import re
import stat
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

BUILD_LOG = re.compile(r"build-task-[0-9a-f]{32}\.log\Z")


def log_type(name: str) -> str | None:
    if BUILD_LOG.fullmatch(name):
        return "build-task"
    if re.fullmatch(r"flowsh-[^/\\\x00]+\.log", name):
        return "flowsh"
    return None


@contextmanager
def scoped_log_directory(root: Path, create: bool = False) -> Iterator[int]:
    """Pin each directory before descending; callers use relative file operations."""
    descriptors: list[int] = []
    try:
        try:
            descriptors.append(
                os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
            )
            for segment in (".flowsh", "logs"):
                if create:
                    try:
                        os.mkdir(segment, mode=0o700, dir_fd=descriptors[-1])
                    except FileExistsError:
                        if not stat.S_ISDIR(
                            os.stat(
                                segment, dir_fd=descriptors[-1], follow_symlinks=False
                            ).st_mode
                        ):
                            raise FileNotFoundError("Unsafe log directory")
                descriptors.append(
                    os.open(
                        segment,
                        os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                        dir_fd=descriptors[-1],
                    )
                )
        except OSError as error:
            raise FileNotFoundError(
                "Unsafe log directory or directory unavailable"
            ) from error
        if create:
            try:
                descriptor = os.open(
                    ".gitignore",
                    os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                    0o600,
                    dir_fd=descriptors[-1],
                )
            except FileExistsError:
                descriptor = None
            if descriptor is not None:
                with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
                    stream.write("*\n")
        yield descriptors[-1]
    finally:
        for descriptor in reversed(descriptors):
            os.close(descriptor)


def bounded_tail(
    path: Path, max_lines: int = 200, *, directory: int | None = None
) -> str:
    if directory is None:
        with scoped_log_directory(path.parent.parent.parent) as descriptor:
            return bounded_tail(path, max_lines, directory=descriptor)
    descriptor = os.open(
        path.name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directory
    )
    with os.fdopen(descriptor, "rb") as stream:
        if not stat.S_ISREG(os.fstat(stream.fileno()).st_mode):
            raise FileNotFoundError("Log is not a regular file")
        size = stream.seek(0, os.SEEK_END)
        offset = max(0, size - 65536)
        stream.seek(offset)
        content = stream.read(65536).decode("utf-8", errors="replace")
    lines = content.splitlines()
    if offset and len(lines) > 1:
        lines = lines[1:]
    return "\n".join(lines[-max(1, min(max_lines, 200)) :])
