-- Canonical append-only human notes on a lead or a student case.
--
-- A note is a recorded fact, not a mutable field: staff correct a note by
-- writing a newer one. UPDATE and DELETE are therefore closed at the grant
-- level, by the absence of any RLS policy and by an append-only trigger.
-- All access goes through two RPCs with the same actor guards the owning
-- domains already use: the Sales lead-workflow authority for lead notes and
-- the exact-case operator authority for student-case notes.

BEGIN;

CREATE TABLE platform.case_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL
    REFERENCES platform.organizations(id) ON DELETE RESTRICT,
  lead_id UUID,
  student_case_id UUID,
  -- Match ECMAScript String.trim() exactly at the SQL boundary so an
  -- authenticated direct RPC cannot persist a value the TypeScript reader
  -- later rejects. Internal LF/CR/TAB remain valid note prose.
  body TEXT NOT NULL CHECK (
    body = btrim(
      body,
      U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF'
    )
    AND body <> ''
    AND char_length(body) <= 4000
  ),
  created_by_membership_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT case_notes_organization_id_id_key UNIQUE (organization_id, id),
  CONSTRAINT case_notes_exactly_one_subject CHECK (
    num_nonnulls(lead_id, student_case_id) = 1
  ),
  CONSTRAINT case_notes_lead_fkey
    FOREIGN KEY (organization_id, lead_id)
    REFERENCES platform.leads(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT case_notes_student_case_fkey
    FOREIGN KEY (organization_id, student_case_id)
    REFERENCES platform.student_cases(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT case_notes_author_membership_fkey
    FOREIGN KEY (organization_id, created_by_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id)
    ON DELETE RESTRICT
);

CREATE INDEX case_notes_lead_page_idx
  ON platform.case_notes (organization_id, lead_id, created_at DESC, id DESC)
  WHERE lead_id IS NOT NULL;
CREATE INDEX case_notes_student_case_page_idx
  ON platform.case_notes (
    organization_id,
    student_case_id,
    created_at DESC,
    id DESC
  )
  WHERE student_case_id IS NOT NULL;
CREATE INDEX case_notes_author_idx
  ON platform.case_notes (organization_id, created_by_membership_id);

-- Direct table access is closed for every API role. RLS is enabled with no
-- policy so a future stray grant still fails closed; the RPCs below are the
-- only doors.
ALTER TABLE platform.case_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.case_notes FORCE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE platform.case_notes
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

CREATE FUNCTION private.forbid_case_note_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'Case notes are append-only facts'
    USING ERRCODE = '55000';
END
$$;

REVOKE ALL ON FUNCTION private.forbid_case_note_change()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

CREATE TRIGGER case_notes_append_only
  BEFORE UPDATE OR DELETE ON platform.case_notes
  FOR EACH ROW
  EXECUTE FUNCTION private.forbid_case_note_change();

CREATE TRIGGER case_notes_append_only_truncate
  BEFORE TRUNCATE ON platform.case_notes
  FOR EACH STATEMENT
  EXECUTE FUNCTION private.forbid_case_note_change();

-- Keep the existing Admin audit journal as the one observable audit surface.
-- Compose with the current allowlist instead of copying it; 'lead' and
-- 'student_case' resource types already exist (migrations 087 and 088).
ALTER FUNCTION platform_private.p7a_safe_audit_actions()
  RENAME TO p7a_safe_audit_actions_pre_case_notes;
CREATE FUNCTION platform_private.p7a_safe_audit_actions()
RETURNS TEXT[]
LANGUAGE SQL
IMMUTABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT pg_catalog.array_agg(DISTINCT allowed.action ORDER BY allowed.action)
  FROM pg_catalog.unnest(
    platform_private.p7a_safe_audit_actions_pre_case_notes()
      || ARRAY['note.create']::TEXT[]
  ) AS allowed(action)
$$;

REVOKE ALL ON FUNCTION platform_private.p7a_safe_audit_actions_pre_case_notes()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON FUNCTION platform_private.p7a_safe_audit_actions()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

-- The Sales lead-note authority mirrors mutate_sales_lead_workflow /
-- staff_sales_lead_detail (migration 086): Admin sees every lead of the
-- organization, Sales sees owned and unowned leads, nobody else sees any.
CREATE FUNCTION private.require_lead_note_actor(
  p_organization_id UUID,
  p_lead_id UUID
)
RETURNS TABLE (
  actor_profile_id UUID,
  actor_membership_id UUID,
  actor_auth_user_id UUID,
  actor_role platform.business_role
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor RECORD;
BEGIN
  SELECT authority.*
  INTO actor
  FROM platform.current_actor_authority() AS authority
  WHERE authority.organization_id = p_organization_id
    AND authority.platform_role IN ('admin', 'sales')
    AND private.platform_has_permission(
      authority.organization_id,
      'lead.sales.workflow.manage'
    );

  IF NOT FOUND OR NOT EXISTS (
    SELECT 1
    FROM platform.leads AS lead
    WHERE lead.organization_id = p_organization_id
      AND lead.id = p_lead_id
      AND (
        actor.platform_role = 'admin'
        OR lead.current_owner_membership_id = actor.membership_id
        OR lead.current_owner_membership_id IS NULL
      )
  ) THEN
    RAISE EXCEPTION 'Lead is unavailable'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY SELECT
    actor.profile_id,
    actor.membership_id,
    actor.auth_user_id,
    actor.platform_role;
END
$$;

REVOKE ALL ON FUNCTION private.require_lead_note_actor(UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

-- Mutation authority is deliberately separate from the STABLE list helper.
-- Sales workflow commands lock the lead before writing audit rows whose
-- immediate FKs touch actor/organization rows. Keep that domain lock order
-- here too: lead first, then the live actor/profile/membership/organization;
-- evaluate ownership only after both lock sets are held.
CREATE FUNCTION private.require_lead_note_mutation_actor(
  p_organization_id UUID,
  p_lead_id UUID
)
RETURNS TABLE (
  actor_profile_id UUID,
  actor_membership_id UUID,
  actor_auth_user_id UUID,
  actor_role platform.business_role
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor RECORD;
  target_lead platform.leads%ROWTYPE;
  target_found BOOLEAN;
BEGIN
  SELECT * INTO target_lead
  FROM platform.leads AS lead
  WHERE lead.organization_id = p_organization_id
    AND lead.id = p_lead_id
  FOR UPDATE;
  target_found := FOUND;

  SELECT * INTO actor
  FROM platform_private.require_domain_actor(
    p_organization_id,
    'lead.sales.workflow.manage'
  );

  IF NOT target_found
    OR actor.actor_role NOT IN ('admin', 'sales')
    OR NOT (
      actor.actor_role = 'admin'
      OR target_lead.current_owner_membership_id = actor.actor_membership_id
      OR target_lead.current_owner_membership_id IS NULL
    )
  THEN
    RAISE EXCEPTION 'Lead is unavailable'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY SELECT
    actor.actor_profile_id,
    actor.actor_membership_id,
    actor.actor_auth_user_id,
    actor.actor_role;
END
$$;

REVOKE ALL ON FUNCTION private.require_lead_note_mutation_actor(UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

-- Lock mutations in the same order as the existing case commands: the live
-- actor/profile/membership/organization rows first, then the student case.
-- The exact-case authority decision is made only after both lock sets are held.
CREATE FUNCTION private.require_student_case_note_mutation_actor(
  p_organization_id UUID,
  p_student_case_id UUID
)
RETURNS TABLE (
  actor_profile_id UUID,
  actor_membership_id UUID,
  actor_auth_user_id UUID,
  actor_role platform.business_role
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor RECORD;
  target_case platform.student_cases%ROWTYPE;
  target_found BOOLEAN;
BEGIN
  SELECT * INTO actor
  FROM platform_private.require_domain_actor(
    p_organization_id,
    'case.read.full'
  );

  SELECT * INTO target_case
  FROM platform.student_cases AS student_case
  WHERE student_case.organization_id = p_organization_id
    AND student_case.id = p_student_case_id
  FOR UPDATE;
  target_found := FOUND;

  IF NOT target_found OR NOT (
    (
      actor.actor_role = 'admin'
      AND private.platform_has_scope(
        p_organization_id,
        'organization',
        p_organization_id
      )
    )
    OR (
      actor.actor_role = 'sales'
      AND target_case.state = 'pending'
      AND target_case.responsible_sales_membership_id =
        actor.actor_membership_id
      AND private.platform_has_scope(
        p_organization_id,
        'student_case',
        p_student_case_id
      )
    )
    OR (
      actor.actor_role = 'curator'
      AND target_case.state IN ('active', 'closed')
      AND target_case.current_curator_membership_id =
        actor.actor_membership_id
      AND private.platform_has_scope(
        p_organization_id,
        'student_case',
        p_student_case_id
      )
    )
  ) THEN
    RAISE EXCEPTION 'Student case is unavailable'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY SELECT
    actor.actor_profile_id,
    actor.actor_membership_id,
    actor.actor_auth_user_id,
    actor.actor_role;
END
$$;

REVOKE ALL ON FUNCTION private.require_student_case_note_mutation_actor(
  UUID, UUID
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

-- request_id is globally unique in the audit journal. Bind a replay to the
-- same live actor before replay_audit compares mutation payloads, otherwise a
-- colleague with access to the same subject could recover another actor's
-- result by guessing both the UUID and the original inputs.
CREATE FUNCTION private.assert_case_note_request_actor(
  p_request_id UUID,
  p_organization_id UUID,
  p_actor_profile_id UUID,
  p_actor_auth_user_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM platform.audit_events AS event
    WHERE event.request_id = p_request_id
      AND (
        event.organization_id IS DISTINCT FROM p_organization_id
        OR event.actor_kind IS DISTINCT FROM 'user'
        OR event.actor_profile_id IS DISTINCT FROM p_actor_profile_id
        OR event.actor_principal IS DISTINCT FROM
          'auth:' || p_actor_auth_user_id::TEXT
      )
  ) THEN
    RAISE EXCEPTION 'Case note request is unavailable'
      USING ERRCODE = '42501';
  END IF;
END
$$;

REVOKE ALL ON FUNCTION private.assert_case_note_request_actor(
  UUID, UUID, UUID, UUID
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

CREATE FUNCTION private.create_case_note(
  p_organization_id UUID,
  p_lead_id UUID,
  p_student_case_id UUID,
  p_body TEXT,
  p_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor RECORD;
  subject_kind TEXT;
  subject_id UUID;
  normalized_body TEXT := btrim(
    p_body,
    U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF'
  );
  created_note_id UUID := gen_random_uuid();
  note_created_at TIMESTAMPTZ;
  replayed JSONB;
  replay_shape JSONB;
  result JSONB;
  fixed_reason CONSTANT TEXT := 'Case note recorded';
BEGIN
  PERFORM platform_private.lock_p2d_request(p_request_id);

  IF p_organization_id IS NULL
    OR num_nonnulls(p_lead_id, p_student_case_id) <> 1
    OR normalized_body IS NULL
    OR normalized_body = ''
    OR char_length(normalized_body) > 4000
    -- Notes are multi-line prose: newline, carriage return and tab stay
    -- allowed while every other control character is rejected.
    OR normalized_body ~ E'[\\x01-\\x08\\x0B\\x0C\\x0E-\\x1F\\x7F]'
  THEN
    RAISE EXCEPTION 'Case note subject and body are invalid'
      USING ERRCODE = '22023';
  END IF;

  IF p_lead_id IS NOT NULL THEN
    subject_kind := 'lead';
    subject_id := p_lead_id;
    -- Match the Sales workflow order: lead before actor/organization. The
    -- helper evaluates ownership only after both lock sets are held.
    SELECT * INTO actor
    FROM private.require_lead_note_mutation_actor(
      p_organization_id,
      p_lead_id
    );
  ELSE
    subject_kind := 'student_case';
    subject_id := p_student_case_id;
    -- Case assignment and note creation now share actor -> subject lock order,
    -- while the helper keeps the exact-case operator check causal.
    SELECT * INTO actor
    FROM private.require_student_case_note_mutation_actor(
      p_organization_id,
      p_student_case_id
    );
  END IF;

  PERFORM private.assert_case_note_request_actor(
    p_request_id,
    p_organization_id,
    actor.actor_profile_id,
    actor.actor_auth_user_id
  );

  replay_shape := jsonb_build_object(
    'organization_id', p_organization_id,
    'lead_id', p_lead_id,
    'student_case_id', p_student_case_id,
    'body', normalized_body,
    'request_id', p_request_id
  );
  replayed := platform_private.replay_audit(
    p_request_id,
    'note.create',
    subject_kind,
    subject_id,
    fixed_reason,
    replay_shape
  );
  IF replayed IS NOT NULL THEN
    RETURN replayed;
  END IF;

  INSERT INTO platform.case_notes (
    id, organization_id, lead_id, student_case_id, body,
    created_by_membership_id
  ) VALUES (
    created_note_id, p_organization_id, p_lead_id, p_student_case_id,
    normalized_body, actor.actor_membership_id
  )
  RETURNING created_at INTO note_created_at;

  result := replay_shape || jsonb_build_object(
    'case_note_id', created_note_id,
    'created_by_membership_id', actor.actor_membership_id,
    'created_at', note_created_at
  );

  INSERT INTO platform.audit_events (
    organization_id, actor_kind, actor_profile_id, actor_membership_id,
    actor_principal, action, resource_type, resource_id, before_state,
    after_state, reason, request_id
  ) VALUES (
    p_organization_id, 'user', actor.actor_profile_id,
    actor.actor_membership_id, 'auth:' || actor.actor_auth_user_id::TEXT,
    'note.create', subject_kind, subject_id, NULL, result, fixed_reason,
    p_request_id
  );

  RETURN result;
END
$$;

CREATE FUNCTION private.list_case_notes(
  p_lead_id UUID,
  p_student_case_id UUID,
  p_limit INTEGER,
  p_before_created_at TIMESTAMPTZ DEFAULT NULL,
  p_before_note_id UUID DEFAULT NULL
)
RETURNS TABLE (
  organization_id UUID,
  case_note_id UUID,
  lead_id UUID,
  student_case_id UUID,
  body TEXT,
  created_by_membership_id UUID,
  author_display_name TEXT,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor RECORD;
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 101 THEN
    RAISE EXCEPTION 'Invalid case note page limit'
      USING ERRCODE = '22023';
  END IF;
  IF num_nonnulls(p_lead_id, p_student_case_id) <> 1 THEN
    RAISE EXCEPTION 'Exactly one case note subject is required'
      USING ERRCODE = '22023';
  END IF;
  IF (p_before_created_at IS NULL) <> (p_before_note_id IS NULL)
    OR (
      p_before_created_at IS NOT NULL
      AND NOT isfinite(p_before_created_at)
    )
  THEN
    RAISE EXCEPTION 'Incomplete case note cursor'
      USING ERRCODE = '22023';
  END IF;

  SELECT authority.*
  INTO actor
  FROM platform.current_actor_authority() AS authority;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active Platform permission is required'
      USING ERRCODE = '42501';
  END IF;

  IF p_lead_id IS NOT NULL THEN
    PERFORM 1
    FROM private.require_lead_note_actor(
      actor.organization_id,
      p_lead_id
    );
  ELSIF NOT private.platform_can_read_student_case(
    actor.organization_id,
    p_student_case_id
  ) THEN
    RAISE EXCEPTION 'Student case is unavailable'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    note.organization_id,
    note.id,
    note.lead_id,
    note.student_case_id,
    note.body,
    note.created_by_membership_id,
    author_profile.display_name,
    note.created_at
  FROM platform.case_notes AS note
  JOIN platform.organization_memberships AS author_membership
    ON author_membership.organization_id = note.organization_id
    AND author_membership.id = note.created_by_membership_id
  JOIN platform.profiles AS author_profile
    ON author_profile.id = author_membership.profile_id
  WHERE note.organization_id = actor.organization_id
    AND (
      (p_lead_id IS NOT NULL AND note.lead_id = p_lead_id)
      OR (
        p_student_case_id IS NOT NULL
        AND note.student_case_id = p_student_case_id
      )
    )
    AND (
      p_before_created_at IS NULL
      OR (note.created_at, note.id)
        < (p_before_created_at, p_before_note_id)
    )
  ORDER BY note.created_at DESC, note.id DESC
  LIMIT p_limit;
END
$$;

REVOKE ALL ON FUNCTION private.create_case_note(
  UUID, UUID, UUID, TEXT, UUID
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION private.create_case_note(
  UUID, UUID, UUID, TEXT, UUID
) TO authenticated;

REVOKE ALL ON FUNCTION private.list_case_notes(
  UUID, UUID, INTEGER, TIMESTAMPTZ, UUID
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION private.list_case_notes(
  UUID, UUID, INTEGER, TIMESTAMPTZ, UUID
) TO authenticated;

-- PostgREST discovers only these narrow functions in the exposed platform
-- schema. They retain invoker privilege and can only enter the privileged
-- bodies through the exact grants above; the bodies themselves are not in an
-- exposed Data API schema.
CREATE FUNCTION platform.create_case_note(
  p_organization_id UUID,
  p_lead_id UUID,
  p_student_case_id UUID,
  p_body TEXT,
  p_request_id UUID
)
RETURNS JSONB
LANGUAGE SQL
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT private.create_case_note(
    p_organization_id,
    p_lead_id,
    p_student_case_id,
    p_body,
    p_request_id
  )
$$;

CREATE FUNCTION platform.list_case_notes(
  p_lead_id UUID,
  p_student_case_id UUID,
  p_limit INTEGER,
  p_before_created_at TIMESTAMPTZ DEFAULT NULL,
  p_before_note_id UUID DEFAULT NULL
)
RETURNS TABLE (
  organization_id UUID,
  case_note_id UUID,
  lead_id UUID,
  student_case_id UUID,
  body TEXT,
  created_by_membership_id UUID,
  author_display_name TEXT,
  created_at TIMESTAMPTZ
)
LANGUAGE SQL
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT result.*
  FROM private.list_case_notes(
    p_lead_id,
    p_student_case_id,
    p_limit,
    p_before_created_at,
    p_before_note_id
  ) AS result
$$;

REVOKE ALL ON FUNCTION platform.create_case_note(
  UUID, UUID, UUID, TEXT, UUID
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.create_case_note(
  UUID, UUID, UUID, TEXT, UUID
) TO authenticated;

REVOKE ALL ON FUNCTION platform.list_case_notes(
  UUID, UUID, INTEGER, TIMESTAMPTZ, UUID
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.list_case_notes(
  UUID, UUID, INTEGER, TIMESTAMPTZ, UUID
) TO authenticated;

COMMENT ON TABLE platform.case_notes IS
  'Append-only human notes on exactly one lead or student case; corrections are newer notes, never edits.';
COMMENT ON COLUMN platform.case_notes.body IS
  'Trimmed non-empty multi-line note text, at most 4000 characters.';
COMMENT ON FUNCTION platform.create_case_note(UUID, UUID, UUID, TEXT, UUID) IS
  'SECURITY INVOKER Data API entrypoint that records one note through the non-exposed private authority body.';
COMMENT ON FUNCTION platform.list_case_notes(
  UUID, UUID, INTEGER, TIMESTAMPTZ, UUID
) IS
  'SECURITY INVOKER Data API entrypoint for keyset-paged notes through the non-exposed private authority body.';

COMMIT;
