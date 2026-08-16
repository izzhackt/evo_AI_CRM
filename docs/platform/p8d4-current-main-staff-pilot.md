# P8D4 Current-Main Staff Pilot Contract

Date: 2026-08-16
Issues: #213, #219
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
- Required candidate source: `d5657acc6c1df1abc790a96778ca71df36687b24`.
- Required candidate tree: `9dfe44fd1c477a9a4af823ba2a37bdb398878919`.
- Required candidate parent: `a05e22b42e31b441ebc5f2274deddab4f3022317`.
- Required exact-main CI run: `31902903078`.
- Required migration range: contiguous `001-076`.
- Target platform: exact `linux/amd64`, empty variant.
- Build runtime: local OrbStack only after `orb status` is `Running` and
  `docker context show` is exactly `orbstack`.
- Deployment host: `hermes-vps`, reverified as `x86_64` immediately before
  transfer and before each container recreation.

The frozen pre-knowledge P8B3 images remain retained rollback/history evidence.
They are not deployed or relabelled because they predate migrations 073–076 and
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

1. Create a clean detached source worktree at the frozen current-main commit,
   including PR #216's supervised consultative Lead Agent policy.
   Require clean status, exact parent/tree identity, the frozen exact-main green
   run, and no open conflicting release PR.
2. Use the reviewed P8B2/P8B3 build and portable-identity tooling with exact
   build tags suffixed `d5657acc6c1df1abc790a96778ca71df36687b24-linux-amd64`;
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
6. Run `npm run p8d4:portable-identity -- --output <new-reviewed-root>`.
   This P8D4 wrapper uses the historical P8B3 verifier with the exact candidate
   and image matrix below, saves each exact tag to a new portable archive,
   derives and verifies its complete OCI graph, and writes a closed collection
   index. Hash every retained artifact. The historical P8B3 defaults remain
   frozen to their old candidate and are never relabelled.

| Boundary | Exact OCI index/image ID | Exact platform manifest |
| --- | --- | --- |
| CRM | `sha256:2d3009047bccb9c619028560d764d48b6565a7707bac022e269d99041a2086ca` | `sha256:f9718c71b222749874c2cb01fd8c88ef278cad36195c56fb88457489b9d2d44f` |
| Inbox | `sha256:b4fea6174bb62f8fac90fd034ede4a1d2134b372bfd805a34f71cf0592a50596` | `sha256:4ff3dc9640d4e047fef4b70b8d608cae2eb73413a4419d9a94e33babad9b870a` |
| Lead Agent | `sha256:cf48fc41d73755eb154f4a00f3bd10d238874e0abf006620c447a9f816fe7bf0` | `sha256:243ea75173e086ead21991df3f61c2c5e0db4bb65d0a37505e9324a7f743cb7f` |

   Validate the generated identity against
   `docs/schemas/p8d4-portable-image-identity.schema.json` and run the real
   retained-archive test with `EVO_P8D4_EVIDENCE_ROOT` set to that exact root.

The builder output is exactly
`.evo-release-evidence/p8b2-input-d5657acc6c1df1abc790a96778ca71df36687b24-linux-amd64/`.
After validation, install only its closed indexed files into
`.evo-release-evidence/p8d4-d5657acc6c1df1abc790a96778ca71df36687b24-reviewed/`.
Its three archives are exactly
`evo-crm-d5657acc6c1df1abc790a96778ca71df36687b24-linux-amd64.tar`,
`evo-inbox-d5657acc6c1df1abc790a96778ca71df36687b24-linux-amd64.tar`, and
`evo-lead-agent-d5657acc6c1df1abc790a96778ca71df36687b24-linux-amd64.tar`.

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

Use exact release ID `2026-08-16.p8d4.1` and roots
`/opt/evo-releases/d5657acc6c1df1abc790a96778ca71df36687b24/2026-08-16.p8d4.1`,
`/opt/evo-release-rollback/2026-08-16.p8d4.1`, and
`/opt/evo-release-evidence/d5657acc6c1df1abc790a96778ca71df36687b24/2026-08-16.p8d4.1`.
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
file. Run from the release root `repo/` with `EVO_RELEASE_REVISION` set to the
frozen full commit, `EVO_RELEASE_VERSION=p8d4-current-main-20260816`,
`EVO_WAHA_IMAGE_DIGEST=sha256:dc134637dfa0bd65202010a65e4ff8176101791699176c75bb37d5aa9daf487c`,
and these exact absolute interpolation values:

