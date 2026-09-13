# Runtime image identity for trusted document receipts

Date: 2026-09-14. Pre-code contract; base c2ddd12d29334480182659a9614ce0d1c1b7fd90.
Scope: the existing release controller and its private environment snapshots.
This is a dependency for D4 receipts, not document ingestion or release proof.

## Authority and command contract

- `EVO_RUNTIME_IMAGE_ID` is controller-generated, never operator/client input.
  It is the exact attested Docker engine-native `state.imageId`, verified against
  the loaded image and running container `.Image`, formatted
  `sha256:` plus 64 lowercase hexadecimal characters. Do not substitute the
  separately attested `imageConfigDigest`, Git revision or an invented hash.
- Candidate preparation reads the private operator env once under the existing
  host lock. A candidate-only sealer rejects any reserved identity key in that
  source, adds the validated image ID and seals the complete bytes once with
  mode0600 and their SHA256. Existing source-change/no-follow/create-once guards
  remain. The historical sealer retains exact-byte copy semantics for rollback.
- Add CLI `--seal-candidate-env <source> --snapshot <destination>
  --runtime-image-id <sha256:id>`. Output remains digest-only `{ok,sha256}`;
  environment values are never logged. Existing seal/validate commands remain.
- Add closed CLI `--verify-runtime-identity --snapshot <sealed-env>
  --runtime-image-id <expected-id> --release-revision <expected-sha>`; bounded
  stdin carries Docker's actual environment JSON array, stdout is `{ok:true}`
  only. `--historical-previous` is restricted to already verified rollback
  previous-generation checks and permits absent image ID only when absent from
  both the frozen previous snapshot and actual previous container.
- Existing archive/config/descriptor/load verification must finish before `up`.
  Candidate preparation alone does not attest the runtime or enable receipts.
- Every new candidate, candidate-status and acceptance identity check requires
  exactly one actual container `EVO_RUNTIME_IMAGE_ID`, equal to both expected
  image ID and `.Image`. Exactly one runtime `EVO_RELEASE_REVISION` must equal
  the verified release revision, not merely its container label.
- Pending recovery validates the same candidate identity. Rollback restores the
  frozen previous env/image pair, including the raw Compose override path.
  A missing image ID is allowed only for an explicitly verified historical
  previous snapshot in rollback; never infer a generic candidate exception.
  Present-but-wrong, duplicate or malformed values always fail closed.
- The application reader is a separate ingress-owned server-only dependency:
  read `process.env.EVO_RUNTIME_IMAGE_ID`, validate the exact format and fail
  closed if unavailable. No request parameter, browser proof or fallback.
  The native parser clears its environment; the trusted parent owns receipts.

## Boundaries and rationale

Reuse hash-sealed `candidate-app.env`/`rollback-app.env` and existing `env_file`;
do not add a mutable image variable to `.env.production`, image hash to its own
Dockerfile, new mount, Docker socket, state schema, or second identity authority.
The explicit Compose environment can override env_file, so verify the actual
container values as well as the frozen snapshot. See
[Docker environment precedence](https://docs.docker.com/compose/how-tos/environment-variables/envvars-precedence/).
Read-only bind mounts prevent container writes, but require a separate
per-generation file/rollback lifecycle without authenticating compromised app
code; see [Docker bind mounts](https://docs.docker.com/engine/storage/bind-mounts/).
[OCI ImageID](https://github.com/opencontainers/image-spec/blob/main/config.md)
names the config hash; this contract deliberately names the engine-native image
identity already bound separately by the EVO archive and loaded-image checks.

## Acceptance and ownership

Only release script, env sealer, their focused tests and this lean plan record
are owned here. No migrations165/166, server reader, native runtime, UI, managed
schema, provider calls, production action or full CI. Other agents own those.

Run actual Node filesystem/CLI tests for candidate sealing and unchanged historic
copy; focused controller command fixtures for prepare/load/status/accept/recovery/
rollback, identity drift and the narrowly scoped historical exception; bash syntax,
focused lint and diff checks. Fixtures are control-flow tests, not service proof.
Additionally exercise sealed env transport/readback with an actual exclusively
owned network-none container after OrbStack Running/context=orbstack preflight,
using its real inspected image ID and proving exact owned-container cleanup.
No duplicate Next build. Freeze exact diff and evidence for independent review
before commit/push/PR; deployment remains a separate root-controlled gate.

## Local execution evidence

Node22.23.1: `node --test tests/app-env-contract.test.mjs
tests/fast-release-control.test.mjs` exited0:46 passed, one opt-in container check
skipped, no failures (raw receipt `01a09cfc700c752199919f3bf0744d26`). This includes
the actual filesystem/CLI checks and synthetic interrupted-controller fixtures;
it is not real provider, host deployment or browser acceptance.

The opt-in `EVO_RUNTIME_IDENTITY_IMAGE=<actual image ID> node --test
--test-name-pattern='actual OrbStack container' tests/fast-release-control.test.mjs`
separately passed1/1 (receipt `01a09cf9d8d17af3bd067b679ba77e19`). OrbStack Running
and context=orbstack were checked before every Docker operation. Existing local
Linuxarm64 image `sha256:75bca775dc4b0902538376554dc56e0123daa06c7eeaf245612f4a59e0712e96`
with revision `ef279986124c7b1f8298994d152ee134aced655c` transported the sealed ID
through actual Compose and exposed it to an actual Node process; wrong revision
was rejected. Owned project `evo-identity-e30d989b` was removed and container
absence confirmed. This reused an existing image, not proof of a newly built app
or a real D4 receipt. No image, volume or unrelated container was removed.

Scoped ESLint, bash syntax and diff checks exited0
(`01a09cfc3cfd7ef0beecfbae4ca32575`); lint reused the existing combined-tree config
and dependencies, with its React auto-detection warning because this isolated
tree has no installed React. Only the three changed JS files were linted; no UI,
Next build, full CI, managed schema or production check was claimed.
