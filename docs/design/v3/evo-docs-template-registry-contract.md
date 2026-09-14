# D4 — реестр университетских бланков

2026-09-14, implementation contract before code. Migration165 is allocated to
this slice;162–164 are immutable inputs owned by the recognition/artifact lanes.
Extends [D4](evo-docs-university-packages-contract.md), not a smaller replacement.

## Installed boundary

One canonical registry, no second university catalogue: organization + exact
`catalog_institutions.id` + its approved `source_revision`. Template identity and
catalog binding never change. A new binding requires another explicit template.
Archive removes selection/publication, preserves every version/review/event.
Creating a newer version or draft mapping does not overwrite a published version.
Publishing explicitly replaces the exact version/mapping/review pointer.

Private tables: templates (title/revision/archive/current pointer), immutable
source versions, immutable mapping versions, append-only mapping reviews,
immutable inspection receipts, append-only command receipts. All table access is
revoked from anon/authenticated/service_role, with RLS enabled. Only authenticated
staff RPCs are exposed. No Student, impersonation, role-name or service-key bypass.

Commands share organization → request → membership → catalog → template locks,
live S2 organization-scoped `catalog.import.manage`, expected template revision,
request UUID and reason. Exact replay returns its old receipt after live access
check; same UUID/different fingerprint conflicts; stale writes change nothing.
Successful writes advance template revision and append a metadata-only receipt.

- `create_university_form_template`: exact catalog ID + title; expected revision0.
- `reserve_university_form_version`: SHA256, size1–20MiB, DOCX/PDF MIME, source
  reference/date. Database allocates version UUID and random immutable private
  object name. These are **declared inputs**, never verified bytes/scan success.
- `save_university_form_mapping`: new mapping UUID + exact version/hash + bounded
  mapping array using the existing61 D2 keys and four derived name keys. No field
  values, signatures or inferred mappings. Duplicate/unknown slots fail. DOCX
  positions are forbidden; PDF geometry uses the existing format (≤100pages,
  ≤500areas, coordinates in points, ≤3 decimal places). Mapping hash uses the
  existing resolver's canonical UTF-8 JSON, not a new incompatible hash format.
- `review_university_form_mapping`: append approve/reject with exact mapping
  hash, reviewer membership and reason. Approval requires matching trusted
  template inspection, valid slots/geometry and current catalog provenance.
- `publish_university_form_template`: exact approved mapping/latest review plus
  exact trusted source receipt; cannot bless draft, rejected or uninspected bytes.
- `archive_university_form_template`: permanent archive (create new identity for
  reuse), no deletion of original bytes/history. Reject changes while archived.

Workspace read is STABLE and side-effect-free, requires live org `catalog.read`
or `catalog.import.manage`; unpublished versions/mappings require manage.
Selected exact source version plus keyset pages (20versions/20mappings) retain
older history without an arbitrary lifetime cap. Selection of published forms
requires `catalog.read` and returns only current nonarchived publications whose
catalog revision and trusted proof still match. Object names, source text, private
values and raw errors are excluded from public metadata/command receipts.

## Inspection is a separate unfinished D4 step

An inspection receipt must bind exact version/SHA/size/MIME/object name,
ClamAV signature revision, D4 template inspector revision/image digest,
inspection manifest SHA and exact slot/page manifest. It is immutable.
The safe manifest is exactly `format`, `slots` (unique `id` + boolean `editable`),
and `pageSizes` (width/height); no extracted text/field values. Its SHA is the
existing JSONB metadata digest; mapping SHA remains resolver-canonical UTF-8 JSON.
Only metadata relevant to mapping validation is persisted here; full inspection
evidence and byte provenance belong to the subsequent real ingress boundary.
**This migration installs no receipt writer and grants none to service_role.**
Publication therefore cannot become reachable in the running product until the
next real private-template upload/ClamAV/hard-isolated D4 inspection slice installs
its reviewed trusted writer. D3 `document-source-v1` is not that proof.
This is a temporary implementation seam, not a permanent disabled solution.
No bucket, upload URL, document scanner, renderer, HTTP/UI or export producer is
enabled here. Template originals remain distinct from student ingress.

## Verification and remaining full D4

Focused synthetic DTO/hash tests and real isolated PostgreSQL command tests cover
tenant/FK boundaries, scoped role grants/revocation, no role-label shortcut,
idempotency/stale revisions, immutable sources/mappings, missing inspection,
review/publication and archive. SQL-owner-inserted receipt metadata exercises
relational invariants only, **not bytes, ClamAV, inspection, layout or production**.
The standalone harness applies001–161+164+165 in its owned network-none OrbStack
database: this gapped slice is not contiguous release proof. Root will integrate
162/163 and run the complete candidate gate.

Still required by full D4: actual private ingress and trusted receipt writer,
hard-isolated template inspection/render, all-page layout/glyph acceptance,
template/mapping UI, forms/artifact integration, reviewed package composition and
ZIP, real authorized case acceptance, exact-head review and managed release.

Official foundations checked2026-09-14:
[PostgreSQL row locks and consistent lock order](https://www.postgresql.org/docs/current/explicit-locking.html),
[SECURITY DEFINER/search_path/grants](https://www.postgresql.org/docs/current/sql-createfunction.html),
[Supabase database functions](https://supabase.com/docs/guides/database/functions).
They justify boundaries, not implementation acceptance.

## Candidate evidence (not released)

- Actual scoped SQL exit0: `01a09cd05d9b7853a6067ab3ea48446d`, including existing
  catalogue review commands, custom manager/reader role publication/assignment/
  revocation, exact replay/stale writes, both tenant directions, immutable history,
  missing proof, exact-review withdrawal,22-version keyset and PDF overlap/page/
  manual-slot rejection. Owned network-none container removed. Receipt insertion
  is PostgreSQL-owner synthetic fixture only; no actual upload/scan occurred.
- Existing D4 forms + new registry tests72/72 and scoped lint exit0:
  `01a09cce6f367a32a6ec01bba1da2f0f`. SQL/Node pin identical DOCX/PDF canonical hashes.
- Real Next16.3.4 production build and TypeScript exit0:
  `01a09ccd8e7d7c9398ee8413e0482a2e`; no new HTTP surface or runtime inspection writer.
- Manifest tests8/8, lint/shell/diff checks passed. Inventory-only validation
  reports CI170 / unit165 unique files; this is not a full test-suite run.

Independent exact-diff review and root integration remain pending. No prod,
Storage/browser, private source inspection, renderer layout or real-case proof.
