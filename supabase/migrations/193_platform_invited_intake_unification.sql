-- PORT-1b «приглашённый проходит ту же анкету и одобрение».
-- docs/EVO_PORTAL_WEB_IPHONE_PLAN_2026-09-19.md §2 («Приглашения»), §5
-- «Новый клиент по приглашению» (+ строка edge cases), §10 PORT-1;
-- docs/design/portal/port-0-contracts.md «Решение: модель доступа»;
-- docs/PLAN_CHANGES.md «PORT-1b: приглашённый проходит ту же анкету и
-- одобрение (миграция 193)» (2026-09-19, the binding contract).
--
-- Intent. Plan §5: a NEW invited client opens the invite, passes the SAME
-- анкета and the SAME staff approval; the invite links them to the existing
-- record but never bypasses the анкета. Today (126/185) an accepted invite
-- activates the portal at finalize time: membership + case bind +
-- portal_activated_at are written when the invite email dispatch succeeds,
-- and the set-password flow drops the user straight into /portal.
--
-- Compatibility boundary is TEMPORAL, not data-shape-derived: only invites
-- dispatched AFTER this migration follow the new path. The receipt gains
-- intake_flow ('legacy' DEFAULT | 'anketa_v1'); prepare (the dispatch RPC)
-- starts stamping 'anketa_v1' for new receipts; every existing receipt gets
-- 'legacy' via the DEFAULT and keeps today's behaviour byte-for-byte. Both
-- live production accounts (2 cases, both active, per the PORT-0 read-only
-- audit) carry no marker and are untouched.
--
-- Deliberate deviation, enforced by CHECK below: case_shape='legacy_pending'
-- always stays intake_flow='legacy'. That legacy shape's whole acceptance
-- semantic is curator assignment + state flip at finalize; routing it через
-- анкету would silently defer the curator assignment the shape exists to
-- perform. The unified workflow no longer prepares such receipts (184/185
-- replaced the path with the Sales cabinet), and the Sales UI cannot create
-- them for cabinet cases.
--
-- Changes:
--  a) student_portal_provisioning_receipts.intake_flow
--     ('legacy' DEFAULT | 'anketa_v1') + shape-compat CHECK.
--  b) platform_private.student_applications.invited_case_id (nullable, FK,
--     CHECK: approved ⇒ student_case_id = invited_case_id).
--  c) prepare_student_portal_provisioning: the receipt INSERT stamps
--     intake_flow='anketa_v1' for normal_u6/cabinet_pending, 'legacy' for
--     legacy_pending. Sales UI unchanged.
--  d) finalize_student_portal_authority: for intake_flow='anketa_v1' the
--     shared bind branch still runs (membership, org scope, exact case
--     scope, student_membership_id — so approval never re-provisions), but
--     finalize RETURNS BEFORE activation: portal_activated_at stays NULL,
--     the receipt stays 'invite_succeeded' (account_pending=true). The
--     invited user therefore has NO portal authority until the анкета is
--     approved — «инвайт больше не даёт прямой вход в кабинет» is a database
--     fact, not just a web-router redirect.
--  e) resolve_student_portal_invite_identity: the returned JSON additionally
--     carries intake_flow and student_display_name (the caller's own receipt
--     row, already their own data) — the TS guard layer routes anketa_v1
--     account-pending sessions to /apply and prefills the name.
--  f) submit_student_application_v1: when auth.uid() owns an accepted
--     anketa_v1 receipt, the application is linked to the invite's case
--     (invited_case_id + canonical_lead_id from the case — never a second
--     client/lead, «один человек — одна карточка»), and the invite-bound
--     Student membership is carved out of the identity-conflict gate (any
--     OTHER membership still raises PT409 exactly as before). Idempotency
--     unchanged: advisory locks + receipts + PT409, never 40001 (the 186
--     lesson).
--  g) decide_student_application_v1: the approve branch REUSES the invited
--     case when invited_case_id is set (185-style): no new membership, lead
--     or case; portal_activated_at via a guarded UPDATE only when NULL;
--     state/curator/handoff untouched; fresh анкета data lands in
--     student_profiles (INSERT for a profile-less cabinet case, bounded
--     UPDATE for an existing profile); the invite receipt completes to
--     'authority_activated'. A foreign auth user bound to someone else's
--     invite case is refused 42501. The ordinary (non-invite) branch is
--     preserved inside ELSE with ONE discovered-defect repair (see (g5)
--     below and PLAN_CHANGES): 042's BEFORE INSERT guard forbids
--     portal_activated_at on a new case, so 180's INSERT-with-activation
--     could never commit; the case is now inserted unactivated and then
--     activated by the same guarded UPDATE 185 uses.
--
-- Technique: pg_get_functiondef + exact anchors + EXECUTE everywhere
-- (образец 180:417-460 / 192:61-72), fail-loud on anchor drift. Latest live
-- bodies verified by grep across every migration: submit/decide — 180
-- (187-192 never touch them); prepare/finalize — 185 ($prep_new$/$fin_new$);
-- resolve — 186 (PT409 patch outside the anchored block).
--
-- Error codes follow the existing families: PT409 for expected business
-- conflicts (178/186 retry lesson: PostgREST retries 40001, so a
-- non-retryable conflict must never use it), 42501 for authority denials.
BEGIN;

