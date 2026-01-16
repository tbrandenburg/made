import frontmatter


def test_write_constitution_creates_file(tmp_path, monkeypatch):
    monkeypatch.setenv("MADE_HOME", str(tmp_path))

    from constitution_service import (
        get_constitution_directory,
        read_constitution,
        write_constitution,
    )

    name = "governance.md"
    content = "# Rules\n- Always test"
    metadata = {"type": "global", "tags": ["policy"]}

    write_constitution(name, metadata, content)

    constitution_dir = get_constitution_directory()
    file_path = constitution_dir / name

    assert file_path.exists()

    parsed = frontmatter.loads(file_path.read_text(encoding="utf-8"))
    assert parsed.content == content
    assert parsed.metadata == metadata

    stored = read_constitution(name)
    assert stored["content"] == content
    assert stored["frontmatter"] == metadata


def test_write_knowledge_creates_file(tmp_path, monkeypatch):
    monkeypatch.setenv("MADE_HOME", str(tmp_path))

    from knowledge_service import (
        get_knowledge_directory,
        read_knowledge_artefact,
        write_knowledge_artefact,
    )

    name = "notes.md"
    content = "# Notes\nDetails about the system."
    metadata = {"type": "document", "tags": ["notes", "docs"]}

    write_knowledge_artefact(name, metadata, content)

    knowledge_dir = get_knowledge_directory()
    file_path = knowledge_dir / name

    assert file_path.exists()

    parsed = frontmatter.loads(file_path.read_text(encoding="utf-8"))
    assert parsed.content == content
    assert parsed.metadata == metadata

    stored = read_knowledge_artefact(name)
    assert stored["content"] == content
    assert stored["frontmatter"] == metadata
