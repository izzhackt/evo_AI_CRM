-- ============================================================
-- 185_platform_cabinet_invites.sql
--
-- Unified-workflow pivot, slice S8 «выдача приглашения для кабинетных дел» --
-- the final documented gap of the unified-workflow plan.
-- docs/EVO_UNIFIED_WORKFLOW_PLAN_2026-09-18.md §4 («Дать доступ / Отклонить»:
-- «Если человек пришёл с сайта или WhatsApp без аккаунта, дополняем
-- необходимые сведения и выдаём персональное приглашение... Одобрение
-- анкеты или доступа не создаёт передачу в Admissions и не назначает
-- куратора») + docs/PLAN_CHANGES.md "unified workflow S8: выдача
-- приглашения для кабинетных дел" (2026-09-19, the binding contract for
-- this migration) + the S7 gap this closes, documented in migration 184's
-- own header (part b): prepare_lead_cabinet_v1 (184) creates a pending,
-- curator-less "кабинет до продажи" case (source_key 'lead-cabinet:'||
-- lead_id, state='pending', current_curator_membership_id NULL), but the 126
-- Student Portal invite family only understood two case shapes --
-- 'normal_u6' (an ACTIVE case, curator already assigned -- the ordinary
-- post-handoff invite) and 'legacy_pending' (a PENDING case that nominates a
-- curator AT PREPARE TIME and assigns them + flips the case active THE
-- MOMENT the invite is accepted). Reusing either shape for a cabinet case
-- was impossible without corrupting business state: normal_u6 requires an
-- already-active case with a curator (a cabinet case has neither);
-- legacy_pending would silently create a handoff and assign a curator on
-- acceptance -- exactly what plan §4 forbids. On top of that, the whole
-- family is gated by platform_private.require_admin_actor, which hard-
-- requires current_role='admin' (155:810-819) -- and membership.provision /
-- scope.manage are staff_system_only=TRUE (155), so a Sales bundle can NEVER
-- hold them (155:323 excludes staff_system_only keys from every non-admin
-- bundle). A site/WhatsApp lead's cabinet is prepared by Sales (184:324-328,
-- admin-or-sales via staff_can_access(...,'lead.sales.workflow.manage',
-- 'lead',...)); dispatch must be operable by that SAME Sales actor, not just
-- an Admin standing in.
--
-- Decision: a THIRD case_shape, 'cabinet_pending'. Its authority is
-- RESOURCE-SCOPED, not a fixed admin permission set: platform_role IN
-- ('admin','sales') AND staff_can_access(org, actor_membership,
-- 'lead.sales.workflow.manage', 'lead', <the case's own canonical_lead_id>)
-- -- the exact pattern 184's prepare_lead_cabinet_v1 (:324-328) and 180's
-- decide_student_application_v1 already use: a privileged SECURITY DEFINER
-- effect gated by a resource-scoped permission on a non-admin actor is
-- established precedent in this codebase, not a new authority model.
-- required_permission_keys for this shape is ARRAY['lead.sales.workflow.
-- manage'] ONLY -- deliberately NOT membership.provision/scope.manage: the
-- caller can never hold those staff_system_only keys; the SECURITY DEFINER
-- function body performs the membership-provision/scope-assignment side
-- effects itself (same trust boundary every other E1 command in this family
-- already relies on).
--
-- Acceptance semantics (plan §4, restated in PLAN_CHANGES.md): approving
-- cabinet access binds the auth user/membership to the case exactly as
-- normal_u6 does (shared, shape-agnostic bind branch -- see (e) below), then
-- sets ONLY portal_activated_at. State stays 'pending', current_curator_
-- membership_id stays NULL -- no curator, no handoff, until a real Sales
-- Report handoff (S2, create_sales_report_handoff, 181) or an Admissions
-- acceptance (S3, 182) touches the case. This is legal under 180's own
-- relaxation of student_cases_state_shape_check (180:395-413): a 'pending'
-- case may carry portal_activated_at, it just may not carry a curator or
-- handoff_at while pending.
--
-- IMPORTANT -- functions in this family are NOT literally what migration 126
-- shows on disk. Migrations 149 (is_eligible_staff_responsibility) and 157
-- (scoped-staff-roles restructuring) already patched the LIVE bodies of
-- platform.prepare_student_portal_provisioning and platform.finalize_
-- student_portal_authority in place via the established pg_get_functiondef
-- + exact-anchor + EXECUTE pattern (137/149/156/176/177/180/181/182). This
-- migration reconstructed the current live bodies by mechanically replaying
-- every prior anchor/replacement pair (verified against 149's and 157's own
-- DO blocks) before writing new anchors, and patches those TWO functions
-- with the SAME pg_get_functiondef+anchor+EXECUTE technique -- never a bare
-- CREATE OR REPLACE with a hand-copied 126 body, which would silently
-- regress the 149/157 patches. platform.authorize_student_portal_invite_
-- reissue and platform_private.assert_student_portal_receipt_admin_e1 were
-- NOT touched by any prior migration's DO block (grepped across every prior
-- migration file) -- authorize_student_portal_invite_reissue is therefore
-- replaced with a plain CREATE OR REPLACE below (safe: its body has never
-- drifted from 126's original text), and assert_student_portal_receipt_
-- admin_e1 (157's CREATE OR REPLACE version) is left completely untouched
-- and simply CALLED by the new wrapper below.
--
-- Assert approach chosen (task's explicit either/or): introduce a NEW
-- platform_private.assert_student_portal_receipt_authority_e1(p_receipt_id),
-- rather than branching assert_student_portal_receipt_admin_e1 in place.
-- For case_shape IN ('normal_u6','legacy_pending') it is a pure delegate --
-- PERFORM assert_student_portal_receipt_admin_e1(p_receipt_id); RETURN --
-- byte-identical behavior to today, reusing 157's live definition rather
-- than re-implementing it. For 'cabinet_pending' it re-resolves the linked
-- lead from receipt.student_case_id EVERY call (platform_private.resolve_
-- student_portal_cabinet_lead_e1 -- never trusts a cached/stored lead id)
-- and re-verifies the ORIGINAL preparer (receipt.authorizing_membership_id)
-- is STILL admin-or-sales with LIVE staff_can_access on that lead
-- (platform_private.assert_student_portal_cabinet_membership_e1) -- fail
-- closed if the membership, the lead link, or the permission grant changed
-- since prepare. finalize_student_portal_authority's own admin-assertion
-- call site is repointed to the new function; every OTHER call site in the
-- receipt lifecycle was individually audited (see the family list below).
--
-- Family audit -- every function in the receipt lifecycle, and what changed:
--   * prepare_student_portal_provisioning -- TOUCHED. New cabinet_pending
--     branch: live actor check (admin-or-sales + staff_can_access on the
--     resolved lead) instead of require_admin_actor's loop, in BOTH the
--     pre-lock preflight and the post-lock repeat (mirrors the existing
--     two-phase shape exactly); a third shape-validation branch verifying
--     genuine cabinet origin (source_key LIKE 'lead-cabinet:%', canonical_
--     lead_id set and matching, pending/no-curator/no-handoff/no-portal-
--     activation/not-closed). normal_u6/legacy_pending code paths are
--     reproduced byte-for-byte from the CURRENT (149+157-patched) live body
--     inside their own untouched branches.
--   * platform.claim_student_portal_invite -- NOT TOUCHED. GRANTed to
--     service_role only (the invite-runtime worker claims dispatch after
--     prepare already recorded authorization; no live actor, no case_shape
--     reference anywhere in its body). Shape-agnostic by construction.
--   * platform.authorize_student_portal_invite_reissue -- TOUCHED (beyond
--     the task's literal 8-name list -- flagged explicitly, see deviations
--     below). GRANTed to `authenticated`: an admin or (now) sales actor
--     calls this directly to authorize re-dispatch of an expired invite.
--     Its FOREACH loop over required_permission_keys calls require_admin_
--     actor, which hard-fails any non-admin regardless of which permission
--     key is checked (155:810-819 requires system_role='admin' before even
--     looking at the key) -- left unchanged, reissuing an invite for a
--     cabinet_pending case would be silently admin-only, contradicting the
--     whole point of this slice (Sales must be able to operate the cabinet
--     case they prepared, not just its first dispatch). Branched exactly
--     like prepare's own two-phase check.
--   * platform.claim_student_portal_invite_reissue -- NOT TOUCHED.
--     service_role only, shape-agnostic (attempt/receipt state only).
--   * platform.record_student_portal_invite_success -- NOT TOUCHED.
--     service_role only, shape-agnostic.
--   * platform.record_student_portal_invite_failure /
--     record_student_portal_invite_unknown (both thin wrappers over
--     platform_private.record_student_portal_invite_terminal_e1) -- NOT
--     TOUCHED. service_role only, shape-agnostic.
--   * platform.reconcile_student_portal_invite -- NOT TOUCHED. service_role
--     only, shape-agnostic (read the full body -- no case_shape reference,
--     no actor/admin check of any kind; it reconciles provider-callback
--     uncertainty purely from receipt/attempt state).
--   * platform.finalize_student_portal_authority -- TOUCHED. Its call to
--     assert_student_portal_receipt_admin_e1 is repointed to the new
--     assert_student_portal_receipt_authority_e1; a third case_shape branch
--     in the state-shape validation (mirrors normal_u6's own pending-vs-
--     active condition, just for state='pending'/curator IS NULL); a third
--     branch in the final activation step -- bind membership/org-scope via
--     the EXISTING shared, shape-agnostic bind branch (unchanged -- see
--     (e) below), then UPDATE ... SET portal_activated_at=occurred_at
--     WHERE state='pending' AND current_curator_membership_id IS NULL AND
--     portal_activated_at IS NULL AND closed_at IS NULL, row_count-guarded
--     exactly like normal_u6's own sibling UPDATE. NO curator, NO state
--     flip, NO handoff_at is ever written for this shape.
--
-- Continuing/re-entry outcome (task's explicit "prove or handle" gate):
-- PROVEN safe with NO extra branch, not extended. finalize's continuing_
-- bound_case / continuing_legacy_activation machinery (the block that
-- re-verifies a PRIOR partial bind via exact audit-trail matching) is
-- driven entirely by continuing_legacy_activation, which stays FALSE for
-- every shape except 'legacy_pending' -- it is set true ONLY inside the
-- "IF target_case.portal_activated_at IS NOT NULL THEN IF case_shape <>
-- 'legacy_pending' THEN RAISE portal_case_already_bound" guard. That guard
-- ALREADY fires correctly for 'cabinet_pending' with zero code change,
-- because it tests inequality to 'legacy_pending', not membership in a
-- fixed list -- exactly the same fail-closed treatment normal_u6 has always
-- received for that specific case (bound AND already portal_activated_at-
-- set, re-entered). The genuinely reachable re-entry case -- student_
-- membership_id bound but portal_activated_at still NULL, i.e. finalize
-- committed the bind but the caller never learned the outcome and retries
-- with the identical receipt -- is symmetric for normal_u6 and cabinet_
-- pending by construction: NEITHER shape's own state-shape branch
-- references continuing_legacy_activation at all, because neither shape
-- ever changes state/curator/handoff_at at finalize time, so the SAME
-- condition legally holds both before AND during that re-entry. Execution
-- falls through to the existing continuing_bound_case verification block
-- (itself already shape-agnostic apart from its own legacy-curator-specific
-- final clause, gated on continuing_legacy_activation, which correctly
-- stays out of scope for cabinet_pending), confirms the prior bind's audit
-- trail matches this exact request, skips re-binding, and proceeds straight
-- to this migration's new activation UPDATE. Reissue-after-partial-dispatch
-- failure (the OTHER meaning of "partial failure" in this family -- an
-- invite email attempt failing/expiring before finalize is ever reached) is
-- the authorize_student_portal_invite_reissue branch above, not a finalize
-- concern at all.
--
-- (e) student_membership_id bind -- VERIFIED, not touched. finalize's bind
-- branch ("ELSE" opposite continuing_bound_case) calls provision_member_
-- authorized_e1 + assign_organization_scope_authorized_e1, then
-- UPDATE platform.student_cases SET student_membership_id=... WHERE
-- student_membership_id IS NULL -- this branch has NEVER referenced
-- case_shape; it already runs identically for cabinet_pending. Portal
-- authority (student_portal_cases) therefore resolves for the now-bound
-- pending case exactly as S1's pending relaxation (180) already allows.
--
-- (f) p7a_safe_audit_actions allowlist -- NO new entries. Every audit action
-- name this migration's new code paths write is already allowlisted:
-- 'student.portal.authority.activate' (126, reused verbatim by the new
-- cabinet_pending activation branch), 'membership.provision' and
-- 'membership.scope.organization.assign' (both written by the shared,
-- untouched bind branch). Neither prepare_student_portal_provisioning nor
-- authorize_student_portal_invite_reissue writes to platform.audit_events
-- at all (never did, for any shape) -- no new action name exists to
-- allowlist.
--
-- RBAC constraint honored throughout: membership.provision and scope.manage
-- are staff_system_only=TRUE (155:30, excluded from every non-admin bundle
-- at 155:323) -- required_permission_keys for cabinet_pending is ARRAY[
-- 'lead.sales.workflow.manage'] ONLY; the caller is never asked to hold, and
-- never checked against, membership.provision/scope.manage.
--
-- Deviation from the task's literal function list: authorize_student_
-- portal_invite_reissue is touched even though it is not one of the eight
-- named call sites (prepare/claim/claim_reissue/record_success/record_
-- failure/record_unknown/reconcile/finalize) -- documented above as a
-- discovered, necessary gap (without it, cabinet-case invite reissue would
-- be silently admin-only). The two remaining S7 cosmetic follow-ups (full-
-- row card save vs partial merge; playbook-bound legacy partner-details
-- fail-closed) stay out of this slice, per 184's own header and PLAN_
-- CHANGES.md's S8 entry.
--
-- TS: caseShape unions (student-portal-provisioning-actions.ts, student-
-- portal-provisioning-admin-store.ts) gain 'cabinet_pending'; server actions
-- accept admin OR sales for this shape (re-checked server-side, never trust
-- the client); StudentPortalAccessCard becomes a three-way discriminator
-- driven by a server-passed case-origin prop, not caseState alone (a
-- cabinet case's caseState is 'pending', same as legacy_pending -- the
-- existing isLegacyPending===caseState==='pending' check would misfire).
-- Invite email machinery needs NO changes -- Supabase Auth invite dispatch
-- always runs under the service-role client (student-portal-invite-
-- runtime.ts:36-52), independent of which role triggered it.
-- ============================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- a) case_shape / required_permission_keys / shape-check CHECK widening
-- ---------------------------------------------------------------------------
DO $portal_receipts_cabinet_shape$
DECLARE case_shape_check TEXT; permission_keys_check TEXT;
BEGIN
  SELECT con.conname INTO case_shape_check
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_namespace ns ON ns.oid = rel.relnamespace
  WHERE ns.nspname = 'platform_private'
    AND rel.relname = 'student_portal_provisioning_receipts'
    AND con.contype = 'c'
    AND pg_get_constraintdef(con.oid) LIKE $p$%'normal_u6'%$p$
    AND pg_get_constraintdef(con.oid) LIKE $p$%'legacy_pending'%$p$
    AND pg_get_constraintdef(con.oid) NOT LIKE $p$%legacy_curator_membership_id%$p$;
  IF case_shape_check IS NULL THEN
    RAISE EXCEPTION 'portal_receipts_case_shape_check_not_found' USING ERRCODE = '55000';
  END IF;
  EXECUTE format(
    'ALTER TABLE platform_private.student_portal_provisioning_receipts DROP CONSTRAINT %I',
    case_shape_check
  );

  SELECT con.conname INTO permission_keys_check
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_namespace ns ON ns.oid = rel.relnamespace
  WHERE ns.nspname = 'platform_private'
    AND rel.relname = 'student_portal_provisioning_receipts'
    AND con.contype = 'c'
    AND pg_get_constraintdef(con.oid) LIKE $p$%required_permission_keys%$p$;
  IF permission_keys_check IS NULL THEN
    RAISE EXCEPTION 'portal_receipts_permission_keys_check_not_found' USING ERRCODE = '55000';
  END IF;
  EXECUTE format(
    'ALTER TABLE platform_private.student_portal_provisioning_receipts DROP CONSTRAINT %I',
    permission_keys_check
  );
END
$portal_receipts_cabinet_shape$;

ALTER TABLE platform_private.student_portal_provisioning_receipts
  ADD CONSTRAINT student_portal_receipts_case_shape_check
    CHECK (case_shape IN ('normal_u6', 'legacy_pending', 'cabinet_pending')),
  ADD CONSTRAINT student_portal_receipts_permission_keys_check CHECK (
    required_permission_keys = ARRAY['membership.provision', 'scope.manage']::TEXT[]
    OR required_permission_keys = ARRAY[
      'membership.provision', 'scope.manage', 'case.curator.assign'
    ]::TEXT[]
    OR required_permission_keys = ARRAY['lead.sales.workflow.manage']::TEXT[]
  ),
  DROP CONSTRAINT student_portal_receipts_shape_check,
  ADD CONSTRAINT student_portal_receipts_shape_check CHECK (
    (case_shape = 'normal_u6' AND legacy_curator_membership_id IS NULL)
    OR (case_shape = 'legacy_pending' AND legacy_curator_membership_id IS NOT NULL)
    OR (case_shape = 'cabinet_pending' AND legacy_curator_membership_id IS NULL)
  );

-- ---------------------------------------------------------------------------
-- b) cabinet_pending authority helpers -- shared by prepare, the reissue
--    authorization entrypoint and the finalize assertion (one authority
--    predicate, reused everywhere it is needed, per the task's own "pick
--    ONE approach and apply it consistently" instruction).
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform_private.resolve_student_portal_cabinet_lead_e1(
  p_organization_id UUID,
  p_student_case_id UUID
)
RETURNS UUID
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT student_case.canonical_lead_id
  FROM platform.student_cases AS student_case
  WHERE student_case.organization_id = p_organization_id
    AND student_case.id = p_student_case_id
    AND student_case.source_key LIKE 'lead-cabinet:%'
    AND student_case.canonical_lead_id IS NOT NULL
$$;

REVOKE ALL ON FUNCTION platform_private.resolve_student_portal_cabinet_lead_e1(UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

-- Live-session actor check (current_actor_authority()-based): used wherever
-- a LIVE caller is being authorized right now (prepare, reissue-authorize).
CREATE FUNCTION platform_private.require_student_portal_cabinet_actor_e1(
  p_organization_id UUID,
  p_lead_id UUID
)
RETURNS TABLE(actor_profile_id UUID, actor_membership_id UUID, actor_auth_user_id UUID)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_lead_id IS NULL THEN
    -- Not a genuine cabinet case (no lead-cabinet source_key/canonical_lead_id) --
    -- fail closed before even asking who is calling.
    RAISE EXCEPTION 'portal_case_invalid_shape' USING ERRCODE = '40001';
  END IF;
  RETURN QUERY
  SELECT a.profile_id, a.membership_id, a.auth_user_id
  FROM platform.current_actor_authority() a
  WHERE a.organization_id = p_organization_id
    AND a.platform_role IN ('admin', 'sales')
    AND platform_private.staff_can_access(
      p_organization_id, a.membership_id,
      'lead.sales.workflow.manage', 'lead', p_lead_id
    );
  IF NOT FOUND THEN
    RAISE EXCEPTION 'portal_admin_authority_changed' USING ERRCODE = '42501';
  END IF;
END
$$;

REVOKE ALL ON FUNCTION platform_private.require_student_portal_cabinet_actor_e1(UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

-- Stored-membership re-verification (no live session -- finalize runs under
-- the service-role client with no JWT actor): re-checks a SPECIFIC
-- membership_id recorded on the receipt at prepare time.
CREATE FUNCTION platform_private.assert_student_portal_cabinet_membership_e1(
  p_organization_id UUID,
  p_membership_id UUID,
  p_lead_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_lead_id IS NULL THEN
    RAISE EXCEPTION 'portal_case_invalid_shape' USING ERRCODE = '40001';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM platform_private.staff_membership_identity(p_organization_id, p_membership_id) AS identity
    WHERE identity.coarse_role IN ('admin', 'sales')
      AND platform_private.staff_can_access(
        p_organization_id, p_membership_id,
        'lead.sales.workflow.manage', 'lead', p_lead_id
      )
  ) THEN
    RAISE EXCEPTION 'portal_admin_authority_changed' USING ERRCODE = '42501';
  END IF;
END
$$;

REVOKE ALL ON FUNCTION platform_private.assert_student_portal_cabinet_membership_e1(UUID, UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

-- The single repointed assertion finalize now calls. normal_u6/legacy_pending
-- delegate to the EXISTING (157) admin assertion verbatim -- byte-identical
-- behavior, not a reimplementation.
CREATE FUNCTION platform_private.assert_student_portal_receipt_authority_e1(
  p_receipt_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  receipt platform_private.student_portal_provisioning_receipts%ROWTYPE;
  v_lead_id UUID;
BEGIN
  SELECT * INTO receipt
  FROM platform_private.student_portal_provisioning_receipts AS candidate
  WHERE candidate.id = p_receipt_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'receipt unavailable' USING ERRCODE = 'P0002'; END IF;

  IF receipt.case_shape <> 'cabinet_pending' THEN
    PERFORM platform_private.assert_student_portal_receipt_admin_e1(p_receipt_id);
    RETURN;
  END IF;

  -- Live re-authorization: resolve the linked lead from the receipt's OWN
  -- student_case EVERY call (never cached), then re-verify the ORIGINAL
  -- preparer's membership still carries live authority over it. Fail closed.
  v_lead_id := platform_private.resolve_student_portal_cabinet_lead_e1(
    receipt.organization_id, receipt.student_case_id
  );
  PERFORM platform_private.assert_student_portal_cabinet_membership_e1(
    receipt.organization_id, receipt.authorizing_membership_id, v_lead_id
  );
END
$$;

REVOKE ALL ON FUNCTION platform_private.assert_student_portal_receipt_authority_e1(UUID)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

-- Companion read added beyond the literal deliverable list, same narrow
-- necessity as 184's own staff_lead_cabinet_case_v1 (184's header calls this
-- exact pattern out by name): StudentPortalAccessCard must discriminate a
-- cabinet_pending case from a legacy_pending one WITHOUT rendering the wrong
-- flow (a legacy curator picker for a curator-less cabinet case). No existing
-- read model exposes source_key/canonical_lead_id to the page/profile-source
-- layer (platform.staff_student_case_page and its snapshot wrapper -- traced
-- through 078/110/137/149/176/177/182 -- select neither column), and adding
-- one there would mean anchor-patching an already seven-times-patched RPC
-- for a single boolean this migration's own domain already knows how to
-- answer. Reuses resolve_student_portal_cabinet_lead_e1 (b, above) --
-- one authority predicate, one truth for "is this a genuine cabinet case".
CREATE FUNCTION platform.staff_student_case_cabinet_origin_v1(
  p_organization_id UUID,
  p_student_case_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_organization_id IS NULL OR p_student_case_id IS NULL
    OR NOT private.platform_can_read_student_case(p_organization_id, p_student_case_id)
  THEN
    RAISE EXCEPTION 'portal_case_unreadable' USING ERRCODE = '42501';
  END IF;
  RETURN platform_private.resolve_student_portal_cabinet_lead_e1(
    p_organization_id, p_student_case_id
  ) IS NOT NULL;
END
$$;

REVOKE ALL ON FUNCTION platform.staff_student_case_cabinet_origin_v1(UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.staff_student_case_cabinet_origin_v1(UUID, UUID)
  TO authenticated;

-- ---------------------------------------------------------------------------
-- c) prepare_student_portal_provisioning -- cabinet_pending branch, patched
--    against the CURRENT (149+157-patched) live body via the established
--    pg_get_functiondef + exact-anchor + EXECUTE technique. The anchor below
--    is the function's ENTIRE current body (DECLARE..END), reconstructed by
--    mechanically replaying 149's and 157's own recorded replacements over
--    126's original source -- if the live body has drifted from that
--    reconstruction in ANY way, this fails closed instead of silently
--    regressing a prior patch.
-- ---------------------------------------------------------------------------
DO $prepare_cabinet_patch$
DECLARE body TEXT; anchor TEXT; replacement TEXT;
BEGIN
  body := pg_catalog.pg_get_functiondef(
    'platform.prepare_student_portal_provisioning(uuid,uuid,text,text,text,uuid,text,uuid)'::regprocedure
  );
  anchor := $prep_old$DECLARE
  v_normalized_email TEXT := pg_catalog.lower(pg_catalog.btrim(p_email));
  v_normalized_display_name TEXT := pg_catalog.btrim(p_student_display_name);
  v_fingerprint_sha256 TEXT;
  required_permissions TEXT[];
  permission_key TEXT;
  actor RECORD;
  actor_bundle_id UUID;
  actor_bundle_version BIGINT;
  actor_access_version BIGINT;
  target_case platform.student_cases%ROWTYPE;
  existing_receipt platform_private.student_portal_provisioning_receipts%ROWTYPE;
  receipt_id UUID;
BEGIN
  IF p_organization_id IS NULL OR p_student_case_id IS NULL
    OR p_request_id IS NULL
    OR v_normalized_email IS NULL
    OR pg_catalog.char_length(v_normalized_email) NOT BETWEEN 3 AND 320
    OR v_normalized_email NOT LIKE '%@%'
    OR v_normalized_email ~ '[[:space:][:cntrl:]]'
    OR v_normalized_display_name IS NULL
    OR pg_catalog.char_length(v_normalized_display_name) NOT BETWEEN 1 AND 200
    OR v_normalized_display_name ~ '[[:cntrl:]]'
    OR p_case_shape IS NULL
    OR p_case_shape NOT IN ('normal_u6', 'legacy_pending')
    OR pg_catalog.char_length(pg_catalog.btrim(COALESCE(p_reason, '')))
      NOT BETWEEN 1 AND 1000
  THEN
    RAISE EXCEPTION 'invalid student portal provisioning input'
      USING ERRCODE = '22023';
  END IF;
  IF (p_case_shape = 'normal_u6' AND p_legacy_curator_membership_id IS NOT NULL)
    OR (p_case_shape = 'legacy_pending' AND p_legacy_curator_membership_id IS NULL)
  THEN
    RAISE EXCEPTION 'portal_curator_required' USING ERRCODE = '40001';
  END IF;

  required_permissions := CASE p_case_shape
    WHEN 'legacy_pending' THEN ARRAY[
      'membership.provision', 'scope.manage', 'case.curator.assign'
    ]::TEXT[]
    ELSE ARRAY['membership.provision', 'scope.manage']::TEXT[]
  END;

  -- Read-only caller preflight before accepting any caller-selected lock key.
  FOREACH permission_key IN ARRAY required_permissions LOOP
    PERFORM 1 FROM platform_private.require_admin_actor(
      p_organization_id, permission_key
    );
  END LOOP;

  PERFORM platform_private.lock_student_case_note_assignment_domain(
    p_organization_id
  );
  PERFORM platform_private.lock_student_portal_request_tree(p_request_id);

  -- Repeat live authority after the canonical locks.
  FOREACH permission_key IN ARRAY required_permissions LOOP
    SELECT * INTO actor
    FROM platform_private.require_admin_actor(p_organization_id, permission_key);
  END LOOP;

  PERFORM 1 FROM platform.organizations WHERE id=p_organization_id FOR UPDATE;
  PERFORM platform_private.staff_lock_memberships(p_organization_id,
    array_remove(ARRAY[actor.actor_membership_id,p_legacy_curator_membership_id]::UUID[],NULL::UUID));
  SELECT identity.access_version,NULL::UUID,NULL::BIGINT
  INTO actor_access_version,actor_bundle_id,actor_bundle_version
  FROM platform_private.staff_membership_identity(p_organization_id,actor.actor_membership_id) identity
  WHERE identity.system_role='admin' AND identity.profile_id=actor.actor_profile_id
    AND identity.auth_user_id=actor.actor_auth_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'portal_admin_authority_changed' USING ERRCODE = '42501';
  END IF;

  v_fingerprint_sha256 := platform_private.student_portal_fingerprint(
    p_organization_id, p_student_case_id, v_normalized_email,
    v_normalized_display_name, p_case_shape, p_legacy_curator_membership_id
  );

  SELECT * INTO existing_receipt
  FROM platform_private.student_portal_provisioning_receipts AS receipt
  WHERE receipt.request_id = p_request_id
  FOR UPDATE;
  IF FOUND THEN
    IF existing_receipt.fingerprint_sha256 <> v_fingerprint_sha256 THEN
      RAISE EXCEPTION 'request_replay_conflict' USING ERRCODE = '40001';
    END IF;
    RETURN platform_private.student_portal_safe_snapshot(existing_receipt.id, FALSE)
      || jsonb_build_object('replayed', TRUE);
  END IF;

  SELECT * INTO target_case
  FROM platform.student_cases AS student_case
  WHERE student_case.organization_id = p_organization_id
    AND student_case.id = p_student_case_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Student case is unavailable' USING ERRCODE = 'P0002';
  END IF;
  IF target_case.student_membership_id IS NOT NULL THEN
    RAISE EXCEPTION 'portal_case_already_bound' USING ERRCODE = '40001';
  END IF;

  IF p_case_shape = 'normal_u6' THEN
    IF target_case.state <> 'active'
      OR target_case.current_curator_membership_id IS NULL
      OR target_case.handoff_at IS NULL
      OR target_case.portal_activated_at IS NOT NULL
      OR target_case.closed_at IS NOT NULL
    THEN
      RAISE EXCEPTION 'portal_case_invalid_shape' USING ERRCODE = '40001';
    END IF;
  ELSE
    IF target_case.state <> 'pending'
      OR target_case.current_curator_membership_id IS NOT NULL
      OR target_case.handoff_at IS NOT NULL
      OR target_case.portal_activated_at IS NOT NULL
      OR target_case.closed_at IS NOT NULL
    THEN
      RAISE EXCEPTION 'portal_case_invalid_shape' USING ERRCODE = '40001';
    END IF;
    -- The requested curator's profile/member rows are already locked above.
    -- Responsibility is live staff identity plus capacity for this exact case,
    -- not a fixed role label or a legacy membership bundle.
    PERFORM 1
    FROM platform_private.staff_membership_identity(
      p_organization_id,p_legacy_curator_membership_id) identity
    WHERE platform_private.staff_can_receive_assignment(p_organization_id,identity.membership_id,
        'case.read.full','student_case',p_student_case_id)
      AND platform_private.staff_can_receive_assignment(p_organization_id,identity.membership_id,
        'task.manage','student_case',p_student_case_id);
    IF NOT FOUND THEN
      RAISE EXCEPTION 'portal_curator_required' USING ERRCODE = '40001';
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1 FROM platform_private.student_portal_provisioning_receipts AS receipt
    WHERE receipt.student_case_id = p_student_case_id
  ) THEN
    RAISE EXCEPTION 'portal_case_already_reserved' USING ERRCODE = '40001';
  END IF;
  IF EXISTS (
    SELECT 1 FROM platform_private.student_portal_provisioning_receipts AS receipt
    WHERE receipt.normalized_email = v_normalized_email
  ) THEN
    RAISE EXCEPTION 'portal_email_already_reserved' USING ERRCODE = '40001';
  END IF;

  BEGIN
    INSERT INTO platform_private.student_portal_provisioning_receipts (
      request_id, organization_id, student_case_id, normalized_email,
      student_display_name, case_shape, legacy_curator_membership_id,
      fingerprint_sha256, authorizing_auth_user_id, authorizing_profile_id,
      authorizing_membership_id, authorizing_access_version,
      authorizing_bundle_id, authorizing_bundle_version,
      required_permission_keys
    ) VALUES (
      p_request_id, p_organization_id, p_student_case_id, v_normalized_email,
      v_normalized_display_name, p_case_shape, p_legacy_curator_membership_id,
      v_fingerprint_sha256, actor.actor_auth_user_id, actor.actor_profile_id,
      actor.actor_membership_id, actor_access_version,
      actor_bundle_id, actor_bundle_version, required_permissions
    ) RETURNING id INTO receipt_id;
  EXCEPTION WHEN unique_violation THEN
    IF EXISTS (
      SELECT 1 FROM platform_private.student_portal_provisioning_receipts AS receipt
      WHERE receipt.normalized_email = v_normalized_email
    ) THEN
      RAISE EXCEPTION 'portal_email_already_reserved' USING ERRCODE = '40001';
    END IF;
    IF EXISTS (
      SELECT 1 FROM platform_private.student_portal_provisioning_receipts AS receipt
      WHERE receipt.student_case_id = p_student_case_id
    ) THEN
      RAISE EXCEPTION 'portal_case_already_reserved' USING ERRCODE = '40001';
    END IF;
    RAISE;
  END;

  RETURN platform_private.student_portal_safe_snapshot(receipt_id, FALSE)
    || jsonb_build_object('replayed', FALSE);
END
$prep_old$;
  IF (pg_catalog.length(body) - pg_catalog.length(pg_catalog.replace(body, anchor, '')))
      / pg_catalog.length(anchor) <> 1 THEN
    RAISE EXCEPTION 'student_portal_prepare_cabinet_source_drift' USING ERRCODE = '55000';
  END IF;
  replacement := $prep_new$DECLARE
  v_normalized_email TEXT := pg_catalog.lower(pg_catalog.btrim(p_email));
  v_normalized_display_name TEXT := pg_catalog.btrim(p_student_display_name);
  v_fingerprint_sha256 TEXT;
  required_permissions TEXT[];
  permission_key TEXT;
  actor RECORD;
  actor_bundle_id UUID;
  actor_bundle_version BIGINT;
  actor_access_version BIGINT;
  target_case platform.student_cases%ROWTYPE;
  existing_receipt platform_private.student_portal_provisioning_receipts%ROWTYPE;
  receipt_id UUID;
  v_lead_id UUID;
BEGIN
  IF p_organization_id IS NULL OR p_student_case_id IS NULL
    OR p_request_id IS NULL
    OR v_normalized_email IS NULL
    OR pg_catalog.char_length(v_normalized_email) NOT BETWEEN 3 AND 320
    OR v_normalized_email NOT LIKE '%@%'
    OR v_normalized_email ~ '[[:space:][:cntrl:]]'
    OR v_normalized_display_name IS NULL
    OR pg_catalog.char_length(v_normalized_display_name) NOT BETWEEN 1 AND 200
    OR v_normalized_display_name ~ '[[:cntrl:]]'
    OR p_case_shape IS NULL
    OR p_case_shape NOT IN ('normal_u6', 'legacy_pending', 'cabinet_pending')
    OR pg_catalog.char_length(pg_catalog.btrim(COALESCE(p_reason, '')))
      NOT BETWEEN 1 AND 1000
  THEN
    RAISE EXCEPTION 'invalid student portal provisioning input'
      USING ERRCODE = '22023';
  END IF;
  IF (p_case_shape = 'normal_u6' AND p_legacy_curator_membership_id IS NOT NULL)
    OR (p_case_shape = 'legacy_pending' AND p_legacy_curator_membership_id IS NULL)
    OR (p_case_shape = 'cabinet_pending' AND p_legacy_curator_membership_id IS NOT NULL)
  THEN
    RAISE EXCEPTION 'portal_curator_required' USING ERRCODE = '40001';
  END IF;

  required_permissions := CASE p_case_shape
    WHEN 'legacy_pending' THEN ARRAY[
      'membership.provision', 'scope.manage', 'case.curator.assign'
    ]::TEXT[]
    WHEN 'cabinet_pending' THEN ARRAY['lead.sales.workflow.manage']::TEXT[]
    ELSE ARRAY['membership.provision', 'scope.manage']::TEXT[]
  END;

  -- Read-only caller preflight before accepting any caller-selected lock key.
  IF p_case_shape = 'cabinet_pending' THEN
    v_lead_id := platform_private.resolve_student_portal_cabinet_lead_e1(
      p_organization_id, p_student_case_id
    );
    PERFORM 1 FROM platform_private.require_student_portal_cabinet_actor_e1(
      p_organization_id, v_lead_id
    );
  ELSE
    FOREACH permission_key IN ARRAY required_permissions LOOP
      PERFORM 1 FROM platform_private.require_admin_actor(
        p_organization_id, permission_key
      );
    END LOOP;
  END IF;

  PERFORM platform_private.lock_student_case_note_assignment_domain(
    p_organization_id
  );
  PERFORM platform_private.lock_student_portal_request_tree(p_request_id);

  -- Repeat live authority after the canonical locks.
  IF p_case_shape = 'cabinet_pending' THEN
    v_lead_id := platform_private.resolve_student_portal_cabinet_lead_e1(
      p_organization_id, p_student_case_id
    );
    SELECT * INTO actor
    FROM platform_private.require_student_portal_cabinet_actor_e1(
      p_organization_id, v_lead_id
    );

    PERFORM 1 FROM platform.organizations WHERE id=p_organization_id FOR UPDATE;
    PERFORM platform_private.staff_lock_memberships(p_organization_id,
      array_remove(ARRAY[actor.actor_membership_id]::UUID[],NULL::UUID));
    SELECT identity.access_version,NULL::UUID,NULL::BIGINT
    INTO actor_access_version,actor_bundle_id,actor_bundle_version
    FROM platform_private.staff_membership_identity(p_organization_id,actor.actor_membership_id) identity
    WHERE identity.coarse_role IN ('admin','sales') AND identity.profile_id=actor.actor_profile_id
      AND identity.auth_user_id=actor.actor_auth_user_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'portal_admin_authority_changed' USING ERRCODE = '42501';
    END IF;
  ELSE
    FOREACH permission_key IN ARRAY required_permissions LOOP
      SELECT * INTO actor
      FROM platform_private.require_admin_actor(p_organization_id, permission_key);
    END LOOP;

    PERFORM 1 FROM platform.organizations WHERE id=p_organization_id FOR UPDATE;
    PERFORM platform_private.staff_lock_memberships(p_organization_id,
      array_remove(ARRAY[actor.actor_membership_id,p_legacy_curator_membership_id]::UUID[],NULL::UUID));
    SELECT identity.access_version,NULL::UUID,NULL::BIGINT
    INTO actor_access_version,actor_bundle_id,actor_bundle_version
    FROM platform_private.staff_membership_identity(p_organization_id,actor.actor_membership_id) identity
    WHERE identity.system_role='admin' AND identity.profile_id=actor.actor_profile_id
      AND identity.auth_user_id=actor.actor_auth_user_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'portal_admin_authority_changed' USING ERRCODE = '42501';
    END IF;
  END IF;

  v_fingerprint_sha256 := platform_private.student_portal_fingerprint(
    p_organization_id, p_student_case_id, v_normalized_email,
    v_normalized_display_name, p_case_shape, p_legacy_curator_membership_id
  );

  SELECT * INTO existing_receipt
  FROM platform_private.student_portal_provisioning_receipts AS receipt
  WHERE receipt.request_id = p_request_id
  FOR UPDATE;
  IF FOUND THEN
    IF existing_receipt.fingerprint_sha256 <> v_fingerprint_sha256 THEN
      RAISE EXCEPTION 'request_replay_conflict' USING ERRCODE = '40001';
    END IF;
    RETURN platform_private.student_portal_safe_snapshot(existing_receipt.id, FALSE)
      || jsonb_build_object('replayed', TRUE);
  END IF;

  SELECT * INTO target_case
  FROM platform.student_cases AS student_case
  WHERE student_case.organization_id = p_organization_id
    AND student_case.id = p_student_case_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Student case is unavailable' USING ERRCODE = 'P0002';
  END IF;
  IF target_case.student_membership_id IS NOT NULL THEN
    RAISE EXCEPTION 'portal_case_already_bound' USING ERRCODE = '40001';
  END IF;

  IF p_case_shape = 'normal_u6' THEN
    IF target_case.state <> 'active'
      OR target_case.current_curator_membership_id IS NULL
      OR target_case.handoff_at IS NULL
      OR target_case.portal_activated_at IS NOT NULL
      OR target_case.closed_at IS NOT NULL
    THEN
      RAISE EXCEPTION 'portal_case_invalid_shape' USING ERRCODE = '40001';
    END IF;
  ELSIF p_case_shape = 'cabinet_pending' THEN
    -- Genuine S1/S7 lead-cabinet origin only (184's prepare_lead_cabinet_v1
    -- shape): curator-less pending case linked to the SAME lead the caller
    -- was just authorized against above.
    IF target_case.source_key IS NULL
      OR target_case.source_key NOT LIKE 'lead-cabinet:%'
      OR target_case.canonical_lead_id IS NULL
      OR target_case.canonical_lead_id <> v_lead_id
      OR target_case.state <> 'pending'
      OR target_case.current_curator_membership_id IS NOT NULL
      OR target_case.handoff_at IS NOT NULL
      OR target_case.portal_activated_at IS NOT NULL
      OR target_case.closed_at IS NOT NULL
    THEN
      RAISE EXCEPTION 'portal_case_invalid_shape' USING ERRCODE = '40001';
    END IF;
  ELSE
    IF target_case.state <> 'pending'
      OR target_case.current_curator_membership_id IS NOT NULL
      OR target_case.handoff_at IS NOT NULL
      OR target_case.portal_activated_at IS NOT NULL
      OR target_case.closed_at IS NOT NULL
    THEN
      RAISE EXCEPTION 'portal_case_invalid_shape' USING ERRCODE = '40001';
    END IF;
    -- The requested curator's profile/member rows are already locked above.
    -- Responsibility is live staff identity plus capacity for this exact case,
    -- not a fixed role label or a legacy membership bundle.
    PERFORM 1
    FROM platform_private.staff_membership_identity(
      p_organization_id,p_legacy_curator_membership_id) identity
    WHERE platform_private.staff_can_receive_assignment(p_organization_id,identity.membership_id,
        'case.read.full','student_case',p_student_case_id)
      AND platform_private.staff_can_receive_assignment(p_organization_id,identity.membership_id,
        'task.manage','student_case',p_student_case_id);
    IF NOT FOUND THEN
      RAISE EXCEPTION 'portal_curator_required' USING ERRCODE = '40001';
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1 FROM platform_private.student_portal_provisioning_receipts AS receipt
    WHERE receipt.student_case_id = p_student_case_id
  ) THEN
    RAISE EXCEPTION 'portal_case_already_reserved' USING ERRCODE = '40001';
  END IF;
  IF EXISTS (
    SELECT 1 FROM platform_private.student_portal_provisioning_receipts AS receipt
    WHERE receipt.normalized_email = v_normalized_email
  ) THEN
    RAISE EXCEPTION 'portal_email_already_reserved' USING ERRCODE = '40001';
  END IF;

  BEGIN
    INSERT INTO platform_private.student_portal_provisioning_receipts (
      request_id, organization_id, student_case_id, normalized_email,
      student_display_name, case_shape, legacy_curator_membership_id,
      fingerprint_sha256, authorizing_auth_user_id, authorizing_profile_id,
      authorizing_membership_id, authorizing_access_version,
      authorizing_bundle_id, authorizing_bundle_version,
      required_permission_keys
    ) VALUES (
      p_request_id, p_organization_id, p_student_case_id, v_normalized_email,
      v_normalized_display_name, p_case_shape, p_legacy_curator_membership_id,
      v_fingerprint_sha256, actor.actor_auth_user_id, actor.actor_profile_id,
      actor.actor_membership_id, actor_access_version,
      actor_bundle_id, actor_bundle_version, required_permissions
    ) RETURNING id INTO receipt_id;
  EXCEPTION WHEN unique_violation THEN
    IF EXISTS (
      SELECT 1 FROM platform_private.student_portal_provisioning_receipts AS receipt
      WHERE receipt.normalized_email = v_normalized_email
    ) THEN
      RAISE EXCEPTION 'portal_email_already_reserved' USING ERRCODE = '40001';
    END IF;
    IF EXISTS (
      SELECT 1 FROM platform_private.student_portal_provisioning_receipts AS receipt
      WHERE receipt.student_case_id = p_student_case_id
    ) THEN
      RAISE EXCEPTION 'portal_case_already_reserved' USING ERRCODE = '40001';
    END IF;
    RAISE;
  END;

  RETURN platform_private.student_portal_safe_snapshot(receipt_id, FALSE)
    || jsonb_build_object('replayed', FALSE);
END
$prep_new$;
  body := pg_catalog.replace(body, anchor, replacement);
  EXECUTE body;
END
$prepare_cabinet_patch$;

-- ---------------------------------------------------------------------------
-- d) finalize_student_portal_authority -- repoint the assertion call, add
--    the cabinet_pending state-shape branch and the cabinet_pending
--    activation branch. Same anchor technique and same drift protection.
-- ---------------------------------------------------------------------------
DO $finalize_cabinet_patch$
DECLARE body TEXT; anchor TEXT; replacement TEXT;
BEGIN
  body := pg_catalog.pg_get_functiondef(
    'platform.finalize_student_portal_authority(uuid,bigint,bigint)'::regprocedure
  );
  anchor := $fin_old$DECLARE
  receipt_hint RECORD;
  receipt platform_private.student_portal_provisioning_receipts%ROWTYPE;
  latest_attempt platform_private.student_portal_invite_attempts%ROWTYPE;
  target_case platform.student_cases%ROWTYPE;
  auth_row RECORD;
  membership_result JSONB;
  scope_result JSONB;
  curator_result JSONB;
  new_student_profile_id UUID;
  new_student_membership_id UUID;
  case_scope platform.record_scopes%ROWTYPE;
  child_membership UUID;
  child_org_scope UUID;
  child_case_scope UUID;
  child_legacy_curator UUID;
  child_final_audit UUID;
  occurred_at TIMESTAMPTZ := statement_timestamp();
  row_count INTEGER;
  continuing_bound_case BOOLEAN := FALSE;
  continuing_legacy_activation BOOLEAN := FALSE;
  bound_student_profile_id UUID;
  final_result JSONB;
BEGIN
  IF p_receipt_id IS NULL OR p_expected_receipt_version IS NULL
    OR p_expected_invite_generation IS NULL
  THEN RAISE EXCEPTION 'invalid student portal finalize input' USING ERRCODE = '22023'; END IF;

  SELECT candidate.organization_id, candidate.request_id
  INTO receipt_hint
  FROM platform_private.student_portal_provisioning_receipts AS candidate
  WHERE candidate.id = p_receipt_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'receipt unavailable' USING ERRCODE = 'P0002'; END IF;

  child_membership := platform_private.student_portal_child_request_id(
    receipt_hint.request_id, '01-membership-provision'
  );
  child_org_scope := platform_private.student_portal_child_request_id(
    receipt_hint.request_id, '02-organization-scope'
  );
  child_case_scope := platform_private.student_portal_child_request_id(
    receipt_hint.request_id, '03-student-case-scope'
  );
  child_legacy_curator := platform_private.student_portal_child_request_id(
    receipt_hint.request_id, '04-legacy-curator'
  );
  child_final_audit := platform_private.student_portal_child_request_id(
    receipt_hint.request_id, '05-student-portal-audit'
  );

  PERFORM platform_private.lock_student_case_note_assignment_domain(
    receipt_hint.organization_id
  );
  PERFORM platform_private.lock_student_portal_request_tree(receipt_hint.request_id);

  -- Canonical advisory locks precede the shared organization/profile/member
  -- row order. Subsequent E1 participant locks reacquire already-held rows.
  PERFORM 1 FROM platform.organizations WHERE id=receipt_hint.organization_id FOR UPDATE;
  SELECT * INTO receipt
  FROM platform_private.student_portal_provisioning_receipts AS candidate
  WHERE candidate.id = p_receipt_id FOR UPDATE;
  PERFORM profile.id FROM platform.profiles profile
  WHERE profile.id=ANY(array_remove(ARRAY[receipt.authorizing_profile_id,receipt.student_profile_id]::UUID[],NULL::UUID))
    OR EXISTS(SELECT 1 FROM platform.organization_memberships membership
      WHERE membership.organization_id=receipt.organization_id AND membership.profile_id=profile.id
        AND membership.id=ANY(array_remove(ARRAY[receipt.authorizing_membership_id,
          receipt.legacy_curator_membership_id,receipt.student_membership_id]::UUID[],NULL::UUID)))
  ORDER BY profile.id FOR UPDATE;
  PERFORM platform_private.staff_lock_memberships(receipt.organization_id,array_remove(
    ARRAY[receipt.authorizing_membership_id,receipt.legacy_curator_membership_id,receipt.student_membership_id]::UUID[],NULL::UUID));
  SELECT * INTO latest_attempt
  FROM platform_private.student_portal_invite_attempts AS attempt
  WHERE attempt.receipt_id = p_receipt_id
    AND attempt.invite_generation = receipt.invite_generation
  FOR UPDATE;

  PERFORM auth_user.id
  FROM auth.users AS auth_user
  WHERE auth_user.id = ANY (ARRAY[
    receipt.authorizing_auth_user_id, receipt.auth_user_id
  ]::UUID[])
  ORDER BY auth_user.id
  FOR UPDATE;
  SELECT * INTO target_case
  FROM platform.student_cases AS student_case
  WHERE student_case.organization_id = receipt.organization_id
    AND student_case.id = receipt.student_case_id
  FOR UPDATE;
  PERFORM membership.id
  FROM platform.organization_memberships AS membership
  WHERE membership.organization_id = receipt.organization_id
    AND membership.id = ANY (pg_catalog.array_remove(ARRAY[
      receipt.authorizing_membership_id,
      receipt.legacy_curator_membership_id,
      receipt.student_membership_id
    ]::UUID[], NULL::UUID))
  ORDER BY membership.id
  FOR UPDATE;
  PERFORM profile.id
  FROM platform.profiles AS profile
  WHERE profile.id = ANY (pg_catalog.array_remove(ARRAY[
    receipt.authorizing_profile_id, receipt.student_profile_id
  ]::UUID[], NULL::UUID))
  ORDER BY profile.id
  FOR UPDATE;

  IF receipt.invite_generation <> p_expected_invite_generation THEN
    RAISE EXCEPTION 'stale_invite_generation' USING ERRCODE = '40001';
  END IF;
  IF receipt.provisioning_state = 'authority_activated' THEN
    RETURN platform_private.student_portal_safe_snapshot(p_receipt_id, FALSE)
      || jsonb_build_object('replayed', TRUE);
  END IF;
  PERFORM platform_private.assert_student_portal_receipt_admin_e1(p_receipt_id);
  IF receipt.receipt_version <> p_expected_receipt_version THEN
    RAISE EXCEPTION 'stale_receipt_version' USING ERRCODE = '40001';
  END IF;
  IF receipt.provisioning_state <> 'invite_succeeded'
    OR receipt.auth_user_id IS NULL
    OR latest_attempt.id IS NULL
    OR (
      latest_attempt.attempt_state <> 'succeeded'
      AND receipt.invite_delivery_status <> 'accepted'
    )
  THEN RAISE EXCEPTION 'portal_authority_not_ready' USING ERRCODE = '40001'; END IF;

  SELECT auth_user.id,
         pg_catalog.lower(pg_catalog.btrim(auth_user.email)) AS email,
         COALESCE(auth_user.email_confirmed_at, auth_user.confirmed_at) AS confirmed_at
  INTO auth_row
  FROM auth.users AS auth_user
  WHERE auth_user.id = receipt.auth_user_id;
  IF NOT FOUND OR auth_row.email <> receipt.normalized_email THEN
    RAISE EXCEPTION 'portal_identity_conflict' USING ERRCODE = '40001';
  END IF;
  IF receipt.invite_delivery_status = 'accepted'
    AND auth_row.confirmed_at IS NULL
  THEN
    RAISE EXCEPTION 'portal_authority_not_ready' USING ERRCODE = '40001';
  END IF;
  IF target_case.id IS NULL THEN
    RAISE EXCEPTION 'portal_case_already_bound' USING ERRCODE = '40001';
  END IF;
  IF target_case.student_membership_id IS NOT NULL THEN
    SELECT membership.profile_id
    INTO bound_student_profile_id
    FROM platform.organization_memberships AS membership
    JOIN platform.profiles AS profile ON profile.id = membership.profile_id
    JOIN platform.role_bundle_versions AS bundle
      ON bundle.id = membership.current_bundle_id
      AND bundle.role = membership."current_role"
    WHERE membership.organization_id = receipt.organization_id
      AND membership.id = target_case.student_membership_id
      AND membership.status = 'active'
      AND membership."current_role" = 'student'
      AND profile.auth_user_id = receipt.auth_user_id
      AND profile.status = 'active'
      AND bundle.status = 'published'
      AND receipt.student_membership_id = membership.id
      AND receipt.student_profile_id = profile.id
    FOR UPDATE OF membership, profile, bundle;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'portal_case_already_bound' USING ERRCODE = '40001';
    END IF;
    continuing_bound_case := TRUE;
    IF target_case.portal_activated_at IS NOT NULL THEN
      IF receipt.case_shape <> 'legacy_pending' THEN
        RAISE EXCEPTION 'portal_case_already_bound' USING ERRCODE = '40001';
      END IF;
      continuing_legacy_activation := TRUE;
    END IF;
  END IF;
  IF receipt.case_shape = 'normal_u6' THEN
    IF target_case.state <> 'active'
      OR target_case.current_curator_membership_id IS NULL
      OR target_case.handoff_at IS NULL
      OR target_case.portal_activated_at IS NOT NULL
      OR target_case.closed_at IS NOT NULL
    THEN RAISE EXCEPTION 'portal_case_invalid_shape' USING ERRCODE = '40001'; END IF;
  ELSE
    IF (
      NOT continuing_legacy_activation
      AND (
        target_case.state <> 'pending'
        OR target_case.current_curator_membership_id IS NOT NULL
        OR target_case.handoff_at IS NOT NULL
        OR target_case.portal_activated_at IS NOT NULL
        OR target_case.closed_at IS NOT NULL
      )
    ) OR (
      continuing_legacy_activation
      AND (
        target_case.state <> 'active'
        OR target_case.current_curator_membership_id
          IS DISTINCT FROM receipt.legacy_curator_membership_id
        OR target_case.handoff_at IS NULL
        OR target_case.portal_activated_at IS NULL
        OR target_case.closed_at IS NOT NULL
      )
    )
      OR NOT EXISTS (
        SELECT 1
        FROM platform_private.staff_membership_identity(
          receipt.organization_id,receipt.legacy_curator_membership_id) identity
        WHERE platform_private.staff_can_receive_assignment(receipt.organization_id,identity.membership_id,
            'case.read.full','student_case',receipt.student_case_id)
          AND platform_private.staff_can_receive_assignment(receipt.organization_id,identity.membership_id,
            'task.manage','student_case',receipt.student_case_id)
      )
    THEN RAISE EXCEPTION 'portal_case_invalid_shape' USING ERRCODE = '40001'; END IF;
  END IF;

  SELECT * INTO case_scope
  FROM platform.record_scopes AS scope
  WHERE scope.organization_id = receipt.organization_id
    AND scope.id = target_case.current_scope_id
    AND scope.scope_version = target_case.current_scope_version
    AND scope.scope_kind = 'student_case'
    AND scope.scope_key = receipt.student_case_id
    AND scope.is_active
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active student-case scope is unavailable' USING ERRCODE = '55000';
  END IF;

  IF continuing_bound_case THEN
    new_student_profile_id := bound_student_profile_id;
    new_student_membership_id := target_case.student_membership_id;
    IF receipt.student_profile_id <> new_student_profile_id
      OR receipt.student_membership_id <> new_student_membership_id
      OR NOT EXISTS (
        SELECT 1
        FROM platform.audit_events AS event
        WHERE event.request_id = child_membership
          AND event.organization_id = receipt.organization_id
          AND event.actor_kind = 'user'
          AND event.actor_profile_id = receipt.authorizing_profile_id
          AND event.actor_principal
            = 'auth:' || receipt.authorizing_auth_user_id::TEXT
          AND event.action = 'membership.provision'
          AND event.resource_type = 'organization_membership'
          AND event.resource_id = new_student_membership_id
          AND event.before_state IS NULL
          AND event.reason = 'Student Portal provisioning'
          AND event.after_state ->> 'organization_id'
            = receipt.organization_id::TEXT
          AND event.after_state ->> 'profile_id' = new_student_profile_id::TEXT
          AND event.after_state ->> 'member_auth_user_id' = receipt.auth_user_id::TEXT
          AND event.after_state ->> 'display_name'
            = receipt.student_display_name
          AND event.after_state ->> 'membership_id'
            = new_student_membership_id::TEXT
          AND event.after_state ->> 'role' = 'student'
          AND event.after_state ->> 'status' = 'active'
          AND event.after_state ->> 'bundle_id' = (
            SELECT membership.current_bundle_id::TEXT
            FROM platform.organization_memberships AS membership
            WHERE membership.organization_id = receipt.organization_id
              AND membership.id = new_student_membership_id
          )
          AND event.after_state -> 'organization_scope_assigned' = 'false'::JSONB
          AND event.after_state ? 'access_version'
          AND (event.after_state ->> 'access_version')::BIGINT > 0
      )
      OR NOT EXISTS (
        SELECT 1
        FROM platform.membership_role_history AS history
        JOIN platform.organization_memberships AS membership
          ON membership.organization_id = history.organization_id
          AND membership.id = history.membership_id
        WHERE history.request_id = child_membership
          AND history.organization_id = receipt.organization_id
          AND history.membership_id = new_student_membership_id
          AND history.profile_id = new_student_profile_id
          AND history.role_version = 1
          AND history.previous_role IS NULL
          AND history.new_role = 'student'
          AND history.previous_bundle_id IS NULL
          AND history.new_bundle_id = membership.current_bundle_id
          AND history.actor_kind = 'user'
          AND history.actor_profile_id = receipt.authorizing_profile_id
          AND history.reason = 'Student Portal provisioning'
      )
      OR NOT EXISTS (
        SELECT 1
        FROM platform.audit_events AS event
        WHERE event.request_id = child_org_scope
          AND event.organization_id = receipt.organization_id
          AND event.action = 'membership.scope.organization.assign'
          AND event.resource_type = 'organization_membership'
          AND event.resource_id = new_student_membership_id
      )
      OR NOT EXISTS (
        SELECT 1
        FROM platform.membership_scope_assignments AS assignment
        JOIN platform.record_scopes AS scope
          ON scope.organization_id = assignment.organization_id
          AND scope.id = assignment.scope_id
          AND scope.scope_version = assignment.scope_version
        WHERE assignment.request_id = child_org_scope
          AND assignment.organization_id = receipt.organization_id
          AND assignment.membership_id = new_student_membership_id
          AND assignment.granted
          AND scope.scope_kind = 'organization'
          AND scope.scope_key = receipt.organization_id
          AND scope.is_active
          AND NOT EXISTS (
            SELECT 1
            FROM platform.membership_scope_assignments AS later
            WHERE later.organization_id = assignment.organization_id
              AND later.membership_id = assignment.membership_id
              AND later.scope_id = assignment.scope_id
              AND later.assignment_version > assignment.assignment_version
          )
      )
      OR (
        NOT continuing_legacy_activation
        AND NOT EXISTS (
          SELECT 1
          FROM platform.membership_scope_assignments AS assignment
          WHERE assignment.request_id = child_case_scope
            AND assignment.organization_id = receipt.organization_id
            AND assignment.membership_id = new_student_membership_id
            AND assignment.scope_id = case_scope.id
            AND assignment.scope_version = case_scope.scope_version
            AND assignment.granted
            AND NOT EXISTS (
              SELECT 1
              FROM platform.membership_scope_assignments AS later
              WHERE later.organization_id = assignment.organization_id
                AND later.membership_id = assignment.membership_id
                AND later.scope_id = assignment.scope_id
                AND later.assignment_version > assignment.assignment_version
            )
        )
      )
      OR (
        continuing_legacy_activation
        AND (
          NOT EXISTS (
            SELECT 1
            FROM platform.audit_events AS event
            WHERE event.request_id = child_legacy_curator
              AND event.organization_id = receipt.organization_id
              AND event.actor_kind = 'user'
              AND event.actor_profile_id = receipt.authorizing_profile_id
              AND event.actor_principal
                = 'auth:' || receipt.authorizing_auth_user_id::TEXT
              AND event.action = 'case.curator.set'
              AND event.resource_type = 'student_case'
              AND event.resource_id = receipt.student_case_id
              AND event.reason = 'Student Portal legacy Curator activation'
              AND event.after_state ->> 'curator_membership_id'
                = receipt.legacy_curator_membership_id::TEXT
              AND event.after_state ->> 'scope_id' = case_scope.id::TEXT
              AND (event.after_state ->> 'scope_version')::BIGINT
                = case_scope.scope_version
              AND (event.after_state ->> 'portal_activated_at')::TIMESTAMPTZ
                = target_case.portal_activated_at
          )
          OR NOT EXISTS (
            SELECT 1
            FROM platform.membership_scope_assignments AS assignment
            WHERE assignment.request_id = child_legacy_curator
              AND assignment.organization_id = receipt.organization_id
              AND assignment.membership_id = new_student_membership_id
              AND assignment.scope_id = case_scope.id
              AND assignment.scope_version = case_scope.scope_version
              AND assignment.granted
              AND NOT EXISTS (
                SELECT 1
                FROM platform.membership_scope_assignments AS later
                WHERE later.organization_id = assignment.organization_id
                  AND later.membership_id = assignment.membership_id
                  AND later.scope_id = assignment.scope_id
                  AND later.assignment_version > assignment.assignment_version
              )
          )
          OR NOT EXISTS (
            SELECT 1
            FROM platform.membership_scope_assignments AS assignment
            JOIN platform.audit_events AS event
              ON event.request_id = child_legacy_curator
              AND event.organization_id = assignment.organization_id
              AND event.before_state ->> 'scope_id' = assignment.scope_id::TEXT
              AND (event.before_state ->> 'scope_version')::BIGINT
                = assignment.scope_version
            WHERE assignment.request_id = child_case_scope
              AND assignment.organization_id = receipt.organization_id
              AND assignment.membership_id = new_student_membership_id
              AND assignment.granted
          )
        )
      )
    THEN
      RAISE EXCEPTION 'portal_identity_conflict' USING ERRCODE = '40001';
    END IF;

  ELSE
    BEGIN
      membership_result := platform_private.provision_member_authorized_e1(
        receipt.organization_id, receipt.auth_user_id, receipt.student_display_name,
        'student', 'Student Portal provisioning', child_membership,
        receipt.authorizing_profile_id, receipt.authorizing_auth_user_id
      );
    EXCEPTION
      WHEN invalid_parameter_value OR unique_violation THEN
        RAISE EXCEPTION 'portal_identity_conflict' USING ERRCODE = '40001';
    END;
    new_student_profile_id := (membership_result ->> 'profile_id')::UUID;
    new_student_membership_id := (membership_result ->> 'membership_id')::UUID;
    scope_result := platform_private.assign_organization_scope_authorized_e1(
      receipt.organization_id, new_student_membership_id,
      'Student Portal organization scope', child_org_scope,
      receipt.authorizing_profile_id, receipt.authorizing_auth_user_id
    );
    PERFORM platform_private.append_scope_event(
      receipt.organization_id, new_student_membership_id,
      case_scope.id, case_scope.scope_version, TRUE,
      'user', receipt.authorizing_profile_id,
      'Student Portal exact case scope', child_case_scope
    );
    UPDATE platform_private.student_portal_provisioning_receipts AS target
    SET student_profile_id = new_student_profile_id,
        student_membership_id = new_student_membership_id,
        updated_at = statement_timestamp()
    WHERE target.id = p_receipt_id;
    PERFORM pg_catalog.set_config(
      'platform.student_portal_bind_receipt_id', p_receipt_id::TEXT, TRUE
    );
    UPDATE platform.student_cases AS student_case
    SET student_membership_id = new_student_membership_id
    WHERE student_case.organization_id = receipt.organization_id
      AND student_case.id = receipt.student_case_id
      AND student_case.student_membership_id IS NULL;
    GET DIAGNOSTICS row_count = ROW_COUNT;
    IF row_count <> 1 THEN
      RAISE EXCEPTION 'portal_case_already_bound' USING ERRCODE = '40001';
    END IF;
    -- Mandatory extra bump after both scopes and the one-way bind.
    PERFORM platform_private.bump_access_version(new_student_profile_id);
  END IF;

  IF receipt.case_shape = 'normal_u6' THEN
    UPDATE platform.student_cases AS student_case
    SET portal_activated_at = occurred_at
    WHERE student_case.organization_id = receipt.organization_id
      AND student_case.id = receipt.student_case_id
      AND student_case.student_membership_id = new_student_membership_id
      AND student_case.state = 'active'
      AND student_case.portal_activated_at IS NULL
      AND student_case.closed_at IS NULL;
    GET DIAGNOSTICS row_count = ROW_COUNT;
    IF row_count <> 1 THEN
      RAISE EXCEPTION 'portal_case_invalid_shape' USING ERRCODE = '40001';
    END IF;
  ELSE
    curator_result := platform_private.assign_student_case_curator_authorized_e1(
      receipt.organization_id, receipt.student_case_id,
      receipt.legacy_curator_membership_id,
      'Student Portal legacy Curator activation', child_legacy_curator,
      receipt.authorizing_profile_id, receipt.authorizing_membership_id,
      receipt.authorizing_auth_user_id
    );
    occurred_at := (curator_result ->> 'portal_activated_at')::TIMESTAMPTZ;
  END IF;

  final_result := jsonb_build_object(
    'receipt_id', receipt.id,
    'request_id', receipt.request_id,
    'student_case_id', receipt.student_case_id,
    'case_shape', receipt.case_shape,
    'student_profile_id', new_student_profile_id,
    'student_membership_id', new_student_membership_id,
    'portal_activated_at', occurred_at,
    'authority_activated', TRUE
  );
  INSERT INTO platform.audit_events (
    organization_id, actor_kind, actor_profile_id, actor_principal,
    action, resource_type, resource_id, before_state, after_state,
    reason, request_id
  ) VALUES (
    receipt.organization_id, 'user', receipt.authorizing_profile_id,
    'auth:' || receipt.authorizing_auth_user_id::TEXT,
    'student.portal.authority.activate', 'student_case', receipt.student_case_id,
    jsonb_build_object(
      'student_membership_id', target_case.student_membership_id,
      'portal_activated_at', target_case.portal_activated_at,
      'case_shape', receipt.case_shape
    ),
    final_result,
    'Student Portal authority activation', child_final_audit
  );

  UPDATE platform_private.student_portal_provisioning_receipts AS target
  SET provisioning_state = 'authority_activated',
      student_profile_id = new_student_profile_id,
      student_membership_id = new_student_membership_id,
      authority_activated_at = occurred_at,
      receipt_version = target.receipt_version + 1,
      safe_error_code = NULL,
      updated_at = statement_timestamp()
  WHERE target.id = p_receipt_id;
  RETURN platform_private.student_portal_safe_snapshot(p_receipt_id, FALSE)
    || jsonb_build_object('replayed', FALSE);
END
$fin_old$;
  IF (pg_catalog.length(body) - pg_catalog.length(pg_catalog.replace(body, anchor, '')))
      / pg_catalog.length(anchor) <> 1 THEN
    RAISE EXCEPTION 'student_portal_finalize_cabinet_source_drift' USING ERRCODE = '55000';
  END IF;
  replacement := $fin_new$DECLARE
  receipt_hint RECORD;
  receipt platform_private.student_portal_provisioning_receipts%ROWTYPE;
  latest_attempt platform_private.student_portal_invite_attempts%ROWTYPE;
  target_case platform.student_cases%ROWTYPE;
  auth_row RECORD;
  membership_result JSONB;
  scope_result JSONB;
  curator_result JSONB;
  new_student_profile_id UUID;
  new_student_membership_id UUID;
  case_scope platform.record_scopes%ROWTYPE;
  child_membership UUID;
  child_org_scope UUID;
  child_case_scope UUID;
  child_legacy_curator UUID;
  child_final_audit UUID;
  occurred_at TIMESTAMPTZ := statement_timestamp();
  row_count INTEGER;
  continuing_bound_case BOOLEAN := FALSE;
  continuing_legacy_activation BOOLEAN := FALSE;
  bound_student_profile_id UUID;
  final_result JSONB;
BEGIN
  IF p_receipt_id IS NULL OR p_expected_receipt_version IS NULL
    OR p_expected_invite_generation IS NULL
  THEN RAISE EXCEPTION 'invalid student portal finalize input' USING ERRCODE = '22023'; END IF;

  SELECT candidate.organization_id, candidate.request_id
  INTO receipt_hint
  FROM platform_private.student_portal_provisioning_receipts AS candidate
  WHERE candidate.id = p_receipt_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'receipt unavailable' USING ERRCODE = 'P0002'; END IF;

  child_membership := platform_private.student_portal_child_request_id(
    receipt_hint.request_id, '01-membership-provision'
  );
  child_org_scope := platform_private.student_portal_child_request_id(
    receipt_hint.request_id, '02-organization-scope'
  );
  child_case_scope := platform_private.student_portal_child_request_id(
    receipt_hint.request_id, '03-student-case-scope'
  );
  child_legacy_curator := platform_private.student_portal_child_request_id(
    receipt_hint.request_id, '04-legacy-curator'
  );
  child_final_audit := platform_private.student_portal_child_request_id(
    receipt_hint.request_id, '05-student-portal-audit'
  );

  PERFORM platform_private.lock_student_case_note_assignment_domain(
    receipt_hint.organization_id
  );
  PERFORM platform_private.lock_student_portal_request_tree(receipt_hint.request_id);

  -- Canonical advisory locks precede the shared organization/profile/member
  -- row order. Subsequent E1 participant locks reacquire already-held rows.
  PERFORM 1 FROM platform.organizations WHERE id=receipt_hint.organization_id FOR UPDATE;
  SELECT * INTO receipt
  FROM platform_private.student_portal_provisioning_receipts AS candidate
  WHERE candidate.id = p_receipt_id FOR UPDATE;
  PERFORM profile.id FROM platform.profiles profile
  WHERE profile.id=ANY(array_remove(ARRAY[receipt.authorizing_profile_id,receipt.student_profile_id]::UUID[],NULL::UUID))
    OR EXISTS(SELECT 1 FROM platform.organization_memberships membership
      WHERE membership.organization_id=receipt.organization_id AND membership.profile_id=profile.id
        AND membership.id=ANY(array_remove(ARRAY[receipt.authorizing_membership_id,
          receipt.legacy_curator_membership_id,receipt.student_membership_id]::UUID[],NULL::UUID)))
  ORDER BY profile.id FOR UPDATE;
  PERFORM platform_private.staff_lock_memberships(receipt.organization_id,array_remove(
    ARRAY[receipt.authorizing_membership_id,receipt.legacy_curator_membership_id,receipt.student_membership_id]::UUID[],NULL::UUID));
  SELECT * INTO latest_attempt
  FROM platform_private.student_portal_invite_attempts AS attempt
  WHERE attempt.receipt_id = p_receipt_id
    AND attempt.invite_generation = receipt.invite_generation
  FOR UPDATE;

  PERFORM auth_user.id
  FROM auth.users AS auth_user
  WHERE auth_user.id = ANY (ARRAY[
    receipt.authorizing_auth_user_id, receipt.auth_user_id
  ]::UUID[])
  ORDER BY auth_user.id
  FOR UPDATE;
  SELECT * INTO target_case
  FROM platform.student_cases AS student_case
  WHERE student_case.organization_id = receipt.organization_id
    AND student_case.id = receipt.student_case_id
  FOR UPDATE;
  PERFORM membership.id
  FROM platform.organization_memberships AS membership
  WHERE membership.organization_id = receipt.organization_id
    AND membership.id = ANY (pg_catalog.array_remove(ARRAY[
      receipt.authorizing_membership_id,
      receipt.legacy_curator_membership_id,
      receipt.student_membership_id
    ]::UUID[], NULL::UUID))
  ORDER BY membership.id
  FOR UPDATE;
  PERFORM profile.id
  FROM platform.profiles AS profile
  WHERE profile.id = ANY (pg_catalog.array_remove(ARRAY[
    receipt.authorizing_profile_id, receipt.student_profile_id
  ]::UUID[], NULL::UUID))
  ORDER BY profile.id
  FOR UPDATE;

  IF receipt.invite_generation <> p_expected_invite_generation THEN
    RAISE EXCEPTION 'stale_invite_generation' USING ERRCODE = '40001';
  END IF;
  IF receipt.provisioning_state = 'authority_activated' THEN
    RETURN platform_private.student_portal_safe_snapshot(p_receipt_id, FALSE)
      || jsonb_build_object('replayed', TRUE);
  END IF;
  PERFORM platform_private.assert_student_portal_receipt_authority_e1(p_receipt_id);
  IF receipt.receipt_version <> p_expected_receipt_version THEN
    RAISE EXCEPTION 'stale_receipt_version' USING ERRCODE = '40001';
  END IF;
  IF receipt.provisioning_state <> 'invite_succeeded'
    OR receipt.auth_user_id IS NULL
    OR latest_attempt.id IS NULL
    OR (
      latest_attempt.attempt_state <> 'succeeded'
      AND receipt.invite_delivery_status <> 'accepted'
    )
  THEN RAISE EXCEPTION 'portal_authority_not_ready' USING ERRCODE = '40001'; END IF;

  SELECT auth_user.id,
         pg_catalog.lower(pg_catalog.btrim(auth_user.email)) AS email,
         COALESCE(auth_user.email_confirmed_at, auth_user.confirmed_at) AS confirmed_at
  INTO auth_row
  FROM auth.users AS auth_user
  WHERE auth_user.id = receipt.auth_user_id;
  IF NOT FOUND OR auth_row.email <> receipt.normalized_email THEN
    RAISE EXCEPTION 'portal_identity_conflict' USING ERRCODE = '40001';
  END IF;
  IF receipt.invite_delivery_status = 'accepted'
    AND auth_row.confirmed_at IS NULL
  THEN
    RAISE EXCEPTION 'portal_authority_not_ready' USING ERRCODE = '40001';
  END IF;
  IF target_case.id IS NULL THEN
    RAISE EXCEPTION 'portal_case_already_bound' USING ERRCODE = '40001';
  END IF;
  IF target_case.student_membership_id IS NOT NULL THEN
    SELECT membership.profile_id
    INTO bound_student_profile_id
    FROM platform.organization_memberships AS membership
    JOIN platform.profiles AS profile ON profile.id = membership.profile_id
    JOIN platform.role_bundle_versions AS bundle
      ON bundle.id = membership.current_bundle_id
      AND bundle.role = membership."current_role"
    WHERE membership.organization_id = receipt.organization_id
      AND membership.id = target_case.student_membership_id
      AND membership.status = 'active'
      AND membership."current_role" = 'student'
      AND profile.auth_user_id = receipt.auth_user_id
      AND profile.status = 'active'
      AND bundle.status = 'published'
      AND receipt.student_membership_id = membership.id
      AND receipt.student_profile_id = profile.id
    FOR UPDATE OF membership, profile, bundle;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'portal_case_already_bound' USING ERRCODE = '40001';
    END IF;
    continuing_bound_case := TRUE;
    IF target_case.portal_activated_at IS NOT NULL THEN
      IF receipt.case_shape <> 'legacy_pending' THEN
        RAISE EXCEPTION 'portal_case_already_bound' USING ERRCODE = '40001';
      END IF;
      continuing_legacy_activation := TRUE;
    END IF;
  END IF;
  IF receipt.case_shape = 'normal_u6' THEN
    IF target_case.state <> 'active'
      OR target_case.current_curator_membership_id IS NULL
      OR target_case.handoff_at IS NULL
      OR target_case.portal_activated_at IS NOT NULL
      OR target_case.closed_at IS NOT NULL
    THEN RAISE EXCEPTION 'portal_case_invalid_shape' USING ERRCODE = '40001'; END IF;
  ELSIF receipt.case_shape = 'cabinet_pending' THEN
    -- No continuing_* flag needed: cabinet_pending never changes state,
    -- curator or handoff_at at finalize time (only portal_activated_at,
    -- below), so this same condition legally holds both before AND during
    -- a continuing_bound_case re-entry (the case's own genuineness was
    -- already re-verified live by assert_student_portal_receipt_authority_e1
    -- above, resolving the lead fresh from receipt.student_case_id).
    IF target_case.state <> 'pending'
      OR target_case.current_curator_membership_id IS NOT NULL
      OR target_case.handoff_at IS NOT NULL
      OR target_case.portal_activated_at IS NOT NULL
      OR target_case.closed_at IS NOT NULL
    THEN RAISE EXCEPTION 'portal_case_invalid_shape' USING ERRCODE = '40001'; END IF;
  ELSE
    IF (
      NOT continuing_legacy_activation
      AND (
        target_case.state <> 'pending'
        OR target_case.current_curator_membership_id IS NOT NULL
        OR target_case.handoff_at IS NOT NULL
        OR target_case.portal_activated_at IS NOT NULL
        OR target_case.closed_at IS NOT NULL
      )
    ) OR (
      continuing_legacy_activation
      AND (
        target_case.state <> 'active'
        OR target_case.current_curator_membership_id
          IS DISTINCT FROM receipt.legacy_curator_membership_id
        OR target_case.handoff_at IS NULL
        OR target_case.portal_activated_at IS NULL
        OR target_case.closed_at IS NOT NULL
      )
    )
      OR NOT EXISTS (
        SELECT 1
        FROM platform_private.staff_membership_identity(
          receipt.organization_id,receipt.legacy_curator_membership_id) identity
        WHERE platform_private.staff_can_receive_assignment(receipt.organization_id,identity.membership_id,
            'case.read.full','student_case',receipt.student_case_id)
          AND platform_private.staff_can_receive_assignment(receipt.organization_id,identity.membership_id,
            'task.manage','student_case',receipt.student_case_id)
      )
    THEN RAISE EXCEPTION 'portal_case_invalid_shape' USING ERRCODE = '40001'; END IF;
  END IF;

  SELECT * INTO case_scope
  FROM platform.record_scopes AS scope
  WHERE scope.organization_id = receipt.organization_id
    AND scope.id = target_case.current_scope_id
    AND scope.scope_version = target_case.current_scope_version
    AND scope.scope_kind = 'student_case'
    AND scope.scope_key = receipt.student_case_id
    AND scope.is_active
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active student-case scope is unavailable' USING ERRCODE = '55000';
  END IF;

  IF continuing_bound_case THEN
    new_student_profile_id := bound_student_profile_id;
    new_student_membership_id := target_case.student_membership_id;
    IF receipt.student_profile_id <> new_student_profile_id
      OR receipt.student_membership_id <> new_student_membership_id
      OR NOT EXISTS (
        SELECT 1
        FROM platform.audit_events AS event
        WHERE event.request_id = child_membership
          AND event.organization_id = receipt.organization_id
          AND event.actor_kind = 'user'
          AND event.actor_profile_id = receipt.authorizing_profile_id
          AND event.actor_principal
            = 'auth:' || receipt.authorizing_auth_user_id::TEXT
          AND event.action = 'membership.provision'
          AND event.resource_type = 'organization_membership'
          AND event.resource_id = new_student_membership_id
          AND event.before_state IS NULL
          AND event.reason = 'Student Portal provisioning'
          AND event.after_state ->> 'organization_id'
            = receipt.organization_id::TEXT
          AND event.after_state ->> 'profile_id' = new_student_profile_id::TEXT
          AND event.after_state ->> 'member_auth_user_id' = receipt.auth_user_id::TEXT
          AND event.after_state ->> 'display_name'
            = receipt.student_display_name
          AND event.after_state ->> 'membership_id'
            = new_student_membership_id::TEXT
          AND event.after_state ->> 'role' = 'student'
          AND event.after_state ->> 'status' = 'active'
          AND event.after_state ->> 'bundle_id' = (
            SELECT membership.current_bundle_id::TEXT
            FROM platform.organization_memberships AS membership
            WHERE membership.organization_id = receipt.organization_id
              AND membership.id = new_student_membership_id
          )
          AND event.after_state -> 'organization_scope_assigned' = 'false'::JSONB
          AND event.after_state ? 'access_version'
          AND (event.after_state ->> 'access_version')::BIGINT > 0
      )
      OR NOT EXISTS (
        SELECT 1
        FROM platform.membership_role_history AS history
        JOIN platform.organization_memberships AS membership
          ON membership.organization_id = history.organization_id
          AND membership.id = history.membership_id
        WHERE history.request_id = child_membership
          AND history.organization_id = receipt.organization_id
          AND history.membership_id = new_student_membership_id
          AND history.profile_id = new_student_profile_id
          AND history.role_version = 1
          AND history.previous_role IS NULL
          AND history.new_role = 'student'
          AND history.previous_bundle_id IS NULL
          AND history.new_bundle_id = membership.current_bundle_id
          AND history.actor_kind = 'user'
          AND history.actor_profile_id = receipt.authorizing_profile_id
          AND history.reason = 'Student Portal provisioning'
      )
      OR NOT EXISTS (
        SELECT 1
        FROM platform.audit_events AS event
        WHERE event.request_id = child_org_scope
          AND event.organization_id = receipt.organization_id
          AND event.action = 'membership.scope.organization.assign'
          AND event.resource_type = 'organization_membership'
          AND event.resource_id = new_student_membership_id
      )
      OR NOT EXISTS (
        SELECT 1
        FROM platform.membership_scope_assignments AS assignment
        JOIN platform.record_scopes AS scope
          ON scope.organization_id = assignment.organization_id
          AND scope.id = assignment.scope_id
          AND scope.scope_version = assignment.scope_version
        WHERE assignment.request_id = child_org_scope
          AND assignment.organization_id = receipt.organization_id
          AND assignment.membership_id = new_student_membership_id
          AND assignment.granted
          AND scope.scope_kind = 'organization'
          AND scope.scope_key = receipt.organization_id
          AND scope.is_active
          AND NOT EXISTS (
            SELECT 1
            FROM platform.membership_scope_assignments AS later
            WHERE later.organization_id = assignment.organization_id
              AND later.membership_id = assignment.membership_id
              AND later.scope_id = assignment.scope_id
              AND later.assignment_version > assignment.assignment_version
          )
      )
      OR (
        NOT continuing_legacy_activation
        AND NOT EXISTS (
          SELECT 1
          FROM platform.membership_scope_assignments AS assignment
          WHERE assignment.request_id = child_case_scope
            AND assignment.organization_id = receipt.organization_id
            AND assignment.membership_id = new_student_membership_id
            AND assignment.scope_id = case_scope.id
            AND assignment.scope_version = case_scope.scope_version
            AND assignment.granted
            AND NOT EXISTS (
              SELECT 1
              FROM platform.membership_scope_assignments AS later
              WHERE later.organization_id = assignment.organization_id
                AND later.membership_id = assignment.membership_id
                AND later.scope_id = assignment.scope_id
                AND later.assignment_version > assignment.assignment_version
            )
        )
      )
      OR (
        continuing_legacy_activation
        AND (
          NOT EXISTS (
            SELECT 1
            FROM platform.audit_events AS event
            WHERE event.request_id = child_legacy_curator
              AND event.organization_id = receipt.organization_id
              AND event.actor_kind = 'user'
              AND event.actor_profile_id = receipt.authorizing_profile_id
              AND event.actor_principal
                = 'auth:' || receipt.authorizing_auth_user_id::TEXT
              AND event.action = 'case.curator.set'
              AND event.resource_type = 'student_case'
              AND event.resource_id = receipt.student_case_id
              AND event.reason = 'Student Portal legacy Curator activation'
              AND event.after_state ->> 'curator_membership_id'
                = receipt.legacy_curator_membership_id::TEXT
              AND event.after_state ->> 'scope_id' = case_scope.id::TEXT
              AND (event.after_state ->> 'scope_version')::BIGINT
                = case_scope.scope_version
              AND (event.after_state ->> 'portal_activated_at')::TIMESTAMPTZ
                = target_case.portal_activated_at
          )
          OR NOT EXISTS (
            SELECT 1
            FROM platform.membership_scope_assignments AS assignment
            WHERE assignment.request_id = child_legacy_curator
              AND assignment.organization_id = receipt.organization_id
              AND assignment.membership_id = new_student_membership_id
              AND assignment.scope_id = case_scope.id
              AND assignment.scope_version = case_scope.scope_version
              AND assignment.granted
              AND NOT EXISTS (
                SELECT 1
                FROM platform.membership_scope_assignments AS later
                WHERE later.organization_id = assignment.organization_id
                  AND later.membership_id = assignment.membership_id
                  AND later.scope_id = assignment.scope_id
                  AND later.assignment_version > assignment.assignment_version
              )
          )
          OR NOT EXISTS (
            SELECT 1
            FROM platform.membership_scope_assignments AS assignment
            JOIN platform.audit_events AS event
              ON event.request_id = child_legacy_curator
              AND event.organization_id = assignment.organization_id
              AND event.before_state ->> 'scope_id' = assignment.scope_id::TEXT
              AND (event.before_state ->> 'scope_version')::BIGINT
                = assignment.scope_version
            WHERE assignment.request_id = child_case_scope
              AND assignment.organization_id = receipt.organization_id
              AND assignment.membership_id = new_student_membership_id
              AND assignment.granted
          )
        )
      )
    THEN
      RAISE EXCEPTION 'portal_identity_conflict' USING ERRCODE = '40001';
    END IF;

  ELSE
    BEGIN
      membership_result := platform_private.provision_member_authorized_e1(
        receipt.organization_id, receipt.auth_user_id, receipt.student_display_name,
        'student', 'Student Portal provisioning', child_membership,
        receipt.authorizing_profile_id, receipt.authorizing_auth_user_id
      );
    EXCEPTION
      WHEN invalid_parameter_value OR unique_violation THEN
        RAISE EXCEPTION 'portal_identity_conflict' USING ERRCODE = '40001';
    END;
    new_student_profile_id := (membership_result ->> 'profile_id')::UUID;
    new_student_membership_id := (membership_result ->> 'membership_id')::UUID;
    scope_result := platform_private.assign_organization_scope_authorized_e1(
      receipt.organization_id, new_student_membership_id,
      'Student Portal organization scope', child_org_scope,
      receipt.authorizing_profile_id, receipt.authorizing_auth_user_id
    );
    PERFORM platform_private.append_scope_event(
      receipt.organization_id, new_student_membership_id,
      case_scope.id, case_scope.scope_version, TRUE,
      'user', receipt.authorizing_profile_id,
      'Student Portal exact case scope', child_case_scope
    );
    UPDATE platform_private.student_portal_provisioning_receipts AS target
    SET student_profile_id = new_student_profile_id,
        student_membership_id = new_student_membership_id,
        updated_at = statement_timestamp()
    WHERE target.id = p_receipt_id;
    PERFORM pg_catalog.set_config(
      'platform.student_portal_bind_receipt_id', p_receipt_id::TEXT, TRUE
    );
    UPDATE platform.student_cases AS student_case
    SET student_membership_id = new_student_membership_id
    WHERE student_case.organization_id = receipt.organization_id
      AND student_case.id = receipt.student_case_id
      AND student_case.student_membership_id IS NULL;
    GET DIAGNOSTICS row_count = ROW_COUNT;
    IF row_count <> 1 THEN
      RAISE EXCEPTION 'portal_case_already_bound' USING ERRCODE = '40001';
    END IF;
    -- Mandatory extra bump after both scopes and the one-way bind.
    PERFORM platform_private.bump_access_version(new_student_profile_id);
  END IF;

  IF receipt.case_shape = 'normal_u6' THEN
    UPDATE platform.student_cases AS student_case
    SET portal_activated_at = occurred_at
    WHERE student_case.organization_id = receipt.organization_id
      AND student_case.id = receipt.student_case_id
      AND student_case.student_membership_id = new_student_membership_id
      AND student_case.state = 'active'
      AND student_case.portal_activated_at IS NULL
      AND student_case.closed_at IS NULL;
    GET DIAGNOSTICS row_count = ROW_COUNT;
    IF row_count <> 1 THEN
      RAISE EXCEPTION 'portal_case_invalid_shape' USING ERRCODE = '40001';
    END IF;
  ELSIF receipt.case_shape = 'cabinet_pending' THEN
    -- Plan §4: approving cabinet access never creates a handoff or assigns
    -- a curator. ONLY portal_activated_at moves; state stays 'pending' and
    -- current_curator_membership_id stays NULL until a real Sales report
    -- handoff (S2) or Admissions acceptance (S3) touches this case.
    UPDATE platform.student_cases AS student_case
    SET portal_activated_at = occurred_at
    WHERE student_case.organization_id = receipt.organization_id
      AND student_case.id = receipt.student_case_id
      AND student_case.student_membership_id = new_student_membership_id
      AND student_case.state = 'pending'
      AND student_case.current_curator_membership_id IS NULL
      AND student_case.portal_activated_at IS NULL
      AND student_case.closed_at IS NULL;
    GET DIAGNOSTICS row_count = ROW_COUNT;
    IF row_count <> 1 THEN
      RAISE EXCEPTION 'portal_case_invalid_shape' USING ERRCODE = '40001';
    END IF;
  ELSE
    curator_result := platform_private.assign_student_case_curator_authorized_e1(
      receipt.organization_id, receipt.student_case_id,
      receipt.legacy_curator_membership_id,
      'Student Portal legacy Curator activation', child_legacy_curator,
      receipt.authorizing_profile_id, receipt.authorizing_membership_id,
      receipt.authorizing_auth_user_id
    );
    occurred_at := (curator_result ->> 'portal_activated_at')::TIMESTAMPTZ;
  END IF;

  final_result := jsonb_build_object(
    'receipt_id', receipt.id,
    'request_id', receipt.request_id,
    'student_case_id', receipt.student_case_id,
    'case_shape', receipt.case_shape,
    'student_profile_id', new_student_profile_id,
    'student_membership_id', new_student_membership_id,
    'portal_activated_at', occurred_at,
    'authority_activated', TRUE
  );
  INSERT INTO platform.audit_events (
    organization_id, actor_kind, actor_profile_id, actor_principal,
    action, resource_type, resource_id, before_state, after_state,
    reason, request_id
  ) VALUES (
    receipt.organization_id, 'user', receipt.authorizing_profile_id,
    'auth:' || receipt.authorizing_auth_user_id::TEXT,
    'student.portal.authority.activate', 'student_case', receipt.student_case_id,
    jsonb_build_object(
      'student_membership_id', target_case.student_membership_id,
      'portal_activated_at', target_case.portal_activated_at,
      'case_shape', receipt.case_shape
    ),
    final_result,
    'Student Portal authority activation', child_final_audit
  );

  UPDATE platform_private.student_portal_provisioning_receipts AS target
  SET provisioning_state = 'authority_activated',
      student_profile_id = new_student_profile_id,
      student_membership_id = new_student_membership_id,
      authority_activated_at = occurred_at,
      receipt_version = target.receipt_version + 1,
      safe_error_code = NULL,
      updated_at = statement_timestamp()
  WHERE target.id = p_receipt_id;
  RETURN platform_private.student_portal_safe_snapshot(p_receipt_id, FALSE)
    || jsonb_build_object('replayed', FALSE);
END
$fin_new$;
  body := pg_catalog.replace(body, anchor, replacement);
  EXECUTE body;
END
$finalize_cabinet_patch$;

-- ---------------------------------------------------------------------------
-- e) authorize_student_portal_invite_reissue -- cabinet_pending branch.
--    Untouched by any prior migration's DO block (verified by grep across
--    every migration file) -- its body has never drifted from 126's
--    original text, so a plain CREATE OR REPLACE with the full body is safe
--    here (unlike (c)/(d) above).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION platform.authorize_student_portal_invite_reissue(
  p_receipt_id UUID,
  p_expected_receipt_version BIGINT,
  p_expected_invite_generation BIGINT,
  p_reissue_request_id UUID,
  p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  receipt_hint RECORD;
  receipt platform_private.student_portal_provisioning_receipts%ROWTYPE;
  permission_key TEXT;
  v_lead_id UUID;
  actor RECORD;
  actor_access_version BIGINT;
  auth_row RECORD;
BEGIN
  IF p_receipt_id IS NULL OR p_expected_receipt_version IS NULL
    OR p_expected_invite_generation IS NULL OR p_reissue_request_id IS NULL
    OR pg_catalog.char_length(pg_catalog.btrim(COALESCE(p_reason, '')))
      NOT BETWEEN 1 AND 1000
  THEN
    RAISE EXCEPTION 'invalid student portal reissue authorization'
      USING ERRCODE = '22023';
  END IF;
  SELECT candidate.organization_id, candidate.request_id,
         candidate.required_permission_keys, candidate.case_shape,
         candidate.student_case_id
  INTO receipt_hint
  FROM platform_private.student_portal_provisioning_receipts AS candidate
  WHERE candidate.id = p_receipt_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'receipt unavailable' USING ERRCODE = 'P0002'; END IF;

  IF receipt_hint.case_shape = 'cabinet_pending' THEN
    v_lead_id := platform_private.resolve_student_portal_cabinet_lead_e1(
      receipt_hint.organization_id, receipt_hint.student_case_id
    );
    PERFORM 1 FROM platform_private.require_student_portal_cabinet_actor_e1(
      receipt_hint.organization_id, v_lead_id
    );
  ELSE
    FOREACH permission_key IN ARRAY receipt_hint.required_permission_keys LOOP
      PERFORM 1 FROM platform_private.require_admin_actor(
        receipt_hint.organization_id, permission_key
      );
    END LOOP;
  END IF;
  PERFORM platform_private.lock_student_case_note_assignment_domain(
    receipt_hint.organization_id
  );
  PERFORM platform_private.lock_p2d_request(p_reissue_request_id);
  PERFORM platform_private.lock_student_portal_request_tree(receipt_hint.request_id);

  SELECT * INTO receipt
  FROM platform_private.student_portal_provisioning_receipts AS candidate
  WHERE candidate.id = p_receipt_id FOR UPDATE;
  IF EXISTS (
    SELECT 1
    FROM platform_private.student_portal_provisioning_receipts AS candidate
    WHERE candidate.reissue_request_id = p_reissue_request_id
      AND candidate.id <> p_receipt_id
  ) OR EXISTS (
    SELECT 1 FROM platform_private.student_portal_invite_attempts AS attempt
    WHERE attempt.reissue_request_id = p_reissue_request_id
      AND attempt.receipt_id <> p_receipt_id
  ) THEN
    RAISE EXCEPTION 'request_replay_conflict' USING ERRCODE = '40001';
  END IF;
  IF receipt.reissue_request_id = p_reissue_request_id
    OR EXISTS (
      SELECT 1 FROM platform_private.student_portal_invite_attempts AS attempt
      WHERE attempt.reissue_request_id = p_reissue_request_id
        AND attempt.receipt_id = p_receipt_id
    )
  THEN
    RETURN platform_private.student_portal_safe_snapshot(p_receipt_id, FALSE)
      || jsonb_build_object('replayed', TRUE);
  END IF;
  IF receipt.receipt_version <> p_expected_receipt_version THEN
    RAISE EXCEPTION 'stale_receipt_version' USING ERRCODE = '40001';
  END IF;
  IF receipt.invite_generation <> p_expected_invite_generation THEN
    RAISE EXCEPTION 'stale_invite_generation' USING ERRCODE = '40001';
  END IF;
  IF receipt.invite_delivery_status = 'accepted' THEN
    RAISE EXCEPTION 'portal_invite_already_accepted' USING ERRCODE = '40001';
  END IF;
  IF receipt.invite_delivery_status <> 'issued'
    OR receipt.auth_user_id IS NULL
    OR receipt.invite_expires_at IS NULL
    OR statement_timestamp() < receipt.invite_expires_at
  THEN
    RAISE EXCEPTION 'portal_invite_not_expired' USING ERRCODE = '40001';
  END IF;

  IF receipt.case_shape = 'cabinet_pending' THEN
    v_lead_id := platform_private.resolve_student_portal_cabinet_lead_e1(
      receipt.organization_id, receipt.student_case_id
    );
    SELECT * INTO actor FROM platform_private.require_student_portal_cabinet_actor_e1(
      receipt.organization_id, v_lead_id
    );
  ELSE
    FOREACH permission_key IN ARRAY receipt.required_permission_keys LOOP
      SELECT * INTO actor FROM platform_private.require_admin_actor(
        receipt.organization_id, permission_key
      );
    END LOOP;
  END IF;
  SELECT profile.access_version
  INTO actor_access_version
  FROM platform.profiles AS profile
  WHERE profile.id = actor.actor_profile_id
    AND profile.auth_user_id = actor.actor_auth_user_id
    AND profile.status = 'active'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'portal_admin_authority_changed' USING ERRCODE = '42501';
  END IF;

  SELECT auth_user.id, pg_catalog.lower(pg_catalog.btrim(auth_user.email)) AS email,
         COALESCE(auth_user.email_confirmed_at, auth_user.confirmed_at) AS confirmed_at
  INTO auth_row
  FROM auth.users AS auth_user
  WHERE auth_user.id = receipt.auth_user_id
  FOR UPDATE;
  IF NOT FOUND OR auth_row.email <> receipt.normalized_email THEN
    RAISE EXCEPTION 'portal_identity_conflict' USING ERRCODE = '40001';
  END IF;
  IF auth_row.confirmed_at IS NOT NULL THEN
    RAISE EXCEPTION 'portal_invite_already_accepted' USING ERRCODE = '40001';
  END IF;

  BEGIN
    UPDATE platform_private.student_portal_provisioning_receipts AS target
    SET invite_delivery_status = 'expired',
        reissue_request_id = p_reissue_request_id,
        reissue_authorized_by_auth_user_id = actor.actor_auth_user_id,
        reissue_authorized_by_profile_id = actor.actor_profile_id,
        reissue_authorized_by_membership_id = actor.actor_membership_id,
        reissue_authorized_access_version = actor_access_version,
        reissue_authorized_at = statement_timestamp(),
        receipt_version = target.receipt_version + 1,
        safe_error_code = NULL,
        updated_at = statement_timestamp()
    WHERE target.id = p_receipt_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'request_replay_conflict' USING ERRCODE = '40001';
  END;
  RETURN platform_private.student_portal_safe_snapshot(p_receipt_id, FALSE)
    || jsonb_build_object('replayed', FALSE);
END
$$;


REVOKE ALL ON FUNCTION platform.authorize_student_portal_invite_reissue(
  UUID, BIGINT, BIGINT, UUID, TEXT
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.authorize_student_portal_invite_reissue(
  UUID, BIGINT, BIGINT, UUID, TEXT
) TO authenticated;

-- ---------------------------------------------------------------------------
-- Comments + close
-- ---------------------------------------------------------------------------
COMMENT ON FUNCTION platform_private.assert_student_portal_receipt_authority_e1(UUID) IS
  'S8: normal_u6/legacy_pending delegate verbatim to assert_student_portal_receipt_admin_e1; cabinet_pending re-verifies admin-or-sales + live staff_can_access(lead.sales.workflow.manage) on the lead resolved fresh from the receipt''s student_case, every call.';
COMMENT ON FUNCTION platform.prepare_student_portal_provisioning(UUID,UUID,TEXT,TEXT,TEXT,UUID,TEXT,UUID) IS
  'S8: adds cabinet_pending (184''s curator-less lead-cabinet case). normal_u6/legacy_pending stay admin-only via require_admin_actor; cabinet_pending authorizes admin-or-sales via staff_can_access on the case''s own canonical_lead_id.';
COMMENT ON FUNCTION platform.finalize_student_portal_authority(UUID,BIGINT,BIGINT) IS
  'S8: cabinet_pending binds membership/org-scope via the shared bind branch then sets ONLY portal_activated_at (state stays pending, no curator, no handoff_at) -- plan §4: approving access never creates a handoff or assigns a curator.';
COMMENT ON FUNCTION platform.authorize_student_portal_invite_reissue(UUID,BIGINT,BIGINT,UUID,TEXT) IS
  'S8: cabinet_pending receipts authorize reissue via admin-or-sales + staff_can_access on the linked lead, instead of require_admin_actor (which is admin-only regardless of the permission key checked).';
COMMENT ON FUNCTION platform.staff_student_case_cabinet_origin_v1(UUID,UUID) IS
  'S8: companion read for StudentPortalAccessCard''s three-way discriminator -- TRUE when the case is a genuine 184 lead-cabinet origin (source_key LIKE lead-cabinet:%, canonical_lead_id set), independent of case state.';

COMMIT;
