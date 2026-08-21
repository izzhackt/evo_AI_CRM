# P8V3 Simpler Server Path

Date: 2026-08-21

## Question

After `P8V3J` still failed during knowledge import, what is the simplest real production path that keeps the system honest and makes it work on the server without the current importer-specific rollout ceremony?

## Verified Repo Facts

- The production CRM app service already defines the runtime we want to trust in production: image/build, env file, volumes, and the `evo_crm_private` plus `evo_public_web` networks. Source: [docker-compose.prod.yml](../../docker-compose.prod.yml)
- The current rollout path does **not** use that service definition directly for knowledge import. It uses a special importer container path with explicit importer identity checks. Source: [scripts/p8v3-production-operations.mjs](../../scripts/p8v3-production-operations.mjs), [tests/p8v3-rollout.test.mjs](../../tests/p8v3-rollout.test.mjs)
- The current preflight also hard-codes importer-network evidence, including DNS `127.0.0.11`, as a separate gate. Source: [scripts/p8v3-preflight.mjs](../../scripts/p8v3-preflight.mjs), [tests/p8v3-rollout.test.mjs](../../tests/p8v3-rollout.test.mjs)
- Knowledge retrieval already supports three explicit modes in product code: `keyword`, `gemini`, and `openai`. Source: [agent-lead2-inbox/src/lib/ai/types.ts](../../agent-lead2-inbox/src/lib/ai/types.ts), [supabase/migrations/035_ai_embeddings_provider_and_scale.sql](../../supabase/migrations/035_ai_embeddings_provider_and_scale.sql)
- The code already treats `keyword` as a first-class no-provider path: when `embeddingsProvider === 'keyword'` or no embeddings key exists, semantic embedding is skipped and lexical retrieval is used. Source: [agent-lead2-inbox/src/lib/ai/knowledge.ts](../../agent-lead2-inbox/src/lib/ai/knowledge.ts)
- The schema was intentionally designed so lexical retrieval works with zero extra provider setup, while semantic embeddings are optional. Source: [supabase/migrations/030_ai_knowledge.sql](../../supabase/migrations/030_ai_knowledge.sql)
- The FTS retrieval RPC already exists and uses PostgreSQL text search over the stored chunk `fts` field. Source: [supabase/migrations/030_ai_knowledge.sql](../../supabase/migrations/030_ai_knowledge.sql)
- The current P8V3 knowledge importer embeds **all** chunk texts before a single `sync_ai_knowledge_bundle` RPC. Source: [src/lib/server/platform-knowledge-bundle.ts](../../src/lib/server/platform-knowledge-bundle.ts)
- The atomic sync property is explicit: the importer completes embeddings first, then performs one atomic `sync_ai_knowledge_bundle` call, so a failed embedding sequence cannot leave a partially imported audience. Source: [docs/PLAN_CHANGES.md](../../docs/PLAN_CHANGES.md), [supabase/migrations/074_ai_knowledge_managed_bundle_sync.sql](../../supabase/migrations/074_ai_knowledge_managed_bundle_sync.sql)
- The Gemini-only seed path is still narrower than the product model itself. `seed-prod-ai-config.mjs` requires `EVO_INBOX_AI_PROVIDER=gemini`, but allows `EVO_INBOX_EMBEDDINGS_PROVIDER=keyword` or `gemini`. Source: [agent-lead2-inbox/scripts/seed-prod-ai-config.mjs](../../agent-lead2-inbox/scripts/seed-prod-ai-config.mjs)
- Current EVO Inbox production proof docs still frame `gemini` as the first-proof path and mention `keyword` only as a deliberate lexical fallback proof. Source: [agent-lead2-inbox/docs/production-proof-checklist.md](../../agent-lead2-inbox/docs/production-proof-checklist.md), [agent-lead2-inbox/docs/hermes-vps-deployment.md](../../agent-lead2-inbox/docs/hermes-vps-deployment.md)

## Verified External Facts

- `docker compose run` starts a one-off command in a **new** container using the configuration defined by the service, including volumes and other service details, while overriding the command. Official Docker docs: https://docs.docker.com/reference/cli/docker/compose/run/
- Compose service networking is defined by the service `networks` attribute. Official Docker docs: https://docs.docker.com/reference/compose-file/services/
- Docker networking behavior is materially different between the default bridge and user-defined networks:
  - containers on the default bridge use a copy of the host `/etc/resolv.conf`
  - containers on a custom network use Docker's embedded DNS server at `127.0.0.11`
  Official Docker docs: https://docs.docker.com/engine/network/
