#!/usr/bin/env python3
"""Инвентаризация источников каталога учебных заведений и программ.

Скрипт читает утверждённое внутреннее хранилище знаний существующим
безопасным читателем и отвечает ровно на один вопрос: что в папке
`Университеты` может стать записью каталога, а что не может.

Он ничего не импортирует, не создаёт записей каталога и не обращается к сети.
Классификация выполняется прозрачными правилами по заголовку документа.
Документ, который не подошёл ни под одно правило, попадает в
`требует_ручной_классификации`, а не угадывается.

Использование:

    python3 scripts/knowledge_ingestion/catalog_inventory.py \
      --vault "<путь>/Внутренняя база знаний ЭВО/Утверждено для внутреннего ИИ" \
      --output <папка результата>
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import unicodedata
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from build_platform_bundle import (  # noqa: E402
    canonical,
    digest,
    discover_documents,
    resolve_source_root,
)

CATALOG_FOLDER = "Университеты"

# Учебное заведение, с которым EVO работает напрямую. Ключ — токен в заголовке,
# значение — каноническое имя и вид по перечню platform.catalog_institution_kind.
HOST_INSTITUTIONS: dict[str, tuple[str, str, str]] = {
    "APU": ("Asia Pacific University of Technology and Innovation", "university", "MY"),
    "APIIT": ("Asia Pacific Institute of Information Technology", "college", "MY"),
    "INTI": ("INTI International University and Colleges", "university", "MY"),
    "SUNWAY": ("Sunway University", "university", "MY"),
    "XIAMEN": ("Xiamen University Malaysia", "university", "MY"),
    "TAYLOR": ("Taylor's University", "university", "MY"),
    "UCSI": ("UCSI University", "university", "MY"),
    "CITY": ("City University Malaysia", "university", "MY"),
    "TONGMYONG": ("Tongmyong University", "university", "KR"),
}

# Учебные заведения, которые появляются только как партнёр, площадка трансфера
# или организация, выдающая диплом. Их нельзя считать записями каталога EVO
# без отдельного решения владельца.
PARTNER_ONLY = {
    "COVENTRY", "SWINBURNE", "HERTFORDSHIRE", "SNHU", "SOUTHERN NEW HAMPSHIRE",
    "SHEFFIELD HALLAM", "DMU", "DE MONTFORT", "CAMBRIDGE", "QAA",
}

# Уровень программы. Порядок важен: более длинные и специфичные раньше.
PROGRAMME_LEVELS: tuple[tuple[str, str], ...] = (
    (r"\bfoundation\b|\bподготовительн", "foundation"),
    (r"\bcertificate\b|\bсертификат", "certificate"),
    (r"\bdiploma\b|\bдиплом", "diploma"),
    (r"\bbachelor\b|\bbsc\b|\bba\b|\bbachelor'?s\b|\bбакалавр", "bachelor"),
    (r"\bmaster\b|\bmba\b|\bmsc\b|\bmagister\b|\bмагистр", "master"),
    (r"\bdoctor\b|\bphd\b|\bdba\b|\bdoctorate\b|\bдоктор", "doctoral"),
    (r"\ba-?level\b", "pre_university"),
)

# Документ описывает заведение, а не программу.
INSTITUTION_PROFILE = (
    r"кампус|campus|аккредита|accredit|рейтинг|ranking|qs |профиль|prospectus|"
    r"проспект|брошюр|награды|достижения|валидац|признание|видео-ссылк|"
    r"о компании|партнёрск|партнерск"
)

# Документ является рабочей таблицей EVO с табличными данными.
WORKSHEET = r"рабочая таблица|расписание стоимости|fee schedule|таблица популярных"

# Документ описывает требования, стоимость или списки, но не конкретную программу.
REFERENCE = (
    r"требовани|requirements|entry|english|стоимость|цены|fee|расход|проживани|"
    r"списки|перечень|направления|pathways|pathway|наборы|intake|опции|мобильност|"
    r"специализац|популярные|программы\b|траектор"
)


def normalize_title(value: str) -> str:
    return unicodedata.normalize("NFC", value).strip()


def read_title(content: str) -> str:
    """Возвращает первый заголовок первого уровня из уже прочитанного текста."""
    for line in content.splitlines():
        if line.startswith("# "):
            return normalize_title(line[2:])
    return ""


def detect_host(title: str) -> tuple[str | None, str | None, str | None]:
    upper = title.upper()
    for token, (name, kind, country) in HOST_INSTITUTIONS.items():
        if re.search(rf"(?<![A-Z]){re.escape(token)}", upper):
            return name, kind, country
    return None, None, None


def detect_partners(title: str) -> list[str]:
    upper = title.upper()
    return sorted({token for token in PARTNER_ONLY if token in upper})


def detect_level(title: str) -> str | None:
    lowered = title.lower()
    for pattern, level in PROGRAMME_LEVELS:
        if re.search(pattern, lowered):
            return level
    return None


def classify(title: str) -> tuple[str, str | None]:
    """Возвращает (категория, уровень программы или None).

    Правила проверяются в фиксированном порядке. Заголовок, не подошедший ни
    под одно правило, получает категорию `требует_ручной_классификации`.
    """
    lowered = title.lower()
    if re.search(WORKSHEET, lowered):
        return "рабочая_таблица", None
    if re.search(INSTITUTION_PROFILE, lowered):
        return "профиль_заведения", None
    level = detect_level(title)
    if level and not re.search(REFERENCE, lowered):
        return "программа", level
    if re.search(REFERENCE, lowered):
        return "справочный_материал", level
    if level:
        return "программа", level
    return "требует_ручной_классификации", None


def count_worksheet_rows(content: str) -> int:
    """Считает строки, похожие на строки таблицы: пять и более колонок TAB."""
    return sum(1 for line in content.splitlines() if line.count("\t") >= 4)


def build_inventory(vault: Path) -> dict:
    _, source_root, _ = resolve_source_root(vault, "internal")
    documents = discover_documents(source_root)

    records: list[dict] = []
    for document in documents:
        source_path = document["source_path"]
        if not source_path.startswith(f"{CATALOG_FOLDER}/"):
            continue
        content = document["content"]
        title = read_title(content)
        category, level = classify(title)
        host_name, host_kind, host_country = detect_host(title)
        host_source = "title" if host_name else None
        if host_name is None:
            # Заголовок не называет заведение. Ищем его в тексте документа и
            # честно записываем, что источник определения — тело, а не заголовок.
            host_name, host_kind, host_country = detect_host(content)
            host_source = "body" if host_name else None
        record = {
            "source_path": source_path,
            "source_sha256": document["source_sha256"],
            "title": title,
            "category": category,
            "programme_level": level,
            "host_institution": host_name,
            "host_institution_source": host_source,
            "institution_kind": host_kind,
            "country_code": host_country,
            "partner_mentions": detect_partners(title),
        }
        if category == "рабочая_таблица":
            record["worksheet_rows"] = count_worksheet_rows(content)
        records.append(record)

    records.sort(key=lambda item: item["source_path"])

    categories = Counter(item["category"] for item in records)
    levels = Counter(
        item["programme_level"] for item in records if item["programme_level"]
    )
    hosts = Counter(
        item["host_institution"] for item in records if item["host_institution"]
    )
    unresolved = [
        item["source_path"] for item in records if item["host_institution"] is None
    ]
    host_from_body = [
        item["source_path"]
        for item in records
        if item["host_institution_source"] == "body"
    ]
    manual = [
        item["source_path"]
        for item in records
        if item["category"] == "требует_ручной_классификации"
    ]
    worksheet_rows = sum(item.get("worksheet_rows", 0) for item in records)

    institutions = sorted(
        {
            (item["host_institution"], item["institution_kind"], item["country_code"])
            for item in records
            if item["host_institution"]
        }
    )

    summary = {
        "documents_total": len(records),
        "by_category": dict(sorted(categories.items())),
        "by_programme_level": dict(sorted(levels.items())),
        "by_host_institution": dict(sorted(hosts.items())),
        "distinct_host_institutions": [
            {"institution_name": name, "institution_kind": kind, "country_code": country}
            for name, kind, country in institutions
        ],
        "worksheet_data_rows": worksheet_rows,
        "documents_without_host_institution": sorted(unresolved),
        "documents_with_host_resolved_from_body": sorted(host_from_body),
        "documents_requiring_manual_classification": sorted(manual),
    }
    return {"summary": summary, "documents": records}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--vault", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    arguments = parser.parse_args()

    inventory = build_inventory(arguments.vault)
    output = arguments.output.expanduser().absolute()
    output.mkdir(parents=True, exist_ok=True)
    payload = canonical(inventory)
    target = output / "catalog-inventory.json"
    target.write_bytes(payload)

    report = {
        "inventory_sha256": digest(payload),
        "inventory_path": str(target),
        "summary": inventory["summary"],
    }
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
