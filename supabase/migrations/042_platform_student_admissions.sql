-- ============================================================
-- 042_platform_student_admissions.sql
--
-- P2D: tenant-isolated student cases, admissions applications, visa cases,
-- tasks, reasoned handoff/lifecycle RPCs and fixed safe projections.
--
-- This migration is repository-only evidence. It does not contact or claim a
-- live amoCRM, Supabase, WAHA, WhatsApp, AI or document provider. Contract and
-- evidence references are deliberately opaque until their owning adapters are
-- implemented and proven in later phases.
-- ============================================================

BEGIN;

CREATE TYPE platform.student_case_state AS ENUM (
  'pending',
  'active',
  'closed'
);

CREATE TYPE platform.route_approval_status AS ENUM (
  'draft',
  'approved',
  'rework'
);

CREATE TYPE platform.application_status AS ENUM (
  'preparation',
  'ready',
  'submitted',
  'under_review',
  'offer',
  'rejected',
  'enrolled',
  'withdrawn',
  'closed'
);

CREATE TYPE platform.visa_status AS ENUM (
  'not_required',
  'not_started',
  'docs',
  'appointment',
  'submitted',
  'approved',
  'rejected',
  'closed'
);

CREATE TYPE platform.case_task_priority AS ENUM (
  'low',
  'normal',
  'high',
  'urgent'
);

CREATE TYPE platform.case_task_status AS ENUM (
  'open',
  'in_progress',
  'blocked',
  'done',
  'cancelled'
);

