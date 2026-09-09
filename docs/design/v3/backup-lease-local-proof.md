# Read-only backup lease: local proof

Status: local transport candidate verified on 2026-09-09. This is **not** a
managed-provider export, restore, migration rehearsal or deployment receipt.
Operators should use the [recovery runbook](../../DISASTER_RECOVERY.md#explicit-short-lived-read-only-transport)
for the separately authorized real export.

## Exact candidate and checks

- Runtime: `224be58b02c66c204a489401b060b14675556668`.
- Runtime plus tests: `71929a91cae39ae410af246c0436ed77dc4992ee`; HEAD was
  checked before and after both final runs.
- Focused exporter/recovery suite: **138/138 passed**, exit 0.
- Release contracts (`npm run test:fast-release`): **148/148 passed**, exit 0.
- Actual disposable PostgreSQL 18.6 proof: **passed**, exit 0, with the
  `MANAGED_BACKUP_READONLY_POSTGRES_VERIFIED` marker.
- ESLint and `git diff --check`: passed. Independent runtime review approved
  the exact runtime commit, including the expanded no-elevation attestation.
- The final Docker inventory contained no remaining proof containers.

Replay from that candidate with Node 22, installed lockfile dependencies,
OrbStack running, Docker context `orbstack`, and cached `postgres:18.6-bookworm`:

```bash
node --test tests/v3-managed-supabase-export.test.mjs tests/v3-managed-supabase-recovery-harness.test.mjs
node scripts/test-v3-managed-backup-readonly-postgres.mjs
```

The recorded runs used
`PATH=/opt/homebrew/opt/node@22/bin:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin`.
No provider credentials are required. The harness creates one uniquely named,
ownership-labelled container with `--network none`, no published ports, a
read-only repository mount and fictional records. It checks ownership before
removing that exact container and its private temporary output.

The SHA-256 of the executed
[PostgreSQL harness](../../../scripts/test-v3-managed-backup-readonly-postgres.mjs)
was `719c5b8c91b0796705aa2499e1ddc361ec0aa230ad12713395dbe4baa9adc43b`.

## What the proof covers

The actual fixed support scripts produced roles, schema, data, migration schema
and migration data. All five matched a privileged control export after only the
existing semantic normalization; a reverse second round stayed identical under
the same exported snapshot despite a concurrent fictional write.

The fixture included Auth users/identities/sessions, forced-RLS private data,
Storage metadata, a sequence, the migration ledger and a custom role/grant.
It proved denied writes and rejection of missing Auth COPY coverage, missing
read access, missing BYPASSRLS, create-role/create-database/replication attributes,
write-role membership and server-file-read elevation. The source-ledger prefix
gate is tested separately; the miniature fixture is not the production ledger.

External HTTP-boundary doubles cover the exact lease request, ownership changes,
ambiguous creation, expiry/interrupts, undrained children and failed cleanup.
They prove that successful capture cannot escape the wrapper until cleanup is
verified. Strict v2 receipt tests reject missing/invalid cleanup evidence while
retaining existing v1 compatibility.

## What remains outside this evidence

The local container uses isolated trust authentication; this does not prove a
managed temporary password, provider role membership, pooler/TLS connection,
Management API mutation or Storage object-byte export. No production data,
Auth users, provider settings, migrations or external messages were changed.

Before a real release: inherit current reviewed `main` dependencies, pass exact-
head CI, obtain the bounded lease/export authorization, perform one real export
inside the exclusive operator window, and then complete isolated restore and
candidate-migration rehearsal. Do not promote this local note into any of those
receipts. Update this note only with a new explicit candidate and observed result.

## Managed read-only checkpoint — September 9, 15:34 UTC

The exporter **preflight**, not `run`, passed on clean `279787cd`. It verified
the configured source identity/runtime keys, six private Storage buckets with
zero objects/bytes, and metadata for the provider backup inserted at September 8,
22:54:26 UTC. This does not capture or restore that backup, attest a usable lease,
or replace the required fresh export of the current 209 imported sales.

Separate read-only Management API inventories established two release blockers:

1. One pre-existing CLI login role expired September 8 at 12:01:57 UTC; zero
   active sessions. It is not the observer role and was not created by this run.
   The provider deletion endpoint is collective. No role was deleted and no
   lease created. Reconcile ownership and obtain explicit authorization before
   cleanup; re-inventory immediately and stop if the exact target changes.
   Retain the exporter's zero-baseline/owned-singleton checks.
2. Source contains two ordinary authenticated Auth identities, both with legacy
   `public.profiles.account_role=owner` links to two distinct `public.accounts`.
   Exactly one has an active Platform profile/Admin membership in the one active
   organization; the second has no Platform membership but owns its legacy
   account. There are no Student case/invitation/provisioning links, other staff
   roles or inactive Platform memberships. No authority-like `app_metadata`
   keys, anonymous/super-admin flags, deleted or banned Auth identities were
   found. No live user login was attempted.

Thus neither the existing exact-one-Auth/Admin recovery exception nor a proposed
one-Admin-plus-fully-unassigned-user exception matches the source. A separately
reviewed restore contract must preserve both Auth identities and legacy account
ownership, verify account isolation, and prove the second identity does not gain
Platform/Student authority. Do not delete that user/account, grant roles, relax a
count comparison, or treat absence of a new Platform profile as absence of all
authority. Current counts also include 209 sales and zero clients: this is not
an empty database.

Root re-read the aggregate evidence; no PII, UUIDs, credentials or metadata blobs
were exposed. Preflight terminal proof: `cfw://span/01a086c5913f75e0bec6db18f2b264a5`.
Classification proofs: `cfw://span/01a086cc62947e30a70fba5b9f14e791`,
`cfw://span/01a086cd1bea7de2a774a55438759748`,
`cfw://span/01a086ce190e77a3bb8aae3fcc25cee4`.
These observations leave the managed export, isolated restore/rehearsal and
production rollout **blocked and unperformed**; the application remains at
`0cbb2d42`, schema 134, with the release arm false.
