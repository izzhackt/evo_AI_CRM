# P8D4 Current-Main Staff Pilot Contract

Date: 2026-08-15
Issue: #213
Status: planning gate; no production mutation until this contract is
independently reviewed, merged, and exact-main CI is green

## Outcome

Build a fresh immutable `linux/amd64` candidate from the first reviewed current
`main` containing knowledge blocks K2 through K4, deploy CRM, EVO Inbox, and EVO
Lead Agent one boundary at a time on Hermes, apply only missing reviewed forward
migrations, independently atomically publish both approved Obsidian knowledge
audiences, and
prove the authenticated staff-only assistant and client playground with real
Gemini drafts.

This block stops before a WhatsApp message, autonomous reply, amoCRM mutation,
WAHA session/webhook change, DNS change, or customer-content provider request.

## Prerequisite identities

- K3 merged commit: `7a0bdb665836ed55c56d4f1af6044a45518b91a8`.
- Required candidate source: `472cc58115b7e6a459d089fd082081fa8da15610`.
- Required candidate tree: `afadf3248ff696c0cf70388cfe06a9b5a8eebc22`.
- Required candidate parent: `7a0bdb665836ed55c56d4f1af6044a45518b91a8`.
- Required exact-main CI run: `31897719155`, completed success.
- Required migration range: contiguous `001-075`.
- Target platform: exact `linux/amd64`, empty variant.
- Build runtime: local OrbStack only after `orb status` is `Running` and
  `docker context show` is exactly `orbstack`.
- Deployment host: `hermes-vps`, reverified as `x86_64` immediately before
  transfer and before each container recreation.

The frozen pre-knowledge P8B3 images remain retained rollback/history evidence.
They are not deployed or relabelled because they predate migrations 073–075 and
the K3/K4 runtime.

The executed P8D3 roots remain present and verified at
`/opt/evo-releases/0505143657858e710acdd5029f1cc77c5524083e/2026-08-15.p8d3.1`,
`/opt/evo-release-evidence/0505143657858e710acdd5029f1cc77c5524083e/2026-08-15.p8d3.1`,
and `/opt/evo-release-rollback/2026-08-15.p8d3.1`. They are immutable historical
evidence only; the fresh P8D4 build/transfer makes them unnecessary as a runtime
prerequisite. Their absence or mutation is nevertheless recorded and reviewed.

## Authorized external effects

The owner's 2026-08-15 instruction authorizes only the following effects after
the contract gate passes:

1. real local OrbStack `linux/amd64` builds, local image/SBOM evidence, and
   collision-free transfer of the exact candidate archives to Hermes;
2. new root-only release, rollback, and redacted evidence directories on
   Hermes;
3. a production migration dry-run and application of only the missing reviewed
   forward migrations in the frozen contiguous range; never reset, repair,
   seed, or edit migration history;
4. a bounded set of real Gemini embedding calls over the exact approved
   client/internal EVO knowledge chunks only, followed by one independent
   atomic managed-bundle sync per audience;
5. one container recreation at a time for CRM, EVO Inbox, and EVO Lead Agent;
6. one authenticated staff-owned internal-assistant draft and one authenticated
   staff-owned client-playground draft using non-customer test questions and the
   real production retrieval/provider path.

No other provider or production mutation is implied. In particular: no WAHA
session or webhook update, QR action, WhatsApp send, amoCRM read/write, DNS
change, autonomous reply, customer transcript upload, or customer-content
Gemini call.

## Mandatory disabled state

Before and after every application recreation, retain the closed disabled
matrix from P8D:

- CRM: WAHA ingress/worker/history/media, amoCRM read, AI memory, Gemini
  proposals, autonomous replies, P6A/P6B/P6C and P7A flags remain `0`;
- CRM: autonomous-replies kill switch remains `1`;
- CRM and Inbox: P7B observability remains `1` with distinct process-only
  secrets already held on Hermes;
- Lead Agent: `EVO_AGENT_AUTOREPLY_ENABLED=false` and
  `EVO_AGENT_GEMINI_MODEL=gemini-3.5-flash`;
- K4 adds no runtime activation switch. Its routes require an authenticated
  account agent and the existing active encrypted AI configuration.

Secrets remain only in existing root-owned mode-`0600` Hermes env files,
managed Supabase encrypted settings, or process memory. Evidence records names,
presence, mode and hashes only; it never records values, URLs, tokens, prompts,
responses, knowledge bodies, or customer/provider identifiers.

## Phase A — fresh immutable candidate

