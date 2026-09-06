-- V3-F reply snippets: canned knowledge-base texts a staff member inserts
-- into the WhatsApp composer. Audience-targeted per role, archived instead of
-- deleted, mutated only through audited optimistic RPCs.

BEGIN;

CREATE TABLE platform.reply_snippets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  audience TEXT NOT NULL CHECK (audience IN ('sales', 'admissions', 'all')),
  title TEXT NOT NULL CHECK (
    title = btrim(title)
    AND char_length(title) BETWEEN 1 AND 120
    AND title !~ '[[:cntrl:]]'
  ),
  -- Bodies are multi-line WhatsApp texts: LF stays, every other control
  -- character (including CR and TAB) is rejected.
  body TEXT NOT NULL CHECK (
    body = btrim(body)
    AND char_length(body) BETWEEN 1 AND 2000
    AND body !~ '[\x01-\x09\x0B-\x1F\x7F]'
  ),
  archived_at TIMESTAMPTZ,
  created_by_membership_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  version BIGINT NOT NULL DEFAULT 1 CHECK (version > 0),
  CONSTRAINT reply_snippets_org_id_key UNIQUE (organization_id, id),
  CONSTRAINT reply_snippets_org_fkey
    FOREIGN KEY (organization_id)
    REFERENCES platform.organizations(id)
    ON DELETE RESTRICT,
  CONSTRAINT reply_snippets_created_by_fkey
    FOREIGN KEY (organization_id, created_by_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT reply_snippets_archive_time_check
    CHECK (archived_at IS NULL OR archived_at >= created_at),
  CONSTRAINT reply_snippets_update_time_check
    CHECK (updated_at >= created_at)
);

CREATE INDEX reply_snippets_active_audience_idx
  ON platform.reply_snippets (organization_id, audience, lower(title))
  WHERE archived_at IS NULL;
CREATE INDEX reply_snippets_created_by_idx
  ON platform.reply_snippets (organization_id, created_by_membership_id);

CREATE TRIGGER reply_snippets_set_updated_at
  BEFORE UPDATE ON platform.reply_snippets
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.set_updated_at();

-- Browser principals never touch the table directly; every read and write
-- goes through the guarded RPCs below.
ALTER TABLE platform.reply_snippets ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.reply_snippets FORCE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE platform.reply_snippets
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

-- Keep the Admin audit journal as the one observable audit surface for the
-- snippet commands. Compose with the current allowlists instead of copying
-- their accumulated contents (pattern of migration 112).
ALTER FUNCTION platform_private.p7a_safe_audit_actions()
  RENAME TO p7a_safe_audit_actions_pre_reply_snippets;
CREATE FUNCTION platform_private.p7a_safe_audit_actions()
RETURNS TEXT[]
LANGUAGE SQL
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT pg_catalog.array_agg(DISTINCT allowed.action ORDER BY allowed.action)
  FROM pg_catalog.unnest(
    platform_private.p7a_safe_audit_actions_pre_reply_snippets()
      || ARRAY[
        'snippet.archive',
        'snippet.create',
        'snippet.update'
      ]::TEXT[]
  ) AS allowed(action)
$$;

REVOKE ALL ON FUNCTION
  platform_private.p7a_safe_audit_actions_pre_reply_snippets()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON FUNCTION platform_private.p7a_safe_audit_actions()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

ALTER FUNCTION platform_private.p7a_safe_audit_resource_types()
  RENAME TO p7a_safe_audit_resource_types_pre_reply_snippets;
CREATE FUNCTION platform_private.p7a_safe_audit_resource_types()
RETURNS TEXT[]
LANGUAGE SQL
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT pg_catalog.array_agg(
    DISTINCT allowed.resource_type
    ORDER BY allowed.resource_type
  )
  FROM pg_catalog.unnest(
    platform_private.p7a_safe_audit_resource_types_pre_reply_snippets()
      || ARRAY['reply_snippet']::TEXT[]
  ) AS allowed(resource_type)
$$;

REVOKE ALL ON FUNCTION
  platform_private.p7a_safe_audit_resource_types_pre_reply_snippets()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON FUNCTION platform_private.p7a_safe_audit_resource_types()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

