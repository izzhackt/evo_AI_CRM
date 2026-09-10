# Operations and universities production acceptance — 10 September 2026

This is the technical release record for the
[business operations continuation](../business-operations-universities-run-plan.md).
It does not turn successful CI or an Admin release smoke into two-employee,
Student-private or provider acceptance. All times below are UTC. No credentials,
customer rows or private screenshots belong in this note.

## Exact candidate and schema

- Accepted candidate: `8b70332fa1417a301890e507b7d6fc2ea20a4255`, exact current
  GitHub `main` at admission and acceptance.
- Product changes merged through [PR712](https://github.com/izzhackt/evo_AI_CRM/pull/712)
  at `cb8e932f7c4cc5cee04c0767519ae6e83ba1df33`.
  [PR713](https://github.com/izzhackt/evo_AI_CRM/pull/713), reviewed head
  `7cd683d935311322d9e0cdb4dd55c5200ecc3f8e`, merged as the accepted candidate.
  The latter corrected test expectations/selectors; the `src` and migration
  trees are unchanged between those two merge commits.
- Full [CI34422704610](https://github.com/izzhackt/evo_AI_CRM/actions/runs/34422704610),
  attempt 1, passed all five jobs: current-main admission, Node/static,
  dependency audit, real database/browser proof and the Main CRM aggregate.
- Managed [schema apply34421758765](https://github.com/izzhackt/evo_AI_CRM/actions/runs/34421758765)
  ran on `cb8e932f7c4cc5cee04c0767519ae6e83ba1df33`. Its initial read found
  138 applied migrations; after the linked-flow dry-run it applied only
  139–148. The `00:34:48` readback listed exactly 001–148. The release's later
  ledger checks passed before mutation and before acceptance. Do not reapply
  this tail.
- The permanent database/Auth/Storage source remains Supabase
  `iosckaqtovbbnssqcpde`; this release did not clone, reset or replace it.

## Immutable release identity

Automatic [release34423266788](https://github.com/izzhackt/evo_AI_CRM/actions/runs/34423266788),
attempt 1, completed successfully at `00:58:58`. Both jobs passed.
`Authenticated read-only V3 browser smoke`, the final GitHub/Supabase guards
and `Accept exact V3 candidate` passed. Failure-only rollback steps were
correctly skipped; this is not missing acceptance evidence.

| Identity | Verified value |
| --- | --- |
| Release ID | `v3-r34423266788-a1-8b70332f` |
| Version | `r31.1-8b70332f` |
| Platform | `linux/amd64` |
| Image ID | `sha256:f94c5e3131e19e5c0d666719ab9f8e72c01e099316a2136aef6a8752b3d50f7b` |
| Image config digest, bound by acceptance | `sha256:36fbd42775021183ea088d7e6f4e0f469695d37ce60c8ed4371bd6b09454659d` |
| GitHub artifact ID | `10131716318` |
| GitHub artifact digest | `sha256:c45141a2320f6acc55d50c6c8c0dce87fa98d79eb30f684a3ddf2f66d0add40c` |
| Acceptance-record SHA-256 | `584c067d089130336f7c07a535c514a77f326dc5487c2e7c293100d5c162a37f` |
| Browser-receipt SHA-256 | `7a8556f824b62e6e585d2b62bb34e7a4588d1fc084b92582520538a182cdcf9d` |

The actual image's OCI source is `https://github.com/izzhackt/evo_AI_CRM`;
revision/version labels match the candidate and version above. The protected
acceptance record binds the same image, artifact, upstream CI and workflow IDs.

## Server readback and disarm

Read-only verification on `hermes-vps`, `/opt/evo-crm`, at `00:59:23` confirmed:

- `release-evidence/current-v3-accepted.json` names this release and
  `v3-r34423266788-a1-8b70332f/v3-acceptance-record.json`. Pointer modification
  time is `2026-09-10 00:58:48.916808120 +0000`.
- The acceptance file's calculated SHA-256 matches the pointer. The calculated
  `browser-receipt.json` hash matches the acceptance record; its `result=passed`
  and revision/release/run/attempt identify this same candidate.
- Container `1135de2d3a44` runs the exact image above, is healthy and has
  restart count 0. The private ClamAV service is healthy with restart count 0
  and image digest
  `sha256:6c92171e6ab52529cd44452f6443dd05b2fc4d580c190ffc70f45f955cb9f4b9`.
- `release-evidence/pending-current.json` is absent. This release's
  `rollback-command.sh` is mode `0700`. Its recorded predecessor remains the
  [accepted September 9 release](2026-09-09-student-admissions-production.md),
  `v3-r34391907814-a1-76c62b90`, not a frozen V1 runtime.
- HTTPS `/api/health` at `https://evo-crm.72.62.119.112.sslip.io` returned 200
  from Hermes with ordinary certificate validation; no TLS bypass was used.
- The coordinator disarmed after acceptance. A separate GitHub API read at
  `00:59:55` confirmed `EVO_PRODUCTION_RELEASE_ARMED=false`; the variable's
  `updated_at` is `2026-09-10T00:59:29Z` (update time, not observation time).

## Same production through localhost

SSH PID `93942` still listens only on `127.0.0.1:3000`, with destination
`hermes-vps` and forwarding target `172.16.8.4:3000`. The new app's actual
`evo_crm_private` address is also `172.16.8.4`; no tunnel replacement was needed.
`http://127.0.0.1:3000/api/health` returned 200. This is the accepted server,
not a separate preview database or development process. Recheck the PID and IP
before future reuse; these are observations, not permanent configuration.

## Business acceptance and explicit limits

- The release workflow performed normal Admin authentication and read-only
  smoke. It did not create business records or prove staff-to-staff chat,
  task completion/reconnect/revocation, or a private Student journey.
- After release, the coordinator refreshed the existing genuine Admin session,
  saw Option2 navigation, and published the five reviewed records through the
  normal management forms. The separate publication/readback below is actual
  business data work, not a claim supplied by the automated release smoke.
- The owner retained the standing no-new-backup instruction for this release,
  explicitly recorded in [O6](../business-operations-universities-run-plan.md#проверки-и-выпуск)
  and both [production](../../../../deploy/production-release.md) /
  [fast-release](../../../../deploy/fast-app-release.md) runbooks. No new export
  or isolated restore rehearsal was performed or marked PASS. Existing backups
  and accepted-image rollback remain retained. Image rollback does not undo
  schema 139–148 or later business writes.
- WAHA pairing, employee numbers, webhook activation, WhatsApp mirroring/send
  and live amoCRM acceptance remain deferred. A healthy WAHA container is not
  evidence of a paired session or delivered message.
- No new synthetic production staff/Student identity, customer case, Auth
  bypass or Admin access to Student-private results was used for this release.

## University publication and visible browser proof

All five [reviewed university records](2026-09-10-university-catalog-sources.md)
were staged, read in the public preview and approved once using the existing
Admin account through `http://localhost:3000`. No service-key publication, fake
user, raw SQL write or duplicate retry was used. Unknown dates and source
conflicts remain explicit; these are computing examples, not complete program
catalogues or assertions of EVO partnership.

| Published institution | Canonical ID |
| --- | --- |
| APU | `a0509b28-0dee-4c82-b59f-4440cf57d8d7` |
| Sunway University | `90a31d99-a15c-44f9-bba5-a1a7799559ea` |
| Multimedia University | `0761ac20-ece0-46fa-9d34-76dde5047d13` |
| XJTLU | `310c203b-fc97-45e6-ad81-c0d570e400c6` |
| Nottingham Ningbo | `184c453b-8847-4d4d-9624-f22130786a9d` |

The published catalogue rendered all five exact names/links. Its China filter
rendered only XJTLU and Nottingham Ningbo. The latter's canonical detail page
rendered `Опубликованная версия 1`, program/intake/source information and explicit
unknown deadlines. Four campus images all had `complete=true` and
`naturalWidth=1280`; APU displayed the intentional no-verified-photo placeholder.
Attribution/license links were visible in the cards and detailed preview.
The management list subsequently showed `На проверке (0)`.

Desktop screenshots show the EVO logo/accent, department navigation, spacious
three-column cards and simple filters. Narrow-screen catalogue and detail checks
measured actual `window.innerWidth=393`, document client/scroll widths both383
(the remainder is the browser scrollbar): no horizontal overflow. The existing
Chrome zoom means the temporary viewport override was295 physical pixels;
record the observed CSS width, not a fictitious393-wide document. The temporary
override was reset before further work.

Live publication exposed one presentation defect in this accepted revision:
Next cache invalidation re-rendered the pending-only draft page after the write,
so the successful receipt was replaced by its neutral completed/unavailable
draft recovery state. Canonical catalogue readback confirmed all five writes;
none were retried. A narrow redirect correction is being reviewed separately.
This note does not claim that correction is already deployed.

The native team-chat route visibly showed its three channels, empty history and
message composer. Live-update status settled to unavailable in this browser;
presence-only artifact checks confirmed public URL/key exist in server runtime,
but neither value appears in the actual TeamChat browser chunk, which still
references `.env.NEXT_PUBLIC_SUPABASE_*`. That inspected chunk's SHA-256 is
`fc05e9828c32fffb7046367fa03e941b7d47c69267d87ea35d674ceffec4093d`.
The corrective server-page prop passes only the existing validated public
configuration; private-channel/session/RLS logic is unchanged. Deployment and
real connection verification are pending, not marked as successful acceptance.
No real message was sent and there was no second employee session.

The global task entry opened the actual standalone staff-task composer without
a student: title, assignee, deadline type and secondary description/priority.
No test task was submitted. Sales opened the manual-lead entry and correctly
reported no active Sales assignee; a genuine Sales membership is required before
creating a real lead. The Admin account was not assigned a fake Sales identity
to work around that business requirement.
