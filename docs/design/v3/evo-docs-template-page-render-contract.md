# D4 — isolated PDF page rendering for region mapping

2026-09-14. **Root-approved contract; bounded native arm64 evidence below.**
Research baseline: `50b35187b8afe941bddde92e6dc868a37b3cef07`.
Root fully read and explicitly approved contract SHA256
`980d4f745c7332e3302a737fc15569da3bbf6279705b5ad5fd6cc25ec43c5073` before code.
At approval PDF.js 6.3.289 + canvas 1.0.9 was an unproven runtime candidate.
The bounded native implementation assignment starts with an actual post-seal
addon/PNG check on native arm64, then the full narrow gate including shared D3.
See the approval entry in [PLAN_CHANGES](../../PLAN_CHANGES.md).

## Goal and unchanged authorities

Give a permitted staff manager an actual image of a PDF page on which to select
text regions. The existing browser-native iframe does not expose a controlled
page viewport. DOCX [source-preview](evo-docs-template-preview-contract.md) is
readable text context, not a PDF layout substitute. This operation extends the
existing [native runtime](evo-docs-template-native-contract.md) under the
[D4 forms/packages contract](evo-docs-university-packages-contract.md) and
[ADR0028](../../adr/0028-unify-document-automation-inside-evo-platform.md).

- Preserve receipt165/166 semantics, original inspection request/output,
  `evo-university-template-v1`, and its 128 KiB output limit. Preserve DOCX
  source-preview, its 10-row/128 KiB limits and its separate transient digest.
- PDF inspection still returns actual `pageSizes` and **`slots: []`**. Rectangles
  are reviewer-defined mappings, never facts discovered by this rasterizer.
  PNG generation creates no slot, review, publication or export receipt.
- Use the same immutable template runtime, fixed launcher, hard OS boundary
  and shared admission lock. No parser import in Next, external converter,
  second product runtime, network, arbitrary source path or writable workspace.
- This transient PNG is a mapping aid, not a font/color/layout certificate,
  malware receipt, approved mapping, generated form, completed package or
  business acceptance. Full D4 still requires usable region mapping, actual
  generated forms/packages and their separate authority/acceptance gates.

## Pinned candidate and packaging

Read-only npm metadata on 2026-09-14 returned `pdfjs-dist` **6.3.289**
(Apache-2.0, Node `>=22.13.0 || >=24`, optional canvas `^1.0.0`) and
`@napi-rs/canvas` **1.0.9** (MIT, Node `>=10`). Pin both exact versions and lockfile
integrities, not those ranges. Node 22.23.1 meets the declared engines; this is
not an execution test. Existing installed PDF libraries are pdf-lib 1.17.1 and
fontkit 1.1.1. Neither proposed rasterizer package was installed at that baseline.
Host-only `pdftoppm` 26.04.0 is not part of the template runtime.

Use `pdfjs-dist/legacy/build/pdf.mjs`; preserve its same-version
`pdf.worker.mjs` and same-process Node loopback worker. PDF.js/canvas imports
occur only after the required TSYNC seal. Package required JS modules,
`cmaps/`, `standard_fonts/`, `wasm/`, licenses and the target-architecture GNU
addon beneath `/opt/evo-university-template-runtime/`, root-owned and read-only.
Preserve module-relative resolution; do not bundle the addon into JavaScript
or copy the application's whole node_modules tree. Record every shipped asset
hash and exact target architecture in build evidence. Preserve the existing
controller-generated runtime image identity; do not invent an image digest.

Canvas supplies Linux arm64-gnu and x64-gnu 1.0.9 packages, approximately 28 MiB
and 33 MiB unpacked. Its published baseline is glibc >=2.18; Linux arm64 requires
Cortex-A57 or newer. The pinned Node Bookworm base is a candidate GNU target,
but actual dynamic-library, CPU and syscall compatibility must be tested.

In the render child only, the launcher supplies these fixed values in its
otherwise clean environment, never values copied from the app or request:

```text
DISABLE_SYSTEM_FONTS_LOAD=1
NAPI_RS_NATIVE_LIBRARY_PATH=/opt/evo-university-template-runtime/vendor/canvas-native.node
```

