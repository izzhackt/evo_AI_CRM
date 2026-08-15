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
   empty variant and the exact application revision label. Require a real
   container/process smoke check for each image with all provider-write and
   autonomous-send paths disabled.
5. Generate a new deterministic manifest/evidence index. The old ARM64 evidence
   remains retained history and is never relabelled as AMD64 evidence.

BuildKit emulation is accepted only as a construction mechanism. A successful
build is not deployment proof; Hermes must independently inspect the transferred
images as `linux/amd64` before any container recreation.

## Validation and review order

1. Merge this docs-only amendment after independent exact-head approval and
   green CI.
2. Implement platform-aware manifest/schema/tests in a separate PR; independent
   review, exact-head CI and exact-main CI are mandatory.
3. Build the real three-image P8B2 candidate on OrbStack, retain evidence, and
   commit only safe deterministic metadata/tooling changes. Secrets and build
   arguments remain process-only.
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