- `EVO_CRM_APP_ENV_FILE=/opt/evo-crm/.env.production`;
- `EVO_CRM_LEAD_AGENT_ENV_FILE=/opt/evo-crm/.env.lead-agent`;
- `EVO_INBOX_APP_ENV_FILE=/opt/evo-inbox/agent-lead2-crmwhatsapp/.env.production`.

Run only `docker compose --env-file <exact-env-source> -p <project> -f <file>
up -d --no-deps <service>` with the applicable absolute service-env variable
also exported. `--env-file` supplies required Compose-time values such as the
Inbox public Supabase URL/key without copying or printing them. The
retained-Compose rollback commands use
the same three absolute variable values, their recorded prior
`EVO_RELEASE_REVISION`, the same fixed release-version and WAHA digest values,
the matching exact env source via `--env-file`, the rollback root as working
directory, and the exact project/file/service matrix. The execution
amendment records the three pre-deploy Compose working directories, revisions,
images and archive hashes. If a later boundary fails, roll back every already
deployed P8D4 boundary in reverse order using those exact retained Compose
files/revisions and verify the complete five-container safe state. Migrations
076 and earlier are additive and forward-only; the real compatibility gate must
prove the three retained old application images remain healthy against schema
001-076 before execution. Database history is never rolled back.

## Phase C — managed Supabase migrations

Use the approved EVO Platform production project only. Obtain the exact ledger
through the Supabase Management API with the owner-held PAT; service-role REST
is not accepted as migration-ledger proof. Run the reviewed P8D4B migration
runner in read-only preflight mode first. The
only acceptable result is:

- the frozen range is already complete, producing a verified no-op; or
- only the frozen missing sequential migrations are listed in order.

Apply only that reviewed missing sequence once. Never use `db reset --linked`,
`migration repair`, `--include-seed`, Dashboard SQL, direct manual edits, the
stored database password, a password reset, JIT configuration or an SSL-
enforcement change.
Re-read the ledger and require the exact frozen contiguous range before any app
recreation or knowledge import.

The CLI is the lockfile-installed Supabase CLI `2.110.0`. The reviewed runner
executes from the merged release-control checkout while passing the exact clean
candidate source root at commit
`d5657acc6c1df1abc790a96778ca71df36687b24` as `--workdir`. The target must
resolve through the Management API to project ref
`iosckaqtovbbnssqcpde`. Password-like database environment variables must be
absent. The CLI's official linked-project flow obtains a short-lived login role
from `POST /v1/projects/{ref}/cli/login-role`; no persistent database password
is supplied or changed. The migration window is exclusive: no other Supabase
CLI link/push session may run for this project because the cleanup endpoint
revokes the project's temporary CLI roles. The runner performs that cleanup
through `DELETE /v1/projects/{ref}/cli/login-role` in a `finally` block after
every apply attempt. Cleanup failure blocks every later P8D4 phase even though
the roles also have a provider-enforced TTL.

