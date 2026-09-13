# D4 — сохранённые результаты и история анкет

Дата: 2026-09-13. Implemented candidate; combined acceptance and release remain open.
Base: main7da50fa8, accepted application05585020. This amends the
[D4 contract](evo-docs-university-packages-contract.md), not its completion criteria.

## Ближайший результат

В текущей «Анкете» сформировать Student Profile → увидеть сохранённый результат →
скачать тот же файл позднее без повторного формирования. Не создавать другой
профиль, вход, базу или продукт. Университетские формы и пакеты подключаются к
этому же lifecycle позже, после своих проверок шаблонов, mapping и состава.

## Атомарный снимок и право доступа

`prepare_document_export` runs through the real authenticated staff session:
organization → request → memberships → case → profile locks, live case-scoped
`profile.read.full` + `document.download`, expected workspace digest, then freeze
confirmed values and review provenance. Return an opaque preparation ID and the
frozen values only to that authorized session. The installed browser command
contains mode/expected digest/request ID, never values, actor ID or Storage key.
The first producer is fixed to Student Profile; kind/target are database-owned
here, not unimplemented browser choices.
Confirmed NULL and the existing nine final-profile requirements remain unchanged.

The service-only `begin_document_export` consumes that preparation and rechecks
the actual Auth user/membership plus live permissions; it returns metadata only.
It must not retrieve current or frozen profile values with the service client.
Renderer receives the session-authorized frozen values, never a later snapshot.
No authenticated function can mark an artifact ready. Use existing S2 helpers,
not role-label checks. Independent D2's exact-key DTO remains unchanged.

Private snapshot/artifact records bind org/case/profile/revision, request and
actor, fixed template/renderer versions, field-review digest, kind/mode and
immutable random target. Index case history and foreign-key references. Frozen
values and object keys never appear in history DTOs, audit events or error text.
Reads do not implicitly create a profile, preparation or artifact.

## Публикация и повторный запрос

1. Prepare/freeze → service begin → render the frozen snapshot once.
2. Durably seal expected SHA256/bytes/MIME and exact key **before upload**.
3. Upload with overwrite disabled; read back exact bytes and verify SHA/size.
4. Recheck live actor/source permissions and all captured input revisions.
5. Transactionally record ready plus immutable receipt. A stale/revoked result
   commits a fixed failure instead of rolling back that failure evidence.

Exact request replay returns the existing artifact/outcome without rendering;
different input with the same request ID conflicts. Ambiguous I/O is persisted
as unknown, not success or a second upload. Reconcile only the sealed known key,
hash and snapshot; never regenerate or silently read latest values. An object
from a failed/stale operation remains unpublished for scoped reconciliation.
No permanent signed URL or public bucket; no file delivery claim from an audit.

History has schema_version1, case ID, stable workspace_revision, live capabilities
and export ID/kind/mode/state/time/source revision/historical/hash/size/MIME/fixed
failure/can_download. Older ready results are immutable and visibly historical.
Download checks the current employee's live access, reads stored bytes, verifies
hash/size and returns private,no-store. It never invokes the renderer.

## Storage amendment

Keep `platform-documents` private PDF/JPEG/PNG≤25MiB and its reservation, scan and
document-version registry unchanged. Generated files are not uploaded originals.
Add private, service-written `platform-document-exports`; first installed capacity
is DOCX≤5MiB for the fixed Student Profile producer. Forms20MiB/ZIP65MiB remain
future capacity, not silently reduced package limits. Templates stay in their
separate planned private bucket. Verify managed global limits before enabling
larger outputs; no inferred paid upgrade.

Local config alone does not configure managed Storage. Add a narrow check/apply
command restricted to this exact managed project/bucket, with sanitized before/
after settings and exact readback. Preserve all unrelated buckets. Never run the
recovery harness for bucket setup and never print credentials.

Official references: [service credentials bypass Storage RLS](https://supabase.com/docs/guides/storage/security/access-control),
[new keys/no overwrite and upload guidance](https://supabase.com/docs/guides/storage/uploads/standard-uploads),
[bucket/global file limits](https://supabase.com/docs/guides/storage/uploads/file-limits).
Trusted handlers must enforce grants even with a private bucket.

## Scope, retirement and proof

Use `/api/v3/student-cases/[studentCaseId]/document-exports` and artifact-ID
download/reconcile routes, integrated in the current Documents/«Анкета» UI.
After persistent-profile proof, remove the old `/profile-exports` producer and
its handler/RPC grants in the same slice. Keep immutable migration161/legacy
attempt history; never fabricate ready artifacts for previously generated bytes
that were not stored. Migration164 reserved;162–163 remain owned by D3.

Focused regressions cover authorization, frozen confirmed inputs, exact replay,
changed request, stale/role revocation, readback corruption, unknown/reconcile,
and history download without rendering. Then one real isolated Auth/DB/Storage/
browser flow exercises generation, cold history and repeated download. Keep
ordinary tests bounded; do not repeat the completed S2/D2 production gate.
Full D4 still requires actual template/version/mapping/package producers, source
ACLs, layout/CJK checks, synthetic integration and authorized real-case acceptance.

## Implementation checkpoint

SQL164, session/API/Storage handlers, strict DTOs and compact history UI exist in
the candidate worktree. Initial isolated SQL behavior passed001–161+164, which
is not contiguous release proof. The new profile producer renders the fixed
reviewed DOCX template; it does not enable arbitrary university rendering.
Native D3 source inspection is not a prerequisite for this manual-profile slice.

The actual Next production build with all three new routes passed
`01a09c0b35bf7261833961994cfec7ca`. The new create route explicitly traces the
fixed DOCX into standalone output. The existing transient route is still pending
same-slice retirement after the replacement's real browser/Storage proof.
CI command inventory includes the client/history test once in the ordinary React
group (not react-server); history updates retain every loaded older artifact.
Focused checks are not Auth/Storage/browser or managed-bucket acceptance.

Expanded isolated SQL proof passed with exit0 (`01a09c1173b67bc383150208ca8342ef`):
actual scoped-role create/publish/assign/revoke/restore, wrong-case denial,
confirmed historical source after a newer version, unhealthy/deleted sources,
expired grants/leases and expired sealed reconciliation. Migration164 was
unchanged; only the fixture expanded. Source/scanner/Storage metadata is synthetic
in this SQL proof, not actual uploaded bytes. The owned container was removed.

### Same-slice retirement inventory after replacement proof

- Remove `src/app/api/v3/student-cases/[studentCaseId]/profile-exports/route.ts`
  and `src/lib/server/student-profile-export-route-handler.ts`.
- Remove the old route matcher/use in `src/lib/platform-route-contract.ts` and
  old tracing key in `next.config.ts`; replace its route test with rejection.
- Remove `tests/student-profile-export-route.test.mjs` and its package/CI manifest
  entries; new artifact handler/DTO/Storage/history tests cover the replacement.
- Revoke both legacy producer RPC grants in forward164, keeping immutable161,
  its historical attempt rows and audit history. No fabricated ready rows.
- Replace the active `student_profile_exports_positive.sql` implementation proof
  and its focused-shell invocation with the persistent artifact outcome proof;
  retain historical documents/receipts instead of executing the retired producer.

Do not remove any of these until the real replacement proof is obtained. Before
merge, confirm no active route/import/grant falls back to the transient producer.
