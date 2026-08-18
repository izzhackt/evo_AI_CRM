# P8U4 root staff-assistant proxy correction

Date: 2026-08-18
Issue: #284
Status: planning gate

## Outcome

Connect exactly `/api/platform-ai/staff-assistant` through the root EVO CRM
proxy so the route handler can enforce its own closed configuration, same-origin,
actor, role, organization, rate-limit, retrieval, provider and audit checks.
The correction remains disabled by default and grants no Auth, provider,
database, production or customer-data authority.

P8U4 is split deliberately:

- P8U4A changes repository code and tests only;
- P8U4B starts only after P8U4A is independently reviewed, merged and green on
  exact main. P8U4B freezes that then-known application commit/tree/parent/CI
  and may produce one collision-free private OrbStack candidate.

## Observed P8U3 stop

The immutable P8U3 attempt stopped fail-closed during the disabled-route smoke
check. Its result is `smoke_failed`, cleanup is verified, and no provider,
database or production effect occurred.

The application route itself returns exact HTTP `503` JSON
`{"error":{"code":"assistant_disabled"}}` when its complete enabling
configuration is absent. The request never reaches that handler because
`src/proxy.ts` does not recognize the exact path and therefore returns the
generic disconnected-API HTTP `403` response first.

Preserve without overwrite or deletion:

- P8U2 result SHA-256
  `c4416cbe6cfb78187275069035da248229594920624eb2c22d0811e24472a7ec`, tag
  `evo-crm:b798c7d36be8e3325a9621d96e496ec0a2bb624f-p8u2-linux-amd64`, and image
  `sha256:1483c286f7d4db3f3bfcfb6eb262416e92290cea1e3666321005f4c73873114e`;
- P8U3 result SHA-256
  `4f3200ef2951403bc2475b4c000ff8c98cc51dc969d77c110ca45cd2616e1396`, tag
  `evo-crm:b798c7d36be8e3325a9621d96e496ec0a2bb624f-p8u3-linux-amd64`, and image
  `sha256:644c40247aed9b132a17782b4f4799af2cfe7fdbcdda7ffc92558b5e7529c806`.

## P8U4A exact proxy seam

Only the literal path `/api/platform-ai/staff-assistant` may bypass the generic
disconnected-route and optimistic proxy-level Supabase refresh branches. The
proxy must pass the request to the existing route handler with the request ID
and private no-store response boundary. It must not authenticate, authorize or
produce a draft itself.

This is not an Auth bypass. The route handler independently requires:

- exact `POST`, same-origin and `application/json` request boundaries;
- the complete disabled-by-default P8U1 configuration;
- request-scoped Supabase actor resolution when enabled;
- authenticated `admin`, `sales` or `curator` role in the configured
  organization;
- the frozen request, rate, retrieval, provider and audit contracts.

With the enabling configuration absent, the route must stop before request-body
processing, actor resolution, database access or provider access and return
exact HTTP `503` JSON `{"error":{"code":"assistant_disabled"}}`.

Every near path, descendant, different Platform AI API and unrelated legacy API
continues through the existing disconnected-route boundary. Tests must prove at
least the exact path passes, one descendant and one sibling remain HTTP `403`,
and the passed request reaches the disabled handler contract.

P8U4A performs no Docker, Supabase, Gemini, knowledge, WAHA, WhatsApp, amoCRM,
DNS, production, deploy, restart or public-route action.

## P8U4B later private candidate

P8U4B is a separate reviewed issue/PR after P8U4A merge. It must freeze:

- the exact P8U4A application merge commit, tree, parent and successful
  exact-main CI run;
- a clean detached application source and a distinct clean release-control
  checkout;
- a new tag, OCI version, smoke-container name and evidence root that are all
  absent before execution;
- the exact immutable P8U2 and P8U3 evidence roots, file allowlists, modes,
  hashes, tags and image IDs as pre/post preservation conditions.

The one permitted candidate attempt must use OrbStack with Docker context
exactly `orbstack`, build `linux/amd64`, use the immutable image ID for SBOM and
network-none smoke, run as UID/GID 1001, use no mounts/caller credentials, and
prove both `/api/health` and the exact disabled assistant response. Evidence
remains private, mode-bound, closed-schema validated and privacy scanned.

P8U4B still grants no transfer, production deploy, public routing, Auth
activation, knowledge import, Supabase mutation, Gemini call, WAHA/WhatsApp
action, amoCRM access or customer-data access.

## Gates

P8U4A requires focused and full tests, lint, build, diff-check, independent
exact-head review, 4/4 exact-head CI, merge and successful exact-main CI.
P8U4B requires its own plan freshness, implementation review, exact-head CI,
merge and exact-main CI before one local candidate attempt. A local candidate
is not production authority or a deployment claim.

## P8U4B exact execution freeze

