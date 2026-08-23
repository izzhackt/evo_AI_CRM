# P8U3 canonical SPDX namespace correction

Date: 2026-08-18
Issue: #282
Status: superseded planning source under #376/ADR 0020; not an active gate

## Observed failed attempt

P8U2 stopped fail-closed at SBOM privacy validation. Its immutable retained
`candidate-result.json` has SHA-256
`c4416cbe6cfb78187275069035da248229594920624eb2c22d0811e24472a7ec`,
`result_code=sbom_failed`, `failure_step=sbom`, and verified container/temp
cleanup. The retained local image ID is
`sha256:1483c286f7d4db3f3bfcfb6eb262416e92290cea1e3666321005f4c73873114e`.
No smoke, provider, database, customer-data, transfer or production boundary
ran.

A read-only value-redacted diagnostic found exactly one rejected pattern: the
Syft-generated UUID in top-level SPDX `documentNamespace`, whose safe shape is
`https://anchore.com/syft/image/sha256-<64 lowercase hex>-<RFC 4122 UUID>`.
No credential, private path or non-allowlisted contact matched.

## Correction

Credential and private-path patterns still scan untouched bytes without an
exception. UUID validation may ignore exactly one UUID only when all conditions
hold:

1. the artifact is parsed SPDX JSON;
2. the UUID occurs exactly once in the untouched bytes;
3. it is the UUID suffix of the exact top-level `documentNamespace` shape;
4. the namespace's 64-hex image component equals the inspected immutable image
   ID without its `sha256:` prefix.

Any UUID elsewhere, a duplicate, a wrong domain/path/image digest, malformed
namespace, credential, private path or non-allowlisted contact remains
blocking.

## Collision-free retry

Preserve the P8U2 root, tag and image unchanged. After this correction is
independently reviewed, merged and exact-main green, create one fresh private
OrbStack build using:

- application commit/tree/parent/CI: unchanged P8U1 identity from P8U2;
- tag:
  `evo-crm:b798c7d36be8e3325a9621d96e496ec0a2bb624f-p8u3-linux-amd64`;
- OCI version: `p8u3-b798c7d3-20260818`;
- smoke container: `evo-p8u3-smoke-b798c7d36be8`;
- evidence root:
  `p8u3-root-b798c7d36be8e3325a9621d96e496ec0a2bb624f-20260818`.

All other P8U2 build, immutable-image, OrbStack, evidence-graph, non-root,
network-none, disabled-route, cleanup and privacy requirements remain exact.
The new tag/container/root must be absent. No P8U2 artifact is overwritten,
retagged or treated as a valid candidate.

## Order and authority

Plan review precedes implementation. Implementation uses behavioral positives
for the exact namespace and negatives for UUID elsewhere/duplicated/wrong
digest/domain/path. Exact-head review plus 4/4 CI, squash merge and exact-main
CI precede the one new local build. Independent retained-evidence review then
ends P8U3.

This grants no Hermes/production, registry, Supabase, knowledge import, Gemini,
Auth activation, customer-data, Caddy/DNS, restart, WAHA, WhatsApp, amoCRM,
autonomous reply, outbound send or billed-resource authority.
