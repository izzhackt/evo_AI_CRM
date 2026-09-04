-- ============================================================
-- 109_platform_company_files.sql
--
-- Canonical private company knowledge folders, files and versions.
--
-- The synthetic Company root is not stored: NULL parent/folder identifiers
-- mean that root. Object bytes are written only through the private Supabase
-- Storage bucket `platform-company-files`; this migration never writes
-- storage.buckets or storage.objects. Browser principals receive one exact,
-- expiring INSERT capability and no list/read/update/delete Storage policy.
-- ============================================================

BEGIN;

CREATE TABLE platform.company_file_folders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  parent_folder_id UUID,
  name TEXT NOT NULL CHECK (
    name = btrim(name)
    AND char_length(name) BETWEEN 1 AND 255
    AND octet_length(name) <= 1024
    AND name !~ '[[:cntrl:]]'
  ),
  version BIGINT NOT NULL DEFAULT 1 CHECK (version > 0),
  archived_at TIMESTAMPTZ,
  created_by_membership_id UUID NOT NULL,
  updated_by_membership_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT company_file_folders_org_id_key UNIQUE (organization_id, id),
  CONSTRAINT company_file_folders_org_fkey
    FOREIGN KEY (organization_id)
    REFERENCES platform.organizations(id)
    ON DELETE RESTRICT,
  CONSTRAINT company_file_folders_parent_fkey
    FOREIGN KEY (organization_id, parent_folder_id)
    REFERENCES platform.company_file_folders(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT company_file_folders_created_by_fkey
    FOREIGN KEY (organization_id, created_by_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT company_file_folders_updated_by_fkey
    FOREIGN KEY (organization_id, updated_by_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT company_file_folders_not_self_parent_check
    CHECK (parent_folder_id IS DISTINCT FROM id),
  CONSTRAINT company_file_folders_archive_time_check
    CHECK (archived_at IS NULL OR archived_at >= created_at),
  CONSTRAINT company_file_folders_update_time_check
    CHECK (updated_at >= created_at)
);

CREATE UNIQUE INDEX company_file_folders_active_sibling_name_key
  ON platform.company_file_folders (
    organization_id,
    COALESCE(parent_folder_id, '00000000-0000-0000-0000-000000000000'::UUID),
    lower(name)
  )
  WHERE archived_at IS NULL;
CREATE INDEX company_file_folders_parent_active_idx
  ON platform.company_file_folders (organization_id, parent_folder_id, name)
  WHERE archived_at IS NULL;

CREATE TABLE platform.company_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  folder_id UUID,
  display_name TEXT NOT NULL CHECK (
    display_name = btrim(display_name)
    AND char_length(display_name) BETWEEN 1 AND 255
    AND octet_length(display_name) <= 1024
    AND display_name !~ '[[:cntrl:]]'
  ),
  current_version_id UUID,
  version BIGINT NOT NULL DEFAULT 1 CHECK (version > 0),
  archived_at TIMESTAMPTZ,
  created_by_membership_id UUID NOT NULL,
  updated_by_membership_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT company_files_org_id_key UNIQUE (organization_id, id),
  CONSTRAINT company_files_org_fkey
    FOREIGN KEY (organization_id)
    REFERENCES platform.organizations(id)
    ON DELETE RESTRICT,
  CONSTRAINT company_files_folder_fkey
    FOREIGN KEY (organization_id, folder_id)
    REFERENCES platform.company_file_folders(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT company_files_created_by_fkey
    FOREIGN KEY (organization_id, created_by_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT company_files_updated_by_fkey
    FOREIGN KEY (organization_id, updated_by_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT company_files_archive_time_check
    CHECK (archived_at IS NULL OR archived_at >= created_at),
  CONSTRAINT company_files_update_time_check
    CHECK (updated_at >= created_at)
);

CREATE UNIQUE INDEX company_files_active_sibling_name_key
  ON platform.company_files (
    organization_id,
    COALESCE(folder_id, '00000000-0000-0000-0000-000000000000'::UUID),
    lower(display_name)
  )
  WHERE archived_at IS NULL;
CREATE INDEX company_files_folder_active_idx
  ON platform.company_files (organization_id, folder_id, display_name)
  WHERE archived_at IS NULL;

CREATE TABLE platform.company_file_versions (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL,
  company_file_id UUID NOT NULL,
  version_no BIGINT NOT NULL CHECK (version_no > 0),
  original_filename TEXT NOT NULL CHECK (
    original_filename = btrim(original_filename)
    AND char_length(original_filename) BETWEEN 1 AND 255
    AND octet_length(original_filename) <= 1024
    AND original_filename !~ '[[:cntrl:]]'
  ),
  declared_mime_type TEXT NOT NULL CHECK (
    declared_mime_type IN (
      'application/pdf',
      'image/jpeg',
      'image/png',
      'text/plain',
      'text/csv',
      'application/msword',
      'application/vnd.ms-excel',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    )
  ),
  byte_size BIGINT NOT NULL CHECK (byte_size BETWEEN 1 AND 26214400),
  sha256_hex TEXT NOT NULL CHECK (sha256_hex ~ '^[0-9a-f]{64}$'),
  submitted_by_membership_id UUID NOT NULL,
  submitted_by_profile_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT company_file_versions_org_id_key UNIQUE (organization_id, id),
  CONSTRAINT company_file_versions_number_key
    UNIQUE (organization_id, company_file_id, version_no),
  CONSTRAINT company_file_versions_file_fkey
    FOREIGN KEY (organization_id, company_file_id)
    REFERENCES platform.company_files(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT company_file_versions_submitter_membership_fkey
    FOREIGN KEY (
      organization_id,
      submitted_by_membership_id,
      submitted_by_profile_id
    )
    REFERENCES platform.organization_memberships(organization_id, id, profile_id)
    ON DELETE RESTRICT,
  CONSTRAINT company_file_versions_identity_key
    UNIQUE (organization_id, id, company_file_id)
);

CREATE INDEX company_file_versions_file_idx
  ON platform.company_file_versions (
    organization_id,
    company_file_id,
    version_no DESC
  );

ALTER TABLE platform.company_files
  ADD CONSTRAINT company_files_current_version_fkey
  FOREIGN KEY (organization_id, current_version_id, id)
  REFERENCES platform.company_file_versions(
    organization_id,
    id,
    company_file_id
  )
  ON DELETE RESTRICT;

CREATE TABLE platform_private.company_file_command_receipts (
  request_id UUID PRIMARY KEY,
  organization_id UUID NOT NULL,
  actor_kind platform.audit_actor_kind NOT NULL,
  actor_profile_id UUID,
  actor_membership_id UUID,
  actor_principal TEXT NOT NULL CHECK (btrim(actor_principal) <> ''),
  action TEXT NOT NULL CHECK (
    action ~ '^company\.file\.[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$'
  ),
  resource_id UUID NOT NULL,
  input JSONB NOT NULL CHECK (jsonb_typeof(input) = 'object'),
  result JSONB NOT NULL CHECK (jsonb_typeof(result) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT company_file_command_receipts_actor_check CHECK (
    (
      actor_kind = 'user'
      AND actor_profile_id IS NOT NULL
      AND actor_membership_id IS NOT NULL
    )
    OR (
      actor_kind = 'service'
      AND actor_profile_id IS NULL
      AND actor_membership_id IS NULL
    )
  ),
  CONSTRAINT company_file_command_receipts_actor_fkey
    FOREIGN KEY (organization_id, actor_membership_id, actor_profile_id)
    REFERENCES platform.organization_memberships(organization_id, id, profile_id)
    ON DELETE RESTRICT
);

CREATE TABLE platform_private.company_file_upload_reservations (
  id UUID PRIMARY KEY,
  request_id UUID NOT NULL UNIQUE,
  organization_id UUID NOT NULL,
  company_file_id UUID NOT NULL,
  company_file_version_id UUID NOT NULL,
  expected_file_version BIGINT NOT NULL CHECK (expected_file_version > 0),
  uploader_profile_id UUID NOT NULL,
  uploader_membership_id UUID NOT NULL,
  uploader_auth_user_id UUID NOT NULL,
  bucket_id TEXT NOT NULL DEFAULT 'platform-company-files'
    CHECK (bucket_id = 'platform-company-files'),
  object_name TEXT NOT NULL CHECK (object_name ~ '^[0-9a-f]{2}/[0-9a-f]{62}$'),
  declared_mime_type TEXT NOT NULL,
  byte_size BIGINT NOT NULL CHECK (byte_size BETWEEN 1 AND 26214400),
  sha256_hex TEXT NOT NULL CHECK (sha256_hex ~ '^[0-9a-f]{64}$'),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT company_file_upload_reservations_object_key
    UNIQUE (bucket_id, object_name),
  CONSTRAINT company_file_upload_reservations_identity_key
    UNIQUE (organization_id, id, company_file_version_id, bucket_id, object_name),
  CONSTRAINT company_file_upload_reservations_version_fkey
    FOREIGN KEY (organization_id, company_file_version_id, company_file_id)
    REFERENCES platform.company_file_versions(organization_id, id, company_file_id)
    ON DELETE RESTRICT,
  CONSTRAINT company_file_upload_reservations_uploader_fkey
    FOREIGN KEY (organization_id, uploader_membership_id, uploader_profile_id)
    REFERENCES platform.organization_memberships(organization_id, id, profile_id)
    ON DELETE RESTRICT,
  CONSTRAINT company_file_upload_reservations_expiry_check CHECK (
    expires_at > created_at
    AND expires_at <= created_at + INTERVAL '10 minutes'
  )
);

CREATE TABLE platform_private.company_file_storage_bindings (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL,
  company_file_id UUID NOT NULL,
  company_file_version_id UUID NOT NULL,
  upload_reservation_id UUID NOT NULL,
  bucket_id TEXT NOT NULL CHECK (bucket_id = 'platform-company-files'),
  object_name TEXT NOT NULL CHECK (object_name ~ '^[0-9a-f]{2}/[0-9a-f]{62}$'),
  expected_byte_size BIGINT NOT NULL CHECK (expected_byte_size BETWEEN 1 AND 26214400),
  expected_sha256_hex TEXT NOT NULL CHECK (expected_sha256_hex ~ '^[0-9a-f]{64}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT company_file_storage_bindings_version_key
    UNIQUE (organization_id, company_file_version_id),
  CONSTRAINT company_file_storage_bindings_identity_key
    UNIQUE (organization_id, id, company_file_version_id),
  CONSTRAINT company_file_storage_bindings_object_key UNIQUE (bucket_id, object_name),
  CONSTRAINT company_file_storage_bindings_reservation_key UNIQUE (upload_reservation_id),
  CONSTRAINT company_file_storage_bindings_reservation_fkey
    FOREIGN KEY (
      organization_id,
      upload_reservation_id,
      company_file_version_id,
      bucket_id,
      object_name
    )
    REFERENCES platform_private.company_file_upload_reservations(
      organization_id,
      id,
      company_file_version_id,
      bucket_id,
      object_name
    )
    ON DELETE RESTRICT,
  CONSTRAINT company_file_storage_bindings_version_fkey
    FOREIGN KEY (organization_id, company_file_version_id, company_file_id)
    REFERENCES platform.company_file_versions(organization_id, id, company_file_id)
    ON DELETE RESTRICT
);

CREATE TABLE platform_private.company_file_upload_finalizations (
  id UUID PRIMARY KEY,
  request_id UUID NOT NULL UNIQUE,
  organization_id UUID NOT NULL,
  company_file_id UUID NOT NULL,
  company_file_version_id UUID NOT NULL,
  upload_reservation_id UUID NOT NULL,
  storage_binding_id UUID NOT NULL,
  bucket_id TEXT NOT NULL CHECK (bucket_id = 'platform-company-files'),
  object_name TEXT NOT NULL CHECK (object_name ~ '^[0-9a-f]{2}/[0-9a-f]{62}$'),
  storage_object_id UUID NOT NULL,
  object_created_at TIMESTAMPTZ NOT NULL,
  finalized_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT company_file_upload_finalizations_version_key
    UNIQUE (organization_id, company_file_version_id),
  CONSTRAINT company_file_upload_finalizations_reservation_key
    UNIQUE (upload_reservation_id),
  CONSTRAINT company_file_upload_finalizations_binding_key
    UNIQUE (storage_binding_id),
  CONSTRAINT company_file_upload_finalizations_object_key
    UNIQUE (bucket_id, object_name),
  CONSTRAINT company_file_upload_finalizations_binding_fkey
    FOREIGN KEY (
      organization_id,
      storage_binding_id,
      company_file_version_id
    )
    REFERENCES platform_private.company_file_storage_bindings(
      organization_id,
      id,
      company_file_version_id
    )
    ON DELETE RESTRICT,
  CONSTRAINT company_file_upload_finalizations_version_fkey
    FOREIGN KEY (organization_id, company_file_version_id, company_file_id)
    REFERENCES platform.company_file_versions(organization_id, id, company_file_id)
    ON DELETE RESTRICT
);

CREATE TABLE platform_private.company_file_download_grants (
  id UUID PRIMARY KEY,
  request_id UUID NOT NULL UNIQUE,
  organization_id UUID NOT NULL,
  company_file_id UUID NOT NULL,
  company_file_version_id UUID NOT NULL,
  storage_binding_id UUID NOT NULL,
  grantee_profile_id UUID NOT NULL,
  grantee_membership_id UUID NOT NULL,
  grantee_auth_user_id UUID NOT NULL,
  grantee_role platform.business_role NOT NULL CHECK (grantee_role IN ('admin', 'curator')),
  access_purpose TEXT NOT NULL CHECK (
    access_purpose = btrim(access_purpose)
    AND char_length(access_purpose) BETWEEN 1 AND 255
    AND octet_length(access_purpose) <= 1024
  ),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT company_file_download_grants_version_fkey
    FOREIGN KEY (organization_id, company_file_version_id, company_file_id)
    REFERENCES platform.company_file_versions(organization_id, id, company_file_id)
    ON DELETE RESTRICT,
  CONSTRAINT company_file_download_grants_identity_key
    UNIQUE (organization_id, id, company_file_version_id),
  CONSTRAINT company_file_download_grants_binding_fkey
    FOREIGN KEY (organization_id, storage_binding_id, company_file_version_id)
    REFERENCES platform_private.company_file_storage_bindings(
      organization_id,
      id,
      company_file_version_id
    )
    ON DELETE RESTRICT,
  CONSTRAINT company_file_download_grants_actor_fkey
    FOREIGN KEY (organization_id, grantee_membership_id, grantee_profile_id)
    REFERENCES platform.organization_memberships(organization_id, id, profile_id)
    ON DELETE RESTRICT,
  CONSTRAINT company_file_download_grants_expiry_check CHECK (
    expires_at > created_at
    AND expires_at <= created_at + INTERVAL '5 minutes'
  )
);

CREATE TABLE platform_private.company_file_download_consumptions (
  id UUID PRIMARY KEY,
  request_id UUID NOT NULL UNIQUE,
  organization_id UUID NOT NULL,
  company_file_download_grant_id UUID NOT NULL UNIQUE,
  company_file_version_id UUID NOT NULL,
  bucket_id TEXT NOT NULL CHECK (bucket_id = 'platform-company-files'),
  object_name TEXT NOT NULL CHECK (object_name ~ '^[0-9a-f]{2}/[0-9a-f]{62}$'),
  signing_expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT company_file_download_consumptions_grant_fkey
    FOREIGN KEY (
      organization_id,
      company_file_download_grant_id,
      company_file_version_id
    )
    REFERENCES platform_private.company_file_download_grants(
      organization_id,
      id,
      company_file_version_id
    )
    ON DELETE RESTRICT,
  CONSTRAINT company_file_download_consumptions_signing_expiry_check CHECK (
    signing_expires_at > consumed_at
    AND signing_expires_at <= consumed_at + INTERVAL '60 seconds'
  )
);

CREATE INDEX company_file_upload_reservations_live_actor_idx
  ON platform_private.company_file_upload_reservations (
    bucket_id,
    object_name,
    uploader_auth_user_id,
    expires_at
  );
CREATE INDEX company_file_upload_reservations_file_live_idx
  ON platform_private.company_file_upload_reservations (
    organization_id,
    company_file_id,
    expires_at DESC
  );
CREATE INDEX company_file_download_grants_live_actor_idx
  ON platform_private.company_file_download_grants (
    organization_id,
    grantee_auth_user_id,
    company_file_version_id,
    expires_at DESC
  );

ALTER TABLE platform.company_file_folders ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.company_file_folders FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.company_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.company_files FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.company_file_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.company_file_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE platform_private.company_file_command_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.company_file_command_receipts FORCE ROW LEVEL SECURITY;
ALTER TABLE platform_private.company_file_upload_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.company_file_upload_reservations FORCE ROW LEVEL SECURITY;
ALTER TABLE platform_private.company_file_storage_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.company_file_storage_bindings FORCE ROW LEVEL SECURITY;
ALTER TABLE platform_private.company_file_upload_finalizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.company_file_upload_finalizations FORCE ROW LEVEL SECURITY;
ALTER TABLE platform_private.company_file_download_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.company_file_download_grants FORCE ROW LEVEL SECURITY;
ALTER TABLE platform_private.company_file_download_consumptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.company_file_download_consumptions FORCE ROW LEVEL SECURITY;

CREATE TRIGGER company_file_versions_append_only_rows
  BEFORE UPDATE OR DELETE ON platform.company_file_versions
  FOR EACH ROW EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER company_file_versions_no_truncate
  BEFORE TRUNCATE ON platform.company_file_versions
  FOR EACH STATEMENT EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER company_file_command_receipts_append_only_rows
  BEFORE UPDATE OR DELETE ON platform_private.company_file_command_receipts
  FOR EACH ROW EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER company_file_command_receipts_no_truncate
  BEFORE TRUNCATE ON platform_private.company_file_command_receipts
  FOR EACH STATEMENT EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER company_file_upload_reservations_append_only_rows
  BEFORE UPDATE OR DELETE ON platform_private.company_file_upload_reservations
  FOR EACH ROW EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER company_file_upload_reservations_no_truncate
  BEFORE TRUNCATE ON platform_private.company_file_upload_reservations
  FOR EACH STATEMENT EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER company_file_storage_bindings_append_only_rows
  BEFORE UPDATE OR DELETE ON platform_private.company_file_storage_bindings
  FOR EACH ROW EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER company_file_storage_bindings_no_truncate
  BEFORE TRUNCATE ON platform_private.company_file_storage_bindings
  FOR EACH STATEMENT EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER company_file_upload_finalizations_append_only_rows
  BEFORE UPDATE OR DELETE ON platform_private.company_file_upload_finalizations
  FOR EACH ROW EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER company_file_upload_finalizations_no_truncate
  BEFORE TRUNCATE ON platform_private.company_file_upload_finalizations
  FOR EACH STATEMENT EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER company_file_download_grants_append_only_rows
  BEFORE UPDATE OR DELETE ON platform_private.company_file_download_grants
  FOR EACH ROW EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER company_file_download_grants_no_truncate
  BEFORE TRUNCATE ON platform_private.company_file_download_grants
  FOR EACH STATEMENT EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER company_file_download_consumptions_append_only_rows
  BEFORE UPDATE OR DELETE ON platform_private.company_file_download_consumptions
  FOR EACH ROW EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER company_file_download_consumptions_no_truncate
  BEFORE TRUNCATE ON platform_private.company_file_download_consumptions
  FOR EACH STATEMENT EXECUTE FUNCTION platform_private.block_append_only_mutation();

REVOKE ALL PRIVILEGES ON platform.company_file_folders
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL PRIVILEGES ON platform.company_files
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL PRIVILEGES ON platform.company_file_versions
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL PRIVILEGES ON platform_private.company_file_command_receipts
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL PRIVILEGES ON platform_private.company_file_upload_reservations
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL PRIVILEGES ON platform_private.company_file_storage_bindings
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL PRIVILEGES ON platform_private.company_file_upload_finalizations
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL PRIVILEGES ON platform_private.company_file_download_grants
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL PRIVILEGES ON platform_private.company_file_download_consumptions
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

CREATE OR REPLACE FUNCTION platform_private.lock_company_file_request(
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
    RAISE EXCEPTION 'request_id is required' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_request_id::TEXT, 599)
  );
END
$$;

REVOKE ALL ON FUNCTION platform_private.lock_company_file_request(UUID)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

CREATE OR REPLACE FUNCTION platform_private.require_company_file_actor(
  p_organization_id UUID,
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
BEGIN
  IF p_organization_id IS NULL
    OR p_permission_key NOT IN ('document.upload', 'document.download')
  THEN
    RAISE EXCEPTION 'Company files are unavailable' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO actor
  FROM platform_private.require_domain_actor(
    p_organization_id,
    p_permission_key
  );

  IF actor.actor_role NOT IN ('admin', 'curator') THEN
    RAISE EXCEPTION 'Company files are unavailable' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    actor.actor_profile_id,
    actor.actor_membership_id,
    actor.actor_auth_user_id,
    actor.actor_role;
END
$$;

REVOKE ALL ON FUNCTION
  platform_private.require_company_file_actor(UUID, TEXT)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

CREATE OR REPLACE FUNCTION platform.staff_company_file_workspace(
  p_organization_id UUID
)
RETURNS TABLE (
  item_kind TEXT,
  item_id UUID,
  parent_folder_id UUID,
  display_name TEXT,
  entity_version TEXT,
  archived_at TIMESTAMPTZ,
  current_version_id UUID,
  current_version_no TEXT,
  original_filename TEXT,
  declared_mime_type TEXT,
  byte_size BIGINT,
  sha256_hex TEXT,
  finalized_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_organization_id IS NULL
    OR (SELECT auth.uid()) IS NULL
    OR (SELECT auth.jwt() ->> 'platform_role') NOT IN ('admin', 'curator')
    OR NOT private.platform_has_permission(
      p_organization_id,
      'document.download'
    )
  THEN
    RAISE EXCEPTION 'Company files are unavailable' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    'folder'::TEXT,
    folder.id,
    folder.parent_folder_id,
    folder.name,
    folder.version::TEXT,
    folder.archived_at,
    NULL::UUID,
    NULL::TEXT,
    NULL::TEXT,
    NULL::TEXT,
    NULL::BIGINT,
    NULL::TEXT,
    NULL::TIMESTAMPTZ,
    folder.updated_at
  FROM platform.company_file_folders AS folder
  WHERE folder.organization_id = p_organization_id
    AND folder.archived_at IS NULL

  UNION ALL

  SELECT
    'file'::TEXT,
    company_file.id,
    company_file.folder_id,
    company_file.display_name,
    company_file.version::TEXT,
    company_file.archived_at,
    company_file.current_version_id,
    file_version.version_no::TEXT,
    file_version.original_filename,
    file_version.declared_mime_type,
    file_version.byte_size,
    file_version.sha256_hex,
    finalization.finalized_at,
    company_file.updated_at
  FROM platform.company_files AS company_file
  LEFT JOIN platform.company_file_versions AS file_version
    ON file_version.organization_id = company_file.organization_id
    AND file_version.id = company_file.current_version_id
    AND file_version.company_file_id = company_file.id
  LEFT JOIN platform_private.company_file_upload_finalizations AS finalization
    ON finalization.organization_id = file_version.organization_id
    AND finalization.company_file_version_id = file_version.id
  WHERE company_file.organization_id = p_organization_id
    AND company_file.archived_at IS NULL;
END
$$;

CREATE OR REPLACE FUNCTION platform.create_company_file_folder(
  p_organization_id UUID,
  p_parent_folder_id UUID,
  p_name TEXT,
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
  parent_row platform.company_file_folders%ROWTYPE;
  receipt platform_private.company_file_command_receipts%ROWTYPE;
  folder_row platform.company_file_folders%ROWTYPE;
  normalized_name TEXT := btrim(p_name);
  command_input JSONB;
  result JSONB;
BEGIN
  SELECT * INTO actor
  FROM platform_private.require_company_file_actor(
    p_organization_id,
    'document.upload'
  );

  IF p_request_id IS NULL
    OR p_name IS NULL
    OR char_length(normalized_name) NOT BETWEEN 1 AND 255
    OR octet_length(normalized_name) > 1024
    OR normalized_name ~ '[[:cntrl:]]'
  THEN
    RAISE EXCEPTION 'Valid company folder metadata is required'
      USING ERRCODE = '22023';
  END IF;

  PERFORM platform_private.lock_company_file_request(p_request_id);
  command_input := jsonb_build_object(
    'parent_folder_id', p_parent_folder_id,
    'name', normalized_name
  );

  SELECT * INTO receipt
  FROM platform_private.company_file_command_receipts AS candidate
  WHERE candidate.request_id = p_request_id;

  IF FOUND THEN
    IF receipt.organization_id IS DISTINCT FROM p_organization_id
      OR receipt.actor_kind <> 'user'
      OR receipt.actor_profile_id IS DISTINCT FROM actor.actor_profile_id
      OR receipt.actor_membership_id IS DISTINCT FROM actor.actor_membership_id
      OR receipt.action <> 'company.file.folder.create'
      OR receipt.input IS DISTINCT FROM command_input
    THEN
      RAISE EXCEPTION 'request_id was already used with different inputs'
        USING ERRCODE = '23505';
    END IF;
    RETURN receipt.result;
  END IF;

  IF p_parent_folder_id IS NOT NULL THEN
    SELECT * INTO parent_row
    FROM platform.company_file_folders AS folder
    WHERE folder.organization_id = p_organization_id
      AND folder.id = p_parent_folder_id
      AND folder.archived_at IS NULL
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Company folder is unavailable' USING ERRCODE = '42501';
    END IF;
  END IF;

  INSERT INTO platform.company_file_folders (
    organization_id,
    parent_folder_id,
    name,
    created_by_membership_id,
    updated_by_membership_id
  )
  VALUES (
    p_organization_id,
    p_parent_folder_id,
    normalized_name,
    actor.actor_membership_id,
    actor.actor_membership_id
  )
  RETURNING * INTO folder_row;

  result := jsonb_build_object(
    'organization_id', folder_row.organization_id,
    'folder_id', folder_row.id,
    'parent_folder_id', folder_row.parent_folder_id,
    'name', folder_row.name,
    'version', folder_row.version::TEXT,
    'archived_at', folder_row.archived_at,
    'created_at', folder_row.created_at,
    'updated_at', folder_row.updated_at
  );

  INSERT INTO platform.audit_events (
    organization_id, actor_kind, actor_profile_id, actor_principal,
    action, resource_type, resource_id, before_state, after_state,
    reason, request_id
  ) VALUES (
    p_organization_id, 'user', actor.actor_profile_id,
    actor.actor_auth_user_id::TEXT, 'company.file.folder.create',
    'company_file_folder', folder_row.id, NULL, result,
    'Company knowledge folder created', p_request_id
  );

  INSERT INTO platform_private.company_file_command_receipts (
    request_id, organization_id, actor_kind, actor_profile_id,
    actor_membership_id, actor_principal, action, resource_id, input, result
  ) VALUES (
    p_request_id, p_organization_id, 'user', actor.actor_profile_id,
    actor.actor_membership_id, actor.actor_auth_user_id::TEXT,
    'company.file.folder.create', folder_row.id, command_input, result
  );

  RETURN result;
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'An active company folder already uses this name'
      USING ERRCODE = '23505';
END
$$;

CREATE OR REPLACE FUNCTION platform_private.mutate_company_file_folder(
  p_organization_id UUID,
  p_folder_id UUID,
  p_expected_version BIGINT,
  p_name TEXT,
  p_new_parent_folder_id UUID,
  p_action TEXT,
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
  folder_row platform.company_file_folders%ROWTYPE;
  parent_row platform.company_file_folders%ROWTYPE;
  receipt platform_private.company_file_command_receipts%ROWTYPE;
  normalized_name TEXT;
  before_state JSONB;
  command_input JSONB;
  result JSONB;
  audit_action TEXT;
BEGIN
  SELECT * INTO actor
  FROM platform_private.require_company_file_actor(
    p_organization_id,
    'document.upload'
  );

  IF p_folder_id IS NULL
    OR p_expected_version IS NULL
    OR p_expected_version <= 0
    OR p_request_id IS NULL
    OR p_action NOT IN ('rename', 'move', 'archive')
  THEN
    RAISE EXCEPTION 'Valid company folder command is required'
      USING ERRCODE = '22023';
  END IF;

  IF p_action = 'rename' THEN
    normalized_name := btrim(p_name);
    IF p_name IS NULL
      OR char_length(normalized_name) NOT BETWEEN 1 AND 255
      OR octet_length(normalized_name) > 1024
      OR normalized_name ~ '[[:cntrl:]]'
    THEN
      RAISE EXCEPTION 'Valid company folder name is required'
        USING ERRCODE = '22023';
    END IF;
    command_input := jsonb_build_object(
      'folder_id', p_folder_id,
      'expected_version', p_expected_version::TEXT,
      'name', normalized_name
    );
  ELSIF p_action = 'move' THEN
    command_input := jsonb_build_object(
      'folder_id', p_folder_id,
      'expected_version', p_expected_version::TEXT,
      'new_parent_folder_id', p_new_parent_folder_id
    );
  ELSE
    command_input := jsonb_build_object(
      'folder_id', p_folder_id,
      'expected_version', p_expected_version::TEXT
    );
  END IF;

  audit_action := 'company.file.folder.' || p_action;
  PERFORM platform_private.lock_company_file_request(p_request_id);

  SELECT * INTO receipt
  FROM platform_private.company_file_command_receipts AS candidate
  WHERE candidate.request_id = p_request_id;

  IF FOUND THEN
    IF receipt.organization_id IS DISTINCT FROM p_organization_id
      OR receipt.actor_kind <> 'user'
      OR receipt.actor_profile_id IS DISTINCT FROM actor.actor_profile_id
      OR receipt.actor_membership_id IS DISTINCT FROM actor.actor_membership_id
      OR receipt.action <> audit_action
      OR receipt.input IS DISTINCT FROM command_input
    THEN
      RAISE EXCEPTION 'request_id was already used with different inputs'
        USING ERRCODE = '23505';
    END IF;
    RETURN receipt.result;
  END IF;

  SELECT * INTO folder_row
  FROM platform.company_file_folders AS folder
  WHERE folder.organization_id = p_organization_id
    AND folder.id = p_folder_id
    AND folder.archived_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Company folder is unavailable' USING ERRCODE = '42501';
  END IF;
  IF folder_row.version <> p_expected_version THEN
    RAISE EXCEPTION 'Company folder changed; refresh and retry'
      USING ERRCODE = '40001';
  END IF;

  before_state := jsonb_build_object(
    'organization_id', folder_row.organization_id,
    'folder_id', folder_row.id,
    'parent_folder_id', folder_row.parent_folder_id,
    'name', folder_row.name,
    'version', folder_row.version::TEXT,
    'archived_at', folder_row.archived_at,
    'created_at', folder_row.created_at,
    'updated_at', folder_row.updated_at
  );

  IF p_action = 'rename' THEN
    UPDATE platform.company_file_folders
    SET
      name = normalized_name,
      version = version + 1,
      updated_by_membership_id = actor.actor_membership_id,
      updated_at = statement_timestamp()
    WHERE organization_id = p_organization_id
      AND id = p_folder_id
    RETURNING * INTO folder_row;
  ELSIF p_action = 'move' THEN
    IF p_new_parent_folder_id = p_folder_id THEN
      RAISE EXCEPTION 'A company folder cannot contain itself'
        USING ERRCODE = '22023';
    END IF;

    IF p_new_parent_folder_id IS NOT NULL THEN
      SELECT * INTO parent_row
      FROM platform.company_file_folders AS folder
      WHERE folder.organization_id = p_organization_id
        AND folder.id = p_new_parent_folder_id
        AND folder.archived_at IS NULL
      FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Company folder is unavailable' USING ERRCODE = '42501';
      END IF;

      IF EXISTS (
        WITH RECURSIVE descendants AS (
          SELECT child.id
          FROM platform.company_file_folders AS child
          WHERE child.organization_id = p_organization_id
            AND child.parent_folder_id = p_folder_id
            AND child.archived_at IS NULL
          UNION ALL
          SELECT child.id
          FROM platform.company_file_folders AS child
          JOIN descendants AS parent ON parent.id = child.parent_folder_id
          WHERE child.organization_id = p_organization_id
            AND child.archived_at IS NULL
        )
        SELECT 1 FROM descendants WHERE id = p_new_parent_folder_id
      ) THEN
        RAISE EXCEPTION 'A company folder cannot move into its descendant'
          USING ERRCODE = '22023';
      END IF;
    END IF;

    UPDATE platform.company_file_folders
    SET
      parent_folder_id = p_new_parent_folder_id,
      version = version + 1,
      updated_by_membership_id = actor.actor_membership_id,
      updated_at = statement_timestamp()
    WHERE organization_id = p_organization_id
      AND id = p_folder_id
    RETURNING * INTO folder_row;
  ELSE
    IF EXISTS (
      SELECT 1
      FROM platform.company_file_folders AS child
      WHERE child.organization_id = p_organization_id
        AND child.parent_folder_id = p_folder_id
        AND child.archived_at IS NULL
    ) OR EXISTS (
      SELECT 1
      FROM platform.company_files AS company_file
      WHERE company_file.organization_id = p_organization_id
        AND company_file.folder_id = p_folder_id
        AND company_file.archived_at IS NULL
    ) THEN
      RAISE EXCEPTION 'Only an empty company folder can be archived'
        USING ERRCODE = 'PT409';
    END IF;

    UPDATE platform.company_file_folders
    SET
      archived_at = statement_timestamp(),
      version = version + 1,
      updated_by_membership_id = actor.actor_membership_id,
      updated_at = statement_timestamp()
    WHERE organization_id = p_organization_id
      AND id = p_folder_id
    RETURNING * INTO folder_row;
  END IF;

  result := jsonb_build_object(
    'organization_id', folder_row.organization_id,
    'folder_id', folder_row.id,
    'parent_folder_id', folder_row.parent_folder_id,
    'name', folder_row.name,
    'version', folder_row.version::TEXT,
    'archived_at', folder_row.archived_at,
    'created_at', folder_row.created_at,
    'updated_at', folder_row.updated_at
  );

  INSERT INTO platform.audit_events (
    organization_id, actor_kind, actor_profile_id, actor_principal,
    action, resource_type, resource_id, before_state, after_state,
    reason, request_id
  ) VALUES (
    p_organization_id, 'user', actor.actor_profile_id,
    actor.actor_auth_user_id::TEXT, audit_action, 'company_file_folder',
    folder_row.id, before_state, result,
    'Company knowledge folder changed', p_request_id
  );

  INSERT INTO platform_private.company_file_command_receipts (
    request_id, organization_id, actor_kind, actor_profile_id,
    actor_membership_id, actor_principal, action, resource_id, input, result
  ) VALUES (
    p_request_id, p_organization_id, 'user', actor.actor_profile_id,
    actor.actor_membership_id, actor.actor_auth_user_id::TEXT,
    audit_action, folder_row.id, command_input, result
  );

  RETURN result;
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'An active company folder already uses this name'
      USING ERRCODE = '23505';
END
$$;

REVOKE ALL ON FUNCTION platform_private.mutate_company_file_folder(
  UUID, UUID, BIGINT, TEXT, UUID, TEXT, UUID
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

CREATE OR REPLACE FUNCTION platform.rename_company_file_folder(
  p_organization_id UUID,
  p_folder_id UUID,
  p_expected_version BIGINT,
  p_name TEXT,
  p_request_id UUID
)
RETURNS JSONB
LANGUAGE SQL
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT platform_private.mutate_company_file_folder(
    p_organization_id, p_folder_id, p_expected_version, p_name,
    NULL, 'rename', p_request_id
  )
$$;

CREATE OR REPLACE FUNCTION platform.move_company_file_folder(
  p_organization_id UUID,
  p_folder_id UUID,
  p_expected_version BIGINT,
  p_new_parent_folder_id UUID,
  p_request_id UUID
)
RETURNS JSONB
LANGUAGE SQL
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT platform_private.mutate_company_file_folder(
    p_organization_id, p_folder_id, p_expected_version, NULL,
    p_new_parent_folder_id, 'move', p_request_id
  )
$$;

CREATE OR REPLACE FUNCTION platform.archive_company_file_folder(
  p_organization_id UUID,
  p_folder_id UUID,
  p_expected_version BIGINT,
  p_request_id UUID
)
RETURNS JSONB
LANGUAGE SQL
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT platform_private.mutate_company_file_folder(
    p_organization_id, p_folder_id, p_expected_version, NULL,
    NULL, 'archive', p_request_id
  )
$$;

CREATE OR REPLACE FUNCTION platform.create_company_file(
  p_organization_id UUID,
  p_folder_id UUID,
  p_display_name TEXT,
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
  folder_row platform.company_file_folders%ROWTYPE;
  receipt platform_private.company_file_command_receipts%ROWTYPE;
  file_row platform.company_files%ROWTYPE;
  normalized_name TEXT := btrim(p_display_name);
  command_input JSONB;
  result JSONB;
BEGIN
  SELECT * INTO actor
  FROM platform_private.require_company_file_actor(
    p_organization_id,
    'document.upload'
  );

  IF p_request_id IS NULL
    OR p_display_name IS NULL
    OR char_length(normalized_name) NOT BETWEEN 1 AND 255
    OR octet_length(normalized_name) > 1024
    OR normalized_name ~ '[[:cntrl:]]'
  THEN
    RAISE EXCEPTION 'Valid company file metadata is required'
      USING ERRCODE = '22023';
  END IF;

  PERFORM platform_private.lock_company_file_request(p_request_id);
  command_input := jsonb_build_object(
    'folder_id', p_folder_id,
    'display_name', normalized_name
  );

  SELECT * INTO receipt
  FROM platform_private.company_file_command_receipts AS candidate
  WHERE candidate.request_id = p_request_id;

  IF FOUND THEN
    IF receipt.organization_id IS DISTINCT FROM p_organization_id
      OR receipt.actor_kind <> 'user'
      OR receipt.actor_profile_id IS DISTINCT FROM actor.actor_profile_id
      OR receipt.actor_membership_id IS DISTINCT FROM actor.actor_membership_id
      OR receipt.action <> 'company.file.file.create'
      OR receipt.input IS DISTINCT FROM command_input
    THEN
      RAISE EXCEPTION 'request_id was already used with different inputs'
        USING ERRCODE = '23505';
    END IF;
    RETURN receipt.result;
  END IF;

  IF p_folder_id IS NOT NULL THEN
    SELECT * INTO folder_row
    FROM platform.company_file_folders AS folder
    WHERE folder.organization_id = p_organization_id
      AND folder.id = p_folder_id
      AND folder.archived_at IS NULL
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Company folder is unavailable' USING ERRCODE = '42501';
    END IF;
  END IF;

  INSERT INTO platform.company_files (
    organization_id,
    folder_id,
    display_name,
    created_by_membership_id,
    updated_by_membership_id
  ) VALUES (
    p_organization_id,
    p_folder_id,
    normalized_name,
    actor.actor_membership_id,
    actor.actor_membership_id
  )
  RETURNING * INTO file_row;

  result := jsonb_build_object(
    'organization_id', file_row.organization_id,
    'company_file_id', file_row.id,
    'folder_id', file_row.folder_id,
    'display_name', file_row.display_name,
    'current_version_id', file_row.current_version_id,
    'version', file_row.version::TEXT,
    'archived_at', file_row.archived_at,
    'created_at', file_row.created_at,
    'updated_at', file_row.updated_at
  );

  INSERT INTO platform.audit_events (
    organization_id, actor_kind, actor_profile_id, actor_principal,
    action, resource_type, resource_id, before_state, after_state,
    reason, request_id
  ) VALUES (
    p_organization_id, 'user', actor.actor_profile_id,
    actor.actor_auth_user_id::TEXT, 'company.file.file.create',
    'company_file', file_row.id, NULL, result,
    'Company knowledge file created', p_request_id
  );

  INSERT INTO platform_private.company_file_command_receipts (
    request_id, organization_id, actor_kind, actor_profile_id,
    actor_membership_id, actor_principal, action, resource_id, input, result
  ) VALUES (
    p_request_id, p_organization_id, 'user', actor.actor_profile_id,
    actor.actor_membership_id, actor.actor_auth_user_id::TEXT,
    'company.file.file.create', file_row.id, command_input, result
  );

  RETURN result;
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'An active company file already uses this name'
      USING ERRCODE = '23505';
END
$$;

CREATE OR REPLACE FUNCTION platform_private.mutate_company_file(
  p_organization_id UUID,
  p_company_file_id UUID,
  p_expected_version BIGINT,
  p_display_name TEXT,
  p_new_folder_id UUID,
  p_action TEXT,
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
  file_row platform.company_files%ROWTYPE;
  folder_row platform.company_file_folders%ROWTYPE;
  receipt platform_private.company_file_command_receipts%ROWTYPE;
  normalized_name TEXT;
  before_state JSONB;
  command_input JSONB;
  result JSONB;
  audit_action TEXT;
BEGIN
  SELECT * INTO actor
  FROM platform_private.require_company_file_actor(
    p_organization_id,
    'document.upload'
  );

  IF p_company_file_id IS NULL
    OR p_expected_version IS NULL
    OR p_expected_version <= 0
    OR p_request_id IS NULL
    OR p_action NOT IN ('rename', 'move', 'archive')
  THEN
    RAISE EXCEPTION 'Valid company file command is required'
      USING ERRCODE = '22023';
  END IF;

  IF p_action = 'rename' THEN
    normalized_name := btrim(p_display_name);
    IF p_display_name IS NULL
      OR char_length(normalized_name) NOT BETWEEN 1 AND 255
      OR octet_length(normalized_name) > 1024
      OR normalized_name ~ '[[:cntrl:]]'
    THEN
      RAISE EXCEPTION 'Valid company file name is required'
        USING ERRCODE = '22023';
    END IF;
    command_input := jsonb_build_object(
      'company_file_id', p_company_file_id,
      'expected_version', p_expected_version::TEXT,
      'display_name', normalized_name
    );
  ELSIF p_action = 'move' THEN
    command_input := jsonb_build_object(
      'company_file_id', p_company_file_id,
      'expected_version', p_expected_version::TEXT,
      'new_folder_id', p_new_folder_id
    );
  ELSE
    command_input := jsonb_build_object(
      'company_file_id', p_company_file_id,
      'expected_version', p_expected_version::TEXT
    );
  END IF;

  audit_action := 'company.file.file.' || p_action;
  PERFORM platform_private.lock_company_file_request(p_request_id);

  SELECT * INTO receipt
  FROM platform_private.company_file_command_receipts AS candidate
  WHERE candidate.request_id = p_request_id;

  IF FOUND THEN
    IF receipt.organization_id IS DISTINCT FROM p_organization_id
      OR receipt.actor_kind <> 'user'
      OR receipt.actor_profile_id IS DISTINCT FROM actor.actor_profile_id
      OR receipt.actor_membership_id IS DISTINCT FROM actor.actor_membership_id
      OR receipt.action <> audit_action
      OR receipt.input IS DISTINCT FROM command_input
    THEN
      RAISE EXCEPTION 'request_id was already used with different inputs'
        USING ERRCODE = '23505';
    END IF;
    RETURN receipt.result;
  END IF;

  SELECT * INTO file_row
  FROM platform.company_files AS company_file
  WHERE company_file.organization_id = p_organization_id
    AND company_file.id = p_company_file_id
    AND company_file.archived_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Company file is unavailable' USING ERRCODE = '42501';
  END IF;
  IF file_row.version <> p_expected_version THEN
    RAISE EXCEPTION 'Company file changed; refresh and retry'
      USING ERRCODE = '40001';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM platform_private.company_file_upload_reservations AS reservation
    WHERE reservation.organization_id = p_organization_id
      AND reservation.company_file_id = p_company_file_id
      AND reservation.expires_at > statement_timestamp()
      AND NOT EXISTS (
        SELECT 1
        FROM platform_private.company_file_upload_finalizations AS finalization
        WHERE finalization.upload_reservation_id = reservation.id
      )
  ) THEN
    RAISE EXCEPTION 'A company file upload is already in progress'
      USING ERRCODE = 'PT409';
  END IF;

  before_state := jsonb_build_object(
    'organization_id', file_row.organization_id,
    'company_file_id', file_row.id,
    'folder_id', file_row.folder_id,
    'display_name', file_row.display_name,
    'current_version_id', file_row.current_version_id,
    'version', file_row.version::TEXT,
    'archived_at', file_row.archived_at,
    'created_at', file_row.created_at,
    'updated_at', file_row.updated_at
  );

  IF p_action = 'rename' THEN
    UPDATE platform.company_files
    SET
      display_name = normalized_name,
      version = version + 1,
      updated_by_membership_id = actor.actor_membership_id,
      updated_at = statement_timestamp()
    WHERE organization_id = p_organization_id
      AND id = p_company_file_id
    RETURNING * INTO file_row;
  ELSIF p_action = 'move' THEN
    IF p_new_folder_id IS NOT NULL THEN
      SELECT * INTO folder_row
      FROM platform.company_file_folders AS folder
      WHERE folder.organization_id = p_organization_id
        AND folder.id = p_new_folder_id
        AND folder.archived_at IS NULL
      FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Company folder is unavailable' USING ERRCODE = '42501';
      END IF;
    END IF;

    UPDATE platform.company_files
    SET
      folder_id = p_new_folder_id,
      version = version + 1,
      updated_by_membership_id = actor.actor_membership_id,
      updated_at = statement_timestamp()
    WHERE organization_id = p_organization_id
      AND id = p_company_file_id
    RETURNING * INTO file_row;
  ELSE
    UPDATE platform.company_files
    SET
      archived_at = statement_timestamp(),
      version = version + 1,
      updated_by_membership_id = actor.actor_membership_id,
      updated_at = statement_timestamp()
    WHERE organization_id = p_organization_id
      AND id = p_company_file_id
    RETURNING * INTO file_row;
  END IF;

  result := jsonb_build_object(
    'organization_id', file_row.organization_id,
    'company_file_id', file_row.id,
    'folder_id', file_row.folder_id,
    'display_name', file_row.display_name,
    'current_version_id', file_row.current_version_id,
    'version', file_row.version::TEXT,
    'archived_at', file_row.archived_at,
    'created_at', file_row.created_at,
    'updated_at', file_row.updated_at
  );

  INSERT INTO platform.audit_events (
    organization_id, actor_kind, actor_profile_id, actor_principal,
    action, resource_type, resource_id, before_state, after_state,
    reason, request_id
  ) VALUES (
    p_organization_id, 'user', actor.actor_profile_id,
    actor.actor_auth_user_id::TEXT, audit_action, 'company_file',
    file_row.id, before_state, result,
    'Company knowledge file changed', p_request_id
  );

  INSERT INTO platform_private.company_file_command_receipts (
    request_id, organization_id, actor_kind, actor_profile_id,
    actor_membership_id, actor_principal, action, resource_id, input, result
  ) VALUES (
    p_request_id, p_organization_id, 'user', actor.actor_profile_id,
    actor.actor_membership_id, actor.actor_auth_user_id::TEXT,
    audit_action, file_row.id, command_input, result
  );

  RETURN result;
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'An active company file already uses this name'
      USING ERRCODE = '23505';
END
$$;

REVOKE ALL ON FUNCTION platform_private.mutate_company_file(
  UUID, UUID, BIGINT, TEXT, UUID, TEXT, UUID
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

CREATE OR REPLACE FUNCTION platform.rename_company_file(
  p_organization_id UUID,
  p_company_file_id UUID,
  p_expected_version BIGINT,
  p_display_name TEXT,
  p_request_id UUID
)
RETURNS JSONB
LANGUAGE SQL
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT platform_private.mutate_company_file(
    p_organization_id, p_company_file_id, p_expected_version,
    p_display_name, NULL, 'rename', p_request_id
  )
$$;

CREATE OR REPLACE FUNCTION platform.move_company_file(
  p_organization_id UUID,
  p_company_file_id UUID,
  p_expected_version BIGINT,
  p_new_folder_id UUID,
  p_request_id UUID
)
RETURNS JSONB
LANGUAGE SQL
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT platform_private.mutate_company_file(
    p_organization_id, p_company_file_id, p_expected_version,
    NULL, p_new_folder_id, 'move', p_request_id
  )
$$;

CREATE OR REPLACE FUNCTION platform.archive_company_file(
  p_organization_id UUID,
  p_company_file_id UUID,
  p_expected_version BIGINT,
  p_request_id UUID
)
RETURNS JSONB
LANGUAGE SQL
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT platform_private.mutate_company_file(
    p_organization_id, p_company_file_id, p_expected_version,
    NULL, NULL, 'archive', p_request_id
  )
$$;

CREATE OR REPLACE FUNCTION platform.reserve_company_file_upload(
  p_organization_id UUID,
  p_company_file_id UUID,
  p_expected_file_version BIGINT,
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
  actor RECORD;
  file_row platform.company_files%ROWTYPE;
  receipt platform_private.company_file_command_receipts%ROWTYPE;
  replay_reservation platform_private.company_file_upload_reservations%ROWTYPE;
  version_id UUID := gen_random_uuid();
  reservation_id UUID := gen_random_uuid();
  binding_id UUID := gen_random_uuid();
  object_token TEXT := replace(gen_random_uuid()::TEXT, '-', '')
    || replace(gen_random_uuid()::TEXT, '-', '');
  object_name TEXT;
  version_no BIGINT;
  normalized_filename TEXT := btrim(p_original_filename);
  normalized_mime TEXT := lower(btrim(p_declared_mime_type));
  normalized_sha256 TEXT := lower(btrim(p_sha256_hex));
  reserved_at TIMESTAMPTZ := statement_timestamp();
  expires_at TIMESTAMPTZ;
  command_input JSONB;
  result JSONB;
BEGIN
  SELECT * INTO actor
  FROM platform_private.require_company_file_actor(
    p_organization_id,
    'document.upload'
  );

  IF p_company_file_id IS NULL
    OR p_expected_file_version IS NULL
    OR p_expected_file_version <= 0
    OR p_request_id IS NULL
    OR p_original_filename IS NULL
    OR char_length(normalized_filename) NOT BETWEEN 1 AND 255
    OR octet_length(normalized_filename) > 1024
    OR normalized_filename ~ '[[:cntrl:]]'
    OR normalized_mime NOT IN (
      'application/pdf',
      'image/jpeg',
      'image/png',
      'text/plain',
      'text/csv',
      'application/msword',
      'application/vnd.ms-excel',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    )
    OR p_byte_size IS NULL
    OR p_byte_size NOT BETWEEN 1 AND 26214400
    OR normalized_sha256 !~ '^[0-9a-f]{64}$'
  THEN
    RAISE EXCEPTION 'Valid private company file upload metadata is required'
      USING ERRCODE = '22023';
  END IF;

  PERFORM platform_private.lock_company_file_request(p_request_id);
  command_input := jsonb_build_object(
    'company_file_id', p_company_file_id,
    'expected_file_version', p_expected_file_version::TEXT,
    'original_filename', normalized_filename,
    'declared_mime_type', normalized_mime,
    'byte_size', p_byte_size::TEXT,
    'sha256_hex', normalized_sha256
  );

  SELECT * INTO receipt
  FROM platform_private.company_file_command_receipts AS candidate
  WHERE candidate.request_id = p_request_id;

  IF FOUND THEN
    IF receipt.organization_id IS DISTINCT FROM p_organization_id
      OR receipt.actor_kind <> 'user'
      OR receipt.actor_profile_id IS DISTINCT FROM actor.actor_profile_id
      OR receipt.actor_membership_id IS DISTINCT FROM actor.actor_membership_id
      OR receipt.action <> 'company.file.upload.reserve'
      OR receipt.input IS DISTINCT FROM command_input
    THEN
      RAISE EXCEPTION 'request_id was already used with different inputs'
        USING ERRCODE = '23505';
    END IF;
    SELECT * INTO STRICT replay_reservation
    FROM platform_private.company_file_upload_reservations AS candidate
    WHERE candidate.request_id = p_request_id
      AND candidate.organization_id = p_organization_id
      AND candidate.company_file_id = p_company_file_id
      AND candidate.company_file_version_id = receipt.resource_id
      AND candidate.uploader_profile_id = actor.actor_profile_id
      AND candidate.uploader_membership_id = actor.actor_membership_id;

    RETURN receipt.result || jsonb_build_object(
      'storage_object_present', EXISTS (
        SELECT 1
        FROM storage.objects AS object
        WHERE object.bucket_id = replay_reservation.bucket_id
          AND object.name = replay_reservation.object_name
      ),
      'file_version_published', EXISTS (
        SELECT 1
        FROM platform_private.company_file_upload_finalizations AS finalization
        WHERE finalization.upload_reservation_id = replay_reservation.id
      )
    );
  END IF;

  SELECT * INTO file_row
  FROM platform.company_files AS company_file
  WHERE company_file.organization_id = p_organization_id
    AND company_file.id = p_company_file_id
    AND company_file.archived_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Company file is unavailable' USING ERRCODE = '42501';
  END IF;
  IF file_row.version <> p_expected_file_version THEN
    RAISE EXCEPTION 'Company file changed; refresh and retry'
      USING ERRCODE = '40001';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM platform_private.company_file_upload_reservations AS reservation
    WHERE reservation.organization_id = p_organization_id
      AND reservation.company_file_id = p_company_file_id
      AND reservation.expires_at > reserved_at
      AND NOT EXISTS (
        SELECT 1
        FROM platform_private.company_file_upload_finalizations AS finalization
        WHERE finalization.upload_reservation_id = reservation.id
      )
  ) THEN
    RAISE EXCEPTION 'A company file upload is already in progress'
      USING ERRCODE = 'PT409';
  END IF;

  SELECT COALESCE(max(candidate.version_no), 0) + 1
  INTO version_no
  FROM platform.company_file_versions AS candidate
  WHERE candidate.organization_id = p_organization_id
    AND candidate.company_file_id = p_company_file_id;

  object_name := substring(object_token FROM 1 FOR 2)
    || '/' || substring(object_token FROM 3);
  expires_at := reserved_at + INTERVAL '10 minutes';

  INSERT INTO platform.company_file_versions (
    id, organization_id, company_file_id, version_no, original_filename,
    declared_mime_type, byte_size, sha256_hex,
    submitted_by_membership_id, submitted_by_profile_id, created_at
  ) VALUES (
    version_id, p_organization_id, p_company_file_id, version_no,
    normalized_filename, normalized_mime, p_byte_size, normalized_sha256,
    actor.actor_membership_id, actor.actor_profile_id, reserved_at
  );

  INSERT INTO platform_private.company_file_upload_reservations (
    id, request_id, organization_id, company_file_id,
    company_file_version_id, expected_file_version, uploader_profile_id,
    uploader_membership_id, uploader_auth_user_id, bucket_id, object_name,
    declared_mime_type, byte_size, sha256_hex, expires_at, created_at
  ) VALUES (
    reservation_id, p_request_id, p_organization_id, p_company_file_id,
    version_id, p_expected_file_version, actor.actor_profile_id,
    actor.actor_membership_id, actor.actor_auth_user_id,
    'platform-company-files', object_name, normalized_mime, p_byte_size,
    normalized_sha256, expires_at, reserved_at
  );

  INSERT INTO platform_private.company_file_storage_bindings (
    id, organization_id, company_file_id, company_file_version_id,
    upload_reservation_id, bucket_id, object_name, expected_byte_size,
    expected_sha256_hex, created_at
  ) VALUES (
    binding_id, p_organization_id, p_company_file_id, version_id,
    reservation_id, 'platform-company-files', object_name, p_byte_size,
    normalized_sha256, reserved_at
  );

  result := jsonb_build_object(
    'organization_id', p_organization_id,
    'company_file_id', p_company_file_id,
    'company_file_version_id', version_id,
    'version_no', version_no::TEXT,
    'upload_reservation_id', reservation_id,
    'bucket_id', 'platform-company-files',
    'object_name', object_name,
    'expires_at', expires_at,
    'declared_mime_type', normalized_mime,
    'byte_size', p_byte_size,
    'sha256_hex', normalized_sha256,
    'storage_object_present', FALSE,
    'file_version_published', FALSE
  );

  INSERT INTO platform.audit_events (
    organization_id, actor_kind, actor_profile_id, actor_principal,
    action, resource_type, resource_id, before_state, after_state,
    reason, request_id
  ) VALUES (
    p_organization_id, 'user', actor.actor_profile_id,
    actor.actor_auth_user_id::TEXT, 'company.file.upload.reserve',
    'company_file_version', version_id,
    jsonb_build_object(
      'company_file_id', file_row.id,
      'file_version', file_row.version::TEXT,
      'current_version_id', file_row.current_version_id
    ), result, 'Private company file upload reserved', p_request_id
  );

  INSERT INTO platform_private.company_file_command_receipts (
    request_id, organization_id, actor_kind, actor_profile_id,
    actor_membership_id, actor_principal, action, resource_id, input, result
  ) VALUES (
    p_request_id, p_organization_id, 'user', actor.actor_profile_id,
    actor.actor_membership_id, actor.actor_auth_user_id::TEXT,
    'company.file.upload.reserve', version_id, command_input, result
  );

  RETURN result;
END
$$;

CREATE OR REPLACE FUNCTION private.platform_can_upload_reserved_company_file(
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
    FROM platform_private.company_file_upload_reservations AS reservation
    JOIN platform_private.company_file_storage_bindings AS binding
      ON binding.organization_id = reservation.organization_id
      AND binding.upload_reservation_id = reservation.id
      AND binding.company_file_version_id = reservation.company_file_version_id
      AND binding.bucket_id = reservation.bucket_id
      AND binding.object_name = reservation.object_name
    JOIN platform.company_files AS company_file
      ON company_file.organization_id = reservation.organization_id
      AND company_file.id = reservation.company_file_id
      AND company_file.archived_at IS NULL
      AND company_file.version = reservation.expected_file_version
    JOIN platform.profiles AS profile
      ON profile.id = reservation.uploader_profile_id
      AND profile.auth_user_id = reservation.uploader_auth_user_id
      AND profile.status = 'active'
    JOIN platform.organization_memberships AS membership
      ON membership.organization_id = reservation.organization_id
      AND membership.id = reservation.uploader_membership_id
      AND membership.profile_id = profile.id
      AND membership.status = 'active'
      AND membership."current_role" IN ('admin', 'curator')
    JOIN platform.organizations AS organization
      ON organization.id = reservation.organization_id
      AND organization.status = 'active'
    WHERE reservation.bucket_id = p_bucket_id
      AND reservation.object_name = p_object_name
      AND reservation.uploader_auth_user_id = (SELECT auth.uid())
      AND reservation.expires_at > statement_timestamp()
      AND private.platform_has_permission(
        reservation.organization_id,
        'document.upload'
      )
      AND NOT EXISTS (
        SELECT 1
        FROM storage.objects AS object
        WHERE object.bucket_id = reservation.bucket_id
          AND object.name = reservation.object_name
      )
      AND NOT EXISTS (
        SELECT 1
        FROM platform_private.company_file_upload_finalizations AS finalization
        WHERE finalization.upload_reservation_id = reservation.id
      )
  )
$$;

REVOKE ALL ON FUNCTION private.platform_can_upload_reserved_company_file(TEXT, TEXT)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION private.platform_can_upload_reserved_company_file(TEXT, TEXT)
  TO authenticated;

DROP POLICY IF EXISTS "Platform company file reserved upload"
  ON storage.objects;
CREATE POLICY "Platform company file reserved upload"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'platform-company-files'
    AND storage.allow_only_operation('storage.object.upload')
    AND (
      SELECT private.platform_can_upload_reserved_company_file(bucket_id, name)
    )
  );

CREATE OR REPLACE FUNCTION platform.finalize_company_file_upload(
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
  receipt platform_private.company_file_command_receipts%ROWTYPE;
  reservation platform_private.company_file_upload_reservations%ROWTYPE;
  binding platform_private.company_file_storage_bindings%ROWTYPE;
  file_row platform.company_files%ROWTYPE;
  version_row platform.company_file_versions%ROWTYPE;
  object_row RECORD;
  finalization_id UUID := gen_random_uuid();
  finalized_at TIMESTAMPTZ := statement_timestamp();
  storage_byte_size BIGINT;
  storage_mime_type TEXT;
  previous_current_version_id UUID;
  previous_file_version BIGINT;
  command_input JSONB;
  result JSONB;
BEGIN
  -- The trusted service identity is verified before request locking, replay or
  -- any private row lookup so a leaked request id never becomes an oracle.
  IF (SELECT auth.jwt() ->> 'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service_role is required to finalize a company file upload'
      USING ERRCODE = '42501';
  END IF;

  IF p_organization_id IS NULL
    OR p_upload_reservation_id IS NULL
    OR p_request_id IS NULL
  THEN
    RAISE EXCEPTION 'organization, upload reservation and request id are required'
      USING ERRCODE = '22023';
  END IF;

  PERFORM platform_private.lock_company_file_request(p_request_id);
  command_input := jsonb_build_object(
    'upload_reservation_id', p_upload_reservation_id
  );

  SELECT * INTO receipt
  FROM platform_private.company_file_command_receipts AS candidate
  WHERE candidate.request_id = p_request_id;

  IF FOUND THEN
    IF receipt.organization_id IS DISTINCT FROM p_organization_id
      OR receipt.actor_kind <> 'service'
      OR receipt.action <> 'company.file.upload.finalize'
      OR receipt.input IS DISTINCT FROM command_input
    THEN
      RAISE EXCEPTION 'request_id was already used with different inputs'
        USING ERRCODE = '23505';
    END IF;
    RETURN receipt.result;
  END IF;

  SELECT * INTO reservation
  FROM platform_private.company_file_upload_reservations AS candidate
  WHERE candidate.organization_id = p_organization_id
    AND candidate.id = p_upload_reservation_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Company file upload reservation is unavailable'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO file_row
  FROM platform.company_files AS company_file
  WHERE company_file.organization_id = reservation.organization_id
    AND company_file.id = reservation.company_file_id
    AND company_file.archived_at IS NULL
  FOR UPDATE;

  IF NOT FOUND OR file_row.version <> reservation.expected_file_version THEN
    RAISE EXCEPTION 'Company file changed before upload finalization'
      USING ERRCODE = '40001';
  END IF;

  previous_current_version_id := file_row.current_version_id;
  previous_file_version := file_row.version;

  SELECT * INTO reservation
  FROM platform_private.company_file_upload_reservations AS candidate
  WHERE candidate.organization_id = p_organization_id
    AND candidate.id = p_upload_reservation_id
  FOR UPDATE;

  IF reservation.expires_at <= finalized_at THEN
    RAISE EXCEPTION 'Company file upload reservation expired'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO STRICT binding
  FROM platform_private.company_file_storage_bindings AS candidate
  WHERE candidate.organization_id = reservation.organization_id
    AND candidate.upload_reservation_id = reservation.id
    AND candidate.company_file_version_id = reservation.company_file_version_id
    AND candidate.bucket_id = reservation.bucket_id
    AND candidate.object_name = reservation.object_name;

  SELECT * INTO STRICT version_row
  FROM platform.company_file_versions AS candidate
  WHERE candidate.organization_id = reservation.organization_id
    AND candidate.id = reservation.company_file_version_id
    AND candidate.company_file_id = reservation.company_file_id;

  SELECT object.id, object.created_at, object.metadata
  INTO object_row
  FROM storage.objects AS object
  WHERE object.bucket_id = binding.bucket_id
    AND object.name = binding.object_name
  FOR UPDATE;

  IF NOT FOUND
    OR COALESCE(object_row.metadata ->> 'size', '') !~ '^[0-9]+$'
  THEN
    RAISE EXCEPTION 'Exact private Storage object is required'
      USING ERRCODE = '42501';
  END IF;

  storage_byte_size := (object_row.metadata ->> 'size')::BIGINT;
  storage_mime_type := lower(COALESCE(object_row.metadata ->> 'mimetype', ''));
  IF storage_byte_size <> reservation.byte_size
    OR storage_byte_size <> binding.expected_byte_size
    OR storage_byte_size <> version_row.byte_size
    OR storage_mime_type <> reservation.declared_mime_type
    OR storage_mime_type <> version_row.declared_mime_type
    OR reservation.sha256_hex <> binding.expected_sha256_hex
    OR reservation.sha256_hex <> version_row.sha256_hex
  THEN
    RAISE EXCEPTION 'Private Storage object metadata does not match reservation'
      USING ERRCODE = '22000';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM platform_private.company_file_upload_finalizations AS finalization
    WHERE finalization.upload_reservation_id = reservation.id
      OR finalization.company_file_version_id = reservation.company_file_version_id
  ) THEN
    RAISE EXCEPTION 'Company file upload was already finalized'
      USING ERRCODE = '23505';
  END IF;

  UPDATE platform.company_files
  SET
    current_version_id = reservation.company_file_version_id,
    version = version + 1,
    updated_by_membership_id = reservation.uploader_membership_id,
    updated_at = finalized_at
  WHERE organization_id = reservation.organization_id
    AND id = reservation.company_file_id
    AND version = reservation.expected_file_version
  RETURNING * INTO file_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Company file changed before upload finalization'
      USING ERRCODE = '40001';
  END IF;

  result := jsonb_build_object(
    'organization_id', reservation.organization_id,
    'company_file_id', reservation.company_file_id,
    'company_file_version_id', reservation.company_file_version_id,
    'version_no', version_row.version_no::TEXT,
    'upload_finalization_id', finalization_id,
    'bucket_id', reservation.bucket_id,
    'object_name', reservation.object_name,
    'finalized_at', finalized_at,
    'file_version', file_row.version::TEXT,
    'current_version_id', file_row.current_version_id
  );

  INSERT INTO platform_private.company_file_upload_finalizations (
    id, request_id, organization_id, company_file_id,
    company_file_version_id, upload_reservation_id, storage_binding_id,
    bucket_id, object_name, storage_object_id, object_created_at, finalized_at
  ) VALUES (
    finalization_id, p_request_id, reservation.organization_id,
    reservation.company_file_id, reservation.company_file_version_id,
    reservation.id, binding.id, reservation.bucket_id, reservation.object_name,
    object_row.id, object_row.created_at, finalized_at
  );

  INSERT INTO platform.audit_events (
    organization_id, actor_kind, actor_profile_id, actor_principal,
    action, resource_type, resource_id, before_state, after_state,
    reason, request_id
  ) VALUES (
    reservation.organization_id, 'service', NULL, 'service_role',
    'company.file.upload.finalize', 'company_file_version',
    reservation.company_file_version_id,
    jsonb_build_object(
      'company_file_id', reservation.company_file_id,
      'file_version', previous_file_version::TEXT,
      'current_version_id', previous_current_version_id
    ), result, 'Private company file upload finalized', p_request_id
  );

  INSERT INTO platform_private.company_file_command_receipts (
    request_id, organization_id, actor_kind, actor_profile_id,
    actor_membership_id, actor_principal, action, resource_id, input, result
  ) VALUES (
    p_request_id, reservation.organization_id, 'service', NULL, NULL,
    'service_role', 'company.file.upload.finalize',
    reservation.company_file_version_id, command_input, result
  );

  RETURN result;
END
$$;

CREATE OR REPLACE FUNCTION platform.grant_company_file_download(
  p_organization_id UUID,
  p_company_file_version_id UUID,
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
  actor RECORD;
  receipt platform_private.company_file_command_receipts%ROWTYPE;
  file_row platform.company_files%ROWTYPE;
  version_row platform.company_file_versions%ROWTYPE;
  binding platform_private.company_file_storage_bindings%ROWTYPE;
  grant_id UUID := gen_random_uuid();
  granted_at TIMESTAMPTZ := statement_timestamp();
  expires_at TIMESTAMPTZ;
  normalized_purpose TEXT := btrim(p_access_purpose);
  command_input JSONB;
  result JSONB;
BEGIN
  SELECT * INTO actor
  FROM platform_private.require_company_file_actor(
    p_organization_id,
    'document.download'
  );

  IF p_company_file_version_id IS NULL
    OR p_request_id IS NULL
    OR p_access_purpose IS NULL
    OR char_length(normalized_purpose) NOT BETWEEN 1 AND 255
    OR octet_length(normalized_purpose) > 1024
    OR p_expires_in_seconds IS NULL
    OR p_expires_in_seconds NOT BETWEEN 1 AND 300
  THEN
    RAISE EXCEPTION 'Valid company file download grant metadata is required'
      USING ERRCODE = '22023';
  END IF;

  PERFORM platform_private.lock_company_file_request(p_request_id);
  command_input := jsonb_build_object(
    'company_file_version_id', p_company_file_version_id,
    'access_purpose', normalized_purpose,
    'expires_in_seconds', p_expires_in_seconds
  );

  SELECT * INTO receipt
  FROM platform_private.company_file_command_receipts AS candidate
  WHERE candidate.request_id = p_request_id;

  IF FOUND THEN
    IF receipt.organization_id IS DISTINCT FROM p_organization_id
      OR receipt.actor_kind <> 'user'
      OR receipt.actor_profile_id IS DISTINCT FROM actor.actor_profile_id
      OR receipt.actor_membership_id IS DISTINCT FROM actor.actor_membership_id
      OR receipt.action <> 'company.file.download.grant'
      OR receipt.input IS DISTINCT FROM command_input
    THEN
      RAISE EXCEPTION 'request_id was already used with different inputs'
        USING ERRCODE = '23505';
    END IF;
    RETURN receipt.result;
  END IF;

  SELECT company_file.* INTO file_row
  FROM platform.company_files AS company_file
  JOIN platform.company_file_versions AS file_version
    ON file_version.organization_id = company_file.organization_id
    AND file_version.company_file_id = company_file.id
    AND file_version.id = p_company_file_version_id
  WHERE company_file.organization_id = p_organization_id
    AND company_file.archived_at IS NULL
    AND company_file.current_version_id = p_company_file_version_id
  FOR UPDATE OF company_file;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Company file is unavailable' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO STRICT version_row
  FROM platform.company_file_versions AS candidate
  WHERE candidate.organization_id = p_organization_id
    AND candidate.id = p_company_file_version_id
    AND candidate.company_file_id = file_row.id;

  SELECT * INTO binding
  FROM platform_private.company_file_storage_bindings AS candidate
  WHERE candidate.organization_id = p_organization_id
    AND candidate.company_file_version_id = p_company_file_version_id;

  IF NOT FOUND
    OR NOT EXISTS (
      SELECT 1
      FROM platform_private.company_file_upload_finalizations AS finalization
      WHERE finalization.organization_id = binding.organization_id
        AND finalization.storage_binding_id = binding.id
        AND finalization.company_file_version_id = binding.company_file_version_id
    )
    OR NOT EXISTS (
      SELECT 1
      FROM storage.objects AS object
      WHERE object.bucket_id = binding.bucket_id
        AND object.name = binding.object_name
        AND COALESCE(object.metadata ->> 'size', '') ~ '^[0-9]+$'
        AND (object.metadata ->> 'size')::BIGINT = version_row.byte_size
        AND lower(COALESCE(object.metadata ->> 'mimetype', '')) =
          version_row.declared_mime_type
    )
  THEN
    RAISE EXCEPTION 'Exact private Storage object is unavailable'
      USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM platform_private.company_file_download_grants AS existing_grant
    WHERE existing_grant.organization_id = p_organization_id
      AND existing_grant.company_file_version_id = p_company_file_version_id
      AND existing_grant.grantee_auth_user_id = actor.actor_auth_user_id
      AND existing_grant.expires_at > granted_at
      AND NOT EXISTS (
        SELECT 1
        FROM platform_private.company_file_download_consumptions AS consumption
        WHERE consumption.company_file_download_grant_id = existing_grant.id
      )
  ) THEN
    RAISE EXCEPTION 'A company file download grant is already active'
      USING ERRCODE = 'PT409';
  END IF;

  expires_at := granted_at + make_interval(secs => p_expires_in_seconds);
  INSERT INTO platform_private.company_file_download_grants (
    id, request_id, organization_id, company_file_id, company_file_version_id,
    storage_binding_id, grantee_profile_id, grantee_membership_id,
    grantee_auth_user_id, grantee_role, access_purpose, expires_at, created_at
  ) VALUES (
    grant_id, p_request_id, p_organization_id, file_row.id,
    p_company_file_version_id, binding.id, actor.actor_profile_id,
    actor.actor_membership_id, actor.actor_auth_user_id, actor.actor_role,
    normalized_purpose, expires_at, granted_at
  );

  result := jsonb_build_object(
    'company_file_download_grant_id', grant_id,
    'expires_at', expires_at,
    'signed_url', NULL,
    'storage_api_service_sign_required', TRUE
  );

  INSERT INTO platform.audit_events (
    organization_id, actor_kind, actor_profile_id, actor_principal,
    action, resource_type, resource_id, before_state, after_state,
    reason, request_id
  ) VALUES (
    p_organization_id, 'user', actor.actor_profile_id,
    actor.actor_auth_user_id::TEXT, 'company.file.download.grant',
    'company_file_version', p_company_file_version_id, NULL, result,
    normalized_purpose, p_request_id
  );

  INSERT INTO platform_private.company_file_command_receipts (
    request_id, organization_id, actor_kind, actor_profile_id,
    actor_membership_id, actor_principal, action, resource_id, input, result
  ) VALUES (
    p_request_id, p_organization_id, 'user', actor.actor_profile_id,
    actor.actor_membership_id, actor.actor_auth_user_id::TEXT,
    'company.file.download.grant', p_company_file_version_id,
    command_input, result
  );

  RETURN result;
END
$$;

CREATE OR REPLACE FUNCTION platform.consume_company_file_download_grant(
  p_organization_id UUID,
  p_company_file_download_grant_id UUID,
  p_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  receipt platform_private.company_file_command_receipts%ROWTYPE;
  grant_row platform_private.company_file_download_grants%ROWTYPE;
  binding platform_private.company_file_storage_bindings%ROWTYPE;
  file_row platform.company_files%ROWTYPE;
  version_row platform.company_file_versions%ROWTYPE;
  consumption_id UUID := gen_random_uuid();
  consumed_at TIMESTAMPTZ := statement_timestamp();
  signing_expires_at TIMESTAMPTZ;
  command_input JSONB;
  result JSONB;
BEGIN
  -- Service authorization precedes replay and every private lookup.
  IF (SELECT auth.jwt() ->> 'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service_role is required to consume a company file grant'
      USING ERRCODE = '42501';
  END IF;

  IF p_organization_id IS NULL
    OR p_company_file_download_grant_id IS NULL
    OR p_request_id IS NULL
  THEN
    RAISE EXCEPTION 'organization, download grant and request id are required'
      USING ERRCODE = '22023';
  END IF;

  PERFORM platform_private.lock_company_file_request(p_request_id);
  command_input := jsonb_build_object(
    'company_file_download_grant_id', p_company_file_download_grant_id
  );

  SELECT * INTO receipt
  FROM platform_private.company_file_command_receipts AS candidate
  WHERE candidate.request_id = p_request_id;

  IF FOUND THEN
    IF receipt.organization_id IS DISTINCT FROM p_organization_id
      OR receipt.actor_kind <> 'service'
      OR receipt.action <> 'company.file.download.consume'
      OR receipt.input IS DISTINCT FROM command_input
    THEN
      RAISE EXCEPTION 'request_id was already used with different inputs'
        USING ERRCODE = '23505';
    END IF;
    IF COALESCE((receipt.result ->> 'signing_expires_at')::TIMESTAMPTZ,
      '-infinity'::TIMESTAMPTZ) <= consumed_at
    THEN
      RAISE EXCEPTION 'Company file signing authorization expired'
        USING ERRCODE = '42501';
    END IF;
    RETURN receipt.result;
  END IF;

  SELECT * INTO grant_row
  FROM platform_private.company_file_download_grants AS candidate
  WHERE candidate.organization_id = p_organization_id
    AND candidate.id = p_company_file_download_grant_id
  FOR UPDATE;

  IF NOT FOUND OR grant_row.expires_at <= consumed_at THEN
    RAISE EXCEPTION 'Live company file download grant is required'
      USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM platform_private.company_file_download_consumptions AS consumption
    WHERE consumption.company_file_download_grant_id = grant_row.id
  ) THEN
    RAISE EXCEPTION 'Company file download grant was already consumed'
      USING ERRCODE = '23505';
  END IF;

  SELECT * INTO file_row
  FROM platform.company_files AS company_file
  WHERE company_file.organization_id = grant_row.organization_id
    AND company_file.id = grant_row.company_file_id
    AND company_file.current_version_id = grant_row.company_file_version_id
    AND company_file.archived_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Company file is unavailable' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM platform.profiles AS profile
    JOIN platform.organization_memberships AS membership
      ON membership.organization_id = grant_row.organization_id
      AND membership.id = grant_row.grantee_membership_id
      AND membership.profile_id = profile.id
    JOIN platform.organizations AS organization
      ON organization.id = membership.organization_id
    JOIN platform.role_bundle_versions AS bundle
      ON bundle.id = membership.current_bundle_id
      AND bundle.role = membership."current_role"
      AND bundle.status = 'published'
    JOIN platform.role_bundle_permissions AS bundle_permission
      ON bundle_permission.bundle_id = bundle.id
      AND bundle_permission.bundle_role = bundle.role
      AND bundle_permission.permission_key = 'document.download'
    WHERE profile.id = grant_row.grantee_profile_id
      AND profile.auth_user_id = grant_row.grantee_auth_user_id
      AND profile.status = 'active'
      AND membership.status = 'active'
      AND membership."current_role" = grant_row.grantee_role
      AND membership."current_role" IN ('admin', 'curator')
      AND organization.status = 'active'
  ) THEN
    RAISE EXCEPTION 'Company file access was revoked' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO STRICT binding
  FROM platform_private.company_file_storage_bindings AS candidate
  WHERE candidate.organization_id = grant_row.organization_id
    AND candidate.id = grant_row.storage_binding_id
    AND candidate.company_file_version_id = grant_row.company_file_version_id;

  SELECT * INTO STRICT version_row
  FROM platform.company_file_versions AS candidate
  WHERE candidate.organization_id = grant_row.organization_id
    AND candidate.id = grant_row.company_file_version_id
    AND candidate.company_file_id = grant_row.company_file_id;

  IF NOT EXISTS (
    SELECT 1
    FROM platform_private.company_file_upload_finalizations AS finalization
    WHERE finalization.organization_id = binding.organization_id
      AND finalization.storage_binding_id = binding.id
      AND finalization.company_file_version_id = binding.company_file_version_id
  ) OR NOT EXISTS (
    SELECT 1
    FROM storage.objects AS object
    WHERE object.bucket_id = binding.bucket_id
      AND object.name = binding.object_name
      AND COALESCE(object.metadata ->> 'size', '') ~ '^[0-9]+$'
      AND (object.metadata ->> 'size')::BIGINT = version_row.byte_size
      AND lower(COALESCE(object.metadata ->> 'mimetype', '')) =
        version_row.declared_mime_type
  ) THEN
    RAISE EXCEPTION 'Exact private Storage object is unavailable'
      USING ERRCODE = '42501';
  END IF;

  signing_expires_at := LEAST(grant_row.expires_at, consumed_at + INTERVAL '60 seconds');
  result := jsonb_build_object(
    'company_file_download_consumption_id', consumption_id,
    'company_file_version_id', grant_row.company_file_version_id,
    'bucket_id', binding.bucket_id,
    'object_name', binding.object_name,
    'signing_expires_in_seconds',
      GREATEST(1, floor(extract(epoch FROM signing_expires_at - consumed_at))::INTEGER),
    'signing_expires_at', signing_expires_at,
    'consumed_at', consumed_at
  );

  INSERT INTO platform_private.company_file_download_consumptions (
    id, request_id, organization_id, company_file_download_grant_id,
    company_file_version_id, bucket_id, object_name, signing_expires_at,
    consumed_at
  ) VALUES (
    consumption_id, p_request_id, grant_row.organization_id, grant_row.id,
    grant_row.company_file_version_id, binding.bucket_id, binding.object_name,
    signing_expires_at, consumed_at
  );

  INSERT INTO platform.audit_events (
    organization_id, actor_kind, actor_profile_id, actor_principal,
    action, resource_type, resource_id, before_state, after_state,
    reason, request_id
  ) VALUES (
    grant_row.organization_id, 'service', NULL, 'service_role',
    'company.file.download.consume', 'company_file_version',
    grant_row.company_file_version_id,
    jsonb_build_object('company_file_download_grant_id', grant_row.id),
    result, 'One company file signing authorization consumed', p_request_id
  );

  INSERT INTO platform_private.company_file_command_receipts (
    request_id, organization_id, actor_kind, actor_profile_id,
    actor_membership_id, actor_principal, action, resource_id, input, result
  ) VALUES (
    p_request_id, grant_row.organization_id, 'service', NULL, NULL,
    'service_role', 'company.file.download.consume',
    grant_row.company_file_version_id, command_input, result
  );

  RETURN result;
END
$$;

REVOKE ALL ON FUNCTION platform.staff_company_file_workspace(UUID)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.staff_company_file_workspace(UUID)
  TO authenticated;

REVOKE ALL ON FUNCTION platform.create_company_file_folder(UUID, UUID, TEXT, UUID)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.create_company_file_folder(UUID, UUID, TEXT, UUID)
  TO authenticated;

REVOKE ALL ON FUNCTION platform.rename_company_file_folder(
  UUID, UUID, BIGINT, TEXT, UUID
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.rename_company_file_folder(
  UUID, UUID, BIGINT, TEXT, UUID
) TO authenticated;

REVOKE ALL ON FUNCTION platform.move_company_file_folder(
  UUID, UUID, BIGINT, UUID, UUID
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.move_company_file_folder(
  UUID, UUID, BIGINT, UUID, UUID
) TO authenticated;

REVOKE ALL ON FUNCTION platform.archive_company_file_folder(
  UUID, UUID, BIGINT, UUID
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.archive_company_file_folder(
  UUID, UUID, BIGINT, UUID
) TO authenticated;

REVOKE ALL ON FUNCTION platform.create_company_file(UUID, UUID, TEXT, UUID)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.create_company_file(UUID, UUID, TEXT, UUID)
  TO authenticated;

REVOKE ALL ON FUNCTION platform.rename_company_file(
  UUID, UUID, BIGINT, TEXT, UUID
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.rename_company_file(
  UUID, UUID, BIGINT, TEXT, UUID
) TO authenticated;

REVOKE ALL ON FUNCTION platform.move_company_file(
  UUID, UUID, BIGINT, UUID, UUID
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.move_company_file(
  UUID, UUID, BIGINT, UUID, UUID
) TO authenticated;

REVOKE ALL ON FUNCTION platform.archive_company_file(
  UUID, UUID, BIGINT, UUID
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.archive_company_file(
  UUID, UUID, BIGINT, UUID
) TO authenticated;

REVOKE ALL ON FUNCTION platform.reserve_company_file_upload(
  UUID, UUID, BIGINT, TEXT, TEXT, BIGINT, TEXT, UUID
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.reserve_company_file_upload(
  UUID, UUID, BIGINT, TEXT, TEXT, BIGINT, TEXT, UUID
) TO authenticated;

REVOKE ALL ON FUNCTION platform.finalize_company_file_upload(UUID, UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.finalize_company_file_upload(UUID, UUID, UUID)
  TO service_role;

REVOKE ALL ON FUNCTION platform.grant_company_file_download(
  UUID, UUID, TEXT, INTEGER, UUID
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.grant_company_file_download(
  UUID, UUID, TEXT, INTEGER, UUID
) TO authenticated;

REVOKE ALL ON FUNCTION platform.consume_company_file_download_grant(
  UUID, UUID, UUID
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.consume_company_file_download_grant(
  UUID, UUID, UUID
) TO service_role;

COMMENT ON TABLE platform.company_file_folders IS
  'Canonical organization-scoped folders below the synthetic V3 Company root.';
COMMENT ON TABLE platform.company_files IS
  'Canonical logical company knowledge files; current_version_id advances only after exact Storage finalization.';
COMMENT ON TABLE platform.company_file_versions IS
  'Immutable metadata for every reserved company file version, including abandoned reservations.';
COMMENT ON FUNCTION platform.staff_company_file_workspace(UUID) IS
  'Admin/Admissions-only active company file tree with current finalized version metadata.';
COMMENT ON FUNCTION platform.reserve_company_file_upload(
  UUID, UUID, BIGINT, TEXT, TEXT, BIGINT, TEXT, UUID
) IS
  'Reserves one opaque insert-only private Storage object and immutable pending company file version.';
COMMENT ON FUNCTION platform.finalize_company_file_upload(UUID, UUID, UUID) IS
  'Service-only exact object metadata verification and atomic current-version publication.';
COMMENT ON FUNCTION platform.grant_company_file_download(
  UUID, UUID, TEXT, INTEGER, UUID
) IS
  'Admin/Admissions audited grant for one current company file version; never returns a signed URL.';
COMMENT ON FUNCTION platform.consume_company_file_download_grant(
  UUID, UUID, UUID
) IS
  'Service-only idempotent one-grant signing authorization with an absolute <=60-second expiry.';

COMMIT;
