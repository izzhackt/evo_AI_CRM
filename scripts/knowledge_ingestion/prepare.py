#!/usr/bin/env python3
"""Безопасно готовит Gmail и Google Drive к проверке в Codex.

Скрипт не вызывает LLM и не изменяет исходные данные. Он создаёт только
манифест, извлечённый деловой текст и ограниченные очереди проверки.
"""

from __future__ import annotations

import argparse
import email
import email.policy
import hashlib
import html
import json
import mailbox
import os
import re
import shutil
import subprocess
import sys
import tempfile
import zipfile
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from email.header import decode_header, make_header
from email.message import Message
from html.parser import HTMLParser
from pathlib import Path
from typing import Iterable
from xml.etree import ElementTree

VERSION = 2
SUPPORTED = {".txt", ".md", ".csv", ".html", ".htm", ".pdf", ".docx", ".xlsx", ".pptx"}
SENSITIVE_WORDS = (
    "passport", "паспорт", "attestat", "аттестат", "diploma", "диплом",
    "transcript", "транскрипт", "receipt", "квитанц", "справк", "анкета",
    "application", "заявлен", "student docs", "документы студ", "medical",
    "медицин", "photo", "фото", "visa", "виза", "affidavit", "нотари",
    "свидетельств", "certificate", "сертификат", "credit", "кредит",
    "bank", "банк", "payment", "оплат", "чек", "emgs",
    "student", "студент", "client", "клиент", "applicant", "заявител",
    "ученик", "лид", "lead", "cv", "resume", "резюме", "recommend",
    "рекоменд", "motivation", "мотивац", "toefl", "ielts", "duolingo",
)
SECRET_WORDS = (
    "доступ", "credential", "password", "пароль", "secret", "token",
    "токен", "api key", "apikey", ".env", "recovery code",
)
GENERIC_CONTRACT_WORDS = ("шаблон", "template", "образец", "общий", "редакция", "блогер", "партнер", "коммерческ", "копия")
TRASH_PARTS = {"корзина", "trash"}
SPAM_LABELS = {"spam", "спам", "trash", "корзина"}


class TextHTMLParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.parts: list[str] = []

    def handle_data(self, data: str) -> None:
        if data.strip():
            self.parts.append(data.strip())


@dataclass
class Record:
    sha256: str
    source_kind: str
    source_paths: list[str]
    size: int
    modified_at: str | None
    classification: str
    extraction_status: str
    media_type: str
    extracted_path: str | None = None
    reason: str | None = None
    metadata: dict[str, str] = field(default_factory=dict)


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def normalized(value: str) -> str:
    return value.casefold().replace("ё", "е")


def contains_word(value: str, words: Iterable[str]) -> bool:
    lowered = normalized(value)
    return any(normalized(word) in lowered for word in words)


def is_trash_path(path: Path, root: Path) -> bool:
    return any(normalized(part) in TRASH_PARTS for part in path.relative_to(root).parts)


def classify(name_and_path: str) -> tuple[str, str | None]:
    if contains_word(name_and_path, SECRET_WORDS):
        return "секреты_и_доступы", "название или путь указывает на секреты"
    if contains_word(name_and_path, SENSITIVE_WORDS):
        return "чувствительные_данные_заявителя", "название или путь указывает на личные документы"
    if contains_word(name_and_path, ("договор", "contract")) and not contains_word(name_and_path, GENERIC_CONTRACT_WORDS):
        return "чувствительные_данные_заявителя", "возможный индивидуальный договор без признака шаблона"
    stem = Path(name_and_path).stem
    titled_words = re.findall(r"(?u)(?:^|[\s_()-])([A-ZА-ЯЁ][a-zа-яё]{2,})(?=$|[\s_().-])", stem)
    if len(titled_words) >= 2:
        return "чувствительные_данные_заявителя", "название похоже на ФИО заявителя"
    return "деловой_материал", None


def body_is_sensitive(value: str) -> bool:
    return contains_word(value, SENSITIVE_WORDS) or bool(
        re.search(r"(?iu)\b(?:passport|паспорт|personal id|дата рождения|date of birth|address|адрес)\b", value)
    )


