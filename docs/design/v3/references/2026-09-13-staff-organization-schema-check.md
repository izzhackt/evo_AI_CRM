# Staff organizational directory — actual schema verification

Date: 2026-09-13.
Contract: [employee roles and accounts, S1](../employee-roles-accounts-run-plan.md).
Candidate base: `fcd1fbc9`; migration154 SHA-256:
`0e7e2cf4e99b6687ccc2c17498cff9b3ac789d8bc632fefe20290999213c2e33`.

Status: actual PostgreSQL schema compilation and unauthenticated/privilege denial
checks passed. This does not establish the authorized Admin edit, concurrency,
replay, archive or real multi-employee browser journeys.

## Isolation and application

OrbStack reported `Running`; Docker context was exactly `orbstack`.
The existing `supabase_db_evo-platform-local` container was healthy.
The source database `postgres` had exactly 125 migration ledger entries, latest
`125`. The owned temporary database `evo_staff_s1_schema_20260913` did not exist
before creation. Existing local `supabase_admin` performed schema export/restore;
forward migrations ran as the existing `postgres` owner.

Exact creation and schema-copy commands:

```sh
docker exec supabase_db_evo-platform-local createdb -U supabase_admin --owner=postgres --template=template0 evo_staff_s1_schema_20260913
set -o pipefail
docker exec supabase_db_evo-platform-local pg_dump -U supabase_admin --dbname=postgres --schema-only | docker exec -i supabase_db_evo-platform-local psql -X -q -U supabase_admin -d evo_staff_s1_schema_20260913 -v ON_ERROR_STOP=1
```

No `--data-only`, table data, mock foundation or fabricated identity/JWT was
used. Dumped definitions retained real owners, grants, extensions and policies.
The existing cluster roles were reused; no global role was created or changed.

The actual committed migrations 126–153 applied without errors:

```sh
set -e
for migration_file in supabase/migrations/{126..153}_*.sql; do
  printf 'Applying %s\n' "$migration_file"
  docker exec -i supabase_db_evo-platform-local psql -X -q -U postgres -d evo_staff_s1_schema_20260913 -v ON_ERROR_STOP=1 < "$migration_file"
done
docker exec -i supabase_db_evo-platform-local psql -X -q -U postgres -d evo_staff_s1_schema_20260913 -v ON_ERROR_STOP=1 < supabase/migrations/154_platform_staff_organization_directory.sql
```

Migration154 also applied without errors. No historical migration was edited.
Reference content introduced by the real forward migrations is their authored
content; no test employees, departments, Auth rows or customer records were seeded.

## Actual catalog and denial checks

The following SQL ran against `evo_staff_s1_schema_20260913` with
`psql -X -q -U supabase_admin -At -v ON_ERROR_STOP=1`. It passed:
three new tables have both RLS flags; no direct table policy or product-role
grant exists; the three RPCs have authenticated-only EXECUTE, owner `postgres`,
SECURITY DEFINER and empty search_path; four real foreign keys exist.
Auth users, profiles, memberships, student cases and all three new tables are
empty.