The runner first checks the Management API ledger and read-only SQL summary,
links only the exact project, and executes `supabase db push --linked --dry-run`.
Only when the remote ledger is exactly `001-072` and that output lists exactly
`073`, `074`, `075`, `076` in order may it execute
`supabase db push --linked --yes`. Exact `001-076` is a verified no-op. A
partial `073-075` state is an incident and stops for review rather than being
automatically resumed.
The runner then re-reads both independent ledger views and requires exact
contiguous `001-076`. Stdout is reduced to migration identifiers/status before
it enters the mode-`0600` closed evidence file; access tokens, temporary role
credentials, connection material, SQL bodies, emails and user identifiers are
never logged or persisted.
An apply-path or local temporary-directory cleanup error with successful role
cleanup records `operation_failed`; failed role cleanup records
`cleanup_failed`. The evidence records both cleanup statuses, and either result
stops publication and deployment.

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
   The currently running legacy Inbox image does not contain the K5 importer,
   so it is never used for publication. From the new release `repo/`, run an
   isolated one-off container from the already verified candidate Inbox image
   without replacing the running service. Create it with
   `EVO_RELEASE_REVISION=d5657acc6c1df1abc790a96778ca71df36687b24 EVO_RELEASE_VERSION=p8d4-current-main-20260816 EVO_WAHA_IMAGE_DIGEST=sha256:dc134637dfa0bd65202010a65e4ff8176101791699176c75bb37d5aa9daf487c EVO_INBOX_APP_ENV_FILE=/opt/evo-inbox/agent-lead2-crmwhatsapp/.env.production EVO_INBOX_WAHA_ENV_FILE=/opt/evo-inbox/agent-lead2-crmwhatsapp/.env.waha docker compose --env-file /opt/evo-inbox/agent-lead2-crmwhatsapp/.env.production -p evo-inbox -f agent-lead2-inbox/deploy/docker-compose.inbox.prod.yml run -d --no-deps --name evo-p8d4-knowledge-import --entrypoint tail app -f /dev/null`;
   require that exact name to be absent first. Use the merged K5 `docker cp`
   and in-container hash verification, then run only
   `docker exec evo-p8d4-knowledge-import npm run knowledge:import -- --audience <client|internal> --bundle <exact-container-path> --manifest <exact-container-path> --account-id "$EVO_KNOWLEDGE_ACCOUNT_ID"`.
   Before the first provider call, inspect the one-off container image and
   require the frozen candidate image ID/revision/platform. The merged K5
   transfer copies the exact files into that one-off container, re-verifies
   their hashes, and removes them before `docker rm -f
   evo-p8d4-knowledge-import`. No alternate
   importer or running-service recreation is permitted in Phase D.
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

## P8D4C final knowledge-freeze amendment

The Phase D inventory sentence above is historical and is superseded only for
the still-unexecuted knowledge publication. The knowledge owner completed the
approved Poland and Malaysia delta batch and froze both publishable vaults at
`2026-08-16T04:16:05+06:00`. The exact final inventory is **11 client** and
**291 internal** Markdown documents. No production knowledge sync or Gemini
call occurred during that batch.

The frozen client bundle SHA-256 is
`c20acf2a3ecdf321d9120ca97e1389b5883ef9cfd5d97dc5b1d2235c56a05c23`;
the frozen internal bundle SHA-256 is
`a3a1092c10ec3a8768c6f8ac63f32f81b0fa9e9c313d820d034ad084565b6184`.
The client allowlist has 8 entries and SHA-256
`3c35e8dbe8a6ad751ea6497d2a5a9b4abb035bd974cfa14e602aabecbb99557e`;
the 8-file client publication manifest has SHA-256
`5f1ad3b95b4c8c8b25dfbddcb698c6676b8c176d5220b9ab07462074178cf374`.
All allowlist source hashes match their published outputs, the full-vault
PII/boundary gate passed, retrieval passed 10/10, forbidden raw/secret roots
were excluded, and all 912 extracted business sources have review binding.

Immediately before transfer, resolve exactly one active Gemini account through
the production service-role boundary without printing or persisting its UUID.
Two fresh builds per audience using that live account must reproduce the exact
bundle hashes above. The deterministic generated K3 manifest hashes are
`6c6c88ef430d91b4ee8c8d694bd69fc73d01cb1067088a2586e7b0c388ca3f8c`
for client and
`6964354ab201daf1cce174aa48aa4aee3db757d091d96c050d88725df04caf33`
for internal. Any count, bundle, manifest, allowlist, publication-manifest or
vault-freeze drift stops before the first embedding request.

The closed `p8d4-result.json` records these non-secret gates in a required
`knowledge_freeze` object: freeze time and status, redacted
`exactly_one_active` account-resolution status, both document counts, bundle
and generated-manifest hashes, client allowlist and publication-manifest
counts/hashes, the PII/boundary result, retrieval pass/fail counts and the
review-bound source count. `pilot_verified` pins every value above exactly.
The production account UUID is never stored in that evidence.

Before rendering the isolated Phase D Compose command, require
`/opt/evo-inbox/agent-lead2-crmwhatsapp/.env.waha` to be an existing root-owned,
root-group, mode-`0600`, regular non-symlink file. Its exact path is supplied
only through `EVO_INBOX_WAHA_ENV_FILE` so Compose can validate the declared WAHA
service while `run --no-deps` still creates only the importer. This does not
authorize a WAHA create, recreate, reload, restart or provider call.