The build places the correct GNU addon at that stable path. This bypasses
canvas's `/usr/bin/ldd`/process-report/subprocess libc detection and disables
system/home-font discovery. Missing or incompatible native binding fails closed;
do not ship or select a WASI canvas replacement. The existing no-exec seal,
Landlock allowlist and syscall policy are not relaxed to accommodate libraries.

## Server API and source request

Proposed export in `src/lib/server/university-template-preflight.ts`:

```ts
renderUniversityTemplatePage(
  {
    bytes,                  // Uint8Array, captured before the first await
    mimeType: "application/pdf",
    expectedSha256,         // lower-case 64-hex SHA-256
    expectedManifest,       // trusted full PDF manifest, never browser input
    page,                   // integer, 1-based
  },
  { signal },
): Promise<
  | { status: "rendered"; metadata: UniversityTemplatePageMetadata; png: Uint8Array }
  | { status: "rejected"; code: "template_not_eligible" | "source_unavailable" }
>
```

Strictly validate and snapshot the input and complete manifest before awaiting
work. PDF bytes must be 12 bytes through 20 MiB; page is 1 through 100 and must
exist. Normalize the manifest exactly as existing source-preview does:
`{format:"pdf",slots:[],pageSizes:[{width,height},...]}`. Hash its UTF-8 JSON
with SHA-256. This `manifestDigest` is transient and distinct from persisted
receipt165/166 digests; do not change their algorithms or records.

The adapter starts the existing launcher with the sole fixed argument
`--render-page-v1`. Its stdin is one UTF-8 JSON header of 1..511 bytes, LF,
then the exact source bytes. Header keys are exactly:

```text
operation: "render-page-v1"
mimeType: "application/pdf"
byteLength: integer
expectedSha256: lower-case 64-hex
expectedManifestDigest: lower-case 64-hex
page: integer
```

Total input remains bounded by 20 MiB +512 bytes. No strings are coerced into
numbers or literals. The child checks exact keys, MIME, size, source hash,
mode agreement, EOF and page bounds. It reuses the existing PDF inspector on
those same captured bytes and compares the digest of the **whole** newly
inspected manifest before calling PDF.js. An off-page manifest change rejects.
Invalid source/mode/geometry/binding gives `template_not_eligible`.
Unavailable isolation, resources, timeout, cancellation or admission gives
`source_unavailable`; raw diagnostics never cross the boundary.

## Binary transport and limits

The template-profile launcher accepts either its existing zero-argument mode
or exactly `--render-page-v1`. Every other argument list is rejected. The D3
profile remains unchanged. A fixed internal mode marker reaches the existing
sealed entrypoint; it must agree with the request operation. No caller-supplied
entrypoint, executable, environment, limit, output format or parser option exists.
Old inspection/source-preview cannot select the new output ceiling by changing
their input header.

Render stdout contains exactly one frame, with no JSON lines or log prefix:

```text
4 bytes   ASCII "EUP1"
4 bytes   unsigned metadataLength, big-endian
4 bytes   unsigned pngLength, big-endian
N bytes   strict UTF-8 JSON metadata
M bytes   PNG
EOF
```

`1 <= N <= 4096`, `0 <= M <= 20 * 1024 * 1024`; frame maximum is
20 MiB +4108 bytes. No base64, multipart, HTML, SVG, PDF or ZIP payload is
accepted. This PNG-only ceiling does not authorize future form/ZIP transport.

Success metadata has exactly these keys; numeric geometry is finite:

```text
status: "rendered"
policyVersion: "evo-university-template-page-v1"
rendererId: "pdfjs-6.3.289-canvas-1.0.9"
mimeType: "application/pdf"
sha256, byteLength, manifestDigest
page, pageCount
widthPt, heightPt
pixelWidth, pixelHeight
pngByteLength, pngSha256
```

All digests are lower-case 64-hex strings. Byte counts, page numbers/counts and
pixel dimensions are integers, never strings, arrays or coercible objects.
pageCount equals the full trusted manifest length; pixel dimensions equal the
fixed raster calculation below; pngByteLength equals the frame's M exactly.

