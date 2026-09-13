# D5: metadata-only import manifest and reconciliation plan

Status: bounded implementation contract, 2026-09-14. Parent:
[unification run plan](evo-docs-unification-run-plan.md), ADR0028 and
`docs/EVO_LAUNCH_PLAN.md`. This is not an importer, real-data reconciliation or D5 completion.

## Boundary and use

`parseDocumentImportManifest(json)` validates untrusted JSON;
`planDocumentImportReconciliation(manifest)` revalidates and returns a deterministic
metadata-only plan. Neither reads files, SQLite, environment or network nor writes
anything. The future authorized exporter/executor is separate work. Do not pass raw
database rows: unknown keys, values, snippets, messages, names and paths are rejected.
No real manifest is committed. Inputs/results still contain private linkage metadata;
keep them in an authorized private workspace, not general logs or knowledge bases.

Envelope `evo-docs-import-metadata/v1`: UUID `sourceInstanceId` (stable across snapshots),
SHA-256 `snapshotSha256`, `domains`, `caseMappings`, `targetCases`, `ledger`.
`domains` has exactly the twelve arrays below. Maximum 10,000 total source rows and 10,000 ledger entries,
1,000 mappings/cases, 16 references per row, 8 MiB JSON. Every object has exact keys.
UUIDs/hashes use canonical lowercase; source PKs are UUIDs except positive integer
candidate/event IDs, student UUID settings keys, student UUID + `:` + registry field
key for field values, and student UUID + `:` + file UUID for package reviews.

Each row: `sourcePk`, `sourceStudentId` (null only for university forms),
`metadataSha256` (exporter-supplied digest, not recomputed source proof), `references`,
`file` (null or `{sha256,byteSize,mimeType}`), `legacyAssertion` boolean. References
are `{relation,domain,sourcePk}` with domain-specific relations checked by the parser.
Required links and same-student ownership are checked by the planner. A canonical
SHA-256 of the validated row binds all its metadata; no actual file bytes are hashed.

| Domain | Required link / file / target boundary |
|---|---|
| students | PK equals sourceStudentId; explicit approved canonical case mapping |
| documents | current_version → document_versions; file descriptor |
| document_versions | document → documents; file descriptor; preserve every version |
| field_values | optional paired source_document/source_version; D2 registry key |
| field_candidates | optional paired source_document/source_version; historical proposal |
| event_log | historical event digest only; no event message or invented actor |
| package_settings | historical settings digest; target persistence still required |
| package_parts | optional parent_version; file descriptor; no parent inferred from kind |
| package_reviews | file → documents/package_parts and version → document_versions/package_parts |
| package_exports | file descriptor; optional member references to versions/parts/forms exports |
| university_forms | file descriptor; explicit catalog mapping/persistence remains future work |
| university_form_exports | form → university_forms; file descriptor; snapshot digest |

Only field values, package reviews, university forms and both export domains may
declare a legacy assertion. Such assertions always require historical provenance
and human review; the planner never supplies a reviewer or promotes them to current
confirmation. Source schema lacks that authorship. Existing D2 review RPCs are not
historical import APIs. Package/form persistence and historical event/proposal
ingestion remain explicit blockers, not silently mapped to Student Profile exports.

## Mapping and reconciliation

Mapping: `{sourceStudentId,organizationId,studentCaseId,approval}`. Approval is null
or `{decisionId,reviewerMembershipId,snapshotSha256}`. A mapping is usable only if
approved for this snapshot, the source student exists, and exact org/case occurs in
`targetCases`. These descriptors do not verify live Auth/permissions or approval.
Duplicate source mappings or multiple source students targeting one case are blocked;
merging identities requires separate explicit design/approval, never name matching.

Ledger entry: `{sourceInstanceId,domain,sourcePk,recordSha256,organizationId,
studentCaseId,targetId}`; org/case are null only for global university forms.
Compare only this stable source instance; reject duplicate source keys and report
foreign-instance or source-absent ledger entries. Equal row fingerprint and case
binding with no other row issues yield `already_recorded`; changed digest/binding yields
`reconciliation_required`; unseen metadata yields `unseen`. No delete/update/upload
is emitted. Target IDs and recorded status remain caller assertions, not DB proof.
Within the current source instance and one domain, different source PKs sharing a
target ID produce `ledger_target_collision` on every affected source row. Equal
byte hashes do not permit merging distinct version identities.

Output covers all rows and twelve domain counts. `executionAllowed`, `importExecuted`,
`sourceBytesVerified`, `liveAuthorityVerified`, `d5Complete` are always false.
Row issues are fixed codes and metadata references, never raw errors/private values.
Unsupported source MIME stays visible; PDF/JPEG/PNG student ingress is not widened.
Future exports must preserve bytes; never regenerate old ZIP/PDF/DOCX as migration.

