import json
import os
from pathlib import Path
import tempfile
import unittest

from scripts.knowledge_ingestion.build_platform_bundle import build_bundle


ACCOUNT = "00000000-0000-0000-0000-000000000001"


class PlatformBundleTests(unittest.TestCase):
    def make_client(self, root: Path) -> Path:
        vault = root / "Клиентская база знаний ЭВО"
        vault.mkdir()
        (vault / ".evo-vault.json").write_text(
            json.dumps(
                {"kind": "evo_client_knowledge", "canonical_path": str(vault.resolve())},
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )
        (vault / "Страны").mkdir()
        (vault / "Страны" / "Китай.md").write_text("Документы для поступления.", encoding="utf-8")
        (vault / ".obsidian").mkdir()
        (vault / ".obsidian" / "ignored.md").write_text("ignored", encoding="utf-8")
        return vault

    def test_same_input_is_byte_identical_and_hidden_controls_are_excluded(self):
        with tempfile.TemporaryDirectory(dir="/private/tmp") as temporary:
            root = Path(temporary)
            vault = self.make_client(root)
            first = root / "first"
            second = root / "second"
            first.mkdir()
            second.mkdir()
            build_bundle(vault, ACCOUNT, "client", first)
            build_bundle(vault, ACCOUNT, "client", second)
            self.assertEqual(
                (first / "evo-knowledge-client.json").read_bytes(),
                (second / "evo-knowledge-client.json").read_bytes(),
            )
            bundle = json.loads((first / "evo-knowledge-client.json").read_text())
            self.assertEqual([item["source_path"] for item in bundle["documents"]], ["Страны/Китай.md"])
            self.assertNotIn("generated_at", bundle)
            self.assertEqual(oct((first / "evo-knowledge-client.json").stat().st_mode & 0o777), "0o600")

    def test_internal_reads_only_exact_approved_child(self):
        with tempfile.TemporaryDirectory(dir="/private/tmp") as temporary:
            root = Path(temporary) / "Внутренняя база знаний ЭВО"
            root.mkdir()
            (root / ".evo-vault.json").write_text(
                json.dumps(
                    {"kind": "evo_internal_knowledge", "canonical_path": str(root.resolve())},
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )
            approved = root / "Утверждено для внутреннего ИИ"
            approved.mkdir()
            (approved / "Процесс.md").write_text("Передать вопрос сотруднику.", encoding="utf-8")
            (root / "Черновик.md").write_text("Не публиковать.", encoding="utf-8")
            output = Path(temporary) / "out"
            output.mkdir()
            build_bundle(approved, ACCOUNT, "internal", output)
            bundle = json.loads((output / "evo-knowledge-internal.json").read_text())
            self.assertEqual([item["source_path"] for item in bundle["documents"]], ["Процесс.md"])

    def test_rejects_pii_invalid_utf8_and_symlink_components(self):
        cases = [
            ("email.md", b"Contact Test@Example.com"),
            ("phone.md", "+996 (555) 123-456".encode()),
            ("digits.md", b"1234567890123456"),
            ("broken.md", b"\xff\xfe"),
        ]
        for name, content in cases:
            with self.subTest(name=name), tempfile.TemporaryDirectory(dir="/private/tmp") as temporary:
                root = Path(temporary)
                vault = self.make_client(root)
                (vault / name).write_bytes(content)
                output = root / "out"
                output.mkdir()
                with self.assertRaises(ValueError):
                    build_bundle(vault, ACCOUNT, "client", output)
                self.assertEqual(list(output.iterdir()), [])

        with tempfile.TemporaryDirectory(dir="/private/tmp") as temporary:
            root = Path(temporary)
            vault = self.make_client(root)
            (vault / "+996555123456.md").write_text("Безопасный текст", encoding="utf-8")
            output = root / "out"
            output.mkdir()
            with self.assertRaises(ValueError):
                build_bundle(vault, ACCOUNT, "client", output)
            self.assertEqual(list(output.iterdir()), [])
        if hasattr(os, "symlink"):
            with tempfile.TemporaryDirectory(dir="/private/tmp") as temporary:
                root = Path(temporary)
                vault = self.make_client(root)
                target = root / "target"
                target.mkdir()
                (target / "note.md").write_text("safe text", encoding="utf-8")
                os.symlink(target, vault / "alias")
                output = root / "out"
                output.mkdir()
                with self.assertRaises(ValueError):
                    build_bundle(vault, ACCOUNT, "client", output)
                self.assertEqual(list(output.iterdir()), [])

    def test_rejects_symlinked_cli_ancestor_and_visible_non_markdown(self):
        with tempfile.TemporaryDirectory(dir="/private/tmp") as temporary:
            root = Path(temporary)
            real = root / "real"
            real.mkdir()
            vault = self.make_client(real)
            alias = root / "alias"
            os.symlink(real, alias)
            output = root / "out-symlink"
            output.mkdir()
            with self.assertRaises(ValueError):
                build_bundle(alias / vault.name, ACCOUNT, "client", output)
            self.assertEqual(list(output.iterdir()), [])

        with tempfile.TemporaryDirectory(dir="/private/tmp") as temporary:
            root = Path(temporary)
            vault = self.make_client(root)
            (vault / "видимый.pdf").write_bytes(b"not markdown")
            output = root / "out-visible"
            output.mkdir()
            with self.assertRaises(ValueError):
                build_bundle(vault, ACCOUNT, "client", output)
            self.assertEqual(list(output.iterdir()), [])

    def test_unreadable_subtree_fails_instead_of_building_partial_bundle(self):
        with tempfile.TemporaryDirectory(dir="/private/tmp") as temporary:
            root = Path(temporary)
            vault = self.make_client(root)
            blocked = vault / "Недоступно"
            blocked.mkdir()
            (blocked / "Скрытая потеря.md").write_text("Не пропускать.", encoding="utf-8")
            output = root / "out"
            output.mkdir()
            blocked.chmod(0)
            try:
                with self.assertRaises(OSError):
                    build_bundle(vault, ACCOUNT, "client", output)
                self.assertEqual(list(output.iterdir()), [])
            finally:
                blocked.chmod(0o700)


if __name__ == "__main__":
    unittest.main()
