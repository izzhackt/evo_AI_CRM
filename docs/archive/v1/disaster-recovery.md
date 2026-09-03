# HISTORICAL V1 ONLY — DO NOT EXECUTE

This file preserves the superseded SQLite/companion recovery proposal. Its
commands are rollback/decision evidence only and are not valid successor
instructions. Use `docs/DISASTER_RECOVERY.md` for the managed-Supabase contract.

# EVO backup and disaster recovery

Status: Block F technical proposal and rehearsal runbook. RPO/RTO values below
are **pending business-owner approval**. Nothing in this document authorizes a
production restore, provider mutation, WAHA logout/relink, or customer message.

## Safety contract

- Restore only into a newly created, isolated destination. The scripts reject
  `/`, shared temporary roots, `/opt/evo-crm`, `/opt/evo-inbox`, and Docker's
  production data root.
- Create backup directories as `0700` and artifacts/manifests as `0600`.
- Every artifact needs a manifest, byte count, SHA-256 checksum, and explicit
  verification result. Never put secrets, customer rows, object names, session
  identifiers, or plaintext settings in a manifest or evidence log.
- Use a root-owned `mktemp -d /var/tmp/evo-dr.XXXXXX` destination for a
  rehearsal. Remove it with an exact validated path after evidence is recorded;
  retain only sanitized timings and pass/fail metadata in Git.
- A rehearsal never stops or changes a production container. A real recovery
  incident requires separate owner authorization and a reviewed incident plan.

## Store inventory and recovery method

| Store | Production location/authority | Backup | Isolated verification |
|---|---|---|---|
| Main CRM SQLite | `evo-crm_evo_crm_data:/app/data/edu-admin.db` | SQLite Online Backup API | checksum, `integrity_check`, `foreign_key_check`, schema/user version, application tables |
| Main CRM generated files | `evo-crm_evo_crm_output` | protected volume archive if non-empty | checksum, archive listing, expected file count; application-specific reads when files exist |
| Inbox database | managed Supabase PostgreSQL | authenticated `supabase db dump`/`pg_dump` | restore to a separately provisioned isolated project/database, then schema/version and application read checks |
| Inbox Storage objects | managed Supabase Storage, separate from DB backups | authenticated S3/CLI/API object export plus inventory | restore through Storage API/S3 into an isolated project/bucket; compare counts, sizes, and checksums without logging names |
| Lead Agent state | `evo-crm_evo_crm_lead_agent_data:/app/data/evo-lead-agent.db`, including OAuth token state stored in that protected volume | SQLite Online Backup API; never print token rows | SQLite checks plus Lead Agent read-only readiness against the isolated path |
| Encrypted CRM settings | ciphertext rows in main CRM SQLite; root key in protected runtime environment | database backup plus independently retained runtime secret configuration | run the real application secret reader inside an isolated protected runtime and assert success/length only; never print plaintext |
| WAHA sessions | `evo-crm_evo_crm_waha_sessions` and `evo-inbox_evo_inbox_waha_sessions` | protected volume archive | checksum/listing only while live; session consistency is not claimed without a WAHA-supported quiesced export |
| Release/secrets | exact Git SHA, image IDs/digests, Compose/Caddy hashes, root-owned `.env*` files | protected release manifest and secret-manager/off-host copy | reconstruct in an isolated Compose project with no public network and compare hashes/key names, never values |

Use `scripts/backup-release-config.sh` with an explicit allow-listed set of
existing EVO configuration files. It refuses non-EVO source roots and
production destinations, and logs only aggregate file count, size, and timing.

Supabase database backups exclude the underlying Storage objects; database and
object recovery therefore have independent pass/fail results. PostgreSQL custom
format dumps should be checked with `pg_restore --list` before isolated restore,
and restore must use `--exit-on-error` and a newly created empty database.

## SQLite rehearsal

Run the Online Backup API inside the container that already has the matching
runtime and database library, targeting a bind-mounted isolated directory:

```bash
node scripts/backup-sqlite.mjs \
  command=backup \
  source=/absolute/source.db \
  destination=/absolute/isolated/main-crm.db \
  store=main-crm

node scripts/backup-sqlite.mjs \
  command=verify \
  artifact=/absolute/isolated/main-crm.db \
  manifest=/absolute/isolated/main-crm.db.manifest.json
```

For Lead Agent SQLite, use Python's `sqlite3.Connection.backup` in the installed
Lead Agent runtime or an equivalent checked-in command once added; a raw copy
of a WAL-mode live database is not an accepted backup.

## Supabase database and Storage gate

Required inputs are a database connection credential, a separately provisioned
empty destination project/database, and authenticated Storage source/destination
access. A service-role API key is not a PostgreSQL password and does not satisfy
the logical restore gate. Do not restore a Dashboard/PITR backup over the live
project for a rehearsal because that makes the project unavailable and mutates
production.

## Encrypted settings gate

The isolated restored CRM database must be mounted read-only into an isolated
container using the production image and protected encryption key injection.
Invoke the application's real `decryptRuntimeSecret` path and record only:
`ciphertext_present`, `decrypt_succeeded`, and non-zero length. A missing root
key, plaintext output, locally reimplemented cipher, or test-only key fails the
gate.

The checked-in `scripts/verify-restored-settings.mjs` implements this gate. Run
it only in an isolated container with the restored database mounted read-only
and the protected production encryption key injected without logging it.

## WAHA relink procedure

The live session must not be logged out or relinked for rehearsal. If session
material cannot be restored consistently, create a fresh isolated WAHA project,
keep it private, configure the same session name and webhook/HMAC contract,
start it, and have the owner scan the newly displayed QR from the intended
WhatsApp account. Then verify session `WORKING`, webhook delivery, and
receive-only behavior before any separately approved send. Never reuse a QR,
copy a session between simultaneously running WAHA instances, or publish the
dashboard/API.

## Proposed objectives (pending owner approval)

| Store | Proposed RPO | Proposed RTO | Technical basis |
|---|---:|---:|---|
| Main CRM SQLite/files | 15 minutes | 60 minutes | small local store; frequent online snapshots and fast isolated checks |
| Supabase PostgreSQL | 24 hours with daily backups; 15 minutes if PITR is purchased | 4 hours | provider plan/PITR choice and isolated-project availability dominate |
| Supabase Storage | 24 hours | 8 hours | separate object export, transfer, and checksum verification |
| Lead Agent SQLite/token state | 15 minutes | 60 minutes | small SQLite store; OAuth state must remain protected and readable |
| Encrypted settings/release secrets | on every change | 2 hours | configuration changes are infrequent but exact key availability is mandatory |
| WAHA sessions | 24 hours best-effort; relink is authoritative fallback | 4 hours plus owner availability | live archive consistency is not guaranteed; QR relink requires the account owner |

## Official recovery references

- SQLite Online Backup API: <https://www.sqlite.org/backup.html>
- SQLite integrity checks: <https://www.sqlite.org/pragma.html#pragma_integrity_check>
- PostgreSQL `pg_dump`: <https://www.postgresql.org/docs/current/app-pgdump.html>
- PostgreSQL `pg_restore`: <https://www.postgresql.org/docs/current/app-pgrestore.html>
- Supabase database backups: <https://supabase.com/docs/guides/platform/backups>
- Supabase backup/restore CLI: <https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore>
- Supabase Storage downloads: <https://supabase.com/docs/guides/storage/management/download-objects>
- WAHA sessions: <https://waha.devlike.pro/docs/how-to/sessions/>
- WAHA security: <https://waha.devlike.pro/docs/how-to/security/>
