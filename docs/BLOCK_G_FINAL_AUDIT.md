# Block G Final Acceptance Audit

Date: 2026-07-24 (Asia/Bishkek).

Verdict: `blocked_external`.

The `/goal-evo-preplatform-hardening` goal remains **open**. Blocks A-F are
merged and independently reviewed, and the production Supabase containment
migrations plus the hardened Inbox runtime are now deployed. Block G still
cannot be completed without owner decisions, the deferred isolated Supabase
database and Storage restore rehearsal, and an explicitly authorized real
WhatsApp/amoCRM test. No customer message, amoCRM mutation, DNS change, QR
relink, or production restore was performed during this audit.

## Requirement status

| Requirement | Status | Evidence and boundary |
|---|---|---|
| GitHub baseline and hardening PR closure | PASS | GitHub `main` is `a09a72fc55d869c861df520f76d62413a2315fc1`. PRs #47-#58 are merged and all four repository CI jobs passed on PR #58. |
| Independent launch-control review | PASS | The plan review and Blocks A-F have recorded final `approved` verdicts in Codex tasks `019f90ed-cdd2-73b1-9a0a-9d5de95850de`, `019f90f1-1274-7740-a4d8-06bafe083880`, `019f9107-640c-76b0-911f-e7e49e443a54`, `019f911d-c8cc-7e80-ac75-98e94eec45ac`, `019f9133-dd7c-7012-b5c7-8dbd6f9e50f5`, `019f914a-80c3-7190-8821-61ece8bd63b1`, and `019f916b-28fb-7420-8572-0416f2c04249`. GitHub itself has no review records for these PRs; the independent reviews are task evidence. |
| A: role-policy and self-promotion denial | PASS | Disposable PostgreSQL role-policy tests cover ordinary staff, privileged staff, and `service_role`, including forbidden-write denials. Production migration 038 was first executed with its postconditions in a transaction that deliberately rolled back, then applied transactionally to project `iosckaqtovbbnssqcpde`. A separate post-commit audit proved registration of migration 038, removal of the public helper, presence of the private helper, and authenticated `private` schema usage. |
| B: sensitive CRM and Transcription Lab surfaces | PASS | Merged tests and production evidence cover unauthenticated/admin denial, upload bounds, encryption fail-closed behavior, retention/restart behavior, and negative sensitive-route access. Public registration policy remains deliberately undecided and unchanged. |
| C: private media and truthful capability | PASS | Production migration 039 was first executed with its postconditions in the same successful rollback dry-run, then applied transactionally. The separate post-commit audit proved migration registration, the `media_audit_events` table, private `chat-media` bucket, denial of authenticated audit inserts, and `messages.media_retention_until`. Unsupported outbound media remains disabled rather than simulated. |
| Durable drafts, outbound attempts/messages and ACK evidence | PASS | PRs #47/#48 preserve append-only draft/delivery evidence, signed server-only acknowledgement writes, explicit unknown outcomes, and no automatic retry of unknown delivery outcomes for the active text path. |
| Provider outage and duplicate/replay behavior | PARTIAL | The active paths have merged automated coverage. A real provider outage/replay was not induced because there is no authorized, isolated WhatsApp/amoCRM test path. Mocks are not accepted as final proof. |
| Lead Agent containment and restart persistence | PASS | Production evidence records `frozen=true`, `ready=false`, worker/outbound/autoreply disabled, and webhook rejection `503 lead_agent_frozen` after restart. No automatic reply was sent. |
| E: private runtime, edge and image-to-Git mapping | PARTIAL | CRM and Lead Agent run `564332b420a1fb1bd6232dda945d044bb922d3f0`; Inbox release `2026-07-24.2` carries exact OCI revision `a09a72fc55d869c861df520f76d62413a2315fc1`. Private readiness reported both Supabase and WAHA ready before and after an application restart; public readiness and internal routes returned `404`. WAHA remained private and unchanged. The fallback host served the expected security headers. CSP remains report-only pending observation and owner approval, and canonical DNS remains unresolved and owner-controlled. |
| F: backup and isolated restore | PARTIAL | Main CRM SQLite, encrypted settings, generated-file inventory, Lead Agent SQLite/application reads, and exact release configuration passed isolated verification. WAHA archives are inventory/extraction evidence only; QR relink was documented but not executed. Supabase database and Storage restores remain blocked by missing authorized credentials and disposable destinations. |
| RPO/RTO and retention operations | BLOCKED | RPO/RTO values remain proposals, not approved policy. Production retention scheduling and its owner remain undecided; this audit makes no policy choice. |
| Real WhatsApp/amoCRM acceptance | BLOCKED | Required production amoCRM credentials, EVO-controlled sender/recipient, QR/relink readiness where needed, and explicit approval for one visible manual reply are absent. No message was sent. |
| Block G completion | BLOCKED | Production Supabase and deployed-runtime proof now pass. The deferred full isolated Supabase database and Storage restore, real provider-path proof, and owner-controlled release decisions remain open. The honest goal state is `blocked_external`, not complete. |

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
| [#56](https://github.com/izzhackt/evo_AI_CRM/pull/56) | Block G final audit | `f77481d9aa47e10dfa4a1091752eca2a7ba41bba` | `426b06834e9feb9efc595170cedf7973d9bb8f37` |
| [#57](https://github.com/izzhackt/evo_AI_CRM/pull/57) | temporary Supabase backup-risk decision | `e9a44968a5060c532a1b6018c864d3f16d663c2c` | `88cf6da7609c794a6ca50df6d5c3e338c0305119` |
| [#58](https://github.com/izzhackt/evo_AI_CRM/pull/58) | private WAHA readiness correction | `c7fdeffa20bd289384bac9283dcefa5afd48266a` | `a09a72fc55d869c861df520f76d62413a2315fc1` |

PR #58 received a separate Codex launch-control verdict of `approved`. GitHub's
review API reports no submitted review record for that PR, so the independent
approval is task evidence and is not represented here as a GitHub approval.

## Production and recovery evidence

- CRM image revision: `564332b420a1fb1bd6232dda945d044bb922d3f0`.
- Lead Agent image revision: `564332b420a1fb1bd6232dda945d044bb922d3f0`.
- Inbox image revision: `a09a72fc55d869c861df520f76d62413a2315fc1`.
- Inbox release: `2026-07-24.2`.
- Protected production evidence:
  `/opt/evo-release-evidence/564332b420a1fb1bd6232dda945d044bb922d3f0/2026-07-24.1`.
- Sanitized restore results are durable in
  [`BLOCK_F_REHEARSAL_EVIDENCE.md`](BLOCK_F_REHEARSAL_EVIDENCE.md).

Production project `iosckaqtovbbnssqcpde` registered migrations 038 and 039
after the exact reviewed SQL and postconditions completed successfully inside a
rollback-only dry-run transaction. The later production transaction committed
both migrations. A separate read-only post-commit audit returned true for both
migration-history records, removal of the public helper, presence of the
private helper, authenticated usage of the private schema, presence of the
media audit table, private `chat-media`, denial of authenticated audit inserts,
and the message-retention column.

The deployed Inbox OCI revision and release labels matched the exact values
above. Its private readiness response reported `checks.supabase=true` and
`checks.waha=true` both before and after an application-container restart.
Readiness uses WAHA's private unauthenticated `/ping` endpoint; WAHA itself was
not restarted, relinked, reconfigured, or exposed. Public readiness and
internal-only routes returned `404`, and the fallback host retained the
expected security headers.

The VPS checkout at `/opt/evo-inbox` was reconciled to a clean checkout at the
exact GitHub `main` revision. Previously drifted source was preserved in a
read-only archive. The older Caddy bind-mount source was byte-identical to the
reviewed file and was left unchanged.

## External owner and credential blockers

- Decide public registration versus invite-only; no registration behavior was
  changed.
- Re-open the owner-approved deferred Supabase plan, database backup, Storage
  export and isolated restore decision around 2026-08-03. RPO/RTO remain
  unapproved; the current production migration/deployment exception does not
  complete Block F or Block G.
- Approve or revise the proposed RPO/RTO values.
- Add or authorize the absent canonical `crm.evoadmissions.com` and
  `inbox.evoadmissions.com` DNS A records.
- Choose the monitoring destination, credentials, responsible owner and on-call
  rotation.
- Decide CSP enforcement after the report-only observation period.
- Provide real WhatsApp/amoCRM credentials, an EVO-controlled dedicated test
  sender/recipient, and explicit approval for one visible manual reply.
- Confirm QR availability for the older CRM WAHA session and separately
  authorize any relink.
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
