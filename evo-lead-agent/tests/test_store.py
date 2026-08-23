from pathlib import Path
import json
import sqlite3

from evo_lead_agent.schemas import InboundMessage
from evo_lead_agent.store import Store


def test_store_deduplicates_provider_message_id(tmp_path: Path) -> None:
    store = Store(tmp_path / "agent.db")
    message = InboundMessage(
        session="evo-inbox",
        provider_message_id="msg-1",
        phone="+996700111222",
        chat_id="996700111222@c.us",
        text="Hello",
    )
    assert store.record_inbound(message, amo_lead_id=10, amo_contact_id=20)
    assert not store.record_inbound(message, amo_lead_id=10, amo_contact_id=20)
    history = store.history("+996700111222")
    assert len(history) == 1
    assert history[0]["text"] == "Hello"
    assert store.has_provider_message("msg-1")


def test_store_records_crm_sync_attempt_status(tmp_path: Path) -> None:
    store = Store(tmp_path / "agent.db")
    store.record_crm_sync_failure("sync-1", '{"ok":false}', "timeout")
    store.record_crm_sync_success("sync-1", '{"ok":true}')
    with sqlite3.connect(store.path) as conn:
        conn.row_factory = sqlite3.Row
        row = conn.execute(
            "SELECT attempt_count, last_error, delivered_at FROM crm_sync_attempts WHERE idempotency_key = ?",
            ("sync-1",),
        ).fetchone()
    assert row is not None
    assert row["attempt_count"] == 2
    assert row["last_error"] is None
    assert row["delivered_at"] is not None


def test_store_imports_and_searches_knowledge_entries(tmp_path: Path) -> None:
    store = Store(tmp_path / "agent.db")
    imported = store.upsert_knowledge_entries(
        [
            {
                "source": "amo_export",
                "external_id": "lead-1-msg-1",
                "question": "Сколько стоит поступление в Европу?",
                "answer": "Стоимость зависит от страны, программы и пакета сопровождения. Менеджер уточнит детали.",
                "language": "ru",
                "tags": ["price", "europe"],
            },
            {
                "source": "amo_export",
                "external_id": "lead-2-msg-1",
                "question": "Do you help with visa documents?",
                "answer": "We can guide document preparation, but visa decisions are made by the consulate.",
                "language": "en",
                "tags": ["visa"],
            },
        ]
    )

    assert imported == 2
    matches = store.search_knowledge("Какая цена учебы в Европе?", limit=3)
    assert len(matches) == 1
    assert matches[0]["external_id"] == "lead-1-msg-1"
    assert matches[0]["score"] > 0


def test_store_imports_committed_starter_knowledge_pack(tmp_path: Path) -> None:
    store = Store(tmp_path / "agent.db")
    repo_root = Path(__file__).resolve().parents[1]
    entries = json.loads(
        (repo_root / "examples" / "evo-admissions-starter-knowledge.json").read_text(encoding="utf-8")
    )["entries"]

    assert store.upsert_knowledge_entries(entries) == 12
    ru_matches = store.search_knowledge("Можно ли поступить без IELTS?", limit=3)
    en_matches = store.search_knowledge("What documents do I need?", limit=3)

    assert ru_matches[0]["external_id"] == "starter-english-ru"
    assert en_matches[0]["external_id"] == "starter-documents-en"


def test_store_deduplicates_knowledge_by_source_and_external_id(tmp_path: Path) -> None:
    store = Store(tmp_path / "agent.db")
    first = {
        "source": "amo_export",
        "external_id": "same-message",
        "question": "Какие документы нужны?",
        "answer": "Паспорт, аттестат и выписка оценок.",
        "language": "ru",
    }
    second = {
        **first,
        "answer": "Обычно нужны паспорт, аттестат, транскрипт и языковой сертификат, если есть.",
    }

    assert store.upsert_knowledge_entries([first]) == 1
    assert store.upsert_knowledge_entries([second]) == 1
    matches = store.search_knowledge("документы паспорт аттестат", limit=1)

    assert len(matches) == 1
    assert matches[0]["answer"] == second["answer"]


def test_store_prefers_newer_knowledge_when_scores_tie(tmp_path: Path) -> None:
    store = Store(tmp_path / "agent.db")
    store.upsert_knowledge_entries(
        [
            {
                "source": "manual",
                "external_id": "old-price",
                "question": "Сколько стоит поступление?",
                "answer": "Старый ответ: стоимость уточняйте.",
                "language": "ru",
            },
            {
                "source": "manual",
                "external_id": "new-price",
                "question": "Сколько стоит поступление?",
                "answer": "Новый утвержденный ответ: стоимость зависит от страны и программы.",
                "language": "ru",
            },
        ]
    )

    matches = store.search_knowledge("Сколько стоит поступление?", limit=2)

    assert [match["external_id"] for match in matches] == ["new-price", "old-price"]


def test_store_buffers_multiple_messages_for_one_scheduled_processor(tmp_path: Path) -> None:
    store = Store(tmp_path / "agent.db")
    first = InboundMessage(
        session="evo-inbox",
        provider_message_id="msg-1",
        phone="+996700111222",
        chat_id="996700111222@c.us",
        text="First question",
    )
    second = InboundMessage(
        session="evo-inbox",
        provider_message_id="msg-2",
        phone="+996700111222",
        chat_id="996700111222@c.us",
        text="Second question",
    )

    assert store.enqueue_message_buffer(first, delay_seconds=0)
    assert not store.enqueue_message_buffer(second, delay_seconds=0)
    drained = store.drain_next_due_buffer(phone="+996700111222")

    assert [message.provider_message_id for message in drained] == ["msg-1", "msg-2"]
    assert store.drain_next_due_buffer(phone="+996700111222") == []


