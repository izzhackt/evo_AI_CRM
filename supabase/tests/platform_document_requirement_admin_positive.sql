\set ON_ERROR_STOP on

-- Run only in the runner-owned empty PostgreSQL database after bootstrap_supabase.sql
-- and migrations 001-157 (+ the forward P2E correction for the green run).
-- This is synthetic PostgreSQL/RPC proof, not real Supabase Auth/browser acceptance.
-- On 001-157 the first create must fail: Organization action is unavailable (42501).
-- Never use provision_member or alter staff grants to make this positive path pass.
BEGIN;

DO $empty_database$
BEGIN
  IF EXISTS (SELECT 1 FROM platform.organizations) THEN
    RAISE EXCEPTION 'Document requirement proof requires an empty isolated database';
  END IF;
END
$empty_database$;

CREATE TEMP TABLE document_requirement_proof ON COMMIT DROP AS
SELECT
  gen_random_uuid() AS auth_user_id,
  gen_random_uuid() AS bootstrap_request_id,
  gen_random_uuid() AS create_request_id,
  gen_random_uuid() AS retire_request_id,
  NULL::JSONB AS bootstrap_receipt,
  NULL::JSONB AS actor_snapshot,
  NULL::JSONB AS access_snapshot,
  NULL::JSONB AS create_receipt,
  NULL::JSONB AS create_replay,
  NULL::JSONB AS retire_receipt,
  NULL::JSONB AS retire_replay,
  (SELECT COALESCE(jsonb_agg(to_jsonb(p) ORDER BY p.permission_key), '[]'::JSONB)
   FROM platform.permission_definitions p) AS permission_baseline,
  (SELECT COALESCE(jsonb_agg(to_jsonb(a) ORDER BY a.id), '[]'::JSONB)
   FROM platform.staff_role_assignments a) AS assignment_baseline;

GRANT SELECT, UPDATE ON document_requirement_proof TO service_role, authenticated;

INSERT INTO auth.users (id, email, raw_user_meta_data)
SELECT auth_user_id, 'document-requirement-admin@evo.local.test',
  '{"full_name":"Synthetic Document Requirement Admin"}'::JSONB
FROM document_requirement_proof;

SET LOCAL request.jwt.claims = '{"role":"service_role"}';
SET LOCAL ROLE service_role;
UPDATE document_requirement_proof
SET bootstrap_receipt = platform.bootstrap_organization_admin(
  'Synthetic Document Requirement Organization', auth_user_id,
  'Synthetic Document Requirement Admin',
  'Isolated positive document requirement RPC proof', bootstrap_request_id
);
RESET ROLE;

DO $bootstrap_identity$
DECLARE f RECORD; membership_row platform.organization_memberships%ROWTYPE;
BEGIN
  SELECT * INTO STRICT f FROM document_requirement_proof;
  SELECT * INTO STRICT membership_row FROM platform.organization_memberships
  WHERE id = (f.bootstrap_receipt->>'membership_id')::UUID;
  IF f.bootstrap_receipt->>'admin_auth_user_id' IS DISTINCT FROM f.auth_user_id::TEXT
    OR f.bootstrap_receipt->>'role' IS DISTINCT FROM 'admin'
    OR f.bootstrap_receipt->>'status' IS DISTINCT FROM 'active'
    OR membership_row.organization_id IS DISTINCT FROM (f.bootstrap_receipt->>'organization_id')::UUID
    OR membership_row.profile_id IS DISTINCT FROM (f.bootstrap_receipt->>'profile_id')::UUID
    OR membership_row.is_system_admin IS DISTINCT FROM TRUE
    OR membership_row.status IS DISTINCT FROM 'active'::platform.membership_status
    OR NOT EXISTS (SELECT 1 FROM platform.profiles p
      WHERE p.id = membership_row.profile_id AND p.auth_user_id = f.auth_user_id)
  THEN
    RAISE EXCEPTION 'Canonical bootstrap did not establish the exact active System Admin';
  END IF;
  PERFORM set_config('request.jwt.claims', jsonb_build_object(
    'sub', f.auth_user_id, 'role', 'authenticated', 'platform_role', 'admin',
    'platform_access_version', (f.bootstrap_receipt->>'access_version')::BIGINT,
    'platform_organization_id', membership_row.organization_id,
    'platform_membership_id', membership_row.id,
    'platform_bundle_id', membership_row.current_bundle_id,
    'platform_bundle_version', (SELECT version FROM platform.role_bundle_versions
      WHERE id = membership_row.current_bundle_id)
  )::TEXT, TRUE);