Rejection metadata is exactly `{status:"rejected",code}` with one of the two
fixed codes above and `M=0`. Success requires `M>0`. No warnings, labels,
filenames, paths, source excerpts or library errors appear in metadata.

The C supervisor uses a bounded heap buffer for the new mode, never a 20-MiB
stack allocation. It buffers the entire child output and requires successful
child exit before delivery. Overflow/abnormal exit produces only a fixed
rejection frame. A deadline-aware write-all loop must handle partial writes,
EINTR, EAGAIN, backpressure and closed readers; a single `write()` is insufficient.
Partial/failed final transport is not success and is never published by HTTP.

The adapter enforces the cap while accumulating bytes, before concatenation;
checks magic, exact lengths/EOF, fatal UTF-8 decoding, strict keys/types and all
source/manifest/page/policy bindings; and verifies PNG byte count/SHA and fixed
signature/IHDR dimensions. It does not decode PNG pixels or import a general
image/PDF parser in Next. Browser decoding is not source-inspection authority.
Success metadata is an immutable validated DTO, not an unchecked mutable cast.

Retain shared single-job admission, ignored stderr, clean inherited descriptors,
PDEATHSIG, AS **2 GiB**, Node heap **256 MiB**, CPU **10 s**, wall **15 s**,
FD **64**, core **0**, and adapter **16 s**. The render-mode wall deadline covers
supervision and final delivery. No automatic timeout/memory increase or weaker
runtime fallback is authorized by this contract.

## Page geometry and raster policy

Keep existing source rules: passive, unsigned, unencrypted, noninteractive PDF;
at most 100 pages/30000 indirect objects; visible page dimensions 72..3000 pt;
rotation exactly zero and UserUnit absent or one. Reuse private geometry from
`openPdf` in `src/lib/server/university-form-pdf.ts`; any factoring must preserve
the public inspector's exact manifest/output and existing fill behavior.

For the selected page, compare PDF.js `view=[x1,y1,x2,y2]` against the inspector's
CropBox intersected with MediaBox, including nonzero/negative origin. Compare all
four coordinates and dimensions with absolute tolerance **1e-6 pt**; all values
must be finite. Require PDF.js rotation 0, UserUnit 1 and the same page count.
Metadata width/height comes from the canonical inspected manifest and must
equal the parent's selected manifest page exactly. A mismatch rejects rather
than selecting either parser's geometry or silently rotating/cropping the page.

Raster dimensions are fixed, not caller-configurable:

```text
s  = min(2, 2048 / max(widthPt, heightPt))
Pw = floor(widthPt  * s)
Ph = floor(heightPt * s)
```

Require positive integer Pw/Ph, each <=2048, and <=4,194,304 pixels total
(at most 16 MiB for one RGBA buffer, not a bound on all parser/native allocations).
Use `getViewport({scale:1,rotation:0,dontFlip:false})` and the additional render
transform `[Pw/widthPt,0,0,Ph/heightPt,0,0]`. Independent axis rounding is deliberate:
the complete visible page fills the bitmap without hidden padding or an assumed
uniform rounded scale. Fixed white background, `intent:"display"`, annotations
enabled, default optional-content visibility; no scripting/viewer layer, editing,
custom colors, operation filters or caller annotation state.

UI places controls over the actual image box, excluding borders/letterboxing:
`xPt=xCss*widthPt/imageCssWidth`, `yPt=yCss*heightPt/imageCssHeight`; width/height
use the corresponding axis. Recompute its box after zoom/resize/scroll. Display
the whole page, support precise numeric/keyboard adjustment, and bind edits to
the exact template/version/source hash/manifest. Existing region size, bounds,
overlap and manual-field guards remain authoritative when mappings are saved
and filled. Rasterization never approves or invents these regions.

## Rendering behavior and known fidelity limitations

