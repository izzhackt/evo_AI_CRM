-- V3-F: canonical private company folders/files/versions. Student case
-- documents and approved AI text knowledge remain separate authorities.
BEGIN;

CREATE TABLE platform.company_knowledge_folders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES platform.organizations(id),
  parent_folder_id uuid,
  name text NOT NULL CHECK (
    name = btrim(name) AND char_length(name) BETWEEN 1 AND 160
    AND octet_length(name) <= 640 AND name NOT IN ('.', '..')
    AND name !~ '[\\/]'
  ),
  version bigint NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_by_profile_id uuid NOT NULL REFERENCES platform.profiles(id),
  removed_by_profile_id uuid REFERENCES platform.profiles(id),
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  removed_at timestamptz,
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, parent_folder_id)
    REFERENCES platform.company_knowledge_folders(organization_id, id),
  CHECK (parent_folder_id IS NULL OR parent_folder_id <> id),
  CHECK (
    (removed_at IS NULL AND removed_by_profile_id IS NULL)
    OR (removed_at IS NOT NULL AND removed_by_profile_id IS NOT NULL)
  )
);
CREATE UNIQUE INDEX company_knowledge_folders_active_name_idx
  ON platform.company_knowledge_folders (
    organization_id,
    COALESCE(parent_folder_id, '00000000-0000-0000-0000-000000000000'),
    lower(name)
  ) WHERE removed_at IS NULL;
CREATE INDEX company_knowledge_folders_parent_idx
  ON platform.company_knowledge_folders(organization_id, parent_folder_id)
  WHERE removed_at IS NULL;
CREATE INDEX company_knowledge_folders_creator_idx
  ON platform.company_knowledge_folders(created_by_profile_id);

CREATE TABLE platform.company_knowledge_files (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES platform.organizations(id),
  folder_id uuid,
  name text NOT NULL CHECK (
    name = btrim(name) AND char_length(name) BETWEEN 1 AND 255
    AND octet_length(name) <= 1024 AND name NOT IN ('.', '..')
    AND name !~ '[\\/]'
  ),
  version bigint NOT NULL DEFAULT 1 CHECK (version >= 1),
  current_file_version_id uuid,
  current_version_no bigint CHECK (
    current_version_no IS NULL OR current_version_no >= 1
  ),
  created_by_profile_id uuid NOT NULL REFERENCES platform.profiles(id),
  removed_by_profile_id uuid REFERENCES platform.profiles(id),
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  removed_at timestamptz,
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, folder_id)
    REFERENCES platform.company_knowledge_folders(organization_id, id),
  CHECK (
    (current_file_version_id IS NULL AND current_version_no IS NULL)
    OR (current_file_version_id IS NOT NULL AND current_version_no IS NOT NULL)
  ),
  CHECK (
    (removed_at IS NULL AND removed_by_profile_id IS NULL)
    OR (removed_at IS NOT NULL AND removed_by_profile_id IS NOT NULL)
  )
);
CREATE UNIQUE INDEX company_knowledge_files_active_name_idx
  ON platform.company_knowledge_files (
    organization_id,
    COALESCE(folder_id, '00000000-0000-0000-0000-000000000000'),
    lower(name)
  ) WHERE removed_at IS NULL;
CREATE INDEX company_knowledge_files_folder_idx
  ON platform.company_knowledge_files(organization_id, folder_id)
  WHERE removed_at IS NULL;
CREATE INDEX company_knowledge_files_creator_idx
  ON platform.company_knowledge_files(created_by_profile_id);

CREATE TABLE platform_private.company_knowledge_upload_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL UNIQUE,
  organization_id uuid NOT NULL REFERENCES platform.organizations(id),
  folder_id uuid,
  file_id uuid NOT NULL,
  file_name text NOT NULL CHECK (
    file_name = btrim(file_name)
    AND char_length(file_name) BETWEEN 1 AND 255
    AND octet_length(file_name) <= 1024
    AND file_name NOT IN ('.', '..') AND file_name !~ '[\\/]'
  ),
  expected_version bigint CHECK (
    expected_version IS NULL OR expected_version >= 1
  ),
  uploader_profile_id uuid NOT NULL REFERENCES platform.profiles(id),
  uploader_membership_id uuid NOT NULL,
  uploader_auth_user_id uuid NOT NULL,
  bucket_id text NOT NULL DEFAULT 'platform-knowledge-files'
    CHECK (bucket_id = 'platform-knowledge-files'),
  object_name text NOT NULL UNIQUE
    CHECK (object_name ~ '^[0-9a-f]{2}/[0-9a-f]{62}$'),
  content_type text NOT NULL
    CHECK (content_type IN ('application/pdf', 'image/jpeg', 'image/png')),
  byte_size bigint NOT NULL CHECK (byte_size BETWEEN 1 AND 26214400),
  sha256_hex text NOT NULL CHECK (sha256_hex ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  FOREIGN KEY (organization_id, folder_id)
    REFERENCES platform.company_knowledge_folders(organization_id, id),
  FOREIGN KEY (organization_id, uploader_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id),
  CHECK (
    expires_at > created_at
    AND expires_at <= created_at + interval '10 minutes'
  )
);
CREATE INDEX company_knowledge_upload_reservations_file_idx
  ON platform_private.company_knowledge_upload_reservations(
    organization_id, file_id, created_at DESC
  );

CREATE TABLE platform.company_knowledge_file_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES platform.organizations(id),
  file_id uuid NOT NULL,
  version_no bigint NOT NULL CHECK (version_no >= 1),
  upload_reservation_id uuid NOT NULL UNIQUE
    REFERENCES platform_private.company_knowledge_upload_reservations(id),
  bucket_id text NOT NULL CHECK (bucket_id = 'platform-knowledge-files'),
  object_name text NOT NULL UNIQUE
    CHECK (object_name ~ '^[0-9a-f]{2}/[0-9a-f]{62}$'),
  original_file_name text NOT NULL,
  content_type text NOT NULL
    CHECK (content_type IN ('application/pdf', 'image/jpeg', 'image/png')),
  byte_size bigint NOT NULL CHECK (byte_size BETWEEN 1 AND 26214400),
  sha256_hex text NOT NULL CHECK (sha256_hex ~ '^[0-9a-f]{64}$'),
  created_by_profile_id uuid NOT NULL REFERENCES platform.profiles(id),
  storage_object_created_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  UNIQUE (organization_id, id, file_id),
  UNIQUE (organization_id, file_id, version_no),
  FOREIGN KEY (organization_id, file_id)
    REFERENCES platform.company_knowledge_files(organization_id, id)
);
CREATE INDEX company_knowledge_file_versions_file_idx
  ON platform.company_knowledge_file_versions(
    organization_id, file_id, version_no DESC
  );
ALTER TABLE platform.company_knowledge_files
  ADD CONSTRAINT company_knowledge_files_current_version_fkey
  FOREIGN KEY (organization_id, current_file_version_id, id)
  REFERENCES platform.company_knowledge_file_versions(
    organization_id, id, file_id
  );

CREATE TABLE platform_private.company_knowledge_upload_finalizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES platform.organizations(id),
  upload_reservation_id uuid NOT NULL UNIQUE
    REFERENCES platform_private.company_knowledge_upload_reservations(id),
  file_id uuid NOT NULL,
  file_version_id uuid NOT NULL,
  audit_event_id uuid NOT NULL UNIQUE REFERENCES platform.audit_events(id),
  response jsonb NOT NULL CHECK (jsonb_typeof(response) = 'object'),
  finalized_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  FOREIGN KEY (organization_id, file_version_id, file_id)
    REFERENCES platform.company_knowledge_file_versions(
      organization_id, id, file_id
    )
);

