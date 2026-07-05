# Long-Run Codex Launch Handoff

## Objective

Run the launch-control flow for Gemini-backed receive-only WhatsApp rollout in EVO Admissions CRM.

## Suggested Skills

- `launch-control`
- `to-issues`
- `code-review`
- `tdd`

## Primary Artifacts

- PRD: `docs/GEMINI_RECEIVE_ONLY_ROLLOUT_PRD.md`
- PRD issue: `https://github.com/izzhackt/evo_AI_CRM/issues/1`
- Launch contract: `docs/EVO_LAUNCH_PLAN.md`
- Decision log: `docs/PLAN_CHANGES.md`
- ADR: `docs/adr/0001-use-gemini-for-lead-agent-draft-review.md`
- Glossary: `CONTEXT.md`

## Resolved Decisions

- First Live Rollout means receive-only proof, not full automation launch.
- Run first live rollout on `hermes-vps` at `/opt/evo-crm`.
- Use a dedicated EVO test WhatsApp number.
- Create or resolve clearly marked real amoCRM test contact and test lead.
- Require Gemini 3.5 Flash draft review before live rollout.
- Keep WhatsApp outbound disabled for first rollout.
- Do not merge the unrelated remote Kant/Bitrix Gemini workspace into the EVO lead-agent path.

## Launch-Control Rules

- Create one PR per block.
- Use real tests and real integrations.
- No mocks, fake provider success, demo modes, or silent fallbacks.
- If live credentials are absent, stop and name the exact missing input.
- Send every PR to an independent reviewer before merge.

## Proposed Blocks

1. Add Gemini 3.5 Flash draft provider to EVO lead-agent: `https://github.com/izzhackt/evo_AI_CRM/issues/2`.
2. Expose receive-only draft review state in CRM/operator flow if current UI evidence is insufficient: `https://github.com/izzhackt/evo_AI_CRM/issues/3`.
3. Harden production preflight and deployment docs for receive-only Gemini rollout: `https://github.com/izzhackt/evo_AI_CRM/issues/4`.
4. Execute production receive-only proof on `hermes-vps` with real WAHA, amoCRM, CRM sync, and Gemini credentials: `https://github.com/izzhackt/evo_AI_CRM/issues/5`.

## Current Branches

- Parent CRM branch: `izzhacktcodex/waha-integration`
- Lead-agent source: parent-tracked `evo-lead-agent/` directory in
  `izzhackt/evo_AI_CRM`

## Stop Conditions

- Missing WAHA, amoCRM, CRM sync, Gemini, admin, or server credentials.
- Need to enable outbound WhatsApp for first proof.
- WAHA session cannot reach `WORKING`.
- amoCRM cannot create or resolve the marked test identity.
- CRM signed sync cannot be verified with real secret.
- Independent reviewer returns `changes_requested`.
