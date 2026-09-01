# EVO production-successor existing-state audit — 2026-09-02

## Decision

The existing managed Supabase project is the correct foundation for the one
EVO production successor. It is healthy, already serves both deployed EVO
applications, and contains the retained `platform` / `platform_private`
foundation. It is **not yet safe to mutate or cut over**.

Production still has several active authorities at once. Customer-facing CRM
state depends on SQLite and the legacy `public` schema, newer platform
capabilities use Supabase `platform` RPCs, EVO Inbox is a second application
contour, and two WAHA sessions plus the lead-agent remain active. Root
migrations `080` through `092` have not been applied to the managed project. A
recoverable pre-change backup and restore proof also do not yet exist.

Issue #546 may build and prove the first replacement slice against an isolated
real Supabase environment. It must not apply production migrations or switch
production traffic until the recovery and rehearsal gates below pass.

## Audit boundary and provenance

This inventory was captured read-only on 2026-09-02 (Asia/Dubai) against:

- GitHub `origin/main` at
  `a1ae2ef2624f1e4564f79300295f53c7ade5ae52`;
- managed Supabase project ref `iosckaqtovbbnssqcpde`;
- `hermes-vps` production containers and files at
  `2026-09-01T21:39:03Z`;
- running production image revision
  `ee8a825ebc72f84449636e3feaefab7a330913d4`;
- running staging image revision
  `6d2109b865da334bd41ad8c432147a2f7045937b`.

The audit used Management API GET/read-only SQL, PostgREST metadata and
read-only VPS/container inspection. It retained only object names, counts,
hashes, sizes, statuses and configuration key names. It did not print secret
values or customer payloads, and it did not change Database, Auth, Storage,
providers, containers, DNS or paid resources.

