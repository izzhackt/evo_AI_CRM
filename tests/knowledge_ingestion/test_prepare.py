from __future__ import annotations

import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock


ROOT = Path(__file__).resolve().parents[2]
MODULE_PATH = ROOT / "scripts" / "knowledge_ingestion" / "prepare.py"
SPEC = importlib.util.spec_from_file_location("knowledge_prepare", MODULE_PATH)
assert SPEC and SPEC.loader
prepare = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = prepare
SPEC.loader.exec_module(prepare)


def load_module(name: str, filename: str):
    spec = importlib.util.spec_from_file_location(name, ROOT / "scripts" / "knowledge_ingestion" / filename)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


review = load_module("review", "review.py")
publish = load_module("knowledge_publish", "publish.py")


class ClassificationTests(unittest.TestCase):
    def test_sensitive_applicant_document_is_metadata_only(self) -> None:
        classification, _ = prepare.classify("Студенты/Иван/Паспорт.pdf")
        self.assertEqual(classification, "чувствительные_данные_заявителя")

    def test_credentials_are_separate_from_business_content(self) -> None:
        classification, _ = prepare.classify("Администрирование/Доступы amoCRM.xlsx")
        self.assertEqual(classification, "секреты_и_доступы")

    def test_business_document_is_allowed_for_local_extraction(self) -> None:
        classification, reason = prepare.classify("Университеты/Стоимость программ.xlsx")
        self.assertEqual((classification, reason), ("деловой_материал", None))

    def test_individual_contract_is_conservatively_sensitive(self) -> None:
        classification, _ = prepare.classify("Китай/Иванов Иван Договор.docx")
        self.assertEqual(classification, "чувствительные_данные_заявителя")

    def test_contract_template_remains_business_material(self) -> None:
        classification, _ = prepare.classify("Китай/Шаблон договора.docx")
        self.assertEqual(classification, "деловой_материал")

    def test_student_directory_is_sensitive(self) -> None:
        classification, _ = prepare.classify("Студенты/Документы/Обычное название.pdf")
        self.assertEqual(classification, "чувствительные_данные_заявителя")

    def test_sensitive_email_body_is_detected(self) -> None:
        self.assertTrue(prepare.body_is_sensitive("Applicant passport details are attached"))

    def test_gmail_spam_and_trash_labels_are_excluded(self) -> None:
        self.assertTrue(prepare.gmail_labels_excluded("Inbox,Spam"))
        self.assertTrue(prepare.gmail_labels_excluded("Корзина"))
        self.assertFalse(prepare.gmail_labels_excluded("Inbox,Important"))


class RealParserTests(unittest.TestCase):
    def test_repository_docx_is_parsed(self) -> None:
        text = prepare.extract_docx(ROOT / "docs" / "specs" / "EVO_PLATFORM_TZ.docx")
        self.assertIn("EVO", text)

    def test_repository_pdf_is_parsed(self) -> None:
        text = prepare.extract_pdf(ROOT / "docs" / "company" / "brand" / "evo-admissions-logobook.pdf")
        self.assertTrue(text.strip())

    def test_repository_pptx_is_parsed(self) -> None:
        text = prepare.extract_pptx(ROOT / "presentations" / "evo-admissions-platform-overview.pptx")
        self.assertIn("EVO", text)

    def test_repository_html_is_parsed(self) -> None:
        source = ROOT / "docs" / "design" / "evo-platform" / "prototype" / "EVO Platform.dc.html"
        text = prepare.extract_file(source)
        self.assertIn("EVO", text)


