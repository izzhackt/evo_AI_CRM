# P8U2 private root candidate contract

Date: 2026-08-18
Issue: #280
Status: planning gate

## Outcome

Produce one private root EVO CRM image from the reviewed P8U1 application
source. The candidate remains local to OrbStack and is never transferred,
routed, deployed or exposed. Auth and the staff-assistant enable flag remain
absent, so the new route must fail closed before actor, database or provider
access.

## Frozen application identity

- commit: `b798c7d36be8e3325a9621d96e496ec0a2bb624f`;
- tree: `eb3a8a863e014606e707bd279f67d9194663e30a`;
- exact parent: `42dc877b6ce3a2c5c8f7f42c6adc192399322d07`;
- exact-main CI: `32072948258`, completed successfully;
- platform: `linux/amd64`, with missing or empty variant;
- tag:
  `evo-crm:b798c7d36be8e3325a9621d96e496ec0a2bb624f-p8u2-linux-amd64`;
- OCI source: `https://github.com/izzhackt/evo_AI_CRM`;
- OCI revision: the frozen application commit;
- OCI version: `p8u2-b798c7d3-20260818`.

The application source is a clean detached checkout at the frozen commit. The
release-control checkout is a separate clean checkout at the eventual merged
P8U2 tooling commit. Immediately before execution, the runner must require its
HEAD to equal current `origin/main`, require a singular successful push CI run
for that exact commit, and record its commit, tree, run and controlled-file
hashes. This keeps application identity separate from the later tooling
identity without inventing an unknown squash commit.

## Closed local paths

- evidence parent: `<application-source>/.evo-release-evidence`, mode `0700`;
- final evidence root:
  `<application-source>/.evo-release-evidence/p8u2-root-b798c7d36be8e3325a9621d96e496ec0a2bb624f-20260818`,
  mode `0700` and absent before the run;
- target files, all regular non-symlink mode `0600`:
  `build-crm.log`, `image-identity.json`, `sbom-crm.spdx.json`,
  `smoke-crm.log`, `candidate-result.json`, and `collection-index.json`.

No other retained file is allowed. Temporary files stay under a mode-`0700`
temporary subroot and are removed in a finally-style path. Failure to clean a
created smoke container or temporary subroot is blocking and must not produce
`candidate_verified`.

## Tooling contract

Add one P8U2 runner, one Draft 2020-12 result schema and focused behavioral
tests. The runner must:

1. verify `orb status` is exactly `Running` and `docker context show` is
   exactly `orbstack` before every local Docker effect;
2. verify the clean application and release-control Git identities, the exact
   current-main successful push CI and the SHA-256 of the runner, schema,
   `Dockerfile`, `package.json` and lockfile;
3. obtain one successful closed image inventory and stop on malformed output,
   duplicate target rows or an existing target tag; an operational inventory
   failure must never be treated as absence;
4. reject an existing evidence root or exact smoke container; no overwrite,
   retag or stale reuse is allowed;
5. run one real `docker buildx build --platform linux/amd64 --load` with the
   frozen tag and OCI build arguments, capturing the real exit before any
   success marker;
6. inspect the built tag and require one exact image ID, `linux/amd64`, empty
   variant, exact OCI source/revision/version labels and configured image user
   `nextjs`;
7. generate a fresh SPDX-JSON SBOM with the installed `docker sbom` plugin,
   require its successful exit and bind its hash to the exact image ID; stale
   SBOM reuse is prohibited;
8. run the exact image with `--platform linux/amd64 --network none`, no mounts,
   no caller environment or credentials, and no restart policy. Only a fresh
   process-only random P7B observability HMAC may be injected; it is never
   written to evidence;
9. verify the running process is UID/GID `1001:1001`, configured user is
   `nextjs`, restart count remains zero and there is no outbound network;
10. from inside the container, require `GET /api/health` to return exact HTTP
    `200` JSON `{\"ok\":true,\"status\":\"live\",\"service\":\"evo-crm\"}`;
11. from inside the container, require a same-origin JSON `POST` to
    `/api/platform-ai/staff-assistant` with the fixed synthetic body
    `{\"audience\":\"internal\",\"turns\":[{\"role\":\"user\",\"text\":\"private disabled-route probe\"}]}`
    to return exact HTTP `503` JSON
    `{\"error\":{\"code\":\"assistant_disabled\"}}`;
12. perform no database, provider, knowledge, customer-data, WAHA, amoCRM or
    external HTTP call. The smoke container has no network and receives none of
    the staff-assistant, Supabase, Gemini, WAHA or amoCRM settings;
13. scan the complete retained root for credentials, UUIDs, email/phone data,
    private paths and unsafe output. Canonical upstream SPDX originator and
    download identifiers may use only the already reviewed narrow path/value
    exceptions; credential scanning always covers untouched bytes;
14. write `collection-index.json` and `candidate-result.json` through
    mode-`0600` temporary files followed by atomic rename. The collection index
    enumerates exactly the four named non-index/non-result artifacts:
    `build-crm.log`, `image-identity.json`, `sbom-crm.spdx.json` and
    `smoke-crm.log`. `candidate-result.json` binds the collection-index hash
    and the same four artifact identities. The index and result do not hash
    themselves. Recheck the exact six-file root, all non-circular hashes,
    sizes and modes before success.

## Result contract

`docs/schemas/p8u2-root-candidate.schema.json` is closed and versioned.
`candidate_verified` requires exact frozen application identity; exact
release-control commit/tree/CI and controlled hashes; target tag/image/platform,
OCI labels and user; build log hash and real exit zero; fresh SBOM file/hash,
format/tool and exact image ID; exact smoke network/mount/env/user/restart,
health and disabled-route results; privacy status; cleanup status; the exact
four-entry collection index; and the exact six-file retained-root allowlist.

Failure results use closed step-specific codes and truthful partial evidence.
They may not claim later verified phases. A retained failure file never becomes
a valid candidate and does not authorize retry under the same evidence root or
tag.

## Review and execution order

1. Independently review this plan before runner/schema/test implementation.
2. Implement with TDD and obtain independent exact-head review plus 4/4 CI.
3. Squash merge and require exact-main CI success.
4. Create a clean detached application checkout at the frozen source, pass the
   OrbStack preflight, and run the reviewed runner once.
5. Independently review the exact retained evidence and live local image.
6. Stop. Do not transfer or deploy the candidate. Auth provisioning and public
   release remain separate later blocks.

## Safety boundary and stop conditions

This block authorizes only repository tooling/tests and one local private
OrbStack build/SBOM/network-none smoke. It grants no Hermes/production,
registry upload, Supabase read/write, knowledge import, Gemini call, Auth
activation, customer-data access, Caddy/DNS, restart, WAHA, WhatsApp, amoCRM,
autonomous reply, outbound send or billed-resource authority.

Stop on Git/tree/CI/hash drift, dirty checkout, wrong runtime/context/platform,
stale tag/root/container/SBOM, schema or privacy failure, non-root/user drift,
unexpected mount/environment/network, health or disabled-route mismatch,
restart, cleanup failure, or any need for production/provider/customer access.
