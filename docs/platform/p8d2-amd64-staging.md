# P8D2 Linux/AMD64 Hermes Staging Contract

Date: 2026-08-15
Issue: #202
Status: superseded staging source under #376/ADR 0020; not an active gate
Block-ID: `EVO-P8D2-LINUX-AMD64-HERMES-STAGING-2026-08-15`

## Goal

Stage the exact reviewed P8B2 Linux/AMD64 candidate, closed evidence, and a
rollback bundle on `hermes-vps` without changing any running container or
external service. Staging may load immutable images into the Hermes Docker
image store; it may not recreate, restart, stop, pause, or signal a container.

## Frozen identities

- Source commit: `0505143657858e710acdd5029f1cc77c5524083e`.
- Source tree: `0563636057a19949a8927abc3ce02b32ba65896c`.
- Source base: `5c948aa8e6b8de402523ccd949a67001a7275f68`.
- Target: exact `linux/amd64`, empty variant.
- CRM image: `sha256:a5421b190e4db827df7333666a9d95a2c01adcb01e2ebb848ee8cfe11ad803dd`.
- Inbox image: `sha256:bed40447beb0255a9fe64f75446fb7259cd02d219a89c4e01627b980fc0e154c`.
- Lead Agent image: `sha256:6cac77644b4824ac31e53aea35d8d6598426cb5b75862d324a17e171d4a5f1a5`.
- Candidate manifest SHA-256: `f9c27c86e7326a59bf95dfb6cbc8c370e673f9c6a603a3d88bc10c279fc20d91`.
- Candidate evidence index SHA-256: `cd22b8bdb85bde1fa3cf1b84fbe56818878e4a3468fa89a8b26e8b4d000974b1`.
- P8B2 collection index SHA-256: `e20e4989eebb62ff0da1fa497be138cf09eb0aa5dd6b4f0821f49f255c6e7a9e`.
- P8C2 report SHA-256: `5b947c41ef1bb260ae781666464c1f3678b7dbc2276efef0ef5490f10401e13a`.
- Release-control main: `a6dc6df1d3c6e2986d63cd4ecc12e0877b2d0057`.
- Release name: `2026-08-15.p8d2.1`.

The existing `2026-08-15.p8d.1` evidence is the failed ARM64 attempt. It is
immutable history and must never be overwritten, reused, renamed, or relabelled.

## Authorization

The owner gave fresh staging-only approval at `2026-08-15T13:26:01Z`.
Execution begins only after independent exact-head approval, merge, and green
exact-main CI. The mutation window is 120 minutes from the recorded UTC start.
Expiry stops staging without touching running services; a later attempt needs
fresh owner approval.

This approval covers archive construction, transfer, hash verification, image
loading, private evidence staging, and rollback capture only. It does not
authorize deployment, provider testing, or customer-data access.

## Mandatory preflight

Before archive or remote-directory creation:

1. Require local `orb status` = `Running` and Docker context = `orbstack`.
2. Require all local tags to match the frozen full IDs, target platform, empty
   variant, and OCI revision `050514...`.
3. Recompute the four evidence hashes, require directory mode `0700`, used
   files mode `0600`, and validate the P8C2 report against its closed v2 schema.
4. Read Hermes architecture, free disk, container image IDs, health, restart
   counts, start timestamps, networks, and destination absence. Require
   `linux/amd64`, healthy current app/WAHA containers, restart count zero, and a
   conservative estimate leaving at least 20 GiB free after candidate and
   rollback archives.
5. Require all three new destinations to be absent; any collision stops work.
6. Record only safe IDs, states, counts, modes, timestamps, and hashes. Never
   print or place environment values in evidence.

Identity, ownership, health, capacity, mode, hash, topology, or destination
drift stops staging before mutation.

## Exact staging procedure

The only authorized local evidence source is
`/Users/iskhak.tazhibaev/.codex/worktrees/e9a7/evo_AI_CRM/.evo-release-evidence/p8c2-0505143657858e710acdd5029f1cc77c5524083e-linux-amd64-20260815`.
It must be a real, non-symlink mode-`0700` directory. The transfer allowlist is
closed to these regular, non-symlink mode-`0600` files; no glob, recursive copy,
or unlisted file is permitted:

```text
amocrm-reconciliation.json
build-crm.log
build-inbox.log
build-lead-agent.log
candidate-manifest.json
collection-index.json
configuration-identity.json
evidence-index.json
gemini-reconciliation.json
github-reconciliation.json
hermes-reconciliation.json
image-identity.json
managed-supabase-reconciliation.json
migration-identity.json
observations.json
p8b-evidence-index.json
p8c2-report-repeat.json
p8c2-report.json
repository-identity.json
rollback-reconciliation.json
runtime-setting-inventory.json
sbom-crm.spdx.json
sbom-identity.json
sbom-inbox.spdx.json
sbom-lead-agent.spdx.json
smoke-crm.log
smoke-identity.json
smoke-inbox.log
smoke-lead-agent.log
validation-identity.json
waha-reconciliation.json
```

The exact local tag to archive mapping is:

