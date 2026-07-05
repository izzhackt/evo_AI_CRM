from __future__ import annotations

import json
import time
from typing import Any

import httpx

from .config import Settings
from .schemas import EvoCrmSyncPayload
from .security import sign_evo_crm_payload


class EvoCrmSyncClient:
    def __init__(self, settings: Settings) -> None:
        if not settings.crm_base_url:
            raise ValueError("missing_crm_base_url")
        if not settings.crm_sync_secret:
            raise ValueError("missing_crm_sync_secret")
        self.base_url = settings.crm_base_url.rstrip("/")
        self.path = settings.crm_sync_path if settings.crm_sync_path.startswith("/") else f"/{settings.crm_sync_path}"
        self.secret = settings.crm_sync_secret
        self.timeout = settings.crm_sync_timeout_seconds

    async def sync_whatsapp(self, payload: EvoCrmSyncPayload) -> dict[str, Any]:
        return await self.sync_payload(_whatsapp_payload(payload))

    async def sync_session_status(
        self,
        session: str,
        status: str,
        phone: str | None,
    ) -> dict[str, Any]:
        return await self.sync_payload(
            {
                "event": "whatsapp.session_status",
                "session": session,
                "status": status,
                "phone": phone,
            }
        )

    async def sync_payload(self, payload: dict[str, Any]) -> dict[str, Any]:
        body = json.dumps(_compact_dict(payload), ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        timestamp = int(time.time())
        signature = sign_evo_crm_payload(body, self.secret, timestamp)
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            response = await client.post(
                f"{self.base_url}{self.path}",
                content=body,
                headers={
                    "Content-Type": "application/json",
                    "X-Evo-Agent-Timestamp": str(timestamp),
                    "X-Evo-Agent-Signature": signature,
                    "X-Evo-Agent-Signature-Algorithm": "sha256",
                },
            )
        response.raise_for_status()
        return response.json()


def _whatsapp_payload(payload: EvoCrmSyncPayload) -> dict[str, Any]:
    return _compact_dict(
        {
            "event": payload.event,
            "session": payload.session,
            "providerMessageId": payload.provider_message_id,
            "phone": payload.phone,
            "chatId": payload.chat_id,
            "text": payload.text,
            "amoLeadId": payload.amo_lead_id,
            "amoContactId": payload.amo_contact_id,
            "amoCreated": payload.amo_created,
            "agentState": payload.agent_state,
            "agentSummary": payload.agent_summary,
            "handoffRequired": payload.handoff_required,
            "handoffReason": payload.handoff_reason,
            "pushName": payload.push_name,
            "replyText": payload.reply_text,
            "outboundProviderMessageId": payload.outbound_provider_message_id,
            "leadUpdates": payload.lead_updates,
            "idempotencyKey": payload.idempotency_key,
        }
    )


def _compact_dict(payload: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in payload.items() if value is not None}
