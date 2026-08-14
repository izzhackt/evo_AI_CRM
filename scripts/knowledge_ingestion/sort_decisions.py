#!/usr/bin/env python3
"""Строит русскую панель решений поверх опубликованных заметок EVO."""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

from publish import validate_internal_vault

CATEGORIES = {
    "Исключить из базы ИИ": ("Сначала — быстрое исключение", "Не превращать в общие знания. Оставить только в закрытом сыром архиве; доступы проверить отдельно."),
    "Обещания, визы и договоры": ("Критично — решение владельца или руководителя", "Выбрать допустимую формулировку обещания и сверить её с действующим договором. Юридические механики не додумывать."),
    "Цены и финансовые условия": ("Высокий приоритет — влияет на продажи", "Зафиксировать валюту, сумму, что включено, срок действия и источник цены. Индивидуальные счета исключить."),
    "Проверить актуальность по официальному источнику": ("Высокий приоритет — проверить пакетно", "Сверить требования, программы, даты и наборы с актуальной официальной страницей или свежим документом партнёра."),
    "Подтвердить у владельца или руководителя": ("Средний приоритет — внутреннее знание", "Подтвердить, что процесс, роль, партнёрство или скрипт действительно используется сейчас."),
    "Архивировать или уточнить контекст": ("Низкий приоритет", "Если материал не нужен для ответов ИИ — архивировать. Иначе запросить контекст и владельца информации."),
}


def category(item: dict) -> str:
    text = " ".join([item.get("title", ""), item.get("summary", ""), item.get("reason", ""), " ".join(item.get("facts", []))]).casefold()
    reason = item.get("reason", "").casefold()
    title = item.get("title", "").casefold()
    sensitive = ("парол", "учетн", "учётн", "токен", "уведомление безопасности", "вход с нового устройства", "доступ к аккаун", "реквизит")
    individual = ("персональные данные", "индивидуальн")
    sensitive_titles = ("invoice", "справка об обучении заявителя", "жалоба клиента", "операционные расходы", "анкета заявителя", "данными студентов")
    if any(word in text for word in sensitive) or any(word in reason for word in individual) or any(word in title for word in sensitive_titles):
        return "Исключить из базы ИИ"
    legal = ("гарант", "возврат", "компенсац", "договор", "контракт", "юридичес", "обязательств")
    visa_rule = "виз" in text and any(word in text for word in ("правил", "срок", "статус", "обещ"))
    if any(word in text for word in legal) or visa_rule:
        return "Обещания, визы и договоры"
    finance = ("цен", "стоим", "оплат", "тариф", "скид", "депозит", "бюджет", "сбор", "tuition", " fee", "стипенд", "расход")
    if any(word in text for word in finance):
        return "Цены и финансовые условия"
    official = ("требован", "intake", "дедлайн", "программ", "поступлен", "университет")
    if item.get("authority") == "official_source" or item.get("section") == "Университеты" or any(word in text for word in official):
        return "Проверить актуальность по официальному источнику"
    if item.get("section") in {"Компания", "Команда", "Процессы", "Партнеры", "Продажи и ответы"}:
        return "Подтвердить у владельца или руководителя"
    return "Архивировать или уточнить контекст"


def parse_note(path: Path) -> tuple[str, tuple[str, ...]]:
    content = path.read_text(encoding="utf-8")
    title = re.search(r"(?m)^# (.+)$", content)
    sources = tuple(sorted(set(re.findall(r"(?m)^  - ([a-f0-9]{64})$", content))))
    if not title or not sources:
        raise ValueError(f"заметка имеет неверный формат: {path.name}")
    return title.group(1).strip(), sources


def load_items(reviews: Path) -> dict[tuple[str, tuple[str, ...]], dict]:
    result = {}
    for path in sorted(reviews.glob("Пакет *.json")):
        for item in json.loads(path.read_text(encoding="utf-8"))["items"]:
            result[(item["title"].strip(), tuple(sorted(set(item["sources"]))))] = item
    return result


