-- Canonical ACL listing of the application schemas: one row per (object, grantee, privilege).
-- Same text is run on the cloud (Management API, read-only) and on self-hosted (psql); the result is compared.
-- Output columns: kind, obj, sub, grantee, priv, grantable. Owner's own rows are left out.
set search_path = '';
with sch as (
  select oid, nspname from pg_catalog.pg_namespace
  where nspname !~ '^pg_' and nspname not in ('information_schema','auth','storage','realtime','extensions','vault',
        'graphql','graphql_public','net','pgbouncer','_realtime','supabase_functions','pgsodium','pgsodium_masks',
        '_analytics','_supavisor','cron')
),
rows as (
  select case when c.relkind = 'S' then 'sequence' else 'table' end as kind,
         pg_catalog.quote_ident(s.nspname) || '.' || pg_catalog.quote_ident(c.relname) as obj, '' as sub,
         x.grantee, x.privilege_type as priv, x.is_grantable, c.relowner as owner
  from pg_catalog.pg_class c join sch s on s.oid = c.relnamespace
  cross join lateral pg_catalog.aclexplode(coalesce(c.relacl, pg_catalog.acldefault((case when c.relkind = 'S' then 's' else 'r' end)::"char", c.relowner))) x
  where c.relkind in ('r','p','v','m','f','S')
  union all
  select 'column', pg_catalog.quote_ident(s.nspname) || '.' || pg_catalog.quote_ident(c.relname), pg_catalog.quote_ident(a.attname),
         x.grantee, x.privilege_type, x.is_grantable, c.relowner
  from pg_catalog.pg_attribute a join pg_catalog.pg_class c on c.oid = a.attrelid join sch s on s.oid = c.relnamespace
  cross join lateral pg_catalog.aclexplode(a.attacl) x
  where a.attacl is not null and not a.attisdropped and c.relkind in ('r','p','v','m','f')
  union all
  select 'function',
         pg_catalog.quote_ident(s.nspname) || '.' || pg_catalog.quote_ident(p.proname) || '(' || pg_catalog.pg_get_function_identity_arguments(p.oid) || ')', '',
         x.grantee, x.privilege_type, x.is_grantable, p.proowner
  from pg_catalog.pg_proc p join sch s on s.oid = p.pronamespace
  cross join lateral pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f'::"char", p.proowner))) x
  where p.prokind in ('f','p')
  union all
  select 'schema', pg_catalog.quote_ident(s.nspname), '', x.grantee, x.privilege_type, x.is_grantable, n.nspowner
  from sch s join pg_catalog.pg_namespace n on n.oid = s.oid
  cross join lateral pg_catalog.aclexplode(coalesce(n.nspacl, pg_catalog.acldefault('n'::"char", n.nspowner))) x
  union all
  select 'type', pg_catalog.quote_ident(s.nspname) || '.' || pg_catalog.quote_ident(t.typname), '', x.grantee, x.privilege_type, x.is_grantable, t.typowner
  from pg_catalog.pg_type t join sch s on s.oid = t.typnamespace
  cross join lateral pg_catalog.aclexplode(coalesce(t.typacl, pg_catalog.acldefault('T'::"char", t.typowner))) x
  where t.typtype in ('e','d')
)
select kind, obj, sub,
       case when grantee = 0 then 'PUBLIC' else pg_catalog.quote_ident(pg_catalog.pg_get_userbyid(grantee)) end as grantee,
       priv, case when is_grantable then 't' else 'f' end as grantable
from rows
where grantee = 0 or grantee <> owner
order by 1, 2, 3, 4, 5;