Fix `stopAtErrors:true`, `useSystemFonts:false`, `disableFontFace:true`,
`enableXfa:false`, `useWorkerFetch:false`, `useWasm:true`,
`isOffscreenCanvasSupported:false`, `isImageDecoderSupported:false`,
`enableHWA:false`, `enableWebGPU:false`. Use only captured Uint8Array data.
The local binary-data factory accepts only exact kind/filename pairs in the
build asset manifest, rejecting traversal, absolute paths and remote URLs.
Worker/module paths are fixed runtime assets. No system font fallback is added.

Do not use PDF.js `maxImageSize` as a fail-closed image-resource limit: its
documented behavior can omit oversized images. Leave it at -1; existing native
CPU/AS/deadline limits reject exhausted renders instead of returning a thumbnail
with omitted content. Capture library warnings/errors before imports at warning
verbosity, record only a boolean and reject the render; suppress their text.
Do not silently accept a WASM initialization warning followed by JS fallback.
Absence of warnings is **not** proof that every glyph or color was preserved.

Unresolved before real native proof:

- Skia `.node` loading, shared-library needs, threading/syscalls and allocations
  under the unchanged kernel rules and 2-GiB address-space limit on both native
  architectures. Declared package engines do not answer this.
- Packaged OpenJPEG/WASM decoding under Node's existing
  `--disable-wasm-trap-handler`, including malformed images and allocation failure.
- Missing/nonembedded fonts, Type3 outlines, embedded CJK and complex drawing
  behavior. The fixed NotoSans **fill** renderer still rejects unsupported CJK/
  emoji/shaping; rendering an original embedded CJK font does not expand fill
  support or repair the separate DOCX font/layout gate.
- With `useWorkerFetch:false`, PDF.js disables its QCMS ICC path and may use
  Alternate/Device color spaces without warning. Therefore this PNG is not
  colorimetric proof. If color distinction affects correct mapping, stop and
  compare the guarded original; do not claim color-faithful approval.
- Display/print annotation and optional-layer visibility can differ. The fixed
  display policy is explicit; output review must not assume it proves every
  print configuration. A page/fixture that cannot be inspected reliably remains
  blocked; no silent renderer replacement or omission is allowed.

## Required real checks and architecture boundary

These are **future acceptance requirements, not completed test claims**.

1. Before every local Docker action, prove OrbStack Running, context `orbstack`,
   local Unix endpoint and native arm64 engine. Run arm64 only on OrbStack.
   **No QEMU, Rosetta, binfmt or other CPU emulation; no foreign-platform build
   or run.** Run amd64 only on an explicitly available and authorized **native
   amd64 host**, after verifying host/engine/image architecture. Missing native
   amd64 access leaves that gate blocked; it does not authorize production/VPS
   use, emulation, paid resources or a passed amd64 claim.
2. Use the narrow existing template runtime test target, with owned network-none,
   read-only, cap-drop/no-new-privileges containers and synthetic/public-licensed
   fixtures only. Record exact commit/image/architecture, real exit status and
   logs; remove only owned containers and verify their absence. No full Next/app
   build in this lane. Root coordinates one later combined image/browser gate.
3. Prove actual addon, legacy worker, CMap, standard-font and WASM loading after
   seal. Missing/wrong native addon, incompatible assets and seal/bootstrap
   absence fail closed. Re-run all real network/private-FS/write/exec/TSYNC,
   FD/environment, CPU/AS/wall/output, process-death and cancellation probes.
   Because shared C changes, re-run D3's narrow native suite. Prove old 4096-byte
   D3 and 128-KiB template ceilings plus unchanged 10-row DOCX preview.
4. Through the real adapter/launcher, render **every page** of a multipage
   synthetic source with portrait/landscape/fractional sizes and nonzero/negative
   CropBox origins. Four colored corner/known-rectangle markers must land at
   computed pixel coordinates within one raster pixel. Inspect every output
   image, not merely extracted text or a nonempty PNG. Reject geometry mismatch,
   rotation/UserUnit exceptions, malformed/encrypted/active/signed sources.
