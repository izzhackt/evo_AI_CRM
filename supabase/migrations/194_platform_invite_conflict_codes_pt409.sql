-- PORT-1b follow-up (review of PR #877): the invite family's authenticated
-- re-invite path still raises business conflicts as SQLSTATE 40001.
--
-- Intent. 40001 is serialization_failure; PostgREST retries the SAME
-- transaction on it, and an expected business conflict (a case that already
-- holds a receipt, an already-bound case, a stale caller version) can never
-- become success by retrying — the retry loop is infinite. This exact class
-- caused the 2026-09-19 CPU incident (99–100% CPU, 29,894
-- portal_identity_conflict/40001 events in five minutes; see
-- docs/qa/portal-identity-conflict-186-2026-09-19.md and
-- https://supabase.com/docs/guides/troubleshooting/high-cpu-and-infinite-transaction-retries-when-using-custom-error-codes-in-rpc-functions-77326b).
-- Migration 186 converted only resolve_student_portal_invite_identity (3)
-- and accept_student_portal_invite_e1 (2); 178 set the same PT409 rule for
-- the анкета RPCs; 193 already raises PT409 in every line it added. This
-- migration converts the remaining business 40001 codes on the invite
-- dispatch/re-invite path:
--
--   platform.prepare_student_portal_provisioning (authenticated; live body =
--   185 $prep_new$ + 193 (c)) — 11 sites:
--     portal_curator_required x2, request_replay_conflict x1,
--     portal_case_already_bound x1, portal_case_invalid_shape x3,
--     portal_case_already_reserved x2, portal_email_already_reserved x2.
--   platform.authorize_student_portal_invite_reissue (authenticated; live
--   body = 185's CREATE OR REPLACE) — 8 sites:
--     request_replay_conflict x2, stale_receipt_version x1,
--     stale_invite_generation x1, portal_invite_already_accepted x2,
--     portal_invite_not_expired x1, portal_identity_conflict x1.
--   platform.finalize_student_portal_authority (service_role, still invoked
--   THROUGH PostgREST by the dispatch coordinator — the 186 storm was on
--   exactly such a service-role PostgREST call; live body = 185 $fin_new$ +
--   193 (d)) — 16 sites:
--     stale_invite_generation x1, stale_receipt_version x1,
--     portal_authority_not_ready x2, portal_identity_conflict x3,
--     portal_case_already_bound x4, portal_case_invalid_shape x5.
--
-- Only the SQLSTATE changes; every message, guard, grant and body byte stays
-- identical, so the store mapping (message-keyed) is unchanged. The server
-- mappers already accept PT409 (student-portal-invite-store) or are updated
-- additively alongside this migration (student-portal-provisioning-admin-store).
--
-- Deliberately left at 40001 (NOT touched here):
--   * The service_role dispatch/reconcile worker RPCs outside the
--     authenticated re-invite path: claim_student_portal_invite,
--     claim_student_portal_invite_reissue, record_student_portal_invite_success,
--     platform_private.record_student_portal_invite_terminal_e1 (failure/
--     unknown), reconcile_student_portal_invite,
--     record_student_portal_invite_accepted, and the
--     platform_private.guard_student_case_identity_e1 trigger. Same
--     transition stance 186 recorded: the coordinator's mapper understands
--     both codes; they can follow in their own reviewed migration.
--   * Genuine optimistic-revision 40001 elsewhere (assessments' expected_revision
--     machinery, 135+) — real revision semantics, out of scope.
--
-- Technique: pg_get_functiondef + byte-exact anchors + EXECUTE (образец
-- 186/192/193), fail-loud on live-body drift, with a terminal assertion that
-- each patched function retains ZERO 40001 sites and exactly the expected
-- PT409 count.
BEGIN;

CREATE FUNCTION pg_temp.evo_p194_conflict_code_replace(p_signature TEXT, p_before TEXT, p_after TEXT, p_expected INTEGER DEFAULT 1)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE body TEXT; occurrences INTEGER;
BEGIN
  SELECT pg_get_functiondef(p_signature::regprocedure) INTO body;
  occurrences := (length(body) - length(replace(body, p_before, ''))) / length(p_before);
  IF occurrences <> p_expected THEN
    RAISE EXCEPTION 'evo_p194_conflict_code_anchor_mismatch: % (% instead of %)', p_signature, occurrences, p_expected;
  END IF;
  EXECUTE replace(body, p_before, p_after);
END
$$;

-- ---------------------------------------------------------------------------
-- a) prepare_student_portal_provisioning — the authenticated (re-)invite RPC.
--    Anchors are the exact RAISE statements of the post-193 live body; the
--    expected count pins every occurrence of each business code.
-- ---------------------------------------------------------------------------
SELECT pg_temp.evo_p194_conflict_code_replace(
  'platform.prepare_student_portal_provisioning(uuid,uuid,text,text,text,uuid,text,uuid)',
  $p194$RAISE EXCEPTION 'portal_curator_required' USING ERRCODE = '40001';$p194$,
  $p194$RAISE EXCEPTION 'portal_curator_required' USING ERRCODE = 'PT409';$p194$,
  2);
SELECT pg_temp.evo_p194_conflict_code_replace(
  'platform.prepare_student_portal_provisioning(uuid,uuid,text,text,text,uuid,text,uuid)',
  $p194$RAISE EXCEPTION 'request_replay_conflict' USING ERRCODE = '40001';$p194$,
  $p194$RAISE EXCEPTION 'request_replay_conflict' USING ERRCODE = 'PT409';$p194$,
  1);
SELECT pg_temp.evo_p194_conflict_code_replace(
  'platform.prepare_student_portal_provisioning(uuid,uuid,text,text,text,uuid,text,uuid)',
  $p194$RAISE EXCEPTION 'portal_case_already_bound' USING ERRCODE = '40001';$p194$,
  $p194$RAISE EXCEPTION 'portal_case_already_bound' USING ERRCODE = 'PT409';$p194$,
  1);
SELECT pg_temp.evo_p194_conflict_code_replace(
  'platform.prepare_student_portal_provisioning(uuid,uuid,text,text,text,uuid,text,uuid)',
  $p194$RAISE EXCEPTION 'portal_case_invalid_shape' USING ERRCODE = '40001';$p194$,
  $p194$RAISE EXCEPTION 'portal_case_invalid_shape' USING ERRCODE = 'PT409';$p194$,
  3);
SELECT pg_temp.evo_p194_conflict_code_replace(
  'platform.prepare_student_portal_provisioning(uuid,uuid,text,text,text,uuid,text,uuid)',
  $p194$RAISE EXCEPTION 'portal_case_already_reserved' USING ERRCODE = '40001';$p194$,
  $p194$RAISE EXCEPTION 'portal_case_already_reserved' USING ERRCODE = 'PT409';$p194$,
  2);
SELECT pg_temp.evo_p194_conflict_code_replace(
  'platform.prepare_student_portal_provisioning(uuid,uuid,text,text,text,uuid,text,uuid)',
  $p194$RAISE EXCEPTION 'portal_email_already_reserved' USING ERRCODE = '40001';$p194$,
  $p194$RAISE EXCEPTION 'portal_email_already_reserved' USING ERRCODE = 'PT409';$p194$,
  2);

-- ---------------------------------------------------------------------------
-- b) authorize_student_portal_invite_reissue — the authenticated re-invite
--    (reissue) authorization RPC. Live body = 185's CREATE OR REPLACE.
-- ---------------------------------------------------------------------------
SELECT pg_temp.evo_p194_conflict_code_replace(
  'platform.authorize_student_portal_invite_reissue(uuid,bigint,bigint,uuid,text)',
  $p194$RAISE EXCEPTION 'request_replay_conflict' USING ERRCODE = '40001';$p194$,
  $p194$RAISE EXCEPTION 'request_replay_conflict' USING ERRCODE = 'PT409';$p194$,
  2);
SELECT pg_temp.evo_p194_conflict_code_replace(
  'platform.authorize_student_portal_invite_reissue(uuid,bigint,bigint,uuid,text)',
  $p194$RAISE EXCEPTION 'stale_receipt_version' USING ERRCODE = '40001';$p194$,
  $p194$RAISE EXCEPTION 'stale_receipt_version' USING ERRCODE = 'PT409';$p194$,
  1);
SELECT pg_temp.evo_p194_conflict_code_replace(
  'platform.authorize_student_portal_invite_reissue(uuid,bigint,bigint,uuid,text)',
  $p194$RAISE EXCEPTION 'stale_invite_generation' USING ERRCODE = '40001';$p194$,
  $p194$RAISE EXCEPTION 'stale_invite_generation' USING ERRCODE = 'PT409';$p194$,
  1);
SELECT pg_temp.evo_p194_conflict_code_replace(
  'platform.authorize_student_portal_invite_reissue(uuid,bigint,bigint,uuid,text)',
  $p194$RAISE EXCEPTION 'portal_invite_already_accepted' USING ERRCODE = '40001';$p194$,
  $p194$RAISE EXCEPTION 'portal_invite_already_accepted' USING ERRCODE = 'PT409';$p194$,
  2);
SELECT pg_temp.evo_p194_conflict_code_replace(
  'platform.authorize_student_portal_invite_reissue(uuid,bigint,bigint,uuid,text)',
  $p194$RAISE EXCEPTION 'portal_invite_not_expired' USING ERRCODE = '40001';$p194$,
  $p194$RAISE EXCEPTION 'portal_invite_not_expired' USING ERRCODE = 'PT409';$p194$,
  1);
SELECT pg_temp.evo_p194_conflict_code_replace(
  'platform.authorize_student_portal_invite_reissue(uuid,bigint,bigint,uuid,text)',
  $p194$RAISE EXCEPTION 'portal_identity_conflict' USING ERRCODE = '40001';$p194$,
  $p194$RAISE EXCEPTION 'portal_identity_conflict' USING ERRCODE = 'PT409';$p194$,
  1);

-- ---------------------------------------------------------------------------
-- c) finalize_student_portal_authority — the coordinator's finalizer behind
--    the same invite flow (service_role via PostgREST). Live body = 185's
--    $fin_new$ + 193's anketa_v1 early return; 193 added no 40001 lines.
-- ---------------------------------------------------------------------------
SELECT pg_temp.evo_p194_conflict_code_replace(
  'platform.finalize_student_portal_authority(uuid,bigint,bigint)',
  $p194$RAISE EXCEPTION 'stale_invite_generation' USING ERRCODE = '40001';$p194$,
  $p194$RAISE EXCEPTION 'stale_invite_generation' USING ERRCODE = 'PT409';$p194$,
  1);
