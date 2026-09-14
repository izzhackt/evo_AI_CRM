# D4 — hard-isolated template inspection

2026-09-14, pre-implementation contract. Base `ef279986`; registry is separately
reviewed `355a4c5c`/PR770. This slice is a required working dependency of the
[university forms flow](evo-docs-university-packages-contract.md), not full D4.

## Exact scope and protocol

- Reuse the D3 C supervisor/seal/bootstrap, with a second compile-time profile:
  fixed `/opt/evo-university-template-runtime`, 128KiB stdout. The D3 default
  `/opt/evo-document-runtime`, 4096-byte output and protocol remain unchanged.
  No caller-selected executable, path, environment or parser options.
- Same mandatory Linux Landlock ABI>=3, no-new-privileges, seccomp allowlist,
  synchronized irreversible no-exec seal before parser import/input, descriptor
  and environment cleanup, parent-death kill. No weakened fallback on macOS or
  unsupported kernels. Limits:2GiB address space,256MiB V8 heap,10 CPU seconds,
 15 wall seconds,64 descriptors; adapter deadline16s and one active call/process.
- Input: one bounded JSON line `{byteLength,expectedSha256,mimeType}` plus exact
  bytes,1–20MiB. Only DOCX/PDF. Both adapter and child capture/check SHA and size.
  Parser imports are the existing `inspectUniversityDocx`/`inspectUniversityPdf`,
  inside the hard boundary, never the web process. No rendering in this slice.
- Output: strict `{status:"verified",sha256,byteLength,mimeType,policyVersion:
  "evo-university-template-v1",manifest}` or fixed rejected code
  `template_not_eligible|source_unavailable`. The manifest is exactly
  `{format,slots,pageSizes}`. DOCX<=3000 unique `p-N` slots: only id/editable,
  no text/context/manualReason; pageSizes empty. PDF:slots empty and1–100 exact
  visible page sizes in points,72–3000 per dimension. Output overflow fails closed.
- PDF source inspection does not discover editable rectangles. Root approved
  separating passive-source/page proof from reviewer-defined `pdf-N` mappings,
  geometry and manual flags. Never fabricate editable PDF slots. A later forward
  migration must adapt registry mapping validation; do not modify165 here.

## Build and trust boundary

New `scripts/university-template/{inspect,build,test-harness}.mjs`, server adapter,
manual native test runner and narrow Dockerfile targets. Bundle only inspection
dependencies; runtime root-owned and immutable to UID1001. Reuse existing seal
and bootstrap bytes; do not ship diagnostic launcher in production. Dockerfile
runner copies the separate template runtime. No font/render asset required for
inspection. CI adds only the exact adapter tests; native tests are explicit.

ClamAV stays outside the credential-free/no-network parser: future trusted
ingestion uses existing `scanBytesWithClamd` and passes the same captured bytes
to this inspector. Future writer must bind both real proofs to live-authorized
org/catalog/template/version/object tuple and an authoritative immutable image
digest. A browser-supplied status/digest is never trusted. This slice installs no
bucket, upload, receipt writer, SQL, provider call, public route or UI. Those are
required next steps toward working forms, not permanently disabled features.

## Required proof before independent review

Scoped Node adapter tests/lint, and actual narrow Linux target tests after exact
OrbStack Running/orbstack/local-socket preflight before every Docker command.
Owned network-none, read-only, cap-drop/no-new-privileges container only; no real
documents/credentials/managed DB. Positive DOCX and passive PDF through actual
production adapter/parser; exact SHA and minimal manifest. Test3000-slot output,
invalid/mismatched/oversized/archive-active/encrypted sources, plus real OS
network/files/FD/env/exec denial, bootstrap absence/seal failure, process-death
cleanup and actual AS/CPU/wall/output limits. Re-run the D3 narrow target if its
shared launcher changes; no duplicate Next build for this isolated runtime slice.
Record actual proof only; freeze for independent review before commit/push.

Official behavior: [Landlock](https://docs.kernel.org/userspace-api/landlock.html)
is an additional irreversible restriction; our contract requires supported
features and fails closed instead of best-effort degradation.
[seccomp filters](https://docs.kernel.org/userspace-api/seccomp_filter.html)
restrict system calls and stack; the existing post-bootstrap TSYNC seal remains.
[Node22 child processes](https://nodejs.org/download/release/v22.23.1/docs/api/child_process.html)
provide transport only, not the hard isolation proof.

## Local implementation checkpoint

Actual final native target passed14/14 (`01a09ce5daa17303bfc835a6d3ad708e`),
image `sha256:1473e442201315bde223347886beacf79294f2ef70c98884d8db5b89391bc7c8`.
The original D3 target passed12/12 (`01a09ce5dabf7a22a2e08b4eb578137a`),
image `sha256:b15af9709aaa576b947e6e5bdc599d0ae7b25d91bb8952afba44c65136bc80e3`.
Both runs recorded exact owned-container absence after cleanup. These are
Linux arm64 narrow target images, not a rebuilt/released full production image.
Focused form tests55/55, manifest/classifier25/25 and scoped lint passed;
strict adapter-only TypeScript passed. No new dependency/font asset was needed.
Independent review remains required before commit/push. Actual ClamAV/private
ingress/trusted writer/mapping review/form exports remain the next required slices.
