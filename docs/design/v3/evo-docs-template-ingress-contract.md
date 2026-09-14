# D4 — private template ingress and trusted inspection receipts

2026-09-14, pre-code proposal. Owned branch starts at `e0e2f971`; reviewed
registry `355a4c5c` and native inspector `05f83e76` are integrated dependencies.
PR768 subsequently merged to main `c2ddd12d`; its tree is exactly the reviewed
`e0e2f971` tree, `d348c8d6df193bb02923c2d3db6c833d44755cec`.
Migration166 is reserved by root;165 stays byte-identical. This is not full D4,
template publication, rendering, migration/import or production acceptance.

## One authority and exact source

Extend the [registry](evo-docs-template-registry-contract.md) and
[native inspection](evo-docs-template-native-contract.md), not student uploads.
Existing session-authenticated reservation fixes organization, catalog ID/source
revision, template/version, expected revision, request ID, declared SHA256/size/
MIME and provenance. A reservation alone never permits source reads or publishing.

Migration166 adds a bounded ingress attempt and immutable outcome events, not a
second template registry. Session preparation requires live `catalog.import.manage`
and rejects staff preview. Server-only begin/seal/complete and explicit reconcile
bind the original active Auth user/membership and recheck S2 permission, catalog
revision, template revision/archive and exact version under the shared lock order:
organization → request → memberships → catalog → template → ingress attempt.
Service credentials are transport authority, never a substitute for that actor.

The request is admitted before reading file bytes. Bound the body to20MiB, copy
once, verify declared SHA/size/MIME, then run actual `scanBytesWithClamd` and
`inspectUniversityTemplate` on those captured bytes. Validate both returned source
bindings and the native policy/minimal manifest. No browser scan/inspection flag,
source key, manifest or inspector identity is accepted. No parser fallback in the
web process. Abort, timeout, unavailable scanner/inspector or malformed proof fails
closed before Storage. A hard request deadline and expiring claim fence late work;
exact deadline/admission limits will be fixed before implementation, not inferred
from HTTP client behavior.

Persist the source/proof seal before crossing Storage. Use the registry's random
version object key in separate private `platform-document-templates`, DOCX/PDF,
20MiB. One create-only upload (`upsert:false`), then full bounded private readback
and exact SHA/size/MIME equality. Final transactional validation creates the
immutable165 inspection receipt only after all current authority/source checks.
No overwrite, public bucket, signed URL or metadata-only success. Storage and SQL
are not one transaction; a response error cannot establish that a write failed.

## Cancellation, replay and reads

Persisted cancellation invalidates the claim. A cancelled/expired/stale worker
cannot seal or complete. Same request fingerprint replays its recorded identity;
different input conflicts. Replay still checks current access and source state.
An ambiguous upload or completion remains `unknown`; no automatic retry or new
inspection. Explicit reconciliation checks only the sealed object/proofs and
current authority, never substitutes new bytes or changes version identity.
Cancelled/failed/unverified objects remain private and ineligible for source reads.

Manager-only source preview/read uses a short-lived session grant, server consume
and post-read completion; exact stored bytes and current authority are rechecked.
Return `private, no-store`, `nosniff`, neutral filenames; passive PDF may be inline,
DOCX is an attachment. This is source access, not a rendered-layout preview.
Published-template selection keeps165's existing `catalog.read` contract.

Forward166 changes only the PDF inspection/mapping compatibility helper: actual
PDF manifests have `slots:[]` and pageSizes; reviewers define `pdf-N` rectangles
and manual flags. Keep exact page bounds, overlap and mapping-content constraints.
DOCX still requires a unique inspected `p-N` slot and its editable/manual rule.

## Approved image identity

Root approved controller-generated `EVO_RUNTIME_IMAGE_ID` in the existing sealed,
per-generation `candidate-app.env`, never the mutable operator env. It is the
verified Docker engine-native `.Image` / release `state.imageId`, with digest kind
`Dockerengine-image-id`; `imageConfigDigest` may differ and is not substituted.
The server-only reader accepts exact lowercase `sha256:<64hex>` plus exact
40hex `EVO_RELEASE_REVISION`, returning imageId, unprefixed imageSha256 and revision.
Missing/malformed identity or non-Linux native execution fails closed. No caller
argument, Git/asset-hash fallback, image socket or identity in child-parser env.
The separately owned release change generates the reserved key and checks actual
container env key uniqueness, identity equality to expected and `.Image`, and
runtime revision equality to the verified image. Local proof must inject the
actual inspected runtime image ID/revision.165 stores the prefixed image ID only
after actual scan and inspection. Delivery of that release binding is still a
dependency, not a claim that the current deployed image already supplies it.

