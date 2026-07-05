import json
from dataclasses import replace
from pathlib import Path

import pytest

from evo_lead_agent.agent import decide_reply
from evo_lead_agent.config import Settings
from evo_lead_agent.schemas import InboundMessage


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
        gemini_api_key="test-key",
        gemini_model="gemini-3.5-flash",
        autoreply_enabled=True,
        outbound_enabled=False,
        max_reply_chars=900,
        reply_delay_seconds=0,
        worker_enabled=False,
        worker_poll_interval_seconds=0.25,
    )


@pytest.mark.asyncio
async def test_decide_reply_includes_knowledge_matches_in_prompt(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    captured: dict[str, object] = {}

    class FakeModels:
        async def generate_content(self, **kwargs: object) -> object:
            captured.update(kwargs)

            class Response:
                text = (
                    '{"reply_text":"Стоимость зависит от страны.","handoff_required":false,'
                    '"handoff_reason":null,"summary":"Asked about price.","lead_updates":{}}'
                )

            return Response()

    class FakeAioClient:
        def __init__(self) -> None:
            self.models = FakeModels()

        async def aclose(self) -> None:
            captured["closed"] = True

    class FakeGenAiClient:
        def __init__(self, api_key: str) -> None:
            self.api_key = api_key
            self.aio = FakeAioClient()

    monkeypatch.setattr("evo_lead_agent.agent.genai.Client", FakeGenAiClient)
    decision = await decide_reply(
        settings=_settings(tmp_path),
        message=InboundMessage(
            session="crm_primary",
            provider_message_id="msg-1",
            phone="+996700111222",
            chat_id="996700111222@c.us",
            text="Сколько стоит поступление?",
        ),
        history=[],
        amo_lead_id=123,
        lead_facts={"target_country": "Canada"},
        knowledge=[
            {
                "question": "Сколько стоит поступление в Европу?",
                "answer": "Стоимость зависит от страны, программы и пакета сопровождения.",
                "source": "amo_export",
                "score": 3,
            }
        ],
    )

    assert decision.reply_text == "Стоимость зависит от страны."
    assert captured["model"] == "gemini-3.5-flash"
    assert captured["closed"] is True
    assert getattr(captured["config"], "response_mime_type") == "application/json"
    user_payload = captured["contents"]
    parsed_payload = json.loads(user_payload)
    assert "knowledge_matches" in user_payload
    assert "Стоимость зависит от страны, программы" in user_payload
    assert parsed_payload["known_lead_facts"] == {"target_country": "Canada"}


@pytest.mark.asyncio
async def test_decide_reply_returns_handoff_when_gemini_missing(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    def fail_client(**_kwargs: object) -> object:
        raise AssertionError("Gemini client must not be created without configuration")

    monkeypatch.setattr("evo_lead_agent.agent.genai.Client", fail_client)

    decision = await decide_reply(
        settings=replace(_settings(tmp_path), gemini_api_key=None),
        message=InboundMessage(
            session="crm_primary",
            provider_message_id="msg-1",
            phone="+996700111222",
            chat_id="996700111222@c.us",
            text="Здравствуйте",
        ),
        history=[],
        amo_lead_id=123,
    )

    assert decision.reply_text is None
    assert decision.handoff_required is True
    assert decision.handoff_reason == "gemini_not_configured"
