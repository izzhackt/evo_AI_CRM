import hashlib
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from scripts.knowledge_ingestion import client_publish


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


class ClientPublishTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name).resolve()
        self.approved = root / "Внутренняя база знаний ЭВО" / "Утверждено для внутреннего ИИ"
        self.client = root / "Клиентская база знаний ЭВО"
        self.approved.mkdir(parents=True)
        self.client.mkdir()
        internal_root = self.approved.parent
        (internal_root / ".evo-vault.json").write_text(json.dumps({
            "kind": "evo_internal_knowledge", "canonical_path": str(internal_root.resolve())
        }), encoding="utf-8")
        (self.client / ".evo-vault.json").write_text(json.dumps({
            "kind": "evo_client_knowledge", "canonical_path": str(self.client.resolve())
        }), encoding="utf-8")
        self.source = self.approved / "Услуги" / "Результат.md"
        self.source.parent.mkdir()
        self.source.write_text("---\nстатус: утверждено_для_внутреннего_ИИ\nязык: ru\n---\n\n# Результат\n\nМы постараемся сделать всё возможное.\n", encoding="utf-8")
        self.reference = self.approved / "Панель решений" / "Решение владельца.md"
        self.reference.parent.mkdir()
        self.reference.write_text("---\nтип: решение_владельца\nстатус: решено\n---\n# Решение владельца", encoding="utf-8")
        self.allowlist = self.client / ".Публикация клиентской базы.json"
        self.write_allowlist()

    def tearDown(self) -> None:
        self.temp.cleanup()

    def write_allowlist(self, **changes: object) -> None:
        entry = {
            "source_relative_path": "Услуги/Результат.md",
            "source_sha256": sha(self.source),
            "destination_relative_path": "FAQ/Результат.md",
            "content_class": "stable_evo_policy",
            "personal_data_reviewed": True,
            "authority": "owner_decision",
            "authority_reference": "Панель решений/Решение владельца.md",
            "official_url": None,
            "verified_at": None,
        }
        entry.update(changes)
        self.allowlist.write_text(json.dumps({"version": 1, "entries": [entry]}, ensure_ascii=False), encoding="utf-8")

    def publish(self) -> int:
        return client_publish.main(["--approved-vault", str(self.approved), "--client-vault", str(self.client), "--allowlist", str(self.allowlist)])

    def test_publishes_allowlisted_note_and_preserves_unmanaged_content(self) -> None:
        unmanaged = self.client / "Моя заметка.md"
        unmanaged.write_text("Не удалять", encoding="utf-8")
        self.assertEqual(self.publish(), 0)
        output = self.client / "FAQ" / "Результат.md"
        self.assertTrue(output.is_file())
        text = output.read_text(encoding="utf-8")
        self.assertIn("управляется: evo_client_publisher", text)
        self.assertIn(sha(self.source), text)
        self.assertTrue(unmanaged.is_file())

    def test_direct_cli_entrypoint_is_runnable(self) -> None:
        script = Path(__file__).parents[2] / "scripts" / "knowledge_ingestion" / "client_publish.py"
        result = subprocess.run([sys.executable, str(script), "--help"], capture_output=True, text=True, check=False)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_invalid_marker_fails_before_mutation(self) -> None:
        before = set(self.client.rglob("*"))
        (self.client / ".evo-vault.json").write_text(json.dumps({"kind": "evo_client_knowledge", "canonical_path": "/tmp/wrong"}), encoding="utf-8")
        with self.assertRaises(ValueError):
            self.publish()
        self.assertEqual(before, set(self.client.rglob("*")))

    def test_marker_and_allowlist_closed_schemas_are_enforced(self) -> None:
        marker = self.client / ".evo-vault.json"
        marker.write_text(json.dumps({"kind": "evo_client_knowledge", "canonical_path": str(self.client.resolve()), "extra": True}), encoding="utf-8")
        with self.assertRaises(ValueError):
            self.publish()
        marker.unlink()
        marker.symlink_to(self.allowlist)
        with self.assertRaises(ValueError):
            self.publish()
        marker.unlink()
        marker.write_text(json.dumps({"kind": "evo_client_knowledge", "canonical_path": str(self.client.resolve())}), encoding="utf-8")
        data = json.loads(self.allowlist.read_text(encoding="utf-8"))
        data["entries"][0]["extra"] = True
        self.allowlist.write_text(json.dumps(data), encoding="utf-8")
        with self.assertRaises(ValueError):
            self.publish()

    def test_invalid_official_provenance_is_rejected(self) -> None:
        self.write_allowlist(content_class="mutable_official_fact", authority="official_source", authority_reference="Проверка.md", official_url="http://example.com", verified_at="15-08-2026")
        with self.assertRaises(ValueError):
            self.publish()

    def test_arbitrary_source_root_is_rejected_before_mutation(self) -> None:
        fake = Path(self.temp.name) / "Сырой архив ЭВО"
        fake.mkdir()
        with self.assertRaises(ValueError):
            client_publish.main(["--approved-vault", str(fake), "--client-vault", str(self.client), "--allowlist", str(self.allowlist)])
        self.assertFalse((self.client / "FAQ").exists())

    def test_authority_reference_must_be_safe_existing_note(self) -> None:
        self.write_allowlist(authority_reference="Панель решений/Нет.md")
        with self.assertRaises(ValueError):
            self.publish()
        self.write_allowlist(authority_reference="../Сырой архив ЭВО/Решение.md")
        with self.assertRaises(ValueError):
            self.publish()
        self.reference.unlink()
        self.reference.symlink_to(self.source)
        self.write_allowlist()
        with self.assertRaises(ValueError):
            self.publish()

    def test_content_class_is_structurally_bound_to_authority(self) -> None:
        self.write_allowlist(content_class="mutable_official_fact")
        with self.assertRaises(ValueError):
            self.publish()
        self.write_allowlist(personal_data_reviewed=False)
        with self.assertRaises(ValueError):
            self.publish()

    def test_email_and_phone_are_always_rejected(self) -> None:
        for pii in ("test@example.com", "+996 555 123 456"):
            self.source.write_text(f"---\nстатус: утверждено_для_внутреннего_ИИ\nязык: ru\n---\n# Контакт\n{pii}", encoding="utf-8")
            self.write_allowlist()
            with self.assertRaises(ValueError):
                self.publish()

    def test_russian_destination_and_real_iso_date_are_required(self) -> None:
        self.reference.write_text("---\nтип: протокол_проверки\nдата_проверки: 2026-08-15\n---\nОфициальная проверка", encoding="utf-8")
        self.write_allowlist(destination_relative_path="FAQ/result.md")
        with self.assertRaises(ValueError):
            self.publish()
        self.write_allowlist(content_class="mutable_official_fact", authority="official_source", authority_reference="Панель решений/Решение владельца.md", official_url="https://example.com", verified_at="2026-99-99")
        with self.assertRaises(ValueError):
            self.publish()

    def test_symlinked_roots_are_rejected_before_mutation(self) -> None:
        approved_link = Path(self.temp.name) / "approved-link"
        approved_link.symlink_to(self.approved, target_is_directory=True)
        with self.assertRaises(ValueError):
            client_publish.main(["--approved-vault", str(approved_link), "--client-vault", str(self.client), "--allowlist", str(self.allowlist)])
        client_link = Path(self.temp.name) / "client-link"
        client_link.symlink_to(self.client, target_is_directory=True)
        with self.assertRaises(ValueError):
            client_publish.main(["--approved-vault", str(self.approved), "--client-vault", str(client_link), "--allowlist", str(self.allowlist)])
        parent_link = Path(self.temp.name).resolve() / "Внутренняя база по ссылке"
        parent_link.symlink_to(self.approved.parent, target_is_directory=True)
        with self.assertRaises(ValueError):
            client_publish.main(["--approved-vault", str(parent_link / "Утверждено для внутреннего ИИ"), "--client-vault", str(self.client), "--allowlist", str(self.allowlist)])
        self.assertFalse((self.client / "FAQ").exists())

    def test_relative_source_reference_and_destination_symlinks_are_rejected(self) -> None:
        real_sources = self.approved / "Реальные источники"
        real_sources.mkdir()
        linked_source = real_sources / "Результат.md"
        linked_source.write_text(self.source.read_text(encoding="utf-8"), encoding="utf-8")
        (self.approved / "Ссылка на источники").symlink_to(real_sources, target_is_directory=True)
        self.write_allowlist(source_relative_path="Ссылка на источники/Результат.md", source_sha256=sha(linked_source))
        with self.assertRaises(ValueError):
            self.publish()

        real_refs = self.approved / "Реальные решения"
        real_refs.mkdir()
        linked_ref = real_refs / "Решение.md"
        linked_ref.write_text(self.reference.read_text(encoding="utf-8"), encoding="utf-8")
        (self.approved / "Ссылка на решения").symlink_to(real_refs, target_is_directory=True)
        self.write_allowlist(authority_reference="Ссылка на решения/Решение.md")
        with self.assertRaises(ValueError):
            self.publish()

        real_destination = self.client / "Реальный раздел"
        real_destination.mkdir()
        (self.client / "Ссылка на раздел").symlink_to(real_destination, target_is_directory=True)
        self.write_allowlist(destination_relative_path="Ссылка на раздел/Результат.md")
        with self.assertRaises(ValueError):
            self.publish()
        self.assertFalse((real_destination / "Результат.md").exists())

    def test_invalid_utf8_stale_file_fails_before_current_output_changes(self) -> None:
        current = self.client / "FAQ" / "Результат.md"
        current.parent.mkdir()
        current.write_text("---\nуправляется: evo_client_publisher\n---\nстарое", encoding="utf-8")
        stale = self.client / "FAQ" / "Старое.md"
        stale.write_bytes(b"\xff\xfe")
        manifest = {"version": 1, "files": [
            {"path": "FAQ/Результат.md", "source_sha256": "a" * 64, "output_sha256": "b" * 64},
            {"path": "FAQ/Старое.md", "source_sha256": "c" * 64, "output_sha256": "d" * 64},
        ]}
        (self.client / ".Манифест клиентской публикации.json").write_text(json.dumps(manifest), encoding="utf-8")
        with self.assertRaises(UnicodeDecodeError):
            self.publish()
        self.assertIn("старое", current.read_text(encoding="utf-8"))

    def test_unmanaged_destination_blocks_all_writes(self) -> None:
        blocked = self.client / "FAQ" / "Результат.md"
        blocked.parent.mkdir()
        blocked.write_text("ручной файл", encoding="utf-8")
        with self.assertRaises(ValueError):
            self.publish()
        self.assertEqual(blocked.read_text(encoding="utf-8"), "ручной файл")
        self.assertFalse((self.client / ".Манифест клиентской публикации.json").exists())

    def test_wrong_source_hash_and_traversal_fail_before_mutation(self) -> None:
        self.write_allowlist(source_sha256="0" * 64)
        with self.assertRaises(ValueError):
            self.publish()
        self.assertFalse((self.client / "FAQ").exists())
        self.write_allowlist(destination_relative_path="../Сырой архив ЭВО/утечка.md")
        with self.assertRaises(ValueError):
            self.publish()
        self.assertFalse((self.client.parent / "Сырой архив ЭВО" / "утечка.md").exists())

    def test_sensitive_or_unresolved_source_is_rejected(self) -> None:
        self.source.write_text("---\nстатус: требует_решения\n---\nПароль клиента: secret", encoding="utf-8")
        self.write_allowlist()
        with self.assertRaises(ValueError):
            self.publish()
        self.assertFalse((self.client / "FAQ").exists())

    def test_stale_cleanup_only_removes_still_managed_file(self) -> None:
        self.assertEqual(self.publish(), 0)
        managed = self.client / "FAQ" / "Результат.md"
        self.allowlist.write_text(json.dumps({"version": 1, "entries": []}), encoding="utf-8")
        self.assertEqual(self.publish(), 0)
        self.assertFalse(managed.exists())
        unmanaged = self.client / "FAQ" / "Ручная.md"
        unmanaged.write_text("ручная", encoding="utf-8")
        self.assertEqual(self.publish(), 0)
        self.assertTrue(unmanaged.exists())


if __name__ == "__main__":
    unittest.main()
