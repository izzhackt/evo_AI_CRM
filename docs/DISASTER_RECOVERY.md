# EVO production-successor recovery contract

Status: active V3 recovery boundary for one managed Supabase authority, one
Next.js application, and one private WAHA transport. This document does not
authorize a production restore, provider mutation, customer-data change, WAHA
logout/relink, or traffic cutover. The superseded SQLite/companion proposal is
retained only at
[`docs/archive/v1/disaster-recovery.md`](archive/v1/disaster-recovery.md).

## Safety contract

- Rehearse #551 only in a newly created disposable local OrbStack contour with
  separate URLs, keys, networks and volumes. Never point the restored app or a
  restore command at production.
- Every restore operation requires an explicit source, destination, timestamp,
  manifest, byte count, checksum and verification result.
- Evidence must not contain secrets, customer rows, object names, session
  identifiers, cookies, tokens, phone numbers or plaintext provider settings.
- A rehearsal never stops, writes, migrates, relinks or reconfigures a live
  service. A real incident requires an approved incident plan.
- Recovery must fail closed. SQLite, Drizzle, a V1 database, companion Inbox,
  Lead Agent, fixtures, dual-read/write, or a shadow runtime is never a recovery
  fallback for the successor.

## Authoritative stores

| Store | Successor authority | Recovery boundary |
| --- | --- | --- |
| CRM data, role mappings and audit events | managed Supabase Postgres/Auth/RLS | encrypted provider or logical database backup restored into disposable local Supabase/Postgres; verify root migration compatibility and server-enforced access |
| Private documents | managed Supabase Storage | separate authenticated object inventory/byte backup restored into disposable private Storage; database backup alone is insufficient |
| WAHA session `crm_primary` | protected `evo_crm_waha_sessions` volume | preserve in place for app releases; use only a WAHA-supported, separately approved backup/relink procedure for disaster recovery |
| Runtime secrets and encrypted provider settings | protected server/provider secret stores | independently retained configuration restored without printing values, then verified through the real server-side reader |
| App generated output | `evo_crm_output` | non-authoritative; regenerate when possible and restore only if a named workflow requires it |
| Application image/config | exact release evidence | restore the recorded immutable image ID and checked-in exact-SHA Compose/configuration; never rebuild from a moving tag |

Supabase database backups and Storage object bytes are separate recovery
artifacts. A database-only restore must not be called a complete product
restore. Auth, RLS, Storage privacy, signed URLs and role behavior all require
isolated application/browser verification.

## Isolated rehearsal sequence

1. Record the exact repository commit, migration set, source backup identity,
   destination project identity, app image ID, WAHA digest and evidence root.
2. Prove the new local OrbStack destination is isolated and empty; reject
   production URLs, networks and volume names.
3. Restore Postgres/Auth from the real encrypted artifact according to the
   provider/PostgreSQL-supported process. A service-key table export, local
   schema reset or synthetic seed is not backup proof.
4. Reconcile root `supabase/` forward migrations without editing historical
   migrations or introducing another schema authority.
5. Restore private Storage separately and verify counts, sizes, checksums,
   bucket privacy and signed-access behavior without logging object names.
6. Start the exact app image against the disposable local Supabase contour.
   Keep provider settings absent and provider actions blocked; never copy or
   mount the live WAHA session volume.
7. Verify Supabase Auth, Admin/Sales/Admissions authorization, canonical CRM
   reads and writes, private document access, event-log continuity, health and
   fail-closed behavior in a real browser and database.
8. Record sanitized pass/fail results and timings. Destroy the isolated
   destination only under its explicit cleanup plan.

## WAHA boundary

Normal app rollback preserves `crm_primary`; it does not rescan a QR or move
session bytes. If the session volume itself is lost or unsupported for restore,
stop and use the separately authorized private relink procedure with the real
account owner. Never run two active webhook owners, reuse one session in two
WAHA instances, expose the dashboard publicly, or send a message merely to
prove recovery.

## Recovery objectives

RPO and RTO are operational/business decisions and remain unset until the
managed Supabase plan, Storage export mechanism, WAHA recovery support, staff
ownership and rehearsal timings are approved. Repository capability alone does
not establish a production recovery objective.

## Official references

- Supabase database backups: <https://supabase.com/docs/guides/platform/backups>
- Supabase local restore of a downloaded backup: <https://supabase.com/docs/guides/local-development/restoring-downloaded-backup>
- Supabase Storage downloads: <https://supabase.com/docs/guides/storage/management/download-objects>
- PostgreSQL `pg_dump`: <https://www.postgresql.org/docs/current/app-pgdump.html>
- PostgreSQL `pg_restore`: <https://www.postgresql.org/docs/current/app-pgrestore.html>
- WAHA sessions: <https://waha.devlike.pro/docs/how-to/sessions/>
- WAHA security: <https://waha.devlike.pro/docs/how-to/security/>