def gmail_labels_excluded(labels: str) -> bool:
    return bool({normalized(item.strip()) for item in labels.split(",")} & SPAM_LABELS)


def safe_decode(value: str | None) -> str:
    if not value:
        return ""
    try:
        return str(make_header(decode_header(value)))
    except (LookupError, UnicodeDecodeError):
        return value


def decode_payload(part: Message) -> str:
    payload = part.get_payload(decode=True) or b""
    charset = part.get_content_charset() or "utf-8"
    try:
        return payload.decode(charset, errors="replace")
    except LookupError:
        return payload.decode("utf-8", errors="replace")


def html_to_text(value: str) -> str:
    parser = TextHTMLParser()
    parser.feed(value)
    return html.unescape("\n".join(parser.parts))


def redact_review_text(value: str) -> str:
    value = re.sub(r"(?i)\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", "[ЭЛЕКТРОННАЯ ПОЧТА СКРЫТА]", value)
    value = re.sub(r"(?<!\w)(?:\+?\d[\s().-]*){8,15}(?!\w)", "[ТЕЛЕФОН СКРЫТ]", value)
    return re.sub(r"\n{3,}", "\n\n", value).strip()


def xml_text(archive: zipfile.ZipFile, names: Iterable[str]) -> str:
    chunks: list[str] = []
    for name in names:
        try:
            root = ElementTree.fromstring(archive.read(name))
        except (KeyError, ElementTree.ParseError):
            continue
        text = " ".join(node.text or "" for node in root.iter() if node.tag.endswith("}t"))
        if text.strip():
            chunks.append(text.strip())
    return "\n".join(chunks)


def extract_docx(path: Path) -> str:
    with zipfile.ZipFile(path) as archive:
        names = sorted(name for name in archive.namelist() if name == "word/document.xml" or name.startswith("word/header") or name.startswith("word/footer"))
        return xml_text(archive, names)


def extract_pptx(path: Path) -> str:
    with zipfile.ZipFile(path) as archive:
        names = sorted(name for name in archive.namelist() if re.fullmatch(r"ppt/slides/slide\d+\.xml", name))
        return xml_text(archive, names)


def extract_xlsx(path: Path) -> str:
    with zipfile.ZipFile(path) as archive:
        shared: list[str] = []
        if "xl/sharedStrings.xml" in archive.namelist():
            root = ElementTree.fromstring(archive.read("xl/sharedStrings.xml"))
            for item in root:
                shared.append(" ".join(node.text or "" for node in item.iter() if node.tag.endswith("}t")))
        rows: list[str] = []
        for name in sorted(n for n in archive.namelist() if re.fullmatch(r"xl/worksheets/sheet\d+\.xml", n)):
            root = ElementTree.fromstring(archive.read(name))
            for row in (node for node in root.iter() if node.tag.endswith("}row")):
                cells: list[str] = []
                for cell in (node for node in row if node.tag.endswith("}c")):
                    value_node = next((node for node in cell if node.tag.endswith("}v")), None)
                    inline = " ".join(node.text or "" for node in cell.iter() if node.tag.endswith("}t"))
                    value = inline or (value_node.text if value_node is not None else "") or ""
                    if cell.attrib.get("t") == "s" and value.isdigit() and int(value) < len(shared):
                        value = shared[int(value)]
                    cells.append(value)
                if any(cells):
                    rows.append("\t".join(cells))
        return "\n".join(rows)


def extract_pdf(path: Path) -> str:
    command = shutil.which("pdftotext")
    if not command:
        raise RuntimeError("pdftotext не найден")
    result = subprocess.run([command, "-layout", str(path), "-"], capture_output=True, check=False)
    if result.returncode:
        raise RuntimeError(result.stderr.decode("utf-8", errors="replace").strip() or "ошибка pdftotext")
    return result.stdout.decode("utf-8", errors="replace")


