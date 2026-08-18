from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass(frozen=True)
class InboundMessage:
    session: str
    provider_message_id: str
    phone: str
    chat_id: str
    text: str
    push_name: str | None = None
    timestamp: int | None = None


@dataclass(frozen=True)
class AmoLeadRef:
    lead_id: int
    contact_id: int | None
    created: bool


@dataclass(frozen=True)
class AgentDecision:
    reply_text: str | None
    handoff_required: bool
    handoff_reason: str | None
    summary: str
    lead_updates: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class EvoCrmSyncPayload:
    event: str
    session: str
    provider_message_id: str
    phone: str
    chat_id: str
    text: str
    provider_occurred_at: str
    amo_account_id: int
    amo_lead_id: int
    amo_contact_id: int | None
    amo_created: bool
    agent_state: str
    agent_summary: str | None
    handoff_required: bool
    handoff_reason: str | None
    push_name: str | None = None
    reply_text: str | None = None
    outbound_provider_message_id: str | None = None
    lead_updates: dict[str, str] = field(default_factory=dict)
    idempotency_key: str | None = None