This amendment changes no provider-call allowance, image, deployment order,
rollback rule or outbound-message prohibition. The vault owner must keep both
publishable roots frozen until production import finishes and the rollout owner
explicitly releases the freeze.

## P8D4E importer-image correction

The first P8D4D isolated container was created from the exact d565 Inbox image,
but the run stopped before any provider call because the production runner had
a dead `knowledge:import` script: Next standalone packaging omitted the
TypeScript entrypoint, `tsx` and its dependency graph. Cleanup completed and no
knowledge row or running production container changed.

Issue `#229` and Plan Block-ID
`EVO-PLATFORM-P8D4E-IMPORTER-IMAGE-2026-08-16` replace that packaging seam with
one build-time-bundled Node 20 ESM importer copied into the non-root Inbox
runner. A fixed `--verify-runtime` path must succeed with container networking
disabled and without credentials, while normal import behavior remains the
same service-role/Gemini/transactional path.

The d565 application images are not reusable after this correction. Another
production import is blocked until the correction is reviewed, merged and
green on exact main, a new current-main three-image candidate is frozen and
reconciled, and the 11/291 vaults freshly reproduce the exact production-bound
hashes. This correction itself authorizes no production or provider mutation.

## P8D4F post-importer candidate refresh

PR #230 merged the importer-image correction as exact main
`aaa9f618131f604f79c694e4b332a0b13afd7a30`; its tree is
`36632068dbfa5ae3d11fdd5bb6876940ca7fc14a` and its exact parent is
`e8e1b0e41c17b8e55f75edd34afedd551c1d57f8`. Exact-main CI run
`31916279374` passed Main CRM, EVO Inbox and EVO Lead Agent. Issue #231 and
Plan Block-ID `EVO-PLATFORM-P8D4F-CANDIDATE-AAA9-2026-08-16` replace only the
obsolete Phase A candidate identity; all later production gates remain closed.

Use a clean detached source checkout at the exact commit above and a separate
clean reviewed release-control checkout. Run the existing fail-closed P8B2
builder on OrbStack with `--platform linux/amd64 --load`, refusing pre-existing
target tags and output paths. The exact tags are:

- `evo-crm:aaa9f618131f604f79c694e4b332a0b13afd7a30-linux-amd64`;
- `evo-inbox:aaa9f618131f604f79c694e4b332a0b13afd7a30-linux-amd64`;
- `evo-lead-agent:aaa9f618131f604f79c694e4b332a0b13afd7a30-linux-amd64`.

The builder output is exactly
`.evo-release-evidence/p8b2-input-aaa9f618131f604f79c694e4b332a0b13afd7a30-linux-amd64/`.
After the real build, add a candidate-specific wrapper, closed schema and
behavioral tests that bind the three observed OCI index IDs and platform
manifest IDs without altering the historical P8D4/d565 identities. Generate a
new portable archive set under exactly
`.evo-release-evidence/p8d4f-aaa9f618131f604f79c694e4b332a0b13afd7a30-reviewed/`.
The directory is mode `0700`; every retained file is mode `0600`; all archive,
SBOM, smoke, identity and collection-index bytes are SHA-256 bound.

The Inbox candidate must additionally pass its packaged
`knowledge:import -- --verify-runtime` seam as UID 1001 with networking
disabled and no env file, credentials or mounts. Normal import must remain
fail-closed without its exact required arguments. No P8D4F command may use a
managed-provider key, customer data, Hermes, or a production hostname.

P8D4F completes only after independent exact-head review, 4/4 PR CI, merge,
and exact-main CI. It authorizes local candidate construction only: no
production transfer, load, restart, deployment, knowledge import, Gemini call,
Supabase write, WAHA/amoCRM/WhatsApp/DNS action or billed resource.

## P8D4G production execution amendment

