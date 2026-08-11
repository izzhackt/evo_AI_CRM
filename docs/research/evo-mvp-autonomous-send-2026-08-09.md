# EVO MVP Autonomous WhatsApp Sending Research

Research date: `2026-08-09`
Scope: design-only research for an approved MVP requirement, with current primary sources first. No live provider mutation, no code or plan edits, no claim of live-send success.

## Concise conclusion

Approve autonomous WhatsApp sending only as **reply-only automation inside the 24-hour service window**, with **Gemini generating structured proposals**, **EVO applying deterministic send gates**, **Supabase owning the durable queue/audit trail**, and **WAHA acting only as the transport adapter**.

Do not approve, in the first MVP, autonomous cold outreach, autonomous out-of-window re-engagement, or model-direct WAHA sending.

## Owner decision applied

The owner approved the recommended boundary on `2026-08-09`: the first MVP is
limited to **reply-only autonomy inside the 24-hour service window**, and every
message outside that window is forced to human review. This research does not
authorize live enablement or a customer send; those remain separate proof and
production gates.

## Bottom line

The smallest real MVP for autonomous WhatsApp sending on EVO is:

1. **Reply-only autonomy**, not general outbound autonomy.
2. **WAHA as the transport adapter**, but **EVO as the durable system of record**.
3. **Gemini produces structured draft decisions**, but **does not call WAHA directly**.
4. A **deterministic send gate** in EVO re-checks consent, time window, business hours, idempotency, handoff state, risk flags, and session health before any send.
5. **Supabase durable queue + audit tables** own the final send decision and replay path.
6. **Unknown or risky cases always hand off to a human**.

That is the smallest design that is both operationally honest and defensible against policy, duplicate-send, and hallucination risk.

## Primary constraints from current docs

### 1. WAHA can technically send messages, but it is not the official WhatsApp Business Platform

