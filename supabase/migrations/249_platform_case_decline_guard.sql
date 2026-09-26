-- Отказ куратора от дела фиксируется (решение владельца 26.09.2026).
-- docs/PLAN_CHANGES.md «2026-09-26 — Отказ куратора от дела не фиксируется:
-- какой инвариант guard 042 ослабить (миграция 249)». 246-248 belong to
-- parallel slices that are not on main yet; merge order closes the gap and
-- the number is settled at merge.
--
-- Why: 182's decline (private.respond_student_case_handoff, 182:392-436)
-- reverts the assignment with
--   UPDATE platform.student_cases SET current_curator_membership_id = NULL,
--     state = 'pending', handoff_at = NULL, current_scope_id/version = new
-- and 042's row trigger platform_private.guard_student_case_transition
-- (042:864-972, still the live definition: no migration replaced it, 193
-- worked around it without changing it) refuses that UPDATE three ways --
-- 'First student-case handoff timestamp is immutable', 'Unsupported
-- student-case transition active to pending' and 'Curator change requires
-- one-step scope rotation and valid handoff state'. Every decline failed
-- with 55000 and rolled back whole, so «Ждут куратора» never filled in real
-- use and neither plan §7's decline (S3) nor owner decision B of 26.09
-- (migration 248) could take effect.
--
-- Owner decision 26.09: relax the guard for exactly the 182 decline shape
-- and nothing else. A «curator decline» is an UPDATE with
--   OLD.state = 'active' AND NEW.state = 'pending',
--   a curator before and none after,
--   handoff_at and closed_at empty after (student_cases_state_shape_check,
--     088/180, requires both for 'pending'; handoff history stays in
--     sales_admissions_handoffs, assignment events, curator responses and
--     the audit),
--   a one-step scope rotation (new scope id, version + 1; the guard's first
--     check already requires the NEW scope to be the exact active
--     student_case scope),
--   and the decline already recorded: the latest revision of the response
--     to that curator's latest assignment (the same row 182 selects, by
--     new_scope_version) is 'declined' by that curator. 182 inserts it just
--     before the case UPDATE (the 'declined' lifecycle event follows right
--     after, in the same command). Every path into 'active' creates a new
--     assignment, so an active case whose current assignment carries a
--     recorded decline exists only inside the decline command.
-- Only such an UPDATE may clear handoff_at, move active -> pending and
-- clear the curator. Everything else is unchanged and keeps its error:
-- handoff_at immutable in every other UPDATE, pending -> active only with a
-- curator and rotation, a curator change with rotation and the same state,
-- closed <-> active as before (the line
-- `OR (OLD.state = 'closed' AND NEW.state = 'active')` that 246 of a parallel
-- slice anchors on stays byte-for-byte). A case bound to a country playbook
-- is still refused by 137's own platform_private.admissions_guard_case
-- (PT409), atomically -- recorded, not changed here.
--
-- Forward-only, self-verifying anchor replace on the live definition
-- (pg_get_functiondef; the 182/241/242/244/245 pattern: exactly one old
-- anchor before, exactly one new text after, fail closed on drift). SECURITY
-- DEFINER, SET search_path = '', owner, grants and the BEFORE INSERT OR
-- UPDATE trigger student_cases_transition_guard are unchanged;
-- private.respond_student_case_handoff is unchanged. The evidence read runs
-- as the function owner (postgres, BYPASSRLS), like the guard's existing
-- record_scopes read.
--
-- Release: apply through evo-schema-ledger.yml. No application code changes:
-- «Отклонить» already calls this command.
BEGIN;

DO $a249_guard$
DECLARE
  body TEXT;
  anchors TEXT[] := ARRAY[
    -- (1) one local flag, set once per UPDATE
    $q$BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM platform.record_scopes AS scope$q$,
    -- (2) recognise the 182 decline; handoff_at stays immutable otherwise
    $q$  IF OLD.handoff_at IS NOT NULL
    AND OLD.handoff_at IS DISTINCT FROM NEW.handoff_at
  THEN$q$,
    -- (3) active -> pending only as a curator decline
    $q$      OR (OLD.state = 'closed' AND NEW.state = 'active')
    )
  THEN$q$,
    -- (4) clearing the curator only as a curator decline
    $q$      OR NEW.current_curator_membership_id IS NULL
      OR ($q$,
    -- (5) leaving 'active' on a curator change only as a curator decline
    $q$        OLD.state IN ('active', 'closed')
        AND NEW.state <> OLD.state
      )$q$
  ];
  replacements TEXT[] := ARRAY[
    $q$DECLARE
  -- 249: TRUE only for the exact decline shape of 182 (see migration 249).
  curator_decline BOOLEAN := FALSE;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM platform.record_scopes AS scope$q$,
    $q$  -- 249: a curator decline (182) returns an active case to 'pending':
  -- the curator is cleared, handoff_at and closed_at are empty, the scope
  -- rotates one step, and that curator's 'declined' response to the
  -- current assignment is already recorded (182 writes it before this
  -- UPDATE). Nothing else may clear handoff_at, move active -> pending or
  -- clear the curator.
  IF OLD.state = 'active' AND NEW.state = 'pending' THEN
    curator_decline :=
      OLD.current_curator_membership_id IS NOT NULL
      AND NEW.current_curator_membership_id IS NULL
      AND NEW.handoff_at IS NULL
      AND NEW.closed_at IS NULL
      AND NEW.current_scope_id IS DISTINCT FROM OLD.current_scope_id
      AND NEW.current_scope_version = OLD.current_scope_version + 1
      AND EXISTS (
        SELECT 1
        FROM (
          SELECT assignment.id
          FROM platform.student_case_assignment_events AS assignment
          WHERE assignment.organization_id = OLD.organization_id
            AND assignment.student_case_id = OLD.id
            AND assignment.new_curator_membership_id = OLD.current_curator_membership_id
          ORDER BY assignment.new_scope_version DESC
          LIMIT 1
        ) AS current_assignment
        CROSS JOIN LATERAL (
          SELECT response.decision, response.curator_membership_id
          FROM platform.student_case_handoff_acknowledgements AS response
          WHERE response.organization_id = OLD.organization_id
            AND response.student_case_id = OLD.id
            AND response.assignment_event_id = current_assignment.id
          ORDER BY response.revision DESC
          LIMIT 1
        ) AS latest_response
        WHERE latest_response.decision = 'declined'
          AND latest_response.curator_membership_id = OLD.current_curator_membership_id
      );
  END IF;

  IF OLD.handoff_at IS NOT NULL
    AND OLD.handoff_at IS DISTINCT FROM NEW.handoff_at
    AND NOT curator_decline
  THEN$q$,
    $q$      OR (OLD.state = 'closed' AND NEW.state = 'active')
      OR curator_decline
    )
  THEN$q$,
    $q$      OR (NEW.current_curator_membership_id IS NULL AND NOT curator_decline)
      OR ($q$,
    $q$        OLD.state IN ('active', 'closed')
        AND NEW.state <> OLD.state
        AND NOT curator_decline
      )$q$
  ];
  i INTEGER;
