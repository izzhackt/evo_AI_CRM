# S1 staff directory and D1 private preview — release evidence

Date: 2026-09-13. Release status: accepted `77cde9ba`; full CI and automatic
release passed, independent server/tunnel checks complete, release arm false.
This closes only S1 organization metadata and D1 private document preview,
not dynamic multi-role authority, real employee onboarding or EVO Docs retirement.

## Reviewed source and working checks

- Independent review approved exact candidate
  `bf227fefe082d14fe58ea01cb3cd7e5a30282d9c`, including final evidence limitations.
- [PR741](https://github.com/izzhackt/evo_AI_CRM/pull/741) merged as
  `251dbdc5faf38961224b7755d545ba496e485ad4`. Its tree matches the reviewed candidate.
- [Fast checks34730057643](https://github.com/izzhackt/evo_AI_CRM/actions/runs/34730057643):
  changed range, release contracts, lint, build, migration boundary and aggregate PASS.
- Actual isolated SQL/Auth/Storage/scanner/UI checks and their limits are in
  [the working report](2026-09-13-staff-directory-working-check.md).

## Cleanup — complete

Only the owned temporary environment was removed: eight named containers,
three named volumes, one private network and the Next runtime on3110. Temporary
technical accounts/data and seven private runtime/trace files were deleted without
a backup, as authorized. Sanitized evidence and screenshots remain outside Git at
`/tmp/evo-s1d1-0qOF30`; exact inventories are `cleanup-runtime-receipt.json` and
`cleanup-file-receipt.json`. The original local foundation remained at125 with the
same container/start time. Existing SSH tunnel3000/PID7065 was not changed.
Shared images, production resources and standalone EVO Docs were not deleted.

## Managed schema — complete

- [Check34730312761](https://github.com/izzhackt/evo_AI_CRM/actions/runs/34730312761)
  read154 local migrations and153 managed migrations; only154 was missing,
  with no unexpected managed versions.
- [Apply34730362417](https://github.com/izzhackt/evo_AI_CRM/actions/runs/34730362417)
  used the existing official linked flow and dry-run. Only
  `154_platform_staff_organization_directory.sql` was applied; readback is001–154.
- This additive change creates organization metadata, not employee invitations,
  role grants, Auth accounts or production fixtures. No new backup/rehearsal was
  performed under the standing owner direction; retained recovery data is preserved.

## Release preflight

Independent read-only Hermes check at01:18–01:20UTC passed. Prior accepted
revision `4e35b896e16449a63bd11bffd457ddf4acac6c62` matched the app image, immutable
acceptance record and browser receipt. Pending pointer was absent; app, WAHA and
ClamAV were healthy with zero restarts and private services had no published ports.

Preservation baseline:

- WAHA container `0d1017e3304dfb3e1dce37ca00a2826b019429266763e211ed399b938baaa750`;
  volume `evo-crm_evo_crm_waha_sessions`.
- ClamAV container `7242869f04f446d677339f23271b21dce7a1d2e18c5af6054d6b1c69bdac81fd`;
  volume `evo-crm_evo_crm_clamav_signatures`.
- SSH tunnel `127.0.0.1:3000` targeted the previous app private IP
  `172.16.8.4:3000`; recheck the target after replacement.

Actor ID72846050 matched the authorized GitHub operator. The release arm remained
false during schema preparation and was enabled only after schema/preflight passed
while exact-main [CI34730314289](https://github.com/izzhackt/evo_AI_CRM/actions/runs/34730314289)
was still running on `251dbdc5faf38961224b7755d545ba496e485ad4`.

## First exact-main CI — failed, not released

CI34730314289 passed admission, Node/static and dependency audit. Browser proof
ran20 tests:15 passed,2 existing conditional skips,3 failed. New S1 passed.
The broad document flow successfully uploaded/downloaded/previewed version2 PNG,
then a later Admin assertion still expected the former PDF filename. Its failure
prevented writing the acceptance receipt required by the following D2 test.
The separate company-file upload returned503 instead of201; cause remains under
investigation. Do not claim the full workflow passed or suppress these failures.
Release arm was reset tofalse immediately; no app replacement was attempted.

The correction changes only the stale expected filename and includes a bounded
flat machine error code in the company-upload status assertion. It keeps201,
all byte/preview/access checks and no automatic retries. ESLint, TypeScript and
diff checks passed; a static filename-consistency check is red on251dbdc5 and
green on the correction. This narrow static check is not a replacement for the
real full browser gate. Release34730599728 was skipped after failed CI.

[PR742](https://github.com/izzhackt/evo_AI_CRM/pull/742) was independently approved
at `421ee31057f02ad0ceff7edef07382c435a8e442` and merged with an identical tree as
`aa2e2346917fd580303a822f593b673bcc18f25e`.
[Fast checks34730739207](https://github.com/izzhackt/evo_AI_CRM/actions/runs/34730739207)
passed all selected gates; build/migration jobs were correctly skipped for this
test/docs-only correction. Migration154 was not reapplied.

Hermes preflight was refreshed at01:34:01UTC: previous accepted pointer, absence
of pending, app/WAHA/ClamAV identities, private IP and tunnel health were unchanged.
The arm was re-enabled while the new exact-main
[CI34730840474](https://github.com/izzhackt/evo_AI_CRM/actions/runs/34730840474)
was running onaa2e2346; this is a corrected-source proof, not a blind rerun of
the failed revision. Company503 remains an explicitly unproven cause unless a
later failure supplies its safe machine code.

The second full CI34730840474 also failed:16 passed,2 conditional skips and2
failed. S1 and company-file workflow passed; the broad document flow instead
received504 at its direct Storage list assertion2286, immediately after denying
an unreserved upload. The following D2 again lacked the producer receipt.
This is the same boundary seen in the original local working check, not a
remaining PNG filename mismatch. Arm was reset tofalse, release34731141578 was
skipped and accepted production remained unchanged. The isolated investigation
subsequently localized the failure to Storage HTTP connection lifecycle, without
Next, ClamAV or case data in that environment. Client-only connection changes
and multipart conversion did not resolve it; database queries/locks did not
explain the failure. This is local evidence, not a production defect claim.
Neither a timeout increase, smaller proof input, automatic retry nor authorization
relaxation is an accepted substitute for a transport correction.

The diagnostic environment was fully removed at01:54:20UTC: five owned containers,
two volumes, one network and seven private files. Sanitized evidence remains at
`/tmp/evo-storage-504-nJYScN`, with `cleanup-receipt.json` confirming closed ports
and unchanged protected foundation125 and SSH tunnel3000. No diagnostic scripts
or credential material are copied into the repository.

Fresh read-only Hermes check at02:36:01UTC still found accepted4e35b896, matching
container/acceptance revision, healthy app, zero restarts and no pending pointer.
This verifies container state, not new UI deployment or business acceptance.

## Local gateway correction — validated scope

The foundation harness now applies the supported Kong2.8.1 setting
`upstream_keepalive_pool_size=0` after start/reset, retaining the CLI custom Nginx
template and existing routing. The helper verifies local engine/project/workdir,
same-project network, exact container/version, effective setting, hashes and
health. It does not change managed Supabase or any product permission, payload,
timeout, expected status or retry. See the source-backed PLAN_CHANGES amendment.

Real isolated check on `evo-gateway-validation-s3krxh`, schema154:

- Two actual helper invocations passed effective-setting, routing/hash, identity
  and health readback. Foreign-worktree and remote-Docker guards rejected before
  mutation with their exact machine codes.
- At04:37:51–04:37:54UTC, actual Admin/Sales/Curator password login, live authority
  RPC and Auth user read all returned200 after existing technical provisioning.
- Ordinary private service-operator Storage upload/list/download returned200;
  the existing887079-byte EVO PDF matched SHA256
  `144b1f0183e9868816816beacb5a0a5cd0eec3da6fa7eb8f6a35b16d4854e878` before/after.
  This is transport validation, **not** case permission/reservation/ClamAV proof.
  No ClamAV was started in this small environment; no failure-triggering diagnostic
  was repeated. The full release gate remains pending.
- Protected receipt: `/private/tmp/evo-gateway-validation.S3KrXH/gateway-validation-receipt.json`,
  SHA256 `0e3ab0b73f24a05163ef7a9b4de7f46b6512d5467cd9385ab8168baa393069f0`.
  Temporary identities and object identifiers remain outside Git.
- Node22 syntax, Bash syntax, scoped ESLint, diff check and existing change-classifier
  suite12/12 passed. These static checks do not stand in for the full browser gate.

Independent Hermes preflight at04:38:21UTC again matched the prior accepted app,
record/browser hashes, no pending, unchanged private WAHA/ClamAV and healthy
zero-restart containers. Available disk113.3GiB and RAM9.04GiB exceeded existing
release minimums. GitHub arm=false and configured/current actor72846050 matched.

At04:44:28UTC the isolated gateway validation environment was removed: six owned
containers, two volumes, one network and the private startup log. Official CLI
stop used the exact workdir/project and no backup. The sanitized
`/private/tmp/evo-gateway-validation.S3KrXH/gateway-cleanup-receipt.json` records
zero remaining owned resources, unchanged protected foundation125/container and
SSH tunnel3000/PID7065. Validation receipt/source and the migrations symlink target
were preserved; production and repository files were not cleanup targets.

## Full CI after #743 — final verifier correction

PR743 merged at04:48:17UTC as6ff4c017f89f1d5c772fe4aff22b5cf3adef6302.
Exact-main CI34738787284 configured the local gateway successfully, passed
18 browser tests (two skipped) at04:55:54UTC, then the V3 quality gate at04:56:38UTC.
The subsequent SQL acceptance failed with
`P4_ACCEPTANCE_ERROR:DOCUMENT_VERSIONS_NOT_IMMUTABLE`.
Automatic release34739085097 was skipped and the repository release arm is false.
The previous accepted production application is not replaced by this result.

The browser's actual second upload is `p4-isolated-proof-v2.png`; its final SQL
expectation was still `p4-isolated-proof-v2.pdf`. The added producer/verifier
source-contract regression failed on that exact difference before the fix, then
passed after changing the single stale expected filename. Existing P4 contract
suite:6/6 passed; Bash syntax, scoped ESLint and diff whitespace checks passed.
No version/ID/hash/scan/finalization assertion or runtime file handling changed.
This regression detects metadata drift; it does not replace real database/browser
acceptance. No focused Storage failure trigger was rerun.

## Full CI after #744 — pinned local image identity correction

PR744 merged as d45d97474badbd687cfc57ff4747f3e51bd32849. Full CI34739779810
failed before browser tests with `local_gateway_version_not_verified`.
Release34739920730 skipped; arm=false. The failed runner did not retain its
selected image reference, so its exact registry is unknown.

The pinned CLI's official image manifest and registry resolver admit
`public.ecr.aws/supabase/kong:2.8.1`, `ghcr.io/supabase/kong:2.8.1`, and
`library/kong:2.8.1`. The original ECR-only predicate rejected the supported
GHCR input with the same error in the new pure regression. After the correction,
both reference and wrong-version/identity checks pass. The helper also checks
the actual `kong version` and includes Docker's immutable image ID in its existing
stable before/after identity readback. No arbitrary mirror or version is accepted.

Actual benign validation on OrbStack:

- The complete helper passed against the root-owned isolated schema154 project
  `evo-s2-schema-g8shc2`, preserving routing/template hashes, health and identity,
  with effective keepalive pool0 and binary version2.8.1. No migration/data changed.
- A real GHCR image pull and isolated `kong version` command passed the same
  exported reference/runtime checks. Its image ID equals the local ECR image ID:
  `sha256:1b53405d8680a09d6f44494b7990bf7da2ea43f84a258c59717d4539abf09f6d`.
  The one-shot command had no network, mounts, ports, customer data or credentials.
  Initial read-only execution could not create OpenResty's temporary file;
  adding a bounded16MiB `/tmp` tmpfs allowed it to run. Both temporary containers
  were auto-removed and absence was checked; shared cached images were preserved.
- Node22 syntax, scoped ESLint and `git diff --check` passed.
  `npm run test:fast-release`:150/150 passed in75.6s, including the two added tests.

These are local identity/configuration checks, not full document, managed-service,
employee or release acceptance. No focused Storage failure trigger was repeated.
The next reviewed exact-main candidate still needs its ordinary full CI.

## Accepted S1/D1 release — 2026-09-13

[PR745](https://github.com/izzhackt/evo_AI_CRM/pull/745) merged at05:35:38UTC as
`77cde9ba8abdd8140db462dfe0203c0356944849`. Its reviewed tree matches the merged
candidate. [Full CI34740753764](https://github.com/izzhackt/evo_AI_CRM/actions/runs/34740753764)
passed all jobs, including database/browser proof. Automatic
[release34741107458 attempt1](https://github.com/izzhackt/evo_AI_CRM/actions/runs/34741107458)
passed both immutable-image build and pending-deploy/acceptance jobs. No repeated
full CI or manual release dispatch was needed for this SHA.

Independent Hermes readback at05:54:38UTC and subsequent file-hash checks:

| Evidence | Observed value |
| --- | --- |
| Release | `v3-r34741107458-a1-77cde9ba` |
| Application revision | `77cde9ba8abdd8140db462dfe0203c0356944849` |
| Image ID | `sha256:9bc7457d2810f10ddafbfa37b87362b4aedb02dff53ac2d53bb69690cc8e8887` |
| App container | `c9c9888c6d22f96a27cbc761ecd63693d46d5561649fda72a0ee6c3323017547` |
| Artifact ID | `10313260031` |
| Artifact digest | `sha256:0c6b681af57320c41611630cc5f4b9859cdecc72c1f02eb96caeed25118f4f48` |
| Current-pointer SHA256 | `45b25b98e796232dccb71c7c009f1ea86d4db598d82a08139c38f1b8e542fe3f` |
| Acceptance-record SHA256 | `3d8e3c4e719a330590a380bca5b7e7efe81a679c67eee4ebc2e19561f54d4ced` |
| Browser-receipt SHA256 | `f176f06ea30ef56ef0c31d57a8d9d32750e90bbfb10692d11c7cbf522f74d32f` |
| Candidate Compose SHA256 | `6cf9d7a609779a457ae19fd3a6cecee20a27fd0353829cc5c96a310474719d35` |

The regular0600 pointer at `/opt/evo-crm/release-evidence/current-v3-accepted.json`
names the matching regular0600 acceptance record and hash. The browser receipt
is regular0600 and says `passed`, bound to the same run/SHA/artifact. Its actual
hash and the retained Compose/environment-snapshot hashes match acceptance;
environment contents were not printed. `pending-current.json` is absent,
including no dangling symlink. App is running/healthy, restarts0, no published
ports; private aliases and addresses remain intact. Previous accepted4e35b896
is retained as the recorded rollback target. No schema reapply was performed.

The original WAHA container `0d1017e3304d…` and ClamAV container `7242869f04f4…`
retain the preflight IDs/images, healthy status, zero restarts and no public
ports. Session/provider state was not changed or exercised. Repository arm was
set to false after the terminal successful release and independently read back.

Chrome read-only post-release check through the existing localhost3000 tunnel:
staff list rendered under the existing Admin session, the member card opened,
and the departments tab rendered its genuine empty state. No employee, role,
department, invitation or customer document was created/changed. This is staff
UI read proof, not real employee onboarding or D2–D6 acceptance. The same tunnel
listener remains SSH PID7065; no local Next process or replacement database was
introduced for this preview.

Local network limitations are explicit: ordinary and macOS-system curl both
could not verify the public host's issuer chain; no insecure TLS option was
used. Plain HTTPS health from Hermes succeeded at
`https://evo-crm.72.62.119.112.sslip.io/api/health` without `--resolve` or TLS
bypass; this is the active hostname, not the deferred `crm.evoadmissions.com`.
Unauthenticated localhost `/api/version`
returned401 and direct Chrome navigation was blocked by the client, so neither
is claimed as an independent local version read. Version proof comes from the
sealed authenticated release browser receipt and independent server identity.
The settings Platform page also showed unavailable database-observation metadata;
successful staff directory reads do not prove that separate observation feed.
These limitations do not negate the accepted release and are not reported fixed.

## Remaining business scope

Custom editable roles and multiple scoped role assignments, real recipient/rights
confirmation and invitation delivery remain open in the employee plan. Structured
profile extraction/export, Gemini processing, versioned forms/packages, legacy data
mapping and accepted cutover remain open in the Docs plan. No real customer files
were opened/uploaded for this release and no provider success is claimed.
