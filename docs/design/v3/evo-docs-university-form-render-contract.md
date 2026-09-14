# D4 — isolated saved DOCX/PDF form rendering

2026-09-14. **Pre-code proposal; independent review and root approval required.**
Native baseline: `c35a1fd3d871177f49ea76668a162be4c9d145d3`.
Persistence/host authority: the independently reviewed saved-form amendment in
[forms/packages](evo-docs-university-packages-contract.md), published as
`658dc151bc3b674e719e125fe4e28c2cbb62b7e6`. Its `FormInput`, `BoundTemplate`,
`FormReceipt`, `RendererProof`, hashes and lifecycle are normative aliases below.
This contract supplies that amendment's missing native framing/resource seam;
it does not revise164/165/166, history v1, Auth, Storage or package rules.

## Scope and existing evidence

Produce a complete DOCX **or** PDF, preserving the source format, from the exact
private source and confirmed frozen profile. Extend the single immutable
`/opt/evo-university-template-runtime/launcher`; no converter service, second
runtime, document parser in Next, network, writable workspace or arbitrary path.
Use [ADR0028](../../adr/0028-unify-document-automation-inside-evo-platform.md),
[native isolation](evo-docs-template-native-contract.md) and the existing
[page renderer](evo-docs-template-page-render-contract.md). PNG mapping aid is
not a saved form, DOCX-to-PDF conversion, layout approval or trusted seal.

Source evidence at baseline:

- `university-form-docx.ts` already inspects, fills and reopens bounded DOCX;
  `university-form-pdf.ts` fills passive PDF with a verified embedded Noto font.
- `university-form-fields.ts` resolves mappings and guards assignments using a
  process-local WeakSet. A serialized resolution is not trusted input.
- `scripts/university-template/fill-proof.mjs` is test-only PDF fill-to-PNG;
  production has no saved-form operation. The164 host producer is profile-only.
- Existing inspect/source-preview JSON outputs, 128 KiB/10-row limits, D3
  4096-byte output, page `--render-page-v1`/EUP1 and receipts stay unchanged.

Prior native amd64 proof is retained, independently reviewed, **not rerun here**:
`/tmp/evo-d4-amd64-plan.p3UxCP/amd64-artifacts/NATIVE_AMD64_PROOF.md`, SHA256
`05bcc8995c1e6f072eecb493d88338b6dbb81eb7be1a2549aba7e1ee97aed7be`;
remote copy `/var/tmp/evo-d4-amd64.styqED/artifacts/NATIVE_AMD64_PROOF.md`.
Proof manifest SHA256 `fa0a479b528d575ffc2826af2e38a41e8b753e904795929ea3d8e750c24df944`:
native x86_64 D3 **12/12**, template **33/33**, two asset-corruption controls,
20 hashed/personally inspected PNGs and scoped cleanup. Template image was
`sha256:c8c3de9a43fb5d914312d3a0e08b6d05d94f4415fd325a301f8e22935771325a`.
This supersedes the older journal's “amd64 unrun” status only for c35's narrow
slice, not this new full-size form transport, integration, full D4 or production.

## Server API and input frame

Proposed export in `src/lib/server/university-template-preflight.ts`; types and
closed guards in new pure `src/lib/university-form-render.ts`. These signatures
are specifications, not currently executable APIs:

```ts
type FormRenderBinding = {
  artifactId: UUID; preparationId: UUID;
  inputSnapshotSha256: Hex; generatedInputSha256: Hex; fieldReviewsSha256: Hex;
};
renderUniversityForm(
  input: { bytes: Uint8Array; formInput: FormInput; binding: FormRenderBinding },
  options: { signal: AbortSignal },
): Promise<
  | { status: "rendered"; metadata: FormRenderMetadata; bytes: Uint8Array }
  | { status: "rejected"; code: FormRenderFailure }
>;
```

