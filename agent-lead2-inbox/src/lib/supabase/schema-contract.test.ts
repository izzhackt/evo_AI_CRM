import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const migrationsDir = fileURLToPath(
  new URL('../../../../supabase/migrations/', import.meta.url)
);
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
const wahaManualOutboundMigration = readFileSync(
  join(migrationsDir, '033_waha_manual_outbound_status.sql'),
  'utf8'
);
const embeddingsScaleMigration = readFileSync(
  join(migrationsDir, '035_ai_embeddings_provider_and_scale.sql'),
  'utf8'
);
const reliableAmoCrmSyncMigration = readFileSync(
  join(migrationsDir, '036_reliable_amocrm_sync_buffer.sql'),
  'utf8'
);
const outboundAuditMigration = readFileSync(
  join(migrationsDir, '037_operator_drafts_and_waha_outbox.sql'),
  'utf8'
);
const platformGrantMigration = readFileSync(
  join(migrationsDir, '040_platform_namespaces_and_secret_containment.sql'),
  'utf8'
);
const platformIdentityMigration = readFileSync(
  join(migrationsDir, '041_platform_identity_rbac_audit.sql'),
  'utf8'
);
const platformAdmissionsMigration = readFileSync(
  join(migrationsDir, '042_platform_student_admissions.sql'),
  'utf8'
);
const platformDocumentsFinanceNotificationsMigration = readFileSync(
  join(migrationsDir, '043_platform_documents_finance_notifications.sql'),
  'utf8'
);
const platformCommunicationsMigration = readFileSync(
  join(migrationsDir, '044_platform_communications_contracts.sql'),
  'utf8'
);
const platformQueuesMigration = readFileSync(
  join(migrationsDir, '045_platform_durable_work_queues.sql'),
  'utf8'
);
const platformDocumentStorageMigration = readFileSync(
  join(migrationsDir, '046_platform_private_document_storage.sql'),
  'utf8'
);
const platformCurrentActorAuthorityMigration = readFileSync(
  join(migrationsDir, '047_platform_current_actor_authority.sql'),
  'utf8'
);
const platformCommunicationsReadAuthorityMigration = readFileSync(
  join(migrationsDir, '048_platform_communications_read_authority.sql'),
  'utf8'
);
const platformMessagingControllerHardeningMigration = readFileSync(
  join(
    migrationsDir,
    '050_platform_messaging_workflow_controller_hardening.sql'
  ),
  'utf8'
);
const platformBusinessWorkflowContractsMigration = readFileSync(
  join(migrationsDir, '051_platform_business_workflow_contracts.sql'),
  'utf8'
);
const platformWorkflowCaseBindingsMigration = readFileSync(
  join(migrationsDir, '052_platform_workflow_case_bindings.sql'),
  'utf8'
);
const platformStudentProfileRequirementsMigration = readFileSync(
  join(migrationsDir, '053_platform_student_profile_requirements.sql'),
  'utf8'
);
const platformDecisionPromptLifecycleMigration = readFileSync(
  join(migrationsDir, '054_platform_decision_prompt_lifecycle.sql'),
  'utf8'
);
const platformContractDraftReportMigration = readFileSync(
  join(migrationsDir, '057_platform_contract_draft_report.sql'),
  'utf8'
);
const platformAmoCrmMappingDiscoveryMigration = readFileSync(
  join(migrationsDir, '058_platform_amocrm_mapping_discovery.sql'),
  'utf8'
);
const platformWahaHistoryMigration = readFileSync(
  join(migrationsDir, '061_platform_waha_history_reconciliation.sql'),
  'utf8'
);
const platformWahaAckSessionRealtimeMigration = readFileSync(
  join(migrationsDir, '063_platform_waha_ack_session_realtime.sql'),
  'utf8'
);
const platformAmoCrmCanonicalContextMigration = readFileSync(
  join(migrationsDir, '064_platform_amocrm_canonical_context.sql'),
  'utf8'
);
const platformAiMemoryRetrievalMigration = readFileSync(
  join(migrationsDir, '065_platform_ai_memory_retrieval.sql'),
  'utf8'
);
const platformGeminiProposalsMigration = readFileSync(
  join(migrationsDir, '066_platform_gemini_proposals.sql'),
  'utf8'
);
const platformAutonomousRepliesMigration = readFileSync(
  join(migrationsDir, '067_platform_autonomous_inbound_replies.sql'),
  'utf8'
);
const platformStudentPortalNotificationsMigration = readFileSync(
  join(migrationsDir, '068_platform_student_portal_notifications.sql'),
  'utf8'
);
const platformStudentPortalOverdueNotificationsMigration = readFileSync(
  join(migrationsDir, '069_platform_student_portal_overdue_notifications.sql'),
  'utf8'
);
const platformPortalCrossDomainClosureMigration = readFileSync(
  join(migrationsDir, '070_platform_portal_cross_domain_closure.sql'),
  'utf8'
);
const platformAuditSearchExportMigration = readFileSync(
  join(migrationsDir, '071_platform_audit_search_export.sql'),
  'utf8'
);
const platformOperationalSignalsMigration = readFileSync(
  join(migrationsDir, '072_platform_operational_signals.sql'),
  'utf8'
);
const aiKnowledgeAudienceMigration = readFileSync(
  join(migrationsDir, '073_ai_knowledge_audience_isolation.sql'),
  'utf8'
);
const aiKnowledgeBundleSyncMigration = readFileSync(
  join(migrationsDir, '074_ai_knowledge_managed_bundle_sync.sql'),
  'utf8'
);
const aiAssistantAuditMigration = readFileSync(
  join(migrationsDir, '075_ai_assistant_immutable_audits.sql'),
  'utf8'
);
const platformOperationalSignalsAuthorizationTest = readFileSync(
  fileURLToPath(
    new URL(
      '../../../../supabase/tests/platform_observability_rls.sql',
      import.meta.url
    )
  ),
  'utf8'
);
const supabaseConfig = readFileSync(
  fileURLToPath(new URL('../../../../supabase/config.toml', import.meta.url)),
  'utf8'
);

function expectRlsEnabled(table: string) {
  expect(allMigrationsSql).toMatch(
    new RegExp(
      `ALTER\\s+TABLE\\s+${table}\\s+ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY`,
      'i'
    )
  );
}

function sqlProtectedRegionEnd(sql: string, start: number): number | null {
  if (sql.startsWith('--', start)) {
    const newline = sql.indexOf('\n', start + 2);
    return newline === -1 ? sql.length : newline + 1;
  }

  if (sql.startsWith('/*', start)) {
    let depth = 1;
    let cursor = start + 2;
    while (cursor < sql.length && depth > 0) {
      if (sql.startsWith('/*', cursor)) {
        depth += 1;
        cursor += 2;
      } else if (sql.startsWith('*/', cursor)) {
        depth -= 1;
        cursor += 2;
      } else {
        cursor += 1;
      }
    }
    return cursor;
  }

  const quote = sql[start];
  if (quote === "'" || quote === '"') {
    let cursor = start + 1;
    while (cursor < sql.length) {
      if (sql[cursor] === quote) {
        if (sql[cursor + 1] === quote) {
          cursor += 2;
          continue;
        }
        return cursor + 1;
      }
      cursor += 1;
    }
    return sql.length;
  }

  if (sql[start] === '$') {
    const tag = sql.slice(start).match(/^\$[A-Za-z0-9_]*\$/)?.[0];
    if (tag) {
      const end = sql.indexOf(tag, start + tag.length);
      return end === -1 ? sql.length : end + tag.length;
    }
  }

  return null;
}

function findMatchingParenthesis(sql: string, start: number): number {
  let depth = 0;
  for (let cursor = start; cursor < sql.length; cursor += 1) {
    const protectedEnd = sqlProtectedRegionEnd(sql, cursor);
    if (protectedEnd !== null) {
      cursor = protectedEnd - 1;
      continue;
    }
    if (sql[cursor] === '(') depth += 1;
    if (sql[cursor] === ')' && --depth === 0) return cursor;
  }
  throw new Error('Unbalanced SQL parenthesis in audit producer inventory');
}

function splitTopLevelSqlList(sql: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let depth = 0;
  for (let cursor = 0; cursor < sql.length; cursor += 1) {
    const protectedEnd = sqlProtectedRegionEnd(sql, cursor);
    if (protectedEnd !== null) {
      cursor = protectedEnd - 1;
      continue;
    }
    if ('([{'.includes(sql[cursor])) depth += 1;
    if (')]}'.includes(sql[cursor])) depth -= 1;
    if (sql[cursor] === ',' && depth === 0) {
      parts.push(sql.slice(start, cursor));
      start = cursor + 1;
    }
  }
  parts.push(sql.slice(start));
  return parts;
}

function findTopLevelFrom(sql: string, start: number): number {
  let depth = 0;
  for (let cursor = start; cursor < sql.length; cursor += 1) {
    const protectedEnd = sqlProtectedRegionEnd(sql, cursor);
    if (protectedEnd !== null) {
      cursor = protectedEnd - 1;
      continue;
    }
    if (sql[cursor] === '(') depth += 1;
    if (sql[cursor] === ')') depth -= 1;
    if (
      depth === 0 &&
      sql.slice(cursor, cursor + 4).toUpperCase() === 'FROM' &&
      !/[A-Za-z0-9_]/.test(sql[cursor - 1] ?? '') &&
      !/[A-Za-z0-9_]/.test(sql[cursor + 4] ?? '')
    ) {
      return cursor;
    }
  }
  throw new Error('Top-level FROM missing from audit producer INSERT');
}

function sqlTextLiterals(sql: string, pattern: RegExp): string[] {
  return [...sql.matchAll(/'((?:''|[^'])*)'/g)]
    .map((match) => match[1].replaceAll("''", "'"))
    .filter((value) => pattern.test(value));
}

