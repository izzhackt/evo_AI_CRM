\set ON_ERROR_STOP on

-- Current-boundary acceptance for migration 192 (PORT-1a «уровни доступа
-- портала»): approved = portal-activated state='pending' кейс, assisted =
-- state IN ('active','closed'). Runs at the 192 checkpoint against the FULL
-- current schema, exactly like platform_cabinet_invites.sql at 185. Fixtures
-- are synthetic actors in the platform_student_assessments_boundary.sql
-- style (replica-mode case snapshots, hook-generated live claims); every row
-- rolls back at the end.
--
-- Boundary claims proven here:
--   (i)   a pending-case student is DENIED create_case_help_request_v1,
--         case_help_workspace_v1 and the document upload/download grants,
--         with each function's existing 42501 message;
--   (ii)  the same pending student still SUCCEEDS on student_portal_overview_v2,
--         student_portal_cases, notifications read, student_university_catalog
--         and assessments read (the shared case gate stays pending-eligible);
--   (iii) an active-case student retains case-help and documents end to end
--         (real download grant issued against a fabricated finalized object);
--   (iv)  a help thread created before the gate stays readable for staff;
--   (v)   the six document-path functions with no individual denial call
--         above (grant_document_download_pre_e5's two anchors, consume_
--         document_download_grant_pre_e5, reserve_document_upload_after_
--         ingress_scan, preflight_document_upload, require_document_
--         storage_actor, require_current_upload_reservation) carry 192's
--         exact tightened state predicate verbatim in their LIVE body
--         (introspection review recommendation, PR #869).
BEGIN;

SET LOCAL TIME ZONE 'UTC';

CREATE FUNCTION pg_temp.p192_id(n INTEGER) RETURNS UUID
LANGUAGE SQL IMMUTABLE AS $$
  SELECT ('19200000-0000-4000-8000-'||lpad(n::TEXT, 12, '0'))::UUID
$$;

CREATE FUNCTION pg_temp.p192_assert(p_condition BOOLEAN, p_message TEXT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_condition IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'Migration 192 assertion failed: %', p_message;
  END IF;
END
$$;

-- One outcome probe for both denials and positives, in the
-- platform_student_assessments_boundary.sql p135_error idiom, extended with
-- the exact message so 42501-with-the-wrong-text cannot pass as the boundary.
CREATE FUNCTION pg_temp.p192_outcome(p_sql TEXT) RETURNS TEXT
LANGUAGE plpgsql
AS $$
BEGIN
  EXECUTE p_sql;
  RETURN 'ok';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE || ' ' || SQLERRM;
END
$$;

GRANT EXECUTE ON FUNCTION
  pg_temp.p192_id(INTEGER),
  pg_temp.p192_assert(BOOLEAN, TEXT),
  pg_temp.p192_outcome(TEXT)
  TO authenticated, service_role;

SELECT 'P192_PORTAL_ACCESS_TIERS_SUITE_START' AS p192_suite_marker;

-- ---------------------------------------------------------------------------
-- Seed: organization, admin/sales/curator staff, TWO students -- A owns a
-- portal-activated PENDING case (approved tier), B owns an ACTIVE case
-- (assisted tier). Same synthetic-actor shape as p135; the state/curator/
-- handoff/portal column combinations are exactly the shapes 180/182/185
-- produce in production.
-- ---------------------------------------------------------------------------
INSERT INTO platform.organizations (id, name)
VALUES (pg_temp.p192_id(1), 'Migration 192 synthetic organization');

INSERT INTO auth.users (id, email, raw_user_meta_data)
VALUES
  (pg_temp.p192_id(101), 'p192-admin@example.invalid', '{}'::JSONB),
  (pg_temp.p192_id(102), 'p192-sales@example.invalid', '{}'::JSONB),
  (pg_temp.p192_id(103), 'p192-curator@example.invalid', '{}'::JSONB),
  (pg_temp.p192_id(104), 'p192-student-pending@example.invalid', '{}'::JSONB),
  (pg_temp.p192_id(105), 'p192-student-active@example.invalid', '{}'::JSONB);

INSERT INTO platform.profiles (id, auth_user_id, display_name, status, access_version)
VALUES
  (pg_temp.p192_id(201), pg_temp.p192_id(101), 'P192 Admin', 'active', 1),
  (pg_temp.p192_id(202), pg_temp.p192_id(102), 'P192 Sales', 'active', 1),
  (pg_temp.p192_id(203), pg_temp.p192_id(103), 'P192 Curator', 'active', 1),
  (pg_temp.p192_id(204), pg_temp.p192_id(104), 'P192 Pending Student', 'active', 1),
  (pg_temp.p192_id(205), pg_temp.p192_id(105), 'P192 Active Student', 'active', 1);

INSERT INTO platform.organization_memberships (
  id, organization_id, profile_id, status, "current_role", current_bundle_id,
  is_system_admin
)
SELECT
  pg_temp.p192_id(300 + actor.n), pg_temp.p192_id(1), pg_temp.p192_id(200 + actor.n),
  'active', actor.role::platform.business_role,
  (
    SELECT id FROM platform.role_bundle_versions
    WHERE role = actor.role::platform.business_role AND status = 'published'
    ORDER BY version DESC LIMIT 1
  ),
  actor.role = 'admin'
FROM (VALUES (1, 'admin'), (2, 'sales'), (3, 'curator'), (4, 'student'), (5, 'student'))
  AS actor(n, role);

INSERT INTO platform.record_scopes (id, organization_id, scope_kind, scope_key, scope_version)
VALUES
  (pg_temp.p192_id(2), pg_temp.p192_id(1), 'organization', pg_temp.p192_id(1), 1),
  (pg_temp.p192_id(401), pg_temp.p192_id(1), 'student_case', pg_temp.p192_id(501), 1),
  (pg_temp.p192_id(402), pg_temp.p192_id(1), 'student_case', pg_temp.p192_id(502), 1);

INSERT INTO platform.membership_scope_assignments (
  organization_id, membership_id, scope_id, scope_version,
  assignment_version, granted, actor_kind, reason, request_id
)
SELECT pg_temp.p192_id(1), pg_temp.p192_id(300 + n), pg_temp.p192_id(2), 1,
  1, TRUE, 'system', 'P192 synthetic organization scope', pg_temp.p192_id(600 + n)
FROM generate_series(1, 5) AS n;

INSERT INTO platform.membership_scope_assignments (
  organization_id, membership_id, scope_id, scope_version,
  assignment_version, granted, actor_kind, reason, request_id
)
VALUES
  (pg_temp.p192_id(1), pg_temp.p192_id(304), pg_temp.p192_id(401), 1,
   1, TRUE, 'system', 'P192 pending student case scope', pg_temp.p192_id(611)),
  (pg_temp.p192_id(1), pg_temp.p192_id(305), pg_temp.p192_id(402), 1,
   1, TRUE, 'system', 'P192 active student case scope', pg_temp.p192_id(612)),
  (pg_temp.p192_id(1), pg_temp.p192_id(303), pg_temp.p192_id(402), 1,
   1, TRUE, 'system', 'P192 curator handoff case scope', pg_temp.p192_id(613));

-- Seed upstream activated case snapshots only (the p135 convention): the
-- 042 transition guard requires new cases to be born pending/portal-inactive,
-- so both already-provisioned shapes are inserted with that one BEFORE
-- trigger skipped; every table CHECK/FK still applies.
SET LOCAL session_replication_role = replica;
INSERT INTO platform.student_cases (
  id, organization_id, student_membership_id, responsible_sales_membership_id,
  source_key, student_display_name, target_country, target_degree,
  program_direction, operational_stage, state, portal_activated_at,
  current_scope_id, current_scope_version
) VALUES (
  pg_temp.p192_id(501), pg_temp.p192_id(1), pg_temp.p192_id(304), pg_temp.p192_id(302),
  'synthetic:p192:approved-cabinet', 'P192 Pending Student', 'China', 'Bachelor',
  'Engineering', 'intake_review', 'pending', clock_timestamp(),
  pg_temp.p192_id(401), 1
);
INSERT INTO platform.student_cases (
  id, organization_id, student_membership_id, responsible_sales_membership_id,
  current_curator_membership_id, source_key, contract_confirmation_ref,
  contract_confirmed_at, student_display_name, target_country, target_degree,
  program_direction, intake, route_approval_status, operational_stage, state,
  handoff_at, portal_activated_at, current_scope_id, current_scope_version
) VALUES (
  pg_temp.p192_id(502), pg_temp.p192_id(1), pg_temp.p192_id(305), pg_temp.p192_id(302),
  pg_temp.p192_id(303), 'synthetic:p192:assisted', 'synthetic:p192:contract',
  clock_timestamp(), 'P192 Active Student', 'China', 'Bachelor',
  'Engineering', '2027', 'approved', 'documents', 'active',
  clock_timestamp(), clock_timestamp(), pg_temp.p192_id(402), 1
);
SET LOCAL session_replication_role = origin;

-- ---------------------------------------------------------------------------
-- Document fixtures. One requirement, one slot per case. The PENDING case
-- gets a real version row so its download-grant call resolves the case and
-- reaches the 192 state gate ('Document is unavailable' -- before 192 the
-- same call fell through to the later 'Current verified clean document is
-- required' gate instead). The ACTIVE case gets the full fabricated
-- finalized-object chain (version, reservation, Storage object, binding,
-- finalization, ClamAV attestation) so a REAL download grant is issued end
-- to end.
-- ---------------------------------------------------------------------------
INSERT INTO platform.document_requirements (
  id, organization_id, target_country, target_degree, program_direction,
  checklist_version, requirement_key, label, instructions,
  created_by_membership_id
) VALUES (
  pg_temp.p192_id(701), pg_temp.p192_id(1), 'China', 'Bachelor', 'Engineering',
  1, 'passport', 'Паспорт', 'Загрузите разворот паспорта', pg_temp.p192_id(301)
);

INSERT INTO platform.document_slots (
  id, organization_id, student_case_id, requirement_id, status,
  created_by_membership_id
) VALUES
  (pg_temp.p192_id(711), pg_temp.p192_id(1), pg_temp.p192_id(501),
   pg_temp.p192_id(701), 'required', pg_temp.p192_id(301)),
  (pg_temp.p192_id(712), pg_temp.p192_id(1), pg_temp.p192_id(502),
   pg_temp.p192_id(701), 'required', pg_temp.p192_id(301));

-- Both versions are born in the real freshly-reserved shape
-- (pending/pending, no scan proof). The PENDING case's version 721 STAYS
-- that way: its download denial below must come from the 192 state gate,
-- which fires before any validation-status check. The ACTIVE case's version
-- 722 is promoted to verified/clean further down, after its fabricated
-- finalization + ClamAV attestation exist (115's proof chain).
INSERT INTO platform.document_versions (
  id, organization_id, student_case_id, document_slot_id, version_no,
  original_filename, declared_mime_type, byte_size, sha256_hex,
  ingest_evidence_ref, submitted_by_membership_id
) VALUES
  (pg_temp.p192_id(721), pg_temp.p192_id(1), pg_temp.p192_id(501),
   pg_temp.p192_id(711), 1, 'passport-pending.pdf', 'application/pdf', 1024,
   repeat('1', 64), 'synthetic:p192:ingest:pending', pg_temp.p192_id(304)),
  (pg_temp.p192_id(722), pg_temp.p192_id(1), pg_temp.p192_id(502),
   pg_temp.p192_id(712), 1, 'passport-active.pdf', 'application/pdf', 2048,
   repeat('2', 64), 'synthetic:p192:ingest:active', pg_temp.p192_id(305));

INSERT INTO storage.buckets (id, name, public)
VALUES ('platform-documents', 'platform-documents', FALSE)
ON CONFLICT DO NOTHING;
INSERT INTO storage.objects (bucket_id, name)
VALUES ('platform-documents', 'ab/' || repeat('5', 62));

INSERT INTO platform_private.document_upload_reservations (
  id, request_id, organization_id, student_case_id, document_slot_id,
  document_version_id, uploader_profile_id, uploader_membership_id,
  uploader_auth_user_id, object_name, declared_mime_type, byte_size,
  sha256_hex, expires_at, ingress_scan_required, ingress_scan_result,
  ingress_scanner_engine, ingress_scanner_engine_version,
  ingress_scanner_signature_version, ingress_scanner_protocol,
  ingress_scanned_at
) VALUES (
  pg_temp.p192_id(731), pg_temp.p192_id(732), pg_temp.p192_id(1),
  pg_temp.p192_id(502), pg_temp.p192_id(712), pg_temp.p192_id(722),
  pg_temp.p192_id(205), pg_temp.p192_id(305), pg_temp.p192_id(105),
  'ab/' || repeat('5', 62), 'application/pdf', 2048, repeat('2', 64),
  statement_timestamp() + INTERVAL '5 minutes', TRUE, 'clean',
  'ClamAV', '1.4.2', '27500', 'clamd-zinstream-v1', statement_timestamp()
);

INSERT INTO platform_private.document_storage_bindings (
  id, organization_id, student_case_id, document_slot_id,
  document_version_id, upload_reservation_id, bucket_id, object_name
) VALUES (
  pg_temp.p192_id(733), pg_temp.p192_id(1), pg_temp.p192_id(502),
  pg_temp.p192_id(712), pg_temp.p192_id(722), pg_temp.p192_id(731),
  'platform-documents', 'ab/' || repeat('5', 62)
);

INSERT INTO platform.audit_events (
  id, organization_id, actor_kind, actor_principal, action, resource_type,
  resource_id, after_state, reason, request_id
) VALUES (
  pg_temp.p192_id(734), pg_temp.p192_id(1), 'service',
  'synthetic:p192:finalizer', 'document.upload.finalize', 'document_version',
  pg_temp.p192_id(722), '{}'::JSONB, 'P192 synthetic finalization evidence',
  pg_temp.p192_id(735)
);

INSERT INTO platform_private.document_upload_finalizations (
  id, request_id, organization_id, upload_reservation_id, student_case_id,
  document_version_id, document_slot_id, finalization_audit_event_id,
  bucket_id, object_name, published_version_no, object_created_at
) VALUES (
  pg_temp.p192_id(736), pg_temp.p192_id(737), pg_temp.p192_id(1),
  pg_temp.p192_id(731), pg_temp.p192_id(502), pg_temp.p192_id(722),
  pg_temp.p192_id(712), pg_temp.p192_id(734), 'platform-documents',
  'ab/' || repeat('5', 62), 1, statement_timestamp()
);

INSERT INTO platform_private.document_malware_scan_attestations (
  id, request_id, organization_id, student_case_id, document_slot_id,
  document_version_id, upload_finalization_id, scanned_sha256_hex,
  scanner_engine, scanner_engine_version, scanner_signature_version,
  scanner_protocol, scanned_at
) VALUES (
  pg_temp.p192_id(738), pg_temp.p192_id(739), pg_temp.p192_id(1),
  pg_temp.p192_id(502), pg_temp.p192_id(712), pg_temp.p192_id(722),
  pg_temp.p192_id(736), repeat('2', 64), 'ClamAV', '1.4.2', '27500',
  'clamd-zinstream-v1', statement_timestamp()
);

-- Promote the ACTIVE version to its post-validation snapshot and move the
-- slot's current pointer onto it -- the fabricated outcome of the
-- service-side validation flow, seeded the p135 way (the one status-guard
-- trigger is skipped; every CHECK and the scan-proof FK shape still hold in
-- the rows themselves).
SET LOCAL session_replication_role = replica;
UPDATE platform.document_versions
SET integrity_status = 'verified',
  malware_status = 'clean',
  malware_scan_attestation_id = pg_temp.p192_id(738),
  validation_updated_at = clock_timestamp()
WHERE id = pg_temp.p192_id(722);
UPDATE platform.document_slots
SET status = 'submitted',
  current_version_id = pg_temp.p192_id(722),
  current_version_no = 1
WHERE id = pg_temp.p192_id(712);
SET LOCAL session_replication_role = origin;

-- A help thread created BEFORE the 192 gate existed (owner insert simulates
-- the pre-gate ledger row) on the PENDING case, for boundary (iv).
INSERT INTO platform.case_help_requests (
  id, organization_id, student_case_id, student_membership_id, subject, body
) VALUES (
  pg_temp.p192_id(741), pg_temp.p192_id(1), pg_temp.p192_id(501),
  pg_temp.p192_id(304), 'Старое обращение', 'Создано до разделения уровней'
);

-- Live JWT claims via the CURRENT production hook -- never hand-built (the
-- platform_cabinet_invites.sql convention), so a claims-shape change fails
-- this suite instead of silently drifting.
SELECT (platform_private.custom_access_token_hook(jsonb_build_object(
  'user_id', pg_temp.p192_id(101),
  'claims', jsonb_build_object('sub', pg_temp.p192_id(101), 'role', 'authenticated')
)) -> 'claims')::TEXT AS p192_admin_claims
\gset
SELECT (platform_private.custom_access_token_hook(jsonb_build_object(
  'user_id', pg_temp.p192_id(104),
  'claims', jsonb_build_object('sub', pg_temp.p192_id(104), 'role', 'authenticated')
)) -> 'claims')::TEXT AS p192_pending_student_claims
\gset
SELECT (platform_private.custom_access_token_hook(jsonb_build_object(
  'user_id', pg_temp.p192_id(105),
  'claims', jsonb_build_object('sub', pg_temp.p192_id(105), 'role', 'authenticated')
)) -> 'claims')::TEXT AS p192_active_student_claims
\gset

-- ===========================================================================
-- (i) DENIED for the pending (approved-tier) student: case-help write/read
-- and both document grants, each with the function's existing 42501 message.
-- The exact texts matter: 'Document is unavailable' comes from the NEW state
-- gate -- before 192 the same download call fell through to the later
-- 'Current verified clean document is required' currentness gate.
-- ===========================================================================
SET request.jwt.claims TO :'p192_pending_student_claims';
SET ROLE authenticated;

SELECT pg_temp.p192_assert(
  pg_temp.p192_outcome(format(
    'SELECT platform.create_case_help_request_v1(%L, %L, %L)',
    'Новое обращение', 'Пробую написать куратору', pg_temp.p192_id(801)
  )) = '42501 Case access denied',
  'pending student was not denied create_case_help_request_v1'
);

SELECT pg_temp.p192_assert(
  pg_temp.p192_outcome('SELECT platform.case_help_workspace_v1()')
    = '42501 Case access denied',
  'pending student was not denied case_help_workspace_v1()'
);

SELECT pg_temp.p192_assert(
  pg_temp.p192_outcome(format(
    'SELECT platform.case_help_workspace_v1(%L)', pg_temp.p192_id(501)
  )) = '42501 Case access denied',
  'pending student was not denied case_help_workspace_v1(own case)'
);

SELECT pg_temp.p192_assert(
  pg_temp.p192_outcome(format(
    'SELECT platform.admit_student_document_upload_scan(%L, %L, %L)',
    pg_temp.p192_id(1), pg_temp.p192_id(711), pg_temp.p192_id(802)
  )) = '42501 Document is unavailable',
  'pending student was not denied the document upload scan admission'
);

SELECT pg_temp.p192_assert(
  pg_temp.p192_outcome(format(
    'SELECT platform.grant_student_portal_document_download(%L, %L, %L)',
    pg_temp.p192_id(1), pg_temp.p192_id(721), pg_temp.p192_id(803)
  )) = '42501 Document is unavailable',
  'pending student was not denied the document download grant at the state gate'
);

-- The checklist projection is empty for the approved tier even though the
-- pending case really has a slot (the pre-192 behaviour would show it).
SELECT pg_temp.p192_assert(
  (SELECT count(*) = 0 FROM platform.student_portal_documents()),
  'pending student still sees document checklist rows'
);

-- ===========================================================================
-- (ii) STILL SUCCEEDS for the same pending student: overview, own case
-- projection, notifications read, university catalog, assessments read --
-- the shared pending-eligible gate must be untouched.
-- ===========================================================================
SELECT pg_temp.p192_assert(
  EXISTS (
    SELECT 1 FROM platform.student_portal_cases() AS portal
    WHERE portal.case_id = pg_temp.p192_id(501)
      AND portal.case_state = 'pending'
      AND portal.portal_activated_at IS NOT NULL
  ),
  'pending student lost the student_portal_cases() projection'
);

SELECT pg_temp.p192_assert(
  EXISTS (SELECT 1 FROM platform.student_portal_overview_v2()),
  'pending student lost student_portal_overview_v2'
);

SELECT pg_temp.p192_assert(
  pg_temp.p192_outcome('SELECT count(*) FROM platform.student_portal_notifications_v2()') = 'ok',
  'pending student lost the notifications read path'
);

SELECT pg_temp.p192_assert(
  platform.student_university_catalog() IS NOT NULL,
  'pending student lost student_university_catalog'
);

SELECT pg_temp.p192_assert(
  platform.student_assessments_v1() ? 'instruments',
  'pending student lost the assessments read path'
);

RESET ROLE;

-- ===========================================================================
-- (iii) The active (assisted-tier) student retains case-help and documents.
-- ===========================================================================
SET request.jwt.claims TO :'p192_active_student_claims';
SET ROLE authenticated;

SELECT platform.create_case_help_request_v1(
  'Вопрос по документам', 'Когда будет проверка паспорта?', pg_temp.p192_id(811)
)::TEXT AS p192_help_receipt
\gset
SELECT pg_temp.p192_assert(
  (:'p192_help_receipt'::JSONB ->> 'caseId')::UUID = pg_temp.p192_id(502),
  'active student could not create a case help request'
);

SELECT pg_temp.p192_assert(
  (
    SELECT jsonb_array_length(workspace -> 'items') = 1
      AND (workspace ->> 'caseId')::UUID = pg_temp.p192_id(502)
    FROM platform.case_help_workspace_v1() AS workspace
  ),
  'active student cannot read their own case help workspace'
);

SELECT pg_temp.p192_assert(
  (
    SELECT count(*) = 1
    FROM platform.student_portal_documents() AS document
    WHERE document.document_slot_id = pg_temp.p192_id(712)
  ),
  'active student lost the document checklist projection'
);

SELECT platform.admit_student_document_upload_scan(
  pg_temp.p192_id(1), pg_temp.p192_id(712), pg_temp.p192_id(812)
)::TEXT AS p192_admit_receipt
\gset
SELECT pg_temp.p192_assert(
  (:'p192_admit_receipt'::JSONB ->> 'scan_allowed')::BOOLEAN,
  'active student was not admitted to the upload scan'
);

SELECT platform.grant_student_portal_document_download(
  pg_temp.p192_id(1), pg_temp.p192_id(722), pg_temp.p192_id(813)
)::TEXT AS p192_download_grant
\gset
SELECT pg_temp.p192_assert(
  (:'p192_download_grant'::JSONB ->> 'document_download_grant_id') IS NOT NULL
  AND (:'p192_download_grant'::JSONB ->> 'storage_api_service_sign_required')::BOOLEAN,
  'active student was not granted the document download'
);

RESET ROLE;

-- ===========================================================================
-- (iv) The pre-gate help thread on the PENDING case stays readable for
-- staff: the staff branch of require_case_operations_actor is untouched.
-- ===========================================================================
SET request.jwt.claims TO :'p192_admin_claims';
SET ROLE authenticated;

SELECT pg_temp.p192_assert(
  (
    SELECT jsonb_array_length(workspace -> 'items') = 1
      AND (workspace -> 'items' -> 0 ->> 'id')::UUID = pg_temp.p192_id(741)
    FROM platform.case_help_workspace_v1(pg_temp.p192_id(501)) AS workspace
  ),
  'staff lost the pre-gate help thread on the pending case'
);

RESET ROLE;

-- ===========================================================================
-- (v) Introspection for the six document-path functions that 192 patches but
-- that no call above denies individually: grant_document_download_pre_e5 is
-- REVOKEd from authenticated (128:768-770) -- its student branch is reached
-- only through grant_student_portal_document_download, which already denies
-- pending on ITS OWN anchor before the call gets this far, so no public RPC
-- can distinguish a correct pre_e5 anchor from a broken one; consume_
-- document_download_grant_pre_e5 and reserve_document_upload_after_ingress_
-- scan belong to the service-role/webhook malware-scan chain; preflight_
-- document_upload, require_document_storage_actor and require_current_
-- upload_reservation are not invoked by any call this suite makes. Each
-- assertion here checks PRESENCE of 192's own p_after text, verbatim, in the
-- LIVE post-migration body (pg_get_functiondef) -- NOT absence of a bare
-- 'pending' substring: reserve_document_upload_after_ingress_scan legitimately
-- contains an unrelated 'pending' literal elsewhere in its body (the ingress-
-- scan-result insert), so a naive '!~ pending' check would misfire there.
-- ===========================================================================
SELECT pg_temp.p192_assert(
  position($p192af$        AND student_case.state IN ('active', 'closed')$p192af$
    IN pg_get_functiondef('private.grant_document_download_pre_e5(uuid,uuid,text,integer,uuid)'::regprocedure)) > 0,
  'grant_document_download_pre_e5 (student_case anchor) lost the 192 tightened state predicate'
);

SELECT pg_temp.p192_assert(
  position($p192af$      AND case_row.state IN ('active', 'closed')$p192af$
    IN pg_get_functiondef('private.grant_document_download_pre_e5(uuid,uuid,text,integer,uuid)'::regprocedure)) > 0,
  'grant_document_download_pre_e5 (case_row anchor) lost the 192 tightened state predicate'
);

SELECT pg_temp.p192_assert(
  position($p192af$        AND student_case.state IN ('active', 'closed') AND student_case.student_membership_id = membership.id$p192af$
    IN pg_get_functiondef('private.consume_document_download_grant_pre_e5(uuid,uuid)'::regprocedure)) > 0,
  'consume_document_download_grant_pre_e5 lost the 192 tightened state predicate'
);

SELECT pg_temp.p192_assert(
  position($p192af$        AND student_case.state IN ('active', 'closed')$p192af$
    IN pg_get_functiondef('platform.reserve_document_upload_after_ingress_scan(uuid,uuid,uuid,text,text,bigint,text,text,text,text,text,text,timestamp with time zone,uuid)'::regprocedure)) > 0,
  'reserve_document_upload_after_ingress_scan lost the 192 tightened state predicate'
);

SELECT pg_temp.p192_assert(
  position($p192af$        AND student_case.state IN ('active', 'closed')$p192af$
    IN pg_get_functiondef('platform.preflight_document_upload(uuid,uuid,text,text,bigint,text,uuid)'::regprocedure)) > 0,
  'preflight_document_upload lost the 192 tightened state predicate'
);

SELECT pg_temp.p192_assert(
  position($p192af$    OR (a.actor_role IS NOT DISTINCT FROM 'student' AND c.state IN ('active','closed')$p192af$
    IN pg_get_functiondef('platform_private.require_document_storage_actor(uuid,uuid,text)'::regprocedure)) > 0,
  'require_document_storage_actor lost the 192 tightened state predicate'
);

SELECT pg_temp.p192_assert(
  position($p192af$      AND c.student_membership_id = m.id AND c.state IN ('active', 'closed') AND c.portal_activated_at IS NOT NULL$p192af$
    IN pg_get_functiondef('platform_private.require_current_upload_reservation(uuid,uuid,text)'::regprocedure)) > 0,
  'require_current_upload_reservation lost the 192 tightened state predicate'
);

SELECT 'P192_PORTAL_ACCESS_TIERS_SUITE_PASSED' AS p192_suite_marker;

ROLLBACK;