Issue `#234` and Plan Block-ID
`EVO-PLATFORM-P8D4G-PRODUCTION-EXECUTION-2026-08-16` supersede the remaining
historical d565 execution identities without rewriting them. Release control
is exact main `a43fc7b182dd0fa3fbd3e02104dff1b1c26bbad2`, tree
`239cb8d5cf2f51805205a4aceb6df6084b2d415e`, exact-main CI run
`31918619142`. The immutable application source remains
`aaa9f618131f604f79c694e4b332a0b13afd7a30`, tree
`36632068dbfa5ae3d11fdd5bb6876940ca7fc14a`, parent
`e8e1b0e41c17b8e55f75edd34afedd551c1d57f8`, exact-main candidate CI
`31916279374`.

The reviewed local source root is
`/Users/iskhak.tazhibaev/.codex/worktrees/evo-p8d4f-source-aaa9`. The only
authorized portable source is its mode-`0700` directory
`.evo-release-evidence/p8d4f-aaa9f618131f604f79c694e4b332a0b13afd7a30-reviewed`.
Its collection index SHA-256 is
`a6bb5b51851d8338891846ff534fc25e774a739f5f656f010b707c398d7d63e7`
and portable identity SHA-256 is
`53fa00c63338a55925fa8d2c8d6e6faaa61d63b0f99251e50dabafd792755ccd`.
The closed transfer matrix is:

| Boundary | Exact build tag | Exact OCI index/image ID | Archive | SHA-256 |
| --- | --- | --- | --- | --- |
| CRM | `evo-crm:aaa9f618131f604f79c694e4b332a0b13afd7a30-linux-amd64` | `sha256:3174e8e35f27ca3983e971d6f4b94b6863a5b64a9ffd751042b3db5ed2f8c55a` | `evo-crm-aaa9f618131f604f79c694e4b332a0b13afd7a30-linux-amd64.tar` | `07c9341c0aeae456b2bd51ae66a8f0ba81645e49f064a212cdc1485df0db50b1` |
| Inbox | `evo-inbox:aaa9f618131f604f79c694e4b332a0b13afd7a30-linux-amd64` | `sha256:d7be064bdd690ac42f9e18fbcb32b8fb42eac32f588256a983393ede9f8b79ca` | `evo-inbox-aaa9f618131f604f79c694e4b332a0b13afd7a30-linux-amd64.tar` | `6bbeadd9e7571db018e0d9932cddfd8f22503b0090c4a27467af9a071eef5a48` |
| Lead Agent | `evo-lead-agent:aaa9f618131f604f79c694e4b332a0b13afd7a30-linux-amd64` | `sha256:9194b569df458a7a80792ca3f4aebfa417204961f229585178aa91c710d45c01` | `evo-lead-agent-aaa9f618131f604f79c694e4b332a0b13afd7a30-linux-amd64.tar` | `32b2937ef5bd2e23ae5c5b405242bade6e9af237165649f737d97a935c709063` |

Every loaded image must also retain `linux/amd64`, empty variant, revision
`aaa9f618131f604f79c694e4b332a0b13afd7a30` and its reviewed platform-manifest
ID. Add only the unsuffixed Compose tags at that same full revision after
proving each destination tag is absent. Retagging to any other name is
forbidden.

Use release ID `2026-08-16.p8d4g.1` and exactly these initially absent roots:

- `/opt/evo-releases/aaa9f618131f604f79c694e4b332a0b13afd7a30/2026-08-16.p8d4g.1`;
- `/opt/evo-release-rollback/2026-08-16.p8d4g.1`;
- `/opt/evo-release-evidence/aaa9f618131f604f79c694e4b332a0b13afd7a30/2026-08-16.p8d4g.1`.

Create them root-owned mode `0700`. Incoming archives use the exact filenames
above under `release/incoming`, mode `0600`, absent destinations, explicit
per-file transfer and local/remote hash equality. The release `repo/` is an
exact clean Git archive of the application source commit. No discovery, glob,
checkout substitution or remote build is permitted.

