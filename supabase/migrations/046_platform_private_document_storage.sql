-- ============================================================
-- 046_platform_private_document_storage.sql
--
-- P2H: reservation-first private Storage bindings for Platform documents.
--
-- The fixed private bucket is provisioned through supabase/config.toml and
-- Storage API lifecycle, never by writing storage.buckets directly here.
-- Object bytes are created only by the Storage API. This migration records
-- opaque object bindings, short-lived upload reservations, audited download
-- grants, one-time service signing authorizations, and an exact
-- operation-aware upload policy.
--
-- No row in this migration proves that bytes were uploaded, scanned, backed
-- up, restored, or downloaded. Browser principals cannot select/sign Storage
-- objects. A trusted backend may produce one bounded signed URL through the
-- Storage API only after consuming an audited grant exactly once.
-- ============================================================

BEGIN;

-- Immutable v6 bundles clone every published v5 permission and add only the
-- explicit private-document upload/download actions. Exactly five roles
-- remain. Sales and Finance intentionally receive neither action.
INSERT INTO platform.permission_definitions (
  permission_key,
  description
)
VALUES
  (
    'document.upload',
    'Reserve and upload one assigned private document object'
  ),
  (
    'document.download',
    'Grant one audited backend-signed download for an authorized private document'
  );

INSERT INTO platform.role_bundle_versions (
  id,
  role,
  version,
  status,
  label
)
VALUES
  (
    '00000000-0000-4000-8000-000000000501',
    'admin',
    6,
    'draft',
    'Admin v6 private document storage'
  ),
  (
    '00000000-0000-4000-8000-000000000502',
    'sales',
    6,
    'draft',
    'Sales v6 private document storage'
  ),
  (
    '00000000-0000-4000-8000-000000000503',
    'curator',
    6,
    'draft',
    'Curator v6 private document storage'
  ),
  (
    '00000000-0000-4000-8000-000000000504',
    'finance',
    6,
    'draft',
    'Finance v6 private document storage'
  ),
  (
    '00000000-0000-4000-8000-000000000505',
    'student',
    6,
    'draft',
    'Student v6 private document storage'
  );

INSERT INTO platform.role_bundle_permissions (
  bundle_id,
  bundle_role,
  permission_key
)
SELECT
  v6.id,
  v6.role,
  v5_permission.permission_key
FROM platform.role_bundle_versions AS v6
JOIN platform.role_bundle_versions AS v5
  ON v5.role = v6.role
  AND v5.version = 5
  AND v5.status = 'published'
JOIN platform.role_bundle_permissions AS v5_permission
  ON v5_permission.bundle_id = v5.id
  AND v5_permission.bundle_role = v5.role
WHERE v6.version = 6;

INSERT INTO platform.role_bundle_permissions (
  bundle_id,
  bundle_role,
  permission_key
)
SELECT
  bundle.id,
  bundle.role,
  permission.permission_key
FROM platform.role_bundle_versions AS bundle
CROSS JOIN platform.permission_definitions AS permission
WHERE bundle.version = 6
  AND bundle.role IN ('admin', 'curator', 'student')
  AND permission.permission_key IN (
    'document.upload',
    'document.download'
  );

UPDATE platform.role_bundle_versions
SET
  status = 'published',
  published_at = statement_timestamp()
WHERE version = 6;

CREATE TEMPORARY TABLE p2h_membership_bundle_upgrades
ON COMMIT DROP
AS
SELECT
  membership.organization_id,
  membership.id AS membership_id,
  membership.profile_id,
  membership."current_role" AS business_role,
  membership.current_bundle_id AS previous_bundle_id,
  v6.id AS new_bundle_id,
  profile.access_version AS previous_access_version,
  COALESCE(
    (
      SELECT MAX(history.role_version)
      FROM platform.membership_role_history AS history
      WHERE history.organization_id = membership.organization_id
        AND history.membership_id = membership.id
    ),
    0
  ) + 1 AS next_role_version,
  gen_random_uuid() AS request_id
FROM platform.organization_memberships AS membership
JOIN platform.profiles AS profile
  ON profile.id = membership.profile_id
JOIN platform.role_bundle_versions AS v5
  ON v5.id = membership.current_bundle_id
  AND v5.role = membership."current_role"
  AND v5.version = 5
  AND v5.status = 'published'
JOIN platform.role_bundle_versions AS v6
  ON v6.role = membership."current_role"
  AND v6.version = 6
  AND v6.status = 'published'
WHERE membership."current_role" IS NOT NULL
  AND membership.current_bundle_id IS NOT NULL;

INSERT INTO platform.membership_role_history (
  organization_id,
  membership_id,
  profile_id,
  role_version,
  previous_role,
  new_role,
  previous_bundle_id,
  new_bundle_id,
  actor_kind,
  actor_profile_id,
  reason,
  request_id
)
SELECT
  upgrade.organization_id,
  upgrade.membership_id,
  upgrade.profile_id,
  upgrade.next_role_version,
  upgrade.business_role,
  upgrade.business_role,
  upgrade.previous_bundle_id,
  upgrade.new_bundle_id,
  'system',
  NULL,
  'P2H immutable RBAC bundle upgrade',
  upgrade.request_id
FROM p2h_membership_bundle_upgrades AS upgrade;

UPDATE platform.organization_memberships AS membership
SET current_bundle_id = upgrade.new_bundle_id
FROM p2h_membership_bundle_upgrades AS upgrade
WHERE membership.organization_id = upgrade.organization_id
  AND membership.id = upgrade.membership_id;

UPDATE platform.profiles AS profile
SET access_version = profile.access_version + 1
WHERE profile.id IN (
  SELECT DISTINCT upgrade.profile_id
  FROM p2h_membership_bundle_upgrades AS upgrade
);

INSERT INTO platform.audit_events (
  organization_id,
  actor_kind,
  actor_profile_id,
  actor_principal,
  action,
  resource_type,
  resource_id,
  before_state,
  after_state,
  reason,
  request_id
)
SELECT
  upgrade.organization_id,
  'system',
  NULL,
  'migration:046_platform_private_document_storage',
  'rbac.bundle.upgrade',
  'organization_membership',
  upgrade.membership_id,
  jsonb_build_object(
    'role', upgrade.business_role,
    'bundle_id', upgrade.previous_bundle_id,
    'access_version', upgrade.previous_access_version
  ),
  jsonb_build_object(
    'role', upgrade.business_role,
    'bundle_id', upgrade.new_bundle_id,
    'access_version', profile.access_version
  ),
  'P2H immutable RBAC bundle upgrade',
  upgrade.request_id
FROM p2h_membership_bundle_upgrades AS upgrade
JOIN platform.profiles AS profile
  ON profile.id = upgrade.profile_id;

