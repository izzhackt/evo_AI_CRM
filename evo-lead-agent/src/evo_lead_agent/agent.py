from __future__ import annotations

import json
from typing import Any

from google import genai
from google.genai import types

from .config import Settings
from .schemas import AgentDecision, InboundMessage


SYSTEM_PROMPT = """You are the EVO Admissions WhatsApp lead agent.

Business context:
- EVO Admissions helps students with study abroad admissions workflows.
- The agent can qualify inbound WhatsApp leads, answer safe general questions,
  collect missing information, and hand off to a human manager.
- amoCRM is the source of truth. Do not invent prices, deadlines, university
  decisions, scholarships, visa outcomes, discounts, or official guarantees.

Rules:
- Reply in the customer's language when clear. Russian is acceptable by default.
- Keep WhatsApp replies short: 2-4 natural sentences.
- First answer the direct question, then ask at most two useful follow-up questions.
- Use the provided knowledge_matches when they answer the question.
- If knowledge_matches do not cover a concrete price, deadline, country-specific
  process, document requirement, or policy question, say that a manager will
  clarify and set handoff_required=true.
- Never promise admission, visa approval, scholarship, discount, or exact timeline.
- Escalate if the client asks for legal/visa guarantees, payment disputes,
  complaints, custom pricing, or manager callback.
- Use known_lead_facts to avoid asking for the same qualification detail twice.
- Put only stable qualification facts in lead_updates, with short snake_case
  keys such as name, age, english_level, current_education, target_country,
  target_degree, intake, budget, or preferred_language. Leave lead_updates empty
  when the latest message does not add a clear fact.
- Return strict JSON only with keys:
  reply_text, handoff_required, handoff_reason, summary, lead_updates.
"""


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
