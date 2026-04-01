from pathlib import Path
import frontmatter

from config import ensure_made_structure


def get_constitution_directory() -> Path:
    made_dir = ensure_made_structure()
    return made_dir / "constitutions"


def _constitution_file_path(file_name: str) -> Path:
    dir_path = get_constitution_directory().resolve()
    normalized = (file_name or "").strip()
    if not normalized:
        raise ValueError("Constitution name is required")
    candidate = (dir_path / normalized).resolve()
    if dir_path not in [candidate, *candidate.parents]:
        raise ValueError("Constitution path must stay within constitutions directory")
    return candidate


def list_constitutions():
    dir_path = get_constitution_directory()
    constitutions = []
    for entry in dir_path.rglob("*.md"):
        if entry.is_file() and entry.name.endswith(".md"):
            parsed = frontmatter.loads(entry.read_text(encoding="utf-8"))
            data = parsed.metadata or {}
            constitutions.append(
                {
                    "name": entry.relative_to(dir_path).as_posix(),
                    "tags": data.get("tags", []),
                    "content": parsed.content,
                    "frontmatter": data,
                }
            )
    return sorted(constitutions, key=lambda constitution: constitution["name"])


def read_constitution(file_name: str):
    file_path = _constitution_file_path(file_name)
    if not file_path.exists() or not file_path.is_file():
        raise FileNotFoundError("Constitution not found")
    parsed = frontmatter.loads(file_path.read_text(encoding="utf-8"))
    return {
        "content": parsed.content,
        "data": parsed.metadata,
        "frontmatter": parsed.metadata,
    }


def write_constitution(file_name: str, frontmatter_data, content: str) -> None:
    file_path = _constitution_file_path(file_name)
    file_path.parent.mkdir(parents=True, exist_ok=True)
    post = frontmatter.Post(content, **(frontmatter_data or {}))
    file_path.write_text(frontmatter.dumps(post), encoding="utf-8")


def delete_constitution(file_name: str) -> None:
    file_path = _constitution_file_path(file_name)
    file_path.unlink()
