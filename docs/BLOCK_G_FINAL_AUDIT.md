# Block G Final Acceptance Audit

Date: 2026-07-24 (Asia/Bishkek).

Verdict: `blocked_external`.

The `/goal-evo-preplatform-hardening` goal remains **open**. Blocks A-F are
merged and independently reviewed, but Block G cannot be completed without
owner decisions, production Supabase access and an isolated restore target,
and an explicitly authorized real WhatsApp/amoCRM test. No customer message,
provider mutation, deployment, migration, DNS change, QR relink, or production
restore was performed during this audit.

## Requirement status

| Requirement | Status | Evidence and boundary |
|---|---|---|
| GitHub baseline and hardening PR closure | PASS | GitHub `main` is `564332b420a1fb1bd6232dda945d044bb922d3f0`. PRs #47-#55 are merged, all four repository CI jobs passed on every PR, and no earlier hardening PR was open when this audit started. |
| Independent launch-control review | PASS | The plan review and Blocks A-F have recorded final `approved` verdicts in Codex tasks `019f90ed-cdd2-73b1-9a0a-9d5de95850de`, `019f90f1-1274-7740-a4d8-06bafe083880`, `019f9107-640c-76b0-911f-e7e49e443a54`, `019f911d-c8cc-7e80-ac75-98e94eec45ac`, `019f9133-dd7c-7012-b5c7-8dbd6f9e50f5`, `019f914a-80c3-7190-8821-61ece8bd63b1`, and `019f916b-28fb-7420-8572-0416f2c04249`. GitHub itself has no review records for these PRs; the independent reviews are task evidence. |
| A: role-policy and self-promotion denial | PARTIAL | Disposable PostgreSQL tests covered ordinary, privileged, and `service_role` cases. In production, the formerly public `is_account_member` RPC now returns `404`, consistent with migration 038 moving it out of the exposed schema. Full migration history and all production grants/policies cannot be independently inspected without an authorized database-admin connection, so this is not promoted to PASS. |
| B: sensitive CRM and Transcription Lab surfaces | PASS | Merged tests and production evidence cover unauthenticated/admin denial, upload bounds, encryption fail-closed behavior, retention/restart behavior, and negative sensitive-route access. Public registration policy remains deliberately undecided and unchanged. |
| C: private media and truthful capability | BLOCKED | Migration 039's `media_audit_events` surface returns `404` in production, including through the server role, and production Inbox still runs pre-Block-C revision `14ed2e34`. Unsupported outbound media remains disabled rather than simulated. |
| Durable drafts, outbound attempts/messages and ACK evidence | PASS | PRs #47/#48 preserve append-only draft/delivery evidence, signed server-only acknowledgement writes, explicit unknown outcomes, and no automatic retry of unknown delivery outcomes for the active text path. |
| Provider outage and duplicate/replay behavior | PARTIAL | The active paths have merged automated coverage. A real provider outage/replay was not induced because there is no authorized, isolated WhatsApp/amoCRM test path. Mocks are not accepted as final proof. |
| Lead Agent containment and restart persistence | PASS | Production evidence records `frozen=true`, `ready=false`, worker/outbound/autoreply disabled, and webhook rejection `503 lead_agent_frozen` after restart. No automatic reply was sent. |
| E: private runtime, edge and image-to-Git mapping | PARTIAL | CRM and Lead Agent run `564332b420a1fb1bd6232dda945d044bb922d3f0`; Inbox runs `14ed2e34c8b97f238aad2db872e7bdc54bf8b238`. Private probe routes return `404`; immutable third-party image, security headers, limits and rollback evidence are recorded. CSP remains report-only pending observation and owner approval. Canonical DNS remains unresolved and owner-controlled. |
| F: backup and isolated restore | PARTIAL | Main CRM SQLite, encrypted settings, generated-file inventory, Lead Agent SQLite/application reads, and exact release configuration passed isolated verification. WAHA archives are inventory/extraction evidence only; QR relink was documented but not executed. Supabase database and Storage restores remain blocked by missing authorized credentials and disposable destinations. |
| RPO/RTO and retention operations | BLOCKED | RPO/RTO values remain proposals, not approved policy. Production retention scheduling and its owner remain undecided; this audit makes no policy choice. |
| Real WhatsApp/amoCRM acceptance | BLOCKED | Required production amoCRM credentials, EVO-controlled sender/recipient, QR/relink readiness where needed, and explicit approval for one visible manual reply are absent. No message was sent. |
| Block G completion | BLOCKED | Required production Supabase proof, full isolated restore, real provider-path proof, and owner-controlled release decisions remain open. The honest goal state is `blocked_external`, not complete. |

## Pull request provenance