END
$bootstrap_identity$;

SET LOCAL ROLE authenticated;
UPDATE document_requirement_proof SET
  actor_snapshot = (SELECT jsonb_agg(to_jsonb(a)) FROM platform.current_actor_authority() a),
  access_snapshot = platform.staff_access_snapshot();

-- The regression seam: normal authenticated System Admin calls, never a private helper.
UPDATE document_requirement_proof SET create_receipt = platform.create_document_requirement(
  (bootstrap_receipt->>'organization_id')::UUID,
  'Synthetic country', 'Synthetic degree', 'Synthetic direction', 548,
  'p4.admin-positive', 'Synthetic positive document requirement',
  'Use only the isolated non-personal document proof.', create_request_id
);
UPDATE document_requirement_proof SET create_replay = platform.create_document_requirement(
  (bootstrap_receipt->>'organization_id')::UUID,
  'Synthetic country', 'Synthetic degree', 'Synthetic direction', 548,
  'p4.admin-positive', 'Synthetic positive document requirement',
  'Use only the isolated non-personal document proof.', create_request_id
);
UPDATE document_requirement_proof SET retire_receipt = platform.retire_document_requirement(
  (bootstrap_receipt->>'organization_id')::UUID,
  (create_receipt->>'document_requirement_id')::UUID,
  'Retire the isolated positive proof requirement', retire_request_id
);
UPDATE document_requirement_proof SET retire_replay = platform.retire_document_requirement(
  (bootstrap_receipt->>'organization_id')::UUID,
  (create_receipt->>'document_requirement_id')::UUID,
  'Retire the isolated positive proof requirement', retire_request_id
);
RESET ROLE;

DO $positive_receipts$
DECLARE
  f RECORD;
  requirement_row platform.document_requirements%ROWTYPE;
  created_event platform.audit_events%ROWTYPE;
  retired_event platform.audit_events%ROWTYPE;
  proof_organization_id UUID;
  proof_membership_id UUID;
  proof_profile_id UUID;
  proof_requirement_id UUID;
