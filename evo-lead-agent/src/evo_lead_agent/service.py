from __future__ import annotations

import asyncio
import json
import logging
import time
from dataclasses import asdict
from typing import Any

from .agent import decide_reply
from .amo import AmoCrmClient
from .config import Settings
from .evo_crm import EvoCrmSyncClient
from .phone import phone_from_waha_chat_id
from .schemas import AgentDecision, EvoCrmSyncPayload, InboundMessage
from .store import Store
from .waha import WahaClient

logger = logging.getLogger(__name__)


class LeadAgentService:
    def __init__(self, settings: Settings, store: Store) -> None:
        self.settings = settings
        self.store = store

    async def handle_waha_payload(self, payload: dict[str, Any]) -> dict[str, Any]:
        event = payload.get("event")
        if event == "session.status":
            return await self._sync_session_status(payload)
        if event != "message":
            return {"accepted": True, "ignored": True, "reason": "unsupported_event"}

        inbound_or_error = self._inbound_from_waha_payload(payload)
        if isinstance(inbound_or_error, dict):
            return inbound_or_error
        inbound = inbound_or_error

        inserted = self.store.record_inbound(
            inbound,
            amo_lead_id=None,
            amo_contact_id=None,
        )
        if not inserted:
            return {"accepted": True, "duplicate": True}

        scheduled = self.store.enqueue_message_buffer(inbound, self.settings.reply_delay_seconds)
        if self.settings.reply_delay_seconds <= 0:
            processed = await self.process_due_buffers(phone=inbound.phone)
            return {"accepted": True, "queued": True, "scheduled": scheduled, "processed": processed}

        return {
            "accepted": True,
            "queued": True,
            "scheduled": scheduled,
            "reply_delay_seconds": self.settings.reply_delay_seconds,
        }

    async def run_buffer_worker(self, stop_event: asyncio.Event) -> None:
        interval = max(0.25, self.settings.worker_poll_interval_seconds)
        while not stop_event.is_set():
            try:
                await self.process_due_buffers(max_groups=5)
            except Exception:
                logger.exception("lead-agent buffer worker failed")
            try:
                await asyncio.wait_for(stop_event.wait(), timeout=interval)
            except TimeoutError:
                continue

    async def process_due_buffers(self, phone: str | None = None, max_groups: int = 10) -> dict[str, Any]:
        processed: list[dict[str, Any]] = []
        for _ in range(max(1, max_groups)):
            messages = self.store.claim_next_due_buffer(phone=phone)
            if not messages:
                break
            provider_message_ids = [message.provider_message_id for message in messages]
            try:
                result = await self._process_buffered_messages(messages)
            except Exception as exc:
                self.store.defer_buffer_retry(provider_message_ids, self.settings.reply_delay_seconds)
                logger.exception("lead-agent buffer processing failed")
                processed.append(
                    {
                        "message_count": len(messages),
                        "reason": "processing_exception",
                        "detail": str(exc),
                        "retryable": True,
                    }
                )
                break
            processed.append(result)
            if result.get("retryable"):
                self.store.defer_buffer_retry(provider_message_ids, self.settings.reply_delay_seconds)
                break
            self.store.mark_buffer_processed(provider_message_ids)
        return {"processed_count": len(processed), "results": processed}

    async def _process_buffered_messages(self, messages: list[InboundMessage]) -> dict[str, Any]:
        inbound = _combine_messages(messages)
        if not self.settings.amo_configured:
            return {"message_count": len(messages), "reason": "amo_not_configured", "retryable": True}
        if not self.settings.crm_sync_configured:
            return {"message_count": len(messages), "reason": "crm_sync_not_configured", "retryable": True}

        amo = AmoCrmClient(self.settings)
        amo_ref = await amo.ensure_lead_for_phone(
            phone=inbound.phone,
            name=inbound.push_name,
            source="EVO WhatsApp leadAgent",
        )
        self.store.upsert_conversation(
            inbound.phone,
            amo_lead_id=amo_ref.lead_id,
            amo_contact_id=amo_ref.contact_id,
        )
        await amo.add_lead_note(amo_ref.lead_id, f"WhatsApp inbound from {inbound.phone}:\n{inbound.text}")

        control = self.store.get_conversation_control(inbound.phone)
        if not control["agent_mode"]:
            decision = AgentDecision(
                reply_text=None,
                handoff_required=True,
                handoff_reason=str(control["handoff_reason"] or "agent_mode_disabled"),
                summary="Inbound WhatsApp message received while agent mode is disabled.",
            )
            crm_sync = await self._sync_crm(
                inbound=inbound,
                amo_lead_id=amo_ref.lead_id,
                amo_contact_id=amo_ref.contact_id,
                amo_created=amo_ref.created,
                decision=decision,
                agent_state="agent_mode_disabled",
            )
            return {
                "lead_id": amo_ref.lead_id,
                "message_count": len(messages),
                "agent_mode": "disabled",
                "crm_sync": crm_sync,
            }

        if not self.settings.autoreply_enabled:
            decision = AgentDecision(
                reply_text=None,
                handoff_required=True,
                handoff_reason="autoreply_disabled",
                summary="Inbound WhatsApp message received; autoreply is disabled.",
            )
            crm_sync = await self._sync_crm(
                inbound=inbound,
                amo_lead_id=amo_ref.lead_id,
                amo_contact_id=amo_ref.contact_id,
                amo_created=amo_ref.created,
                decision=decision,
                agent_state="autoreply_disabled",
            )
            return {
                "lead_id": amo_ref.lead_id,
                "message_count": len(messages),
                "autoreply": "disabled",
                "crm_sync": crm_sync,
            }

        decision = await decide_reply(
            settings=self.settings,
            message=inbound,
            history=self.store.history(inbound.phone),
            amo_lead_id=amo_ref.lead_id,
            knowledge=self.store.search_knowledge(inbound.text, limit=5),
            lead_facts=self.store.lead_facts(inbound.phone, amo_ref.lead_id),
        )
        lead_updates = self.store.clean_lead_facts(decision.lead_updates)
        await amo.add_lead_note(
            amo_ref.lead_id,
            "leadAgent decision:\n"
            f"summary: {decision.summary}\n"
            f"handoff_required: {decision.handoff_required}\n"
            f"reason: {decision.handoff_reason or '-'}\n"
            f"lead_updates: {json.dumps(lead_updates, ensure_ascii=False) if lead_updates else '-'}",
        )
        if decision.handoff_required:
            await amo.create_followup_task(
                lead_id=amo_ref.lead_id,
                text=f"leadAgent handoff: {decision.handoff_reason or 'manager_review'}",
                complete_till=int(time.time()) + 3600,
            )

        if decision.reply_text and self.settings.outbound_enabled and self.settings.waha_configured:
            waha = WahaClient(
                base_url=self.settings.waha_base_url or "",
                api_key=self.settings.waha_api_key or "",
                session_name=self.settings.waha_session_name,
            )
            outbound_id = await waha.send_text(inbound.phone, decision.reply_text)
            self.store.record_outbound(inbound.phone, decision.reply_text, outbound_id)
            await amo.add_lead_note(amo_ref.lead_id, f"WhatsApp outbound by leadAgent:\n{decision.reply_text}")
            crm_sync = await self._sync_crm(
                inbound=inbound,
                amo_lead_id=amo_ref.lead_id,
                amo_contact_id=amo_ref.contact_id,
                amo_created=amo_ref.created,
                decision=decision,
                agent_state="reply_sent",
                outbound_provider_message_id=outbound_id,
                synced_reply_text=decision.reply_text,
                lead_updates=lead_updates,
            )
            if crm_sync == "delivered":
                self.store.upsert_lead_facts(inbound.phone, amo_ref.lead_id, lead_updates)
            return {
                "reply": "sent",
                "lead_id": amo_ref.lead_id,
                "message_count": len(messages),
                "crm_sync": crm_sync,
                "crm_sync_failed": crm_sync == "failed",
            }

        agent_state = "handoff_required" if decision.handoff_required else "reply_not_sent"
        crm_sync = await self._sync_crm(
            inbound=inbound,
            amo_lead_id=amo_ref.lead_id,
            amo_contact_id=amo_ref.contact_id,
            amo_created=amo_ref.created,
            decision=decision,
            agent_state=agent_state,
            lead_updates=lead_updates,
        )
        if crm_sync == "failed":
            return {
                "reply": "not_sent",
                "retryable": True,
                "reason": "crm_sync_failed",
                "lead_id": amo_ref.lead_id,
                "handoff_required": decision.handoff_required,
                "message_count": len(messages),
                "crm_sync": crm_sync,
            }
        self.store.upsert_lead_facts(inbound.phone, amo_ref.lead_id, lead_updates)
        return {
            "reply": "not_sent",
            "outbound_enabled": self.settings.outbound_enabled,
            "lead_id": amo_ref.lead_id,
            "handoff_required": decision.handoff_required,
            "message_count": len(messages),
            "crm_sync": crm_sync,
        }

    def _inbound_from_waha_payload(self, payload: dict[str, Any]) -> InboundMessage | dict[str, Any]:
        raw_message = payload.get("payload")
        if not isinstance(raw_message, dict):
            return {"accepted": False, "ignored": True, "reason": "missing_payload"}
        if raw_message.get("fromMe") is True:
            return {"accepted": True, "ignored": True, "reason": "from_me"}

        chat_id = raw_message.get("from")
        if chat_id == "status@broadcast" or (isinstance(chat_id, str) and chat_id.endswith("@g.us")):
            return {"accepted": True, "ignored": True, "reason": "non_direct_chat"}

        phone = phone_from_waha_chat_id(chat_id)
        text = raw_message.get("body")
        provider_message_id = raw_message.get("id")
        if not phone or not isinstance(text, str) or not text.strip() or not isinstance(provider_message_id, str):
            return {"accepted": True, "ignored": True, "reason": "missing_required_message_fields"}

        return InboundMessage(
            session=str(payload.get("session") or self.settings.waha_session_name),
            provider_message_id=provider_message_id,
            phone=phone,
            chat_id=str(chat_id),
            text=text.strip(),
            push_name=_push_name(raw_message),
            timestamp=_timestamp(raw_message.get("timestamp")),
        )

    async def _sync_crm(
        self,
        inbound: InboundMessage,
        amo_lead_id: int,
        amo_contact_id: int | None,
        amo_created: bool,
        decision: AgentDecision,
        agent_state: str,
        outbound_provider_message_id: str | None = None,
        synced_reply_text: str | None = None,
        lead_updates: dict[str, str] | None = None,
    ) -> str:
        idempotency_key = f"{inbound.session}:{inbound.provider_message_id}:{agent_state}"
        payload = EvoCrmSyncPayload(
            event="whatsapp.message",
            session=inbound.session,
            provider_message_id=inbound.provider_message_id,
            phone=inbound.phone,
            chat_id=inbound.chat_id,
            text=inbound.text,
            push_name=inbound.push_name,
            amo_lead_id=amo_lead_id,
            amo_contact_id=amo_contact_id,
            amo_created=amo_created,
            agent_state=agent_state,
            agent_summary=decision.summary,
            handoff_required=decision.handoff_required,
            handoff_reason=decision.handoff_reason,
            reply_text=synced_reply_text,
            outbound_provider_message_id=outbound_provider_message_id,
            lead_updates=lead_updates or {},
            idempotency_key=idempotency_key,
        )
        payload_json = json.dumps(asdict(payload), ensure_ascii=False, sort_keys=True)
        try:
            await EvoCrmSyncClient(self.settings).sync_whatsapp(payload)
        except Exception as exc:
            self.store.record_crm_sync_failure(idempotency_key, payload_json, str(exc))
            return "failed"
        self.store.record_crm_sync_success(idempotency_key, payload_json)
        return "delivered"

    async def _sync_session_status(self, payload: dict[str, Any]) -> dict[str, Any]:
        if not self.settings.crm_sync_configured:
            return {"accepted": False, "reason": "crm_sync_not_configured"}

        raw_status = payload.get("payload")
        if not isinstance(raw_status, dict):
            return {"accepted": False, "ignored": True, "reason": "missing_payload"}

        status = raw_status.get("status")
        if not isinstance(status, str) or not status.strip():
            return {"accepted": True, "ignored": True, "reason": "missing_status"}

        phone = None
        me = payload.get("me")
        if isinstance(me, dict):
            phone = phone_from_waha_chat_id(me.get("id"))

        try:
            await EvoCrmSyncClient(self.settings).sync_session_status(
                session=str(payload.get("session") or self.settings.waha_session_name),
                status=status.strip(),
                phone=phone,
            )
        except Exception as exc:
            return {"accepted": False, "reason": "crm_sync_failed", "detail": str(exc)}

        return {"accepted": True, "session_status": status.strip(), "crm_sync": "delivered"}


def parse_json_body(raw_body: bytes) -> dict[str, Any]:
    data = json.loads(raw_body.decode("utf-8"))
    if not isinstance(data, dict):
        raise ValueError("payload_must_be_object")
    return data


def _combine_messages(messages: list[InboundMessage]) -> InboundMessage:
    latest = messages[-1]
    if len(messages) == 1:
        return latest
    combined_text = "\n".join(f"{index}. {message.text}" for index, message in enumerate(messages, start=1))
    return InboundMessage(
        session=latest.session,
        provider_message_id=latest.provider_message_id,
        phone=latest.phone,
        chat_id=latest.chat_id,
        text=combined_text,
        push_name=latest.push_name,
        timestamp=latest.timestamp,
    )


def _push_name(raw_message: dict[str, Any]) -> str | None:
    nested = raw_message.get("_data")
    if isinstance(nested, dict) and isinstance(nested.get("pushName"), str):
        return nested["pushName"].strip() or None
    return None


def _timestamp(value: object) -> int | None:
    if isinstance(value, int) and value > 0:
        return value
    return None