Only the authenticated producer obtains `FormInput` from prepare and the exact
template GET from begin. Browser values, rendered assignments, Storage paths,
claim tokens, source URLs, image IDs and credentials are absent from this API.
The adapter captures its own byte copy and closed normalized input before any
await. A shared existing runtime admission lease is acquired before large
copies; contention fails `source_unavailable`, without a queue or extra child.
The host author must add one form-job memory lease per app process before source
GET and hold it through upload/readback settlement (also after HTTP abort). That
form-only admission is not present in the baseline164 profile producer; it bounds
retained artifacts after the native lease ends, without a second runtime/store.

Invoke exactly `launcher --render-form-v1`, a new fixed university-build mode.
Request is one **EUFQ** frame, not newline JSON/base64 or an EUP1 variant:

```text
ASCII "EUFQ" | uint32BE capsuleLength | uint32BE sourceLength
UTF-8 capsule JSON | sourceLength raw source bytes | EOF
```

Capsule is the exact closed object
`{operation:"render-form-v1", binding:FormRenderBinding, formInput:FormInput}`.
`capsuleLength` is1–2097152; `sourceLength` is1–20971520 and equals
`formInput.source_byte_size`. The parser validates both lengths before allocation,
reads exactly them, then requires EOF. Total maximum is **23068684 bytes**.
Trailing byte/frame, truncation, BOM, invalid UTF-8, unknown/duplicate keys,
nonliteral enums, arrays where records are expected and invalid numbers reject.

Canonical capsule encoding: recursively sort object keys by ASCII key order,
retain array order, encode primitive values with `JSON.stringify`, no whitespace.
All schema keys are ASCII; numeric values must meet their existing finite/safe
range constraints. Child validates the closed schema, reserializes and requires
byte equality. Thus alternate number spelling, duplicate keys or escapes do not
create multiple wire representations. This is a private transport encoding,
**not** PostgreSQL `jsonb::text`, mapping hash or RFC8785.

`capsuleSha256 = SHA256(UTF8("evo-university-form-request-v1\u0000") || capsuleBytes)`.
Both child and adapter compute it. Source bytes are bound through independently
recomputed source SHA/length and exact minimal manifest. Do not persist this
transient digest in `RendererProof` or replace existing hashes with it.

The2 MiB JSON budget is new only for form input: registry mapping JSON already
permits1 MiB, minimal manifest fits128 KiB, and FrozenProfile164 has61 fixed
fields (at most500 code points/value, smaller country/date caps, no proposals).
Even conservative JSON escaping leaves ample metadata headroom under2 MiB.
The old511-byte inspection header cannot carry these inputs. This does not
increase source, expanded archive, output, inspect or preview budgets.

## Child validation, resolution and rendering

Install the same no-exec TSYNC seal before reading request bytes or loading
the form entrypoint. All phases below run in that **one child**:

1. Validate exact published `FormInput`/binding schemas, profile/case IDs,
   template/version/source MIME and size, `form`/mapping/review IDs+SHA tuples,
   renderer policy/font expectation and real UTC `validation_day`. No current
   wall-clock substitution: the supplied day is DB-bound, rechecked by SQL.
   Require approved mapping/review for draft too. The child does not claim DB
   publication, actor permissions or receipt existence; host/SQL own those facts.
2. Validate FrozenProfile164 with `normalizePlatformStudentProfileFieldsSnapshot`;
   additionally require initialized profile, exact61 ordered fields,
   `can_initialize=false`, `can_review=false`, `can_export=true`, proposals=[],
   and nonconfirmed value/source version/source page all NULL. Preserve original
   review states/reviewed timestamps; do not upgrade state, discard conflicts,
   consult a provider or apply D2's unrelated nine-required-field readiness gate.
3. Recompute source hash; inspect the captured bytes with the existing format
   inspector. Compare the **whole ordered minimal projection**, not a subset,
   with `BoundTemplate.manifest`. Compute the separate native `manifestDigest`
   over normalized `JSON.stringify({format,slots,pageSizes})`, as in page-preview.
   The persisted166 `manifest_sha256` uses bw1 instead; do not equate them.
   PDF has `slots:[]`, actual geometry;
   DOCX rich text/context/kind/manualReason come only from these bytes. Never
   fabricate rich slots from the SQL manifest or return them as proof metadata.
