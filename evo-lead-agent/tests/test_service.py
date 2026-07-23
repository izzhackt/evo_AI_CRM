import asyncio
from dataclasses import replace
from pathlib import Path

import pytest

from evo_lead_agent import service as service_module
from evo_lead_agent.config import Settings
from evo_lead_agent.schemas import AgentDecision, AmoLeadRef, InboundMessage
from evo_lead_agent.service import LeadAgentService
from evo_lead_agent.store import Store


def _settings(tmp_path: Path) -> Settings:
    return Settings(
        app_env="test",
        database_path=tmp_path / "agent.db",
        waha_base_url=None,
        waha_api_key=None,
        waha_session_name="crm_primary",
        waha_webhook_secret="secret",
        amo_account_base_url=None,
        amo_client_id=None,
        amo_client_secret=None,
        amo_redirect_uri=None,
        amo_refresh_token=None,
        amo_token_file=tmp_path / "amo-token.json",
        amo_pipeline_id=None,
        amo_status_id=None,
        amo_responsible_user_id=None,
        crm_base_url=None,
        crm_sync_path="/api/internal/lead-agent/whatsapp",
        crm_sync_secret=None,
        crm_sync_timeout_seconds=10,
        admin_api_key="admin-secret",
        gemini_api_key=None,
        gemini_model="gemini-3.5-flash",
        autoreply_enabled=False,
        outbound_enabled=False,
        max_reply_chars=900,
        reply_delay_seconds=0,
        worker_enabled=False,
        worker_poll_interval_seconds=0.25,
    )


@pytest.mark.asyncio
async def test_frozen_service_rejects_processing_before_any_provider_call(
    tmp_path: Path,
    monkeypatch,
) -> None:
    class ForbiddenProvider:
        def __init__(self, *args, **kwargs) -> None:
            raise AssertionError("frozen service must not construct a provider client")

    monkeypatch.setattr(service_module, "WahaClient", ForbiddenProvider)
    settings = replace(
        _settings(tmp_path),
        frozen=True,
        worker_enabled=True,
        autoreply_enabled=True,
        outbound_enabled=True,
    )
    service = LeadAgentService(settings=settings, store=Store(tmp_path / "agent.db"))

    result = await service.handle_waha_payload({"event": "message"})

    assert result == {"accepted": False, "ignored": True, "reason": "lead_agent_frozen"}


@pytest.mark.asyncio
async def test_service_reports_missing_amo_for_realistic_waha_payload(tmp_path: Path) -> None:
    settings = _settings(tmp_path)
    service = LeadAgentService(settings=settings, store=Store(settings.database_path))
    result = await service.handle_waha_payload(
        {
            "event": "message",
            "session": "crm_primary",
            "payload": {
                "id": "waha-msg-1",
                "from": "996700111222@c.us",
                "fromMe": False,
                "body": "Здравствуйте, хочу поступить за границу",
                "timestamp": 1720000000,
                "_data": {"pushName": "Client"},
            },
        }
    )
    assert result["accepted"] is True
    assert result["processed"]["processed_count"] == 1
    assert len(result["processed"]["results"]) == 1
    assert result["processed"]["results"][0]["reason"] == "amo_not_configured"
    assert result["processed"]["results"][0]["retryable"] is True


@pytest.mark.asyncio
async def test_service_retryable_buffer_retries_without_fresh_inbound(tmp_path: Path) -> None:
    settings = _settings(tmp_path)
    service = LeadAgentService(settings=settings, store=Store(settings.database_path))

    first = await service.handle_waha_payload(
        {
            "event": "message",
            "session": "crm_primary",
            "payload": {
                "id": "waha-msg-retry-1",
                "from": "996700111222@c.us",
                "fromMe": False,
                "body": "Первое сообщение",
                "timestamp": 1720000000,
            },
        }
    )

    retry = await service.process_due_buffers(phone="+996700111222")

    assert first["processed"]["processed_count"] == 1
    assert retry["processed_count"] == 1
    assert retry["results"][0]["reason"] == "amo_not_configured"
    assert retry["results"][0]["retryable"] is True