-- One audience-visibility rule for reads and writes. The database roles map
-- to the product roles as admin=admin, sales=sales, curator=admissions.
CREATE FUNCTION platform_private.reply_snippet_audience_visible(
  p_role TEXT,
  p_audience TEXT
)
RETURNS BOOLEAN
LANGUAGE SQL
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_role = 'admin' THEN p_audience IN ('sales', 'admissions', 'all')
    WHEN p_role = 'sales' THEN p_audience IN ('sales', 'all')
    WHEN p_role = 'curator' THEN p_audience IN ('admissions', 'all')
    ELSE FALSE
  END
$$;

REVOKE ALL ON FUNCTION
  platform_private.reply_snippet_audience_visible(TEXT, TEXT)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

-- Snippet commands are open to every staff role; finance and student actors
-- fail closed. require_domain_actor also locks the actor's profile and
-- membership rows FOR UPDATE, which serializes this transaction against a
-- concurrent authority change until commit.
CREATE FUNCTION platform_private.require_reply_snippet_actor(
  p_organization_id UUID
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
BEGIN
  SELECT * INTO actor
  FROM platform_private.require_domain_actor(
    p_organization_id,
    'organization.read'
  );

  IF actor.actor_role NOT IN ('admin', 'sales', 'curator') THEN
    RAISE EXCEPTION 'Reply snippets are unavailable' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY SELECT
    actor.actor_profile_id,
    actor.actor_membership_id,
    actor.actor_auth_user_id,
    actor.actor_role;
END
$$;

REVOKE ALL ON FUNCTION platform_private.require_reply_snippet_actor(UUID)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

CREATE FUNCTION platform.list_reply_snippets(
  p_organization_id UUID,
  p_audience TEXT DEFAULT NULL
)
RETURNS TABLE (
  organization_id UUID,
  reply_snippet_id UUID,
  audience TEXT,
  title TEXT,
  body TEXT,
  version TEXT,
  created_by_membership_id UUID,
  created_by_display_name TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_audience IS NOT NULL
    AND p_audience NOT IN ('sales', 'admissions', 'all')
  THEN
    RAISE EXCEPTION 'Reply snippet audience filter is invalid'
      USING ERRCODE = '22023';
  END IF;
  -- platform_has_permission cross-checks every JWT authority claim against
  -- the live rows, so the platform_role claim used below is verified.
  IF p_organization_id IS NULL
    OR (SELECT auth.uid()) IS NULL
    OR (SELECT auth.jwt() ->> 'platform_role')
      NOT IN ('admin', 'sales', 'curator')
    OR NOT private.platform_has_permission(
      p_organization_id,
      'organization.read'
    )
  THEN
    RAISE EXCEPTION 'Reply snippets are unavailable' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    snippet.organization_id,
    snippet.id,
    snippet.audience,
    snippet.title,
    snippet.body,
    snippet.version::TEXT,
    snippet.created_by_membership_id,
    creator_profile.display_name,
    snippet.created_at,
    snippet.updated_at
  FROM platform.reply_snippets AS snippet
  JOIN platform.organization_memberships AS creator_membership
    ON creator_membership.organization_id = snippet.organization_id
    AND creator_membership.id = snippet.created_by_membership_id
  JOIN platform.profiles AS creator_profile
    ON creator_profile.id = creator_membership.profile_id
  WHERE snippet.organization_id = p_organization_id
    AND snippet.archived_at IS NULL
    AND platform_private.reply_snippet_audience_visible(
      (SELECT auth.jwt() ->> 'platform_role'),
      snippet.audience
    )
    AND (p_audience IS NULL OR snippet.audience = p_audience)
  ORDER BY lower(snippet.title), snippet.created_at, snippet.id;
END
$$;

CREATE FUNCTION platform.create_reply_snippet(
  p_organization_id UUID,
  p_audience TEXT,
  p_title TEXT,
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
  snippet_row platform.reply_snippets%ROWTYPE;
  normalized_title TEXT := btrim(p_title);
  normalized_body TEXT := btrim(p_body);
  replayed JSONB;
  replay_shape JSONB;
  result JSONB;
  fixed_reason CONSTANT TEXT := 'Reply snippet created';
BEGIN
  PERFORM platform_private.lock_p2d_request(p_request_id);

  IF p_organization_id IS NULL
    OR p_audience IS NULL
    OR p_audience NOT IN ('sales', 'admissions', 'all')
    OR normalized_title IS NULL
    OR normalized_title = ''
    OR char_length(normalized_title) > 120
    OR normalized_title ~ '[[:cntrl:]]'
    OR normalized_body IS NULL
    OR normalized_body = ''
    OR char_length(normalized_body) > 2000
    OR normalized_body ~ '[\x01-\x09\x0B-\x1F\x7F]'
  THEN
    RAISE EXCEPTION 'Reply snippet audience, title and body are invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO actor
  FROM platform_private.require_reply_snippet_actor(p_organization_id);

  -- A non-admin author only publishes into audiences they can read.
  IF NOT platform_private.reply_snippet_audience_visible(
    actor.actor_role::TEXT,
    p_audience
  ) THEN
    RAISE EXCEPTION 'Reply snippets are unavailable' USING ERRCODE = '42501';
  END IF;

  replay_shape := jsonb_build_object(
    'organization_id', p_organization_id,
    'audience', p_audience,
    'title', normalized_title,
    'body', normalized_body,
    'request_id', p_request_id
  );
  replayed := platform_private.replay_audit(
    p_request_id,
    'snippet.create',
    'reply_snippet',
    NULL,
    fixed_reason,
    replay_shape
  );
  IF replayed IS NOT NULL THEN
    RETURN replayed;
  END IF;

  INSERT INTO platform.reply_snippets (
    organization_id, audience, title, body, created_by_membership_id
  ) VALUES (
    p_organization_id, p_audience, normalized_title, normalized_body,
    actor.actor_membership_id
  )
  RETURNING * INTO snippet_row;

  result := replay_shape || jsonb_build_object(
    'reply_snippet_id', snippet_row.id,
    'version', snippet_row.version::TEXT,
    'archived_at', snippet_row.archived_at,
    'created_at', snippet_row.created_at,
    'updated_at', snippet_row.updated_at
  );

  INSERT INTO platform.audit_events (
    organization_id, actor_kind, actor_profile_id, actor_principal, action,
    resource_type, resource_id, before_state, after_state, reason, request_id
  ) VALUES (
    p_organization_id, 'user', actor.actor_profile_id,
    'auth:' || actor.actor_auth_user_id::TEXT, 'snippet.create',
    'reply_snippet', snippet_row.id, NULL, result, fixed_reason, p_request_id
  );

  RETURN result;
END
$$;

CREATE FUNCTION platform.update_reply_snippet(
  p_organization_id UUID,
  p_reply_snippet_id UUID,
  p_audience TEXT,
  p_title TEXT,
  p_body TEXT,
  p_expected_version BIGINT,
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
  snippet_row platform.reply_snippets%ROWTYPE;
  normalized_title TEXT := btrim(p_title);
  normalized_body TEXT := btrim(p_body);
  replayed JSONB;
  replay_shape JSONB;
  result JSONB;
  audit_before JSONB;
  next_version BIGINT;
  changed_at TIMESTAMPTZ;
  fixed_reason CONSTANT TEXT := 'Reply snippet updated';
BEGIN
  PERFORM platform_private.lock_p2d_request(p_request_id);

  IF p_expected_version IS NULL OR p_expected_version < 1 THEN
    RAISE EXCEPTION 'admissions_version_conflict'
      USING ERRCODE = 'PT409';
  END IF;
  IF p_organization_id IS NULL
    OR p_reply_snippet_id IS NULL
    OR p_audience IS NULL
    OR p_audience NOT IN ('sales', 'admissions', 'all')
    OR normalized_title IS NULL
    OR normalized_title = ''
    OR char_length(normalized_title) > 120
    OR normalized_title ~ '[[:cntrl:]]'
    OR normalized_body IS NULL
    OR normalized_body = ''
    OR char_length(normalized_body) > 2000
    OR normalized_body ~ '[\x01-\x09\x0B-\x1F\x7F]'
  THEN
    RAISE EXCEPTION 'Reply snippet audience, title and body are invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO actor
  FROM platform_private.require_reply_snippet_actor(p_organization_id);

  IF NOT platform_private.reply_snippet_audience_visible(
    actor.actor_role::TEXT,
    p_audience
  ) THEN
    RAISE EXCEPTION 'Reply snippets are unavailable' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO snippet_row
  FROM platform.reply_snippets AS snippet
  WHERE snippet.organization_id = p_organization_id
    AND snippet.id = p_reply_snippet_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reply snippet is unavailable' USING ERRCODE = '42501';
  END IF;

  -- The author edits their own snippet; Admin edits any snippet.
  IF actor.actor_role <> 'admin'
    AND snippet_row.created_by_membership_id
      IS DISTINCT FROM actor.actor_membership_id
  THEN
    RAISE EXCEPTION 'Reply snippet is unavailable' USING ERRCODE = '42501';
  END IF;

  replay_shape := jsonb_build_object(
    'organization_id', p_organization_id,
    'reply_snippet_id', p_reply_snippet_id,
    'audience', p_audience,
    'title', normalized_title,
    'body', normalized_body,
    'request_id', p_request_id,
    'expected_version', p_expected_version::TEXT
  );
  replayed := platform_private.replay_audit(
    p_request_id,
    'snippet.update',
    'reply_snippet',
    p_reply_snippet_id,
    fixed_reason,
    replay_shape
  );
  IF replayed IS NOT NULL THEN
    RETURN replayed;
  END IF;

  IF snippet_row.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'Reply snippet is unavailable' USING ERRCODE = '42501';
  END IF;
  IF snippet_row.version <> p_expected_version
    OR snippet_row.version = 9223372036854775807
  THEN
    RAISE EXCEPTION 'admissions_version_conflict'
      USING ERRCODE = 'PT409';
  END IF;
  IF snippet_row.audience = p_audience
    AND snippet_row.title = normalized_title
    AND snippet_row.body = normalized_body
  THEN
    RAISE EXCEPTION 'Reply snippet must change' USING ERRCODE = '22023';
  END IF;

  UPDATE platform.reply_snippets AS snippet
  SET audience = p_audience,
      title = normalized_title,
      body = normalized_body,
      version = snippet_row.version + 1
  WHERE snippet.organization_id = p_organization_id
    AND snippet.id = p_reply_snippet_id
  RETURNING snippet.version, snippet.updated_at
  INTO next_version, changed_at;

  audit_before := jsonb_build_object(
    'audience', snippet_row.audience,
    'title', snippet_row.title,
    'body', snippet_row.body,
    'archived_at', snippet_row.archived_at,
    'version', snippet_row.version::TEXT
  );
  result := replay_shape || jsonb_build_object(
    'version', next_version::TEXT,
    'archived_at', NULL,
    'created_at', snippet_row.created_at,
    'updated_at', changed_at
  );

  INSERT INTO platform.audit_events (
    organization_id, actor_kind, actor_profile_id, actor_principal, action,
    resource_type, resource_id, before_state, after_state, reason, request_id
  ) VALUES (
    p_organization_id, 'user', actor.actor_profile_id,
    'auth:' || actor.actor_auth_user_id::TEXT, 'snippet.update',
    'reply_snippet', p_reply_snippet_id, audit_before, result, fixed_reason,
    p_request_id
  );

  RETURN result;
END
$$;

CREATE FUNCTION platform.archive_reply_snippet(
  p_organization_id UUID,
  p_reply_snippet_id UUID,
  p_expected_version BIGINT,
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
  snippet_row platform.reply_snippets%ROWTYPE;
  replayed JSONB;
  replay_shape JSONB;
  result JSONB;
  audit_before JSONB;
  next_version BIGINT;
  archived_time TIMESTAMPTZ;
  changed_at TIMESTAMPTZ;
  fixed_reason CONSTANT TEXT := 'Reply snippet archived';
BEGIN
  PERFORM platform_private.lock_p2d_request(p_request_id);

  IF p_expected_version IS NULL OR p_expected_version < 1 THEN
    RAISE EXCEPTION 'admissions_version_conflict'
      USING ERRCODE = 'PT409';
  END IF;
  IF p_organization_id IS NULL OR p_reply_snippet_id IS NULL THEN
    RAISE EXCEPTION 'Reply snippet identity is invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO actor
  FROM platform_private.require_reply_snippet_actor(p_organization_id);

  SELECT * INTO snippet_row
  FROM platform.reply_snippets AS snippet
  WHERE snippet.organization_id = p_organization_id
    AND snippet.id = p_reply_snippet_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reply snippet is unavailable' USING ERRCODE = '42501';
  END IF;

  IF actor.actor_role <> 'admin'
    AND snippet_row.created_by_membership_id
      IS DISTINCT FROM actor.actor_membership_id
  THEN
    RAISE EXCEPTION 'Reply snippet is unavailable' USING ERRCODE = '42501';
  END IF;

  replay_shape := jsonb_build_object(
    'organization_id', p_organization_id,
    'reply_snippet_id', p_reply_snippet_id,
    'request_id', p_request_id,
    'expected_version', p_expected_version::TEXT
  );
  replayed := platform_private.replay_audit(
    p_request_id,
    'snippet.archive',
    'reply_snippet',
    p_reply_snippet_id,
    fixed_reason,
    replay_shape
  );
  IF replayed IS NOT NULL THEN
    RETURN replayed;
  END IF;

  IF snippet_row.archived_at IS NOT NULL
    OR snippet_row.version <> p_expected_version
    OR snippet_row.version = 9223372036854775807
  THEN
    RAISE EXCEPTION 'admissions_version_conflict'
      USING ERRCODE = 'PT409';
  END IF;

  UPDATE platform.reply_snippets AS snippet
  SET archived_at = statement_timestamp(),
      version = snippet_row.version + 1
  WHERE snippet.organization_id = p_organization_id
    AND snippet.id = p_reply_snippet_id
  RETURNING snippet.version, snippet.archived_at, snippet.updated_at
  INTO next_version, archived_time, changed_at;

  audit_before := jsonb_build_object(
    'audience', snippet_row.audience,
    'title', snippet_row.title,
    'body', snippet_row.body,
    'archived_at', snippet_row.archived_at,
    'version', snippet_row.version::TEXT
  );
  result := replay_shape || jsonb_build_object(
    'audience', snippet_row.audience,
    'title', snippet_row.title,
    'body', snippet_row.body,
    'version', next_version::TEXT,
    'archived_at', archived_time,
    'created_at', snippet_row.created_at,
    'updated_at', changed_at
  );

  INSERT INTO platform.audit_events (
    organization_id, actor_kind, actor_profile_id, actor_principal, action,
    resource_type, resource_id, before_state, after_state, reason, request_id
  ) VALUES (
    p_organization_id, 'user', actor.actor_profile_id,
    'auth:' || actor.actor_auth_user_id::TEXT, 'snippet.archive',
    'reply_snippet', p_reply_snippet_id, audit_before, result, fixed_reason,
    p_request_id
  );

  RETURN result;
END
$$;

REVOKE ALL ON FUNCTION platform.list_reply_snippets(UUID, TEXT)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.list_reply_snippets(UUID, TEXT)
  TO authenticated;

REVOKE ALL ON FUNCTION platform.create_reply_snippet(
  UUID, TEXT, TEXT, TEXT, UUID
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.create_reply_snippet(
  UUID, TEXT, TEXT, TEXT, UUID
) TO authenticated;

REVOKE ALL ON FUNCTION platform.update_reply_snippet(
  UUID, UUID, TEXT, TEXT, TEXT, BIGINT, UUID
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.update_reply_snippet(
  UUID, UUID, TEXT, TEXT, TEXT, BIGINT, UUID
) TO authenticated;

REVOKE ALL ON FUNCTION platform.archive_reply_snippet(
  UUID, UUID, BIGINT, UUID
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.archive_reply_snippet(
  UUID, UUID, BIGINT, UUID
) TO authenticated;

COMMENT ON TABLE platform.reply_snippets IS
  'Organization-local canned reply texts for the WhatsApp composer; archived instead of deleted, targeted by staff audience.';
COMMENT ON COLUMN platform.reply_snippets.audience IS
  'Machine audience key: sales, admissions or all; curator memberships read the admissions audience.';
COMMENT ON FUNCTION platform.list_reply_snippets(UUID, TEXT) IS
  'Lists active reply snippets visible to the verified actor role: sales sees sales+all, curator sees admissions+all, admin sees every audience.';
COMMENT ON FUNCTION platform.update_reply_snippet(
  UUID, UUID, TEXT, TEXT, TEXT, BIGINT, UUID
) IS
  'Optimistically rewrites one active snippet; the author or an Admin may edit, and non-admin authors stay inside their visible audiences.';

COMMIT;