WAHA documents direct send endpoints such as [`POST /api/sendText`](https://waha.devlike.pro/docs/how-to/send-messages/), [`POST /api/sendSeen`](https://waha.devlike.pro/docs/how-to/engines/), reply support via `reply_to` in the [send messages guide](https://waha.devlike.pro/docs/how-to/send-messages/), message ACK events in the [events guide](https://waha.devlike.pro/docs/how-to/events/), and session lifecycle/status in the [sessions guide](https://waha.devlike.pro/docs/how-to/sessions/).

But WAHA also explicitly describes itself as a Node.js layer on top of **multiple community-driven WhatsApp engines** in the [engines guide](https://waha.devlike.pro/docs/how-to/engines/). That matters: WAHA gives EVO a technical way to send and observe messages, but it is **not** the same thing as Meta's official Cloud API compliance envelope.

Design implication:

- WAHA can be the **send transport**.
- WAHA should **not** be treated as proof that a given autonomous-send behavior is policy-safe.

### 2. Official WhatsApp business terms require consent, honoring opt-outs, and expose spam-enforcement risk

WhatsApp's official [Business Terms of Service](https://www.whatsapp.com/legal/business-terms) say the company must secure the necessary rights, consents, and permissions, including **opt-in**, to communicate with customers over WhatsApp; must honor user requests to stop or opt out; and may face suspension or termination if users block, mark messages as spam, or report the business.

Design implication:

- EVO needs an explicit **consent state** and **opt-out state** per lead.
- Autonomy cannot mean "send whenever the model feels appropriate."
- A send that is technically possible through WAHA can still be operationally dangerous if it violates consent expectations.

### 3. Official WhatsApp policy still distinguishes customer-service window vs business-initiated messages

WhatsApp's official [Business Messaging Policy](https://whatsappbusiness.com/policy/) says businesses may send free-form messages **within a 24-hour customer service window**, and otherwise must use an **approved template** for business-initiated outreach.

Design implication:

- The safest MVP is **reply-only inside the customer-service window**.
- Outside that window, do **not** let the autonomous path send free-form text.
- If the owner later wants autonomous re-engagement, that should be a **separate template/compliance track**, not bundled into the first MVP.

### 4. WAHA exposes the delivery and session signals EVO needs for safe automation

WAHA's [events guide](https://waha.devlike.pro/docs/how-to/events/) documents `message.any`, `message.ack`, and webhook/WebSocket delivery. WAHA's current [sessions guide](https://waha.devlike.pro/docs/how-to/sessions/#reachout-timelock) documents both `WORKING` and `me.reachoutTimelock`: the session can remain `WORKING` while an active timelock blocks outreach. The preflight therefore requires an explicit `null` or `isActive: false` timelock state and fails closed on active, missing, or malformed state. WAHA's [presence guide](https://waha.devlike.pro/docs/how-to/presence/) documents explicit `typing`, `paused`, `online`, and `offline` presence controls.

Design implication:

- EVO can gate autonomous sends on **session health**.
- EVO can reconcile send success through **ACK events** rather than assuming a successful HTTP request means the customer really received the message.
- EVO can choose whether to emulate human-like presence, but that should remain a controlled product decision, not default behavior.

### 5. Gemini is appropriate for classification and draft generation, not final transport authority

Google's official [Interactions API overview](https://ai.google.dev/gemini-api/docs/interactions-overview) says it is the recommended API for new projects. The official [structured output guide](https://ai.google.dev/gemini-api/docs/structured-output) supports JSON-schema-constrained responses. The official [function calling guide](https://ai.google.dev/gemini-api/docs/function-calling) supports tool invocation, and the official [safety settings guide](https://ai.google.dev/gemini-api/docs/safety-settings) documents configurable safety filters. Google's current [models guide](https://ai.google.dev/gemini-api/docs/models) shows `gemini-3.6-flash`, `gemini-3.5-flash`, and `gemini-3.5-flash-lite` as current options.

Design implication:

- Gemini is a good fit for **intent classification**, **risk labeling**, **fact extraction**, and **reply drafting**.
- Gemini should **not** directly decide that a send happened.
- The final go/no-go must remain in deterministic EVO code.

### 6. Supabase already has the durable primitives this MVP needs

Supabase's official [Queues guide](https://supabase.com/docs/guides/queues) says Supabase Queues is a Postgres-native durable queue system with **guaranteed delivery**. Supabase's official [Realtime guide](https://supabase.com/docs/guides/realtime/subscribing-to-database-changes) says **Broadcast** is the recommended approach for scalability and security, while Postgres Changes is simpler but less scalable.

Design implication:

- Use a **durable queue** for send jobs.
- Use **Broadcast** for operator UI updates after inbound classification, gate decisions, send attempts, ACK changes, and handoffs.

## Safe autonomy patterns compared

### Pattern A: Model calls WAHA directly

Flow:

- inbound message
- model decides
- model tool-calls send endpoint

Verdict: **Reject**

Why:

- no deterministic re-check of policy/business constraints
- weak idempotency
- weak audit separation between "model wanted to send" and "system sent"
- too easy to send hallucinated or duplicate content

### Pattern B: Model drafts, deterministic gate decides, queue worker sends

Flow:

- inbound message persisted
- model emits structured decision
- deterministic gate re-checks all non-model rules
- queue worker sends through WAHA
- ACK/session events reconcile the result

Verdict: **Best MVP**

Why:

- preserves autonomy while keeping business controls in code
- gives clean audit records
- isolates retry logic from model behavior
- keeps the owner kill-switch and handoff controls credible

### Pattern C: Human approval before every send

Verdict: **Safest, but not autonomous**

Use when:

- outside the 24-hour service window
- pricing/policy edge cases
- high-risk intents
- owner wants staged rollout

## Recommended MVP scope

Autonomous sending should be limited to **all** of the following:

- the customer has already messaged EVO in the same chat
- the message is inside the **24-hour service window** described by the official [Business Messaging Policy](https://whatsappbusiness.com/policy/)
- the lead is not opted out
- the lead is not currently in a human-handoff lock
- the answer can be built from:
  - recent chat context
  - durable per-lead memory in EVO
  - approved pgvector knowledge
- the model returns **high enough confidence**
- the deterministic gate finds **no blocking risk flags**

Autonomous sending should **not** cover, in MVP:

- cold outbound
- reopening dormant chats outside the service window
- pricing exceptions
- legal/visa/immigration certainty claims
- scholarship guarantees
- contradictory records between WhatsApp and amoCRM
- unresolved customer anger, abuse, or complaint states
- unsupported media/voice interpretation if confidence is low

## The smallest real MVP architecture

### Step 1. Persist inbound before any reasoning

On `message.any`, EVO persists:

- raw WAHA payload
- normalized message row
- lead/chat linkage
- media metadata
- received timestamp
- source session

This matches WAHA's event-driven model in the [events guide](https://waha.devlike.pro/docs/how-to/events/) and keeps EVO-owned durable memory intact.

### Step 2. Build a structured model decision, not a direct action

Gemini should return a strict JSON object using [structured outputs](https://ai.google.dev/gemini-api/docs/structured-output), for example:

```json
{
  "intent": "qualification_question",
  "confidence": 0.92,
  "risk_level": "low",
  "risk_flags": [],
  "needs_human": false,
  "business_hours_sensitive": false,
  "knowledge_chunk_ids": ["kb_123", "kb_891"],
  "lead_memory_updates": {
    "country_interest": "Malaysia",
    "intake_stage": "early_research"
  },
  "proposed_reply": "..."
}
```

The model should not return "message sent". It should return **a proposal**.

### Step 3. Deterministic send gate

Before any send job is created, EVO code re-checks:

- `consent_state == allowed`
- `opt_out_state == false`
- `within_service_window == true`
- `current_time within owner-approved business hours`
- `lead_handoff_lock == false`
- `global_kill_switch == false`
- `lead_kill_switch == false`
- `session.status == WORKING` from WAHA's [sessions guide](https://waha.devlike.pro/docs/how-to/sessions/)
- `me.reachoutTimelock == null || me.reachoutTimelock.isActive == false` from
  the current [Reachout Timelock guide](https://waha.devlike.pro/docs/how-to/sessions/#reachout-timelock)
- exact same-chat latest-inbound reply binding
- `message_idempotency_key` unused
- `last_outbound_at` respects cooldown/rate rules
- `risk_level` and `risk_flags` pass owner policy
- `proposed_reply` contains no blocked claims
- required knowledge citations/chunk ids are present for knowledge-based answers

If any check fails, **do not send**. Create a handoff/audit item instead.

### Step 4. Durable send queue

If the gate passes, EVO writes a durable send job to Supabase Queues using the primitives described in the official [Queues guide](https://supabase.com/docs/guides/queues).

The queued payload should include:

- internal send intent id
- lead id
- chat id
- WAHA session
- rendered text
- optional `reply_to`
- generated idempotency token
- model decision snapshot
- gate snapshot

### Step 5. Send worker

The worker:

1. rechecks the kill-switch
2. rechecks session health
3. sends via WAHA [`/api/sendText`](https://waha.devlike.pro/docs/how-to/send-messages/) or a reply with `reply_to` from the same guide
4. stores the WAHA response
5. marks the send as `accepted_by_transport`, not yet `delivered`

That wording matters. An HTTP success from WAHA is **not the same** as confirmed customer delivery or read.

### Step 6. ACK and reconciliation

EVO listens for WAHA [`message.ack`](https://waha.devlike.pro/docs/how-to/events/) and `session.status` events.

Suggested status ladder:

- `queued`
- `sending`
- `accepted_by_transport`
- `ack_server`
- `ack_device`
- `read`
- `failed_transport`
- `failed_policy_gate`
- `failed_reconciliation`
- `human_handoff`

This keeps transport truth separate from model intent.

### Step 7. Operator UI updates

Use Supabase Realtime **Broadcast** as recommended by the official [Realtime guide](https://supabase.com/docs/guides/realtime/subscribing-to-database-changes) to push:

- inbound message received
- AI decision ready
- gate blocked or passed
- send queued
- send accepted
- ACK/read updates
- human handoff triggered

## Explicit control set for MVP

### Confidence control

Only allow autonomous send above an owner-set threshold, for example `>= 0.85`.

Reason:

- confidence is not truth, but it is a useful gate for reducing low-signal sends

### Intent allowlist

Start with a small allowlist:

- greeting
- simple qualification
- acknowledgment of received docs/media
- answering approved FAQ from pgvector context
- confirming next-step process already present in approved KB

Block initially:

- price negotiation
- custom scholarships
- legal advice
- immigration certainty
- anything that depends on unverified amoCRM changes

### Risk control

Require the model to emit risk flags such as:

- `missing_kb_support`
- `contradictory_customer_record`
- `outside_business_hours`
- `customer_angry`
- `policy_sensitive`
- `low_confidence`

Any medium/high-risk flag should route to handoff.

### Consent control

Track separately:

- `platform_opt_in`
- `in_thread_reply_allowed`
- `opted_out`

For MVP, the safest interpretation is:

- an inbound customer message can allow **in-thread service replies**
- it should **not** automatically authorize proactive re-engagement outside the service window

### Business-hours control

Autonomous sending should respect owner-approved operating hours by lead locale or by EVO's chosen default timezone. If outside hours, either queue for next opening or hand off.

### Rate control

Set at least:

- maximum autonomous replies per lead in a rolling window
- minimum cooldown between automated sends
- maximum consecutive automated replies before human review

This is a product control, not a WAHA feature.

### Idempotency control

Every send intent must have a unique idempotency key based on:

- lead id
- triggering inbound message id
- decision version
- rendered outbound hash

Without this, retries can duplicate sends.

### Unknown-send control

If the answer depends on information not present in:

- recent chat
- durable lead memory
- approved KB

then the system must not send. It should ask a human.

### ACK control

A WAHA send request is not "done" until EVO observes a meaningful state progression through [`message.ack`](https://waha.devlike.pro/docs/how-to/events/), or a retry/repair rule decides otherwise.

### Handoff control

Human handoff should trigger on:

- blocked gate
- low confidence
- conflicting records
- angry or abusive customer
- media/voice the model cannot safely interpret
- business-hours restriction if the owner prefers not to queue
- repeated unanswered automated turns

### Kill-switch control

MVP needs at least:

- one **global autonomous-send kill switch**
- one **per-lead kill switch**
- one **per-intent disable switch**

The send worker must check the kill-switch immediately before transport send, not only at decision time.

### Audit control

For every autonomous turn, store:

- inbound trigger message id
- model name
- model structured output
- retrieved KB chunk ids
- gate inputs
- gate verdict
- final rendered outbound
- transport response
- later ACK/read outcomes
- human override if any

This is required if the owner later wants to explain "why did the system send that message?"

## WAHA-specific operational choices for MVP

### Use replies when possible

WAHA supports replying with `reply_to` in the [send messages guide](https://waha.devlike.pro/docs/how-to/send-messages/). For MVP, replying to the exact inbound message is safer than sending unrelated new outbound text because it keeps the autonomous action anchored to a visible customer request.

### Treat presence as optional

WAHA supports explicit `typing`, `paused`, `online`, and `offline` in the [presence guide](https://waha.devlike.pro/docs/how-to/presence/). This should be an owner choice, not a default. The safest MVP is:

- no fake typing required
- optionally mark `seen`
- remain conservative about `online`/`typing` automation

### Gate on session health

Only send when WAHA session health is good according to the [sessions guide](https://waha.devlike.pro/docs/how-to/sessions/). If the session is not `WORKING`, autonomous send must fail closed.

## Recommended model choice

For a new autonomous-send MVP today, the clean default is **`gemini-3.6-flash`** from Google's current [models guide](https://ai.google.dev/gemini-api/docs/models):

- it is the latest stable Flash model in the Gemini 3 family
- it supports the current Interactions/structured-output path
- it is a better default than letting the transport worker depend on an older ad hoc prompt path

If cost pressure becomes dominant later, `gemini-3.5-flash-lite` can be evaluated for extraction-only substeps from the same guide. But for the first autonomous send surface, stronger reasoning is worth more than a small per-message savings.

## Recommendation summary

Approve this as the smallest real MVP:

1. autonomous **reply-only**, inside the service window
2. **Gemini structured decision**, not direct send
3. **deterministic send gate** in EVO
4. **Supabase durable queue**
5. **WAHA transport worker**
6. **ACK-based reconciliation**
7. **fail closed to human handoff**

Do **not** approve, in the first MVP:

- autonomous cold outreach
- autonomous out-of-window re-engagement
- model-direct WAHA tool calling
- free-form answers without approved KB support
- silent retries without idempotency and audit

## Remaining material owner decisions

1. Should the first MVP be restricted to **reply-only inside the 24-hour service window**, with all other cases forced to human review?
2. Which exact intents are allowed for autonomous send on day one: greeting, qualification, FAQ, doc acknowledgment, follow-up scheduling, or something narrower?
3. What confidence threshold should block autonomous send?
4. What business-hours rule should apply: Bishkek time, customer local time, or country-specific schedules?
5. How many consecutive autonomous replies are allowed before mandatory human handoff?
6. Should the system ever send if the answer is not grounded in approved KB chunks, even when the model is confident?
7. Should EVO auto-send `seen` or `typing` presence, or should MVP avoid presence simulation entirely?
8. What is the exact owner kill-switch surface: global only, global plus per-lead, or global plus per-lead plus per-intent?
9. Should autonomous send be allowed when amoCRM and EVO disagree on sales status, or must that always hand off?
10. For outside-window re-engagement later, will the owner approve an official template/compliance track, or keep that permanently human-only?

## Source register

### Primary

- WAHA send messages: https://waha.devlike.pro/docs/how-to/send-messages/
- WAHA events: https://waha.devlike.pro/docs/how-to/events/
- WAHA sessions: https://waha.devlike.pro/docs/how-to/sessions/
- WAHA engines: https://waha.devlike.pro/docs/how-to/engines/
- WAHA presence: https://waha.devlike.pro/docs/how-to/presence/
- WhatsApp Business Terms: https://www.whatsapp.com/legal/business-terms
- WhatsApp Business Messaging Policy: https://whatsappbusiness.com/policy/
- Gemini Interactions API: https://ai.google.dev/gemini-api/docs/interactions-overview
- Gemini structured outputs: https://ai.google.dev/gemini-api/docs/structured-output
- Gemini function calling: https://ai.google.dev/gemini-api/docs/function-calling
- Gemini safety settings: https://ai.google.dev/gemini-api/docs/safety-settings
- Gemini models: https://ai.google.dev/gemini-api/docs/models
- Supabase Realtime: https://supabase.com/docs/guides/realtime/subscribing-to-database-changes
- Supabase Queues: https://supabase.com/docs/guides/queues
