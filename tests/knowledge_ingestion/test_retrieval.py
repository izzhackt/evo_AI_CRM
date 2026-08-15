import json
import tempfile
import unittest
from pathlib import Path

from scripts.knowledge_ingestion import check_retrieval


class RetrievalGateTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name).resolve()
        self.internal_root = root / "Внутренняя база знаний ЭВО"
        self.internal = self.internal_root / "Утверждено для внутреннего ИИ"
        self.client = root / "Клиентская база знаний ЭВО"
        self.internal.mkdir(parents=True)
        self.client.mkdir()
        (self.internal_root / ".evo-vault.json").write_text(json.dumps({"kind": "evo_internal_knowledge", "canonical_path": str(self.internal_root.resolve())}), encoding="utf-8")
        (self.client / ".evo-vault.json").write_text(json.dumps({"kind": "evo_client_knowledge", "canonical_path": str(self.client.resolve())}), encoding="utf-8")
        (self.internal / "Процессы").mkdir()
        (self.internal / "Процессы" / "Передача клиента.md").write_text("# Передача клиента\nПередача клиента из отдела продаж в сопровождение.", encoding="utf-8")
        (self.client / "Страны" / "Китай").mkdir(parents=True)
        (self.client / "Страны" / "Китай" / "Документы.md").write_text("# Документы для Китая\nЧек-лист документов для поступления в Китай.", encoding="utf-8")
        self.cases = root / "cases.json"
        self.cases.write_text(json.dumps({"version": 1, "cases": [
            {"vault": "internal", "query": "как передать клиента в сопровождение", "top_k": 1, "expected_paths": ["Процессы/Передача клиента.md"]},
            {"vault": "client", "query": "документы для поступления в Китай", "top_k": 1, "expected_paths": ["Страны/Китай/Документы.md"]},
        ]}, ensure_ascii=False), encoding="utf-8")
        self.report = self.internal_root / "Панель управления" / "Отчёт проверки поиска.json"

    def tearDown(self) -> None:
        self.temp.cleanup()

    def run_gate(self) -> int:
        return check_retrieval.main(["--internal-vault", str(self.internal), "--client-vault", str(self.client), "--cases", str(self.cases), "--report", str(self.report)])

    def test_real_markdown_cases_write_machine_readable_report(self) -> None:
        self.assertEqual(self.run_gate(), 0)
        report = json.loads(self.report.read_text(encoding="utf-8"))
        self.assertEqual(report["passed"], 2)
        self.assertEqual(report["failed"], 0)
        self.assertEqual(report["searched_roots"], [str(self.internal.resolve()), str(self.client.resolve())])
        self.assertTrue(report["forbidden_roots_excluded"])

    def test_unexpected_case_field_and_forbidden_expected_path_fail(self) -> None:
        data = json.loads(self.cases.read_text(encoding="utf-8"))
        data["cases"][0]["extra"] = True
        self.cases.write_text(json.dumps(data), encoding="utf-8")
        with self.assertRaises(ValueError):
            self.run_gate()
        self.assertFalse(self.report.exists())
        data["cases"][0].pop("extra")
        data["cases"][0]["expected_paths"] = ["../Сырой архив ЭВО/утечка.md"]
        self.cases.write_text(json.dumps(data), encoding="utf-8")
        with self.assertRaises(ValueError):
            self.run_gate()

    def test_forbidden_nested_archive_fails_before_report_write(self) -> None:
        forbidden = self.internal / "Сырой архив ЭВО"
        forbidden.mkdir()
        (forbidden / "Утечка.md").write_text("# Закрытый материал", encoding="utf-8")
        with self.assertRaises(ValueError):
            self.run_gate()
        self.assertFalse(self.report.exists())

        (forbidden / "Утечка.md").unlink()
        forbidden.rmdir()
        data = json.loads(self.cases.read_text(encoding="utf-8"))
        data["cases"][0]["expected_paths"] = ["Секреты и доступы ЭВО/Пароли.md"]
        self.cases.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
        with self.assertRaises(ValueError):
            self.run_gate()
        self.assertFalse(self.report.exists())

    def test_symlinked_markdown_is_rejected(self) -> None:
        target = self.internal / "Процессы" / "Передача клиента.md"
        link = self.internal / "Процессы" / "Ссылка.md"
        link.symlink_to(target)
        with self.assertRaises(ValueError):
            self.run_gate()

    def test_symlinked_directory_and_vault_root_are_rejected(self) -> None:
        real = self.internal / "Другие процессы"
        real.mkdir()
        (real / "Заметка.md").write_text("# Заметка", encoding="utf-8")
        (self.internal / "Ссылка на процессы").symlink_to(real, target_is_directory=True)
        with self.assertRaises(ValueError):
            self.run_gate()
        (self.internal / "Ссылка на процессы").unlink()
        alias = self.internal_root.parent / "Внутренняя ссылка"
        alias.symlink_to(self.internal_root, target_is_directory=True)
        with self.assertRaises(ValueError):
            check_retrieval.main(["--internal-vault", str(alias / "Утверждено для внутреннего ИИ"), "--client-vault", str(self.client), "--cases", str(self.cases), "--report", str(self.report)])

    def test_missing_expected_result_returns_nonzero(self) -> None:
        data = json.loads(self.cases.read_text(encoding="utf-8"))
        data["cases"][0]["expected_paths"] = ["Процессы/Несуществующее.md"]
        self.cases.write_text(json.dumps(data), encoding="utf-8")
        self.assertEqual(self.run_gate(), 1)
        report = json.loads(self.report.read_text(encoding="utf-8"))
        self.assertEqual(report["failed"], 1)


if __name__ == "__main__":
    unittest.main()
