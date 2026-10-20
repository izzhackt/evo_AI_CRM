-- md5 over the text of every row (content check without showing any content). Same text on both sides.
set timezone = 'UTC';
select 'platform.clients' as t, md5(coalesce(string_agg(x::text, E'\n' order by x::text), '')) as h from platform.clients x
union all
select 'platform.leads' as t, md5(coalesce(string_agg(x::text, E'\n' order by x::text), '')) as h from platform.leads x
union all
select 'platform.student_cases' as t, md5(coalesce(string_agg(x::text, E'\n' order by x::text), '')) as h from platform.student_cases x
union all
select 'platform.student_profiles' as t, md5(coalesce(string_agg(x::text, E'\n' order by x::text), '')) as h from platform.student_profiles x
union all
select 'platform.communication_conversations' as t, md5(coalesce(string_agg(x::text, E'\n' order by x::text), '')) as h from platform.communication_conversations x
union all
select 'platform.communication_messages' as t, md5(coalesce(string_agg(x::text, E'\n' order by x::text), '')) as h from platform.communication_messages x
union all
select 'platform.audit_events' as t, md5(coalesce(string_agg(x::text, E'\n' order by x::text), '')) as h from platform.audit_events x
union all
select 'platform.case_tasks' as t, md5(coalesce(string_agg(x::text, E'\n' order by x::text), '')) as h from platform.case_tasks x
union all
select 'platform.staff_tasks' as t, md5(coalesce(string_agg(x::text, E'\n' order by x::text), '')) as h from platform.staff_tasks x
union all
select 'platform.payment_obligations' as t, md5(coalesce(string_agg(x::text, E'\n' order by x::text), '')) as h from platform.payment_obligations x
union all
select 'platform.profiles' as t, md5(coalesce(string_agg(x::text, E'\n' order by x::text), '')) as h from platform.profiles x
union all
select 'platform.organization_memberships' as t, md5(coalesce(string_agg(x::text, E'\n' order by x::text), '')) as h from platform.organization_memberships x
union all
select 'public.ai_knowledge_chunks' as t, md5(coalesce(string_agg(x::text, E'\n' order by x::text), '')) as h from public.ai_knowledge_chunks x
union all
select 'auth.users' as t, md5(coalesce(string_agg(x::text, E'\n' order by x::text), '')) as h from auth.users x
union all
select 'auth.identities' as t, md5(coalesce(string_agg(x::text, E'\n' order by x::text), '')) as h from auth.identities x
union all
select 'storage.objects' as t, md5(coalesce(string_agg(x::text, E'\n' order by x::text), '')) as h from storage.objects x
union all
select 'storage.buckets' as t, md5(coalesce(string_agg(x::text, E'\n' order by x::text), '')) as h from storage.buckets x
union all
select 'supabase_migrations.schema_migrations' as t, md5(coalesce(string_agg(x::text, E'\n' order by x::text), '')) as h from supabase_migrations.schema_migrations x
union all
select 'pgmq.a_platform_work_v1' as t, md5(coalesce(string_agg(x::text, E'\n' order by x::text), '')) as h from pgmq.a_platform_work_v1 x
order by 1;