5. Exercise Latin/Cyrillic/Kyrgyz, public-licensed embedded CJK, Base14, Type3,
   JPEG/JPX, transparency/masks and diagnostic-producing malformed resources.
   Verify visible glyphs/lines/backgrounds and report unsupported cases honestly.
   A cold genuine raster must pass unchanged native limits; no cached/host-rendered
   substitute counts. Repeat supported rendering on native amd64 before calling
   the candidate supported for the production architecture.
6. Pure/adapter transport checks cover wrong source hash, off-page full-manifest
   mutation, stale page, malformed header/frame/UTF-8/DTO, wrong PNG SHA/IHDR,
   inconsistent lengths, trailing bytes, old/new mode confusion, cap+1, partial
   writes, stopped readers, abort and shared admission contention. Real native
   diagnostics must cross the actual new output cap and deadlines; mock frames
   alone do not prove kernel/resource behavior.
7. For actual PDF fill acceptance, reconstruct the existing branded mapping
   resolution from frozen inputs **inside the isolated process**; serialized
   WeakSet-branded results are not authority. Fill a reviewed synthetic mapping
   with confirmed values, then render and inspect **all generated pages**.
   Confirm visible glyphs, region containment, page geometry and unchanged source
   artwork outside explicit text/draft-notice areas, allowing raster antialiasing
   at boundaries. Overflow, unsupported glyph/shaping, overlap and out-of-bounds
   must block export. This PNG-only operation does not itself authorize or
   implement generated-PDF/ZIP binary transport or persistent artifact writes.
8. Root's full D4 gate additionally exercises real staff authorization/revocation,
   private Storage, source-hash/status rechecks, visual selection with zoom/resize/
   keyboard, save/reload/review, generated form history and usable packages/exports.
   Inspect all pages of each accepted generated document. Native synthetic PNG
   proof is not live authority, deployment or real-client/business acceptance.

If a limit, codec, font or platform incompatibility blocks this design, record
the evidence and request a forward contract amendment before changing the
architecture. Do not relax existing inspection, receipts or isolation to make
a raster test pass.

## Ownership and implementation stop

Root's subsequent explicit approval authorizes this bounded native lane to own
`scripts/document-source/launcher.c`, `scripts/university-template/*`,
the existing adapter, a pure page DTO, private PDF geometry factoring, exact
dependency/runtime asset packaging and focused tests/runners. Root owns staff HTTP/UI,
live source-version permission/receipt binding, reviewer-defined region storage,
generated artifact/package integration and combined business proof. SQL165/166
and source-inspection semantics remain outside this lane. Do not overwrite
parallel work. Independent exact-diff review is required before code publication.
Native amd64 remains mandatory before production-architecture support is claimed;
its current unavailability does not block useful native arm64 implementation.
Keep all generated synthetic PNGs available for root's visual review. No emulation,
new server, full Next/app image, production/provider or private-document access.

The staff route must read the exact authorized original and trusted manifest,
and recheck current permission, version/hash/status after rendering before
delivery. Serve transient bytes privately with no-store; no public URL, shared
cache, DB preview persistence or Student projection. Revocation/staleness discards
the result. Renderer metadata and hashes are integrity checks, not authorization.

## Official pinned sources consulted

