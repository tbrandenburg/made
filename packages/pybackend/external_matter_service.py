from pathlib import Path

import frontmatter


def _resolve_path(raw_path: str) -> Path:
    normalized = (raw_path or "").strip()
    if not normalized:
        raise ValueError("Path is required")
    return Path(normalized).expanduser()


def read_external_matter(path: str) -> dict:
    file_path = _resolve_path(path)
    if not file_path.exists() or not file_path.is_file():
        raise FileNotFoundError(f"External file not found: {file_path}")

    parsed = frontmatter.loads(file_path.read_text(encoding="utf-8"))
    return {
        "path": str(file_path),
        "content": parsed.content,
        "frontmatter": parsed.metadata or {},
    }


def write_external_matter(path: str, frontmatter_data, content: str) -> dict:
    file_path = _resolve_path(path)
    if not file_path.exists() or not file_path.is_file():
        raise FileNotFoundError(f"External file not found: {file_path}")

    post = frontmatter.Post(content or "", **(frontmatter_data or {}))
    file_path.write_text(frontmatter.dumps(post), encoding="utf-8")
    return {"success": True, "path": str(file_path)}