-- A reservation is the only browser-upload authorization source. It is
-- immutable, expires after ten minutes, and binds an authenticated principal
-- to one opaque name and one pending Platform document version.
CREATE TABLE platform_private.document_upload_reservations (
  id UUID PRIMARY KEY,
  request_id UUID NOT NULL UNIQUE,
  organization_id UUID NOT NULL,
  student_case_id UUID NOT NULL,
  document_slot_id UUID NOT NULL,
  document_version_id UUID NOT NULL,
  uploader_profile_id UUID NOT NULL,
  uploader_membership_id UUID NOT NULL,
  uploader_auth_user_id UUID NOT NULL,
  bucket_id TEXT NOT NULL DEFAULT 'platform-documents'
    CHECK (bucket_id = 'platform-documents'),
  object_name TEXT NOT NULL CHECK (
    object_name ~ '^[0-9a-f]{2}/[0-9a-f]{62}$'
  ),
  declared_mime_type TEXT NOT NULL CHECK (
    declared_mime_type IN (
      'application/pdf',
      'image/jpeg',
      'image/png'
    )
  ),
  byte_size BIGINT NOT NULL CHECK (
    byte_size BETWEEN 1 AND 26214400
  ),
  sha256_hex TEXT NOT NULL CHECK (
    sha256_hex ~ '^[0-9a-f]{64}$'
  ),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT document_upload_reservations_object_key
    UNIQUE (bucket_id, object_name),
  CONSTRAINT document_upload_reservations_identity_key
    UNIQUE (
      organization_id,
      id,
      document_version_id,
      bucket_id,
      object_name
    ),
  CONSTRAINT document_upload_reservations_version_fkey
    FOREIGN KEY (
      organization_id,
      document_version_id,
      student_case_id,
      document_slot_id
    )
    REFERENCES platform.document_versions(
      organization_id,
      id,
      student_case_id,
      document_slot_id
    )
    ON DELETE RESTRICT,
  CONSTRAINT document_upload_reservations_profile_fkey
    FOREIGN KEY (uploader_profile_id)
    REFERENCES platform.profiles(id)
    ON DELETE RESTRICT,
  CONSTRAINT document_upload_reservations_membership_fkey
    FOREIGN KEY (organization_id, uploader_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT document_upload_reservations_expiry_check CHECK (
    expires_at > created_at
    AND expires_at <= created_at + INTERVAL '10 minutes'
  )
);

-- A binding is created before bytes arrive. It is an immutable target
-- identity, not proof that the Storage object exists.
CREATE TABLE platform_private.document_storage_bindings (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL,
  student_case_id UUID NOT NULL,
  document_slot_id UUID NOT NULL,
  document_version_id UUID NOT NULL,
  upload_reservation_id UUID NOT NULL,
  bucket_id TEXT NOT NULL CHECK (bucket_id = 'platform-documents'),
  object_name TEXT NOT NULL CHECK (
    object_name ~ '^[0-9a-f]{2}/[0-9a-f]{62}$'
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT document_storage_bindings_version_key
    UNIQUE (organization_id, document_version_id),
  CONSTRAINT document_storage_bindings_reservation_key
    UNIQUE (upload_reservation_id),
  CONSTRAINT document_storage_bindings_object_key
    UNIQUE (bucket_id, object_name),
  CONSTRAINT document_storage_bindings_version_fkey
    FOREIGN KEY (
      organization_id,
      document_version_id,
      student_case_id,
      document_slot_id
    )
    REFERENCES platform.document_versions(
      organization_id,
      id,
      student_case_id,
      document_slot_id
    )
    ON DELETE RESTRICT,
  CONSTRAINT document_storage_bindings_reservation_fkey
    FOREIGN KEY (
      organization_id,
      upload_reservation_id,
      document_version_id,
      bucket_id,
      object_name
    )
    REFERENCES platform_private.document_upload_reservations(
      organization_id,
      id,
      document_version_id,
      bucket_id,
      object_name
    )
    ON DELETE RESTRICT
);

-- Finalization is the immutable publication receipt for one exact uploaded
-- object. Reservation creates pending metadata only; this service-side receipt
-- proves that the exact Storage object existed inside the upload window before
-- the version became the slot's current submitted version.
CREATE TABLE platform_private.document_upload_finalizations (
  id UUID PRIMARY KEY,
  request_id UUID NOT NULL UNIQUE,
  organization_id UUID NOT NULL,
  upload_reservation_id UUID NOT NULL UNIQUE,
  student_case_id UUID NOT NULL,
  document_version_id UUID NOT NULL UNIQUE,
  document_slot_id UUID NOT NULL,
  finalization_audit_event_id UUID NOT NULL UNIQUE,
  bucket_id TEXT NOT NULL CHECK (bucket_id = 'platform-documents'),
  object_name TEXT NOT NULL CHECK (
    object_name ~ '^[0-9a-f]{2}/[0-9a-f]{62}$'
  ),
  published_version_no BIGINT NOT NULL CHECK (published_version_no > 0),
  object_created_at TIMESTAMPTZ NOT NULL,
  finalized_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT document_upload_finalizations_reservation_fkey
    FOREIGN KEY (
      organization_id,
      upload_reservation_id,
      document_version_id,
      bucket_id,
      object_name
    )
    REFERENCES platform_private.document_upload_reservations(
      organization_id,
      id,
      document_version_id,
      bucket_id,
      object_name
    )
    ON DELETE RESTRICT,
  CONSTRAINT document_upload_finalizations_version_fkey
    FOREIGN KEY (
      organization_id,
      document_version_id,
      student_case_id,
      document_slot_id,
      published_version_no
    )
    REFERENCES platform.document_versions(
      organization_id,
      id,
      student_case_id,
      document_slot_id,
      version_no
    )
    ON DELETE RESTRICT,
  CONSTRAINT document_upload_finalizations_audit_fkey
    FOREIGN KEY (finalization_audit_event_id)
    REFERENCES platform.audit_events(id)
    ON DELETE RESTRICT
);

-- A download grant is append-only, actor-bound and short-lived. Its
-- document_access_event_id proves that browser authorization was audited
-- before a trusted backend may consume it exactly once.
CREATE TABLE platform_private.document_download_grants (
  id UUID PRIMARY KEY,
  request_id UUID NOT NULL UNIQUE,
  organization_id UUID NOT NULL,
  student_case_id UUID NOT NULL,
  document_slot_id UUID NOT NULL,
  document_version_id UUID NOT NULL,
  storage_binding_id UUID NOT NULL,
  document_access_event_id UUID NOT NULL UNIQUE,
  grantee_profile_id UUID NOT NULL,
  grantee_membership_id UUID NOT NULL,
  grantee_auth_user_id UUID NOT NULL,
  grantee_role platform.business_role NOT NULL CHECK (
    grantee_role IN ('admin', 'curator', 'student')
  ),
  grantee_access_version BIGINT NOT NULL CHECK (
    grantee_access_version > 0
  ),
  access_purpose TEXT NOT NULL CHECK (
    btrim(access_purpose) <> ''
    AND char_length(btrim(access_purpose)) <= 255
    AND octet_length(btrim(access_purpose)) <= 1024
  ),
  expires_in_seconds INTEGER NOT NULL CHECK (
    expires_in_seconds BETWEEN 1 AND 60
  ),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT document_download_grants_binding_fkey
    FOREIGN KEY (storage_binding_id)
    REFERENCES platform_private.document_storage_bindings(id)
    ON DELETE RESTRICT,
  CONSTRAINT document_download_grants_version_fkey
    FOREIGN KEY (
      organization_id,
      document_version_id,
      student_case_id,
      document_slot_id
    )
    REFERENCES platform.document_versions(
      organization_id,
      id,
      student_case_id,
      document_slot_id
    )
    ON DELETE RESTRICT,
  CONSTRAINT document_download_grants_access_event_fkey
    FOREIGN KEY (document_access_event_id)
    REFERENCES platform.document_access_events(id)
    ON DELETE RESTRICT,
  CONSTRAINT document_download_grants_profile_fkey
    FOREIGN KEY (grantee_profile_id)
    REFERENCES platform.profiles(id)
    ON DELETE RESTRICT,
  CONSTRAINT document_download_grants_membership_fkey
    FOREIGN KEY (organization_id, grantee_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT document_download_grants_expiry_check CHECK (
    expires_at > created_at
    AND expires_at <=
      created_at + make_interval(secs => expires_in_seconds)
  )
);

-- A consumption is an immutable, one-time authorization for the trusted
-- backend to call Storage createSignedUrl with exactly the returned TTL.
-- It deliberately stores neither the signed URL nor its bearer token.
CREATE TABLE platform_private.document_download_consumptions (
  id UUID PRIMARY KEY,
  request_id UUID NOT NULL UNIQUE,
  organization_id UUID NOT NULL,
  document_download_grant_id UUID NOT NULL UNIQUE,
  document_access_event_id UUID NOT NULL UNIQUE,
  signing_audit_event_id UUID NOT NULL UNIQUE,
  storage_binding_id UUID NOT NULL,
  bucket_id TEXT NOT NULL CHECK (bucket_id = 'platform-documents'),
  object_name TEXT NOT NULL CHECK (
    object_name ~ '^[0-9a-f]{2}/[0-9a-f]{62}$'
  ),
  max_signed_url_expires_in_seconds INTEGER NOT NULL CHECK (
    max_signed_url_expires_in_seconds BETWEEN 1 AND 60
  ),
  grant_expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT document_download_consumptions_grant_fkey
    FOREIGN KEY (document_download_grant_id)
    REFERENCES platform_private.document_download_grants(id)
    ON DELETE RESTRICT,
  CONSTRAINT document_download_consumptions_access_event_fkey
    FOREIGN KEY (document_access_event_id)
    REFERENCES platform.document_access_events(id)
    ON DELETE RESTRICT,
  CONSTRAINT document_download_consumptions_audit_event_fkey
    FOREIGN KEY (signing_audit_event_id)
    REFERENCES platform.audit_events(id)
    ON DELETE RESTRICT,
  CONSTRAINT document_download_consumptions_binding_fkey
    FOREIGN KEY (storage_binding_id)
    REFERENCES platform_private.document_storage_bindings(id)
    ON DELETE RESTRICT,
  CONSTRAINT document_download_consumptions_grant_window_check CHECK (
    grant_expires_at > consumed_at
    AND grant_expires_at <= consumed_at + INTERVAL '60 seconds'
  )
);

-- Add the product bounds without taking an ACCESS EXCLUSIVE validation scan.
-- NOT VALID protects new rows immediately; the explicit validation below also
-- makes the migration fail closed if historical P2E evidence violates them.
ALTER TABLE platform.document_versions
  ADD CONSTRAINT document_versions_original_filename_size_check
  CHECK (
    char_length(btrim(original_filename)) BETWEEN 1 AND 255
    AND octet_length(btrim(original_filename)) <= 1024
  ) NOT VALID;

ALTER TABLE platform.document_access_events
  ADD CONSTRAINT document_access_events_purpose_size_check
  CHECK (
    char_length(btrim(access_purpose)) BETWEEN 1 AND 255
    AND octet_length(btrim(access_purpose)) <= 1024
  ) NOT VALID;

ALTER TABLE platform.document_versions
  VALIDATE CONSTRAINT document_versions_original_filename_size_check;
ALTER TABLE platform.document_access_events
  VALIDATE CONSTRAINT document_access_events_purpose_size_check;

CREATE INDEX document_upload_reservations_live_actor_idx
  ON platform_private.document_upload_reservations (
    bucket_id,
    object_name,
    uploader_auth_user_id,
    expires_at
  );
CREATE INDEX document_upload_reservations_actor_rate_idx
  ON platform_private.document_upload_reservations (
    organization_id,
    uploader_auth_user_id,
    created_at DESC
  );
CREATE INDEX document_upload_reservations_slot_live_idx
  ON platform_private.document_upload_reservations (
    organization_id,
    document_slot_id,
    expires_at DESC
  );
CREATE INDEX document_upload_reservations_slot_rate_idx
  ON platform_private.document_upload_reservations (
    organization_id,
    document_slot_id,
    created_at DESC
  );
CREATE INDEX document_download_grants_live_actor_idx
  ON platform_private.document_download_grants (
    organization_id,
    grantee_auth_user_id,
    expires_at,
    storage_binding_id
  );
CREATE INDEX document_download_grants_actor_rate_idx
  ON platform_private.document_download_grants (
    organization_id,
    grantee_auth_user_id,
    created_at DESC
  );
CREATE INDEX document_download_grants_actor_version_live_idx
  ON platform_private.document_download_grants (
    organization_id,
    grantee_auth_user_id,
    document_version_id,
    expires_at DESC
  );
CREATE INDEX document_storage_bindings_case_idx
  ON platform_private.document_storage_bindings (
    organization_id,
    student_case_id,
    document_version_id
  );
CREATE INDEX document_upload_finalizations_slot_idx
  ON platform_private.document_upload_finalizations (
    organization_id,
    document_slot_id,
    published_version_no DESC
  );
CREATE INDEX document_download_consumptions_object_idx
  ON platform_private.document_download_consumptions (
    bucket_id,
    object_name,
    consumed_at
  );

ALTER TABLE platform_private.document_upload_reservations
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.document_upload_reservations
  FORCE ROW LEVEL SECURITY;
ALTER TABLE platform_private.document_storage_bindings
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.document_storage_bindings
  FORCE ROW LEVEL SECURITY;
ALTER TABLE platform_private.document_upload_finalizations
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.document_upload_finalizations
  FORCE ROW LEVEL SECURITY;
ALTER TABLE platform_private.document_download_grants
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.document_download_grants
  FORCE ROW LEVEL SECURITY;
ALTER TABLE platform_private.document_download_consumptions
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.document_download_consumptions
  FORCE ROW LEVEL SECURITY;

CREATE TRIGGER document_upload_reservations_append_only_rows
  BEFORE UPDATE OR DELETE
  ON platform_private.document_upload_reservations
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER document_upload_reservations_no_truncate
  BEFORE TRUNCATE
  ON platform_private.document_upload_reservations
  FOR EACH STATEMENT
  EXECUTE FUNCTION platform_private.block_append_only_mutation();

CREATE TRIGGER document_storage_bindings_append_only_rows
  BEFORE UPDATE OR DELETE
  ON platform_private.document_storage_bindings
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER document_storage_bindings_no_truncate
  BEFORE TRUNCATE
  ON platform_private.document_storage_bindings
  FOR EACH STATEMENT
  EXECUTE FUNCTION platform_private.block_append_only_mutation();

CREATE TRIGGER document_upload_finalizations_append_only_rows
  BEFORE UPDATE OR DELETE
  ON platform_private.document_upload_finalizations
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER document_upload_finalizations_no_truncate
  BEFORE TRUNCATE
  ON platform_private.document_upload_finalizations
  FOR EACH STATEMENT
  EXECUTE FUNCTION platform_private.block_append_only_mutation();

CREATE TRIGGER document_download_grants_append_only_rows
  BEFORE UPDATE OR DELETE
  ON platform_private.document_download_grants
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER document_download_grants_no_truncate
  BEFORE TRUNCATE
  ON platform_private.document_download_grants
  FOR EACH STATEMENT
  EXECUTE FUNCTION platform_private.block_append_only_mutation();

CREATE TRIGGER document_download_consumptions_append_only_rows
  BEFORE UPDATE OR DELETE
  ON platform_private.document_download_consumptions
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER document_download_consumptions_no_truncate
  BEFORE TRUNCATE
  ON platform_private.document_download_consumptions
  FOR EACH STATEMENT
  EXECUTE FUNCTION platform_private.block_append_only_mutation();

REVOKE ALL PRIVILEGES
  ON platform_private.document_upload_reservations
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL PRIVILEGES
  ON platform_private.document_storage_bindings
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL PRIVILEGES
  ON platform_private.document_upload_finalizations
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL PRIVILEGES
  ON platform_private.document_download_grants
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL PRIVILEGES
  ON platform_private.document_download_consumptions
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

CREATE OR REPLACE FUNCTION platform_private.lock_p2h_request(
  p_request_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION
      'request_id is required'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      'evo:p2h:request:' || p_request_id::TEXT,
      0
    )
  );
END
$$;

REVOKE ALL ON FUNCTION platform_private.lock_p2h_request(UUID)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

-- Resolve one current browser actor and enforce the exact case ownership rules
-- for both upload reservations and download grants.
CREATE OR REPLACE FUNCTION platform_private.require_document_storage_actor(
  p_organization_id UUID,
  p_student_case_id UUID,
  p_permission_key TEXT
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
BEGIN
  IF p_organization_id IS NULL
    OR p_student_case_id IS NULL
    OR p_permission_key NOT IN (
      'document.upload',
      'document.download'
    )
  THEN
    RAISE EXCEPTION
      'Document is unavailable'
      USING ERRCODE = '42501';
  END IF;

  -- Resolve the current JWT actor before reading any case-scoped state. All
  -- missing and unauthorized resource variants intentionally converge on the
  -- same caller-visible denial.
  SELECT *
  INTO actor
  FROM platform_private.require_domain_actor(
    p_organization_id,
    p_permission_key
  );

  SELECT *
  INTO target_case
  FROM platform.student_cases AS student_case
  WHERE student_case.organization_id = p_organization_id
    AND student_case.id = p_student_case_id
  FOR UPDATE;

  IF NOT FOUND OR NOT (
    (
      actor.actor_role = 'admin'
      AND platform_private.membership_has_active_scope(
        p_organization_id,
        actor.actor_membership_id,
        'organization',
        p_organization_id
      )
    )
    OR (
      actor.actor_role = 'curator'
      AND target_case.state IN ('active', 'closed')
      AND target_case.current_curator_membership_id IS NOT DISTINCT FROM
        actor.actor_membership_id
      AND platform_private.membership_has_active_scope(
        p_organization_id,
        actor.actor_membership_id,
        'student_case',
        target_case.id
      )
    )
    OR (
      actor.actor_role = 'student'
      AND target_case.state IN ('active', 'closed')
      AND target_case.student_membership_id IS NOT DISTINCT FROM
        actor.actor_membership_id
      AND target_case.portal_activated_at IS NOT NULL
      AND platform_private.membership_has_active_scope(
        p_organization_id,
        actor.actor_membership_id,
        'student_case',
        target_case.id
      )
    )
  ) THEN
    RAISE EXCEPTION
      'Document is unavailable'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY SELECT
    actor.actor_profile_id,
    actor.actor_membership_id,
    actor.actor_auth_user_id,
    actor.actor_role;
END
$$;

REVOKE ALL ON FUNCTION
  platform_private.require_document_storage_actor(UUID, UUID, TEXT)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

CREATE OR REPLACE FUNCTION platform.reserve_document_upload(
  p_organization_id UUID,
  p_document_slot_id UUID,
  p_original_filename TEXT,
  p_declared_mime_type TEXT,
  p_byte_size BIGINT,
  p_sha256_hex TEXT,
  p_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  slot_row platform.document_slots%ROWTYPE;
  case_row platform.student_cases%ROWTYPE;
  actor RECORD;
  existing_reservation
    platform_private.document_upload_reservations%ROWTYPE;
  existing_version platform.document_versions%ROWTYPE;
  reservation_id UUID := gen_random_uuid();
  binding_id UUID := gen_random_uuid();
  version_id UUID := gen_random_uuid();
  object_token TEXT :=
    replace(gen_random_uuid()::TEXT, '-', '')
    || replace(gen_random_uuid()::TEXT, '-', '');
  object_name TEXT;
  next_version_no BIGINT;
  reservation_created_at TIMESTAMPTZ := statement_timestamp();
  reservation_expires_at TIMESTAMPTZ;
  normalized_mime TEXT;
  normalized_sha256 TEXT;
  recent_actor_reservation_count BIGINT;
  recent_slot_reservation_count BIGINT;
  result JSONB;
  actor_hourly_limit CONSTANT INTEGER := 60;
  slot_hourly_limit CONSTANT INTEGER := 12;
  fixed_reason CONSTANT TEXT :=
    'Private document upload reserved before Storage object creation';
BEGIN
  PERFORM platform_private.lock_p2h_request(p_request_id);

  normalized_mime := lower(btrim(p_declared_mime_type));
  normalized_sha256 := lower(btrim(p_sha256_hex));

  IF p_organization_id IS NULL
    OR p_document_slot_id IS NULL
    OR p_original_filename IS NULL
    OR btrim(p_original_filename) = ''
    OR char_length(btrim(p_original_filename)) > 255
    OR octet_length(btrim(p_original_filename)) > 1024
    OR normalized_mime NOT IN (
      'application/pdf',
      'image/jpeg',
      'image/png'
    )
    OR p_byte_size IS NULL
    OR p_byte_size NOT BETWEEN 1 AND 26214400
    OR normalized_sha256 !~ '^[0-9a-f]{64}$'
  THEN
    RAISE EXCEPTION
      'Valid private document upload metadata is required'
      USING ERRCODE = '22023';
  END IF;

  -- Establish the current JWT principal before probing the caller-selected
  -- slot. The subsequent join returns a row only when that same principal has
  -- current object scope; missing and unauthorized slots share one denial.
  SELECT *
  INTO actor
  FROM platform_private.require_domain_actor(
    p_organization_id,
    'document.upload'
  );

  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      'evo:p2h:upload-actor:'
      || p_organization_id::TEXT
      || ':'
      || actor.actor_auth_user_id::TEXT,
      0
    )
  );

  -- Match review/finalization lock order explicitly: case first, then slot.
  -- The authorization query still returns no row for both missing and
  -- unauthorized caller-selected slots.
  SELECT student_case.*
  INTO case_row
  FROM platform.student_cases AS student_case
  JOIN platform.document_slots AS slot
    ON slot.organization_id = student_case.organization_id
    AND slot.student_case_id = student_case.id
  WHERE student_case.organization_id = p_organization_id
    AND slot.id = p_document_slot_id
    AND (
      (
        actor.actor_role = 'admin'
        AND platform_private.membership_has_active_scope(
          p_organization_id,
          actor.actor_membership_id,
          'organization',
          p_organization_id
        )
      )
      OR (
        actor.actor_role = 'curator'
        AND student_case.state IN ('active', 'closed')
        AND student_case.current_curator_membership_id IS NOT DISTINCT FROM
          actor.actor_membership_id
        AND platform_private.membership_has_active_scope(
          p_organization_id,
          actor.actor_membership_id,
          'student_case',
          student_case.id
        )
      )
      OR (
        actor.actor_role = 'student'
        AND student_case.state IN ('active', 'closed')
        AND student_case.student_membership_id IS NOT DISTINCT FROM
          actor.actor_membership_id
        AND student_case.portal_activated_at IS NOT NULL
        AND platform_private.membership_has_active_scope(
          p_organization_id,
          actor.actor_membership_id,
          'student_case',
          student_case.id
        )
      )
    )
  FOR UPDATE OF student_case;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Document is unavailable'
      USING ERRCODE = '42501';
  END IF;

  SELECT slot.*
  INTO slot_row
  FROM platform.document_slots AS slot
  WHERE slot.organization_id = p_organization_id
    AND slot.id = p_document_slot_id
    AND slot.student_case_id = case_row.id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Document is unavailable'
      USING ERRCODE = '42501';
  END IF;

  SELECT *
  INTO existing_reservation
  FROM platform_private.document_upload_reservations AS reservation
  WHERE reservation.request_id = p_request_id;

  IF FOUND THEN
    SELECT *
    INTO STRICT existing_version
    FROM platform.document_versions AS version
    WHERE version.organization_id =
        existing_reservation.organization_id
      AND version.id = existing_reservation.document_version_id;

    IF existing_reservation.organization_id IS DISTINCT FROM
        p_organization_id
      OR existing_reservation.document_slot_id IS DISTINCT FROM
        p_document_slot_id
      OR existing_reservation.uploader_profile_id IS DISTINCT FROM
        actor.actor_profile_id
      OR existing_reservation.uploader_membership_id IS DISTINCT FROM
        actor.actor_membership_id
      OR existing_reservation.uploader_auth_user_id IS DISTINCT FROM
        actor.actor_auth_user_id
      OR existing_version.original_filename IS DISTINCT FROM
        btrim(p_original_filename)
      OR existing_reservation.declared_mime_type IS DISTINCT FROM
        normalized_mime
      OR existing_reservation.byte_size IS DISTINCT FROM p_byte_size
      OR existing_reservation.sha256_hex IS DISTINCT FROM
        normalized_sha256
    THEN
      RAISE EXCEPTION
        'request_id was already used with different upload inputs'
        USING ERRCODE = '23505';
    END IF;

    RETURN jsonb_build_object(
      'organization_id', existing_reservation.organization_id,
      'student_case_id', existing_reservation.student_case_id,
      'document_slot_id', existing_reservation.document_slot_id,
      'document_version_id', existing_reservation.document_version_id,
      'upload_reservation_id', existing_reservation.id,
      'bucket_id', existing_reservation.bucket_id,
      'object_name', existing_reservation.object_name,
      'expires_at', existing_reservation.expires_at,
      'declared_mime_type', existing_reservation.declared_mime_type,
      'byte_size', existing_reservation.byte_size,
      'sha256_hex', existing_reservation.sha256_hex,
      'storage_object_present', EXISTS (
        SELECT 1
        FROM storage.objects AS object
        WHERE object.bucket_id = existing_reservation.bucket_id
          AND object.name = existing_reservation.object_name
      ),
      'document_slot_published', EXISTS (
        SELECT 1
        FROM platform_private.document_upload_finalizations AS finalization
        WHERE finalization.upload_reservation_id = existing_reservation.id
      )
    );
  END IF;

  IF slot_row.status = 'approved' THEN
    RAISE EXCEPTION
      'Document is unavailable'
      USING ERRCODE = '42501';
  END IF;

  -- The slot row lock serializes every actor competing for the same slot.
  -- Preserve an issued capability until it is finalized or expires instead of
  -- allowing a later reservation to overtake uploaded but unpublished bytes.
  IF EXISTS (
    SELECT 1
    FROM platform_private.document_upload_reservations AS reservation
    WHERE reservation.organization_id = p_organization_id
      AND reservation.document_slot_id = p_document_slot_id
      AND reservation.expires_at > reservation_created_at
      AND NOT EXISTS (
        SELECT 1
        FROM platform_private.document_upload_finalizations AS finalization
        WHERE finalization.upload_reservation_id = reservation.id
      )
  ) THEN
    RAISE EXCEPTION
      'A document upload is already in progress'
      USING ERRCODE = 'PT409';
  END IF;

  SELECT count(*)
  INTO recent_actor_reservation_count
  FROM platform_private.document_upload_reservations AS reservation
  WHERE reservation.organization_id = p_organization_id
    AND reservation.uploader_auth_user_id = actor.actor_auth_user_id
    AND reservation.created_at >
      reservation_created_at - INTERVAL '1 hour';

  SELECT count(*)
  INTO recent_slot_reservation_count
  FROM platform_private.document_upload_reservations AS reservation
  WHERE reservation.organization_id = p_organization_id
    AND reservation.document_slot_id = p_document_slot_id
    AND reservation.created_at >
      reservation_created_at - INTERVAL '1 hour';

  IF recent_actor_reservation_count >= actor_hourly_limit
    OR recent_slot_reservation_count >= slot_hourly_limit
  THEN
    RAISE EXCEPTION
      'Document upload request limit reached'
      USING ERRCODE = 'PT429';
  END IF;

  object_name :=
    substring(object_token FROM 1 FOR 2)
    || '/'
    || substring(object_token FROM 3);
  -- Pending or abandoned reservations must still consume a version number.
  -- The slot lock serializes this MAX lookup without publishing the pending
  -- version as the current usable document.
  SELECT COALESCE(MAX(version.version_no), 0) + 1
  INTO next_version_no
  FROM platform.document_versions AS version
  WHERE version.organization_id = p_organization_id
    AND version.document_slot_id = p_document_slot_id;
  reservation_expires_at :=
    reservation_created_at + INTERVAL '10 minutes';

  INSERT INTO platform.document_versions (
    id,
    organization_id,
    student_case_id,
    document_slot_id,
    version_no,
    original_filename,
    declared_mime_type,
    byte_size,
    sha256_hex,
    ingest_evidence_ref,
    submitted_by_membership_id,
    integrity_status,
    malware_status
  )
  VALUES (
    version_id,
    p_organization_id,
    slot_row.student_case_id,
    p_document_slot_id,
    next_version_no,
    btrim(p_original_filename),
    normalized_mime,
    p_byte_size,
    normalized_sha256,
    'storage-reservation:' || reservation_id::TEXT,
    actor.actor_membership_id,
    'pending',
    'pending'
  );

  INSERT INTO platform_private.document_upload_reservations (
    id,
    request_id,
    organization_id,
    student_case_id,
    document_slot_id,
    document_version_id,
    uploader_profile_id,
    uploader_membership_id,
    uploader_auth_user_id,
    bucket_id,
    object_name,
    declared_mime_type,
    byte_size,
    sha256_hex,
    expires_at,
    created_at
  )
  VALUES (
    reservation_id,
    p_request_id,
    p_organization_id,
    slot_row.student_case_id,
    p_document_slot_id,
    version_id,
    actor.actor_profile_id,
    actor.actor_membership_id,
    actor.actor_auth_user_id,
    'platform-documents',
    object_name,
    normalized_mime,
    p_byte_size,
    normalized_sha256,
    reservation_expires_at,
    reservation_created_at
  );

  INSERT INTO platform_private.document_storage_bindings (
    id,
    organization_id,
    student_case_id,
    document_slot_id,
    document_version_id,
    upload_reservation_id,
    bucket_id,
    object_name,
    created_at
  )
  VALUES (
    binding_id,
    p_organization_id,
    slot_row.student_case_id,
    p_document_slot_id,
    version_id,
    reservation_id,
    'platform-documents',
    object_name,
    reservation_created_at
  );

  result := jsonb_build_object(
    'organization_id', p_organization_id,
    'student_case_id', slot_row.student_case_id,
    'document_slot_id', p_document_slot_id,
    'document_version_id', version_id,
    'upload_reservation_id', reservation_id,
    'bucket_id', 'platform-documents',
    'object_name', object_name,
    'expires_at', reservation_expires_at,
    'declared_mime_type', normalized_mime,
    'byte_size', p_byte_size,
    'sha256_hex', normalized_sha256,
    'storage_object_present', FALSE,
    'document_slot_published', FALSE
  );

  INSERT INTO platform.audit_events (
    organization_id,
    actor_kind,
    actor_profile_id,
    actor_principal,
    action,
    resource_type,
    resource_id,
    before_state,
    after_state,
    reason,
    request_id
  )
  VALUES (
    p_organization_id,
    'user',
    actor.actor_profile_id,
    'auth:' || actor.actor_auth_user_id::TEXT,
    'document.upload.reserve',
    'document_version',
    version_id,
    NULL,
    result,
    fixed_reason,
    p_request_id
  );

  RETURN result;
END
$$;

-- Only a trusted backend can publish a reserved version. The Storage object
-- may be finalized after the ten-minute wall-clock deadline when its
-- provider-owned created_at proves that the browser completed the exact upload
-- before expiry. This avoids stranding a valid near-deadline upload while
-- still rejecting late, missing or mismatched objects.
CREATE OR REPLACE FUNCTION platform.finalize_document_upload(
  p_organization_id UUID,
  p_upload_reservation_id UUID,
  p_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  existing_finalization
    platform_private.document_upload_finalizations%ROWTYPE;
  reservation platform_private.document_upload_reservations%ROWTYPE;
  binding platform_private.document_storage_bindings%ROWTYPE;
  case_row platform.student_cases%ROWTYPE;
  version_row platform.document_versions%ROWTYPE;
  slot_row platform.document_slots%ROWTYPE;
  object_row RECORD;
  finalization_id UUID := gen_random_uuid();
  finalization_audit_event_id UUID := gen_random_uuid();
  finalized_at TIMESTAMPTZ := statement_timestamp();
  result JSONB;
  fixed_reason CONSTANT TEXT :=
    'Trusted backend published an exact object-backed document upload';
BEGIN
  IF (SELECT auth.jwt() ->> 'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION
      'service_role is required to finalize a document upload'
      USING ERRCODE = '42501';
  END IF;

  IF p_organization_id IS NULL
    OR p_upload_reservation_id IS NULL
    OR p_request_id IS NULL
  THEN
    RAISE EXCEPTION
      'organization, upload reservation and request id are required'
      USING ERRCODE = '22023';
  END IF;

  PERFORM platform_private.lock_p2h_request(p_request_id);

  -- Read the immutable reservation identity first, then acquire mutable domain
  -- locks in the established case -> slot -> version order used by document
  -- review. The reservation itself is locked only after those mutable rows.
  SELECT *
  INTO reservation
  FROM platform_private.document_upload_reservations AS candidate
  WHERE candidate.organization_id = p_organization_id
    AND candidate.id = p_upload_reservation_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Document upload reservation is unavailable'
      USING ERRCODE = '42501';
  END IF;

  SELECT *
  INTO case_row
  FROM platform.student_cases AS student_case
  WHERE student_case.organization_id = reservation.organization_id
    AND student_case.id = reservation.student_case_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Document upload reservation is unavailable'
      USING ERRCODE = '42501';
  END IF;

  SELECT *
  INTO slot_row
  FROM platform.document_slots AS slot
  WHERE slot.organization_id = reservation.organization_id
    AND slot.id = reservation.document_slot_id
    AND slot.student_case_id = reservation.student_case_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Document slot cannot publish this reserved version'
      USING ERRCODE = '42501';
  END IF;

  SELECT *
  INTO version_row
  FROM platform.document_versions AS version
  WHERE version.organization_id = reservation.organization_id
    AND version.id = reservation.document_version_id
    AND version.student_case_id = reservation.student_case_id
    AND version.document_slot_id = reservation.document_slot_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Pending document version is unavailable'
      USING ERRCODE = '42501';
  END IF;

  SELECT *
  INTO STRICT reservation
  FROM platform_private.document_upload_reservations AS candidate
  WHERE candidate.organization_id = p_organization_id
    AND candidate.id = p_upload_reservation_id
  FOR UPDATE;

  -- Recheck the immutable receipt only after acquiring the shared domain lock
  -- order. Two request IDs racing on one reservation now deterministically
  -- produce one receipt and one conflict; exact replay returns that receipt.
  SELECT *
  INTO existing_finalization
  FROM platform_private.document_upload_finalizations AS finalization
  WHERE finalization.request_id = p_request_id
    OR finalization.upload_reservation_id = p_upload_reservation_id
  FOR UPDATE;

  IF FOUND THEN
    IF existing_finalization.request_id IS DISTINCT FROM p_request_id
      OR existing_finalization.organization_id IS DISTINCT FROM
        p_organization_id
      OR existing_finalization.upload_reservation_id IS DISTINCT FROM
        p_upload_reservation_id
    THEN
      RAISE EXCEPTION
        'request_id or upload reservation was already finalized differently'
        USING ERRCODE = '23505';
    END IF;

    RETURN jsonb_build_object(
      'organization_id', existing_finalization.organization_id,
      'student_case_id', existing_finalization.student_case_id,
      'document_slot_id', existing_finalization.document_slot_id,
      'document_version_id', existing_finalization.document_version_id,
      'upload_reservation_id',
        existing_finalization.upload_reservation_id,
      'bucket_id', existing_finalization.bucket_id,
      'object_name', existing_finalization.object_name,
      'object_created_at', existing_finalization.object_created_at,
      'finalized_at', existing_finalization.finalized_at,
      'published_slot_status', 'submitted',
      'published_version_no',
        existing_finalization.published_version_no,
      'document_slot_published', TRUE
    );
  END IF;

  SELECT *
  INTO STRICT binding
  FROM platform_private.document_storage_bindings AS candidate
  WHERE candidate.organization_id = reservation.organization_id
    AND candidate.upload_reservation_id = reservation.id
    AND candidate.document_version_id = reservation.document_version_id
    AND candidate.bucket_id = reservation.bucket_id
    AND candidate.object_name = reservation.object_name;

  IF slot_row.status = 'approved'
    OR (
      slot_row.current_version_no IS NOT NULL
      AND slot_row.current_version_no >= version_row.version_no
    )
  THEN
    RAISE EXCEPTION
      'Document slot cannot publish this reserved version'
      USING ERRCODE = '42501';
  END IF;

  SELECT
    object.id,
    object.created_at
  INTO object_row
  FROM storage.objects AS object
  WHERE object.bucket_id = binding.bucket_id
    AND object.name = binding.object_name
  FOR SHARE;

  IF NOT FOUND
    OR object_row.created_at IS NULL
    OR object_row.created_at < reservation.created_at
    OR object_row.created_at > reservation.expires_at
  THEN
    RAISE EXCEPTION
      'Exact document object was not uploaded inside the reservation window'
      USING ERRCODE = '42501';
  END IF;

  UPDATE platform.document_slots AS slot
  SET
    status = 'submitted',
    current_version_id = version_row.id,
    current_version_no = version_row.version_no
  WHERE slot.organization_id = reservation.organization_id
    AND slot.id = reservation.document_slot_id;

  result := jsonb_build_object(
    'organization_id', reservation.organization_id,
    'student_case_id', reservation.student_case_id,
    'document_slot_id', reservation.document_slot_id,
    'document_version_id', reservation.document_version_id,
    'upload_reservation_id', reservation.id,
    'bucket_id', reservation.bucket_id,
    'object_name', reservation.object_name,
    'object_created_at', object_row.created_at,
    'finalized_at', finalized_at,
    'published_slot_status', 'submitted',
    'published_version_no', version_row.version_no,
    'document_slot_published', TRUE
  );

  INSERT INTO platform.audit_events (
    id,
    organization_id,
    actor_kind,
    actor_profile_id,
    actor_principal,
    action,
    resource_type,
    resource_id,
    before_state,
    after_state,
    reason,
    request_id
  )
  VALUES (
    finalization_audit_event_id,
    reservation.organization_id,
    'service',
    NULL,
    'service:platform-document-upload-finalization',
    'document.upload.finalize',
    'document_version',
    reservation.document_version_id,
    jsonb_build_object(
      'slot_status', slot_row.status,
      'current_version_id', slot_row.current_version_id,
      'current_version_no', slot_row.current_version_no
    ),
    result,
    fixed_reason,
    p_request_id
  );

  INSERT INTO platform_private.document_upload_finalizations (
    id,
    request_id,
    organization_id,
    upload_reservation_id,
    student_case_id,
    document_version_id,
    document_slot_id,
    finalization_audit_event_id,
    bucket_id,
    object_name,
    published_version_no,
    object_created_at,
    finalized_at
  )
  VALUES (
    finalization_id,
    p_request_id,
    reservation.organization_id,
    reservation.id,
    reservation.student_case_id,
    reservation.document_version_id,
    reservation.document_slot_id,
    finalization_audit_event_id,
    reservation.bucket_id,
    reservation.object_name,
    version_row.version_no,
    object_row.created_at,
    finalized_at
  );

  RETURN result;
END
$$;

REVOKE ALL ON FUNCTION platform.finalize_document_upload(UUID, UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION
  platform.finalize_document_upload(UUID, UUID, UUID)
  TO service_role;

-- This helper is callable only from the Platform Storage INSERT policy. It
-- rechecks token freshness, current role, current assignment/scope, case state,
-- reservation expiry and exact opaque object name. The immutable reservation
-- remains usable even if a separately authorized metadata path later advances
-- the slot pointer; only expiry, upload completion, or access revocation ends
-- this specific capability.
CREATE OR REPLACE FUNCTION private.platform_can_upload_reserved_document(
  p_bucket_id TEXT,
  p_object_name TEXT
)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM platform_private.document_upload_reservations AS reservation
    JOIN platform_private.document_storage_bindings AS binding
      ON binding.organization_id = reservation.organization_id
      AND binding.upload_reservation_id = reservation.id
      AND binding.document_version_id = reservation.document_version_id
      AND binding.bucket_id = reservation.bucket_id
      AND binding.object_name = reservation.object_name
    JOIN platform.document_versions AS version
      ON version.organization_id = reservation.organization_id
      AND version.id = reservation.document_version_id
      AND version.student_case_id = reservation.student_case_id
      AND version.document_slot_id = reservation.document_slot_id
    JOIN platform.document_slots AS slot
      ON slot.organization_id = reservation.organization_id
      AND slot.id = reservation.document_slot_id
      AND slot.student_case_id = reservation.student_case_id
    JOIN platform.student_cases AS student_case
      ON student_case.organization_id = reservation.organization_id
      AND student_case.id = reservation.student_case_id
    JOIN platform.organization_memberships AS membership
      ON membership.organization_id = reservation.organization_id
      AND membership.id = reservation.uploader_membership_id
    JOIN platform.profiles AS profile
      ON profile.id = reservation.uploader_profile_id
      AND profile.id = membership.profile_id
    WHERE reservation.bucket_id = p_bucket_id
      AND reservation.object_name = p_object_name
      AND reservation.expires_at > statement_timestamp()
      AND reservation.uploader_auth_user_id = (SELECT auth.uid())
      AND profile.auth_user_id = reservation.uploader_auth_user_id
      AND version.integrity_status = 'pending'
      AND version.malware_status = 'pending'
      AND private.platform_has_permission(
        reservation.organization_id,
        'document.upload'
      )
      AND (
        (
          membership."current_role" = 'admin'
          AND platform_private.membership_has_active_scope(
            reservation.organization_id,
            membership.id,
            'organization',
            reservation.organization_id
          )
        )
        OR (
          membership."current_role" = 'curator'
          AND student_case.state IN ('active', 'closed')
          AND student_case.current_curator_membership_id = membership.id
          AND platform_private.membership_has_active_scope(
            reservation.organization_id,
            membership.id,
            'student_case',
            reservation.student_case_id
          )
        )
        OR (
          membership."current_role" = 'student'
          AND student_case.state IN ('active', 'closed')
          AND student_case.student_membership_id = membership.id
          AND student_case.portal_activated_at IS NOT NULL
          AND platform_private.membership_has_active_scope(
            reservation.organization_id,
            membership.id,
            'student_case',
            reservation.student_case_id
          )
        )
      )
  )
$$;

REVOKE ALL ON FUNCTION
  private.platform_can_upload_reserved_document(TEXT, TEXT)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION
  private.platform_can_upload_reserved_document(TEXT, TEXT)
  TO authenticated;

CREATE OR REPLACE FUNCTION platform.grant_document_download(
  p_organization_id UUID,
  p_document_version_id UUID,
  p_access_purpose TEXT,
  p_expires_in_seconds INTEGER,
  p_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  preliminary_version RECORD;
  case_row platform.student_cases%ROWTYPE;
  version_row platform.document_versions%ROWTYPE;
  binding_row platform_private.document_storage_bindings%ROWTYPE;
  actor RECORD;
  existing_grant platform_private.document_download_grants%ROWTYPE;
  grant_id UUID := gen_random_uuid();
  access_event_id UUID := gen_random_uuid();
  grant_created_at TIMESTAMPTZ := statement_timestamp();
  grant_expires_at TIMESTAMPTZ;
  actor_access_version BIGINT;
  recent_actor_grant_count BIGINT;
  contract_reference TEXT;
  result JSONB;
  actor_hourly_limit CONSTANT INTEGER := 120;
  fixed_reason CONSTANT TEXT :=
    'Audited private document download grant created for one backend consumption';
BEGIN
  PERFORM platform_private.lock_p2h_request(p_request_id);

  IF p_organization_id IS NULL
    OR p_document_version_id IS NULL
    OR p_access_purpose IS NULL
    OR btrim(p_access_purpose) = ''
    OR char_length(btrim(p_access_purpose)) > 255
    OR octet_length(btrim(p_access_purpose)) > 1024
    OR p_expires_in_seconds IS NULL
    OR p_expires_in_seconds NOT BETWEEN 1 AND 60
  THEN
    RAISE EXCEPTION
      'Valid short-lived document download grant inputs are required'
      USING ERRCODE = '22023';
  END IF;

  -- Resolve the current JWT principal before reading caller-selected document
  -- state. The authorized join makes missing and unauthorized versions
  -- indistinguishable; validation and object-presence checks occur only after
  -- current object scope has been proven.
  SELECT *
  INTO actor
  FROM platform_private.require_domain_actor(
    p_organization_id,
    'document.download'
  );

  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      'evo:p2h:download-actor:'
      || p_organization_id::TEXT
      || ':'
      || actor.actor_auth_user_id::TEXT,
      0
    )
  );

  SELECT version.student_case_id
  INTO preliminary_version
  FROM platform.document_versions AS version
  JOIN platform.student_cases AS student_case
    ON student_case.organization_id = version.organization_id
    AND student_case.id = version.student_case_id
  WHERE version.organization_id = p_organization_id
    AND version.id = p_document_version_id
    AND (
      (
        actor.actor_role = 'admin'
        AND platform_private.membership_has_active_scope(
          p_organization_id,
          actor.actor_membership_id,
          'organization',
          p_organization_id
        )
      )
      OR (
        actor.actor_role = 'curator'
        AND student_case.state IN ('active', 'closed')
        AND student_case.current_curator_membership_id IS NOT DISTINCT FROM
          actor.actor_membership_id
        AND platform_private.membership_has_active_scope(
          p_organization_id,
          actor.actor_membership_id,
          'student_case',
          student_case.id
        )
      )
      OR (
        actor.actor_role = 'student'
        AND student_case.state IN ('active', 'closed')
        AND student_case.student_membership_id IS NOT DISTINCT FROM
          actor.actor_membership_id
        AND student_case.portal_activated_at IS NOT NULL
        AND platform_private.membership_has_active_scope(
          p_organization_id,
          actor.actor_membership_id,
          'student_case',
          student_case.id
        )
      )
    );

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Document is unavailable'
      USING ERRCODE = '42501';
  END IF;

  -- Every document workflow acquires mutable domain rows in case -> slot
  -- (when needed) -> version order. Resolve the authorized case above without
  -- a row lock, then lock case before the exact case-bound version so review
  -- and finalization cannot form a reciprocal wait cycle with this grant.
  SELECT *
  INTO case_row
  FROM platform.student_cases AS student_case
  WHERE student_case.organization_id = p_organization_id
    AND student_case.id = preliminary_version.student_case_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Document is unavailable'
      USING ERRCODE = '42501';
  END IF;

  SELECT *
  INTO version_row
  FROM platform.document_versions AS version
  WHERE version.organization_id = p_organization_id
    AND version.id = p_document_version_id
    AND version.student_case_id = case_row.id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Document is unavailable'
      USING ERRCODE = '42501';
  END IF;

  -- Re-evaluate record scope after both locks. Assignment, Portal activation,
  -- case state and active scopes must still authorize this exact case.
  IF NOT (
    (
      actor.actor_role = 'admin'
      AND platform_private.membership_has_active_scope(
        p_organization_id,
        actor.actor_membership_id,
        'organization',
        p_organization_id
      )
    )
    OR (
      actor.actor_role = 'curator'
      AND case_row.state IN ('active', 'closed')
      AND case_row.current_curator_membership_id IS NOT DISTINCT FROM
        actor.actor_membership_id
      AND platform_private.membership_has_active_scope(
        p_organization_id,
        actor.actor_membership_id,
        'student_case',
        case_row.id
      )
    )
    OR (
      actor.actor_role = 'student'
      AND case_row.state IN ('active', 'closed')
      AND case_row.student_membership_id IS NOT DISTINCT FROM
        actor.actor_membership_id
      AND case_row.portal_activated_at IS NOT NULL
      AND platform_private.membership_has_active_scope(
        p_organization_id,
        actor.actor_membership_id,
        'student_case',
        case_row.id
      )
    )
  ) THEN
    RAISE EXCEPTION
      'Document is unavailable'
      USING ERRCODE = '42501';
  END IF;

  IF version_row.integrity_status <> 'verified'
    OR version_row.malware_status <> 'clean'
  THEN
    RAISE EXCEPTION
      'Verified clean document is required'
      USING ERRCODE = '42501';
  END IF;

  SELECT *
  INTO binding_row
  FROM platform_private.document_storage_bindings AS binding
  WHERE binding.organization_id = p_organization_id
    AND binding.document_version_id = p_document_version_id;

  IF NOT FOUND OR NOT EXISTS (
    SELECT 1
    FROM storage.objects AS object
    WHERE object.bucket_id = binding_row.bucket_id
      AND object.name = binding_row.object_name
  ) THEN
    RAISE EXCEPTION
      'Private Storage object is unavailable'
      USING ERRCODE = '42501';
  END IF;

  SELECT profile.access_version
  INTO STRICT actor_access_version
  FROM platform.profiles AS profile
  WHERE profile.id = actor.actor_profile_id;

  SELECT *
  INTO existing_grant
  FROM platform_private.document_download_grants AS download_grant
  WHERE download_grant.request_id = p_request_id;

  IF FOUND THEN
    IF existing_grant.organization_id IS DISTINCT FROM
        p_organization_id
      OR existing_grant.document_version_id IS DISTINCT FROM
        p_document_version_id
      OR existing_grant.grantee_profile_id IS DISTINCT FROM
        actor.actor_profile_id
      OR existing_grant.grantee_membership_id IS DISTINCT FROM
        actor.actor_membership_id
      OR existing_grant.grantee_auth_user_id IS DISTINCT FROM
        actor.actor_auth_user_id
      OR existing_grant.grantee_role IS DISTINCT FROM actor.actor_role
      OR existing_grant.grantee_access_version IS DISTINCT FROM
        actor_access_version
      OR existing_grant.access_purpose IS DISTINCT FROM
        btrim(p_access_purpose)
      OR existing_grant.expires_in_seconds IS DISTINCT FROM
        p_expires_in_seconds
    THEN
      RAISE EXCEPTION
        'request_id was already used with different download inputs'
        USING ERRCODE = '23505';
    END IF;

    RETURN jsonb_build_object(
      'document_download_grant_id', existing_grant.id,
      'expires_at', existing_grant.expires_at,
      'signed_url', NULL,
      'storage_api_service_sign_required', TRUE
    );
  END IF;

  IF EXISTS (
    SELECT 1
    FROM platform_private.document_download_grants AS download_grant
    WHERE download_grant.organization_id = p_organization_id
      AND download_grant.grantee_auth_user_id = actor.actor_auth_user_id
      AND download_grant.document_version_id = p_document_version_id
      AND download_grant.expires_at > grant_created_at
      AND NOT EXISTS (
        SELECT 1
        FROM platform_private.document_download_consumptions AS consumption
        WHERE consumption.document_download_grant_id = download_grant.id
      )
  ) THEN
    RAISE EXCEPTION
      'A document download grant is already active'
      USING ERRCODE = 'PT409';
  END IF;

  SELECT count(*)
  INTO recent_actor_grant_count
  FROM platform_private.document_download_grants AS download_grant
  WHERE download_grant.organization_id = p_organization_id
    AND download_grant.grantee_auth_user_id = actor.actor_auth_user_id
    AND download_grant.created_at >
      grant_created_at - INTERVAL '1 hour';

  IF recent_actor_grant_count >= actor_hourly_limit THEN
    RAISE EXCEPTION
      'Document download request limit reached'
      USING ERRCODE = 'PT429';
  END IF;

  grant_expires_at :=
    grant_created_at + make_interval(secs => p_expires_in_seconds);
  contract_reference := 'storage-download-grant:' || grant_id::TEXT;

  INSERT INTO platform.document_access_events (
    id,
    organization_id,
    student_case_id,
    document_slot_id,
    document_version_id,
    actor_kind,
    actor_profile_id,
    actor_membership_id,
    access_purpose,
    contract_reference,
    request_id,
    created_at
  )
  VALUES (
    access_event_id,
    p_organization_id,
    version_row.student_case_id,
    version_row.document_slot_id,
    version_row.id,
    'user',
    actor.actor_profile_id,
    actor.actor_membership_id,
    btrim(p_access_purpose),
    contract_reference,
    p_request_id,
    grant_created_at
  );

  INSERT INTO platform_private.document_download_grants (
    id,
    request_id,
    organization_id,
    student_case_id,
    document_slot_id,
    document_version_id,
    storage_binding_id,
    document_access_event_id,
    grantee_profile_id,
    grantee_membership_id,
    grantee_auth_user_id,
    grantee_role,
    grantee_access_version,
    access_purpose,
    expires_in_seconds,
    expires_at,
    created_at
  )
  VALUES (
    grant_id,
    p_request_id,
    p_organization_id,
    version_row.student_case_id,
    version_row.document_slot_id,
    version_row.id,
    binding_row.id,
    access_event_id,
    actor.actor_profile_id,
    actor.actor_membership_id,
    actor.actor_auth_user_id,
    actor.actor_role,
    actor_access_version,
    btrim(p_access_purpose),
    p_expires_in_seconds,
    grant_expires_at,
    grant_created_at
  );

  result := jsonb_build_object(
    'document_download_grant_id', grant_id,
    'expires_at', grant_expires_at,
    'signed_url', NULL,
    'storage_api_service_sign_required', TRUE
  );

  INSERT INTO platform.audit_events (
    organization_id,
    actor_kind,
    actor_profile_id,
    actor_principal,
    action,
    resource_type,
    resource_id,
    before_state,
    after_state,
    reason,
    request_id
  )
  VALUES (
    p_organization_id,
    'user',
    actor.actor_profile_id,
    'auth:' || actor.actor_auth_user_id::TEXT,
    'document.download.grant',
    'document_version',
    version_row.id,
    NULL,
    result,
    fixed_reason,
    p_request_id
  );

  RETURN result;
END
$$;

-- Browser callers cannot sign or fetch platform-documents directly. A trusted
-- backend must consume one opaque grant exactly once, then call the Storage API
-- with the returned exact object and max_signed_url_expires_in_seconds. The
-- SQL function never creates, receives or stores a signed URL/bearer token.
CREATE OR REPLACE FUNCTION platform.consume_document_download_grant(
  p_document_download_grant_id UUID,
  p_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  download_grant platform_private.document_download_grants%ROWTYPE;
  binding platform_private.document_storage_bindings%ROWTYPE;
  existing_consumption
    platform_private.document_download_consumptions%ROWTYPE;
  authorization_valid BOOLEAN := FALSE;
  consumption_id UUID := gen_random_uuid();
  signing_audit_event_id UUID := gen_random_uuid();
  consumed_at TIMESTAMPTZ := statement_timestamp();
  remaining_seconds INTEGER;
  result JSONB;
  fixed_reason CONSTANT TEXT :=
    'Trusted backend consumed one audited download grant before provider signing';
BEGIN
  IF (SELECT auth.jwt() ->> 'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION
      'service_role is required to consume a document download grant'
      USING ERRCODE = '42501';
  END IF;

  IF p_document_download_grant_id IS NULL OR p_request_id IS NULL THEN
    RAISE EXCEPTION
      'download grant id and request id are required'
      USING ERRCODE = '22023';
  END IF;

  PERFORM platform_private.lock_p2h_request(p_request_id);

  SELECT *
  INTO download_grant
  FROM platform_private.document_download_grants AS candidate
  WHERE candidate.id = p_document_download_grant_id
  FOR UPDATE;

  IF NOT FOUND OR download_grant.expires_at <= consumed_at THEN
    RAISE EXCEPTION
      'Live document download grant is required'
      USING ERRCODE = '42501';
  END IF;

  SELECT *
  INTO existing_consumption
  FROM platform_private.document_download_consumptions AS consumption
  WHERE consumption.document_download_grant_id =
      p_document_download_grant_id
    OR consumption.request_id = p_request_id;

  IF FOUND THEN
    RAISE EXCEPTION
      'Document download grant or request was already consumed'
      USING ERRCODE = '23505';
  END IF;

  SELECT *
  INTO STRICT binding
  FROM platform_private.document_storage_bindings AS candidate
  WHERE candidate.id = download_grant.storage_binding_id
    AND candidate.organization_id = download_grant.organization_id
    AND candidate.document_version_id =
      download_grant.document_version_id;

  IF NOT EXISTS (
    SELECT 1
    FROM storage.objects AS object
    WHERE object.bucket_id = binding.bucket_id
      AND object.name = binding.object_name
  ) THEN
    RAISE EXCEPTION
      'Private Storage object is unavailable'
      USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM platform.document_access_events AS access_event
    WHERE access_event.id = download_grant.document_access_event_id
      AND access_event.organization_id = download_grant.organization_id
      AND access_event.student_case_id =
        download_grant.student_case_id
      AND access_event.document_slot_id =
        download_grant.document_slot_id
      AND access_event.document_version_id =
        download_grant.document_version_id
      AND access_event.actor_kind = 'user'
      AND access_event.actor_profile_id =
        download_grant.grantee_profile_id
      AND access_event.actor_membership_id =
        download_grant.grantee_membership_id
      AND access_event.request_id = download_grant.request_id
  ) THEN
    RAISE EXCEPTION
      'Audited document access grant is required'
      USING ERRCODE = '42501';
  END IF;

  SELECT TRUE
  INTO authorization_valid
  FROM platform.profiles AS profile
  JOIN platform.organization_memberships AS membership
    ON membership.organization_id = download_grant.organization_id
    AND membership.id = download_grant.grantee_membership_id
    AND membership.profile_id = profile.id
  JOIN platform.organizations AS organization
    ON organization.id = membership.organization_id
  JOIN platform.role_bundle_versions AS bundle
    ON bundle.id = membership.current_bundle_id
    AND bundle.role = membership."current_role"
  JOIN platform.role_bundle_permissions AS bundle_permission
    ON bundle_permission.bundle_id = bundle.id
    AND bundle_permission.bundle_role = bundle.role
    AND bundle_permission.permission_key = 'document.download'
  JOIN platform.student_cases AS student_case
    ON student_case.organization_id = download_grant.organization_id
    AND student_case.id = download_grant.student_case_id
  JOIN platform.document_versions AS document_version
    ON document_version.organization_id =
      download_grant.organization_id
    AND document_version.id = download_grant.document_version_id
    AND document_version.student_case_id =
      download_grant.student_case_id
    AND document_version.document_slot_id =
      download_grant.document_slot_id
  WHERE profile.id = download_grant.grantee_profile_id
    AND profile.auth_user_id = download_grant.grantee_auth_user_id
    AND profile.status = 'active'
    AND profile.access_version =
      download_grant.grantee_access_version
    AND membership.status = 'active'
    AND membership."current_role" = download_grant.grantee_role
    AND organization.status = 'active'
    AND bundle.status = 'published'
    AND document_version.integrity_status = 'verified'
    AND document_version.malware_status = 'clean'
    AND (
      (
        membership."current_role" = 'admin'
        AND platform_private.membership_has_active_scope(
          download_grant.organization_id,
          membership.id,
          'organization',
          download_grant.organization_id
        )
      )
      OR (
        membership."current_role" = 'curator'
        AND student_case.state IN ('active', 'closed')
        AND student_case.current_curator_membership_id = membership.id
        AND platform_private.membership_has_active_scope(
          download_grant.organization_id,
          membership.id,
          'student_case',
          download_grant.student_case_id
        )
      )
      OR (
        membership."current_role" = 'student'
        AND student_case.state IN ('active', 'closed')
        AND student_case.student_membership_id = membership.id
        AND student_case.portal_activated_at IS NOT NULL
        AND platform_private.membership_has_active_scope(
          download_grant.organization_id,
          membership.id,
          'student_case',
          download_grant.student_case_id
        )
      )
    )
  FOR UPDATE OF profile, membership, organization, student_case,
    document_version;

  IF NOT COALESCE(authorization_valid, FALSE) THEN
    RAISE EXCEPTION
      'Current document authorization is required'
      USING ERRCODE = '42501';
  END IF;

  remaining_seconds := LEAST(
    60,
    floor(
      extract(epoch FROM (download_grant.expires_at - clock_timestamp()))
    )::INTEGER
  );

  IF remaining_seconds < 1 THEN
    RAISE EXCEPTION
      'Live document download grant is required'
      USING ERRCODE = '42501';
  END IF;

  result := jsonb_build_object(
    'organization_id', download_grant.organization_id,
    'student_case_id', download_grant.student_case_id,
    'document_slot_id', download_grant.document_slot_id,
    'document_version_id', download_grant.document_version_id,
    'document_download_grant_id', download_grant.id,
    'document_download_consumption_id', consumption_id,
    'document_access_event_id',
      download_grant.document_access_event_id,
    'bucket_id', binding.bucket_id,
    'object_name', binding.object_name,
    'max_signed_url_expires_in_seconds', remaining_seconds,
    'grant_expires_at', download_grant.expires_at,
    'signed_url', NULL,
    'storage_api_service_sign_required', TRUE
  );

  INSERT INTO platform.audit_events (
    id,
    organization_id,
    actor_kind,
    actor_profile_id,
    actor_principal,
    action,
    resource_type,
    resource_id,
    before_state,
    after_state,
    reason,
    request_id,
    created_at
  )
  VALUES (
    signing_audit_event_id,
    download_grant.organization_id,
    'service',
    NULL,
    'service:platform-document-signing',
    'document.download.sign.authorize',
    'document_version',
    download_grant.document_version_id,
    NULL,
    result,
    fixed_reason,
    p_request_id,
    consumed_at
  );

  INSERT INTO platform_private.document_download_consumptions (
    id,
    request_id,
    organization_id,
    document_download_grant_id,
    document_access_event_id,
    signing_audit_event_id,
    storage_binding_id,
    bucket_id,
    object_name,
    max_signed_url_expires_in_seconds,
    grant_expires_at,
    consumed_at
  )
  VALUES (
    consumption_id,
    p_request_id,
    download_grant.organization_id,
    download_grant.id,
    download_grant.document_access_event_id,
    signing_audit_event_id,
    binding.id,
    binding.bucket_id,
    binding.object_name,
    remaining_seconds,
    download_grant.expires_at,
    consumed_at
  );

  RETURN result;
END
$$;

REVOKE ALL ON FUNCTION platform.consume_document_download_grant(UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION
  platform.consume_document_download_grant(UUID, UUID)
  TO service_role;

-- Backup inventory reconciles every binding with every provider metadata row
-- in the fixed bucket, including missing and unbound objects. expected_* is
-- protected application metadata, never an assertion that current object bytes
-- were downloaded or hashed.
CREATE OR REPLACE FUNCTION platform.document_storage_backup_inventory()
RETURNS TABLE (
  organization_id UUID,
  document_version_id UUID,
  student_case_id UUID,
  document_slot_id UUID,
  bucket_id TEXT,
  object_name TEXT,
  storage_object_id UUID,
  binding_present BOOLEAN,
  storage_object_present BOOLEAN,
  expected_byte_size BIGINT,
  expected_sha256_hex TEXT,
  storage_reported_byte_size BIGINT,
  inventory_state TEXT,
  binding_created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF (SELECT auth.jwt() ->> 'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION
      'Service role is required'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH binding_inventory AS (
    SELECT
      binding.organization_id,
      binding.document_version_id,
      binding.student_case_id,
      binding.document_slot_id,
      binding.bucket_id,
      binding.object_name,
      version.byte_size AS expected_byte_size,
      version.sha256_hex AS expected_sha256_hex,
      binding.created_at AS binding_created_at
    FROM platform_private.document_storage_bindings AS binding
    JOIN platform.document_versions AS version
      ON version.organization_id = binding.organization_id
      AND version.id = binding.document_version_id
  ),
  storage_inventory AS (
    SELECT
      object.id AS storage_object_id,
      object.bucket_id,
      object.name AS object_name,
      CASE
        WHEN COALESCE(object.metadata ->> 'size', '') ~ '^[0-9]+$'
          THEN (object.metadata ->> 'size')::BIGINT
        ELSE NULL
      END AS storage_reported_byte_size
    FROM storage.objects AS object
    WHERE object.bucket_id = 'platform-documents'
  )
  SELECT
    binding.organization_id,
    binding.document_version_id,
    binding.student_case_id,
    binding.document_slot_id,
    COALESCE(binding.bucket_id, object.bucket_id),
    COALESCE(binding.object_name, object.object_name),
    object.storage_object_id,
    binding.document_version_id IS NOT NULL,
    object.storage_object_id IS NOT NULL,
    binding.expected_byte_size,
    binding.expected_sha256_hex,
    object.storage_reported_byte_size,
    CASE
      WHEN binding.document_version_id IS NULL THEN 'unbound_object'
      WHEN object.storage_object_id IS NULL THEN 'missing_object'
      WHEN object.storage_reported_byte_size IS NULL
        THEN 'present_size_unknown'
      WHEN object.storage_reported_byte_size <>
        binding.expected_byte_size THEN 'size_mismatch'
      ELSE 'present'
    END,
    binding.binding_created_at
  FROM binding_inventory AS binding
  FULL OUTER JOIN storage_inventory AS object
    ON object.bucket_id = binding.bucket_id
    AND object.object_name = binding.object_name
  ORDER BY
    COALESCE(binding.organization_id::TEXT, ''),
    COALESCE(binding.document_version_id::TEXT, ''),
    COALESCE(binding.object_name, object.object_name);
END
$$;

-- This upload-only policy is intentionally the sole policy mentioning
-- platform-documents. Browser upload is insert-only and cannot upsert.
-- Browser select/sign/list/get/update/delete remain denied even after a grant;
-- the trusted backend signs only after the service-only consumption RPC.
DROP POLICY IF EXISTS "Platform document reserved upload"
  ON storage.objects;
CREATE POLICY "Platform document reserved upload"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'platform-documents'
    AND storage.allow_only_operation('storage.object.upload')
    AND (
      SELECT private.platform_can_upload_reserved_document(
        bucket_id,
        name
      )
    )
  );

DROP POLICY IF EXISTS "Platform document audited single sign"
  ON storage.objects;

REVOKE ALL ON FUNCTION platform.reserve_document_upload(
  UUID,
  UUID,
  TEXT,
  TEXT,
  BIGINT,
  TEXT,
  UUID
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.reserve_document_upload(
  UUID,
  UUID,
  TEXT,
  TEXT,
  BIGINT,
  TEXT,
  UUID
) TO authenticated;

REVOKE ALL ON FUNCTION platform.grant_document_download(
  UUID,
  UUID,
  TEXT,
  INTEGER,
  UUID
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.grant_document_download(
  UUID,
  UUID,
  TEXT,
  INTEGER,
  UUID
) TO authenticated;

REVOKE ALL ON FUNCTION platform.document_storage_backup_inventory()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.document_storage_backup_inventory()
  TO service_role;

COMMENT ON TABLE platform_private.document_upload_reservations IS
  'Immutable ten-minute upload authorization for one exact opaque Platform document object.';
COMMENT ON TABLE platform_private.document_storage_bindings IS
  'Immutable version-to-object target binding; it is not proof that object bytes exist.';
COMMENT ON TABLE platform_private.document_upload_finalizations IS
  'Immutable service-side receipt proving one exact in-window Storage object was published as current.';
COMMENT ON TABLE platform_private.document_download_grants IS
  'Immutable audited short-lived browser grant; object identity remains backend-only.';
COMMENT ON TABLE platform_private.document_download_consumptions IS
  'Immutable one-time backend signing authorization; stores no URL or bearer token.';
COMMENT ON FUNCTION platform.reserve_document_upload(
  UUID,
  UUID,
  TEXT,
  TEXT,
  BIGINT,
  TEXT,
  UUID
) IS
  'Creates pending document metadata plus one exact private upload reservation without publishing the slot.';
COMMENT ON FUNCTION platform.finalize_document_upload(UUID, UUID, UUID) IS
  'Service-only idempotent publication of one exact object uploaded inside its reservation window.';
COMMENT ON FUNCTION platform.grant_document_download(
  UUID,
  UUID,
  TEXT,
  INTEGER,
  UUID
) IS
  'Audits one verified-clean opaque browser grant; never returns an object key or signed URL.';
COMMENT ON FUNCTION platform.consume_document_download_grant(UUID, UUID) IS
  'Service-only one-time grant consumption returning an exact object and <=60 second provider signing TTL; never returns a signed URL.';
COMMENT ON FUNCTION platform.document_storage_backup_inventory() IS
  'Service-only missing/unbound/size reconciliation; expected SHA is not an actual object-byte hash claim.';

COMMIT;
