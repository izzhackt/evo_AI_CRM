-- Fingerprint of everything the schema dump carries (application schemas): functions, relations with columns/defaults/ACL,
-- constraints, indexes, policies, triggers. Run on the CLOUD at pre-dump time and again at freeze time; equal => the
-- pre-dumped roles/schema/history_schema files are still exact. Output: one md5 and a count (no names, no data).
with s as (select oid, nspname from pg_namespace where nspname !~ '^pg_' and nspname not in
  ('information_schema','extensions','auth','storage','realtime','vault','graphql','graphql_public','net','pgbouncer','_realtime','supabase_functions','cron')),
x as (
  select 'fn ' || p.oid::regprocedure::text || ' ' || md5(coalesce(p.prosrc,'') || p.prokind::text || coalesce(p.proacl::text,'') || p.prosecdef::text || coalesce(p.proconfig::text,'')) as v
    from pg_proc p join s on s.oid = p.pronamespace
  union all
  select 'rel ' || c.oid::regclass::text || ' ' || c.relkind::text || ' ' || c.relrowsecurity::text || ' ' || coalesce(c.relacl::text,'') || ' ' ||
         coalesce((select string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text || ':' || coalesce(pg_get_expr(d.adbin, d.adrelid),'') || ':' || coalesce(a.attacl::text,''), ',' order by a.attnum)
                   from pg_attribute a left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
                   where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped), '')
    from pg_class c join s on s.oid = c.relnamespace where c.relkind in ('r','p','v','m','S','f')
  union all
  select 'con ' || conrelid::regclass::text || ' ' || conname || ' ' || pg_get_constraintdef(oid) from pg_constraint where connamespace in (select oid from s)
  union all
  select 'idx ' || indexrelid::regclass::text || ' ' || pg_get_indexdef(indexrelid) from pg_index i join pg_class c on c.oid = i.indrelid join s on s.oid = c.relnamespace
  union all
  select 'pol ' || schemaname || '.' || tablename || '.' || policyname || ' ' || coalesce(qual,'') || coalesce(with_check,'') from pg_policies
  union all
  select 'trg ' || tgrelid::regclass::text || ' ' || pg_get_triggerdef(oid) from pg_trigger where not tgisinternal
  union all
  select 'ver ' || version from supabase_migrations.schema_migrations
)
select md5(string_agg(v, E'\n' order by v)) as fp, count(*) as n from x;