Relevant provider behavior was checked against the official
[Management API reference](https://supabase.com/docs/reference/api/introduction),
[Database Backups guide](https://supabase.com/docs/guides/platform/backups),
[Storage bucket access model](https://supabase.com/docs/guides/storage/buckets/fundamentals)
and [Storage access-control guide](https://supabase.com/docs/guides/storage/security/access-control).

## Managed Supabase identity

| Property | Proved value |
| --- | --- |
| Project ref | `iosckaqtovbbnssqcpde` |
| Project name | `evo-platform-prod` |
| Organization slug | `xoyuhdupqssfncmemfvm` |
| Region | `ap-southeast-1` |
| Project status | `ACTIVE_HEALTHY` |
| PostgreSQL | `17.6.1.155`, engine 17, GA |
| Created | `2026-07-07T05:49:51.367705Z` |
| Current consumers | deployed CRM and deployed EVO Inbox |

The linked-project metadata, Management API identity, CRM environment and
Inbox environment all resolve to the same ref. No second project should be
created as a substitute.

## Migration reconciliation

| Check | Result |
| --- | --- |
| Root migration files | 92, versions `001`–`092` |
| Managed-project ledger | 79, versions `001`–`079` |
| Extra remote versions | none |
| Name mismatches in `001`–`079` | none |
| Immutable-history verifier | PASS for the recorded `001`–`046` range |
| Local migration manifest SHA-256 | `898b17695a5ffd1204f0430c4941247ca9ab2aa3f176b8ca5dc8c20ea16616a1` |

The exact unapplied set is:

```text
080_platform_manual_send_waha_runtime.sql
081_platform_manual_send_waha_provisioning.sql
082_platform_waha_session_authority.sql
083_platform_unified_staff_access.sql
084_platform_canonical_client_lead.sql
085_platform_waha_receive_only_sales.sql
086_platform_sales_workflow.sql
087_platform_contract_payment_gate.sql
088_platform_sales_admissions_handoff.sql
089_platform_admissions_case_workspace.sql
090_platform_u8_finance_stop_factor_surface.sql
091_platform_u9_gemini_human_review.sql
092_platform_u10_pilot_cohort_legacy_isolation.sql
```

These files are proposed forward history, not evidence of deployed behavior.
They must be exercised sequentially from an exact `079` clone or staging state,
reviewed for the new single-successor contract, and reconciled before any
production apply. There is no permission to mark them applied, reset the
ledger or repair history by hand.

## Database authority and population

### Catalog and enforcement surface

| Schema | Tables | RLS-enabled | Policies | Functions | Triggers | Exact population signal |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| `platform` | 73 | 73 | 65 | 176 | 205 | 10 non-empty tables, 1,258 rows |
| `platform_private` | 63 | 63 | 0 | 165 | 116 | all 63 empty |
| `public` | 41 | 41 | 91 | 148 | 49 | 11 non-empty tables, 70 rows |
| `storage` | 8 | 8 | 12 | 17 | 4 | service metadata plus 3 buckets; 0 objects |
| `pgmq` | 5 | 0 | 0 | 40 | — | 2 queue metadata rows |
| `realtime` | 10 | 1 | 2 | 15 | — | no application rows observed |

All business-facing tables in `platform`, `platform_private`, `public` and
`storage` have RLS enabled. An RLS-enabled table with no explicit policy is not
automatically a vulnerability: it can be intentionally deny-all and reachable
only through security-reviewed RPCs. The deployed PostgREST configuration
publishes `public`, `platform` and `graphql_public`; it does not publish
`platform_private`. The `platform` OpenAPI surface contains 73 table paths and
176 RPC paths, while direct table probes were denied and the deployed code uses
the RPC boundary.

### Non-sensitive row counts

- `auth.users`: 1.
- `platform.organizations`: 1.
- `platform.organization_memberships`: 1.
- `platform.profiles`: 1.
- `platform.audit_events`: 1.
- `platform.role_bundle_permissions`: 1,135.
- `platform.permission_definitions`: 61.
- `platform.role_bundle_versions`: 55.
- `platform.student_cases`, `student_profiles`, `university_applications`,
  `visa_cases`, `case_tasks`, document business tables, communication business
  tables, payment business tables and manual-send business tables: 0.
- `platform_private`: every table has 0 rows.
- `public.accounts`: 1; `public.profiles`: 1; `public.ai_configs`: 1;
  `public.ai_knowledge_documents`: 13; `public.ai_knowledge_chunks`: 43;
  `public.contacts`, `deals`, `conversations` and `messages`: 0.
- `storage.buckets`: 3; `storage.objects`: 0.

This proves that the canonical `platform` CRM tables currently contain
foundation metadata, not migrated customer cases. It does **not** prove that
production has no customer data: the active CRM and lead-agent SQLite files
remain separate authorities and must be inventoried and migrated explicitly.

## Auth, roles, Storage, Realtime, queues and backup

### Auth and roles

The project has one Auth user, one email identity, and one platform
membership/profile. The membership is active with the bootstrap role
`supabase_read_only_user`. That proves the retained Auth machinery exists; it
does not prove a production staff lifecycle or the accepted Admin, Sales and
Admissions role journeys. The unapplied
`083_platform_unified_staff_access.sql` is part of that gap.

### Storage

Live buckets are:

| Bucket | Access | Objects | Successor decision |
| --- | --- | ---: | --- |
| `avatars` | public | 0 | retain only if the accepted staff UI needs public avatars |
| `flow-media` | public | 0 | preserve for current Inbox rollback; do not use for private CRM files |
| `chat-media` | private | 0 | preserve for current Inbox rollback; reconcile before reuse |

The committed target config also defines private `platform-documents` and
`platform-whatsapp-media` buckets with MIME and size restrictions. Those two
buckets are absent live. They must be created through the reviewed successor
migration/config path, with RLS and signed-download browser proof; direct SQL
changes to Storage metadata are forbidden.

### Realtime and queues

The `supabase_realtime` publication currently includes:

```text
public.conversations
public.flow_runs
public.member_presence
public.message_reactions
public.messages
public.notifications
```

No `platform` table is currently in the publication. Realtime is retained only
where a proved staff interaction needs it. `pgmq` has work and dead-letter
queue/archive relations for `platform_work_v1` and
`platform_dead_letter_v1`; both live queue depths are 0. Queue consumers must
be mapped to one successor worker before any old worker is retired.

### Backup and recovery

The live backup-list endpoint returned HTTP 200 with 7 provider backups and
`walg_enabled=true`; `pitr_enabled=false`. The separate backup-schedule endpoint
returned `402 entitlement_required` because that scheduling feature requires
the Enterprise organization plan. This proves provider backup presence, but it
does not prove a recoverable pre-change snapshot or a passed restore rehearsal.
Supabase documents daily backups for paid plans and recommends an off-site
logical dump where provider backups are unavailable. Production migration and
cutover remain blocked until #551 records a current pre-change artifact and a
real restore result. Enabling paid PITR is not implied or authorized by this
audit.

## Current VPS and traffic topology

### Running Compose projects and containers

| Project | Running contour |
| --- | --- |
| `evo-crm` | CRM app, lead-agent and private CRM WAHA |
| `evo-inbox` | Inbox app and private Inbox WAHA |
| `evo-edge` | public `evo-edge-caddy` on ports 80/443 |
| `evo-crm-staging` | staging app plus Cloudflare tunnel |

`evo-student-docs` is a separate non-target service but is also attached to
`evo_public_web` and must not become an accidental successor dependency.

The production CRM app, lead-agent and Inbox app all run images labeled with
revision `ee8a825ebc72f84449636e3feaefab7a330913d4`. Production Compose inputs
resolve from immutable `/opt/evo-releases/.../repo/...` directories. The
historical `/opt/evo-crm` and `/opt/evo-inbox` checkouts are at different
commits and are not the running image authority.

### Networks and public edge

- `evo_crm_private`: CRM app, CRM WAHA, lead-agent.
- `evo_inbox_private`: Inbox app, Inbox WAHA.
- `evo_crm_staging_private`: staging app, staging tunnel.
- `evo_public_web`: public edge, both production apps, staging app and
  `evo-student-docs`.

`evo-edge-caddy` is the public route owner. At audit time:

- `https://evo-crm.72.62.119.112.sslip.io/login` returned HTTP 200;
- `https://evo-inbox.72.62.119.112.sslip.io/api/health` returned HTTP 200;
- `crm.evoadmissions.com` had no A/AAAA answer;
- `inbox.evoadmissions.com` had no A/AAAA answer.

The working `sslip.io` routes are validation endpoints, not proof that the
canonical production hostnames are ready.

### Active SQLite authorities

The CRM SQLite main file is 135,168 bytes at SHA-256
`08a8d4d792e7be32b5e99e2b1d7c49cfa560e6d2a6b7bcbff73991fe76dc75be`.
Its 4,120,032-byte WAL was present, so the hash of the main file alone is not a
logical database snapshot. Read-only copied-file inspection found these exact
row counts:

| CRM table | Rows | CRM table | Rows |
| --- | ---: | --- | ---: |
| `applications` | 0 | `calls` | 0 |
| `channel_messages` | 0 | `channels` | 0 |
| `clients` | 0 | `documents` | 0 |
| `lead_activities` | 0 | `leads` | 0 |
| `payments` | 0 | `settings` | 8 |
| `tasks` | 0 | `updates` | 0 |
| `users` | 1 | `visa_cases` | 0 |
| `wa_accounts` | 1 | `wa_conversations` | 0 |
| `wa_messages` | 0 |  |  |

The lead-agent SQLite file is 102,400 bytes at SHA-256
`2fcba8b72914254b47b0f02a7ceeed6737d3584885592bfc6daf8e0d7ed60a92`.
Its only populated application table is `knowledge_entries` with 12 rows;
`conversation_controls`, `conversations`, `crm_sync_attempts`, `lead_facts`,
`message_buffers` and `messages` each have 0.

The latest timestamped CRM backup observed was
`edu-admin-20260724T002547Z.db`, 135,168 bytes, SHA-256
`c58ce3b94bf5271d4cba2388ae0a8ef14befa4d89bc0e0a0c44f5c78be8674ec`.
It is rollback input only: no restore of that artifact was performed or proved.

### Active files, volumes and configuration seams

- CRM app data is about 4.1 MiB and contains `edu-admin.db`, its WAL and SHM.
- Timestamped CRM SQLite backups occupy about 516 KiB.
- Lead-agent data is about 108 KiB and contains `evo-lead-agent.db` plus its
  private token cache.
- CRM WAHA session storage is about 1.9 GiB and contains sessions including
  `crm_primary` and `china_curator`.
- Inbox WAHA session storage is about 181 MiB and contains `evo-inbox`.
- Staging data/output/backup volumes are effectively empty.

The production key-name inventory confirms active seams for `EVO_DB_PATH`,
Supabase URL/publishable/service credentials, platform feature flags,
`AUTH_SECRET`, backup location, lead-agent DB, amoCRM, Gemini, both WAHA
contours and internal CRM sync. Values were not read into evidence.

Current active runtime paths include:

- CRM SQLite through `EVO_DB_PATH` and `src/lib/db.ts`;
- lead-agent SQLite through `EVO_AGENT_DB_PATH`;
- the two-field development session in `src/lib/auth.ts`, `src/proxy.ts` and
  `src/app/login/page.tsx`;
- application-local private documents through
  `src/lib/server/private-document-repository.ts` and its route handlers;
- Supabase platform modules through
  `src/lib/server/platform-supabase-service-client.ts` and platform RPCs;
- CRM WAHA inbound ownership at `POST /webhooks/waha`, followed by
  `/api/internal/lead-agent/whatsapp`;
- a separate Inbox app, database surface, private network and WAHA session.

Both production Compose files explicitly set `EVO_AGENT_WORKER_ENABLED=false`.
The lead-agent service and webhook remain deployed even though the separate
worker toggle is off.

## Keep / adapt / remove / rebuild matrix

| Capability | Decision | Why / exit criterion |
| --- | --- | --- |
| Existing managed Supabase project | **KEEP** | Healthy, already shared, exact identity proved |
| Root migrations `001`–`079` | **KEEP** | Exact live history; immutable |
| Root migrations `080`–`092` | **ADAPT** | Rehearse from exact `079`, align to ADR 0024, then apply forward only |
| `platform` and `platform_private` schemas/RPCs | **ADAPT** | Retain security model; complete CRM rows, grants and outcome tests |
| Supabase Auth | **ADAPT** | Replace dev gate with real staff/session/role path in #546 |
| Existing Storage buckets | **KEEP for rollback / ADAPT selectively** | Do not treat public Inbox media as private CRM storage |
| `platform-documents`, `platform-whatsapp-media` | **REBUILD/PROVISION** | Private bucket, policy, signed access and recovery proof required |
| `evo-edge-caddy` and exact-release images | **KEEP** | Correct edge owner and useful immutable provenance pattern |
| VPS release topology | **ADAPT** | Converge CRM + Inbox on one successor app/release authority |
| Private WAHA isolation | **KEEP/ADAPT** | Keep private transport; converge to one authorized successor session |
| CRM `edu-admin.db` authority | **REMOVE after migration proof** | No dual read/write or permanent rollback runtime |
| Lead-agent `evo-lead-agent.db` authority | **REMOVE after provider replacement proof** | Provider receipts must persist in canonical Supabase |
| Two-field development gate | **REMOVE in #546** | Supabase Auth becomes the only staff session path |
| Local private-document bytes | **REMOVE in #548** | Supabase Storage becomes the only accepted file path |
| Separate Inbox UI/runtime | **REMOVE after integrated proof** | One EVO staff UI and one application authority |
| Old webhooks/workers/provider fallbacks | **REMOVE in owning slice** | One explicit provider path; ambiguity fails closed |
| Historical ADRs, migrations, runbooks and backups | **KEEP as history** | Rollback evidence only; never imported as successor authority |

“Remove” never means delete first. Each owning slice must prove the replacement
with real database, application and browser tests, attach a scoped `rg` and
runtime inventory, and then delete the superseded executable path in that same
slice. Frozen V1 deployment artifacts remain recoverable until authorized
cutover.

## Exact blockers before production mutation or cutover

1. Rehearse migrations `080`–`092` from the exact live `079` state and resolve
   any ADR 0024 conflicts.
2. Produce a recoverable pre-change database/Storage backup and pass a restore
   rehearsal; seven listed provider backups without a restore result are not
   acceptance.
3. Replace the dev gate with Supabase Auth and prove Admin, Sales and
   Admissions authorization in SQL, server actions and browser journeys.
4. Migrate/reconcile the active CRM and lead-agent SQLite state without dual
   writes, including every row-count/hash discrepancy.
5. Provision and prove the two target private buckets; current live buckets do
   not satisfy the document contract.
6. Move Sales, Student 360, Admissions, Finance and provider receipts to the
   one canonical `platform` / `platform_private` authority.
7. Converge CRM, Inbox, lead-agent and both WAHA contours into the accepted
   single app/provider topology, then remove the old executable paths.
8. Remove staging and unrelated membership from the successor public network.
9. Establish authorized DNS/TLS for the canonical hostname and prove the exact
   release image through it.
10. Complete staging browser/provider/recovery acceptance before the bounded
    production authority switch.

## Acceptance result for #545

- [x] Exact managed project and consumers identified without exposing secrets.
- [x] Remote `001`–`079` reconciled to root `001`–`092`; missing set recorded.
- [x] Auth, roles, RLS, Storage, Realtime, queues, audit and sanitized data
  population inventoried.
- [x] VPS, edge, apps, WAHAs, SQLite paths, networks, release provenance and
  current traffic ownership inventoried.
- [x] Keep/adapt/remove/rebuild decisions and cutover blockers recorded.
- [x] No Database, Auth, Storage, provider, deployment, DNS or paid-resource
  mutation occurred.
