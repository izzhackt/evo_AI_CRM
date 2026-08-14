#!/usr/bin/env python3
"""Идемпотентно публикует одобренные Codex-факты во внутренний vault."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path

from review import load_allowed_sources, review_fingerprint, validate_result

MATERIAL = ("гарант", "guarantee", "возврат", "refund", "цена", "стоимост", "тариф", "оплат", "договор", "контракт", "contract", "обязательств", "виза", "visa", "пароль", "токен", "секрет")
AUTHORITY = {"legacy_or_unknown": 0, "confirmed_correspondence": 1, "evo_active_document": 2, "official_source": 3, "signed_contract": 4, "owner_director": 5}


def safe_name(value: str) -> str:
    cleaned = re.sub(r"[\\/:*?\"<>|]", "-", value).strip().strip(".")
    return cleaned[:100] or "Без названия"


def material(item: dict) -> bool:
    text = " ".join([item.get("title", ""), item.get("summary", ""), *item.get("facts", [])]).casefold()
    return any(word in text for word in MATERIAL)


def validate_internal_vault(vault: Path, root: Path) -> None:
    root = root.expanduser().resolve()
    vault = vault.expanduser().resolve()
    marker = root / ".evo-vault.json"
    if root.name != "Внутренняя база знаний ЭВО" or vault.name != "Утверждено для внутреннего ИИ" or root not in vault.parents or not marker.is_file():
        raise ValueError("публикация разрешена только в 'Внутренняя база знаний ЭВО/Утверждено для внутреннего ИИ'")
    data = json.loads(marker.read_text(encoding="utf-8"))
    if data != {"kind": "evo_internal_knowledge", "canonical_path": str(root)}:
        raise ValueError("marker внутреннего vault не совпадает с его canonical path")


def render(item: dict, status: str) -> str:
    sources = sorted(set(item["sources"]))
    lines = ["---", f"статус: {status}", "язык: ru", "источники:"]
    lines.extend(f"  - {source}" for source in sources)
    lines.extend(["---", "", f"# {item['title']}", "", item.get("summary", "").strip(), "", "## Факты", ""])
    lines.extend(f"- {fact}" for fact in item.get("facts", []))
    lines.extend(["", "## Происхождение", ""])
    lines.extend(f"- SHA-256: `{source}`" for source in sources)
    return "\n".join(lines).rstrip() + "\n"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Опубликовать одобренные русские заметки во внутренний Obsidian vault.")
    parser.add_argument("--reviews", type=Path, required=True)
    parser.add_argument("--queue", type=Path, required=True)
    parser.add_argument("--vault", type=Path, required=True)
    parser.add_argument("--authorized-root", type=Path, required=True)
    args = parser.parse_args(argv)
    try:
        reviews = args.reviews.expanduser().resolve()
        queue = args.queue.expanduser().resolve()
        vault = args.vault.expanduser().resolve()
        root = args.authorized_root.expanduser().resolve()
        if not reviews.is_dir():
            raise FileNotFoundError(f"результаты проверки не найдены: {reviews}")
        validate_internal_vault(vault, root)
        allowed_sources, batch_hashes = load_allowed_sources(queue, reviews.parent)
        approved = escalated = ignored = 0
        escalation = vault / "Требует решения"
        all_items: list[dict] = []
        for review in sorted(reviews.glob("Пакет *.json")):
            fingerprint_path = review.with_suffix(".sha256")
            batch_name = f"{review.stem}.md"
            batch = queue / batch_name
            if not fingerprint_path.is_file() or not batch.is_file():
                raise ValueError(f"у результата нет fingerprint проверенного пакета: {review.name}")
            fingerprint = fingerprint_path.read_text(encoding="utf-8").strip()
            batch_text = batch.read_text(encoding="utf-8")
            actual_batch = hashlib.sha256(batch_text.encode()).hexdigest()
            expected_review = review_fingerprint(batch_text)
            if not re.fullmatch(r"[a-f0-9]{64}", fingerprint) or fingerprint != expected_review or batch_hashes.get(batch_name) != actual_batch:
                raise ValueError(f"fingerprint результата не совпадает с текущим K2-пакетом: {review.name}")
            batch_sources = set(re.findall(r"(?m)^## ([a-f0-9]{64})", batch_text))
            if not batch_sources <= allowed_sources:
                raise ValueError(f"пакет содержит запрещённый источник: {batch_name}")
            data = validate_result(json.loads(review.read_text(encoding="utf-8")), batch_sources)
            all_items.extend(data["items"])
        claim_groups: dict[str, set[str]] = {}
        for item in all_items:
            key = item["claim_key"]
            content = f"{item['summary'].strip()}::{json.dumps(item['facts'], ensure_ascii=False, sort_keys=True)}"
            claim_groups.setdefault(key, set()).add(content)
        manifest_path = vault / ".Манифест публикации Codex.json"
        previous_paths: set[str] = set()
        if manifest_path.is_file():
            previous = json.loads(manifest_path.read_text(encoding="utf-8"))
            if not isinstance(previous, dict) or not isinstance(previous.get("files"), list):
                raise ValueError("повреждён манифест публикации Codex")
            previous_paths = {value for value in previous["files"] if isinstance(value, str)}
        current_paths: set[str] = set()
        for item in all_items:
            decision = item.get("decision")
            if decision == "ignore":
                ignored += 1
                continue
            conflict_key = item["claim_key"]
            group_items = [candidate for candidate in all_items if candidate.get("decision") == "approve" and candidate["claim_key"] == conflict_key]
            max_authority = max((AUTHORITY[candidate["authority"]] for candidate in group_items), default=-1)
            highest = [candidate for candidate in group_items if AUTHORITY[candidate["authority"]] == max_authority]
            unresolved_conflict = len(claim_groups[conflict_key]) > 1 and (len(highest) != 1 or item is not highest[0])
            if decision != "approve" or material(item) or unresolved_conflict:
                target_dir = escalation
                status = "требует_решения"
                escalated += 1
            else:
                target_dir = vault / safe_name(item.get("section", "Неопределенное"))
                status = "утверждено_для_внутреннего_ИИ"
                approved += 1
            identity = hashlib.sha256((item.get("title", "") + "\n" + "\n".join(sorted(item.get("sources", [])))).encode()).hexdigest()[:12]
            target_dir.mkdir(parents=True, exist_ok=True)
            target = target_dir / f"{safe_name(item.get('title', 'Без названия'))} — {identity}.md"
            target.write_text(render(item, status), encoding="utf-8")
            current_paths.add(str(target.relative_to(vault)))
        for relative in previous_paths - current_paths:
            stale = (vault / relative).resolve()
            if vault in stale.parents and stale.is_file():
                stale.unlink()
        manifest_path.parent.mkdir(parents=True, exist_ok=True)
        manifest_path.write_text(json.dumps({"files": sorted(current_paths)}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(json.dumps({"утверждено": approved, "требует_решения": escalated, "игнорировано": ignored}, ensure_ascii=False))
        return 0
    except (FileNotFoundError, ValueError, json.JSONDecodeError) as error:
        print(f"Ошибка: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
