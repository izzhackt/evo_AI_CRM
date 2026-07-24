"""Create and verify a private online SQLite backup without exposing row data."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sqlite3
import time
from pathlib import Path

PRODUCTION_ROOTS = (Path("/opt/evo-crm"), Path("/opt/evo-inbox"), Path("/var/lib/docker"))
BROAD_ROOTS = (Path("/"), Path("/tmp"), Path("/var/tmp"))


def safe_destination(value: str) -> Path:
    destination = Path(value)
    if not destination.is_absolute():
        raise ValueError("backup destination must be absolute")
    if destination in BROAD_ROOTS:
        raise ValueError("backup destination is too broad")
    if destination.parent in (Path("/tmp"), Path("/var/tmp")):
        raise ValueError("backup destination requires a dedicated private directory")
    destination = destination.resolve()
    if any(destination == root or root in destination.parents for root in PRODUCTION_ROOTS):
        raise ValueError("backup destination must not be production-owned")
    return destination


def inspect_database(path: Path) -> dict[str, int | str]:
    with sqlite3.connect(f"file:{path}?mode=ro", uri=True) as connection:
        integrity = connection.execute("PRAGMA integrity_check").fetchall()
        if integrity != [("ok",)]:
            raise RuntimeError("SQLite integrity_check failed")
        if connection.execute("PRAGMA foreign_key_check").fetchall():
            raise RuntimeError("SQLite foreign_key_check failed")
        schema_version = connection.execute("PRAGMA schema_version").fetchone()[0]
        user_version = connection.execute("PRAGMA user_version").fetchone()[0]
        table_count = connection.execute(
            "SELECT count(*) FROM sqlite_schema "
            "WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
        ).fetchone()[0]
        if table_count < 1:
            raise RuntimeError("restored SQLite database contains no application tables")
    return {
        "integrityCheck": "ok",
        "foreignKeyCheck": "ok",
        "schemaVersion": schema_version,
        "userVersion": user_version,
        "tableCount": table_count,
    }


def backup(source: Path, destination: Path, store: str) -> dict:
    if not source.is_absolute() or not source.is_file():
        raise ValueError("SQLite source must be an existing absolute file")
    parent = destination.parent
    if parent.exists():
        stat = parent.stat()
        if not parent.is_dir() or stat.st_mode & 0o777 != 0o700 or stat.st_uid != os.getuid():
            raise ValueError("existing backup directory must be owned by the current user with mode 0700")
    else:
        ancestor = parent.parent
        stat = ancestor.stat()
        if not ancestor.is_dir() or stat.st_mode & 0o777 != 0o700 or stat.st_uid != os.getuid():
            raise ValueError("backup directory parent must be private and owned by the current user")
        parent.mkdir(mode=0o700)
    started = time.monotonic()
    with sqlite3.connect(f"file:{source}?mode=ro", uri=True) as source_db:
        with sqlite3.connect(destination) as destination_db:
            source_db.backup(destination_db, pages=128, sleep=0.05)
    destination.chmod(0o600)
    verification = inspect_database(destination)
    digest = hashlib.sha256(destination.read_bytes()).hexdigest()
    manifest = {
        "formatVersion": 1,
        "kind": "evo-sqlite-online-backup",
        "store": store,
        "artifact": destination.name,
        "bytes": destination.stat().st_size,
        "sha256": digest,
        "verification": verification,
        "durationMs": round((time.monotonic() - started) * 1000),
    }
    manifest_path = destination.with_suffix(destination.suffix + ".manifest.json")
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
    manifest_path.chmod(0o600)
    return manifest


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True, type=Path)
    parser.add_argument("--destination", required=True)
    parser.add_argument("--store", default="lead-agent")
    args = parser.parse_args()
    manifest = backup(args.source, safe_destination(args.destination), args.store)
    print(json.dumps({"status": "verified", **manifest}))


if __name__ == "__main__":
    os.umask(0o077)
    main()