The live preflight currently observes healthy/restart-`0` CRM, Inbox, Lead
Agent and both WAHA containers; production applications still run the prior
CRM `sha256:d4626208423df2c0df24262763917b82b1157b53a115b44f02478ecf7245f580`,
Inbox `sha256:6d5e0a9d5ea073737bdd8c2c5621818ca7bdb76dd5b16ca5e44563d39833cb6b`
and Lead Agent
`sha256:3678747c1ea1c9b5655bb830296c9e4d4aedf60d3d193b438633b68eb3f97cc7`
image IDs. The two WAHA containers both retain exact digest
`sha256:dc134637dfa0bd65202010a65e4ff8176101791699176c75bb37d5aa9daf487c`.
Re-read every value immediately before mutation. Reuse the exact Phase-B
rollback env and Compose source matrix, save each prior application image to
the exact rollback filenames, and require root-owned regular non-symlink
mode-`0600` env inputs. Any drift stops.

Before Compose rendering, apply the already-reviewed P8D disabled matrix to the
three live env files using atomic same-directory replacement, root ownership
and mode `0600`. Only missing named non-secret settings may be appended, and
only the known single Lead Agent conflict
`EVO_AGENT_AUTOREPLY_ENABLED=true` may be changed to `false`. Preserve
secret-bearing before-images only in the rollback-secret root, never in
redacted evidence. Require CRM Platform ingress/worker/history/media, amoCRM
read, AI memory, Gemini proposal, autonomous reply, P6A/P6B/P6C and P7A flags
`0`; kill switch `1`; CRM/Inbox P7B observability `1`; Lead Agent frozen
`true`, worker/autoreply/outbound `false`, and model `gemini-3.5-flash`.

The production Supabase project is exactly `iosckaqtovbbnssqcpde`. A fresh
Management API read must return `ACTIVE_HEALTHY` and exact contiguous migration
ledger `001-076`. That state is a mandatory no-op: do not link, create a CLI
login role, run `db push`, reset, repair, seed, alter a password or execute SQL.
Any other ledger stops before knowledge or deployment.

The two vault roots remain the exact Phase-D paths and remain frozen at
`2026-08-16T04:16:05+06:00` with 11 client and 291 internal Markdown documents.
The previously recorded bundle/manifest pairs
`c20acf2a3ecdf321d9120ca97e1389b5883ef9cfd5d97dc5b1d2235c56a05c23` /
`6c6c88ef430d91b4ee8c8d694bd69fc73d01cb1067088a2586e7b0c388ca3f8c`,
`a3a1092c10ec3a8768c6f8ac63f32f81b0fa9e9c313d820d034ad084565b6184` /
`6964354ab201daf1cce174aa48aa4aee3db757d091d96c050d88725df04caf33`,
`08a955db439163b0998c47722a949ed882e42aa78c3987b6965af31fa5df3494` /
`1abb456300eccfdc5732489fd6856c7be04730949e19347f9ff1cdb550c6093f`,
and
`63a867bffc1c972dd28765d18906260090730a23e654531b7c34cd6d282d7dcb` /
`78cf2c1c071b67c23b0c91632bdc4684f139c22c8b3a8cf9b6145531b2c47561`
were built with unverified or explicit non-production account UUIDs. They are
historical staging evidence only and are forbidden as production import
identities.

Resolve the live account by service-role read of active Gemini configuration:
there must be exactly one row with provider `gemini`, model
`gemini-3.5-flash`, embeddings provider `gemini`, active `true`, and autonomous
reply `false`. Keep its UUID in process memory; never print it, interpolate it
into shell history, write it to a file, or retain it in evidence. The immutable
builder and candidate importer both require `--account-id`. Therefore the only
authorized exception is transient process argv: the private local builder
receives a shell-variable expansion, and the one-off Hermes importer receives
the value over encrypted SSH stdin into a root-only shell variable whose
command text contains no UUID. The value may appear transiently only in the
local builder and one-off container importer argv; it must not be persisted by
SSH, Docker, the shell or evidence. Build each audience twice into distinct
absent mode-`0700` local directories with the merged builder and this UUID, then
require byte-identical bundle, manifest and report bytes across both builds
plus exact 11/291 counts. Newly computed hashes become the only production
bundle identities.