BEGIN
  body := pg_get_functiondef('platform_private.guard_student_case_transition()'::regprocedure);
  FOR i IN 1 .. cardinality(anchors) LOOP
    IF (length(body) - length(replace(body, anchors[i], ''))) / length(anchors[i]) <> 1
      OR strpos(body, replacements[i]) <> 0
    THEN
      RAISE EXCEPTION 'a249_case_decline_guard_anchor_drift: %', i;
    END IF;
    body := replace(body, anchors[i], replacements[i]);
    IF (length(body) - length(replace(body, replacements[i], ''))) / length(replacements[i]) <> 1 THEN
      RAISE EXCEPTION 'a249_case_decline_guard_anchor_drift: % after', i;
    END IF;
  END LOOP;
  EXECUTE body;
END
$a249_guard$;

-- CREATE OR REPLACE keeps the ACL; restated as in 042.
REVOKE ALL ON FUNCTION platform_private.guard_student_case_transition()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

DO $a249_verify$
DECLARE
  guard RECORD;
  definition TEXT;
  kept TEXT;
BEGIN
  SELECT p.oid::REGPROCEDURE AS signature, p.prosecdef, p.proconfig,
    pg_get_userbyid(p.proowner) AS owner
  INTO STRICT guard
  FROM pg_catalog.pg_proc AS p
  WHERE p.oid = 'platform_private.guard_student_case_transition()'::regprocedure;
  IF NOT guard.prosecdef OR guard.proconfig IS DISTINCT FROM ARRAY['search_path=""']
    OR guard.owner <> 'postgres'
    OR has_function_privilege('anon', guard.signature, 'EXECUTE')
    OR has_function_privilege('authenticated', guard.signature, 'EXECUTE')
    OR has_function_privilege('service_role', guard.signature, 'EXECUTE')
  THEN
    RAISE EXCEPTION 'a249_case_decline_guard_verification_failed: definer, search_path, owner or grants';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger AS t
    WHERE t.tgrelid = 'platform.student_cases'::regclass
      AND t.tgname = 'student_cases_transition_guard'
      AND t.tgfoid = 'platform_private.guard_student_case_transition()'::regprocedure
      AND t.tgenabled = 'O' AND NOT t.tgisinternal
      AND t.tgtype = 23 -- ROW | BEFORE | INSERT | UPDATE
  ) THEN
    RAISE EXCEPTION 'a249_case_decline_guard_verification_failed: trigger';
  END IF;
  definition := pg_get_functiondef('platform_private.guard_student_case_transition()'::regprocedure);
  -- Every refusal of 042 is still there, and so is the line 246 anchors on.
  FOREACH kept IN ARRAY ARRAY[
    $k$'Student case requires its exact active student_case scope'$k$,
    $k$'New student case must start pending on scope version 1'$k$,
    $k$'First student-case handoff timestamp is immutable'$k$,
    $k$'First portal activation timestamp is immutable'$k$,
    $k$'Unsupported student-case transition % to %'$k$,
    $k$'Curator change requires one-step scope rotation and valid handoff state'$k$,
    $k$'Pending activation requires curator and scope rotation'$k$,
    $k$'Closing a student case requires closed_at'$k$,
    $k$'Reopening a student case must clear closed_at'$k$,
    $k$OR (OLD.state = 'closed' AND NEW.state = 'active')$k$
  ] LOOP
    IF (length(definition) - length(replace(definition, kept, ''))) / length(kept) <> 1 THEN
      RAISE EXCEPTION 'a249_case_decline_guard_verification_failed: %', kept;
    END IF;
  END LOOP;
  IF (length(definition) - length(replace(definition, 'curator_decline', ''))) / length('curator_decline') <> 6 THEN
    RAISE EXCEPTION 'a249_case_decline_guard_verification_failed: curator_decline uses';
  END IF;
END
$a249_verify$;

COMMENT ON FUNCTION platform_private.guard_student_case_transition() IS
  'Student-case state machine guard (042). Since 249 an active case returns to pending only as the curator decline of 182: curator cleared, handoff_at and closed_at empty, one-step scope rotation, and that curator''s declined response to the current assignment already recorded.';

COMMIT;