def extract_file(path: Path) -> str:
    suffix = path.suffix.casefold()
    if suffix in {".txt", ".md", ".csv"}:
        return path.read_text(encoding="utf-8", errors="replace")
    if suffix in {".html", ".htm"}:
        return html_to_text(path.read_text(encoding="utf-8", errors="replace"))
    if suffix == ".pdf":
        return extract_pdf(path)
    if suffix == ".docx":
        return extract_docx(path)
    if suffix == ".xlsx":
        return extract_xlsx(path)
    if suffix == ".pptx":
        return extract_pptx(path)
    raise ValueError(f"неподдерживаемый формат: {suffix or '[без расширения]'}")


def extract_message_text(message: Message) -> str:
    plain: list[str] = []
    rich: list[str] = []
    for part in message.walk():
        if part.get_content_disposition() == "attachment":
            continue
        if part.get_content_type() == "text/plain":
            plain.append(decode_payload(part))
        elif part.get_content_type() == "text/html":
            rich.append(html_to_text(decode_payload(part)))
    return "\n".join(plain or rich)


def atomic_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=path.parent, delete=False) as handle:
        json.dump(value, handle, ensure_ascii=False, indent=2, sort_keys=True)
        temp = Path(handle.name)
    temp.replace(path)


class Pipeline:
    def __init__(self, output: Path, batch_chars: int, batch_items: int) -> None:
        self.output = output
        self.extracted = output / "Извлеченный текст"
        self.batches = output / "Очередь проверки Codex"
        self.checkpoint_path = output / "Состояние обработки.json"
        self.records: dict[str, Record] = {}
        self.completed: dict[str, str] = {}
        self.new_review: list[tuple[Record, str]] = []
        self.stats = {"обнаружено": 0, "новая_работа": 0, "дубликаты": 0, "исключено": 0, "чувствительное": 0, "ошибки": 0}
        self.batch_chars = batch_chars
        self.batch_items = batch_items
        if self.checkpoint_path.exists():
            try:
                data = json.loads(self.checkpoint_path.read_text(encoding="utf-8"))
                stored_version = data.get("version")
                if not isinstance(stored_version, int) or not isinstance(data.get("completed"), dict):
                    raise ValueError("неверная версия или структура")
                self.completed = data["completed"] if stored_version == VERSION else {}
            except (OSError, json.JSONDecodeError, ValueError) as error:
                raise RuntimeError(f"повреждён checkpoint: {self.checkpoint_path}: {error}") from error

    def add_record(self, record: Record, text: str | None = None) -> None:
        existing = self.records.get(record.sha256)
        if existing:
            locations = list(existing.source_paths)
            for location in record.source_paths:
                if location not in locations:
                    locations.append(location)
            priority = {"исключено_корзина": 0, "исключено_спам_или_корзина": 0, "деловой_материал": 1, "чувствительные_данные_заявителя": 2, "секреты_и_доступы": 3}
            if priority.get(record.classification, 0) > priority.get(existing.classification, 0):
                record.source_paths = locations
                self.records[record.sha256] = record
                existing = record
            else:
                existing.source_paths = locations
            if existing.classification in {"секреты_и_доступы", "чувствительные_данные_заявителя"}:
                existing.extraction_status = "только_метаданные"
                existing.extracted_path = None
                (self.extracted / f"{record.sha256}.txt").unlink(missing_ok=True)
                self.completed.pop(record.sha256, None)
            self.stats["дубликаты"] += 1
            return
        self.records[record.sha256] = record
        if record.classification in {"секреты_и_доступы", "чувствительные_данные_заявителя"}:
            (self.extracted / f"{record.sha256}.txt").unlink(missing_ok=True)
            self.completed.pop(record.sha256, None)
        if text and record.extraction_status == "извлечено":
            self.new_review.append((record, text))

    def process_drive(self, root: Path) -> None:
        if not root.is_dir():
            raise FileNotFoundError(f"папка Google Drive не найдена: {root}")
        for path in sorted(p for p in root.rglob("*") if p.is_file()):
            self.stats["обнаружено"] += 1
            stat = path.stat()
            digest = sha256_file(path)
            rel = str(path.relative_to(root))
            if is_trash_path(path, root):
                self.stats["исключено"] += 1
                self.add_record(Record(digest, "google_drive", [rel], stat.st_size, datetime.fromtimestamp(stat.st_mtime, timezone.utc).isoformat(), "исключено_корзина", "не_извлекалось", path.suffix.casefold(), reason="путь находится в Корзине"))
                continue
            classification, reason = classify(rel)
            if classification != "деловой_материал":
                self.stats["чувствительное"] += 1
                self.add_record(Record(digest, "google_drive", [rel], stat.st_size, datetime.fromtimestamp(stat.st_mtime, timezone.utc).isoformat(), classification, "только_метаданные", path.suffix.casefold(), reason=reason))
                continue
            if path.suffix.casefold() not in SUPPORTED:
                self.add_record(Record(digest, "google_drive", [rel], stat.st_size, datetime.fromtimestamp(stat.st_mtime, timezone.utc).isoformat(), classification, "неподдерживаемый_формат", path.suffix.casefold()))
                continue
            self._extract_path(path, digest, "google_drive", rel, stat)

    def _extract_path(self, path: Path, digest: str, kind: str, source: str, stat: os.stat_result, metadata: dict[str, str] | None = None) -> None:
        existing = self.records.get(digest)
        if existing and existing.classification in {"секреты_и_доступы", "чувствительные_данные_заявителя"}:
            self.add_record(Record(digest, kind, [source], stat.st_size, datetime.fromtimestamp(stat.st_mtime, timezone.utc).isoformat(), "деловой_материал", "только_метаданные", path.suffix.casefold(), reason="совпадает с чувствительным объектом", metadata=metadata or {}))
            return
        target = self.extracted / f"{digest}.txt"
        if self.completed.get(digest) == "извлечено" and target.exists():
            self.add_record(Record(digest, kind, [source], stat.st_size, datetime.fromtimestamp(stat.st_mtime, timezone.utc).isoformat(), "деловой_материал", "извлечено", path.suffix.casefold(), str(target.relative_to(self.output)), metadata=metadata or {}))
            return
        try:
            text = redact_review_text(extract_file(path))
            if not text:
                status = "нужен_OCR" if path.suffix.casefold() == ".pdf" else "нет_текстового_содержимого"
                self.completed[digest] = status
                self.add_record(Record(digest, kind, [source], stat.st_size, datetime.fromtimestamp(stat.st_mtime, timezone.utc).isoformat(), "деловой_материал", status, path.suffix.casefold(), reason="локальный парсер не нашёл текстового слоя", metadata=metadata or {}))
                return
            self.extracted.mkdir(parents=True, exist_ok=True)
            target.write_text(text, encoding="utf-8")
            self.completed[digest] = "извлечено"
            self.stats["новая_работа"] += 1
            self.add_record(Record(digest, kind, [source], stat.st_size, datetime.fromtimestamp(stat.st_mtime, timezone.utc).isoformat(), "деловой_материал", "извлечено", path.suffix.casefold(), str(target.relative_to(self.output)), metadata=metadata or {}), text)
        except Exception as error:  # manifest must preserve parser failures
            self.stats["ошибки"] += 1
            self.completed[digest] = "ошибка"
            self.add_record(Record(digest, kind, [source], stat.st_size, datetime.fromtimestamp(stat.st_mtime, timezone.utc).isoformat(), "деловой_материал", "ошибка", path.suffix.casefold(), reason=str(error), metadata=metadata or {}))

    def process_mbox(self, path: Path) -> None:
        if not path.is_file():
            raise FileNotFoundError(f"MBOX не найден: {path}")
        box = mailbox.mbox(path, create=False)
        for index, message in enumerate(box):
            self.stats["обнаружено"] += 1
            raw = message.as_bytes(policy=email.policy.default)
            digest = sha256_bytes(raw)
            labels = safe_decode(message.get("X-Gmail-Labels"))
            subject = safe_decode(message.get("Subject"))
            source = f"{path.name}#сообщение-{index + 1}"
            if gmail_labels_excluded(labels):
                self.stats["исключено"] += 1
                self.add_record(Record(digest, "gmail", [source], len(raw), None, "исключено_спам_или_корзина", "не_извлекалось", "message/rfc822", reason="метка Gmail Spam/Trash"))
                continue
            classification, reason = classify(subject)
            if classification != "деловой_материал":
                self.stats["чувствительное"] += 1
                self.add_record(Record(digest, "gmail", [source], len(raw), None, classification, "только_метаданные", "message/rfc822", reason=reason))
                continue
            target = self.extracted / f"{digest}.txt"
            metadata = {"тема": redact_review_text(subject), "дата": safe_decode(message.get("Date"))}
            if self.completed.get(digest) == "извлечено" and target.exists():
                self.add_record(Record(digest, "gmail", [source], len(raw), None, classification, "извлечено", "message/rfc822", str(target.relative_to(self.output)), metadata=metadata))
            else:
                try:
                    raw_text = extract_message_text(message)
                    if body_is_sensitive(raw_text):
                        self.stats["чувствительное"] += 1
                        self.completed.pop(digest, None)
                        target.unlink(missing_ok=True)
                        self.add_record(Record(digest, "gmail", [source], len(raw), None, "чувствительные_данные_заявителя", "только_метаданные", "message/rfc822", reason="тело письма содержит признаки данных заявителя", metadata=metadata))
                        continue
                    text = redact_review_text(raw_text)
                    if not text:
                        self.completed[digest] = "нет_текстового_содержимого"
                        self.add_record(Record(digest, "gmail", [source], len(raw), None, classification, "нет_текстового_содержимого", "message/rfc822", reason="сообщение не содержит поддерживаемого текста", metadata=metadata))
                    else:
                        self.extracted.mkdir(parents=True, exist_ok=True)
                        target.write_text(text, encoding="utf-8")
                        self.completed[digest] = "извлечено"
                        self.stats["новая_работа"] += 1
                        record = Record(digest, "gmail", [source], len(raw), None, classification, "извлечено", "message/rfc822", str(target.relative_to(self.output)), metadata=metadata)
                        self.add_record(record, text)
                except Exception as error:
                    self.stats["ошибки"] += 1
                    self.completed[digest] = "ошибка"
                    self.add_record(Record(digest, "gmail", [source], len(raw), None, classification, "ошибка", "message/rfc822", reason=str(error), metadata=metadata))
            for part_index, part in enumerate(message.walk()):
                filename = safe_decode(part.get_filename())
                if not filename or part.get_content_disposition() != "attachment":
                    continue
                payload = part.get_payload(decode=True) or b""
                attachment_digest = sha256_bytes(payload)
                attachment_source = f"{source}#вложение-{part_index}-{filename}"
                attachment_class, attachment_reason = classify(f"{subject}/{filename}")
                if attachment_class != "деловой_материал":
                    self.stats["чувствительное"] += 1
                    self.add_record(Record(attachment_digest, "gmail_attachment", [attachment_source], len(payload), None, attachment_class, "только_метаданные", Path(filename).suffix.casefold(), reason=attachment_reason))
                    continue
                suffix = Path(filename).suffix.casefold()
                if suffix not in SUPPORTED:
                    self.add_record(Record(attachment_digest, "gmail_attachment", [attachment_source], len(payload), None, attachment_class, "неподдерживаемый_формат", suffix))
                    continue
                with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as handle:
                    handle.write(payload)
                    temp = Path(handle.name)
                try:
                    self._extract_path(temp, attachment_digest, "gmail_attachment", attachment_source, temp.stat())
                finally:
                    temp.unlink(missing_ok=True)

    def finish(self) -> None:
        self.output.mkdir(parents=True, exist_ok=True)
        allowed_extracted = {
            record.sha256
            for record in self.records.values()
            if record.classification == "деловой_материал" and record.extraction_status == "извлечено"
        }
        if self.extracted.is_dir():
            for path in self.extracted.glob("*.txt"):
                if path.stem not in allowed_extracted:
                    path.unlink()
        self.stats["ошибки"] = sum(record.extraction_status == "ошибка" for record in self.records.values())
        manifest = self.output / "Манифест источников.jsonl"
        with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=self.output, delete=False) as handle:
            for digest in sorted(self.records):
                record = self.records[digest]
                record.source_paths.sort()
                handle.write(json.dumps(asdict(record), ensure_ascii=False, sort_keys=True) + "\n")
            temp = Path(handle.name)
        temp.replace(manifest)
        atomic_json(self.checkpoint_path, {"version": VERSION, "completed": self.completed})
        self.batches.mkdir(parents=True, exist_ok=True)
        for old in self.batches.glob("Пакет *.md"):
            old.unlink()
        header = self._batch_header()
        batch: list[str] = []
        chars = len(header)
        number = 1
        review_items: list[tuple[Record, str]] = []
        for record in self.records.values():
            if record.classification != "деловой_материал" or record.extraction_status != "извлечено" or not record.extracted_path:
                continue
            extracted_path = self.output / record.extracted_path
            if extracted_path.is_file():
                review_items.append((record, extracted_path.read_text(encoding="utf-8")))
        max_content = max(1000, self.batch_chars - len(header) - 500)
        for record, content in sorted(review_items, key=lambda item: item[0].sha256):
            chunks = [content[index:index + max_content] for index in range(0, len(content), max_content)] or [""]
            for chunk_number, chunk in enumerate(chunks, 1):
                chunk_label = f" — часть {chunk_number} из {len(chunks)}" if len(chunks) > 1 else ""
                entry = f"## {record.sha256}{chunk_label}\n\nИсточник: `{record.source_kind}` — `{record.source_paths[0]}`\n\n{chunk}\n"
                if batch and (len(batch) >= self.batch_items or chars + len(entry) > self.batch_chars):
                    self._write_batch(number, batch)
                    number += 1
                    batch, chars = [], len(header)
                batch.append(entry)
                chars += len(entry)
        if batch:
            self._write_batch(number, batch)
        batch_manifest = {
            path.name: sha256_file(path)
            for path in sorted(self.batches.glob("Пакет *.md"))
        }
        atomic_json(self.output / "Манифест пакетов Codex.json", {"version": VERSION, "batches": batch_manifest})
        atomic_json(self.output / "Отчет последнего запуска.json", {"версия": VERSION, "завершено": datetime.now(timezone.utc).isoformat(), **self.stats})

    def _write_batch(self, number: int, entries: list[str]) -> None:
        (self.batches / f"Пакет {number:04d}.md").write_text(self._batch_header() + "\n".join(entries), encoding="utf-8")

    @staticmethod
    def _batch_header() -> str:
        return "# Пакет проверки Codex\n\nПроверь только факты EVO. Не публикуй персональные данные, секреты или неподтверждённые выводы. Пиши по-русски и сохраняй ссылки на SHA-256 и источник.\n\n"