-- ---------------------------------------------------------------------------
-- a) receipts: intake_flow marker (temporal compatibility boundary)
-- ---------------------------------------------------------------------------
ALTER TABLE platform_private.student_portal_provisioning_receipts
  ADD COLUMN intake_flow TEXT NOT NULL DEFAULT 'legacy',
  ADD CONSTRAINT student_portal_receipts_intake_flow_check
    CHECK (intake_flow IN ('legacy', 'anketa_v1')),
  ADD CONSTRAINT student_portal_receipts_intake_flow_shape_check
    CHECK (NOT (case_shape = 'legacy_pending' AND intake_flow = 'anketa_v1'));

-- ---------------------------------------------------------------------------
-- b) student_applications: invited_case_id (the анкета→invite-case link)
-- ---------------------------------------------------------------------------
ALTER TABLE platform_private.student_applications
  ADD COLUMN invited_case_id UUID,
  ADD CONSTRAINT student_applications_invited_case_fkey
    FOREIGN KEY (organization_id, invited_case_id)
    REFERENCES platform.student_cases(organization_id, id),
  -- Decision-shape compatibility: an invited application, once approved,
  -- must have been bound to EXACTLY its invite case. student_case_id's own
  -- pending/rejected NULL requirement stays governed by 180's
  -- student_applications_decision_shape_check, untouched here.
  ADD CONSTRAINT student_applications_invited_case_shape_check
    CHECK (
      invited_case_id IS NULL
      OR status <> 'approved'
      OR student_case_id = invited_case_id
    );

-- ---------------------------------------------------------------------------
-- Shared single-anchor patch helper (exact copy of 192's idiom).
-- ---------------------------------------------------------------------------
CREATE FUNCTION pg_temp.evo_p193_invited_intake_replace(p_signature TEXT, p_before TEXT, p_after TEXT, p_expected INTEGER DEFAULT 1)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE body TEXT; occurrences INTEGER;
BEGIN
  SELECT pg_get_functiondef(p_signature::regprocedure) INTO body;
  occurrences := (length(body) - length(replace(body, p_before, ''))) / length(p_before);
  IF occurrences <> p_expected THEN
    RAISE EXCEPTION 'evo_p193_invited_intake_anchor_mismatch: % (% instead of %)', p_signature, occurrences, p_expected;
  END IF;
  EXECUTE replace(body, p_before, p_after);
END
$$;

-- ---------------------------------------------------------------------------
-- c) prepare_student_portal_provisioning: stamp intake_flow at dispatch.
--    Live body = 185's $prep_new$ replacement (nothing later touched it).
-- ---------------------------------------------------------------------------
SELECT pg_temp.evo_p193_invited_intake_replace(
  'platform.prepare_student_portal_provisioning(uuid,uuid,text,text,text,uuid,text,uuid)',
  $p193_prep_old$    INSERT INTO platform_private.student_portal_provisioning_receipts (
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
    ) RETURNING id INTO receipt_id;$p193_prep_old$,
  $p193_prep_new$    INSERT INTO platform_private.student_portal_provisioning_receipts (
      request_id, organization_id, student_case_id, normalized_email,
      student_display_name, case_shape, legacy_curator_membership_id,
      fingerprint_sha256, authorizing_auth_user_id, authorizing_profile_id,
      authorizing_membership_id, authorizing_access_version,
      authorizing_bundle_id, authorizing_bundle_version,
      required_permission_keys, intake_flow
    ) VALUES (
      p_request_id, p_organization_id, p_student_case_id, v_normalized_email,
      v_normalized_display_name, p_case_shape, p_legacy_curator_membership_id,
      v_fingerprint_sha256, actor.actor_auth_user_id, actor.actor_profile_id,
      actor.actor_membership_id, actor_access_version,
      actor_bundle_id, actor_bundle_version, required_permissions,
      -- PORT-1b (193): every NEW invite goes через анкету. legacy_pending is
      -- deliberately excluded (see the header) and keeps the legacy flow.
      CASE WHEN p_case_shape = 'legacy_pending' THEN 'legacy' ELSE 'anketa_v1' END
    ) RETURNING id INTO receipt_id;$p193_prep_new$);

