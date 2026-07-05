# Functional Spec: EVO Admissions WhatsApp Lead Agent

Version: 2026-07-03
Status: implementation baseline

## 1. Purpose

EVO Admissions needs a WhatsApp lead agent that can respond quickly to inbound
student leads while keeping sales data consistent. The agent must work with the
existing EVO CRM and WAHA deployment, but amoCRM is the source of truth for lead
and contact identity.

The system should:

- receive real WhatsApp messages through WAHA;
- resolve or create the matching amoCRM contact and lead;
- keep local idempotency and conversation history;
- answer safe admissions questions when enabled;
- collect missing qualification data;
- hand off risky or high-intent cases to a human manager;
- keep EVO CRM usable as the operator surface.

## 2. Source Of Truth

amoCRM owns:

- lead/contact identity;
- pipeline/status ownership;
- responsible manager assignment;
- source attribution;
- lead notes and follow-up tasks created by the agent.

The lead-agent service owns:

- WAHA webhook validation;
- WhatsApp message idempotency;
- conversation-to-amo association;
- AI decisioning and handoff summaries;
- guarded outbound WhatsApp send when enabled.

EVO CRM owns:

- staff UI;
- manual WhatsApp sending;
- local conversation display;
- student/client workflows after lead conversion.

EVO CRM currently creates local WhatsApp leads without remote amo IDs. That must
be corrected in the next CRM-side integration slice by adding remote identity
fields and a shadow-sync contract.

## 3. WhatsApp Behavior

For inbound direct messages:

1. Verify the WAHA HMAC signature.
2. Ignore unsupported events, `fromMe`, broadcasts, and groups.
3. Extract phone from WAHA `chatId`.
4. Deduplicate by provider message ID.
5. Search amoCRM by contact phone.
6. If no amo contact/lead exists, create contact and lead in amoCRM.
7. Store inbound history locally.
8. Add an amoCRM note with the inbound message.
9. If autoreply is disabled, stop.
10. If autoreply is enabled, generate a guarded decision.
11. If handoff is needed, add a note and follow-up task in amoCRM.
12. If outbound is enabled and a safe reply exists, send via WAHA and record it.

## 4. Agent Behavior

The agent may:

- answer general study-abroad process questions;
- ask about target country, degree, timeline, budget, current grade/university,
  English level, and preferred consultation time;
- summarize the lead for a manager;
- explain that a manager will confirm exact pricing, deadlines, and next steps.

The agent must not:

- guarantee admission, visa approval, grants, scholarships, discounts, or exact
  deadlines;
- invent university requirements, prices, promo terms, or official timelines;
- claim a human has confirmed something when not confirmed;
- continue autonomously during complaints, payment disputes, legal/visa risk, or
  explicit callback requests.

## 5. Handoff Criteria

Handoff is required when:

- the client asks for a manager or call;
- the client is ready to book/pay/sign;
- the message includes complaint, refund, visa guarantee, legal, or urgent risk;
- the agent lacks approved knowledge;
- the model or integration is not configured;
- amoCRM identity cannot be resolved safely.

The handoff summary should include:

- client phone/name if known;
- latest question;
- language;
- target country/degree if known;
- urgency/timeline;
- budget/payment signals;
- unresolved questions;
- reason for handoff.

## 6. Safety Switches

Default state:

- `EVO_AGENT_AUTOREPLY_ENABLED=false`
- `EVO_AGENT_OUTBOUND_ENABLED=false`

The first live test with the user's number should start with both disabled,
then enable autoreply without outbound, then enable outbound only after reviewing
the draft/decision behavior and amoCRM notes.
