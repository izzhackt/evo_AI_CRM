import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const migrationsDir = join(process.cwd(), 'supabase', 'migrations');
const migrationFiles = readdirSync(migrationsDir)
  .filter((file) => file.endsWith('.sql'))
  .sort();
const allMigrationsSql = migrationFiles
  .map((file) => readFileSync(join(migrationsDir, file), 'utf8'))
  .join('\n');
const evoShadowMigration = readFileSync(
  join(migrationsDir, '031_evo_companion_shadow_store.sql'),
  'utf8'
);
const wahaInboundMigration = readFileSync(
  join(migrationsDir, '032_waha_inbound_message_idempotency.sql'),
  'utf8'
);

function expectRlsEnabled(table: string) {
  expect(allMigrationsSql).toMatch(
    new RegExp(`ALTER\\s+TABLE\\s+${table}\\s+ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY`, 'i')
  );
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
    ];

    for (const table of requiredTables) {
      expect(allMigrationsSql).toMatch(
        new RegExp(`CREATE\\s+TABLE\\s+IF\\s+NOT\\s+EXISTS\\s+${table}\\b`, 'i')
      );
    }

    expect(allMigrationsSql).toMatch(/CREATE\s+TYPE\s+account_role_enum/i);
    expect(allMigrationsSql).toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+is_account_member/i);
    expect(allMigrationsSql).toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.set_member_role/i);
    expect(allMigrationsSql).toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.remove_account_member/i);
    expect(allMigrationsSql).toMatch(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.transfer_account_ownership/i
    );
  });

  it('adds only nullable amoCRM shadow identifiers for companion records', () => {
    expect(evoShadowMigration).toMatch(/ALTER\s+TABLE\s+contacts[\s\S]*amo_contact_id\s+text/i);
    expect(evoShadowMigration).toMatch(
      /ALTER\s+TABLE\s+conversations[\s\S]*amo_lead_id\s+text/i
    );
    expect(evoShadowMigration).toMatch(/ALTER\s+TABLE\s+deals[\s\S]*amo_lead_id\s+text/i);
    expect(evoShadowMigration).toMatch(/amoCRM remains the canonical contact identity source/i);
    expect(evoShadowMigration).toMatch(/amoCRM remains canonical for lead identity and sales status/i);
    expect(evoShadowMigration).not.toMatch(/sales_status/i);
    expect(evoShadowMigration).not.toMatch(/pipeline_status/i);
  });

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
      expectRlsEnabled(table);
    }

    expect(allMigrationsSql).toMatch(/CREATE\s+POLICY\s+contacts_select/i);
    expect(allMigrationsSql).toMatch(/CREATE\s+POLICY\s+conversations_select/i);
    expect(allMigrationsSql).toMatch(/CREATE\s+POLICY\s+messages_select/i);
    expect(evoShadowMigration).toMatch(/CREATE\s+POLICY\s+integration_settings_select/i);
  });

  it('keeps integration secret reads on the service-role side of the boundary', () => {
    expect(evoShadowMigration).toMatch(/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+integration_secrets/i);
    expect(evoShadowMigration).toMatch(/encrypted_value\s+text\s+NOT\s+NULL/i);
    expect(evoShadowMigration).toMatch(/no\s+SELECT\s+policy/i);
    expect(evoShadowMigration).toMatch(/service-role\s+client/i);
    expect(evoShadowMigration).not.toMatch(
      /CREATE\s+POLICY\s+\S+\s+ON\s+integration_secrets\s+FOR\s+SELECT/i
    );
    expect(evoShadowMigration).toMatch(/CREATE\s+POLICY\s+integration_secrets_insert/i);
    expect(evoShadowMigration).toMatch(/CREATE\s+POLICY\s+integration_secrets_update/i);
    expect(evoShadowMigration).toMatch(/CREATE\s+POLICY\s+integration_secrets_delete/i);
  });

  it('adds WAHA-specific inbound message idempotency without changing legacy Meta ids', () => {
    expect(wahaInboundMigration).toMatch(/ALTER\s+TABLE\s+messages[\s\S]*waha_session_name\s+text/i);
    expect(wahaInboundMigration).toMatch(/ALTER\s+TABLE\s+messages[\s\S]*waha_message_id\s+text/i);
    expect(wahaInboundMigration).toMatch(
      /CREATE\s+UNIQUE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+idx_messages_waha_session_message_id/i
    );
    expect(wahaInboundMigration).toMatch(
      /WHERE\s+waha_session_name\s+IS\s+NOT\s+NULL\s+AND\s+waha_message_id\s+IS\s+NOT\s+NULL/i
    );
    expect(wahaInboundMigration).not.toMatch(/UNIQUE\s*\(\s*message_id\s*\)/i);
  });
});