-- ---------------------------------------------------------------------------
-- d) finalize_student_portal_authority: anketa_v1 binds but never activates.
--    Live body = 185's $fin_new$ replacement. The anchor is the activation
--    step (the state-shape validation earlier in the body starts with the
--    same IF line but continues differently, so this text is unique).
-- ---------------------------------------------------------------------------
SELECT pg_temp.evo_p193_invited_intake_replace(
  'platform.finalize_student_portal_authority(uuid,bigint,bigint)',
  $p193_fin_old$  IF receipt.case_shape = 'normal_u6' THEN
    UPDATE platform.student_cases AS student_case
    SET portal_activated_at = occurred_at$p193_fin_old$,
  $p193_fin_new$  -- PORT-1b (193): an anketa_v1 invite never activates the portal at
  -- finalize time. The bind above (membership, organization scope, exact
  -- case scope, student_membership_id) has already happened or been
  -- re-verified, so the анкета approval never re-provisions; the receipt
  -- deliberately stays 'invite_succeeded' (account_pending) until
  -- decide_student_application_v1 approves the анкета, activates the case
  -- and completes this receipt. Re-entry is symmetric: a replayed finalize
  -- re-verifies the bind audit trail above and returns here again.
  IF receipt.intake_flow = 'anketa_v1' THEN
    RETURN platform_private.student_portal_safe_snapshot(p_receipt_id, FALSE)
      || jsonb_build_object('replayed', FALSE);
  END IF;

  IF receipt.case_shape = 'normal_u6' THEN
    UPDATE platform.student_cases AS student_case
    SET portal_activated_at = occurred_at$p193_fin_new$);

-- ---------------------------------------------------------------------------
-- e) resolve_student_portal_invite_identity: expose intake_flow and the
--    caller's own display name. Live body = 126's text with 186's PT409
--    substitution; the anchored RETURN block was not touched by 186.
--    intake_flow is NOT NULL, student_display_name is NOT NULL — neither is
--    ever stripped by jsonb_strip_nulls.
-- ---------------------------------------------------------------------------
SELECT pg_temp.evo_p193_invited_intake_replace(
  'platform.resolve_student_portal_invite_identity(uuid,text,boolean)',
  $p193_res_old$    'authority_activated', receipt.provisioning_state = 'authority_activated',
    'account_pending', receipt.provisioning_state <> 'authority_activated'
  ));$p193_res_old$,
  $p193_res_new$    'authority_activated', receipt.provisioning_state = 'authority_activated',
    'account_pending', receipt.provisioning_state <> 'authority_activated',
    'intake_flow', receipt.intake_flow,
    'student_display_name', receipt.student_display_name
  ));$p193_res_new$);