def ensure_output(output: Path, authorized_root: Path) -> tuple[Path, Path]:
    authorized = authorized_root.expanduser().resolve()
    target = output.expanduser().resolve()
    if target == authorized or authorized not in target.parents:
        raise ValueError(f"output должен находиться внутри разрешённой папки: {authorized}")
    target.mkdir(parents=True, exist_ok=True)
    return target, authorized


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description="Подготовить реальные источники EVO для проверки в Codex без LLM API.")
    result.add_argument("--drive-root", type=Path, help="корень распакованного Google Drive")
    result.add_argument("--gmail-mbox", type=Path, help="файл Gmail MBOX")
    result.add_argument("--output", type=Path, required=True, help="папка результата")
    result.add_argument("--authorized-root", type=Path, required=True, help="разрешённый корень результата")
    result.add_argument("--batch-chars", type=int, default=80_000)
    result.add_argument("--batch-items", type=int, default=25)
    return result


def main(argv: list[str] | None = None) -> int:
    args = parser().parse_args(argv)
    if not args.drive_root and not args.gmail_mbox:
        parser().error("нужен хотя бы один источник: --drive-root или --gmail-mbox")
    try:
        output, _ = ensure_output(args.output, args.authorized_root)
        pipeline = Pipeline(output, args.batch_chars, args.batch_items)
        if args.drive_root:
            pipeline.process_drive(args.drive_root.expanduser().resolve())
        if args.gmail_mbox:
            pipeline.process_mbox(args.gmail_mbox.expanduser().resolve())
        pipeline.finish()
        print(json.dumps(pipeline.stats, ensure_ascii=False, sort_keys=True))
        return 1 if pipeline.stats["ошибки"] else 0
    except (FileNotFoundError, RuntimeError, ValueError) as error:
        print(f"Ошибка: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
