#!/usr/bin/env python3
"""Fail-closed publication of explicitly allowlisted internal notes to the client vault."""

from __future__ import annotations

import argparse
from datetime import date
import hashlib
import json
import re
from pathlib import Path, PurePosixPath

try:
    from .review import contains_email, contains_phone
except ImportError:  # Direct CLI execution from the repository root.
    from review import contains_email, contains_phone

MARKER_FIELDS = {"kind", "canonical_path"}
ALLOWLIST_FIELDS = {"version", "entries"}
ENTRY_FIELDS = {
    "source_relative_path", "source_sha256", "destination_relative_path",
    "content_class", "personal_data_reviewed", "authority",
    "authority_reference", "official_url", "verified_at",
}
MANIFEST_FIELDS = {"version", "files"}
MANIFEST_ENTRY_FIELDS = {"path", "source_sha256", "output_sha256"}
MANAGED_MARKER = "управляется: evo_client_publisher"
SENSITIVE = ("пароль", "токен", "секрет", "паспорт", "персональн", "требует_решения", "доступ_для_клиентского_ии: false")


def reject_symlink_components(path: Path, label: str) -> None:
    raw = path.expanduser().absolute()
    for component in (raw, *raw.parents):
        if component.exists() and component.is_symlink():
            raise ValueError(f"{label}: символические ссылки запрещены")


def digest_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def load_closed(path: Path, fields: set[str], label: str) -> dict:
    if path.is_symlink() or not path.is_file():
        raise ValueError(f"{label}: требуется обычный файл")
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict) or set(data) != fields:
        raise ValueError(f"{label}: неверная закрытая схема")
    return data


def validate_marker(vault: Path) -> None:
    if vault.is_symlink() or not vault.is_dir():
        raise ValueError("клиентский vault должен быть обычной папкой")
    marker = load_closed(vault / ".evo-vault.json", MARKER_FIELDS, "marker")
    if marker["kind"] != "evo_client_knowledge" or marker["canonical_path"] != str(vault.resolve()):
        raise ValueError("marker не соответствует точному клиентскому vault")


def validate_approved_vault(approved: Path) -> None:
    if approved.is_symlink() or not approved.is_dir() or approved.name != "Утверждено для внутреннего ИИ":
        raise ValueError("разрешён только точный approved vault")
    root = approved.parent
    if root.is_symlink() or root.name != "Внутренняя база знаний ЭВО":
        raise ValueError("approved vault должен находиться в отмеченной внутренней базе")
    marker = load_closed(root / ".evo-vault.json", MARKER_FIELDS, "internal marker")
    if marker["kind"] != "evo_internal_knowledge" or marker["canonical_path"] != str(root.resolve()):
        raise ValueError("internal marker не соответствует точному vault")


def relative_markdown(value: object, label: str) -> PurePosixPath:
    if not isinstance(value, str) or "\\" in value:
        raise ValueError(f"{label}: нужен относительный POSIX-путь")
    path = PurePosixPath(value)
    if path.is_absolute() or path.suffix.lower() != ".md" or any(part in {"", ".", ".."} for part in path.parts):
        raise ValueError(f"{label}: небезопасный Markdown-путь")
    return path


def russian_path(path: PurePosixPath) -> bool:
    return bool(re.search(r"[А-Яа-яЁё]", str(path.with_suffix(""))))


def frontmatter(text: str) -> dict[str, str]:
    if not text.startswith("---\n"):
        return {}
    end = text.find("\n---\n", 4)
    if end < 0:
        return {}
    fields: dict[str, str] = {}
    for line in text[4:end].splitlines():
        if ":" in line and not line.startswith((" ", "\t")):
            key, value = line.split(":", 1)
            fields[key.strip()] = value.strip()
    return fields