-- ---------------------------------------------------------------------------
-- f) submit_student_application_v1: link the анкета to the caller's own
--    accepted anketa_v1 invite. Live body = 180's (checked: 181-192 never
--    reference it). Three anchors, ONE EXECUTE (the body is only valid once
--    all three replacements are applied together).
-- ---------------------------------------------------------------------------
DO $p193_submit_patch$
DECLARE
  body TEXT;
  pair TEXT[];
  pairs TEXT[][];
  occurrences INTEGER;
BEGIN
  body := pg_get_functiondef('platform.submit_student_application_v1(uuid,jsonb,bigint)'::regprocedure);
  pairs := ARRAY[
    -- (f1) DECLARE: the invite receipt and its case.
    [$p193_sub_a$DECLARE email TEXT; org UUID; app platform_private.student_applications%ROWTYPE;
 receipt platform_private.student_application_receipts%ROWTYPE; payload JSONB;
 owner_membership_id UUID; linked_client_id UUID; linked_lead_id UUID;$p193_sub_a$,
     $p193_sub_b$DECLARE email TEXT; org UUID; app platform_private.student_applications%ROWTYPE;
 receipt platform_private.student_application_receipts%ROWTYPE; payload JSONB;
 owner_membership_id UUID; linked_client_id UUID; linked_lead_id UUID;
 invite_receipt platform_private.student_portal_provisioning_receipts%ROWTYPE;
 invited_case platform.student_cases%ROWTYPE;$p193_sub_b$],
    -- (f2) Identity gate: carve out ONLY the caller's own invite-bound
    -- Student membership (anketa_v1, accepted, same normalized email). Any
    -- other membership — including a legacy-invite one — keeps today's
    -- PT409. auth_user_id and normalized_email are UNIQUE on receipts, so
    -- at most one row can match.
    [$p193_sub_c$ IF EXISTS(SELECT 1 FROM platform.profiles p JOIN platform.organization_memberships m ON m.profile_id=p.id WHERE p.auth_user_id=auth.uid()) THEN
  RAISE EXCEPTION 'student_application_identity_conflict' USING ERRCODE='PT409'; END IF;$p193_sub_c$,
     $p193_sub_d$ SELECT r.* INTO invite_receipt FROM platform_private.student_portal_provisioning_receipts r
  WHERE r.auth_user_id=auth.uid() AND r.organization_id=org
   AND r.intake_flow='anketa_v1' AND r.invite_delivery_status='accepted'
   AND r.normalized_email=email;
 IF EXISTS(SELECT 1 FROM platform.profiles p JOIN platform.organization_memberships m ON m.profile_id=p.id
  WHERE p.auth_user_id=auth.uid()
   AND (invite_receipt.id IS NULL OR invite_receipt.student_membership_id IS NULL
    OR m.id<>invite_receipt.student_membership_id)) THEN
  RAISE EXCEPTION 'student_application_identity_conflict' USING ERRCODE='PT409'; END IF;$p193_sub_d$],
    -- (f3) Link the invited анкета to the invite's own case/lead instead of
    -- creating a second client/lead. The link is re-derived server-side from
    -- the caller's OWN receipt on every (re)submit — a resumed draft or a
    -- rejected-and-resubmitted анкета keeps its invite context, and a
    -- foreign auth user has no receipt to reach someone else's case.
    [$p193_sub_e$ IF app.canonical_lead_id IS NULL THEN$p193_sub_e$,
     $p193_sub_f$ IF invite_receipt.id IS NOT NULL THEN
  SELECT c.* INTO invited_case FROM platform.student_cases c
  WHERE c.organization_id=org AND c.id=invite_receipt.student_case_id;
  IF invited_case.id IS NULL THEN
   RAISE EXCEPTION 'student_application_identity_conflict' USING ERRCODE='PT409'; END IF;
  IF app.invited_case_id IS DISTINCT FROM invited_case.id
  OR app.canonical_lead_id IS DISTINCT FROM invited_case.canonical_lead_id THEN
   UPDATE platform_private.student_applications SET invited_case_id=invited_case.id,canonical_lead_id=invited_case.canonical_lead_id
   WHERE id=app.id RETURNING * INTO app;
  END IF;
 ELSIF app.canonical_lead_id IS NULL THEN$p193_sub_f$]
  ];
  FOREACH pair SLICE 1 IN ARRAY pairs LOOP
    occurrences := (length(body) - length(replace(body, pair[1], ''))) / length(pair[1]);
    IF occurrences <> 1 THEN
      RAISE EXCEPTION 'evo_p193_submit_anchor_mismatch (% occurrences): %', occurrences, left(pair[1], 80);
    END IF;
    body := replace(body, pair[1], pair[2]);
  END LOOP;
  EXECUTE body;
