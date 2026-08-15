# P8B2 Linux/AMD64 Candidate Contract

Date: 2026-08-15  
Issue: #188  
Status: planning gate

## Why a new candidate is required

The first P8D deployment stopped at the Lead Agent boundary. The retained P8B
images were real `linux/arm64` images built on the Apple Silicon development
host, while Hermes reports `linux/amd64`. The Lead Agent process failed with an
`Exec format error`; rollback restored the previous image and all three
application services are healthy. CRM and Inbox were not recreated. No WAHA,
provider, DNS, Supabase-data or customer-data mutation occurred.

An image platform is part of immutable release identity. Retagging the ARM64
images, asking the AMD64 host to emulate them, or rebuilding under the old P8B
identity is prohibited.

## Frozen source and target

- Application source commit:
  `0505143657858e710acdd5029f1cc77c5524083e`.
- Application source tree:
  `0563636057a19949a8927abc3ce02b32ba65896c`.
- Application base commit:
  `5c948aa8e6b8de402523ccd949a67001a7275f68`.
- Target platform: exact `linux/amd64`, with no variant.
- Build runtime: local OrbStack only after the mandatory `orb status` and
  `docker context show` preflight.
- Deployment host: Hermes, whose platform must be re-read as `linux/amd64`
  immediately before image transfer and deployment.

The source bytes remain the reviewed P8B application bytes. The new platform,
image IDs, build records, manifest and evidence index form a different P8B2
candidate. The current release-control `main` commit may orchestrate the build
and deployment but may not be substituted for the application source identity.

## Candidate construction

1. Extend the closed P8 manifest/evidence contract so each image records exact
   OCI `os`, `architecture` and optional `variant`; all three must equal the
   frozen target.
2. Create three distinct tags suffixed with `-linux-amd64`. Never overwrite the
   retained ARM64 P8B tags.
3. Use `docker buildx build --platform linux/amd64 --load` against the exact
   detached source tree. Record the real command outcome and build log for each
   image. Do not use a registry/cloud builder or billed service.
4. Require each loaded image to report `Os=linux`, `Architecture=amd64`, an
   empty variant and the exact application revision label.
5. Generate one SPDX-JSON SBOM per exact image with the locally installed
   `docker sbom`/Syft provider. Record tool versions, image ID, command, file
   SHA-256 and successful exit in closed per-image evidence. SBOM files remain
   mode `0600` under ignored `.evo-release-evidence/`; they may contain package
   and image filesystem metadata but must pass the existing secret/customer
   data rejection before indexing. No SBOM is uploaded to a registry/service.
6. Generate a new deterministic manifest/evidence index. The old ARM64 evidence
   remains retained history and is never relabelled as AMD64 evidence.

BuildKit emulation is accepted only as a construction mechanism. A successful
build is not deployment proof; Hermes must independently inspect the transferred
images as `linux/amd64` before any container recreation.

## Exact provider-disabled smoke procedure

The smoke gate proves that the real image starts and serves its intentionally
dependency-free liveness route on the target instruction set. It does not claim
Supabase, WAHA, Gemini or amoCRM readiness. No mock server or substitute
dependency is used.

For each exact loaded image, start a new disposable container with Docker
network mode `none`, no mounts, no customer data and no provider credentials.
Use a unique container name and remove it after evidence capture. Inspect the
container image ID and platform before starting it, wait only for its bounded
health deadline, and run the liveness request inside that same container:

- CRM: port `3000`, `GET http://127.0.0.1:3000/api/health`, exact safe JSON
  `{ok:true,status:"live",service:"evo-crm"}` and HTTP `200`.
- Inbox: port `3000`, `GET http://127.0.0.1:3000/api/health`, exact safe JSON
  `{ok:true,status:"live",service:"evo-inbox-companion"}` and HTTP `200`.
- Lead Agent: port `8000`, `GET http://127.0.0.1:8000/health`, HTTP `200`,
  `ok:true`, `status:"live"`, `frozen:true`, and `ready:false`.

CRM receives the complete closed P8D Main CRM disabled matrix from
`docs/platform/p8d-disabled-deployment.md`; the kill switch remains `1` and
P7B observability remains enabled with a new process-only smoke HMAC value.
Lead Agent receives exact `EVO_AGENT_FROZEN=true`,
`EVO_AGENT_WORKER_ENABLED=false`, `EVO_AGENT_OUTBOUND_ENABLED=false`, and
`EVO_AGENT_AUTOREPLY_ENABLED=false`. Inbox receives
`EVO_PLATFORM_P7B_OBSERVABILITY_ENABLED=1` plus a distinct process-only smoke
HMAC value. Values exist only in the container process and are never retained.

The container must remain running with restart count zero through the check.
Evidence records image ID, platform, fixed service/route/result codes, start and
finish times, exit status, restart count and a SHA-256 of the redacted log. It
must not record environment values, container inspect environment, arbitrary
logs, tokens, URLs, request contents or filesystem data. Any outbound network
requirement, non-liveness call, timeout, crash, restart, wrong JSON/platform or
secret-like evidence fails the candidate.

## Validation and review order

1. Merge this docs-only amendment after independent exact-head approval and
   green CI.
2. Implement platform-aware manifest/schema/tests in a separate PR; independent
   review, exact-head CI and exact-main CI are mandatory.
3. Build the real three-image P8B2 candidate on OrbStack, retain evidence, and
   generate the three exact SBOMs; commit only safe deterministic
   metadata/tooling changes. Secrets and build arguments remain process-only.
4. Redo P8C environment reconciliation using the P8B2 image IDs and platform
   fields.
5. Ask for a fresh action-time deployment window after every candidate identity
   and rollback prerequisite is verified.
6. Repeat P8D one boundary at a time: Lead Agent, CRM, then Inbox. Stop and
   roll back on any architecture, health, identity or safety-setting mismatch.

## Safety boundary

This contract authorizes planning, local builds, local container smoke checks,
safe evidence and later provider-disabled application deployment only. It does
not authorize WAHA container/session/webhook/QR changes, Caddy or DNS changes,
WhatsApp sends, Gemini customer-content calls, amoCRM reads/writes, autonomous
send, Supabase schema/data writes, customer-record inspection, billed resources
or removal of rollback artifacts.