| Service | Frozen tag | Candidate archive |
| --- | --- | --- |
| CRM | `evo-crm:0505143657858e710acdd5029f1cc77c5524083e-linux-amd64` | `evo-crm-0505143657858e710acdd5029f1cc77c5524083e-linux-amd64.tar` |
| Inbox | `evo-inbox:0505143657858e710acdd5029f1cc77c5524083e-linux-amd64` | `evo-inbox-0505143657858e710acdd5029f1cc77c5524083e-linux-amd64.tar` |
| Lead Agent | `evo-lead-agent:0505143657858e710acdd5029f1cc77c5524083e-linux-amd64` | `evo-lead-agent-0505143657858e710acdd5029f1cc77c5524083e-linux-amd64.tar` |

The exact rollback environment matrix is closed to three files. WAHA env files
and every other secret file are outside this staging authority:

| Source | Rollback destination filename |
| --- | --- |
| `/opt/evo-crm/.env.production` | `env-crm-production.rollback` |
| `/opt/evo-crm/.env.lead-agent` | `env-lead-agent.rollback` |
| `/opt/evo-inbox/agent-lead2-crmwhatsapp/.env.production` | `env-inbox-production.rollback` |

Each source must be a root-owned, root-group, mode-`0600`, regular non-symlink
file. Each destination must be absent. Copy only with an explicit
`install -o root -g root -m 0600 -- SOURCE DESTINATION`; stop on a missing
source, unexpected owner/mode/type, existing destination, or any extra selected
input. Hash bytes without printing them. Redacted evidence contains only the
fixed destination name, SHA-256, mode, and success code, never the source path
or value.

1. Create a local mode-`0700` `mktemp -d`. For each row above, run the exact
   equivalent of `docker image save --platform=linux/amd64 --output ARCHIVE TAG`.
   Require the archive path absent before creation, then set mode `0600`, hash
   it, and re-inspect the tag against the frozen image ID before transfer.
2. Create only these new root-owned mode-`0700` Hermes directories:
   - `/opt/evo-releases/0505143657858e710acdd5029f1cc77c5524083e/2026-08-15.p8d2.1`;
   - `/opt/evo-release-evidence/0505143657858e710acdd5029f1cc77c5524083e/2026-08-15.p8d2.1`;
   - `/opt/evo-release-rollback/2026-08-15.p8d2.1`.
3. Before loading candidates, save the exact currently running image ID behind
   `evo-crm-app-1`, `evo-inbox-app-1`, and `evo-crm-lead-agent-1` with
   `docker image save --platform=linux/amd64 --output` to, respectively,
   `rollback-evo-crm-current.tar`, `rollback-evo-inbox-current.tar`, and
   `rollback-evo-lead-agent-current.tar` in the rollback directory. All three
   destinations must be absent and mode `0600`. Then apply only the closed
   three-row environment matrix above. Hash every rollback artifact without
   printing its bytes.
4. Transfer the three exact candidate archives and each explicitly allowlisted
   evidence file with `scp -p --` to a newly created root-owned mode-`0700`
   incoming directory inside the matching release directory; do not transfer a
   parent directory or use `*`. On Hermes, require every destination absent,
   then use `install -o root -g root -m 0600 --` for the fixed archive/evidence
   destination names. Recompute every local and remote SHA-256 and require
   equality before loading. Require root ownership, directories `0700`, files
   `0600`, regular files only, and no symlinks. Evidence files land under the
   exact evidence directory with unchanged basenames; candidate archives land
   under the exact release directory with the three table names.
5. Require all three exact candidate tags absent. Load each named archive with
   `docker image load --platform=linux/amd64 --input ARCHIVE`; inspect each exact
   tag and require its frozen full ID, `linux/amd64`, empty variant, source
   label, and OCI revision. Require the loaded tag-to-ID mapping to equal the
   table and frozen identities. Never retag or substitute an image.
6. Write a closed redacted staging result with fixed release/source IDs,
   archive hashes, safe image/platform fields, pre/post running image IDs,
   health, restart counts, start timestamps, rollback hashes, and result codes.
   Evidence is mode `0600` and contains no env value, token, provider URL,
   customer identifier, arbitrary log, or SBOM body.
7. Re-read all running services. They must retain the preflight image IDs and
   start timestamps, remain healthy, and have restart count zero. No Compose up,
   restart, stop, pause, kill, rename, network mutation, or recreation is allowed.
8. Remove only local temporary image archives after remote archive/evidence and
   rollback hashes are proven. Retain the reviewed local evidence root.

The archive commands follow Docker's current official `docker image save` and
`docker image load` contracts, including their exact `--platform=linux/amd64`
selection and fail-closed behavior when that platform is absent:
<https://docs.docker.com/reference/cli/docker/image/save/> and
<https://docs.docker.com/reference/cli/docker/image/load/>.

## Stop and cleanup

- Before directory creation, stop with zero remote mutation.
- After directory creation, retain any partial root-only bundle with a redacted
  failure code; never silently delete, repair, or reuse it.
- After image-load failure, do not automatically remove or retag anything.
- Never prune Docker, delete existing images/volumes/networks, overwrite the
  ARM64 attempt, or broaden cleanup to unrelated projects.

## Completion and next gate

Staging completes only when all exact AMD64 images and rollback/evidence
bundles are verified on Hermes while every running service remains unchanged
and healthy. Then rerun read-only P8C2. Deployment remains separately gated and
must replace the old ARM64 matrix with exact P8B2 identities before recreation.

No WAHA/Caddy/DNS/session/QR mutation, WhatsApp send, Gemini content call,
amoCRM access, Supabase write, customer-data inspection, billed resource, or
provider mutation is authorized.