class BoundaryTests(unittest.TestCase):
    def test_output_must_be_below_authorized_root(self) -> None:
        with tempfile.TemporaryDirectory() as first, tempfile.TemporaryDirectory() as second:
            with self.assertRaises(ValueError):
                prepare.ensure_output(Path(second) / "out", Path(first))

    def test_corrupt_checkpoint_fails_closed(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            (output / "Состояние обработки.json").write_text("not-json", encoding="utf-8")
            with self.assertRaises(RuntimeError):
                prepare.Pipeline(output, 1000, 2)

    def test_older_policy_checkpoint_is_safely_invalidated(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            checkpoint = {"version": prepare.VERSION - 1, "completed": {"old-sha": "извлечено"}}
            (output / "Состояние обработки.json").write_text(json.dumps(checkpoint), encoding="utf-8")
            pipeline = prepare.Pipeline(output, 1000, 2)
            self.assertEqual(pipeline.completed, {})

    def test_second_run_has_zero_new_work(self) -> None:
        source = ROOT / "docs" / "specs" / "EVO_PLATFORM_TZ.docx"
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            drive = root / "drive"
            drive.mkdir()
            linked = drive / source.name
            linked.symlink_to(source)
            output = root / "authorized" / "run"
            output.mkdir(parents=True)
            first = prepare.Pipeline(output, 100_000, 25)
            first.process_drive(drive)
            first.finish()
            self.assertEqual(first.stats["новая_работа"], 1)
            batch_manifest = json.loads((output / "Манифест пакетов Codex.json").read_text(encoding="utf-8"))
            batch_file = next((output / "Очередь проверки Codex").glob("Пакет *.md"))
            self.assertEqual(batch_manifest["batches"][batch_file.name], prepare.sha256_file(batch_file))
            second = prepare.Pipeline(output, 100_000, 25)
            second.process_drive(drive)
            second.finish()
            self.assertEqual(second.stats["новая_работа"], 0)
            report = json.loads((output / "Отчет последнего запуска.json").read_text(encoding="utf-8"))
            self.assertEqual(report["новая_работа"], 0)

    def test_active_copy_wins_over_identical_trash_copy(self) -> None:
        source = ROOT / "docs" / "specs" / "EVO_PLATFORM_TZ.docx"
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            drive = root / "drive"
            trash = drive / "Корзина"
            trash.mkdir(parents=True)
            (trash / source.name).symlink_to(source)
            (drive / source.name).symlink_to(source)
            output = root / "output"
            pipeline = prepare.Pipeline(output, 100_000, 25)
            pipeline.process_drive(drive)
            pipeline.finish()
            record = next(iter(pipeline.records.values()))
            self.assertEqual(record.classification, "деловой_материал")
            self.assertEqual(record.extraction_status, "извлечено")
            self.assertEqual(len(record.source_paths), 2)

    def test_batches_never_exceed_character_limit(self) -> None:
        source = ROOT / "docs" / "specs" / "EVO_PLATFORM_TZ.docx"
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            pipeline = prepare.Pipeline(output, 5000, 25)
            digest = prepare.sha256_file(source)
            pipeline.extracted.mkdir(parents=True)
            extracted = pipeline.extracted / f"{digest}.txt"
            extracted.write_text(prepare.extract_docx(source), encoding="utf-8")
            pipeline.records[digest] = prepare.Record(
                digest, "google_drive", [source.name], source.stat().st_size,
                None, "деловой_материал", "извлечено", ".docx",
                str(extracted.relative_to(output)),
            )
            pipeline.finish()
            sizes = [len(path.read_text(encoding="utf-8")) for path in pipeline.batches.glob("*.md")]
            self.assertTrue(sizes)
            self.assertLessEqual(max(sizes), 5000)


class ReviewPublicationTests(unittest.TestCase):
    def test_single_source_batch_canonicalizes_a_well_formed_wrong_hash(self) -> None:
        allowed = "a" * 64
        item = {
            "decision": "ignore", "claim_key": "noise", "authority": "legacy_or_unknown",
            "title": "Шум", "section": "Неопределенное", "summary": "Нет устойчивого знания.",
            "facts": [], "sources": ["b" * 64], "reason": "Служебный фрагмент.",
        }
        result = review.validate_result({"items": [item]}, {allowed})
        self.assertEqual(result["items"][0]["sources"], [allowed])

    def test_multi_source_batch_still_rejects_a_hash_outside_the_batch(self) -> None:
        allowed = {"a" * 64, "b" * 64}
        data = {
            "items": [{
                "decision": "ignore", "claim_key": "noise", "authority": "legacy_or_unknown",
                "title": "Шум", "section": "Неопределенное", "summary": "Нет устойчивого знания.",
                "facts": [], "sources": ["c" * 64], "reason": "Служебный фрагмент.",
            }]
        }
        with self.assertRaises(ValueError):
            review.validate_result(data, allowed)

    def test_phone_detection_allows_dates_but_rejects_real_numbers(self) -> None:
        self.assertFalse(review.contains_phone("Документ действует с 14.08.2026 и имеет код 1234-5678."))
        self.assertTrue(review.contains_phone("Контакт: +996 555 123 456"))
        self.assertTrue(review.contains_phone("Контакт: 0555 123 456"))
        self.assertTrue(review.contains_phone("Идентификатор: 1234567890123456"))

    def test_review_timeout_retries_then_fails_closed_and_cleans_up(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "Внутренняя база знаний ЭВО" / "Входящие кандидаты"
            pipeline = root / "Конвейер импорта"
            queue = pipeline / "Очередь проверки Codex"
            output = root / "Результаты проверки Codex"
            queue.mkdir(parents=True)
            source = "a" * 64
            batch = queue / "Пакет 0001.md"
            batch.write_text(f"## {source}\n\nРабочий материал", encoding="utf-8")
            (pipeline / "Манифест источников.jsonl").write_text(
                json.dumps({"sha256": source, "classification": "деловой_материал", "extraction_status": "извлечено"}) + "\n",
                encoding="utf-8",
            )
            (pipeline / "Манифест пакетов Codex.json").write_text(
                json.dumps({"version": prepare.VERSION, "batches": {batch.name: prepare.sha256_file(batch)}}),
                encoding="utf-8",
            )
            temporary_paths: list[Path] = []
            original_named_temporary_file = tempfile.NamedTemporaryFile

            def tracked_temporary_file(*args, **kwargs):
                handle = original_named_temporary_file(*args, **kwargs)
                temporary_paths.append(Path(handle.name))
                return handle

            timeout = review.subprocess.TimeoutExpired(cmd=["codex", "exec"], timeout=1)
            arguments = [
                "--queue", str(queue), "--output", str(output), "--authorized-root", str(root),
                "--max-attempts", "2", "--timeout-seconds", "1",
            ]
            with mock.patch.object(review.shutil, "which", return_value="/usr/bin/codex"), \
                 mock.patch.object(review.tempfile, "NamedTemporaryFile", side_effect=tracked_temporary_file), \
                 mock.patch.object(review.subprocess, "run", side_effect=timeout) as run:
                self.assertEqual(review.main(arguments), 2)

            self.assertEqual(run.call_count, 2)
            self.assertTrue(all(not path.exists() for path in temporary_paths))
            self.assertFalse((output / "Пакет 0001.json").exists())
            self.assertFalse((output / "Пакет 0001.sha256").exists())

    def test_review_rejects_source_outside_current_batch(self) -> None:
        source = "a" * 64
        data = {"items": [{"decision": "approve", "sources": [source]}]}
        with self.assertRaises(ValueError):
            review.validate_result(data, {"b" * 64})

    def test_orphan_review_result_and_fingerprint_are_removed(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            result = output / "Пакет 9999.json"
            result.write_text("{}", encoding="utf-8")
            result.with_suffix(".sha256").write_text("a" * 64, encoding="utf-8")
            self.assertEqual(review.remove_orphan_results(output, {"Пакет 0001.md"}), 1)
            self.assertFalse(result.exists())
            self.assertFalse(result.with_suffix(".sha256").exists())

    def test_material_claim_is_forced_to_escalation(self) -> None:
        for title in ("Гарантия визы", "Visa guarantee", "Тариф и оплата", "Refund", "Контракт"):
            with self.subTest(title=title):
                item = {"title": title, "summary": "", "facts": []}
                self.assertTrue(publish.material(item))

    def test_escalated_note_is_not_marked_approved(self) -> None:
        item = {"title": "Вопрос", "summary": "Нужно решение", "facts": [], "sources": ["a" * 64]}
        text = publish.render(item, "требует_решения")
        self.assertIn("статус: требует_решения", text)
        self.assertNotIn("статус: утверждено_для_внутреннего_ИИ", text)

    def test_api_credentials_are_removed_from_codex_environment(self) -> None:
        original = dict(review.os.environ)
        try:
            review.os.environ["OPENAI_API_KEY"] = "must-not-pass"
            review.os.environ["SOME_PROVIDER_TOKEN"] = "must-not-pass"
            environment = review.codex_environment()
            self.assertNotIn("OPENAI_API_KEY", environment)
            self.assertNotIn("SOME_PROVIDER_TOKEN", environment)
        finally:
            review.os.environ.clear()
            review.os.environ.update(original)

    def test_client_vault_boundary_fails_closed(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "Клиентская база знаний ЭВО"
            vault = root / "Утверждено для внутреннего ИИ"
            with self.assertRaises(ValueError):
                publish.validate_internal_vault(vault, root)

    def test_internal_vault_boundary_is_accepted(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "Внутренняя база знаний ЭВО"
            vault = root / "Утверждено для внутреннего ИИ"
            root.mkdir()
            (root / ".evo-vault.json").write_text(json.dumps({"kind": "evo_internal_knowledge", "canonical_path": str(root.resolve())}), encoding="utf-8")
            publish.validate_internal_vault(vault, root)

    def test_publication_removes_only_stale_managed_note(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            root = base / "Внутренняя база знаний ЭВО"
            incoming = root / "Входящие кандидаты"
            reviews = incoming / "Результаты проверки Codex"
            reviews.mkdir(parents=True)
            vault = root / "Утверждено для внутреннего ИИ"
            (root / ".evo-vault.json").write_text(json.dumps({"kind": "evo_internal_knowledge", "canonical_path": str(root.resolve())}), encoding="utf-8")
            source = "a" * 64
            pipeline = incoming / "Конвейер импорта"
            queue = pipeline / "Очередь проверки Codex"
            queue.mkdir(parents=True)
            batch = queue / "Пакет 0001.md"
            batch.write_text(f"## {source}\n\nРеальный источник", encoding="utf-8")
            batch_fingerprint = prepare.sha256_file(batch)
            fingerprint = review.review_fingerprint(batch.read_text(encoding="utf-8"))
            (pipeline / "Манифест источников.jsonl").write_text(json.dumps({"sha256": source, "classification": "деловой_материал", "extraction_status": "извлечено"}) + "\n", encoding="utf-8")
            (pipeline / "Манифест пакетов Codex.json").write_text(json.dumps({"version": prepare.VERSION, "batches": {batch.name: batch_fingerprint}}), encoding="utf-8")
            item = {
                "decision": "approve", "title": "Рабочий процесс", "section": "Процессы",
                "claim_key": "working-process", "authority": "evo_active_document",
                "summary": "Внутренний порядок работы.", "facts": ["Порядок описан."],
                "sources": [source], "reason": "Ясный деловой материал."
            }
            result = reviews / "Пакет 0001.json"
            result.write_text(json.dumps({"items": [item]}, ensure_ascii=False), encoding="utf-8")
            result.with_suffix(".sha256").write_text(fingerprint, encoding="utf-8")
            arguments = ["--reviews", str(reviews), "--queue", str(queue), "--authorized-root", str(root), "--vault", str(vault)]
            self.assertEqual(publish.main(arguments), 0)
            managed = json.loads((vault / ".Манифест публикации Codex.json").read_text(encoding="utf-8"))["files"]
            self.assertEqual(len(managed), 1)
            unmanaged = vault / "Моя ручная заметка.md"
            unmanaged.write_text("Не удалять", encoding="utf-8")
            item["decision"] = "ignore"
            result.write_text(json.dumps({"items": [item]}, ensure_ascii=False), encoding="utf-8")
            self.assertEqual(publish.main(arguments), 0)
            self.assertFalse((vault / managed[0]).exists())
            self.assertTrue(unmanaged.exists())

    def test_higher_authority_escalation_blocks_lower_approval(self) -> None:
        low = {
            "decision": "approve", "claim_key": "country-deadline", "authority": "legacy_or_unknown",
            "title": "Срок подачи", "section": "Страны", "summary": "Срок A", "facts": ["A"],
            "sources": ["a" * 64], "reason": "Старый документ"
        }
        high = {
            "decision": "escalate", "claim_key": "country-deadline", "authority": "owner_director",
            "title": "Срок подачи", "section": "Страны", "summary": "Срок B", "facts": ["B"],
            "sources": ["b" * 64], "reason": "Нужно подтверждение"
        }
        self.assertTrue(publish.conflict_blocks(low, [low, high]))


if __name__ == "__main__":
    unittest.main()
