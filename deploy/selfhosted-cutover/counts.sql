-- Row counts of the main tables. Same text runs on the cloud (Management API) and on self-hosted (psql). Counts only.
select 'platform.clients' as t, count(*) as n from platform.clients
union all select 'platform.leads', count(*) from platform.leads
union all select 'platform.student_cases', count(*) from platform.student_cases
union all select 'platform.student_profiles', count(*) from platform.student_profiles
union all select 'platform.communication_conversations', count(*) from platform.communication_conversations
union all select 'platform.communication_messages', count(*) from platform.communication_messages
union all select 'platform.conversation_participants', count(*) from platform.conversation_participants
union all select 'platform.staff_tasks', count(*) from platform.staff_tasks
union all select 'platform.case_tasks', count(*) from platform.case_tasks
union all select 'platform.audit_events', count(*) from platform.audit_events
union all select 'platform.profiles', count(*) from platform.profiles
union all select 'platform.organization_memberships', count(*) from platform.organization_memberships
union all select 'platform.payment_obligations', count(*) from platform.payment_obligations
union all select 'platform.catalog_institutions', count(*) from platform.catalog_institutions
union all select 'public.ai_knowledge_chunks', count(*) from public.ai_knowledge_chunks
union all select 'public.ai_knowledge_documents', count(*) from public.ai_knowledge_documents
union all select 'auth.users', count(*) from auth.users
union all select 'auth.identities', count(*) from auth.identities
union all select 'auth.refresh_tokens', count(*) from auth.refresh_tokens
union all select 'auth.sessions', count(*) from auth.sessions
union all select 'storage.buckets', count(*) from storage.buckets
union all select 'storage.objects', count(*) from storage.objects
union all select 'supabase_migrations.schema_migrations', count(*) from supabase_migrations.schema_migrations
union all select 'pgmq.q_platform_work_v1', count(*) from pgmq.q_platform_work_v1
union all select 'pgmq.q_platform_dead_letter_v1', count(*) from pgmq.q_platform_dead_letter_v1
union all select 'pgmq.q_ai_agent_work_v1', count(*) from pgmq.q_ai_agent_work_v1
union all select 'pgmq.q_ai_agent_dead_letter_v1', count(*) from pgmq.q_ai_agent_dead_letter_v1
union all select 'pgmq.a_platform_work_v1', count(*) from pgmq.a_platform_work_v1
union all select 'pgmq.a_ai_agent_work_v1', count(*) from pgmq.a_ai_agent_work_v1
union all select 'pgmq.a_platform_dead_letter_v1', count(*) from pgmq.a_platform_dead_letter_v1
union all select 'pgmq.a_ai_agent_dead_letter_v1', count(*) from pgmq.a_ai_agent_dead_letter_v1
order by 1;