SELECT pg_temp.evo_p194_conflict_code_replace(
  'platform.finalize_student_portal_authority(uuid,bigint,bigint)',
  $p194$RAISE EXCEPTION 'stale_receipt_version' USING ERRCODE = '40001';$p194$,
  $p194$RAISE EXCEPTION 'stale_receipt_version' USING ERRCODE = 'PT409';$p194$,
  1);
SELECT pg_temp.evo_p194_conflict_code_replace(
  'platform.finalize_student_portal_authority(uuid,bigint,bigint)',
  $p194$RAISE EXCEPTION 'portal_authority_not_ready' USING ERRCODE = '40001';$p194$,
  $p194$RAISE EXCEPTION 'portal_authority_not_ready' USING ERRCODE = 'PT409';$p194$,
  2);
SELECT pg_temp.evo_p194_conflict_code_replace(
  'platform.finalize_student_portal_authority(uuid,bigint,bigint)',
  $p194$RAISE EXCEPTION 'portal_identity_conflict' USING ERRCODE = '40001';$p194$,
  $p194$RAISE EXCEPTION 'portal_identity_conflict' USING ERRCODE = 'PT409';$p194$,
  3);
SELECT pg_temp.evo_p194_conflict_code_replace(
  'platform.finalize_student_portal_authority(uuid,bigint,bigint)',
  $p194$RAISE EXCEPTION 'portal_case_already_bound' USING ERRCODE = '40001';$p194$,
  $p194$RAISE EXCEPTION 'portal_case_already_bound' USING ERRCODE = 'PT409';$p194$,
  4);