1. Create a clean detached source worktree at the frozen K4 merged-main commit.
   Require clean status, exact parent/tree identity, the frozen exact-main green
   run, and no open conflicting release PR.
2. Use the reviewed P8B2/P8B3 build and portable-identity tooling with exact
   build tags suffixed `472cc58115b7e6a459d089fd082081fa8da15610-linux-amd64`;
   refuse every pre-existing target tag and output path.
3. Build CRM, Inbox, and Lead Agent with real Buildx
   `--platform linux/amd64 --load`. Record real exit status and BuildKit metadata;
   a stale image can never satisfy a failed build.
4. Inspect each image and require exact platform, empty variant, frozen OCI
   revision/source labels, and distinct image identities.
5. Generate fresh SPDX-JSON SBOMs and network-none real liveness smoke evidence
   for every exact image. Apply the existing closed privacy scanner and schema
   validators. Retain the ignored evidence directory mode `0700` and every file
   mode `0600`.
6. Save each exact tag to a new portable archive, derive and verify its complete
   OCI graph, and write a closed collection index. Hash every retained artifact.

The builder output is exactly
`.evo-release-evidence/p8b2-input-472cc58115b7e6a459d089fd082081fa8da15610-linux-amd64/`.
After validation, install only its closed indexed files into
`.evo-release-evidence/p8d4-472cc58115b7e6a459d089fd082081fa8da15610-reviewed/`.
Its three archives are exactly
`evo-crm-472cc58115b7e6a459d089fd082081fa8da15610-linux-amd64.tar`,
`evo-inbox-472cc58115b7e6a459d089fd082081fa8da15610-linux-amd64.tar`, and
`evo-lead-agent-472cc58115b7e6a459d089fd082081fa8da15610-linux-amd64.tar`.

## Phase B — Hermes preflight, rollback, and transfer

Immediately before mutation, re-read and record only safe metadata:

- exact current main/candidate identities and CI;
- Hermes architecture, disk, Docker/Compose versions, edge/network ownership;
- CRM, Lead Agent, Inbox, CRM WAHA, and Inbox WAHA exact image IDs, health,
  restart counts and start times;
- exact env-file regular/non-symlink/root-owned/`0600` preconditions;
- managed Supabase project identity and migration ledger through read-only
  management/database credentials;
- release, rollback, evidence and incoming destination absence.

Use exact release ID `2026-08-15.p8d4.1` and roots
`/opt/evo-releases/472cc58115b7e6a459d089fd082081fa8da15610/2026-08-15.p8d4.1`,
`/opt/evo-release-rollback/2026-08-15.p8d4.1`, and
`/opt/evo-release-evidence/472cc58115b7e6a459d089fd082081fa8da15610/2026-08-15.p8d4.1`.
All must be absent before execution. Copy the three exact current
production image archives and the exact three env files into the rollback-secret
root using explicit paths and mode `0600`; evidence retains only fixed labels,
hashes and success state. Transfer the new candidate archives/indexes through
explicit absent incoming paths, require local/remote byte hashes, load without
retagging, and require the exact build-tag-to-image/platform/revision mapping.
Then require the unsuffixed Compose tags to be absent, add only the three exact
unsuffixed `evo-crm`, `evo-inbox`, and `evo-lead-agent` commit tags to those same
image IDs, and re-inspect both tag forms before Compose use.

Rollback env destinations are exactly `crm.env.production`,
`lead-agent.env.production`, and `inbox.env.production`; rollback image archives
are exactly `prior-crm.tar`, `prior-lead-agent.tar`, and `prior-inbox.tar`.

The pre-deploy Compose rollback inputs are also closed. Their source paths must
still be root-owned regular non-symlink files at execution time; any drift stops
the release. Copy them with `install -o root -g root -m 0600` into the rollback
root before any migration, tag, or container mutation:

| Boundary | Exact current source | Rollback destination |
| --- | --- | --- |
| CRM | `/opt/evo-releases/564332b420a1fb1bd6232dda945d044bb922d3f0/repo/docker-compose.prod.yml` | `crm.compose.yml` |
| Inbox | `/opt/evo-releases/a09a72fc55d869c861df520f76d62413a2315fc1/repo/agent-lead2-inbox/deploy/docker-compose.inbox.prod.yml` | `inbox.compose.yml` |
| Lead Agent | `/opt/evo-releases/b2303eccb78b7c102ec702e9821f765f6dfaba88/repo/docker-compose.prod.yml` | `lead-agent.compose.yml` |

