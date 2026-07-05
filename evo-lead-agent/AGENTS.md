# AGENTS.md

## How To Work In This Repo

- This repo is the EVO Admissions lead-agent product. Treat it as production
  work, not a demo or mock workspace.
- Legacy source docs and reference snapshots are not deployable as-is. The
  Fusion repositories under `research/repos/` are reference-only snapshots, not
  canonical EVO product source and not part of the deployable tree. Reuse proven
  patterns deliberately only after adapting them to EVO Admissions, WAHA HMAC,
  amoCRM source-of-truth identity, and local Docker/server constraints.
- Before changing runtime integration behavior, verify current WAHA and amoCRM
  API docs from official sources, then cite the researched behavior in the
  relevant spec or implementation note.
- Do not hardcode credentials, WhatsApp session data, customer personal data,
  amoCRM tokens, WAHA API keys, Gemini keys, or server secrets.
- Keep WAHA private. The lead agent should talk to WAHA through the private
  Docker/network URL and must not expose WAHA dashboard, Swagger, or API.
- Default runtime safety is conservative:
  - `EVO_AGENT_AUTOREPLY_ENABLED=false`
  - `EVO_AGENT_OUTBOUND_ENABLED=false`
  - human handoff is allowed even when outbound is disabled
- Do not claim a real integration is working unless it was validated against the
  real service with real credentials.
- If real credentials or live services are missing, clearly report the exact
  blocker and keep validation to deterministic local tests.
- For larger changes, use planner/research/reviewer agents where available and
  keep an explicit plan in `implementation-plan.md`.
- When a task says to build on prior chatbot work, inspect reference snapshots
  only for reusable behavior and record the plan change before adapting any
  pattern. Do not copy an entire unrelated service into the EVO runtime.

## Current Product Boundary

- WAHA receives/sends WhatsApp messages.
- This service owns inbound lead-agent automation and amoCRM identity mapping.
- amoCRM is the source of truth for lead/contact records.
- EVO CRM remains the operator UI and can consume lead shadow/association data
  after the integration contract is implemented there.
