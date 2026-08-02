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
const platformAdmissionsMigration = readFileSync(
  join(migrationsDir, '042_platform_student_admissions.sql'),
  'utf8'
)
const platformDocumentsFinanceNotificationsMigration = readFileSync(
  join(
    migrationsDir,
    '043_platform_documents_finance_notifications.sql'
  ),
  'utf8'
)
const platformCommunicationsMigration = readFileSync(
  join(migrationsDir, '044_platform_communications_contracts.sql'),
  'utf8'
)
const platformQueuesMigration = readFileSync(
  join(migrationsDir, '045_platform_durable_work_queues.sql'),
  'utf8'
)
const platformDocumentStorageMigration = readFileSync(
  join(migrationsDir, '046_platform_private_document_storage.sql'),
  'utf8'
)
const platformCurrentActorAuthorityMigration = readFileSync(
  join(migrationsDir, '047_platform_current_actor_authority.sql'),
  'utf8'
)
const platformCommunicationsReadAuthorityMigration = readFileSync(
  join(migrationsDir, '048_platform_communications_read_authority.sql'),
  'utf8'
)
const platformMessagingControllerHardeningMigration = readFileSync(
  join(
    migrationsDir,
    '050_platform_messaging_workflow_controller_hardening.sql'
  ),
  'utf8'
)
const platformBusinessWorkflowContractsMigration = readFileSync(
  join(
    migrationsDir,
    '051_platform_business_workflow_contracts.sql'
  ),
  'utf8'
)
const platformWorkflowCaseBindingsMigration = readFileSync(
  join(migrationsDir, '052_platform_workflow_case_bindings.sql'),
  'utf8'
)
const platformStudentProfileRequirementsMigration = readFileSync(
  join(migrationsDir, '053_platform_student_profile_requirements.sql'),
  'utf8'
)
const platformDecisionPromptLifecycleMigration = readFileSync(
  join(migrationsDir, '054_platform_decision_prompt_lifecycle.sql'),
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
  it('preserves containment through the current platform migration boundary', () => {
    expect(migrationFiles.at(-1)).toBe(
      '055_platform_document_finalization_lock_order.sql'
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
    expect(platformDecisionPromptLifecycleMigration).toMatch(
      /CREATE\s+TABLE\s+platform_private\.ai_prompt_artifact_versions/i
    )
    expect(platformDecisionPromptLifecycleMigration).toMatch(
      /CREATE\s+TABLE\s+platform\.decision_backlogs/i
    )
    expect(platformDecisionPromptLifecycleMigration).toMatch(
      /ALTER\s+TABLE\s+platform\.decision_backlogs\s+FORCE\s+ROW\s+LEVEL\s+SECURITY/i
    )
    expect(platformIdentityMigration).toMatch(
      /CREATE\s+TABLE\s+platform\.organization_memberships/i
    )
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
      )
      expect(platformBusinessWorkflowContractsMigration).toMatch(
        new RegExp(
          `ALTER\\s+TABLE\\s+platform\\.${table}\\s+FORCE\\s+ROW\\s+LEVEL\\s+SECURITY`,
          'i'
        )
      )
    }
    expect(platformBusinessWorkflowContractsMigration).not.toMatch(
      /ALTER\s+TABLE\s+platform\.student_cases/i
    )
    expect(platformWorkflowCaseBindingsMigration).toMatch(
      /ALTER\s+TABLE\s+platform\.student_cases[\s\S]*ADD\s+COLUMN\s+applied_ozo_workflow_contract_version_id\s+UUID/i
    )
    expect(platformWorkflowCaseBindingsMigration).toMatch(
      /CREATE\s+TABLE\s+platform\.student_case_op_handoffs/i
    )
    expect(platformWorkflowCaseBindingsMigration).toMatch(
      /ALTER\s+TABLE\s+platform\.student_case_op_handoffs\s+FORCE\s+ROW\s+LEVEL\s+SECURITY/i
    )
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
      )
    }
    expect(platformWorkflowCaseBindingsMigration).not.toMatch(
      /CREATE\s+TABLE\s+platform\.(?:leads?|contacts?|sales_pipeline)/i
    )
    for (const table of [
      'student_profiles',
      'country_requirement_versions',
      'country_requirement_version_sources',
    ]) {
      expect(platformStudentProfileRequirementsMigration).toMatch(
        new RegExp(`CREATE\\s+TABLE\\s+platform\\.${table}`, 'i')
      )
      expect(platformStudentProfileRequirementsMigration).toMatch(
        new RegExp(
          `ALTER\\s+TABLE\\s+platform\\.${table}\\s+FORCE\\s+ROW\\s+LEVEL\\s+SECURITY`,
          'i'
        )
      )
    }
    expect(platformStudentProfileRequirementsMigration).toMatch(
      /ALTER\s+TABLE\s+platform\.student_cases[\s\S]*ADD\s+COLUMN\s+applied_country_requirement_version_id\s+UUID/i
    )
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
      )
    }
    expect(platformStudentProfileRequirementsMigration).toMatch(
      /CREATE\s+TRIGGER\s+document_requirements_approved_manifest_guard[\s\S]*BEFORE\s+INSERT\s+OR\s+UPDATE\s+OR\s+DELETE\s+ON\s+platform\.document_requirements/i
    )
    expect(platformStudentProfileRequirementsMigration).not.toMatch(
      /CREATE\s+TABLE\s+platform\.(?:checklists?|documents?)(?:\s|\()/i
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
    expect(platformCurrentActorAuthorityMigration).toMatch(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+platform\.current_actor_authority\s*\(\s*\)/i
    )
    expect(platformCurrentActorAuthorityMigration).toMatch(
      /REVOKE\s+ALL\s+ON\s+FUNCTION\s+platform\.current_actor_authority\s*\(\s*\)\s+FROM\s+PUBLIC,\s*anon,\s*authenticated,\s*service_role,\s*supabase_auth_admin/i
    )
    expect(platformCurrentActorAuthorityMigration).toMatch(
      /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+platform\.current_actor_authority\s*\(\s*\)\s+TO\s+authenticated/i
    )
    expect(platformCommunicationsReadAuthorityMigration).toMatch(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+platform_private\.require_domain_actor_read\s*\(\s*p_organization_id\s+UUID,\s*p_permission_key\s+TEXT\s*\)[\s\S]*STABLE[\s\S]*SECURITY\s+DEFINER/i
    )
    expect(platformCommunicationsReadAuthorityMigration).toMatch(
      /REVOKE\s+ALL\s+ON\s+FUNCTION\s+platform_private\.require_domain_actor_read\s*\(\s*UUID,\s*TEXT\s*\)\s+FROM\s+PUBLIC,\s*anon,\s*authenticated,\s*service_role,\s*supabase_auth_admin/i
    )
    expect(platformCommunicationsReadAuthorityMigration).toMatch(
      /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+platform\.staff_communication_queue\s*\(\s*UUID\s*\),\s*platform\.staff_conversation_messages\s*\(\s*UUID,\s*UUID\s*\)\s+TO\s+authenticated/i
    )
    expect(supabaseConfig).not.toMatch(
      /schemas\s*=.*(?:platform_private|pgmq_public)/
    )
  })

  it('hardens P3C manual messaging, cycle binding, and public health projection', () => {
    expect(platformMessagingControllerHardeningMigration).toMatch(
      /ALTER\s+TABLE\s+platform\.manual_send_authorizations[\s\S]*ADD\s+COLUMN\s+source_message_id\s+UUID[\s\S]*ALTER\s+COLUMN\s+ai_draft_id\s+DROP\s+NOT\s+NULL/i
    )
    expect(platformMessagingControllerHardeningMigration).toMatch(
      /DROP\s+FUNCTION\s+platform\.request_manual_whatsapp_send_with_authorization\s*\(\s*UUID,\s*UUID,\s*TEXT,\s*TEXT,\s*TEXT,\s*UUID\s*\)/i
    )
    expect(platformMessagingControllerHardeningMigration).toMatch(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+platform\.request_manual_whatsapp_send_with_authorization\s*\(\s*p_organization_id\s+UUID,\s*p_conversation_id\s+UUID,\s*p_source_message_id\s+UUID,\s*p_ai_draft_id\s+UUID/i
    )
    expect(platformMessagingControllerHardeningMigration).toMatch(
      /INTERVAL\s+'5 minutes'/i
    )
    expect(platformMessagingControllerHardeningMigration).toMatch(
      /INTERVAL\s+'1 minute'/i
    )

    const publicWorkflowSignature =
      platformMessagingControllerHardeningMigration.match(
        /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+platform\.staff_conversation_workflow[\s\S]*?RETURNS\s+TABLE\s*\(([\s\S]*?)\)\s*LANGUAGE/i
      )?.[1] ?? ''
    expect(publicWorkflowSignature).toMatch(/ai_readiness_fresh\s+BOOLEAN/i)
    expect(publicWorkflowSignature).toMatch(/waha_readiness_fresh\s+BOOLEAN/i)
    expect(publicWorkflowSignature).not.toMatch(
      /readiness_(?:reason|evidence_ref)/i
    )
    expect(platformMessagingControllerHardeningMigration).toMatch(
      /p_max_attempts\s*<>\s*1/i
    )
  })

  it('declares one private Platform document bucket and service-only download signing', () => {
    const bucketDeclarations = Array.from(
      supabaseConfig.matchAll(/^\[storage\.buckets\.([^\]]+)\]$/gm),
      (match) => match[1]
    )

    expect(bucketDeclarations).toEqual(['platform-documents'])
    expect(supabaseConfig).toMatch(
      /\[storage\.buckets\.platform-documents\]\s*public\s*=\s*false\s*file_size_limit\s*=\s*"25MiB"\s*allowed_mime_types\s*=\s*\["application\/pdf",\s*"image\/jpeg",\s*"image\/png"\]/m
    )
    expect(platformDocumentStorageMigration).toMatch(
      /CREATE\s+TABLE\s+platform_private\.document_upload_reservations/i
    )
    expect(platformDocumentStorageMigration).toMatch(
      /CREATE\s+TABLE\s+platform_private\.document_storage_bindings/i
    )
    expect(platformDocumentStorageMigration).toMatch(
      /CREATE\s+TABLE\s+platform_private\.document_upload_finalizations/i
    )
    expect(platformDocumentStorageMigration).toMatch(
      /CREATE\s+TABLE\s+platform_private\.document_download_grants/i
    )
    expect(platformDocumentStorageMigration).toMatch(
      /CREATE\s+TABLE\s+platform_private\.document_download_consumptions/i
    )
    expect(platformDocumentStorageMigration).toMatch(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+platform\.reserve_document_upload\s*\(\s*p_organization_id\s+UUID,\s*p_document_slot_id\s+UUID,\s*p_original_filename\s+TEXT,\s*p_declared_mime_type\s+TEXT,\s*p_byte_size\s+BIGINT,\s*p_sha256_hex\s+TEXT,\s*p_request_id\s+UUID\s*\)/i
    )
    expect(platformDocumentStorageMigration).toMatch(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+platform\.finalize_document_upload\s*\(\s*p_organization_id\s+UUID,\s*p_upload_reservation_id\s+UUID,\s*p_request_id\s+UUID\s*\)[\s\S]*service_role is required to finalize a document upload[\s\S]*FROM\s+storage\.objects[\s\S]*object_row\.created_at\s*>\s*reservation\.expires_at[\s\S]*UPDATE\s+platform\.document_slots[\s\S]*INSERT\s+INTO\s+platform_private\.document_upload_finalizations/i
    )
    expect(platformDocumentStorageMigration).toMatch(
      /SELECT\s+COALESCE\s*\(\s*MAX\s*\(\s*version\.version_no\s*\),\s*0\s*\)\s*\+\s*1[\s\S]*FROM\s+platform\.document_versions\s+AS\s+version/i
    )
    expect(platformDocumentStorageMigration).not.toMatch(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+platform\.reserve_document_upload[\s\S]*?UPDATE\s+platform\.document_slots[\s\S]*?CREATE\s+OR\s+REPLACE\s+FUNCTION\s+platform\.finalize_document_upload/i
    )
    expect(platformDocumentStorageMigration).toMatch(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+platform\.grant_document_download\s*\(\s*p_organization_id\s+UUID,\s*p_document_version_id\s+UUID,\s*p_access_purpose\s+TEXT,\s*p_expires_in_seconds\s+INTEGER,\s*p_request_id\s+UUID\s*\)/i
    )
    const downloadGrantFunction =
      platformDocumentStorageMigration.match(
        /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+platform\.grant_document_download[\s\S]*?END\s*\$\$;/i
      )?.[0] ?? ''
    expect(downloadGrantFunction).toMatch(
      /SELECT\s+\*\s+INTO\s+case_row\s+FROM\s+platform\.student_cases\s+AS\s+student_case[\s\S]*?FOR\s+UPDATE;[\s\S]*?SELECT\s+\*\s+INTO\s+version_row\s+FROM\s+platform\.document_versions\s+AS\s+version[\s\S]*?version\.student_case_id\s*=\s*case_row\.id[\s\S]*?FOR\s+UPDATE;[\s\S]*?Re-evaluate record scope after both locks/i
    )
    expect(downloadGrantFunction).not.toMatch(
      /FOR\s+UPDATE\s+OF\s+version,\s*student_case/i
    )
    expect(platformDocumentStorageMigration).toMatch(
      /char_length\s*\(\s*btrim\s*\(\s*p_original_filename\s*\)\s*\)\s*>\s*255[\s\S]*octet_length\s*\(\s*btrim\s*\(\s*p_original_filename\s*\)\s*\)\s*>\s*1024/i
    )
    expect(platformDocumentStorageMigration).toMatch(
      /char_length\s*\(\s*btrim\s*\(\s*p_access_purpose\s*\)\s*\)\s*>\s*255[\s\S]*octet_length\s*\(\s*btrim\s*\(\s*p_access_purpose\s*\)\s*\)\s*>\s*1024/i
    )
    expect(platformDocumentStorageMigration).toMatch(
      /VALIDATE\s+CONSTRAINT\s+document_versions_original_filename_size_check[\s\S]*VALIDATE\s+CONSTRAINT\s+document_access_events_purpose_size_check/i
    )
    expect(platformDocumentStorageMigration).toMatch(
      /actor_hourly_limit\s+CONSTANT\s+INTEGER\s*:=\s*60[\s\S]*slot_hourly_limit\s+CONSTANT\s+INTEGER\s*:=\s*12[\s\S]*'A document upload is already in progress'[\s\S]*ERRCODE\s*=\s*'PT409'[\s\S]*'Document upload request limit reached'[\s\S]*ERRCODE\s*=\s*'PT429'/i
    )
    expect(platformDocumentStorageMigration).toMatch(
      /reservation\.expires_at\s*>\s*reservation_created_at[\s\S]*FROM\s+platform_private\.document_upload_finalizations\s+AS\s+finalization[\s\S]*finalization\.upload_reservation_id\s*=\s*reservation\.id/i
    )
    expect(platformDocumentStorageMigration).toMatch(
      /actor_hourly_limit\s+CONSTANT\s+INTEGER\s*:=\s*120[\s\S]*'A document download grant is already active'[\s\S]*ERRCODE\s*=\s*'PT409'[\s\S]*'Document download request limit reached'[\s\S]*ERRCODE\s*=\s*'PT429'/i
    )
    expect(platformDocumentStorageMigration).toMatch(
      /'evo:p2h:upload-actor:'[\s\S]*p_organization_id::TEXT[\s\S]*actor\.actor_auth_user_id::TEXT/i
    )
    expect(platformDocumentStorageMigration).toMatch(
      /'evo:p2h:download-actor:'[\s\S]*p_organization_id::TEXT[\s\S]*actor\.actor_auth_user_id::TEXT/i
    )
    expect(platformDocumentStorageMigration).toMatch(
      /WHERE\s+reservation\.organization_id\s*=\s*p_organization_id\s+AND\s+reservation\.uploader_auth_user_id\s*=\s*actor\.actor_auth_user_id[\s\S]*reservation\.created_at\s*>/i
    )
    expect(platformDocumentStorageMigration).toMatch(
      /WHERE\s+download_grant\.organization_id\s*=\s*p_organization_id\s+AND\s+download_grant\.grantee_auth_user_id\s*=\s*actor\.actor_auth_user_id[\s\S]*download_grant\.created_at\s*>/i
    )
    expect(platformDocumentStorageMigration).toMatch(
      /require_domain_actor\s*\(\s*p_organization_id,\s*'document\.upload'\s*\)[\s\S]*FROM\s+platform\.document_slots\s+AS\s+slot[\s\S]*'Document is unavailable'[\s\S]*ERRCODE\s*=\s*'42501'/i
    )
    expect(platformDocumentStorageMigration).toMatch(
      /require_domain_actor\s*\(\s*p_organization_id,\s*'document\.download'\s*\)[\s\S]*FROM\s+platform\.document_versions\s+AS\s+version[\s\S]*'Document is unavailable'[\s\S]*ERRCODE\s*=\s*'42501'/i
    )
    const reservedUploadPolicyHelper =
      platformDocumentStorageMigration.match(
        /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+private\.platform_can_upload_reserved_document[\s\S]*?\n\$\$;/i
      )?.[0] ?? ''
    expect(reservedUploadPolicyHelper).not.toMatch(
      /slot\.current_version_id\s*=\s*reservation\.document_version_id/i
    )
    expect(platformDocumentStorageMigration).toMatch(
      /result\s*:=\s*jsonb_build_object\s*\(\s*'document_download_grant_id',\s*grant_id,\s*'expires_at',\s*grant_expires_at,\s*'signed_url',\s*NULL,\s*'storage_api_service_sign_required',\s*TRUE\s*\);/i
    )
    expect(platformDocumentStorageMigration).toMatch(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+platform\.consume_document_download_grant\s*\(\s*p_document_download_grant_id\s+UUID,\s*p_request_id\s+UUID\s*\)[\s\S]*REVOKE\s+ALL\s+ON\s+FUNCTION\s+platform\.consume_document_download_grant\s*\(\s*UUID,\s*UUID\s*\)\s+FROM\s+PUBLIC,\s*anon,\s*authenticated,\s*service_role,\s*supabase_auth_admin[\s\S]*GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+platform\.consume_document_download_grant\s*\(\s*UUID,\s*UUID\s*\)\s+TO\s+service_role/i
    )
    expect(platformDocumentStorageMigration).toMatch(
      /'max_signed_url_expires_in_seconds',\s*remaining_seconds[\s\S]*'signed_url',\s*NULL[\s\S]*'storage_api_service_sign_required',\s*TRUE/i
    )
    expect(platformDocumentStorageMigration).toMatch(
      /CREATE\s+POLICY\s+"Platform document reserved upload"[\s\S]*FOR\s+INSERT\s+TO\s+authenticated[\s\S]*bucket_id\s*=\s*'platform-documents'[\s\S]*storage\.allow_only_operation\s*\(\s*'storage\.object\.upload'\s*\)/i
    )
    expect(platformDocumentStorageMigration).toMatch(
      /DROP\s+POLICY\s+IF\s+EXISTS\s+"Platform document audited single sign"\s+ON\s+storage\.objects/i
    )
    expect(platformDocumentStorageMigration).not.toMatch(
      /CREATE\s+POLICY\s+[^;]*\s+ON\s+storage\.objects[^;]*\s+FOR\s+SELECT\b[^;]*;/i
    )
    expect(platformDocumentStorageMigration).toMatch(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+platform\.document_storage_backup_inventory\s*\(\s*\)\s*RETURNS\s+TABLE\s*\(\s*organization_id\s+UUID,\s*document_version_id\s+UUID,\s*student_case_id\s+UUID,\s*document_slot_id\s+UUID,\s*bucket_id\s+TEXT,\s*object_name\s+TEXT,\s*storage_object_id\s+UUID,\s*binding_present\s+BOOLEAN,\s*storage_object_present\s+BOOLEAN,\s*expected_byte_size\s+BIGINT,\s*expected_sha256_hex\s+TEXT,\s*storage_reported_byte_size\s+BIGINT,\s*inventory_state\s+TEXT,\s*binding_created_at\s+TIMESTAMPTZ\s*\)[\s\S]*GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+platform\.document_storage_backup_inventory\s*\(\s*\)\s+TO\s+service_role/i
    )
    expect(platformDocumentStorageMigration).not.toMatch(
      /\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+storage\.(?:buckets|objects)\b/i
    )
    expect(platformDocumentStorageMigration).not.toMatch(
      /document_storage_backup_inventory[\s\S]*RETURNS\s+TABLE\s*\([^)]*(?:original_filename|signed_url|token)/i
    )
    expect(platformDocumentStorageMigration).not.toMatch(
      /CREATE\s+POLICY[\s\S]*FOR\s+(?:UPDATE|DELETE)[\s\S]*platform-documents/i
    )
  })

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
    ]

    for (const table of admissionsTables) {
      expect(platformAdmissionsMigration).toMatch(
        new RegExp(`CREATE\\s+TABLE\\s+platform\\.${table}\\b`, 'i')
      )
      expect(platformAdmissionsMigration).toMatch(
        new RegExp(
          `ALTER\\s+TABLE\\s+platform\\.${table}\\s+ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY`,
          'i'
        )
      )
      expect(platformAdmissionsMigration).toMatch(
        new RegExp(
          `ALTER\\s+TABLE\\s+platform\\.${table}\\s+FORCE\\s+ROW\\s+LEVEL\\s+SECURITY`,
          'i'
        )
      )
    }

    expect(platformAdmissionsMigration).toMatch(
      /CREATE\s+TYPE\s+platform\.visa_status\s+AS\s+ENUM\s*\(\s*'not_required',\s*'not_started',\s*'docs',\s*'appointment',\s*'submitted',\s*'approved',\s*'rejected',\s*'closed'\s*\)/i
    )
    expect(platformAdmissionsMigration).toMatch(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+platform\.assign_student_case_curator[\s\S]*SECURITY\s+DEFINER/i
    )
    expect(platformAdmissionsMigration).toMatch(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+platform\.sales_handoff_summaries\s*\(\s*\)[\s\S]*SECURITY\s+DEFINER/i
    )
    expect(platformAdmissionsMigration).toMatch(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+platform\.student_portal_cases\s*\(\s*\)[\s\S]*SECURITY\s+DEFINER/i
    )
    const admissionsPolicies = platformAdmissionsMigration
      .split(';')
      .filter((statement) => /CREATE\s+POLICY/i.test(statement))

    expect(admissionsPolicies).toHaveLength(admissionsTables.length)
    for (const policy of admissionsPolicies) {
      expect(policy).toMatch(/\bFOR\s+SELECT\b/i)
      expect(policy).not.toMatch(/\bFOR\s+(?:INSERT|UPDATE|DELETE|ALL)\b/i)
    }
  })

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
    ]

    for (const table of p2eTables) {
      expect(platformDocumentsFinanceNotificationsMigration).toMatch(
        new RegExp(`CREATE\\s+TABLE\\s+platform\\.${table}\\b`, 'i')
      )
      expect(platformDocumentsFinanceNotificationsMigration).toMatch(
        new RegExp(
          `ALTER\\s+TABLE\\s+platform\\.${table}\\s+ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY`,
          'i'
        )
      )
      expect(platformDocumentsFinanceNotificationsMigration).toMatch(
        new RegExp(
          `ALTER\\s+TABLE\\s+platform\\.${table}\\s+FORCE\\s+ROW\\s+LEVEL\\s+SECURITY`,
          'i'
        )
      )
    }

    expect(platformDocumentsFinanceNotificationsMigration).toMatch(
      /CREATE\s+TYPE\s+platform\.notification_channel\s+AS\s+ENUM\s*\(\s*'in_app',\s*'individual_whatsapp'\s*\)/i
    )
    expect(platformDocumentsFinanceNotificationsMigration).toMatch(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+platform\.record_document_version_metadata[\s\S]*SECURITY\s+DEFINER[\s\S]*GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+platform\.record_document_version_metadata[\s\S]*TO\s+service_role/i
    )
    expect(platformDocumentsFinanceNotificationsMigration).toMatch(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+platform\.record_payment_event[\s\S]*referenced_payment_event_id[\s\S]*SECURITY\s+DEFINER/i
    )
    expect(platformDocumentsFinanceNotificationsMigration).toMatch(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+platform\.student_portal_finance\s*\(\s*\)[\s\S]*SECURITY\s+DEFINER\s+SET\s+search_path\s*=\s*''/i
    )
    expect(platformDocumentsFinanceNotificationsMigration).toMatch(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+platform\.my_notifications\s*\(\s*\)[\s\S]*SECURITY\s+DEFINER\s+SET\s+search_path\s*=\s*''/i
    )
    expect(platformDocumentsFinanceNotificationsMigration).not.toMatch(
      /\b(provider_message_id|provider_ack|recipient_ids|broadcast_id|campaign_id)\b/i
    )
    expect(platformDocumentsFinanceNotificationsMigration).not.toMatch(
      /\b(?:CREATE|ALTER|DROP)\s+(?:TABLE|POLICY|SCHEMA)\s+storage\b/i
    )
  })

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
    ]
    const privateTables = [
      'provider_webhook_events',
      'provider_reconciliation_events',
    ]
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
    ]
    const createdTables = [
      ...platformCommunicationsMigration.matchAll(
        /CREATE\s+TABLE\s+((?:platform|platform_private)\.[a-z_]+)/gi
      ),
    ].map((match) => match[1].toLowerCase())
    const createdFunctions = [
      ...platformCommunicationsMigration.matchAll(
        /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+platform\.([a-z_]+)/gi
      ),
    ].map((match) => match[1].toLowerCase())

    expect(createdTables).toEqual([
      'platform_private.provider_webhook_events',
      ...platformTables.map((table) => `platform.${table}`),
      'platform_private.provider_reconciliation_events',
    ])
    expect(createdFunctions).toEqual(platformFunctions)

    for (const table of platformTables) {
      expect(platformCommunicationsMigration).toMatch(
        new RegExp(
          `ALTER\\s+TABLE\\s+platform\\.${table}\\s+ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY`,
          'i'
        )
      )
      expect(platformCommunicationsMigration).toMatch(
        new RegExp(
          `ALTER\\s+TABLE\\s+platform\\.${table}\\s+FORCE\\s+ROW\\s+LEVEL\\s+SECURITY`,
          'i'
        )
      )
    }

    for (const table of privateTables) {
      expect(platformCommunicationsMigration).toMatch(
        new RegExp(
          `ALTER\\s+TABLE\\s+platform_private\\.${table}\\s+ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY`,
          'i'
        )
      )
      expect(platformCommunicationsMigration).toMatch(
        new RegExp(
          `ALTER\\s+TABLE\\s+platform_private\\.${table}\\s+FORCE\\s+ROW\\s+LEVEL\\s+SECURITY`,
          'i'
        )
      )
    }

    expect(platformCommunicationsMigration).toMatch(
      /CREATE\s+TABLE\s+platform_private\.provider_webhook_events[\s\S]*provider_account_ref\s+TEXT\s+NOT\s+NULL[\s\S]*provider_conversation_ref\s+TEXT[\s\S]*provider_event_variant_ref\s+TEXT[\s\S]*provider_request_id\s+TEXT\s+NOT\s+NULL[\s\S]*waha_session_name\s+TEXT[\s\S]*payload_id\s+TEXT\s+NOT\s+NULL[\s\S]*event_type\s+TEXT\s+NOT\s+NULL[\s\S]*provider_occurred_at\s+TIMESTAMPTZ\s+NOT\s+NULL[\s\S]*verification_status\s+platform\.webhook_verification_status\s+NOT\s+NULL[\s\S]*raw_payload\s+JSONB\s+NOT\s+NULL[\s\S]*verification_headers\s+JSONB\s+NOT\s+NULL[\s\S]*verification_evidence_ref\s+TEXT\s+NOT\s+NULL[\s\S]*payload_sha256\s+TEXT\s+NOT\s+NULL/i
    )
    expect(platformCommunicationsMigration).toMatch(
      /CONSTRAINT\s+provider_webhook_events_variant_shape_check\s+CHECK[\s\S]*provider\s*=\s*'waha'[\s\S]*event_type\s*=\s*'message\.ack'[\s\S]*provider_event_variant_ref\s+IS\s+NOT\s+NULL[\s\S]*event_type\s*=\s*'message\.any'[\s\S]*provider_event_variant_ref\s+IS\s+NULL/i
    )
    expect(platformCommunicationsMigration).toMatch(
      /CREATE\s+UNIQUE\s+INDEX\s+provider_webhook_events_waha_business_key[\s\S]*organization_id,\s*provider_account_ref,\s*waha_session_name,\s*event_type,\s*payload_id,\s*COALESCE\s*\(\s*provider_event_variant_ref,\s*''\s*\)[\s\S]*WHERE\s+provider\s*=\s*'waha'/i
    )
    expect(platformCommunicationsMigration).toMatch(
      /CONSTRAINT\s+provider_webhook_events_provider_request_key\s+UNIQUE\s*\(\s*organization_id,\s*provider,\s*provider_account_ref,\s*provider_request_id\s*\)/i
    )
    expect(platformCommunicationsMigration).toMatch(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+platform\.persist_provider_webhook_event\s*\(\s*p_organization_id\s+UUID,\s*p_provider\s+platform\.communication_provider,\s*p_provider_account_ref\s+TEXT,\s*p_provider_conversation_ref\s+TEXT,\s*p_provider_event_variant_ref\s+TEXT,\s*p_provider_request_id\s+TEXT,\s*p_waha_session_name\s+TEXT,\s*p_payload_id\s+TEXT,\s*p_event_type\s+TEXT,\s*p_provider_occurred_at\s+TIMESTAMPTZ,\s*p_verification_status\s+platform\.webhook_verification_status,\s*p_raw_payload\s+JSONB,\s*p_verification_headers\s+JSONB,\s*p_verification_evidence_ref\s+TEXT,\s*p_payload_sha256\s+TEXT,\s*p_request_id\s+UUID\s*\)\s*RETURNS\s+JSONB[\s\S]*?IF\s+\(SELECT\s+auth\.jwt\(\)\s*->>\s*'role'\)\s+IS\s+DISTINCT\s+FROM\s+'service_role'/i
    )
    expect(platformCommunicationsMigration).not.toMatch(
      /CREATE\s+UNIQUE\s+INDEX\s+provider_webhook_events_non_waha_business_key/i
    )
    expect(platformCommunicationsMigration).toMatch(
      /CREATE\s+UNIQUE\s+INDEX\s+provider_reconciliation_events_source_effect_key[\s\S]*organization_id,\s*source_webhook_event_id,\s*observation_kind,\s*conversation_id,\s*communication_message_id,\s*ack_state[\s\S]*NULLS\s+NOT\s+DISTINCT[\s\S]*WHERE\s+source_webhook_event_id\s+IS\s+NOT\s+NULL/i
    )
    expect(platformCommunicationsMigration).toMatch(
      /CREATE\s+UNIQUE\s+INDEX\s+provider_reconciliation_events_unknown_authorization_key[\s\S]*organization_id,\s*manual_send_authorization_id[\s\S]*WHERE\s+observation_kind\s*=\s*'unknown_result'/i
    )

    expect(platformCommunicationsMigration).toMatch(
      /CREATE\s+TABLE\s+platform\.communication_conversations[\s\S]*waha_session_name\s+TEXT\s+NOT\s+NULL[\s\S]*kommo_conversation_id\s+TEXT[\s\S]*amocrm_lead_id\s+BIGINT\s+NOT\s+NULL[\s\S]*amocrm_contact_id\s+BIGINT\s+NOT\s+NULL/i
    )
    expect(platformCommunicationsMigration).toMatch(
      /CREATE\s+TABLE\s+platform\.communication_messages[\s\S]*waha_session_name\s+TEXT[\s\S]*waha_message_id\s+TEXT[\s\S]*kommo_conversation_id\s+TEXT[\s\S]*kommo_message_id\s+TEXT[\s\S]*amocrm_lead_id\s+BIGINT\s+NOT\s+NULL[\s\S]*amocrm_contact_id\s+BIGINT\s+NOT\s+NULL/i
    )

    expect(platformCommunicationsMigration).toMatch(
      /CREATE\s+TYPE\s+platform\.ai_draft_language\s+AS\s+ENUM\s*\(\s*'ru',\s*'en'\s*\)/i
    )
    expect(platformCommunicationsMigration).toMatch(
      /CREATE\s+TYPE\s+platform\.communication_message_language\s+AS\s+ENUM\s*\(\s*'ru',\s*'en',\s*'undetermined'\s*\)/i
    )
    expect(platformCommunicationsMigration).toMatch(
      /CREATE\s+TYPE\s+platform\.ai_language_detection_status\s+AS\s+ENUM\s*\(\s*'confident',\s*'uncertain'\s*\)/i
    )
    expect(platformCommunicationsMigration).toMatch(
      /CREATE\s+TABLE\s+platform\.ai_draft_requests[\s\S]*source_message_id\s+UUID\s+NOT\s+NULL[\s\S]*requested_by_profile_id\s+UUID\s+NOT\s+NULL[\s\S]*requested_by_membership_id\s+UUID\s+NOT\s+NULL[\s\S]*request_id\s+UUID\s+NOT\s+NULL\s+UNIQUE/i
    )
    expect(platformCommunicationsMigration).toMatch(
      /CREATE\s+TABLE\s+platform\.ai_drafts[\s\S]*provider_ref\s+TEXT[\s\S]*model_ref\s+TEXT[\s\S]*prompt_policy_version\s+TEXT[\s\S]*source_context\s+JSONB\s+NOT\s+NULL[\s\S]*source_context_sha256\s+TEXT\s+NOT\s+NULL[\s\S]*generated_text\s+TEXT[\s\S]*reviewed_text\s+TEXT/i
    )
    expect(platformCommunicationsMigration).toMatch(
      /CREATE\s+TABLE\s+platform\.ai_draft_knowledge_citations[\s\S]*knowledge_version_id\s+UUID\s+NOT\s+NULL/i
    )
    expect(platformCommunicationsMigration).toMatch(
      /CREATE\s+TABLE\s+platform\.manual_send_authorizations[\s\S]*final_text\s+TEXT\s+NOT\s+NULL[\s\S]*final_text_sha256\s+TEXT\s+NOT\s+NULL[\s\S]*authorized_by_membership_id\s+UUID\s+NOT\s+NULL/i
    )

    expect(platformCommunicationsMigration).not.toMatch(
      /CREATE\s+TABLE\s+(?:platform\.)?[a-z_]*(?:outbox|broadcast|campaign|queue_job)[a-z_]*\b/i
    )
    expect(platformCommunicationsMigration).not.toMatch(
      /\b(?:CREATE|ALTER|DROP)\s+(?:TABLE|POLICY|SCHEMA)\s+(?:storage|pgmq)\b/i
    )
    expect(platformCommunicationsMigration).not.toMatch(
      /\bdelivery_status\s+(?:TEXT|platform\.)/i
    )
  })

  it('adds real PGMQ work without browser queue access or unknown-result retry', () => {
    for (const table of [
      'durable_work_items',
      'durable_work_attempts',
      'durable_work_events',
      'durable_work_dead_letters',
      'durable_work_idempotency',
    ]) {
      expect(platformQueuesMigration).toMatch(
        new RegExp(
          `CREATE\\s+TABLE\\s+platform_private\\.${table}\\b`,
          'i'
        )
      )
    }

    for (const table of ['work_review_cases', 'work_review_events']) {
      expect(platformQueuesMigration).toMatch(
        new RegExp(`CREATE\\s+TABLE\\s+platform\\.${table}\\b`, 'i')
      )
      expect(platformQueuesMigration).toMatch(
        new RegExp(
          `ALTER\\s+TABLE\\s+platform\\.${table}\\s+FORCE\\s+ROW\\s+LEVEL\\s+SECURITY`,
          'i'
        )
      )
    }

    expect(platformQueuesMigration).toMatch(
      /CREATE\s+EXTENSION\s+IF\s+NOT\s+EXISTS\s+pgmq/i
    )
    expect(platformQueuesMigration).toMatch(
      /SELECT\s+pgmq\.create\s*\(\s*'platform_work_v1'\s*\)/i
    )
    expect(platformQueuesMigration).toMatch(
      /SELECT\s+pgmq\.create\s*\(\s*'platform_dead_letter_v1'\s*\)/i
    )
    expect(platformQueuesMigration).toMatch(
      /CREATE\s+TYPE\s+platform\.durable_work_kind\s+AS\s+ENUM\s*\(\s*'provider_webhook_process',\s*'ai_draft_generate',\s*'manual_whatsapp_send'\s*\)/i
    )
    expect(platformQueuesMigration).toMatch(
      /FROM\s+pgmq\.read\s*\(\s*'platform_work_v1'/i
    )
    expect(platformQueuesMigration).not.toMatch(/\bpgmq\.pop\s*\(/i)
    expect(platformQueuesMigration).toMatch(
      /jsonb_build_object\s*\(\s*'v',\s*1,\s*'work_item_id',\s*created_work_item_id,\s*'kind',\s*p_kind\s*\)/i
    )
    expect(platformQueuesMigration).toMatch(
      /p_kind\s*=\s*'manual_whatsapp_send'[\s\S]*p_max_attempts\s*<>\s*1/i
    )
    expect(platformQueuesMigration).toMatch(
      /p2g_open_unknown_review[\s\S]*worker_lease_expired_before_result/i
    )
    expect(platformQueuesMigration).toMatch(
      /REVOKE\s+ALL\s+ON\s+SCHEMA\s+pgmq[\s\S]*service_role/i
    )
    expect(platformQueuesMigration).not.toMatch(/confirmed_external_send/i)
    expect(platformQueuesMigration).not.toMatch(
      /\b(auto[_-]?reply|broadcast|mass[_-]?send|campaign)\b/i
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
