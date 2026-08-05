\set ON_ERROR_STOP on

-- P4B schema, projection, lock-order, RLS and ACL inventory at migration 059.
DO $$
DECLARE
  target_table CONSTANT REGCLASS :=
    'platform_private.amocrm_mapping_approval_events'::REGCLASS;
  current_view CONSTANT REGCLASS :=
    'platform_private.current_amocrm_mapping_selections'::REGCLASS;
  binding_validator CONSTANT REGPROCEDURE :=
    'platform_private.amocrm_mapping_selected_bindings_is_well_formed(jsonb)'::REGPROCEDURE;
  binding_normalizer CONSTANT REGPROCEDURE :=
    'platform_private.normalize_amocrm_mapping_selected_bindings(jsonb)'::REGPROCEDURE;
  actor_helper CONSTANT REGPROCEDURE :=
    'platform_private.require_p4b_admin_conversation_actor(uuid,uuid)'::REGPROCEDURE;
  state_rpc CONSTANT REGPROCEDURE :=
    'platform.amocrm_mapping_state_for_conversation(uuid,uuid)'::REGPROCEDURE;
  workspace_rpc CONSTANT REGPROCEDURE :=
    'platform.admin_amocrm_mapping_approval_workspace(uuid,uuid,uuid)'::REGPROCEDURE;
  approve_rpc CONSTANT REGPROCEDURE :=
    'platform.approve_amocrm_mapping_selection(uuid,uuid,uuid,jsonb,uuid,text,uuid)'::REGPROCEDURE;
  revoke_rpc CONSTANT REGPROCEDURE :=
    'platform.revoke_amocrm_mapping_selection(uuid,uuid,uuid,text,uuid)'::REGPROCEDURE;
  checked_role TEXT;
  checked_privilege TEXT;
  checked_routine REGPROCEDURE;
  actual_columns TEXT[];
  view_definition TEXT;
  actor_definition TEXT;
  approve_definition TEXT;
  request_lock_position INTEGER;
  authority_position INTEGER;
  collision_position INTEGER;
  tuple_try_lock_position INTEGER;
  tuple_lock_position INTEGER;
  latest_position INTEGER;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_class AS relation
    JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    JOIN pg_roles AS owner_role ON owner_role.oid = relation.relowner
    WHERE relation.oid = target_table
      AND namespace.nspname = 'platform_private'
      AND relation.relname = 'amocrm_mapping_approval_events'
      AND relation.relkind = 'r'
      AND relation.relpersistence = 'p'
      AND relation.relrowsecurity
      AND relation.relforcerowsecurity
      AND owner_role.rolname = 'postgres'
  ) THEN
    RAISE EXCEPTION 'P4B private event table owner/RLS contract drifted';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_policy AS policy
    WHERE policy.polrelid = target_table
  ) THEN
    RAISE EXCEPTION 'P4B private event ledger must have no browser policy';
  END IF;

  SELECT pg_catalog.array_agg(
    column_record.attname::TEXT
      || ':'
      || pg_catalog.format_type(
        column_record.atttypid,
        column_record.atttypmod
      )
      || ':'
      || CASE WHEN column_record.attnotnull THEN 'not-null' ELSE 'nullable' END
    ORDER BY column_record.attnum
  )
  INTO actual_columns
  FROM pg_attribute AS column_record
  WHERE column_record.attrelid = target_table
    AND column_record.attnum > 0
    AND NOT column_record.attisdropped;

  IF actual_columns IS DISTINCT FROM ARRAY[
    'id:uuid:not-null',
    'organization_id:uuid:not-null',
    'amocrm_account_id:bigint:not-null',
    'mapping_use:text:not-null',
    'event_version:bigint:not-null',
    'event_kind:text:not-null',
    'discovery_version_id:uuid:not-null',
    'selected_bindings:jsonb:not-null',
    'prior_event_id:uuid:nullable',
    'decision_conversation_id:uuid:not-null',
    'actor_profile_id:uuid:not-null',
    'actor_membership_id:uuid:not-null',
    'reason:text:not-null',
    'request_id:uuid:not-null',
    'created_at:timestamp with time zone:not-null'
  ]::TEXT[] THEN
    RAISE EXCEPTION 'P4B event ledger column contract drifted: %',
      actual_columns;
  END IF;

  IF (
    SELECT pg_catalog.array_agg(
      constraint_record.conname::TEXT ORDER BY constraint_record.conname
    )
    FROM pg_constraint AS constraint_record
    WHERE constraint_record.conrelid = target_table
      AND constraint_record.contype IN ('f', 'p', 'u')
  ) IS DISTINCT FROM ARRAY[
    'amocrm_mapping_approval_events_actor_membership_fkey',
    'amocrm_mapping_approval_events_actor_profile_id_fkey',
    'amocrm_mapping_approval_events_conversation_fkey',
    'amocrm_mapping_approval_events_discovery_fkey',
    'amocrm_mapping_approval_events_org_account_use_id_key',
    'amocrm_mapping_approval_events_org_account_use_version_key',
    'amocrm_mapping_approval_events_organization_id_fkey',
    'amocrm_mapping_approval_events_pkey',
    'amocrm_mapping_approval_events_prior_fkey',
    'amocrm_mapping_approval_events_request_id_key'
  ]::TEXT[] THEN
    RAISE EXCEPTION 'P4B primary/unique/FK inventory drifted';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint AS constraint_record
    WHERE constraint_record.conrelid =
      'platform_private.amocrm_mapping_discovery_versions'::REGCLASS
      AND constraint_record.conname =
        'amocrm_mapping_discovery_versions_org_account_id_key'
      AND constraint_record.contype = 'u'
  ) THEN
    RAISE EXCEPTION 'P4B discovery tenant/account FK anchor is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint AS constraint_record
    WHERE constraint_record.conrelid = target_table
      AND constraint_record.contype = 'c'
      AND pg_catalog.pg_get_constraintdef(constraint_record.oid)
        LIKE '%amocrm_mapping_selected_bindings_is_well_formed%'
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_constraint AS constraint_record
    WHERE constraint_record.conrelid = target_table
      AND constraint_record.contype = 'c'
      AND pg_catalog.pg_get_constraintdef(constraint_record.oid)
        LIKE '%mapping_use%messaging%'
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_constraint AS constraint_record
    WHERE constraint_record.conrelid = target_table
      AND constraint_record.contype = 'c'
      AND pg_catalog.pg_get_constraintdef(constraint_record.oid)
        LIKE '%approved%revoked%'
  ) THEN
    RAISE EXCEPTION 'P4B binding/use/event checks drifted';
  END IF;

  IF (
    SELECT pg_catalog.array_agg(
      trigger_record.tgname::TEXT ORDER BY trigger_record.tgname
    )
    FROM pg_trigger AS trigger_record
    WHERE trigger_record.tgrelid = target_table
      AND NOT trigger_record.tgisinternal
  ) IS DISTINCT FROM ARRAY[
    'amocrm_mapping_approval_events_append_only_rows',
    'amocrm_mapping_approval_events_no_truncate'
  ]::TEXT[] THEN
    RAISE EXCEPTION 'P4B append-only trigger inventory drifted';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger AS trigger_record
    WHERE trigger_record.tgrelid = target_table
      AND trigger_record.tgname =
        'amocrm_mapping_approval_events_append_only_rows'
      AND trigger_record.tgfoid =
        'platform_private.block_append_only_mutation()'::REGPROCEDURE
      AND trigger_record.tgtype = 27
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_trigger AS trigger_record
    WHERE trigger_record.tgrelid = target_table
      AND trigger_record.tgname =
        'amocrm_mapping_approval_events_no_truncate'
      AND trigger_record.tgfoid =
        'platform_private.block_append_only_mutation()'::REGPROCEDURE
      AND trigger_record.tgtype = 34
  ) THEN
    RAISE EXCEPTION 'P4B append-only trigger behavior drifted';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_class AS relation
    JOIN pg_roles AS owner_role ON owner_role.oid = relation.relowner
    WHERE relation.oid = current_view
      AND relation.relkind = 'v'
      AND owner_role.rolname = 'postgres'
  ) THEN
    RAISE EXCEPTION 'P4B current projection owner/type drifted';
  END IF;

  SELECT pg_catalog.regexp_replace(
    pg_catalog.lower(pg_catalog.pg_get_viewdef(current_view, TRUE)),
    '[[:space:]()]',
    '',
    'g'
  )
  INTO view_definition;

  -- pg_get_viewdef formatting is version-dependent. Keep this check structural;
  -- the RLS suite proves behavior by revoking, reapproving and replaying an
  -- older event without resurrecting it as the current selection.
  IF pg_catalog.strpos(view_definition, 'distincton') = 0
    OR pg_catalog.strpos(view_definition, 'event_versiondesc') = 0
    OR pg_catalog.strpos(view_definition, 'event_kind') = 0
    OR pg_catalog.strpos(view_definition, '''approved''') = 0
  THEN
    RAISE EXCEPTION
      'P4B projection must retain latest-event and approved-state structure';
  END IF;

  FOREACH checked_privilege IN ARRAY ARRAY[
    'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
  ] LOOP
    FOREACH checked_role IN ARRAY ARRAY[
      'anon', 'authenticated', 'service_role', 'supabase_auth_admin'
    ] LOOP
      IF has_table_privilege(
        checked_role,
        target_table,
        checked_privilege
      ) THEN
        RAISE EXCEPTION 'P4B table leaked % to %',
          checked_privilege,
          checked_role;
      END IF;
    END LOOP;
  END LOOP;

  FOREACH checked_role IN ARRAY ARRAY[
    'anon', 'authenticated', 'service_role', 'supabase_auth_admin'
  ] LOOP
    IF has_table_privilege(checked_role, current_view, 'SELECT') THEN
      RAISE EXCEPTION 'P4B private projection leaked SELECT to %',
        checked_role;
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc AS routine
    JOIN pg_roles AS owner_role ON owner_role.oid = routine.proowner
    WHERE routine.oid = state_rpc
      AND owner_role.rolname = 'postgres'
      AND routine.prosecdef
      AND routine.provolatile = 's'
      AND routine.proconfig @> ARRAY['search_path=""']::TEXT[]
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_proc AS routine
    JOIN pg_roles AS owner_role ON owner_role.oid = routine.proowner
    WHERE routine.oid = workspace_rpc
      AND owner_role.rolname = 'postgres'
      AND routine.prosecdef
      AND routine.provolatile = 's'
      AND routine.proconfig @> ARRAY['search_path=""']::TEXT[]
      AND routine.pronargdefaults = 1
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_proc AS routine
    JOIN pg_roles AS owner_role ON owner_role.oid = routine.proowner
    WHERE routine.oid = approve_rpc
      AND owner_role.rolname = 'postgres'
      AND routine.prosecdef
      AND routine.provolatile = 'v'
      AND routine.proconfig @> ARRAY['search_path=""']::TEXT[]
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_proc AS routine
    JOIN pg_roles AS owner_role ON owner_role.oid = routine.proowner
    WHERE routine.oid = revoke_rpc
      AND owner_role.rolname = 'postgres'
      AND routine.prosecdef
      AND routine.provolatile = 'v'
      AND routine.proconfig @> ARRAY['search_path=""']::TEXT[]
  ) THEN
    RAISE EXCEPTION 'P4B public RPC owner/security/search_path drifted';
  END IF;

  IF (
    SELECT routine.proargnames[3:6]
    FROM pg_proc AS routine WHERE routine.oid = state_rpc
  ) IS DISTINCT FROM ARRAY[
    'organization_id',
    'conversation_id',
    'mapping_use',
    'mapping_state'
  ]::TEXT[] OR (
    SELECT routine.proargnames[4:26]
    FROM pg_proc AS routine WHERE routine.oid = workspace_rpc
  ) IS DISTINCT FROM ARRAY[
    'organization_id',
    'conversation_id',
    'amocrm_account_id',
    'mapping_use',
    'mapping_state',
    'review_discovery_version_id',
    'review_discovery_version',
    'review_account_domain',
    'review_account_subdomain',
    'review_sanitized_snapshot',
    'review_snapshot_sha256',
    'review_evidence_kind',
    'review_evidence_ref',
    'review_discovered_at',
    'current_event_id',
    'current_event_kind',
    'current_discovery_version_id',
    'current_discovery_version',
    'current_selected_bindings',
    'current_reason',
    'current_actor_profile_id',
    'current_request_id',
    'current_created_at'
  ]::TEXT[] OR (
    SELECT routine.proargnames[8:22]
    FROM pg_proc AS routine WHERE routine.oid = approve_rpc
  ) IS DISTINCT FROM ARRAY[
    'approval_event_id',
    'organization_id',
    'amocrm_account_id',
    'mapping_use',
    'event_version',
    'event_kind',
    'discovery_version_id',
    'discovery_version',
    'selected_bindings',
    'prior_event_id',
    'actor_profile_id',
    'reason',
    'request_id',
    'created_at',
    'mapping_state'
  ]::TEXT[] OR (
    SELECT routine.proargnames[6:20]
    FROM pg_proc AS routine WHERE routine.oid = revoke_rpc
  ) IS DISTINCT FROM ARRAY[
    'approval_event_id',
    'organization_id',
    'amocrm_account_id',
    'mapping_use',
    'event_version',
    'event_kind',
    'discovery_version_id',
    'discovery_version',
    'selected_bindings',
    'prior_event_id',
    'actor_profile_id',
    'reason',
    'request_id',
    'created_at',
    'mapping_state'
  ]::TEXT[] THEN
    RAISE EXCEPTION 'P4B RPC result aliases drifted';
  END IF;

  IF (
    SELECT pg_catalog.pg_get_expr(routine.proargdefaults, 0)
    FROM pg_proc AS routine WHERE routine.oid = workspace_rpc
  ) IS DISTINCT FROM 'NULL::uuid' THEN
    RAISE EXCEPTION 'P4B workspace latest-discovery default drifted';
  END IF;

  FOREACH checked_routine IN ARRAY ARRAY[
    binding_validator,
    binding_normalizer,
    actor_helper,
    state_rpc,
    workspace_rpc,
    approve_rpc,
    revoke_rpc
  ] LOOP
    IF EXISTS (
      SELECT 1
      FROM pg_proc AS routine
      CROSS JOIN LATERAL pg_catalog.aclexplode(
        COALESCE(
          routine.proacl,
          pg_catalog.acldefault('f', routine.proowner)
        )
      ) AS privilege
      WHERE routine.oid = checked_routine
        AND privilege.grantee = 0
        AND privilege.privilege_type = 'EXECUTE'
    ) THEN
      RAISE EXCEPTION 'P4B routine % leaked EXECUTE to PUBLIC',
        checked_routine;
    END IF;
  END LOOP;

  FOREACH checked_routine IN ARRAY ARRAY[
    state_rpc, workspace_rpc, approve_rpc, revoke_rpc
  ] LOOP
    IF NOT has_function_privilege(
      'authenticated',
      checked_routine,
      'EXECUTE'
    ) OR has_function_privilege('anon', checked_routine, 'EXECUTE')
      OR has_function_privilege('service_role', checked_routine, 'EXECUTE')
      OR has_function_privilege(
        'supabase_auth_admin',
        checked_routine,
        'EXECUTE'
      )
    THEN
      RAISE EXCEPTION 'P4B RPC EXECUTE ACL drifted for %', checked_routine;
    END IF;
  END LOOP;

  FOREACH checked_routine IN ARRAY ARRAY[
    binding_validator, binding_normalizer, actor_helper
  ] LOOP
    FOREACH checked_role IN ARRAY ARRAY[
      'anon', 'authenticated', 'service_role', 'supabase_auth_admin'
    ] LOOP
      IF has_function_privilege(
        checked_role,
        checked_routine,
        'EXECUTE'
      ) THEN
        RAISE EXCEPTION 'P4B private helper % leaked to %',
          checked_routine,
          checked_role;
      END IF;
    END LOOP;
  END LOOP;

  SELECT pg_catalog.regexp_replace(
    pg_catalog.pg_get_functiondef(actor_helper),
    E'[[:space:]]+',
    ' ',
    'g'
  )
  INTO actor_definition;

  IF pg_catalog.strpos(
    actor_definition,
    'FOR SHARE OF profile, membership, organization, bundle, conversation'
  ) = 0
    OR pg_catalog.strpos(actor_definition, 'FOR UPDATE OF') <> 0
    OR pg_catalog.strpos(actor_definition, 'require_domain_actor(') <> 0
  THEN
    RAISE EXCEPTION
      'P4B live-authority helper must use non-serializing shared row locks';
  END IF;

  -- This is a comment-stripped structural guard, not concurrency proof. The
  -- separate local PostgREST Promise.all race exercises executable fail-fast
  -- tuple serialization and the single-winner/PT409 behavior across sessions.
  FOREACH checked_routine IN ARRAY ARRAY[approve_rpc, revoke_rpc] LOOP
    SELECT pg_catalog.regexp_replace(
      pg_catalog.pg_get_functiondef(checked_routine),
      E'--[^\\n]*(\\n|$)',
      E'\\n',
      'g'
    )
    INTO approve_definition;
    request_lock_position := pg_catalog.strpos(
      approve_definition,
      'evo:p4b:amocrm-mapping-request:'
    );
    authority_position := pg_catalog.strpos(
      approve_definition,
      'require_p4b_admin_conversation_actor'
    );
    collision_position := pg_catalog.strpos(
      approve_definition,
      'request_id is already owned by another operation'
    );
    tuple_try_lock_position := pg_catalog.strpos(
      approve_definition,
      'pg_try_advisory_xact_lock'
    );
    tuple_lock_position := pg_catalog.strpos(
      approve_definition,
      'evo:p4b:amocrm-mapping-tuple:'
    );
    latest_position := pg_catalog.strpos(
      approve_definition,
      'ORDER BY event.event_version DESC, event.id DESC'
    );

    IF request_lock_position = 0
      OR authority_position = 0
      OR collision_position = 0
      OR tuple_try_lock_position = 0
      OR tuple_lock_position = 0
      OR latest_position = 0
      OR request_lock_position >= authority_position
      OR authority_position >= collision_position
      OR collision_position >= tuple_try_lock_position
      OR tuple_try_lock_position >= tuple_lock_position
      OR tuple_lock_position >= latest_position
    THEN
      RAISE EXCEPTION
        'P4B request/authority/collision/try-tuple/latest order drifted for %',
        checked_routine;
    END IF;
  END LOOP;

  -- Do not duplicate executable security behavior with pg_get_functiondef
  -- string matching: PostgreSQL deparser output changes across supported
  -- versions. The stateful RLS suite executes both stale PT409 paths, rejects
  -- a forged responsible-user source and verifies provider_proof=false in all
  -- append-only approval/revocation audit events. The local auth hook also
  -- proves the single-winner/PT409 contract across independent sessions.

  IF EXISTS (
    SELECT 1
    FROM platform.permission_definitions AS permission
    WHERE permission.permission_key LIKE '%amocrm%'
      OR permission.permission_key LIKE '%mapping.approval%'
  ) OR EXISTS (
    SELECT 1
    FROM platform.role_bundle_versions AS bundle
    WHERE bundle.version > 11
  ) THEN
    RAISE EXCEPTION 'P4B incorrectly introduced RBAC permission/bundle state';
  END IF;
END
$$;

SELECT 'platform amoCRM mapping approval inventory passed' AS result;