def within(root: Path, relative: PurePosixPath) -> Path:
    candidate = root
    for part in relative.parts:
        candidate = candidate / part
        if candidate.is_symlink():
            raise ValueError("путь проходит через символическую ссылку")
    if root.resolve() not in (candidate.resolve(strict=False), *candidate.resolve(strict=False).parents):
        raise ValueError("путь выходит за границы vault")
    return candidate


def strip_frontmatter(text: str) -> str:
    if text.startswith("---\n"):
        end = text.find("\n---\n", 4)
        if end >= 0:
            return text[end + 5:].lstrip()
    return text


def validate_entry(entry: object, approved: Path, client: Path) -> tuple[dict, Path, Path, str]:
    if not isinstance(entry, dict) or set(entry) != ENTRY_FIELDS:
        raise ValueError("allowlist entry: неверная закрытая схема")
    source_rel = relative_markdown(entry["source_relative_path"], "source_relative_path")
    destination_rel = relative_markdown(entry["destination_relative_path"], "destination_relative_path")
    if not russian_path(destination_rel):
        raise ValueError("destination_relative_path должен быть на русском языке")
    source = within(approved, source_rel)
    destination = within(client, destination_rel)
    if source.is_symlink() or not source.is_file():
        raise ValueError("источник должен быть обычным Markdown-файлом")
    source_bytes = source.read_bytes()
    if not re.fullmatch(r"[0-9a-f]{64}", str(entry["source_sha256"])) or digest_bytes(source_bytes) != entry["source_sha256"]:
        raise ValueError("SHA-256 источника не совпадает")
    text = source_bytes.decode("utf-8")
    lowered = text.casefold()
    if "язык: ru" not in lowered or not re.search(r"[А-Яа-яЁё]", text) or "статус: утверждено_для_внутреннего_ии" not in lowered or any(token in lowered for token in SENSITIVE):
        raise ValueError("источник не разрешён для клиентской публикации")
    authority = entry["authority"]
    reference = entry["authority_reference"]
    reference_rel = relative_markdown(reference, "authority_reference")
    reference_path = within(approved, reference_rel)
    if reference_path.is_symlink() or not reference_path.is_file():
        raise ValueError("authority_reference должен указывать на существующую внутреннюю заметку")
    reference_raw = reference_path.read_text(encoding="utf-8")
    reference_fields = frontmatter(reference_raw)
    content_class = entry["content_class"]
    if entry["personal_data_reviewed"] is not True:
        raise ValueError("personal_data_reviewed должен быть true")
    if contains_email(text) or contains_phone(text):
        raise ValueError("источник содержит email или телефон")
    if content_class == "stable_evo_policy" and authority == "owner_decision":
        if entry["official_url"] is not None or entry["verified_at"] is not None:
            raise ValueError("owner_decision требует null official fields")
        if reference_fields.get("тип") != "решение_владельца" or reference_fields.get("статус") != "решено":
            raise ValueError("owner_decision не подтверждён заметкой решения")
    elif content_class == "mutable_official_fact" and authority == "official_source":
        if not isinstance(entry["official_url"], str) or not entry["official_url"].startswith("https://"):
            raise ValueError("official_source требует HTTPS URL")
        if not isinstance(entry["verified_at"], str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", entry["verified_at"]):
            raise ValueError("official_source требует дату YYYY-MM-DD")
        try:
            date.fromisoformat(entry["verified_at"])
        except ValueError as error:
            raise ValueError("official_source требует реальную календарную дату") from error
        if reference_fields.get("тип") != "протокол_проверки":
            raise ValueError("official_source не подтверждён заметкой проверки")
        try:
            date.fromisoformat(reference_fields.get("дата_проверки", ""))
        except ValueError as error:
            raise ValueError("протокол проверки требует реальную дату_проверки") from error
    else:
        raise ValueError("content_class не соответствует authority")
    if destination.exists() and (destination.is_symlink() or not destination.is_file() or MANAGED_MARKER not in destination.read_text(encoding="utf-8")):
        raise ValueError("нельзя перезаписать неуправляемый файл")
    return entry, source, destination, text


def render(entry: dict, text: str) -> bytes:
    url = "null" if entry["official_url"] is None else json.dumps(entry["official_url"], ensure_ascii=False)
    date = "null" if entry["verified_at"] is None else entry["verified_at"]
    header = (
        "---\nтип: клиентское_знание\nуправляется: evo_client_publisher\n"
        f"источник_внутренней_базы: {json.dumps(entry['source_relative_path'], ensure_ascii=False)}\n"
        f"источник_sha256: {entry['source_sha256']}\nавторитет: {entry['authority']}\n"
        f"класс_содержания: {entry['content_class']}\nперсональные_данные_проверены: true\n"
        f"подтверждение: {json.dumps(entry['authority_reference'], ensure_ascii=False)}\n"
        f"официальный_url: {url}\nпроверено: {date}\n---\n\n"
    )
    return (header + strip_frontmatter(text)).encode("utf-8")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--approved-vault", type=Path, required=True)
    parser.add_argument("--client-vault", type=Path, required=True)
    parser.add_argument("--allowlist", type=Path, required=True)
    args = parser.parse_args(argv)
    reject_symlink_components(args.approved_vault, "approved vault")
    reject_symlink_components(args.client_vault, "client vault")
    approved, client, allowlist = args.approved_vault.resolve(), args.client_vault.resolve(), args.allowlist
    validate_approved_vault(approved)
    validate_marker(client)
    if allowlist.name != ".Публикация клиентской базы.json" or allowlist.parent.resolve() != client:
        raise ValueError("allowlist разрешён только в корне клиентского vault")
    data = load_closed(allowlist, ALLOWLIST_FIELDS, "allowlist")
    if data["version"] != 1 or not isinstance(data["entries"], list):
        raise ValueError("allowlist: поддерживается только version 1")
    validated = [validate_entry(entry, approved, client) for entry in data["entries"]]
    destinations = [str(PurePosixPath(entry["destination_relative_path"])) for entry, *_ in validated]
    if len(destinations) != len(set(destinations)):
        raise ValueError("destination_relative_path должен быть уникальным")

    manifest_path = client / ".Манифест клиентской публикации.json"
    old_files: list[dict] = []
    if manifest_path.exists():
        manifest = load_closed(manifest_path, MANIFEST_FIELDS, "manifest")
        if manifest["version"] != 1 or not isinstance(manifest["files"], list):
            raise ValueError("manifest: поддерживается только version 1")
        for item in manifest["files"]:
            if not isinstance(item, dict) or set(item) != MANIFEST_ENTRY_FIELDS:
                raise ValueError("manifest entry: неверная закрытая схема")
            manifest_relative = relative_markdown(item["path"], "manifest path")
            within(client, manifest_relative)
            if not re.fullmatch(r"[0-9a-f]{64}", str(item["source_sha256"])) or not re.fullmatch(r"[0-9a-f]{64}", str(item["output_sha256"])):
                raise ValueError("manifest entry: неверный SHA-256")
        old_files = manifest["files"]

    current = set(destinations)
    stale_candidates: list[Path] = []
    for item in old_files:
        if item["path"] in current:
            continue
        stale = within(client, relative_markdown(item["path"], "manifest path"))
        if stale.exists():
            if stale.is_symlink() or not stale.is_file():
                raise ValueError("stale candidate должен быть обычным файлом")
            stale_text = stale.read_text(encoding="utf-8")
            if MANAGED_MARKER in stale_text:
                stale_candidates.append(stale)

    outputs = []
    for entry, _, destination, text in validated:
        payload = render(entry, text)
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(payload)
        outputs.append({"path": entry["destination_relative_path"], "source_sha256": entry["source_sha256"], "output_sha256": digest_bytes(payload)})

    for stale in stale_candidates:
        stale.unlink()
    manifest_path.write_text(json.dumps({"version": 1, "files": outputs}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