SELECT pg_temp.evo_p194_conflict_code_replace(
  'platform.finalize_student_portal_authority(uuid,bigint,bigint)',
  $p194$RAISE EXCEPTION 'portal_case_invalid_shape' USING ERRCODE = '40001';$p194$,
  $p194$RAISE EXCEPTION 'portal_case_invalid_shape' USING ERRCODE = 'PT409';$p194$,
  5);

-- ---------------------------------------------------------------------------
-- Terminal assertion: the three patched functions now contain ZERO custom
-- 40001 sites and exactly the expected number of PT409 sites (образец 186's
-- post-apply readback: "zero remaining custom 40001 codes ... PT409 sites").
-- ---------------------------------------------------------------------------
DO $p194_readback$
DECLARE
  target RECORD;
  body TEXT;
  old_code CONSTANT TEXT := $anchor$ERRCODE = '40001'$anchor$;
  new_code CONSTANT TEXT := $anchor$ERRCODE = 'PT409'$anchor$;
BEGIN
  FOR target IN
    SELECT * FROM (VALUES
      ('platform.prepare_student_portal_provisioning(uuid,uuid,text,text,text,uuid,text,uuid)', 11),
      ('platform.authorize_student_portal_invite_reissue(uuid,bigint,bigint,uuid,text)', 8),
      ('platform.finalize_student_portal_authority(uuid,bigint,bigint)', 16)
    ) AS functions(signature, expected_pt409)
  LOOP
    body := pg_get_functiondef(target.signature::regprocedure);
    IF position(old_code IN body) <> 0 THEN
      RAISE EXCEPTION 'p194_readback: 40001 still present in %', target.signature;
    END IF;
    IF (length(body) - length(replace(body, new_code, ''))) / length(new_code)
      <> target.expected_pt409
    THEN
      RAISE EXCEPTION 'p194_readback: unexpected PT409 count in %', target.signature;
    END IF;
  END LOOP;
END $p194_readback$;

NOTIFY pgrst, 'reload schema';
COMMIT;