CREATE TABLE platform_private.company_knowledge_download_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL UNIQUE,
  organization_id uuid NOT NULL REFERENCES platform.organizations(id),
  file_id uuid NOT NULL,
  file_version_id uuid NOT NULL,
  requester_profile_id uuid NOT NULL REFERENCES platform.profiles(id),
  requester_membership_id uuid NOT NULL,
  requester_auth_user_id uuid NOT NULL,
  bucket_id text NOT NULL CHECK (bucket_id = 'platform-knowledge-files'),
  object_name text NOT NULL,
  file_name text NOT NULL,
  content_type text NOT NULL,
  byte_size bigint NOT NULL,
  sha256_hex text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  FOREIGN KEY (organization_id, file_version_id, file_id)
    REFERENCES platform.company_knowledge_file_versions(
      organization_id, id, file_id
    ),
  FOREIGN KEY (organization_id, requester_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id),
  CHECK (
    expires_at > created_at
    AND expires_at <= created_at + interval '60 seconds'
  )
);
CREATE INDEX company_knowledge_download_grants_file_idx
  ON platform_private.company_knowledge_download_grants(
    organization_id, file_id, created_at DESC
  );

CREATE TABLE platform_private.company_knowledge_download_consumptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES platform.organizations(id),
  download_grant_id uuid NOT NULL UNIQUE
    REFERENCES platform_private.company_knowledge_download_grants(id),
  audit_event_id uuid NOT NULL UNIQUE REFERENCES platform.audit_events(id),
  response jsonb NOT NULL CHECK (jsonb_typeof(response) = 'object'),
  consumed_at timestamptz NOT NULL DEFAULT statement_timestamp()
);

CREATE TABLE platform_private.company_knowledge_command_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL UNIQUE,
  organization_id uuid NOT NULL REFERENCES platform.organizations(id),
  actor_profile_id uuid NOT NULL REFERENCES platform.profiles(id),
  actor_membership_id uuid NOT NULL,
  actor_auth_user_id uuid NOT NULL,
  action text NOT NULL CHECK (
    action ~ '^company\.(folder|file)\.[a-z]+(\.[a-z]+)?$'
  ),
  input_payload jsonb NOT NULL CHECK (jsonb_typeof(input_payload) = 'object'),
  response jsonb NOT NULL CHECK (jsonb_typeof(response) = 'object'),
  audit_event_id uuid NOT NULL UNIQUE REFERENCES platform.audit_events(id),
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  FOREIGN KEY (organization_id, actor_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id)
);

-- No table receives a browser policy or direct browser privilege. Every read
-- and write goes through the explicit functions below.
ALTER TABLE platform.company_knowledge_folders ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.company_knowledge_folders FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.company_knowledge_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.company_knowledge_files FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.company_knowledge_file_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.company_knowledge_file_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE platform_private.company_knowledge_upload_reservations
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.company_knowledge_upload_reservations
  FORCE ROW LEVEL SECURITY;
ALTER TABLE platform_private.company_knowledge_upload_finalizations
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.company_knowledge_upload_finalizations
  FORCE ROW LEVEL SECURITY;
ALTER TABLE platform_private.company_knowledge_download_grants
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.company_knowledge_download_grants
  FORCE ROW LEVEL SECURITY;
ALTER TABLE platform_private.company_knowledge_download_consumptions
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.company_knowledge_download_consumptions
  FORCE ROW LEVEL SECURITY;
ALTER TABLE platform_private.company_knowledge_command_receipts
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.company_knowledge_command_receipts
  FORCE ROW LEVEL SECURITY;

DO $append_only$
DECLARE
  relation_name text;
BEGIN
  FOREACH relation_name IN ARRAY ARRAY[
    'platform.company_knowledge_file_versions',
    'platform_private.company_knowledge_upload_reservations',
    'platform_private.company_knowledge_upload_finalizations',
    'platform_private.company_knowledge_download_grants',
    'platform_private.company_knowledge_download_consumptions',
    'platform_private.company_knowledge_command_receipts'
  ] LOOP
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %s FOR EACH ROW '
      || 'EXECUTE FUNCTION platform_private.block_append_only_mutation()',
      replace(relation_name, '.', '_') || '_append_only_rows',
      relation_name
    );
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE TRUNCATE ON %s FOR EACH STATEMENT '
      || 'EXECUTE FUNCTION platform_private.block_append_only_mutation()',
      replace(relation_name, '.', '_') || '_no_truncate',
      relation_name
    );
  END LOOP;
END
$append_only$;

CREATE FUNCTION platform_private.lock_company_knowledge_request(p_request_id uuid)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'request id is required' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'evo:v3:company-knowledge:' || p_request_id::text, 0
  ));
END
$$;

CREATE FUNCTION platform_private.lock_company_knowledge_scope(
  p_organization_id uuid
) RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'organization id is required' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'evo:v3:company-knowledge-scope:' || p_organization_id::text, 0
  ));
END
$$;

CREATE FUNCTION platform_private.company_knowledge_name(
  p_name text, p_limit integer
) RETURNS text LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE normalized text := btrim(p_name);
BEGIN
  IF p_name IS NULL OR normalized = '' OR normalized IN ('.', '..')
    OR normalized ~ '[\\/]' OR char_length(normalized) > p_limit
    OR octet_length(normalized) > 1024
  THEN
    RAISE EXCEPTION 'Valid company knowledge name is required'
      USING ERRCODE = '22023';
  END IF;
  RETURN normalized;
END
$$;

