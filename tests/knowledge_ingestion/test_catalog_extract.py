from __future__ import annotations

import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.dont_write_bytecode = True

ROOT = Path(__file__).resolve().parents[2]
SCRIPTS = ROOT / "scripts" / "knowledge_ingestion"
sys.path.insert(0, str(SCRIPTS))

SPEC = importlib.util.spec_from_file_location("catalog_extract", SCRIPTS / "catalog_extract.py")
assert SPEC and SPEC.loader
extract = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = extract
SPEC.loader.exec_module(extract)

NOTE = """---
статус: утверждено_для_внутреннего_ИИ
язык: ru
---

# {title}

## Факты

{facts}

## Происхождение

- SHA-256: `{sha}`
"""


def write_vault(root: Path, notes: dict[str, tuple[str, list[str]]]) -> Path:
    vault = root / "Внутренняя база знаний ЭВО"
    approved = vault / "Утверждено для внутреннего ИИ"
    (approved / extract.CATALOG_FOLDER).mkdir(parents=True)
    (vault / ".evo-vault.json").write_text(
        json.dumps(
            {"kind": "evo_internal_knowledge", "canonical_path": str(vault.resolve())},
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    for name, (title, facts) in notes.items():
        target = approved / name
        target.parent.mkdir(parents=True, exist_ok=True)
        body = "\n".join(f"- {line}" for line in facts)
        # SHA из одних цифр отвергается PII-фильтром как телефонный номер,
        # поэтому фикстура использует настоящий шестнадцатеричный вид.
        target.write_text(
            NOTE.format(title=title, facts=body, sha="a3f" * 21 + "d"), encoding="utf-8"
        )
    return approved


class DurationTests(unittest.TestCase):
    def test_plain_years_become_months(self) -> None:
        value, evidence, reason = extract.extract_duration(["- Длительность программы: 4 года."])
        self.assertEqual(value, 48)
        self.assertIn("4 года", evidence)
        self.assertIsNone(reason)

    def test_plain_months_are_kept(self) -> None:
        value, _, _ = extract.extract_duration(
            ["- Certificate имеет длительность 16 месяцев и состоит из 3 семестров."]
        )
        self.assertEqual(value, 16)

    def test_lower_bound_is_refused(self) -> None:
        # Регрессия: «минимум 1 год 7 месяцев» ранее извлекалось как 12 месяцев.
        value, evidence, reason = extract.extract_duration(
            ["- Длительность: минимум 1 год 7 месяцев."]
        )
        self.assertIsNone(value)
        self.assertIsNone(evidence)
        self.assertEqual(reason, "неопределённая длительность в источнике")

    def test_two_study_modes_are_refused(self) -> None:
        # Регрессия: «3 года очно и 4 года заочно» ранее давало 36 месяцев,
        # молча отбрасывая второй режим обучения.
        for line in (
            "- Длительность: 3 года при очном обучении и 4 года при заочном обучении.",
            "- Длительность: 3 года full-time и 4 года part-time.",
            "- Заявленная длительность — 2 года full-time или 4 года part-time.",
        ):
            with self.subTest(line=line):
                value, _, reason = extract.extract_duration([line])
                self.assertIsNone(value)
                self.assertEqual(reason, "в источнике несколько разных длительностей")

    def test_range_and_open_forms_are_refused(self) -> None:
        for line, in (("- Длительность: 24+ месяца.",), ("- Длительность: от 2 лет.",),
                      ("- Длительность: 2-3 года.",), ("- Длительность: около 3 лет.",)):
            with self.subTest(line=line):
                value, _, reason = extract.extract_duration([line])
                self.assertIsNone(value)
                self.assertEqual(reason, "неопределённая длительность в источнике")

    def test_absent_duration_is_reported_as_absent(self) -> None:
        value, _, reason = extract.extract_duration(["- Программа доступна в кампусе Subang."])
        self.assertIsNone(value)
        self.assertEqual(reason, "длительность в источнике отсутствует")


class IntakeTests(unittest.TestCase):
    def test_months_are_normalised_and_sorted(self) -> None:
        months, evidence = extract.extract_intakes(
            ["- Наборы указаны в январе, марте, мае, августе и октябре."]
        )
        self.assertEqual(months, ["01", "03", "05", "08", "10"])
        self.assertIn("январе", evidence)

    def test_may_is_not_confused_with_march(self) -> None:
        months, _ = extract.extract_intakes(["- Указанные наборы: май."])
        self.assertEqual(months, ["05"])

    def test_intake_line_without_months_yields_nothing(self) -> None:
        months, evidence = extract.extract_intakes(["- Наборы уточняются у университета."])
        self.assertIsNone(months)
        self.assertIsNone(evidence)


class LanguageTests(unittest.TestCase):
    def test_entry_requirement_is_not_a_teaching_language(self) -> None:
        # Регрессия: строка о требованиях к прошлому диплому ранее давала `en`.
        code, evidence = extract.extract_language(
            ["- Требования к английскому: первая степень на английском языке, IELTS 6."]
        )
        self.assertIsNone(code)
        self.assertIsNone(evidence)

    def test_explicit_teaching_language_is_accepted(self) -> None:
        code, evidence = extract.extract_language(["- Язык обучения: английский."])
        self.assertEqual(code, "en")
        self.assertIn("Язык обучения", evidence)


class CandidateTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name).resolve()
        self.addCleanup(self.temporary.cleanup)

    def test_only_programmes_become_candidates(self) -> None:
        approved = write_vault(
            self.root,
            {
                f"{extract.CATALOG_FOLDER}/a.md": ("INTI Diploma in Business", ["Длительность программы: 2 года."]),
                f"{extract.CATALOG_FOLDER}/b.md": ("Кампус Sunway University", ["Кампус расположен в Bandar Sunway."]),
            },
        )
        result = extract.build_candidates(approved)
        self.assertEqual(result["summary"]["candidates_total"], 1)
        self.assertEqual(result["summary"]["skipped_by_category"], {"профиль_заведения": 1})

    def test_level_always_requires_human_confirmation(self) -> None:
        approved = write_vault(
            self.root,
            {f"{extract.CATALOG_FOLDER}/a.md": ("INTI Diploma in Business", ["Длительность программы: 2 года."])},
        )
        candidate = extract.build_candidates(approved)["candidates"][0]
        self.assertEqual(candidate["programme_level_proposed"], "diploma")
        self.assertIn("programme_level_confirmation", candidate["requires_manual"])

    def test_absent_fields_are_listed_for_manual_entry(self) -> None:
        approved = write_vault(
            self.root,
            {f"{extract.CATALOG_FOLDER}/a.md": ("INTI Diploma in Business", ["Программа доступна в Subang."])},
        )
        candidate = extract.build_candidates(approved)["candidates"][0]
        self.assertIsNone(candidate["duration_months"])
        self.assertIsNone(candidate["intake_months"])
        self.assertIsNone(candidate["study_language"])
        for field in ("duration_months", "intake_months", "study_language"):
            self.assertIn(field, candidate["requires_manual"])

    def test_every_filled_field_carries_its_source_line(self) -> None:
        approved = write_vault(
            self.root,
            {
                f"{extract.CATALOG_FOLDER}/a.md": (
                    "INTI Diploma in Business",
                    ["Длительность программы: 2 года.", "Наборы указаны на январь и август."],
                )
            },
        )
        candidate = extract.build_candidates(approved)["candidates"][0]
        self.assertEqual(candidate["duration_months"], 24)
        self.assertIsNotNone(candidate["duration_evidence"])
        self.assertEqual(candidate["intake_months"], ["01", "08"])
        self.assertIsNotNone(candidate["intake_evidence"])

    def test_output_is_deterministic(self) -> None:
        notes = {
            f"{extract.CATALOG_FOLDER}/б.md": ("APU Foundation Programme", ["Длительность программы: 1 год."]),
            f"{extract.CATALOG_FOLDER}/а.md": ("INTI Diploma in Business", ["Длительность программы: 2 года."]),
        }
        left = extract.build_candidates(write_vault(self.root / "one", notes))
        right = extract.build_candidates(write_vault(self.root / "two", notes))
        self.assertEqual(extract.canonical(left), extract.canonical(right))


if __name__ == "__main__":
    unittest.main()
