from pathlib import Path
import frontmatter

from config import ensure_made_structure


def get_knowledge_directory() -> Path:
    made_dir = ensure_made_structure()
    return made_dir / "knowledge"


def list_knowledge_artefacts():
    dir_path = get_knowledge_directory()
    artefacts = []
    for entry in dir_path.iterdir():
        if entry.is_file() and entry.name.endswith(".md"):
            parsed = frontmatter.loads(entry.read_text(encoding="utf-8"))
            data = parsed.metadata or {}
            artefacts.append(
                {
                    "name": entry.name,
                    "type": data.get("type", "document"),
                    "tags": data.get("tags", []),
                    "content": parsed.content,
                    "frontmatter": data,
                }
            )
    return sorted(artefacts, key=lambda artefact: artefact["name"])


def read_knowledge_artefact(file_name: str):
    dir_path = get_knowledge_directory()
    file_path = dir_path / file_name
    parsed = frontmatter.loads(file_path.read_text(encoding="utf-8"))
    return {
        "content": parsed.content,
        "data": parsed.metadata,
        "frontmatter": parsed.metadata,
    }


def write_knowledge_artefact(file_name: str, frontmatter_data, content: str) -> None:
    dir_path = get_knowledge_directory()
    file_path = dir_path / file_name
    post = frontmatter.Post(content, **(frontmatter_data or {}))
    file_path.write_text(frontmatter.dumps(post), encoding="utf-8")