Transfer only each new bundle and manifest to absent root-owned mode-`0600`
files under `release/knowledge-incoming`; prove local/remote hashes. Create the
isolated `evo-p8d4-knowledge-import` container from the exact candidate Inbox
image using the Phase-D `run -d --no-deps` command updated only to revision
`aaa9f618...` and release version `p8d4g-20260816`. Reverify image, platform,
runtime, networks and no running-service replacement; copy bytes into the
container, rehash, and invoke client then internal. For each invocation, pipe
the UUID only on SSH stdin; the fixed remote script reads one line into
`EVO_KNOWLEDGE_ACCOUNT_ID`, validates canonical UUID syntax without output, and
expands it only into the frozen importer argument
`--account-id "$EVO_KNOWLEDGE_ACCOUNT_ID"`. No literal UUID may occur in the
local or remote command text. Importer stdout must remain the reviewed closed
UUID-free projection. Remove copied knowledge bytes, remove the one-off
container, and remove remote incoming knowledge bytes after both safe database
revisions/hashes/counts verify.

Recreate only Inbox app, CRM app and Lead Agent, in that order, using exact
Compose commands and interpolation paths already frozen in Phase B with
revision `aaa9f618...`, version `p8d4g-20260816` and the unchanged WAHA digest.
After every boundary require exact image, health, restart `0`, networks,
disabled state and liveness. On failure, unwind every completed application
boundary in reverse order. WAHA and Caddy are never recreated or reloaded.

Run only the two committed non-customer cases after all deployments verify:
`client_china_documents` at `POST /api/ai/playground` and
`internal_malaysia_handoff` at `POST /api/ai/internal-assistant`. Use one
existing active admin session process-only. Exactly the bounded embedding work
for the 11/291 approved bundles and exactly two Gemini draft requests are
authorized; no retry, fallback, WhatsApp, WAHA, amoCRM, autonomous or customer
content call is allowed.

Before production mutation, add a dedicated closed P8D4G result schema and
executable runner/verifier. It must pin all fixed identities above and enforce
cross-artifact equality for the newly computed bundle/manifest hashes across
the two builds, transfer, UUID-free importer result and safe database evidence.
It must support truthful partial failure, atomic mode-`0600` output and contain
no UUID, secret, URL, prompt, response, knowledge body or customer/provider
identifier. The obsolete P8D4 v1 constants are never used for completion.

The production action window is 120 minutes from its recorded UTC start. It may
begin only after the implementation PR has independent exact-head approval,
4/4 CI, merge, exact-main green CI and a fresh preflight. Any identity, hash,
flag, ledger, provider, privacy, health, restart, network, evidence or rollback
drift stops; application changes are fully unwound where possible and the
database/knowledge state is reported truthfully rather than destructively
rolled back.

## P8D4H knowledge UUID artifact correction

Issue `#236` and Plan Block-ID
`EVO-PLATFORM-P8D4H-KNOWLEDGE-UUID-ARTIFACT-2026-08-16` correct one literal
conflict in P8D4G without changing its candidate, ordering or external authority.
The immutable builder writes `account_id` into the canonical bundle and manifest,
and the importer validates that identity before the service-role transaction.
Those exact files therefore cannot be both valid and UUID-free.

The production account UUID may appear only inside the two deterministic local
build copies of each canonical bundle/manifest and the exact encrypted-transfer,
root-owned remote-incoming and isolated-container copies needed to import them.
Local roots are newly created mode `0700`; files are mode `0600`; remote and
container destinations are absent before use, private and hash-bound. The
UUID-bearing builder report is temporary validation material only: do not
transfer or retain it.

Do not create a standalone UUID file or expose the value through stdout, stderr,
Git, shell history, command literals, retained reports, redacted evidence or
importer output. Transport remains transient local argv plus encrypted SSH stdin
to a root-only variable expanded only in the isolated importer argv. The reviewed
`safeImportResult` remains the only allowed importer output.

Use a finally-style cleanup path on every terminal success or failure after any
UUID-bearing artifact is created. Attempt to remove every created local
build-copy root (four on the complete two-audience/two-build path), every
created remote incoming bundle/manifest pair and every created in-container
copy, including after build validation, transfer, container, import or
post-import verification failure. Verify absence before application deployment.
Cleanup failure is blocking and must be represented by a closed UUID-free result
code. P8D4G retained evidence may contain only safe audience names, counts,
SHA-256 values, fixed statuses and cleanup state.

## P8D4I deterministic knowledge report correction

