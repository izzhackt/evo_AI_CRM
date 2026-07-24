import importlib.util
import json
import sqlite3
from pathlib import Path

import pytest

SCRIPT_PATH = Path(__file__).parents[1] / "scripts" / "backup_sqlite.py"
SPEC = importlib.util.spec_from_file_location("backup_sqlite", SCRIPT_PATH)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)
backup = MODULE.backup
safe_destination = MODULE.safe_destination


@pytest.mark.parametrize(
    "destination",
    ["/", "/tmp", "/var/tmp", "/tmp/x.db", "/var/tmp/x.db", "/opt/evo-crm/x.db", "/opt/evo-inbox/x.db", "relative.db"],
)
def test_rejects_broad_production_and_relative_destinations(destination: str) -> None:
    with pytest.raises(ValueError):
        safe_destination(destination)


def test_online_backup_is_private_complete_and_verified(tmp_path: Path) -> None:
    tmp_path.chmod(0o700)
    source = tmp_path / "source.db"
    with sqlite3.connect(source) as connection:
        connection.execute("CREATE TABLE records (id INTEGER PRIMARY KEY, value TEXT)")
        connection.execute("INSERT INTO records(value) VALUES ('protected')")

    destination = tmp_path / "isolated" / "restored.db"
    manifest = backup(source, destination, "lead-agent")
    manifest_path = destination.with_suffix(".db.manifest.json")

    assert manifest["verification"]["integrityCheck"] == "ok"
    assert manifest["verification"]["foreignKeyCheck"] == "ok"
    assert manifest["verification"]["tableCount"] == 1
    assert destination.stat().st_mode & 0o777 == 0o600
    assert manifest_path.stat().st_mode & 0o777 == 0o600
    assert json.loads(manifest_path.read_text())["sha256"] == manifest["sha256"]


def test_failed_backup_does_not_change_existing_parent_mode(tmp_path: Path) -> None:
    source = tmp_path / "source.db"
    with sqlite3.connect(source) as connection:
        connection.execute("CREATE TABLE records (id INTEGER PRIMARY KEY)")
    tmp_path.chmod(0o755)
    with pytest.raises(ValueError, match="mode 0700"):
        backup(source, tmp_path / "backup.db", "lead-agent")
    assert tmp_path.stat().st_mode & 0o777 == 0o755