CREATE FUNCTION platform_private.replay_company_knowledge_command(
  p_request_id uuid, p_organization_id uuid, p_profile_id uuid,
  p_membership_id uuid, p_auth_user_id uuid, p_action text, p_input jsonb
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE prior platform_private.company_knowledge_command_receipts%rowtype;
BEGIN
  SELECT * INTO prior
  FROM platform_private.company_knowledge_command_receipts receipt
  WHERE receipt.request_id = p_request_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF prior.organization_id <> p_organization_id
    OR prior.actor_profile_id <> p_profile_id
    OR prior.actor_membership_id <> p_membership_id
    OR prior.actor_auth_user_id <> p_auth_user_id
    OR prior.action <> p_action OR prior.input_payload <> p_input
  THEN
    RAISE EXCEPTION 'company_knowledge_request_replay_mismatch'
      USING ERRCODE = '23505';
  END IF;
  RETURN prior.response;
END
$$;

CREATE FUNCTION platform_private.record_company_knowledge_command(
  p_request_id uuid, p_organization_id uuid, p_profile_id uuid,
  p_membership_id uuid, p_auth_user_id uuid, p_action text,
  p_resource_type text, p_resource_id uuid, p_before jsonb, p_after jsonb,
  p_reason text, p_input jsonb, p_response jsonb
) RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE audit_id uuid := gen_random_uuid();
BEGIN
  INSERT INTO platform.audit_events(
    id, organization_id, actor_kind, actor_profile_id, actor_principal,
    action, resource_type, resource_id, before_state, after_state,
    reason, request_id
  ) VALUES (
    audit_id, p_organization_id, 'user', p_profile_id,
    'auth:' || p_auth_user_id::text, p_action, p_resource_type,
    p_resource_id, p_before, p_after, p_reason, p_request_id
  );
  INSERT INTO platform_private.company_knowledge_command_receipts(
    request_id, organization_id, actor_profile_id, actor_membership_id,
    actor_auth_user_id, action, input_payload, response, audit_event_id
  ) VALUES (
    p_request_id, p_organization_id, p_profile_id, p_membership_id,
    p_auth_user_id, p_action, p_input, p_response, audit_id
  );
END
$$;

CREATE FUNCTION platform.list_company_knowledge_folders()
RETURNS TABLE(
  organization_id uuid, folder_id uuid, parent_folder_id uuid, name text,
  version bigint, created_at timestamptz, updated_at timestamptz
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor record;
BEGIN
  SELECT * INTO actor FROM platform_private.require_admissions_runtime_actor(
    'document.read.full'
  );
  RETURN QUERY SELECT f.organization_id, f.id, f.parent_folder_id, f.name,
    f.version, f.created_at, f.updated_at
  FROM platform.company_knowledge_folders f
  WHERE f.organization_id = actor.organization_id AND f.removed_at IS NULL
  ORDER BY lower(f.name), f.id;
END
$$;

CREATE FUNCTION platform.list_company_knowledge_files()
RETURNS TABLE(
  organization_id uuid, file_id uuid, folder_id uuid, name text,
  version bigint, current_file_version_id uuid, current_version_no bigint,
  content_type text, byte_size bigint, sha256_hex text,
  created_at timestamptz, updated_at timestamptz,
  current_version_created_at timestamptz
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor record;
BEGIN
  SELECT * INTO actor FROM platform_private.require_admissions_runtime_actor(
    'document.read.full'
  );
  RETURN QUERY SELECT f.organization_id, f.id, f.folder_id, f.name,
    f.version, f.current_file_version_id, f.current_version_no,
    v.content_type, v.byte_size, v.sha256_hex,
    f.created_at, f.updated_at, v.created_at
  FROM platform.company_knowledge_files f
  JOIN platform.company_knowledge_file_versions v
    ON v.organization_id = f.organization_id
    AND v.id = f.current_file_version_id AND v.file_id = f.id
  WHERE f.organization_id = actor.organization_id AND f.removed_at IS NULL
  ORDER BY lower(f.name), f.id;
END
$$;

CREATE FUNCTION platform_private.mutate_company_knowledge_folder(
  p_operation text, p_folder_id uuid, p_parent_folder_id uuid, p_name text,
  p_expected_version bigint, p_request_id uuid
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  actor record;
  row_before platform.company_knowledge_folders%rowtype;
  new_id uuid := gen_random_uuid();
  normalized_name text;
  action text := 'company.folder.' || p_operation;
  input_payload jsonb;
  replayed jsonb;
  before_state jsonb;
  result jsonb;
  written_at timestamptz := statement_timestamp();
BEGIN
  IF p_operation NOT IN ('create', 'rename', 'move', 'remove') THEN
    RAISE EXCEPTION 'Unsupported company folder operation'
      USING ERRCODE = '22023';
  END IF;
  IF p_operation IN ('create', 'rename') THEN
    normalized_name := platform_private.company_knowledge_name(p_name, 160);
  END IF;
  IF p_operation <> 'create' AND (
    p_folder_id IS NULL OR p_expected_version IS NULL
    OR p_expected_version < 1
  ) THEN
    RAISE EXCEPTION 'folder id and expected version are required'
      USING ERRCODE = '22023';
  END IF;
  PERFORM platform_private.lock_company_knowledge_request(p_request_id);
  SELECT * INTO actor FROM platform_private.require_admissions_runtime_actor(
    'document.manage'
  );
  PERFORM platform_private.lock_company_knowledge_scope(actor.organization_id);

  input_payload := CASE p_operation
    WHEN 'create' THEN jsonb_build_object(
      'parent_folder_id', p_parent_folder_id, 'name', normalized_name
    )
    WHEN 'rename' THEN jsonb_build_object(
      'folder_id', p_folder_id, 'name', normalized_name,
      'expected_version', p_expected_version
    )
    WHEN 'move' THEN jsonb_build_object(
      'folder_id', p_folder_id, 'parent_folder_id', p_parent_folder_id,
      'expected_version', p_expected_version
    )
    ELSE jsonb_build_object(
      'folder_id', p_folder_id, 'expected_version', p_expected_version
    )
  END;
  replayed := platform_private.replay_company_knowledge_command(
    p_request_id, actor.organization_id, actor.profile_id,
    actor.membership_id, actor.auth_user_id, action, input_payload
  );
  IF replayed IS NOT NULL THEN RETURN replayed; END IF;

  IF p_operation = 'create' THEN
    IF p_parent_folder_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM platform.company_knowledge_folders f
      WHERE f.organization_id = actor.organization_id
        AND f.id = p_parent_folder_id AND f.removed_at IS NULL
    ) THEN
      RAISE EXCEPTION 'Company knowledge folder is unavailable'
        USING ERRCODE = '42501';
    END IF;
    INSERT INTO platform.company_knowledge_folders(
      id, organization_id, parent_folder_id, name, created_by_profile_id,
      created_at, updated_at
    ) VALUES (
      new_id, actor.organization_id, p_parent_folder_id, normalized_name,
      actor.profile_id, written_at, written_at
    );
    result := jsonb_build_object(
      'organization_id', actor.organization_id, 'folder_id', new_id,
      'parent_folder_id', p_parent_folder_id, 'name', normalized_name,
      'version', 1, 'created_at', written_at, 'updated_at', written_at
    );
    PERFORM platform_private.record_company_knowledge_command(
      p_request_id, actor.organization_id, actor.profile_id,
      actor.membership_id, actor.auth_user_id, action,
      'company_knowledge_folder', new_id, NULL, result,
      'Staff created one canonical company knowledge folder',
      input_payload, result
    );
    RETURN result;
  END IF;

  SELECT * INTO row_before FROM platform.company_knowledge_folders f
  WHERE f.organization_id = actor.organization_id AND f.id = p_folder_id
    AND f.removed_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Company knowledge folder is unavailable'
      USING ERRCODE = '42501';
  END IF;
  IF row_before.version <> p_expected_version
    OR row_before.version = 9223372036854775807
  THEN
    RAISE EXCEPTION 'company_knowledge_folder_version_conflict'
      USING ERRCODE = 'PT409';
  END IF;
  before_state := jsonb_build_object(
    'organization_id', row_before.organization_id,
    'folder_id', row_before.id,
    'parent_folder_id', row_before.parent_folder_id,
    'name', row_before.name, 'version', row_before.version,
    'created_at', row_before.created_at, 'updated_at', row_before.updated_at
  );

  IF p_operation = 'rename' THEN
    IF row_before.name = normalized_name THEN
      RAISE EXCEPTION 'Company knowledge folder name must change'
        USING ERRCODE = '22023';
    END IF;
    UPDATE platform.company_knowledge_folders f SET
      name = normalized_name, version = row_before.version + 1,
      updated_at = written_at
    WHERE f.organization_id = actor.organization_id AND f.id = p_folder_id;
    result := before_state || jsonb_build_object(
      'name', normalized_name, 'version', row_before.version + 1,
      'updated_at', written_at
    );
  ELSIF p_operation = 'move' THEN
    IF row_before.parent_folder_id IS NOT DISTINCT FROM p_parent_folder_id THEN
      RAISE EXCEPTION 'Company knowledge folder parent must change'
        USING ERRCODE = '22023';
    END IF;
    IF p_parent_folder_id = row_before.id THEN
      RAISE EXCEPTION 'Company knowledge folder cycle is forbidden'
        USING ERRCODE = '22023';
    END IF;
    IF p_parent_folder_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM platform.company_knowledge_folders f
      WHERE f.organization_id = actor.organization_id
        AND f.id = p_parent_folder_id AND f.removed_at IS NULL
    ) THEN
      RAISE EXCEPTION 'Company knowledge folder is unavailable'
        USING ERRCODE = '42501';
    END IF;
    IF p_parent_folder_id IS NOT NULL AND EXISTS (
      WITH RECURSIVE ancestors AS (
        SELECT f.id, f.parent_folder_id
        FROM platform.company_knowledge_folders f
        WHERE f.organization_id = actor.organization_id
          AND f.id = p_parent_folder_id AND f.removed_at IS NULL
        UNION ALL
        SELECT f.id, f.parent_folder_id
        FROM platform.company_knowledge_folders f JOIN ancestors a
          ON a.parent_folder_id = f.id
        WHERE f.organization_id = actor.organization_id
          AND f.removed_at IS NULL
      ) SELECT 1 FROM ancestors WHERE id = row_before.id
    ) THEN
      RAISE EXCEPTION 'Company knowledge folder cycle is forbidden'
        USING ERRCODE = '22023';
    END IF;
    UPDATE platform.company_knowledge_folders f SET
      parent_folder_id = p_parent_folder_id,
      version = row_before.version + 1, updated_at = written_at
    WHERE f.organization_id = actor.organization_id AND f.id = p_folder_id;
    result := before_state || jsonb_build_object(
      'parent_folder_id', p_parent_folder_id,
      'version', row_before.version + 1, 'updated_at', written_at
    );
  ELSE
    IF EXISTS (
      SELECT 1 FROM platform.company_knowledge_folders f
      WHERE f.organization_id = actor.organization_id
        AND f.parent_folder_id = p_folder_id AND f.removed_at IS NULL
    ) OR EXISTS (
      SELECT 1 FROM platform.company_knowledge_files f
      WHERE f.organization_id = actor.organization_id
        AND f.folder_id = p_folder_id AND f.removed_at IS NULL
    ) THEN
      RAISE EXCEPTION 'Company knowledge folder must be empty before removal'
        USING ERRCODE = '23503';
    END IF;
    UPDATE platform.company_knowledge_folders f SET
      version = row_before.version + 1, updated_at = written_at,
      removed_at = written_at, removed_by_profile_id = actor.profile_id
    WHERE f.organization_id = actor.organization_id AND f.id = p_folder_id;
    result := before_state || jsonb_build_object(
      'version', row_before.version + 1, 'updated_at', written_at,
      'removed_at', written_at
    );
  END IF;

  PERFORM platform_private.record_company_knowledge_command(
    p_request_id, actor.organization_id, actor.profile_id,
    actor.membership_id, actor.auth_user_id, action,
    'company_knowledge_folder', row_before.id, before_state, result,
    'Staff changed one canonical company knowledge folder',
    input_payload, result
  );
  RETURN result;
END
$$;

CREATE FUNCTION platform.create_company_knowledge_folder(
  p_parent_folder_id uuid, p_name text, p_request_id uuid
) RETURNS jsonb LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
  SELECT platform_private.mutate_company_knowledge_folder(
    'create', NULL, p_parent_folder_id, p_name, NULL, p_request_id
  )
$$;
CREATE FUNCTION platform.rename_company_knowledge_folder(
  p_folder_id uuid, p_name text, p_expected_version bigint, p_request_id uuid
) RETURNS jsonb LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
  SELECT platform_private.mutate_company_knowledge_folder(
    'rename', p_folder_id, NULL, p_name, p_expected_version, p_request_id
  )
$$;
CREATE FUNCTION platform.move_company_knowledge_folder(
  p_folder_id uuid, p_parent_folder_id uuid, p_expected_version bigint,
  p_request_id uuid
) RETURNS jsonb LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
  SELECT platform_private.mutate_company_knowledge_folder(
    'move', p_folder_id, p_parent_folder_id, NULL,
    p_expected_version, p_request_id
  )
$$;
CREATE FUNCTION platform.remove_company_knowledge_folder(
  p_folder_id uuid, p_expected_version bigint, p_request_id uuid
) RETURNS jsonb LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
  SELECT platform_private.mutate_company_knowledge_folder(
    'remove', p_folder_id, NULL, NULL, p_expected_version, p_request_id
  )
$$;

CREATE FUNCTION platform_private.mutate_company_knowledge_file(
  p_operation text, p_file_id uuid, p_folder_id uuid, p_name text,
  p_expected_version bigint, p_request_id uuid
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  actor record;
  row_before platform.company_knowledge_files%rowtype;
  normalized_name text;
  action text := 'company.file.' || p_operation;
  input_payload jsonb;
  replayed jsonb;
  before_state jsonb;
  result jsonb;
  written_at timestamptz := statement_timestamp();
BEGIN
  IF p_operation NOT IN ('rename', 'move', 'remove')
    OR p_file_id IS NULL OR p_expected_version IS NULL
    OR p_expected_version < 1
  THEN
    RAISE EXCEPTION 'Valid company file mutation is required'
      USING ERRCODE = '22023';
  END IF;
  IF p_operation = 'rename' THEN
    normalized_name := platform_private.company_knowledge_name(p_name, 255);
  END IF;
  PERFORM platform_private.lock_company_knowledge_request(p_request_id);
  SELECT * INTO actor FROM platform_private.require_admissions_runtime_actor(
    'document.manage'
  );
  PERFORM platform_private.lock_company_knowledge_scope(actor.organization_id);
  input_payload := CASE p_operation
    WHEN 'rename' THEN jsonb_build_object(
      'file_id', p_file_id, 'name', normalized_name,
      'expected_version', p_expected_version
    )
    WHEN 'move' THEN jsonb_build_object(
      'file_id', p_file_id, 'folder_id', p_folder_id,
      'expected_version', p_expected_version
    )
    ELSE jsonb_build_object(
      'file_id', p_file_id, 'expected_version', p_expected_version
    )
  END;
  replayed := platform_private.replay_company_knowledge_command(
    p_request_id, actor.organization_id, actor.profile_id,
    actor.membership_id, actor.auth_user_id, action, input_payload
  );
  IF replayed IS NOT NULL THEN RETURN replayed; END IF;

  SELECT * INTO row_before FROM platform.company_knowledge_files f
  WHERE f.organization_id = actor.organization_id AND f.id = p_file_id
    AND f.removed_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Company knowledge file is unavailable'
      USING ERRCODE = '42501';
  END IF;
  IF row_before.version <> p_expected_version
    OR row_before.version = 9223372036854775807
  THEN
    RAISE EXCEPTION 'company_knowledge_file_version_conflict'
      USING ERRCODE = 'PT409';
  END IF;
  before_state := jsonb_build_object(
    'organization_id', row_before.organization_id, 'file_id', row_before.id,
    'folder_id', row_before.folder_id, 'name', row_before.name,
    'version', row_before.version,
    'current_file_version_id', row_before.current_file_version_id,
    'current_version_no', row_before.current_version_no,
    'created_at', row_before.created_at, 'updated_at', row_before.updated_at
  );

  IF p_operation = 'rename' THEN
    IF row_before.name = normalized_name THEN
      RAISE EXCEPTION 'Company knowledge file name must change'
        USING ERRCODE = '22023';
    END IF;
    UPDATE platform.company_knowledge_files f SET
      name = normalized_name, version = row_before.version + 1,
      updated_at = written_at
    WHERE f.organization_id = actor.organization_id AND f.id = p_file_id;
    result := before_state || jsonb_build_object(
      'name', normalized_name, 'version', row_before.version + 1,
      'updated_at', written_at
    );
  ELSIF p_operation = 'move' THEN
    IF row_before.folder_id IS NOT DISTINCT FROM p_folder_id THEN
      RAISE EXCEPTION 'Company knowledge file folder must change'
        USING ERRCODE = '22023';
    END IF;
    IF p_folder_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM platform.company_knowledge_folders folder
      WHERE folder.organization_id = actor.organization_id
        AND folder.id = p_folder_id AND folder.removed_at IS NULL
    ) THEN
      RAISE EXCEPTION 'Company knowledge folder is unavailable'
        USING ERRCODE = '42501';
    END IF;
    UPDATE platform.company_knowledge_files f SET
      folder_id = p_folder_id, version = row_before.version + 1,
      updated_at = written_at
    WHERE f.organization_id = actor.organization_id AND f.id = p_file_id;
    result := before_state || jsonb_build_object(
      'folder_id', p_folder_id, 'version', row_before.version + 1,
      'updated_at', written_at
    );
  ELSE
    UPDATE platform.company_knowledge_files f SET
      version = row_before.version + 1, updated_at = written_at,
      removed_at = written_at, removed_by_profile_id = actor.profile_id
    WHERE f.organization_id = actor.organization_id AND f.id = p_file_id;
    result := before_state || jsonb_build_object(
      'version', row_before.version + 1, 'updated_at', written_at,
      'removed_at', written_at
    );
  END IF;

  PERFORM platform_private.record_company_knowledge_command(
    p_request_id, actor.organization_id, actor.profile_id,
    actor.membership_id, actor.auth_user_id, action,
    'company_knowledge_file', row_before.id, before_state, result,
    'Staff changed one canonical company knowledge file',
    input_payload, result
  );
  RETURN result;
END
$$;

CREATE FUNCTION platform.rename_company_knowledge_file(
  p_file_id uuid, p_name text, p_expected_version bigint, p_request_id uuid
) RETURNS jsonb LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
  SELECT platform_private.mutate_company_knowledge_file(
    'rename', p_file_id, NULL, p_name, p_expected_version, p_request_id
  )
$$;
CREATE FUNCTION platform.move_company_knowledge_file(
  p_file_id uuid, p_folder_id uuid, p_expected_version bigint,
  p_request_id uuid
) RETURNS jsonb LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
  SELECT platform_private.mutate_company_knowledge_file(
    'move', p_file_id, p_folder_id, NULL, p_expected_version, p_request_id
  )
$$;
CREATE FUNCTION platform.remove_company_knowledge_file(
  p_file_id uuid, p_expected_version bigint, p_request_id uuid
) RETURNS jsonb LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
  SELECT platform_private.mutate_company_knowledge_file(
    'remove', p_file_id, NULL, NULL, p_expected_version, p_request_id
  )
$$;

CREATE FUNCTION platform.reserve_company_knowledge_file_upload(
  p_folder_id uuid, p_file_id uuid, p_file_name text, p_content_type text,
  p_byte_size bigint, p_sha256 text, p_request_id uuid,
  p_expected_version bigint DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  actor record;
  file_row platform.company_knowledge_files%rowtype;
  reservation_id uuid := gen_random_uuid();
  opaque_hex text := replace(gen_random_uuid()::text, '-', '')
    || replace(gen_random_uuid()::text, '-', '');
  object_name text;
  normalized_name text;
  normalized_type text := lower(btrim(p_content_type));
  normalized_sha text := lower(btrim(p_sha256));
  input_payload jsonb;
  replayed jsonb;
  result jsonb;
  reserved_at timestamptz := statement_timestamp();
  expires_at timestamptz := reserved_at + interval '10 minutes';
BEGIN
  IF p_file_id IS NULL OR p_request_id IS NULL
    OR normalized_type NOT IN ('application/pdf', 'image/jpeg', 'image/png')
    OR p_byte_size IS NULL OR p_byte_size NOT BETWEEN 1 AND 26214400
    OR normalized_sha !~ '^[0-9a-f]{64}$'
    OR (p_expected_version IS NOT NULL AND p_expected_version < 1)
  THEN
    RAISE EXCEPTION 'Valid company knowledge upload metadata is required'
      USING ERRCODE = '22023';
  END IF;
  normalized_name := platform_private.company_knowledge_name(
    p_file_name, 255
  );
  object_name := substr(opaque_hex, 1, 2) || '/' || substr(opaque_hex, 3);
  PERFORM platform_private.lock_company_knowledge_request(p_request_id);
  SELECT * INTO actor FROM platform_private.require_admissions_runtime_actor(
    'document.upload'
  );
  input_payload := jsonb_build_object(
    'folder_id', p_folder_id, 'file_id', p_file_id,
    'file_name', normalized_name, 'content_type', normalized_type,
    'byte_size', p_byte_size, 'sha256_hex', normalized_sha,
    'expected_version', p_expected_version
  );
  replayed := platform_private.replay_company_knowledge_command(
    p_request_id, actor.organization_id, actor.profile_id,
    actor.membership_id, actor.auth_user_id,
    'company.file.upload.reserve', input_payload
  );
  IF replayed IS NOT NULL THEN RETURN replayed; END IF;

  IF p_folder_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM platform.company_knowledge_folders folder
    WHERE folder.organization_id = actor.organization_id
      AND folder.id = p_folder_id AND folder.removed_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Company knowledge folder is unavailable'
      USING ERRCODE = '42501';
  END IF;
  SELECT * INTO file_row FROM platform.company_knowledge_files file
  WHERE file.organization_id = actor.organization_id AND file.id = p_file_id
  FOR UPDATE;
  IF FOUND THEN
    IF file_row.removed_at IS NOT NULL THEN
      RAISE EXCEPTION 'Company knowledge file is unavailable'
        USING ERRCODE = '42501';
    END IF;
    IF p_expected_version IS NULL
      OR file_row.version <> p_expected_version
      OR file_row.version = 9223372036854775807
    THEN
      RAISE EXCEPTION 'company_knowledge_file_version_conflict'
        USING ERRCODE = 'PT409';
    END IF;
    IF file_row.folder_id IS DISTINCT FROM p_folder_id
      OR file_row.name <> normalized_name
    THEN
      RAISE EXCEPTION 'Upload metadata must match the current logical file'
        USING ERRCODE = 'PT409';
    END IF;
  ELSE
    IF p_expected_version IS NOT NULL OR EXISTS (
      SELECT 1 FROM platform.company_knowledge_files file
      WHERE file.id = p_file_id
    ) THEN
      RAISE EXCEPTION 'Company knowledge file is unavailable'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  INSERT INTO platform_private.company_knowledge_upload_reservations(
    id, request_id, organization_id, folder_id, file_id, file_name,
    expected_version, uploader_profile_id, uploader_membership_id,
    uploader_auth_user_id, object_name, content_type, byte_size, sha256_hex,
    expires_at, created_at
  ) VALUES (
    reservation_id, p_request_id, actor.organization_id, p_folder_id,
    p_file_id, normalized_name, p_expected_version, actor.profile_id,
    actor.membership_id, actor.auth_user_id, object_name, normalized_type,
    p_byte_size, normalized_sha, expires_at, reserved_at
  );
  result := jsonb_build_object(
    'organization_id', actor.organization_id,
    'reservation_id', reservation_id, 'file_id', p_file_id,
    'folder_id', p_folder_id, 'file_name', normalized_name,
    'expected_version', p_expected_version,
    'bucket_id', 'platform-knowledge-files', 'object_name', object_name,
    'content_type', normalized_type, 'byte_size', p_byte_size,
    'sha256_hex', normalized_sha, 'expires_at', expires_at,
    'created_at', reserved_at
  );
  PERFORM platform_private.record_company_knowledge_command(
    p_request_id, actor.organization_id, actor.profile_id,
    actor.membership_id, actor.auth_user_id,
    'company.file.upload.reserve', 'company_knowledge_file', p_file_id,
    CASE WHEN file_row.id IS NULL THEN NULL ELSE to_jsonb(file_row) END,
    result, 'Staff reserved one exact private company file upload',
    input_payload, result
  );
  RETURN result;
END
$$;

CREATE FUNCTION platform.finalize_company_knowledge_file_upload(
  p_reservation_id uuid
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  reservation platform_private.company_knowledge_upload_reservations%rowtype;
  prior platform_private.company_knowledge_upload_finalizations%rowtype;
  file_row platform.company_knowledge_files%rowtype;
  object_row record;
  reported_size text;
  reported_type text;
  reported_user_sha text;
  reported_nested_sha text;
  reported_flat_sha text;
  new_version_id uuid := gen_random_uuid();
  new_version_no bigint;
  audit_id uuid := gen_random_uuid();
  audit_request_id uuid := gen_random_uuid();
  finalized_at timestamptz := statement_timestamp();
  result jsonb;
BEGIN
  IF (SELECT auth.jwt() ->> 'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service_role is required to finalize company file upload'
      USING ERRCODE = '42501';
  END IF;
  IF p_reservation_id IS NULL THEN
    RAISE EXCEPTION 'upload reservation id is required'
      USING ERRCODE = '22023';
  END IF;
  SELECT * INTO prior
  FROM platform_private.company_knowledge_upload_finalizations f
  WHERE f.upload_reservation_id = p_reservation_id;
  IF FOUND THEN RETURN prior.response; END IF;

  SELECT * INTO reservation
  FROM platform_private.company_knowledge_upload_reservations r
  WHERE r.id = p_reservation_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Company knowledge upload reservation is unavailable'
      USING ERRCODE = '42501';
  END IF;
  -- A concurrent retry can pass the fast replay lookup before the first
  -- finalizer commits. Recheck after the reservation row serializes both
  -- callers so the same reservation always returns the committed response.
  SELECT * INTO prior
  FROM platform_private.company_knowledge_upload_finalizations f
  WHERE f.upload_reservation_id = p_reservation_id;
  IF FOUND THEN RETURN prior.response; END IF;
  PERFORM platform_private.lock_company_knowledge_scope(
    reservation.organization_id
  );
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'evo:v3:company-file:' || reservation.file_id::text, 0
  ));

  SELECT object.created_at, object.metadata, to_jsonb(object) AS object_json
  INTO object_row
  FROM storage.objects object
  WHERE object.bucket_id = reservation.bucket_id
    AND object.name = reservation.object_name
  FOR SHARE;
  IF NOT FOUND OR object_row.created_at IS NULL
    OR object_row.created_at < reservation.created_at
    OR object_row.created_at > reservation.expires_at
  THEN
    RAISE EXCEPTION 'Exact company file object was not uploaded in reservation'
      USING ERRCODE = '55000';
  END IF;
  reported_size := object_row.metadata ->> 'size';
  reported_type := object_row.metadata ->> 'mimetype';
  reported_user_sha := object_row.object_json #>> '{user_metadata,sha256}';
  reported_nested_sha := object_row.metadata #>> '{metadata,sha256}';
  reported_flat_sha := object_row.metadata ->> 'sha256';
  IF reported_size IS NULL OR reported_size !~ '^[0-9]+$'
    OR reported_size::bigint <> reservation.byte_size
    OR lower(COALESCE(reported_type, '')) <> reservation.content_type
    OR COALESCE(reported_user_sha, reported_nested_sha, reported_flat_sha) IS NULL
    OR (reported_user_sha IS NOT NULL
      AND lower(reported_user_sha) <> reservation.sha256_hex)
    OR (reported_nested_sha IS NOT NULL
      AND lower(reported_nested_sha) <> reservation.sha256_hex)
    OR (reported_flat_sha IS NOT NULL
      AND lower(reported_flat_sha) <> reservation.sha256_hex)
  THEN
    RAISE EXCEPTION 'Exact company file Storage metadata does not match reservation'
      USING ERRCODE = '55000';
  END IF;

  SELECT * INTO file_row FROM platform.company_knowledge_files file
  WHERE file.organization_id = reservation.organization_id
    AND file.id = reservation.file_id
  FOR UPDATE;
  IF FOUND THEN
    IF file_row.removed_at IS NOT NULL
      OR reservation.expected_version IS NULL
      OR file_row.version <> reservation.expected_version
      OR file_row.version = 9223372036854775807
      OR file_row.folder_id IS DISTINCT FROM reservation.folder_id
      OR file_row.name <> reservation.file_name
    THEN
      RAISE EXCEPTION 'company_knowledge_file_version_conflict'
        USING ERRCODE = 'PT409';
    END IF;
    new_version_no := file_row.current_version_no + 1;
  ELSE
    IF reservation.expected_version IS NOT NULL OR EXISTS (
      SELECT 1 FROM platform.company_knowledge_files file
      WHERE file.id = reservation.file_id
    ) THEN
      RAISE EXCEPTION 'Company knowledge file is unavailable'
        USING ERRCODE = '42501';
    END IF;
    IF reservation.folder_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM platform.company_knowledge_folders folder
      WHERE folder.organization_id = reservation.organization_id
        AND folder.id = reservation.folder_id AND folder.removed_at IS NULL
    ) THEN
      RAISE EXCEPTION 'Company knowledge folder is unavailable'
        USING ERRCODE = '42501';
    END IF;
    INSERT INTO platform.company_knowledge_files(
      id, organization_id, folder_id, name, created_by_profile_id,
      created_at, updated_at
    ) VALUES (
      reservation.file_id, reservation.organization_id,
      reservation.folder_id, reservation.file_name,
      reservation.uploader_profile_id, finalized_at, finalized_at
    );
    new_version_no := 1;
  END IF;

  INSERT INTO platform.company_knowledge_file_versions(
    id, organization_id, file_id, version_no, upload_reservation_id,
    bucket_id, object_name, original_file_name, content_type, byte_size,
    sha256_hex, created_by_profile_id, storage_object_created_at, created_at
  ) VALUES (
    new_version_id, reservation.organization_id, reservation.file_id,
    new_version_no, reservation.id, reservation.bucket_id,
    reservation.object_name, reservation.file_name, reservation.content_type,
    reservation.byte_size, reservation.sha256_hex,
    reservation.uploader_profile_id, object_row.created_at, finalized_at
  );
  UPDATE platform.company_knowledge_files file SET
    current_file_version_id = new_version_id,
    current_version_no = new_version_no,
    version = CASE WHEN file_row.id IS NULL THEN 1 ELSE file_row.version + 1 END,
    updated_at = finalized_at
  WHERE file.organization_id = reservation.organization_id
    AND file.id = reservation.file_id;

  result := jsonb_build_object(
    'organization_id', reservation.organization_id,
    'reservation_id', reservation.id, 'file_id', reservation.file_id,
    'folder_id', reservation.folder_id, 'file_name', reservation.file_name,
    'version', CASE WHEN file_row.id IS NULL THEN 1 ELSE file_row.version + 1 END,
    'file_version_id', new_version_id, 'file_version_no', new_version_no,
    'bucket_id', reservation.bucket_id, 'object_name', reservation.object_name,
    'content_type', reservation.content_type, 'byte_size', reservation.byte_size,
    'sha256_hex', reservation.sha256_hex, 'finalized_at', finalized_at
  );
  INSERT INTO platform.audit_events(
    id, organization_id, actor_kind, actor_profile_id, actor_principal,
    action, resource_type, resource_id, before_state, after_state,
    reason, request_id
  ) VALUES (
    audit_id, reservation.organization_id, 'service', NULL,
    'evo-company-file-storage', 'company.file.upload.finalize',
    'company_knowledge_file', reservation.file_id,
    CASE WHEN file_row.id IS NULL THEN NULL ELSE to_jsonb(file_row) END,
    result, 'Trusted server finalized one exact private Storage object',
    audit_request_id
  );
  INSERT INTO platform_private.company_knowledge_upload_finalizations(
    organization_id, upload_reservation_id, file_id, file_version_id,
    audit_event_id, response, finalized_at
  ) VALUES (
    reservation.organization_id, reservation.id, reservation.file_id,
    new_version_id, audit_id, result, finalized_at
  );
  RETURN result;
END
$$;

CREATE FUNCTION platform.grant_company_knowledge_file_download(
  p_file_version_id uuid, p_request_id uuid
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  actor record;
  file_row record;
  grant_id uuid := gen_random_uuid();
  input_payload jsonb;
  replayed jsonb;
  result jsonb;
  granted_at timestamptz := statement_timestamp();
  expires_at timestamptz := granted_at + interval '60 seconds';
BEGIN
  IF p_file_version_id IS NULL OR p_request_id IS NULL THEN
    RAISE EXCEPTION 'file version id and request id are required'
      USING ERRCODE = '22023';
  END IF;
  PERFORM platform_private.lock_company_knowledge_request(p_request_id);
  SELECT * INTO actor FROM platform_private.require_admissions_runtime_actor(
    'document.download'
  );
  input_payload := jsonb_build_object('file_version_id', p_file_version_id);
  replayed := platform_private.replay_company_knowledge_command(
    p_request_id, actor.organization_id, actor.profile_id,
    actor.membership_id, actor.auth_user_id,
    'company.file.download.grant', input_payload
  );
  IF replayed IS NOT NULL THEN RETURN replayed; END IF;

  SELECT
    file.id AS file_id, file.name AS file_name,
    file_version.id AS file_version_id, file_version.bucket_id,
    file_version.object_name, file_version.content_type,
    file_version.byte_size, file_version.sha256_hex
  INTO file_row
  FROM platform.company_knowledge_file_versions file_version
  JOIN platform.company_knowledge_files file
    ON file.organization_id = file_version.organization_id
    AND file.id = file_version.file_id
  WHERE file_version.organization_id = actor.organization_id
    AND file_version.id = p_file_version_id
    AND file.removed_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Company knowledge file is unavailable'
      USING ERRCODE = '42501';
  END IF;

  result := jsonb_build_object(
    'organization_id', actor.organization_id, 'grant_id', grant_id,
    'file_id', file_row.file_id,
    'file_version_id', file_row.file_version_id,
    'bucket_id', file_row.bucket_id, 'object_name', file_row.object_name,
    'file_name', file_row.file_name, 'content_type', file_row.content_type,
    'byte_size', file_row.byte_size, 'sha256_hex', file_row.sha256_hex,
    'expires_at', expires_at, 'created_at', granted_at
  );
  INSERT INTO platform_private.company_knowledge_download_grants(
    id, request_id, organization_id, file_id, file_version_id,
    requester_profile_id, requester_membership_id, requester_auth_user_id,
    bucket_id, object_name, file_name, content_type, byte_size, sha256_hex,
    expires_at, created_at
  ) VALUES (
    grant_id, p_request_id, actor.organization_id, file_row.file_id,
    file_row.file_version_id, actor.profile_id, actor.membership_id,
    actor.auth_user_id, file_row.bucket_id, file_row.object_name,
    file_row.file_name, file_row.content_type, file_row.byte_size,
    file_row.sha256_hex, expires_at, granted_at
  );
  PERFORM platform_private.record_company_knowledge_command(
    p_request_id, actor.organization_id, actor.profile_id,
    actor.membership_id, actor.auth_user_id,
    'company.file.download.grant', 'company_knowledge_file',
    file_row.file_id, NULL, result,
    'Staff granted one bounded company file download', input_payload, result
  );
  RETURN result;
END
$$;

CREATE FUNCTION platform.consume_company_knowledge_file_download_grant(
  p_grant_id uuid
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  grant_row platform_private.company_knowledge_download_grants%rowtype;
  audit_id uuid := gen_random_uuid();
  audit_request_id uuid := gen_random_uuid();
  consumed_at timestamptz := statement_timestamp();
  result jsonb;
BEGIN
  IF (SELECT auth.jwt() ->> 'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service_role is required to consume company file grant'
      USING ERRCODE = '42501';
  END IF;
  IF p_grant_id IS NULL THEN
    RAISE EXCEPTION 'download grant id is required' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO grant_row
  FROM platform_private.company_knowledge_download_grants grant_candidate
  WHERE grant_candidate.id = p_grant_id
  FOR UPDATE;
  IF NOT FOUND OR grant_row.expires_at <= consumed_at THEN
    RAISE EXCEPTION 'Live company file download grant is required'
      USING ERRCODE = '42501';
  END IF;
  IF EXISTS (
    SELECT 1 FROM platform_private.company_knowledge_download_consumptions c
    WHERE c.download_grant_id = p_grant_id
  ) THEN
    RAISE EXCEPTION 'Company file download grant was already consumed'
      USING ERRCODE = '23505';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM platform.company_knowledge_files file
    JOIN platform.company_knowledge_file_versions file_version
      ON file_version.organization_id = file.organization_id
      AND file_version.file_id = file.id
      AND file_version.id = grant_row.file_version_id
    WHERE file.organization_id = grant_row.organization_id
      AND file.id = grant_row.file_id AND file.removed_at IS NULL
  ) OR NOT EXISTS (
    SELECT 1 FROM storage.objects object
    WHERE object.bucket_id = grant_row.bucket_id
      AND object.name = grant_row.object_name
  ) THEN
    RAISE EXCEPTION 'Private company file object is unavailable'
      USING ERRCODE = '42501';
  END IF;
  result := jsonb_build_object(
    'organization_id', grant_row.organization_id,
    'grant_id', grant_row.id, 'file_id', grant_row.file_id,
    'file_version_id', grant_row.file_version_id,
    'bucket_id', grant_row.bucket_id, 'object_name', grant_row.object_name,
    'file_name', grant_row.file_name, 'content_type', grant_row.content_type,
    'byte_size', grant_row.byte_size, 'sha256_hex', grant_row.sha256_hex,
    'expires_at', grant_row.expires_at, 'consumed_at', consumed_at
  );
  INSERT INTO platform.audit_events(
    id, organization_id, actor_kind, actor_profile_id, actor_principal,
    action, resource_type, resource_id, before_state, after_state,
    reason, request_id
  ) VALUES (
    audit_id, grant_row.organization_id, 'service', NULL,
    'evo-company-file-storage', 'company.file.download.consume',
    'company_knowledge_file', grant_row.file_id, NULL, result,
    'Trusted server consumed one bounded company file download grant',
    audit_request_id
  );
  INSERT INTO platform_private.company_knowledge_download_consumptions(
    organization_id, download_grant_id, audit_event_id, response, consumed_at
  ) VALUES (
    grant_row.organization_id, grant_row.id, audit_id, result, consumed_at
  );
  RETURN result;
END
$$;

-- Audit export remains deliberately allowlisted. Extend the current tip rather
-- than replacing earlier safe actions.
ALTER FUNCTION platform_private.p7a_safe_audit_actions()
  RENAME TO p7a_safe_audit_actions_pre_v3_company_files;
CREATE FUNCTION platform_private.p7a_safe_audit_actions()
RETURNS text[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT ARRAY(
    SELECT DISTINCT action
    FROM unnest(
      platform_private.p7a_safe_audit_actions_pre_v3_company_files()
      || ARRAY[
        'company.folder.create', 'company.folder.rename',
        'company.folder.move', 'company.folder.remove',
        'company.file.rename', 'company.file.move', 'company.file.remove',
        'company.file.upload.reserve', 'company.file.upload.finalize',
        'company.file.download.grant', 'company.file.download.consume'
      ]::text[]
    ) action
    ORDER BY action
  )
$$;

ALTER FUNCTION platform_private.p7a_safe_audit_resource_types()
  RENAME TO p7a_safe_audit_resource_types_pre_v3_company_files;
CREATE FUNCTION platform_private.p7a_safe_audit_resource_types()
RETURNS text[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT ARRAY(
    SELECT DISTINCT resource_type
    FROM unnest(
      platform_private.p7a_safe_audit_resource_types_pre_v3_company_files()
      || ARRAY[
        'company_knowledge_folder',
        'company_knowledge_file'
      ]::text[]
    ) resource_type
    ORDER BY resource_type
  )
$$;

REVOKE ALL PRIVILEGES ON platform.company_knowledge_folders
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL PRIVILEGES ON platform.company_knowledge_files
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL PRIVILEGES ON platform.company_knowledge_file_versions
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL PRIVILEGES
  ON platform_private.company_knowledge_upload_reservations,
     platform_private.company_knowledge_upload_finalizations,
     platform_private.company_knowledge_download_grants,
     platform_private.company_knowledge_download_consumptions,
     platform_private.company_knowledge_command_receipts
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

REVOKE ALL ON FUNCTION platform_private.lock_company_knowledge_request(uuid)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON FUNCTION platform_private.lock_company_knowledge_scope(uuid)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON FUNCTION platform_private.company_knowledge_name(text, integer)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON FUNCTION platform_private.replay_company_knowledge_command(
  uuid, uuid, uuid, uuid, uuid, text, jsonb
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON FUNCTION platform_private.record_company_knowledge_command(
  uuid, uuid, uuid, uuid, uuid, text, text, uuid, jsonb, jsonb,
  text, jsonb, jsonb
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON FUNCTION platform_private.mutate_company_knowledge_folder(
  text, uuid, uuid, text, bigint, uuid
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON FUNCTION platform_private.mutate_company_knowledge_file(
  text, uuid, uuid, text, bigint, uuid
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON FUNCTION
  platform_private.p7a_safe_audit_actions_pre_v3_company_files()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON FUNCTION platform_private.p7a_safe_audit_actions()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON FUNCTION
  platform_private.p7a_safe_audit_resource_types_pre_v3_company_files()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON FUNCTION platform_private.p7a_safe_audit_resource_types()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

REVOKE ALL ON FUNCTION platform.list_company_knowledge_folders()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.list_company_knowledge_folders()
  TO authenticated;
REVOKE ALL ON FUNCTION platform.list_company_knowledge_files()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.list_company_knowledge_files()
  TO authenticated;
REVOKE ALL ON FUNCTION platform.create_company_knowledge_folder(
  uuid, text, uuid
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.create_company_knowledge_folder(
  uuid, text, uuid
) TO authenticated;
REVOKE ALL ON FUNCTION platform.rename_company_knowledge_folder(
  uuid, text, bigint, uuid
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.rename_company_knowledge_folder(
  uuid, text, bigint, uuid
) TO authenticated;
REVOKE ALL ON FUNCTION platform.move_company_knowledge_folder(
  uuid, uuid, bigint, uuid
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.move_company_knowledge_folder(
  uuid, uuid, bigint, uuid
) TO authenticated;
REVOKE ALL ON FUNCTION platform.remove_company_knowledge_folder(
  uuid, bigint, uuid
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.remove_company_knowledge_folder(
  uuid, bigint, uuid
) TO authenticated;
REVOKE ALL ON FUNCTION platform.rename_company_knowledge_file(
  uuid, text, bigint, uuid
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.rename_company_knowledge_file(
  uuid, text, bigint, uuid
) TO authenticated;
REVOKE ALL ON FUNCTION platform.move_company_knowledge_file(
  uuid, uuid, bigint, uuid
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.move_company_knowledge_file(
  uuid, uuid, bigint, uuid
) TO authenticated;
REVOKE ALL ON FUNCTION platform.remove_company_knowledge_file(
  uuid, bigint, uuid
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.remove_company_knowledge_file(
  uuid, bigint, uuid
) TO authenticated;
REVOKE ALL ON FUNCTION platform.reserve_company_knowledge_file_upload(
  uuid, uuid, text, text, bigint, text, uuid, bigint
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.reserve_company_knowledge_file_upload(
  uuid, uuid, text, text, bigint, text, uuid, bigint
) TO authenticated;
REVOKE ALL ON FUNCTION platform.grant_company_knowledge_file_download(
  uuid, uuid
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.grant_company_knowledge_file_download(
  uuid, uuid
) TO authenticated;
REVOKE ALL ON FUNCTION platform.finalize_company_knowledge_file_upload(uuid)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.finalize_company_knowledge_file_upload(uuid)
  TO service_role;
REVOKE ALL ON FUNCTION
  platform.consume_company_knowledge_file_download_grant(uuid)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION
  platform.consume_company_knowledge_file_download_grant(uuid)
  TO service_role;

COMMENT ON TABLE platform.company_knowledge_files IS
  'Canonical logical V3 company files. Student documents and AI text knowledge are not copied here.';
COMMENT ON TABLE platform.company_knowledge_file_versions IS
  'Immutable exact private Storage-backed versions for canonical company files.';
COMMENT ON FUNCTION platform.reserve_company_knowledge_file_upload(
  uuid, uuid, text, text, bigint, text, uuid, bigint
) IS
  'Reserves one server-uploaded opaque object; creates no browser Storage permission.';

COMMIT;
