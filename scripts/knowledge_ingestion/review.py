#!/usr/bin/env python3
"""Запускает установленный Codex CLI по подготовленным пакетам EVO."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

SCHEMA = Path(__file__).with_name("review_schema.json")
SECTIONS = {"Страны", "Университеты", "Услуги", "Процессы", "Продажи и ответы", "Компания", "Команда", "Партнеры", "Неопределенное"}
PROMPT = """Ты проверяешь один подготовленный пакет внутренней базы знаний EVO Admissions.
Верни только JSON по переданной схеме. Работай на русском языке.

Правила:
- не добавляй знания извне и не выдумывай отсутствующие факты;
- один вывод должен ссылаться на SHA-256 исходников из пакета;
- claim_key — стабильный латинский kebab-case идентификатор предмета утверждения;
- authority выбирай строго по происхождению: owner_director, signed_contract,
  official_source, evo_active_document, confirmed_correspondence или
  legacy_or_unknown; при сомнении используй legacy_or_unknown и escalate;
- ignore — дубликат, шум, переписка без устойчивого знания;
- escalate — противоречие, низкая уверенность, персональные данные, секреты,
  индивидуальный договор, цена, гарантия, возврат, юридическое обязательство;
- approve — только ясный, нечувствительный, непротиворечивый деловой факт;
- не копируй в JSON персональные данные, email, телефоны, номера документов;
- summary и facts должны быть пригодны для русской Obsidian-заметки.
"""


def inside(path: Path, root: Path) -> Path:
    target = path.expanduser().resolve()
    boundary = root.expanduser().resolve()
    if target == boundary or boundary not in target.parents:
        raise ValueError(f"путь должен находиться внутри разрешённого корня: {boundary}")
    return target


def validate_result(data: object, allowed_sources: set[str] | None = None) -> dict:
    if not isinstance(data, dict) or not isinstance(data.get("items"), list):
        raise ValueError("ответ Codex не соответствует ожидаемой структуре")
    for item in data["items"]:
        if not isinstance(item, dict) or item.get("decision") not in {"approve", "escalate", "ignore"}:
            raise ValueError("ответ Codex содержит неверное решение")
        if set(item) != {"decision", "claim_key", "authority", "title", "section", "summary", "facts", "sources", "reason"}:
            raise ValueError("ответ Codex не соответствует полной схеме")
        if not isinstance(item["title"], str) or not item["title"].strip() or item["section"] not in SECTIONS:
            raise ValueError("ответ Codex содержит неверное название или раздел")
        if not isinstance(item["summary"], str) or not isinstance(item["reason"], str) or not isinstance(item["facts"], list) or any(not isinstance(value, str) for value in item["facts"]):
            raise ValueError("ответ Codex содержит неверные текстовые поля")
        if not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", item["claim_key"]) or item["authority"] not in {"owner_director", "signed_contract", "official_source", "evo_active_document", "confirmed_correspondence", "legacy_or_unknown"}:
            raise ValueError("ответ Codex содержит неверный claim_key или уровень источника")
        output_text = " ".join([item["title"], item["summary"], item["reason"], *item["facts"]])
        if re.search(r"(?i)\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", output_text) or re.search(r"(?<!\w)(?:\+?\d[\s().-]*){8,15}(?!\w)", output_text):
            raise ValueError("ответ Codex содержит email или телефон")
        sources = item.get("sources")
        if not isinstance(sources, list) or not sources or any(not isinstance(value, str) or not re.fullmatch(r"[a-f0-9]{64}", value) for value in sources):
            raise ValueError("ответ Codex содержит неверные ссылки на SHA-256")
        if allowed_sources is not None and not set(sources) <= allowed_sources:
            raise ValueError("ответ Codex ссылается на SHA-256 вне проверяемого пакета")
    return data


def load_allowed_sources(queue: Path, authorized_root: Path | None = None) -> tuple[set[str], dict[str, str]]:
    manifest = queue.parent / "Манифест источников.jsonl"
    batch_manifest_path = queue.parent / "Манифест пакетов Codex.json"
    if authorized_root is not None:
        boundary = authorized_root.expanduser().resolve()
        if boundary.name != "Входящие кандидаты" or boundary not in queue.parents:
            raise ValueError("очередь должна находиться внутри внутренней папки 'Входящие кандидаты'")
    if queue.name != "Очередь проверки Codex" or not manifest.is_file() or not batch_manifest_path.is_file():
        raise ValueError("разрешена только очередь рядом с K2-манифестом")
    allowed: set[str] = set()
    for line in manifest.read_text(encoding="utf-8").splitlines():
        record = json.loads(line)
        if record.get("classification") == "деловой_материал" and record.get("extraction_status") == "извлечено":
            allowed.add(record["sha256"])
    batch_manifest = json.loads(batch_manifest_path.read_text(encoding="utf-8"))
    if not isinstance(batch_manifest, dict) or not isinstance(batch_manifest.get("batches"), dict):
        raise ValueError("повреждён манифест пакетов Codex")
    hashes = batch_manifest["batches"]
    for name, digest in hashes.items():
        if not isinstance(name, str) or not re.fullmatch(r"[a-f0-9]{64}", str(digest)):
            raise ValueError("манифест пакетов Codex содержит неверную запись")
    return allowed, hashes


def codex_environment() -> dict[str, str]:
    blocked = re.compile(r"(?i)(api.*key|token|secret|password|credential)")
    return {key: value for key, value in os.environ.items() if not blocked.search(key)}


def review_fingerprint(batch_text: str) -> str:
    digest = hashlib.sha256()
    digest.update(batch_text.encode())
    digest.update(PROMPT.encode())
    digest.update(SCHEMA.read_bytes())
    return digest.hexdigest()


def remove_orphan_results(output: Path, current_names: set[str]) -> int:
    removed = 0
    for stale in output.glob("Пакет *.json"):
        if f"{stale.stem}.md" not in current_names:
            stale.unlink()
            stale.with_suffix(".sha256").unlink(missing_ok=True)
            removed += 1
    return removed


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Проверить пакеты EVO через авторизованный Codex CLI без LLM API.")
    parser.add_argument("--queue", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--authorized-root", type=Path, required=True)
    parser.add_argument("--limit", type=int, help="максимум новых пакетов за запуск")
    parser.add_argument("--max-attempts", type=int, default=2, choices=range(1, 4), help="1-3 попытки строгой проверки пакета")
    parser.add_argument("--timeout-seconds", type=int, default=600, help="лимит времени одной попытки Codex")
    args = parser.parse_args(argv)
    try:
        queue = args.queue.expanduser().resolve()
        output = inside(args.output, args.authorized_root)
        if not queue.is_dir():
            raise FileNotFoundError(f"очередь не найдена: {queue}")
        codex = shutil.which("codex")
        if not codex:
            raise RuntimeError("Codex CLI не найден")
        output.mkdir(parents=True, exist_ok=True)
        manifest_sources, batch_hashes = load_allowed_sources(queue, args.authorized_root)
        current_names = {path.name for path in queue.glob("Пакет *.md")}
        if current_names != set(batch_hashes):
            raise ValueError("состав очереди не совпадает с манифестом пакетов Codex")
        remove_orphan_results(output, current_names)
        processed = 0
        for batch in sorted(queue.glob("Пакет *.md")):
            batch_text = batch.read_text(encoding="utf-8")
            allowed_sources = set(re.findall(r"(?m)^## ([a-f0-9]{64})", batch_text))
            if not allowed_sources or not allowed_sources <= manifest_sources:
                raise ValueError(f"пакет содержит SHA вне разрешённого K2-манифеста: {batch.name}")
            batch_fingerprint = hashlib.sha256(batch_text.encode()).hexdigest()
            if batch_hashes.get(batch.name) != batch_fingerprint:
                raise ValueError(f"содержимое пакета не совпадает с K2-манифестом: {batch.name}")
            fingerprint = review_fingerprint(batch_text)
            target = output / f"{batch.stem}.json"
            fingerprint_path = output / f"{batch.stem}.sha256"
            if target.exists() and fingerprint_path.is_file() and fingerprint_path.read_text(encoding="utf-8").strip() == fingerprint:
                validate_result(json.loads(target.read_text(encoding="utf-8")), allowed_sources)
                continue
            if args.limit is not None and processed >= args.limit:
                break
            last_error: Exception | None = None
            for _attempt in range(args.max_attempts):
                with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as handle:
                    temp = Path(handle.name)
                try:
                    command = [codex, "exec", "--ephemeral", "--ignore-user-config", "--sandbox", "read-only", "--skip-git-repo-check", "--output-schema", str(SCHEMA), "--output-last-message", str(temp), "-"]
                    allowed_line = "Разрешённые SHA-256: " + ", ".join(sorted(allowed_sources))
                    result = subprocess.run(command, input=PROMPT + "\n" + allowed_line + "\n\n" + batch_text, text=True, capture_output=True, check=False, env=codex_environment(), timeout=args.timeout_seconds)
                    if result.returncode:
                        raise RuntimeError(f"Codex завершился с кодом {result.returncode}: {result.stderr[-1000:]}")
                    data = validate_result(json.loads(temp.read_text(encoding="utf-8")), allowed_sources)
                    target.write_text(json.dumps(data, ensure_ascii=False, indent=2, sort_keys=True), encoding="utf-8")
                    fingerprint_path.write_text(fingerprint + "\n", encoding="utf-8")
                    processed += 1
                    last_error = None
                    break
                except (RuntimeError, ValueError, json.JSONDecodeError, subprocess.TimeoutExpired) as error:
                    last_error = error
                finally:
                    temp.unlink(missing_ok=True)
            if last_error is not None:
                raise RuntimeError(f"пакет не прошёл строгую проверку за {args.max_attempts} попытки: {last_error}")
        print(json.dumps({"новых_пакетов": processed, "всего_результатов": len(list(output.glob("Пакет *.json")))}, ensure_ascii=False))
        return 0
    except (FileNotFoundError, RuntimeError, ValueError, json.JSONDecodeError) as error:
        print(f"Ошибка: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
