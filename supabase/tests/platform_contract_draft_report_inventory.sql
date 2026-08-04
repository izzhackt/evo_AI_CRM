\set ON_ERROR_STOP on

-- BW6 catalog, ACL and API inventory at the exact migration-057 boundary.
DO $$
DECLARE
  checked_table_name TEXT;
  checked_relation REGCLASS;
  checked_role TEXT;
  checked_routine REGPROCEDURE;
  authenticated_routines REGPROCEDURE[] := ARRAY[
    'platform.create_contract_template_version(uuid,text,text,uuid,jsonb,text,jsonb,text,uuid)'::REGPROCEDURE,
    'platform.approve_contract_template_version(uuid,uuid,text,uuid)'::REGPROCEDURE,
    'platform.retire_contract_template_version(uuid,uuid,text,uuid)'::REGPROCEDURE,
    'platform.generate_student_case_contract_draft(uuid,uuid,uuid,text,uuid)'::REGPROCEDURE,
    'platform.review_student_case_contract_draft(uuid,uuid,uuid,platform.contract_artifact_review_decision,text,uuid)'::REGPROCEDURE,
    'platform.seed_post_contract_items(uuid,uuid,uuid,text,uuid)'::REGPROCEDURE,
    'platform.update_post_contract_item(uuid,uuid,uuid,bigint,platform.post_contract_item_status,uuid,text,text,text,uuid)'::REGPROCEDURE,
    'platform.generate_post_contract_report(uuid,uuid,uuid,text,uuid)'::REGPROCEDURE,
    'platform.review_post_contract_report(uuid,uuid,uuid,platform.contract_artifact_review_decision,text,uuid)'::REGPROCEDURE,
    'platform.staff_case_contract_workspace(uuid,uuid)'::REGPROCEDURE
  ];
  private_routines REGPROCEDURE[] := ARRAY[
    'platform_private.contract_manifest_source_type(text)'::REGPROCEDURE,
    'platform_private.contract_field_manifest_is_valid(jsonb)'::REGPROCEDURE,
    'platform_private.contract_template_is_valid(text,jsonb)'::REGPROCEDURE,
    'platform_private.post_contract_blueprint_is_valid(jsonb)'::REGPROCEDURE,
    'platform_private.require_bw6_admin_actor(uuid)'::REGPROCEDURE,
    'platform_private.require_bw6_case_actor(uuid,uuid,text,boolean)'::REGPROCEDURE
  ];
