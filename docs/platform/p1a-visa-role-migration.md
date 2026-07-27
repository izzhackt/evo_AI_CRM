# P1A legacy Visa-role migration runbook

Status: implementation runbook. It does **not** authorize a production
deployment, database write, service stop, or role change.

## What this migration does

The first platform release has four staff roles: `admin`, `sales`, `curator`
and `finance`. Visa work remains available as the `/visa` module, owned by
Admin and Curator. The old `visa` value is no longer a valid staff role.

The migration changes only existing `users.role = 'visa'` rows to `curator`.
User IDs and all foreign-key references remain unchanged. It does not change
student stages, visa cases, applications, documents or customer data.

The application never performs this conversion automatically during startup.
Before an approved migration, a legacy Visa account is denied at the
authentication boundary and is not included in the staff list.

## Why there are two commands

`inventory` is read-only. It creates a deterministic report containing user IDs
and reference counts, but no names, email addresses, phone numbers, passwords
or customer messages. A separate hash of all `{userId, role}` pairs binds the
review to the same user-role state without exposing staff identity. A second
cryptographic hash binds the report to the complete logical SQLite state:
normalized schema entries and every value in every table are included, while
the underlying values are never written to the report or console.

`apply` accepts only the exact reviewed inventory hash and a verified SQLite
backup. It requires the backup's complete logical-state hash to match the
reviewed inventory, then rechecks the live database inside one immediate
transaction. Any unrelated operational write, schema drift, missing user,
invalid backup, checksum mismatch or foreign-key error stops the migration.
SQLite's [Online Backup API](https://www.sqlite.org/backup.html) provides a
consistent source snapshot; the additional logical-state binding proves that
the reviewed database and rollback artifact still describe the same state.

## Required gate before production use

An authorized maintenance owner must provide all of the following:

1. a separately approved production maintenance window;
2. the exact deployed Git SHA and target SQLite path;
3. a proven write freeze covering the application, workers and webhook
   consumers from before backup creation through all post-apply checks;
4. a private backup directory owned by the operator with mode `0700`;
5. a verified `main-crm` SQLite online backup and manifest;
6. a reviewed inventory report and its exact SHA-256 value;
7. a coordinated application deploy/start and database rollback procedure.

Create the backup only after the write freeze is active. Keep the freeze active
through inventory, apply and post-apply verification. Do not resume writes if
the backup or current database fails the complete logical-state comparison.

Do not use `/tmp`, `/var/tmp`, the repository, `/opt/evo-crm` or
`/opt/evo-inbox` for reports or backups. Do not paste report files into GitHub,
chat, CI logs or PR comments.

## Approved command sequence

The examples use placeholders. The operator must replace them with explicit
absolute paths inside the approved private backup location.

First create and verify an online backup:

```bash
node scripts/backup-sqlite.mjs \
  command=backup \
  source=/absolute/path/to/edu-admin.db \
  destination=/absolute/private/evidence/pre-p1a.db \
  store=main-crm

node scripts/backup-sqlite.mjs \
  command=verify \
  artifact=/absolute/private/evidence/pre-p1a.db \
  manifest=/absolute/private/evidence/pre-p1a.db.manifest.json
```

Then create the read-only inventory:

```bash
npm run migrate:visa-role -- \
  command=inventory \
  source=/absolute/path/to/edu-admin.db \
  report=/absolute/private/evidence/p1a-visa-role-inventory.json
```

The command prints only `status`, migration ID, row count and inventory
SHA-256. Review the private JSON report. If the count or references are
unexpected, stop and investigate; do not run `apply`.

After approval, copy the printed inventory SHA-256 literally into `confirm`:

```bash
npm run migrate:visa-role -- \
  command=apply \
  source=/absolute/path/to/edu-admin.db \
  report=/absolute/private/evidence/p1a-visa-role-inventory.json \
  confirm=REVIEWED_INVENTORY_SHA256 \
  backup=/absolute/private/evidence/pre-p1a.db \
  backup-manifest=/absolute/private/evidence/pre-p1a.db.manifest.json \
  receipt=/absolute/private/evidence/p1a-visa-role-apply-receipt.json
```

Success creates a private `0600` receipt and one
`staff_role_migrations` audit row. It also installs database guards that reject
future inserts or updates with unsupported role values.

## Post-apply checks

Record only aggregate results:

```sql
SELECT role, COUNT(*) AS user_count
FROM users
GROUP BY role
ORDER BY role;

SELECT migration_id, source_role, target_role, migrated_user_count,
       inventory_sha256, backup_sha256, applied_at
FROM staff_role_migrations
WHERE migration_id = 'p1a-visa-role-to-curator-v2';

PRAGMA integrity_check;
PRAGMA foreign_key_check;
```

The role query must return no `visa` row. `integrity_check` must return `ok`,
and `foreign_key_check` must return zero rows. Then verify with dedicated test
accounts that Admin and Curator can open `/visa`, while Sales, Finance and
Student cannot open the staff Visa module. Resume application writes only after
all checks succeed and the release owner accepts the result.

## Rollback

Do not reverse the role with an ad-hoc SQL update: the new application rejects
`visa`, and a partial reverse would create an unsupported state.

If rollback is authorized, stop the affected release in the maintenance window,
restore the verified pre-migration SQLite backup as a complete database, deploy
the matching pre-P1A application commit, run integrity and foreign-key checks,
and verify authentication with dedicated test accounts. A production restore
remains a separate destructive action requiring explicit authorization.
