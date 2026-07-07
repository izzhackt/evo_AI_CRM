import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const migrationsDir = join(process.cwd(), 'supabase', 'migrations')
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

function expectRlsEnabled(table: string) {
  expect(allMigrationsSql).toMatch(
    new RegExp(
      `ALTER\\s+TABLE\\s+${table}\\s+ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY`,
      'i'
    )
  )
}

describe('Supabase companion schema contract', () => {
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
})
