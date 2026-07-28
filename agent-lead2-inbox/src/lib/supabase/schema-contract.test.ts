import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const migrationsDir = fileURLToPath(
  new URL('../../../../supabase/migrations/', import.meta.url)
)
const migrationFiles = readdirSync(migrationsDir)
  .filter((file) => file.endsWith('.sql'))
  .sort()
const allMigrationsSql = migrationFiles
  .map((file) => readFileSync(join(migrationsDir, file), 'utf8'))
  .join('\n')
const evoShadowMigration = readFileSync(
  join(migrationsDir, '031_evo_companion_shadow_store.sql'),
  'utf8'
)
const wahaInboundMigration = readFileSync(
  join(migrationsDir, '032_waha_inbound_message_idempotency.sql'),
  'utf8'
)
const wahaManualOutboundMigration = readFileSync(
  join(migrationsDir, '033_waha_manual_outbound_status.sql'),
  'utf8'
)
const embeddingsScaleMigration = readFileSync(
  join(migrationsDir, '035_ai_embeddings_provider_and_scale.sql'),
  'utf8'
)
const reliableAmoCrmSyncMigration = readFileSync(
  join(migrationsDir, '036_reliable_amocrm_sync_buffer.sql'),
  'utf8'
)
const outboundAuditMigration = readFileSync(
  join(migrationsDir, '037_operator_drafts_and_waha_outbox.sql'),
  'utf8'
)
const platformGrantMigration = readFileSync(
  join(migrationsDir, '040_platform_namespaces_and_secret_containment.sql'),
  'utf8'
)
const platformIdentityMigration = readFileSync(
  join(migrationsDir, '041_platform_identity_rbac_audit.sql'),
  'utf8'
)
const supabaseConfig = readFileSync(
  fileURLToPath(new URL('../../../../supabase/config.toml', import.meta.url)),
  'utf8'
)

function expectRlsEnabled(table: string) {
  expect(allMigrationsSql).toMatch(
    new RegExp(
      `ALTER\\s+TABLE\\s+${table}\\s+ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY`,
      'i'
    )
  )
}

