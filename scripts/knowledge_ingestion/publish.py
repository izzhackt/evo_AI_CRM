#!/usr/bin/env python3
"""Идемпотентно публикует одобренные Codex-факты во внутренний vault."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path

MATERIAL = ("гарант", "возврат", "цена", "стоимост", "договор", "обязательств", "виза", "пароль", "токен", "секрет")


def safe_name(value: str) -> str:
    cleaned = re.sub(r"[\\/:*?\"<>|]", "-", value).strip().strip(".")
    return cleaned[:100] or "Без названия"


def material(item: dict) -> bool:
    text = " ".join([item.get("title", ""), item.get("summary", ""), *item.get("facts", [])]).casefold()
    return any(word in text for word in MATERIAL)


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
    parser.add_argument("--vault", type=Path, required=True)
    parser.add_argument("--authorized-root", type=Path, required=True)
    args = parser.parse_args(argv)
    try:
        reviews = args.reviews.expanduser().resolve()
        vault = args.vault.expanduser().resolve()
        root = args.authorized_root.expanduser().resolve()
        if not reviews.is_dir():
            raise FileNotFoundError(f"результаты проверки не найдены: {reviews}")
        if vault == root or root not in vault.parents:
            raise ValueError(f"vault должен находиться внутри разрешённого корня: {root}")
        approved = escalated = ignored = 0
        escalation = vault / "Требует решения"
        for review in sorted(reviews.glob("Пакет *.json")):
            data = json.loads(review.read_text(encoding="utf-8"))
            for item in data.get("items", []):
                decision = item.get("decision")
                if decision == "ignore":
                    ignored += 1
                    continue
                if decision != "approve" or material(item):
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
        print(json.dumps({"утверждено": approved, "требует_решения": escalated, "игнорировано": ignored}, ensure_ascii=False))
        return 0
    except (FileNotFoundError, ValueError, json.JSONDecodeError) as error:
        print(f"Ошибка: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
