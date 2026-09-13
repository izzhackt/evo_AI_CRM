# Isolated source inspection — document-source-v1

Date: 2026-09-13. Implementation contract, not production proof.
Root-approved sibling from exact D4 `ae52a3165c142c5f87bebd80e97b18a15e84877e`.
Extends [D3](evo-docs-recognition-contract.md); does not implement its provider,
Storage, authorization, queue, HTTP or UI adapters. Root owns their integration.

## Fixed seam

`inspectDocumentSource({bytes, mimeType, expectedSha256}, {signal})` returns
`{status:'verified', sha256, byteLength, mimeType, pageCount,
policyVersion:'document-source-v1'}` or
`{status:'rejected', code:'document_not_eligible'|'source_unavailable'}`.
No paths, executable names, environment settings or parser options from callers.
Capture bytes before awaiting; compare exact SHA-256 both before and inside the
worker. PDF/JPEG/PNG only, 1 byte through 25 MiB; PDF 1..20 pages, encrypted/unreadable rejected;
JPEG/PNG 1 page, each dimension 1..20,000 and total at most 40,000,000 pixels.
No original rewriting, OCR/text extraction, raw metadata or file contents in output.
Structural inspection does not replace malware scanning or prove Gemini acceptance.

## Executable boundary

One fixed C supervisor starts one bundled Node source inspector, under existing
nonroot UID 1001. No shell, Docker socket, extra service, managed DB or provider.
Immutable root-owned runtime/dependencies live at `/opt/evo-document-runtime`.
Landlock ABI>=3 denies filesystem access except runtime, Node and required system
libraries; no `/app`, homes, `/proc`, `/sys`, credentials or arbitrary temp files.
Only explicit stdin/stdout/stderr pipes survive. A fresh explicit environment
excludes `NODE_OPTIONS`, `LD_*`, application/provider credentials and user config.
An architecture-checked seccomp allowlist blocks network sockets, external process
inspection, namespaces and process creation; only required same-process threads
are permitted. Missing/unsupported isolation fails `source_unavailable`, without
fallback to the main Node process. No setuid or extra container capabilities.

OS soft/hard limits: address space 2 GiB, CPU 10 seconds, core 0, open descriptors 64.
One job at a time per application process. Trusted supervisor watchdog 15 seconds;
abort and parent death kill the inspector; normal supervision reaps it, and the
container's init reaps it after supervisor death. Output 4 KiB maximum; stderr is
discarded, parser exceptions become fixed codes. This is an address-space limit,
not a measured RSS or per-job cgroup promise. Node heap 256 MiB supplements it;
`--disable-wasm-trap-handler`, narrow thread pools, sharp concurrency 1/cache off.
Input is read from fixed descriptor 0 with `readSync`, avoiding libuv socket
discovery. The only permitted ioctl is `FIONBIO` for already-owned I/O channels;
network/socket syscalls remain denied. The exact architecture's ELF loader has
execute permission; other system libraries are read-only, not executable files.
Policy changes require review; future D4 may reuse this launcher only through a
new fixed operation/limits contract, not an arbitrary-command interface.

### Review correction: signal ownership and post-startup execution

The initial proof did not cover two rejected invariants: unrestricted `fcntl`
could signal the same-UID supervisor using an asynchronous pipe, and a worker
thread could re-exec Node without retaining the leader's parent-death setting.
The approved correction preserves those invariants, rather than weakening them:

- Allow only descriptor get/set flags and close-on-exec duplication. Restrict
  mutable flags to the required safe set; deny signal ownership, signal selection,
  async notification, directory notification and all other `fcntl` commands.
- The launcher's sole production entry is fixed root-owned `bootstrap.mjs`.
  It must load `seal.node`, a native addon built against the pinned Node headers,
  before dynamically importing any document parser or reading input. Initialization
  synchronizes an irreversible no-exec filter across every current thread using
  `SECCOMP_FILTER_FLAG_TSYNC`; any nonzero result terminates startup. Subsequent
  threads inherit it. Missing/unloadable addon is fatal; there is no optional
  preload, bypass, direct-inspector launch or application-process fallback.