## Public integration contract

`platform-university-forms.ts` owns server-only typed session wrappers for all
eight165 RPCs, plus `getPlatformUniversityFormManagerTemplates` and
`getPlatformUniversityTemplateInspection`. Manager listing includes unpublished,
pending and archived templates in20-item UUID-keyset pages for cold resume.
Inspection metadata exposes only exact version/hash, minimal slots/pageSizes and
safe receipt/state data; no private object keys, proof inputs or source text.
Root owns `v3/university-form-source.ts`, actions and the existing catalogue UI.

HTTP base: `/api/v3/university-forms/[templateId]/versions/[versionId]/source`.
POST takes bounded raw bytes, exact Content-Type, UUID `Idempotency-Key` and quoted
decimal `If-Match` revision, after session reservation. GET yields guarded verified
bytes; GET `/status` yields safe inspection metadata. POST `/cancel` and
`/reconcile` take exact `{request_id,expected_revision,reason}`. Mutations require
same Origin. No duplicate JSON reserve endpoint is needed for the session actions.
Public attempt states: prepared/processing/sealed/verified/failed/unknown/cancelled;
active or unknown responses use202, never a success banner. Error bodies contain
fixed codes only. Each distinct intent gets a new request ID; replay retains it.

## Proof and implementation boundary

Add typed session/RPC/HTTP adapters, bounded ingress and source/cancel/reconcile
handlers,166/SQL fixture, private bucket plan/check tool and focused tests. Record
actual integration inventory; preserve D3/export suites and dependency journals.
Synthetic SQL tests cover authorization/revocation, stale/catalog/archive races,
fencing, cancellation, replay/conflict, immutable receipts and PDF/DOCX rules.
Later isolated local proof must exercise the real reviewed Linux inspector,
ClamAV and private Storage, exact-byte readback and ambiguous-I/O reconciliation.
Use OrbStack preflight before every Docker operation; no real files, managed
bucket apply, provider, UI or deployment. Scoped tests are not a full gate.

