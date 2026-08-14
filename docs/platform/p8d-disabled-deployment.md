# P8D Disabled Production Deployment Contract

Status: proposed under issue
[#184](https://github.com/izzhackt/evo_AI_CRM/issues/184).

Block-ID: `EVO-P8D-DISABLED-PRODUCTION-DEPLOYMENT-2026-08-15`.

## Goal

Deploy the already-built P8B application candidate to the owned production
host while every new Platform provider-write, worker and autonomous-send path
is disabled. This block proves deployment identity, health and rollback. It
does not prove the real provider journey and does not cut over WAHA ownership.

## Frozen identities

- P8B application source commit:
  `0505143657858e710acdd5029f1cc77c5524083e`.
- P8B application tree:
  `0563636057a19949a8927abc3ce02b32ba65896c`.
- P8B base commit: `5c948aa8e6b8de402523ccd949a67001a7275f68`.
- Candidate manifest SHA-256:
  `0ac30b056c7d079e0c257b092def4a84ebd031a83b4743079b4149238f9cdeb0`.
- Evidence index SHA-256:
  `27cbdfff5f9aea757e75e3d8841d55742bea744622552a2484d856261ee3f6fd`.
- Main CRM image ID:
  `sha256:07461c5990e2e4281af85fd0d85ec63e711d11cd6a5aa339220418914af428b2`.
- EVO Inbox image ID:
  `sha256:4e881e08e036590576d7ccb74f949207b8f31342bad74a4e946b0751a233c9cc`.
- EVO Lead Agent image ID:
  `sha256:c1555f5875ff46f123a1fbcb80b07c125d725c40c574047c137abc24737cde27`.
- Release-control commit at plan start:
  `33d745121208bdaf30fceeda25e9c87ab346db8e`.
- Release name: `2026-08-15.p8d.1`.

The application candidate remains P8B commit `050514...`. Commits after its
squash-main equivalent `6ee93bd...` changed only CI, documentation, evidence
schemas/scripts/tests and package command wiring. They did not change the three
application source trees, Dockerfiles, production Compose/Caddy files,
migrations or runtime examples. P8D therefore uses current reviewed `main` as
the release-control source and the frozen P8B image IDs as application
provenance. It must not rebuild or relabel those images.

## Authorized action window

The owner authorized this disabled P8D deployment on 2026-08-15. Execution may
start only after this contract merges with independent review and exact-main
green CI. The executor records the UTC start timestamp and has at most 120
minutes for mutation and verification. If the window expires, stop with the
current safe runtime or execute rollback; a later attempt needs a fresh
timestamped owner approval.

Authorization covers only:

- staging a clean detached release and private evidence directory on
  `hermes-vps`;
- preserving current image/configuration/volume rollback artifacts;
- deploying the three frozen first-party image IDs for `evo-crm-app`,
  `evo-inbox-app` and `evo-lead-agent`, one boundary at a time;
- an exact managed-Supabase migration-ledger read and a no-op when it remains
  contiguous `001-072`;
- private/public health and authenticated readiness reads that do not expose
  customer content;
- immediate rollback to the captured prior image/configuration identities.

It does not authorize:

- rebuilding candidate images or substituting tags for image IDs;
- restarting or replacing either WAHA container or `evo-edge-caddy`;
- changing DNS, Caddy routing, WAHA session/webhook/QR configuration or the
  retained legacy webhook path;
- running `supabase db push`, repair, reset or migration SQL when the production
  ledger is already exactly `001-072`; any ledger drift stops P8D;
- WhatsApp sends, customer-content Gemini calls, amoCRM writes, autonomous send,
  provider webhook replay, billed resources, Lead Agent/legacy retirement,
  customer-record inspection or production restore.

## Mandatory disabled state

Before Compose rendering and again inside the created containers, verify only
the setting names and normalized boolean state, never secret values. The exact
matrix is closed:

| Boundary | Required setting | Value |
| --- | --- | --- |
| Main CRM | `EVO_PLATFORM_WAHA_INGRESS_ENABLED` | `0` |
| Main CRM | `EVO_PLATFORM_WAHA_WORKER_ENABLED` | `0` |
| Main CRM | `EVO_PLATFORM_WAHA_HISTORY_ENABLED` | `0` |
| Main CRM | `EVO_PLATFORM_WAHA_MEDIA_ENABLED` | `0` |
| Main CRM | `EVO_PLATFORM_AMOCRM_READ_ENABLED` | `0` |
| Main CRM | `EVO_PLATFORM_AI_MEMORY_ENABLED` | `0` |
| Main CRM | `EVO_PLATFORM_GEMINI_PROPOSALS_ENABLED` | `0` |
| Main CRM | `EVO_PLATFORM_AUTONOMOUS_REPLIES_ENABLED` | `0` |
| Main CRM | `EVO_PLATFORM_AUTONOMOUS_REPLIES_KILL_SWITCH` | `1` |
| Main CRM | `EVO_PLATFORM_P6A_PORTAL_ATTENTION_ENABLED` | `0` |
| Main CRM | `EVO_PLATFORM_P6B_PORTAL_NOTIFICATIONS_ENABLED` | `0` |
| Main CRM | `EVO_PLATFORM_P6C_OVERDUE_NOTIFICATIONS_ENABLED` | `0` |
| Main CRM | `EVO_PLATFORM_P7A_AUDIT_ENABLED` | `0` |
| Main CRM | `EVO_PLATFORM_P7B_OBSERVABILITY_ENABLED` | `1` |
| EVO Lead Agent | `EVO_AGENT_FROZEN` | `true` |
| EVO Lead Agent | `EVO_AGENT_WORKER_ENABLED` | `false` |
| EVO Lead Agent | `EVO_AGENT_AUTOREPLY_ENABLED` | `false` |
| EVO Lead Agent | `EVO_AGENT_OUTBOUND_ENABLED` | `false` |
| EVO Lead Agent | `EVO_AGENT_GEMINI_MODEL` | `gemini-3.5-flash` |
| EVO Inbox | `EVO_PLATFORM_P7B_OBSERVABILITY_ENABLED` | `1` |

The CRM values live only in `/opt/evo-crm/.env.production`; Lead Agent values
live only in `/opt/evo-crm/.env.lead-agent`; and the Inbox observability value
lives only in `/opt/evo-inbox/agent-lead2-crmwhatsapp/.env.production`.
Compose overrides may pin the same values but must not disagree with those
files. EVO Inbox has no separate autonomous-send activation flag in this
candidate: P8D must not call its send, AI-test or configuration-mutation
endpoints, and must not mutate its encrypted per-account provider settings.

If a required disabled flag is absent from the live secret files, append only
that non-secret boolean setting under mode `0600`, record the file hash before
and after, and never print the file. P8D also explicitly authorizes appending
the single non-secret line `EVO_AGENT_GEMINI_MODEL=gemini-3.5-flash` to
`/opt/evo-crm/.env.lead-agent` when that setting is absent; no Gemini request is
made.

The first fail-closed preflight at `2026-08-14T22:12:22Z` found one exact
existing conflict before any production mutation:
`EVO_AGENT_AUTOREPLY_ENABLED=true` in `/opt/evo-crm/.env.lead-agent`, while the
existing Compose override keeps the running container at `false`. Issue #186
authorizes one atomic safety correction of that exact file setting from
`true` to `false`. Before editing, copy the mode-`0600` file to a root-only
rollback file beside the live env file, outside every release/evidence
directory; record only an opaque backup identifier, success state and the
before hash in redacted evidence, and require exactly one active assignment.
Delete that secret-bearing rollback copy only after all three deployed services
and the final disabled-state checks pass; delete it immediately after a
successful rollback, or retain it root-only while a failed rollback is
escalated. After editing, preserve root ownership and mode `0600`, record only
the after hash, require exactly one active `false` assignment, and render
Compose to confirm the container value remains `false`. Do not print or retain
the file contents in redacted evidence. Any other missing non-boolean setting
or any other existing conflicting value remains a stop condition rather than
an invitation to add or override configuration through an unreviewed layer.

The same preflight proved that the two distinct private-readiness HMAC settings
are absent. Issue #186 authorizes generation on Hermes of exactly two distinct
32-byte random values with `openssl rand -hex 32`: one stored only as
`EVO_PLATFORM_P7B_OBSERVABILITY_SECRET` in `/opt/evo-crm/.env.production`, and
one stored only as `EVO_INBOX_P7B_OBSERVABILITY_SECRET` in
`/opt/evo-inbox/agent-lead2-crmwhatsapp/.env.production`. Back up each file to a
root-only mode-`0600` sibling outside evidence, require the key to be absent
before insertion, update atomically in the same directory, and preserve root
ownership/mode. Values exist only in process memory and those files: never
print, transmit, hash into evidence, or copy them between services. Redacted
evidence records only `present=true`, `length=64`, `distinct=true`, update
success and the env-file before/after hashes. The rollback copies follow the
same deletion/failed-rollback retention rule as the Lead Agent env backup.

## Pre-mutation gate

All items are mandatory:

1. GitHub `main`, this merged contract and exact-main CI are green and stable.
2. The retained P8B manifest, evidence index and three local image IDs recompute
   to the frozen hashes. Transfer uses `docker save` over SSH or another
   byte-preserving path; Hermes verifies the imported image IDs before use.
3. Hermes still has the P8C-owned EVO projects, networks, containers and
   canonical/fallback routes; no unrelated proxy owns the EVO edge.
4. Current container image IDs, OCI revisions, restart counts, health and
   network membership are recorded without environment values.
5. Current production env files exist, are owned by root and mode `0600`; only
   required setting names and disabled boolean states are inspected.
6. Managed `evo-platform-prod` is `ACTIVE_HEALTHY` and its migration ledger is
   exactly contiguous `001-072`. A difference is a stop condition, not an
   invitation to repair production during this release.
7. WAHA session ownership remains known and the legacy webhook path remains
   available. P8D records but does not change the existing legacy target. The
   Inbox WAHA session may remain `SCAN_QR_CODE`; this is an expected external
   blocker and must not be relabelled ready or fixed without owner phone/QR
   participation.
8. Disk/memory capacity and rollback image/configuration capture succeed.
9. A clean detached release directory and mode-`0700` evidence directory exist;
   no real `.env` file enters the release tree or retained evidence.
10. Rollback Compose rendering and image existence checks pass before the first
    container is recreated.

## Ordered execution

1. Capture pre-state and rollback tags/configuration hashes using the safe
   read-only portions of `deploy/production-release.md`; do not run its
   WAHA/Caddy deploy steps.
2. Run the CRM application's normal SQLite logical backup while it remains
   online. Do not run the runbook's volume-snapshot block: it pauses both WAHA
   containers and is outside P8D authorization. P8D performs no migration or
   provider write, so rollback is the captured prior application image plus the
   unchanged live env/volume mounts. Treat the logical backup as secret and
   retain it outside Git.
3. Verify the managed migration ledger. Record the expected no-op `001-072`.
4. Import and verify the exact candidate image IDs on Hermes.
5. Render Compose with the live absolute env-file paths and disabled state.
6. Recreate `evo-lead-agent` first in frozen/no-worker mode. Require container
   health, private admin health and a `503/not-ready` result where frozen state
   intentionally prevents receive processing; do not call a provider.
7. Recreate `evo-crm-app`. Require container health, public canonical and
   fallback HTTP health where DNS exists, authenticated private readiness and
   unchanged private WAHA/Lead Agent network reachability. Current missing
   canonical DNS is recorded as blocked and is not changed in P8D. Do not enable
   Platform ingress.
8. Recreate `evo-inbox-app`. Require container health, canonical HTTP health,
   where DNS exists, and require the authenticated private readiness response to
   truthfully retain `not_ready` while WAHA is `SCAN_QR_CODE`; unchanged private
   Inbox WAHA reachability is still required. Do not send or replay a message.
9. Recheck exact deployed image IDs, OCI source/revision labels, disabled flags,
   restart counts, networks, WAHA/Caddy untouched identities, migration ledger
   and rollback artifacts.
10. Retain redacted evidence and stop before P8E or any provider proof.

## Rollback

Rollback is triggered immediately when a recreated service is unhealthy,
unexpectedly restarts, exposes a private route, changes provider behavior,
cannot reach an existing private dependency, or does not match the frozen image
identity.

- Recreate only the failed/already-changed first-party services from the
  captured prior image overrides and original live configuration paths.
- Do not restore database/WAHA volumes for an application-code rollback unless
  a separately reviewed data-restore decision is made. P8D expects no migration
  and no provider write.
- Verify prior image IDs, health, networks, restart counts and canonical URLs.
- Preserve both failed-deployment and rollback evidence; do not retry blindly.

## Evidence and completion

Evidence root:
`/opt/evo-release-evidence/0505143657858e710acdd5029f1cc77c5524083e/2026-08-15.p8d.1`.
Directory mode is `0700`; files are `0600`. Retained evidence contains only
fixed check IDs, timestamps, exit/status codes, hashes, image IDs, revisions,
counts, safe route names and boolean setting state. It must not contain env
values, tokens, cookies, customer identifiers/content, provider payloads,
database rows or WAHA session data.

P8D is complete only when all three candidate image IDs are deployed, the
migration check is a verified no-op, every required health/readiness check has
the expected disabled-mode result, WAHA/Caddy and legacy ownership are
unchanged, rollback remains executable, and an independent reviewer accepts the
redacted report. Otherwise P8D is `blocked` or `rolled_back`, never partially
`verified`.

## Official basis

- Supabase production migrations:
  <https://supabase.com/docs/guides/deployment/database-migrations>
- Docker Compose production guidance:
  <https://docs.docker.com/compose/how-tos/production/>
- Docker Compose image and service behavior:
  <https://docs.docker.com/reference/compose-file/services/>
- WAHA API security:
  <https://waha.devlike.pro/docs/how-to/security/>
- Gemini model API:
  <https://ai.google.dev/gemini-api/docs/models>
