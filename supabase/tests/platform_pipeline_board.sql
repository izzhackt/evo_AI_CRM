\set ON_ERROR_STOP on
-- Privilege-boundary suite for migration 186 (OTH-1 «Воронка поступления»).
-- Isolated synthetic SQL fixtures only -- no Auth invitation, real customer or
-- provider action. Style follows supabase/tests/platform_admissions_playbook_boundary.sql
-- (a137's direct student_cases fixture under session_replication_role=replica,
-- and its manual JWT-claims actor simulation) and
-- supabase/tests/platform_cabinet_invites.sql (SET request.jwt.claims /
-- SET ROLE authenticated / RESET ROLE per actor).
BEGIN;

CREATE FUNCTION pg_temp.p186_id(n INTEGER) RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$
  SELECT ('59186000-0000-4000-8000-' || lpad(n::TEXT, 12, '0'))::UUID
$$;
CREATE FUNCTION pg_temp.p186_assert(ok BOOLEAN, message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'P186: %', message; END IF;
END
$$;
CREATE FUNCTION pg_temp.p186_error(sql TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE sql; RETURN 'ok';
EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE;
END
$$;
GRANT EXECUTE ON FUNCTION pg_temp.p186_id(INTEGER), pg_temp.p186_assert(BOOLEAN, TEXT), pg_temp.p186_error(TEXT)
  TO authenticated, anon, service_role;

SELECT 'P186_PIPELINE_BOARD_SUITE_START' AS p186_suite_marker;

-- ---------------------------------------------------------------------------
-- Fixture: one organization; admin (n1), sales (n2), curator A (n3, assigned
-- to the board's active case), curator B (n4, no access to it), student (n5).
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE p186_actors(n INTEGER, role platform.business_role, claims TEXT);
INSERT INTO p186_actors(n, role) VALUES
  (1, 'admin'), (2, 'sales'), (3, 'curator'), (4, 'curator'), (5, 'student');

INSERT INTO platform.organizations(id, name) VALUES (pg_temp.p186_id(1), 'P186 Fictional organization');
INSERT INTO auth.users(id, email, raw_user_meta_data)
  SELECT pg_temp.p186_id(100 + n), 'p186-' || n || '@example.invalid', '{}'::JSONB FROM p186_actors;
INSERT INTO platform.profiles(id, auth_user_id, display_name, status, access_version)
  SELECT pg_temp.p186_id(200 + n), pg_temp.p186_id(100 + n), 'P186 Actor ' || n, 'active', 1 FROM p186_actors;
INSERT INTO platform.organization_memberships(id, organization_id, profile_id, status, "current_role", current_bundle_id)
  SELECT pg_temp.p186_id(300 + n), pg_temp.p186_id(1), pg_temp.p186_id(200 + n), 'active', role,
    (SELECT id FROM platform.role_bundle_versions WHERE role = a.role AND status = 'published' ORDER BY version DESC LIMIT 1)
  FROM p186_actors a;

UPDATE platform.organization_memberships SET is_system_admin = TRUE
  WHERE id = pg_temp.p186_id(301);

INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version)
  VALUES (pg_temp.p186_id(401), pg_temp.p186_id(1), 'organization', pg_temp.p186_id(1), 1);
-- Per-case scopes: only curator A (n3) is granted access to either case.
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version)
  VALUES
    (pg_temp.p186_id(410), pg_temp.p186_id(1), 'student_case', pg_temp.p186_id(501), 1),
    (pg_temp.p186_id(411), pg_temp.p186_id(1), 'student_case', pg_temp.p186_id(502), 1);
INSERT INTO platform.membership_scope_assignments(organization_id, membership_id, scope_id, scope_version, assignment_version, granted, actor_kind, reason, request_id)
  SELECT pg_temp.p186_id(1), pg_temp.p186_id(300 + n), pg_temp.p186_id(401), 1, 1, TRUE, 'system', 'P186 synthetic organization scope', pg_temp.p186_id(600 + n)
  FROM p186_actors a WHERE n IN (1);
INSERT INTO platform.membership_scope_assignments(organization_id, membership_id, scope_id, scope_version, assignment_version, granted, actor_kind, reason, request_id)
  VALUES
    (pg_temp.p186_id(1), pg_temp.p186_id(303), pg_temp.p186_id(410), 1, 1, TRUE, 'system', 'P186 curator A case scope', pg_temp.p186_id(620)),
    (pg_temp.p186_id(1), pg_temp.p186_id(303), pg_temp.p186_id(411), 1, 1, TRUE, 'system', 'P186 curator A case scope', pg_temp.p186_id(621));

SET LOCAL session_replication_role = replica;
-- Case 501: active, assigned to curator A, EU-direction (non-playbook), so no
-- admissions_playbook_version_id — the trigger-safety note in 186's own
-- migration applies to configured cases too, but this fixture stays simple.
INSERT INTO platform.student_cases(
  id, organization_id, responsible_sales_membership_id, current_curator_membership_id,
  source_key, student_display_name, target_country, target_degree, operational_stage,
  state, handoff_at, current_scope_id, current_scope_version
) VALUES (
  pg_temp.p186_id(501), pg_temp.p186_id(1), pg_temp.p186_id(302), pg_temp.p186_id(303),
  'synthetic:p186:501', 'P186 Student Active', 'CZ', 'Bachelor', 'contract_confirmed',
  'active', clock_timestamp(), pg_temp.p186_id(410), 1
);
-- Case 502: closed, also curator A's — moving it must be rejected.
INSERT INTO platform.student_cases(
  id, organization_id, responsible_sales_membership_id, current_curator_membership_id,
  source_key, student_display_name, target_country, target_degree, operational_stage,
  state, handoff_at, closed_at, current_scope_id, current_scope_version
) VALUES (
  pg_temp.p186_id(502), pg_temp.p186_id(1), pg_temp.p186_id(302), pg_temp.p186_id(303),
  'synthetic:p186:502', 'P186 Student Closed', 'IT', 'Bachelor', 'completed',
  'closed', clock_timestamp(), clock_timestamp(), pg_temp.p186_id(411), 1
);
INSERT INTO platform.university_applications(id, organization_id, student_case_id, institution_name, program_name, status, created_by_membership_id, is_primary)
  VALUES (pg_temp.p186_id(970), pg_temp.p186_id(1), pg_temp.p186_id(501), 'P186 Synthetic University', 'P186 Programme', 'preparation', pg_temp.p186_id(301), TRUE);
SET LOCAL session_replication_role = origin;

UPDATE p186_actors a SET claims = jsonb_build_object(
  'sub', p.auth_user_id, 'role', 'authenticated', 'platform_role', a.role,
  'platform_access_version', p.access_version, 'platform_organization_id', m.organization_id,
  'platform_membership_id', m.id, 'platform_bundle_id', b.id, 'platform_bundle_version', b.version
)::TEXT
FROM platform.profiles p JOIN platform.organization_memberships m ON m.profile_id = p.id
  JOIN platform.role_bundle_versions b ON b.id = m.current_bundle_id
WHERE p.id = pg_temp.p186_id(200 + a.n);
GRANT SELECT ON p186_actors TO authenticated;

SELECT claims AS p186_admin FROM p186_actors WHERE n = 1 \gset

-- ---------------------------------------------------------------------------
-- Grant the curator role: one staff_role_definitions/role_bundle_versions pair
-- publishing 'case.read.full' + 'case.update.append', assigned to BOTH
-- curators with scope_kind='own' (the 155/173 surface, exactly as
-- platform_cabinet_invites.sql does for Sales). 'own' scopes to the cases the
-- membership actually curates, which is what makes curator B's negative
-- checks below a genuine resource-scope boundary, not a missing-grant one.
-- ---------------------------------------------------------------------------
SET request.jwt.claims TO :'p186_admin';
SET ROLE authenticated;
SELECT platform.staff_role_command(
  pg_temp.p186_id(1), pg_temp.p186_id(701), 0, 'create',
  jsonb_build_object(
    'label', 'P186 Curator casework',
    'description', 'Migration 186 synthetic curator casework role',
    'permissionKeys', jsonb_build_array('case.read.full', 'case.update.append')
  ),
  'P186 create curator casework role', pg_temp.p186_id(711)
) AS p186_role_created \gset
SELECT platform.staff_role_impact(pg_temp.p186_id(1), pg_temp.p186_id(701), 1)
  ->> 'impactFingerprint' AS p186_role_impact \gset
SELECT platform.staff_role_publish(
  pg_temp.p186_id(1), pg_temp.p186_id(701), 1, :'p186_role_impact',
  'P186 publish curator casework role', pg_temp.p186_id(712)
) AS p186_role_published \gset
SELECT (:'p186_role_published'::JSONB ->> 'bundleId') AS p186_role_bundle_id \gset
SELECT platform.staff_role_assignments_save(
  pg_temp.p186_id(1), pg_temp.p186_id(303), 1,
  jsonb_build_array(jsonb_build_object('roleId', pg_temp.p186_id(701), 'scope', jsonb_build_object('kind', 'own', 'key', NULL, 'resourceKind', NULL))),
  jsonb_build_array(jsonb_build_object('roleId', pg_temp.p186_id(701), 'roleVersion', 2, 'bundleId', :'p186_role_bundle_id'::UUID, 'bundleVersion', 1)),
  'P186 grant curator A casework', pg_temp.p186_id(713)
) AS p186_curator_a_granted \gset
SELECT platform.staff_role_assignments_save(
  pg_temp.p186_id(1), pg_temp.p186_id(304), 1,
  jsonb_build_array(jsonb_build_object('roleId', pg_temp.p186_id(701), 'scope', jsonb_build_object('kind', 'own', 'key', NULL, 'resourceKind', NULL))),
  jsonb_build_array(jsonb_build_object('roleId', pg_temp.p186_id(701), 'roleVersion', 2, 'bundleId', :'p186_role_bundle_id'::UUID, 'bundleVersion', 1)),
  'P186 grant curator B casework', pg_temp.p186_id(714)
) AS p186_curator_b_granted \gset
RESET ROLE;

-- The grants bump access versions: rebuild every actor's claims from live
-- rows so stale platform_access_version values never fail actor resolution.
UPDATE p186_actors a SET claims = jsonb_build_object(
  'sub', p.auth_user_id, 'role', 'authenticated', 'platform_role', a.role,
  'platform_access_version', p.access_version, 'platform_organization_id', m.organization_id,
  'platform_membership_id', m.id, 'platform_bundle_id', b.id, 'platform_bundle_version', b.version
)::TEXT
FROM platform.profiles p JOIN platform.organization_memberships m ON m.profile_id = p.id
  JOIN platform.role_bundle_versions b ON b.id = m.current_bundle_id
WHERE p.id = pg_temp.p186_id(200 + a.n);

SELECT claims AS p186_curator_a FROM p186_actors WHERE n = 3 \gset
SELECT claims AS p186_curator_b FROM p186_actors WHERE n = 4 \gset
SELECT claims AS p186_student FROM p186_actors WHERE n = 5 \gset

-- ---------------------------------------------------------------------------
-- Curator A: board read includes the active case, excludes the closed one.
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims TO :'p186_curator_a';
SET LOCAL ROLE authenticated;

SELECT platform.staff_admissions_pipeline_board_v1() AS p186_board_a \gset
SELECT pg_temp.p186_assert(
  (SELECT count(*) = 1 FROM jsonb_array_elements(:'p186_board_a'::JSONB -> 'rows') r WHERE r ->> 'student_case_id' = pg_temp.p186_id(501)::TEXT),
  'curator A sees their own active case exactly once'
);
SELECT pg_temp.p186_assert(
  NOT EXISTS (SELECT 1 FROM jsonb_array_elements(:'p186_board_a'::JSONB -> 'rows') r WHERE r ->> 'student_case_id' = pg_temp.p186_id(502)::TEXT),
  'closed case never appears on the board'
);
SELECT pg_temp.p186_assert(
  (SELECT r ->> 'pipeline_stage' = 'new' AND r ->> 'primary_institution_name' = 'P186 Synthetic University'
     AND (r ->> 'awaiting_ack')::BOOLEAN = FALSE
   FROM jsonb_array_elements(:'p186_board_a'::JSONB -> 'rows') r WHERE r ->> 'student_case_id' = pg_temp.p186_id(501)::TEXT),
  'board row carries the default stage, primary institution and a false attention flag'
);
SELECT pg_temp.p186_assert((:'p186_board_a'::JSONB ->> 'truncated')::BOOLEAN = FALSE, 'small fixture is never truncated');

-- Move: curator A moves their own active case forward.
SELECT platform.move_case_pipeline_v1(pg_temp.p186_id(1), pg_temp.p186_id(501), 'documents', FALSE, pg_temp.p186_id(901)) AS p186_move_receipt \gset
SELECT pg_temp.p186_assert(:'p186_move_receipt'::JSONB ->> 'pipeline_stage' = 'documents', 'move persists the new stage in the receipt');
SELECT pg_temp.p186_assert((SELECT pipeline_stage FROM platform.student_cases WHERE id = pg_temp.p186_id(501)) = 'documents', 'move persists the new stage on the row');

-- Replay: same request id, same arguments -> identical receipt, no new audit row.
SELECT pg_temp.p186_assert(
  platform.move_case_pipeline_v1(pg_temp.p186_id(1), pg_temp.p186_id(501), 'documents', FALSE, pg_temp.p186_id(901)) = :'p186_move_receipt'::JSONB,
  'exact replay returns the identical receipt'
);

-- Same request id, different arguments -> conflict, not a silent replay.
SELECT pg_temp.p186_assert(
  pg_temp.p186_error(format('SELECT platform.move_case_pipeline_v1(%L,%L,%L,%L,%L)', pg_temp.p186_id(1), pg_temp.p186_id(501), 'visa', FALSE, pg_temp.p186_id(901))) = '22023',
  'reused request id with different input is a request_id conflict, not a replay'
);

-- Invalid commands: both stage and remove, neither, or an unknown stage key.
SELECT pg_temp.p186_assert(
  pg_temp.p186_error(format('SELECT platform.move_case_pipeline_v1(%L,%L,%L,%L,%L)', pg_temp.p186_id(1), pg_temp.p186_id(501), 'visa', TRUE, gen_random_uuid())) = '22023',
  'stage and remove together is invalid'
);
SELECT pg_temp.p186_assert(
  pg_temp.p186_error(format('SELECT platform.move_case_pipeline_v1(%L,%L,NULL,%L,%L)', pg_temp.p186_id(1), pg_temp.p186_id(501), FALSE, gen_random_uuid())) = '22023',
  'neither stage nor remove is invalid'
);
SELECT pg_temp.p186_assert(
  pg_temp.p186_error(format('SELECT platform.move_case_pipeline_v1(%L,%L,%L,%L,%L)', pg_temp.p186_id(1), pg_temp.p186_id(501), 'not_a_stage', FALSE, gen_random_uuid())) = '22023',
  'unknown stage key is invalid'
);

-- Moving a closed case is rejected even for its own assigned curator.
SELECT pg_temp.p186_assert(
  pg_temp.p186_error(format('SELECT platform.move_case_pipeline_v1(%L,%L,%L,%L,%L)', pg_temp.p186_id(1), pg_temp.p186_id(502), 'documents', FALSE, gen_random_uuid())) = '22023',
  'moving a closed case is rejected'
);
RESET ROLE;

-- Audit/receipt invariants for the first move and its replay run as
-- superuser: platform.audit_events and platform_private.* grant no SELECT to
-- authenticated (same placement as platform_cabinet_invites.sql).
SELECT pg_temp.p186_assert((SELECT count(*) = 1 FROM platform.audit_events WHERE resource_id = pg_temp.p186_id(501) AND action = 'case.pipeline.move'), 'exactly one audit row after one move plus its exact replay');
SELECT pg_temp.p186_assert((SELECT count(*) = 1 FROM platform_private.case_pipeline_requests WHERE request_id = pg_temp.p186_id(901)), 'exactly one receipt row for the reused request id');

-- ---------------------------------------------------------------------------
-- Curator B: no scope on case 501 -> forbidden on both the move and the read.
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims TO :'p186_curator_b';
SET LOCAL ROLE authenticated;
SELECT pg_temp.p186_assert(
  pg_temp.p186_error(format('SELECT platform.move_case_pipeline_v1(%L,%L,%L,%L,%L)', pg_temp.p186_id(1), pg_temp.p186_id(501), 'documents', FALSE, gen_random_uuid())) = '42501',
  'a curator with no access to this case is forbidden from moving it'
);
SELECT platform.staff_admissions_pipeline_board_v1() AS p186_board_b \gset
SELECT pg_temp.p186_assert(
  NOT EXISTS (SELECT 1 FROM jsonb_array_elements(:'p186_board_b'::JSONB -> 'rows') r WHERE r ->> 'student_case_id' = pg_temp.p186_id(501)::TEXT),
  'the board read for a curator excludes another curator''s case'
);
RESET ROLE;

-- ---------------------------------------------------------------------------
-- Student: forbidden on both the move and the read.
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims TO :'p186_student';
SET LOCAL ROLE authenticated;
SELECT pg_temp.p186_assert(
  pg_temp.p186_error(format('SELECT platform.move_case_pipeline_v1(%L,%L,%L,%L,%L)', pg_temp.p186_id(1), pg_temp.p186_id(501), 'documents', FALSE, gen_random_uuid())) = '42501',
  'a student is forbidden from moving a case'
);
SELECT pg_temp.p186_assert(
  pg_temp.p186_error('SELECT platform.staff_admissions_pipeline_board_v1()') = '42501',
  'a student is forbidden from reading the board'
);
RESET ROLE;

-- ---------------------------------------------------------------------------
-- Curator A again: «Убрать из воронки» hides the case from the board read
-- without touching its stage.
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims TO :'p186_curator_a';
SET LOCAL ROLE authenticated;
SELECT platform.move_case_pipeline_v1(pg_temp.p186_id(1), pg_temp.p186_id(501), NULL, TRUE, pg_temp.p186_id(902)) AS p186_remove_receipt \gset
SELECT pg_temp.p186_assert(:'p186_remove_receipt'::JSONB ->> 'pipeline_stage' = 'documents', 'removing from the board never changes the stage');
SELECT pg_temp.p186_assert((:'p186_remove_receipt'::JSONB ->> 'pipeline_hidden')::BOOLEAN = TRUE, 'removal receipt reports hidden');
SELECT pg_temp.p186_assert((SELECT pipeline_hidden_at IS NOT NULL AND pipeline_stage = 'documents' FROM platform.student_cases WHERE id = pg_temp.p186_id(501)), 'row is hidden with its stage intact');
SELECT platform.staff_admissions_pipeline_board_v1() AS p186_board_after_remove \gset
SELECT pg_temp.p186_assert(
  NOT EXISTS (SELECT 1 FROM jsonb_array_elements(:'p186_board_after_remove'::JSONB -> 'rows') r WHERE r ->> 'student_case_id' = pg_temp.p186_id(501)::TEXT),
  'a removed case no longer appears on its own curator''s board'
);
-- The case itself remains fully readable elsewhere (still active, not archived).
SELECT pg_temp.p186_assert((SELECT state = 'active' FROM platform.student_cases WHERE id = pg_temp.p186_id(501)), '«Убрать из воронки» never archives the case');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- Final invariants (superuser).
-- ---------------------------------------------------------------------------
SELECT pg_temp.p186_assert((SELECT count(*) = 2 FROM platform.audit_events WHERE resource_id = pg_temp.p186_id(501) AND action = 'case.pipeline.move'), 'exactly two successful moves audited: the stage change and the removal');
SELECT pg_temp.p186_assert((SELECT count(*) = 2 FROM platform_private.case_pipeline_requests WHERE organization_id = pg_temp.p186_id(1)), 'exactly two receipt rows: the stage-change request and the removal request');
SELECT pg_temp.p186_assert(pg_temp.p186_error('UPDATE platform_private.case_pipeline_requests SET fingerprint = fingerprint') = '55000', 'receipts are append-only');
SELECT pg_temp.p186_assert(pg_temp.p186_error('DELETE FROM platform_private.case_pipeline_requests') = '55000', 'receipts cannot be deleted');
SELECT pg_temp.p186_assert(
  'case.pipeline.move' = ANY (platform_private.p7a_safe_audit_actions()),
  'the new action is listed in the audit-search allowlist'
);

ROLLBACK;