4. Recompute `computePackageGeneratedInputHash` over the exact published
   projection, using `fieldReviewsSha256` from the bound receipt; require equality
   with `generatedInputSha256`. Recompute canonical mapping hash through the
   existing resolver; exact review tuple must match. Deep-freeze the reconstructed
   rich template, mapping, review and normalized profile fields; call
   `resolveUniversityFormMappings` with `today=validation_day`.
5. Call `getUniversityFormAssignments` inside this child. Final requires
   `fieldsReady`; draft includes only confirmed assignments. DOCX calls real
   `fillUniversityDocx(source, assignments, {draft})`; PDF calls real
   `fillUniversityPdf(source, resolution, {draft})`. No host resolution brand,
   caller assignment, stale cached fill or cross-process resolution serialization.
6. Check generated bytes1–20 MiB. DOCX's existing output reopen proves ZIP/XML
   integrity; PDF reinspection of the serialized output must prove passive,
   bounded content and unchanged actual page count/geometry. Inspect **output**,
   not just the in-memory pre-save PDF. Compute output SHA256 only after success.
   There is no streaming partial artifact or success before these checks.

`inputSnapshotSha256` (bw1 FormInput), `fieldReviewsSha256` and the persisted
`formInput.manifest_sha256` remain opaque
trusted **DB** bindings. No Node PostgreSQL serializer exists in this baseline;
echoing them is not independent verification. Host compares session preparation,
begin receipt and all capsule/receipt fields; SQL seal binds immutable snapshot
digests to artifact+claim. The separately computed capsule digest proves which
exact input the native job consumed. Package hash and mapping hash remain their
existing distinct algorithms, with TS/SQL parity vectors; no silent hash migration.

## EUF1 result, identity and trusted seal

One **EUF1** frame, with a dedicated parser; never accept PNG-only EUP1:

```text
ASCII "EUF1" | uint32BE metadataLength | uint32BE outputLength
UTF-8 metadata JSON | outputLength raw DOCX/PDF bytes | EOF
```

Metadata1–4096 bytes; success output1–20971520 bytes; maximum frame **20975628**.
Rejection has outputLength0 and exact `{status:"rejected",code:FormRenderFailure}`.
Success metadata is this closed object, all keys mandatory:

```ts
type FormRenderMetadata = {
  status: "rendered"; policyVersion: "evo-university-form-render-v1";
  artifactId: UUID; preparationId: UUID;
  capsuleSha256: Hex; inputSnapshotSha256: Hex; generatedInputSha256: Hex;
  fieldReviewsSha256: Hex; templateSha256: Hex; sourceByteLength: number;
  manifestSha256: Hex; manifestDigest: Hex;
  mode: "draft" | "final"; mimeType: DOCX | PDF;
  rendererVersion: "evo-university-form-docx-v1" | "evo-university-form-pdf-v1";
  rendererId: "pizzip-3.2.0-xmldom-0.9.12" | "pdf-lib-1.17.1-fontkit-1.1.1";
  fontSha256: Hex | null; pageCount: number | null;
  outputByteLength: number; outputSha256: Hex;
  counts: { confirmed: number; confirmed_empty: number; missing: number;
    unconfirmed: number; conflict: number; invalid: number; manual: number };
  warnings: ("layout_review_required" | "manual_fields_unchanged"
    | "unresolved_fields_omitted" | "draft_notice")[];
};
```

Count each mapped slot exactly once by resolver state: nonnegative integers,
sum=mapping count (1–3000 DOCX,1–500 PDF). `pageCount` is1–100 for PDF, NULL for
DOCX (no layout engine).
Warnings are unique, lexically sorted fixed codes, never source/library text:
layout review always; manual warning iff manual count>0; omission iff any of
confirmed_empty/missing/unconfirmed/conflict/invalid counts>0; draft iff draft.
Manual counts describe mapped slots, not every manual area in the source.

