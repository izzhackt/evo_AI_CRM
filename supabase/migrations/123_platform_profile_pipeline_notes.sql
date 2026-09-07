-- Profile/Pipeline note projection for the V3 D2 surface.
--
-- Migration 117 remains the append-only note authority. This migration adds
-- one bounded latest-lead-note projection to the existing Sales page RPC so
-- pipeline cards never issue a per-lead note query. The public signature is
-- unchanged; only its returned row grows by four nullable columns.

BEGIN;

DROP FUNCTION platform.staff_sales_lead_page(
  INTEGER, TIMESTAMPTZ, UUID, TEXT, TEXT, TEXT, UUID, TEXT, TEXT
);

CREATE FUNCTION private.staff_sales_lead_page_with_latest_note(
  p_limit INTEGER,
  p_cursor_updated_at TIMESTAMPTZ DEFAULT NULL,
  p_cursor_id UUID DEFAULT NULL,
  p_connection_filter TEXT DEFAULT 'all',
  p_stage_filter TEXT DEFAULT NULL,
  p_assignment_filter TEXT DEFAULT 'all',
  p_owner_membership_id UUID DEFAULT NULL,
  p_due_filter TEXT DEFAULT 'all',
  p_query TEXT DEFAULT NULL
)
RETURNS TABLE (
  sort_at TIMESTAMPTZ,
  organization_id UUID,
  lead_id UUID,
  client_id UUID,
  client_display_name TEXT,
  client_email TEXT,
  client_phone TEXT,
  current_owner_membership_id UUID,
  current_owner_display_name TEXT,
  stage_key TEXT,
  source_key TEXT,
  lifecycle_state platform.lead_lifecycle_state,
  next_action_text TEXT,
  next_action_due_date DATE,
  workflow_version BIGINT,
  is_connected BOOLEAN,
  open_duplicate_candidate_count BIGINT,
  linked_student_case_count BIGINT,
  linked_conversation_count BIGINT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  stage_entered_at TIMESTAMPTZ,
  latest_note_id UUID,
  latest_note_body TEXT,
  latest_note_author_display_name TEXT,
  latest_note_created_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    page.*,
    latest_note.id,
    latest_note.body,
    latest_note.author_display_name,
    latest_note.created_at
  FROM private.staff_sales_lead_page(
    p_limit,
    p_cursor_updated_at,
    p_cursor_id,
    p_connection_filter,
    p_stage_filter,
    p_assignment_filter,
    p_owner_membership_id,
    p_due_filter,
    p_query
  ) AS page
  LEFT JOIN LATERAL (
    SELECT
      note.id,
      note.body,
      author_profile.display_name AS author_display_name,
      note.created_at
    FROM platform.case_notes AS note
    JOIN platform.organization_memberships AS author_membership
      ON author_membership.organization_id = note.organization_id
     AND author_membership.id = note.created_by_membership_id
    JOIN platform.profiles AS author_profile
      ON author_profile.id = author_membership.profile_id
    WHERE note.organization_id = page.organization_id
      AND note.lead_id = page.lead_id
      AND note.student_case_id IS NULL
    ORDER BY note.created_at DESC, note.id DESC
    LIMIT 1
  ) AS latest_note ON TRUE
$$;

CREATE FUNCTION platform.staff_sales_lead_page(
  p_limit INTEGER,
  p_cursor_updated_at TIMESTAMPTZ DEFAULT NULL,
  p_cursor_id UUID DEFAULT NULL,
  p_connection_filter TEXT DEFAULT 'all',
  p_stage_filter TEXT DEFAULT NULL,
  p_assignment_filter TEXT DEFAULT 'all',
  p_owner_membership_id UUID DEFAULT NULL,
  p_due_filter TEXT DEFAULT 'all',
  p_query TEXT DEFAULT NULL
)
RETURNS TABLE (
  sort_at TIMESTAMPTZ,
  organization_id UUID,
  lead_id UUID,
  client_id UUID,
  client_display_name TEXT,
  client_email TEXT,
  client_phone TEXT,
  current_owner_membership_id UUID,
  current_owner_display_name TEXT,
  stage_key TEXT,
  source_key TEXT,
  lifecycle_state platform.lead_lifecycle_state,
  next_action_text TEXT,
  next_action_due_date DATE,
  workflow_version BIGINT,
  is_connected BOOLEAN,
  open_duplicate_candidate_count BIGINT,
  linked_student_case_count BIGINT,
  linked_conversation_count BIGINT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  stage_entered_at TIMESTAMPTZ,
  latest_note_id UUID,
  latest_note_body TEXT,
  latest_note_author_display_name TEXT,
  latest_note_created_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT page.*
  FROM private.staff_sales_lead_page_with_latest_note(
    p_limit,
    p_cursor_updated_at,
    p_cursor_id,
    p_connection_filter,
    p_stage_filter,
    p_assignment_filter,
    p_owner_membership_id,
    p_due_filter,
    p_query
  ) AS page
$$;

REVOKE ALL ON FUNCTION private.staff_sales_lead_page_with_latest_note(
  INTEGER, TIMESTAMPTZ, UUID, TEXT, TEXT, TEXT, UUID, TEXT, TEXT
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION private.staff_sales_lead_page_with_latest_note(
  INTEGER, TIMESTAMPTZ, UUID, TEXT, TEXT, TEXT, UUID, TEXT, TEXT
) TO authenticated;

REVOKE ALL ON FUNCTION platform.staff_sales_lead_page(
  INTEGER, TIMESTAMPTZ, UUID, TEXT, TEXT, TEXT, UUID, TEXT, TEXT
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.staff_sales_lead_page(
  INTEGER, TIMESTAMPTZ, UUID, TEXT, TEXT, TEXT, UUID, TEXT, TEXT
) TO authenticated;

COMMENT ON FUNCTION private.staff_sales_lead_page_with_latest_note(
  INTEGER, TIMESTAMPTZ, UUID, TEXT, TEXT, TEXT, UUID, TEXT, TEXT
) IS
  'Authorized bounded Sales page plus at most one exact latest append-only lead note per visible row.';
COMMENT ON FUNCTION platform.staff_sales_lead_page(
  INTEGER, TIMESTAMPTZ, UUID, TEXT, TEXT, TEXT, UUID, TEXT, TEXT
) IS
  'Bounded role-scoped Sales queue with canonical stage-entry time and one batched latest lead-note summary; no student-case note substitution.';

COMMIT;
