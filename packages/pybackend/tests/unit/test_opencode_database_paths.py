"""Exercise discovery caching with a real subprocess and SQLite read safety."""

from contextlib import closing
import sqlite3
import sys

import pytest

from opencode_database_agent_cli import OpenCodeDatabaseAgentCLI
from opencode_v2_agent_cli import OpenCodeV2AgentCLI


@pytest.fixture
def discovery(tmp_path, monkeypatch):
    executable = tmp_path / "opencode"
    database = tmp_path / "history.db"
    database.touch()
    pointer = tmp_path / "pointer"
    pointer.write_text(str(database))
    calls = tmp_path / "calls"
    executable.write_text(
        f"#!{sys.executable}\n"
        "from pathlib import Path\n"
        "import sys\n"
        f"calls = Path({str(calls)!r})\n"
        "with calls.open('a') as stream: stream.write('call\\n')\n"
        "assert sys.argv[1:] == ['debug', 'paths', 'db']\n"
        f"value = Path({str(pointer)!r}).read_text()\n"
        "if value == 'fail':\n"
        "    print('Discovery failed', file=sys.stderr)\n"
        "    sys.exit(1)\n"
        "print(value)\n"
    )
    executable.chmod(0o755)
    monkeypatch.setenv("PATH", str(tmp_path))
    monkeypatch.delenv("OPENCODE_DB", raising=False)
    return database, pointer, calls


def test_discovery_is_shared_by_new_adapters_and_rechecks_missing_path(discovery):
    database, pointer, calls = discovery
    assert OpenCodeV2AgentCLI()._database_path() == database
    assert OpenCodeV2AgentCLI()._database_path() == database
    assert calls.read_text().splitlines() == ["call"]

    replacement = database.with_name("replacement.db")
    replacement.touch()
    pointer.write_text(str(replacement))
    database.unlink()
    assert OpenCodeV2AgentCLI()._database_path() == replacement
    assert calls.read_text().splitlines() == ["call", "call"]


def test_discovery_does_not_cache_failure_or_invalid_output(discovery):
    database, pointer, calls = discovery
    pointer.write_text("fail")
    with pytest.raises(RuntimeError, match="Discovery failed"):
        OpenCodeV2AgentCLI()._database_path()
    pointer.write_text("relative.db")
    with pytest.raises(ValueError, match="non-absolute"):
        OpenCodeV2AgentCLI()._database_path()
    pointer.write_text(str(database.with_name("absent.db")))
    with pytest.raises(FileNotFoundError, match="database not found"):
        OpenCodeV2AgentCLI()._database_path()
    pointer.write_text(str(database))
    assert OpenCodeV2AgentCLI()._database_path() == database
    assert len(calls.read_text().splitlines()) == 4


def test_v2_override_is_immediate_and_environment_changes_rediscover(
    discovery, monkeypatch
):
    database, pointer, calls = discovery
    assert OpenCodeV2AgentCLI()._database_path() == database
    override = database.with_name("override.db")
    monkeypatch.setenv("OPENCODE_DB", str(override))
    assert OpenCodeV2AgentCLI()._database_path() == override
    assert calls.read_text().splitlines() == ["call"]

    monkeypatch.setenv("OPENCODE_DB", ":memory:")
    with pytest.raises(ValueError, match="in-memory"):
        OpenCodeV2AgentCLI()._database_path()
    monkeypatch.delenv("OPENCODE_DB")
    monkeypatch.setenv("XDG_DATA_HOME", str(database.parent / "new-home"))
    pointer.write_text(str(database))
    assert OpenCodeV2AgentCLI()._database_path() == database
    assert len(calls.read_text().splitlines()) == 2


def test_v1_native_override_and_legacy_precedence(tmp_path, monkeypatch):
    native = tmp_path / "native.db"
    legacy = tmp_path / "legacy.db"
    native.touch()
    legacy.touch()
    monkeypatch.delenv("OPENCODE_DATABASE_PATH", raising=False)
    monkeypatch.setenv("OPENCODE_DB", str(native))
    adapter = OpenCodeDatabaseAgentCLI()
    assert adapter._get_database_path() == native
    monkeypatch.setenv("OPENCODE_DATABASE_PATH", str(legacy))
    assert adapter._get_database_path() == legacy
    monkeypatch.delenv("OPENCODE_DATABASE_PATH")
    monkeypatch.setenv("OPENCODE_DB", str(tmp_path / "missing.db"))
    assert adapter._get_database_path() is None
    monkeypatch.setenv("OPENCODE_DB", ":memory:")
    assert adapter._get_database_path() is None


def test_v1_history_connections_are_read_only_and_missing_files_are_not_created(
    tmp_path,
):
    database = tmp_path / "history with spaces.db"
    with closing(sqlite3.connect(database)) as connection:
        connection.execute("CREATE TABLE sample (value TEXT)")
        connection.execute("INSERT INTO sample VALUES ('retained')")
        connection.commit()
    adapter = OpenCodeDatabaseAgentCLI()
    with closing(adapter._connect_database(database)) as connection:
        assert connection.execute("SELECT value FROM sample").fetchone() == ("retained",)
        with pytest.raises(sqlite3.OperationalError, match="readonly"):
            connection.execute("DELETE FROM sample")
        assert connection.execute("SELECT count(*) FROM sample").fetchone() == (1,)
    missing = tmp_path / "absent.db"
    with pytest.raises(sqlite3.OperationalError):
        adapter._connect_database(missing)
    assert not missing.exists()