CREATE TABLE platform.student_cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL
    REFERENCES platform.organizations(id) ON DELETE RESTRICT,
  student_membership_id UUID NOT NULL,
  responsible_sales_membership_id UUID NOT NULL,
  current_curator_membership_id UUID,
  source_key TEXT NOT NULL CHECK (btrim(source_key) <> ''),
  contract_confirmation_ref TEXT NOT NULL
    CHECK (btrim(contract_confirmation_ref) <> ''),
  contract_confirmed_at TIMESTAMPTZ NOT NULL,
  student_display_name TEXT NOT NULL CHECK (btrim(student_display_name) <> ''),
  target_country TEXT NOT NULL CHECK (btrim(target_country) <> ''),
  target_degree TEXT NOT NULL CHECK (btrim(target_degree) <> ''),
  program_direction TEXT,
  intake TEXT,
  language_assumption TEXT,
  funding_assumption TEXT,
  route_approval_status platform.route_approval_status NOT NULL DEFAULT 'draft',
  operational_stage TEXT NOT NULL DEFAULT 'contract_confirmed'
    CHECK (btrim(operational_stage) <> ''),
  state platform.student_case_state NOT NULL DEFAULT 'pending',
  handoff_at TIMESTAMPTZ,
  portal_activated_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  next_action TEXT,
  current_scope_id UUID NOT NULL,
  current_scope_version BIGINT NOT NULL CHECK (current_scope_version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT student_cases_organization_id_id_key
    UNIQUE (organization_id, id),
  CONSTRAINT student_cases_organization_source_key
    UNIQUE (organization_id, source_key),
  CONSTRAINT student_cases_student_membership_fkey
    FOREIGN KEY (organization_id, student_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT student_cases_responsible_sales_membership_fkey
    FOREIGN KEY (organization_id, responsible_sales_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT student_cases_current_curator_membership_fkey
    FOREIGN KEY (organization_id, current_curator_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT student_cases_current_scope_fkey
    FOREIGN KEY (
      organization_id,
      current_scope_id,
      current_scope_version
    )
    REFERENCES platform.record_scopes(organization_id, id, scope_version)
    ON DELETE RESTRICT,
  CONSTRAINT student_cases_program_direction_check CHECK (
    program_direction IS NULL OR btrim(program_direction) <> ''
  ),
  CONSTRAINT student_cases_intake_check CHECK (
    intake IS NULL OR btrim(intake) <> ''
  ),
  CONSTRAINT student_cases_language_assumption_check CHECK (
    language_assumption IS NULL OR btrim(language_assumption) <> ''
  ),
  CONSTRAINT student_cases_funding_assumption_check CHECK (
    funding_assumption IS NULL OR btrim(funding_assumption) <> ''
  ),
  CONSTRAINT student_cases_next_action_check CHECK (
    next_action IS NULL OR btrim(next_action) <> ''
  ),
  CONSTRAINT student_cases_state_shape_check CHECK (
    (
      state = 'pending'
      AND current_curator_membership_id IS NULL
      AND handoff_at IS NULL
      AND portal_activated_at IS NULL
      AND closed_at IS NULL
    )
    OR (
      state = 'active'
      AND current_curator_membership_id IS NOT NULL
      AND handoff_at IS NOT NULL
      AND portal_activated_at IS NOT NULL
      AND closed_at IS NULL
    )
    OR (
      state = 'closed'
      AND current_curator_membership_id IS NOT NULL
      AND handoff_at IS NOT NULL
      AND portal_activated_at IS NOT NULL
      AND closed_at IS NOT NULL
    )
  )
);

CREATE TABLE platform.student_case_assignment_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  student_case_id UUID NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('assigned', 'reassigned')),
  previous_curator_membership_id UUID,
  new_curator_membership_id UUID NOT NULL,
  previous_scope_id UUID NOT NULL,
  previous_scope_version BIGINT NOT NULL CHECK (previous_scope_version > 0),
  new_scope_id UUID NOT NULL,
  new_scope_version BIGINT NOT NULL CHECK (new_scope_version > 0),
  actor_membership_id UUID NOT NULL,
  reason TEXT NOT NULL CHECK (
    char_length(btrim(reason)) BETWEEN 1 AND 1000
  ),
  request_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT student_case_assignment_events_request_id_key UNIQUE (request_id),
  CONSTRAINT student_case_assignment_events_case_fkey
    FOREIGN KEY (organization_id, student_case_id)
    REFERENCES platform.student_cases(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT student_case_assignment_events_previous_curator_fkey
    FOREIGN KEY (organization_id, previous_curator_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT student_case_assignment_events_new_curator_fkey
    FOREIGN KEY (organization_id, new_curator_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT student_case_assignment_events_previous_scope_fkey
    FOREIGN KEY (
      organization_id,
      previous_scope_id,
      previous_scope_version
    )
    REFERENCES platform.record_scopes(organization_id, id, scope_version)
    ON DELETE RESTRICT,
  CONSTRAINT student_case_assignment_events_new_scope_fkey
    FOREIGN KEY (
      organization_id,
      new_scope_id,
      new_scope_version
    )
    REFERENCES platform.record_scopes(organization_id, id, scope_version)
    ON DELETE RESTRICT,
  CONSTRAINT student_case_assignment_events_actor_fkey
    FOREIGN KEY (organization_id, actor_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT student_case_assignment_events_scope_progression CHECK (
    new_scope_version = previous_scope_version + 1
    AND new_scope_id <> previous_scope_id
  ),
  CONSTRAINT student_case_assignment_events_type_shape CHECK (
    (event_type = 'assigned' AND previous_curator_membership_id IS NULL)
    OR (
      event_type = 'reassigned'
      AND previous_curator_membership_id IS NOT NULL
      AND previous_curator_membership_id <> new_curator_membership_id
    )
  )
);

CREATE TABLE platform.student_case_lifecycle_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  student_case_id UUID NOT NULL,
  event_type TEXT NOT NULL CHECK (
    event_type IN ('activated', 'closed', 'reopened')
  ),
  previous_state platform.student_case_state NOT NULL,
  new_state platform.student_case_state NOT NULL,
  actor_membership_id UUID NOT NULL,
  reason TEXT NOT NULL CHECK (
    char_length(btrim(reason)) BETWEEN 1 AND 1000
  ),
  request_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT student_case_lifecycle_events_request_id_key UNIQUE (request_id),
  CONSTRAINT student_case_lifecycle_events_case_fkey
    FOREIGN KEY (organization_id, student_case_id)
    REFERENCES platform.student_cases(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT student_case_lifecycle_events_actor_fkey
    FOREIGN KEY (organization_id, actor_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT student_case_lifecycle_events_transition_check CHECK (
    (
      event_type = 'activated'
      AND previous_state = 'pending'
      AND new_state = 'active'
    )
    OR (
      event_type = 'closed'
      AND previous_state = 'active'
      AND new_state = 'closed'
    )
    OR (
      event_type = 'reopened'
      AND previous_state = 'closed'
      AND new_state = 'active'
    )
  )
);

CREATE TABLE platform.student_case_updates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  student_case_id UUID NOT NULL,
  author_membership_id UUID NOT NULL,
  source TEXT NOT NULL CHECK (btrim(source) <> ''),
  body TEXT NOT NULL CHECK (btrim(body) <> ''),
  student_visible BOOLEAN NOT NULL DEFAULT FALSE,
  occurred_at TIMESTAMPTZ NOT NULL,
  request_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT student_case_updates_organization_id_id_key
    UNIQUE (organization_id, id),
  CONSTRAINT student_case_updates_request_id_key UNIQUE (request_id),
  CONSTRAINT student_case_updates_case_fkey
    FOREIGN KEY (organization_id, student_case_id)
    REFERENCES platform.student_cases(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT student_case_updates_author_fkey
    FOREIGN KEY (organization_id, author_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id)
    ON DELETE RESTRICT
);

CREATE TABLE platform.university_applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  student_case_id UUID NOT NULL,
  institution_name TEXT NOT NULL CHECK (btrim(institution_name) <> ''),
  program_name TEXT NOT NULL CHECK (btrim(program_name) <> ''),
  status platform.application_status NOT NULL DEFAULT 'preparation',
  latest_evidence_reference TEXT,
  created_by_membership_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT university_applications_organization_id_id_key
    UNIQUE (organization_id, id),
  CONSTRAINT university_applications_org_id_case_key
    UNIQUE (organization_id, id, student_case_id),
  CONSTRAINT university_applications_case_fkey
    FOREIGN KEY (organization_id, student_case_id)
    REFERENCES platform.student_cases(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT university_applications_created_by_fkey
    FOREIGN KEY (organization_id, created_by_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT university_applications_evidence_check CHECK (
    (
      latest_evidence_reference IS NULL
      OR btrim(latest_evidence_reference) <> ''
    )
    AND (
      status NOT IN (
        'submitted',
        'under_review',
        'offer',
        'rejected',
        'enrolled'
      )
      OR (
        latest_evidence_reference IS NOT NULL
        AND btrim(latest_evidence_reference) <> ''
      )
    )
  )
);

CREATE TABLE platform.university_application_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  application_id UUID NOT NULL,
  student_case_id UUID NOT NULL,
  previous_status platform.application_status,
  new_status platform.application_status NOT NULL,
  evidence_reference TEXT,
  note TEXT,
  actor_membership_id UUID NOT NULL,
  request_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT university_application_events_request_id_key UNIQUE (request_id),
  CONSTRAINT university_application_events_application_fkey
    FOREIGN KEY (organization_id, application_id, student_case_id)
    REFERENCES platform.university_applications(
      organization_id,
      id,
      student_case_id
    )
    ON DELETE RESTRICT,
  CONSTRAINT university_application_events_case_fkey
    FOREIGN KEY (organization_id, student_case_id)
    REFERENCES platform.student_cases(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT university_application_events_actor_fkey
    FOREIGN KEY (organization_id, actor_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT university_application_events_status_check CHECK (
    previous_status IS NULL OR previous_status <> new_status
  ),
  CONSTRAINT university_application_events_evidence_check CHECK (
    (
      evidence_reference IS NULL
      OR btrim(evidence_reference) <> ''
    )
    AND (
      new_status NOT IN (
        'submitted',
        'under_review',
        'offer',
        'rejected',
        'enrolled'
      )
      OR (
        evidence_reference IS NOT NULL
        AND btrim(evidence_reference) <> ''
      )
    )
  ),
  CONSTRAINT university_application_events_note_check CHECK (
    note IS NULL OR btrim(note) <> ''
  )
);

CREATE TABLE platform.visa_cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  student_case_id UUID NOT NULL,
  status platform.visa_status NOT NULL DEFAULT 'not_started',
  latest_evidence_reference TEXT,
  created_by_membership_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT visa_cases_organization_id_id_key UNIQUE (organization_id, id),
  CONSTRAINT visa_cases_org_id_case_key
    UNIQUE (organization_id, id, student_case_id),
  CONSTRAINT visa_cases_organization_case_key
    UNIQUE (organization_id, student_case_id),
  CONSTRAINT visa_cases_case_fkey
    FOREIGN KEY (organization_id, student_case_id)
    REFERENCES platform.student_cases(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT visa_cases_created_by_fkey
    FOREIGN KEY (organization_id, created_by_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT visa_cases_evidence_check CHECK (
    (
      latest_evidence_reference IS NULL
      OR btrim(latest_evidence_reference) <> ''
    )
    AND (
      status NOT IN ('approved', 'rejected')
      OR (
        latest_evidence_reference IS NOT NULL
        AND btrim(latest_evidence_reference) <> ''
      )
    )
  )
);

CREATE TABLE platform.visa_case_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  visa_case_id UUID NOT NULL,
  student_case_id UUID NOT NULL,
  previous_status platform.visa_status,
  new_status platform.visa_status NOT NULL,
  evidence_reference TEXT,
  note TEXT,
  actor_membership_id UUID NOT NULL,
  request_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT visa_case_events_request_id_key UNIQUE (request_id),
  CONSTRAINT visa_case_events_visa_fkey
    FOREIGN KEY (organization_id, visa_case_id, student_case_id)
    REFERENCES platform.visa_cases(organization_id, id, student_case_id)
    ON DELETE RESTRICT,
  CONSTRAINT visa_case_events_case_fkey
    FOREIGN KEY (organization_id, student_case_id)
    REFERENCES platform.student_cases(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT visa_case_events_actor_fkey
    FOREIGN KEY (organization_id, actor_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT visa_case_events_status_check CHECK (
    previous_status IS NULL OR previous_status <> new_status
  ),
  CONSTRAINT visa_case_events_evidence_check CHECK (
    (
      evidence_reference IS NULL
      OR btrim(evidence_reference) <> ''
    )
    AND (
      new_status NOT IN ('approved', 'rejected')
      OR (
        evidence_reference IS NOT NULL
        AND btrim(evidence_reference) <> ''
      )
    )
  ),
  CONSTRAINT visa_case_events_note_check CHECK (
    note IS NULL OR btrim(note) <> ''
  )
);

CREATE TABLE platform.case_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  student_case_id UUID NOT NULL,
  task_type TEXT NOT NULL CHECK (btrim(task_type) <> ''),
  title TEXT NOT NULL CHECK (btrim(title) <> ''),
  assignee_membership_id UUID NOT NULL,
  priority platform.case_task_priority NOT NULL DEFAULT 'normal',
  due_at TIMESTAMPTZ,
  status platform.case_task_status NOT NULL DEFAULT 'open',
  student_visible BOOLEAN NOT NULL DEFAULT FALSE,
  created_by_membership_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT case_tasks_organization_id_id_key UNIQUE (organization_id, id),
  CONSTRAINT case_tasks_org_id_case_key
    UNIQUE (organization_id, id, student_case_id),
  CONSTRAINT case_tasks_case_fkey
    FOREIGN KEY (organization_id, student_case_id)
    REFERENCES platform.student_cases(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT case_tasks_assignee_fkey
    FOREIGN KEY (organization_id, assignee_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT case_tasks_created_by_fkey
    FOREIGN KEY (organization_id, created_by_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id)
    ON DELETE RESTRICT
);

CREATE TABLE platform.case_task_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  case_task_id UUID NOT NULL,
  student_case_id UUID NOT NULL,
  previous_status platform.case_task_status,
  new_status platform.case_task_status NOT NULL,
  previous_assignee_membership_id UUID,
  new_assignee_membership_id UUID NOT NULL,
  actor_membership_id UUID NOT NULL,
  request_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT case_task_events_request_id_key UNIQUE (request_id),
  CONSTRAINT case_task_events_task_fkey
    FOREIGN KEY (organization_id, case_task_id, student_case_id)
    REFERENCES platform.case_tasks(organization_id, id, student_case_id)
    ON DELETE RESTRICT,
  CONSTRAINT case_task_events_case_fkey
    FOREIGN KEY (organization_id, student_case_id)
    REFERENCES platform.student_cases(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT case_task_events_previous_assignee_fkey
    FOREIGN KEY (organization_id, previous_assignee_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT case_task_events_new_assignee_fkey
    FOREIGN KEY (organization_id, new_assignee_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT case_task_events_actor_fkey
    FOREIGN KEY (organization_id, actor_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT case_task_events_change_check CHECK (
    previous_status IS NULL
    OR previous_status <> new_status
    OR previous_assignee_membership_id IS DISTINCT FROM new_assignee_membership_id
  )
);

-- Foreign keys are not indexed automatically. Every tenant-qualified FK gets
-- an exact leading index so RLS joins and RESTRICT checks remain bounded.
CREATE INDEX student_cases_student_membership_idx
  ON platform.student_cases (organization_id, student_membership_id);
CREATE INDEX student_cases_sales_state_idx
  ON platform.student_cases (
    organization_id,
    responsible_sales_membership_id,
    state
  );
CREATE INDEX student_cases_curator_state_idx
  ON platform.student_cases (
    organization_id,
    current_curator_membership_id,
    state
  );
CREATE INDEX student_cases_scope_idx
  ON platform.student_cases (
    organization_id,
    current_scope_id,
    current_scope_version
  );
CREATE INDEX student_case_assignment_events_case_idx
  ON platform.student_case_assignment_events (
    organization_id,
    student_case_id,
    created_at DESC
  );
CREATE INDEX student_case_assignment_events_previous_curator_idx
  ON platform.student_case_assignment_events (
    organization_id,
    previous_curator_membership_id
  );
CREATE INDEX student_case_assignment_events_new_curator_idx
  ON platform.student_case_assignment_events (
    organization_id,
    new_curator_membership_id
  );
CREATE INDEX student_case_assignment_events_previous_scope_idx
  ON platform.student_case_assignment_events (
    organization_id,
    previous_scope_id,
    previous_scope_version
  );
CREATE INDEX student_case_assignment_events_new_scope_idx
  ON platform.student_case_assignment_events (
    organization_id,
    new_scope_id,
    new_scope_version
  );
CREATE INDEX student_case_assignment_events_actor_idx
  ON platform.student_case_assignment_events (
    organization_id,
    actor_membership_id
  );
CREATE INDEX student_case_lifecycle_events_case_idx
  ON platform.student_case_lifecycle_events (
    organization_id,
    student_case_id,
    created_at DESC
  );
CREATE INDEX student_case_lifecycle_events_actor_idx
  ON platform.student_case_lifecycle_events (
    organization_id,
    actor_membership_id
  );
CREATE INDEX student_case_updates_case_idx
  ON platform.student_case_updates (
    organization_id,
    student_case_id,
    occurred_at DESC
  );
CREATE INDEX student_case_updates_author_idx
  ON platform.student_case_updates (
    organization_id,
    author_membership_id
  );
CREATE INDEX university_applications_case_idx
  ON platform.university_applications (
    organization_id,
    student_case_id,
    updated_at DESC
  );
CREATE INDEX university_applications_created_by_idx
  ON platform.university_applications (
    organization_id,
    created_by_membership_id
  );
CREATE INDEX university_application_events_application_idx
  ON platform.university_application_events (
    organization_id,
    application_id,
    student_case_id,
    created_at DESC
  );
CREATE INDEX university_application_events_case_idx
  ON platform.university_application_events (
    organization_id,
    student_case_id
  );
CREATE INDEX university_application_events_actor_idx
  ON platform.university_application_events (
    organization_id,
    actor_membership_id
  );
CREATE INDEX visa_cases_case_idx
  ON platform.visa_cases (organization_id, student_case_id);
CREATE INDEX visa_cases_created_by_idx
  ON platform.visa_cases (organization_id, created_by_membership_id);
CREATE INDEX visa_case_events_visa_idx
  ON platform.visa_case_events (
    organization_id,
    visa_case_id,
    student_case_id,
    created_at DESC
  );
CREATE INDEX visa_case_events_case_idx
  ON platform.visa_case_events (organization_id, student_case_id);
CREATE INDEX visa_case_events_actor_idx
  ON platform.visa_case_events (organization_id, actor_membership_id);
CREATE INDEX case_tasks_case_state_idx
  ON platform.case_tasks (
    organization_id,
    student_case_id,
    status,
    due_at
  );
CREATE INDEX case_tasks_assignee_idx
  ON platform.case_tasks (
    organization_id,
    assignee_membership_id,
    status
  );
CREATE INDEX case_tasks_created_by_idx
  ON platform.case_tasks (
    organization_id,
    created_by_membership_id
  );
CREATE INDEX case_task_events_task_idx
  ON platform.case_task_events (
    organization_id,
    case_task_id,
    student_case_id,
    created_at DESC
  );
CREATE INDEX case_task_events_case_idx
  ON platform.case_task_events (organization_id, student_case_id);
CREATE INDEX case_task_events_previous_assignee_idx
  ON platform.case_task_events (
    organization_id,
    previous_assignee_membership_id
  );
CREATE INDEX case_task_events_new_assignee_idx
  ON platform.case_task_events (
    organization_id,
    new_assignee_membership_id
  );
CREATE INDEX case_task_events_actor_idx
  ON platform.case_task_events (organization_id, actor_membership_id);

-- There may be many historical scope versions, but exactly one student-case
-- scope can be active for a case at a time.
CREATE UNIQUE INDEX record_scopes_one_active_subject_idx
  ON platform.record_scopes (organization_id, scope_kind, scope_key)
  WHERE is_active;

ALTER TABLE platform.student_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.student_cases FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.student_case_assignment_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.student_case_assignment_events FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.student_case_lifecycle_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.student_case_lifecycle_events FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.student_case_updates ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.student_case_updates FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.university_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.university_applications FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.university_application_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.university_application_events FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.visa_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.visa_cases FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.visa_case_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.visa_case_events FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.case_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.case_tasks FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.case_task_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.case_task_events FORCE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION platform_private.protect_domain_identity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  checked_column TEXT;
BEGIN
  FOREACH checked_column IN ARRAY TG_ARGV
  LOOP
    IF (to_jsonb(NEW) -> checked_column)
      IS DISTINCT FROM (to_jsonb(OLD) -> checked_column)
    THEN
      RAISE EXCEPTION
        'platform.% identity column % is immutable',
        TG_TABLE_NAME,
        checked_column
        USING ERRCODE = '55000';
    END IF;
  END LOOP;
  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION platform_private.protect_domain_identity()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

CREATE TRIGGER student_cases_identity_immutable
  BEFORE UPDATE ON platform.student_cases
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.protect_domain_identity(
    'id',
    'organization_id',
    'student_membership_id',
    'responsible_sales_membership_id',
    'source_key',
    'contract_confirmation_ref',
    'contract_confirmed_at'
  );
CREATE TRIGGER university_applications_identity_immutable
  BEFORE UPDATE ON platform.university_applications
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.protect_domain_identity(
    'id',
    'organization_id',
    'student_case_id',
    'created_by_membership_id'
  );
CREATE TRIGGER visa_cases_identity_immutable
  BEFORE UPDATE ON platform.visa_cases
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.protect_domain_identity(
    'id',
    'organization_id',
    'student_case_id',
    'created_by_membership_id'
  );
CREATE TRIGGER case_tasks_identity_immutable
  BEFORE UPDATE ON platform.case_tasks
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.protect_domain_identity(
    'id',
    'organization_id',
    'student_case_id',
    'created_by_membership_id'
  );

CREATE TRIGGER student_cases_set_updated_at
  BEFORE UPDATE ON platform.student_cases
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.set_updated_at();
CREATE TRIGGER university_applications_set_updated_at
  BEFORE UPDATE ON platform.university_applications
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.set_updated_at();
CREATE TRIGGER visa_cases_set_updated_at
  BEFORE UPDATE ON platform.visa_cases
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.set_updated_at();
CREATE TRIGGER case_tasks_set_updated_at
  BEFORE UPDATE ON platform.case_tasks
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.set_updated_at();

CREATE OR REPLACE FUNCTION platform_private.protect_student_case_scope()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF OLD.scope_kind <> 'student_case' THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION
      'Historical student-case scope % cannot be deleted',
      OLD.id
      USING ERRCODE = '55000';
  END IF;

  IF OLD.organization_id IS DISTINCT FROM NEW.organization_id
    OR OLD.id IS DISTINCT FROM NEW.id
    OR OLD.scope_kind IS DISTINCT FROM NEW.scope_kind
    OR OLD.scope_key IS DISTINCT FROM NEW.scope_key
    OR OLD.scope_version IS DISTINCT FROM NEW.scope_version
    OR OLD.created_at IS DISTINCT FROM NEW.created_at
    OR NOT OLD.is_active
    OR NEW.is_active
  THEN
    RAISE EXCEPTION
      'Student-case scope % permits only one-way active-to-inactive rotation',
      OLD.id
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION platform_private.protect_student_case_scope()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

CREATE TRIGGER record_scopes_student_case_forward_only
  BEFORE UPDATE OR DELETE ON platform.record_scopes
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.protect_student_case_scope();

CREATE OR REPLACE FUNCTION platform_private.guard_student_case_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM platform.record_scopes AS scope
    WHERE scope.organization_id = NEW.organization_id
      AND scope.id = NEW.current_scope_id
      AND scope.scope_version = NEW.current_scope_version
      AND scope.scope_kind = 'student_case'
      AND scope.scope_key = NEW.id
      AND scope.is_active
  ) THEN
    RAISE EXCEPTION
      'Student case requires its exact active student_case scope'
      USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'pending'
      OR NEW.current_curator_membership_id IS NOT NULL
      OR NEW.handoff_at IS NOT NULL
      OR NEW.portal_activated_at IS NOT NULL
      OR NEW.closed_at IS NOT NULL
      OR NEW.current_scope_version <> 1
    THEN
      RAISE EXCEPTION
        'New student case must start pending on scope version 1'
        USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.handoff_at IS NOT NULL
    AND OLD.handoff_at IS DISTINCT FROM NEW.handoff_at
  THEN
    RAISE EXCEPTION
      'First student-case handoff timestamp is immutable'
      USING ERRCODE = '55000';
  END IF;

  IF OLD.portal_activated_at IS NOT NULL
    AND OLD.portal_activated_at IS DISTINCT FROM NEW.portal_activated_at
  THEN
    RAISE EXCEPTION
      'First portal activation timestamp is immutable'
      USING ERRCODE = '55000';
  END IF;

  IF OLD.state IS DISTINCT FROM NEW.state
    AND NOT (
      (OLD.state = 'pending' AND NEW.state = 'active')
      OR (OLD.state = 'active' AND NEW.state = 'closed')
      OR (OLD.state = 'closed' AND NEW.state = 'active')
    )
  THEN
    RAISE EXCEPTION
      'Unsupported student-case transition % to %',
      OLD.state,
      NEW.state
      USING ERRCODE = '55000';
  END IF;

  IF OLD.current_scope_id IS DISTINCT FROM NEW.current_scope_id
    OR OLD.current_scope_version IS DISTINCT FROM NEW.current_scope_version
    OR OLD.current_curator_membership_id
      IS DISTINCT FROM NEW.current_curator_membership_id
  THEN
    IF NEW.current_scope_id = OLD.current_scope_id
      OR NEW.current_scope_version <> OLD.current_scope_version + 1
      OR NEW.current_curator_membership_id IS NULL
      OR (
        OLD.state = 'pending'
        AND NEW.state <> 'active'
      )
      OR (
        OLD.state IN ('active', 'closed')
        AND NEW.state <> OLD.state
      )
    THEN
      RAISE EXCEPTION
        'Curator change requires one-step scope rotation and valid handoff state'
        USING ERRCODE = '55000';
    END IF;
  ELSIF OLD.state = 'pending' AND NEW.state = 'active' THEN
    RAISE EXCEPTION
      'Pending activation requires curator and scope rotation'
      USING ERRCODE = '55000';
  END IF;

  IF OLD.state = 'active' AND NEW.state = 'closed' AND NEW.closed_at IS NULL THEN
    RAISE EXCEPTION
      'Closing a student case requires closed_at'
      USING ERRCODE = '55000';
  END IF;

  IF OLD.state = 'closed' AND NEW.state = 'active' AND NEW.closed_at IS NOT NULL THEN
    RAISE EXCEPTION
      'Reopening a student case must clear closed_at'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION platform_private.guard_student_case_transition()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

CREATE TRIGGER student_cases_transition_guard
  BEFORE INSERT OR UPDATE ON platform.student_cases
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.guard_student_case_transition();

CREATE OR REPLACE FUNCTION platform_private.block_domain_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION
    'Hard % on platform.% is forbidden; use reviewed lifecycle state',
    TG_OP,
    TG_TABLE_NAME
    USING ERRCODE = '55000';
END
$$;

REVOKE ALL ON FUNCTION platform_private.block_domain_delete()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

CREATE TRIGGER student_cases_no_delete
  BEFORE DELETE ON platform.student_cases
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.block_domain_delete();
CREATE TRIGGER student_cases_no_truncate
  BEFORE TRUNCATE ON platform.student_cases
  FOR EACH STATEMENT
  EXECUTE FUNCTION platform_private.block_domain_delete();
CREATE TRIGGER university_applications_no_delete
  BEFORE DELETE ON platform.university_applications
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.block_domain_delete();
CREATE TRIGGER university_applications_no_truncate
  BEFORE TRUNCATE ON platform.university_applications
  FOR EACH STATEMENT
  EXECUTE FUNCTION platform_private.block_domain_delete();
CREATE TRIGGER visa_cases_no_delete
  BEFORE DELETE ON platform.visa_cases
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.block_domain_delete();
CREATE TRIGGER visa_cases_no_truncate
  BEFORE TRUNCATE ON platform.visa_cases
  FOR EACH STATEMENT
  EXECUTE FUNCTION platform_private.block_domain_delete();
CREATE TRIGGER case_tasks_no_delete
  BEFORE DELETE ON platform.case_tasks
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.block_domain_delete();
CREATE TRIGGER case_tasks_no_truncate
  BEFORE TRUNCATE ON platform.case_tasks
  FOR EACH STATEMENT
  EXECUTE FUNCTION platform_private.block_domain_delete();

-- Events and human-authored updates are forward-only evidence.
CREATE TRIGGER student_case_assignment_events_append_only
  BEFORE UPDATE OR DELETE ON platform.student_case_assignment_events
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER student_case_assignment_events_no_truncate
  BEFORE TRUNCATE ON platform.student_case_assignment_events
  FOR EACH STATEMENT
  EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER student_case_lifecycle_events_append_only
  BEFORE UPDATE OR DELETE ON platform.student_case_lifecycle_events
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER student_case_lifecycle_events_no_truncate
  BEFORE TRUNCATE ON platform.student_case_lifecycle_events
  FOR EACH STATEMENT
  EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER student_case_updates_append_only
  BEFORE UPDATE OR DELETE ON platform.student_case_updates
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER student_case_updates_no_truncate
  BEFORE TRUNCATE ON platform.student_case_updates
  FOR EACH STATEMENT
  EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER university_application_events_append_only
  BEFORE UPDATE OR DELETE ON platform.university_application_events
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER university_application_events_no_truncate
  BEFORE TRUNCATE ON platform.university_application_events
  FOR EACH STATEMENT
  EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER visa_case_events_append_only
  BEFORE UPDATE OR DELETE ON platform.visa_case_events
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER visa_case_events_no_truncate
  BEFORE TRUNCATE ON platform.visa_case_events
  FOR EACH STATEMENT
  EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER case_task_events_append_only
  BEFORE UPDATE OR DELETE ON platform.case_task_events
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER case_task_events_no_truncate
  BEFORE TRUNCATE ON platform.case_task_events
  FOR EACH STATEMENT
  EXECUTE FUNCTION platform_private.block_append_only_mutation();

-- P2D extends immutable RBAC through new published v2 bundles. V1 remains
-- untouched. Every existing membership with authority, including inactive or
-- blocked membership debt, is advanced so later reactivation cannot revive v1.
INSERT INTO platform.permission_definitions (
  permission_key,
  description
)
VALUES
  ('case.read.full', 'Read a full student case within live object scope'),
  ('case.read.summary', 'Read the fixed post-handoff Sales summary'),
  ('case.curator.assign', 'Assign or reassign the student case Curator'),
  ('case.lifecycle.change', 'Close or reopen an assigned student case'),
  ('case.route.manage', 'Manage approved operational route fields'),
  ('case.update.append', 'Append an operational student case update'),
  ('application.manage', 'Create and change university applications'),
  ('visa.manage', 'Create and change the assigned student visa case'),
  ('task.manage', 'Create and change assigned student case tasks'),
  ('portal.read.self', 'Read fixed activated Student Portal projections');

INSERT INTO platform.role_bundle_versions (
  id,
  role,
  version,
  status,
  label
)
VALUES
  (
    '00000000-0000-4000-8000-000000000101',
    'admin',
    2,
    'draft',
    'Admin v2 admissions'
  ),
  (
    '00000000-0000-4000-8000-000000000102',
    'sales',
    2,
    'draft',
    'Sales v2 admissions'
  ),
  (
    '00000000-0000-4000-8000-000000000103',
    'curator',
    2,
    'draft',
    'Curator v2 admissions'
  ),
  (
    '00000000-0000-4000-8000-000000000104',
    'finance',
    2,
    'draft',
    'Finance v2 admissions'
  ),
  (
    '00000000-0000-4000-8000-000000000105',
    'student',
    2,
    'draft',
    'Student v2 admissions'
  );

INSERT INTO platform.role_bundle_permissions (
  bundle_id,
  bundle_role,
  permission_key
)
SELECT
  v2.id,
  v2.role,
  v1_permission.permission_key
FROM platform.role_bundle_versions AS v2
JOIN platform.role_bundle_versions AS v1
  ON v1.role = v2.role
  AND v1.version = 1
  AND v1.status = 'published'
JOIN platform.role_bundle_permissions AS v1_permission
  ON v1_permission.bundle_id = v1.id
  AND v1_permission.bundle_role = v1.role
WHERE v2.version = 2;

INSERT INTO platform.role_bundle_permissions (
  bundle_id,
  bundle_role,
  permission_key
)
SELECT
  bundle.id,
  bundle.role,
  permission.permission_key
FROM platform.role_bundle_versions AS bundle
CROSS JOIN platform.permission_definitions AS permission
WHERE bundle.version = 2
  AND (
    bundle.role = 'admin'
    OR (
      bundle.role = 'sales'
      AND permission.permission_key IN (
        'case.read.full',
        'case.read.summary',
        'case.route.manage',
        'case.update.append',
        'application.manage',
        'task.manage'
      )
    )
    OR (
      bundle.role = 'curator'
      AND permission.permission_key IN (
        'case.read.full',
        'case.lifecycle.change',
        'case.route.manage',
        'case.update.append',
        'application.manage',
        'visa.manage',
        'task.manage'
      )
    )
    OR (
      bundle.role = 'student'
      AND permission.permission_key = 'portal.read.self'
    )
  )
  AND permission.permission_key IN (
    'case.read.full',
    'case.read.summary',
    'case.curator.assign',
    'case.lifecycle.change',
    'case.route.manage',
    'case.update.append',
    'application.manage',
    'visa.manage',
    'task.manage',
    'portal.read.self'
  );

UPDATE platform.role_bundle_versions
SET
  status = 'published',
  published_at = statement_timestamp()
WHERE version = 2;

CREATE TEMPORARY TABLE p2d_membership_bundle_upgrades
ON COMMIT DROP
AS
SELECT
  membership.organization_id,
  membership.id AS membership_id,
  membership.profile_id,
  membership."current_role" AS business_role,
  membership.current_bundle_id AS previous_bundle_id,
  v2.id AS new_bundle_id,
  profile.access_version AS previous_access_version,
  COALESCE(
    (
      SELECT MAX(history.role_version)
      FROM platform.membership_role_history AS history
      WHERE history.organization_id = membership.organization_id
        AND history.membership_id = membership.id
    ),
    0
  ) + 1 AS next_role_version,
  gen_random_uuid() AS request_id
FROM platform.organization_memberships AS membership
JOIN platform.profiles AS profile
  ON profile.id = membership.profile_id
JOIN platform.role_bundle_versions AS v2
  ON v2.role = membership."current_role"
  AND v2.version = 2
  AND v2.status = 'published'
WHERE membership."current_role" IS NOT NULL
  AND membership.current_bundle_id IS NOT NULL
  AND membership.current_bundle_id <> v2.id;

INSERT INTO platform.membership_role_history (
  organization_id,
  membership_id,
  profile_id,
  role_version,
  previous_role,
  new_role,
  previous_bundle_id,
  new_bundle_id,
  actor_kind,
  actor_profile_id,
  reason,
  request_id
)
SELECT
  upgrade.organization_id,
  upgrade.membership_id,
  upgrade.profile_id,
  upgrade.next_role_version,
  upgrade.business_role,
  upgrade.business_role,
  upgrade.previous_bundle_id,
  upgrade.new_bundle_id,
  'system',
  NULL,
  'P2D immutable RBAC bundle upgrade',
  upgrade.request_id
FROM p2d_membership_bundle_upgrades AS upgrade;

UPDATE platform.organization_memberships AS membership
SET current_bundle_id = upgrade.new_bundle_id
FROM p2d_membership_bundle_upgrades AS upgrade
WHERE membership.organization_id = upgrade.organization_id
  AND membership.id = upgrade.membership_id;

UPDATE platform.profiles AS profile
SET access_version = profile.access_version + 1
WHERE profile.id IN (
  SELECT DISTINCT upgrade.profile_id
  FROM p2d_membership_bundle_upgrades AS upgrade
);

INSERT INTO platform.audit_events (
  organization_id,
  actor_kind,
  actor_profile_id,
  actor_principal,
  action,
  resource_type,
  resource_id,
  before_state,
  after_state,
  reason,
  request_id
)
SELECT
  upgrade.organization_id,
  'system',
  NULL,
  'migration:042_platform_student_admissions',
  'rbac.bundle.upgrade',
  'organization_membership',
  upgrade.membership_id,
  jsonb_build_object(
    'role', upgrade.business_role,
    'bundle_id', upgrade.previous_bundle_id,
    'access_version', upgrade.previous_access_version
  ),
  jsonb_build_object(
    'role', upgrade.business_role,
    'bundle_id', upgrade.new_bundle_id,
    'access_version', profile.access_version
  ),
  'P2D immutable RBAC bundle upgrade',
  upgrade.request_id
FROM p2d_membership_bundle_upgrades AS upgrade
JOIN platform.profiles AS profile
  ON profile.id = upgrade.profile_id;

CREATE OR REPLACE FUNCTION platform_private.lock_p2d_request(
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
    RAISE EXCEPTION
      'request_id is required'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      'evo:p2d:request:' || p_request_id::TEXT,
      0
    )
  );
END
$$;

REVOKE ALL ON FUNCTION platform_private.lock_p2d_request(UUID)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

CREATE OR REPLACE FUNCTION platform_private.require_domain_actor(
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
BEGIN
  IF p_organization_id IS NULL
    OR (SELECT auth.uid()) IS NULL
    OR NOT private.platform_has_permission(
      p_organization_id,
      p_permission_key
    )
  THEN
    RAISE EXCEPTION
      'Active Platform permission is required'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    profile.id,
    membership.id,
    profile.auth_user_id,
    membership."current_role"
  FROM platform.profiles AS profile
  JOIN platform.organization_memberships AS membership
    ON membership.profile_id = profile.id
  JOIN platform.organizations AS organization
    ON organization.id = membership.organization_id
  JOIN platform.role_bundle_versions AS bundle
    ON bundle.id = membership.current_bundle_id
    AND bundle.role = membership."current_role"
  WHERE profile.auth_user_id = (SELECT auth.uid())
    AND profile.status = 'active'
    AND membership.organization_id = p_organization_id
    AND membership.status = 'active'
    AND organization.status = 'active'
    AND bundle.status = 'published'
    AND membership."current_role"::TEXT =
      (SELECT auth.jwt() ->> 'platform_role')
    AND profile.access_version::TEXT =
      (SELECT auth.jwt() ->> 'platform_access_version')
  FOR UPDATE OF profile, membership, organization;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Active Platform permission is required'
      USING ERRCODE = '42501';
  END IF;
END
$$;

REVOKE ALL ON FUNCTION platform_private.require_domain_actor(UUID, TEXT)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

CREATE OR REPLACE FUNCTION private.platform_can_read_student_case(
  p_organization_id UUID,
  p_student_case_id UUID
)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM platform.student_cases AS student_case
    JOIN platform.organization_memberships AS actor_membership
      ON actor_membership.organization_id = student_case.organization_id
    JOIN platform.profiles AS actor_profile
      ON actor_profile.id = actor_membership.profile_id
    WHERE student_case.organization_id = p_organization_id
      AND student_case.id = p_student_case_id
      AND actor_profile.auth_user_id = (SELECT auth.uid())
      AND private.platform_has_permission(
        student_case.organization_id,
        'case.read.full'
      )
      AND (
        (
          actor_membership."current_role" = 'admin'
          AND private.platform_has_scope(
            student_case.organization_id,
            'organization',
            student_case.organization_id
          )
        )
        OR (
          actor_membership."current_role" = 'sales'
          AND student_case.state = 'pending'
          AND student_case.responsible_sales_membership_id =
            actor_membership.id
          AND private.platform_has_scope(
            student_case.organization_id,
            'student_case',
            student_case.id
          )
        )
        OR (
          actor_membership."current_role" = 'curator'
          AND student_case.state IN ('active', 'closed')
          AND student_case.current_curator_membership_id =
            actor_membership.id
          AND private.platform_has_scope(
            student_case.organization_id,
            'student_case',
            student_case.id
          )
        )
      )
  )
$$;

REVOKE ALL ON FUNCTION private.platform_can_read_student_case(UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE
  ON FUNCTION private.platform_can_read_student_case(UUID, UUID)
  TO authenticated;

CREATE OR REPLACE FUNCTION private.platform_can_read_student_portal_case(
  p_organization_id UUID,
  p_student_case_id UUID
)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM platform.student_cases AS student_case
    JOIN platform.organization_memberships AS membership
      ON membership.organization_id = student_case.organization_id
      AND membership.id = student_case.student_membership_id
    JOIN platform.profiles AS profile
      ON profile.id = membership.profile_id
    WHERE student_case.organization_id = p_organization_id
      AND student_case.id = p_student_case_id
      AND profile.auth_user_id = (SELECT auth.uid())
      AND membership."current_role" = 'student'
      AND student_case.state IN ('active', 'closed')
      AND student_case.portal_activated_at IS NOT NULL
      AND private.platform_has_permission(
        student_case.organization_id,
        'portal.read.self'
      )
      AND private.platform_has_scope(
        student_case.organization_id,
        'student_case',
        student_case.id
      )
  )
$$;

REVOKE ALL ON FUNCTION private.platform_can_read_student_portal_case(
  UUID,
  UUID
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

CREATE OR REPLACE FUNCTION platform_private.require_case_operator(
  p_organization_id UUID,
  p_student_case_id UUID,
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
  target_case platform.student_cases%ROWTYPE;
BEGIN
  SELECT *
  INTO actor
  FROM platform_private.require_domain_actor(
    p_organization_id,
    p_permission_key
  );

  SELECT *
  INTO target_case
  FROM platform.student_cases AS student_case
  WHERE student_case.organization_id = p_organization_id
    AND student_case.id = p_student_case_id;

  IF NOT FOUND OR NOT (
    (
      actor.actor_role = 'admin'
      AND private.platform_has_scope(
        p_organization_id,
        'organization',
        p_organization_id
      )
    )
    OR (
      actor.actor_role = 'sales'
      AND target_case.state = 'pending'
      AND target_case.responsible_sales_membership_id =
        actor.actor_membership_id
      AND private.platform_has_scope(
        p_organization_id,
        'student_case',
        p_student_case_id
      )
    )
    OR (
      actor.actor_role = 'curator'
      AND target_case.state IN ('active', 'closed')
      AND target_case.current_curator_membership_id =
        actor.actor_membership_id
      AND private.platform_has_scope(
        p_organization_id,
        'student_case',
        p_student_case_id
      )
    )
  ) THEN
    RAISE EXCEPTION
      'Student case is unavailable'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY SELECT
    actor.actor_profile_id,
    actor.actor_membership_id,
    actor.actor_auth_user_id,
    actor.actor_role;
END
$$;

REVOKE ALL ON FUNCTION platform_private.require_case_operator(
  UUID,
  UUID,
  TEXT
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

-- Authenticated base-table access is SELECT-only and limited to full staff
-- mode. Students and post-handoff Sales use fixed projection RPCs below.
CREATE POLICY student_cases_staff_read
  ON platform.student_cases
  FOR SELECT
  TO authenticated
  USING (
    (SELECT private.platform_can_read_student_case(organization_id, id))
  );

CREATE POLICY student_case_assignment_events_staff_read
  ON platform.student_case_assignment_events
  FOR SELECT
  TO authenticated
  USING (
    (SELECT private.platform_can_read_student_case(
      organization_id,
      student_case_id
    ))
  );

CREATE POLICY student_case_lifecycle_events_staff_read
  ON platform.student_case_lifecycle_events
  FOR SELECT
  TO authenticated
  USING (
    (SELECT private.platform_can_read_student_case(
      organization_id,
      student_case_id
    ))
  );

CREATE POLICY student_case_updates_staff_read
  ON platform.student_case_updates
  FOR SELECT
  TO authenticated
  USING (
    (SELECT private.platform_can_read_student_case(
      organization_id,
      student_case_id
    ))
  );

CREATE POLICY university_applications_staff_read
  ON platform.university_applications
  FOR SELECT
  TO authenticated
  USING (
    (SELECT private.platform_can_read_student_case(
      organization_id,
      student_case_id
    ))
  );

CREATE POLICY university_application_events_staff_read
  ON platform.university_application_events
  FOR SELECT
  TO authenticated
  USING (
    (SELECT private.platform_can_read_student_case(
      organization_id,
      student_case_id
    ))
  );

CREATE POLICY visa_cases_staff_read
  ON platform.visa_cases
  FOR SELECT
  TO authenticated
  USING (
    (SELECT private.platform_can_read_student_case(
      organization_id,
      student_case_id
    ))
  );

CREATE POLICY visa_case_events_staff_read
  ON platform.visa_case_events
  FOR SELECT
  TO authenticated
  USING (
    (SELECT private.platform_can_read_student_case(
      organization_id,
      student_case_id
    ))
  );

CREATE POLICY case_tasks_staff_read
  ON platform.case_tasks
  FOR SELECT
  TO authenticated
  USING (
    (SELECT private.platform_can_read_student_case(
      organization_id,
      student_case_id
    ))
  );

CREATE POLICY case_task_events_staff_read
  ON platform.case_task_events
  FOR SELECT
  TO authenticated
  USING (
    (SELECT private.platform_can_read_student_case(
      organization_id,
      student_case_id
    ))
  );

CREATE OR REPLACE FUNCTION platform.create_pending_student_case(
  p_organization_id UUID,
  p_student_membership_id UUID,
  p_responsible_sales_membership_id UUID,
  p_source_key TEXT,
  p_contract_confirmation_ref TEXT,
  p_contract_confirmed_at TIMESTAMPTZ,
  p_student_display_name TEXT,
  p_target_country TEXT,
  p_target_degree TEXT,
  p_program_direction TEXT,
  p_intake TEXT,
  p_language_assumption TEXT,
  p_funding_assumption TEXT,
  p_operational_stage TEXT,
  p_next_action TEXT,
  p_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  replayed JSONB;
  created_case_id UUID := gen_random_uuid();
  created_scope_id UUID := gen_random_uuid();
  sales_profile_id UUID;
  sales_access_version BIGINT;
  result JSONB;
  fixed_reason CONSTANT TEXT :=
    'Service-created confirmed-contract pending student case';
BEGIN
  IF (SELECT auth.jwt() ->> 'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION
      'Service role is required'
      USING ERRCODE = '42501';
  END IF;

  PERFORM platform_private.lock_p2d_request(p_request_id);

  IF p_organization_id IS NULL
    OR p_student_membership_id IS NULL
    OR p_responsible_sales_membership_id IS NULL
    OR p_contract_confirmed_at IS NULL
    OR p_source_key IS NULL
    OR btrim(p_source_key) = ''
    OR p_contract_confirmation_ref IS NULL
    OR btrim(p_contract_confirmation_ref) = ''
    OR p_student_display_name IS NULL
    OR btrim(p_student_display_name) = ''
    OR p_target_country IS NULL
    OR btrim(p_target_country) = ''
    OR p_target_degree IS NULL
    OR btrim(p_target_degree) = ''
    OR p_operational_stage IS NULL
    OR btrim(p_operational_stage) = ''
  THEN
    RAISE EXCEPTION
      'Confirmed contract and required student-case fields are required'
      USING ERRCODE = '22023';
  END IF;

  replayed := platform_private.replay_audit(
    p_request_id,
    'case.create',
    'student_case',
    NULL,
    fixed_reason,
    jsonb_build_object(
      'organization_id', p_organization_id,
      'student_membership_id', p_student_membership_id,
      'responsible_sales_membership_id',
        p_responsible_sales_membership_id,
      'source_key', btrim(p_source_key),
      'contract_confirmation_ref', btrim(p_contract_confirmation_ref),
      'contract_confirmed_at', p_contract_confirmed_at,
      'student_display_name', btrim(p_student_display_name),
      'target_country', btrim(p_target_country),
      'target_degree', btrim(p_target_degree),
      'program_direction', NULLIF(btrim(p_program_direction), ''),
      'intake', NULLIF(btrim(p_intake), ''),
      'language_assumption', NULLIF(btrim(p_language_assumption), ''),
      'funding_assumption', NULLIF(btrim(p_funding_assumption), ''),
      'route_approval_status', 'draft',
      'operational_stage', btrim(p_operational_stage),
      'next_action', NULLIF(btrim(p_next_action), '')
    )
  );
  IF replayed IS NOT NULL THEN
    RETURN replayed;
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      'evo:p2d:case-source:'
        || p_organization_id::TEXT
        || ':'
        || btrim(p_source_key),
      0
    )
  );

  replayed := platform_private.replay_audit(
    p_request_id,
    'case.create',
    'student_case',
    NULL,
    fixed_reason,
    jsonb_build_object(
      'organization_id', p_organization_id,
      'student_membership_id', p_student_membership_id,
      'responsible_sales_membership_id',
        p_responsible_sales_membership_id,
      'source_key', btrim(p_source_key),
      'contract_confirmation_ref', btrim(p_contract_confirmation_ref),
      'contract_confirmed_at', p_contract_confirmed_at,
      'student_display_name', btrim(p_student_display_name),
      'target_country', btrim(p_target_country),
      'target_degree', btrim(p_target_degree),
      'program_direction', NULLIF(btrim(p_program_direction), ''),
      'intake', NULLIF(btrim(p_intake), ''),
      'language_assumption', NULLIF(btrim(p_language_assumption), ''),
      'funding_assumption', NULLIF(btrim(p_funding_assumption), ''),
      'route_approval_status', 'draft',
      'operational_stage', btrim(p_operational_stage),
      'next_action', NULLIF(btrim(p_next_action), '')
    )
  );
  IF replayed IS NOT NULL THEN
    RETURN replayed;
  END IF;

  PERFORM 1
  FROM platform.organization_memberships AS membership
  JOIN platform.profiles AS profile
    ON profile.id = membership.profile_id
  JOIN platform.organizations AS organization
    ON organization.id = membership.organization_id
  JOIN platform.role_bundle_versions AS bundle
    ON bundle.id = membership.current_bundle_id
    AND bundle.role = membership."current_role"
  WHERE membership.organization_id = p_organization_id
    AND membership.id = p_student_membership_id
    AND membership.status = 'active'
    AND membership."current_role" = 'student'
    AND profile.status = 'active'
    AND organization.status = 'active'
    AND bundle.status = 'published'
  FOR UPDATE OF membership, profile, organization;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Live Student membership is required'
      USING ERRCODE = '22023';
  END IF;

  SELECT profile.id
  INTO sales_profile_id
  FROM platform.organization_memberships AS membership
  JOIN platform.profiles AS profile
    ON profile.id = membership.profile_id
  JOIN platform.organizations AS organization
    ON organization.id = membership.organization_id
  JOIN platform.role_bundle_versions AS bundle
    ON bundle.id = membership.current_bundle_id
    AND bundle.role = membership."current_role"
  WHERE membership.organization_id = p_organization_id
    AND membership.id = p_responsible_sales_membership_id
    AND membership.status = 'active'
    AND membership."current_role" = 'sales'
    AND profile.status = 'active'
    AND organization.status = 'active'
    AND bundle.status = 'published'
  FOR UPDATE OF membership, profile, organization;

  IF sales_profile_id IS NULL THEN
    RAISE EXCEPTION
      'Live Sales membership is required'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO platform.record_scopes (
    id,
    organization_id,
    scope_kind,
    scope_key,
    scope_version,
    is_active
  )
  VALUES (
    created_scope_id,
    p_organization_id,
    'student_case',
    created_case_id,
    1,
    TRUE
  );

  INSERT INTO platform.student_cases (
    id,
    organization_id,
    student_membership_id,
    responsible_sales_membership_id,
    current_curator_membership_id,
    source_key,
    contract_confirmation_ref,
    contract_confirmed_at,
    student_display_name,
    target_country,
    target_degree,
    program_direction,
    intake,
    language_assumption,
    funding_assumption,
    route_approval_status,
    operational_stage,
    state,
    handoff_at,
    portal_activated_at,
    closed_at,
    next_action,
    current_scope_id,
    current_scope_version
  )
  VALUES (
    created_case_id,
    p_organization_id,
    p_student_membership_id,
    p_responsible_sales_membership_id,
    NULL,
    btrim(p_source_key),
    btrim(p_contract_confirmation_ref),
    p_contract_confirmed_at,
    btrim(p_student_display_name),
    btrim(p_target_country),
    btrim(p_target_degree),
    NULLIF(btrim(p_program_direction), ''),
    NULLIF(btrim(p_intake), ''),
    NULLIF(btrim(p_language_assumption), ''),
    NULLIF(btrim(p_funding_assumption), ''),
    'draft',
    btrim(p_operational_stage),
    'pending',
    NULL,
    NULL,
    NULL,
    NULLIF(btrim(p_next_action), ''),
    created_scope_id,
    1
  );

  PERFORM platform_private.append_scope_event(
    p_organization_id,
    p_responsible_sales_membership_id,
    created_scope_id,
    1,
    TRUE,
    'service',
    NULL,
    fixed_reason,
    p_request_id
  );

  sales_access_version :=
    platform_private.bump_access_version(sales_profile_id);

  result := jsonb_build_object(
    'organization_id', p_organization_id,
    'student_case_id', created_case_id,
    'student_membership_id', p_student_membership_id,
    'responsible_sales_membership_id',
      p_responsible_sales_membership_id,
    'source_key', btrim(p_source_key),
    'contract_confirmation_ref', btrim(p_contract_confirmation_ref),
    'contract_confirmed_at', p_contract_confirmed_at,
    'student_display_name', btrim(p_student_display_name),
    'target_country', btrim(p_target_country),
    'target_degree', btrim(p_target_degree),
    'program_direction', NULLIF(btrim(p_program_direction), ''),
    'intake', NULLIF(btrim(p_intake), ''),
    'language_assumption', NULLIF(btrim(p_language_assumption), ''),
    'funding_assumption', NULLIF(btrim(p_funding_assumption), ''),
    'route_approval_status', 'draft',
    'operational_stage', btrim(p_operational_stage),
    'next_action', NULLIF(btrim(p_next_action), ''),
    'state', 'pending',
    'scope_id', created_scope_id,
    'scope_version', 1,
    'sales_access_version', sales_access_version
  );

  INSERT INTO platform.audit_events (
    organization_id,
    actor_kind,
    actor_profile_id,
    actor_principal,
    action,
    resource_type,
    resource_id,
    before_state,
    after_state,
    reason,
    request_id
  )
  VALUES (
    p_organization_id,
    'service',
    NULL,
    'service:platform-case-ingest',
    'case.create',
    'student_case',
    created_case_id,
    NULL,
    result,
    fixed_reason,
    p_request_id
  );

  RETURN result;
END
$$;

CREATE OR REPLACE FUNCTION platform.assign_student_case_curator(
  p_organization_id UUID,
  p_student_case_id UUID,
  p_curator_membership_id UUID,
  p_reason TEXT,
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
  target_case platform.student_cases%ROWTYPE;
  replayed JSONB;
  previous_scope platform.record_scopes%ROWTYPE;
  new_scope_id UUID := gen_random_uuid();
  new_scope_version BIGINT;
  previous_curator_id UUID;
  new_curator_profile_id UUID;
  affected_profile_id UUID;
  occurred_at TIMESTAMPTZ := statement_timestamp();
  assignment_kind TEXT;
  result JSONB;
BEGIN
  PERFORM platform_private.lock_p2d_request(p_request_id);

  IF p_reason IS NULL
    OR char_length(btrim(p_reason)) NOT BETWEEN 1 AND 1000
    OR p_student_case_id IS NULL
    OR p_curator_membership_id IS NULL
  THEN
    RAISE EXCEPTION
      'Assignment reason of 1 to 1000 characters is required'
      USING ERRCODE = '22023';
  END IF;

  SELECT *
  INTO actor
  FROM platform_private.require_admin_actor(
    p_organization_id,
    'case.curator.assign'
  );

  PERFORM 1
  FROM platform.organization_memberships AS membership
  JOIN platform.profiles AS profile
    ON profile.id = membership.profile_id
  JOIN platform.organizations AS organization
    ON organization.id = membership.organization_id
  WHERE membership.organization_id = p_organization_id
    AND membership.id = actor.actor_membership_id
    AND membership.status = 'active'
    AND membership."current_role" = 'admin'
    AND profile.id = actor.actor_profile_id
    AND profile.status = 'active'
    AND organization.status = 'active'
  FOR UPDATE OF membership, profile, organization;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Active Admin membership is required'
      USING ERRCODE = '42501';
  END IF;

  replayed := platform_private.replay_audit(
    p_request_id,
    'case.curator.set',
    'student_case',
    p_student_case_id,
    btrim(p_reason),
    jsonb_build_object(
      'organization_id', p_organization_id,
      'student_case_id', p_student_case_id,
      'curator_membership_id', p_curator_membership_id
    )
  );
  IF replayed IS NOT NULL THEN
    RETURN replayed;
  END IF;

  SELECT *
  INTO target_case
  FROM platform.student_cases AS student_case
  WHERE student_case.organization_id = p_organization_id
    AND student_case.id = p_student_case_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Student case is unavailable'
      USING ERRCODE = '42501';
  END IF;

  replayed := platform_private.replay_audit(
    p_request_id,
    'case.curator.set',
    'student_case',
    p_student_case_id,
    btrim(p_reason),
    jsonb_build_object(
      'organization_id', p_organization_id,
      'student_case_id', p_student_case_id,
      'curator_membership_id', p_curator_membership_id
    )
  );
  IF replayed IS NOT NULL THEN
    RETURN replayed;
  END IF;

  SELECT profile.id
  INTO new_curator_profile_id
  FROM platform.organization_memberships AS membership
  JOIN platform.profiles AS profile
    ON profile.id = membership.profile_id
  JOIN platform.role_bundle_versions AS bundle
    ON bundle.id = membership.current_bundle_id
    AND bundle.role = membership."current_role"
  WHERE membership.organization_id = p_organization_id
    AND membership.id = p_curator_membership_id
    AND membership.status = 'active'
    AND membership."current_role" = 'curator'
    AND profile.status = 'active'
    AND bundle.status = 'published'
  FOR UPDATE OF membership, profile;

  IF new_curator_profile_id IS NULL THEN
    RAISE EXCEPTION
      'Live Curator membership is required'
      USING ERRCODE = '22023';
  END IF;

  previous_curator_id := target_case.current_curator_membership_id;
  IF previous_curator_id = p_curator_membership_id THEN
    RAISE EXCEPTION
      'Student case already has this Curator'
      USING ERRCODE = '22023';
  END IF;

  IF target_case.state = 'pending' THEN
    assignment_kind := 'assigned';
  ELSIF target_case.state IN ('active', 'closed')
    AND previous_curator_id IS NOT NULL
  THEN
    assignment_kind := 'reassigned';
  ELSE
    RAISE EXCEPTION
      'Student case is not assignable'
      USING ERRCODE = '55000';
  END IF;

  SELECT *
  INTO previous_scope
  FROM platform.record_scopes AS scope
  WHERE scope.organization_id = p_organization_id
    AND scope.id = target_case.current_scope_id
    AND scope.scope_version = target_case.current_scope_version
    AND scope.scope_kind = 'student_case'
    AND scope.scope_key = p_student_case_id
    AND scope.is_active
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Active student-case scope is unavailable'
      USING ERRCODE = '55000';
  END IF;

  new_scope_version := previous_scope.scope_version + 1;

  UPDATE platform.record_scopes AS scope
  SET is_active = FALSE
  WHERE scope.id = previous_scope.id;

  INSERT INTO platform.record_scopes (
    id,
    organization_id,
    scope_kind,
    scope_key,
    scope_version,
    is_active
  )
  VALUES (
    new_scope_id,
    p_organization_id,
    'student_case',
    p_student_case_id,
    new_scope_version,
    TRUE
  );

  IF assignment_kind = 'assigned' THEN
    PERFORM platform_private.append_scope_event(
      p_organization_id,
      target_case.responsible_sales_membership_id,
      previous_scope.id,
      previous_scope.scope_version,
      FALSE,
      'user',
      actor.actor_profile_id,
      btrim(p_reason),
      p_request_id
    );
  ELSE
    PERFORM platform_private.append_scope_event(
      p_organization_id,
      previous_curator_id,
      previous_scope.id,
      previous_scope.scope_version,
      FALSE,
      'user',
      actor.actor_profile_id,
      btrim(p_reason),
      p_request_id
    );
    PERFORM platform_private.append_scope_event(
      p_organization_id,
      target_case.student_membership_id,
      previous_scope.id,
      previous_scope.scope_version,
      FALSE,
      'user',
      actor.actor_profile_id,
      btrim(p_reason),
      p_request_id
    );
  END IF;

  PERFORM platform_private.append_scope_event(
    p_organization_id,
    p_curator_membership_id,
    new_scope_id,
    new_scope_version,
    TRUE,
    'user',
    actor.actor_profile_id,
    btrim(p_reason),
    p_request_id
  );
  PERFORM platform_private.append_scope_event(
    p_organization_id,
    target_case.student_membership_id,
    new_scope_id,
    new_scope_version,
    TRUE,
    'user',
    actor.actor_profile_id,
    btrim(p_reason),
    p_request_id
  );

  UPDATE platform.student_cases AS student_case
  SET
    current_curator_membership_id = p_curator_membership_id,
    state = CASE
      WHEN target_case.state = 'pending' THEN 'active'::platform.student_case_state
      ELSE target_case.state
    END,
    handoff_at = COALESCE(target_case.handoff_at, occurred_at),
    portal_activated_at =
      COALESCE(target_case.portal_activated_at, occurred_at),
    current_scope_id = new_scope_id,
    current_scope_version = new_scope_version
  WHERE student_case.organization_id = p_organization_id
    AND student_case.id = p_student_case_id;

  INSERT INTO platform.student_case_assignment_events (
    organization_id,
    student_case_id,
    event_type,
    previous_curator_membership_id,
    new_curator_membership_id,
    previous_scope_id,
    previous_scope_version,
    new_scope_id,
    new_scope_version,
    actor_membership_id,
    reason,
    request_id
  )
  VALUES (
    p_organization_id,
    p_student_case_id,
    assignment_kind,
    previous_curator_id,
    p_curator_membership_id,
    previous_scope.id,
    previous_scope.scope_version,
    new_scope_id,
    new_scope_version,
    actor.actor_membership_id,
    btrim(p_reason),
    p_request_id
  );

  IF assignment_kind = 'assigned' THEN
    INSERT INTO platform.student_case_lifecycle_events (
      organization_id,
      student_case_id,
      event_type,
      previous_state,
      new_state,
      actor_membership_id,
      reason,
      request_id
    )
    VALUES (
      p_organization_id,
      p_student_case_id,
      'activated',
      'pending',
      'active',
      actor.actor_membership_id,
      btrim(p_reason),
      p_request_id
    );
  END IF;

  FOR affected_profile_id IN
    SELECT DISTINCT membership.profile_id
    FROM platform.organization_memberships AS membership
    WHERE membership.organization_id = p_organization_id
      AND membership.id = ANY (
        CASE
          WHEN assignment_kind = 'assigned' THEN ARRAY[
            target_case.responsible_sales_membership_id,
            target_case.student_membership_id,
            p_curator_membership_id
          ]::UUID[]
          ELSE ARRAY[
            previous_curator_id,
            target_case.student_membership_id,
            p_curator_membership_id
          ]::UUID[]
        END
      )
  LOOP
    PERFORM platform_private.bump_access_version(affected_profile_id);
  END LOOP;

  result := jsonb_build_object(
    'organization_id', p_organization_id,
    'student_case_id', p_student_case_id,
    'curator_membership_id', p_curator_membership_id,
    'previous_curator_membership_id', previous_curator_id,
    'assignment_type', assignment_kind,
    'case_state',
      CASE WHEN target_case.state = 'pending' THEN 'active' ELSE target_case.state::TEXT END,
    'scope_id', new_scope_id,
    'scope_version', new_scope_version,
    'handoff_at', COALESCE(target_case.handoff_at, occurred_at),
    'portal_activated_at',
      COALESCE(target_case.portal_activated_at, occurred_at)
  );

  INSERT INTO platform.audit_events (
    organization_id,
    actor_kind,
    actor_profile_id,
    actor_principal,
    action,
    resource_type,
    resource_id,
    before_state,
    after_state,
    reason,
    request_id
  )
  VALUES (
    p_organization_id,
    'user',
    actor.actor_profile_id,
    'auth:' || actor.actor_auth_user_id::TEXT,
    'case.curator.set',
    'student_case',
    p_student_case_id,
    jsonb_build_object(
      'case_state', target_case.state,
      'curator_membership_id', previous_curator_id,
      'scope_id', previous_scope.id,
      'scope_version', previous_scope.scope_version,
      'handoff_at', target_case.handoff_at,
      'portal_activated_at', target_case.portal_activated_at
    ),
    result,
    btrim(p_reason),
    p_request_id
  );

  RETURN result;
END
$$;

CREATE OR REPLACE FUNCTION platform.change_student_case_state(
  p_organization_id UUID,
  p_student_case_id UUID,
  p_new_state platform.student_case_state,
  p_reason TEXT,
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
  target_case platform.student_cases%ROWTYPE;
  replayed JSONB;
  event_name TEXT;
  result JSONB;
BEGIN
  PERFORM platform_private.lock_p2d_request(p_request_id);

  IF p_reason IS NULL
    OR char_length(btrim(p_reason)) NOT BETWEEN 1 AND 1000
  THEN
    RAISE EXCEPTION
      'Lifecycle reason of 1 to 1000 characters is required'
      USING ERRCODE = '22023';
  END IF;

  SELECT *
  INTO actor
  FROM platform_private.require_case_operator(
    p_organization_id,
    p_student_case_id,
    'case.lifecycle.change'
  );

  replayed := platform_private.replay_audit(
    p_request_id,
    'case.lifecycle.change',
    'student_case',
    p_student_case_id,
    btrim(p_reason),
    jsonb_build_object(
      'organization_id', p_organization_id,
      'student_case_id', p_student_case_id,
      'case_state', p_new_state
    )
  );
  IF replayed IS NOT NULL THEN
    RETURN replayed;
  END IF;

  SELECT *
  INTO target_case
  FROM platform.student_cases AS student_case
  WHERE student_case.organization_id = p_organization_id
    AND student_case.id = p_student_case_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Student case is unavailable'
      USING ERRCODE = '42501';
  END IF;

  SELECT *
  INTO actor
  FROM platform_private.require_case_operator(
    p_organization_id,
    p_student_case_id,
    'case.lifecycle.change'
  );

  replayed := platform_private.replay_audit(
    p_request_id,
    'case.lifecycle.change',
    'student_case',
    p_student_case_id,
    btrim(p_reason),
    jsonb_build_object(
      'organization_id', p_organization_id,
      'student_case_id', p_student_case_id,
      'case_state', p_new_state
    )
  );
  IF replayed IS NOT NULL THEN
    RETURN replayed;
  END IF;

  IF target_case.state = 'active' AND p_new_state = 'closed' THEN
    event_name := 'closed';
  ELSIF target_case.state = 'closed' AND p_new_state = 'active' THEN
    event_name := 'reopened';
  ELSE
    RAISE EXCEPTION
      'Only active-to-closed or closed-to-active is permitted'
      USING ERRCODE = '55000';
  END IF;

  UPDATE platform.student_cases AS student_case
  SET
    state = p_new_state,
    closed_at = CASE
      WHEN p_new_state = 'closed' THEN statement_timestamp()
      ELSE NULL
    END
  WHERE student_case.organization_id = p_organization_id
    AND student_case.id = p_student_case_id;

  INSERT INTO platform.student_case_lifecycle_events (
    organization_id,
    student_case_id,
    event_type,
    previous_state,
    new_state,
    actor_membership_id,
    reason,
    request_id
  )
  VALUES (
    p_organization_id,
    p_student_case_id,
    event_name,
    target_case.state,
    p_new_state,
    actor.actor_membership_id,
    btrim(p_reason),
    p_request_id
  );

  result := jsonb_build_object(
    'organization_id', p_organization_id,
    'student_case_id', p_student_case_id,
    'case_state', p_new_state,
    'event_type', event_name,
    'closed_at',
      CASE WHEN p_new_state = 'closed' THEN statement_timestamp() ELSE NULL END,
    'portal_activated_at', target_case.portal_activated_at,
    'handoff_at', target_case.handoff_at
  );

  INSERT INTO platform.audit_events (
    organization_id,
    actor_kind,
    actor_profile_id,
    actor_principal,
    action,
    resource_type,
    resource_id,
    before_state,
    after_state,
    reason,
    request_id
  )
  VALUES (
    p_organization_id,
    'user',
    actor.actor_profile_id,
    'auth:' || actor.actor_auth_user_id::TEXT,
    'case.lifecycle.change',
    'student_case',
    p_student_case_id,
    jsonb_build_object(
      'case_state', target_case.state,
      'closed_at', target_case.closed_at
    ),
    result,
    btrim(p_reason),
    p_request_id
  );

  RETURN result;
END
$$;

CREATE OR REPLACE FUNCTION platform.set_student_case_route(
  p_organization_id UUID,
  p_student_case_id UUID,
  p_target_country TEXT,
  p_target_degree TEXT,
  p_program_direction TEXT,
  p_intake TEXT,
  p_language_assumption TEXT,
  p_funding_assumption TEXT,
  p_route_approval_status platform.route_approval_status,
  p_operational_stage TEXT,
  p_next_action TEXT,
  p_reason TEXT,
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
  target_case platform.student_cases%ROWTYPE;
  replayed JSONB;
  result JSONB;
BEGIN
  PERFORM platform_private.lock_p2d_request(p_request_id);

  IF p_target_country IS NULL
    OR btrim(p_target_country) = ''
    OR p_target_degree IS NULL
    OR btrim(p_target_degree) = ''
    OR p_operational_stage IS NULL
    OR btrim(p_operational_stage) = ''
    OR p_reason IS NULL
    OR char_length(btrim(p_reason)) NOT BETWEEN 1 AND 1000
  THEN
    RAISE EXCEPTION
      'Route fields and reason are required'
      USING ERRCODE = '22023';
  END IF;

  SELECT *
  INTO actor
  FROM platform_private.require_case_operator(
    p_organization_id,
    p_student_case_id,
    'case.route.manage'
  );

  replayed := platform_private.replay_audit(
    p_request_id,
    'case.route.change',
    'student_case',
    p_student_case_id,
    btrim(p_reason),
    jsonb_build_object(
      'organization_id', p_organization_id,
      'student_case_id', p_student_case_id,
      'target_country', btrim(p_target_country),
      'target_degree', btrim(p_target_degree),
      'program_direction', NULLIF(btrim(p_program_direction), ''),
      'intake', NULLIF(btrim(p_intake), ''),
      'language_assumption', NULLIF(btrim(p_language_assumption), ''),
      'funding_assumption', NULLIF(btrim(p_funding_assumption), ''),
      'route_approval_status', p_route_approval_status,
      'operational_stage', btrim(p_operational_stage),
      'next_action', NULLIF(btrim(p_next_action), '')
    )
  );
  IF replayed IS NOT NULL THEN
    RETURN replayed;
  END IF;

  SELECT *
  INTO target_case
  FROM platform.student_cases AS student_case
  WHERE student_case.organization_id = p_organization_id
    AND student_case.id = p_student_case_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Student case is unavailable'
      USING ERRCODE = '42501';
  END IF;

  SELECT *
  INTO actor
  FROM platform_private.require_case_operator(
    p_organization_id,
    p_student_case_id,
    'case.route.manage'
  );

  replayed := platform_private.replay_audit(
    p_request_id,
    'case.route.change',
    'student_case',
    p_student_case_id,
    btrim(p_reason),
    jsonb_build_object(
      'organization_id', p_organization_id,
      'student_case_id', p_student_case_id,
      'target_country', btrim(p_target_country),
      'target_degree', btrim(p_target_degree),
      'program_direction', NULLIF(btrim(p_program_direction), ''),
      'intake', NULLIF(btrim(p_intake), ''),
      'language_assumption', NULLIF(btrim(p_language_assumption), ''),
      'funding_assumption', NULLIF(btrim(p_funding_assumption), ''),
      'route_approval_status', p_route_approval_status,
      'operational_stage', btrim(p_operational_stage),
      'next_action', NULLIF(btrim(p_next_action), '')
    )
  );
  IF replayed IS NOT NULL THEN
    RETURN replayed;
  END IF;

  UPDATE platform.student_cases AS student_case
  SET
    target_country = btrim(p_target_country),
    target_degree = btrim(p_target_degree),
    program_direction = NULLIF(btrim(p_program_direction), ''),
    intake = NULLIF(btrim(p_intake), ''),
    language_assumption = NULLIF(btrim(p_language_assumption), ''),
    funding_assumption = NULLIF(btrim(p_funding_assumption), ''),
    route_approval_status = p_route_approval_status,
    operational_stage = btrim(p_operational_stage),
    next_action = NULLIF(btrim(p_next_action), '')
  WHERE student_case.organization_id = p_organization_id
    AND student_case.id = p_student_case_id;

  result := jsonb_build_object(
    'organization_id', p_organization_id,
    'student_case_id', p_student_case_id,
    'target_country', btrim(p_target_country),
    'target_degree', btrim(p_target_degree),
    'program_direction', NULLIF(btrim(p_program_direction), ''),
    'intake', NULLIF(btrim(p_intake), ''),
    'language_assumption', NULLIF(btrim(p_language_assumption), ''),
    'funding_assumption', NULLIF(btrim(p_funding_assumption), ''),
    'route_approval_status', p_route_approval_status,
    'operational_stage', btrim(p_operational_stage),
    'next_action', NULLIF(btrim(p_next_action), '')
  );

  INSERT INTO platform.audit_events (
    organization_id,
    actor_kind,
    actor_profile_id,
    actor_principal,
    action,
    resource_type,
    resource_id,
    before_state,
    after_state,
    reason,
    request_id
  )
  VALUES (
    p_organization_id,
    'user',
    actor.actor_profile_id,
    'auth:' || actor.actor_auth_user_id::TEXT,
    'case.route.change',
    'student_case',
    p_student_case_id,
    jsonb_build_object(
      'target_country', target_case.target_country,
      'target_degree', target_case.target_degree,
      'program_direction', target_case.program_direction,
      'intake', target_case.intake,
      'language_assumption', target_case.language_assumption,
      'funding_assumption', target_case.funding_assumption,
      'route_approval_status', target_case.route_approval_status,
      'operational_stage', target_case.operational_stage,
      'next_action', target_case.next_action
    ),
    result,
    btrim(p_reason),
    p_request_id
  );

  RETURN result;
END
$$;

CREATE OR REPLACE FUNCTION platform_private.application_status_needs_evidence(
  p_status platform.application_status
)
RETURNS BOOLEAN
LANGUAGE SQL
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT p_status IN (
    'submitted',
    'under_review',
    'offer',
    'rejected',
    'enrolled'
  )
$$;

REVOKE ALL ON FUNCTION platform_private.application_status_needs_evidence(
  platform.application_status
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

CREATE OR REPLACE FUNCTION platform_private.visa_status_needs_evidence(
  p_status platform.visa_status
)
RETURNS BOOLEAN
LANGUAGE SQL
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT p_status IN ('approved', 'rejected')
$$;

REVOKE ALL ON FUNCTION platform_private.visa_status_needs_evidence(
  platform.visa_status
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

CREATE OR REPLACE FUNCTION platform.append_student_case_update(
  p_organization_id UUID,
  p_student_case_id UUID,
  p_body TEXT,
  p_source TEXT,
  p_student_visible BOOLEAN,
  p_occurred_at TIMESTAMPTZ,
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
  target_case platform.student_cases%ROWTYPE;
  replayed JSONB;
  created_update_id UUID := gen_random_uuid();
  result JSONB;
  fixed_reason CONSTANT TEXT := 'Student case update appended';
BEGIN
  PERFORM platform_private.lock_p2d_request(p_request_id);

  IF p_body IS NULL
    OR btrim(p_body) = ''
    OR p_source IS NULL
    OR btrim(p_source) = ''
    OR p_occurred_at IS NULL
    OR p_student_visible IS NULL
  THEN
    RAISE EXCEPTION
      'Update body, source, visibility and occurred_at are required'
      USING ERRCODE = '22023';
  END IF;

  SELECT *
  INTO actor
  FROM platform_private.require_case_operator(
    p_organization_id,
    p_student_case_id,
    'case.update.append'
  );

  replayed := platform_private.replay_audit(
    p_request_id,
    'case.update.append',
    'student_case_update',
    NULL,
    fixed_reason,
    jsonb_build_object(
      'organization_id', p_organization_id,
      'student_case_id', p_student_case_id,
      'body', btrim(p_body),
      'source', btrim(p_source),
      'student_visible', p_student_visible,
      'occurred_at', p_occurred_at
    )
  );
  IF replayed IS NOT NULL THEN
    RETURN replayed;
  END IF;

  SELECT *
  INTO target_case
  FROM platform.student_cases AS student_case
  WHERE student_case.organization_id = p_organization_id
    AND student_case.id = p_student_case_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Student case is unavailable'
      USING ERRCODE = '42501';
  END IF;

  SELECT *
  INTO actor
  FROM platform_private.require_case_operator(
    p_organization_id,
    p_student_case_id,
    'case.update.append'
  );

  replayed := platform_private.replay_audit(
    p_request_id,
    'case.update.append',
    'student_case_update',
    NULL,
    fixed_reason,
    jsonb_build_object(
      'organization_id', p_organization_id,
      'student_case_id', p_student_case_id,
      'body', btrim(p_body),
      'source', btrim(p_source),
      'student_visible', p_student_visible,
      'occurred_at', p_occurred_at
    )
  );
  IF replayed IS NOT NULL THEN
    RETURN replayed;
  END IF;

  INSERT INTO platform.student_case_updates (
    id,
    organization_id,
    student_case_id,
    author_membership_id,
    source,
    body,
    student_visible,
    occurred_at,
    request_id
  )
  VALUES (
    created_update_id,
    p_organization_id,
    p_student_case_id,
    actor.actor_membership_id,
    btrim(p_source),
    btrim(p_body),
    p_student_visible,
    p_occurred_at,
    p_request_id
  );

  result := jsonb_build_object(
    'organization_id', p_organization_id,
    'student_case_update_id', created_update_id,
    'student_case_id', p_student_case_id,
    'author_membership_id', actor.actor_membership_id,
    'body', btrim(p_body),
    'source', btrim(p_source),
    'student_visible', p_student_visible,
    'occurred_at', p_occurred_at
  );

  INSERT INTO platform.audit_events (
    organization_id,
    actor_kind,
    actor_profile_id,
    actor_principal,
    action,
    resource_type,
    resource_id,
    before_state,
    after_state,
    reason,
    request_id
  )
  VALUES (
    p_organization_id,
    'user',
    actor.actor_profile_id,
    'auth:' || actor.actor_auth_user_id::TEXT,
    'case.update.append',
    'student_case_update',
    created_update_id,
    NULL,
    result,
    fixed_reason,
    p_request_id
  );

  RETURN result;
END
$$;

CREATE OR REPLACE FUNCTION platform.create_university_application(
  p_organization_id UUID,
  p_student_case_id UUID,
  p_institution_name TEXT,
  p_program_name TEXT,
  p_status platform.application_status,
  p_evidence_reference TEXT,
  p_note TEXT,
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
  target_case platform.student_cases%ROWTYPE;
  replayed JSONB;
  created_application_id UUID := gen_random_uuid();
  result JSONB;
  fixed_reason CONSTANT TEXT := 'University application created';
BEGIN
  PERFORM platform_private.lock_p2d_request(p_request_id);

  IF p_institution_name IS NULL
    OR btrim(p_institution_name) = ''
    OR p_program_name IS NULL
    OR btrim(p_program_name) = ''
    OR p_status IS NULL
    OR (
      platform_private.application_status_needs_evidence(p_status)
      AND (
        p_evidence_reference IS NULL
        OR btrim(p_evidence_reference) = ''
      )
    )
  THEN
    RAISE EXCEPTION
      'Application fields and required external-status evidence are required'
      USING ERRCODE = '22023';
  END IF;

  SELECT *
  INTO actor
  FROM platform_private.require_case_operator(
    p_organization_id,
    p_student_case_id,
    'application.manage'
  );

  replayed := platform_private.replay_audit(
    p_request_id,
    'application.create',
    'university_application',
    NULL,
    fixed_reason,
    jsonb_build_object(
      'organization_id', p_organization_id,
      'student_case_id', p_student_case_id,
      'institution_name', btrim(p_institution_name),
      'program_name', btrim(p_program_name),
      'status', p_status,
      'evidence_reference', NULLIF(btrim(p_evidence_reference), ''),
      'note', NULLIF(btrim(p_note), '')
    )
  );
  IF replayed IS NOT NULL THEN
    RETURN replayed;
  END IF;

  SELECT *
  INTO target_case
  FROM platform.student_cases AS student_case
  WHERE student_case.organization_id = p_organization_id
    AND student_case.id = p_student_case_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Student case is unavailable'
      USING ERRCODE = '42501';
  END IF;

  SELECT *
  INTO actor
  FROM platform_private.require_case_operator(
    p_organization_id,
    p_student_case_id,
    'application.manage'
  );

  replayed := platform_private.replay_audit(
    p_request_id,
    'application.create',
    'university_application',
    NULL,
    fixed_reason,
    jsonb_build_object(
      'organization_id', p_organization_id,
      'student_case_id', p_student_case_id,
      'institution_name', btrim(p_institution_name),
      'program_name', btrim(p_program_name),
      'status', p_status,
      'evidence_reference', NULLIF(btrim(p_evidence_reference), ''),
      'note', NULLIF(btrim(p_note), '')
    )
  );
  IF replayed IS NOT NULL THEN
    RETURN replayed;
  END IF;

  INSERT INTO platform.university_applications (
    id,
    organization_id,
    student_case_id,
    institution_name,
    program_name,
    status,
    latest_evidence_reference,
    created_by_membership_id
  )
  VALUES (
    created_application_id,
    p_organization_id,
    p_student_case_id,
    btrim(p_institution_name),
    btrim(p_program_name),
    p_status,
    NULLIF(btrim(p_evidence_reference), ''),
    actor.actor_membership_id
  );

  INSERT INTO platform.university_application_events (
    organization_id,
    application_id,
    student_case_id,
    previous_status,
    new_status,
    evidence_reference,
    note,
    actor_membership_id,
    request_id
  )
  VALUES (
    p_organization_id,
    created_application_id,
    p_student_case_id,
    NULL,
    p_status,
    NULLIF(btrim(p_evidence_reference), ''),
    NULLIF(btrim(p_note), ''),
    actor.actor_membership_id,
    p_request_id
  );

  result := jsonb_build_object(
    'organization_id', p_organization_id,
    'university_application_id', created_application_id,
    'student_case_id', p_student_case_id,
    'institution_name', btrim(p_institution_name),
    'program_name', btrim(p_program_name),
    'status', p_status,
    'evidence_reference', NULLIF(btrim(p_evidence_reference), ''),
    'note', NULLIF(btrim(p_note), '')
  );

  INSERT INTO platform.audit_events (
    organization_id,
    actor_kind,
    actor_profile_id,
    actor_principal,
    action,
    resource_type,
    resource_id,
    before_state,
    after_state,
    reason,
    request_id
  )
  VALUES (
    p_organization_id,
    'user',
    actor.actor_profile_id,
    'auth:' || actor.actor_auth_user_id::TEXT,
    'application.create',
    'university_application',
    created_application_id,
    NULL,
    result,
    fixed_reason,
    p_request_id
  );

  RETURN result;
END
$$;

CREATE OR REPLACE FUNCTION platform.change_university_application(
  p_organization_id UUID,
  p_application_id UUID,
  p_new_status platform.application_status,
  p_evidence_reference TEXT,
  p_note TEXT,
  p_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  preliminary_actor RECORD;
  actor RECORD;
  application_row platform.university_applications%ROWTYPE;
  replayed JSONB;
  result JSONB;
  fixed_reason CONSTANT TEXT := 'University application status changed';
BEGIN
  PERFORM platform_private.lock_p2d_request(p_request_id);

  IF p_new_status IS NULL
    OR (
      platform_private.application_status_needs_evidence(p_new_status)
      AND (
        p_evidence_reference IS NULL
        OR btrim(p_evidence_reference) = ''
      )
    )
  THEN
    RAISE EXCEPTION
      'Application status and required external-status evidence are required'
      USING ERRCODE = '22023';
  END IF;

  SELECT *
  INTO preliminary_actor
  FROM platform_private.require_domain_actor(
    p_organization_id,
    'application.manage'
  );

  replayed := platform_private.replay_audit(
    p_request_id,
    'application.status.change',
    'university_application',
    p_application_id,
    fixed_reason,
    jsonb_build_object(
      'organization_id', p_organization_id,
      'university_application_id', p_application_id,
      'status', p_new_status,
      'evidence_reference', NULLIF(btrim(p_evidence_reference), ''),
      'note', NULLIF(btrim(p_note), '')
    )
  );
  IF replayed IS NOT NULL THEN
    RETURN replayed;
  END IF;

  SELECT *
  INTO application_row
  FROM platform.university_applications AS application
  WHERE application.organization_id = p_organization_id
    AND application.id = p_application_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'University application is unavailable'
      USING ERRCODE = '42501';
  END IF;

  SELECT *
  INTO actor
  FROM platform_private.require_case_operator(
    p_organization_id,
    application_row.student_case_id,
    'application.manage'
  );

  replayed := platform_private.replay_audit(
    p_request_id,
    'application.status.change',
    'university_application',
    p_application_id,
    fixed_reason,
    jsonb_build_object(
      'organization_id', p_organization_id,
      'university_application_id', p_application_id,
      'status', p_new_status,
      'evidence_reference', NULLIF(btrim(p_evidence_reference), ''),
      'note', NULLIF(btrim(p_note), '')
    )
  );
  IF replayed IS NOT NULL THEN
    RETURN replayed;
  END IF;

  IF application_row.status = p_new_status THEN
    RAISE EXCEPTION
      'Application status must change'
      USING ERRCODE = '22023';
  END IF;

  UPDATE platform.university_applications AS application
  SET
    status = p_new_status,
    latest_evidence_reference = COALESCE(
      NULLIF(btrim(p_evidence_reference), ''),
      application_row.latest_evidence_reference
    )
  WHERE application.organization_id = p_organization_id
    AND application.id = p_application_id;

  INSERT INTO platform.university_application_events (
    organization_id,
    application_id,
    student_case_id,
    previous_status,
    new_status,
    evidence_reference,
    note,
    actor_membership_id,
    request_id
  )
  VALUES (
    p_organization_id,
    p_application_id,
    application_row.student_case_id,
    application_row.status,
    p_new_status,
    NULLIF(btrim(p_evidence_reference), ''),
    NULLIF(btrim(p_note), ''),
    actor.actor_membership_id,
    p_request_id
  );

  result := jsonb_build_object(
    'organization_id', p_organization_id,
    'university_application_id', p_application_id,
    'student_case_id', application_row.student_case_id,
    'status', p_new_status,
    'evidence_reference', NULLIF(btrim(p_evidence_reference), ''),
    'note', NULLIF(btrim(p_note), '')
  );

  INSERT INTO platform.audit_events (
    organization_id,
    actor_kind,
    actor_profile_id,
    actor_principal,
    action,
    resource_type,
    resource_id,
    before_state,
    after_state,
    reason,
    request_id
  )
  VALUES (
    p_organization_id,
    'user',
    actor.actor_profile_id,
    'auth:' || actor.actor_auth_user_id::TEXT,
    'application.status.change',
    'university_application',
    p_application_id,
    jsonb_build_object(
      'status', application_row.status,
      'evidence_reference', application_row.latest_evidence_reference
    ),
    result,
    fixed_reason,
    p_request_id
  );

  RETURN result;
END
$$;

CREATE OR REPLACE FUNCTION platform.create_visa_case(
  p_organization_id UUID,
  p_student_case_id UUID,
  p_status platform.visa_status,
  p_evidence_reference TEXT,
  p_note TEXT,
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
  target_case platform.student_cases%ROWTYPE;
  replayed JSONB;
  created_visa_case_id UUID := gen_random_uuid();
  result JSONB;
  fixed_reason CONSTANT TEXT := 'Visa case created';
BEGIN
  PERFORM platform_private.lock_p2d_request(p_request_id);

  IF p_status IS NULL
    OR (
      platform_private.visa_status_needs_evidence(p_status)
      AND (
        p_evidence_reference IS NULL
        OR btrim(p_evidence_reference) = ''
      )
    )
  THEN
    RAISE EXCEPTION
      'Visa status and required external-decision evidence are required'
      USING ERRCODE = '22023';
  END IF;

  SELECT *
  INTO actor
  FROM platform_private.require_case_operator(
    p_organization_id,
    p_student_case_id,
    'visa.manage'
  );

  replayed := platform_private.replay_audit(
    p_request_id,
    'visa.create',
    'visa_case',
    NULL,
    fixed_reason,
    jsonb_build_object(
      'organization_id', p_organization_id,
      'student_case_id', p_student_case_id,
      'status', p_status,
      'evidence_reference', NULLIF(btrim(p_evidence_reference), ''),
      'note', NULLIF(btrim(p_note), '')
    )
  );
  IF replayed IS NOT NULL THEN
    RETURN replayed;
  END IF;

  SELECT *
  INTO target_case
  FROM platform.student_cases AS student_case
  WHERE student_case.organization_id = p_organization_id
    AND student_case.id = p_student_case_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Student case is unavailable'
      USING ERRCODE = '42501';
  END IF;

  SELECT *
  INTO actor
  FROM platform_private.require_case_operator(
    p_organization_id,
    p_student_case_id,
    'visa.manage'
  );

  replayed := platform_private.replay_audit(
    p_request_id,
    'visa.create',
    'visa_case',
    NULL,
    fixed_reason,
    jsonb_build_object(
      'organization_id', p_organization_id,
      'student_case_id', p_student_case_id,
      'status', p_status,
      'evidence_reference', NULLIF(btrim(p_evidence_reference), ''),
      'note', NULLIF(btrim(p_note), '')
    )
  );
  IF replayed IS NOT NULL THEN
    RETURN replayed;
  END IF;

  INSERT INTO platform.visa_cases (
    id,
    organization_id,
    student_case_id,
    status,
    latest_evidence_reference,
    created_by_membership_id
  )
  VALUES (
    created_visa_case_id,
    p_organization_id,
    p_student_case_id,
    p_status,
    NULLIF(btrim(p_evidence_reference), ''),
    actor.actor_membership_id
  );

  INSERT INTO platform.visa_case_events (
    organization_id,
    visa_case_id,
    student_case_id,
    previous_status,
    new_status,
    evidence_reference,
    note,
    actor_membership_id,
    request_id
  )
  VALUES (
    p_organization_id,
    created_visa_case_id,
    p_student_case_id,
    NULL,
    p_status,
    NULLIF(btrim(p_evidence_reference), ''),
    NULLIF(btrim(p_note), ''),
    actor.actor_membership_id,
    p_request_id
  );

  result := jsonb_build_object(
    'organization_id', p_organization_id,
    'visa_case_id', created_visa_case_id,
    'student_case_id', p_student_case_id,
    'status', p_status,
    'evidence_reference', NULLIF(btrim(p_evidence_reference), ''),
    'note', NULLIF(btrim(p_note), '')
  );

  INSERT INTO platform.audit_events (
    organization_id,
    actor_kind,
    actor_profile_id,
    actor_principal,
    action,
    resource_type,
    resource_id,
    before_state,
    after_state,
    reason,
    request_id
  )
  VALUES (
    p_organization_id,
    'user',
    actor.actor_profile_id,
    'auth:' || actor.actor_auth_user_id::TEXT,
    'visa.create',
    'visa_case',
    created_visa_case_id,
    NULL,
    result,
    fixed_reason,
    p_request_id
  );

  RETURN result;
END
$$;

CREATE OR REPLACE FUNCTION platform.change_visa_case(
  p_organization_id UUID,
  p_visa_case_id UUID,
  p_new_status platform.visa_status,
  p_evidence_reference TEXT,
  p_note TEXT,
  p_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  preliminary_actor RECORD;
  actor RECORD;
  visa_row platform.visa_cases%ROWTYPE;
  replayed JSONB;
  result JSONB;
  fixed_reason CONSTANT TEXT := 'Visa status changed';
BEGIN
  PERFORM platform_private.lock_p2d_request(p_request_id);

  IF p_new_status IS NULL
    OR (
      platform_private.visa_status_needs_evidence(p_new_status)
      AND (
        p_evidence_reference IS NULL
        OR btrim(p_evidence_reference) = ''
      )
    )
  THEN
    RAISE EXCEPTION
      'Visa status and required external-decision evidence are required'
      USING ERRCODE = '22023';
  END IF;

  SELECT *
  INTO preliminary_actor
  FROM platform_private.require_domain_actor(
    p_organization_id,
    'visa.manage'
  );

  replayed := platform_private.replay_audit(
    p_request_id,
    'visa.status.change',
    'visa_case',
    p_visa_case_id,
    fixed_reason,
    jsonb_build_object(
      'organization_id', p_organization_id,
      'visa_case_id', p_visa_case_id,
      'status', p_new_status,
      'evidence_reference', NULLIF(btrim(p_evidence_reference), ''),
      'note', NULLIF(btrim(p_note), '')
    )
  );
  IF replayed IS NOT NULL THEN
    RETURN replayed;
  END IF;

  SELECT *
  INTO visa_row
  FROM platform.visa_cases AS visa
  WHERE visa.organization_id = p_organization_id
    AND visa.id = p_visa_case_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Visa case is unavailable'
      USING ERRCODE = '42501';
  END IF;

  SELECT *
  INTO actor
  FROM platform_private.require_case_operator(
    p_organization_id,
    visa_row.student_case_id,
    'visa.manage'
  );

  replayed := platform_private.replay_audit(
    p_request_id,
    'visa.status.change',
    'visa_case',
    p_visa_case_id,
    fixed_reason,
    jsonb_build_object(
      'organization_id', p_organization_id,
      'visa_case_id', p_visa_case_id,
      'status', p_new_status,
      'evidence_reference', NULLIF(btrim(p_evidence_reference), ''),
      'note', NULLIF(btrim(p_note), '')
    )
  );
  IF replayed IS NOT NULL THEN
    RETURN replayed;
  END IF;

  IF visa_row.status = p_new_status THEN
    RAISE EXCEPTION
      'Visa status must change'
      USING ERRCODE = '22023';
  END IF;

  UPDATE platform.visa_cases AS visa
  SET
    status = p_new_status,
    latest_evidence_reference = COALESCE(
      NULLIF(btrim(p_evidence_reference), ''),
      visa_row.latest_evidence_reference
    )
  WHERE visa.organization_id = p_organization_id
    AND visa.id = p_visa_case_id;

  INSERT INTO platform.visa_case_events (
    organization_id,
    visa_case_id,
    student_case_id,
    previous_status,
    new_status,
    evidence_reference,
    note,
    actor_membership_id,
    request_id
  )
  VALUES (
    p_organization_id,
    p_visa_case_id,
    visa_row.student_case_id,
    visa_row.status,
    p_new_status,
    NULLIF(btrim(p_evidence_reference), ''),
    NULLIF(btrim(p_note), ''),
    actor.actor_membership_id,
    p_request_id
  );

  result := jsonb_build_object(
    'organization_id', p_organization_id,
    'visa_case_id', p_visa_case_id,
    'student_case_id', visa_row.student_case_id,
    'status', p_new_status,
    'evidence_reference', NULLIF(btrim(p_evidence_reference), ''),
    'note', NULLIF(btrim(p_note), '')
  );

  INSERT INTO platform.audit_events (
    organization_id,
    actor_kind,
    actor_profile_id,
    actor_principal,
    action,
    resource_type,
    resource_id,
    before_state,
    after_state,
    reason,
    request_id
  )
  VALUES (
    p_organization_id,
    'user',
    actor.actor_profile_id,
    'auth:' || actor.actor_auth_user_id::TEXT,
    'visa.status.change',
    'visa_case',
    p_visa_case_id,
    jsonb_build_object(
      'status', visa_row.status,
      'evidence_reference', visa_row.latest_evidence_reference
    ),
    result,
    fixed_reason,
    p_request_id
  );

  RETURN result;
END
$$;

CREATE OR REPLACE FUNCTION platform_private.require_live_task_assignee(
  p_organization_id UUID,
  p_membership_id UUID
)
RETURNS TABLE (
  assignee_profile_id UUID,
  assignee_role platform.business_role
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN QUERY
  SELECT
    profile.id,
    membership."current_role"
  FROM platform.organization_memberships AS membership
  JOIN platform.profiles AS profile
    ON profile.id = membership.profile_id
  JOIN platform.organizations AS organization
    ON organization.id = membership.organization_id
  JOIN platform.role_bundle_versions AS bundle
    ON bundle.id = membership.current_bundle_id
    AND bundle.role = membership."current_role"
  WHERE membership.organization_id = p_organization_id
    AND membership.id = p_membership_id
    AND membership.status = 'active'
    AND membership."current_role" IN ('admin', 'sales', 'curator')
    AND profile.status = 'active'
    AND organization.status = 'active'
    AND bundle.status = 'published'
  FOR UPDATE OF membership, profile, organization;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Live Admin, Sales or Curator task assignee is required'
      USING ERRCODE = '22023';
  END IF;
END
$$;

REVOKE ALL ON FUNCTION platform_private.require_live_task_assignee(UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

CREATE OR REPLACE FUNCTION platform.create_case_task(
  p_organization_id UUID,
  p_student_case_id UUID,
  p_task_type TEXT,
  p_title TEXT,
  p_assignee_membership_id UUID,
  p_priority platform.case_task_priority,
  p_due_at TIMESTAMPTZ,
  p_status platform.case_task_status,
  p_student_visible BOOLEAN,
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
  target_case platform.student_cases%ROWTYPE;
  assignee RECORD;
  replayed JSONB;
  created_task_id UUID := gen_random_uuid();
  result JSONB;
  fixed_reason CONSTANT TEXT := 'Student case task created';
BEGIN
  PERFORM platform_private.lock_p2d_request(p_request_id);

  IF p_task_type IS NULL
    OR btrim(p_task_type) = ''
    OR p_title IS NULL
    OR btrim(p_title) = ''
    OR p_assignee_membership_id IS NULL
    OR p_priority IS NULL
    OR p_status IS NULL
    OR p_student_visible IS NULL
  THEN
    RAISE EXCEPTION
      'Task type, title, assignee, priority, status and visibility are required'
      USING ERRCODE = '22023';
  END IF;

  SELECT *
  INTO actor
  FROM platform_private.require_case_operator(
    p_organization_id,
    p_student_case_id,
    'task.manage'
  );

  replayed := platform_private.replay_audit(
    p_request_id,
    'task.create',
    'case_task',
    NULL,
    fixed_reason,
    jsonb_build_object(
      'organization_id', p_organization_id,
      'student_case_id', p_student_case_id,
      'task_type', btrim(p_task_type),
      'title', btrim(p_title),
      'assignee_membership_id', p_assignee_membership_id,
      'priority', p_priority,
      'due_at', p_due_at,
      'status', p_status,
      'student_visible', p_student_visible
    )
  );
  IF replayed IS NOT NULL THEN
    RETURN replayed;
  END IF;

  SELECT *
  INTO target_case
  FROM platform.student_cases AS student_case
  WHERE student_case.organization_id = p_organization_id
    AND student_case.id = p_student_case_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Student case is unavailable'
      USING ERRCODE = '42501';
  END IF;

  SELECT *
  INTO actor
  FROM platform_private.require_case_operator(
    p_organization_id,
    p_student_case_id,
    'task.manage'
  );

  SELECT *
  INTO assignee
  FROM platform_private.require_live_task_assignee(
    p_organization_id,
    p_assignee_membership_id
  );

  IF actor.actor_role <> 'admin'
    AND p_assignee_membership_id <> actor.actor_membership_id
  THEN
    RAISE EXCEPTION
      'Non-Admin case owner may assign a task only to self'
      USING ERRCODE = '42501';
  END IF;

  replayed := platform_private.replay_audit(
    p_request_id,
    'task.create',
    'case_task',
    NULL,
    fixed_reason,
    jsonb_build_object(
      'organization_id', p_organization_id,
      'student_case_id', p_student_case_id,
      'task_type', btrim(p_task_type),
      'title', btrim(p_title),
      'assignee_membership_id', p_assignee_membership_id,
      'priority', p_priority,
      'due_at', p_due_at,
      'status', p_status,
      'student_visible', p_student_visible
    )
  );
  IF replayed IS NOT NULL THEN
    RETURN replayed;
  END IF;

  INSERT INTO platform.case_tasks (
    id,
    organization_id,
    student_case_id,
    task_type,
    title,
    assignee_membership_id,
    priority,
    due_at,
    status,
    student_visible,
    created_by_membership_id
  )
  VALUES (
    created_task_id,
    p_organization_id,
    p_student_case_id,
    btrim(p_task_type),
    btrim(p_title),
    p_assignee_membership_id,
    p_priority,
    p_due_at,
    p_status,
    p_student_visible,
    actor.actor_membership_id
  );

  INSERT INTO platform.case_task_events (
    organization_id,
    case_task_id,
    student_case_id,
    previous_status,
    new_status,
    previous_assignee_membership_id,
    new_assignee_membership_id,
    actor_membership_id,
    request_id
  )
  VALUES (
    p_organization_id,
    created_task_id,
    p_student_case_id,
    NULL,
    p_status,
    NULL,
    p_assignee_membership_id,
    actor.actor_membership_id,
    p_request_id
  );

  result := jsonb_build_object(
    'organization_id', p_organization_id,
    'case_task_id', created_task_id,
    'student_case_id', p_student_case_id,
    'task_type', btrim(p_task_type),
    'title', btrim(p_title),
    'assignee_membership_id', p_assignee_membership_id,
    'priority', p_priority,
    'due_at', p_due_at,
    'status', p_status,
    'student_visible', p_student_visible
  );

  INSERT INTO platform.audit_events (
    organization_id,
    actor_kind,
    actor_profile_id,
    actor_principal,
    action,
    resource_type,
    resource_id,
    before_state,
    after_state,
    reason,
    request_id
  )
  VALUES (
    p_organization_id,
    'user',
    actor.actor_profile_id,
    'auth:' || actor.actor_auth_user_id::TEXT,
    'task.create',
    'case_task',
    created_task_id,
    NULL,
    result,
    fixed_reason,
    p_request_id
  );

  RETURN result;
END
$$;

CREATE OR REPLACE FUNCTION platform.change_case_task(
  p_organization_id UUID,
  p_case_task_id UUID,
  p_new_status platform.case_task_status,
  p_new_assignee_membership_id UUID,
  p_priority platform.case_task_priority,
  p_due_at TIMESTAMPTZ,
  p_student_visible BOOLEAN,
  p_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  preliminary_actor RECORD;
  actor RECORD;
  task_row platform.case_tasks%ROWTYPE;
  assignee RECORD;
  replayed JSONB;
  result JSONB;
  fixed_reason CONSTANT TEXT := 'Student case task changed';
BEGIN
  PERFORM platform_private.lock_p2d_request(p_request_id);

  IF p_new_status IS NULL
    OR p_new_assignee_membership_id IS NULL
    OR p_priority IS NULL
    OR p_student_visible IS NULL
  THEN
    RAISE EXCEPTION
      'Task status, assignee, priority and visibility are required'
      USING ERRCODE = '22023';
  END IF;

  SELECT *
  INTO preliminary_actor
  FROM platform_private.require_domain_actor(
    p_organization_id,
    'task.manage'
  );

  replayed := platform_private.replay_audit(
    p_request_id,
    'task.change',
    'case_task',
    p_case_task_id,
    fixed_reason,
    jsonb_build_object(
      'organization_id', p_organization_id,
      'case_task_id', p_case_task_id,
      'status', p_new_status,
      'assignee_membership_id', p_new_assignee_membership_id,
      'priority', p_priority,
      'due_at', p_due_at,
      'student_visible', p_student_visible
    )
  );
  IF replayed IS NOT NULL THEN
    RETURN replayed;
  END IF;

  SELECT *
  INTO task_row
  FROM platform.case_tasks AS task
  WHERE task.organization_id = p_organization_id
    AND task.id = p_case_task_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Student case task is unavailable'
      USING ERRCODE = '42501';
  END IF;

  SELECT *
  INTO actor
  FROM platform_private.require_case_operator(
    p_organization_id,
    task_row.student_case_id,
    'task.manage'
  );

  SELECT *
  INTO assignee
  FROM platform_private.require_live_task_assignee(
    p_organization_id,
    p_new_assignee_membership_id
  );

  IF actor.actor_role <> 'admin'
    AND (
      task_row.assignee_membership_id <> actor.actor_membership_id
      OR p_new_assignee_membership_id <> actor.actor_membership_id
      OR task_row.priority <> p_priority
      OR task_row.due_at IS DISTINCT FROM p_due_at
      OR task_row.student_visible <> p_student_visible
    )
  THEN
    RAISE EXCEPTION
      'A live non-Admin task assignee may change only own task status'
      USING ERRCODE = '42501';
  END IF;

  replayed := platform_private.replay_audit(
    p_request_id,
    'task.change',
    'case_task',
    p_case_task_id,
    fixed_reason,
    jsonb_build_object(
      'organization_id', p_organization_id,
      'case_task_id', p_case_task_id,
      'status', p_new_status,
      'assignee_membership_id', p_new_assignee_membership_id,
      'priority', p_priority,
      'due_at', p_due_at,
      'student_visible', p_student_visible
    )
  );
  IF replayed IS NOT NULL THEN
    RETURN replayed;
  END IF;

  IF task_row.status = p_new_status
    AND task_row.assignee_membership_id = p_new_assignee_membership_id
    AND task_row.priority = p_priority
    AND task_row.due_at IS NOT DISTINCT FROM p_due_at
    AND task_row.student_visible = p_student_visible
  THEN
    RAISE EXCEPTION
      'Task mutation must change at least one field'
      USING ERRCODE = '22023';
  END IF;

  UPDATE platform.case_tasks AS task
  SET
    status = p_new_status,
    assignee_membership_id = p_new_assignee_membership_id,
    priority = p_priority,
    due_at = p_due_at,
    student_visible = p_student_visible
  WHERE task.organization_id = p_organization_id
    AND task.id = p_case_task_id;

  INSERT INTO platform.case_task_events (
    organization_id,
    case_task_id,
    student_case_id,
    previous_status,
    new_status,
    previous_assignee_membership_id,
    new_assignee_membership_id,
    actor_membership_id,
    request_id
  )
  VALUES (
    p_organization_id,
    p_case_task_id,
    task_row.student_case_id,
    task_row.status,
    p_new_status,
    task_row.assignee_membership_id,
    p_new_assignee_membership_id,
    actor.actor_membership_id,
    p_request_id
  );

  result := jsonb_build_object(
    'organization_id', p_organization_id,
    'case_task_id', p_case_task_id,
    'student_case_id', task_row.student_case_id,
    'status', p_new_status,
    'assignee_membership_id', p_new_assignee_membership_id,
    'priority', p_priority,
    'due_at', p_due_at,
    'student_visible', p_student_visible
  );

  INSERT INTO platform.audit_events (
    organization_id,
    actor_kind,
    actor_profile_id,
    actor_principal,
    action,
    resource_type,
    resource_id,
    before_state,
    after_state,
    reason,
    request_id
  )
  VALUES (
    p_organization_id,
    'user',
    actor.actor_profile_id,
    'auth:' || actor.actor_auth_user_id::TEXT,
    'task.change',
    'case_task',
    p_case_task_id,
    jsonb_build_object(
      'status', task_row.status,
      'assignee_membership_id', task_row.assignee_membership_id,
      'priority', task_row.priority,
      'due_at', task_row.due_at,
      'student_visible', task_row.student_visible
    ),
    result,
    fixed_reason,
    p_request_id
  );

  RETURN result;
END
$$;

-- Fixed safe projections deliberately return columns, not JSON copies of base
-- rows. They are the only P2D read surface for post-handoff Sales and Students.
CREATE OR REPLACE FUNCTION platform.sales_handoff_summaries()
RETURNS TABLE (
  case_id UUID,
  student_display_name TEXT,
  target_country TEXT,
  target_degree TEXT,
  case_state platform.student_case_state,
  assigned_curator_display_name TEXT,
  handoff_at TIMESTAMPTZ
)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    student_case.id,
    student_case.student_display_name,
    student_case.target_country,
    student_case.target_degree,
    student_case.state,
    curator_profile.display_name,
    student_case.handoff_at
  FROM platform.student_cases AS student_case
  JOIN platform.organization_memberships AS sales_membership
    ON sales_membership.organization_id = student_case.organization_id
    AND sales_membership.id =
      student_case.responsible_sales_membership_id
  JOIN platform.profiles AS sales_profile
    ON sales_profile.id = sales_membership.profile_id
  JOIN platform.organization_memberships AS curator_membership
    ON curator_membership.organization_id = student_case.organization_id
    AND curator_membership.id =
      student_case.current_curator_membership_id
  JOIN platform.profiles AS curator_profile
    ON curator_profile.id = curator_membership.profile_id
  WHERE sales_profile.auth_user_id = (SELECT auth.uid())
    AND sales_membership.status = 'active'
    AND sales_membership."current_role" = 'sales'
    AND sales_profile.status = 'active'
    AND curator_membership.status = 'active'
    AND curator_membership."current_role" = 'curator'
    AND curator_profile.status = 'active'
    AND student_case.state IN ('active', 'closed')
    AND student_case.handoff_at IS NOT NULL
    AND private.platform_has_permission(
      student_case.organization_id,
      'case.read.summary'
    )
  ORDER BY student_case.handoff_at DESC, student_case.id
$$;

CREATE OR REPLACE FUNCTION platform.student_portal_cases()
RETURNS TABLE (
  case_id UUID,
  student_display_name TEXT,
  target_country TEXT,
  target_degree TEXT,
  program_direction TEXT,
  intake TEXT,
  route_approval_status platform.route_approval_status,
  operational_stage TEXT,
  case_state platform.student_case_state,
  next_action TEXT,
  portal_activated_at TIMESTAMPTZ
)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    student_case.id,
    student_case.student_display_name,
    student_case.target_country,
    student_case.target_degree,
    student_case.program_direction,
    student_case.intake,
    student_case.route_approval_status,
    student_case.operational_stage,
    student_case.state,
    student_case.next_action,
    student_case.portal_activated_at
  FROM platform.student_cases AS student_case
  WHERE private.platform_can_read_student_portal_case(
    student_case.organization_id,
    student_case.id
  )
  ORDER BY student_case.created_at, student_case.id
$$;

CREATE OR REPLACE FUNCTION platform.student_portal_applications()
RETURNS TABLE (
  application_id UUID,
  case_id UUID,
  institution_name TEXT,
  program_name TEXT,
  application_status platform.application_status,
  updated_at TIMESTAMPTZ
)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    application.id,
    application.student_case_id,
    application.institution_name,
    application.program_name,
    application.status,
    application.updated_at
  FROM platform.university_applications AS application
  WHERE private.platform_can_read_student_portal_case(
    application.organization_id,
    application.student_case_id
  )
  ORDER BY application.updated_at DESC, application.id
$$;

CREATE OR REPLACE FUNCTION platform.student_portal_visa_cases()
RETURNS TABLE (
  visa_case_id UUID,
  case_id UUID,
  visa_status platform.visa_status,
  updated_at TIMESTAMPTZ
)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    visa.id,
    visa.student_case_id,
    visa.status,
    visa.updated_at
  FROM platform.visa_cases AS visa
  WHERE private.platform_can_read_student_portal_case(
    visa.organization_id,
    visa.student_case_id
  )
  ORDER BY visa.updated_at DESC, visa.id
$$;

CREATE OR REPLACE FUNCTION platform.student_portal_tasks()
RETURNS TABLE (
  case_task_id UUID,
  case_id UUID,
  task_type TEXT,
  title TEXT,
  priority platform.case_task_priority,
  due_at TIMESTAMPTZ,
  task_status platform.case_task_status,
  updated_at TIMESTAMPTZ
)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    task.id,
    task.student_case_id,
    task.task_type,
    task.title,
    task.priority,
    task.due_at,
    task.status,
    task.updated_at
  FROM platform.case_tasks AS task
  WHERE task.student_visible
    AND private.platform_can_read_student_portal_case(
      task.organization_id,
      task.student_case_id
    )
  ORDER BY task.due_at NULLS LAST, task.id
$$;

CREATE OR REPLACE FUNCTION platform.student_portal_updates()
RETURNS TABLE (
  case_update_id UUID,
  case_id UUID,
  source TEXT,
  body TEXT,
  occurred_at TIMESTAMPTZ
)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    case_update.id,
    case_update.student_case_id,
    case_update.source,
    case_update.body,
    case_update.occurred_at
  FROM platform.student_case_updates AS case_update
  WHERE case_update.student_visible
    AND private.platform_can_read_student_portal_case(
      case_update.organization_id,
      case_update.student_case_id
    )
  ORDER BY case_update.occurred_at DESC, case_update.id
$$;

-- Exposed admissions relations are authenticated read surfaces only. RLS
-- decides object scope; every mutation remains behind an explicitly granted
-- SECURITY DEFINER routine.
REVOKE ALL PRIVILEGES ON TABLE
  platform.student_cases,
  platform.student_case_assignment_events,
  platform.student_case_lifecycle_events,
  platform.student_case_updates,
  platform.university_applications,
  platform.university_application_events,
  platform.visa_cases,
  platform.visa_case_events,
  platform.case_tasks,
  platform.case_task_events
FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

GRANT SELECT ON TABLE
  platform.student_cases,
  platform.student_case_assignment_events,
  platform.student_case_lifecycle_events,
  platform.student_case_updates,
  platform.university_applications,
  platform.university_application_events,
  platform.visa_cases,
  platform.visa_case_events,
  platform.case_tasks,
  platform.case_task_events
TO authenticated;

REVOKE ALL PRIVILEGES ON TYPE
  platform.student_case_state,
  platform.route_approval_status,
  platform.application_status,
  platform.visa_status,
  platform.case_task_priority,
  platform.case_task_status
FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

GRANT USAGE ON TYPE
  platform.student_case_state,
  platform.route_approval_status,
  platform.application_status,
  platform.visa_status,
  platform.case_task_priority,
  platform.case_task_status
TO authenticated;

REVOKE ALL ON FUNCTION platform.create_pending_student_case(
  UUID,
  UUID,
  UUID,
  TEXT,
  TEXT,
  TIMESTAMPTZ,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  UUID
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.create_pending_student_case(
  UUID,
  UUID,
  UUID,
  TEXT,
  TEXT,
  TIMESTAMPTZ,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  UUID
) TO service_role;

REVOKE ALL ON FUNCTION platform.assign_student_case_curator(
  UUID,
  UUID,
  UUID,
  TEXT,
  UUID
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.assign_student_case_curator(
  UUID,
  UUID,
  UUID,
  TEXT,
  UUID
) TO authenticated;

REVOKE ALL ON FUNCTION platform.change_student_case_state(
  UUID,
  UUID,
  platform.student_case_state,
  TEXT,
  UUID
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.change_student_case_state(
  UUID,
  UUID,
  platform.student_case_state,
  TEXT,
  UUID
) TO authenticated;

REVOKE ALL ON FUNCTION platform.set_student_case_route(
  UUID,
  UUID,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  platform.route_approval_status,
  TEXT,
  TEXT,
  TEXT,
  UUID
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.set_student_case_route(
  UUID,
  UUID,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  platform.route_approval_status,
  TEXT,
  TEXT,
  TEXT,
  UUID
) TO authenticated;

REVOKE ALL ON FUNCTION platform.append_student_case_update(
  UUID,
  UUID,
  TEXT,
  TEXT,
  BOOLEAN,
  TIMESTAMPTZ,
  UUID
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.append_student_case_update(
  UUID,
  UUID,
  TEXT,
  TEXT,
  BOOLEAN,
  TIMESTAMPTZ,
  UUID
) TO authenticated;

REVOKE ALL ON FUNCTION platform.create_university_application(
  UUID,
  UUID,
  TEXT,
  TEXT,
  platform.application_status,
  TEXT,
  TEXT,
  UUID
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.create_university_application(
  UUID,
  UUID,
  TEXT,
  TEXT,
  platform.application_status,
  TEXT,
  TEXT,
  UUID
) TO authenticated;

REVOKE ALL ON FUNCTION platform.change_university_application(
  UUID,
  UUID,
  platform.application_status,
  TEXT,
  TEXT,
  UUID
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.change_university_application(
  UUID,
  UUID,
  platform.application_status,
  TEXT,
  TEXT,
  UUID
) TO authenticated;

REVOKE ALL ON FUNCTION platform.create_visa_case(
  UUID,
  UUID,
  platform.visa_status,
  TEXT,
  TEXT,
  UUID
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.create_visa_case(
  UUID,
  UUID,
  platform.visa_status,
  TEXT,
  TEXT,
  UUID
) TO authenticated;

REVOKE ALL ON FUNCTION platform.change_visa_case(
  UUID,
  UUID,
  platform.visa_status,
  TEXT,
  TEXT,
  UUID
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.change_visa_case(
  UUID,
  UUID,
  platform.visa_status,
  TEXT,
  TEXT,
  UUID
) TO authenticated;

REVOKE ALL ON FUNCTION platform.create_case_task(
  UUID,
  UUID,
  TEXT,
  TEXT,
  UUID,
  platform.case_task_priority,
  TIMESTAMPTZ,
  platform.case_task_status,
  BOOLEAN,
  UUID
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.create_case_task(
  UUID,
  UUID,
  TEXT,
  TEXT,
  UUID,
  platform.case_task_priority,
  TIMESTAMPTZ,
  platform.case_task_status,
  BOOLEAN,
  UUID
) TO authenticated;

REVOKE ALL ON FUNCTION platform.change_case_task(
  UUID,
  UUID,
  platform.case_task_status,
  UUID,
  platform.case_task_priority,
  TIMESTAMPTZ,
  BOOLEAN,
  UUID
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.change_case_task(
  UUID,
  UUID,
  platform.case_task_status,
  UUID,
  platform.case_task_priority,
  TIMESTAMPTZ,
  BOOLEAN,
  UUID
) TO authenticated;

REVOKE ALL ON FUNCTION platform.sales_handoff_summaries()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.sales_handoff_summaries()
  TO authenticated;

REVOKE ALL ON FUNCTION platform.student_portal_cases()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.student_portal_cases()
  TO authenticated;

REVOKE ALL ON FUNCTION platform.student_portal_applications()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.student_portal_applications()
  TO authenticated;

REVOKE ALL ON FUNCTION platform.student_portal_visa_cases()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.student_portal_visa_cases()
  TO authenticated;

REVOKE ALL ON FUNCTION platform.student_portal_tasks()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.student_portal_tasks()
  TO authenticated;

REVOKE ALL ON FUNCTION platform.student_portal_updates()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.student_portal_updates()
  TO authenticated;

COMMENT ON TABLE platform.student_cases IS
  'Operational admissions cases. amoCRM remains canonical for contact, lead, responsible sales manager and sales stage.';
COMMENT ON TABLE platform.student_case_assignment_events IS
  'Append-only Curator assignment and reassignment evidence with request-level replay protection.';
COMMENT ON TABLE platform.student_case_lifecycle_events IS
  'Append-only close and reopen evidence; case lifecycle does not replace the amoCRM sales stage.';
COMMENT ON TABLE platform.university_applications IS
  'Operational university applications; multiple applications per student case are supported.';
COMMENT ON TABLE platform.visa_cases IS
  'Curator-managed operational visa record. External approval or rejection requires opaque evidence.';
COMMENT ON TABLE platform.case_tasks IS
  'Role-scoped operational tasks. Student access is available only through safe portal projections.';
COMMENT ON FUNCTION platform.create_pending_student_case(
  UUID,
  UUID,
  UUID,
  TEXT,
  TEXT,
  TIMESTAMPTZ,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  UUID
) IS
  'Service-only replay-safe creation after an externally confirmed contract; never activates portal access.';
COMMENT ON FUNCTION platform.sales_handoff_summaries() IS
  'Fixed non-secret post-handoff Sales projection; no admissions base-table access is widened.';
COMMENT ON FUNCTION platform.student_portal_cases() IS
  'Student-safe self projection with no caller-selectable case identifier.';

COMMIT;