Adapter checks frame lengths/EOF, strict UTF-8/closed DTO, every echoed binding,
computed capsule/native-manifest/output digests, exact MIME-policy-renderer-font combination,
counts and warning consistency. It checks only fixed byte signatures (ZIP local
header / `%PDF-`), never parses DOCX/PDF in Next. Body remains private, metadata
deeply immutable. No raw source/value, XML, parser diagnostic or HTML crosses
in metadata, logs or audit. Generated bytes necessarily contain confirmed values.

`rendererId` is the exact existing lockfile engine revision, not a Docker ID.
PDF child actually hashes the shipped Noto font and requires
`b85c38ecea8a7cfb39c24e395a4007474fa5a4fc864f6ee33309eb4948d232d5`;
DOCX `fontSha256=null` means preserved declarations, not embedded-font proof.
Build bundles the production fill entrypoint under a fixed nested path preserving
the existing relative `FONT_PATH`, ships only required read-only Noto/OFL assets,
and records their hashes with bundle hashes in build evidence. No dependency
upgrade or new font is proposed; existing PDF.js/canvas remains for page rendering.

The **host**, not child/request, calls `readUniversityTemplateRuntimeIdentity()`
before and after execution; require the same valid controller-supplied tuple.
Only after a normal, fully verified result may the host construct the published
`RendererProof={image_id:identity.imageId,release_revision:identity.revision,
font_sha256:metadata.fontSha256}` and call the existing extended trusted seal.
Engine-native full `sha256:` identity is not166's bare inspector digest, OCI config
digest or a hash of revision. Missing/changed identity means no seal. Child cannot
attest its Docker image, and supplied identity is never called self-attestation.
Seal stores exact output hash/size/proof once; create-only Storage/readback/ready,
unknown reconciliation, historical downloads and live scope stay in164's owner.
No proof at prepare; no regeneration during download or reconciliation.

## Failure, manual, draft and font behavior

`FormRenderFailure` is exactly `invalid_input | binding_mismatch |
template_not_eligible | form_not_ready | text_overflow | character_unsupported |
shaping_unsupported | output_too_large | source_unavailable`.

- Invalid framing/closed schema → invalid_input; source/manifest/mapping/review/hash
  mismatch → binding_mismatch; passive-source structural rejection → template_not_eligible.
- Final uses exact existing `fieldsReady`: each item must be confirmed or an
  optional confirmed_empty/missing item. Manual (even optional), unconfirmed,
  conflict or invalid items block final. Malformed mapping/geometry is rejection
  in draft too, not an omission.
- Existing PDF overflow/glyph/shaping exceptions map to their fixed codes; known
  output-size rejection maps to output_too_large. Never truncate text, reduce
  below8pt, replace missing glyphs, transliterate, silently fall back or clip.
- Missing native/font/runtime identity, unexpected exception/library warning,
  crash, signal, timeout, output corruption, protocol failure on stdout or abort
  → source_unavailable. Recognized inspector advisory strings are not parser
  failures; keep them private and derive only the fixed warnings above. Any actual
  parser warning/error diagnostic rejects rather than quietly producing a file.
- DOCX retains paragraphs/tables/styles/header/footer/section structure; manual
  signatures, consent, photos, checkboxes and complex fields stay unchanged.
  Draft uses existing all-section/header notices. Font declarations do not prove
  installed fonts, line wrapping or page layout in the recipient's office app.
- PDF validates **all** human regions including omitted/manual ones for bounds,
  overlap and character cells against actual visible CropBox origins. Preserve
  source graphics; embed fixed Noto,8–11pt existing metric/ink fit,<=50000 rendered
  code points. Unsupported CJK/shaping values reject; embedded CJK in the source
  is a different raster compatibility fact. Draft marks every actual page.

