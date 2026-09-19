-- OTH-2: unified staff task panel + notification rework support.
-- Adds case-task assignment notifications (today platform.case_tasks has no
-- notification trigger at all), a due-in-1-day reminder with no cron in this
-- codebase (grepped: no pg_cron/pg_cron extension/cron.schedule anywhere in
-- supabase/migrations — see platform.staff_notifications_page_v2 below for
-- the chosen lazy-materialization design), a bulk mark-all-read command and
-- an enriched read-time notification page. Additive columns only: no
-- existing platform.staff_notifications row is rewritten by this migration.
BEGIN;

-- (a) Additive columns + kind/shape CHECK replacement -----------------------
ALTER TABLE platform.staff_notifications
  ADD COLUMN case_task_id UUID,
  ADD COLUMN actor_membership_id UUID,
  ADD CONSTRAINT staff_notifications_case_task_fkey
    FOREIGN KEY (organization_id, case_task_id) REFERENCES platform.case_tasks(organization_id, id),
  ADD CONSTRAINT staff_notifications_actor_fkey
    FOREIGN KEY (organization_id, actor_membership_id) REFERENCES platform.organization_memberships(organization_id, id);

ALTER TABLE platform.staff_notifications DROP CONSTRAINT staff_notifications_kind_check;
ALTER TABLE platform.staff_notifications DROP CONSTRAINT staff_notifications_check;
ALTER TABLE platform.staff_notifications
  ADD CONSTRAINT staff_notifications_kind_check CHECK (kind IN (
    'task_assigned', 'task_updated', 'chat_mention', 'case_help',
    'case_task_assigned', 'task_due'
  )),
  ADD CONSTRAINT staff_notifications_check CHECK (
    (kind = 'case_help' AND help_request_id IS NOT NULL AND student_case_id IS NOT NULL
      AND message_id IS NULL AND staff_task_id IS NULL AND case_task_id IS NULL)
    OR (kind = 'chat_mention' AND message_id IS NOT NULL
      AND staff_task_id IS NULL AND help_request_id IS NULL AND student_case_id IS NULL AND case_task_id IS NULL)
    OR (kind IN ('task_assigned', 'task_updated') AND staff_task_id IS NOT NULL
      AND message_id IS NULL AND help_request_id IS NULL AND student_case_id IS NULL AND case_task_id IS NULL)
    OR (kind = 'case_task_assigned' AND case_task_id IS NOT NULL AND student_case_id IS NOT NULL
      AND staff_task_id IS NULL AND message_id IS NULL AND help_request_id IS NULL)
    OR (kind = 'task_due' AND help_request_id IS NULL AND message_id IS NULL AND student_case_id IS NULL
      AND ((staff_task_id IS NOT NULL AND case_task_id IS NULL) OR (staff_task_id IS NULL AND case_task_id IS NOT NULL)))
  );