def test_store_peek_next_due_buffer_does_not_claim_messages(tmp_path: Path) -> None:
    store = Store(tmp_path / "agent.db")
    first = InboundMessage(
        session="evo-inbox",
        provider_message_id="msg-1",
        phone="+996700111222",
        chat_id="996700111222@c.us",
        text="First question",
    )
    second = InboundMessage(
        session="evo-inbox",
        provider_message_id="msg-2",
        phone="+996700111222",
        chat_id="996700111222@c.us",
        text="Second question",
    )

    assert store.enqueue_message_buffer(first, delay_seconds=0)
    assert not store.enqueue_message_buffer(second, delay_seconds=0)

    peeked = store.peek_next_due_buffer(phone="+996700111222")
    peeked_again = store.peek_next_due_buffer(phone="+996700111222")

    assert [message.provider_message_id for message in peeked] == ["msg-1", "msg-2"]
    assert [message.provider_message_id for message in peeked_again] == ["msg-1", "msg-2"]
    with sqlite3.connect(store.path) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            """
            SELECT provider_message_id, processor_scheduled
            FROM message_buffers
            ORDER BY id ASC
            """
        ).fetchall()
    assert [(row["provider_message_id"], row["processor_scheduled"]) for row in rows] == [
        ("msg-1", 1),
        ("msg-2", 0),
    ]

    claimed = store.claim_next_due_buffer(phone="+996700111222")

    assert [message.provider_message_id for message in claimed] == ["msg-1", "msg-2"]
    with sqlite3.connect(store.path) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            """
            SELECT provider_message_id, processor_scheduled
            FROM message_buffers
            ORDER BY id ASC
            """
        ).fetchall()
    assert [(row["provider_message_id"], row["processor_scheduled"]) for row in rows] == [
        ("msg-1", 2),
        ("msg-2", 2),
    ]
    assert store.claim_next_due_buffer(phone="+996700111222") == []


def test_store_drain_schedules_remaining_messages_after_limited_batch(tmp_path: Path) -> None:
    store = Store(tmp_path / "agent.db")
    messages = [
        InboundMessage(
            session="evo-inbox",
            provider_message_id=f"msg-{index:02d}",
            phone="+996700111222",
            chat_id="996700111222@c.us",
            text=f"Question {index}",
        )
        for index in range(55)
    ]

    assert store.enqueue_message_buffer(messages[0], delay_seconds=0)
    for message in messages[1:]:
        assert not store.enqueue_message_buffer(message, delay_seconds=0)

    first_batch = store.drain_next_due_buffer(phone="+996700111222", limit=50)

    assert [message.provider_message_id for message in first_batch] == [
        f"msg-{index:02d}" for index in range(50)
    ]
    with sqlite3.connect(store.path) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            """
            SELECT provider_message_id, processor_scheduled, processed_at
            FROM message_buffers
            WHERE provider_message_id >= 'msg-50'
            ORDER BY id ASC
            """
        ).fetchall()
    assert [(row["provider_message_id"], row["processor_scheduled"]) for row in rows] == [
        ("msg-50", 1),
        ("msg-51", 0),
        ("msg-52", 0),
        ("msg-53", 0),
        ("msg-54", 0),
    ]
    assert all(row["processed_at"] is None for row in rows)

    second_batch = store.drain_next_due_buffer(phone="+996700111222", limit=50)

    assert [message.provider_message_id for message in second_batch] == [
        f"msg-{index:02d}" for index in range(50, 55)
    ]
    assert store.drain_next_due_buffer(phone="+996700111222", limit=50) == []


def test_store_conversation_control_defaults_to_agent_mode(tmp_path: Path) -> None:
    store = Store(tmp_path / "agent.db")

    assert store.get_conversation_control("+996700111222")["agent_mode"] is True

    store.set_agent_mode("+996700111222", enabled=False, handoff_reason="operator_takeover")
    control = store.get_conversation_control("+996700111222")

    assert control["agent_mode"] is False
    assert control["handoff_reason"] == "operator_takeover"


def test_store_persists_sanitized_lead_facts_per_conversation(tmp_path: Path) -> None:
    store = Store(tmp_path / "agent.db")

    saved = store.upsert_lead_facts(
        "+996700111222",
        123,
        {
            "Target-Country": "Canada",
            "age": 17,
            "empty": "",
            "nested": {"unsafe": True},
            "Секрет": "ignored",
            "passport_number": "AB123456",
            "notes": "free-form model text",
            "preferred_language": "call me at +996 700 111 222",
        },
    )
    store.upsert_lead_facts("+996700111222", 123, {"target_country": "USA"})
    store.upsert_lead_facts("+996700111222", 999, {"target_country": "Canada"})

    assert saved == {"target_country": "Canada", "age": "17"}
    assert store.lead_facts("+996700111222", 123) == {"age": "17", "target_country": "USA"}
    assert store.lead_facts("+996700111222", 999) == {"target_country": "Canada"}
    assert store.lead_facts("+996700999000", 123) == {}