def managed_path(dashboard: Path, name: str) -> Path:
    if not name or Path(name).name != name or not name.endswith(".md") or name.startswith(".") or ".." in name:
        raise ValueError("манифест панели содержит небезопасное имя файла")
    target = (dashboard / name).resolve()
    if target.parent != dashboard.resolve():
        raise ValueError("манифест панели выходит за разрешённую папку")
    return target


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Отсортировать заметки 'Требует решения' в Obsidian.")
    parser.add_argument("--reviews", type=Path, required=True)
    parser.add_argument("--vault", type=Path, required=True)
    parser.add_argument("--authorized-root", type=Path, required=True)
    args = parser.parse_args(argv)
    try:
        reviews = args.reviews.expanduser().resolve()
        vault = args.vault.expanduser().resolve()
        root = args.authorized_root.expanduser().resolve()
        validate_internal_vault(vault, root)
        unresolved = vault / "Требует решения"
        if not reviews.is_dir() or not unresolved.is_dir():
            raise FileNotFoundError("не найдены результаты проверки или папка 'Требует решения'")
        review_items = load_items(reviews)
        grouped: dict[str, list[tuple[Path, dict]]] = defaultdict(list)
        for note in sorted(unresolved.glob("*.md")):
            item = review_items.get(parse_note(note))
            if item is None:
                raise ValueError(f"для заметки не найден исходный результат Codex: {note.name}")
            grouped[category(item)].append((note, item))
        note_count = len(list(unresolved.glob("*.md")))
        if sum(map(len, grouped.values())) != note_count:
            raise ValueError("не все заметки попали в панель решений")

        dashboard = vault / "Панель решений"
        dashboard.mkdir(exist_ok=True)
        manifest_path = dashboard / ".Манифест панели решений.json"
        previous_generated: set[str] = set()
        if manifest_path.is_file():
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            if not isinstance(manifest, dict) or not isinstance(manifest.get("files"), list):
                raise ValueError("повреждён манифест панели решений")
            if any(not isinstance(name, str) for name in manifest["files"]):
                raise ValueError("манифест панели содержит неверное имя файла")
            previous_generated = set(manifest["files"])
            for name in previous_generated:
                managed_path(dashboard, name)
        generated = {"Главная панель.md"}
        for name, (priority, action) in CATEGORIES.items():
            rows = sorted(grouped.get(name, []), key=lambda pair: (pair[1].get("section", ""), pair[1]["title"].casefold()))
            lines = ["---", "тип: панель_решений", "язык: ru", "---", "", f"# {name}", "", f"**Приоритет:** {priority}", "", f"**Рекомендуемое решение:** {action}", "", f"Всего пунктов: **{len(rows)}**", "", "## Чек-лист", ""]
            for note, item in rows:
                link = f"[[Требует решения/{note.stem}|{item['title']}]]"
                lines.append(f"- [ ] {link} — {item.get('section', 'Неопределенное')}; источник: `{item.get('authority', 'legacy_or_unknown')}`")
            filename = f"{name}.md"
            generated.add(filename)
            (dashboard / filename).write_text("\n".join(lines).rstrip() + "\n", encoding="utf-8")

        counts = Counter({name: len(grouped.get(name, [])) for name in CATEGORIES})
        lines = ["---", "тип: главная_панель_решений", "язык: ru", "---", "", "# Панель решений EVO", "", f"Всего нерешённых пунктов: **{sum(counts.values())}**.", "", "## Самый быстрый порядок", "", "1. Исключить чувствительные и индивидуальные материалы — это не требует утверждения факта.", "2. Одним решением согласовать правила обещаний, виз и договоров.", "3. Пакетно подтвердить действующие цены и сроки их действия.", "4. Пакетно сверить университетские сведения с официальными источниками.", "5. Руководителю подтвердить внутренние процессы и партнёрства.", "6. Остаток архивировать либо запросить контекст.", "", "## Очереди", ""]
        for name, (priority, _action) in CATEGORIES.items():
            lines.append(f"- [[Панель решений/{name}|{name}]] — **{counts[name]}**; {priority}.")
        lines.extend(["", "## Что означает решение", "", "- **Утвердить** — информация становится доступной внутреннему ИИ.", "- **Исключить** — источник остаётся в закрытом архиве, но не становится знанием ИИ.", "- **Обновить** — старая заметка заменяется подтверждённой формулировкой с новым источником.", "- **Архивировать** — материал сохраняется для истории и не используется в ответах."])
        (dashboard / "Главная панель.md").write_text("\n".join(lines).rstrip() + "\n", encoding="utf-8")
        for stale_name in previous_generated - generated:
            stale = managed_path(dashboard, stale_name)
            if stale.is_file():
                if "тип: панель_решений" not in stale.read_text(encoding="utf-8"):
                    raise ValueError(f"отказ удаления неуправляемого файла: {stale.name}")
                stale.unlink()
        manifest_path.write_text(json.dumps({"version": 1, "files": sorted(generated)}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(json.dumps({"всего": sum(counts.values()), "категории": counts}, ensure_ascii=False))
        return 0
    except (FileNotFoundError, ValueError, json.JSONDecodeError) as error:
        print(f"Ошибка: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
