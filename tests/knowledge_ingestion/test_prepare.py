from __future__ import annotations

import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
MODULE_PATH = ROOT / "scripts" / "knowledge_ingestion" / "prepare.py"
SPEC = importlib.util.spec_from_file_location("knowledge_prepare", MODULE_PATH)
assert SPEC and SPEC.loader
prepare = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = prepare
SPEC.loader.exec_module(prepare)


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
            second = prepare.Pipeline(output, 100_000, 25)
            second.process_drive(drive)
            second.finish()
            self.assertEqual(second.stats["новая_работа"], 0)
            report = json.loads((output / "Отчет последнего запуска.json").read_text(encoding="utf-8"))
            self.assertEqual(report["новая_работа"], 0)


if __name__ == "__main__":
    unittest.main()
