\set ON_ERROR_STOP on
\set ON_ERROR_ROLLBACK on

-- Behavioural proof for the catalog programme layer. Every row is synthetic,
-- the outer transaction is rolled back, and no provider, source content or
-- customer data is present.
BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.assert_true(
  p_condition BOOLEAN,
  p_message TEXT
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_condition IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'Catalog programme assertion failed: %', p_message;
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION pg_temp.assert_rejects(
  p_statement TEXT,
  p_message TEXT
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  BEGIN
    EXECUTE p_statement;
  EXCEPTION
    WHEN OTHERS THEN
      RETURN;
  END;
  RAISE EXCEPTION 'Catalog programme assertion failed: %', p_message;
END
$$;

-- Reuse the organizations and admin memberships created by the identity
-- fixture rather than inventing a second identity model.
SELECT
  membership.organization_id AS org_a,
  membership.id AS admin_a_membership
FROM platform.organization_memberships AS membership
JOIN platform.profiles AS profile ON profile.id = membership.profile_id
WHERE profile.auth_user_id = '10000000-0000-4000-8000-000000000001'
\gset

SELECT
  membership.organization_id AS org_b,
  membership.id AS admin_b_membership
FROM platform.organization_memberships AS membership
JOIN platform.profiles AS profile ON profile.id = membership.profile_id
WHERE profile.auth_user_id = '10000000-0000-4000-8000-000000000008'
\gset

-- The two organizations must genuinely differ, otherwise every
-- cross-organization assertion below would pass vacuously. psql does not
-- substitute variables inside dollar-quoted blocks, so this is a plain call.
SELECT pg_temp.assert_true(
  :'org_a'::UUID <> :'org_b'::UUID,
  'Fixture organizations must differ for cross-tenant assertions'
);

-- A knowledge-vault source, one batch and one approved institution per
-- organization. Provenance values are fixed so the assertions below are exact.
-- A reviewed source must carry its full review metadata; the constraint
-- rejects a review status without a reviewer, role and timestamp.
INSERT INTO platform.source_registry (
  id, organization_id, source_key, source_kind, source_url,
  source_revision, review_status, created_by_membership_id,
  reviewed_by_membership_id, reviewer_role, reviewed_at
) VALUES (
  '9a000000-0000-4000-8000-000000000001',
  :'org_a',
  'src_' || repeat('a', 32),
  'knowledge_vault',
  'evo-knowledge://internal/' || repeat('b', 64),
  'vaultrev-000001',
  'reviewed',
  :'admin_a_membership',
  :'admin_a_membership',
  'admin',
  statement_timestamp()
);

-- An approved batch must carry both validation and review metadata; the
-- constraint refuses an approval that skipped either step.
INSERT INTO platform.catalog_import_batches (
  id, organization_id, source_registry_id, source_revision,
  institution_kind, status, created_by_membership_id,
  validated_by_membership_id, validated_at,
  reviewed_by_membership_id, reviewed_at, review_reason
) VALUES (
  '9b000000-0000-4000-8000-000000000001',
  :'org_a',
  '9a000000-0000-4000-8000-000000000001',
  'vaultrev-000001',
  'university',
  'approved',
  :'admin_a_membership',
  :'admin_a_membership',
  statement_timestamp(),
  :'admin_a_membership',
  statement_timestamp(),
  'Synthetic fixture batch for the programme boundary proof'
);

INSERT INTO platform.catalog_institutions (
  id, organization_id, institution_kind, institution_name, country_code,
  source_registry_id, source_revision, import_batch_id, source_record_key,
  approved_by_membership_id
) VALUES (
  '9c000000-0000-4000-8000-000000000001',
  :'org_a',
  'university',
  'INTI International University and Colleges',
  'MY',
  '9a000000-0000-4000-8000-000000000001',
  'vaultrev-000001',
  '9b000000-0000-4000-8000-000000000001',
  'rec_' || repeat('a', 32),
  :'admin_a_membership'
);

-- A full-time programme is accepted with its literal duration and intakes.
INSERT INTO platform.catalog_programmes (
  id, organization_id, catalog_institution_id, programme_level, study_mode,
  programme_name, duration_months, intake_months,
  source_registry_id, source_revision, import_batch_id, source_record_key,
  approved_by_membership_id
) VALUES (
  '9d000000-0000-4000-8000-000000000001',
  :'org_a',
  '9c000000-0000-4000-8000-000000000001',
  'diploma',
  'full_time',
  'INTI Diploma in Business',
  24,
  ARRAY[1, 5, 8]::SMALLINT[],
  '9a000000-0000-4000-8000-000000000001',
  'vaultrev-000001',
  '9b000000-0000-4000-8000-000000000001',
  'rec_' || repeat('b', 32),
  :'admin_a_membership'
);

-- The same programme in part-time form is a second record, not a conflict.
-- This is the measured case: 34 of 104 programmes state duration per mode.
INSERT INTO platform.catalog_programmes (
  id, organization_id, catalog_institution_id, programme_level, study_mode,
  programme_name, duration_months, intake_months,
  source_registry_id, source_revision, import_batch_id, source_record_key,
  approved_by_membership_id
) VALUES (
  '9d000000-0000-4000-8000-000000000002',
  :'org_a',
  '9c000000-0000-4000-8000-000000000001',
  'diploma',
  'part_time',
  'INTI Diploma in Business',
  48,
  ARRAY[1, 5, 8]::SMALLINT[],
  '9a000000-0000-4000-8000-000000000001',
  'vaultrev-000001',
  '9b000000-0000-4000-8000-000000000001',
  'rec_' || repeat('c', 32),
  :'admin_a_membership'
);

-- A duration-free programme is legitimate: the source often states none.
INSERT INTO platform.catalog_programmes (
  id, organization_id, catalog_institution_id, programme_level, study_mode,
  programme_name, duration_months,
  source_registry_id, source_revision, import_batch_id, source_record_key,
  approved_by_membership_id
) VALUES (
  '9d000000-0000-4000-8000-000000000003',
  :'org_a',
  '9c000000-0000-4000-8000-000000000001',
  'transfer_programme',
  'full_time',
  'INTI American Degree Transfer Program',
  NULL,
  '9a000000-0000-4000-8000-000000000001',
  'vaultrev-000001',
  '9b000000-0000-4000-8000-000000000001',
  'rec_' || repeat('d', 32),
  :'admin_a_membership'
);

DO $$
DECLARE
  stored_duration SMALLINT;
BEGIN
  IF (
    SELECT count(*) FROM platform.catalog_programmes
    WHERE programme_name = 'INTI Diploma in Business'
  ) <> 2 THEN
    RAISE EXCEPTION
      'Full-time and part-time forms must coexist as two records';
  END IF;

  SELECT duration_months INTO stored_duration
  FROM platform.catalog_programmes
  WHERE id = '9d000000-0000-4000-8000-000000000003';

  IF stored_duration IS NOT NULL THEN
    RAISE EXCEPTION 'An absent duration must stay absent, not default';
  END IF;
END
$$;

-- Negative cases.
SELECT pg_temp.assert_rejects(
  format(
    $stmt$
      INSERT INTO platform.catalog_programmes (
        organization_id, catalog_institution_id, programme_level, study_mode,
        programme_name, source_registry_id, source_revision, import_batch_id,
        source_record_key, approved_by_membership_id
      ) VALUES (
        %L, '9c000000-0000-4000-8000-000000000001', 'diploma', 'full_time',
        'INTI  Diploma   in Business',
        '9a000000-0000-4000-8000-000000000001', 'vaultrev-000001',
        '9b000000-0000-4000-8000-000000000001', 'rec_%s', %L
      )
    $stmt$,
    :'org_a', repeat('e', 32), :'admin_a_membership'
  ),
  'A duplicate name, level and mode must be rejected despite whitespace'
);

SELECT pg_temp.assert_rejects(
  format(
    $stmt$
      INSERT INTO platform.catalog_programmes (
        organization_id, catalog_institution_id, programme_level, study_mode,
        programme_name, source_registry_id, source_revision, import_batch_id,
        source_record_key, approved_by_membership_id
      ) VALUES (
        %L, '9c000000-0000-4000-8000-000000000001', 'bachelor', 'full_time',
        'Cross organization programme',
        '9a000000-0000-4000-8000-000000000001', 'vaultrev-000001',
        '9b000000-0000-4000-8000-000000000001', 'rec_%s', %L
      )
    $stmt$,
    :'org_b', repeat('f', 32), :'admin_b_membership'
  ),
  'A programme must not attach to an institution of another organization'
);

SELECT pg_temp.assert_rejects(
  format(
    $stmt$
      INSERT INTO platform.catalog_programmes (
        organization_id, catalog_institution_id, programme_level, study_mode,
        programme_name, source_registry_id, source_revision, import_batch_id,
        source_record_key, approved_by_membership_id
      ) VALUES (
        %L, '9c000000-0000-4000-8000-000000000001', 'master', 'online',
        'Wrong provenance programme',
        '9a000000-0000-4000-8000-000000000001', 'vaultrev-999999',
        '9b000000-0000-4000-8000-000000000001', 'rec_%s', %L
      )
    $stmt$,
    :'org_a', repeat('1', 32), :'admin_a_membership'
  ),
  'A programme must not claim a revision its batch does not have'
);

SELECT pg_temp.assert_rejects(
  $stmt$
    UPDATE platform.catalog_programmes
    SET programme_name = 'Renamed after approval'
    WHERE id = '9d000000-0000-4000-8000-000000000001'
  $stmt$,
  'An approved programme must be immutable'
);

SELECT pg_temp.assert_rejects(
  $stmt$
    DELETE FROM platform.catalog_programmes
    WHERE id = '9d000000-0000-4000-8000-000000000001'
  $stmt$,
  'An approved programme must be retained for audit'
);

SELECT pg_temp.assert_rejects(
  format(
    $stmt$
      INSERT INTO platform.catalog_programmes (
        organization_id, catalog_institution_id, programme_level, study_mode,
        programme_name, intake_months,
        source_registry_id, source_revision, import_batch_id,
        source_record_key, approved_by_membership_id
      ) VALUES (
        %L, '9c000000-0000-4000-8000-000000000001', 'master', 'online',
        'Bad intake programme', ARRAY[13]::SMALLINT[],
        '9a000000-0000-4000-8000-000000000001', 'vaultrev-000001',
        '9b000000-0000-4000-8000-000000000001', 'rec_%s', %L
      )
    $stmt$,
    :'org_a', repeat('2', 32), :'admin_a_membership'
  ),
  'An out-of-range intake month must be rejected'
);

-- A candidate attached to an institution of another organization cannot exist,
-- so an unapproved institution can never be promoted by accident.
SELECT pg_temp.assert_rejects(
  format(
    $stmt$
      INSERT INTO platform.catalog_programme_candidates (
        organization_id, catalog_import_batch_id, source_record_key,
        institution_id, programme_name, programme_level, study_mode,
        created_by_membership_id
      ) VALUES (
        %L, '9b000000-0000-4000-8000-000000000001', 'rec_%s',
        '9c000000-0000-4000-8000-000000000001', 'Foreign candidate',
        'diploma', 'full_time', %L
      )
    $stmt$,
    :'org_b', repeat('3', 32), :'admin_b_membership'
  ),
  'A candidate must not reference an institution of another organization'
);

-- A candidate may not be marked valid while carrying validation errors.
SELECT pg_temp.assert_rejects(
  format(
    $stmt$
      INSERT INTO platform.catalog_programme_candidates (
        organization_id, catalog_import_batch_id, source_record_key,
        institution_id, programme_name, programme_level, study_mode,
        validation_status, validation_errors, created_by_membership_id
      ) VALUES (
        %L, '9b000000-0000-4000-8000-000000000001', 'rec_%s',
        '9c000000-0000-4000-8000-000000000001', 'Contradictory candidate',
        'diploma', 'full_time', 'valid', ARRAY['missing_level'], %L
      )
    $stmt$,
    :'org_a', repeat('4', 32), :'admin_a_membership'
  ),
  'A valid candidate must not carry validation errors'
);

ROLLBACK;