END
$p193_submit_patch$;

-- ---------------------------------------------------------------------------
-- g) decide_student_application_v1: approve reuses the invited case.
--    Live body = 180's. Five anchors, ONE EXECUTE. The ordinary branch is
--    preserved byte-for-byte inside ELSE (anchors g3/g4 only open and close
--    the IF around it).
-- ---------------------------------------------------------------------------
DO $p193_decide_patch$
DECLARE
  body TEXT;
  pair TEXT[];
  pairs TEXT[][];
  occurrences INTEGER;
BEGIN
  body := pg_get_functiondef('platform.decide_student_application_v1(uuid,bigint,text,text,uuid)'::regprocedure);
  pairs := ARRAY[
    -- (g1) DECLARE: invite receipt, its case, an existing profile row and a
    -- guarded-update row counter.
    [$p193_dec_a$ q JSONB; email TEXT; lead_id UUID; owner_membership_id UUID;$p193_dec_a$,
     $p193_dec_b$ q JSONB; email TEXT; lead_id UUID; owner_membership_id UUID;
 invite_receipt platform_private.student_portal_provisioning_receipts%ROWTYPE;
 invited_case platform.student_cases%ROWTYPE; existing_profile platform.student_profiles%ROWTYPE;
 invited_row_count INTEGER;$p193_dec_b$],
    -- (g2) Identity gate: an invited application's auth user must be EXACTLY
    -- the receipt's bound user for that case (anyone else — 42501); the
    -- invite-bound membership itself is not an identity conflict, any other
    -- membership still is. Non-invited applications keep 180's gate verbatim.
    [$p193_dec_c$  IF EXISTS(SELECT 1 FROM platform.profiles p JOIN platform.organization_memberships m ON m.profile_id=p.id WHERE p.auth_user_id=app.auth_user_id) THEN
   RAISE EXCEPTION 'student_application_identity_conflict' USING ERRCODE='PT409'; END IF;$p193_dec_c$,
     $p193_dec_d$  IF app.invited_case_id IS NOT NULL THEN
   SELECT r.* INTO invite_receipt FROM platform_private.student_portal_provisioning_receipts r
   WHERE r.organization_id=org AND r.student_case_id=app.invited_case_id
    AND r.intake_flow='anketa_v1' AND r.invite_delivery_status='accepted'
    AND r.student_membership_id IS NOT NULL;
   IF invite_receipt.id IS NULL OR invite_receipt.auth_user_id IS DISTINCT FROM app.auth_user_id THEN
    RAISE EXCEPTION 'student_application_forbidden' USING ERRCODE='42501'; END IF;
   IF EXISTS(SELECT 1 FROM platform.profiles p JOIN platform.organization_memberships m ON m.profile_id=p.id
    WHERE p.auth_user_id=app.auth_user_id AND m.id<>invite_receipt.student_membership_id) THEN
    RAISE EXCEPTION 'student_application_identity_conflict' USING ERRCODE='PT409'; END IF;
  ELSIF EXISTS(SELECT 1 FROM platform.profiles p JOIN platform.organization_memberships m ON m.profile_id=p.id WHERE p.auth_user_id=app.auth_user_id) THEN
   RAISE EXCEPTION 'student_application_identity_conflict' USING ERRCODE='PT409'; END IF;$p193_dec_d$],
    -- (g3) Open the invited-approve branch right before the ordinary
    -- provision/case-creation body. The invited case is reused exactly as a
    -- 185 finalize would have activated it: portal_activated_at only (and
    -- only when still NULL), state/curator/handoff untouched, no new
    -- membership/lead/case; fresh анкета data lands in student_profiles; the
    -- invite receipt completes to 'authority_activated' so guards, the staff
    -- card and finalize replays all see one consistent terminal state.
    [$p193_dec_e$  child_membership:=platform_private.student_portal_child_request_id(p_request_id,'public_student_membership');$p193_dec_e$,
     $p193_dec_f$  IF app.invited_case_id IS NOT NULL THEN
   SELECT c.* INTO invited_case FROM platform.student_cases c
   WHERE c.organization_id=org AND c.id=app.invited_case_id FOR UPDATE;
   IF invited_case.id IS NULL
   OR invited_case.student_membership_id IS DISTINCT FROM invite_receipt.student_membership_id THEN
    RAISE EXCEPTION 'student_application_forbidden' USING ERRCODE='42501'; END IF;
   new_case:=invited_case.id;
   member_id:=invited_case.student_membership_id;
   profile_id:=invite_receipt.student_profile_id;
   IF invited_case.portal_activated_at IS NULL THEN
    UPDATE platform.student_cases SET portal_activated_at=statement_timestamp()
    WHERE organization_id=org AND id=invited_case.id
     AND portal_activated_at IS NULL AND closed_at IS NULL;
    GET DIAGNOSTICS invited_row_count=ROW_COUNT;
    IF invited_row_count<>1 THEN
     RAISE EXCEPTION 'student_application_conflict' USING ERRCODE='PT409'; END IF;
   END IF;
   UPDATE platform_private.student_portal_provisioning_receipts r
   SET provisioning_state='authority_activated',
    authority_activated_at=COALESCE(r.authority_activated_at,statement_timestamp()),
    receipt_version=r.receipt_version+1,safe_error_code=NULL,updated_at=statement_timestamp()
   WHERE r.id=invite_receipt.id AND r.provisioning_state<>'authority_activated';
   SELECT sp.* INTO existing_profile FROM platform.student_profiles sp
   WHERE sp.organization_id=org AND sp.student_case_id=invited_case.id FOR UPDATE;
   IF existing_profile.id IS NULL THEN
    INSERT INTO platform.student_profiles(organization_id,student_case_id,revision,preferred_display_name,legal_display_name,
     citizenship_country,current_education_summary,academic_summary,language_summary,budget_band,decision_participant_labels,
     consent_status,consent_evidence_ref,created_by_membership_id,updated_by_membership_id)
    VALUES(org,invited_case.id,1,(q->>'firstName')||' '||(q->>'lastName'),NULL,q->>'nationality',education_label,
     (q->>'averageGrade')||' / '||(q->>'gradeScale'),
     language_label,budget_label,ARRAY[]::TEXT[],'granted','student_application:'||app.id::TEXT||':consent:2026-09-18',actor.membership_id,actor.membership_id)
    RETURNING id INTO new_profile;
    FOR field IN SELECT * FROM (VALUES
     ('student_first_name',q->>'firstName'),('student_last_name',q->>'lastName'),('mobile_phone',q->>'phone'),('student_email',CASE WHEN length(email)<=120 THEN email ELSE NULL END),
     ('nationality',NULL::TEXT),('current_study_status',education_label),('budget_per_year',budget_label)
    ) AS fields(key,value) WHERE key='nationality' OR value IS NOT NULL LOOP
     INSERT INTO platform.student_profile_fields(organization_id,student_case_id,student_profile_id,field_key,value,review_state,profile_revision)
     VALUES(org,invited_case.id,new_profile,field.key,field.value,'needs_review',1);
    END LOOP;
   ELSE
    -- Bounded refresh of the анкета-derived summary fields only; the card
    -- fields / profile_revision machinery (150/151/184) is deliberately not
    -- regenerated here.
    UPDATE platform.student_profiles SET citizenship_country=q->>'nationality',current_education_summary=education_label,
     academic_summary=(q->>'averageGrade')||' / '||(q->>'gradeScale'),language_summary=language_label,budget_band=budget_label,
     updated_by_membership_id=actor.membership_id,updated_at=statement_timestamp()
    WHERE id=existing_profile.id;
   END IF;
   PERFORM platform_private.bump_access_version(profile_id);
   UPDATE platform_private.student_applications SET status='approved',revision=revision+1,decided_at=statement_timestamp(),
    decided_by_membership_id=actor.membership_id,decision_reason=btrim(p_reason),student_case_id=invited_case.id,admissions_direction=NULL WHERE id=app.id;
  ELSE
  child_membership:=platform_private.student_portal_child_request_id(p_request_id,'public_student_membership');$p193_dec_f$],
    -- (g4) Close the invited-approve branch after the ordinary branch's own
    -- final approved UPDATE (which keeps student_case_id=new_case).
    [$p193_dec_g$  UPDATE platform_private.student_applications SET status='approved',revision=revision+1,decided_at=statement_timestamp(),
   decided_by_membership_id=actor.membership_id,decision_reason=btrim(p_reason),student_case_id=new_case,admissions_direction=NULL WHERE id=app.id;
 END IF;$p193_dec_g$,
     $p193_dec_h$  UPDATE platform_private.student_applications SET status='approved',revision=revision+1,decided_at=statement_timestamp(),
   decided_by_membership_id=actor.membership_id,decision_reason=btrim(p_reason),student_case_id=new_case,admissions_direction=NULL WHERE id=app.id;
  END IF;
 END IF;$p193_dec_h$],
    -- (g5) Discovered defect fix inside the ordinary branch (validation
    -- finding, recorded in PLAN_CHANGES): 042's guard_student_case_transition
    -- (BEFORE INSERT, never patched since 042) requires portal_activated_at
    -- IS NULL on a NEW case, so 180's INSERT-with-activation could never
    -- commit — unreachable until now because production has 0 анкет and no
    -- test ever called decide. Insert the case unactivated, then set
    -- portal_activated_at via the guarded UPDATE path 185 already uses for
    -- pending cases; the 042 trigger itself stays untouched.
    [$p193_dec_i$  INSERT INTO platform.student_cases(id,organization_id,student_membership_id,responsible_sales_membership_id,source_key,
   student_display_name,target_country,target_degree,intake,operational_stage,state,portal_activated_at,
   current_scope_id,current_scope_version,public_application_id,canonical_lead_id)
  VALUES(new_case,org,member_id,owner_membership_id,'public_student_application:'||app.id::TEXT,(q->>'firstName')||' '||(q->>'lastName'),
   NULL,target_degree_label,intake_label,'intake_review','pending',statement_timestamp(),
   scope_id,1,app.id,lead_id);$p193_dec_i$,
     $p193_dec_j$  INSERT INTO platform.student_cases(id,organization_id,student_membership_id,responsible_sales_membership_id,source_key,
   student_display_name,target_country,target_degree,intake,operational_stage,state,
   current_scope_id,current_scope_version,public_application_id,canonical_lead_id)
  VALUES(new_case,org,member_id,owner_membership_id,'public_student_application:'||app.id::TEXT,(q->>'firstName')||' '||(q->>'lastName'),
   NULL,target_degree_label,intake_label,'intake_review','pending',
   scope_id,1,app.id,lead_id);
  UPDATE platform.student_cases SET portal_activated_at=statement_timestamp()
  WHERE organization_id=org AND id=new_case AND portal_activated_at IS NULL AND closed_at IS NULL;
  GET DIAGNOSTICS invited_row_count=ROW_COUNT;
  IF invited_row_count<>1 THEN
   RAISE EXCEPTION 'student_application_conflict' USING ERRCODE='PT409'; END IF;$p193_dec_j$]
  ];
  FOREACH pair SLICE 1 IN ARRAY pairs LOOP
    occurrences := (length(body) - length(replace(body, pair[1], ''))) / length(pair[1]);
    IF occurrences <> 1 THEN
      RAISE EXCEPTION 'evo_p193_decide_anchor_mismatch (% occurrences): %', occurrences, left(pair[1], 80);
    END IF;
    body := replace(body, pair[1], pair[2]);
  END LOOP;
  EXECUTE body;
END
$p193_decide_patch$;

NOTIFY pgrst,'reload schema';
COMMIT;
