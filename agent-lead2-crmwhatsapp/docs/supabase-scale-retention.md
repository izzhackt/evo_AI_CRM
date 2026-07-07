# Supabase Scale And Retention Preflight

Issue #27 audit scope: EVO Inbox conversations, messages, and AI knowledge
vectors. This document is review guidance only; no live Supabase project was
mutated by this run.

## Official Docs Checked

Checked on 2026-07-07:

- Supabase vector indexes: https://supabase.com/docs/guides/ai/vector-indexes
- Supabase HNSW indexes:
  https://supabase.com/docs/guides/ai/vector-indexes/hnsw-indexes
- Supabase semantic search:
  https://supabase.com/docs/guides/ai/semantic-search
- Supabase database size:
  https://supabase.com/docs/guides/platform/database-size
- Supabase billing:
  https://supabase.com/docs/guides/platform/billing-on-supabase
- Supabase compute/disk:
  https://supabase.com/docs/guides/platform/compute-and-disk

Supabase documents that large vector tables should be indexed, pgvector supports
HNSW and IVFFlat, HNSW is generally recommended by Supabase, and pgvector 0.7.0+
supports indexed vectors up to 2000 dimensions. EVO Inbox keeps
`ai_knowledge_chunks.embedding vector(1536)` so Gemini and OpenAI embeddings can
share the existing HNSW cosine index.

Supabase plan docs currently make the Free database-size quota the first hard
pilot limit: Free projects have a 500 MB database-size quota/read-only risk.
Pro is required before sustained production traffic or large imports.

## Current Schema Readiness

Conversation/message hot paths:

- `idx_contacts_account_phone_normalized` protects sender lookup by normalized
  phone.
- `idx_conversations_account` protects account-scoped inbox filters.
- `idx_conversations_account_amo_lead_id` protects amoCRM shadow lookup.
- `idx_messages_waha_session_message_id` makes WAHA inbound delivery
  idempotent.
- `idx_messages_waha_session` supports WAHA session filtering.
- `idx_conversations_account_last_message` supports inbox ordering by newest
  activity.
- `idx_messages_conversation_created_at` supports chronological message
  timelines and AI context loads.

Knowledge hot paths:

- `ai_knowledge_chunks_fts_idx` supports keyword fallback in Russian, Kyrgyz,
  and other non-English text through the language-neutral `simple` config.
- `ai_knowledge_chunks_embedding_idx` uses HNSW cosine distance for semantic
  Gemini/OpenAI retrieval.
- `ai_knowledge_chunks_document_id_idx` keeps delete/reindex operations bounded
  when a knowledge document changes.

## Storage Growth Estimates

These are planning estimates, not Supabase invoices. Run the SQL audit below on
the real project before each production proof or large import.

- Conversations are small shadow rows. Even tens of thousands of rows are
  usually not the quota driver unless previews contain long text.
- Messages are the main growth driver. A typical WhatsApp text message plus row
  overhead and indexes commonly lands in the 1-4 KB planning range; long text,
  media metadata, reactions, and additional indexes can exceed that. A Free
  500 MB database can be exhausted by roughly 100k-200k real messages once
  indexes, auth tables, knowledge vectors, WAL overhead, and operational margin
  are included.
- Knowledge vectors are dense. `vector(1536)` stores about 6 KB of float data
  before row, text, FTS, and HNSW index overhead. Plan 12-25 KB per chunk for
  first-launch sizing. 1,000 chunks is usually a small tens-of-MB footprint;
  10,000 chunks can become a material part of the Free quota.
- Supabase Storage buckets are separate from database rows. If media download
  and retention are enabled later, Free's storage headroom is also only pilot
  scale and Pro should be assumed for production media retention.

## Free Vs Pro Decision

Free is enough only for:

- Issue #20 proof traffic.
- A small pilot with no historical WhatsApp import.
- Fewer than roughly 10k live messages.
- A small knowledge base, roughly hundreds of chunks rather than thousands.
- No long-lived media retention in Supabase Storage.

Move to Pro before:

- Production staff use starts handling sustained daily WhatsApp traffic.
- Any historical WhatsApp or amoCRM message import exceeds 50k messages.
- The database reaches 250 MB or 50% of the Free quota.
- Knowledge chunks exceed roughly 2,000 chunks or frequent reindexing is needed.
- Media retention is enabled beyond URLs/metadata.
- Low-latency search and predictable compute matter during business hours.

Hard stop: do not continue on Free when the database approaches 400 MB. Schedule
the Pro move before Supabase can place the project into read-only behavior.

## Retention Policy To Approve

No automatic deletion is enabled in this issue. Before production, approve a
policy for:

- Messages: retain active/open conversations indefinitely; archive or export
  closed conversations older than 12-24 months if legal/operational policy
  permits.
- Media metadata: keep URLs only unless a separate media retention requirement
  is approved.
- Knowledge: delete stale documents through the admin UI; chunk rows cascade.
- Audit evidence: preserve enough rows to prove manual sends, no auto-reply,
  and amoCRM/Supabase identity linkage.

## Live Audit SQL

Run through Supabase SQL editor or `psql` against the intended project. Do not
paste secret values into tickets or logs.

```sql
select pg_size_pretty(pg_database_size(current_database())) as database_size;

select
  schemaname,
  relname,
  pg_size_pretty(pg_total_relation_size(format('%I.%I', schemaname, relname))) as total_size,
  pg_size_pretty(pg_relation_size(format('%I.%I', schemaname, relname))) as table_size
from pg_stat_user_tables
where relname in (
  'contacts',
  'conversations',
  'messages',
  'ai_knowledge_documents',
  'ai_knowledge_chunks'
)
order by pg_total_relation_size(format('%I.%I', schemaname, relname)) desc;

select 'contacts' as table_name, count(*) from contacts
union all select 'conversations', count(*) from conversations
union all select 'messages', count(*) from messages
union all select 'ai_knowledge_documents', count(*) from ai_knowledge_documents
union all select 'ai_knowledge_chunks', count(*) from ai_knowledge_chunks;

select
  extversion as pgvector_version
from pg_extension
where extname = 'vector';

select
  indexname,
  indexdef
from pg_indexes
where schemaname = 'public'
  and tablename in ('conversations', 'messages', 'ai_knowledge_chunks')
order by tablename, indexname;
```

Pass criteria:

- Database size is below 250 MB for Free, or project is already Pro.
- `vector` extension is present.
- `idx_conversations_account_last_message`,
  `idx_messages_conversation_created_at`, and
  `ai_knowledge_chunks_embedding_idx` exist.
- Knowledge chunk count and message count fit the plan above.
