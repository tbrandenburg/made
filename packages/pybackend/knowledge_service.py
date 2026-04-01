from pathlib import Path
import frontmatter

from config import ensure_made_structure


def get_knowledge_directory() -> Path:
    made_dir = ensure_made_structure()
    return made_dir / "knowledge"


def _knowledge_file_path(file_name: str) -> Path:
    dir_path = get_knowledge_directory().resolve()
    normalized = (file_name or "").strip()
    if not normalized:
        raise ValueError("Knowledge artefact name is required")
    candidate = (dir_path / normalized).resolve()
    if dir_path not in [candidate, *candidate.parents]:
        raise ValueError("Knowledge artefact path must stay within knowledge directory")
    return candidate


def list_knowledge_artefacts():
    dir_path = get_knowledge_directory()
    artefacts = []
    for entry in dir_path.rglob("*.md"):
        if entry.is_file() and entry.name.endswith(".md"):
            parsed = frontmatter.loads(entry.read_text(encoding="utf-8"))
            data = parsed.metadata or {}
            artefacts.append(
                {
                    "name": entry.relative_to(dir_path).as_posix(),
                    "type": data.get("type", "document"),
                    "tags": data.get("tags", []),
                    "content": parsed.content,
                    "frontmatter": data,
                }
            )
    return sorted(artefacts, key=lambda artefact: artefact["name"])


def read_knowledge_artefact(file_name: str):
    file_path = _knowledge_file_path(file_name)
    if not file_path.exists() or not file_path.is_file():
        raise FileNotFoundError("Knowledge artefact not found")
    parsed = frontmatter.loads(file_path.read_text(encoding="utf-8"))
    return {
        "content": parsed.content,
        "data": parsed.metadata,
        "frontmatter": parsed.metadata,
    }


def write_knowledge_artefact(file_name: str, frontmatter_data, content: str) -> None:
    file_path = _knowledge_file_path(file_name)
    file_path.parent.mkdir(parents=True, exist_ok=True)
    post = frontmatter.Post(content, **(frontmatter_data or {}))
    file_path.write_text(frontmatter.dumps(post), encoding="utf-8")


def delete_knowledge_artefact(file_name: str) -> None:
    file_path = _knowledge_file_path(file_name)
    file_path.unlink()