-- (b) Case-task assignment notifications -------------------------------
-- Deviation from the plan's literal "AFTER INSERT OR UPDATE trigger on
-- platform.case_tasks", recorded here as instructed: platform.case_task_events
-- (042_platform_student_admissions.sql) already carries a NOT NULL
-- actor_membership_id on every row, both for the initial creation and for
-- every later assignee/status change — 110_platform_case_task_all_day_deadlines.sql:153-172
-- inserts one unconditionally on create, and :340-355 inserts one on change
-- ONLY when status or assignee_membership_id actually changed. Triggering on
-- that existing append-only log instead of the mutable case_tasks row itself
-- gives an always-known actor for both create and reassignment, so the
-- "accept NULL actor" fallback the plan allows for is never needed, and no
-- extra column or backfill is required. This mirrors 142_platform_team_workflow.sql:185-203
-- (platform_private.notify_staff_task_event / staff_task_event_notifications),
-- which triggers on platform.staff_task_events the same way.
CREATE FUNCTION platform_private.notify_case_task_event() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE task_row platform.case_tasks%ROWTYPE;
BEGIN
  -- case_task_events only ever logs a status-or-assignee transition (see the
  -- 110 note above); a status-only event (e.g. completing one's own task)
  -- must not renotify the unchanged assignee.
  IF NEW.previous_assignee_membership_id IS NOT DISTINCT FROM NEW.new_assignee_membership_id THEN
    RETURN NEW;
  END IF;
  IF NEW.new_assignee_membership_id = NEW.actor_membership_id THEN RETURN NEW; END IF;
  SELECT * INTO STRICT task_row FROM platform.case_tasks t
    WHERE t.organization_id = NEW.organization_id AND t.id = NEW.case_task_id;
  INSERT INTO platform.staff_notifications
    (organization_id, recipient_membership_id, event_key, kind, case_task_id, student_case_id, actor_membership_id)
    SELECT NEW.organization_id, m.id,
      'case-task:' || NEW.id::TEXT,
      'case_task_assigned', NEW.case_task_id, NEW.student_case_id, NEW.actor_membership_id
    FROM platform.organization_memberships m JOIN platform.profiles p ON p.id = m.profile_id
    WHERE m.organization_id = NEW.organization_id AND m.id = NEW.new_assignee_membership_id
      AND m.status = 'active' AND p.status = 'active'
    ON CONFLICT (organization_id, recipient_membership_id, event_key) DO NOTHING;
  RETURN NEW;
END $$;
CREATE TRIGGER case_task_event_notifications AFTER INSERT ON platform.case_task_events
  FOR EACH ROW EXECUTE FUNCTION platform_private.notify_case_task_event();
REVOKE ALL ON FUNCTION platform_private.notify_case_task_event()
  FROM PUBLIC, anon, authenticated, service_role;

-- (c) Bulk mark-all-read -----------------------------------------------
CREATE FUNCTION platform.mark_all_staff_notifications_read(p_organization_id UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor RECORD; marked BIGINT;
BEGIN
  -- mark_staff_notification_read (142:255-265) resolves the caller per-row,
  -- from staff_notification_visible(row) alone, with no single row to start
  -- from here. Anchor instead on the actor lookup platform.staff_notifications_page
  -- itself uses post-156 (156_platform_scoped_staff_consumers.sql:1218-1228:
  -- the anchor 'a.platform_role IN (''admin'',''sales'',''curator'')' was
  -- text-patched to 'a.platform_role IS DISTINCT FROM ''student'''), the
  -- live actor-resolution shape for this whole notification family today.
  SELECT * INTO actor FROM platform.current_actor_authority() a
    WHERE a.organization_id = p_organization_id AND a.platform_role IS DISTINCT FROM 'student';
  IF NOT FOUND THEN RAISE EXCEPTION 'staff_notifications_forbidden' USING ERRCODE = '42501'; END IF;
  UPDATE platform.staff_notifications n SET read_at = clock_timestamp()
    WHERE n.organization_id = p_organization_id AND n.recipient_membership_id = actor.membership_id
      AND n.read_at IS NULL AND platform_private.staff_notification_visible(n);
  GET DIAGNOSTICS marked = ROW_COUNT;
  RETURN jsonb_build_object('marked', marked::TEXT);
END $$;

-- (d) Enriched v2 page, with lazy due-reminder materialization ---------
-- No pg_cron/scheduler exists anywhere in this codebase (grepped across all
-- 186 prior migrations, the app and scripts/ — see the S2 research report
-- for the ADR-worthy confirmation). Rather than add one, this RPC
-- materializes each caller's own due-tomorrow reminders as a side effect of
-- reading their own notification page, keyed so a second call within the
-- same due window is a no-op (ON CONFLICT DO NOTHING on the same UNIQUE
-- (organization_id, recipient_membership_id, event_key) used everywhere
-- else in this table) and so a changed or cleared due naturally mints a
-- different key next time instead of resurrecting a stale one. The bell
-- polls this RPC every 60s (src/components/v3/StaffNotifications.tsx), so a
-- reminder becomes visible within one polling interval of crossing the
-- 24-hour boundary with no background job at all.
CREATE FUNCTION platform.staff_notifications_page_v2(
  p_organization_id UUID, p_before_at TIMESTAMPTZ DEFAULT NULL, p_before_id UUID DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor RECORD; items JSONB; unread_count BIGINT; today_bishkek DATE;
BEGIN
  SELECT * INTO actor FROM platform.current_actor_authority() a
    WHERE a.organization_id = p_organization_id AND a.platform_role IS DISTINCT FROM 'student';
  IF NOT FOUND THEN RAISE EXCEPTION 'staff_notifications_forbidden' USING ERRCODE = '42501'; END IF;
  IF (p_before_at IS NULL) <> (p_before_id IS NULL)
  THEN RAISE EXCEPTION 'staff_notifications_cursor_invalid' USING ERRCODE = '22023'; END IF;
  today_bishkek := (statement_timestamp() AT TIME ZONE 'Asia/Bishkek')::DATE;

  INSERT INTO platform.staff_notifications (organization_id, recipient_membership_id, event_key, kind, staff_task_id)
    SELECT p_organization_id, actor.membership_id,
      'task-reminder:' || t.id::TEXT || ':' || COALESCE(t.due_at::TEXT, t.due_on::TEXT), 'task_due', t.id
    FROM platform.staff_tasks t
    WHERE t.organization_id = p_organization_id AND t.assignee_membership_id = actor.membership_id
      AND t.status NOT IN ('done', 'cancelled')
      AND ((t.due_on IS NOT NULL AND t.due_on = today_bishkek + 1)
        OR (t.due_at IS NOT NULL AND statement_timestamp() >= t.due_at - INTERVAL '24 hours'
          AND statement_timestamp() < t.due_at))
    ON CONFLICT (organization_id, recipient_membership_id, event_key) DO NOTHING;

  INSERT INTO platform.staff_notifications (organization_id, recipient_membership_id, event_key, kind, case_task_id)
    SELECT p_organization_id, actor.membership_id,
      'task-reminder:' || t.id::TEXT || ':' || COALESCE(t.due_at::TEXT, t.due_on::TEXT), 'task_due', t.id
    FROM platform.case_tasks t
    WHERE t.organization_id = p_organization_id AND t.assignee_membership_id = actor.membership_id
      AND t.status NOT IN ('done', 'cancelled')
      AND ((t.due_on IS NOT NULL AND t.due_on = today_bishkek + 1)
        OR (t.due_at IS NOT NULL AND statement_timestamp() >= t.due_at - INTERVAL '24 hours'
          AND statement_timestamp() < t.due_at))
    ON CONFLICT (organization_id, recipient_membership_id, event_key) DO NOTHING;

  -- Neutralize stale reminders: task completed/cancelled, due cleared, or the
  -- due changed since materialization (its event_key no longer matches the
  -- task's CURRENT due; a still-qualifying new due re-materializes above on
  -- this same call, under a fresh key, so no duplicate ever becomes live).
  UPDATE platform.staff_notifications n SET read_at = clock_timestamp()
    FROM platform.staff_tasks t
    WHERE n.organization_id = p_organization_id AND n.kind = 'task_due' AND n.staff_task_id = t.id
      AND n.recipient_membership_id = actor.membership_id AND n.read_at IS NULL
      AND (t.status IN ('done', 'cancelled') OR (t.due_at IS NULL AND t.due_on IS NULL)
        OR n.event_key IS DISTINCT FROM 'task-reminder:' || t.id::TEXT || ':' || COALESCE(t.due_at::TEXT, t.due_on::TEXT));
  UPDATE platform.staff_notifications n SET read_at = clock_timestamp()
    FROM platform.case_tasks t
    WHERE n.organization_id = p_organization_id AND n.kind = 'task_due' AND n.case_task_id = t.id
      AND n.recipient_membership_id = actor.membership_id AND n.read_at IS NULL
      AND (t.status IN ('done', 'cancelled') OR (t.due_at IS NULL AND t.due_on IS NULL)
        OR n.event_key IS DISTINCT FROM 'task-reminder:' || t.id::TEXT || ':' || COALESCE(t.due_at::TEXT, t.due_on::TEXT));

  SELECT count(*) INTO unread_count FROM platform.staff_notifications n
    WHERE n.organization_id = p_organization_id AND n.recipient_membership_id = actor.membership_id
      AND n.read_at IS NULL AND platform_private.staff_notification_visible(n);

  -- Enrichment is read-time only: actor_display_name/subject_title/
  -- student_display_name are never stored, only ever joined at read. Legacy
  -- task_assigned/task_updated rows predate the actor_membership_id column,
  -- so their actor is recovered by parsing event_key 'task:'||event_id (the
  -- exact shape platform_private.notify_staff_task_event writes, verified at
  -- 142_platform_team_workflow.sql:190-191) and joining staff_task_events.
  SELECT COALESCE(jsonb_agg(q.item ORDER BY q.created_at DESC, q.id DESC), '[]'::JSONB) INTO items FROM (
    SELECT n.created_at, n.id, jsonb_build_object(
        'id', n.id, 'kind', n.kind, 'created_at', n.created_at, 'read_at', n.read_at,
        'staff_task_id', n.staff_task_id, 'message_id', n.message_id,
        'channel_key', m.channel_key, 'parent_message_id', m.parent_message_id,
        -- A task_due row for a case task carries no student_case_id of its own
        -- (the (d) CHECK requires it NULL for kind='task_due'); derive it from
        -- the linked case task so the client can still build a working href
        -- and show the student name, same as case_task_assigned already can.
        'student_case_id', COALESCE(n.student_case_id, subject_case_task.student_case_id),
        'help_request_id', n.help_request_id,
        'case_task_id', n.case_task_id,
        'actor_display_name', CASE
          WHEN n.actor_membership_id IS NOT NULL THEN actor_profile.display_name
          WHEN n.kind IN ('task_assigned', 'task_updated') AND n.event_key ~ '^task:[0-9a-fA-F-]{36}$'
            THEN legacy_actor.display_name
          ELSE NULL END,
        'subject_title', CASE
          WHEN n.staff_task_id IS NOT NULL THEN subject_staff_task.title
          WHEN n.case_task_id IS NOT NULL THEN subject_case_task.title
          ELSE NULL END,
        -- task_due only: the exact due, so the row can read "Завтра" for an
        -- all-day due or the precise time for a timed one, the same
        -- distinction projectPlatformTaskDeadline already draws elsewhere.
        'subject_due_on', CASE WHEN n.kind = 'task_due' THEN
          CASE WHEN n.staff_task_id IS NOT NULL THEN subject_staff_task.due_on ELSE subject_case_task.due_on END
          ELSE NULL END,
        'subject_due_at', CASE WHEN n.kind = 'task_due' THEN
          CASE WHEN n.staff_task_id IS NOT NULL THEN subject_staff_task.due_at ELSE subject_case_task.due_at END
          ELSE NULL END,
        'student_display_name', CASE
          WHEN n.student_case_id IS NOT NULL THEN subject_student_case.student_display_name
          WHEN n.case_task_id IS NOT NULL THEN case_task_student.student_display_name
          ELSE NULL END
      ) AS item
    FROM platform.staff_notifications n
    LEFT JOIN platform.team_chat_messages m ON m.id = n.message_id
    LEFT JOIN platform.organization_memberships actor_member
      ON actor_member.organization_id = n.organization_id AND actor_member.id = n.actor_membership_id
    LEFT JOIN platform.profiles actor_profile ON actor_profile.id = actor_member.profile_id
    LEFT JOIN platform.staff_task_events legacy_event
      ON legacy_event.organization_id = n.organization_id
      -- CASE, not bare conjuncts: SQL guarantees no evaluation order inside a
      -- join qual, and an unguarded cast blew up on 'case-task:<uuid>' keys
      -- (substring FROM 6 of those is 'task:<uuid>', not a UUID).
      AND legacy_event.id = CASE
        WHEN n.kind IN ('task_assigned', 'task_updated')
          AND n.event_key ~ '^task:[0-9a-fA-F-]{36}$'
        THEN substring(n.event_key FROM 6)::UUID
        ELSE NULL END
    LEFT JOIN platform.organization_memberships legacy_member
      ON legacy_member.organization_id = n.organization_id AND legacy_member.id = legacy_event.actor_membership_id
    LEFT JOIN platform.profiles legacy_actor ON legacy_actor.id = legacy_member.profile_id
    LEFT JOIN platform.staff_tasks subject_staff_task
      ON subject_staff_task.organization_id = n.organization_id AND subject_staff_task.id = n.staff_task_id
    LEFT JOIN platform.case_tasks subject_case_task
      ON subject_case_task.organization_id = n.organization_id AND subject_case_task.id = n.case_task_id
    LEFT JOIN platform.student_cases subject_student_case
      ON subject_student_case.organization_id = n.organization_id AND subject_student_case.id = n.student_case_id
    LEFT JOIN platform.student_cases case_task_student
      ON case_task_student.organization_id = n.organization_id AND case_task_student.id = subject_case_task.student_case_id
    WHERE n.organization_id = p_organization_id AND n.recipient_membership_id = actor.membership_id
      AND platform_private.staff_notification_visible(n)
      AND (p_before_at IS NULL OR (n.created_at, n.id) < (p_before_at, p_before_id))
    ORDER BY n.created_at DESC, n.id DESC LIMIT 51
  ) q;
  RETURN jsonb_build_object('items', items, 'unread_count', unread_count::TEXT);
END $$;

-- Visibility: extend the live platform_private.staff_notification_visible
-- (156_platform_scoped_staff_consumers.sql:988-1005 is the installed body —
-- the LATEST CREATE OR REPLACE for this function in the whole ledger, grepped
-- across every later migration) for the two new kinds. case_task_assigned
-- and a case-task task_due are visible to the task's current assignee or to
-- anyone who can read the case in full — the same case-level authority
-- case_help already uses, since platform.case_tasks has no staff_can_access
-- resource kind of its own (case tasks are gated by the separate
-- 'task.manage'/'case.read.full' permission family, not staff_can_access).
CREATE OR REPLACE FUNCTION platform_private.staff_notification_visible(n platform.staff_notifications)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM platform.current_actor_authority() a
    WHERE a.organization_id = n.organization_id AND a.membership_id = n.recipient_membership_id
      AND a.platform_role IS DISTINCT FROM 'student' AND (
        (n.staff_task_id IS NOT NULL AND platform_private.staff_can_access(
          n.organization_id, a.membership_id, 'staff.task.read', 'staff_task', n.staff_task_id))
        OR (n.message_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM platform.team_chat_messages m
          WHERE m.organization_id = n.organization_id AND m.id = n.message_id
            AND m.deleted_at IS NULL AND a.membership_id = ANY(m.mentioned_membership_ids)
            AND platform_private.team_chat_can_access(n.organization_id, m.channel_key)))
        OR (n.kind = 'case_help' AND platform_private.staff_can_access(
          n.organization_id, a.membership_id, 'case.read.full', 'student_case', n.student_case_id))
        OR (n.case_task_id IS NOT NULL AND n.kind IN ('case_task_assigned', 'task_due') AND EXISTS (
          SELECT 1 FROM platform.case_tasks t
          WHERE t.organization_id = n.organization_id AND t.id = n.case_task_id
            AND (t.assignee_membership_id = a.membership_id OR platform_private.staff_can_access(
              n.organization_id, a.membership_id, 'case.read.full', 'student_case', t.student_case_id))))
      )
  )
$$;

REVOKE ALL ON FUNCTION platform.mark_all_staff_notifications_read(UUID),
  platform.staff_notifications_page_v2(UUID, TIMESTAMPTZ, UUID)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION platform.mark_all_staff_notifications_read(UUID),
  platform.staff_notifications_page_v2(UUID, TIMESTAMPTZ, UUID)
  TO authenticated;

-- (e) Zero-degradation: exclude the two new kinds from the pre-existing
-- platform.staff_notifications_page so the OLD app (installed between this
-- migration's apply and its own release) never receives an unrecognized
-- kind. Its live installed body is 146_platform_partner_packets_student_help.sql:215-231
-- (a full CREATE OR REPLACE, the most recent one before this migration) with
-- exactly one later text patch applied on top by 156's pg_temp.evo_s2_replace
-- sweep (156_platform_scoped_staff_consumers.sql:1218,1222-1228): the actor
-- gate 'a.platform_role IN (''admin'',''sales'',''curator'')' became
-- 'a.platform_role IS DISTINCT FROM ''student'''. That is the ONLY patch
-- 156 makes to this function (grepped: every other 156 hit against
-- staff_notifications_page is that same REVOKE/GRANT anchor-list entry, not
-- a body edit) — the row shape and every other clause are reproduced
-- byte-for-byte from 146 below. Signature and returned shape stay identical;
-- only an added kind allowlist is new.
CREATE OR REPLACE FUNCTION platform.staff_notifications_page(p_organization_id UUID,p_before_at TIMESTAMPTZ DEFAULT NULL,p_before_id UUID DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor RECORD; items JSONB; unread_count BIGINT;
BEGIN
 SELECT * INTO actor FROM platform.current_actor_authority() a WHERE a.organization_id=p_organization_id AND a.platform_role IS DISTINCT FROM 'student';
 IF NOT FOUND THEN RAISE EXCEPTION 'staff_notifications_forbidden' USING ERRCODE='42501'; END IF;
 IF(p_before_at IS NULL)<>(p_before_id IS NULL) THEN RAISE EXCEPTION 'staff_notifications_cursor_invalid' USING ERRCODE='22023'; END IF;
 SELECT count(*) INTO unread_count FROM platform.staff_notifications n WHERE n.organization_id=p_organization_id AND n.recipient_membership_id=actor.membership_id AND n.read_at IS NULL
  AND n.kind IN ('task_assigned','task_updated','chat_mention','case_help') AND platform_private.staff_notification_visible(n);
 SELECT COALESCE(jsonb_agg(q.item ORDER BY q.created_at DESC,q.id DESC),'[]'::JSONB) INTO items FROM (
  SELECT n.created_at,n.id,jsonb_build_object('id',n.id,'kind',n.kind,'created_at',n.created_at,'read_at',n.read_at,'staff_task_id',n.staff_task_id,
   'message_id',n.message_id,'channel_key',m.channel_key,'parent_message_id',m.parent_message_id,'student_case_id',n.student_case_id,'help_request_id',n.help_request_id) item
  FROM platform.staff_notifications n LEFT JOIN platform.team_chat_messages m ON m.id=n.message_id
  WHERE n.organization_id=p_organization_id AND n.recipient_membership_id=actor.membership_id
   AND n.kind IN ('task_assigned','task_updated','chat_mention','case_help') AND platform_private.staff_notification_visible(n)
   AND(p_before_at IS NULL OR(n.created_at,n.id)<(p_before_at,p_before_id)) ORDER BY n.created_at DESC,n.id DESC LIMIT 51
 )q;
 RETURN jsonb_build_object('items',items,'unread_count',unread_count::TEXT);
END $$;

NOTIFY pgrst, 'reload schema';
COMMIT;