@pytest.mark.asyncio
async def test_service_later_inbound_joins_retryable_buffer(tmp_path: Path) -> None:
    settings = _settings(tmp_path)
    service = LeadAgentService(settings=settings, store=Store(settings.database_path))

    await service.handle_waha_payload(
        {
            "event": "message",
            "session": "crm_primary",
            "payload": {
                "id": "waha-msg-retry-1",
                "from": "996700111222@c.us",
                "fromMe": False,
                "body": "Первое сообщение",
                "timestamp": 1720000000,
            },
        }
    )
    second = await service.handle_waha_payload(
        {
            "event": "message",
            "session": "crm_primary",
            "payload": {
                "id": "waha-msg-retry-2",
                "from": "996700111222@c.us",
                "fromMe": False,
                "body": "Второе сообщение",
                "timestamp": 1720000001,
            },
        }
    )

    assert second["scheduled"] is False
    assert second["processed"]["processed_count"] == 1
    assert second["processed"]["results"][0]["message_count"] == 2


@pytest.mark.asyncio
async def test_service_webhook_receipt_queues_without_external_io(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = replace(
        _settings(tmp_path),
        amo_account_base_url="https://example.amocrm.ru",
        amo_client_id="client-id",
        amo_client_secret="client-secret",
        amo_redirect_uri="https://example.com/callback",
        amo_refresh_token="refresh-token",
        crm_base_url="http://crm.internal",
        crm_sync_secret="sync-secret",
        reply_delay_seconds=30,
    )

    class ExplodingAmoClient:
        def __init__(self, settings: Settings) -> None:
            raise AssertionError("webhook receipt must not instantiate AmoCrmClient")

    monkeypatch.setattr(service_module, "AmoCrmClient", ExplodingAmoClient)
    service = LeadAgentService(settings=settings, store=Store(settings.database_path))

    result = await service.handle_waha_payload(
        {
            "event": "message",
            "session": "crm_primary",
            "payload": {
                "id": "waha-msg-fast-return",
                "from": "996700111222@c.us",
                "fromMe": False,
                "body": "Хочу поступить",
                "timestamp": 1720000000,
            },
        }
    )

    assert result == {
        "accepted": True,
        "queued": True,
        "scheduled": True,
        "reply_delay_seconds": 30,
    }


@pytest.mark.asyncio
async def test_service_syncs_session_status_to_crm(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    settings = replace(_settings(tmp_path), crm_base_url="http://crm.internal", crm_sync_secret="sync-secret")
    calls: list[dict[str, str | None]] = []

    class FakeCrmSyncClient:
        def __init__(self, settings: Settings) -> None:
            self.settings = settings

        async def sync_session_status(self, session: str, status: str, phone: str | None) -> dict[str, bool]:
            calls.append({"session": session, "status": status, "phone": phone})
            return {"ok": True}

    monkeypatch.setattr(service_module, "EvoCrmSyncClient", FakeCrmSyncClient)
    service = LeadAgentService(settings=settings, store=Store(settings.database_path))

    result = await service.handle_waha_payload(
        {
            "event": "session.status",
            "session": "crm_primary",
            "payload": {"status": "WORKING"},
            "me": {"id": "996700111222@c.us"},
        }
    )

    assert result == {"accepted": True, "session_status": "WORKING", "crm_sync": "delivered"}
    assert calls == [{"session": "crm_primary", "status": "WORKING", "phone": "+996700111222"}]


@pytest.mark.asyncio
async def test_service_passes_knowledge_matches_to_decision(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    settings = replace(
        _settings(tmp_path),
        amo_account_base_url="https://example.amocrm.ru",
        amo_client_id="client-id",
        amo_client_secret="client-secret",
        amo_redirect_uri="https://example.com/callback",
        amo_refresh_token="refresh-token",
        crm_base_url="http://crm.internal",
        crm_sync_secret="sync-secret",
        autoreply_enabled=True,
    )
    store = Store(settings.database_path)
    store.upsert_knowledge_entries(
        [
            {
                "source": "manual",
                "external_id": "documents",
                "question": "Какие документы нужны?",
                "answer": "Обычно нужны паспорт, аттестат и транскрипт.",
                "language": "ru",
            }
        ]
    )
    store.upsert_lead_facts("+996700111222", 123, {"target_country": "Canada"})
    captured: dict[str, object] = {}

    class FakeAmoClient:
        def __init__(self, settings: Settings) -> None:
            self.settings = settings

        async def ensure_lead_for_phone(self, phone: str, name: str | None, source: str) -> AmoLeadRef:
            return AmoLeadRef(lead_id=123, contact_id=456, created=False)

        async def add_lead_note(self, lead_id: int, text: str) -> None:
            return None

        async def create_followup_task(self, lead_id: int, text: str, complete_till: int) -> None:
            return None

    class FakeCrmSyncClient:
        def __init__(self, settings: Settings) -> None:
            self.settings = settings

        async def sync_whatsapp(self, payload: object) -> dict[str, bool]:
            captured["crm_payload"] = payload
            return {"ok": True}

    async def fake_decide_reply(
        settings: Settings,
        message: InboundMessage,
        history: list[dict[str, object]],
        amo_lead_id: int | None,
        knowledge: list[dict[str, object]] | None = None,
        lead_facts: dict[str, str] | None = None,
    ) -> AgentDecision:
        captured["knowledge"] = knowledge
        captured["lead_facts"] = lead_facts
        return AgentDecision(
            reply_text="Обычно нужны паспорт, аттестат и транскрипт.",
            handoff_required=False,
            handoff_reason=None,
            summary="Asked about documents.",
            lead_updates={
                "current_education": "11 класс",
                "Target-Country": "USA",
                "passport_number": "AB123456",
            },
        )

    monkeypatch.setattr(service_module, "AmoCrmClient", FakeAmoClient)
    monkeypatch.setattr(service_module, "EvoCrmSyncClient", FakeCrmSyncClient)
    monkeypatch.setattr(service_module, "decide_reply", fake_decide_reply)
    service = LeadAgentService(settings=settings, store=store)

    result = await service.handle_waha_payload(
        {
            "event": "message",
            "session": "crm_primary",
            "payload": {
                "id": "waha-msg-docs",
                "from": "996700111222@c.us",
                "fromMe": False,
                "body": "Какие документы нужны для поступления?",
                "timestamp": 1720000000,
            },
        }
    )

    assert result["accepted"] is True
    assert result["processed"]["results"][0]["reply"] == "not_sent"
    assert captured["knowledge"][0]["external_id"] == "documents"  # type: ignore[index]
    assert captured["lead_facts"] == {"target_country": "Canada"}
    assert store.lead_facts("+996700111222", 123) == {
        "current_education": "11 класс",
        "target_country": "USA",
    }
    assert store.lead_facts("+996700111222", 999) == {}
    assert captured["crm_payload"].lead_updates == {  # type: ignore[attr-defined]
        "current_education": "11 класс",
        "target_country": "USA",
    }


@pytest.mark.asyncio
async def test_service_retries_no_outbound_buffer_when_crm_sync_fails(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = replace(
        _settings(tmp_path),
        amo_account_base_url="https://example.amocrm.ru",
        amo_client_id="client-id",
        amo_client_secret="client-secret",
        amo_redirect_uri="https://example.com/callback",
        amo_refresh_token="refresh-token",
        crm_base_url="http://crm.internal",
        crm_sync_secret="sync-secret",
        autoreply_enabled=True,
    )
    store = Store(settings.database_path)

    class FakeAmoClient:
        def __init__(self, settings: Settings) -> None:
            self.settings = settings

        async def ensure_lead_for_phone(self, phone: str, name: str | None, source: str) -> AmoLeadRef:
            return AmoLeadRef(lead_id=123, contact_id=456, created=False)

        async def add_lead_note(self, lead_id: int, text: str) -> None:
            return None

        async def create_followup_task(self, lead_id: int, text: str, complete_till: int) -> None:
            return None

    class FakeCrmSyncClient:
        def __init__(self, settings: Settings) -> None:
            self.settings = settings

        async def sync_whatsapp(self, payload: object) -> dict[str, bool]:
            raise RuntimeError("temporary crm outage")

    async def fake_decide_reply(
        settings: Settings,
        message: InboundMessage,
        history: list[dict[str, object]],
        amo_lead_id: int | None,
        knowledge: list[dict[str, object]] | None = None,
        lead_facts: dict[str, str] | None = None,
    ) -> AgentDecision:
        return AgentDecision(
            reply_text="Подскажем по документам.",
            handoff_required=False,
            handoff_reason=None,
            summary="Answered without outbound.",
            lead_updates={"target_country": "Canada"},
        )

    monkeypatch.setattr(service_module, "AmoCrmClient", FakeAmoClient)
    monkeypatch.setattr(service_module, "EvoCrmSyncClient", FakeCrmSyncClient)
    monkeypatch.setattr(service_module, "decide_reply", fake_decide_reply)
    service = LeadAgentService(settings=settings, store=store)

    result = await service.handle_waha_payload(
        {
            "event": "message",
            "session": "crm_primary",
            "payload": {
                "id": "waha-msg-crm-fail",
                "from": "996700111222@c.us",
                "fromMe": False,
                "body": "Хочу в Канаду",
                "timestamp": 1720000000,
            },
        }
    )

    first_result = result["processed"]["results"][0]

    assert first_result["retryable"] is True
    assert first_result["reason"] == "crm_sync_failed"
    assert store.lead_facts("+996700111222", 123) == {}


@pytest.mark.asyncio
async def test_service_does_not_commit_lead_facts_when_reply_sent_crm_sync_fails(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = replace(
        _settings(tmp_path),
        waha_base_url="http://waha.internal",
        waha_api_key="waha-key",
        amo_account_base_url="https://example.amocrm.ru",
        amo_client_id="client-id",
        amo_client_secret="client-secret",
        amo_redirect_uri="https://example.com/callback",
        amo_refresh_token="refresh-token",
        crm_base_url="http://crm.internal",
        crm_sync_secret="sync-secret",
        autoreply_enabled=True,
        outbound_enabled=True,
    )
    store = Store(settings.database_path)

    class FakeAmoClient:
        def __init__(self, settings: Settings) -> None:
            self.settings = settings

        async def ensure_lead_for_phone(self, phone: str, name: str | None, source: str) -> AmoLeadRef:
            return AmoLeadRef(lead_id=123, contact_id=456, created=False)

        async def add_lead_note(self, lead_id: int, text: str) -> None:
            return None

        async def create_followup_task(self, lead_id: int, text: str, complete_till: int) -> None:
            return None

    class FakeWahaClient:
        def __init__(self, base_url: str, api_key: str, session_name: str) -> None:
            self.base_url = base_url
            self.api_key = api_key
            self.session_name = session_name

        async def send_text(self, phone: str, text: str) -> str:
            return "outbound-msg-1"

    class FakeCrmSyncClient:
        def __init__(self, settings: Settings) -> None:
            self.settings = settings

        async def sync_whatsapp(self, payload: object) -> dict[str, bool]:
            raise RuntimeError("temporary crm outage")

    async def fake_decide_reply(
        settings: Settings,
        message: InboundMessage,
        history: list[dict[str, object]],
        amo_lead_id: int | None,
        knowledge: list[dict[str, object]] | None = None,
        lead_facts: dict[str, str] | None = None,
    ) -> AgentDecision:
        return AgentDecision(
            reply_text="Да, поможем с поступлением.",
            handoff_required=False,
            handoff_reason=None,
            summary="Answered with outbound.",
            lead_updates={"target_country": "Canada"},
        )

    monkeypatch.setattr(service_module, "AmoCrmClient", FakeAmoClient)
    monkeypatch.setattr(service_module, "EvoCrmSyncClient", FakeCrmSyncClient)
    monkeypatch.setattr(service_module, "WahaClient", FakeWahaClient)
    monkeypatch.setattr(service_module, "decide_reply", fake_decide_reply)
    service = LeadAgentService(settings=settings, store=store)

    result = await service.handle_waha_payload(
        {
            "event": "message",
            "session": "crm_primary",
            "payload": {
                "id": "waha-msg-outbound-crm-fail",
                "from": "996700111222@c.us",
                "fromMe": False,
                "body": "Хочу в Канаду",
                "timestamp": 1720000000,
            },
        }
    )

    first_result = result["processed"]["results"][0]

    assert first_result["reply"] == "sent"
    assert first_result["crm_sync"] == "failed"
    assert first_result["crm_sync_failed"] is True
    assert "retryable" not in first_result
    assert store.lead_facts("+996700111222", 123) == {}


@pytest.mark.asyncio
async def test_service_processes_buffered_messages_as_one_agent_turn(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = replace(
        _settings(tmp_path),
        amo_account_base_url="https://example.amocrm.ru",
        amo_client_id="client-id",
        amo_client_secret="client-secret",
        amo_redirect_uri="https://example.com/callback",
        amo_refresh_token="refresh-token",
        crm_base_url="http://crm.internal",
        crm_sync_secret="sync-secret",
        autoreply_enabled=True,
    )
    store = Store(settings.database_path)
    messages = [
        InboundMessage(
            session="crm_primary",
            provider_message_id="msg-1",
            phone="+996700111222",
            chat_id="996700111222@c.us",
            text="Хочу в Европу",
        ),
        InboundMessage(
            session="crm_primary",
            provider_message_id="msg-2",
            phone="+996700111222",
            chat_id="996700111222@c.us",
            text="Какие документы нужны?",
        ),
    ]
    for message in messages:
        store.record_inbound(message, amo_lead_id=123, amo_contact_id=456)
        store.enqueue_message_buffer(message, delay_seconds=0)
    captured: dict[str, object] = {}

    class FakeAmoClient:
        def __init__(self, settings: Settings) -> None:
            self.settings = settings

        async def ensure_lead_for_phone(self, phone: str, name: str | None, source: str) -> AmoLeadRef:
            return AmoLeadRef(lead_id=123, contact_id=456, created=False)

        async def add_lead_note(self, lead_id: int, text: str) -> None:
            return None

        async def create_followup_task(self, lead_id: int, text: str, complete_till: int) -> None:
            return None

    class FakeCrmSyncClient:
        def __init__(self, settings: Settings) -> None:
            self.settings = settings

        async def sync_whatsapp(self, payload: object) -> dict[str, bool]:
            return {"ok": True}

    async def fake_decide_reply(
        settings: Settings,
        message: InboundMessage,
        history: list[dict[str, object]],
        amo_lead_id: int | None,
        knowledge: list[dict[str, object]] | None = None,
        lead_facts: dict[str, str] | None = None,
    ) -> AgentDecision:
        captured["text"] = message.text
        return AgentDecision(
            reply_text="Подскажем по документам.",
            handoff_required=False,
            handoff_reason=None,
            summary="Answered batched questions.",
        )

    monkeypatch.setattr(service_module, "AmoCrmClient", FakeAmoClient)
    monkeypatch.setattr(service_module, "EvoCrmSyncClient", FakeCrmSyncClient)
    monkeypatch.setattr(service_module, "decide_reply", fake_decide_reply)

    result = await LeadAgentService(settings=settings, store=store).process_due_buffers(phone="+996700111222")

    assert result["processed_count"] == 1
    assert result["results"][0]["message_count"] == 2
    assert captured["text"] == "1. Хочу в Европу\n2. Какие документы нужны?"


@pytest.mark.asyncio
async def test_service_claims_due_buffer_once_for_concurrent_processors(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = replace(
        _settings(tmp_path),
        amo_account_base_url="https://example.amocrm.ru",
        amo_client_id="client-id",
        amo_client_secret="client-secret",
        amo_redirect_uri="https://example.com/callback",
        amo_refresh_token="refresh-token",
        crm_base_url="http://crm.internal",
        crm_sync_secret="sync-secret",
        autoreply_enabled=True,
    )
    store = Store(settings.database_path)
    message = InboundMessage(
        session="crm_primary",
        provider_message_id="msg-concurrent",
        phone="+996700111222",
        chat_id="996700111222@c.us",
        text="Concurrent test",
    )
    store.record_inbound(message, amo_lead_id=None, amo_contact_id=None)
    store.enqueue_message_buffer(message, delay_seconds=0)
    service = LeadAgentService(settings=settings, store=store)
    calls = 0

    async def fake_process_buffered_messages(messages: list[InboundMessage]) -> dict[str, object]:
        nonlocal calls
        calls += 1
        await asyncio.sleep(0.05)
        return {"message_count": len(messages), "reply": "not_sent"}

    monkeypatch.setattr(service, "_process_buffered_messages", fake_process_buffered_messages)

    first, second = await asyncio.gather(
        service.process_due_buffers(phone="+996700111222"),
        service.process_due_buffers(phone="+996700111222"),
    )

    assert calls == 1
    assert sorted([first["processed_count"], second["processed_count"]]) == [0, 1]


@pytest.mark.asyncio
async def test_service_releases_claimed_buffer_after_processing_exception(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = replace(
        _settings(tmp_path),
        amo_account_base_url="https://example.amocrm.ru",
        amo_client_id="client-id",
        amo_client_secret="client-secret",
        amo_redirect_uri="https://example.com/callback",
        amo_refresh_token="refresh-token",
        crm_base_url="http://crm.internal",
        crm_sync_secret="sync-secret",
        autoreply_enabled=True,
    )
    store = Store(settings.database_path)
    message = InboundMessage(
        session="crm_primary",
        provider_message_id="msg-exception",
        phone="+996700111222",
        chat_id="996700111222@c.us",
        text="Exception test",
    )
    store.record_inbound(message, amo_lead_id=None, amo_contact_id=None)
    store.enqueue_message_buffer(message, delay_seconds=0)
    service = LeadAgentService(settings=settings, store=store)

    async def failing_process_buffered_messages(messages: list[InboundMessage]) -> dict[str, object]:
        raise RuntimeError("forced failure")

    monkeypatch.setattr(service, "_process_buffered_messages", failing_process_buffered_messages)

    result = await service.process_due_buffers(phone="+996700111222")
    retryable_messages = store.claim_next_due_buffer(phone="+996700111222")

    assert result["processed_count"] == 1
    assert result["results"][0]["reason"] == "processing_exception"
    assert result["results"][0]["retryable"] is True
    assert [message.provider_message_id for message in retryable_messages] == ["msg-exception"]


@pytest.mark.asyncio
async def test_service_agent_mode_disabled_skips_ai_and_syncs_state(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = replace(
        _settings(tmp_path),
        amo_account_base_url="https://example.amocrm.ru",
        amo_client_id="client-id",
        amo_client_secret="client-secret",
        amo_redirect_uri="https://example.com/callback",
        amo_refresh_token="refresh-token",
        crm_base_url="http://crm.internal",
        crm_sync_secret="sync-secret",
        autoreply_enabled=True,
    )
    store = Store(settings.database_path)
    message = InboundMessage(
        session="crm_primary",
        provider_message_id="waha-msg-paused",
        phone="+996700111222",
        chat_id="996700111222@c.us",
        text="Оператор уже отвечает",
    )
    store.record_inbound(message, amo_lead_id=None, amo_contact_id=None)
    store.enqueue_message_buffer(message, delay_seconds=0)
    store.set_agent_mode("+996700111222", enabled=False, handoff_reason="operator_takeover")
    calls: dict[str, object] = {"decide_called": False}

    class FakeAmoClient:
        def __init__(self, settings: Settings) -> None:
            self.settings = settings

        async def ensure_lead_for_phone(self, phone: str, name: str | None, source: str) -> AmoLeadRef:
            return AmoLeadRef(lead_id=123, contact_id=456, created=False)

        async def add_lead_note(self, lead_id: int, text: str) -> None:
            return None

    class FakeCrmSyncClient:
        def __init__(self, settings: Settings) -> None:
            self.settings = settings

        async def sync_whatsapp(self, payload: object) -> dict[str, bool]:
            calls["agent_state"] = payload.agent_state
            calls["handoff_reason"] = payload.handoff_reason
            return {"ok": True}

    async def fake_decide_reply(
        settings: Settings,
        message: InboundMessage,
        history: list[dict[str, object]],
        amo_lead_id: int | None,
        knowledge: list[dict[str, object]] | None = None,
        lead_facts: dict[str, str] | None = None,
    ) -> AgentDecision:
        calls["decide_called"] = True
        return AgentDecision(reply_text=None, handoff_required=True, handoff_reason=None, summary="")

    monkeypatch.setattr(service_module, "AmoCrmClient", FakeAmoClient)
    monkeypatch.setattr(service_module, "EvoCrmSyncClient", FakeCrmSyncClient)
    monkeypatch.setattr(service_module, "decide_reply", fake_decide_reply)
    service = LeadAgentService(settings=settings, store=store)

    result = await service.process_due_buffers(phone="+996700111222")

    assert result["processed_count"] == 1
    assert result["results"][0]["agent_mode"] == "disabled"
    assert calls == {
        "decide_called": False,
        "agent_state": "agent_mode_disabled",
        "handoff_reason": "operator_takeover",
    }


@pytest.mark.asyncio
async def test_service_buffer_worker_polls_until_stopped(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = replace(_settings(tmp_path), worker_poll_interval_seconds=0.25)
    service = LeadAgentService(settings=settings, store=Store(settings.database_path))
    stop_event = asyncio.Event()
    calls = 0

    async def fake_process_due_buffers(phone: str | None = None, max_groups: int = 10) -> dict[str, object]:
        nonlocal calls
        calls += 1
        if calls == 2:
            stop_event.set()
        return {"processed_count": 0, "results": []}

    monkeypatch.setattr(service, "process_due_buffers", fake_process_due_buffers)

    await asyncio.wait_for(service.run_buffer_worker(stop_event), timeout=1)

    assert calls >= 2
