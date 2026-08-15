from __future__ import annotations

import json
from typing import Any

from google import genai
from google.genai import types

from .config import Settings
from .sales_prompt import SYSTEM_PROMPT
from .schemas import AgentDecision, InboundMessage


async def decide_reply(
    settings: Settings,
    message: InboundMessage,
    history: list[dict[str, Any]],
    amo_lead_id: int | None,
    knowledge: list[dict[str, Any]] | None = None,
    lead_facts: dict[str, str] | None = None,
) -> AgentDecision:
    if not settings.gemini_api_key:
        return AgentDecision(
            reply_text=None,
            handoff_required=True,
            handoff_reason="gemini_not_configured",
            summary="Inbound message received, but Gemini API key is not configured.",
        )

    history_text = "\n".join(f"{item['direction']}: {item['text']}" for item in history[-20:])
    user_payload = {
        "amo_lead_id": amo_lead_id,
        "phone": message.phone,
        "latest_message": message.text,
        "history": history_text,
        "known_lead_facts": lead_facts or {},
        "knowledge_matches": _compact_knowledge(knowledge or []),
    }
    client = genai.Client(api_key=settings.gemini_api_key)
    aio_client = client.aio
    try:
        response = await aio_client.models.generate_content(
            model=settings.gemini_model,
            contents=json.dumps(user_payload, ensure_ascii=False),
            config=types.GenerateContentConfig(
                system_instruction=SYSTEM_PROMPT,
                max_output_tokens=900,
                temperature=0.2,
                response_mime_type="application/json",
            ),
        )
    finally:
        close = getattr(aio_client, "aclose", None)
        if close is not None:
            await close()
    raw = response.text or ""
    data = json.loads(raw)
    reply = data.get("reply_text")
    if isinstance(reply, str) and len(reply) > settings.max_reply_chars:
        reply = reply[: settings.max_reply_chars].rstrip()
    return AgentDecision(
        reply_text=reply if isinstance(reply, str) and reply.strip() else None,
        handoff_required=bool(data.get("handoff_required")),
        handoff_reason=data.get("handoff_reason") if isinstance(data.get("handoff_reason"), str) else None,
        summary=data.get("summary") if isinstance(data.get("summary"), str) else message.text,
        lead_updates=data.get("lead_updates") if isinstance(data.get("lead_updates"), dict) else {},
    )


def _compact_knowledge(knowledge: list[dict[str, Any]]) -> list[dict[str, Any]]:
    compact = []
    for item in knowledge[:5]:
        compact.append(
            {
                "question": str(item.get("question", ""))[:500],
                "answer": str(item.get("answer", ""))[:1000],
                "source": str(item.get("source", ""))[:80],
                "score": item.get("score"),
            }
        )
    return compact
