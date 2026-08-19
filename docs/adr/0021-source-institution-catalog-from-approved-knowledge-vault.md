# ADR 0021: Source the institution catalog from the approved knowledge vault

- Status: proposed
- Date: 2026-08-20
- Proposed main checkpoint: `c27a6a84`
- Refines: ADR 0014 catalog boundary and ADR 0020 knowledge authority order
- Supersedes in conflict: the Notion assumption in FR-107 only
- Retains: FR-106 staging, validation and explicit approval boundary
- Depends on: `docs/platform/catalog-source-inventory.md`, delivered by
  PR #317. Until that merges, references to it resolve only on that branch.

## Context

FR-107 records that university catalog import is blocked because the Notion
workspace is unavailable, and requires that missing college data must not be
replaced with invented records. That requirement was correct when written.

The owner decided on 2026-08-20 that Notion is no longer the source and that the
approved EVO knowledge vault becomes the catalog source. The vault already
exists, is already governed by the four storage boundaries in `AGENTS.md`, is
already read by a safe reader in `scripts/knowledge_ingestion`, and its approved
internal audience already carries per-document SHA-256 provenance.

A measured inventory of the vault is recorded in
`docs/platform/catalog-source-inventory.md`. It found 195 documents under
`Университеты`: 104 programme candidates, 25 institution profiles, 40 reference
materials, 21 requiring manual classification and 5 worksheets. Nine host
institutions were resolved. Ninety of the 104 programmes belong to INTI, and
five of the nine institutions have no programme document at all.

Three properties of the vault constrain any design.

First, the vault has no URL. Every existing value of
`platform.workflow_source_kind` is a web address, and
`platform_private.is_safe_workflow_source_url` validates each one against an
exact pattern with a fail-closed `ELSE FALSE`. A local vault has a filesystem
path instead, and the P8V evidence rules prohibit private paths in retained
records.

Second, `platform.catalog_institutions` stores only an institution: name, kind,
country, city and provenance. There is no programme relation anywhere in the
schema, so 104 programme candidates have nowhere to go.

Third, four of the five worksheets contain zero tabular rows. The Malaysian fee
and intake tables described in the vault are not present in it as data. Only the
China worksheet is tabular, with 1512 rows whose institution names are
concatenated with fee figures.

## Decision

### Catalog source

The approved internal knowledge vault becomes the catalog source of record for
institutions and programmes. Notion remains a historical source under the
authority order in ADR 0020 and is not consulted for catalog import.

The client vault is not a catalog source. Only the approved internal audience is
read, because client publication is a downstream product of internal approval.

### Source identity without a filesystem path

`platform.workflow_source_kind` gains the value `knowledge_vault`, and
`platform_private.is_safe_workflow_source_url` gains a matching branch. Because
PostgreSQL cannot use a newly added enum value inside the transaction that adds
it, the enum extension and its first use are separate ordered migrations.

A knowledge-vault source is identified by the synthetic form
`evo-knowledge://internal/<sha256>`, where `<sha256>` is the 64 lowercase hex
characters of the source document digest already produced by
`scripts/knowledge_ingestion/build_platform_bundle.py`. No filesystem path,
vault root, user directory or Russian folder name enters the database.

`source_revision` carries the vault bundle manifest SHA-256 for the audience.
That value is already produced by the existing builder and already recorded as
release evidence, so catalog provenance and knowledge-release provenance refer
to the same artifact rather than to two independent claims.

### Programme relation

A programme relation is added beside `platform.catalog_institutions` with the
same organization scoping, FORCE row level security, provenance binding and
approval requirements. A programme references exactly one approved institution.

Programme level is a new enum rather than free text. Its values are the seven
observed in the inventory plus `transfer_programme`, because fifteen INTI
American and Australian Degree Transfer documents are a transfer route and fit
none of foundation, diploma or bachelor. Recording them at a wrong level would
misrepresent what a student actually enrols in.

### Rules the design must preserve

1. An institution with no programme is valid. Five of nine institutions are in
   that state today, and treating it as an import failure would be wrong.
2. A partner or awarding institution is not a catalog institution. A student
   enrolled at INTI on a 3+0 with Coventry studies at INTI; recording Coventry
   as an EVO catalog institution would create a place a student cannot apply to.
3. Import creates staging candidates only. An approved row appears solely
   through the existing explicit Admin approval path required by FR-106.
4. A field without a literal fact in the source stays empty. Duration, intake,
   tuition and entry requirements are absent far more often than present, and an
   inferred value would enter the client-facing answer path.
5. Concatenated China worksheet values are not split automatically. Each such
   row is a candidate requiring human confirmation.

## Consequences

- FR-107 is rewritten from "blocked while Notion is unavailable" to the vault
  source and its own fail-closed conditions. FR-106 is unchanged.
- The catalog gains a second import source kind; the existing Google and Notion
  kinds are retained and not migrated.
- Malaysian tuition and intake data cannot be imported, because it is not in the
  vault. That gap is recorded rather than filled from an external site.
- The client-facing AI gains catalog-backed institution and programme answers
  only after Admin approval, so the approved-knowledge boundary is unchanged.

## What this ADR does not authorize

No migration is applied, no candidate is staged, no approved row is created, no
provider is called and no production or managed Supabase mutation is performed.
Implementation follows as separately reviewed migration and importer blocks.

## Primary source basis

- `docs/platform/catalog-source-inventory.md` — measured vault inventory
- `supabase/migrations/056_platform_university_catalog_import_boundary.sql`
- `supabase/migrations/051_platform_business_workflow_contracts.sql`
- `scripts/knowledge_ingestion/build_platform_bundle.py`
- [PostgreSQL ALTER TYPE](https://www.postgresql.org/docs/current/sql-altertype.html)
