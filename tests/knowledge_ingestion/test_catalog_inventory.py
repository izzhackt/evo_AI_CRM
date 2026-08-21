from __future__ import annotations

import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SCRIPTS = ROOT / "scripts" / "knowledge_ingestion"
sys.path.insert(0, str(SCRIPTS))

SPEC = importlib.util.spec_from_file_location(
    "catalog_inventory", SCRIPTS / "catalog_inventory.py"
)
assert SPEC and SPEC.loader
inventory = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = inventory
SPEC.loader.exec_module(inventory)


NOTE = """---
статус: утверждено_для_внутреннего_ИИ
язык: ru
---

# {title}

{body}
"""


def write_vault(root: Path, notes: dict[str, tuple[str, str]]) -> Path:
    """Создаёт минимальное внутреннее хранилище с точным маркером."""
    vault = root / "Внутренняя база знаний ЭВО"
    approved = vault / "Утверждено для внутреннего ИИ"
    (approved / inventory.CATALOG_FOLDER).mkdir(parents=True)
    marker = {"kind": "evo_internal_knowledge", "canonical_path": str(vault.resolve())}
    (vault / ".evo-vault.json").write_text(
        json.dumps(marker, ensure_ascii=False), encoding="utf-8"
    )
    for name, (title, body) in notes.items():
        target = approved / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(NOTE.format(title=title, body=body), encoding="utf-8")
    return approved


class ClassificationTests(unittest.TestCase):
    def test_programme_title_yields_level(self) -> None:
        category, level = inventory.classify("INTI Diploma in Business")
        self.assertEqual(category, "программа")
        self.assertEqual(level, "diploma")

    def test_every_level_token_is_recognised(self) -> None:
        expected = {
            "APU Foundation Programme": "foundation",
            "INTI Certificate in Business Studies": "certificate",
            "INTI Diploma in Accounting": "diploma",
            "INTI Bachelor of Civil Engineering with Honours": "bachelor",
            "INTI Master in Information Technology": "master",
            "Doctor of Education": "doctoral",
            "Cambridge A-Level в INTI": "pre_university",
        }
        for title, level in expected.items():
            with self.subTest(title=title):
                self.assertEqual(inventory.detect_level(title), level)

    def test_institution_profile_is_not_a_programme(self) -> None:
        for title in (
            "Кампус Sunway University",
            "APU имеет аккредитацию QAA UK",
            "APU в QS World University Rankings 2025",
            "Профиль INTI в брошюре 2026",
        ):
            with self.subTest(title=title):
                self.assertEqual(inventory.classify(title)[0], "профиль_заведения")

    def test_worksheet_is_its_own_category(self) -> None:
        category, level = inventory.classify(
            "Рабочая таблица EVO по университетам Малайзии"
        )
        self.assertEqual(category, "рабочая_таблица")
        self.assertIsNone(level)

    def test_reference_material_is_not_promoted_to_programme(self) -> None:
        # Заголовок содержит уровень, но документ описывает требования, а не
        # конкретную программу. Он не должен стать кандидатом каталога.
        category, _ = inventory.classify(
            "Admission requirements для Foundation и Diploma APU"
        )
        self.assertEqual(category, "справочный_материал")

    def test_unknown_title_is_flagged_not_guessed(self) -> None:
        category, level = inventory.classify("INTI- Traditional Chinese Medicine")
        self.assertEqual(category, "требует_ручной_классификации")
        self.assertIsNone(level)


class InstitutionDetectionTests(unittest.TestCase):
    def test_host_institution_is_resolved_with_kind_and_country(self) -> None:
        name, kind, country = inventory.detect_host("Sunway University Business School")
        self.assertEqual(name, "Sunway University")
        self.assertEqual(kind, "university")
        self.assertEqual(country, "MY")

    def test_apiit_is_a_college_not_a_university(self) -> None:
        _, kind, _ = inventory.detect_host("APIIT Certificate in Administrative Skills")
        self.assertEqual(kind, "college")

    def test_partner_university_is_not_a_host(self) -> None:
        title = "INTI BSc with Honours in Computer Science 3+0 with Coventry University"
        name, _, _ = inventory.detect_host(title)
        self.assertEqual(name, "INTI International University and Colleges")
        self.assertIn("COVENTRY", inventory.detect_partners(title))

    def test_unknown_institution_returns_none_rather_than_a_guess(self) -> None:
        self.assertEqual(inventory.detect_host("Брошюры SPD по BA-программам"), (None, None, None))


class InventoryBuildTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        # macOS отдаёт временную папку под символической ссылкой /var. Читатель
        # хранилища справедливо запрещает символические ссылки, поэтому фикстура
        # использует уже разрешённый путь.
        self.root = Path(self.temporary.name).resolve()
        self.addCleanup(self.temporary.cleanup)

    def test_inventory_records_provenance_and_summary(self) -> None:
        approved = write_vault(
            self.root,
            {
                f"{inventory.CATALOG_FOLDER}/INTI Diploma in Business.md": (
                    "INTI Diploma in Business",
                    "Двухлетняя программа.",
                ),
                f"{inventory.CATALOG_FOLDER}/Кампус Sunway University.md": (
                    "Кампус Sunway University",
                    "Описание кампуса.",
                ),
                "Страны/Малайзия.md": ("Малайзия", "Вне папки каталога."),
            },
        )
        result = inventory.build_inventory(approved)
        summary = result["summary"]

        # Документ вне папки каталога не попадает в инвентаризацию.
        self.assertEqual(summary["documents_total"], 2)
        self.assertEqual(summary["by_category"]["программа"], 1)
        self.assertEqual(summary["by_category"]["профиль_заведения"], 1)

        for record in result["documents"]:
            self.assertRegex(record["source_sha256"], r"^[0-9a-f]{64}$")
            self.assertTrue(record["source_path"].startswith(inventory.CATALOG_FOLDER))

    def test_host_resolved_from_body_is_reported_as_such(self) -> None:
        approved = write_vault(
            self.root,
            {
                f"{inventory.CATALOG_FOLDER}/Doctor of Education.md": (
                    "Doctor of Education",
                    "Программу предлагает Sunway University.",
                ),
            },
        )
        result = inventory.build_inventory(approved)
        record = result["documents"][0]
        self.assertEqual(record["host_institution"], "Sunway University")
        self.assertEqual(record["host_institution_source"], "body")
        self.assertIn(
            record["source_path"],
            result["summary"]["documents_with_host_resolved_from_body"],
        )

    def test_missing_institution_is_reported_not_invented(self) -> None:
        approved = write_vault(
            self.root,
            {
                f"{inventory.CATALOG_FOLDER}/Брошюры SPD.md": (
                    "Брошюры SPD по BA-программам в fashion",
                    "Материалы без принимающего заведения.",
                ),
            },
        )
        result = inventory.build_inventory(approved)
        record = result["documents"][0]
        self.assertIsNone(record["host_institution"])
        self.assertIsNone(record["host_institution_source"])
        self.assertIsNone(record["country_code"])
        self.assertIn(
            record["source_path"],
            result["summary"]["documents_without_host_institution"],
        )

    def test_worksheet_rows_are_counted(self) -> None:
        columns = "\t".join(["Университет", "Город", "Набор", "Степень", "Язык"])
        approved = write_vault(
            self.root,
            {
                f"{inventory.CATALOG_FOLDER}/Рабочая таблица.md": (
                    "Рабочая таблица EVO по университетам Малайзии",
                    f"{columns}\n{columns}\nобычная строка",
                ),
            },
        )
        result = inventory.build_inventory(approved)
        self.assertEqual(result["documents"][0]["worksheet_rows"], 2)
        self.assertEqual(result["summary"]["worksheet_data_rows"], 2)

    def test_output_is_deterministic(self) -> None:
        notes = {
            f"{inventory.CATALOG_FOLDER}/б.md": ("APU Foundation Programme", "Текст."),
            f"{inventory.CATALOG_FOLDER}/а.md": ("INTI Diploma in Business", "Текст."),
        }
        first = write_vault(self.root / "one", notes)
        second = write_vault(self.root / "two", notes)
        left = inventory.build_inventory(first)
        right = inventory.build_inventory(second)
        self.assertEqual(
            [item["source_path"] for item in left["documents"]],
            sorted(item["source_path"] for item in left["documents"]),
        )
        self.assertEqual(inventory.canonical(left), inventory.canonical(right))


if __name__ == "__main__":
    unittest.main()