BEGIN
  IF to_regprocedure('public.uuid_generate_v5(uuid,text)') IS NULL THEN
    RAISE EXCEPTION 'BW6 did not repair the migration-052 uuid v5 namespace';
  END IF;

  IF has_function_privilege(
      'anon',
      'public.uuid_generate_v5(uuid,text)',
      'EXECUTE'
    )
    OR has_function_privilege(
      'authenticated',
      'public.uuid_generate_v5(uuid,text)',
      'EXECUTE'
    )
    OR has_function_privilege(
      'service_role',
      'public.uuid_generate_v5(uuid,text)',
      'EXECUTE'
    )
    OR has_function_privilege(
      'supabase_auth_admin',
      'public.uuid_generate_v5(uuid,text)',
      'EXECUTE'
    )
  THEN
    RAISE EXCEPTION 'BW6 uuid v5 compatibility entry point is API-callable';
  END IF;

  IF (
    SELECT array_agg(enum_value.enumlabel ORDER BY enum_value.enumsortorder)
    FROM pg_type AS enum_type
    JOIN pg_namespace AS namespace ON namespace.oid = enum_type.typnamespace
    JOIN pg_enum AS enum_value ON enum_value.enumtypid = enum_type.oid
    WHERE namespace.nspname = 'platform'
      AND enum_type.typname = 'contract_template_version_status'
  ) IS DISTINCT FROM ARRAY['draft', 'approved', 'retired']::NAME[] THEN
    RAISE EXCEPTION 'BW6 template status enum drifted';
  END IF;
  IF (
    SELECT array_agg(enum_value.enumlabel ORDER BY enum_value.enumsortorder)
    FROM pg_type AS enum_type
    JOIN pg_namespace AS namespace ON namespace.oid = enum_type.typnamespace
    JOIN pg_enum AS enum_value ON enum_value.enumtypid = enum_type.oid
    WHERE namespace.nspname = 'platform'
      AND enum_type.typname = 'contract_artifact_status'
  ) IS DISTINCT FROM ARRAY['draft', 'approved', 'rejected']::NAME[] THEN
    RAISE EXCEPTION 'BW6 artifact status enum drifted';
  END IF;
  IF (
    SELECT array_agg(enum_value.enumlabel ORDER BY enum_value.enumsortorder)
    FROM pg_type AS enum_type
    JOIN pg_namespace AS namespace ON namespace.oid = enum_type.typnamespace
    JOIN pg_enum AS enum_value ON enum_value.enumtypid = enum_type.oid
    WHERE namespace.nspname = 'platform'
      AND enum_type.typname = 'contract_artifact_review_decision'
  ) IS DISTINCT FROM ARRAY['approved', 'rejected']::NAME[] THEN
    RAISE EXCEPTION 'BW6 artifact decision enum drifted';
  END IF;
  IF (
    SELECT array_agg(enum_value.enumlabel ORDER BY enum_value.enumsortorder)
    FROM pg_type AS enum_type
    JOIN pg_namespace AS namespace ON namespace.oid = enum_type.typnamespace
    JOIN pg_enum AS enum_value ON enum_value.enumtypid = enum_type.oid
    WHERE namespace.nspname = 'platform'
      AND enum_type.typname = 'post_contract_item_status'
  ) IS DISTINCT FROM ARRAY[
    'open', 'in_progress', 'blocked', 'delivered'
  ]::NAME[] THEN
    RAISE EXCEPTION 'BW6 item status enum drifted';
  END IF;

  FOREACH checked_table_name IN ARRAY ARRAY[
    'contract_template_versions',
    'student_case_contract_drafts',
    'post_contract_items',
    'post_contract_reports'
  ] LOOP
    checked_relation := format('platform.%I', checked_table_name)::REGCLASS;
    IF NOT EXISTS (
      SELECT 1
      FROM pg_class AS relation
      JOIN pg_roles AS owner_role ON owner_role.oid = relation.relowner
      WHERE relation.oid = checked_relation
        AND relation.relkind = 'r'
        AND relation.relrowsecurity
        AND relation.relforcerowsecurity
        AND owner_role.rolname = 'postgres'
    ) THEN
      RAISE EXCEPTION 'BW6 relation % owner/RLS drifted', checked_table_name;
    END IF;
    IF NOT has_table_privilege('authenticated', checked_relation, 'SELECT')
      OR has_table_privilege('authenticated', checked_relation, 'INSERT')
      OR has_table_privilege('authenticated', checked_relation, 'UPDATE')
      OR has_table_privilege('authenticated', checked_relation, 'DELETE')
    THEN
      RAISE EXCEPTION 'BW6 relation % authenticated ACL drifted', checked_table_name;
    END IF;
    IF EXISTS (
      SELECT 1
      FROM aclexplode(
        COALESCE(
          (SELECT relation.relacl FROM pg_class AS relation WHERE relation.oid = checked_relation),
          acldefault(
            'r',
            (SELECT relation.relowner FROM pg_class AS relation WHERE relation.oid = checked_relation)
          )
        )
      ) AS privilege
      WHERE privilege.grantee = 0
        AND privilege.privilege_type IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
    ) THEN
      RAISE EXCEPTION 'BW6 relation % leaked to PUBLIC', checked_table_name;
    END IF;
    FOREACH checked_role IN ARRAY ARRAY[
      'anon', 'service_role', 'supabase_auth_admin'
    ] LOOP
      IF has_table_privilege(checked_role, checked_relation, 'SELECT')
        OR has_table_privilege(checked_role, checked_relation, 'INSERT')
        OR has_table_privilege(checked_role, checked_relation, 'UPDATE')
        OR has_table_privilege(checked_role, checked_relation, 'DELETE')
      THEN
        RAISE EXCEPTION 'BW6 relation % leaked to %',
          checked_table_name, checked_role;
      END IF;
    END LOOP;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_attribute AS attribute
    WHERE attribute.attrelid = 'platform.post_contract_reports'::REGCLASS
      AND attribute.attname = 'contract_template_version_id'
      AND attribute.attnotnull
      AND NOT attribute.attisdropped
  ) THEN
    RAISE EXCEPTION 'BW6 report template pin is missing or nullable';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint AS constraint_record
    WHERE constraint_record.conrelid = 'platform.post_contract_reports'::REGCLASS
      AND constraint_record.conname = 'post_contract_reports_template_fkey'
      AND constraint_record.contype = 'f'
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_constraint AS constraint_record
    WHERE constraint_record.conrelid = 'platform.post_contract_reports'::REGCLASS
      AND constraint_record.conname = 'post_contract_reports_template_version_key'
      AND constraint_record.contype = 'u'
  ) THEN
    RAISE EXCEPTION 'BW6 report template FK/version scope drifted';
  END IF;
  IF to_regprocedure(
    'platform.generate_post_contract_report(uuid,uuid,text,uuid)'
  ) IS NOT NULL THEN
    RAISE EXCEPTION 'BW6 case-wide report generator overload remains callable';
  END IF;
  IF (
    SELECT procedure.proargnames
    FROM pg_proc AS procedure
    WHERE procedure.oid =
      'platform.generate_post_contract_report(uuid,uuid,uuid,text,uuid)'::REGPROCEDURE
  ) IS DISTINCT FROM ARRAY[
    'p_organization_id',
    'p_student_case_id',
    'p_contract_template_version_id',
    'p_reason',
    'p_request_id'
  ]::TEXT[] THEN
    RAISE EXCEPTION 'BW6 report generator argument contract drifted';
  END IF;

  IF (
    SELECT array_agg(policy.policyname ORDER BY policy.policyname)
    FROM pg_policies AS policy
    WHERE policy.schemaname = 'platform'
      AND policy.tablename IN (
        'contract_template_versions',
        'student_case_contract_drafts',
        'post_contract_items',
        'post_contract_reports'
      )
  ) IS DISTINCT FROM ARRAY[
    'contract_template_versions_read',
    'post_contract_items_read',
    'post_contract_reports_read',
    'student_case_contract_drafts_read'
  ]::NAME[] THEN
    RAISE EXCEPTION 'BW6 RLS policy inventory drifted';
  END IF;

  IF (
    SELECT array_agg(trigger_name ORDER BY trigger_name)
    FROM (
      SELECT trigger.tgname AS trigger_name
      FROM pg_trigger AS trigger
      WHERE trigger.tgrelid IN (
        'platform.contract_template_versions'::REGCLASS,
        'platform.student_case_contract_drafts'::REGCLASS,
        'platform.post_contract_items'::REGCLASS,
        'platform.post_contract_reports'::REGCLASS
      )
        AND NOT trigger.tgisinternal
    ) AS trigger_inventory
  ) IS DISTINCT FROM ARRAY[
    'contract_template_versions_guard_mutation',
    'contract_template_versions_no_truncate',
    'post_contract_items_guard_mutation',
    'post_contract_items_no_truncate',
    'post_contract_reports_guard_mutation',
    'post_contract_reports_no_truncate',
    'student_case_contract_drafts_guard_mutation',
    'student_case_contract_drafts_no_truncate'
  ]::NAME[] THEN
    RAISE EXCEPTION 'BW6 immutability trigger inventory drifted';
  END IF;

  FOREACH checked_routine IN ARRAY authenticated_routines LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_proc AS procedure
      WHERE procedure.oid = checked_routine
        AND procedure.prosecdef
        AND procedure.proconfig @> ARRAY['search_path=""']::TEXT[]
        AND procedure.prorettype = 'jsonb'::REGTYPE
    ) THEN
      RAISE EXCEPTION 'BW6 RPC % security/return contract drifted', checked_routine;
    END IF;
    IF NOT has_function_privilege('authenticated', checked_routine, 'EXECUTE')
      OR EXISTS (
        SELECT 1
        FROM aclexplode(
          COALESCE(
            (SELECT procedure.proacl FROM pg_proc AS procedure WHERE procedure.oid = checked_routine),
            acldefault(
              'f',
              (SELECT procedure.proowner FROM pg_proc AS procedure WHERE procedure.oid = checked_routine)
            )
          )
        ) AS privilege
        WHERE privilege.grantee = 0
          AND privilege.privilege_type = 'EXECUTE'
      )
      OR has_function_privilege('anon', checked_routine, 'EXECUTE')
      OR has_function_privilege('service_role', checked_routine, 'EXECUTE')
      OR has_function_privilege(
        'supabase_auth_admin', checked_routine, 'EXECUTE'
      )
    THEN
      RAISE EXCEPTION 'BW6 RPC % ACL drifted', checked_routine;
    END IF;
  END LOOP;

  FOREACH checked_routine IN ARRAY private_routines LOOP
    IF EXISTS (
        SELECT 1
        FROM aclexplode(
          COALESCE(
            (SELECT procedure.proacl FROM pg_proc AS procedure WHERE procedure.oid = checked_routine),
            acldefault(
              'f',
              (SELECT procedure.proowner FROM pg_proc AS procedure WHERE procedure.oid = checked_routine)
            )
          )
        ) AS privilege
        WHERE privilege.grantee = 0
          AND privilege.privilege_type = 'EXECUTE'
      )
      OR has_function_privilege('anon', checked_routine, 'EXECUTE')
      OR has_function_privilege('authenticated', checked_routine, 'EXECUTE')
      OR has_function_privilege('service_role', checked_routine, 'EXECUTE')
      OR has_function_privilege(
        'supabase_auth_admin', checked_routine, 'EXECUTE'
      )
    THEN
      RAISE EXCEPTION 'BW6 private routine % leaked execute', checked_routine;
    END IF;
  END LOOP;

  IF (
    SELECT procedure.proargnames
    FROM pg_proc AS procedure
    WHERE procedure.oid =
      'platform.create_contract_template_version(uuid,text,text,uuid,jsonb,text,jsonb,text,uuid)'::REGPROCEDURE
  ) IS DISTINCT FROM ARRAY[
    'p_organization_id',
    'p_template_key',
    'p_title',
    'p_source_registry_id',
    'p_field_manifest',
    'p_template_text',
    'p_post_contract_checklist_blueprint',
    'p_reason',
    'p_request_id'
  ]::TEXT[] THEN
    RAISE EXCEPTION 'BW6 create-template argument names drifted';
  END IF;

  IF (
    SELECT procedure.proargnames
    FROM pg_proc AS procedure
    WHERE procedure.oid =
      'platform.update_post_contract_item(uuid,uuid,uuid,bigint,platform.post_contract_item_status,uuid,text,text,text,uuid)'::REGPROCEDURE
  ) IS DISTINCT FROM ARRAY[
    'p_organization_id',
    'p_student_case_id',
    'p_post_contract_item_id',
    'p_expected_revision',
    'p_status',
    'p_owner_membership_id',
    'p_next_action',
    'p_evidence_ref',
    'p_reason',
    'p_request_id'
  ]::TEXT[] THEN
    RAISE EXCEPTION 'BW6 update-item argument names drifted';
  END IF;

  IF platform_private.contract_manifest_source_type(
    'student_case.student_display_name'
  ) <> 'text'
    OR platform_private.contract_manifest_source_type(
      'student_profile.date_of_birth'
    ) <> 'date'
    OR platform_private.contract_manifest_source_type(
      'country_requirement.version'
    ) <> 'integer'
    OR platform_private.contract_manifest_source_type(
      'handoff.approved_commercial_fields.fee_amount_minor'
    ) <> 'integer'
    OR platform_private.contract_manifest_source_type(
      'chat.raw_body'
    ) IS NOT NULL
  THEN
    RAISE EXCEPTION 'BW6 manifest source allowlist drifted';
  END IF;

  IF NOT platform_private.contract_template_is_valid(
    'Student: {{student_name}}',
    '[{"field_key":"student_name","source_path":"student_case.student_display_name","value_type":"text","required":true}]'::JSONB
  )
    OR platform_private.contract_template_is_valid(
      'Student: {{unknown_field}}',
      '[{"field_key":"student_name","source_path":"student_case.student_display_name","value_type":"text","required":true}]'::JSONB
    )
    OR platform_private.contract_field_manifest_is_valid(
      '[{"field_key":"chat","source_path":"chat.raw_body","value_type":"text","required":true}]'::JSONB
    )
    OR NOT platform_private.post_contract_blueprint_is_valid(
      '[{"item_key":"welcome_pack","label":"Send synthetic welcome pack","owner_role":"curator","next_action":"Send synthetic pack"}]'::JSONB
    )
  THEN
    RAISE EXCEPTION 'BW6 manifest, placeholder or blueprint validation drifted';
  END IF;

  IF (
    SELECT count(*)
    FROM platform.permission_definitions AS permission
    WHERE permission.permission_key IN (
      'contract.template.read',
      'contract.template.manage',
      'contract.draft.manage',
      'post.contract.manage'
    )
  ) <> 4 THEN
    RAISE EXCEPTION 'BW6 permission catalog drifted';
  END IF;

  IF (
    SELECT count(*)
    FROM platform.role_bundle_versions AS bundle
    WHERE bundle.version = 11
      AND bundle.status = 'published'
  ) <> 5 THEN
    RAISE EXCEPTION 'BW6 published v11 bundle inventory drifted';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM platform.role_bundle_versions AS v11
    JOIN platform.role_bundle_versions AS v10 ON v10.role = v11.role
    WHERE v11.version = 11
      AND v10.version = 10
      AND EXISTS (
        SELECT permission.permission_key
        FROM platform.role_bundle_permissions AS permission
        WHERE permission.bundle_id = v10.id
        EXCEPT
        SELECT permission.permission_key
        FROM platform.role_bundle_permissions AS permission
        WHERE permission.bundle_id = v11.id
      )
  ) THEN
    RAISE EXCEPTION 'BW6 v11 bundles failed to preserve v10 permissions';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM platform.role_bundle_permissions AS permission
    JOIN platform.role_bundle_versions AS bundle
      ON bundle.id = permission.bundle_id
    WHERE bundle.version = 11
      AND permission.permission_key IN (
        'contract.template.read',
        'contract.template.manage',
        'contract.draft.manage',
        'post.contract.manage'
      )
      AND NOT (
        (bundle.role = 'admin')
        OR (
          bundle.role = 'sales'
          AND permission.permission_key IN (
            'contract.template.read', 'contract.draft.manage'
          )
        )
        OR (
          bundle.role = 'curator'
          AND permission.permission_key IN (
            'contract.template.read',
            'contract.draft.manage',
            'post.contract.manage'
          )
        )
      )
  ) OR EXISTS (
    SELECT 1
    FROM platform.role_bundle_versions AS bundle
    WHERE bundle.version = 11
      AND (
        (bundle.role = 'admin' AND 4 <> (
          SELECT count(*)
          FROM platform.role_bundle_permissions AS permission
          WHERE permission.bundle_id = bundle.id
            AND permission.permission_key IN (
              'contract.template.read',
              'contract.template.manage',
              'contract.draft.manage',
              'post.contract.manage'
            )
        ))
        OR (bundle.role = 'sales' AND 2 <> (
          SELECT count(*)
          FROM platform.role_bundle_permissions AS permission
          WHERE permission.bundle_id = bundle.id
            AND permission.permission_key IN (
              'contract.template.read',
              'contract.draft.manage'
            )
        ))
        OR (bundle.role = 'curator' AND 3 <> (
          SELECT count(*)
          FROM platform.role_bundle_permissions AS permission
          WHERE permission.bundle_id = bundle.id
            AND permission.permission_key IN (
              'contract.template.read',
              'contract.draft.manage',
              'post.contract.manage'
            )
        ))
      )
  ) THEN
    RAISE EXCEPTION 'BW6 v11 role/permission matrix drifted';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM platform.organization_memberships AS membership
    JOIN platform.role_bundle_versions AS bundle
      ON bundle.id = membership.current_bundle_id
    WHERE membership."current_role" IS NOT NULL
      AND membership.current_bundle_id IS NOT NULL
      AND (
        bundle.version <> 11
        OR bundle.role <> membership."current_role"
        OR bundle.status <> 'published'
      )
  ) THEN
    RAISE EXCEPTION 'BW6 left a membership outside its v11 bundle';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM platform.membership_role_history AS history
    LEFT JOIN platform.audit_events AS audit
      ON audit.request_id = history.request_id
      AND audit.organization_id = history.organization_id
      AND audit.resource_id = history.membership_id
      AND audit.action = 'rbac.bundle.upgrade'
    JOIN platform.role_bundle_versions AS previous_bundle
      ON previous_bundle.id = history.previous_bundle_id
    JOIN platform.role_bundle_versions AS new_bundle
      ON new_bundle.id = history.new_bundle_id
    JOIN platform.profiles AS profile ON profile.id = history.profile_id
    WHERE history.reason = 'BW6 immutable RBAC bundle upgrade'
      AND (
        audit.id IS NULL
        OR previous_bundle.version <> 10
        OR new_bundle.version <> 11
        OR (audit.before_state ->> 'access_version')::BIGINT + 1 <>
          (audit.after_state ->> 'access_version')::BIGINT
        OR (audit.after_state ->> 'access_version')::BIGINT <>
          profile.access_version
      )
  ) THEN
    RAISE EXCEPTION 'BW6 membership upgrade evidence drifted';
  END IF;
END
$$;

SELECT 'platform contract draft/report inventory passed' AS result;