describe('Supabase companion schema contract', () => {
  it('preserves P2B containment and adds only the reviewed P2C identity boundary', () => {
    expect(migrationFiles.at(-1)).toBe(
      '041_platform_identity_rbac_audit.sql'
    )
    expect(platformGrantMigration).toMatch(
      /CREATE\s+SCHEMA\s+IF\s+NOT\s+EXISTS\s+platform\s+AUTHORIZATION\s+postgres/i
    )
    expect(platformGrantMigration).toMatch(
      /CREATE\s+SCHEMA\s+IF\s+NOT\s+EXISTS\s+platform_private\s+AUTHORIZATION\s+postgres/i
    )
    expect(platformGrantMigration).not.toMatch(/CREATE\s+TABLE/i)
    expect(platformGrantMigration).toMatch(
      /GRANT\s+USAGE\s+ON\s+SCHEMA\s+platform\s+TO\s+authenticated,\s*service_role/i
    )
    expect(platformGrantMigration).toMatch(
      /REVOKE\s+ALL\s+PRIVILEGES\s+ON\s+SCHEMA\s+platform_private\s+FROM\s+PUBLIC,\s*anon,\s*authenticated,\s*service_role/i
    )
    expect(platformIdentityMigration).toMatch(
      /CREATE\s+TYPE\s+platform\.business_role\s+AS\s+ENUM\s*\(\s*'admin',\s*'sales',\s*'curator',\s*'finance',\s*'student'\s*\)/i
    )
    expect(platformIdentityMigration).toMatch(
      /CREATE\s+TABLE\s+platform\.organization_memberships/i
    )
    expect(platformIdentityMigration).toMatch(
      /ALTER\s+TABLE\s+platform\.organization_memberships\s+FORCE\s+ROW\s+LEVEL\s+SECURITY/i
    )
    expect(platformIdentityMigration).toMatch(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+platform_private\.custom_access_token_hook\s*\(\s*event\s+JSONB\s*\)[\s\S]*SECURITY\s+INVOKER/i
    )
    expect(platformIdentityMigration).toMatch(
      /RETURN\s+jsonb_build_object\s*\(\s*'claims',\s*claims\s*\)/i
    )
    expect(supabaseConfig).toMatch(
      /schemas\s*=\s*\["public",\s*"platform",\s*"graphql_public"\]/
    )
    expect(supabaseConfig).not.toMatch(
      /schemas\s*=.*(?:platform_private|pgmq_public)/
    )
  })

  it('makes legacy secret-bearing tables service-only without broad grants', () => {
    for (const table of [
      'whatsapp_config',
      'ai_configs',
      'webhook_endpoints',
      'api_keys',
      'integration_secrets',
    ]) {
      expect(platformGrantMigration).toMatch(
        new RegExp(`public\\.${table}`, 'i')
      )
    }

    expect(platformGrantMigration).toMatch(
      /REVOKE\s+ALL\s+PRIVILEGES\s+ON\s+TABLE[\s\S]*public\.whatsapp_config[\s\S]*public\.integration_secrets[\s\S]*FROM\s+PUBLIC,\s*anon,\s*authenticated,\s*service_role/i
    )
    expect(platformGrantMigration).toMatch(
      /GRANT\s+SELECT,\s*INSERT,\s*UPDATE,\s*DELETE\s+ON\s+TABLE[\s\S]*public\.whatsapp_config[\s\S]*public\.integration_secrets[\s\S]*TO\s+service_role/i
    )
    expect(platformGrantMigration).not.toMatch(
      /GRANT\s+ALL\s+PRIVILEGES\s+ON\s+TABLE/i
    )
    expect(platformGrantMigration).toMatch(
      /DROP\s+POLICY\s+IF\s+EXISTS\s+integration_secrets_insert\s+ON\s+public\.integration_secrets/i
    )
  })

  it('preserves the tables required for issue #11 companion data', () => {
    const requiredTables = [
      'profiles',
      'accounts',
      'account_invitations',
      'contacts',
      'conversations',
      'messages',
      'integration_settings',
      'integration_secrets',
      'ai_configs',
      'ai_knowledge_documents',
      'ai_knowledge_chunks',
    ]

    for (const table of requiredTables) {
      expect(allMigrationsSql).toMatch(
        new RegExp(`CREATE\\s+TABLE\\s+IF\\s+NOT\\s+EXISTS\\s+${table}\\b`, 'i')
      )
    }

    expect(allMigrationsSql).toMatch(/CREATE\s+TYPE\s+account_role_enum/i)
    expect(allMigrationsSql).toMatch(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+is_account_member/i
    )
    expect(allMigrationsSql).toMatch(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.set_member_role/i
    )
    expect(allMigrationsSql).toMatch(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.remove_account_member/i
    )
    expect(allMigrationsSql).toMatch(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.transfer_account_ownership/i
    )
  })

  it('adds only nullable amoCRM shadow identifiers for companion records', () => {
    expect(evoShadowMigration).toMatch(
      /ALTER\s+TABLE\s+contacts[\s\S]*amo_contact_id\s+text/i
    )
    expect(evoShadowMigration).toMatch(
      /ALTER\s+TABLE\s+conversations[\s\S]*amo_lead_id\s+text/i
    )
    expect(evoShadowMigration).toMatch(
      /ALTER\s+TABLE\s+deals[\s\S]*amo_lead_id\s+text/i
    )
    expect(evoShadowMigration).toMatch(
      /amoCRM remains the canonical contact identity source/i
    )
    expect(evoShadowMigration).toMatch(
      /amoCRM remains canonical for lead identity and sales status/i
    )
    expect(evoShadowMigration).not.toMatch(/sales_status/i)
    expect(evoShadowMigration).not.toMatch(/pipeline_status/i)
  })

  it('enables RLS on exposed companion tables and settings boundaries', () => {
    for (const table of [
      'profiles',
      'accounts',
      'contacts',
      'conversations',
      'messages',
      'integration_settings',
      'integration_secrets',
      'ai_configs',
      'ai_knowledge_documents',
      'ai_knowledge_chunks',
    ]) {
      expectRlsEnabled(table)
    }

    expect(allMigrationsSql).toMatch(/CREATE\s+POLICY\s+contacts_select/i)
    expect(allMigrationsSql).toMatch(/CREATE\s+POLICY\s+conversations_select/i)
    expect(allMigrationsSql).toMatch(/CREATE\s+POLICY\s+messages_select/i)
    expect(evoShadowMigration).toMatch(
      /CREATE\s+POLICY\s+integration_settings_select/i
    )
  })

  it('keeps integration secret reads on the service-role side of the boundary', () => {
    expect(evoShadowMigration).toMatch(
      /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+integration_secrets/i
    )
    expect(evoShadowMigration).toMatch(/encrypted_value\s+text\s+NOT\s+NULL/i)
    expect(evoShadowMigration).toMatch(/no\s+SELECT\s+policy/i)
    expect(evoShadowMigration).toMatch(/service-role\s+client/i)
    expect(evoShadowMigration).not.toMatch(
      /CREATE\s+POLICY\s+\S+\s+ON\s+integration_secrets\s+FOR\s+SELECT/i
    )
    expect(evoShadowMigration).toMatch(
      /CREATE\s+POLICY\s+integration_secrets_insert/i
    )
    expect(evoShadowMigration).toMatch(
      /CREATE\s+POLICY\s+integration_secrets_update/i
    )
    expect(evoShadowMigration).toMatch(
      /CREATE\s+POLICY\s+integration_secrets_delete/i
    )
  })

  it('adds WAHA-specific inbound message idempotency without changing legacy Meta ids', () => {
    expect(wahaInboundMigration).toMatch(
      /ALTER\s+TABLE\s+messages[\s\S]*waha_session_name\s+text/i
    )
    expect(wahaInboundMigration).toMatch(
      /ALTER\s+TABLE\s+messages[\s\S]*waha_message_id\s+text/i
    )
    expect(wahaInboundMigration).toMatch(
      /CREATE\s+UNIQUE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+idx_messages_waha_session_message_id/i
    )
    expect(wahaInboundMigration).toMatch(
      /WHERE\s+waha_session_name\s+IS\s+NOT\s+NULL\s+AND\s+waha_message_id\s+IS\s+NOT\s+NULL/i
    )
    expect(wahaInboundMigration).not.toMatch(/UNIQUE\s*\(\s*message_id\s*\)/i)
  })

  it('adds nullable WAHA manual outbound provider status without requiring provider ids', () => {
    expect(wahaManualOutboundMigration).toMatch(
      /ALTER\s+TABLE\s+messages[\s\S]*waha_message_status\s+text/i
    )
    expect(wahaManualOutboundMigration).toMatch(/accepted_without_id/i)
    expect(wahaManualOutboundMigration).not.toMatch(
      /waha_message_id\s+text\s+NOT\s+NULL/i
    )
  })

  it('allows Gemini as an encrypted account-level AI provider', () => {
    expect(allMigrationsSql).toMatch(
      /DROP\s+CONSTRAINT\s+IF\s+EXISTS\s+ai_configs_provider_check/i
    )
    expect(allMigrationsSql).toMatch(
      /CHECK\s*\(\s*provider\s+IN\s*\([\s\S]*'openai'[\s\S]*'anthropic'[\s\S]*'gemini'[\s\S]*\)\s*\)/i
    )
  })

  it('adds explicit embeddings provider selection with keyword as the default', () => {
    expect(embeddingsScaleMigration).toMatch(
      /ALTER\s+TABLE\s+ai_configs[\s\S]*ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+embeddings_provider\s+text\s+NOT\s+NULL\s+DEFAULT\s+'keyword'/i
    )
    expect(embeddingsScaleMigration).toMatch(
      /DROP\s+CONSTRAINT\s+IF\s+EXISTS\s+ai_configs_embeddings_provider_check/i
    )
    expect(embeddingsScaleMigration).toMatch(
      /CHECK\s*\(\s*embeddings_provider\s+IN\s*\([\s\S]*'keyword'[\s\S]*'gemini'[\s\S]*'openai'[\s\S]*\)\s*\)/i
    )
  })

  it('adds composite indexes for production inbox and message growth paths', () => {
    expect(embeddingsScaleMigration).toMatch(
      /CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+idx_conversations_account_last_message[\s\S]*ON\s+conversations\s*\(\s*account_id,\s*last_message_at\s+DESC\s+NULLS\s+LAST,\s*updated_at\s+DESC\s+NULLS\s+LAST,\s*id\s*\)/i
    )
    expect(embeddingsScaleMigration).toMatch(
      /CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+idx_messages_conversation_created_at[\s\S]*ON\s+messages\s*\(\s*conversation_id,\s*created_at,\s*id\s*\)/i
    )
  })

  it('adds explicit retryable amoCRM sync status to conversations and messages', () => {
    expect(reliableAmoCrmSyncMigration).toMatch(
      /ALTER\s+TABLE\s+conversations[\s\S]*ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+crm_sync_status\s+text\s+NOT\s+NULL\s+DEFAULT\s+'pending'/i
    )
    expect(reliableAmoCrmSyncMigration).toMatch(
      /CHECK\s*\(\s*crm_sync_status\s+IN\s*\([\s\S]*'pending'[\s\S]*'synced'[\s\S]*'not_configured'[\s\S]*'blocked'[\s\S]*\)\s*\)/i
    )
    expect(reliableAmoCrmSyncMigration).toMatch(
      /ALTER\s+TABLE\s+messages[\s\S]*ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+crm_sync_status\s+text\s+NOT\s+NULL\s+DEFAULT\s+'pending'/i
    )
    expect(reliableAmoCrmSyncMigration).toMatch(
      /idx_conversations_account_crm_sync_retry/i
    )
    expect(reliableAmoCrmSyncMigration).toMatch(
      /idx_messages_conversation_crm_sync_status/i
    )
  })

  it('adds immutable account-scoped AI draft audits with member read-only access', () => {
    expect(
      outboundAuditMigration.match(/DEFAULT\s+gen_random_uuid\(\)/gi) ?? []
    ).toHaveLength(2)
    expect(outboundAuditMigration).not.toMatch(/\buuid_generate_v4\(\)/i)
    expect(outboundAuditMigration).toMatch(
      /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+ai_drafts\s*\([\s\S]*account_id\s+uuid\s+NOT\s+NULL[\s\S]*conversation_id\s+uuid\s+NOT\s+NULL[\s\S]*created_by\s+uuid\s+NOT\s+NULL[\s\S]*provider\s+text\s+NOT\s+NULL[\s\S]*model\s+text\s+NOT\s+NULL[\s\S]*content_text\s+text\s+NOT\s+NULL[\s\S]*knowledge_chunk_ids\s+uuid\[\]\s+NOT\s+NULL[\s\S]*knowledge_item_count\s+integer\s+NOT\s+NULL[\s\S]*created_at\s+timestamptz\s+NOT\s+NULL/i
    )
    expect(outboundAuditMigration).toMatch(
      /ALTER\s+TABLE\s+ai_drafts\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/i
    )
    expect(outboundAuditMigration).toMatch(
      /CREATE\s+POLICY\s+ai_drafts_select\s+ON\s+ai_drafts\s+FOR\s+SELECT[\s\S]*is_account_member\s*\(\s*account_id\s*\)/i
    )
    expect(outboundAuditMigration).toMatch(
      /REVOKE\s+INSERT,\s*UPDATE,\s*DELETE\s+ON\s+TABLE\s+ai_drafts\s+FROM\s+anon,\s*authenticated/i
    )
    expect(outboundAuditMigration).toMatch(
      /CREATE\s+TRIGGER\s+ai_drafts_immutable/i
    )
  })

  it('extends messages with a backward-compatible durable WAHA outbox contract', () => {
    for (const column of [
      'ai_draft_id',
      'outbound_state',
      'outbound_attempt_count',
      'outbound_error_code',
      'outbound_error',
      'outbound_started_at',
      'outbound_completed_at',
      'waha_chat_id',
      'waha_ack',
      'waha_ack_name',
      'waha_ack_at',
    ]) {
      expect(outboundAuditMigration).toMatch(
        new RegExp(`ADD\\s+COLUMN\\s+IF\\s+NOT\\s+EXISTS\\s+${column}\\b`, 'i')
      )
    }

    expect(outboundAuditMigration).toMatch(
      /CHECK\s*\(\s*outbound_state\s+IN\s*\(\s*'queued',\s*'dispatching',\s*'accepted',\s*'rejected',\s*'unknown'\s*\)\s*\)/i
    )
    expect(outboundAuditMigration).toMatch(
      /FOREIGN\s+KEY\s*\(\s*ai_draft_id,\s*conversation_id\s*\)[\s\S]*REFERENCES\s+ai_drafts\s*\(\s*id,\s*conversation_id\s*\)/i
    )
    expect(outboundAuditMigration).toMatch(
      /CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+idx_messages_waha_outbound_reconcile[\s\S]*ON\s+messages\s*\(\s*outbound_state,\s*waha_session_name,\s*waha_message_id\s*\)[\s\S]*WHERE[\s\S]*waha_message_id\s+IS\s+NOT\s+NULL[\s\S]*waha_chat_id\s+IS\s+NOT\s+NULL/i
    )
    expect(outboundAuditMigration).toMatch(
      /DROP\s+POLICY\s+IF\s+EXISTS\s+messages_modify\s+ON\s+messages/i
    )
    expect(outboundAuditMigration).toMatch(
      /CREATE\s+POLICY\s+messages_select\s+ON\s+messages\s+FOR\s+SELECT[\s\S]*is_account_member\s*\(\s*c\.account_id\s*\)/i
    )
    expect(outboundAuditMigration).toMatch(
      /REVOKE\s+INSERT,\s*UPDATE,\s*DELETE,\s*TRUNCATE,\s*REFERENCES,\s*TRIGGER\s+ON\s+TABLE\s+messages\s+FROM\s+anon,\s*authenticated/i
    )
    expect(outboundAuditMigration).toMatch(
      /GRANT\s+SELECT,\s*INSERT,\s*UPDATE,\s*DELETE\s+ON\s+TABLE\s+messages\s+TO\s+service_role/i
    )
  })

  it('records immutable acknowledgement evidence through a service-role-only RPC', () => {
    expect(outboundAuditMigration).toMatch(
      /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+waha_message_ack_events/i
    )
    expect(outboundAuditMigration).toMatch(
      /UNIQUE\s*\(\s*account_id,\s*waha_session_name,\s*waha_message_id,\s*ack\s*\)/i
    )
    expect(outboundAuditMigration).toMatch(
      /CREATE\s+TRIGGER\s+waha_message_ack_events_immutable/i
    )
    expect(outboundAuditMigration).toMatch(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+record_waha_message_ack[\s\S]*SECURITY\s+DEFINER[\s\S]*c\.account_id\s*=\s*p_account_id[\s\S]*m\.waha_session_name\s*=\s*p_session_name[\s\S]*m\.waha_message_id\s*=\s*p_waha_message_id/i
    )
    expect(outboundAuditMigration).toMatch(
      /p_ack\s*=\s*-1\s+AND\s+m\.waha_ack\s*=\s*0/i
    )
    expect(outboundAuditMigration).toMatch(
      /p_ack\s*>=\s*0\s+AND\s+m\.waha_ack\s*>=\s*0\s+AND\s+p_ack\s*>\s*m\.waha_ack/i
    )
    expect(outboundAuditMigration).toMatch(
      /REVOKE\s+ALL\s+ON\s+FUNCTION\s+record_waha_message_ack[\s\S]*FROM\s+PUBLIC,\s*anon,\s*authenticated/i
    )
    expect(outboundAuditMigration).toMatch(
      /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+record_waha_message_ack[\s\S]*TO\s+service_role/i
    )
  })
})