Primary references: [Storage create-only/concurrent upload behavior](https://supabase.com/docs/guides/storage/uploads/standard-uploads)
(standard uploads support20MiB; TUS is recommended above6MiB, but the existing TUS
helper retries implicitly), [service-key RLS bypass](https://supabase.com/docs/guides/storage/security/access-control),
[PostgreSQL lock order/deadlocks](https://www.postgresql.org/docs/current/explicit-locking.html),
[OCI ImageID/config digest](https://github.com/opencontainers/image-spec/blob/main/config.md#imageid).
These references explain the contract, not proof of a running ingress.

## Implemented server checkpoint — actual combined proof pending

The handler captures at most20MiB/4096 chunks and permits one byte-processing
operation per process, with no internal queue. Overall upload lifetime is100s;
body25s, Storage upload20s/readback15s and each RPC10s have tighter limits.
Native/ClamAV retain their own existing bounds. Abort races terminate the caller
even if an external operation ignores cancellation; no next phase starts after
abort. Claim120s and single-use source grant60s are independently DB-fenced.
Status/cancel do not occupy the byte slot or require inspector configuration.
GET read and explicit reconcile reuse existing sealed proof, never re-inspect or
upload. A lost completion response requires status/reconciliation, not a second
automatic write. Cancelled/failed orphan objects stay private and are not deleted
by these request handlers; any future cleanup requires its own authorized scope.

The source catalog revision is a bounded revision label, not a SHA. The SQL
`p_inspector_revision`/165 field is the fixed native policy version; the separate
`p_runtime_revision` is the verified40-hex release revision. Docker image identity
retains the exact prefixed engine ID. No caller-supplied proof reaches the seal.

`npm run configure:university-template-storage` prints an offline plan without
reading credentials; `-- --check` performs only a fixed-project bucket read.
`-- --apply` is an independently authorized one-shot create of an absent private
PDF/DOCX20MiB bucket, never an update/policy/object mutation. No managed check or
apply ran here. New opaque secret keys use only `apikey`, while legacy service
JWTs also use Authorization ([official key behavior](https://supabase.com/docs/guides/getting-started/api-keys)).
Only object-specific NoSuchKey indicates missing bytes; generic404/bucket/access
failures remain unavailable ([Storage errors](https://supabase.com/docs/guides/storage/debugging/error-codes)).

Actual scoped parser/transport/method/manifest tests100/100 and strict server
TypeScript/lint passed (`01a09d0ddbe777e3953f19eb5cf1cf78`). HTTP success envelopes in
tests are explicitly transport fixtures, not service/native evidence. Corrected
DOCX SQL regression went RED (`01a09d0cf04379a1975c7671268bbfec`) then contiguous
001–166 GREEN (`01a09d0ddc877af0aa8831ae73769755`), with owned container cleanup.
Inventory: CI332 occurrences/193 unique/139 duplicates; unit230/188/42. These
checks do not prove actual ingress, full D4, provider, UI or production readiness.
## Bounded integrated acceptance transport (pre-execution)

Independent HTTP review corrected cancellation accounting: an aborted response
does not release the single byte-operation lease while a started ClamAV/native
promise remains unsettled. The actual deferred-negative-scanner regression was
RED (`01a09d15ae3e74d1a39782abf5734434`) then21/21 route checks GREEN with lint
(`01a09d15f3c779528b7914c12e118718`); it makes no successful inspection claim.

`--university-template-ingress-only` reuses the foundation harness's one local
Supabase/Auth/ClamAV stack. The browser talks only to the exact production image
published at `127.0.0.1:<owned-port>`; it does not execute ingress on host Next dev.
The application container joins the already inspected run-owned Supabase bridge.
A bounded, acceptance-only Node bootstrap forwards its loopback port8000 to the
exact run-owned Kong container port8000, with no caller-selected destination.
The existing scanner joins that same bridge and is addressed by its validated
owned name/3310. Production Supabase URL validation remains unchanged: the app
receives `http://127.0.0.1:8000`, never an arbitrary insecure network hostname.

Image identity comes only from actual Docker inspection of the frozen production
image; native architecture, OCI revision, acceptance-parent/runtime equivalence,
actual application `.Image`, exact revision/image environment uniqueness and
loopback port binding are mandatory readbacks. Only non-secret identity may be
placed in Docker configuration; local credentials enter once over bounded stdin
and remain in process memory. No provider credentials are allowed. The immutable
production filesystem stays untouched; only bounded `/tmp` and Next cache mounts
are writable. The common cleanup owns only the exact app/scanner/local-project
resources and verifies absence before publishing the receipt. Preparing this
harness is not execution or fullD4/business acceptance.

Primary transport references: [Docker bridge DNS and network isolation](https://docs.docker.com/engine/network/drivers/bridge/),
[explicit loopback port publishing](https://docs.docker.com/engine/network/port-publishing/),
and [Node TCP servers and clients](https://nodejs.org/docs/latest-v22.x/api/net.html).

### One explicitly authorized lost-reply fault

The acceptance-only loopback proxy may lose exactly one successful create-only
PDF upload response. Its fixed target remains the already-owned Kong/8000. It
must first observe actual200/201 from Storage, then perform a private GET of the
same exact object and verify SHA256, byte length and MIME against the forwarded
POST before closing the application-facing response. No response/DB/status is
fabricated. A fixed marker is emitted only after verified readback; any mismatch
leaves recovery acceptance failed/pending. The browser then observes real unknown
and explicitly reconciles to verified. This fault is not a production feature,
retry or fallback. No other request is faulted; ordinary requests pass through.
The proxy uses [Node HTTP message completion and socket destruction](https://r2.nodejs.org/docs/latest-jod/api/http.html);
timeouts destroy the request explicitly rather than treating a timeout event as
completed work. The committed product adapter remains unchanged by this harness.

Prepared entry point: `scripts/test-postgres-v2-foundation.sh --university-template-ingress-only`.
It requires the same `EVO_D3_COMBINED_IMAGE`, `EVO_D3_ACCEPTANCE_IMAGE` and frozen
revision binding used by the shared image-pair gate. No image is built by this
mode. The browser helper is `scripts/lib/university-template-ingress-browser-proof.mjs`;
root may extend this one helper with reviewed mapping/preview/publication steps.
Its current receipt explicitly keeps `fullD4Acceptance`, `businessAcceptance`
and `providerAcceptance` false.50/50 scoped checks/lint/shell syntax passed
(`01a09d2257817730ae0b8a82e21328e2`), not the actual integrated workflow.

Pre-execution review caught the different receipt keys: inspection metadata
uses `receipt_id`; ingress command receipts use `inspection_receipt_id`.
The helper now compares those actual normalized shapes. Both regressions were
RED before correction;52/52 scoped checks, lint and shell syntax are now GREEN
(`01a09d37594c72d1a676cedb2607d07c`). Actual integrated execution remains pending.