```sql
BEGIN READ ONLY;
DO $check$
DECLARE t REGCLASS; r TEXT; privilege_name TEXT; fn REGPROCEDURE;
BEGIN
  FOREACH t IN ARRAY ARRAY['platform.staff_departments'::REGCLASS,
    'platform.staff_organizational_details'::REGCLASS, 'platform.staff_direction_assignments'::REGCLASS]
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid=t AND relrowsecurity AND relforcerowsecurity) THEN
      RAISE EXCEPTION 'RLS missing on %',t;
    END IF;
    IF EXISTS(SELECT 1 FROM pg_policy WHERE polrelid=t) THEN RAISE EXCEPTION 'Unexpected direct policy on %',t; END IF;
    FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role','supabase_auth_admin'] LOOP
      FOREACH privilege_name IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] LOOP
        IF has_table_privilege(r,t,privilege_name) THEN
          RAISE EXCEPTION 'Unexpected table privilege: % % %',r,t,privilege_name;
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;
  FOREACH fn IN ARRAY ARRAY[
    'platform.staff_workspace_directory(uuid)'::REGPROCEDURE,
    'platform.staff_department_command(uuid,uuid,text,text,text,bigint,text,uuid)'::REGPROCEDURE,
    'platform.staff_organizational_details_save(uuid,uuid,uuid,text,text[],bigint,text,uuid)'::REGPROCEDURE]
  LOOP
    IF NOT has_function_privilege('authenticated',fn,'EXECUTE') THEN RAISE EXCEPTION 'Missing authenticated RPC grant: %',fn; END IF;
    FOREACH r IN ARRAY ARRAY['anon','service_role','supabase_auth_admin'] LOOP
      -- Superuser supabase_admin is intentionally not a tested product role.
      IF has_function_privilege(r,fn,'EXECUTE') THEN RAISE EXCEPTION 'Unexpected RPC grant: % %',r,fn; END IF;
    END LOOP;
    IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=fn AND prosecdef
      AND proconfig @> ARRAY['search_path=""']::TEXT[] AND pg_get_userbyid(proowner)='postgres')
    THEN RAISE EXCEPTION 'Wrong RPC owner/security/search_path: %',fn; END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_constraint WHERE contype='f'
    AND conrelid IN ('platform.staff_departments'::REGCLASS,'platform.staff_organizational_details'::REGCLASS,
      'platform.staff_direction_assignments'::REGCLASS)) <> 4 THEN RAISE EXCEPTION 'Expected four real FKs'; END IF;
  IF EXISTS(SELECT 1 FROM platform.staff_departments)
    OR EXISTS(SELECT 1 FROM platform.staff_organizational_details)
    OR EXISTS(SELECT 1 FROM platform.staff_direction_assignments)
    OR EXISTS(SELECT 1 FROM auth.users)
    OR EXISTS(SELECT 1 FROM platform.profiles)
    OR EXISTS(SELECT 1 FROM platform.organization_memberships)
    OR EXISTS(SELECT 1 FROM platform.student_cases)
  THEN RAISE EXCEPTION 'Unexpected staff/Auth/case data in schema-only proof'; END IF;
  RAISE NOTICE 'PASS: three FORCE RLS tables, no direct policies/grants, three authenticated-only RPCs, four FKs, zero Auth/staff/case rows';
END $check$;
SELECT jsonb_build_object(
  'foreign_keys',(SELECT jsonb_agg(jsonb_build_object('table',conrelid::REGCLASS::TEXT,
    'definition',pg_get_constraintdef(oid)) ORDER BY conrelid::REGCLASS::TEXT,conname)
    FROM pg_constraint WHERE contype='f' AND conrelid IN ('platform.staff_departments'::REGCLASS,
      'platform.staff_organizational_details'::REGCLASS,'platform.staff_direction_assignments'::REGCLASS)),
  'new_tables_empty',NOT EXISTS(SELECT 1 FROM platform.staff_departments)
    AND NOT EXISTS(SELECT 1 FROM platform.staff_organizational_details)
    AND NOT EXISTS(SELECT 1 FROM platform.staff_direction_assignments),
  'source_customers_copied',false
);
ROLLBACK;
```

The next actual-role calls passed all nine denials. The `authenticated` role
had no user identity; each RPC entered its real Admin guard and raised
SQLSTATE `42501` with the exact message
`Active scoped Admin permission membership.read is required`.
All three direct table reads were denied, and `anon` could execute none of
the three RPCs. No Auth claim was fabricated.

```sql
BEGIN READ ONLY;
SET LOCAL ROLE authenticated;
DO $check$
DECLARE statement TEXT;
BEGIN
  IF auth.uid() IS NOT NULL THEN RAISE EXCEPTION 'Unexpected authenticated identity'; END IF;
  FOREACH statement IN ARRAY ARRAY[
    'SELECT platform.staff_workspace_directory(NULL::UUID)',
    'SELECT platform.staff_department_command(NULL::UUID,NULL::UUID,NULL::TEXT,NULL::TEXT,NULL::TEXT,NULL::BIGINT,NULL::TEXT,NULL::UUID)',
    'SELECT platform.staff_organizational_details_save(NULL::UUID,NULL::UUID,NULL::UUID,NULL::TEXT,NULL::TEXT[],NULL::BIGINT,NULL::TEXT,NULL::UUID)'
  ] LOOP
    BEGIN
      EXECUTE statement;
      RAISE EXCEPTION 'RPC accepted an absent identity: %',statement;
    EXCEPTION WHEN insufficient_privilege THEN
      IF SQLERRM <> 'Active scoped Admin permission membership.read is required' THEN
        RAISE EXCEPTION 'Unexpected denial instead of live Admin guard: %',SQLERRM;
      END IF;
      RAISE NOTICE 'PASS actual authenticated RPC guard: %',statement;
    END;
  END LOOP;
  FOREACH statement IN ARRAY ARRAY[
    'SELECT count(*) FROM platform.staff_departments',
    'SELECT count(*) FROM platform.staff_organizational_details',
    'SELECT count(*) FROM platform.staff_direction_assignments'
  ] LOOP
    BEGIN
      EXECUTE statement;
      RAISE EXCEPTION 'Direct table read unexpectedly succeeded: %',statement;
    EXCEPTION WHEN insufficient_privilege THEN
      RAISE NOTICE 'PASS actual authenticated direct table denial: %',statement;
    END;
  END LOOP;
END $check$;
ROLLBACK;
BEGIN READ ONLY;
SET LOCAL ROLE anon;
DO $check$
DECLARE statement TEXT;
BEGIN
  FOREACH statement IN ARRAY ARRAY[
    'SELECT platform.staff_workspace_directory(NULL::UUID)',
    'SELECT platform.staff_department_command(NULL::UUID,NULL::UUID,NULL::TEXT,NULL::TEXT,NULL::TEXT,NULL::BIGINT,NULL::TEXT,NULL::UUID)',
    'SELECT platform.staff_organizational_details_save(NULL::UUID,NULL::UUID,NULL::UUID,NULL::TEXT,NULL::TEXT[],NULL::BIGINT,NULL::TEXT,NULL::UUID)'
  ] LOOP
    BEGIN
      EXECUTE statement;
      RAISE EXCEPTION 'Anonymous RPC unexpectedly succeeded: %',statement;
    EXCEPTION WHEN insufficient_privilege THEN
      RAISE NOTICE 'PASS actual anonymous RPC denial: %',statement;
    END;
  END LOOP;
END $check$;
ROLLBACK;
```

