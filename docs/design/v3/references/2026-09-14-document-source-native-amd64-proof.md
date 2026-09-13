# Native AMD64 source inspection — reviewed correction

Recorded2026-09-14 Asia/Dubai; execution/cleanup2026-09-13 UTC.
Source: `10f1a08cb6718726b69f29e804f7c377cdc5b6d8`.
This is synthetic runtime verification, not D3/real-provider/production acceptance.

- Native Hermes x86_64, Linux6.8.0-138-generic; image linux/amd64, Node22.23.1,
  UID1001. Exact13-file tracked archive matched after transfer; manifest SHA256
  `558dd07b44db1657788743c4fcd6d3a1c8028c8ece14a2d51f549c6e066f969a`.
- The diagnostic target build returned0. Exact image:
  `sha256:8a4996f47b6196f2aced4faa6f0ac33c281cece6e6e5d72455504c3a46f02177`.
- Unchanged harness: complete terminal TAP12/12 PASS,0fail/cancel/skip,29.14s.
  TAP SHA256 `86046282bfb04a0580b319f3d281d77ef4b0e2b16b11c02c18609b50e62b2fe0`.
- **Observation limit:** original SSH returned255 after connection loss. The
  original docker-run exit code was not observed. Complete TAP was recovered
  after reconnect without rerunning; the separate metadata-container exit0 is
  not a substitute for the unobserved harness exit.
- Actual running container: init, network none, read-only, cap-drop ALL,
  no-new-privileges, pids128, memory3GiB, tmpfs256MiB/noexec/nosuid; no ports/mounts.
- Full runtime permission audit:187 files/32 directories, root-owned, no writable
  bits or symlinks. Five fixed assets, including bootstrap, are0555. Earlier
  32e7255's11/12 failure remains valid evidence of the archive-mode defect.
- Both owned containers, image tag and exact temporary server directory were
  absent after cleanup. Shared cache and production were untouched.
- Production before/after stayed accepted05585020/image49543bbc, running healthy,
  restart0; same container ID and start time.

Independent source correction review approved diff
`6d243db65c15ad6a46ebaee258320d69b0d0b892948a1a4e7e01fb4acd61255a`.
Separate evidence reviewer recomputed all9 retained artifact hashes and approved
only the claims above; the13 raw source-match lines were not independently
available to that reviewer. Root/runner retained that transfer receipt.

Operator-local evidence: `/tmp/evo-document-runtime-amd64-proof.Cmb4qq/PROOF.md`.
Durable receipt references: source match `01a09c50d5267dd08372591a9b970b58`,
full TAP `01a09c83700e7fe2998dd878291c4009`, hashes
`01a09c836c7d72b390ff4fbd98297804`, permission audit
`01a09c83748a7963ab115e225731083d`, retained proof/cleanup
`01a09c84975174a0a8643d518e86c645`.

Next: compose the real D3 source-loader/Auth/Storage/queue/browser path against
this runtime. No Gemini dispatch, credentials, employee invitation, managed
migration or production feature enablement was performed by this proof.
