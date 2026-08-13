# EVO runtime hardening and alert ownership

This runbook extends `production-release.md`; it does not authorize a deploy.
PR #46 remains the source of truth for clean exact-SHA builds, evidence capture,
boundary-by-boundary rollout, and rollback.

## Runtime contracts

- `/api/health` is process liveness. It never calls a provider and is the
  Compose healthcheck target for first-party web applications.
- `/api/readiness` is dependency readiness. CRM checks that its SQLite store is
  readable and writable. Inbox checks Supabase Auth and private unauthenticated
  WAHA `/ping` with a three-second timeout. Caddy returns `404` for public
  readiness requests; run them from an EVO-owned private network.
- Lead Agent `/health` stays liveness plus its explicit frozen/readiness fields.
  Frozen is expected containment, not provider readiness.
- A green container is not real WhatsApp, amoCRM, Supabase data-path, AI, or
  outbound proof. Run those separately with approved credentials and test data.

These contracts follow current
[Docker Compose health guidance](https://docs.docker.com/compose/how-tos/startup-order/),
[WAHA health guidance](https://waha.devlike.pro/docs/how-to/observability/), and
[Supabase Auth health guidance](https://supabase.com/docs/guides/troubleshooting/how-do-i-check-gotrueapi-version-of-a-supabase-project-lQAnOR).

## Limits and private boundaries

- Caddy rejects headers above 32 KiB, Inbox bodies above 20 MiB, and CRM bodies
  above 105 MiB. The CRM limit preserves the application-validated 101 MiB
  transcription request ceiling.
- Next.js proxy buffering uses matching ceilings. Route-level validation remains
  authoritative; edge limits are a coarse denial-of-service boundary.
- Caddy returns `404` for `/api/internal/*`, `/api/readiness/*`, `/admin/*`, and
  `/metrics`. WAHA and Lead Agent have no public port or Caddy route.
- Caddy emits the existing CSP in report-only mode, enforces the other baseline
  security headers, disables health caching, rotates JSON logs, and deletes
  credential-bearing headers from access logs. Enforcing CSP remains blocked
  on the plan's real two-deploy violation review and browser route pass; the
  current missing canonical DNS prevents that proof in this lane.
- Every service has explicit CPU, memory, and PID ceilings. See the
  [Compose services reference](https://docs.docker.com/reference/compose-file/services/)
  and [Caddy request-body reference](https://caddyserver.com/docs/caddyfile/directives/request_body).

## Request correlation and safe logs

CRM and Inbox accept a safe `X-Request-ID` or create a UUID, pass it to route
handlers, return it to the client, and log only method and path. Lead Agent uses
the same contract and adds response status and elapsed time. Query strings,
bodies, cookies, authorization values, provider payloads, phone numbers, and
customer content must not be logged.

During an incident, start with the client-visible `X-Request-ID`, then search
the relevant app logs. Do not paste customer messages or secrets into an issue.

## Alert ownership

| Signal | Initial owner | Required response |
| --- | --- | --- |
| unhealthy container or restart loop | EVO server operator | inspect bounded logs, liveness, resource/OOM state, and release evidence |
| private readiness `503` | owner of the failing integration | confirm provider status/config without exposing secrets |
| public `5xx` or upstream failure | EVO server operator | correlate edge/app request ID; roll back if release-related |
| WAHA session disconnected | WhatsApp operator | relink through the private operator path |
| provider proof unavailable | product owner | supply credentials, approval, and real test identity |

No external pager, webhook destination, named on-call rotation, or monitoring
credentials exist in the repository. Real alert delivery remains blocked on
that owner decision and credentials. Container health and response ownership
are implemented; external notification is not claimed.

## Read-only production baseline (2026-07-24 Asia/Bishkek)

Inspection on `hermes-vps` made no changes:

- CRM app and Lead Agent run first-party revision `1f0d1a81`; Inbox runs
  `14ed2e34`. Their image labels map to the expected Git releases.
- Both WAHA services run the same immutable digest
  `sha256:f3c33e8e70a78eb37af4f4e2eb655849d42d8ffdc4b8254f9de38069e906a146`.
  Caddy runs immutable image ID
  `sha256:86deaf5e3d3408a6ccec08fbb79989783dd26e206ae10bcf78a801dc8c9ab794`.
  These are third-party identities, not EVO Git revision labels.
- `evo_public_web` contains only the two public app containers and
  `evo-edge-caddy`; neither WAHA nor Lead Agent is attached.
- The host has 4 CPUs and 15 GiB RAM. A one-shot baseline measured roughly
  62-64 MiB per Next app, 801-860 MiB per WAHA, 119 MiB for Lead Agent, and
  14 MiB for Caddy, with 5-116 PIDs. The configured ceilings leave material
  per-service headroom; they are limits, not reservations, and should be
  reviewed against sustained metrics after deployment.
- Existing fallback routes respond, but the pre-Block-E edge still permits a
  public request to an Inbox `/api/internal/*` route (authentication returned
  `401`). This change makes the edge return `404` before the app.
- Canonical `crm.evoadmissions.com` and `inbox.evoadmissions.com` do not resolve
  from the server. DNS remains an owner-controlled blocker; fallback `sslip.io`
  routes were used for non-mutating header/status inspection.

## Production WAHA patch (2026-08-13 Asia/Bishkek)

The July baseline above remains historical evidence. On 2026-08-13 both WAHA
services were updated to WAHA `2026.7.1` at immutable digest
`sha256:dc134637dfa0bd65202010a65e4ff8176101791699176c75bb37d5aa9daf487c`.
The update fixed the live WEBJS chats API failure observed on `2026.6.2`.

Post-update evidence:

- both WAHA containers reported `healthy` on the new digest;
- `crm_primary` returned to `WORKING` with the existing linked identity;
- `GET /api/crm_primary/chats` returned HTTP 200;
- a protected full archive read 541 chats without API errors;
- an immediate second pass skipped all 541 unchanged chats.

No WhatsApp message was sent, read, edited, archived or deleted during this
patch and export validation.

## Pre-deploy and rollback evidence

From a clean exact-SHA release worktree, run:

```bash
npm run test:security
npm run lint
npm run build
npm --prefix agent-lead2-inbox test
npm --prefix agent-lead2-inbox run lint
npm --prefix agent-lead2-inbox run build
pytest -q evo-lead-agent/tests
node scripts/validate-runtime-hardening.mjs --compose
```

Build CRM, Inbox, and Lead Agent with the exact `EVO_RELEASE_REVISION` and
`EVO_RELEASE_VERSION`, then inspect both OCI labels. Caddy and WAHA are
third-party images: record their immutable digest and upstream metadata, but do
not claim they contain the EVO Git revision/version labels.

Before deployment, capture current image IDs, third-party digests, Compose
config hashes, mounts, networks, and first-party OCI labels with
`production-release.md`. After deployment, the running first-party revision
must equal the approved commit. Rollback restores recorded prior image IDs and
prior validated Compose/Caddy configuration; never rebuild rollback from a
moving tag.