function inventoryPreP7AuditProducerPairs() {
  const producerPairs = new Set<string>();
  const unresolved: string[] = [];
  const producerMigrationFiles = migrationFiles.filter((file) => {
    const sequence = Number.parseInt(file.slice(0, 3), 10);
    return sequence >= 41 && sequence <= 70;
  });

  for (const file of producerMigrationFiles) {
    const sql = readFileSync(join(migrationsDir, file), 'utf8');
    const actionVariables = new Map<string, string[]>();
    for (const variable of ['action_name', 'audit_action']) {
      const actions: string[] = [];
      const assignment = new RegExp(
        `\\b${variable}\\s*:=\\s*([\\s\\S]*?);`,
        'gi'
      );
      for (const match of sql.matchAll(assignment)) {
        actions.push(
          ...sqlTextLiterals(match[1], /^[a-z][a-z0-9]*(?:\.[a-z0-9]+)+$/)
        );
      }
      actionVariables.set(variable, actions);
    }

    const insert = /INSERT\s+INTO\s+platform\.audit_events\s*\(/gi;
    for (const match of sql.matchAll(insert)) {
      const columnsStart = match.index + match[0].lastIndexOf('(');
      const columnsEnd = findMatchingParenthesis(sql, columnsStart);
      const columns = splitTopLevelSqlList(
        sql.slice(columnsStart + 1, columnsEnd)
      ).map((column) => column.trim());
      let cursor = columnsEnd + 1;
      while (/\s/.test(sql[cursor] ?? '')) cursor += 1;

      let expressions: string[];
      if (sql.slice(cursor).match(/^VALUES\b/i)) {
        cursor += sql.slice(cursor).match(/^VALUES\b/i)![0].length;
        while (/\s/.test(sql[cursor] ?? '')) cursor += 1;
        const valuesEnd = findMatchingParenthesis(sql, cursor);
        expressions = splitTopLevelSqlList(sql.slice(cursor + 1, valuesEnd));
      } else if (sql.slice(cursor).match(/^SELECT\b/i)) {
        cursor += sql.slice(cursor).match(/^SELECT\b/i)![0].length;
        expressions = splitTopLevelSqlList(
          sql.slice(cursor, findTopLevelFrom(sql, cursor))
        );
      } else {
        unresolved.push(`${file}: unsupported INSERT source`);
        continue;
      }

      const actionExpression = expressions[columns.indexOf('action')];
      const resourceExpression = expressions[columns.indexOf('resource_type')];
      if (actionExpression === undefined || resourceExpression === undefined) {
        unresolved.push(`${file}: action/resource column missing`);
        continue;
      }
      let actions = sqlTextLiterals(
        actionExpression,
        /^[a-z][a-z0-9]*(?:\.[a-z0-9]+)+$/
      );
      if (actions.length === 0) {
        const variable = actionExpression
          .trim()
          .match(/^(action_name|audit_action)(?:::\w+)?$/i)?.[1]
          ?.toLowerCase();
        if (variable) actions = actionVariables.get(variable) ?? [];
      }
      const resources = sqlTextLiterals(
        resourceExpression,
        /^[a-z][a-z0-9_]*$/
      );
      if (actions.length === 0 || resources.length === 0) {
        unresolved.push(`${file}: unresolved action/resource expression`);
        continue;
      }
      for (const action of new Set(actions)) {
        for (const resource of new Set(resources)) {
          producerPairs.add(`${action}|${resource}`);
        }
      }
    }
  }

  return { producerPairs, unresolved };
}

function p7aAllowlist(functionName: string): Set<string> {
  const body = platformAuditSearchExportMigration.match(
    new RegExp(
      `FUNCTION\\s+platform_private\\.${functionName}\\(\\)[\\s\\S]*?SELECT\\s+ARRAY\\[([\\s\\S]*?)\\]::TEXT\\[\\]`,
      'i'
    )
  )?.[1];
  if (!body) throw new Error(`P7A allowlist function missing: ${functionName}`);
  return new Set(sqlTextLiterals(body, /./));
}

describe('Supabase companion schema contract', () => {
  it('preserves containment through the current platform migration boundary', () => {
    expect(migrationFiles.at(-1)).toBe('075_ai_assistant_immutable_audits.sql');
    expect(platformOperationalSignalsMigration).toMatch(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+platform\.platform_operational_signals_v1\s*\(\s*p_request_id\s+UUID\s*\)\s*RETURNS\s+JSONB[\s\S]*?SECURITY\s+DEFINER[\s\S]*?SET\s+search_path\s*=\s*''[\s\S]*?SET\s+statement_timeout\s*=\s*'3000ms'[\s\S]*?SET\s+lock_timeout\s*=\s*'1000ms'/i
    );
    expect(platformOperationalSignalsMigration).toMatch(
      /ALTER\s+FUNCTION\s+platform\.platform_operational_signals_v1\s*\(\s*UUID\s*\)\s+OWNER\s+TO\s+postgres/i
    );
    expect(platformOperationalSignalsMigration).toMatch(
      /REVOKE\s+ALL\s+ON\s+FUNCTION\s+platform\.platform_operational_signals_v1\s*\(\s*UUID\s*\)\s+FROM\s+PUBLIC,\s*anon,\s*authenticated,\s*service_role,\s*supabase_auth_admin/i
    );
    expect(platformOperationalSignalsMigration).toMatch(
      /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+platform\.platform_operational_signals_v1\s*\(\s*UUID\s*\)\s+TO\s+service_role/i
    );
    expect(platformOperationalSignalsMigration).not.toMatch(
      /GRANT\s+(?:SELECT|INSERT|UPDATE|DELETE|ALL)[\s\S]*?(?:platform_private\.(?:durable_work|messaging_integration_health|waha_media_archive|autonomous_reply)|platform\.(?:work_review_cases|audit_events))/i
    );
    expect(platformOperationalSignalsMigration).toMatch(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+platform_private\.p7b_observability_clock\s*\(\s*\)[\s\S]*?SELECT\s+pg_catalog\.statement_timestamp\s*\(\s*\)/i
    );
    expect(platformOperationalSignalsMigration).toMatch(
      /REVOKE\s+ALL\s+ON\s+FUNCTION\s+platform_private\.p7b_observability_clock\s*\(\s*\)\s+FROM\s+PUBLIC,\s*anon,\s*authenticated,\s*service_role,\s*supabase_auth_admin/i
    );
    expect(
      platformOperationalSignalsMigration.match(/LIMIT\s+1000001/gi)
    ).toHaveLength(16);
    for (const indexContract of [
      /CREATE\s+INDEX\s+durable_work_items_p7b_ready_idx\s+ON\s+platform_private\.durable_work_items\s*\(\s*organization_id,\s*available_at,\s*id\s*\)\s*WHERE\s+state\s*=\s*'queued'/i,
      /CREATE\s+INDEX\s+durable_work_items_p7b_retry_wait_idx\s+ON\s+platform_private\.durable_work_items\s*\(\s*organization_id,\s*updated_at,\s*id\s*\)\s*WHERE\s+state\s*=\s*'retry_wait'/i,
      /CREATE\s+INDEX\s+durable_work_items_p7b_leased_idx\s+ON\s+platform_private\.durable_work_items\s*\(\s*organization_id,\s*id\s*\)\s*WHERE\s+state\s*=\s*'leased'/i,
      /CREATE\s+INDEX\s+durable_work_items_p7b_expired_lease_idx\s+ON\s+platform_private\.durable_work_items\s*\(\s*organization_id,\s*leased_until,\s*id\s*\)\s*WHERE\s+state\s*=\s*'leased'\s+AND\s+leased_until\s+IS\s+NOT\s+NULL/i,
      /CREATE\s+INDEX\s+waha_media_archive_work_p7b_state_idx\s+ON\s+platform_private\.waha_media_archive_work\s*\(\s*organization_id,\s*state,\s*id\s*\)\s*WHERE\s+state\s*<>\s*'archived'/i,
      /CREATE\s+INDEX\s+waha_media_archive_work_p7b_oldest_idx\s+ON\s+platform_private\.waha_media_archive_work\s*\(\s*organization_id,\s*created_at,\s*id\s*\)\s*WHERE\s+state\s*<>\s*'archived'/i,
      /CREATE\s+INDEX\s+autonomous_reply_lifecycle_p7b_state_time_idx\s+ON\s+platform_private\.autonomous_reply_intent_lifecycle\s*\(\s*organization_id,\s*state,\s*created_at,\s*id,\s*intent_id\s*\)/i,
    ]) {
      expect(platformOperationalSignalsMigration).toMatch(indexContract);
    }
    for (const operationalSource of [
      'durable_work_items',
      'durable_work_dead_letters',
      'work_review_cases',
      'waha_media_archive_work',
      'autonomous_reply_intent_lifecycle',
    ]) {
      expect(platformOperationalSignalsMigration).toMatch(
        new RegExp(
          `applicable_organization_ids[\\s\\S]*?${operationalSource}`,
          'i'
        )
      );
    }
    expect(platformAuditSearchExportMigration).toMatch(
      /DROP\s+POLICY\s+IF\s+EXISTS\s+audit_events_read\s+ON\s+platform\.audit_events/i
    );
    expect(platformAuditSearchExportMigration).toMatch(
      /REVOKE\s+ALL\s+ON\s+TABLE\s+platform\.audit_events\s+FROM\s+PUBLIC,\s*anon,\s*authenticated,\s*service_role,\s*supabase_auth_admin/i
    );
    expect(platformAuditSearchExportMigration).not.toMatch(
      /GRANT\s+SELECT\s+ON(?:\s+TABLE)?[\s\S]*?platform\.audit_events/i
    );
    expect(platformAuditSearchExportMigration).toMatch(
      /CREATE\s+INDEX\s+audit_events_org_resource_created_id_idx\s+ON\s+platform\.audit_events\s*\(\s*organization_id,\s*resource_id,\s*created_at\s+DESC,\s*id\s+DESC\s*\)/i
    );
    expect(platformAuditSearchExportMigration).toMatch(
      /CREATE\s+TABLE\s+platform_private\.audit_export_replays/i
    );
    for (const rlsMode of ['ENABLE', 'FORCE']) {
      expect(platformAuditSearchExportMigration).toMatch(
        new RegExp(
          `ALTER\\s+TABLE\\s+platform_private\\.audit_export_replays\\s+${rlsMode}\\s+ROW\\s+LEVEL\\s+SECURITY`,
          'i'
        )
      );
    }
    expect(platformAuditSearchExportMigration).toMatch(
      /REVOKE\s+ALL\s+ON\s+TABLE\s+platform_private\.audit_export_replays\s+FROM\s+PUBLIC,\s*anon,\s*authenticated,\s*service_role,\s*supabase_auth_admin/i
    );
    expect(platformAuditSearchExportMigration).not.toMatch(
      /CREATE\s+POLICY[\s\S]*?ON\s+platform_private\.audit_export_replays/i
    );
    for (const rpc of ['search_audit_events', 'export_audit_events']) {
      expect(platformAuditSearchExportMigration).toMatch(
        new RegExp(
          `CREATE\\s+OR\\s+REPLACE\\s+FUNCTION\\s+platform\\.${rpc}\\s*\\([\\s\\S]*?SECURITY\\s+DEFINER[\\s\\S]*?SET\\s+search_path\\s*=\\s*''`,
          'i'
        )
      );
      expect(platformAuditSearchExportMigration).toMatch(
        new RegExp(
          `REVOKE\\s+ALL\\s+ON\\s+FUNCTION\\s+platform\\.${rpc}\\s*\\([\\s\\S]*?FROM\\s+PUBLIC,\\s*anon,\\s*authenticated,\\s*service_role,\\s*supabase_auth_admin`,
          'i'
        )
      );
      expect(platformAuditSearchExportMigration).toMatch(
        new RegExp(
          `GRANT\\s+EXECUTE\\s+ON\\s+FUNCTION\\s+platform\\.${rpc}\\s*\\([\\s\\S]*?TO\\s+authenticated`,
          'i'
        )
      );
    }
    for (const table of [
      'waha_history_reconciliation_runs',
      'waha_history_reconciliation_lifecycle',
      'waha_history_reconciliation_requests',
      'waha_history_message_observations',
      'waha_history_projection_effects',
      'waha_history_reconciliation_checkpoints',
    ]) {
      expect(platformWahaHistoryMigration).toMatch(
        new RegExp(`CREATE\\s+TABLE\\s+platform_private\\.${table}`, 'i')
      );
      expect(platformWahaHistoryMigration).toMatch(
        new RegExp(
          `ALTER\\s+TABLE\\s+platform_private\\.${table}\\s+ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY`,
          'i'
        )
      );
      expect(platformWahaHistoryMigration).toMatch(
        new RegExp(
          `ALTER\\s+TABLE\\s+platform_private\\.${table}\\s+FORCE\\s+ROW\\s+LEVEL\\s+SECURITY`,
          'i'
        )
      );
      expect(platformWahaHistoryMigration).toMatch(
        new RegExp(
          `REVOKE\\s+ALL\\s+ON\\s+TABLE[\\s\\S]*?platform_private\\.${table}[\\s\\S]*?FROM\\s+PUBLIC,\\s*anon,\\s*authenticated,\\s*service_role,\\s*supabase_auth_admin`,
          'i'
        )
      );
    }
    for (const rpc of [
      'begin_waha_history_reconciliation',
      'project_waha_history_page',
      'finish_waha_history_reconciliation',
    ]) {
      expect(platformWahaHistoryMigration).toMatch(
        new RegExp(
          `REVOKE\\s+ALL\\s+ON\\s+FUNCTION[\\s\\S]*?platform\\.${rpc}\\s*\\([\\s\\S]*?FROM\\s+PUBLIC,\\s*anon,\\s*authenticated,\\s*service_role,\\s*supabase_auth_admin`,
          'i'
        )
      );
      expect(platformWahaHistoryMigration).toMatch(
        new RegExp(
          `GRANT\\s+EXECUTE\\s+ON\\s+FUNCTION[\\s\\S]*?platform\\.${rpc}\\s*\\([\\s\\S]*?TO\\s+service_role`,
          'i'
        )
      );
    }
    expect(platformWahaAckSessionRealtimeMigration).toMatch(
      /CREATE\s+TABLE\s+platform\.waha_session_health/i
    );
    expect(platformWahaAckSessionRealtimeMigration).toMatch(
      /ALTER\s+TABLE\s+platform\.waha_session_health\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/i
    );
    for (const table of [
      'waha_ack_observations',
      'waha_session_observations',
      'waha_event_projection_effects',
      'waha_event_projection_requests',
    ]) {
      expect(platformWahaAckSessionRealtimeMigration).toMatch(
        new RegExp(`CREATE\\s+TABLE\\s+platform_private\\.${table}`, 'i')
      );
      expect(platformWahaAckSessionRealtimeMigration).toMatch(
        new RegExp(
          `ALTER\\s+TABLE\\s+platform_private\\.${table}\\s+ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY`,
          'i'
        )
      );
      expect(platformWahaAckSessionRealtimeMigration).toMatch(
        new RegExp(
          `ALTER\\s+TABLE\\s+platform_private\\.${table}\\s+FORCE\\s+ROW\\s+LEVEL\\s+SECURITY`,
          'i'
        )
      );
    }
    expect(platformWahaAckSessionRealtimeMigration).toMatch(
      /CREATE\s+POLICY\s+platform_messaging_broadcast_read\s+ON\s+realtime\.messages\s+FOR\s+SELECT\s+TO\s+authenticated/i
    );
    expect(platformWahaAckSessionRealtimeMigration).toMatch(
      /REVOKE\s+INSERT,\s*UPDATE,\s*DELETE,\s*TRUNCATE\s+ON\s+TABLE\s+realtime\.messages\s+FROM\s+PUBLIC,\s*anon,\s*authenticated/i
    );
    expect(platformWahaAckSessionRealtimeMigration).not.toMatch(
      /CREATE\s+POLICY[\s\S]{0,160}\s+ON\s+realtime\.messages\s+FOR\s+INSERT\s+TO\s+authenticated/i
    );
    expect(platformGrantMigration).toMatch(
      /CREATE\s+SCHEMA\s+IF\s+NOT\s+EXISTS\s+platform\s+AUTHORIZATION\s+postgres/i
    );
    expect(platformGrantMigration).toMatch(
      /CREATE\s+SCHEMA\s+IF\s+NOT\s+EXISTS\s+platform_private\s+AUTHORIZATION\s+postgres/i
    );
    expect(platformGrantMigration).not.toMatch(/CREATE\s+TABLE/i);
    expect(platformGrantMigration).toMatch(
      /GRANT\s+USAGE\s+ON\s+SCHEMA\s+platform\s+TO\s+authenticated,\s*service_role/i
    );
    expect(platformGrantMigration).toMatch(
      /REVOKE\s+ALL\s+PRIVILEGES\s+ON\s+SCHEMA\s+platform_private\s+FROM\s+PUBLIC,\s*anon,\s*authenticated,\s*service_role/i
    );
    expect(platformIdentityMigration).toMatch(
      /CREATE\s+TYPE\s+platform\.business_role\s+AS\s+ENUM\s*\(\s*'admin',\s*'sales',\s*'curator',\s*'finance',\s*'student'\s*\)/i
    );
    expect(platformDecisionPromptLifecycleMigration).toMatch(
      /CREATE\s+TABLE\s+platform_private\.ai_prompt_artifact_versions/i
    );
    expect(platformAmoCrmMappingDiscoveryMigration).toMatch(
      /CREATE\s+TABLE\s+platform_private\.amocrm_mapping_discovery_versions/i
    );
    expect(platformAmoCrmMappingDiscoveryMigration).toMatch(
      /ALTER\s+TABLE\s+platform_private\.amocrm_mapping_discovery_versions\s+FORCE\s+ROW\s+LEVEL\s+SECURITY/i
    );
    expect(platformAmoCrmMappingDiscoveryMigration).toMatch(
      /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+platform\.persist_amocrm_mapping_discovery[\s\S]*?TO\s+service_role/i
    );
    expect(platformAmoCrmMappingDiscoveryMigration).not.toMatch(
      /GRANT\s+(?:SELECT|INSERT|UPDATE|DELETE)[\s\S]*?amocrm_mapping_discovery_versions/i
    );
    expect(platformDecisionPromptLifecycleMigration).toMatch(
      /CREATE\s+TABLE\s+platform\.decision_backlogs/i
    );
    expect(platformDecisionPromptLifecycleMigration).toMatch(
      /ALTER\s+TABLE\s+platform\.decision_backlogs\s+FORCE\s+ROW\s+LEVEL\s+SECURITY/i
    );
    for (const table of [
      'contract_template_versions',
      'student_case_contract_drafts',
      'post_contract_items',
      'post_contract_reports',
    ]) {
      expect(platformContractDraftReportMigration).toMatch(
        new RegExp(`CREATE\\s+TABLE\\s+platform\\.${table}`, 'i')
      );
      expect(platformContractDraftReportMigration).toMatch(
        new RegExp(
          `ALTER\\s+TABLE\\s+platform\\.${table}\\s+ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY`,
          'i'
        )
      );
      expect(platformContractDraftReportMigration).toMatch(
        new RegExp(
          `ALTER\\s+TABLE\\s+platform\\.${table}\\s+FORCE\\s+ROW\\s+LEVEL\\s+SECURITY`,
          'i'
        )
      );
    }
    for (const rpc of [
      'create_contract_template_version',
      'approve_contract_template_version',
      'retire_contract_template_version',
      'generate_student_case_contract_draft',
      'review_student_case_contract_draft',
      'seed_post_contract_items',
      'update_post_contract_item',
      'generate_post_contract_report',
      'review_post_contract_report',
      'staff_case_contract_workspace',
    ]) {
      expect(platformContractDraftReportMigration).toMatch(
        new RegExp(
          `CREATE\\s+OR\\s+REPLACE\\s+FUNCTION\\s+platform\\.${rpc}`,
          'i'
        )
      );
    }
    expect(platformContractDraftReportMigration).toMatch(
      /INSERT\s+INTO\s+platform\.role_bundle_versions[\s\S]*'admin',\s*11[\s\S]*'student',\s*11/i
    );
    expect(platformIdentityMigration).toMatch(
      /CREATE\s+TABLE\s+platform\.organization_memberships/i
    );
    for (const table of [
      'source_registry',
      'workflow_contracts',
      'workflow_contract_versions',
      'workflow_contract_version_sources',
    ]) {
      expect(platformBusinessWorkflowContractsMigration).toMatch(
        new RegExp(
          `CREATE\\s+TABLE(?:\\s+IF\\s+NOT\\s+EXISTS)?\\s+platform\\.${table}`,
          'i'
        )
      );
      expect(platformBusinessWorkflowContractsMigration).toMatch(
        new RegExp(
          `ALTER\\s+TABLE\\s+platform\\.${table}\\s+FORCE\\s+ROW\\s+LEVEL\\s+SECURITY`,
          'i'
        )
      );
    }
    expect(platformBusinessWorkflowContractsMigration).not.toMatch(
      /ALTER\s+TABLE\s+platform\.student_cases/i
    );
    expect(platformWorkflowCaseBindingsMigration).toMatch(
      /ALTER\s+TABLE\s+platform\.student_cases[\s\S]*ADD\s+COLUMN\s+applied_ozo_workflow_contract_version_id\s+UUID/i
    );
    expect(platformWorkflowCaseBindingsMigration).toMatch(
      /CREATE\s+TABLE\s+platform\.student_case_op_handoffs/i
    );
    expect(platformWorkflowCaseBindingsMigration).toMatch(
      /ALTER\s+TABLE\s+platform\.student_case_op_handoffs\s+FORCE\s+ROW\s+LEVEL\s+SECURITY/i
    );
    for (const rpc of [
      'create_pending_student_case_with_handoff',
      'staff_op_workflow_contract',
      'staff_student_case_queue',
      'staff_student_case_snapshot',
      'staff_application_queue',
      'staff_application_snapshot',
    ]) {
      expect(platformWorkflowCaseBindingsMigration).toMatch(
        new RegExp(
          `CREATE\\s+OR\\s+REPLACE\\s+FUNCTION\\s+platform\\.${rpc}\\s*\\(`,
          'i'
        )
      );
    }
    expect(platformWorkflowCaseBindingsMigration).not.toMatch(
      /CREATE\s+TABLE\s+platform\.(?:leads?|contacts?|sales_pipeline)/i
    );
    for (const table of [
      'student_profiles',
      'country_requirement_versions',
      'country_requirement_version_sources',
    ]) {
      expect(platformStudentProfileRequirementsMigration).toMatch(
        new RegExp(`CREATE\\s+TABLE\\s+platform\\.${table}`, 'i')
      );
      expect(platformStudentProfileRequirementsMigration).toMatch(
        new RegExp(
          `ALTER\\s+TABLE\\s+platform\\.${table}\\s+FORCE\\s+ROW\\s+LEVEL\\s+SECURITY`,
          'i'
        )
      );
    }
    expect(platformStudentProfileRequirementsMigration).toMatch(
      /ALTER\s+TABLE\s+platform\.student_cases[\s\S]*ADD\s+COLUMN\s+applied_country_requirement_version_id\s+UUID/i
    );
    for (const rpc of [
      'create_country_requirement_version',
      'link_country_requirement_version_source',
      'approve_country_requirement_version',
      'retire_country_requirement_version',
      'apply_country_requirement_version',
      'upsert_student_profile',
      'staff_student_profile_snapshot',
      'staff_student_case_documents',
      'staff_country_requirement_versions_for_case',
      'student_portal_profile',
    ]) {
      expect(platformStudentProfileRequirementsMigration).toMatch(
        new RegExp(
          `CREATE\\s+OR\\s+REPLACE\\s+FUNCTION\\s+platform\\.${rpc}\\s*\\(`,
          'i'
        )
      );
    }
    expect(platformStudentProfileRequirementsMigration).toMatch(
      /CREATE\s+TRIGGER\s+document_requirements_approved_manifest_guard[\s\S]*BEFORE\s+INSERT\s+OR\s+UPDATE\s+OR\s+DELETE\s+ON\s+platform\.document_requirements/i
    );
    expect(platformStudentProfileRequirementsMigration).not.toMatch(
      /CREATE\s+TABLE\s+platform\.(?:checklists?|documents?)(?:\s|\()/i
    );
    expect(platformIdentityMigration).toMatch(
      /ALTER\s+TABLE\s+platform\.organization_memberships\s+FORCE\s+ROW\s+LEVEL\s+SECURITY/i
    );
    expect(platformIdentityMigration).toMatch(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+platform_private\.custom_access_token_hook\s*\(\s*event\s+JSONB\s*\)[\s\S]*SECURITY\s+INVOKER/i
    );
    expect(platformIdentityMigration).toMatch(
      /RETURN\s+jsonb_build_object\s*\(\s*'claims',\s*claims\s*\)/i
    );
    expect(supabaseConfig).toMatch(
      /schemas\s*=\s*\["public",\s*"platform",\s*"graphql_public"\]/
    );
    expect(platformCurrentActorAuthorityMigration).toMatch(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+platform\.current_actor_authority\s*\(\s*\)/i
    );
    expect(platformCurrentActorAuthorityMigration).toMatch(
      /REVOKE\s+ALL\s+ON\s+FUNCTION\s+platform\.current_actor_authority\s*\(\s*\)\s+FROM\s+PUBLIC,\s*anon,\s*authenticated,\s*service_role,\s*supabase_auth_admin/i
    );
    expect(platformCurrentActorAuthorityMigration).toMatch(
      /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+platform\.current_actor_authority\s*\(\s*\)\s+TO\s+authenticated/i
    );
    expect(platformCommunicationsReadAuthorityMigration).toMatch(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+platform_private\.require_domain_actor_read\s*\(\s*p_organization_id\s+UUID,\s*p_permission_key\s+TEXT\s*\)[\s\S]*STABLE[\s\S]*SECURITY\s+DEFINER/i
    );
    expect(platformCommunicationsReadAuthorityMigration).toMatch(
      /REVOKE\s+ALL\s+ON\s+FUNCTION\s+platform_private\.require_domain_actor_read\s*\(\s*UUID,\s*TEXT\s*\)\s+FROM\s+PUBLIC,\s*anon,\s*authenticated,\s*service_role,\s*supabase_auth_admin/i
    );
    expect(platformCommunicationsReadAuthorityMigration).toMatch(
      /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+platform\.staff_communication_queue\s*\(\s*UUID\s*\),\s*platform\.staff_conversation_messages\s*\(\s*UUID,\s*UUID\s*\)\s+TO\s+authenticated/i
    );
    expect(supabaseConfig).not.toMatch(
      /schemas\s*=.*(?:platform_private|pgmq_public)/
    );
  });

  it('enforces account-scoped client and internal knowledge audiences', () => {
    expect(aiKnowledgeAudienceMigration).toMatch(
      /ALTER\s+TABLE\s+public\.ai_knowledge_documents[\s\S]*ADD\s+COLUMN\s+audience\s+TEXT\s+NOT\s+NULL\s+DEFAULT\s+'internal'[\s\S]*CHECK\s*\(audience\s+IN\s*\('client',\s*'internal'\)\)/i
    );
    expect(aiKnowledgeAudienceMigration).toMatch(
      /FOREIGN\s+KEY\s*\(document_id,\s*account_id,\s*audience\)[\s\S]*REFERENCES\s+public\.ai_knowledge_documents\s*\(id,\s*account_id,\s*audience\)/i
    );
    expect(aiKnowledgeAudienceMigration).toMatch(
      /CREATE\s+POLICY\s+ai_knowledge_documents_select[\s\S]*private\.is_account_member\s*\(account_id,\s*'agent'\)/i
    );
    expect(aiKnowledgeAudienceMigration).toMatch(
      /CREATE\s+POLICY\s+ai_knowledge_documents_insert[\s\S]*audience\s*=\s*'internal'[\s\S]*private\.is_account_member\s*\(account_id,\s*'admin'\)/i
    );
    expect(aiKnowledgeAudienceMigration).toMatch(
      /CREATE\s+FUNCTION\s+public\.match_ai_knowledge_fts\s*\(\s*p_account_id\s+UUID,\s*p_audience\s+TEXT,[\s\S]*SECURITY\s+INVOKER[\s\S]*chunk\.audience\s*=\s*p_audience/i
    );
    expect(aiKnowledgeAudienceMigration).toMatch(
      /CREATE\s+FUNCTION\s+public\.match_ai_knowledge_semantic\s*\(\s*p_account_id\s+UUID,\s*p_audience\s+TEXT,[\s\S]*SECURITY\s+INVOKER[\s\S]*chunk\.audience\s*=\s*p_audience/i
    );
  });

  it('keeps managed Obsidian synchronization atomic and service-role-only', () => {
    expect(aiKnowledgeBundleSyncMigration).toMatch(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.sync_ai_knowledge_bundle[\s\S]*SECURITY\s+DEFINER[\s\S]*SET\s+search_path\s*=\s*''/i
    );
    expect(aiKnowledgeBundleSyncMigration).toMatch(
      /pg_advisory_xact_lock\s*\(\s*hashtextextended\s*\(p_account_id::TEXT\s*\|\|\s*chr\(31\)\s*\|\|\s*p_audience,\s*0\)\s*\)/i
    );
    expect(aiKnowledgeBundleSyncMigration).toMatch(
      /REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.sync_ai_knowledge_bundle\(UUID,\s*TEXT,\s*TEXT,\s*JSONB\)\s+FROM\s+PUBLIC,\s*anon,\s*authenticated,\s*service_role/i
    );
    expect(aiKnowledgeBundleSyncMigration).toMatch(
      /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.sync_ai_knowledge_bundle\(UUID,\s*TEXT,\s*TEXT,\s*JSONB\)\s+TO\s+service_role/i
    );
    expect(aiKnowledgeBundleSyncMigration).toMatch(
      /source_path'\s*<>\s*normalize\(v_document->>'source_path',\s*NFC\)/i
    );
    expect(aiKnowledgeBundleSyncMigration).toMatch(
      /Сырой архив ЭВО\|Секреты и доступы ЭВО/
    );
    expect(aiKnowledgeBundleSyncMigration).not.toMatch(
      /CREATE\s+EXTENSION\s+.*pgcrypto/i
    );
  });

  it('stores immutable body-free assistant audits for ninety days', () => {
    expect(aiAssistantAuditMigration).toMatch(
      /CREATE\s+TABLE\s+public\.ai_assistant_audits/i
    );
    expect(aiAssistantAuditMigration).toMatch(
      /expires_at[\s\S]*created_at\s*\+\s*interval\s*'90 days'/i
    );
    expect(aiAssistantAuditMigration).toMatch(
      /CREATE\s+POLICY\s+ai_assistant_audits_select[\s\S]*private\.is_account_member\(account_id,\s*'agent'\)/i
    );
    expect(aiAssistantAuditMigration).toMatch(
      /GRANT\s+SELECT,\s*INSERT,\s*DELETE[\s\S]*TO\s+service_role/i
    );
    expect(aiAssistantAuditMigration).not.toMatch(
      /response_body|message_body|content_text/i
    );
  });

  it('keeps new P7B runtime evidence explicitly non-provider', () => {
    expect(platformOperationalSignalsAuthorizationTest).not.toMatch(
      /provider_observed/i
    );
    expect(platformOperationalSignalsAuthorizationTest).toMatch(
      /local_non_provider/i
    );
  });

  it('classifies every pre-P7A audit producer as projected or intentionally private', () => {
    const requiredBusinessPairs = [
      'ai.draft.language.resolve|ai_draft',
      'ai.draft.request.knowledge|ai_draft_request_knowledge_selection',
      'catalog.import.batch.create|catalog_import_batch',
      'catalog.import.batch.review|catalog_import_batch',
      'catalog.import.batch.validate|catalog_import_batch',
      'catalog.import.candidate.stage|catalog_import_candidate',
      'communication.waha.history.pause|waha_history_reconciliation_run',
      'contract.draft.generate|student_case_contract_draft',
      'contract.draft.review|student_case_contract_draft',
      'contract.template.version.approve|contract_template_version',
      'contract.template.version.create|contract_template_version',
      'contract.template.version.retire|contract_template_version',
      'country.requirement.apply|student_case',
      'country.requirement.source.link|country_requirement_version_source',
      'country.requirement.version.approve|country_requirement_version',
      'country.requirement.version.create|country_requirement_version',
      'country.requirement.version.retire|country_requirement_version',
      'decision.backlog.create|decision_backlog',
      'decision.backlog.transition|decision_backlog',
      'knowledge.chunkset.publish|approved_knowledge_chunk_set',
      'knowledge.version.publish|approved_knowledge_version',
      'knowledge.version.retire|approved_knowledge_version',
      'post.contract.item.update|post_contract_item',
      'post.contract.items.seed|post_contract_item_set',
      'post.contract.report.generate|post_contract_report',
      'post.contract.report.review|post_contract_report',
      'workflow.contract.create|workflow_contract',
      'workflow.source.link|workflow_contract_version_source',
      'workflow.source.register|source_registry',
      'workflow.source.retire|source_registry',
      'workflow.source.review|source_registry',
      'workflow.version.approve|workflow_contract_version',
      'workflow.version.create|workflow_contract_version',
      'workflow.version.retire|workflow_contract_version',
    ];
    const intentionallyPrivatePairs = [
      'communication.webhook.persist|provider_webhook_event',
      'integration.amocrm.mapping.discovery.persist|amocrm_mapping_discovery_version',
      'media.archive.claim|communication_media',
      'media.archive.finish|communication_media',
      'media.download.consume|communication_media',
      'media.download.grant|communication_media',
      'prompt.artifact.publish|ai_prompt_artifact_version',
      'prompt.artifact.retire|ai_prompt_artifact_version',
      'work.claim|durable_work_item',
      'work.conflict.review|durable_work_item',
      'work.dead.letter|durable_work_item',
      'work.enqueue.deduplicate|durable_work_item',
      'work.enqueue|durable_work_item',
      'work.lease.extend|durable_work_item',
      'work.retry.schedule|durable_work_item',
      'work.review.resolve|work_review_case',
      'work.succeed|durable_work_item',
      'work.unknown.review|durable_work_item',
    ];
    const reviewedOmissions = new Set([
      ...requiredBusinessPairs,
      ...intentionallyPrivatePairs,
    ]);
    const { producerPairs, unresolved } = inventoryPreP7AuditProducerPairs();
    const sortedProducerPairs = [...producerPairs].sort();
    const safeActions = p7aAllowlist('p7a_safe_audit_actions');
    const safeResources = p7aAllowlist('p7a_safe_audit_resource_types');
    const isProjected = (pair: string) => {
      const [action, resource] = pair.split('|');
      return safeActions.has(action) && safeResources.has(resource);
    };

    expect(unresolved).toEqual([]);
    expect(sortedProducerPairs).toHaveLength(112);
    expect(
      createHash('sha256').update(sortedProducerPairs.join('\n')).digest('hex')
    ).toBe('d3a2d42e476d64e5cb96950312b0a969276ab8bd06828aaa166ecce8c1297a2a');
    expect(requiredBusinessPairs).toHaveLength(34);
    expect(intentionallyPrivatePairs).toHaveLength(18);
    expect(reviewedOmissions.size).toBe(52);
    expect(
      [...reviewedOmissions].filter((pair) => !producerPairs.has(pair))
    ).toEqual([]);
    expect(requiredBusinessPairs.filter((pair) => !isProjected(pair))).toEqual(
      []
    );
    expect(intentionallyPrivatePairs.filter(isProjected)).toEqual([]);
    expect(
      sortedProducerPairs.filter(
        (pair) =>
          !isProjected(pair) && !intentionallyPrivatePairs.includes(pair)
      )
    ).toEqual([]);
    expect(sortedProducerPairs.filter(isProjected)).toHaveLength(94);
  });

  it('keeps P6B Student Portal notifications in-app-only and actor-derived', () => {
    expect(platformStudentPortalNotificationsMigration).toMatch(
      /CREATE\s+TABLE\s+platform\.student_portal_notification_projection_v1/i
    );
    expect(platformStudentPortalNotificationsMigration).toMatch(
      /ALTER\s+TABLE\s+platform\.student_portal_notification_projection_v1\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/i
    );
    expect(platformStudentPortalNotificationsMigration).toMatch(
      /ALTER\s+TABLE\s+platform\.student_portal_notification_projection_v1\s+FORCE\s+ROW\s+LEVEL\s+SECURITY/i
    );
    expect(platformStudentPortalNotificationsMigration).toMatch(
      /CREATE\s+TABLE\s+platform_private\.student_portal_notification_runtime_controls\s*\([\s\S]*?organization_id\s+UUID\s+PRIMARY\s+KEY[\s\S]*?enabled\s+BOOLEAN\s+NOT\s+NULL\s+DEFAULT\s+FALSE[\s\S]*?updated_at\s+TIMESTAMPTZ\s+NOT\s+NULL\s+DEFAULT\s+statement_timestamp\s*\(\s*\)/i
    );
    expect(platformStudentPortalNotificationsMigration).toMatch(
      /ALTER\s+TABLE\s+platform_private\.student_portal_notification_runtime_controls\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY[\s\S]*?ALTER\s+TABLE\s+platform_private\.student_portal_notification_runtime_controls\s+FORCE\s+ROW\s+LEVEL\s+SECURITY/i
    );
    expect(platformStudentPortalNotificationsMigration).toMatch(
      /ALTER\s+FUNCTION\s+platform\.review_document_version\s*\(\s*UUID,\s*UUID,\s*platform\.document_review_decision,\s*TEXT,\s*UUID\s*\)\s+SET\s+SCHEMA\s+platform_private[\s\S]*?ALTER\s+FUNCTION\s+platform_private\.review_document_version\s*\(\s*UUID,\s*UUID,\s*platform\.document_review_decision,\s*TEXT,\s*UUID\s*\)\s+RENAME\s+TO\s+review_document_version_legacy_043/i
    );
    expect(platformStudentPortalNotificationsMigration).toMatch(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+platform\.review_document_version_with_portal_notification_v1\s*\(\s*p_organization_id\s+UUID,\s*p_document_version_id\s+UUID,\s*p_decision\s+platform\.document_review_decision,\s*p_reason\s+TEXT,\s*p_request_id\s+UUID\s*\)[\s\S]*?platform_private\.student_portal_notification_runtime_controls[\s\S]*?platform_private\.review_document_version_legacy_043/i
    );
    expect(platformStudentPortalNotificationsMigration).toMatch(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+platform\.review_document_version\s*\([\s\S]*?set_config\s*\(\s*'platform_private\.p6b_portal_notification_context',\s*''[\s\S]*?platform_private\.review_document_version_legacy_043/i
    );
    expect(platformStudentPortalNotificationsMigration).toMatch(
      /current_setting\s*\(\s*'platform_private\.p6b_portal_notification_context',\s*TRUE\s*\)[\s\S]*?set_config\s*\(\s*'platform_private\.p6b_portal_notification_context'/i
    );
    expect(platformStudentPortalNotificationsMigration).toMatch(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+platform\.student_portal_notifications_v1\s*\(\s*\)[\s\S]*?RETURNS\s+TABLE\s*\(\s*notification_id\s+UUID,\s*category\s+TEXT,\s*review_decision\s+platform\.document_review_decision,\s*requirement_key\s+TEXT,\s*requirement_label\s+TEXT,\s*reason\s+TEXT,\s*created_at\s+TIMESTAMPTZ,\s*read_at\s+TIMESTAMPTZ\s*\)/i
    );
    expect(platformStudentPortalNotificationsMigration).toMatch(
      /WITH\s+authority\s+AS\s+MATERIALIZED[\s\S]*?readable_cases\s+AS\s+MATERIALIZED[\s\S]*?platform_can_read_student_portal_case\s*\(\s*student_case\.organization_id,\s*student_case\.id\s*\)[\s\S]*?JOIN\s+readable_cases\s+AS\s+readable_case/i
    );
    expect(platformStudentPortalNotificationsMigration).not.toMatch(
      /platform_can_read_student_portal_case\s*\(\s*projection\./i
    );
    expect(platformStudentPortalNotificationsMigration).toMatch(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+platform\.mark_own_student_portal_notification_read_v1\s*\(\s*p_notification_id\s+UUID,\s*p_request_id\s+UUID\s*\)[\s\S]*?RETURNS\s+JSONB/i
    );
    expect(platformStudentPortalNotificationsMigration).not.toContain(
      "'student_portal.notification.read'"
    );
    expect(
      platformStudentPortalNotificationsMigration.match(/'notification\.read'/g)
    ).toHaveLength(2);
    expect(platformStudentPortalNotificationsMigration).toMatch(
      /CREATE\s+TRIGGER\s+document_reviews_publish_student_portal_notification[\s\S]*?AFTER\s+INSERT[\s\S]*?ON\s+platform\.document_reviews/i
    );
    expect(platformStudentPortalNotificationsMigration).toMatch(
      /CREATE\s+POLICY\s+student_portal_notifications_broadcast_read[\s\S]*?ON\s+realtime\.messages[\s\S]*?FOR\s+SELECT[\s\S]*?TO\s+authenticated/i
    );
    expect(platformStudentPortalNotificationsMigration).toMatch(
      /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+platform_private\.can_subscribe_student_portal_notifications\s*\(\s*TEXT\s*\)\s+TO\s+authenticated/i
    );
    expect(platformStudentPortalNotificationsMigration).toMatch(
      /NEW\.reason\s*~\s*'\[\[:cntrl:\]\]'/i
    );
    expect(platformStudentPortalNotificationsMigration).toMatch(
      /char_length\s*\(\s*btrim\s*\(\s*requirement_key\s*\)\s*\)\s+NOT\s+BETWEEN\s+1\s+AND\s+128/i
    );
    expect(platformStudentPortalNotificationsMigration).toMatch(
      /student_case\.state\s+IN\s*\(\s*'active',\s*'closed'\s*\)[\s\S]*?student_case\.portal_activated_at\s+IS\s+NOT\s+NULL/i
    );
    expect(platformStudentPortalNotificationsMigration).toMatch(
      /permission_key\s*=\s*'portal\.read\.self'[\s\S]*?permission_key\s*=\s*'notification\.read\.self'/i
    );
    expect(platformStudentPortalNotificationsMigration).toMatch(
      /scope_assignment\.granted[\s\S]*?later_assignment\.assignment_version\s*>\s*scope_assignment\.assignment_version/i
    );
    expect(platformStudentPortalNotificationsMigration).toMatch(
      /ORDER\s+BY\s+notification\.created_at\s+DESC,\s*notification\.id\s+DESC\s+LIMIT\s+500/i
    );
    expect(platformStudentPortalNotificationsMigration).toMatch(
      /REVOKE\s+ALL\s+ON\s+TABLE\s+platform_private\.student_portal_notification_runtime_controls\s+FROM\s+PUBLIC,\s*anon,\s*authenticated,\s*service_role,\s*supabase_auth_admin/i
    );
    expect(platformStudentPortalNotificationsMigration).toMatch(
      /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+platform\.review_document_version_with_portal_notification_v1\s*\(\s*UUID,\s*UUID,\s*platform\.document_review_decision,\s*TEXT,\s*UUID\s*\)\s+TO\s+authenticated/i
    );
    expect(platformStudentPortalNotificationsMigration).toMatch(
      /ALTER\s+FUNCTION\s+platform\.mark_own_notification_read_legacy_043\s*\(\s*UUID,\s*UUID,\s*UUID\s*\)\s+SET\s+SCHEMA\s+platform_private/i
    );
    expect(platformStudentPortalNotificationsMigration).toMatch(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+platform\.mark_own_notification_read\s*\([\s\S]*?student_portal_notification_projection_v1[\s\S]*?ERRCODE\s*=\s*'42501'/i
    );
    expect(platformStudentPortalNotificationsMigration).not.toMatch(
      /INSERT\s+INTO\s+platform\.notification_delivery_intents/i
    );
  });

  it('keeps P6C overdue publication bounded, private, and actor-derived', () => {
    for (const table of [
      'student_portal_overdue_notification_runtime_controls',
      'student_portal_overdue_transition_state',
      'student_portal_overdue_notification_runs',
    ]) {
      expect(platformStudentPortalOverdueNotificationsMigration).toMatch(
        new RegExp(`CREATE\\s+TABLE\\s+platform_private\\.${table}`, 'i')
      );
      expect(platformStudentPortalOverdueNotificationsMigration).toMatch(
        new RegExp(
          `ALTER\\s+TABLE\\s+platform_private\\.${table}\\s+ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY[\\s\\S]*?ALTER\\s+TABLE\\s+platform_private\\.${table}\\s+FORCE\\s+ROW\\s+LEVEL\\s+SECURITY`,
          'i'
        )
      );
    }
    expect(platformStudentPortalOverdueNotificationsMigration).toMatch(
      /CREATE\s+TABLE\s+platform_private\.student_portal_overdue_notification_runtime_controls\s*\([\s\S]*?enabled\s+BOOLEAN\s+NOT\s+NULL\s+DEFAULT\s+FALSE[\s\S]*?automation_owner_membership_id\s+UUID\s+NOT\s+NULL/i
    );
    expect(platformStudentPortalOverdueNotificationsMigration).toMatch(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+platform\.process_student_portal_overdue_notifications_v1\s*\(\s*p_request_id\s+UUID,\s*p_worker_id\s+TEXT\s*\)[\s\S]*?FOR\s+UPDATE\s+OF\s+control\s+SKIP\s+LOCKED[\s\S]*?LIMIT\s+50[\s\S]*?FOR\s+UPDATE\s+OF\s+task\s+SKIP\s+LOCKED[\s\S]*?LIMIT\s+50[\s\S]*?FOR\s+UPDATE\s+OF\s+obligation\s+SKIP\s+LOCKED/i
    );
    expect(platformStudentPortalOverdueNotificationsMigration).toMatch(
      /SELECT\s+run\.result,\s*run\.worker_id\s+INTO\s+replayed,\s*replay_worker_id[\s\S]*?replay_worker_id\s+IS\s+DISTINCT\s+FROM\s+p_worker_id[\s\S]*?ERRCODE\s*=\s*'22023'/i
    );
    for (const trigger of [
      'student_portal_overdue_runs_append_only',
      'student_portal_overdue_runs_no_truncate',
      'student_portal_overdue_projection_append_only',
      'student_portal_overdue_projection_no_truncate',
    ]) {
      expect(platformStudentPortalOverdueNotificationsMigration).toMatch(
        new RegExp(
          `CREATE\\s+TRIGGER\\s+${trigger}[\\s\\S]*?platform_private\\.block_append_only_mutation\\s*\\(\\s*\\)`,
          'i'
        )
      );
    }
    expect(platformStudentPortalOverdueNotificationsMigration).toMatch(
      /CREATE\s+INDEX\s+case_tasks_student_overdue_scan_idx\s+ON\s+platform\.case_tasks\s*\(\s*organization_id,\s*due_at,\s*id\s*\)[\s\S]*?WHERE\s+student_visible[\s\S]*?status\s+IN\s*\(\s*'open',\s*'in_progress',\s*'blocked'\s*\)/i
    );
    expect(platformStudentPortalOverdueNotificationsMigration).toMatch(
      /CREATE\s+INDEX\s+payment_obligations_overdue_scan_idx\s+ON\s+platform\.payment_obligations\s*\(\s*organization_id,\s*due_at,\s*id\s*\)[\s\S]*?amount_minor\s*-\s*total_paid_minor\s*\+\s*total_refunded_minor\s*>\s*0/i
    );
    expect(platformStudentPortalOverdueNotificationsMigration).toMatch(
      /SET\s+is_overdue\s*=\s*FALSE,[\s\S]*?observed_due_at\s*=\s*COALESCE\s*\(\s*candidate\.due_at,\s*state\.observed_due_at\s*\)/i
    );
    expect(platformStudentPortalOverdueNotificationsMigration).toMatch(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+platform\.student_portal_notifications_v2\s*\(\s*\)[\s\S]*?notification_id\s+UUID,\s*category\s+TEXT,\s*event_code\s+TEXT,\s*subject_label\s+TEXT,\s*detail\s+TEXT,\s*due_at\s+TIMESTAMPTZ,\s*created_at\s+TIMESTAMPTZ,\s*read_at\s+TIMESTAMPTZ/i
    );
    expect(platformStudentPortalOverdueNotificationsMigration).toMatch(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+platform\.mark_own_student_portal_notification_read_v2\s*\(\s*p_notification_id\s+UUID,\s*p_request_id\s+UUID\s*\)[\s\S]*?platform_can_read_student_portal_case/i
    );
    expect(platformStudentPortalOverdueNotificationsMigration).toMatch(
      /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+platform\.process_student_portal_overdue_notifications_v1\s*\(\s*UUID,\s*TEXT\s*\)\s+TO\s+service_role/i
    );
    expect(platformStudentPortalOverdueNotificationsMigration).toMatch(
      /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+platform\.student_portal_notifications_v2\s*\(\s*\)\s+TO\s+authenticated/i
    );
    expect(platformStudentPortalOverdueNotificationsMigration).toMatch(
      /student_portal_notification_projection_v1[\s\S]*?student_portal_overdue_notification_projection_v1[\s\S]*?ERRCODE\s*=\s*'42501'/i
    );
    expect(platformStudentPortalOverdueNotificationsMigration).not.toMatch(
      /INSERT\s+INTO\s+platform\.notification_delivery_intents/i
    );
    expect(platformStudentPortalOverdueNotificationsMigration).not.toMatch(
      /(?:waha|amocrm|sqlite)/i
    );
  });

  it('keeps P6D visa and finance closure exact-case and provider-free', () => {
    expect(platformPortalCrossDomainClosureMigration).toMatch(
      /platform\.staff_case_visa\s*\(\s*p_student_case_id\s+UUID\s*\)[\s\S]*?private\.platform_can_read_student_case[\s\S]*?private\.platform_has_permission\s*\([\s\S]*?'visa\.manage'/i
    );
    expect(platformPortalCrossDomainClosureMigration).toMatch(
      /platform\.staff_case_finance\s*\(\s*p_student_case_id\s+UUID\s*\)[\s\S]*?private\.platform_can_read_finance_full[\s\S]*?private\.platform_can_read_student_case[\s\S]*?'finance\.read\.summary'/i
    );
    expect(platformPortalCrossDomainClosureMigration).toMatch(
      /platform\.settle_payment_obligation\s*\(\s*p_organization_id\s+UUID,\s*p_student_case_id\s+UUID,\s*p_payment_obligation_id\s+UUID,\s*p_source_key\s+TEXT,\s*p_evidence_ref\s+TEXT,\s*p_reason\s+TEXT,\s*p_request_id\s+UUID\s*\)/i
    );
    expect(platformPortalCrossDomainClosureMigration).toMatch(
      /FROM\s+platform\.student_cases\s+AS\s+student_case[\s\S]*?FOR\s+UPDATE[\s\S]*?FROM\s+platform\.payment_obligations\s+AS\s+obligation[\s\S]*?obligation\.student_case_id\s*=\s*p_student_case_id[\s\S]*?FOR\s+UPDATE/i
    );
    expect(platformPortalCrossDomainClosureMigration).toMatch(
      /outstanding_minor\s*:=\s*obligation_row\.amount_minor\s*-\s*\(\s*obligation_row\.total_paid_minor\s*-\s*obligation_row\.total_refunded_minor\s*\)/i
    );
    expect(platformPortalCrossDomainClosureMigration).toMatch(
      /platform\.record_payment_event\s*\([\s\S]*?outstanding_minor,[\s\S]*?obligation_row\.currency,[\s\S]*?transaction_timestamp\(\)/i
    );
    expect(platformPortalCrossDomainClosureMigration).toMatch(
      /char_length\(p_source_key\)\s+NOT\s+BETWEEN\s+1\s+AND\s+512[\s\S]*?p_source_key\s*~\s*'\[\[:cntrl:\]\]'/i
    );
    expect(platformPortalCrossDomainClosureMigration).not.toMatch(
      /(?:waha|whatsapp|amocrm|provider)_(?:id|ref|message|status)/i
    );
    expect(platformPortalCrossDomainClosureMigration).not.toMatch(
      /GRANT\s+(?:SELECT|INSERT|UPDATE|DELETE|ALL)\s+ON\s+(?:TABLE\s+)?platform/i
    );
  });

  it('hardens P3C manual messaging, cycle binding, and public health projection', () => {
    expect(platformMessagingControllerHardeningMigration).toMatch(
      /ALTER\s+TABLE\s+platform\.manual_send_authorizations[\s\S]*ADD\s+COLUMN\s+source_message_id\s+UUID[\s\S]*ALTER\s+COLUMN\s+ai_draft_id\s+DROP\s+NOT\s+NULL/i
    );
    expect(platformMessagingControllerHardeningMigration).toMatch(
      /DROP\s+FUNCTION\s+platform\.request_manual_whatsapp_send_with_authorization\s*\(\s*UUID,\s*UUID,\s*TEXT,\s*TEXT,\s*TEXT,\s*UUID\s*\)/i
    );
    expect(platformMessagingControllerHardeningMigration).toMatch(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+platform\.request_manual_whatsapp_send_with_authorization\s*\(\s*p_organization_id\s+UUID,\s*p_conversation_id\s+UUID,\s*p_source_message_id\s+UUID,\s*p_ai_draft_id\s+UUID/i
    );
    expect(platformMessagingControllerHardeningMigration).toMatch(
      /INTERVAL\s+'5 minutes'/i
    );
    expect(platformMessagingControllerHardeningMigration).toMatch(
      /INTERVAL\s+'1 minute'/i
    );

    const publicWorkflowSignature =
      platformMessagingControllerHardeningMigration.match(
        /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+platform\.staff_conversation_workflow[\s\S]*?RETURNS\s+TABLE\s*\(([\s\S]*?)\)\s*LANGUAGE/i
      )?.[1] ?? '';
    expect(publicWorkflowSignature).toMatch(/ai_readiness_fresh\s+BOOLEAN/i);
    expect(publicWorkflowSignature).toMatch(/waha_readiness_fresh\s+BOOLEAN/i);
    expect(publicWorkflowSignature).not.toMatch(
      /readiness_(?:reason|evidence_ref)/i
    );
    expect(platformMessagingControllerHardeningMigration).toMatch(
      /p_max_attempts\s*<>\s*1/i
    );
  });

  it('declares only the fixed private Platform buckets and service-only download signing', () => {
    const bucketDeclarations = Array.from(
      supabaseConfig.matchAll(/^\[storage\.buckets\.([^\]]+)\]$/gm),
      (match) => match[1]
    );

    expect(bucketDeclarations).toEqual([
      'platform-documents',
      'platform-whatsapp-media',
    ]);
    expect(supabaseConfig).toMatch(
      /\[storage\.buckets\.platform-documents\]\s*public\s*=\s*false\s*file_size_limit\s*=\s*"25MiB"\s*allowed_mime_types\s*=\s*\["application\/pdf",\s*"image\/jpeg",\s*"image\/png"\]/m
    );
    expect(supabaseConfig).toMatch(
      /\[storage\.buckets\.platform-whatsapp-media\]\s*public\s*=\s*false\s*file_size_limit\s*=\s*"50MiB"\s*allowed_mime_types\s*=\s*\["application\/octet-stream",\s*"application\/pdf",\s*"image\/gif",\s*"image\/jpeg",\s*"image\/png",\s*"image\/webp",\s*"audio\/mpeg",\s*"audio\/ogg",\s*"audio\/wav",\s*"video\/mp4"\]/m
    );
    expect(platformDocumentStorageMigration).toMatch(
      /CREATE\s+TABLE\s+platform_private\.document_upload_reservations/i
    );
    expect(platformDocumentStorageMigration).toMatch(
      /CREATE\s+TABLE\s+platform_private\.document_storage_bindings/i
    );
    expect(platformDocumentStorageMigration).toMatch(
      /CREATE\s+TABLE\s+platform_private\.document_upload_finalizations/i
    );
    expect(platformDocumentStorageMigration).toMatch(
      /CREATE\s+TABLE\s+platform_private\.document_download_grants/i
    );
    expect(platformDocumentStorageMigration).toMatch(
      /CREATE\s+TABLE\s+platform_private\.document_download_consumptions/i
    );
    expect(platformDocumentStorageMigration).toMatch(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+platform\.reserve_document_upload\s*\(\s*p_organization_id\s+UUID,\s*p_document_slot_id\s+UUID,\s*p_original_filename\s+TEXT,\s*p_declared_mime_type\s+TEXT,\s*p_byte_size\s+BIGINT,\s*p_sha256_hex\s+TEXT,\s*p_request_id\s+UUID\s*\)/i
    );
    expect(platformDocumentStorageMigration).toMatch(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+platform\.finalize_document_upload\s*\(\s*p_organization_id\s+UUID,\s*p_upload_reservation_id\s+UUID,\s*p_request_id\s+UUID\s*\)[\s\S]*service_role is required to finalize a document upload[\s\S]*FROM\s+storage\.objects[\s\S]*object_row\.created_at\s*>\s*reservation\.expires_at[\s\S]*UPDATE\s+platform\.document_slots[\s\S]*INSERT\s+INTO\s+platform_private\.document_upload_finalizations/i
    );
    expect(platformDocumentStorageMigration).toMatch(
      /SELECT\s+COALESCE\s*\(\s*MAX\s*\(\s*version\.version_no\s*\),\s*0\s*\)\s*\+\s*1[\s\S]*FROM\s+platform\.document_versions\s+AS\s+version/i
    );
    expect(platformDocumentStorageMigration).not.toMatch(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+platform\.reserve_document_upload[\s\S]*?UPDATE\s+platform\.document_slots[\s\S]*?CREATE\s+OR\s+REPLACE\s+FUNCTION\s+platform\.finalize_document_upload/i
    );
    expect(platformDocumentStorageMigration).toMatch(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+platform\.grant_document_download\s*\(\s*p_organization_id\s+UUID,\s*p_document_version_id\s+UUID,\s*p_access_purpose\s+TEXT,\s*p_expires_in_seconds\s+INTEGER,\s*p_request_id\s+UUID\s*\)/i
    );
    const downloadGrantFunction =
      platformDocumentStorageMigration.match(
        /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+platform\.grant_document_download[\s\S]*?END\s*\$\$;/i
      )?.[0] ?? '';
    expect(downloadGrantFunction).toMatch(
      /SELECT\s+\*\s+INTO\s+case_row\s+FROM\s+platform\.student_cases\s+AS\s+student_case[\s\S]*?FOR\s+UPDATE;[\s\S]*?SELECT\s+\*\s+INTO\s+version_row\s+FROM\s+platform\.document_versions\s+AS\s+version[\s\S]*?version\.student_case_id\s*=\s*case_row\.id[\s\S]*?FOR\s+UPDATE;[\s\S]*?Re-evaluate record scope after both locks/i
    );
    expect(downloadGrantFunction).not.toMatch(
      /FOR\s+UPDATE\s+OF\s+version,\s*student_case/i
    );
    expect(platformDocumentStorageMigration).toMatch(
      /char_length\s*\(\s*btrim\s*\(\s*p_original_filename\s*\)\s*\)\s*>\s*255[\s\S]*octet_length\s*\(\s*btrim\s*\(\s*p_original_filename\s*\)\s*\)\s*>\s*1024/i
    );
    expect(platformDocumentStorageMigration).toMatch(
      /char_length\s*\(\s*btrim\s*\(\s*p_access_purpose\s*\)\s*\)\s*>\s*255[\s\S]*octet_length\s*\(\s*btrim\s*\(\s*p_access_purpose\s*\)\s*\)\s*>\s*1024/i
    );
    expect(platformDocumentStorageMigration).toMatch(
      /VALIDATE\s+CONSTRAINT\s+document_versions_original_filename_size_check[\s\S]*VALIDATE\s+CONSTRAINT\s+document_access_events_purpose_size_check/i
    );
    expect(platformDocumentStorageMigration).toMatch(
      /actor_hourly_limit\s+CONSTANT\s+INTEGER\s*:=\s*60[\s\S]*slot_hourly_limit\s+CONSTANT\s+INTEGER\s*:=\s*12[\s\S]*'A document upload is already in progress'[\s\S]*ERRCODE\s*=\s*'PT409'[\s\S]*'Document upload request limit reached'[\s\S]*ERRCODE\s*=\s*'PT429'/i
    );
    expect(platformDocumentStorageMigration).toMatch(
      /reservation\.expires_at\s*>\s*reservation_created_at[\s\S]*FROM\s+platform_private\.document_upload_finalizations\s+AS\s+finalization[\s\S]*finalization\.upload_reservation_id\s*=\s*reservation\.id/i
    );
    expect(platformDocumentStorageMigration).toMatch(
      /actor_hourly_limit\s+CONSTANT\s+INTEGER\s*:=\s*120[\s\S]*'A document download grant is already active'[\s\S]*ERRCODE\s*=\s*'PT409'[\s\S]*'Document download request limit reached'[\s\S]*ERRCODE\s*=\s*'PT429'/i
    );
    expect(platformDocumentStorageMigration).toMatch(
      /'evo:p2h:upload-actor:'[\s\S]*p_organization_id::TEXT[\s\S]*actor\.actor_auth_user_id::TEXT/i
    );
    expect(platformDocumentStorageMigration).toMatch(
      /'evo:p2h:download-actor:'[\s\S]*p_organization_id::TEXT[\s\S]*actor\.actor_auth_user_id::TEXT/i
    );
    expect(platformDocumentStorageMigration).toMatch(
      /WHERE\s+reservation\.organization_id\s*=\s*p_organization_id\s+AND\s+reservation\.uploader_auth_user_id\s*=\s*actor\.actor_auth_user_id[\s\S]*reservation\.created_at\s*>/i
    );
    expect(platformDocumentStorageMigration).toMatch(
      /WHERE\s+download_grant\.organization_id\s*=\s*p_organization_id\s+AND\s+download_grant\.grantee_auth_user_id\s*=\s*actor\.actor_auth_user_id[\s\S]*download_grant\.created_at\s*>/i
    );
    expect(platformDocumentStorageMigration).toMatch(
      /require_domain_actor\s*\(\s*p_organization_id,\s*'document\.upload'\s*\)[\s\S]*FROM\s+platform\.document_slots\s+AS\s+slot[\s\S]*'Document is unavailable'[\s\S]*ERRCODE\s*=\s*'42501'/i
    );
    expect(platformDocumentStorageMigration).toMatch(
      /require_domain_actor\s*\(\s*p_organization_id,\s*'document\.download'\s*\)[\s\S]*FROM\s+platform\.document_versions\s+AS\s+version[\s\S]*'Document is unavailable'[\s\S]*ERRCODE\s*=\s*'42501'/i
    );
    const reservedUploadPolicyHelper =
      platformDocumentStorageMigration.match(
        /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+private\.platform_can_upload_reserved_document[\s\S]*?\n\$\$;/i
      )?.[0] ?? '';
    expect(reservedUploadPolicyHelper).not.toMatch(
      /slot\.current_version_id\s*=\s*reservation\.document_version_id/i
    );
    expect(platformDocumentStorageMigration).toMatch(
      /result\s*:=\s*jsonb_build_object\s*\(\s*'document_download_grant_id',\s*grant_id,\s*'expires_at',\s*grant_expires_at,\s*'signed_url',\s*NULL,\s*'storage_api_service_sign_required',\s*TRUE\s*\);/i
    );
    expect(platformDocumentStorageMigration).toMatch(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+platform\.consume_document_download_grant\s*\(\s*p_document_download_grant_id\s+UUID,\s*p_request_id\s+UUID\s*\)[\s\S]*REVOKE\s+ALL\s+ON\s+FUNCTION\s+platform\.consume_document_download_grant\s*\(\s*UUID,\s*UUID\s*\)\s+FROM\s+PUBLIC,\s*anon,\s*authenticated,\s*service_role,\s*supabase_auth_admin[\s\S]*GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+platform\.consume_document_download_grant\s*\(\s*UUID,\s*UUID\s*\)\s+TO\s+service_role/i
    );
    expect(platformDocumentStorageMigration).toMatch(
      /'max_signed_url_expires_in_seconds',\s*remaining_seconds[\s\S]*'signed_url',\s*NULL[\s\S]*'storage_api_service_sign_required',\s*TRUE/i
    );
    expect(platformDocumentStorageMigration).toMatch(
      /CREATE\s+POLICY\s+"Platform document reserved upload"[\s\S]*FOR\s+INSERT\s+TO\s+authenticated[\s\S]*bucket_id\s*=\s*'platform-documents'[\s\S]*storage\.allow_only_operation\s*\(\s*'storage\.object\.upload'\s*\)/i
    );
    expect(platformDocumentStorageMigration).toMatch(
      /DROP\s+POLICY\s+IF\s+EXISTS\s+"Platform document audited single sign"\s+ON\s+storage\.objects/i
    );
    expect(platformDocumentStorageMigration).not.toMatch(
      /CREATE\s+POLICY\s+[^;]*\s+ON\s+storage\.objects[^;]*\s+FOR\s+SELECT\b[^;]*;/i
    );
    expect(platformDocumentStorageMigration).toMatch(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+platform\.document_storage_backup_inventory\s*\(\s*\)\s*RETURNS\s+TABLE\s*\(\s*organization_id\s+UUID,\s*document_version_id\s+UUID,\s*student_case_id\s+UUID,\s*document_slot_id\s+UUID,\s*bucket_id\s+TEXT,\s*object_name\s+TEXT,\s*storage_object_id\s+UUID,\s*binding_present\s+BOOLEAN,\s*storage_object_present\s+BOOLEAN,\s*expected_byte_size\s+BIGINT,\s*expected_sha256_hex\s+TEXT,\s*storage_reported_byte_size\s+BIGINT,\s*inventory_state\s+TEXT,\s*binding_created_at\s+TIMESTAMPTZ\s*\)[\s\S]*GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+platform\.document_storage_backup_inventory\s*\(\s*\)\s+TO\s+service_role/i
    );
    expect(platformDocumentStorageMigration).not.toMatch(
      /\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+storage\.(?:buckets|objects)\b/i
    );
    expect(platformDocumentStorageMigration).not.toMatch(
      /document_storage_backup_inventory[\s\S]*RETURNS\s+TABLE\s*\([^)]*(?:original_filename|signed_url|token)/i
    );
    expect(platformDocumentStorageMigration).not.toMatch(
      /CREATE\s+POLICY[\s\S]*FOR\s+(?:UPDATE|DELETE)[\s\S]*platform-documents/i
    );
  });

  it('adds the student admissions domain without widening browser writes', () => {
    const admissionsTables = [
      'student_cases',
      'student_case_assignment_events',
      'student_case_lifecycle_events',
      'student_case_updates',
      'university_applications',
      'university_application_events',
      'visa_cases',
      'visa_case_events',
      'case_tasks',
      'case_task_events',
    ];

    for (const table of admissionsTables) {
      expect(platformAdmissionsMigration).toMatch(
        new RegExp(`CREATE\\s+TABLE\\s+platform\\.${table}\\b`, 'i')
      );
      expect(platformAdmissionsMigration).toMatch(
        new RegExp(
          `ALTER\\s+TABLE\\s+platform\\.${table}\\s+ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY`,
          'i'
        )
      );
      expect(platformAdmissionsMigration).toMatch(
        new RegExp(
          `ALTER\\s+TABLE\\s+platform\\.${table}\\s+FORCE\\s+ROW\\s+LEVEL\\s+SECURITY`,
          'i'
        )
      );
    }

    expect(platformAdmissionsMigration).toMatch(
      /CREATE\s+TYPE\s+platform\.visa_status\s+AS\s+ENUM\s*\(\s*'not_required',\s*'not_started',\s*'docs',\s*'appointment',\s*'submitted',\s*'approved',\s*'rejected',\s*'closed'\s*\)/i
    );
    expect(platformAdmissionsMigration).toMatch(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+platform\.assign_student_case_curator[\s\S]*SECURITY\s+DEFINER/i
    );
    expect(platformAdmissionsMigration).toMatch(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+platform\.sales_handoff_summaries\s*\(\s*\)[\s\S]*SECURITY\s+DEFINER/i
    );
    expect(platformAdmissionsMigration).toMatch(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+platform\.student_portal_cases\s*\(\s*\)[\s\S]*SECURITY\s+DEFINER/i
    );
    const admissionsPolicies = platformAdmissionsMigration
      .split(';')
      .filter((statement) => /CREATE\s+POLICY/i.test(statement));

    expect(admissionsPolicies).toHaveLength(admissionsTables.length);
    for (const policy of admissionsPolicies) {
      expect(policy).toMatch(/\bFOR\s+SELECT\b/i);
      expect(policy).not.toMatch(/\bFOR\s+(?:INSERT|UPDATE|DELETE|ALL)\b/i);
    }
  });

  it('adds P2E metadata and intent contracts without provider-success claims', () => {
    const p2eTables = [
      'document_requirements',
      'document_slots',
      'document_versions',
      'document_validation_events',
      'document_reviews',
      'document_access_events',
      'payment_obligations',
      'payment_events',
      'payment_evidence',
      'stop_factors',
      'stop_factor_events',
      'notification_consents',
      'notification_consent_events',
      'notifications',
      'notification_delivery_intents',
      'notification_events',
    ];

    for (const table of p2eTables) {
      expect(platformDocumentsFinanceNotificationsMigration).toMatch(
        new RegExp(`CREATE\\s+TABLE\\s+platform\\.${table}\\b`, 'i')
      );
      expect(platformDocumentsFinanceNotificationsMigration).toMatch(
        new RegExp(
          `ALTER\\s+TABLE\\s+platform\\.${table}\\s+ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY`,
          'i'
        )
      );
      expect(platformDocumentsFinanceNotificationsMigration).toMatch(
        new RegExp(
          `ALTER\\s+TABLE\\s+platform\\.${table}\\s+FORCE\\s+ROW\\s+LEVEL\\s+SECURITY`,
          'i'
        )
      );
    }

    expect(platformDocumentsFinanceNotificationsMigration).toMatch(
      /CREATE\s+TYPE\s+platform\.notification_channel\s+AS\s+ENUM\s*\(\s*'in_app',\s*'individual_whatsapp'\s*\)/i
    );
    expect(platformDocumentsFinanceNotificationsMigration).toMatch(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+platform\.record_document_version_metadata[\s\S]*SECURITY\s+DEFINER[\s\S]*GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+platform\.record_document_version_metadata[\s\S]*TO\s+service_role/i
    );
    expect(platformDocumentsFinanceNotificationsMigration).toMatch(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+platform\.record_payment_event[\s\S]*referenced_payment_event_id[\s\S]*SECURITY\s+DEFINER/i
    );
    expect(platformDocumentsFinanceNotificationsMigration).toMatch(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+platform\.student_portal_finance\s*\(\s*\)[\s\S]*SECURITY\s+DEFINER\s+SET\s+search_path\s*=\s*''/i
    );
    expect(platformDocumentsFinanceNotificationsMigration).toMatch(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+platform\.my_notifications\s*\(\s*\)[\s\S]*SECURITY\s+DEFINER\s+SET\s+search_path\s*=\s*''/i
    );
    expect(platformDocumentsFinanceNotificationsMigration).not.toMatch(
      /\b(provider_message_id|provider_ack|recipient_ids|broadcast_id|campaign_id)\b/i
    );
    expect(platformDocumentsFinanceNotificationsMigration).not.toMatch(
      /\b(?:CREATE|ALTER|DROP)\s+(?:TABLE|POLICY|SCHEMA)\s+storage\b/i
    );
  });

  it('adds P2F communication and draft evidence without claiming provider delivery', () => {
    const platformTables = [
      'communication_conversations',
      'conversation_handoff_events',
      'conversation_participants',
      'communication_messages',
      'approved_knowledge_versions',
      'ai_draft_requests',
      'ai_drafts',
      'ai_draft_knowledge_citations',
      'ai_draft_events',
      'manual_send_authorizations',
    ];
    const privateTables = [
      'provider_webhook_events',
      'provider_reconciliation_events',
    ];
    const platformFunctions = [
      'create_communication_conversation',
      'record_communication_message',
      'append_provider_reconciliation_event',
      'link_communication_conversation_case',
      'record_conversation_participant',
      'persist_provider_webhook_event',
      'publish_approved_knowledge_version',
      'retire_approved_knowledge_version',
      'request_ai_draft',
      'record_ai_draft',
      'complete_ai_draft_generation',
      'resolve_ai_draft_language',
      'review_ai_draft',
      'authorize_manual_send',
      'staff_communication_queue',
      'staff_conversation_messages',
      'former_sales_case_summaries',
      'student_portal_messages',
      'approved_knowledge_catalog',
    ];
    const createdTables = [
      ...platformCommunicationsMigration.matchAll(
        /CREATE\s+TABLE\s+((?:platform|platform_private)\.[a-z_]+)/gi
      ),
    ].map((match) => match[1].toLowerCase());
    const createdFunctions = [
      ...platformCommunicationsMigration.matchAll(
        /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+platform\.([a-z_]+)/gi
      ),
    ].map((match) => match[1].toLowerCase());

    expect(createdTables).toEqual([
      'platform_private.provider_webhook_events',
      ...platformTables.map((table) => `platform.${table}`),
      'platform_private.provider_reconciliation_events',
    ]);
    expect(createdFunctions).toEqual(platformFunctions);

    for (const table of platformTables) {
      expect(platformCommunicationsMigration).toMatch(
        new RegExp(
          `ALTER\\s+TABLE\\s+platform\\.${table}\\s+ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY`,
          'i'
        )
      );
      expect(platformCommunicationsMigration).toMatch(
        new RegExp(
          `ALTER\\s+TABLE\\s+platform\\.${table}\\s+FORCE\\s+ROW\\s+LEVEL\\s+SECURITY`,
          'i'
        )
      );
    }

    for (const table of privateTables) {
      expect(platformCommunicationsMigration).toMatch(
        new RegExp(
          `ALTER\\s+TABLE\\s+platform_private\\.${table}\\s+ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY`,
          'i'
        )
      );
      expect(platformCommunicationsMigration).toMatch(
        new RegExp(
          `ALTER\\s+TABLE\\s+platform_private\\.${table}\\s+FORCE\\s+ROW\\s+LEVEL\\s+SECURITY`,
          'i'
        )
      );
    }

    expect(platformCommunicationsMigration).toMatch(
      /CREATE\s+TABLE\s+platform_private\.provider_webhook_events[\s\S]*provider_account_ref\s+TEXT\s+NOT\s+NULL[\s\S]*provider_conversation_ref\s+TEXT[\s\S]*provider_event_variant_ref\s+TEXT[\s\S]*provider_request_id\s+TEXT\s+NOT\s+NULL[\s\S]*waha_session_name\s+TEXT[\s\S]*payload_id\s+TEXT\s+NOT\s+NULL[\s\S]*event_type\s+TEXT\s+NOT\s+NULL[\s\S]*provider_occurred_at\s+TIMESTAMPTZ\s+NOT\s+NULL[\s\S]*verification_status\s+platform\.webhook_verification_status\s+NOT\s+NULL[\s\S]*raw_payload\s+JSONB\s+NOT\s+NULL[\s\S]*verification_headers\s+JSONB\s+NOT\s+NULL[\s\S]*verification_evidence_ref\s+TEXT\s+NOT\s+NULL[\s\S]*payload_sha256\s+TEXT\s+NOT\s+NULL/i
    );
    expect(platformCommunicationsMigration).toMatch(
      /CONSTRAINT\s+provider_webhook_events_variant_shape_check\s+CHECK[\s\S]*provider\s*=\s*'waha'[\s\S]*event_type\s*=\s*'message\.ack'[\s\S]*provider_event_variant_ref\s+IS\s+NOT\s+NULL[\s\S]*event_type\s*=\s*'message\.any'[\s\S]*provider_event_variant_ref\s+IS\s+NULL/i
    );
    expect(platformCommunicationsMigration).toMatch(
      /CREATE\s+UNIQUE\s+INDEX\s+provider_webhook_events_waha_business_key[\s\S]*organization_id,\s*provider_account_ref,\s*waha_session_name,\s*event_type,\s*payload_id,\s*COALESCE\s*\(\s*provider_event_variant_ref,\s*''\s*\)[\s\S]*WHERE\s+provider\s*=\s*'waha'/i
    );
    expect(platformCommunicationsMigration).toMatch(
      /CONSTRAINT\s+provider_webhook_events_provider_request_key\s+UNIQUE\s*\(\s*organization_id,\s*provider,\s*provider_account_ref,\s*provider_request_id\s*\)/i
    );
    expect(platformCommunicationsMigration).toMatch(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+platform\.persist_provider_webhook_event\s*\(\s*p_organization_id\s+UUID,\s*p_provider\s+platform\.communication_provider,\s*p_provider_account_ref\s+TEXT,\s*p_provider_conversation_ref\s+TEXT,\s*p_provider_event_variant_ref\s+TEXT,\s*p_provider_request_id\s+TEXT,\s*p_waha_session_name\s+TEXT,\s*p_payload_id\s+TEXT,\s*p_event_type\s+TEXT,\s*p_provider_occurred_at\s+TIMESTAMPTZ,\s*p_verification_status\s+platform\.webhook_verification_status,\s*p_raw_payload\s+JSONB,\s*p_verification_headers\s+JSONB,\s*p_verification_evidence_ref\s+TEXT,\s*p_payload_sha256\s+TEXT,\s*p_request_id\s+UUID\s*\)\s*RETURNS\s+JSONB[\s\S]*?IF\s+\(SELECT\s+auth\.jwt\(\)\s*->>\s*'role'\)\s+IS\s+DISTINCT\s+FROM\s+'service_role'/i
    );
    expect(platformCommunicationsMigration).not.toMatch(
      /CREATE\s+UNIQUE\s+INDEX\s+provider_webhook_events_non_waha_business_key/i
    );
    expect(platformCommunicationsMigration).toMatch(
      /CREATE\s+UNIQUE\s+INDEX\s+provider_reconciliation_events_source_effect_key[\s\S]*organization_id,\s*source_webhook_event_id,\s*observation_kind,\s*conversation_id,\s*communication_message_id,\s*ack_state[\s\S]*NULLS\s+NOT\s+DISTINCT[\s\S]*WHERE\s+source_webhook_event_id\s+IS\s+NOT\s+NULL/i
    );
    expect(platformCommunicationsMigration).toMatch(
      /CREATE\s+UNIQUE\s+INDEX\s+provider_reconciliation_events_unknown_authorization_key[\s\S]*organization_id,\s*manual_send_authorization_id[\s\S]*WHERE\s+observation_kind\s*=\s*'unknown_result'/i
    );

    expect(platformCommunicationsMigration).toMatch(
      /CREATE\s+TABLE\s+platform\.communication_conversations[\s\S]*waha_session_name\s+TEXT\s+NOT\s+NULL[\s\S]*kommo_conversation_id\s+TEXT[\s\S]*amocrm_lead_id\s+BIGINT\s+NOT\s+NULL[\s\S]*amocrm_contact_id\s+BIGINT\s+NOT\s+NULL/i
    );
    expect(platformCommunicationsMigration).toMatch(
      /CREATE\s+TABLE\s+platform\.communication_messages[\s\S]*waha_session_name\s+TEXT[\s\S]*waha_message_id\s+TEXT[\s\S]*kommo_conversation_id\s+TEXT[\s\S]*kommo_message_id\s+TEXT[\s\S]*amocrm_lead_id\s+BIGINT\s+NOT\s+NULL[\s\S]*amocrm_contact_id\s+BIGINT\s+NOT\s+NULL/i
    );

    expect(platformCommunicationsMigration).toMatch(
      /CREATE\s+TYPE\s+platform\.ai_draft_language\s+AS\s+ENUM\s*\(\s*'ru',\s*'en'\s*\)/i
    );
    expect(platformCommunicationsMigration).toMatch(
      /CREATE\s+TYPE\s+platform\.communication_message_language\s+AS\s+ENUM\s*\(\s*'ru',\s*'en',\s*'undetermined'\s*\)/i
    );
    expect(platformCommunicationsMigration).toMatch(
      /CREATE\s+TYPE\s+platform\.ai_language_detection_status\s+AS\s+ENUM\s*\(\s*'confident',\s*'uncertain'\s*\)/i
    );
    expect(platformCommunicationsMigration).toMatch(
      /CREATE\s+TABLE\s+platform\.ai_draft_requests[\s\S]*source_message_id\s+UUID\s+NOT\s+NULL[\s\S]*requested_by_profile_id\s+UUID\s+NOT\s+NULL[\s\S]*requested_by_membership_id\s+UUID\s+NOT\s+NULL[\s\S]*request_id\s+UUID\s+NOT\s+NULL\s+UNIQUE/i
    );
    expect(platformCommunicationsMigration).toMatch(
      /CREATE\s+TABLE\s+platform\.ai_drafts[\s\S]*provider_ref\s+TEXT[\s\S]*model_ref\s+TEXT[\s\S]*prompt_policy_version\s+TEXT[\s\S]*source_context\s+JSONB\s+NOT\s+NULL[\s\S]*source_context_sha256\s+TEXT\s+NOT\s+NULL[\s\S]*generated_text\s+TEXT[\s\S]*reviewed_text\s+TEXT/i
    );
    expect(platformCommunicationsMigration).toMatch(
      /CREATE\s+TABLE\s+platform\.ai_draft_knowledge_citations[\s\S]*knowledge_version_id\s+UUID\s+NOT\s+NULL/i
    );
    expect(platformCommunicationsMigration).toMatch(
      /CREATE\s+TABLE\s+platform\.manual_send_authorizations[\s\S]*final_text\s+TEXT\s+NOT\s+NULL[\s\S]*final_text_sha256\s+TEXT\s+NOT\s+NULL[\s\S]*authorized_by_membership_id\s+UUID\s+NOT\s+NULL/i
    );

    expect(platformCommunicationsMigration).not.toMatch(
      /CREATE\s+TABLE\s+(?:platform\.)?[a-z_]*(?:outbox|broadcast|campaign|queue_job)[a-z_]*\b/i
    );
    expect(platformCommunicationsMigration).not.toMatch(
      /\b(?:CREATE|ALTER|DROP)\s+(?:TABLE|POLICY|SCHEMA)\s+(?:storage|pgmq)\b/i
    );
    expect(platformCommunicationsMigration).not.toMatch(
      /\bdelivery_status\s+(?:TEXT|platform\.)/i
    );
  });

  it('adds real PGMQ work without browser queue access or unknown-result retry', () => {
    for (const table of [
      'durable_work_items',
      'durable_work_attempts',
      'durable_work_events',
      'durable_work_dead_letters',
      'durable_work_idempotency',
    ]) {
      expect(platformQueuesMigration).toMatch(
        new RegExp(`CREATE\\s+TABLE\\s+platform_private\\.${table}\\b`, 'i')
      );
    }

    for (const table of ['work_review_cases', 'work_review_events']) {
      expect(platformQueuesMigration).toMatch(
        new RegExp(`CREATE\\s+TABLE\\s+platform\\.${table}\\b`, 'i')
      );
      expect(platformQueuesMigration).toMatch(
        new RegExp(
          `ALTER\\s+TABLE\\s+platform\\.${table}\\s+FORCE\\s+ROW\\s+LEVEL\\s+SECURITY`,
          'i'
        )
      );
    }

    expect(platformQueuesMigration).toMatch(
      /CREATE\s+EXTENSION\s+IF\s+NOT\s+EXISTS\s+pgmq/i
    );
    expect(platformQueuesMigration).toMatch(
      /SELECT\s+pgmq\.create\s*\(\s*'platform_work_v1'\s*\)/i
    );
    expect(platformQueuesMigration).toMatch(
      /SELECT\s+pgmq\.create\s*\(\s*'platform_dead_letter_v1'\s*\)/i
    );
    expect(platformQueuesMigration).toMatch(
      /CREATE\s+TYPE\s+platform\.durable_work_kind\s+AS\s+ENUM\s*\(\s*'provider_webhook_process',\s*'ai_draft_generate',\s*'manual_whatsapp_send'\s*\)/i
    );
    expect(platformQueuesMigration).toMatch(
      /FROM\s+pgmq\.read\s*\(\s*'platform_work_v1'/i
    );
    expect(platformQueuesMigration).not.toMatch(/\bpgmq\.pop\s*\(/i);
    expect(platformQueuesMigration).toMatch(
      /jsonb_build_object\s*\(\s*'v',\s*1,\s*'work_item_id',\s*created_work_item_id,\s*'kind',\s*p_kind\s*\)/i
    );
    expect(platformQueuesMigration).toMatch(
      /p_kind\s*=\s*'manual_whatsapp_send'[\s\S]*p_max_attempts\s*<>\s*1/i
    );
    expect(platformQueuesMigration).toMatch(
      /p2g_open_unknown_review[\s\S]*worker_lease_expired_before_result/i
    );
    expect(platformQueuesMigration).toMatch(
      /REVOKE\s+ALL\s+ON\s+SCHEMA\s+pgmq[\s\S]*service_role/i
    );
    expect(platformQueuesMigration).not.toMatch(/confirmed_external_send/i);
    expect(platformQueuesMigration).not.toMatch(
      /\b(auto[_-]?reply|broadcast|mass[_-]?send|campaign)\b/i
    );
  });

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
      );
    }

    expect(platformGrantMigration).toMatch(
      /REVOKE\s+ALL\s+PRIVILEGES\s+ON\s+TABLE[\s\S]*public\.whatsapp_config[\s\S]*public\.integration_secrets[\s\S]*FROM\s+PUBLIC,\s*anon,\s*authenticated,\s*service_role/i
    );
    expect(platformGrantMigration).toMatch(
      /GRANT\s+SELECT,\s*INSERT,\s*UPDATE,\s*DELETE\s+ON\s+TABLE[\s\S]*public\.whatsapp_config[\s\S]*public\.integration_secrets[\s\S]*TO\s+service_role/i
    );
    expect(platformGrantMigration).not.toMatch(
      /GRANT\s+ALL\s+PRIVILEGES\s+ON\s+TABLE/i
    );
    expect(platformGrantMigration).toMatch(
      /DROP\s+POLICY\s+IF\s+EXISTS\s+integration_secrets_insert\s+ON\s+public\.integration_secrets/i
    );
  });

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
    expect(allMigrationsSql).toMatch(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+is_account_member/i
    );
    expect(allMigrationsSql).toMatch(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.set_member_role/i
    );
    expect(allMigrationsSql).toMatch(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.remove_account_member/i
    );
    expect(allMigrationsSql).toMatch(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.transfer_account_ownership/i
    );
  });

  it('adds only nullable amoCRM shadow identifiers for companion records', () => {
    expect(evoShadowMigration).toMatch(
      /ALTER\s+TABLE\s+contacts[\s\S]*amo_contact_id\s+text/i
    );
    expect(evoShadowMigration).toMatch(
      /ALTER\s+TABLE\s+conversations[\s\S]*amo_lead_id\s+text/i
    );
    expect(evoShadowMigration).toMatch(
      /ALTER\s+TABLE\s+deals[\s\S]*amo_lead_id\s+text/i
    );
    expect(evoShadowMigration).toMatch(
      /amoCRM remains the canonical contact identity source/i
    );
    expect(evoShadowMigration).toMatch(
      /amoCRM remains canonical for lead identity and sales status/i
    );
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
    expect(evoShadowMigration).toMatch(
      /CREATE\s+POLICY\s+integration_settings_select/i
    );
  });

  it('keeps integration secret reads on the service-role side of the boundary', () => {
    expect(evoShadowMigration).toMatch(
      /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+integration_secrets/i
    );
    expect(evoShadowMigration).toMatch(/encrypted_value\s+text\s+NOT\s+NULL/i);
    expect(evoShadowMigration).toMatch(/no\s+SELECT\s+policy/i);
    expect(evoShadowMigration).toMatch(/service-role\s+client/i);
    expect(evoShadowMigration).not.toMatch(
      /CREATE\s+POLICY\s+\S+\s+ON\s+integration_secrets\s+FOR\s+SELECT/i
    );
    expect(evoShadowMigration).toMatch(
      /CREATE\s+POLICY\s+integration_secrets_insert/i
    );
    expect(evoShadowMigration).toMatch(
      /CREATE\s+POLICY\s+integration_secrets_update/i
    );
    expect(evoShadowMigration).toMatch(
      /CREATE\s+POLICY\s+integration_secrets_delete/i
    );
  });

  it('adds WAHA-specific inbound message idempotency without changing legacy Meta ids', () => {
    expect(wahaInboundMigration).toMatch(
      /ALTER\s+TABLE\s+messages[\s\S]*waha_session_name\s+text/i
    );
    expect(wahaInboundMigration).toMatch(
      /ALTER\s+TABLE\s+messages[\s\S]*waha_message_id\s+text/i
    );
    expect(wahaInboundMigration).toMatch(
      /CREATE\s+UNIQUE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+idx_messages_waha_session_message_id/i
    );
    expect(wahaInboundMigration).toMatch(
      /WHERE\s+waha_session_name\s+IS\s+NOT\s+NULL\s+AND\s+waha_message_id\s+IS\s+NOT\s+NULL/i
    );
    expect(wahaInboundMigration).not.toMatch(/UNIQUE\s*\(\s*message_id\s*\)/i);
  });

  it('adds nullable WAHA manual outbound provider status without requiring provider ids', () => {
    expect(wahaManualOutboundMigration).toMatch(
      /ALTER\s+TABLE\s+messages[\s\S]*waha_message_status\s+text/i
    );
    expect(wahaManualOutboundMigration).toMatch(/accepted_without_id/i);
    expect(wahaManualOutboundMigration).not.toMatch(
      /waha_message_id\s+text\s+NOT\s+NULL/i
    );
  });

  it('allows Gemini as an encrypted account-level AI provider', () => {
    expect(allMigrationsSql).toMatch(
      /DROP\s+CONSTRAINT\s+IF\s+EXISTS\s+ai_configs_provider_check/i
    );
    expect(allMigrationsSql).toMatch(
      /CHECK\s*\(\s*provider\s+IN\s*\([\s\S]*'openai'[\s\S]*'anthropic'[\s\S]*'gemini'[\s\S]*\)\s*\)/i
    );
  });

  it('adds explicit embeddings provider selection with keyword as the default', () => {
    expect(embeddingsScaleMigration).toMatch(
      /ALTER\s+TABLE\s+ai_configs[\s\S]*ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+embeddings_provider\s+text\s+NOT\s+NULL\s+DEFAULT\s+'keyword'/i
    );
    expect(embeddingsScaleMigration).toMatch(
      /DROP\s+CONSTRAINT\s+IF\s+EXISTS\s+ai_configs_embeddings_provider_check/i
    );
    expect(embeddingsScaleMigration).toMatch(
      /CHECK\s*\(\s*embeddings_provider\s+IN\s*\([\s\S]*'keyword'[\s\S]*'gemini'[\s\S]*'openai'[\s\S]*\)\s*\)/i
    );
  });

  it('adds composite indexes for production inbox and message growth paths', () => {
    expect(embeddingsScaleMigration).toMatch(
      /CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+idx_conversations_account_last_message[\s\S]*ON\s+conversations\s*\(\s*account_id,\s*last_message_at\s+DESC\s+NULLS\s+LAST,\s*updated_at\s+DESC\s+NULLS\s+LAST,\s*id\s*\)/i
    );
    expect(embeddingsScaleMigration).toMatch(
      /CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+idx_messages_conversation_created_at[\s\S]*ON\s+messages\s*\(\s*conversation_id,\s*created_at,\s*id\s*\)/i
    );
  });

  it('adds explicit retryable amoCRM sync status to conversations and messages', () => {
    expect(reliableAmoCrmSyncMigration).toMatch(
      /ALTER\s+TABLE\s+conversations[\s\S]*ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+crm_sync_status\s+text\s+NOT\s+NULL\s+DEFAULT\s+'pending'/i
    );
    expect(reliableAmoCrmSyncMigration).toMatch(
      /CHECK\s*\(\s*crm_sync_status\s+IN\s*\([\s\S]*'pending'[\s\S]*'synced'[\s\S]*'not_configured'[\s\S]*'blocked'[\s\S]*\)\s*\)/i
    );
    expect(reliableAmoCrmSyncMigration).toMatch(
      /ALTER\s+TABLE\s+messages[\s\S]*ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+crm_sync_status\s+text\s+NOT\s+NULL\s+DEFAULT\s+'pending'/i
    );
    expect(reliableAmoCrmSyncMigration).toMatch(
      /idx_conversations_account_crm_sync_retry/i
    );
    expect(reliableAmoCrmSyncMigration).toMatch(
      /idx_messages_conversation_crm_sync_status/i
    );
  });

  it('adds immutable account-scoped AI draft audits with member read-only access', () => {
    expect(
      outboundAuditMigration.match(/DEFAULT\s+gen_random_uuid\(\)/gi) ?? []
    ).toHaveLength(2);
    expect(outboundAuditMigration).not.toMatch(/\buuid_generate_v4\(\)/i);
    expect(outboundAuditMigration).toMatch(
      /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+ai_drafts\s*\([\s\S]*account_id\s+uuid\s+NOT\s+NULL[\s\S]*conversation_id\s+uuid\s+NOT\s+NULL[\s\S]*created_by\s+uuid\s+NOT\s+NULL[\s\S]*provider\s+text\s+NOT\s+NULL[\s\S]*model\s+text\s+NOT\s+NULL[\s\S]*content_text\s+text\s+NOT\s+NULL[\s\S]*knowledge_chunk_ids\s+uuid\[\]\s+NOT\s+NULL[\s\S]*knowledge_item_count\s+integer\s+NOT\s+NULL[\s\S]*created_at\s+timestamptz\s+NOT\s+NULL/i
    );
    expect(outboundAuditMigration).toMatch(
      /ALTER\s+TABLE\s+ai_drafts\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/i
    );
    expect(outboundAuditMigration).toMatch(
      /CREATE\s+POLICY\s+ai_drafts_select\s+ON\s+ai_drafts\s+FOR\s+SELECT[\s\S]*is_account_member\s*\(\s*account_id\s*\)/i
    );
    expect(outboundAuditMigration).toMatch(
      /REVOKE\s+INSERT,\s*UPDATE,\s*DELETE\s+ON\s+TABLE\s+ai_drafts\s+FROM\s+anon,\s*authenticated/i
    );
    expect(outboundAuditMigration).toMatch(
      /CREATE\s+TRIGGER\s+ai_drafts_immutable/i
    );
  });

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
      );
    }

    expect(outboundAuditMigration).toMatch(
      /CHECK\s*\(\s*outbound_state\s+IN\s*\(\s*'queued',\s*'dispatching',\s*'accepted',\s*'rejected',\s*'unknown'\s*\)\s*\)/i
    );
    expect(outboundAuditMigration).toMatch(
      /FOREIGN\s+KEY\s*\(\s*ai_draft_id,\s*conversation_id\s*\)[\s\S]*REFERENCES\s+ai_drafts\s*\(\s*id,\s*conversation_id\s*\)/i
    );
    expect(outboundAuditMigration).toMatch(
      /CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+idx_messages_waha_outbound_reconcile[\s\S]*ON\s+messages\s*\(\s*outbound_state,\s*waha_session_name,\s*waha_message_id\s*\)[\s\S]*WHERE[\s\S]*waha_message_id\s+IS\s+NOT\s+NULL[\s\S]*waha_chat_id\s+IS\s+NOT\s+NULL/i
    );
    expect(outboundAuditMigration).toMatch(
      /DROP\s+POLICY\s+IF\s+EXISTS\s+messages_modify\s+ON\s+messages/i
    );
    expect(outboundAuditMigration).toMatch(
      /CREATE\s+POLICY\s+messages_select\s+ON\s+messages\s+FOR\s+SELECT[\s\S]*is_account_member\s*\(\s*c\.account_id\s*\)/i
    );
    expect(outboundAuditMigration).toMatch(
      /REVOKE\s+INSERT,\s*UPDATE,\s*DELETE,\s*TRUNCATE,\s*REFERENCES,\s*TRIGGER\s+ON\s+TABLE\s+messages\s+FROM\s+anon,\s*authenticated/i
    );
    expect(outboundAuditMigration).toMatch(
      /GRANT\s+SELECT,\s*INSERT,\s*UPDATE,\s*DELETE\s+ON\s+TABLE\s+messages\s+TO\s+service_role/i
    );
  });

  it('records immutable acknowledgement evidence through a service-role-only RPC', () => {
    expect(outboundAuditMigration).toMatch(
      /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+waha_message_ack_events/i
    );
    expect(outboundAuditMigration).toMatch(
      /UNIQUE\s*\(\s*account_id,\s*waha_session_name,\s*waha_message_id,\s*ack\s*\)/i
    );
    expect(outboundAuditMigration).toMatch(
      /CREATE\s+TRIGGER\s+waha_message_ack_events_immutable/i
    );
    expect(outboundAuditMigration).toMatch(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+record_waha_message_ack[\s\S]*SECURITY\s+DEFINER[\s\S]*c\.account_id\s*=\s*p_account_id[\s\S]*m\.waha_session_name\s*=\s*p_session_name[\s\S]*m\.waha_message_id\s*=\s*p_waha_message_id/i
    );
    expect(outboundAuditMigration).toMatch(
      /p_ack\s*=\s*-1\s+AND\s+m\.waha_ack\s*=\s*0/i
    );
    expect(outboundAuditMigration).toMatch(
      /p_ack\s*>=\s*0\s+AND\s+m\.waha_ack\s*>=\s*0\s+AND\s+p_ack\s*>\s*m\.waha_ack/i
    );
    expect(outboundAuditMigration).toMatch(
      /REVOKE\s+ALL\s+ON\s+FUNCTION\s+record_waha_message_ack[\s\S]*FROM\s+PUBLIC,\s*anon,\s*authenticated/i
    );
    expect(outboundAuditMigration).toMatch(
      /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+record_waha_message_ack[\s\S]*TO\s+service_role/i
    );
  });

  it('keeps P4R1 amoCRM read evidence private and exposes only scoped safe RPCs', () => {
    expect(platformAmoCrmCanonicalContextMigration).not.toMatch(
      /pg_catalog\.coalesce/i
    );

    for (const table of [
      'amocrm_canonical_context_current',
      'amocrm_canonical_context_observations',
    ]) {
      expect(platformAmoCrmCanonicalContextMigration).toMatch(
        new RegExp(`CREATE\\s+TABLE\\s+platform_private\\.${table}`, 'i')
      );
      expect(platformAmoCrmCanonicalContextMigration).toMatch(
        new RegExp(
          `ALTER\\s+TABLE\\s+platform_private\\.${table}\\s+ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY`,
          'i'
        )
      );
      expect(platformAmoCrmCanonicalContextMigration).toMatch(
        new RegExp(
          `ALTER\\s+TABLE\\s+platform_private\\.${table}\\s+FORCE\\s+ROW\\s+LEVEL\\s+SECURITY`,
          'i'
        )
      );
    }

    expect(platformAmoCrmCanonicalContextMigration).toMatch(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+platform\.record_amocrm_canonical_context_observation[\s\S]*SECURITY\s+DEFINER/i
    );
    expect(platformAmoCrmCanonicalContextMigration).toMatch(
      /GRANT\s+EXECUTE\s+ON\s+FUNCTION[\s\S]*platform\.record_amocrm_canonical_context_observation[\s\S]*TO\s+service_role/i
    );
    expect(platformAmoCrmCanonicalContextMigration).toMatch(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+platform\.staff_amocrm_canonical_context[\s\S]*RETURNS\s+TABLE[\s\S]*platform_private\.require_domain_actor_read[\s\S]*private\.platform_can_read_communication_full/i
    );
    expect(platformAmoCrmCanonicalContextMigration).toMatch(
      /FROM\s+platform_private\.amocrm_canonical_context_current\s+AS\s+current_projection[\s\S]*JOIN\s+platform\.communication_conversations\s+AS\s+conversation[\s\S]*conversation\.amocrm_account_id\s*=\s*current_projection\.amocrm_account_id[\s\S]*conversation\.amocrm_contact_id\s*=\s*current_projection\.amocrm_contact_id[\s\S]*conversation\.amocrm_lead_id\s*=\s*current_projection\.amocrm_lead_id/i
    );
    expect(platformAmoCrmCanonicalContextMigration).toMatch(
      /GRANT\s+EXECUTE\s+ON\s+FUNCTION[\s\S]*platform\.staff_amocrm_canonical_context\(UUID,\s*UUID\)[\s\S]*TO\s+authenticated/i
    );

    const staffResult = platformAmoCrmCanonicalContextMigration.match(
      /platform\.staff_amocrm_canonical_context\([\s\S]*?RETURNS\s+TABLE\s*\(([\s\S]*?)\)\s*LANGUAGE/i
    )?.[1];
    expect(staffResult).toBeDefined();
    expect(staffResult).not.toMatch(
      /amocrm_(?:account|contact|lead)_id|responsible_user_id|pipeline_id|status_id|provider_body|token|secret/i
    );
  });

  it('adds private P5F1 AI memory with degraded lexical retrieval only', () => {
    const privateTables = [
      'conversation_ai_memory_versions',
      'conversation_ai_fact_versions',
      'conversation_ai_qualification_versions',
      'conversation_ai_control_events',
      'approved_knowledge_chunk_sets',
      'approved_knowledge_chunks',
      'approved_knowledge_chunk_embeddings',
      'ai_retrieval_requests',
      'ai_retrieval_evidence',
    ];

    for (const table of privateTables) {
      expect(platformAiMemoryRetrievalMigration).toMatch(
        new RegExp(`CREATE\\s+TABLE\\s+platform_private\\.${table}`, 'i')
      );
      expect(platformAiMemoryRetrievalMigration).toMatch(
        new RegExp(
          `ALTER\\s+TABLE\\s+platform_private\\.${table}\\s+ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY`,
          'i'
        )
      );
      expect(platformAiMemoryRetrievalMigration).toMatch(
        new RegExp(
          `ALTER\\s+TABLE\\s+platform_private\\.${table}\\s+FORCE\\s+ROW\\s+LEVEL\\s+SECURITY`,
          'i'
        )
      );
    }

    const tableRevoke = platformAiMemoryRetrievalMigration.match(
      /REVOKE\s+ALL\s+ON\s+TABLE([\s\S]*?)FROM\s+PUBLIC,\s*anon,\s*authenticated,\s*service_role,\s*supabase_auth_admin/i
    )?.[1];
    expect(tableRevoke).toBeDefined();
    for (const table of privateTables) {
      expect(tableRevoke).toMatch(
        new RegExp(`platform_private\\.${table}`, 'i')
      );
    }

    expect(platformAiMemoryRetrievalMigration).toMatch(
      /CREATE\s+TYPE\s+platform\.ai_memory_fact_key\s+AS\s+ENUM\s*\(\s*'preferred_country',\s*'preferred_program',\s*'budget_signal',\s*'intake_target',\s*'preferred_language',\s*'urgency',\s*'blockers',\s*'promised_follow_up',\s*'unanswered_questions'\s*\)/i
    );
    expect(platformAiMemoryRetrievalMigration).toMatch(
      /CREATE\s+TYPE\s+platform\.ai_qualification_status\s+AS\s+ENUM\s*\(\s*'collecting',\s*'ready_for_staff_review',\s*'staff_confirmed',\s*'not_a_fit'\s*\)/i
    );
    expect(platformAiMemoryRetrievalMigration).toMatch(
      /CREATE\s+TYPE\s+platform\.ai_control_state\s+AS\s+ENUM\s*\(\s*'paused',\s*'staff_takeover',\s*'staff_only'\s*\)/i
    );
    expect(platformAiMemoryRetrievalMigration).toMatch(
      /embedding\s+public\.vector\(1536\)/i
    );
    expect(platformAiMemoryRetrievalMigration).toMatch(
      /search_vector\s+TSVECTOR\s+GENERATED\s+ALWAYS\s+AS\s*\(\s*to_tsvector\('simple',\s*content_text\)\s*\)\s+STORED/i
    );
    expect(platformAiMemoryRetrievalMigration).toMatch(
      /CREATE\s+INDEX\s+approved_knowledge_chunks_fts_idx[\s\S]*?USING\s+GIN\s*\(search_vector\)/i
    );
    expect(platformAiMemoryRetrievalMigration).not.toMatch(/USING\s+HNSW/i);

    for (const rpc of [
      'staff_conversation_ai_memory',
      'record_conversation_ai_memory',
      'record_conversation_ai_fact',
      'record_conversation_ai_qualification',
      'set_conversation_ai_control',
      'publish_approved_knowledge_chunk_set',
      'preview_approved_knowledge_lexical',
      'staff_ai_retrieval_evidence',
      'staff_ai_retrieval_capabilities',
    ]) {
      const declaration = platformAiMemoryRetrievalMigration.match(
        new RegExp(
          `CREATE\\s+OR\\s+REPLACE\\s+FUNCTION\\s+platform\\.${rpc}\\s*\\([\\s\\S]*?SECURITY\\s+DEFINER[\\s\\S]*?SET\\s+search_path\\s*=\\s*''[\\s\\S]*?AS\\s+\\$\\$`,
          'i'
        )
      )?.[0];
      expect(declaration).toBeDefined();
    }

    expect(platformAiMemoryRetrievalMigration).toMatch(
      /platform\.record_conversation_ai_memory\s*\(\s*p_organization_id\s+UUID,\s*p_conversation_id\s+UUID,\s*p_expected_version\s+BIGINT,\s*p_short_summary\s+TEXT,\s*p_long_summary\s+TEXT,\s*p_source_message_id\s+UUID,\s*p_reason\s+TEXT,\s*p_request_id\s+UUID\s*\)/i
    );
    expect(platformAiMemoryRetrievalMigration).toMatch(
      /platform\.record_conversation_ai_fact\s*\(\s*p_organization_id\s+UUID,\s*p_conversation_id\s+UUID,\s*p_fact_key\s+TEXT,\s*p_expected_version\s+BIGINT,\s*p_status\s+TEXT,\s*p_value\s+JSONB,\s*p_source_message_id\s+UUID,\s*p_reason\s+TEXT,\s*p_request_id\s+UUID\s*\)/i
    );
    expect(platformAiMemoryRetrievalMigration).toMatch(
      /platform\.preview_approved_knowledge_lexical\s*\(\s*p_organization_id\s+UUID,\s*p_conversation_id\s+UUID,\s*p_source_message_ref\s+TEXT,\s*p_limit\s+INTEGER,\s*p_reason\s+TEXT,\s*p_request_id\s+UUID\s*\)/i
    );
    expect(platformAiMemoryRetrievalMigration).toMatch(
      /exact_source_message_id\s*:=\s*p_source_message_ref::UUID[\s\S]*?message\.direction\s*=\s*'inbound'/i
    );

    const memoryResult = platformAiMemoryRetrievalMigration.match(
      /platform\.staff_conversation_ai_memory\([\s\S]*?RETURNS\s+TABLE\s*\(([\s\S]*?)\)\s*LANGUAGE/i
    )?.[1];
    expect(memoryResult).toBeDefined();
    expect(memoryResult).not.toMatch(
      /waha|phone|kommo|amocrm|embedding|score|distance|query|hash|chunk|secret|token/i
    );

    const evidenceResult = platformAiMemoryRetrievalMigration.match(
      /platform\.staff_ai_retrieval_evidence\([\s\S]*?RETURNS\s+TABLE\s*\(([\s\S]*?)\)\s*LANGUAGE/i
    )?.[1];
    expect(evidenceResult).toBeDefined();
    expect(evidenceResult).not.toMatch(
      /knowledge_version_id|chunk_id|content_text|embedding|score|distance|query|hash|waha|phone|kommo|amocrm|secret|token/i
    );
    expect(evidenceResult).toMatch(
      /retrieval_request_id\s+UUID[\s\S]*source_message_id\s+UUID[\s\S]*knowledge_key\s+TEXT[\s\S]*knowledge_version\s+BIGINT/i
    );

    expect(platformAiMemoryRetrievalMigration).toMatch(
      /RETURN\s+QUERY\s+SELECT\s+'gemini-embedding-2'::TEXT,\s*1536,\s*FALSE,\s*FALSE,\s*TRUE,\s*TRUE,\s*FALSE,\s*'blocked'::TEXT/i
    );
    expect(platformAiMemoryRetrievalMigration).toMatch(
      /GRANT\s+EXECUTE\s+ON\s+FUNCTION[\s\S]*?platform\.staff_ai_retrieval_capabilities\(UUID,\s*UUID\)[\s\S]*?TO\s+authenticated/i
    );
    expect(platformAiMemoryRetrievalMigration).not.toMatch(
      /GRANT\s+EXECUTE\s+ON\s+FUNCTION[\s\S]*?TO\s+service_role/i
    );
    expect(platformAiMemoryRetrievalMigration).not.toMatch(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+platform\.[a-z0-9_]*(?:semantic|embedding|provider)[a-z0-9_]*\s*\(/i
    );
    expect(platformAiMemoryRetrievalMigration).not.toMatch(
      /INSERT\s+INTO\s+platform_private\.approved_knowledge_chunk_embeddings/i
    );
    expect(platformAiMemoryRetrievalMigration).not.toMatch(
      /(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+platform\.(?:ai_drafts|manual_send_authorizations|durable_work_items)/i
    );
    expect(platformAiMemoryRetrievalMigration).not.toMatch(/\bresume\b/i);

    for (const table of [
      'gemini_proposal_requests',
      'gemini_proposal_results',
    ]) {
      expect(platformGeminiProposalsMigration).toMatch(
        new RegExp(`CREATE\\s+TABLE\\s+platform_private\\.${table}`, 'i')
      );
      expect(platformGeminiProposalsMigration).toMatch(
        new RegExp(
          `ALTER\\s+TABLE\\s+platform_private\\.${table}\\s+ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY`,
          'i'
        )
      );
      expect(platformGeminiProposalsMigration).toMatch(
        new RegExp(
          `ALTER\\s+TABLE\\s+platform_private\\.${table}\\s+FORCE\\s+ROW\\s+LEVEL\\s+SECURITY`,
          'i'
        )
      );
    }

    for (const rpc of [
      'begin_gemini_proposal',
      'finish_gemini_proposal',
      'staff_gemini_proposal',
    ]) {
      expect(platformGeminiProposalsMigration).toMatch(
        new RegExp(
          `CREATE\\s+OR\\s+REPLACE\\s+FUNCTION\\s+platform\\.${rpc}\\s*\\([\\s\\S]*?SECURITY\\s+DEFINER[\\s\\S]*?SET\\s+search_path\\s*=\\s*''[\\s\\S]*?AS\\s+\\$\\$`,
          'i'
        )
      );
    }

    expect(platformGeminiProposalsMigration).toMatch(
      /model_ref\s+TEXT\s+NOT\s+NULL\s+CHECK\s*\(model_ref\s*=\s*'gemini-3\.5-flash'\)/i
    );
    expect(platformGeminiProposalsMigration).toMatch(
      /human_review_required\s+BOOLEAN\s+NOT\s+NULL\s+DEFAULT\s+TRUE\s+CHECK\s*\(\s*human_review_required\s*=\s*TRUE/i
    );
    expect(platformGeminiProposalsMigration).toMatch(
      /autonomous_authority\s+BOOLEAN\s+NOT\s+NULL\s+DEFAULT\s+FALSE\s+CHECK\s*\(\s*autonomous_authority\s*=\s*FALSE/i
    );
    expect(platformGeminiProposalsMigration).toMatch(
      /provider_proof_state\s+TEXT\s+NOT\s+NULL\s+DEFAULT\s+'blocked'\s+CHECK\s*\(\s*provider_proof_state\s*=\s*'blocked'/i
    );
    expect(platformGeminiProposalsMigration).toMatch(
      /private_provider_status\s+TEXT\s+NOT\s+NULL\s+CHECK\s*\(\s*platform_private\.gemini_proposal_provider_status_is_valid/i
    );
    expect(platformGeminiProposalsMigration).toMatch(
      /outcome\s*=\s*'proposal_ready'[\s\S]*?private_provider_status\s*=\s*'completed'/i
    );
    expect(platformGeminiProposalsMigration).toMatch(
      /platform\.finish_gemini_proposal\s*\(\s*p_organization_id\s+UUID,\s*p_conversation_id\s+UUID,\s*p_source_message_id\s+UUID,\s*p_proposal_request_id\s+UUID,\s*p_outcome\s+TEXT,\s*p_failure_code\s+TEXT,\s*p_prompt_text\s+TEXT,\s*p_provider_interaction_ref\s+TEXT,\s*p_provider_status\s+TEXT,\s*p_response_json\s+JSONB\s*\)/i
    );
    expect(platformGeminiProposalsMigration).toMatch(
      /message\.direction\s*=\s*'inbound'[\s\S]*?NOT\s+EXISTS[\s\S]*?later_message/i
    );

    const proposalResult = platformGeminiProposalsMigration.match(
      /platform\.staff_gemini_proposal\([\s\S]*?RETURNS\s+TABLE\s*\(([\s\S]*?)\)\s*LANGUAGE/i
    )?.[1];
    expect(proposalResult).toBeDefined();
    expect(proposalResult).not.toMatch(
      /context|prompt|provider_interaction|provider_status|response_json|hash|waha|phone|kommo|amocrm|secret|token/i
    );
    expect(platformGeminiProposalsMigration).toMatch(
      /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+platform\.begin_gemini_proposal[\s\S]*?TO\s+service_role/i
    );
    expect(platformGeminiProposalsMigration).toMatch(
      /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+platform\.finish_gemini_proposal[\s\S]*?TO\s+service_role/i
    );
    expect(platformGeminiProposalsMigration).toMatch(
      /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+platform\.staff_gemini_proposal\(UUID,\s*UUID\)[\s\S]*?TO\s+authenticated/i
    );
    expect(platformGeminiProposalsMigration).not.toMatch(
      /(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+platform\.(?:communication_messages|manual_send_authorizations|durable_work_items|conversation_ai_memory_versions|conversation_ai_fact_versions|conversation_ai_qualification_versions)/i
    );
  });

  it('contains P5F3 autonomous transport behind exact staff and service RPCs', () => {
    for (const table of [
      'conversation_autonomy_control_events',
      'autonomous_reply_gate_decisions',
      'autonomous_reply_intents',
      'autonomous_reply_intent_lifecycle',
      'autonomous_reply_attempts',
      'autonomous_reply_claim_receipts',
      'autonomous_reply_attempt_results',
      'autonomous_reply_provider_bindings',
    ]) {
      expect(platformAutonomousRepliesMigration).toMatch(
        new RegExp(`CREATE\\s+TABLE\\s+platform_private\\.${table}`, 'i')
      );
      expect(platformAutonomousRepliesMigration).toMatch(
        new RegExp(
          `ALTER\\s+TABLE\\s+platform_private\\.${table}\\s+ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY`,
          'i'
        )
      );
      expect(platformAutonomousRepliesMigration).toMatch(
        new RegExp(
          `ALTER\\s+TABLE\\s+platform_private\\.${table}\\s+FORCE\\s+ROW\\s+LEVEL\\s+SECURITY`,
          'i'
        )
      );
    }

    expect(platformAutonomousRepliesMigration).toMatch(
      /platform\.set_conversation_autonomy_control\s*\(\s*p_organization_id\s+UUID,\s*p_conversation_id\s+UUID,\s*p_expected_version\s+BIGINT,\s*p_state\s+TEXT,\s*p_reason\s+TEXT,\s*p_request_id\s+UUID\s*\)/i
    );
    expect(platformAutonomousRepliesMigration).toMatch(
      /platform\.claim_autonomous_reply\s*\(\s*p_organization_id\s+UUID,\s*p_worker_ref\s+TEXT,\s*p_visibility_timeout_seconds\s+INTEGER,\s*p_policy_version\s+TEXT,\s*p_request_id\s+UUID\s*\)/i
    );
    expect(platformAutonomousRepliesMigration).toMatch(
      /platform\.finish_autonomous_reply\s*\(\s*p_organization_id\s+UUID,\s*p_intent_id\s+UUID,\s*p_attempt_id\s+UUID,\s*p_outcome\s+TEXT,\s*p_error_code\s+TEXT,\s*p_provider_message_id\s+TEXT,\s*p_provider_observed_at\s+TIMESTAMPTZ,\s*p_request_id\s+UUID\s*\)/i
    );
    expect(platformAutonomousRepliesMigration).toMatch(
      /platform\.staff_conversation_autonomous_reply_state\s*\(\s*p_organization_id\s+UUID,\s*p_conversation_id\s+UUID\s*\)/i
    );
    expect(platformAutonomousRepliesMigration).toMatch(
      /A claimed autonomous reply request cannot be replayed/i
    );
    expect(platformAutonomousRepliesMigration).toMatch(
      /platform_private\.p5f3_policy_now\(\)[\s\S]*?SELECT\s+pg_catalog\.statement_timestamp\(\)/i
    );
    expect(platformAutonomousRepliesMigration).toMatch(
      /inside_reply_window[\s\S]*?policy_now\s*-\s*INTERVAL\s*'24 hours'\s+AND\s+policy_now[\s\S]*?business_hours[\s\S]*?policy_now\s+AT\s+TIME\s+ZONE\s+'Asia\/Bishkek'/i
    );
    expect(
      platformAutonomousRepliesMigration.match(/evo:p5f3:conversation:/gi)
        ?.length
    ).toBeGreaterThanOrEqual(4);
    expect(platformAutonomousRepliesMigration).toMatch(
      /'mutable_gate_blocked'[\s\S]*?INSERT\s+INTO\s+platform\.conversation_autonomous_reply_state[\s\S]*?'manual_review'[\s\S]*?autonomous_authority\s*=\s*FALSE/i
    );
    expect(platformAutonomousRepliesMigration).toMatch(
      /CREATE\s+TRIGGER\s+conversation_autonomous_reply_state_realtime_invalidate[\s\S]*?platform_private\.broadcast_platform_messaging_invalidation\s*\(\s*'autonomous_reply'\s*\)/i
    );
    expect(platformAutonomousRepliesMigration).toMatch(
      /message_identity_source\s*=\s*'private_autonomous_reply_binding'/i
    );
    expect(platformAutonomousRepliesMigration).not.toMatch(
      /GRANT\s+(?:SELECT|INSERT|UPDATE|DELETE|ALL)[\s\S]*?platform_private\.autonomous_reply/i
    );
  });
});
