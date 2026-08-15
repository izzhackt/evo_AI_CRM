# P8D3 Portable Linux/AMD64 Hermes Staging Contract

Date: 2026-08-15
Issue: #209
Status: proposed staging gate
Block-ID: `EVO-P8D3-PORTABLE-AMD64-HERMES-STAGING-2026-08-15`

## Goal and authority

Complete staging of the exact P8B3 candidate on `hermes-vps` without changing
any running container or external service. The owner gave fresh staging-only
approval at `2026-08-15T15:08:40Z`. Execution begins only after this contract
is independently approved, merged, and exact-main CI is green. The mutation
window is 120 minutes from the recorded execution start; expiry requires fresh
approval.

This authority permits new root-only release/evidence/rollback directories,
fresh rollback capture, byte-verified evidence transfer, and reuse of the
already proven P8D2 image-load checkpoint. It does not permit a second image
load when the exact tag already resolves to the P8B3 manifest digest. It never
permits deploy/recreate/restart/stop/pause/signal, provider access, customer
data, DNS, WAHA/session/webhook/QR changes, WhatsApp sends, Gemini content
calls, amoCRM access, Supabase writes, billed resources, prune or cleanup.

## Frozen identities

- Application source: `0505143657858e710acdd5029f1cc77c5524083e`.
- Target: `linux/amd64`, empty variant.
- P8B3 identity SHA-256: `d931ebdcf17dce16018e85780a67e569fcaa8d2ca53d70b7fe49f4db1cc7f785`.
- P8B3 collection SHA-256: `f2f080baf53d237996b910eaa7991d0ab93b18457cc116b13f9e6b97ba4f92b3`.
- CRM manifest: `sha256:b965ac5c41d4e8bddc6d6bb7baaa7bcec101af4083b8ca861f9e9904cec9eafd`.
- Inbox manifest: `sha256:e15c5e07b4232e39622616cb76ed84e1e5b6a7c9145728a42a7701a3238e6b92`.
- Lead Agent manifest: `sha256:572d01c6f2a0824e56607f41d4376e927ccdf41c5218c6dd65930f95cd6593cd`.
- Archive SHA-256 values: CRM `51e2945406fdd569a2d5e9e227ae7fc1e088a28126da2b30cc1a925179d2e21d`, Inbox `16a536ccfb0132fb3efde05e62a42af8788d7fd21acd5b2bbe614b92d941836a`, Lead Agent `5534265bfd8822f512beb66ad72bbabe09f5795ed16c3d1881050c91b0b6f889`.
- New release name: `2026-08-15.p8d3.1`.

The P8D/P8D2 roots and their failure evidence are immutable. The new exact
destinations must be absent:

- `/opt/evo-releases/0505143657858e710acdd5029f1cc77c5524083e/2026-08-15.p8d3.1`
- `/opt/evo-release-evidence/0505143657858e710acdd5029f1cc77c5524083e/2026-08-15.p8d3.1`
- `/opt/evo-release-rollback/2026-08-15.p8d3.1`

## Real inputs and resume checkpoint

The only local P8B3 root is
`/Users/iskhak.tazhibaev/.codex/worktrees/e9a7/evo_AI_CRM/.evo-release-evidence/p8b3-portable-0505143657858e710acdd5029f1cc77c5524083e-20260815-reviewed`.
It must be a regular non-symlink directory, mode `0700`, with exactly these five
regular non-symlink mode-`0600` files and no extras:

```text
collection-index.json
portable-image-identity.json
evo-crm-0505143657858e710acdd5029f1cc77c5524083e-linux-amd64.tar
evo-inbox-0505143657858e710acdd5029f1cc77c5524083e-linux-amd64.tar
evo-lead-agent-0505143657858e710acdd5029f1cc77c5524083e-linux-amd64.tar
```

P8D2 already transferred and loaded these exact archive bytes before stopping
on the index-versus-manifest comparison error. Reuse is allowed only if fresh
checks prove this exact matrix. The duplicate P8D2 `incoming/` archives are
never valid reuse sources.

| Service | Exact P8D2 source | Exact P8D3 destination | SHA-256 | Exact tag | Expected loaded manifest ID |
| --- | --- | --- | --- | --- | --- |
| CRM | `/opt/evo-releases/0505143657858e710acdd5029f1cc77c5524083e/2026-08-15.p8d2.1/evo-crm-0505143657858e710acdd5029f1cc77c5524083e-linux-amd64.tar` | `/opt/evo-releases/0505143657858e710acdd5029f1cc77c5524083e/2026-08-15.p8d3.1/evo-crm-0505143657858e710acdd5029f1cc77c5524083e-linux-amd64.tar` | `51e2945406fdd569a2d5e9e227ae7fc1e088a28126da2b30cc1a925179d2e21d` | `evo-crm:0505143657858e710acdd5029f1cc77c5524083e-linux-amd64` | `sha256:b965ac5c41d4e8bddc6d6bb7baaa7bcec101af4083b8ca861f9e9904cec9eafd` |
| Inbox | `/opt/evo-releases/0505143657858e710acdd5029f1cc77c5524083e/2026-08-15.p8d2.1/evo-inbox-0505143657858e710acdd5029f1cc77c5524083e-linux-amd64.tar` | `/opt/evo-releases/0505143657858e710acdd5029f1cc77c5524083e/2026-08-15.p8d3.1/evo-inbox-0505143657858e710acdd5029f1cc77c5524083e-linux-amd64.tar` | `16a536ccfb0132fb3efde05e62a42af8788d7fd21acd5b2bbe614b92d941836a` | `evo-inbox:0505143657858e710acdd5029f1cc77c5524083e-linux-amd64` | `sha256:e15c5e07b4232e39622616cb76ed84e1e5b6a7c9145728a42a7701a3238e6b92` |
| Lead Agent | `/opt/evo-releases/0505143657858e710acdd5029f1cc77c5524083e/2026-08-15.p8d2.1/evo-lead-agent-0505143657858e710acdd5029f1cc77c5524083e-linux-amd64.tar` | `/opt/evo-releases/0505143657858e710acdd5029f1cc77c5524083e/2026-08-15.p8d3.1/evo-lead-agent-0505143657858e710acdd5029f1cc77c5524083e-linux-amd64.tar` | `5534265bfd8822f512beb66ad72bbabe09f5795ed16c3d1881050c91b0b6f889` | `evo-lead-agent:0505143657858e710acdd5029f1cc77c5524083e-linux-amd64` | `sha256:572d01c6f2a0824e56607f41d4376e927ccdf41c5218c6dd65930f95cd6593cd` |

