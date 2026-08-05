\set ON_ERROR_STOP on

-- BW8A catalog, ownership, RLS, ACL and durable-work inventory at migration 059.
-- This test is intentionally data-light: behavioral authorization and optimistic
-- concurrency belong to the companion RLS/concurrency suites.
DO $$
DECLARE
  checked_table_name TEXT;
  checked_relation REGCLASS;
  checked_role TEXT;
  checked_routine REGPROCEDURE;
  checked_index_name TEXT;
  checked_index_column TEXT;
  enum_inventory RECORD;
  actual_enum_values TEXT[];
  expected_enum_values TEXT[];
  relation_owner OID;
  authenticated_role_oid OID := (SELECT oid FROM pg_roles WHERE rolname = 'authenticated');
  service_role_oid OID := (SELECT oid FROM pg_roles WHERE rolname = 'service_role');
  authenticated_jsonb_routines REGPROCEDURE[] := ARRAY[
    'platform.manual_edit_student_profile_field(uuid,uuid,bigint,text,platform.student_profile_value_kind,jsonb,text,uuid)'::REGPROCEDURE,
    'platform.confirm_student_profile_extracted_fact(uuid,uuid,uuid,bigint,text,uuid)'::REGPROCEDURE,
    'platform.reject_student_profile_extracted_fact(uuid,uuid,uuid,bigint,text,uuid)'::REGPROCEDURE,
    'platform.create_china_student_document_overlay(uuid,text,text,bigint,uuid,text,uuid)'::REGPROCEDURE,
    'platform.apply_china_student_document_overlay(uuid,uuid,uuid,text,uuid)'::REGPROCEDURE,
    'platform.recompute_student_document_applicability(uuid,uuid,bigint,date,timestamp with time zone,text,text,uuid)'::REGPROCEDURE,
    'platform.request_student_profile_export(uuid,uuid,bigint,text,text,text,platform.student_profile_export_format,text,text,uuid)'::REGPROCEDURE,
    'platform.grant_student_profile_export_download(uuid,uuid,text,integer,uuid)'::REGPROCEDURE
  ];
  authenticated_boolean_routines REGPROCEDURE[] := ARRAY[
    'private.platform_can_read_student_document_intelligence(uuid,uuid)'::REGPROCEDURE,
    'private.platform_can_read_student_portal_case(uuid,uuid)'::REGPROCEDURE
  ];
  service_jsonb_routines REGPROCEDURE[] := ARRAY[
    'platform.enqueue_document_validation_work(uuid,uuid,text,integer,uuid)'::REGPROCEDURE,
    'platform.enqueue_document_extraction_work(uuid,uuid,text,integer,uuid)'::REGPROCEDURE,
    'platform.enqueue_student_profile_export_work(uuid,uuid,text,integer,uuid)'::REGPROCEDURE,
    'platform.claim_durable_work(integer,text,uuid)'::REGPROCEDURE,
    'platform.create_document_extraction_run(uuid,uuid,text,text,text,integer,uuid)'::REGPROCEDURE,
    'platform.transition_document_extraction_run(uuid,uuid,platform.document_extraction_run_status,platform.document_extraction_run_status,text,text,uuid)'::REGPROCEDURE,
    'platform.append_document_extracted_fact(uuid,uuid,text,platform.student_profile_value_kind,jsonb,jsonb,numeric,jsonb,platform.document_extracted_fact_status,uuid)'::REGPROCEDURE,
    'platform.reserve_student_profile_export_storage(uuid,uuid,uuid)'::REGPROCEDURE,
    'platform.finalize_student_profile_export_storage(uuid,uuid,text,bigint,uuid)'::REGPROCEDURE,
    'platform.consume_student_profile_export_download_grant(uuid,text,uuid)'::REGPROCEDURE,
    'platform.fail_student_profile_export(uuid,uuid,platform.student_profile_export_status,text,uuid)'::REGPROCEDURE
  ];
  private_routines REGPROCEDURE[] := ARRAY[
    'platform_private.is_safe_workflow_source_url(platform.workflow_source_kind,text)'::REGPROCEDURE,
    'platform_private.student_profile_value_is_valid(platform.student_profile_value_kind,jsonb)'::REGPROCEDURE,
    'platform_private.student_profile_catalog_value_is_valid(text,jsonb)'::REGPROCEDURE,
    'platform_private.document_source_locator_is_valid(jsonb)'::REGPROCEDURE,
    'platform_private.resolve_document_applicability(platform.document_requirement_applicability_rule,date,date)'::REGPROCEDURE,
    'platform_private.guard_bw8_extraction_run_mutation()'::REGPROCEDURE,
    'platform_private.guard_bw8_extracted_fact_mutation()'::REGPROCEDURE,
    'platform_private.guard_bw8_profile_field_value_mutation()'::REGPROCEDURE,
    'platform_private.guard_bw8_profile_export_mutation()'::REGPROCEDURE,
    'platform_private.guard_bw8_requirement_metadata()'::REGPROCEDURE,
    'platform_private.guard_bw8_slot_applicability()'::REGPROCEDURE,
    'platform_private.lock_bw8_request(uuid)'::REGPROCEDURE,
    'platform_private.require_bw8_case_actor(uuid,uuid,text)'::REGPROCEDURE,
    'platform_private.project_bw8_profile_field(uuid,uuid,uuid,text,jsonb,uuid,bigint)'::REGPROCEDURE,
    'platform_private.enqueue_bw8_durable_work(uuid,platform.durable_work_kind,uuid,uuid,uuid,text,integer,uuid,platform.durable_work_operation)'::REGPROCEDURE
  ];