Record the current three application image IDs and exact Compose revision
values without printing env contents. After saving and hashing the three prior
archives, prove each can map back to its recorded prior revision tag. The
rollback order is Lead Agent, CRM, then Inbox. For each boundary, load its
retained archive, atomically restore its env file, restore the recorded prior
revision tag only when absent or already mapped to the same image ID, and run
the retained Compose file with the recorded revision, project, and service.
Stop on tag collision. Reinspect all five exact containers and require healthy
state and unchanged restart counts after the complete unwind. No current
checkout or discovered Compose file may be used during rollback.

The release root contains an exact clean Git archive in `repo/`. Deployment is
closed to these commands and env sources; no glob or discovered Compose file is
accepted:

| Boundary | Compose project/file/service | Exact env source |
| --- | --- | --- |
| Inbox | `evo-inbox`; `repo/agent-lead2-inbox/deploy/docker-compose.inbox.prod.yml`; `app` | `/opt/evo-inbox/agent-lead2-crmwhatsapp/.env.production` |
| CRM | `evo-crm`; `repo/docker-compose.prod.yml`; `app` | `/opt/evo-crm/.env.production` |
| Lead Agent | `evo-crm`; `repo/docker-compose.prod.yml`; `lead-agent` | `/opt/evo-crm/.env.lead-agent` |

Each exact env source must be a root-owned regular non-symlink mode-`0600`
file. With `EVO_RELEASE_REVISION` set to the frozen full commit, run only
`docker compose -p <project> -f <file> up -d --no-deps <service>`. The execution
amendment records the three pre-deploy Compose working directories, revisions,
images and archive hashes. If a later boundary fails, roll back every already
deployed P8D4 boundary in reverse order using those exact retained Compose
files/revisions and verify the complete five-container safe state. Migrations
075 and earlier are additive and forward-only; the real compatibility gate must
prove the three retained old application images remain healthy against schema
001-075 before execution. Database history is never rolled back.

## Phase C — managed Supabase migrations

Use the approved EVO Platform production project only. Obtain the exact ledger
with database credentials; service-role REST is not accepted as migration-ledger
proof. Run `supabase db push --dry-run` or the reviewed equivalent first. The
only acceptable result is:

- the frozen range is already complete, producing a verified no-op; or
- only the frozen missing sequential migrations are listed in order.

Apply only that reviewed missing sequence once. Never use `db reset --linked`,
`migration repair`, `--include-seed`, Dashboard SQL, or direct manual edits.
Re-read the ledger and require the exact frozen contiguous range before any app
recreation or knowledge import.

The CLI is the lockfile-installed Supabase CLI `2.110.0`, executed from the
exact candidate source root. The target must first resolve through the
Management API to project ref `iosckaqtovbbnssqcpde`; the database URL and
password remain process-only. Exact commands are
`./node_modules/.bin/supabase db push --db-url "$EVO_PLATFORM_DB_URL" --dry-run`
and, only after the dry-run artifact lists exactly missing `073`, `074`, `075`
in order (or their missing suffix), the same command without `--dry-run`.
Stdout is reduced to migration identifiers/status before it enters the mode
`0600` evidence file; connection material is never logged.

## Phase D — real approved knowledge publication

1. Build fresh deterministic bundles from the two exact marked Obsidian roots
   using the merged K3 builder. Reject any dirty vault drift, symlink, visible
   non-Markdown file, invalid marker/provenance, raw/secret path, PII/contact
   pattern, invalid UTF-8, or non-deterministic second build.
   The roots are exactly
   `/Users/iskhak.tazhibaev/Documents/01_Projects/EVO_Знания/Клиентская база знаний ЭВО`
   and
   `/Users/iskhak.tazhibaev/Documents/01_Projects/EVO_Знания/Внутренняя база знаний ЭВО/Утверждено для внутреннего ИИ`.
   The reviewed inventory is 10 client documents and 286 internal documents;
   any drift stops before a provider call.
2. Require the final client and internal bundle/manifests to match their
   independently repeated byte hashes. Bundles remain local mode `0600`, are
   never committed, and use the merged K5 contract's exact ephemeral
   SSH-to-Hermes, `docker cp`, importer re-verification and cleanup path.
3. Resolve the exact production account through an approved server-side
   identifier without printing it: a service-role query must return exactly one
   account row for the existing active encrypted Gemini configuration, and its
   UUID is passed process-only as `EVO_KNOWLEDGE_ACCOUNT_ID`. Use that existing
   active Gemini configuration
   and credential to compute real embeddings for approved business knowledge
   only. No customer text is permitted.