Each source must be root:root, mode `0600`, regular/non-symlink; each
destination must be absent. Require every exact tag to resolve to the matrix
manifest ID, `linux/amd64`, empty variant, source label and OCI revision. Any
mismatch stops; do not reload, retag, delete or repair. Copy each row only with
explicit `install -o root -g root -m 0600 -- SOURCE DESTINATION`; no recursive
copy, glob, hardlink or symlink is allowed.

## Mandatory preflight and rollback

1. Require OrbStack `Running` and local Docker context exactly `orbstack`.
2. Validate P8B3 identity with its merged Draft 2020-12 schema and rerun the
   real archive-derived test over all three archives.
3. Require Hermes `x86_64`, at least 20 GiB conservative free space after the
   new release/rollback copies, and all destinations absent.
4. Snapshot safe pre-state for exact containers `evo-crm-app-1`,
   `evo-crm-lead-agent-1`, `evo-inbox-app-1`, `evo-crm-waha-1`, and
   `evo-inbox-waha`: image ID, health, restart count and start timestamp.
   Require running/healthy and restart count zero.
5. Create the three exact destinations root:root mode `0700`, failing on any
   collision. Retain a partial root with a redacted failure result after this.
6. Save the exact current images for the three application containers as
   `rollback-evo-crm-current.tar`, `rollback-evo-lead-agent-current.tar`, and
   `rollback-evo-inbox-current.tar`, root:root mode `0600`.
7. Copy only this closed env matrix into rollback storage using explicit
   `install`; each source must be root:root, mode `0600`, regular/non-symlink:

| Source | Destination |
| --- | --- |
| `/opt/evo-crm/.env.production` | `env-crm-production.rollback` |
| `/opt/evo-crm/.env.lead-agent` | `env-lead-agent.rollback` |
| `/opt/evo-inbox/agent-lead2-crmwhatsapp/.env.production` | `env-inbox-production.rollback` |

Hash rollback bytes without printing them. Evidence may contain only fixed
destination names, hashes, modes and result codes.

## Staging and completion

Transfer `portable-image-identity.json` and `collection-index.json` individually
through collision-free incoming names, verify local/remote SHA-256 equality,
then install them mode `0600` into the new evidence root. Copy the three
hash-proven P8D2 remote archives into the new release root with fixed names and
recompute hashes. Do not load an image because the exact P8B3 manifests are
already present; if any tag is absent, staging stops and a new contract is
required rather than silently broadening this resume procedure.

Write `staging-result.json` against the closed merged schema
`docs/schemas/p8d3-staging-result.schema.json`. The result is created as a new
mode-`0600` temporary file in the evidence directory, validated locally with a
Draft 2020-12 validator after a read-only copy, then atomically renamed to the
final absent path and hashed into `staging-result.sha256` via the same
temp/validate/rename discipline. Fixed result codes are `staged_verified`,
`preflight_blocked`, `checkpoint_mismatch`, `rollback_failed`,
`evidence_transfer_failed`, and `running_state_changed`. No env value, token,
URL, arbitrary log, SBOM body or customer/provider identifier is allowed.

Re-read all five running containers and require byte-equal pre/post safe state.
P8D3 deliberately does not rerun P8C2: its known WAHA, amoCRM, DNS and managed
migration-ledger checks would require provider/credential access that this
staging approval excludes, while staging changes no running configuration.
The retained P8C2 result remains truthfully `blocked`. `staged_verified` proves
only that the new release/evidence/rollback roots and exact existing images
verify while the running system is unchanged. Every other result code is a
failed staging outcome and stops before any later deployment gate.

Docker archive semantics follow the current official
[save](https://docs.docker.com/reference/cli/docker/image/save/) and
[load](https://docs.docker.com/reference/cli/docker/image/load/) contracts;
OCI index/manifest identity follows the current
[OCI descriptor specification](https://github.com/opencontainers/image-spec/blob/main/descriptor.md).

Application activation remains a separate P8D4 contract, review, exact-main
gate and fresh owner approval. Release-control main now contains migration
`073` and an updated future-candidate migration inventory; the frozen P8B3
application images predate that migration. P8D3 stages their exact bytes only
and does not assert runtime compatibility. P8D4 must close that compatibility
decision before any deployment.