Plan Block-ID:
`EVO-PLATFORM-P8D4I-KNOWLEDGE-REPORT-DETERMINISM-2026-08-16` corrects one
impossible comparison without changing the candidate or any production
authority. The builder deliberately records a fresh `generated_at` value and
the distinct temporary `output_directory` in each validation report. Those two
reports therefore cannot be byte-identical even when their canonical outputs
are identical.

For each audience, the P8D4G runner MUST continue to build twice in distinct
mode-`0700` temporary roots and MUST require byte-for-byte equality of both
canonical bundle files and both canonical manifest files. It MUST validate both
closed report shapes and compare every stable field exactly: version, live
account held only in process memory, audience, marker root, document count,
bundle SHA-256 and manifest SHA-256. Only `generated_at` and
`output_directory` are excluded from equality because they describe the two
separate executions. Both UUID-bearing reports remain temporary validation
material, are never transferred or retained, and are removed by the P8D4H
finally-style cleanup before deployment.

This correction grants no new provider call, deployment, production mutation,
customer-data access or outbound authority. All P8D4G and P8D4H stop, privacy,
rollback and evidence requirements remain unchanged.

## P8D4J merged-runner execution control

Plan Block-ID `EVO-PLATFORM-P8D4J-EXECUTION-CONTROL-2026-08-16` makes the
production runner fail closed until a second, reviewed control artifact binds
the runner implementation after its squash merge. That closed artifact records
the merged implementation commit, tree, exact-main CI and exact ordered hashes
of the runner, production adapter, result schema and package registration.

Immediately before any production effect, the runner MUST recompute those
hashes, require a clean checkout at current GitHub `main`, prove that checkout
descends from the bound implementation, and require its own exact-main required
checks green. The retained result records the bound implementation and observed
execution commit/tree/CI separately from the immutable application candidate.
Missing control, dirty bytes, main drift, ancestry drift, file-hash drift or red
CI stops before Hermes, Supabase or Gemini access.

The later control artifact is metadata only. Neither this gate nor its control
PR adds production, deployment, provider, customer-data or outbound authority.

## P8D4L Hermes preflight source-mode correction

Issue `#245` and Plan Block-ID
`EVO-PLATFORM-P8D4L-PREFLIGHT-SOURCE-MODES-2026-08-16` correct only the
preflight source-file matrix and retry identity. The first real preflight was a
truthful `preflight_blocked` result and performed no Supabase, Gemini,
knowledge, deployment, restart or provider mutation. Preserve that result.

The next attempt uses release ID `2026-08-16.p8d4l.1`, release version
`p8d4l-20260816`, and newly absent release, rollback and evidence roots derived
from that ID. Do not reuse or overwrite the prior local failed-evidence root.

Before any provider or production effect, require these exact existing sources
to be regular, non-symlink `root:root` files with these exact modes:

| purpose | exact source | mode |
| --- | --- | --- |
| CRM secret environment | `/opt/evo-crm/.env.production` | `0600` |
| Lead Agent secret environment | `/opt/evo-crm/.env.lead-agent` | `0600` |
| Inbox secret environment | `/opt/evo-inbox/agent-lead2-crmwhatsapp/.env.production` | `0600` |
| Inbox WAHA secret environment | `/opt/evo-inbox/agent-lead2-crmwhatsapp/.env.waha` | `0600` |
| retained CRM Compose | `/opt/evo-releases/564332b420a1fb1bd6232dda945d044bb922d3f0/repo/docker-compose.prod.yml` | `0644` |
| retained Inbox Compose | `/opt/evo-releases/a09a72fc55d869c861df520f76d62413a2315fc1/repo/agent-lead2-inbox/deploy/docker-compose.inbox.prod.yml` | `0644` |
| retained Lead Agent Compose | `/opt/evo-releases/b2303eccb78b7c102ec702e9821f765f6dfaba88/repo/docker-compose.prod.yml` | `0600` |

Any missing file, symlink, owner/group drift, mode drift, path drift,
pre-existing retry root or pre-existing candidate tag stops before effects.
Rollback copies remain installed into the private rollback root at `0600`
regardless of their non-secret source mode. All other P8D4G through P8D4K
candidate, provider, pilot, cleanup, rollback and privacy rules remain exact.

Because the operations, runner and result identity change, a separate reviewed
execution-control metadata update must bind the merged P8D4L bytes before the
next real preflight.