BEGIN
  SELECT * INTO STRICT f FROM document_requirement_proof;
  proof_organization_id := (f.bootstrap_receipt->>'organization_id')::UUID;
  proof_membership_id := (f.bootstrap_receipt->>'membership_id')::UUID;
  proof_profile_id := (f.bootstrap_receipt->>'profile_id')::UUID;
  proof_requirement_id := (f.create_receipt->>'document_requirement_id')::UUID;
  IF jsonb_array_length(f.actor_snapshot) IS DISTINCT FROM 1
    OR NOT (f.actor_snapshot->0 @> jsonb_build_object(
      'auth_user_id', f.auth_user_id, 'profile_id', proof_profile_id,
      'membership_id', proof_membership_id, 'organization_id', proof_organization_id,
      'platform_role', 'admin'))
    OR f.access_snapshot->>'systemRole' IS DISTINCT FROM 'admin'
    OR f.access_snapshot->>'membershipId' IS DISTINCT FROM proof_membership_id::TEXT
    OR f.access_snapshot->>'organizationId' IS DISTINCT FROM proof_organization_id::TEXT
  THEN RAISE EXCEPTION 'Public actor snapshots do not identify the bootstrapped System Admin'; END IF;

  IF f.create_receipt IS DISTINCT FROM jsonb_build_object(
    'organization_id', proof_organization_id, 'document_requirement_id', proof_requirement_id,
    'target_country', 'Synthetic country', 'target_degree', 'Synthetic degree',
    'program_direction', 'Synthetic direction', 'checklist_version', 548,
    'requirement_key', 'p4.admin-positive', 'label', 'Synthetic positive document requirement',
    'instructions', 'Use only the isolated non-personal document proof.', 'status', 'active')
    OR f.create_replay IS DISTINCT FROM f.create_receipt
    OR f.retire_receipt IS DISTINCT FROM jsonb_build_object(
      'organization_id', proof_organization_id, 'document_requirement_id', proof_requirement_id,
      'status', 'retired', 'retired_at', f.retire_receipt->'retired_at')
    OR NULLIF(f.retire_receipt->>'retired_at', '') IS NULL
    OR f.retire_replay IS DISTINCT FROM f.retire_receipt
  THEN RAISE EXCEPTION 'Create/retire or exact same-request replay receipt mismatch'; END IF;

  SELECT * INTO STRICT requirement_row FROM platform.document_requirements r
  WHERE r.id = proof_requirement_id AND r.organization_id = proof_organization_id;
  IF (SELECT count(*) FROM platform.document_requirements) <> 1
    OR requirement_row.created_by_membership_id IS DISTINCT FROM proof_membership_id
    OR requirement_row.status::TEXT IS DISTINCT FROM 'retired'
    OR requirement_row.retired_at IS DISTINCT FROM (f.retire_receipt->>'retired_at')::TIMESTAMPTZ
    OR requirement_row.requirement_key IS DISTINCT FROM 'p4.admin-positive'
  THEN RAISE EXCEPTION 'Requirement identity/status changed or replay duplicated data'; END IF;

  SELECT * INTO STRICT created_event FROM platform.audit_events e WHERE e.request_id = f.create_request_id;
  SELECT * INTO STRICT retired_event FROM platform.audit_events e WHERE e.request_id = f.retire_request_id;
  IF (SELECT count(*) FROM platform.audit_events e WHERE e.resource_type = 'document_requirement') <> 2
    OR created_event.action IS DISTINCT FROM 'document.requirement.create'
    OR retired_event.action IS DISTINCT FROM 'document.requirement.retire'
    OR created_event.organization_id IS DISTINCT FROM proof_organization_id
    OR retired_event.organization_id IS DISTINCT FROM proof_organization_id
    OR created_event.resource_id IS DISTINCT FROM proof_requirement_id
    OR retired_event.resource_id IS DISTINCT FROM proof_requirement_id
    OR created_event.actor_profile_id IS DISTINCT FROM proof_profile_id
    OR retired_event.actor_profile_id IS DISTINCT FROM proof_profile_id
    OR created_event.actor_kind::TEXT IS DISTINCT FROM 'user'
    OR retired_event.actor_kind::TEXT IS DISTINCT FROM 'user'
    OR created_event.actor_principal IS DISTINCT FROM 'auth:' || f.auth_user_id::TEXT
    OR retired_event.actor_principal IS DISTINCT FROM 'auth:' || f.auth_user_id::TEXT
    OR created_event.after_state IS DISTINCT FROM f.create_receipt
    OR retired_event.after_state IS DISTINCT FROM f.retire_receipt
    OR created_event.before_state IS NOT NULL
    OR retired_event.before_state IS DISTINCT FROM '{"status":"active","retired_at":null}'::JSONB
  THEN RAISE EXCEPTION 'Audit identity/history changed or replay appended another receipt'; END IF;

  IF f.permission_baseline IS DISTINCT FROM (SELECT COALESCE(
      jsonb_agg(to_jsonb(p) ORDER BY p.permission_key), '[]'::JSONB) FROM platform.permission_definitions p)
    OR f.assignment_baseline IS DISTINCT FROM (SELECT COALESCE(
      jsonb_agg(to_jsonb(a) ORDER BY a.id), '[]'::JSONB) FROM platform.staff_role_assignments a)
  THEN RAISE EXCEPTION 'Positive document path modified the permission catalogue or role assignments'; END IF;
END
$positive_receipts$;

ROLLBACK;
\echo 'PLATFORM_DOCUMENT_REQUIREMENT_ADMIN_POSITIVE_OK'