- `docker exec` runs a command in an already running container only while its main process is alive. Official Docker docs: https://docs.docker.com/reference/cli/docker/container/exec/
- PostgreSQL full text search is a real search system, not a hacky substring filter. It identifies natural-language documents satisfying a query and can rank them by relevance. Official PostgreSQL docs: https://www.postgresql.org/docs/current/textsearch-intro.html
- PostgreSQL text search uses `tsvector` for preprocessed documents and `tsquery` for queries. Official PostgreSQL docs: https://www.postgresql.org/docs/current/textsearch-intro.html
- The base retrieval table allows rows without embeddings, but the current managed P8V3 import path does not: it embeds every chunk before the RPC, and `sync_ai_knowledge_bundle` requires an exact 1536-number `embedding` array for every chunk. Google documents `gemini-embedding-2` and its configurable output dimensionality; the repo pins it to 1536 dimensions. Official Google docs: https://ai.google.dev/gemini-api/docs/embeddings

## Option Comparison

| Option | What it means | Main upside | Main downside | Recommendation |
| --- | --- | --- | --- | --- |
| A. Keep current special importer path | Continue with the dedicated importer container, importer packaging, importer preflight, importer DNS proof | Preserves the already-reviewed rollout contract | Every environment fact about that special path costs a full release cycle | Not the simplest path |
| B. One-off import via Compose service definition | Add a dedicated one-off import command/service that reuses the CRM app service config and networks via `docker compose run --rm --no-deps ...` | Best balance of reproducibility and simplicity; keeps network/env parity with production service definition | Still a new container, so not zero change | Best server-side semantic path |
| C. Run import inside the already-running app container | Use `docker compose exec` or `docker exec` against the live app container | Maximal network parity with the live service | Less reproducible, couples operational import to a mutable live container session | Acceptable emergency path, not the preferred steady-state path |
| D. Run host-side Node process as root | Execute the import from the server host using host Node/env/secrets | No container creation issues | Wrong runtime boundary, more drift, weaker secret/process isolation, harder to prove parity | Do not use |
| E. Skip semantic embeddings for now, use `keyword` retrieval | Add a separate lexical-only managed import path, then rely on PostgreSQL FTS | Removes provider calls from knowledge retrieval after that change | Not a configuration-only switch: the current managed importer/RPC requires an embedding for every chunk, so this needs code, SQL, tests, and a migration/review cycle | Valid later simplification, not the smallest correction now |

## What “Simpler” Should Mean Here

The simplest path is not “whatever bypasses Docker.” The simplest path is:

1. reuse the same runtime definition that already serves production traffic;
2. avoid a special importer-only network/runtime whenever possible;
3. avoid hidden fallbacks;
4. keep rollback straightforward;
5. minimize new moving parts between the app and the provider.

By those criteria:

- Option `B` is the smallest change that preserves the already agreed full v1 behavior.
- Option `E` is a valid product simplification only if the owner deliberately accepts lexical-only retrieval and a new importer/SQL change.

## Recommended Decision

### Recommended now: preserve the full v1 behavior

Choose `B`: replace the current special importer lifecycle with a Compose-defined one-off import job that uses the same service-level config as the CRM app.

Why:

- Docker officially guarantees `docker compose run` uses the service configuration.
- That means fewer custom rollout assumptions around env, volumes, and networks.
- It removes the separately assembled long-lived helper container, its copy/start/exec lifecycle, and its independent network construction.

The existing candidate CRM image cannot supply the importer code by itself. It
is built from application commit `0f1454d014bbc9eca9d7381dfe557e980965543e`,
while the reviewed retry, bounded-429 and safe-diagnostic importer corrections
landed later. The one-off Compose job must therefore bind-mount the separately
built current importer artifact read-only and retain its deterministic
SHA-256/size proof. “Compose-native” simplifies execution; it does not authorize
running stale code baked into the candidate image.

Practical shape:

- Reuse the existing `app` service and its exact production Compose file
- Bind-mount the current deterministic importer, bundle and manifest read-only
- Forbid build/pull and dependency startup
- Invoke it with `docker compose run --rm --no-deps --pull never ...`

This is still a controlled one-off process, but it is aligned to the production service contract rather than a bespoke sidecar path.

### Optional later simplification: lexical-only retrieval

`keyword` is a real supported retrieval mode, and PostgreSQL FTS already exists. However, the current P8V3 managed importer and RPC require embeddings for every imported chunk. A keyword-first launch therefore needs a deliberately reviewed lexical-only import branch (and likely an RPC/schema-contract adjustment); it is not a one-click setting change in the current release.

## What Not To Call “Simpler”

- Host-side root Node execution is not simpler in a production engineering sense. It trades one explicit container contract for uncontrolled host drift.
- Reaching into the live app container with `docker exec` is simpler only as a short-term rescue action. It is not the cleanest long-term release path because the command depends on the current mutable running container state.

## Bottom Line

There are two honest alternatives, but only one is the smallest correction now:

1. `Recommended now`: replace the special importer runtime with a Compose-defined one-off service/job based on the production app service definition.
2. `Optional scope change`: add a true lexical-only managed import path and then switch production retrieval to `keyword`.

If the only question is “what gets us to a real working server fastest with the least operational friction,” the answer is:

- keep the current full-v1 semantics;
- run the current separately verified importer through the existing production Compose service contract rather than the bespoke importer-container lifecycle.
