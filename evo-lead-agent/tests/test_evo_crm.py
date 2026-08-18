from evo_lead_agent.evo_crm import _whatsapp_payload
from evo_lead_agent.schemas import EvoCrmSyncPayload


def test_whatsapp_payload_uses_evo_crm_camel_case_contract() -> None:
    payload = EvoCrmSyncPayload(
        event="whatsapp.message",
        session="crm_primary",
        provider_message_id="waha-msg-1",
        phone="+996700111222",
        chat_id="996700111222@c.us",
        text="Здравствуйте",
        provider_occurred_at="2026-08-18T02:30:00.000Z",
        amo_account_id=789,
        amo_lead_id=123,
        amo_contact_id=456,
        amo_created=True,
        agent_state="reply_sent",
        agent_summary="Interested in admissions.",
        handoff_required=False,
        handoff_reason=None,
        push_name="Client",
        reply_text="Здравствуйте! Чем можем помочь?",
        outbound_provider_message_id="waha-out-1",
        idempotency_key="crm_primary:waha-msg-1:reply_sent",
    )

    result = _whatsapp_payload(payload)

    assert result["providerMessageId"] == "waha-msg-1"
    assert result["providerOccurredAt"] == "2026-08-18T02:30:00.000Z"
    assert result["amoAccountId"] == 789
    assert result["amoLeadId"] == 123
    assert result["amoContactId"] == 456
    assert result["agentState"] == "reply_sent"
    assert result["agentSummary"] == "Interested in admissions."
    assert result["replyText"] == "Здравствуйте! Чем можем помочь?"
    assert result["outboundProviderMessageId"] == "waha-out-1"
    assert "provider_message_id" not in result
    assert "amo_lead_id" not in result
    assert "agent_state" not in result