- The original syscall allowlist permits only filter installation with TSYNC;
  stacking cannot relax existing restrictions. The second filter denies both
  `execve` and `execveat`. Thread support and parent-death cleanup remain required.
- Before acceptance, reproduce both findings against the old implementation in
  an owned synthetic container; prove denied signal delivery to its supervisor,
  worker-thread re-exec denial, then no surviving inspector on supervisor death.
  Exercise actual production bootstrap and fail-closed addon loading, not only
  a separately compiled diagnostic sealing function. No application process,
  production process, provider or real document is a test target.

Pinned existing libraries: Node 22.23.1 in the existing digest-pinned bookworm
image, pdf-lib 1.17.1, sharp 0.35.4 and lockfile-resolved dependencies. No new parser
framework. Native launcher is compiled from reviewed source in a build-only stage.
The Linux host must expose working Landlock>=3 and seccomp; this is checked at
execution, not inferred from distro/image name. Runtime assets are copied explicitly
and are not allowed to read the broader Next standalone/application tree.

## Bounded proof

Run only after OrbStack reports Running and context is exactly orbstack. Use a
disposable source-runtime image/container, no credentials, no production resources.
Actual synthetic PDF/JPEG/PNG inspection; encrypted/bad/page/pixel/size limits;
fixed diagnostic fixtures through the real sandbox prove denied network/outside
dummy file access and absent inherited env/descriptors. Actual bounded allocation,
CPU, wall timeout and abort prove resource enforcement and no surviving child.
Diagnostic entrypoints exist only in a separately compiled test launcher, never
the production binary. No fuzzing or full application suite. Root independently
reviews exact committed head before release integration; no deployment implied.
Run `npm run test:document-source-runtime` for the real Linux target. Ordinary
`test:document-source-preflight`/CI covers only input boundaries and must not be
reported as real isolation proof. Native arm64 OrbStack proof does not establish
native amd64 execution: the same focused image/harness must pass on the intended
Linux architecture and kernel before that runtime is enabled there.

## Official basis (checked 2026-09-13)

- [Landlock](https://docs.kernel.org/userspace-api/landlock.html): unprivileged,
  inherited restrictions; pre-opened file descriptors need explicit handling.
- [seccomp](https://docs.kernel.org/userspace-api/seccomp_filter.html): architecture
  checks, no-new-privileges, inherited filters; not itself a filesystem sandbox.
- [Linux resource limits](https://man7.org/linux/man-pages/man2/getrlimit.2.html)
  and [parent-death signal](https://man7.org/linux/man-pages/man2/PR_SET_PDEATHSIG.2const.html).
- [Node22 flags](https://nodejs.org/download/release/v22.23.1/docs/api/cli.html#--disable-wasm-trap-handler).
- [Sharp limits](https://sharp.pixelplumbing.com/api-constructor/) and
  [metadata](https://sharp.pixelplumbing.com/api-input/): metadata alone does not
  decode pixel data; use a complete bounded decode after dimension checks.
- [PDF load options](https://pdf-lib.js.org/docs/api/interfaces/loadoptions).
- [Linux 6.2 Landlock UAPI](https://raw.githubusercontent.com/torvalds/linux/v6.2/include/uapi/linux/landlock.h):
  exact ABI 3 `TRUNCATE` constant, needed with Bookworm's older build headers.
- [Node 22.23.1 libuv I/O](https://raw.githubusercontent.com/nodejs/node/v22.23.1/deps/uv/src/unix/core.c):
  fixed `FIONBIO` request used for nonblocking owned descriptors.
- [Linux seccomp TSYNC](https://man7.org/linux/man-pages/man2/seccomp.2.html):
  synchronization failure is nonzero, possibly a thread ID; filters cannot be removed.
- [Linux asynchronous file signals](https://man7.org/linux/man-pages/man2/F_SETOWN.2const.html):
  `F_SETOWN`/`F_SETSIG` with `O_ASYNC` are a signaling path independent of `kill`.