Host persists only its published failure union: form_not_ready and the three
value/layout codes → `form_not_ready`; binding_mismatch/invalid_input/output
integrity mismatch → `integrity_failed`; template_not_eligible → `source_unavailable`;
output_too_large/native unavailable/timeout → `export_failed`. Auth/current-source
changes remain host/SQL `access_changed`/`source_changed`, never guessed by child.
No bytes or success proof survives any failed result.

## Resource and lifetime contract

Explicit form budgets, **not an accidental inheritance of inspection stdout**:

| Boundary | Form limit / behavior |
|---|---|
| Source / capsule / result |20 MiB /2 MiB /20 MiB; independent frame lengths above |
| Child OS | AS2 GiB, CPU10s, core0, FD64; unchanged Landlock/seccomp TSYNC/PDEATHSIG/no-exec |
| Node | old-space256 MiB, V8 pool1, trap-handler disabled; unchanged clean env |
| Supervisor |15s monotonic total from before fork, including input, computation, wait and output delivery |
| Host adapter |16s total; abort/timeout SIGKILLs supervisor; await actual close before lease release |
| Native harness | serial CPU2 / memory3 GiB / no swap / pids128 / network none / read-only / cap-drop ALL / no-new-privileges |

CPU/wall/AS remain deliberately unchanged **as candidate hard ceilings**. Existing
native PDF fill+PNG fits them; that is not evidence for near20 MiB DOCX/PDF output.
Mandatory capacity measurements below decide support. If valid boundary fixtures
cannot pass, record actual phase/CPU/RSS/wall, stop and obtain a reviewed limit
amendment; do not quietly reduce the20 MiB product ceiling or relax isolation.

Preserve DOCX20 MiB ZIP/50 MiB expanded/512 entries/20 MiB per entry/5 MiB each XML/
20 MiB total XML/3000 paragraphs/1000 code points per assignment. Preserve PDF
100 pages/30000 objects/72–3000pt geometry/500 regions and passive-content guards.

No polling loop may block indefinitely. Child reads bounded exact frames; host
writes at most64 KiB per chunk and honors write(false)→drain, abort/error/close
and the same deadline. Capture stdout concurrently. Supervisor buffers at most
the one frame+one overflow sentinel on heap, never stack; withholds it until
child exit0+EOF. Then use the existing nonblocking short-write/EINTR/EAGAIN/poll
delivery loop, including its deadline. If delivery already started then fails,
close/fail; never append a second rejection frame to partial success.

Adapter retains one bounded output allocation plus small framing/chunk overhead;
avoid Buffer.concat duplicating the whole source/result, and never decode binary
as text/base64. At most one2 MiB capsule and one20 MiB source capture per job;
library copies/expanded structures live inside the child AS bound. Renderer APIs
produce a whole buffer, so streaming serialization or disk spooling is not assumed.
Report peak child RSS and host transport RSS, not merely V8 heap. Cancellation
removes listeners/timers once, closes pipes and releases input/output references
only after settlement; no early lease release or detached surviving descendant.

## Required validation and implementation ownership

Run the following on the **same frozen candidate** per native architecture;
retain exact commands, image IDs, byte/hashes, wall/CPU/RSS and zero-skip counts.
No emulation: native arm64 on preflighted OrbStack; native amd64 on the explicitly
authorized native host only. Prior c35 results are provenance, not these results.

