# EVO production-successor runtime hardening

This is the #551 target V3 runtime contract for root
`docker-compose.prod.yml` and the isolated loopback OrbStack proof profile.
EVO has no target staging environment. #551 removes the exact repository
staging contour below; #552 separately inventories and retires any matching
remote contour before it can arm production. This document does not authorize
a deployment. The
superseded V1/companion record is retained at
[`docs/archive/v1/runtime-hardening.md`](../docs/archive/v1/runtime-hardening.md).

## Exact staging-retirement inventory

#551 must first capture a read-only path/reference map, then delete these four
active staging artifacts rather than leave aliases or disabled fallbacks:

- `docker-compose.staging.yml`;
- `deploy/env.staging.example`;
- `scripts/evo-release-environment-profile.mjs`; and
- `tests/release-environment-profile.test.mjs`.

#551 must remove only release-environment staging branches, inputs, imports,
configuration and assertions from these active files:

- `scripts/evo-app-env-contract.mjs`;
- `scripts/evo-fast-release.sh`;
- `scripts/platform-provider-runtime-inventory.mjs`;
- `scripts/test-p6d-release-candidate-orbstack.mjs`;
- `scripts/validate-runtime-hardening.mjs`;
- `tests/app-env-contract.test.mjs`;
- `tests/fast-release-control.test.mjs`;
- `tests/p6d-release-candidate.test.mjs`;
- `tests/platform-runtime-public-config.test.mjs`;
- `tests/runtime-hardening.test.mjs`;
- `evo-lead-agent/tests/test_config.py` — release-staging assertions removed; and
- `package.json`.

The new two-job release workflow also removes its `staging` Environment/input/
job path. The active `staging-crm.72.62.119.112.sslip.io` route is removed from
the legacy `agent-lead2-inbox/deploy/Caddyfile.evo-edge`. `deploy/README.md` and
root `CONTEXT.md` describe only the no-staging V3 authority; the superseded
staging runbooks are copied to historical-only
`docs/archive/v2/staging-release.md` and
`docs/archive/v2/u11-staging-recovery.md` before the active
`docs/runbooks/u11-staging-recovery.md` file and every active link to it are
removed.
Existing V1/V2 ADRs, migrations, runbooks, archived docs, evidence, Git history
and other historical decision/rollback documentation remain unchanged and
non-executable.

This inventory uses "staging" only for the obsolete deploy environment. The old
`EVO_RELEASE_STAGING_ROOT` name describes a private transient artifact-transfer
directory; #551 renames that function to `EVO_RELEASE_TRANSFER_ROOT` and keeps
its containment/cleanup safeguards, not a deploy environment. In
`tests/platform-runtime-public-config.test.mjs`, #551 removes the staging-named
deployment fixture and `deploy/env.staging.example` dependency but preserves the
same cache/config-isolation outcome under neutral distinct-config names. The
PII-free university catalog import staging rows in
`platform.catalog_import_candidates` are a business concept and remain.

Before setting `EVO_PRODUCTION_RELEASE_ARMED=true`, #552 performs a read-only
Hermes/GitHub/Supabase/repository inventory for the staging hostname/Caddy
route, `/opt/evo-crm-staging`, Compose project and containers labelled
`evo-crm-staging`, staging-owned networks/volumes, GitHub `staging`
Environment and staging-only variables/secrets, the managed Supabase staging
branch/project recorded as `evo-v1-staging`, and the active
`docs/runbooks/u11-staging-recovery.md` path plus every active link to it. The
Supabase inventory must resolve the exact organization and 20-character
project ref, prove that it differs from the production ref, and prove from
database/Auth/Storage counts and retained backup identity that it is the
staging-only, data-less contour covered by the owner's recorded retirement
authorization. A friendly name is never deletion authority. Any identity,
ownership, content, billing-shape or authorization ambiguity stops for a new
exact owner decision.

Only after those checks may #552 retire that exact managed staging
branch/project together with the exact inventoried Hermes/GitHub contour; #551
first copies the active runbook to
`docs/archive/v2/u11-staging-recovery.md` and removes its executable path and
active links. Sanitized hashes, topology and the archived runbooks remain
historical evidence. A second independent read-only inventory must prove that
the hostname/route, root, containers, Compose project, networks, volumes,
GitHub Environment/config, exact Supabase staging ref and active runbook/links
no longer exist or route traffic. Production `evo-crm`, `crm_primary`, the
production Supabase ref/data, `evo_public_web`, production volumes and frozen
history are never deletion targets. Any surviving or unverified staging
component keeps the arm disabled.

## Runtime and readiness

- `app` and private `waha` are the only Compose services.
- `app` runs read-only with bounded CPU, memory, PIDs and JSON logs; only its
  generated-output volume and declared tmpfs paths are writable.
- `waha` has bounded CPU, memory, PIDs and logs, stores session material only in
  `evo_crm_waha_sessions`, and joins only `evo_crm_private`.