P8U4A is merged as application commit
`93d07740e15b05067af31b4aa03c865b6b1cebda`, tree
`6ef0aea5eedaa26bd4d7de857bfa9bee9ff4e888`, parent
`a63236838964542f712639aae83597747fee639f`, with successful exact-main push
CI run `32081894062`. P8U4B must build only that application identity from the
clean detached checkout
`/Users/iskhak.tazhibaev/.codex/worktrees/evo-platform-p8u2-source`. The
release-control checkout is separately
`/Users/iskhak.tazhibaev/.codex/worktrees/evo-platform-p8u2-tooling`; it must be
clean current `origin/main`, contain the reviewed P8U4B runner/schema bytes,
and have exactly one successful exact-main push CI run before execution.

The collision-free target identity is exact:

- tag:
  `evo-crm:93d07740e15b05067af31b4aa03c865b6b1cebda-p8u4-linux-amd64`;
- OCI version: `p8u4-93d07740-20260818`;
- smoke container: `evo-p8u4-smoke-93d07740e15b`;
- evidence root:
  `p8u4-root-93d07740e15b05067af31b4aa03c865b6b1cebda-20260818`.

The target tag, smoke-container name and evidence root must be absent before
the attempt. The OCI version is written only as the new target image label and
must equal the frozen value after build. The retained
`.evo-release-evidence` parent remains a real non-symlink mode-`0700`
directory under the application checkout. The new root is created once as a
real mode-`0700` directory. A successful result contains exactly six regular
non-symlink mode-`0600` files: `build-crm.log`, `candidate-result.json`,
`collection-index.json`, `image-identity.json`, `sbom-crm.spdx.json`, and
`smoke-crm.log`. A failed result retains only `candidate-result.json` plus the
exact already-created prefix of those artifacts; it must not fabricate a
later artifact, and retains `collection-index.json` only when that complete
index was already created before the failure. Every retained file remains
mode `0600`.

P8U4B must preserve and verify before and after every local Docker/evidence
effect:

- P8U2 root
  `p8u2-root-b798c7d36be8e3325a9621d96e496ec0a2bb624f-20260818`, exact
  three-file allowlist, root mode `0700`, files mode `0600`, result SHA-256
  `c4416cbe6cfb78187275069035da248229594920624eb2c22d0811e24472a7ec`,
  build SHA-256
  `c478bd933f8f89bb2a117a2d50cf5bd9612f8356d01d5ea3135ccf594227377a`,
  image-identity SHA-256
  `8d0b470a7d67b39bc2f2703020cea7d18a9515fe86a2947bec4e6af23ed8f763`,
  tag
  `evo-crm:b798c7d36be8e3325a9621d96e496ec0a2bb624f-p8u2-linux-amd64`, and
  image ID
  `sha256:1483c286f7d4db3f3bfcfb6eb262416e92290cea1e3666321005f4c73873114e`;
- P8U3 root
  `p8u3-root-b798c7d36be8e3325a9621d96e496ec0a2bb624f-20260818`, exact
  four-file allowlist, root mode `0700`, files mode `0600`, build SHA-256
  `4a5483cafb04f3b34056b5257dc262df4585723c001f2edbe2930c160f6bf196`,
  result SHA-256
  `4f3200ef2951403bc2475b4c000ff8c98cc51dc969d77c110ca45cd2616e1396`,
  image-identity SHA-256
  `877a315bd1e4ae418ed90fdb0bc244edb9cd251507715369974625040c7cfb62`,
  SBOM SHA-256
  `a1b1f1eb929a39e038b26d4014dff6abd3c36491df51e7b96b8f9cb17f5029b0`,
  tag
  `evo-crm:b798c7d36be8e3325a9621d96e496ec0a2bb624f-p8u3-linux-amd64`, and
  image ID
  `sha256:644c40247aed9b132a17782b4f4799af2cfe7fdbcdda7ffc92558b5e7529c806`.

Every Docker command, including cleanup, must immediately recheck OrbStack is
`Running` and Docker context is exactly `orbstack`. The build is
`linux/amd64 --load`; SBOM and smoke use the immutable inspected image ID, not
the mutable tag. Smoke uses network `none`, no mounts, configured user
`nextjs`, actual UID/GID `1001`, exact `/api/health` HTTP `200`, and exact
staff-assistant HTTP `503` body
`{"error":{"code":"assistant_disabled"}}`. The result may be
`candidate_verified` only after the complete retained evidence graph,
privacy scan, target-image identity, container ownership/cleanup, and both
preservation boundaries are revalidated from retained bytes.

The smoke container receives no caller environment except exactly
`EVO_PLATFORM_P7B_OBSERVABILITY_ENABLED=1` and one fresh random process-only
`EVO_PLATFORM_P7B_OBSERVABILITY_SECRET` HMAC generated by the runner. The HMAC
value is never printed, returned or retained. The runner must prove the exact
two injected variable names, `caller_credential_count=0`, and zero
staff-assistant enablement, Supabase, Gemini, WAHA and amoCRM settings in the
closed result/evidence. Any extra environment variable injected by the runner
is blocking.
