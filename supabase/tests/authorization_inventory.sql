\set ON_ERROR_STOP on

\echo '=== exposed relations and RLS ==='
SELECT
  n.nspname AS schema_name,
  c.relname AS relation_name,
  CASE c.relkind
    WHEN 'r' THEN 'table'
    WHEN 'p' THEN 'partitioned table'
    WHEN 'v' THEN 'view'
    WHEN 'm' THEN 'materialized view'
  END AS relation_type,
  c.relrowsecurity AS rls_enabled,
  c.relforcerowsecurity AS rls_forced
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname IN ('public', 'storage')
  AND c.relkind IN ('r', 'p', 'v', 'm')
ORDER BY schema_name, relation_name;

\echo '=== API-role relation grants ==='
SELECT
  tp.table_schema,
  tp.table_name,
  tp.grantee,
  string_agg(tp.privilege_type, ', ' ORDER BY tp.privilege_type) AS privileges
FROM information_schema.table_privileges tp
WHERE tp.table_schema IN ('public', 'storage')
  AND tp.grantee IN ('anon', 'authenticated', 'service_role')
GROUP BY tp.table_schema, tp.table_name, tp.grantee
ORDER BY tp.table_schema, tp.table_name, tp.grantee;

\echo '=== API-role column grants ==='
SELECT
  cp.table_schema,
  cp.table_name,
  cp.column_name,
  cp.grantee,
  string_agg(cp.privilege_type, ', ' ORDER BY cp.privilege_type) AS privileges
FROM information_schema.column_privileges cp
WHERE cp.table_schema IN ('public', 'storage')
  AND cp.grantee IN ('anon', 'authenticated', 'service_role')
GROUP BY cp.table_schema, cp.table_name, cp.column_name, cp.grantee
ORDER BY cp.table_schema, cp.table_name, cp.column_name, cp.grantee;

\echo '=== public and storage RLS policies ==='
SELECT
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
FROM pg_policies
WHERE schemaname IN ('public', 'storage')
ORDER BY schemaname, tablename, policyname;

\echo '=== exposed RPC/function grants and SECURITY DEFINER posture ==='
SELECT
  n.nspname AS schema_name,
  p.proname AS function_name,
  pg_get_function_identity_arguments(p.oid) AS arguments,
  p.prosecdef AS security_definer,
  p.proconfig AS function_settings,
  has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_execute,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_execute,
  has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_role_execute
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
LEFT JOIN pg_depend d
  ON d.classid = 'pg_proc'::regclass
  AND d.objid = p.oid
  AND d.deptype = 'e'
WHERE n.nspname IN ('public', 'private', 'platform')
  AND d.objid IS NULL
ORDER BY function_name, arguments;

\echo '=== storage bucket and policy posture ==='
SELECT
  b.id,
  b.public,
  b.file_size_limit,
  b.allowed_mime_types
FROM storage.buckets b
ORDER BY b.id;

SELECT
  policyname,
  roles,
  cmd,
  qual,
  with_check
FROM pg_policies
WHERE schemaname = 'storage'
  AND tablename = 'objects'
ORDER BY policyname;

\ir platform_current_actor_authority.sql
