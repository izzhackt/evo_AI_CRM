# Greenfield Platform Boundary

This note summarizes the active boundary for EVO Platform implementation as of
2026-08-09 at accepted main
`8dbc99c578a9bad0750a04cb322f26a2fe68b1c0`.

- Platform backend: greenfield, Supabase-native.
- No legacy SQLite data import.
- No legacy account import.
- No root-auth migration into Platform.
- No dual-read or dual-write bridge.
- The accepted Claude Design root frontend from PRs #64/#71/#72 stays the only
  product UI; no fallback or parallel Inbox UI.
- First slice: bounded operator messaging and inbound-reply autonomy only.
- Messaging scope: conversation list/thread, necessary context, private WAHA
  receive/send, media, ACK/session reconciliation, AI draft/manual send, Gemini
  structured proposal, deterministic gates, durable lead memory, approved
  pgvector knowledge, audit and minimal health/settings.
- Autonomous send is limited to an exact inbound-triggered reply inside the
  rolling 24-hour service window. Human outbound/takeover pauses autonomy; only
  authorized staff may resume.
- Valid media-only inbound remains operator-visible and hands off; missing text
  is not a terminally successful no-op.
- amoCRM access is bounded read-mostly for canonical contact, lead, responsible
  Sales and stage plus task/call/chat-record references. No provider writes,
  inferred mapping, hardcoded IDs or silent fallback.
- WAHA remains private transport. Supabase owns queues, decision evidence, lead
  memory, approved retrieval, ACK/session reconciliation, private Realtime and
  audit. Root polling moves to private Realtime in a later block.
- Excluded first-slice scope: Inbox CRM/dashboard/pipeline/deal/lead/
  broadcast/flow/campaign/unrelated analytics/settings surfaces, cold outbound,
  autonomous follow-up/re-engagement and out-of-window free-form sends.
- P5A receive-only ingress is merged but disabled by default. PR #133/P5B is a
  draft, unmerged receive/project worker with no Gemini or provider send; it is
  blocked on this authority amendment and media-only handling.
- P1 is historical legacy containment. P2A-P2H are reusable foundation. Former
  P2I restore duties move to P7.
- Cutover evidence: bounded reconciliation window, zero unexplained
  loss/duplicates, health and rollback proof.
- Lead Agent and the legacy webhook/session/rollback path remain deployed and
  frozen. New workers and autonomy stay disabled by default until authorized
  real-provider E2E; this docs change authorizes no provider or production
  mutation.