| Gate | Required actual evidence |
|---|---|
| Closed DTO / binding | full frozen61-field capsule; SQL/TS package hash vectors; whole manifest change; source byte/size/MIME drift; mapping/review/day/profile tuple drift; duplicate/nested-array/null keys; post-dispatch caller mutation; bw1 echo not claimed as recomputation |
| EUFQ/EUF1 transport | both formats, fragmented input/output, invalid UTF-8/BOM/duplicate keys; bad magic/length/hash/trailing bytes; exact2 MiB capsule bound and+1; exact20 MiB output frame and+1; reject EUP1; no partial success on child fail |
| Real full-size fill | passive DOCX and PDF output each19.5–20 MiB with incompressible synthetic image content, decoded/reopened independently inside isolated test runtime; actual input/output sizes+SHA; >20 MiB output rejection; large legal mapping/profile and format structure limits; no “large padded request only” substitute |
| Lifecycle / isolation | all existing D3 12 and template33 checks; form cross-mode contention; missing/tampered font/bundle; missing seal; parent death; CPU/AS/wall gates; stalled stdin/stdout; abort before/during/after fill; subsequent valid job; no lingering PID or lease |
| PDF output / pages | source/final/draft standard+long values on every portrait/landscape/cropped/fractional page; Ө/Ү/Ң Latin/Cyrillic; source CJK/Type3/CMap/JPEG/JPX/mask fixtures; untouched manual areas; no clipping; glyph/shaping/overflow/overlap/off-page negatives; passive output reopen then existing isolated page renderer |
| DOCX output / sections | synthetic tables/merged cells/style/headers/footers/even/first-page sections; final/draft standard+long Latin/Cyrillic/Ө/Ү/Ң; unchanged manual areas; XML/package guards, deterministic repeat hash; actual opened office-rendered pages and all draft section notices, not XML-only layout approval |
| Host/SQL integration (separate owner) | both formats: real Auth→source GET→native→seal→create-only Storage→hash readback→ready history v2→cold download/reconcile; old profile history v1; stale/revoked/ambiguous-storage negatives; same real output identity preserved through seal/reconcile |

Retain all synthetic original/filled DOCX/PDF and every PDF-page PNG for visual
review. DOCX office-app inspection is a validation tool, not a new production
converter or server. If no approved actual office renderer is available, record
that visual gate as open; do not equate OOXML integrity with layout fidelity.
Near-limit timing, peak buffers, complex-font coverage and office layout remain
unmeasured for this operation. No production enablement until required native
and host/Storage gates are separately proved.

After review/approval, native author owns shared launcher fixed-mode dispatch,
`scripts/university-template/{render-form,build,test-harness}.mjs`, minimal parser
port adjustments if required, the existing preflight adapter/shared lease, new
pure render DTO and focused tests/runtime asset packaging. Changes to shared C
require D3 regression proof. Root/assigned authors own DTO aliases from the saved
producer, SQL167, identity/controller, HTTP orchestration, Auth, Storage, UI,
packages and combined acceptance. Agree exported type file ownership before
code; no duplicate store, session reader, exported resolver brand or authority.

## Official references checked for this proposal

Context7 returned monthly-quota exhaustion; official primary sources were read
directly. These explain API behavior, not runtime acceptance:

- [Node22.23.1 child process close/error and bounded pipes](https://nodejs.org/download/release/v22.23.1/docs/api/child_process.html#event-close): close follows process exit and closed stdio; signal delivery alone is not settlement.
- [Node22.23.1 writable backpressure](https://nodejs.org/download/release/v22.23.1/docs/api/stream.html#event-drain): stop writes after false and resume on drain; buffering is not a memory limit.
- [Pinned pdf-lib1.17.1 save implementation](https://raw.githubusercontent.com/Hopding/pdf-lib/v1.17.1/src/api/PDFDocument.ts) and [API](https://pdf-lib.js.org/docs/api/classes/pdfdocument#save): save resolves a complete Uint8Array; font embedding is explicit.
- [Pinned PizZip3.2.0 generator](https://raw.githubusercontent.com/open-xml-templating/pizzip/v3.2.0/es6/object.js) and [nodebuffer generation](https://open-xml-templating.github.io/pizzip/documentation/api_pizzip/generate.html): full archive materialization; no assumed streaming writer.
- [PostgreSQL17 JSON representation](https://www.postgresql.org/docs/17/datatype-json.html): jsonb normalizes representation; ordinary JSON serialization is not an interchangeable digest encoding. The repository's bw1 function, not this documentation, defines its hash bytes.
