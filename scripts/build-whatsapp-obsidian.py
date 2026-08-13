#!/usr/bin/env python3
"""Build closed Russian Markdown transcripts and a sanitized WhatsApp analysis."""

from __future__ import annotations

import argparse
import collections
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import tempfile
from typing import Any


PHONE = re.compile(r"(?<!\w)\+?\d[\d\s()\-]{7,}\d(?!\w)")
URL = re.compile(r"https?://[^\s<>()]+")
SPACE = re.compile(r"\s+")
TOPICS = {
    "Китай": ("китай", "china", "кнр"),
    "Малайзия": ("малайзи", "malaysia"),
    "Турция": ("турци", "turkey"),
    "Польша": ("польш", "poland"),
    "Италия": ("итали", "italy"),
    "Чехия": ("чех", "czech"),
    "Кипр": ("кипр", "cyprus"),
    "Австрия": ("австри", "austria"),
    "ОАЭ": ("дуба", "оаэ", "uae"),
    "Документы": ("документ", "аттестат", "паспорт", "справк", "перевод", "нотари"),
    "Виза": ("виз", "посольств", "миграц"),
    "Университеты": ("университет", "вуз", "university", "college"),
    "Стоимость и оплата": ("стоим", "оплат", "цена", "доллар", "сом", "контракт"),
    "Стипендии и гранты": ("стипенд", "грант", "scholarship"),
    "Сроки": ("дедлайн", "срок", "deadline", "прием документов"),
    "Процесс поступления": ("поступлен", "заявк", "аппликац", "application", "зачислен"),
    "Продажи и сопровождение": ("клиент", "лид", "менеджер", "сопровожд", "консультац"),
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Markdown и анализ закрытого архива WhatsApp")
    parser.add_argument("--raw", type=Path, required=True)
    parser.add_argument("--vault-export", type=Path, required=True)
    return parser.parse_args()


def atomic_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(path.parent, 0o700)
    fd, temporary = tempfile.mkstemp(prefix=path.name + ".", suffix=".part", dir=path.parent)
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(text)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    except BaseException:
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass
        raise


def serialized(value: Any) -> str:
    if isinstance(value, str):
        return value
    if isinstance(value, dict) and isinstance(value.get("_serialized"), str):
        return value["_serialized"]
    return "неизвестно"


def timestamp(value: Any) -> str:
    if not isinstance(value, (int, float)):
        return "время неизвестно"
    return dt.datetime.fromtimestamp(value, dt.timezone.utc).astimezone().isoformat(timespec="seconds")


def safe_markdown(value: Any) -> str:
    text = str(value or "").replace("\r\n", "\n").replace("\r", "\n")
    return text.replace("```", "` ` `")


def sanitized(text: str) -> str:
    text = PHONE.sub("[телефон скрыт]", text)
    text = URL.sub("[ссылка скрыта]", text)
    return SPACE.sub(" ", text).strip()


def main() -> int:
    args = parse_args()
    raw = args.raw.expanduser().resolve()
    export = args.vault_export.expanduser().resolve()
    transcripts = export / "Транскрипты"
    analysis = export / "Анализ"
    transcripts.mkdir(parents=True, exist_ok=True, mode=0o700)
    analysis.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(transcripts, 0o700)
    os.chmod(analysis, 0o700)

    topic_counts: collections.Counter[str] = collections.Counter()
    topic_chats: dict[str, set[str]] = collections.defaultdict(set)
    domains: collections.Counter[str] = collections.Counter()
    message_total = 0
    text_total = 0
    media_total = 0
    from_me_total = 0
    chat_summaries: list[dict[str, Any]] = []

    for source in sorted((raw / "Чаты").glob("*.jsonl")):
        records = [json.loads(line) for line in source.open("r", encoding="utf-8")]
        metadata = records[0].get("данные") or {}
        chat_hash = source.stem
        name = str(metadata.get("name") or "Без названия")
        chat_id = serialized(metadata.get("id"))
        lines = [
            "---",
            "тип: закрытая_переписка_whatsapp",
            "статус: сырой_источник",
            "доступ_для_клиентского_ии: false",
            f"идентификатор_источника: {chat_hash}",
            "---",
            "",
            f"# Переписка WhatsApp — {safe_markdown(name)}",
            "",
            "> Закрытый персональный источник. Не является утверждённым знанием.",
            "",
            "## Метаданные",
            "",
            f"- Внутренний ID: `{safe_markdown(chat_id)}`",
            f"- Группа: {'да' if metadata.get('isGroup') else 'нет'}",
            f"- Сырой файл: `../Сырые данные/Чаты/{source.name}`",
            "",
            "## Сообщения",
            "",
        ]
        chat_topics: collections.Counter[str] = collections.Counter()
        first_ts: int | float | None = None
        last_ts: int | float | None = None
        chat_messages = 0
        for record in records[1:]:
            message = record.get("данные") if isinstance(record, dict) else None
            if not isinstance(message, dict):
                continue
            message_total += 1
            chat_messages += 1
            ts = message.get("timestamp")
            if isinstance(ts, (int, float)):
                first_ts = ts if first_ts is None else min(first_ts, ts)
                last_ts = ts if last_ts is None else max(last_ts, ts)
            body = str(message.get("body") or "")
            has_media = message.get("hasMedia") is True
            media_total += int(has_media)
            from_me = message.get("fromMe") is True
            from_me_total += int(from_me)
            sender = "ЭВО" if from_me else "Собеседник"
            if body:
                text_total += 1
                lowered = body.casefold()
                for topic, markers in TOPICS.items():
                    if any(marker in lowered for marker in markers):
                        topic_counts[topic] += 1
                        chat_topics[topic] += 1
                        topic_chats[topic].add(chat_hash)
                for url in URL.findall(body):
                    match = re.match(r"https?://([^/]+)", url.casefold())
                    if match:
                        domains[match.group(1).removeprefix("www.")] += 1
            content = safe_markdown(body) if body else "_[без текста]_"
            lines.extend([
                f"### {timestamp(ts)} — {sender}",
                "",
                content,
                "",
            ])
            if has_media:
                raw_id = serialized(message.get("id"))
                media_key = hashlib.sha256((chat_id + "\0" + raw_id).encode("utf-8")).hexdigest()
                lines.extend([
                    f"Вложение: `../Медиа/Файлы/{media_key}.*`",
                    "",
                ])
        atomic_text(transcripts / f"{chat_hash}.md", "\n".join(lines).rstrip() + "\n")
        chat_summaries.append({
            "id": chat_hash,
            "messages": chat_messages,
            "first": first_ts,
            "last": last_ts,
            "topics": chat_topics.most_common(5),
        })

    top_chats = sorted(chat_summaries, key=lambda item: item["messages"], reverse=True)[:30]
    report_lines = [
        "---",
        "тип: анализ_закрытого_архива",
        "статус: аналитический_черновик",
        "доступ_для_клиентского_ии: false",
        "---",
        "",
        "# Сводный анализ переписок WhatsApp",
        "",
        "> Анализ показывает темы и сигналы для проверки. Частота упоминаний не",
        "> подтверждает истинность факта и не заменяет официальный источник.",
        "",
        "## Масштаб архива",
        "",
        f"- Чатов: {len(chat_summaries)}",
        f"- Сообщений: {message_total}",
        f"- Текстовых сообщений: {text_total}",
        f"- Сообщений с медиа: {media_total}",
        f"- Сообщений от ЭВО: {from_me_total}",
        f"- Сообщений от собеседников: {message_total - from_me_total}",
        "",
        "## Тематические сигналы",
        "",
        "| Тема | Сообщений с упоминанием | Чатов |",
        "| --- | ---: | ---: |",
    ]
    for topic, count in topic_counts.most_common():
        report_lines.append(f"| {topic} | {count} | {len(topic_chats[topic])} |")
    report_lines.extend([
        "",
        "## Наиболее активные чаты (обезличено)",
        "",
        "| ID источника | Сообщений | Период | Основные темы |",
        "| --- | ---: | --- | --- |",
    ])
    for item in top_chats:
        period = f"{timestamp(item['first'])} — {timestamp(item['last'])}"
        topics = ", ".join(topic for topic, _ in item["topics"]) or "не определены"
        report_lines.append(f"| `{item['id']}` | {item['messages']} | {period} | {topics} |")
    report_lines.extend([
        "",
        "## Часто встречающиеся внешние домены",
        "",
    ])
    for domain, count in domains.most_common(30):
        report_lines.append(f"- `{sanitized(domain)}` — {count}")
    report_lines.extend([
        "",
        "## Правило дальнейшей обработки",
        "",
        "Из этого отчёта создаются только обезличенные карточки-кандидаты в",
        "`10_На проверке`. Перед публикацией каждый факт должен быть сопоставлен",
        "с актуальным официальным источником и подтверждён владельцем или",
        "руководителем ЭВО.",
    ])
    atomic_text(analysis / "Сводный анализ переписок WhatsApp.md", "\n".join(report_lines) + "\n")
    print(json.dumps({"чаты": len(chat_summaries), "сообщения": message_total, "транскрипты": len(chat_summaries)}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