4. Invoke one service-role-only transactional sync per audience. A provider,
   validation, or SQL failure must leave the prior audience unchanged.
   Inside the exact Inbox app container run only
   `npm run knowledge:import -- --audience <client|internal> --bundle <exact> --manifest <exact> --account-id "$EVO_KNOWLEDGE_ACCOUNT_ID"`
   after the merged K5 transfer and hash checks; no alternate importer exists.
5. Re-read only safe counts/revisions/hashes and prove that client retrieval
   returns only `client` chunks and internal retrieval only `internal` chunks.
   Run the frozen Russian retrieval cases through the real production RPC.
   If the second audience fails after the first commits, record a truthful safe
   partial publication and retry only the failed audience with the same
   byte-identical bundle. Deployment cannot begin until both revisions verify.

## Phase E — one-boundary-at-a-time deployment

Recreate only these application containers, in this order:

1. `evo-inbox-app-1`;
2. `evo-crm-app-1`;
3. `evo-crm-lead-agent-1`.

WAHA and Caddy are never recreated or reloaded. After each boundary require:
exact image identity, healthy status, restart count `0`, expected private/public
network attachments, the mandatory disabled matrix, private readiness, and the
existing public non-customer liveness route. Any failure rolls back that
boundary and every earlier P8D4 boundary in reverse order, then stops.

## Phase F — staff-only real pilot

Using an existing authorized staff account and no customer conversation:

1. call the K4 internal assistant with one fixed Russian internal-process
   question and require a real Gemini draft plus one or more `internal` source
   note identities;
2. call the client playground with one fixed Russian admissions question and
   require a real Gemini draft plus one or more `client` source identities;
3. prove the immutable audit contains only fixed provider/retrieval metadata,
   source/chunk identities and hashes—never query text, draft text, raw knowledge
   content, phone, email or customer identifiers;
4. repeat audience-isolation denial checks and confirm no WhatsApp/WAHA send,
   amoCRM mutation, autonomous intent or customer-data event was created.

The embedding phase may make exactly one request per frozen chunk using the
configured embedding model, with no retry or fallback. The pilot then makes
exactly two GenerateContent requests. These bounded embedding requests and two
draft requests are the only provider content calls authorized in P8D4.
Use exact authenticated `POST /api/ai/internal-assistant` case
`internal_malaysia_handoff` and `POST /api/ai/playground` case
`client_china_documents`, with the committed questions in
`scripts/knowledge_ingestion/platform_eval_cases.json`. The principal is an
existing active production `admin`; evidence records only role/status and a
one-way actor hash, never identity or credentials.

## Evidence and completion

Write a closed `p8d4-result.json` validated against
`docs/schemas/p8d4-result.schema.json`, plus SHA-256, under the new
redacted evidence root using mode-`0600` temporary files and atomic rename. It
records exact source/tree/CI, migration ledger before/after, image and rollback
image/env/Compose hashes, safe bundle revisions/counts, fixed test IDs/results,
ordered container health before/after, and a fixed result code. It contains no arbitrary logs or secret,
prompt, response, knowledge, provider or customer values.

`pilot_verified` requires every phase and invariant above. Other exact codes are
`preflight_blocked`, `build_failed`, `migration_failed`, `knowledge_failed`,
`deployment_failed`, `pilot_failed`, and `rollback_failed`. Failure branches
permit truthful partial arrays and stop. Completion also requires independent
review of the exact evidence, current-main CI, a clean repo, and no open P8D4
PR. The next real WhatsApp/amoCRM lead test is a separate block requiring fresh
owner approval.

## Stop conditions

Stop and preserve the healthy prior state on any identity/hash/tree/CI drift,
missing credential, unsafe bundle content, migration mismatch, non-sequential
dry-run, provider error, evidence collision, wrong platform, image/config drift,
health/restart regression, rollback loss, audience leak, audit body leak,
unexpected outbound request, need for a mock/fallback, or any action outside the
explicit authorization above.

## Validation gate

Before execution, the final exact contract and its append-only plan decision
must pass `git diff --check`, relevant Node/Python/SQL tests, schema validation,
root and Inbox lint/typecheck/build, all required GitHub CI at exact head, an
independent launch-control review, merge, and exact-main green CI. Runtime claims
must then come only from the real OrbStack, managed Supabase, Gemini, and Hermes
paths described above.
