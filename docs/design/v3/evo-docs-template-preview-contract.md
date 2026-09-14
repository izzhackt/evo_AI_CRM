# D4 — readable source context for mapping

2026-09-14, root-approved pre-code contract. Based on `abcbf3ac`; root read and
approved this protocol, including clipping metadata, before implementation. This extends the existing native
template runtime and [D4 registry](evo-docs-template-registry-contract.md).

## Gap and ownership

The trusted receipt intentionally contains only paragraph IDs/editability and
PDF page geometry. An operator cannot reasonably map `p-47` without the nearby
source label. The existing `inspectUniversityDocx` already produces text,
context, kind and manualReason; invoke it only inside the existing isolated
runtime. This lane owns its typed read-only preview operation, adapter, focused
tests and documentation. Root owns staff routes/actions/UI; the ingress lane
owns166, source authorization and private byte retrieval. No166, source route,
UI or release-controller changes belong to this lane.

## Exact protocol

- Preserve the existing inspection request/output, `evo-university-template-v1`,
  128KiB output ceiling and165 receipt schema byte-for-byte. Preview is a
  separate operation in the same fixed runtime, not another launcher/runtime.
- The new request is one JSON line with exactly `{operation:"source-preview",
  byteLength,expectedSha256,mimeType,offset}` plus the same exact frozen bytes.
  Only DOCX is accepted. Offset is an integer from0 through2999 and must select
  an existing paragraph. Page size is fixed at10; no executable, path, limit,
  environment or parser setting is caller-configurable.
- Success has exactly `{status:"preview",policyVersion:
  "evo-university-template-preview-v1",sha256,byteLength,mimeType,manifestDigest,
  offset,totalSlots,nextOffset,slots}`. `nextOffset` is the next index or null.
  Rows are exactly `{id,text,context,kind,editable,manualReason,truncated}`.
  IDs and editable values must match the corresponding trusted manifest rows.
  Kinds use the existing `blank|label` union. Text<=1200 UTF-16
  code units, context<=600, manualReason null or<=240. `truncated` is true
  whenever text, label, nearby context or manualReason was clipped at any stage.
  Preserve private clipping metadata before the existing inspector slices;
  expose it only in preview, leaving the minimal inspection output unchanged.
  Strings are data for escaped text rendering,
  never HTML, Markdown, links, style, file paths or executable instructions.
  Worst-case JSON escaping stays under the unchanged128KiB bound.
- Rejected responses retain the exact existing fixed-code rejection shape.
  Invalid mode/offset, PDF preview, malformed source or hash mismatch fail
  closed. Do not expose parser diagnostics or source text in errors/logs.
- Adapter `previewUniversityTemplateSource` accepts frozen bytes, exact source
  SHA/MIME, trusted `expectedManifest` and offset, plus AbortSignal. It strictly
  validates the manifest, computes SHA256 of the normalized UTF-8 JSON
  `{format,slots,pageSizes}`, and checks the child's `manifestDigest`. The child
  computes that digest from the complete newly inspected source, not the page.
  This transient digest is explicitly distinct from165's JSONB receipt digest;
  no persisted digest algorithm changes. Source SHA/size/MIME, policy, offset,
  total/count/nextOffset, row IDs/editability and all exact keys are checked.
- Reuse one shared admission lock for inspection and preview, the fixed
  `/opt/evo-university-template-runtime/launcher`, clean environment, ignored
  stderr,16s adapter deadline and current hard-isolation/OS limits. No parser
  imports in the Next process, network/private filesystem access, weaker
  platform fallback or new dependencies.

## Integration and evidence boundary

The staff source-preview route must retrieve verified original bytes through
the current session and compare the live trusted inspection metadata for the
exact template/version/hash. Only a current permitted manager sees source text;
no client-provided manifest, Student DTO, receipt, DB persistence or broad cache.
Recheck live access after processing before delivering text, as source download
does. Root will render ordinary escaped strings with an explicit excerpt/layout
limitation. PDF mapping instead uses actual inspected pageSizes and the guarded
original PDF; this operation discovers no PDF slots or font/layout evidence.

## Scoped proof

Adapter tests cover exact binding, invalid output, malformed/oversized rows,
pagination, tampered manifest and source, abort/concurrency, and unchanged
inspection behavior. Actual synthetic DOCX requests through the reviewed Linux
launcher must prove labels/table context/manual areas, second/last page,
3000 paragraphs, Unicode/escaping, long paragraph/label/nearby clipping and
unchanged minimal inspection. Run the
existing narrow runtime target only after exact OrbStack preflight; preserve its
OS denial/resource tests. No full Next/production build: root coordinates the
single combined image/Auth/Storage/browser proof. No real/client files, managed
changes, Gemini, invitations, WAHA or deployment.

Official references checked for this proposal: [Node22 child-process pipes and
close lifecycle](https://nodejs.org/download/release/v22.23.1/docs/api/child_process.html)
and [Landlock irreversible restrictions](https://docs.kernel.org/userspace-api/landlock.html).
The child-process API is transport; the unchanged native supervisor/seal is the
isolation boundary. A working text preview is neither a malware receipt nor a
layout approval, publication or full D4 acceptance.

## Implemented interface and bounded local proof

`src/lib/server/university-template-preflight.ts` exports
`previewUniversityTemplateSource({bytes,mimeType,expectedSha256,expectedManifest,offset},
{signal})`. Its result is `UniversityTemplateSourcePreviewResult`: the exact
`status:"preview"` DTO or the existing fixed `status:"rejected"` union. The pure
success DTO and page-size constant are in `src/lib/university-template-preview.ts`.
`expectedManifest` must come from the live trusted source metadata, never from
browser input. Both operations use the same supervisor and admission lock.

Actual local proof on2026-09-14:

- 18/18 scoped DOCX + adapter/DTO checks and scoped lint passed
  (`01a09d13620d70e1aebe51e00308cb5b`). Strict adapter/DTO TypeScript and diff
  checks passed (`01a09d13a65071b19e5e52ef299148da`).
- 17/17 actual narrow Linux arm64 runtime checks passed in37.2s
  (`01a09d14db9a75a1a2924bfeac777eb4`), including existing network/files/FD/env,
  seal/no-exec, memory/output/CPU/wall, parent-death and cancellation proofs.
  DOCX preview covers first/second/last pages,3000 paragraphs, context/manual
  reasons, prior clipping, Unicode and off-page manifest mutation. Original
  DOCX/PDF inspection remains minimal and unchanged.
- OrbStack Running/orbstack/local-unix-socket checks preceded the runner and
  every container operation. Exact test image:
  `sha256:cc5bd0ded17a48df396f44ee1fbbf0ab589e016a5a8011b7c1609e4879c4ccbd`.
  Owned container `evo-university-template-proof-f0883b58f7e2474cbfc71f7fd8bf913f`
  was removed and its absence verified by the runner.

No C supervisor/seal/bootstrap, SQL, HTTP, UI, dependency or production code
outside this bounded adapter/runtime change was modified. No full Next/app image
build or real/private document processing ran. Independent review, root-owned
source authorization/UI wiring and combined Auth/Storage/browser acceptance
remain required before claiming a usable released workflow.

Independent implementation review identified one coercion flaw in the pure DTO
guard: `String(row.kind)` admitted arrays. The correction uses exact `blank|label`
literal comparison and removes the cast. Actual focused7/7 tests, including
array/nested-array/object/null rejections, lint and strict TypeScript passed
(`01a09d1c607d7f11bae31a0fd5ff0938`). Native OS/image tests above precede this pure
guard correction and were not repeated; they are not a new image claim. Exact
corrected-diff independent review remains pending.
