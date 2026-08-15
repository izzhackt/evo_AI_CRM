# P8C Environment Reconciliation Contract

Status: implementation contract under issue
[#180](https://github.com/izzhackt/evo_AI_CRM/issues/180).

Block-ID: `EVO-P8C-ENVIRONMENT-RECONCILIATION-2026-08-14`.

## Purpose

P8C compares the already-built P8B release candidate with the real GitHub,
`hermes-vps`, managed Supabase, WAHA, amoCRM and Gemini environments. It is a
read-only inventory. It does not deploy, migrate, restart, send, write, or
enable anything.

The P8B images were built from pull-request head
`0505143657858e710acdd5029f1cc77c5524083e`. GitHub squash-merged the same tree
as main commit `6ee93bd308aa478357279dd71511c7dc479b1f69`. P8C records both identities and
their shared tree `0563636057a19949a8927abc3ce02b32ba65896c`. The images remain attributed
to the pull-request head; P8C must block if the two tree objects differ.
The report also retains the three P8B OCI digests and the P8B evidence-index
SHA-256, so later P8D work cannot silently substitute rebuilt images.

## Closed report

The deterministic report has exactly seven segments:

- `github`
- `hermes`
- `managed_supabase`
- `waha`
- `amocrm`
- `gemini`
- `rollback`

Every segment uses one of `verified`, `blocked`, `deferred`, or
`not_applicable`, an explicit UTC observation time, a fixed operation name, a
fixed result code, and the path plus SHA-256 of separately retained redacted
evidence. The overall result is `blocked` when any segment is blocked,
otherwise `deferred` when any segment is deferred, and otherwise `verified`.

`verified` means the named real environment was queried read-only and every
required check matched. Missing access, ambiguous ownership, unsafe evidence,
candidate drift, or a required mismatch is `blocked`. A local substitute can
never verify a provider or production segment.

## Evidence boundary

Evidence and output live only below the ignored `.evo-release-evidence/`
directory. Directories are mode `0700`, files are mode `0600`, symlinks and
paths outside that root are rejected, and existing evidence is hash-checked
before the report is written.

Retained evidence may contain fixed identifiers, versions, counts, booleans,
migration ranges, Git SHAs, OCI digests, setting names and ownership. It must
not contain setting values, secrets, tokens, cookies, email addresses, phone
numbers, customer records, WhatsApp content, amoCRM entities, Gemini prompts or
responses, database rows, provider payloads, or Storage object bytes.

## Exact operations

- GitHub: `github_read_only_release_identity`
- Hermes: `hermes_read_only_runtime_inventory`
- Supabase: `supabase_read_only_project_and_migration_inventory`
- WAHA: `waha_read_only_health_and_ownership_inventory`
- amoCRM: `amocrm_read_only_account_inventory`
- Gemini: `gemini_read_only_model_and_access_inventory`
- rollback: `rollback_read_only_artifact_inventory`

Official operational basis:

- Docker image metadata is inspected read-only with `docker image inspect`;
  immutable registry digests are distinct from mutable tags.
- Supabase migration history is compared with `supabase migration list` or a
  read-only query of `supabase_migrations.schema_migrations`; `db push`,
  `migration repair`, and remote reset are forbidden in P8C.
- Provider health/account/model operations must be documented read-only API
  calls and must not retrieve customer records or generate customer content.

Primary references checked on 2026-08-14:

- [Docker image inspection](https://docs.docker.com/reference/cli/docker/image/)
- [Supabase migration list](https://supabase.com/docs/reference/cli/supabase-orgs-list#supabase-migration-list)
- [WAHA observability and health endpoint](https://waha.devlike.pro/docs/how-to/observability/)
- [WAHA API key security](https://waha.devlike.pro/docs/how-to/security/)
- [Gemini models guide](https://ai.google.dev/gemini-api/docs/models)
- [Gemini models API reference](https://ai.google.dev/api/models)
- [amoCRM account parameters](https://www.amocrm.ru/developers/content/crm_platform/account-info)
- [Supabase read-only database query](https://supabase.com/docs/reference/api/introduction)
- [WAHA sessions](https://waha.devlike.pro/docs/how-to/sessions/) and
  [webhooks](https://waha.devlike.pro/docs/how-to/events/)

## Stop and handoff

P8C stops with a truthful blocked report if access is missing or drift exists.
P8D remains a separate action-time approval: it may deploy only the exact
candidate with provider-write and autonomous-send controls disabled. This
contract grants no P8D authority.

## P8B2 amd64 extension

Issue [#197](https://github.com/izzhackt/evo_AI_CRM/issues/197) extends this
contract without changing the historical P8B reconciliation described above.
For the rebuilt P8B2 candidate, the closed report schema is version `2`; the
version-discriminated schema continues to validate historical version `1`
reports against their original closed shape. The P8C command accepts retained
artifact paths below its evidence root, not caller assertions for hashes,
platforms, or image identities. It reads and hashes `candidate-manifest.json`,
its bound `evidence-index.json`, the P8B2 `collection-index.json`, and the
retained historical P8B evidence index used for lineage. The historical index
must also be a closed version `1` document bound to the candidate commit. P8C
then derives the following report values, including
`p8b_evidence_index_sha256`, from those bytes:

- `target_platform`, with exactly `os: linux`, `architecture: amd64`, and an
  empty `variant`;
- `candidate_manifest_sha256`, the SHA-256 of the deterministic candidate
  manifest;
- `candidate_evidence_index_sha256`, the SHA-256 of that manifest's evidence
  index;
- `p8b2_collection_index_sha256`, the SHA-256 of the retained P8B2 build,
  smoke, and SBOM collection index.

Missing fields, symlinks, paths outside the evidence root, extra or unknown
platform fields, any architecture other than `amd64`, a non-empty platform
variant, hash mismatches, and candidate/image mismatches are hard input
failures. The collection index must hash the retained image, SBOM, and smoke
identities, and all three identities must agree on exactly the three distinct
CRM, Inbox, and Lead Agent image IDs. These bindings ensure P8C inventories the
exact P8B2 linux/amd64 candidate and cannot silently fall back to the earlier
arm64 artifacts.

Each consumed JSON artifact is checked against its repository-owned closed
shape. Evidence-index segments must all be `verified`; SBOM records must be
successful `linux/amd64` records; smoke records must be successful, isolated on
network `none`, and have zero restarts. Every collection entry must declare
mode `600`, and the retained file must actually have mode `0600`.
SBOM and smoke records retain the closed service order `main_crm`, `evo_inbox`,
`lead_agent`. Their candidate-bound tags, SBOM filenames and tool version,
smoke routes, timestamps, hashes, and service names must match the corresponding
schema exactly; reordering records cannot transfer evidence between services.