BEGIN
  IF authenticated_role_oid IS NULL OR service_role_oid IS NULL THEN
    RAISE EXCEPTION 'BW8A expected Supabase API roles are missing';
  END IF;

  -- Public evidence/catalog tables are postgres-owned, forced-RLS, and expose
  -- exactly SELECT to authenticated. No column-level ACL may bypass that shape.
  FOREACH checked_table_name IN ARRAY ARRAY[
    'student_profile_field_catalog',
    'document_extraction_runs',
    'document_extracted_facts',
    'student_profile_field_values',
    'student_profile_field_decisions',
    'student_profile_exports'
  ] LOOP
    checked_relation := format('platform.%I', checked_table_name)::REGCLASS;
    SELECT relation.relowner
    INTO relation_owner
    FROM pg_class AS relation
    JOIN pg_roles AS owner_role ON owner_role.oid = relation.relowner
    WHERE relation.oid = checked_relation
      AND relation.relkind = 'r'
      AND relation.relrowsecurity
      AND relation.relforcerowsecurity
      AND owner_role.rolname = 'postgres';

    IF relation_owner IS NULL THEN
      RAISE EXCEPTION 'BW8A public relation % owner/RLS drifted', checked_table_name;
    END IF;
    IF NOT has_table_privilege('authenticated', checked_relation, 'SELECT')
      OR EXISTS (
        SELECT 1
        FROM aclexplode(COALESCE(
          (SELECT relation.relacl FROM pg_class AS relation WHERE relation.oid = checked_relation),
          acldefault('r', relation_owner)
        )) AS privilege
        WHERE privilege.grantee <> relation_owner
          AND NOT (
            privilege.grantee = authenticated_role_oid
            AND privilege.privilege_type = 'SELECT'
            AND NOT privilege.is_grantable
          )
      )
      OR EXISTS (
        SELECT 1
        FROM pg_attribute AS attribute
        CROSS JOIN LATERAL aclexplode(attribute.attacl) AS privilege
        WHERE attribute.attrelid = checked_relation
          AND attribute.attacl IS NOT NULL
          AND NOT attribute.attisdropped
          AND privilege.grantee <> relation_owner
      )
    THEN
      RAISE EXCEPTION 'BW8A public relation % is not authenticated SELECT-only', checked_table_name;
    END IF;
  END LOOP;

  -- Applicability capability context and export objects/tokens are private
  -- ledger rows, never browser- or service-visible relations.
  FOREACH checked_table_name IN ARRAY ARRAY[
    'document_applicability_recompute_context',
    'student_profile_export_storage_reservations',
    'student_profile_export_storage_bindings',
    'student_profile_export_download_grants',
    'student_profile_export_download_consumptions'
  ] LOOP
    checked_relation := format('platform_private.%I', checked_table_name)::REGCLASS;
    SELECT relation.relowner
    INTO relation_owner
    FROM pg_class AS relation
    JOIN pg_roles AS owner_role ON owner_role.oid = relation.relowner
    WHERE relation.oid = checked_relation
      AND relation.relkind = 'r'
      AND relation.relrowsecurity
      AND relation.relforcerowsecurity
      AND owner_role.rolname = 'postgres';

    IF relation_owner IS NULL THEN
      RAISE EXCEPTION 'BW8A private relation % owner/RLS drifted', checked_table_name;
    END IF;
    IF EXISTS (
      SELECT 1
      FROM aclexplode(COALESCE(
        (SELECT relation.relacl FROM pg_class AS relation WHERE relation.oid = checked_relation),
        acldefault('r', relation_owner)
      )) AS privilege
      WHERE privilege.grantee <> relation_owner
    ) OR EXISTS (
      SELECT 1
      FROM pg_attribute AS attribute
      CROSS JOIN LATERAL aclexplode(attribute.attacl) AS privilege
      WHERE attribute.attrelid = checked_relation
        AND attribute.attacl IS NOT NULL
        AND NOT attribute.attisdropped
        AND privilege.grantee <> relation_owner
    ) THEN
      RAISE EXCEPTION 'BW8A private relation % leaked a client/service grant', checked_table_name;
    END IF;
  END LOOP;

  IF (
    SELECT array_agg(
      policy.tablename || ':' || policy.policyname || ':' || policy.cmd
      ORDER BY policy.tablename, policy.policyname
    )
    FROM pg_policies AS policy
    WHERE policy.schemaname = 'platform'
      AND policy.tablename IN (
        'student_profile_field_catalog', 'document_extraction_runs',
        'document_extracted_facts', 'student_profile_field_values',
        'student_profile_field_decisions', 'student_profile_exports'
      )
  ) IS DISTINCT FROM ARRAY[
    'document_extracted_facts:document_extracted_facts_staff_read:SELECT',
    'document_extraction_runs:document_extraction_runs_staff_read:SELECT',
    'student_profile_exports:student_profile_exports_staff_read:SELECT',
    'student_profile_field_catalog:student_profile_field_catalog_read:SELECT',
    'student_profile_field_decisions:student_profile_field_decisions_staff_read:SELECT',
    'student_profile_field_values:student_profile_field_values_staff_read:SELECT',
    'student_profile_field_values:student_profile_field_values_student_self_read:SELECT'
  ]::TEXT[] THEN
    RAISE EXCEPTION 'BW8A public-table RLS policy inventory drifted';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policy AS policy
    WHERE policy.polrelid = 'platform.student_profile_field_values'::REGCLASS
      AND policy.polname = 'student_profile_field_values_student_self_read'
      AND policy.polcmd = 'r'
      AND policy.polpermissive
      AND policy.polroles = ARRAY[authenticated_role_oid]
      AND pg_get_expr(policy.polqual, policy.polrelid)
        LIKE '%private.platform_has_permission(%organization_id, ''profile.read.self''%'
      AND pg_get_expr(policy.polqual, policy.polrelid)
        LIKE '%private.platform_can_read_student_portal_case(%organization_id, %student_case_id)%'
  ) THEN
    RAISE EXCEPTION 'BW8A Student confirmed-value self-read predicate drifted';
  END IF;

  -- The supplied Student Profile form is an exact, typed 62-field contract.
  IF (SELECT count(*) FROM platform.student_profile_field_catalog) <> 62
    OR EXISTS (
      WITH expected(
        field_key, value_kind, section_key, display_order, is_sensitive,
        is_repeating, core_projection_field
      ) AS (VALUES
        ('identity.preferred_display_name', 'name', 'identity', 1, FALSE, FALSE, 'preferred_display_name'),
        ('identity.legal_display_name', 'name', 'identity', 2, TRUE, FALSE, 'legal_display_name'),
        ('preferences.communication_language', 'communication_language', 'preferences', 3, FALSE, FALSE, 'communication_language'),
        ('personal.date_of_birth', 'date', 'personal', 4, TRUE, FALSE, 'date_of_birth'),
        ('personal.citizenship_country', 'country_code', 'personal', 5, TRUE, FALSE, 'citizenship_country'),
        ('personal.residency_country', 'country_code', 'personal', 6, TRUE, FALSE, 'residency_country'),
        ('education.current_summary', 'text', 'education', 7, TRUE, FALSE, 'current_education_summary'),
        ('education.academic_summary', 'text', 'education', 8, TRUE, FALSE, 'academic_summary'),
        ('language.summary', 'text', 'language', 9, TRUE, FALSE, 'language_summary'),
        ('study.budget_band', 'text', 'study', 10, TRUE, FALSE, 'budget_band'),
        ('decision.participant_labels', 'text_array', 'decision', 11, TRUE, TRUE, 'decision_participant_labels'),
        ('consent.status', 'consent_status', 'consent', 12, TRUE, FALSE, 'consent_status'),
        ('consent.evidence_ref', 'text', 'consent', 13, TRUE, FALSE, 'consent_evidence_ref'),
        ('workflow.next_step', 'text', 'workflow', 14, TRUE, FALSE, 'next_step'),
        ('personal.first_name', 'name', 'personal', 15, TRUE, FALSE, NULL),
        ('personal.last_name', 'name', 'personal', 16, TRUE, FALSE, NULL),
        ('personal.passport_number', 'passport_number', 'personal', 17, TRUE, FALSE, NULL),
        ('personal.passport_expiry_date', 'date', 'personal', 18, TRUE, FALSE, NULL),
        ('personal.permanent_address', 'text', 'personal', 19, TRUE, FALSE, NULL),
        ('personal.mobile_phone', 'phone', 'personal', 20, TRUE, FALSE, NULL),
        ('personal.messaging_contact', 'text', 'personal', 21, TRUE, FALSE, NULL),
        ('personal.student_email', 'email', 'personal', 22, TRUE, FALSE, NULL),
        ('personal.chinese_level', 'language_level', 'personal', 23, TRUE, FALSE, NULL),
        ('personal.english_level', 'language_level', 'personal', 24, TRUE, FALSE, NULL),
        ('education.history', 'education_history', 'education', 25, TRUE, TRUE, NULL),
        ('education.current_study_status', 'text', 'education', 26, TRUE, FALSE, NULL),
        ('education.expected_graduation_year', 'year', 'education', 27, TRUE, FALSE, NULL),
        ('education.extracurricular_achievements', 'text', 'education', 28, TRUE, FALSE, NULL),
        ('study.desired_country', 'country_code', 'study', 29, FALSE, FALSE, NULL),
        ('study.desired_university', 'text', 'study', 30, FALSE, FALSE, NULL),
        ('study.field_major', 'text', 'study', 31, FALSE, FALSE, NULL),
        ('study.program_level', 'text', 'study', 32, FALSE, FALSE, NULL),
        ('study.desired_start_date', 'date', 'study', 33, FALSE, FALSE, NULL),
        ('study.budget_per_year', 'money', 'study', 34, TRUE, FALSE, NULL),
        ('study.scholarship_interest', 'boolean', 'study', 35, FALSE, FALSE, NULL),
        ('study.field_choice_reason', 'text', 'study', 36, FALSE, FALSE, NULL),
        ('father.first_name', 'name', 'father', 37, TRUE, FALSE, NULL),
        ('father.last_name', 'name', 'father', 38, TRUE, FALSE, NULL),
        ('father.employer', 'text', 'father', 39, TRUE, FALSE, NULL),
        ('father.job_title', 'text', 'father', 40, TRUE, FALSE, NULL),
        ('father.mobile_phone', 'phone', 'father', 41, TRUE, FALSE, NULL),
        ('father.work_email', 'email', 'father', 42, TRUE, FALSE, NULL),
        ('father.personal_email', 'email', 'father', 43, TRUE, FALSE, NULL),
        ('mother.first_name', 'name', 'mother', 44, TRUE, FALSE, NULL),
        ('mother.last_name', 'name', 'mother', 45, TRUE, FALSE, NULL),
        ('mother.employer', 'text', 'mother', 46, TRUE, FALSE, NULL),
        ('mother.job_title', 'text', 'mother', 47, TRUE, FALSE, NULL),
        ('mother.mobile_phone', 'phone', 'mother', 48, TRUE, FALSE, NULL),
        ('mother.work_email', 'email', 'mother', 49, TRUE, FALSE, NULL),
        ('mother.personal_email', 'email', 'mother', 50, TRUE, FALSE, NULL),
        ('emergency.contact_name', 'name', 'emergency', 51, TRUE, FALSE, NULL),
        ('emergency.relationship', 'text', 'emergency', 52, TRUE, FALSE, NULL),
        ('emergency.phone_or_email', 'text', 'emergency', 53, TRUE, FALSE, NULL),
        ('visa.previous_refusal', 'boolean', 'visa', 54, TRUE, FALSE, NULL),
        ('visa.refusal_country', 'country_code', 'visa', 55, TRUE, FALSE, NULL),
        ('health.chronic_or_allergies', 'boolean', 'health', 56, TRUE, FALSE, NULL),
        ('health.details', 'text', 'health', 57, TRUE, FALSE, NULL),
        ('referral.source', 'text', 'referral', 58, FALSE, FALSE, NULL),
        ('acknowledgement.student_signature', 'boolean', 'acknowledgement', 59, TRUE, FALSE, NULL),
        ('acknowledgement.student_signature_date', 'date', 'acknowledgement', 60, TRUE, FALSE, NULL),
        ('acknowledgement.parent_signature', 'boolean', 'acknowledgement', 61, TRUE, FALSE, NULL),
        ('acknowledgement.parent_signature_date', 'date', 'acknowledgement', 62, TRUE, FALSE, NULL)
      ),
      actual AS (
        SELECT
          catalog.field_key,
          catalog.value_kind::TEXT,
          catalog.section_key,
          catalog.display_order,
          catalog.is_sensitive,
          catalog.is_repeating,
          catalog.core_projection_field::TEXT
        FROM platform.student_profile_field_catalog AS catalog
      ),
      difference AS (
        (SELECT * FROM expected EXCEPT ALL SELECT * FROM actual)
        UNION ALL
        (SELECT * FROM actual EXCEPT ALL SELECT * FROM expected)
      )
      SELECT 1 FROM difference
    )
  THEN
    RAISE EXCEPTION 'BW8A exact 62-field Student Profile catalog drifted';
  END IF;

  -- New enums and the extended shared durable-work enums are closed contracts.
  FOR enum_inventory IN
    SELECT key AS enum_name, value AS expected_values
    FROM jsonb_each($enums${
      "document_extraction_run_status": ["queued", "processing", "succeeded", "failed", "superseded"],
      "document_extracted_fact_status": ["proposed", "conflict", "confirmed", "rejected", "superseded"],
      "student_profile_value_kind": ["name", "text", "email", "phone", "date", "country_code", "passport_number", "communication_language", "language_level", "education_history", "year", "money", "boolean", "text_array", "consent_status"],
      "student_profile_value_source": ["extracted_fact", "manual"],
      "student_profile_field_decision_kind": ["confirm", "reject", "manual_edit", "supersede"],
      "student_profile_export_format": ["docx", "pdf"],
      "student_profile_export_status": ["queued", "processing", "succeeded", "failed", "superseded"],
      "document_requirement_applicability_rule": ["always", "minor_only", "after_contract_payment"],
      "document_slot_applicability_status": ["required", "not_required", "pending_information"],
      "durable_work_kind": ["provider_webhook_process", "ai_draft_generate", "manual_whatsapp_send", "document_validation", "document_extraction", "student_profile_export"],
      "durable_work_operation": ["enqueue_verified_webhook", "enqueue_ai_draft", "enqueue_manual_whatsapp_send", "claim", "extend_lease", "finish", "enqueue_document_validation", "enqueue_document_extraction", "enqueue_student_profile_export"]
    }$enums$::JSONB)
  LOOP
    SELECT array_agg(enum_value.enumlabel::TEXT ORDER BY enum_value.enumsortorder)
    INTO actual_enum_values
    FROM pg_type AS enum_type
    JOIN pg_namespace AS namespace ON namespace.oid = enum_type.typnamespace
    JOIN pg_enum AS enum_value ON enum_value.enumtypid = enum_type.oid
    WHERE namespace.nspname = 'platform'
      AND enum_type.typname = enum_inventory.enum_name;

    SELECT array_agg(element.value ORDER BY element.ordinality)
    INTO expected_enum_values
    FROM jsonb_array_elements_text(enum_inventory.expected_values)
      WITH ORDINALITY AS element(value, ordinality);

    IF actual_enum_values IS DISTINCT FROM expected_enum_values THEN
      RAISE EXCEPTION 'BW8A enum % drifted: expected %, found %',
        enum_inventory.enum_name, expected_enum_values, actual_enum_values;
    END IF;
  END LOOP;

  -- v12 clones all v11 grants and adds the five sensitive capabilities only
  -- to Admin and Curator bundles. Assignment is enforced by the case policy.
  IF (
    SELECT count(*)
    FROM platform.permission_definitions
    WHERE permission_key IN (
      'document.intelligence.read', 'document.intelligence.manage',
      'profile.field.read', 'profile.field.manage', 'profile.export.manage'
    )
  ) <> 5 THEN
    RAISE EXCEPTION 'BW8A permission catalog is incomplete';
  END IF;

  IF (
    SELECT array_agg(bundle.role::TEXT ORDER BY bundle.role::TEXT)
    FROM platform.role_bundle_versions AS bundle
    WHERE bundle.version = 12
      AND bundle.status = 'published'
  ) IS DISTINCT FROM ARRAY['admin', 'curator', 'finance', 'sales', 'student']::TEXT[]
    OR (SELECT count(*) FROM platform.role_bundle_versions WHERE version = 12) <> 5
  THEN
    RAISE EXCEPTION 'BW8A published v12 role bundle inventory drifted';
  END IF;

  IF EXISTS (
    WITH expected(role_name, permission_key) AS (
      SELECT role_name, permission_key
      FROM unnest(ARRAY['admin', 'curator']) AS role_name
      CROSS JOIN unnest(ARRAY[
        'document.intelligence.read', 'document.intelligence.manage',
        'profile.field.read', 'profile.field.manage', 'profile.export.manage'
      ]) AS permission_key
    ),
    actual AS (
      SELECT bundle.role::TEXT, permission.permission_key
      FROM platform.role_bundle_versions AS bundle
      JOIN platform.role_bundle_permissions AS permission
        ON permission.bundle_id = bundle.id
        AND permission.bundle_role = bundle.role
      WHERE bundle.version = 12
        AND permission.permission_key IN (
          'document.intelligence.read', 'document.intelligence.manage',
          'profile.field.read', 'profile.field.manage', 'profile.export.manage'
        )
    ),
    difference AS (
      (SELECT * FROM expected EXCEPT ALL SELECT * FROM actual)
      UNION ALL
      (SELECT * FROM actual EXCEPT ALL SELECT * FROM expected)
    )
    SELECT 1 FROM difference
  ) THEN
    RAISE EXCEPTION 'BW8A new permissions are not Admin/Curator-only';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM platform.role_bundle_versions AS v12
    JOIN platform.role_bundle_versions AS v11
      ON v11.role = v12.role
      AND v11.version = 11
      AND v11.status = 'published'
    JOIN platform.role_bundle_permissions AS v11_permission
      ON v11_permission.bundle_id = v11.id
      AND v11_permission.bundle_role = v11.role
    LEFT JOIN platform.role_bundle_permissions AS v12_permission
      ON v12_permission.bundle_id = v12.id
      AND v12_permission.bundle_role = v12.role
      AND v12_permission.permission_key IS NOT DISTINCT FROM
        v11_permission.permission_key
    WHERE v12.version = 12
      AND v12.status = 'published'
      AND v12_permission.permission_key IS NULL
  ) THEN
    RAISE EXCEPTION 'BW8A v12 failed to preserve a v11 permission';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM platform.organization_memberships AS membership
    JOIN platform.role_bundle_versions AS bundle
      ON bundle.id = membership.current_bundle_id
    WHERE membership."current_role" IS NOT NULL
      AND membership.current_bundle_id IS NOT NULL
      AND (
        bundle.version <> 12
        OR bundle.status <> 'published'
        OR bundle.role <> membership."current_role"
      )
  ) THEN
    RAISE EXCEPTION 'BW8A left a membership outside its published v12 role bundle';
  END IF;

  -- BW8 extends the existing PGMQ-backed ledger with typed, mutually exclusive
  -- source pointers; it does not create a second queue or retry ledger.
  IF EXISTS (
    WITH expected(column_name) AS (VALUES
      ('source_document_version_id'),
      ('source_extraction_run_id'),
      ('source_profile_export_id')
    ),
    actual AS (
      SELECT attribute.attname::TEXT
      FROM pg_attribute AS attribute
      WHERE attribute.attrelid = 'platform_private.durable_work_items'::REGCLASS
        AND attribute.attname IN (
          'source_document_version_id',
          'source_extraction_run_id',
          'source_profile_export_id'
        )
        AND NOT attribute.attisdropped
        AND NOT attribute.attnotnull
        AND format_type(attribute.atttypid, attribute.atttypmod) = 'uuid'
    ),
    difference AS (
      (SELECT * FROM expected EXCEPT ALL SELECT * FROM actual)
      UNION ALL
      (SELECT * FROM actual EXCEPT ALL SELECT * FROM expected)
    )
    SELECT 1 FROM difference
  ) THEN
    RAISE EXCEPTION 'BW8A durable-work typed source columns drifted';
  END IF;

  IF EXISTS (
    WITH expected(constraint_name, target_relation) AS (VALUES
      ('durable_work_items_document_version_fkey', 'platform.document_versions'),
      ('durable_work_items_extraction_run_fkey', 'platform.document_extraction_runs'),
      ('durable_work_items_profile_export_fkey', 'platform.student_profile_exports')
    ),
    actual AS (
      SELECT constraint_record.conname::TEXT,
        constraint_record.confrelid::REGCLASS::TEXT
      FROM pg_constraint AS constraint_record
      WHERE constraint_record.conrelid = 'platform_private.durable_work_items'::REGCLASS
        AND constraint_record.contype = 'f'
        AND constraint_record.conname IN (
          'durable_work_items_document_version_fkey',
          'durable_work_items_extraction_run_fkey',
          'durable_work_items_profile_export_fkey'
        )
        AND constraint_record.convalidated
        AND constraint_record.confdeltype = 'r'
    ),
    difference AS (
      (SELECT * FROM expected EXCEPT ALL SELECT * FROM actual)
      UNION ALL
      (SELECT * FROM actual EXCEPT ALL SELECT * FROM expected)
    )
    SELECT 1 FROM difference
  ) THEN
    RAISE EXCEPTION 'BW8A durable-work source foreign keys drifted';
  END IF;

  FOR checked_index_name, checked_index_column IN
    SELECT * FROM (VALUES
      ('durable_work_items_document_version_source_key', 'source_document_version_id'),
      ('durable_work_items_extraction_run_source_key', 'source_extraction_run_id'),
      ('durable_work_items_profile_export_source_key', 'source_profile_export_id')
    ) AS expected(index_name, source_column)
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_index AS index_record
      JOIN pg_class AS index_relation ON index_relation.oid = index_record.indexrelid
      WHERE index_record.indrelid = 'platform_private.durable_work_items'::REGCLASS
        AND index_relation.relname = checked_index_name
        AND index_record.indisunique
        AND index_record.indpred IS NOT NULL
        AND (
          SELECT array_agg(attribute.attname::TEXT ORDER BY key.ordinality)
          FROM unnest(index_record.indkey) WITH ORDINALITY AS key(attnum, ordinality)
          JOIN pg_attribute AS attribute
            ON attribute.attrelid = index_record.indrelid
            AND attribute.attnum = key.attnum
        ) = ARRAY['organization_id', checked_index_column]::TEXT[]
        AND pg_get_expr(index_record.indpred, index_record.indrelid)
          = format('(%I IS NOT NULL)', checked_index_column)
    ) THEN
      RAISE EXCEPTION 'BW8A durable-work source index % drifted', checked_index_name;
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint AS constraint_record
    WHERE constraint_record.conrelid = 'platform_private.durable_work_items'::REGCLASS
      AND constraint_record.conname = 'durable_work_items_source_shape_check'
      AND constraint_record.contype = 'c'
      AND constraint_record.convalidated
      AND pg_get_constraintdef(constraint_record.oid) LIKE '%document_validation%'
      AND pg_get_constraintdef(constraint_record.oid) LIKE '%document_extraction%'
      AND pg_get_constraintdef(constraint_record.oid) LIKE '%student_profile_export%'
      AND pg_get_constraintdef(constraint_record.oid) LIKE '%source_document_version_id%'
      AND pg_get_constraintdef(constraint_record.oid) LIKE '%source_extraction_run_id%'
      AND pg_get_constraintdef(constraint_record.oid) LIKE '%source_profile_export_id%'
  ) THEN
    RAISE EXCEPTION 'BW8A durable-work source-shape invariant drifted';
  END IF;

  -- Every API routine is postgres-owned SECURITY DEFINER with an empty search
  -- path and one exact caller role; private helpers expose no non-owner EXECUTE.
  FOREACH checked_routine IN ARRAY authenticated_jsonb_routines LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_proc AS procedure
      JOIN pg_roles AS owner_role ON owner_role.oid = procedure.proowner
      WHERE procedure.oid = checked_routine
        AND owner_role.rolname = 'postgres'
        AND procedure.prosecdef
        AND procedure.proconfig @> ARRAY['search_path=""']::TEXT[]
        AND procedure.prorettype = 'jsonb'::REGTYPE
    ) OR NOT has_function_privilege('authenticated', checked_routine, 'EXECUTE')
      OR EXISTS (
        SELECT 1
        FROM pg_proc AS procedure
        CROSS JOIN LATERAL aclexplode(COALESCE(
          procedure.proacl, acldefault('f', procedure.proowner)
        )) AS privilege
        WHERE procedure.oid = checked_routine
          AND privilege.grantee <> procedure.proowner
          AND NOT (
            privilege.grantee = authenticated_role_oid
            AND privilege.privilege_type = 'EXECUTE'
            AND NOT privilege.is_grantable
          )
      )
    THEN
      RAISE EXCEPTION 'BW8A authenticated JSONB routine % security/ACL drifted', checked_routine;
    END IF;
  END LOOP;

  FOREACH checked_routine IN ARRAY authenticated_boolean_routines LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_proc AS procedure
      JOIN pg_roles AS owner_role ON owner_role.oid = procedure.proowner
      WHERE procedure.oid = checked_routine
        AND owner_role.rolname = 'postgres'
        AND procedure.prosecdef
        AND procedure.proconfig @> ARRAY['search_path=""']::TEXT[]
        AND procedure.prorettype = 'boolean'::REGTYPE
    ) OR NOT has_function_privilege('authenticated', checked_routine, 'EXECUTE')
      OR EXISTS (
        SELECT 1
        FROM pg_proc AS procedure
        CROSS JOIN LATERAL aclexplode(COALESCE(
          procedure.proacl, acldefault('f', procedure.proowner)
        )) AS privilege
        WHERE procedure.oid = checked_routine
          AND privilege.grantee <> procedure.proowner
          AND NOT (
            privilege.grantee = authenticated_role_oid
            AND privilege.privilege_type = 'EXECUTE'
            AND NOT privilege.is_grantable
          )
      )
    THEN
      RAISE EXCEPTION 'BW8A authenticated boolean routine % security/ACL drifted', checked_routine;
    END IF;
  END LOOP;

  FOREACH checked_routine IN ARRAY service_jsonb_routines LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_proc AS procedure
      JOIN pg_roles AS owner_role ON owner_role.oid = procedure.proowner
      WHERE procedure.oid = checked_routine
        AND owner_role.rolname = 'postgres'
        AND procedure.prosecdef
        AND procedure.proconfig @> ARRAY['search_path=""']::TEXT[]
        AND procedure.prorettype = 'jsonb'::REGTYPE
    ) OR NOT has_function_privilege('service_role', checked_routine, 'EXECUTE')
      OR EXISTS (
        SELECT 1
        FROM pg_proc AS procedure
        CROSS JOIN LATERAL aclexplode(COALESCE(
          procedure.proacl, acldefault('f', procedure.proowner)
        )) AS privilege
        WHERE procedure.oid = checked_routine
          AND privilege.grantee <> procedure.proowner
          AND NOT (
            privilege.grantee = service_role_oid
            AND privilege.privilege_type = 'EXECUTE'
            AND NOT privilege.is_grantable
          )
      )
    THEN
      RAISE EXCEPTION 'BW8A service JSONB routine % security/ACL drifted', checked_routine;
    END IF;
  END LOOP;

  FOREACH checked_routine IN ARRAY private_routines LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_proc AS procedure
      JOIN pg_roles AS owner_role ON owner_role.oid = procedure.proowner
      WHERE procedure.oid = checked_routine
        AND owner_role.rolname = 'postgres'
        AND procedure.prosecdef
        AND procedure.proconfig @> ARRAY['search_path=""']::TEXT[]
    ) OR EXISTS (
      SELECT 1
      FROM pg_proc AS procedure
      CROSS JOIN LATERAL aclexplode(COALESCE(
        procedure.proacl, acldefault('f', procedure.proowner)
      )) AS privilege
      WHERE procedure.oid = checked_routine
        AND privilege.grantee <> procedure.proowner
    ) THEN
      RAISE EXCEPTION 'BW8A private routine % security/ACL drifted', checked_routine;
    END IF;
  END LOOP;

  -- New evidence/current-value/private-storage tables all have exact mutation
  -- guards. The existing requirements/slots receive their BW8 monotonic guards.
  IF EXISTS (
    WITH expected(table_schema, table_name, trigger_name, function_name) AS (VALUES
      ('platform', 'student_profile_field_catalog', 'student_profile_field_catalog_append_only', 'block_append_only_mutation'),
      ('platform', 'student_profile_field_catalog', 'student_profile_field_catalog_no_truncate', 'block_append_only_mutation'),
      ('platform', 'document_extraction_runs', 'document_extraction_runs_transition_guard', 'guard_bw8_extraction_run_mutation'),
      ('platform', 'document_extraction_runs', 'document_extraction_runs_no_truncate', 'block_append_only_mutation'),
      ('platform', 'document_extracted_facts', 'document_extracted_facts_transition_guard', 'guard_bw8_extracted_fact_mutation'),
      ('platform', 'document_extracted_facts', 'document_extracted_facts_no_truncate', 'block_append_only_mutation'),
      ('platform', 'student_profile_field_values', 'student_profile_field_values_revision_guard', 'guard_bw8_profile_field_value_mutation'),
      ('platform', 'student_profile_field_values', 'student_profile_field_values_no_truncate', 'block_append_only_mutation'),
      ('platform', 'student_profile_field_decisions', 'student_profile_field_decisions_append_only', 'block_append_only_mutation'),
      ('platform', 'student_profile_field_decisions', 'student_profile_field_decisions_no_truncate', 'block_append_only_mutation'),
      ('platform', 'student_profile_exports', 'student_profile_exports_transition_guard', 'guard_bw8_profile_export_mutation'),
      ('platform', 'student_profile_exports', 'student_profile_exports_no_truncate', 'block_append_only_mutation'),
      ('platform_private', 'student_profile_export_storage_reservations', 'student_profile_export_storage_reservations_append_only', 'block_append_only_mutation'),
      ('platform_private', 'student_profile_export_storage_reservations', 'student_profile_export_storage_reservations_no_truncate', 'block_append_only_mutation'),
      ('platform_private', 'student_profile_export_storage_bindings', 'student_profile_export_storage_bindings_append_only', 'block_append_only_mutation'),
      ('platform_private', 'student_profile_export_storage_bindings', 'student_profile_export_storage_bindings_no_truncate', 'block_append_only_mutation'),
      ('platform_private', 'student_profile_export_download_grants', 'student_profile_export_download_grants_append_only', 'block_append_only_mutation'),
      ('platform_private', 'student_profile_export_download_grants', 'student_profile_export_download_grants_no_truncate', 'block_append_only_mutation'),
      ('platform_private', 'student_profile_export_download_consumptions', 'student_profile_export_download_consumptions_append_only', 'block_append_only_mutation'),
      ('platform_private', 'student_profile_export_download_consumptions', 'student_profile_export_download_consumptions_no_truncate', 'block_append_only_mutation')
    ),
    actual AS (
      SELECT
        table_namespace.nspname::TEXT,
        table_relation.relname::TEXT,
        trigger_record.tgname::TEXT,
        trigger_function.proname::TEXT
      FROM pg_trigger AS trigger_record
      JOIN pg_class AS table_relation ON table_relation.oid = trigger_record.tgrelid
      JOIN pg_namespace AS table_namespace ON table_namespace.oid = table_relation.relnamespace
      JOIN pg_proc AS trigger_function ON trigger_function.oid = trigger_record.tgfoid
      WHERE NOT trigger_record.tgisinternal
        AND (table_namespace.nspname, table_relation.relname) IN (
          ('platform', 'student_profile_field_catalog'),
          ('platform', 'document_extraction_runs'),
          ('platform', 'document_extracted_facts'),
          ('platform', 'student_profile_field_values'),
          ('platform', 'student_profile_field_decisions'),
          ('platform', 'student_profile_exports'),
          ('platform_private', 'student_profile_export_storage_reservations'),
          ('platform_private', 'student_profile_export_storage_bindings'),
          ('platform_private', 'student_profile_export_download_grants'),
          ('platform_private', 'student_profile_export_download_consumptions')
        )
    ),
    difference AS (
      (SELECT * FROM expected EXCEPT ALL SELECT * FROM actual)
      UNION ALL
      (SELECT * FROM actual EXCEPT ALL SELECT * FROM expected)
    )
    SELECT 1 FROM difference
  ) THEN
    RAISE EXCEPTION 'BW8A append-only/monotonic trigger inventory drifted';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger AS trigger_record
    WHERE trigger_record.tgrelid = 'platform.document_requirements'::REGCLASS
      AND trigger_record.tgname = 'document_requirements_bw8_metadata_guard'
      AND trigger_record.tgfoid = 'platform_private.guard_bw8_requirement_metadata()'::REGPROCEDURE
      AND NOT trigger_record.tgisinternal
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_trigger AS trigger_record
    WHERE trigger_record.tgrelid = 'platform.document_slots'::REGCLASS
      AND trigger_record.tgname = 'document_slots_bw8_applicability_guard'
      AND trigger_record.tgfoid = 'platform_private.guard_bw8_slot_applicability()'::REGPROCEDURE
      AND NOT trigger_record.tgisinternal
  ) THEN
    RAISE EXCEPTION 'BW8A requirement/slot monotonic guard inventory drifted';
  END IF;

  IF pg_get_functiondef(
    'platform_private.guard_bw8_slot_applicability()'::REGPROCEDURE
  ) NOT LIKE '%platform_private.document_applicability_recompute_context%'
    OR pg_get_functiondef(
      'platform_private.guard_bw8_slot_applicability()'::REGPROCEDURE
    ) NOT LIKE '%pg_catalog.txid_current()%'
  THEN
    RAISE EXCEPTION 'BW8A slot guard lost its transaction-bound private context';
  END IF;

  -- Direct truth-table proof for the deterministic resolver. `always` is
  -- independent of dates, contract/payment is gated by its reviewed date, and
  -- minor-only fails to pending until both DOB and the explicit as-of date are
  -- known. On the exact eighteenth birthday the applicant is no longer minor.
  IF platform_private.resolve_document_applicability(
      'always', NULL, NULL
    ) <> 'required'
    OR platform_private.resolve_document_applicability(
      'after_contract_payment', NULL, NULL
    ) <> 'not_required'
    OR platform_private.resolve_document_applicability(
      'minor_only', NULL, DATE '2026-08-05'
    ) <> 'pending_information'
    OR platform_private.resolve_document_applicability(
      'minor_only', DATE '2008-08-05', NULL
    ) <> 'pending_information'
    OR platform_private.resolve_document_applicability(
      'minor_only', DATE '2008-08-06', DATE '2026-08-05'
    ) <> 'required'
    OR platform_private.resolve_document_applicability(
      'minor_only', DATE '2008-08-05', DATE '2026-08-05'
    ) <> 'not_required'
  THEN
    RAISE EXCEPTION 'BW8A document applicability resolver truth table drifted';
  END IF;

  IF NOT platform_private.is_safe_workflow_source_url(
      'google_drive_file',
      'https://drive.google.com/file/d/1EKZOzQKli3Ub2tVxsX1qlpRj21kAJ6C9/view?pli=1'
    )
    OR platform_private.is_safe_workflow_source_url(
      'google_drive_file',
      'https://drive.google.com/file/d/1EKZOzQKli3Ub2tVxsX1qlpRj21kAJ6C9/view?pli=2'
    )
    OR platform_private.is_safe_workflow_source_url(
      'google_drive_file',
      'https://drive.google.com/file/d/1EKZOzQKli3Ub2tVxsX1qlpRj21kAJ6C9/view?pli=1&x=1'
    )
    OR platform_private.is_safe_workflow_source_url(
      'google_drive_file',
      'https://drive.google.com/file/d/1EKZOzQKli3Ub2tVxsX1qlpRj21kAJ6C9/view?token=secret'
    )
    OR pg_get_functiondef(
      'platform.create_china_student_document_overlay(uuid,text,text,bigint,uuid,text,uuid)'::REGPROCEDURE
    ) NOT LIKE '%https://drive.google.com/file/d/1EKZOzQKli3Ub2tVxsX1qlpRj21kAJ6C9/view?pli=1%'
  THEN
    RAISE EXCEPTION 'BW8A reviewed China Drive URL contract drifted';
  END IF;
END
$$;

SELECT 'platform student document intelligence inventory passed' AS result;