- Isolated candidate and recovery proofs bind only to loopback, use distinct
  project/network/volume identities, and never mount the production WAHA
  session volume or become a persistent environment.
- `/api/health` is app process liveness and does not call Supabase or a provider.
- WAHA `/ping` is process liveness, not proof that `crm_primary` is connected or
  that a message can be sent.
- `/api/readiness` is private, HMAC-authenticated Supabase readiness when
  `EVO_PLATFORM_P7B_OBSERVABILITY_ENABLED=1`; disabled or invalidly signed
  requests return `404`, and dependency failure returns `503`.

A green container is not proof of Supabase Auth/RLS/Storage, WhatsApp delivery,
amoCRM, Gemini, or a customer workflow. Those require their named real-service
acceptance gates.

## Privacy and failure behavior

- Never publish the WAHA port or dashboard. Operator access uses a private
  server-side path.
- Never log query strings, bodies, cookies, authorization headers, Supabase or
  WAHA keys, customer content, phone numbers, session data, or provider payloads.
- Correlation logs contain a safe request ID, method, route template, status
  class, and elapsed time only.
- Missing or invalid Supabase configuration must fail closed. No SQLite,
  Drizzle, fixtures, companion Inbox, Lead Agent, old webhook or manual worker
  may become a fallback. A frozen V1 app is eligible only as #552's exact,
  state-bound rollback to the real pre-change app before V3 acceptance; it may
  not run beside V3, and its wrapper refuses execution after acceptance.
- Canonical documents use private Supabase Storage. The app output volume is not
  a business-data backup or alternate file authority.
- Production document finalization and download fail closed unless the one real
  scanner returns a valid clean result. Detected, unavailable, timeout and
  malformed outcomes remain quarantined/denied until a successful rescan;
  `scanner_proof=false` is local checksum evidence only.

## Runtime verification

At an exact candidate head, verify:

1. Compose resolves exactly `app` and `waha` and no host port exists for WAHA;
2. the app image labels match the exact commit and immutable release version;
3. WAHA resolves to its reviewed immutable digest;
4. both healthchecks pass within the declared timeout;
5. `app` is on private and web networks while `waha` is private-only;
6. read-only filesystems, resource ceilings, bounded logs, tmpfs paths and named
   volumes match the checked-in Compose contract;
7. stopping or misconfiguring the primary Supabase path produces a clear error,
   not fallback behavior;
8. the real document-scanner path proves clean, detected, unavailable, timeout,
   malformed and recovery/rescan outcomes without customer files; and
9. every release remains pending until the exact deploy-job acceptance step
   binds image/revision/digests plus internal/public health and authenticated V3
   browser proof, while every rollback wrapper rejects a changed current image
   or a newer/superseding release.

For a production release, the secretless build and fresh deploy jobs separately
enforce current-main, CI, arm, actor and immutable-artifact identity. The deploy
job repeats those checks plus the ledger immediately before first SSH. The
read-only live inventory then permits only a genuinely absent app, the exact
frozen V1 identity approved by #552, or an exact V3 matching the protected
current-accepted record. A pending candidate blocks another release. Missing or
unrecognized source/revision/version labels, image/artifact identity,
accepted/pending state or retained-file hashes stop before replacement.

Use `npm run test:p6d` for the focused contract/inventory checks and one
`npm run test:p6d:orbstack` execution for the final real disposable Supabase +
app/private-WAHA runtime proof. Never mount the production WAHA session volume
or call a live provider from that test.

## Operational response

| Signal | Initial owner | Required response |
| --- | --- | --- |
| app or WAHA unhealthy/restarting | EVO server operator | inspect sanitized bounded logs, resource/OOM state and exact release evidence |
| private readiness `503` | Supabase/application owner | verify project status, migration ledger and secret binding without exposing values |
| WAHA session disconnected | WhatsApp operator | preserve the volume; use the separately authorized private session procedure |
| pending release regression or interruption | release operator | use only that candidate's wrapper to restore its exact recorded prior absent/V1/accepted-V3 state; leave unresolved pending blocked; never run V1 beside V3 or change Supabase/WAHA state |
| accepted current V3 regression | release operator | only the current release's wrapper may restore its exact prior accepted V3 after proving the running candidate and absence of a superseding release; absent/V1/older wrappers refuse |
| provider proof unavailable | product owner | schedule the explicit provider acceptance gate; do not infer success from health |

No repository check, local candidate, or CI job is a production alerting system.

## Official runtime references

- Docker Compose `config` service/image projections:
  <https://docs.docker.com/reference/cli/docker/compose/config/>
- Docker Compose `up --wait` health behavior:
  <https://docs.docker.com/reference/cli/docker/compose/up/>
- Compose health, read-only, resource, network and logging service fields:
  <https://docs.docker.com/reference/compose-file/services/>
