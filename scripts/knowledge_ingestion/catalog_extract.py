#!/usr/bin/env python3
"""Извлекает кандидатов программ каталога из утверждённой базы знаний.

Скрипт создаёт только кандидатов для staging. Он не создаёт одобренных записей,
не обращается к базе данных и не выходит в сеть.

Главное правило: **поле заполняется только дословным фактом из источника.**
Если факт не найден или найден в неоднозначной форме, поле остаётся пустым и
попадает в список `requires_manual`. Каждое заполненное поле несёт `evidence` —
точную строку источника, по которой значение получено, чтобы человек мог
проверить извлечение, не открывая файл.

Использование:

    python3 scripts/knowledge_ingestion/catalog_extract.py \
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

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))

from build_platform_bundle import canonical, digest, discover_documents, resolve_source_root  # noqa: E402
from catalog_inventory import CATALOG_FOLDER, classify, detect_host, detect_partners, read_title  # noqa: E402

# Месяц в родительном или предложном падеже, как он встречается в источниках.
MONTHS: dict[str, str] = {
    "январ": "01", "феврал": "02", "март": "03", "апрел": "04",
    "ма": "05", "июн": "06", "июл": "07", "август": "08",
    "сентябр": "09", "октябр": "10", "ноябр": "11", "декабр": "12",
}

# Длительность в годах. Требуется явное число рядом со словом «год».
DURATION_YEARS = re.compile(
    r"(?<![\d,.])(\d{1,2})\s*(?:год|года|лет)\b", re.IGNORECASE
)
# Длительность в месяцах.
DURATION_MONTHS = re.compile(
    r"(?<![\d,.])(\d{1,3})\s*месяц", re.IGNORECASE
)
# Неопределённая форма: «24+ месяца», «от 2 лет», «2-3 года», «минимум 1 год».
# Такое значение не является точной длительностью и не берётся.
DURATION_AMBIGUOUS = re.compile(
    r"\d\s*\+|\bот\s+\d|\bдо\s+\d|\d\s*[-–—]\s*\d"
    r"|\bминимум\b|\bмаксимум\b|\bне\s+менее\b|\bне\s+более\b|\bпримерно\b|\bоколо\b",
    re.IGNORECASE,
)

# Язык обучения берётся только из фразы, которая прямо о языке преподавания.
# Упоминание английского в требованиях к поступлению языком обучения не является.
LANGUAGE_CONTEXT = re.compile(
    r"язык обучения|обучение (?:ведётся|ведется|проходит) на|преподава[а-я]* на"
    r"|taught in|[- ]taught\b|medium of instruction",
    re.IGNORECASE,
)
LANGUAGE_EXCLUDE = re.compile(
    r"требован|требуется|IELTS|TOEFL|MUET|PTE|сертификат|балл", re.IGNORECASE
)
LANGUAGE_PATTERNS: tuple[tuple[str, str], ...] = (
    (r"английск|english", "en"),
    (r"китайск|chinese|mandarin", "zh"),
    (r"русск|russian", "ru"),
)

FACTS_HEADING = "## Факты"
PROVENANCE_HEADING = "## Происхождение"


def fact_lines(content: str) -> list[str]:
    """Возвращает строки раздела «Факты». Прочие разделы не разбираются."""
    lines = content.splitlines()
    try:
        start = lines.index(FACTS_HEADING) + 1
    except ValueError:
        return []
    out: list[str] = []
    for line in lines[start:]:
        if line.startswith("## "):
            break
        stripped = line.strip()
        if stripped.startswith("- "):
            out.append(unicodedata.normalize("NFC", stripped))
    return out


def extract_duration(lines: list[str]) -> tuple[int | None, str | None, str | None]:
    """Возвращает (месяцы, строка-доказательство, причина отказа)."""
    for line in lines:
        if not re.search(r"длительн|длится|продолжительн", line, re.IGNORECASE):
            continue
        if DURATION_AMBIGUOUS.search(line):
            return None, None, "неопределённая длительность в источнике"
        years = DURATION_YEARS.findall(line)
        months = DURATION_MONTHS.findall(line)
        # Две и более длительности в одной строке означают разные режимы
        # обучения, например очный и заочный. Выбрать одну молча нельзя.
        if len(years) + len(months) > 1:
            return None, None, "в источнике несколько разных длительностей"
        if years:
            return int(years[0]) * 12, line, None
        if months:
            return int(months[0]), line, None
        return None, None, "длительность упомянута без явного числа"
    return None, None, "длительность в источнике отсутствует"


def extract_intakes(lines: list[str]) -> tuple[list[str] | None, str | None]:
    for line in lines:
        if not re.search(r"набор", line, re.IGNORECASE):
            continue
        lowered = line.lower()
        found: list[str] = []
        for stem, number in MONTHS.items():
            # «ма» совпало бы с «март»; берём только «май»/«мае»/«мая».
            pattern = r"\bмa?[йея]\b" if stem == "ма" else rf"\b{stem}\w*"
            if re.search(pattern.replace("a", "а"), lowered):
                found.append(number)
        unique = sorted(set(found))
        if unique:
            return unique, line
        return None, None
    return None, None


def extract_language(lines: list[str]) -> tuple[str | None, str | None]:
    for line in lines:
        if not LANGUAGE_CONTEXT.search(line):
            continue
        if LANGUAGE_EXCLUDE.search(line):
            continue
        for pattern, code in LANGUAGE_PATTERNS:
            if re.search(pattern, line, re.IGNORECASE):
                return code, line
    return None, None


def build_candidates(vault: Path) -> dict:
    _, source_root, _ = resolve_source_root(vault, "internal")
    candidates: list[dict] = []
    skipped = Counter()

    for document in discover_documents(source_root):
        source_path = document["source_path"]
        if not source_path.startswith(f"{CATALOG_FOLDER}/"):
            continue
        content = document["content"]
        title = read_title(content)
        category, level = classify(title)
        if category != "программа":
            skipped[category] += 1
            continue

        institution, kind, country = detect_host(title)
        institution_source = "title" if institution else None
        if institution is None:
            institution, kind, country = detect_host(content)
            institution_source = "body" if institution else None

        lines = fact_lines(content)
        duration, duration_evidence, duration_reason = extract_duration(lines)
        intakes, intake_evidence = extract_intakes(lines)
        language, language_evidence = extract_language(lines)

        manual: list[str] = []
        if institution is None:
            manual.append("institution")
        # Уровень никогда не принимается как окончательный из заголовка:
        # официальная проверка нашла таблицу с заголовком «bachelor programmes»,
        # перечисляющую программы уровня diploma.
        manual.append("programme_level_confirmation")
        if duration is None:
            manual.append("duration_months")
        if intakes is None:
            manual.append("intake_months")
        if language is None:
            manual.append("study_language")

        candidates.append(
            {
                "source_path": source_path,
                "source_sha256": document["source_sha256"],
                "programme_name": title,
                "institution_name": institution,
                "institution_kind": kind,
                "country_code": country,
                "institution_source": institution_source,
                "programme_level_proposed": level,
                "duration_months": duration,
                "duration_evidence": duration_evidence,
                "duration_absent_reason": duration_reason,
                "intake_months": intakes,
                "intake_evidence": intake_evidence,
                "study_language": language,
                "study_language_evidence": language_evidence,
                "partner_mentions": detect_partners(title),
                "requires_manual": manual,
            }
        )

    candidates.sort(key=lambda item: item["source_path"])
    total = len(candidates)

    def filled(field: str) -> int:
        return sum(1 for c in candidates if c[field] is not None)

    summary = {
        "candidates_total": total,
        "skipped_by_category": dict(sorted(skipped.items())),
        "field_fill": {
            field: {
                "filled": filled(field),
                "percent": round(filled(field) * 100 / total, 1) if total else 0.0,
            }
            for field in (
                "institution_name",
                "programme_level_proposed",
                "duration_months",
                "intake_months",
                "study_language",
            )
        },
        "duration_absent_reasons": dict(
            sorted(Counter(
                c["duration_absent_reason"]
                for c in candidates
                if c["duration_absent_reason"]
            ).items())
        ),
        "by_institution": dict(
            sorted(Counter(
                c["institution_name"] or "не определено" for c in candidates
            ).items())
        ),
    }
    return {"summary": summary, "candidates": candidates}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--vault", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    arguments = parser.parse_args()

    result = build_candidates(arguments.vault)
    output = arguments.output.expanduser().absolute()
    output.mkdir(parents=True, exist_ok=True)
    payload = canonical(result)
    target = output / "catalog-programme-candidates.json"
    target.write_bytes(payload)

    print(json.dumps(
        {
            "candidates_sha256": digest(payload),
            "candidates_path": str(target),
            "summary": result["summary"],
        },
        ensure_ascii=False,
        indent=2,
    ))


if __name__ == "__main__":
    main()