- [PDF.js 6.3.289 release](https://github.com/mozilla/pdf.js/releases/tag/v6.3.289)
  and [npm version metadata](https://registry.npmjs.org/pdfjs-dist/6.3.289): exact
  version/engines/license; registry fields were read with `npm view`, not installed.
- [Official Node raster example](https://github.com/mozilla/pdf.js/blob/v6.3.289/examples/node/pdf2png/pdf2png.mjs),
  [Node canvas factory](https://github.com/mozilla/pdf.js/blob/v6.3.289/src/display/node_utils.js)
  and [Node loopback worker](https://github.com/mozilla/pdf.js/blob/v6.3.289/src/display/api.js#L1962).
- [PDF.js initialization/render API](https://github.com/mozilla/pdf.js/blob/v6.3.289/src/display/api.js),
  [viewport transform](https://github.com/mozilla/pdf.js/blob/v6.3.289/src/display/page_viewport.js),
  [visible page intersection](https://github.com/mozilla/pdf.js/blob/v6.3.289/src/core/document.js)
  and [binary-data factory](https://github.com/mozilla/pdf.js/blob/v6.3.289/src/display/binary_data_factory.js).
- [Canvas 1.0.9 requirements](https://github.com/Brooooooklyn/canvas/blob/v1.0.9/README.md),
  [npm metadata](https://registry.npmjs.org/@napi-rs/canvas/1.0.9),
  [native selection](https://github.com/Brooooooklyn/canvas/blob/v1.0.9/js-binding.js)
  and [system-font loading](https://github.com/Brooooooklyn/canvas/blob/v1.0.9/index.js).
- [WASM initialization/fallback](https://github.com/mozilla/pdf.js/blob/v6.3.289/src/core/wasm_image.js),
  [Node ICC limitation](https://github.com/mozilla/pdf.js/blob/v6.3.289/src/core/icc_colorspace.js#L142)
  and [alternate color-space fallback](https://github.com/mozilla/pdf.js/blob/v6.3.289/src/core/colorspace_utils.js#L184).
- Synthetic CJK fixtures use upstream [Noto Sans2.004](https://github.com/notofonts/noto-cjk/tree/Sans2.004)
  and its [OFL license](https://github.com/notofonts/noto-cjk/blob/Sans2.004/LICENSE):
  [regional SC OTF](https://github.com/notofonts/noto-cjk/blob/Sans2.004/Sans/SubsetOTF/SC/NotoSansSC-Regular.otf)
  (8,331,336 bytes, SHA256 `faa6c9df652116dde789d351359f3d7e5d2285a2b2a1f04a2d7244df706d5ea9`)
  and [full CJK OTF](https://github.com/notofonts/noto-cjk/blob/Sans2.004/Sans/OTF/SimplifiedChinese/NotoSansCJKsc-Regular.otf)
  (16,437,364 bytes, SHA256 `2c76254f6fc379fddfce0a7e84fb5385bb135d3e399294f6eeb6680d0365b74b`).
  Only test-image assets include these fonts; they are not new fill fonts or a
  production fallback. The builder verifies exact bytes and the OFL hash.

No runtime compatibility, generated-output fidelity or native amd64 evidence
was produced by this research/documentation slice.

## First native compatibility checkpoint

After approval, the fixed test-image-only post-seal tracer passed 1/1 on native
Linux arm64/Node22.23.1 with unchanged limits (`01a09d36428f7d83bfe60e71c9040e70`).
Image: `sha256:641ba5c5267758f38f2c4443368fa4e08ad19dd1f53f069ae1042d14cbf8746a`.
The real PNG contains visible synthetic Latin text and red/blue corner markers;
SHA256 `90d4920df1755e7ab5785b5de8d78ed81eb51bc8d6563672ca1c2275cde2f78a`.
Owned container `evo-university-template-proof-fbee85e321864240bad5817b5963aa41`
was removed and absence verified. This is only an addon/basic-PNG tracer, not
the production API/frame, complete codec/font suite, D3 regression, native amd64,
fill/all-page, Auth/Storage/browser or full D4 acceptance.

## Findings retained from the required font matrix

The first embedded-CJK fixture used pdf-lib/fontkit's CFF subset and generated
PDF.js warnings about a font stream subtype and out-of-bounds subroutines. A
correctly labelled full OpenType font subsequently exposed the pinned renderer's
65,535-glyph CFF limitation: `Not enough space in charstrings to duplicate first glyph`
([pinned implementation](https://github.com/mozilla/pdf.js/blob/v6.3.289/src/core/cff_parser.js)).
Both warning-producing cases stay explicit negative fixtures. A smaller official
SC regional font is the positive embedded CJK fixture; this does not establish
universal CJK font compatibility. No warning was suppressed, no OS/AS limit was
relaxed and no alternate renderer/font was silently selected for a source PDF.

Visual inspection then rejected an otherwise numerically passing regional-CJK
fixture: pdf-lib had encoded glyph-array IDs where the CID-keyed CFF required
its actual CIDs, so different visible ideographs appeared without a warning.
The synthetic generator now derives CIDs from the pinned font charset and binds
the text, width table and ToUnicode map consistently. The corrected PNG visibly
reads `中文大学 / 日本語 / 申请表`. This finding is why nonempty PNGs, extracted
text and the absence of warnings cannot replace per-page visual acceptance.

Adding the dedicated Kyrgyz letters `Ө Ү Ң ө ү ң` also revealed that eight
repetitions of the expanded synthetic motivation exceeded the existing field
length policy. The actual failure was `form_fields_not_ready` in the resolver,
not rasterization or memory exhaustion. The fixture prefix was shortened to
keep its long confirmed value within that unchanged policy. Test-only fixed
variant/page/phase diagnostics distinguish these fixture failures from native
runtime incompatibilities; they are not part of the production frame.

Root's reviewed PDF-region correction `0e74845215fd158358c6e6a942b8f4313a098b79`
is integrated in this lane as `809095ac2fd3b727353a319332d54d8c94bcc915`.
The four non-journal files match the published correction exactly; the journal
keeps its previous prefix plus the exact incoming append. The isolated fill
fixture now reconstructs its branded resolution from actual PDF `slots: []`
and explicit reviewed mapping regions. Earlier synthetic slot fixtures are
historical diagnostics, not evidence for the corrected authority boundary.

## Frozen arm64 implementation checkpoint

On the integrated `809095ac` base, the final narrow image is
`sha256:d7c5e88b9890003097bcc4e3cbf14b54a03da402829cca547b1a2c58bad0a329`.
Native OrbStack/Linux arm64/Node22.23.1 checks passed **33/33**, with no skipped
cases (`01a09d6267857b41a67d4161211657cc`). This includes actual sealed asset/
codec loading, old inspection and DOCX preview, exact binary binding/caps,
backpressure and stopped-reader deadline, geometry/corners, in-flight abort,
all generated pages and negative mapping/font cases. The known full-CFF and
malformed CFF/JPX refusals are expected failures, not supported rendering claims.

The same shared C source (SHA256
`dfdc81ffdc6d668f7d0dd9a93025026832ebc3e593549fca49596bc53b540079`)
passed D3's native **12/12** checks (`01a09d4e98187d538906d1d96893c469`), image
`sha256:12bedd33f57d0682a3b1bec7542433f463fbbef507b4ef96da7789d0773a36f0`.
No C change followed that run. Two additional fault-injected runs of the final
template image mounted harmless repository package metadata read-only over,
separately, the raster manifest and one hashed JS asset. Inspection still verified
the synthetic PDF; actual page rendering rejected both as `source_unavailable`
(`01a09d6323787992b44fa32e44dae9f9`). Owned proof/fault containers were removed
and their absence verified; these deliberate fault mounts are negative tests,
not an alternative production configuration.

Twenty PNGs are retained in the runner's `evo-university-template-png-03ypHa`
temporary artifact directory. All were visually covered: eighteen are byte-identical
to previously inspected outputs; the corrected CJK and CMap PNGs were inspected
separately. The artifact `manifest.json` binds names/hashes to the final image;
its SHA256 is `82e236cb64d4686d040e1b9b0a90f2aadf7e4550561249c9b7148490575b1f40`.
Both original/final/draft page geometries, the long-value pages, Kyrgyz-specific
glyphs and unchanged manual/source areas are visible. CJK output SHA256 is
`46fe40d665c3f432fc1bd56a537caed72f47f021b89ec6d5a696c21f4ba99212`.

Integrated focused Node tests passed **86/86** (`01a09d5c66d47f11a3da9c4c123be075`),
alongside scoped ESLint, TypeScript and diff checks. TypeScript used explicit
`node,next/image-types/global` declarations without generating a Next build.
The implementation remains pending independent exact-diff review/publication.
At that arm64 checkpoint, native amd64, staff authorization/Storage/visual mapping,
generated-PDF/package transport and full D4 business acceptance remained open. The read-only authorized
Hermes inventory found an available x86_64 Docker host; it did not authorize or
execute a remote build/container. No production or managed service was changed.

## Staff PDF page HTTP and region editor

Pre-code continuation, 2026-09-14. Native `c35a1fd3` was independently approved
and integrated as `abcd82bf`; the final integration preserved all existing tests,
adding the page test once (21 focused checks pass, receipt `01a09d795cde75d19b819a1e092036f7`).
The accepted ingress source is now main `0f58072b` (PR773).

Native amd64 also passed D3 12/12, template33/33 and two asset-corruption refusals,
with no skipped cases, on the exact published native source. Independent review
covered all29 source blobs, actual resource/cleanup logs and all20 PNGs
(`01a09d7b620c78109be3e3b303165f91`). D3 image `sha256:b529789c1e7c7615a2216629746fa073addb50bd82583e0584c35bc337cda87d`,
template image `sha256:c8c3de9a43fb5d914312d3a0e08b6d05d94f4415fd325a301f8e22935771325a`;
proof manifest `fa0a479b528d575ffc2826af2e38a41e8b753e904795929ea3d8e750c24df944`.
This closes the narrow native-architecture gate, not the app/browser/form-output gate.

- Add GET `.../versions/[versionId]/source/page?page=N`, exactly one canonical
  integer query1–100 within the trusted PDF manifest. All other methods405.
  Keep the same manager permission, exact source metadata, one-use read grant,
  private Storage read/hash, shared byte-operation lease and completion-time
  live permission/source recheck as DOCX preview. No SQL/migration/auth change.
- Invoke only the reviewed `renderUniversityTemplatePage` after Storage read.
  Return `image/png`, exact content length and `x-evo-template-page` containing
  the bounded ASCII metadata JSON, plus private/no-store/nosniff/same-origin.
  No signed URL, browser-provided manifest or public cache. No PNG before grant
  completion. Cancellation holds the lease until actual native settlement.
- Client fetches at most20MiB with same-origin credentials, bounded timeout and
  no redirects; verifies closed metadata against version/hash/whole manifest/page,
  PNG length/SHA and decoded natural dimensions. Only then display a local blob URL;
  revoke on replacement/unmount, discard late responses. No persistent browser cache.
- Existing forms page selects the PDF editor for inspected PDF and keeps DOCX
  behavior. Use exact saved version/hash/manifest keys, existing save_mapping,
  separate explicit review and publication; no automatic approval. Saved review
  displays its actual page overlays read-only. Archived/source-changed stays blocked.
- Visual thesis: quiet white EVO workspace, actual document dominant, red accent
  for current region/primary save. Content: page controls → document → selected field
  settings, one column on narrow screens. Interaction: visible selection/focus,
  bounded loading feedback, responsive zoom without losing points-based geometry.
- Add a region by pointer drag (capture/cancel) or an accessible button; select and
  edit it via labelled numeric x/y/width/height controls and arrow-key movement.
  Coordinates use the current borderless image box per axis; overlay percentages
  survive resize/zoom. Page navigation retains unsaved edits; explicit undo/reset
  restores prior edits. Field source/date format/required/manual and optional
  character cells reuse existing policy. Reject overlaps/out-of-bounds/invalid
  cells before save, without replacing authoritative server validation.
- Existing500-region/100-page bounds stay unchanged. A manual field remains blank;
  no profile data is fetched/displayed by the mapping editor. Save uncertainty
  freezes exact request/form and offers same-request retry or reload, never a new
  request with changed content. Errors preserve draft and explain a next action.

Current primary API references: [image box coordinates](https://developer.mozilla.org/en-US/docs/Web/API/Element/getBoundingClientRect),
[pointer capture](https://developer.mozilla.org/en-US/docs/Web/API/Element/setPointerCapture),
[blob URL cleanup](https://developer.mozilla.org/en-US/docs/Web/API/URL/revokeObjectURL_static).
Browser plugin not available: use existing repository Playwright acceptance.
Target flow: university → inspected PDF → draw/edit region → save → explicit
review/publication → cold reopen exact overlays, desktop1440px and mobile393px.
Before claiming the UI works, require actual Auth/Storage/native/browser flow,
screenshots, page identity, no blank/overlay, clean console and interaction proof.
Pure geometry/denial tests support but do not replace that acceptance.