The next read-only SQL ran as `postgres` and passed: all four foreign keys have
valid covering indexes; all five new audit actions and both resource types
are in the real allowlists; changed categories match the application contract;
there are zero lead rows.

```sql
BEGIN READ ONLY;
DO $check$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint AS c
    WHERE c.contype='f' AND c.conrelid IN (
      'platform.staff_departments'::REGCLASS,
      'platform.staff_organizational_details'::REGCLASS,
      'platform.staff_direction_assignments'::REGCLASS)
    AND NOT EXISTS(
      SELECT 1 FROM pg_index AS i WHERE i.indrelid=c.conrelid
        AND i.indisvalid AND i.indpred IS NULL AND i.indnkeyatts>=cardinality(c.conkey)
        AND NOT EXISTS(SELECT 1 FROM generate_subscripts(c.conkey,1) AS key_position
          WHERE i.indkey[key_position-1] <> c.conkey[key_position])
    )
  ) THEN RAISE EXCEPTION 'An actual FK lacks a covering index'; END IF;
  IF NOT platform_private.p7a_safe_audit_actions() @> ARRAY[
    'staff.department.create','staff.department.update','staff.department.archive',
    'staff.department.restore','staff.organization.details.change']::TEXT[]
  THEN RAISE EXCEPTION 'Missing safe audit actions'; END IF;
  IF NOT platform_private.p7a_safe_audit_resource_types() @>
    ARRAY['staff_department','staff_organizational_details']::TEXT[]
  THEN RAISE EXCEPTION 'Missing safe audit resource types'; END IF;
  IF EXISTS(SELECT 1 FROM unnest(ARRAY['staff.department.create','staff.department.update',
    'staff.department.archive','staff.department.restore']) AS action
    WHERE platform_private.p7a_changed_field_codes(action) <> ARRAY['record_status']::TEXT[])
    OR platform_private.p7a_changed_field_codes('staff.organization.details.change') <>
      ARRAY['assignment']::TEXT[]
  THEN RAISE EXCEPTION 'Unexpected audit category mapping'; END IF;
  IF EXISTS(SELECT 1 FROM platform.leads) THEN RAISE EXCEPTION 'Unexpected lead data'; END IF;
  RAISE NOTICE 'PASS: all four FKs indexed; five real audit actions, two resource types, exact safe category mappings; zero lead rows';
END $check$;
ROLLBACK;
```

## Existing authority preserved

Before/after migration154, these six installed functions had byte-identical
`pg_get_functiondef`, the same owner, ACL and configuration. All were owned by
`postgres` and retained empty search_path. `current_actor_authority`,
`platform_has_permission` and `platform_has_scope` retained their authenticated
grants; other private helpers retained only the owner grant. The safe audit row projection itself
was not rewritten and still omits before/after payloads and free-text reasons.

| Function | Definition MD5 before and after |
|---|---|
| `platform_private.is_eligible_staff_responsibility(uuid,uuid,text)` | `8a77df06bf70697cee79d8d70af5d97f` |
| `platform_private.p7a_safe_audit_row(platform.audit_events)` | `65732ceba4d7790fdc2d00e1abe04583` |
| `platform_private.require_admin_actor(uuid,text)` | `8ca00207c76bb652a8af7397d4f9dc64` |
| `platform.current_actor_authority()` | `3922703fc4470692fade9282961f7c8c` |
| `private.platform_has_permission(uuid,text)` | `8243455101c94c3d261bb0faff33bb5b` |
| `private.platform_has_scope(uuid,platform.scope_kind,uuid)` | `2315b6dbf00b576082eac13fd97ec33c` |

The source `postgres` database still reported ledger count `125`, latest `125`,
after every validation. No source schema/data, Supabase process, role or
container lifecycle was changed.

## Cleanup

Validation evidence was saved before cleanup. Exact target readback confirmed
owner `postgres` and zero active connections. The following command succeeded:

```sh
docker exec supabase_db_evo-platform-local dropdb -U supabase_admin evo_staff_s1_schema_20260913
```

Final actual readback:

```json
{"source_ledger_max":"125","source_ledger_count":125,"temporary_database_exists":false}
```

The existing container remained `Up 5 days (healthy)`. Only the owned schema
copy was removed. Its generated definitions can be recreated from the recorded
schema-only command and actual migration files; no working data was deleted.