## Future execution prerequisites, not implemented here

An authorized frozen source snapshot and real mapping approval; finished target
persistence; case-scoped authorization; scan/integrity gates; durable ledger;
Storage readback SHA/size, twelve-domain identity/count/link/state reconciliation;
independent review and real acceptance before cutover. Do not instantiate standalone
`AppDatabase` for readonly export: its constructor migrates/backfills the source.
Existing scan-bound reservation/finalization and D4 immutable export reconciliation
are reuse points, not authority to import arbitrary file formats/history.

Primary references checked 2026-09-14: [SQLite Backup API](https://www.sqlite.org/backup.html)
describes a consistent snapshot; [Supabase Storage schema](https://supabase.com/docs/guides/storage/schema/design)
requires object mutations through its API, not SQL metadata writes;
[Storage uploads](https://supabase.com/docs/guides/storage/uploads/standard-uploads)
documents conflict/overwrite behavior. No backup, Storage operation or provider call
is performed by this module, and this slice adds no backup requirement.

## Readonly snapshot adapter (next D5 prerequisite)

`readDocumentImportSnapshot(snapshotPath, contextJson)` reads an explicitly
authorized, completed SQLite snapshot; it never opens the live standalone app.
Context JSON has exact keys `schema` (`evo-docs-snapshot-context/v1`),
`sourceInstanceId`, `snapshotSha256`, `caseMappings`, `targetCases`, `ledger`,
`universityFiles`. The first five data fields reuse manifest validation.
`universityFiles` entries are `{domain,sourcePk,file}` for university forms/exports
only, with the manifest file descriptor. They are externally supplied assertions,
not authority or verified attachment bytes; duplicate/foreign/hash-mismatched
entries block. Forms also require the MIME to match source `file_format`.

The absolute path must be canonical, with no symlink component, URI, dot traversal,
hard link, directory or special file. Its parent must not be group/world writable.
Limits: 64 MiB snapshot, 8 MiB context, 10,000 total rows/descriptors. A completed
rollback-journal snapshot is required: WAL-format headers and any `-wal`, `-shm`
or `-journal` sibling are rejected without opening SQLite. The reader holds a
readonly file descriptor, verifies SQLite header/SHA, opens the existing pathname
with `readOnly:true`, `allowExtension:false`, `timeout:0`, `query_only=ON` and
`trusted_schema=OFF`, then verifies identity/size/mtime/SHA and sidecar absence
again after close. It does not copy, create, repair, migrate, checkpoint or chmod
anything. These checks detect drift; they are not a sandbox for hostile concurrent
filesystem mutation. The caller must provide a frozen operator-controlled directory.

Exactly the twelve ordinary tables are required (`sqlite_sequence` is allowed).
Expected complete column names are checked from source schema; views, triggers,
virtual tables and hidden/generated columns fail closed. Explicit SELECT lists:

| Domain | Projected columns beyond identity/student linkage |
|---|---|
| students | none; no names |
| documents | current_version_id, sha256, size_bytes, mime_type |
| document_versions | document_id, sha256, size_bytes, mime_type |
| field_values | key, source_document_id, source_version_id, state |
| field_candidates | key, source_document_id, source_version_id |
| event_log | none; no message or invented actor |
| package_settings | generation |
| package_parts | sha256, size_bytes, mime_type; no inferred parent |
| package_reviews | file_id, version_id, sha256, constraints_hash |
| package_exports | sha256, size_bytes; no private manifest membership |
| university_forms | sha256, file_format, mapping_confirmed, generation |
| university_form_exports | form_id, sha256; no snapshot payload |

`metadataSha256` is a versioned hash of these allowlisted columns only. Hashing the
SQLite file verifies snapshot identity but neither inspects nor proves attachment
contents. Changes in omitted values/messages/settings/mappings/snapshots are not
row-level reconciled by this reader. Legacy fields confirmed in source, package
reviews/exports and form assertions stay historical; no reviewer is manufactured.

Result includes all twelve counts and fixed metadata diagnostics. If university
size metadata is absent or descriptors conflict, `manifest`/`plan` are null and
status is `blocked`, never a partial manifest dropping rows. Otherwise it feeds the
existing parser/planner; its issues (including foreign IDs) make status `blocked`.
Every result still has `executionAllowed:false`, `sourceBytesVerified:false`,
`liveAuthorityVerified:false`, `d5Complete:false`. No path/private value/raw error
is included. The reader has no command or application-runtime entrypoint.

Primary behavior verified: [Node22.23.1 SQLite](https://nodejs.org/download/release/v22.23.1/docs/api/sqlite.html#new-databasesyncpath-options)
supports readonly existing-file opens and disabled extensions;
[SQLite query_only](https://www.sqlite.org/pragma.html#pragma_query_only) alone is
not a readonly connection. Real-data snapshot creation/access remains separately authorized.