| PR | Purpose | Head commit | Merge commit |
|---|---|---|---|
| [#47](https://github.com/izzhackt/evo_AI_CRM/pull/47) | audited WAHA outbound delivery | `58f81b0d7963905d734b1685c1a12c9f60725bbe` | `0b685cd6c8268ae6a83a2ea67fa107f83453f43c` |
| [#48](https://github.com/izzhackt/evo_AI_CRM/pull/48) | migration 037 UUID compatibility | `9330dea1d87284e24ab88cba090a50406f52221f` | `14ed2e34c8b97f238aad2db872e7bdc54bf8b238` |
| [#49](https://github.com/izzhackt/evo_AI_CRM/pull/49) | pre-platform hardening plan | `d5b1df163307490c0630414c67fd82fa2fa983f6` | `7e1c2341e059314f1e7dc190b57b768bd300a314` |
| [#50](https://github.com/izzhackt/evo_AI_CRM/pull/50) | Block A authorization containment | `5065e993dd235f35f64b398878af15c3023c7630` | `3f8aee28350676c7c04eeffa990f248003455614` |
| [#51](https://github.com/izzhackt/evo_AI_CRM/pull/51) | Block B sensitive CRM surfaces | `676605048f508786d81c237388d55f8a799715c1` | `577ae5aee34b97346ed820dbb6ec7f430b43d1ab` |
| [#52](https://github.com/izzhackt/evo_AI_CRM/pull/52) | Block C private media | `367d6c15b8961d0a4645cbee7a92b6fee5cc7859` | `b776fd8bcdc0f3d830c429158fbb431e4917f24d` |
| [#53](https://github.com/izzhackt/evo_AI_CRM/pull/53) | Block D Lead Agent freeze | `16ec2f2fede8ff009e0508ef3ed18512b40cf630` | `e02bf19baa0c8793a4cd97cc537413e22466ddf8` |
| [#54](https://github.com/izzhackt/evo_AI_CRM/pull/54) | Block E runtime hardening | `0b976dfd711657c95d5b4cb13a4928fe91b786c4` | `e9c90b57561f0cda0526a02ad7d4ad2a57323652` |
| [#55](https://github.com/izzhackt/evo_AI_CRM/pull/55) | Block F disaster recovery | `0afe128c2b9f8b6202d2933c1fa755571fb4f358` | `564332b420a1fb1bd6232dda945d044bb922d3f0` |

## Production and recovery evidence

- CRM image revision: `564332b420a1fb1bd6232dda945d044bb922d3f0`.
- Lead Agent image revision: `564332b420a1fb1bd6232dda945d044bb922d3f0`.
- Inbox image revision: `14ed2e34c8b97f238aad2db872e7bdc54bf8b238`.
- Protected production evidence:
  `/opt/evo-release-evidence/564332b420a1fb1bd6232dda945d044bb922d3f0/2026-07-24.1`.
- Sanitized restore results are durable in
  [`BLOCK_F_REHEARSAL_EVIDENCE.md`](BLOCK_F_REHEARSAL_EVIDENCE.md).

Migration 038 must not be recorded as definitely absent: its public RPC marker
is now absent, which is consistent with application. It also must not be
recorded as fully proven without database migration-history/admin access.
Migration 039 remains not applied based on its absent production table surface
and the old Inbox runtime revision.

## External owner and credential blockers

- Decide public registration versus invite-only; no registration behavior was
  changed.
- Provide authorized Supabase database/Management and Storage backup access,
  plus isolated database/project and bucket restore destinations.
- Approve or revise the proposed RPO/RTO values.
- Decide DNS ownership and authorize exact records/changes.
- Choose the monitoring destination, credentials, responsible owner and on-call
  rotation.
- Decide CSP enforcement after the report-only observation period.
- Provide an EVO-controlled WhatsApp sender/recipient, production amoCRM
  credentials, and explicit approval for one visible manual reply.
- Confirm WAHA QR/relink availability and separately authorize any relink.
- Provide an authenticated operator session for final Inbox browser proof.
- Decide retention scheduling and operational ownership.
- Separately authorize any production permission correction for legacy
  state/config roots.

These items are blockers, not delegated decisions. This audit does not turn any
proposal into policy or authorize any external action.

## Owner decision after this audit

On 2026-07-24 (Asia/Bishkek), the owner accepted the increased rollback and
data-loss risk of proceeding without a pre-migration Supabase database and
Storage backup and decided not to upgrade the Supabase plan now. The exact
append-only boundary is recorded in
[`PLAN_CHANGES.md`](PLAN_CHANGES.md#2026-07-24---owner-accepts-temporary-supabase-pre-migration-backup-risk).

This changes one immediate stop condition only: production migrations 038/039
and the Inbox deployment may proceed without the full Supabase backup after
transaction-level validation, migration-specific rollback SQL and durable
rollback evidence, and every other release gate pass. Destructive migrations
and data rewrites remain prohibited. For these named actions only, the later
owner decision in `PLAN_CHANGES.md` supersedes the launch plan's generic
backup-related deployment stop; the generic stop remains binding otherwise.

The missing real Supabase database-plus-Storage backup and isolated restore
rehearsal remains an open Block F/Block G acceptance item, with owner review
targeted for 2026-08-03 after about ten days of platform use. RPO/RTO remains
unapproved. The overall `blocked_external` verdict is unchanged because this
decision neither supplies the deferred restore evidence nor clears the other
external acceptance gates.
