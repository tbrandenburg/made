from pathlib import Path

import frontmatter

from config import ensure_made_structure


def get_tasks_directory() -> Path:
    made_dir = ensure_made_structure()
    return made_dir / "tasks"


def list_tasks():
    dir_path = get_tasks_directory()
    tasks = []
    for entry in dir_path.iterdir():
        if entry.is_file() and entry.name.endswith(".md"):
            parsed = frontmatter.loads(entry.read_text(encoding="utf-8"))
            data = parsed.metadata or {}
            tasks.append(
                {
                    "name": entry.name,
                    "tags": data.get("tags", []),
                    "content": parsed.content,
                    "frontmatter": data,
                }
            )
    return sorted(tasks, key=lambda task: task["name"])


def read_task(file_name: str):
    dir_path = get_tasks_directory()
    file_path = dir_path / file_name
    parsed = frontmatter.loads(file_path.read_text(encoding="utf-8"))
    return {
        "content": parsed.content,
        "data": parsed.metadata,
        "frontmatter": parsed.metadata,
    }


def write_task(file_name: str, frontmatter_data, content: str) -> None:
    dir_path = get_tasks_directory()
    file_path = dir_path / file_name
    post = frontmatter.Post(content, **(frontmatter_data or {}))
    file_path.write_text(frontmatter.dumps(post), encoding="utf-8")
