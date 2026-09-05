# EVO production-successor runtime hardening

This is the active V3 runtime contract for root `docker-compose.prod.yml`.
It does not authorize a deployment. The
superseded V1/companion record is retained at
[`docs/archive/v1/runtime-hardening.md`](../docs/archive/v1/runtime-hardening.md).

## Runtime and readiness

- `app` and private `waha` are the only Compose services.
- `app` runs read-only with bounded CPU, memory, PIDs and JSON logs; only its
  generated-output volume and declared tmpfs paths are writable.
- `waha` has bounded CPU, memory, PIDs and logs, stores session material only in
  `evo_crm_waha_sessions`, and joins only `evo_crm_private`.
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
  Drizzle, fixtures, companion Inbox, Lead Agent, old webhook, manual worker, or
  V1 runtime may become a fallback.
- Canonical documents use private Supabase Storage. The app output volume is not
  a business-data backup or alternate file authority.

## Runtime verification

At an exact candidate head, verify:

1. Compose resolves exactly `app` and `waha` and no host port exists for WAHA;
2. the app image labels match the exact commit and immutable release version;
3. WAHA resolves to its reviewed immutable digest;
4. both healthchecks pass within the declared timeout;
5. `app` is on private and web networks while `waha` is private-only;
6. read-only filesystems, resource ceilings, bounded logs, tmpfs paths and named
   volumes match the checked-in Compose contract; and
7. stopping or misconfiguring the primary Supabase path produces a clear error,
   not fallback behavior.

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
| release regression | release operator | restore the recorded exact app image; do not start V1 or change Supabase/WAHA state |
| provider proof unavailable | product owner | schedule the explicit provider acceptance gate; do not infer success from health |

No repository check, local candidate, or CI job is a production alerting system.

## Official runtime references

- Docker Compose `config` service/image projections:
  <https://docs.docker.com/reference/cli/docker/compose/config/>
- Docker Compose `up --wait` health behavior:
  <https://docs.docker.com/reference/cli/docker/compose/up/>
- Compose health, read-only, resource, network and logging service fields:
  <https://docs.docker.com/reference/compose-file/services/>
