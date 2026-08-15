#!/usr/bin/env python3
"""Build deterministic, PII-free EVO knowledge bundles for the runtime importer."""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import stat
import tempfile
import unicodedata
from uuid import UUID

try:
    from .review import contains_email, contains_phone
except ImportError:  # Direct CLI execution from the repository root.
    from review import contains_email, contains_phone

MARKER_FIELDS = {"kind", "canonical_path"}
FORBIDDEN_PARTS = {"Сырой архив ЭВО", "Секреты и доступы ЭВО"}
AUDIENCES = {"client", "internal"}
VAULT_KINDS = {
    "client": "evo_client_knowledge",
    "internal": "evo_internal_knowledge",
}


def digest(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def canonical(value: object) -> bytes:
    return (
        json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        + "\n"
    ).encode("utf-8")


def reject_symlink_components(path: Path, stop: Path | None = None) -> None:
    current = path.absolute()
    stop_absolute = stop.absolute() if stop else None
    while True:
        if current.is_symlink():
            raise ValueError(f"символические ссылки запрещены: {current}")
        if current == stop_absolute or current.parent == current:
            break
        current = current.parent


def load_marker(root: Path, expected_kind: str) -> tuple[dict, bytes]:
    if root.is_symlink() or not root.is_dir():
        raise ValueError("vault должен быть обычной папкой")
    marker_path = root / ".evo-vault.json"
    reject_symlink_components(marker_path, root)
    if marker_path.is_symlink() or not marker_path.is_file():
        raise ValueError("отсутствует обычный marker vault")
    raw = marker_path.read_bytes()
    try:
        marker = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError("marker должен быть валидным UTF-8 JSON") from error
    if not isinstance(marker, dict) or set(marker) != MARKER_FIELDS:
        raise ValueError("marker имеет неверную закрытую схему")
    if marker["kind"] != expected_kind or marker["canonical_path"] != str(root.resolve()):
        raise ValueError("marker не соответствует точному vault")
    return marker, raw


def resolve_source_root(vault: Path, audience: str) -> tuple[Path, Path, bytes]:
    if audience not in AUDIENCES:
        raise ValueError("audience должен быть client или internal")
    vault = vault.expanduser().absolute()
    reject_symlink_components(vault)
    if audience == "client":
        marker_root = vault
        source_root = vault
    else:
        if vault.name != "Утверждено для внутреннего ИИ":
            raise ValueError("internal требует точный approved child")
        marker_root = vault.parent
        if marker_root.name != "Внутренняя база знаний ЭВО":
            raise ValueError("approved child находится вне внутреннего vault")
        source_root = vault
    _, marker_bytes = load_marker(marker_root, VAULT_KINDS[audience])
    reject_symlink_components(source_root, marker_root)
    if source_root.is_symlink() or not source_root.is_dir():
        raise ValueError("source root должен быть обычной папкой")
    return marker_root, source_root, marker_bytes


def normalized_relative(path: Path, root: Path) -> str:
    relative = path.relative_to(root)
    value = unicodedata.normalize("NFC", relative.as_posix())
    parsed = PurePosixPath(value)
    if (
        not value
        or value.startswith("/")
        or "\\" in value
        or parsed.suffix.lower() != ".md"
        or any(part in {"", ".", ".."} or part.startswith(".") for part in parsed.parts)
        or any(part in FORBIDDEN_PARTS for part in parsed.parts)
    ):
        raise ValueError(f"недопустимый source_path: {value}")
    return value


def discover_documents(root: Path) -> list[dict]:
    documents: list[dict] = []
    seen: set[str] = set()
    def traversal_error(error: OSError) -> None:
        raise error

    for current, dirnames, filenames in os.walk(
        root, followlinks=False, onerror=traversal_error
    ):
        current_path = Path(current)
        for dirname in list(dirnames):
            candidate = current_path / dirname
            if dirname.startswith("."):
                dirnames.remove(dirname)
                continue
            if candidate.is_symlink():
                raise ValueError(f"символическая папка запрещена: {candidate}")
            if dirname in FORBIDDEN_PARTS:
                raise ValueError(f"запрещённая папка в knowledge vault: {dirname}")
        for filename in filenames:
            if filename.startswith("."):
                continue
            path = current_path / filename
            if not filename.lower().endswith(".md"):
                raise ValueError(f"видимый файл не является Markdown: {path}")
            reject_symlink_components(path, root)
            mode = path.lstat().st_mode
            if stat.S_ISLNK(mode) or not stat.S_ISREG(mode):
                raise ValueError(f"источник должен быть обычным Markdown: {path}")
            source_path = normalized_relative(path, root)
            if source_path in seen:
                raise ValueError(f"дублирующий source_path: {source_path}")
            raw = path.read_bytes()
            try:
                content = raw.decode("utf-8")
            except UnicodeDecodeError as error:
                raise ValueError(f"невалидный UTF-8: {source_path}") from error
            title = PurePosixPath(source_path).stem
            pii_text = f"{source_path}\n{title}\n{content}"
            if contains_email(pii_text) or contains_phone(pii_text):
                raise ValueError(f"обнаружены персональные данные: {source_path}")
            if not content.strip():
                raise ValueError(f"пустая заметка запрещена: {source_path}")
            seen.add(source_path)
            documents.append(
                {
                    "source_path": source_path,
                    "source_sha256": digest(raw),
                    "title": title,
                    "content": content,
                }
            )
    documents.sort(key=lambda item: item["source_path"])
    if not documents:
        raise ValueError("bundle не может быть пустым")
    return documents


def safe_output_dir(path: Path) -> None:
    if path.is_symlink() or not path.is_dir():
        raise ValueError("output directory должен быть новой обычной папкой")
    if any(path.iterdir()):
        raise ValueError("output directory должен быть пустым")
    path.chmod(0o700)


def build_bundle(vault: Path, account_id: str, audience: str, output_dir: Path) -> dict:
    account_id = str(UUID(account_id))
    marker_root, source_root, marker_bytes = resolve_source_root(vault, audience)
    safe_output_dir(output_dir)
    bundle_name = f"evo-knowledge-{audience}.json"
    manifest_name = f"evo-knowledge-{audience}.sha256.json"
    bundle = {
        "version": 1,
        "account_id": account_id,
        "audience": audience,
        "vault_kind": VAULT_KINDS[audience],
        "marker_sha256": digest(marker_bytes),
        "documents": discover_documents(source_root),
    }
    bundle_bytes = canonical(bundle)
    bundle_sha = digest(bundle_bytes)
    manifest = {
        "version": 1,
        "account_id": account_id,
        "audience": audience,
        "bundle_file": bundle_name,
        "bundle_sha256": bundle_sha,
    }
    manifest_bytes = canonical(manifest)
    bundle_path = output_dir / bundle_name
    manifest_path = output_dir / manifest_name
    report_path = output_dir / f"evo-knowledge-{audience}.report.json"
    bundle_path.write_bytes(bundle_bytes)
    manifest_path.write_bytes(manifest_bytes)
    report = {
        "version": 1,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "account_id": account_id,
        "audience": audience,
        "marker_root": str(marker_root),
        "document_count": len(bundle["documents"]),
        "bundle_sha256": bundle_sha,
        "manifest_sha256": digest(manifest_bytes),
        "output_directory": str(output_dir),
    }
    report_path.write_bytes(canonical(report))
    for path in (bundle_path, manifest_path, report_path):
        path.chmod(0o600)
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--vault", type=Path, required=True)
    parser.add_argument("--account-id", required=True)
    parser.add_argument("--audience", choices=sorted(AUDIENCES), required=True)
    args = parser.parse_args()
    output = Path(tempfile.mkdtemp(prefix="evo-knowledge-", dir="/private/tmp"))
    try:
        report = build_bundle(args.vault, args.account_id, args.audience, output)
    except Exception:
        shutil.rmtree(output)
        raise
    print(json.dumps(report, ensure_ascii=False, sort_keys=True))


if __name__ == "__main__":
    main()
