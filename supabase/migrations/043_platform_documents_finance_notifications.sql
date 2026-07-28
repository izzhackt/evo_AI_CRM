-- ============================================================
-- 043_platform_documents_finance_notifications.sql
--
-- P2E: tenant-isolated document metadata, manual finance records and durable
-- individual notification intent. This is a database contract only.
--
-- No row in this migration proves a binary upload/download, malware scanner,
-- payment provider, consent provider, Queue/outbox operation or WhatsApp
-- delivery. Storage/provider evidence is deliberately deferred to P2F-P2H.
-- ============================================================

BEGIN;

CREATE TYPE platform.document_requirement_status AS ENUM (
  'active',
  'retired'
);

CREATE TYPE platform.document_slot_status AS ENUM (
  'required',
  'submitted',
  'approved',
  'correction_required',
  'rejected'
);

CREATE TYPE platform.document_integrity_status AS ENUM (
  'pending',
  'verified',
  'failed'
);

CREATE TYPE platform.document_malware_status AS ENUM (
  'pending',
  'clean',
  'infected',
  'error'
);

CREATE TYPE platform.document_review_decision AS ENUM (
  'approved',
  'correction_required',
  'rejected'
);

CREATE TYPE platform.obligation_category AS ENUM (
  'evo_service_fee',
  'third_party_cost'
);

CREATE TYPE platform.obligation_status AS ENUM (
  'pending',
  'partially_paid',
  'paid',
  'overdue'
);

CREATE TYPE platform.payment_event_type AS ENUM (
  'payment',
  'refund'
);

CREATE TYPE platform.stop_factor_status AS ENUM (
  'active',
  'resolved'
);

CREATE TYPE platform.stop_factor_resolution_kind AS ENUM (
  'payment_event',
  'admin_override'
);

CREATE TYPE platform.notification_channel AS ENUM (
  'in_app',
  'individual_whatsapp'
);

CREATE TYPE platform.notification_consent_status AS ENUM (
  'granted',
  'withdrawn'
);

CREATE TYPE platform.notification_intent_status AS ENUM (
  'pending',
  'consent_blocked',
  'cancelled'
);

CREATE TYPE platform.notification_event_type AS ENUM (
  'created',
  'read',
  'cancelled'
);

CREATE TABLE platform.document_requirements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL
    REFERENCES platform.organizations(id) ON DELETE RESTRICT,
  target_country TEXT NOT NULL CHECK (btrim(target_country) <> ''),
  target_degree TEXT NOT NULL CHECK (btrim(target_degree) <> ''),
  program_direction TEXT NOT NULL CHECK (btrim(program_direction) <> ''),
  checklist_version BIGINT NOT NULL CHECK (checklist_version > 0),
  requirement_key TEXT NOT NULL CHECK (
    requirement_key ~ '^[a-z][a-z0-9_.-]*$'
  ),
  label TEXT NOT NULL CHECK (btrim(label) <> ''),
  instructions TEXT NOT NULL CHECK (btrim(instructions) <> ''),
  status platform.document_requirement_status NOT NULL DEFAULT 'active',
  created_by_membership_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  retired_at TIMESTAMPTZ,
  CONSTRAINT document_requirements_organization_id_id_key
    UNIQUE (organization_id, id),
  CONSTRAINT document_requirements_route_version_key UNIQUE (
    organization_id,
    target_country,
    target_degree,
    program_direction,
    checklist_version,
    requirement_key
  ),
  CONSTRAINT document_requirements_creator_fkey
    FOREIGN KEY (organization_id, created_by_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT document_requirements_status_shape_check CHECK (
    (status = 'active' AND retired_at IS NULL)
    OR (status = 'retired' AND retired_at IS NOT NULL)
  )
);

CREATE TABLE platform.document_slots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  student_case_id UUID NOT NULL,
  requirement_id UUID NOT NULL,
  status platform.document_slot_status NOT NULL DEFAULT 'required',
  deadline TIMESTAMPTZ,
  next_action TEXT,
  current_version_id UUID,
  current_version_no BIGINT,
  created_by_membership_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT document_slots_organization_id_id_key
    UNIQUE (organization_id, id),
  CONSTRAINT document_slots_organization_id_id_case_key
    UNIQUE (organization_id, id, student_case_id),
  CONSTRAINT document_slots_case_requirement_key
    UNIQUE (organization_id, student_case_id, requirement_id),
  CONSTRAINT document_slots_case_fkey
    FOREIGN KEY (organization_id, student_case_id)
    REFERENCES platform.student_cases(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT document_slots_requirement_fkey
    FOREIGN KEY (organization_id, requirement_id)
    REFERENCES platform.document_requirements(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT document_slots_creator_fkey
    FOREIGN KEY (organization_id, created_by_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT document_slots_next_action_check CHECK (
    next_action IS NULL OR btrim(next_action) <> ''
  ),
  CONSTRAINT document_slots_current_version_pair_check CHECK (
    (current_version_id IS NULL) = (current_version_no IS NULL)
  ),
  CONSTRAINT document_slots_status_shape_check CHECK (
    (
      status = 'required'
      AND current_version_id IS NULL
      AND current_version_no IS NULL
    )
    OR (
      status <> 'required'
      AND current_version_id IS NOT NULL
      AND current_version_no IS NOT NULL
      AND current_version_no > 0
    )
  )
);

CREATE TABLE platform.document_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  student_case_id UUID NOT NULL,
  document_slot_id UUID NOT NULL,
  version_no BIGINT NOT NULL CHECK (version_no > 0),
  original_filename TEXT NOT NULL CHECK (btrim(original_filename) <> ''),
  declared_mime_type TEXT NOT NULL CHECK (
    declared_mime_type IN (
      'application/pdf',
      'image/jpeg',
      'image/png'
    )
  ),
  byte_size BIGINT NOT NULL CHECK (
    byte_size BETWEEN 1 AND 26214400
  ),
  sha256_hex TEXT NOT NULL CHECK (
    sha256_hex ~ '^[0-9a-f]{64}$'
  ),
  ingest_evidence_ref TEXT NOT NULL CHECK (
    btrim(ingest_evidence_ref) <> ''
  ),
  submitted_by_membership_id UUID NOT NULL,
  integrity_status platform.document_integrity_status
    NOT NULL DEFAULT 'pending',
  malware_status platform.document_malware_status
    NOT NULL DEFAULT 'pending',
  validation_updated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT document_versions_organization_id_id_key
    UNIQUE (organization_id, id),
  CONSTRAINT document_versions_parent_identity_key
    UNIQUE (
      organization_id,
      id,
      student_case_id,
      document_slot_id
    ),
  CONSTRAINT document_versions_current_slot_key
    UNIQUE (
      organization_id,
      id,
      student_case_id,
      document_slot_id,
      version_no
    ),
  CONSTRAINT document_versions_slot_version_key
    UNIQUE (organization_id, document_slot_id, version_no),
  CONSTRAINT document_versions_case_fkey
    FOREIGN KEY (organization_id, student_case_id)
    REFERENCES platform.student_cases(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT document_versions_slot_fkey
    FOREIGN KEY (
      organization_id,
      document_slot_id,
      student_case_id
    )
    REFERENCES platform.document_slots(
      organization_id,
      id,
      student_case_id
    )
    ON DELETE RESTRICT,
  CONSTRAINT document_versions_submitter_fkey
    FOREIGN KEY (organization_id, submitted_by_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id)
    ON DELETE RESTRICT
);

ALTER TABLE platform.document_slots
  ADD CONSTRAINT document_slots_current_version_fkey
  FOREIGN KEY (
    organization_id,
    current_version_id,
    student_case_id,
    id,
    current_version_no
  )
  REFERENCES platform.document_versions(
    organization_id,
    id,
    student_case_id,
    document_slot_id,
    version_no
  )
  ON DELETE RESTRICT;

CREATE TABLE platform.document_validation_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  student_case_id UUID NOT NULL,
  document_slot_id UUID NOT NULL,
  document_version_id UUID NOT NULL,
  previous_integrity_status platform.document_integrity_status NOT NULL,
  new_integrity_status platform.document_integrity_status NOT NULL,
  previous_malware_status platform.document_malware_status NOT NULL,
  new_malware_status platform.document_malware_status NOT NULL,
  validation_source TEXT NOT NULL CHECK (btrim(validation_source) <> ''),
  evidence_ref TEXT NOT NULL CHECK (btrim(evidence_ref) <> ''),
  service_principal TEXT NOT NULL CHECK (btrim(service_principal) <> ''),
  request_id UUID NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT document_validation_events_version_fkey
    FOREIGN KEY (
      organization_id,
      document_version_id,
      student_case_id,
      document_slot_id
    )
    REFERENCES platform.document_versions(
      organization_id,
      id,
      student_case_id,
      document_slot_id
    )
    ON DELETE RESTRICT,
  CONSTRAINT document_validation_events_change_check CHECK (
    previous_integrity_status <> new_integrity_status
    OR previous_malware_status <> new_malware_status
  )
);

CREATE TABLE platform.document_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  student_case_id UUID NOT NULL,
  document_slot_id UUID NOT NULL,
  document_version_id UUID NOT NULL,
  decision platform.document_review_decision NOT NULL,
  reason TEXT,
  reviewer_membership_id UUID NOT NULL,
  request_id UUID NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT document_reviews_version_fkey
    FOREIGN KEY (
      organization_id,
      document_version_id,
      student_case_id,
      document_slot_id
    )
    REFERENCES platform.document_versions(
      organization_id,
      id,
      student_case_id,
      document_slot_id
    )
    ON DELETE RESTRICT,
  CONSTRAINT document_reviews_reviewer_fkey
    FOREIGN KEY (organization_id, reviewer_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT document_reviews_reason_check CHECK (
    (
      decision = 'approved'
      AND (reason IS NULL OR btrim(reason) <> '')
    )
    OR (
      decision IN ('correction_required', 'rejected')
      AND reason IS NOT NULL
      AND btrim(reason) <> ''
    )
  )
);

CREATE TABLE platform.document_access_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  student_case_id UUID NOT NULL,
  document_slot_id UUID NOT NULL,
  document_version_id UUID NOT NULL,
  actor_kind platform.audit_actor_kind NOT NULL,
  actor_profile_id UUID
    REFERENCES platform.profiles(id) ON DELETE RESTRICT,
  actor_membership_id UUID,
  access_purpose TEXT NOT NULL CHECK (btrim(access_purpose) <> ''),
  contract_reference TEXT NOT NULL CHECK (btrim(contract_reference) <> ''),
  request_id UUID NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT document_access_events_version_fkey
    FOREIGN KEY (
      organization_id,
      document_version_id,
      student_case_id,
      document_slot_id
    )
    REFERENCES platform.document_versions(
      organization_id,
      id,
      student_case_id,
      document_slot_id
    )
    ON DELETE RESTRICT,
  CONSTRAINT document_access_events_membership_fkey
    FOREIGN KEY (organization_id, actor_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT document_access_events_actor_check CHECK (
    (
      actor_kind = 'user'
      AND actor_profile_id IS NOT NULL
      AND actor_membership_id IS NOT NULL
    )
    OR (
      actor_kind <> 'user'
      AND actor_profile_id IS NULL
      AND actor_membership_id IS NULL
    )
  )
);

CREATE TABLE platform.payment_obligations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  student_case_id UUID NOT NULL,
  label TEXT NOT NULL CHECK (btrim(label) <> ''),
  category platform.obligation_category NOT NULL,
  amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
  currency TEXT NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  due_at TIMESTAMPTZ NOT NULL,
  next_action TEXT NOT NULL CHECK (btrim(next_action) <> ''),
  total_paid_minor BIGINT NOT NULL DEFAULT 0 CHECK (total_paid_minor >= 0),
  total_refunded_minor BIGINT NOT NULL DEFAULT 0
    CHECK (total_refunded_minor >= 0),
  created_by_membership_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT payment_obligations_organization_id_id_key
    UNIQUE (organization_id, id),
  CONSTRAINT payment_obligations_parent_identity_key
    UNIQUE (organization_id, id, student_case_id),
  CONSTRAINT payment_obligations_case_fkey
    FOREIGN KEY (organization_id, student_case_id)
    REFERENCES platform.student_cases(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT payment_obligations_creator_fkey
    FOREIGN KEY (organization_id, created_by_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT payment_obligations_totals_check CHECK (
    total_refunded_minor <= total_paid_minor
    AND total_paid_minor - total_refunded_minor <= amount_minor
  )
);

CREATE TABLE platform.payment_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  student_case_id UUID NOT NULL,
  payment_obligation_id UUID NOT NULL,
  event_type platform.payment_event_type NOT NULL,
  referenced_payment_event_id UUID,
  amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
  currency TEXT NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  occurred_at TIMESTAMPTZ NOT NULL,
  source_key TEXT NOT NULL CHECK (btrim(source_key) <> ''),
  actor_membership_id UUID NOT NULL,
  request_id UUID NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT payment_events_organization_id_id_key
    UNIQUE (organization_id, id),
  CONSTRAINT payment_events_parent_identity_key
    UNIQUE (
      organization_id,
      id,
      student_case_id,
      payment_obligation_id
    ),
  CONSTRAINT payment_events_obligation_fkey
    FOREIGN KEY (
      organization_id,
      payment_obligation_id,
      student_case_id
    )
    REFERENCES platform.payment_obligations(
      organization_id,
      id,
      student_case_id
    )
    ON DELETE RESTRICT,
  CONSTRAINT payment_events_actor_fkey
    FOREIGN KEY (organization_id, actor_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT payment_events_referenced_payment_fkey
    FOREIGN KEY (
      organization_id,
      referenced_payment_event_id,
      student_case_id,
      payment_obligation_id
    )
    REFERENCES platform.payment_events(
      organization_id,
      id,
      student_case_id,
      payment_obligation_id
    )
    ON DELETE RESTRICT,
  CONSTRAINT payment_events_reference_shape_check CHECK (
    (
      event_type = 'payment'
      AND referenced_payment_event_id IS NULL
    )
    OR (
      event_type = 'refund'
      AND referenced_payment_event_id IS NOT NULL
      AND referenced_payment_event_id <> id
    )
  )
);

CREATE TABLE platform.payment_evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  student_case_id UUID NOT NULL,
  payment_obligation_id UUID NOT NULL,
  payment_event_id UUID NOT NULL,
  evidence_ref TEXT NOT NULL CHECK (btrim(evidence_ref) <> ''),
  recorded_by_membership_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT payment_evidence_organization_id_id_key
    UNIQUE (organization_id, id),
  CONSTRAINT payment_evidence_event_fkey
    FOREIGN KEY (
      organization_id,
      payment_event_id,
      student_case_id,
      payment_obligation_id
    )
    REFERENCES platform.payment_events(
      organization_id,
      id,
      student_case_id,
      payment_obligation_id
    )
    ON DELETE RESTRICT,
  CONSTRAINT payment_evidence_recorder_fkey
    FOREIGN KEY (organization_id, recorded_by_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id)
    ON DELETE RESTRICT
);

CREATE TABLE platform.stop_factors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  student_case_id UUID NOT NULL,
  payment_obligation_id UUID NOT NULL,
  status platform.stop_factor_status NOT NULL DEFAULT 'active',
  reason TEXT NOT NULL CHECK (btrim(reason) <> ''),
  owner_membership_id UUID NOT NULL,
  blocked_action TEXT NOT NULL CHECK (btrim(blocked_action) <> ''),
  next_action TEXT NOT NULL CHECK (btrim(next_action) <> ''),
  created_evidence_ref TEXT NOT NULL CHECK (
    btrim(created_evidence_ref) <> ''
  ),
  created_by_membership_id UUID NOT NULL,
  resolution_kind platform.stop_factor_resolution_kind,
  resolution_payment_event_id UUID,
  resolution_reason TEXT,
  resolution_evidence_ref TEXT,
  resolved_by_membership_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  resolved_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT stop_factors_organization_id_id_key
    UNIQUE (organization_id, id),
  CONSTRAINT stop_factors_parent_identity_key
    UNIQUE (
      organization_id,
      id,
      student_case_id,
      payment_obligation_id
    ),
  CONSTRAINT stop_factors_obligation_fkey
    FOREIGN KEY (
      organization_id,
      payment_obligation_id,
      student_case_id
    )
    REFERENCES platform.payment_obligations(
      organization_id,
      id,
      student_case_id
    )
    ON DELETE RESTRICT,
  CONSTRAINT stop_factors_owner_fkey
    FOREIGN KEY (organization_id, owner_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT stop_factors_creator_fkey
    FOREIGN KEY (organization_id, created_by_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT stop_factors_resolver_fkey
    FOREIGN KEY (organization_id, resolved_by_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT stop_factors_resolution_event_fkey
    FOREIGN KEY (
      organization_id,
      resolution_payment_event_id,
      student_case_id,
      payment_obligation_id
    )
    REFERENCES platform.payment_events(
      organization_id,
      id,
      student_case_id,
      payment_obligation_id
    )
    ON DELETE RESTRICT,
  CONSTRAINT stop_factors_status_shape_check CHECK (
    (
      status = 'active'
      AND resolution_kind IS NULL
      AND resolution_payment_event_id IS NULL
      AND resolution_reason IS NULL
      AND resolution_evidence_ref IS NULL
      AND resolved_by_membership_id IS NULL
      AND resolved_at IS NULL
    )
    OR (
      status = 'resolved'
      AND resolution_kind IS NOT NULL
      AND resolution_reason IS NOT NULL
      AND btrim(resolution_reason) <> ''
      AND resolved_by_membership_id IS NOT NULL
      AND resolved_at IS NOT NULL
      AND (
        (
          resolution_kind = 'payment_event'
          AND resolution_payment_event_id IS NOT NULL
          AND resolution_evidence_ref IS NULL
        )
        OR (
          resolution_kind = 'admin_override'
          AND resolution_payment_event_id IS NULL
          AND resolution_evidence_ref IS NOT NULL
          AND btrim(resolution_evidence_ref) <> ''
        )
      )
    )
  )
);

CREATE TABLE platform.stop_factor_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  student_case_id UUID NOT NULL,
  payment_obligation_id UUID NOT NULL,
  stop_factor_id UUID NOT NULL,
  previous_status platform.stop_factor_status,
  new_status platform.stop_factor_status NOT NULL,
  resolution_kind platform.stop_factor_resolution_kind,
  resolution_payment_event_id UUID,
  evidence_ref TEXT NOT NULL CHECK (btrim(evidence_ref) <> ''),
  reason TEXT NOT NULL CHECK (btrim(reason) <> ''),
  actor_membership_id UUID NOT NULL,
  request_id UUID NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT stop_factor_events_parent_fkey
    FOREIGN KEY (
      organization_id,
      stop_factor_id,
      student_case_id,
      payment_obligation_id
    )
    REFERENCES platform.stop_factors(
      organization_id,
      id,
      student_case_id,
      payment_obligation_id
    )
    ON DELETE RESTRICT,
  CONSTRAINT stop_factor_events_payment_event_fkey
    FOREIGN KEY (
      organization_id,
      resolution_payment_event_id,
      student_case_id,
      payment_obligation_id
    )
    REFERENCES platform.payment_events(
      organization_id,
      id,
      student_case_id,
      payment_obligation_id
    )
    ON DELETE RESTRICT,
  CONSTRAINT stop_factor_events_actor_fkey
    FOREIGN KEY (organization_id, actor_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT stop_factor_events_shape_check CHECK (
    (
      previous_status IS NULL
      AND new_status = 'active'
      AND resolution_kind IS NULL
      AND resolution_payment_event_id IS NULL
    )
    OR (
      previous_status = 'active'
      AND new_status = 'resolved'
      AND resolution_kind IS NOT NULL
    )
  )
);

CREATE TABLE platform.notification_consents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  membership_id UUID NOT NULL,
  channel platform.notification_channel NOT NULL
    CHECK (channel = 'individual_whatsapp'),
  status platform.notification_consent_status NOT NULL,
  policy_ref TEXT NOT NULL CHECK (btrim(policy_ref) <> ''),
  evidence_ref TEXT NOT NULL CHECK (btrim(evidence_ref) <> ''),
  granted_at TIMESTAMPTZ,
  withdrawn_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT notification_consents_organization_id_id_key
    UNIQUE (organization_id, id),
  CONSTRAINT notification_consents_subject_identity_key
    UNIQUE (organization_id, id, membership_id),
  CONSTRAINT notification_consents_subject_channel_key
    UNIQUE (organization_id, membership_id, channel),
  CONSTRAINT notification_consents_membership_fkey
    FOREIGN KEY (organization_id, membership_id)
    REFERENCES platform.organization_memberships(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT notification_consents_status_shape_check CHECK (
    (
      status = 'granted'
      AND granted_at IS NOT NULL
      AND withdrawn_at IS NULL
    )
    OR (
      status = 'withdrawn'
      AND withdrawn_at IS NOT NULL
    )
  )
);

CREATE TABLE platform.notification_consent_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  membership_id UUID NOT NULL,
  notification_consent_id UUID NOT NULL,
  previous_status platform.notification_consent_status,
  new_status platform.notification_consent_status NOT NULL,
  policy_ref TEXT NOT NULL CHECK (btrim(policy_ref) <> ''),
  evidence_ref TEXT NOT NULL CHECK (btrim(evidence_ref) <> ''),
  actor_membership_id UUID NOT NULL,
  request_id UUID NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT notification_consent_events_consent_fkey
    FOREIGN KEY (
      organization_id,
      notification_consent_id,
      membership_id
    )
    REFERENCES platform.notification_consents(
      organization_id,
      id,
      membership_id
    )
    ON DELETE RESTRICT,
  CONSTRAINT notification_consent_events_subject_fkey
    FOREIGN KEY (organization_id, membership_id)
    REFERENCES platform.organization_memberships(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT notification_consent_events_actor_fkey
    FOREIGN KEY (organization_id, actor_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT notification_consent_events_change_check CHECK (
    previous_status IS NULL OR previous_status <> new_status
  )
);

CREATE TABLE platform.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  student_case_id UUID NOT NULL,
  recipient_membership_id UUID NOT NULL,
  category TEXT NOT NULL CHECK (
    category ~ '^[a-z][a-z0-9_.-]*$'
  ),
  title TEXT NOT NULL CHECK (btrim(title) <> ''),
  body TEXT NOT NULL CHECK (btrim(body) <> ''),
  dedupe_key TEXT NOT NULL CHECK (btrim(dedupe_key) <> ''),
  created_by_membership_id UUID NOT NULL,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT notifications_organization_id_id_key
    UNIQUE (organization_id, id),
  CONSTRAINT notifications_parent_identity_key
    UNIQUE (
      organization_id,
      id,
      student_case_id,
      recipient_membership_id
    ),
  CONSTRAINT notifications_case_fkey
    FOREIGN KEY (organization_id, student_case_id)
    REFERENCES platform.student_cases(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT notifications_recipient_fkey
    FOREIGN KEY (organization_id, recipient_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT notifications_creator_fkey
    FOREIGN KEY (organization_id, created_by_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id)
    ON DELETE RESTRICT
);

CREATE TABLE platform.notification_delivery_intents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  notification_id UUID NOT NULL,
  student_case_id UUID NOT NULL,
  recipient_membership_id UUID NOT NULL,
  channel platform.notification_channel NOT NULL,
  status platform.notification_intent_status NOT NULL,
  dedupe_key TEXT NOT NULL CHECK (btrim(dedupe_key) <> ''),
  notification_consent_id UUID,
  consent_status_snapshot platform.notification_consent_status,
  consent_policy_ref TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT notification_delivery_intents_notification_channel_key
    UNIQUE (organization_id, notification_id, channel),
  CONSTRAINT notification_delivery_intents_recipient_dedupe_key
    UNIQUE (
      organization_id,
      recipient_membership_id,
      channel,
      dedupe_key
    ),
  CONSTRAINT notification_delivery_intents_notification_fkey
    FOREIGN KEY (
      organization_id,
      notification_id,
      student_case_id,
      recipient_membership_id
    )
    REFERENCES platform.notifications(
      organization_id,
      id,
      student_case_id,
      recipient_membership_id
    )
    ON DELETE RESTRICT,
  CONSTRAINT notification_delivery_intents_consent_fkey
    FOREIGN KEY (
      organization_id,
      notification_consent_id,
      recipient_membership_id
    )
    REFERENCES platform.notification_consents(
      organization_id,
      id,
      membership_id
    )
    ON DELETE RESTRICT,
  CONSTRAINT notification_delivery_intents_consent_shape_check CHECK (
    (
      channel = 'in_app'
      AND status = 'pending'
      AND notification_consent_id IS NULL
      AND consent_status_snapshot IS NULL
      AND consent_policy_ref IS NULL
    )
    OR (
      channel = 'individual_whatsapp'
      AND status IN ('pending', 'consent_blocked', 'cancelled')
      AND (
        (
          status = 'pending'
          AND notification_consent_id IS NOT NULL
          AND consent_status_snapshot = 'granted'
          AND consent_policy_ref IS NOT NULL
          AND btrim(consent_policy_ref) <> ''
        )
        OR (
          status = 'consent_blocked'
          AND (
            (
              notification_consent_id IS NULL
              AND consent_status_snapshot IS NULL
              AND consent_policy_ref IS NULL
            )
            OR (
              notification_consent_id IS NOT NULL
              AND consent_status_snapshot = 'withdrawn'
              AND consent_policy_ref IS NOT NULL
              AND btrim(consent_policy_ref) <> ''
            )
          )
        )
        OR status = 'cancelled'
      )
    )
  )
);

CREATE TABLE platform.notification_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  notification_id UUID NOT NULL,
  student_case_id UUID NOT NULL,
  recipient_membership_id UUID NOT NULL,
  event_type platform.notification_event_type NOT NULL,
  actor_membership_id UUID NOT NULL,
  reason TEXT NOT NULL CHECK (btrim(reason) <> ''),
  request_id UUID NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT notification_events_notification_fkey
    FOREIGN KEY (
      organization_id,
      notification_id,
      student_case_id,
      recipient_membership_id
    )
    REFERENCES platform.notifications(
      organization_id,
      id,
      student_case_id,
      recipient_membership_id
    )
    ON DELETE RESTRICT,
  CONSTRAINT notification_events_actor_fkey
    FOREIGN KEY (organization_id, actor_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id)
    ON DELETE RESTRICT
);

-- Every tenant-qualified foreign key and high-frequency authorization path has
-- a leading index. Partial indexes keep current-work queues compact.
CREATE INDEX document_requirements_creator_idx
  ON platform.document_requirements (
    organization_id,
    created_by_membership_id
  );
CREATE INDEX document_requirements_active_route_idx
  ON platform.document_requirements (
    organization_id,
    target_country,
    target_degree,
    program_direction,
    checklist_version DESC
  )
  WHERE status = 'active';
CREATE INDEX document_slots_case_status_idx
  ON platform.document_slots (
    organization_id,
    student_case_id,
    status,
    deadline
  );
CREATE INDEX document_slots_requirement_idx
  ON platform.document_slots (organization_id, requirement_id);
CREATE INDEX document_slots_creator_idx
  ON platform.document_slots (
    organization_id,
    created_by_membership_id
  );
CREATE INDEX document_slots_current_version_idx
  ON platform.document_slots (
    organization_id,
    current_version_id,
    student_case_id,
    id,
    current_version_no
  )
  WHERE current_version_id IS NOT NULL;
CREATE INDEX document_versions_case_idx
  ON platform.document_versions (
    organization_id,
    student_case_id,
    created_at DESC
  );
CREATE INDEX document_versions_slot_idx
  ON platform.document_versions (
    organization_id,
    document_slot_id,
    version_no DESC
  );
CREATE INDEX document_versions_submitter_idx
  ON platform.document_versions (
    organization_id,
    submitted_by_membership_id
  );
CREATE INDEX document_validation_events_version_idx
  ON platform.document_validation_events (
    organization_id,
    document_version_id,
    created_at DESC
  );
CREATE INDEX document_reviews_version_idx
  ON platform.document_reviews (
    organization_id,
    document_version_id,
    created_at DESC
  );
CREATE INDEX document_reviews_reviewer_idx
  ON platform.document_reviews (
    organization_id,
    reviewer_membership_id
  );
CREATE INDEX document_access_events_version_idx
  ON platform.document_access_events (
    organization_id,
    document_version_id,
    created_at DESC
  );
CREATE INDEX document_access_events_actor_membership_idx
  ON platform.document_access_events (
    organization_id,
    actor_membership_id
  )
  WHERE actor_membership_id IS NOT NULL;

CREATE INDEX payment_obligations_case_due_idx
  ON platform.payment_obligations (
    organization_id,
    student_case_id,
    due_at
  );
CREATE INDEX payment_obligations_creator_idx
  ON platform.payment_obligations (
    organization_id,
    created_by_membership_id
  );
CREATE INDEX payment_events_obligation_idx
  ON platform.payment_events (
    organization_id,
    payment_obligation_id,
    occurred_at DESC
  );
CREATE INDEX payment_events_actor_idx
  ON platform.payment_events (
    organization_id,
    actor_membership_id
  );
CREATE INDEX payment_events_referenced_payment_idx
  ON platform.payment_events (
    organization_id,
    referenced_payment_event_id,
    event_type
  )
  WHERE referenced_payment_event_id IS NOT NULL;
CREATE INDEX payment_evidence_event_idx
  ON platform.payment_evidence (
    organization_id,
    payment_event_id,
    created_at
  );
CREATE INDEX payment_evidence_recorder_idx
  ON platform.payment_evidence (
    organization_id,
    recorded_by_membership_id
  );
CREATE INDEX stop_factors_case_status_idx
  ON platform.stop_factors (
    organization_id,
    student_case_id,
    status
  );
CREATE INDEX stop_factors_obligation_status_idx
  ON platform.stop_factors (
    organization_id,
    payment_obligation_id,
    status
  );
CREATE INDEX stop_factors_owner_idx
  ON platform.stop_factors (
    organization_id,
    owner_membership_id,
    status
  );
CREATE INDEX stop_factors_creator_idx
  ON platform.stop_factors (
    organization_id,
    created_by_membership_id
  );
CREATE INDEX stop_factors_resolver_idx
  ON platform.stop_factors (
    organization_id,
    resolved_by_membership_id
  )
  WHERE resolved_by_membership_id IS NOT NULL;
CREATE INDEX stop_factors_resolution_payment_event_idx
  ON platform.stop_factors (
    organization_id,
    resolution_payment_event_id
  )
  WHERE resolution_payment_event_id IS NOT NULL;
CREATE INDEX stop_factor_events_parent_idx
  ON platform.stop_factor_events (
    organization_id,
    stop_factor_id,
    created_at
  );
CREATE INDEX stop_factor_events_payment_event_idx
  ON platform.stop_factor_events (
    organization_id,
    resolution_payment_event_id
  )
  WHERE resolution_payment_event_id IS NOT NULL;
CREATE INDEX stop_factor_events_actor_idx
  ON platform.stop_factor_events (
    organization_id,
    actor_membership_id
  );

CREATE INDEX notification_consents_membership_status_idx
  ON platform.notification_consents (
    organization_id,
    membership_id,
    status
  );
CREATE INDEX notification_consent_events_consent_idx
  ON platform.notification_consent_events (
    organization_id,
    notification_consent_id,
    created_at DESC
  );
CREATE INDEX notification_consent_events_subject_idx
  ON platform.notification_consent_events (
    organization_id,
    membership_id
  );
CREATE INDEX notification_consent_events_actor_idx
  ON platform.notification_consent_events (
    organization_id,
    actor_membership_id
  );
CREATE INDEX notifications_recipient_created_idx
  ON platform.notifications (
    organization_id,
    recipient_membership_id,
    created_at DESC
  );
CREATE INDEX notifications_case_created_idx
  ON platform.notifications (
    organization_id,
    student_case_id,
    created_at DESC
  );
CREATE INDEX notifications_creator_idx
  ON platform.notifications (
    organization_id,
    created_by_membership_id
  );
CREATE INDEX notification_delivery_intents_notification_idx
  ON platform.notification_delivery_intents (
    organization_id,
    notification_id
  );
CREATE INDEX notification_delivery_intents_consent_idx
  ON platform.notification_delivery_intents (
    organization_id,
    notification_consent_id
  )
  WHERE notification_consent_id IS NOT NULL;
CREATE INDEX notification_delivery_intents_pending_idx
  ON platform.notification_delivery_intents (
    organization_id,
    channel,
    created_at
  )
  WHERE status = 'pending';
CREATE INDEX notification_events_notification_idx
  ON platform.notification_events (
    organization_id,
    notification_id,
    created_at
  );
CREATE INDEX notification_events_actor_idx
  ON platform.notification_events (
    organization_id,
    actor_membership_id
  );

ALTER TABLE platform.document_requirements ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.document_requirements FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.document_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.document_slots FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.document_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.document_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.document_validation_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.document_validation_events FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.document_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.document_reviews FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.document_access_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.document_access_events FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.payment_obligations ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.payment_obligations FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.payment_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.payment_events FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.payment_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.payment_evidence FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.stop_factors ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.stop_factors FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.stop_factor_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.stop_factor_events FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.notification_consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.notification_consents FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.notification_consent_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.notification_consent_events FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.notifications FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.notification_delivery_intents ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.notification_delivery_intents FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.notification_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.notification_events FORCE ROW LEVEL SECURITY;

-- Parent identity is immutable. Domain RPCs may change only explicit snapshot
-- fields while immutable event rows retain the authoritative history.
CREATE TRIGGER document_requirements_identity_immutable
  BEFORE UPDATE ON platform.document_requirements
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.protect_domain_identity(
    'id',
    'organization_id',
    'target_country',
    'target_degree',
    'program_direction',
    'checklist_version',
    'requirement_key',
    'label',
    'instructions',
    'created_by_membership_id',
    'created_at'
  );
CREATE TRIGGER document_slots_identity_immutable
  BEFORE UPDATE ON platform.document_slots
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.protect_domain_identity(
    'id',
    'organization_id',
    'student_case_id',
    'requirement_id',
    'deadline',
    'next_action',
    'created_by_membership_id',
    'created_at'
  );
CREATE TRIGGER document_versions_identity_immutable
  BEFORE UPDATE ON platform.document_versions
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.protect_domain_identity(
    'id',
    'organization_id',
    'student_case_id',
    'document_slot_id',
    'version_no',
    'original_filename',
    'declared_mime_type',
    'byte_size',
    'sha256_hex',
    'ingest_evidence_ref',
    'submitted_by_membership_id',
    'created_at'
  );
CREATE TRIGGER payment_obligations_identity_immutable
  BEFORE UPDATE ON platform.payment_obligations
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.protect_domain_identity(
    'id',
    'organization_id',
    'student_case_id',
    'label',
    'category',
    'amount_minor',
    'currency',
    'due_at',
    'next_action',
    'created_by_membership_id',
    'created_at'
  );
CREATE TRIGGER stop_factors_identity_immutable
  BEFORE UPDATE ON platform.stop_factors
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.protect_domain_identity(
    'id',
    'organization_id',
    'student_case_id',
    'payment_obligation_id',
    'reason',
    'owner_membership_id',
    'blocked_action',
    'next_action',
    'created_evidence_ref',
    'created_by_membership_id',
    'created_at'
  );
CREATE TRIGGER notification_consents_identity_immutable
  BEFORE UPDATE ON platform.notification_consents
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.protect_domain_identity(
    'id',
    'organization_id',
    'membership_id',
    'channel',
    'created_at'
  );
CREATE TRIGGER notifications_identity_immutable
  BEFORE UPDATE ON platform.notifications
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.protect_domain_identity(
    'id',
    'organization_id',
    'student_case_id',
    'recipient_membership_id',
    'category',
    'title',
    'body',
    'dedupe_key',
    'created_by_membership_id',
    'created_at'
  );

CREATE TRIGGER document_slots_set_updated_at
  BEFORE UPDATE ON platform.document_slots
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.set_updated_at();
CREATE TRIGGER document_versions_set_updated_at
  BEFORE UPDATE ON platform.document_versions
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.set_updated_at();
CREATE TRIGGER payment_obligations_set_updated_at
  BEFORE UPDATE ON platform.payment_obligations
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.set_updated_at();
CREATE TRIGGER stop_factors_set_updated_at
  BEFORE UPDATE ON platform.stop_factors
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.set_updated_at();
CREATE TRIGGER notification_consents_set_updated_at
  BEFORE UPDATE ON platform.notification_consents
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.set_updated_at();
CREATE TRIGGER notifications_set_updated_at
  BEFORE UPDATE ON platform.notifications
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.set_updated_at();

CREATE OR REPLACE FUNCTION platform_private.guard_p2e_parent_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_TABLE_NAME = 'document_requirements' THEN
    IF OLD.status = 'retired'
      OR NEW.status NOT IN ('active', 'retired')
      OR (
        OLD.status = 'active'
        AND NEW.status = 'active'
        AND NEW.retired_at IS DISTINCT FROM OLD.retired_at
      )
      OR (
        OLD.status = 'active'
        AND NEW.status = 'retired'
        AND NEW.retired_at IS NULL
      )
    THEN
      RAISE EXCEPTION
        'Document requirement transition is not allowed'
        USING ERRCODE = '55000';
    END IF;
  ELSIF TG_TABLE_NAME = 'document_slots' THEN
    IF NOT (
      (OLD.status = 'required' AND NEW.status = 'submitted')
      OR (
        OLD.status IN ('submitted', 'correction_required', 'rejected')
        AND NEW.status = 'submitted'
      )
      OR (
        OLD.status = 'submitted'
        AND NEW.status IN (
          'approved',
          'correction_required',
          'rejected'
        )
      )
    ) THEN
      RAISE EXCEPTION
        'Document slot transition is not allowed'
        USING ERRCODE = '55000';
    END IF;
  ELSIF TG_TABLE_NAME = 'document_versions' THEN
    IF NEW.integrity_status IS NOT DISTINCT FROM OLD.integrity_status
      AND NEW.malware_status IS NOT DISTINCT FROM OLD.malware_status
    THEN
      RAISE EXCEPTION
        'Document version update requires validation-state change'
        USING ERRCODE = '55000';
    END IF;
    IF NEW.validation_updated_at IS NULL THEN
      RAISE EXCEPTION
        'Document validation update requires validation_updated_at'
        USING ERRCODE = '55000';
    END IF;
  ELSIF TG_TABLE_NAME = 'payment_obligations' THEN
    IF NEW.total_paid_minor = OLD.total_paid_minor
      AND NEW.total_refunded_minor = OLD.total_refunded_minor
    THEN
      RAISE EXCEPTION
        'Payment obligation update requires confirmed totals change'
        USING ERRCODE = '55000';
    END IF;
  ELSIF TG_TABLE_NAME = 'stop_factors' THEN
    IF OLD.status <> 'active' OR NEW.status <> 'resolved' THEN
      RAISE EXCEPTION
        'Stop factor may transition only from active to resolved'
        USING ERRCODE = '55000';
    END IF;
  ELSIF TG_TABLE_NAME = 'notification_consents' THEN
    IF NEW.status = OLD.status THEN
      RAISE EXCEPTION
        'Notification consent update requires a status change'
        USING ERRCODE = '55000';
    END IF;
  ELSIF TG_TABLE_NAME = 'notifications' THEN
    IF OLD.read_at IS NOT NULL
      OR NEW.read_at IS NULL
    THEN
      RAISE EXCEPTION
        'Notification read state is one-way'
        USING ERRCODE = '55000';
    END IF;
  ELSE
    RAISE EXCEPTION
      'Unexpected P2E guarded table %',
      TG_TABLE_NAME
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION platform_private.guard_p2e_parent_transition()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

CREATE TRIGGER document_requirements_transition_guard
  BEFORE UPDATE ON platform.document_requirements
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.guard_p2e_parent_transition();
CREATE TRIGGER document_slots_transition_guard
  BEFORE UPDATE ON platform.document_slots
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.guard_p2e_parent_transition();
CREATE TRIGGER document_versions_transition_guard
  BEFORE UPDATE ON platform.document_versions
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.guard_p2e_parent_transition();
CREATE TRIGGER payment_obligations_transition_guard
  BEFORE UPDATE ON platform.payment_obligations
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.guard_p2e_parent_transition();
CREATE TRIGGER stop_factors_transition_guard
  BEFORE UPDATE ON platform.stop_factors
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.guard_p2e_parent_transition();
CREATE TRIGGER notification_consents_transition_guard
  BEFORE UPDATE ON platform.notification_consents
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.guard_p2e_parent_transition();
CREATE TRIGGER notifications_transition_guard
  BEFORE UPDATE ON platform.notifications
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.guard_p2e_parent_transition();

-- Parent records are lifecycle-managed, never physically deleted in P2E.
CREATE TRIGGER document_requirements_no_delete
  BEFORE DELETE ON platform.document_requirements
  FOR EACH ROW EXECUTE FUNCTION platform_private.block_domain_delete();
CREATE TRIGGER document_requirements_no_truncate
  BEFORE TRUNCATE ON platform.document_requirements
  FOR EACH STATEMENT EXECUTE FUNCTION platform_private.block_domain_delete();
CREATE TRIGGER document_slots_no_delete
  BEFORE DELETE ON platform.document_slots
  FOR EACH ROW EXECUTE FUNCTION platform_private.block_domain_delete();
CREATE TRIGGER document_slots_no_truncate
  BEFORE TRUNCATE ON platform.document_slots
  FOR EACH STATEMENT EXECUTE FUNCTION platform_private.block_domain_delete();
CREATE TRIGGER document_versions_no_delete
  BEFORE DELETE ON platform.document_versions
  FOR EACH ROW EXECUTE FUNCTION platform_private.block_domain_delete();
CREATE TRIGGER document_versions_no_truncate
  BEFORE TRUNCATE ON platform.document_versions
  FOR EACH STATEMENT EXECUTE FUNCTION platform_private.block_domain_delete();
CREATE TRIGGER payment_obligations_no_delete
  BEFORE DELETE ON platform.payment_obligations
  FOR EACH ROW EXECUTE FUNCTION platform_private.block_domain_delete();
CREATE TRIGGER payment_obligations_no_truncate
  BEFORE TRUNCATE ON platform.payment_obligations
  FOR EACH STATEMENT EXECUTE FUNCTION platform_private.block_domain_delete();
CREATE TRIGGER stop_factors_no_delete
  BEFORE DELETE ON platform.stop_factors
  FOR EACH ROW EXECUTE FUNCTION platform_private.block_domain_delete();
CREATE TRIGGER stop_factors_no_truncate
  BEFORE TRUNCATE ON platform.stop_factors
  FOR EACH STATEMENT EXECUTE FUNCTION platform_private.block_domain_delete();
CREATE TRIGGER notification_consents_no_delete
  BEFORE DELETE ON platform.notification_consents
  FOR EACH ROW EXECUTE FUNCTION platform_private.block_domain_delete();
CREATE TRIGGER notification_consents_no_truncate
  BEFORE TRUNCATE ON platform.notification_consents
  FOR EACH STATEMENT EXECUTE FUNCTION platform_private.block_domain_delete();
CREATE TRIGGER notifications_no_delete
  BEFORE DELETE ON platform.notifications
  FOR EACH ROW EXECUTE FUNCTION platform_private.block_domain_delete();
CREATE TRIGGER notifications_no_truncate
  BEFORE TRUNCATE ON platform.notifications
  FOR EACH STATEMENT EXECUTE FUNCTION platform_private.block_domain_delete();

-- Evidence and intent records are append-only. Delivery intent itself has no
-- sent/delivered transition in P2E.
CREATE TRIGGER document_validation_events_append_only
  BEFORE UPDATE OR DELETE ON platform.document_validation_events
  FOR EACH ROW EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER document_validation_events_no_truncate
  BEFORE TRUNCATE ON platform.document_validation_events
  FOR EACH STATEMENT EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER document_reviews_append_only
  BEFORE UPDATE OR DELETE ON platform.document_reviews
  FOR EACH ROW EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER document_reviews_no_truncate
  BEFORE TRUNCATE ON platform.document_reviews
  FOR EACH STATEMENT EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER document_access_events_append_only
  BEFORE UPDATE OR DELETE ON platform.document_access_events
  FOR EACH ROW EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER document_access_events_no_truncate
  BEFORE TRUNCATE ON platform.document_access_events
  FOR EACH STATEMENT EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER payment_events_append_only
  BEFORE UPDATE OR DELETE ON platform.payment_events
  FOR EACH ROW EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER payment_events_no_truncate
  BEFORE TRUNCATE ON platform.payment_events
  FOR EACH STATEMENT EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER payment_evidence_append_only
  BEFORE UPDATE OR DELETE ON platform.payment_evidence
  FOR EACH ROW EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER payment_evidence_no_truncate
  BEFORE TRUNCATE ON platform.payment_evidence
  FOR EACH STATEMENT EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER stop_factor_events_append_only
  BEFORE UPDATE OR DELETE ON platform.stop_factor_events
  FOR EACH ROW EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER stop_factor_events_no_truncate
  BEFORE TRUNCATE ON platform.stop_factor_events
  FOR EACH STATEMENT EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER notification_consent_events_append_only
  BEFORE UPDATE OR DELETE ON platform.notification_consent_events
  FOR EACH ROW EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER notification_consent_events_no_truncate
  BEFORE TRUNCATE ON platform.notification_consent_events
  FOR EACH STATEMENT EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER notification_delivery_intents_append_only
  BEFORE UPDATE OR DELETE ON platform.notification_delivery_intents
  FOR EACH ROW EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER notification_delivery_intents_no_truncate
  BEFORE TRUNCATE ON platform.notification_delivery_intents
  FOR EACH STATEMENT EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER notification_events_append_only
  BEFORE UPDATE OR DELETE ON platform.notification_events
  FOR EACH ROW EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER notification_events_no_truncate
  BEFORE TRUNCATE ON platform.notification_events
  FOR EACH STATEMENT EXECUTE FUNCTION platform_private.block_append_only_mutation();

-- P2E publishes immutable v3 bundles by cloning v2 and adding only the
-- document, finance and individual-notification capabilities below.
INSERT INTO platform.permission_definitions (
  permission_key,
  description
)
VALUES
  ('document.read.full', 'Read full assigned document metadata and evidence'),
  ('document.manage', 'Create assigned document requirements and slots'),
  ('document.review', 'Review an assigned current document version'),
  ('document.read.sales', 'Read a fixed pre-contract document checklist'),
  ('document.read.self', 'Read fixed self-only Portal document projections'),
  ('finance.read.full', 'Read full organization-scoped finance records'),
  ('finance.manage', 'Create manual finance obligations'),
  ('finance.event.confirm', 'Confirm a manual payment or refund with evidence'),
  ('finance.stop.manage', 'Create and resolve finance stop factors'),
  ('finance.read.summary', 'Read fixed non-sensitive case finance summaries'),
  ('finance.read.self', 'Read fixed self-only Portal finance projections'),
  ('notification.create', 'Create one scoped individual notification'),
  ('notification.read.self', 'Read and acknowledge own notifications'),
  ('notification.consent.self', 'Manage own individual WhatsApp consent');

INSERT INTO platform.role_bundle_versions (
  id,
  role,
  version,
  status,
  label
)
VALUES
  (
    '00000000-0000-4000-8000-000000000201',
    'admin',
    3,
    'draft',
    'Admin v3 documents finance notifications'
  ),
  (
    '00000000-0000-4000-8000-000000000202',
    'sales',
    3,
    'draft',
    'Sales v3 documents finance notifications'
  ),
  (
    '00000000-0000-4000-8000-000000000203',
    'curator',
    3,
    'draft',
    'Curator v3 documents finance notifications'
  ),
  (
    '00000000-0000-4000-8000-000000000204',
    'finance',
    3,
    'draft',
    'Finance v3 documents finance notifications'
  ),
  (
    '00000000-0000-4000-8000-000000000205',
    'student',
    3,
    'draft',
    'Student v3 documents finance notifications'
  );

INSERT INTO platform.role_bundle_permissions (
  bundle_id,
  bundle_role,
  permission_key
)
SELECT
  v3.id,
  v3.role,
  v2_permission.permission_key
FROM platform.role_bundle_versions AS v3
JOIN platform.role_bundle_versions AS v2
  ON v2.role = v3.role
  AND v2.version = 2
  AND v2.status = 'published'
JOIN platform.role_bundle_permissions AS v2_permission
  ON v2_permission.bundle_id = v2.id
  AND v2_permission.bundle_role = v2.role
WHERE v3.version = 3;

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
WHERE bundle.version = 3
  AND (
    bundle.role = 'admin'
    OR (
      bundle.role = 'sales'
      AND permission.permission_key IN (
        'document.read.sales',
        'finance.read.summary',
        'notification.create',
        'notification.read.self',
        'notification.consent.self'
      )
    )
    OR (
      bundle.role = 'curator'
      AND permission.permission_key IN (
        'document.read.full',
        'document.manage',
        'document.review',
        'finance.read.summary',
        'notification.create',
        'notification.read.self',
        'notification.consent.self'
      )
    )
    OR (
      bundle.role = 'finance'
      AND permission.permission_key IN (
        'finance.read.full',
        'finance.manage',
        'finance.event.confirm',
        'finance.stop.manage',
        'notification.create',
        'notification.read.self',
        'notification.consent.self'
      )
    )
    OR (
      bundle.role = 'student'
      AND permission.permission_key IN (
        'document.read.self',
        'finance.read.self',
        'notification.read.self',
        'notification.consent.self'
      )
    )
  )
  AND permission.permission_key IN (
    'document.read.full',
    'document.manage',
    'document.review',
    'document.read.sales',
    'document.read.self',
    'finance.read.full',
    'finance.manage',
    'finance.event.confirm',
    'finance.stop.manage',
    'finance.read.summary',
    'finance.read.self',
    'notification.create',
    'notification.read.self',
    'notification.consent.self'
  );

UPDATE platform.role_bundle_versions
SET
  status = 'published',
  published_at = statement_timestamp()
WHERE version = 3;

CREATE TEMPORARY TABLE p2e_membership_bundle_upgrades
ON COMMIT DROP
AS
SELECT
  membership.organization_id,
  membership.id AS membership_id,
  membership.profile_id,
  membership."current_role" AS business_role,
  membership.current_bundle_id AS previous_bundle_id,
  v3.id AS new_bundle_id,
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
  ON v2.id = membership.current_bundle_id
  AND v2.role = membership."current_role"
  AND v2.version = 2
  AND v2.status = 'published'
JOIN platform.role_bundle_versions AS v3
  ON v3.role = membership."current_role"
  AND v3.version = 3
  AND v3.status = 'published'
WHERE membership."current_role" IS NOT NULL
  AND membership.current_bundle_id IS NOT NULL;

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
  'P2E immutable RBAC bundle upgrade',
  upgrade.request_id
FROM p2e_membership_bundle_upgrades AS upgrade;

UPDATE platform.organization_memberships AS membership
SET current_bundle_id = upgrade.new_bundle_id
FROM p2e_membership_bundle_upgrades AS upgrade
WHERE membership.organization_id = upgrade.organization_id
  AND membership.id = upgrade.membership_id;

UPDATE platform.profiles AS profile
SET access_version = profile.access_version + 1
WHERE profile.id IN (
  SELECT DISTINCT upgrade.profile_id
  FROM p2e_membership_bundle_upgrades AS upgrade
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
  'migration:043_platform_documents_finance_notifications',
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
  'P2E immutable RBAC bundle upgrade',
  upgrade.request_id
FROM p2e_membership_bundle_upgrades AS upgrade
JOIN platform.profiles AS profile
  ON profile.id = upgrade.profile_id;

CREATE OR REPLACE FUNCTION platform_private.lock_p2e_request(
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
      'evo:p2e:request:' || p_request_id::TEXT,
      0
    )
  );
END
$$;

REVOKE ALL ON FUNCTION platform_private.lock_p2e_request(UUID)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

CREATE OR REPLACE FUNCTION platform_private.membership_has_active_scope(
  p_organization_id UUID,
  p_membership_id UUID,
  p_scope_kind platform.scope_kind,
  p_scope_key UUID
)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM platform.record_scopes AS scope
    JOIN platform.membership_scope_assignments AS assignment
      ON assignment.organization_id = scope.organization_id
      AND assignment.scope_id = scope.id
      AND assignment.scope_version = scope.scope_version
    WHERE scope.organization_id = p_organization_id
      AND scope.scope_kind = p_scope_kind
      AND scope.scope_key = p_scope_key
      AND scope.is_active
      AND assignment.membership_id = p_membership_id
      AND assignment.granted
      AND NOT EXISTS (
        SELECT 1
        FROM platform.membership_scope_assignments AS later_assignment
        WHERE later_assignment.organization_id =
            assignment.organization_id
          AND later_assignment.membership_id = assignment.membership_id
          AND later_assignment.scope_id = assignment.scope_id
          AND later_assignment.assignment_version >
            assignment.assignment_version
      )
  )
$$;

REVOKE ALL ON FUNCTION platform_private.membership_has_active_scope(
  UUID,
  UUID,
  platform.scope_kind,
  UUID
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

CREATE OR REPLACE FUNCTION platform_private.require_p2e_admin_actor(
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
DECLARE
  actor RECORD;
BEGIN
  SELECT *
  INTO actor
  FROM platform_private.require_domain_actor(
    p_organization_id,
    p_permission_key
  );

  IF actor.actor_role <> 'admin'
    OR NOT private.platform_has_scope(
      p_organization_id,
      'organization',
      p_organization_id
    )
  THEN
    RAISE EXCEPTION
      'Active organization-scoped Admin permission is required'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY SELECT
    actor.actor_profile_id,
    actor.actor_membership_id,
    actor.actor_auth_user_id,
    actor.actor_role;
END
$$;

REVOKE ALL ON FUNCTION platform_private.require_p2e_admin_actor(UUID, TEXT)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

CREATE OR REPLACE FUNCTION platform_private.require_finance_actor(
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
DECLARE
  actor RECORD;
BEGIN
  SELECT *
  INTO actor
  FROM platform_private.require_domain_actor(
    p_organization_id,
    p_permission_key
  );

  IF actor.actor_role NOT IN ('admin', 'finance')
    OR NOT private.platform_has_scope(
      p_organization_id,
      'organization',
      p_organization_id
    )
  THEN
    RAISE EXCEPTION
      'Active organization-scoped Admin or Finance permission is required'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY SELECT
    actor.actor_profile_id,
    actor.actor_membership_id,
    actor.actor_auth_user_id,
    actor.actor_role;
END
$$;

REVOKE ALL ON FUNCTION platform_private.require_finance_actor(UUID, TEXT)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

CREATE OR REPLACE FUNCTION private.platform_can_read_document_full(
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
    JOIN platform.profiles AS profile
      ON profile.id = membership.profile_id
    WHERE student_case.organization_id = p_organization_id
      AND student_case.id = p_student_case_id
      AND profile.auth_user_id = (SELECT auth.uid())
      AND private.platform_has_permission(
        student_case.organization_id,
        'document.read.full'
      )
      AND (
        (
          membership."current_role" = 'admin'
          AND private.platform_has_scope(
            student_case.organization_id,
            'organization',
            student_case.organization_id
          )
        )
        OR (
          membership."current_role" = 'curator'
          AND student_case.state IN ('active', 'closed')
          AND student_case.current_curator_membership_id = membership.id
          AND private.platform_has_scope(
            student_case.organization_id,
            'student_case',
            student_case.id
          )
        )
      )
  )
$$;

REVOKE ALL ON FUNCTION private.platform_can_read_document_full(UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE
  ON FUNCTION private.platform_can_read_document_full(UUID, UUID)
  TO authenticated;

CREATE OR REPLACE FUNCTION private.platform_can_read_document_requirement(
  p_organization_id UUID,
  p_requirement_id UUID
)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    (
      private.platform_has_permission(
        p_organization_id,
        'document.read.full'
      )
      AND (
        EXISTS (
          SELECT 1
          FROM platform.organization_memberships AS membership
          JOIN platform.profiles AS profile
            ON profile.id = membership.profile_id
          WHERE membership.organization_id = p_organization_id
            AND profile.auth_user_id = (SELECT auth.uid())
            AND membership."current_role" = 'admin'
            AND private.platform_has_scope(
              p_organization_id,
              'organization',
              p_organization_id
            )
        )
        OR EXISTS (
          SELECT 1
          FROM platform.document_slots AS slot
          WHERE slot.organization_id = p_organization_id
            AND slot.requirement_id = p_requirement_id
            AND private.platform_can_read_document_full(
              slot.organization_id,
              slot.student_case_id
            )
        )
      )
    )
$$;

REVOKE ALL ON FUNCTION private.platform_can_read_document_requirement(
  UUID,
  UUID
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE
  ON FUNCTION private.platform_can_read_document_requirement(UUID, UUID)
  TO authenticated;

CREATE OR REPLACE FUNCTION private.platform_can_read_finance_full(
  p_organization_id UUID
)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM platform.organization_memberships AS membership
    JOIN platform.profiles AS profile
      ON profile.id = membership.profile_id
    WHERE membership.organization_id = p_organization_id
      AND profile.auth_user_id = (SELECT auth.uid())
      AND membership."current_role" IN ('admin', 'finance')
      AND private.platform_has_permission(
        p_organization_id,
        'finance.read.full'
      )
      AND private.platform_has_scope(
        p_organization_id,
        'organization',
        p_organization_id
      )
  )
$$;

REVOKE ALL ON FUNCTION private.platform_can_read_finance_full(UUID)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE
  ON FUNCTION private.platform_can_read_finance_full(UUID)
  TO authenticated;

CREATE POLICY document_requirements_full_read
  ON platform.document_requirements
  FOR SELECT
  TO authenticated
  USING (
    (SELECT private.platform_can_read_document_requirement(
      organization_id,
      id
    ))
  );
CREATE POLICY document_slots_full_read
  ON platform.document_slots
  FOR SELECT
  TO authenticated
  USING (
    (SELECT private.platform_can_read_document_full(
      organization_id,
      student_case_id
    ))
  );
CREATE POLICY document_versions_full_read
  ON platform.document_versions
  FOR SELECT
  TO authenticated
  USING (
    (SELECT private.platform_can_read_document_full(
      organization_id,
      student_case_id
    ))
  );
CREATE POLICY document_validation_events_full_read
  ON platform.document_validation_events
  FOR SELECT
  TO authenticated
  USING (
    (SELECT private.platform_can_read_document_full(
      organization_id,
      student_case_id
    ))
  );
CREATE POLICY document_reviews_full_read
  ON platform.document_reviews
  FOR SELECT
  TO authenticated
  USING (
    (SELECT private.platform_can_read_document_full(
      organization_id,
      student_case_id
    ))
  );
CREATE POLICY document_access_events_full_read
  ON platform.document_access_events
  FOR SELECT
  TO authenticated
  USING (
    (SELECT private.platform_can_read_document_full(
      organization_id,
      student_case_id
    ))
  );

CREATE POLICY payment_obligations_full_read
  ON platform.payment_obligations
  FOR SELECT
  TO authenticated
  USING (
    (SELECT private.platform_can_read_finance_full(organization_id))
  );
CREATE POLICY payment_events_full_read
  ON platform.payment_events
  FOR SELECT
  TO authenticated
  USING (
    (SELECT private.platform_can_read_finance_full(organization_id))
  );
CREATE POLICY payment_evidence_full_read
  ON platform.payment_evidence
  FOR SELECT
  TO authenticated
  USING (
    (SELECT private.platform_can_read_finance_full(organization_id))
  );
CREATE POLICY stop_factors_full_read
  ON platform.stop_factors
  FOR SELECT
  TO authenticated
  USING (
    (SELECT private.platform_can_read_finance_full(organization_id))
  );
CREATE POLICY stop_factor_events_full_read
  ON platform.stop_factor_events
  FOR SELECT
  TO authenticated
  USING (
    (SELECT private.platform_can_read_finance_full(organization_id))
  );

CREATE OR REPLACE FUNCTION platform.create_document_requirement(
  p_organization_id UUID,
  p_target_country TEXT,
  p_target_degree TEXT,
  p_program_direction TEXT,
  p_checklist_version BIGINT,
  p_requirement_key TEXT,
  p_label TEXT,
  p_instructions TEXT,
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
  replayed JSONB;
  created_requirement_id UUID := gen_random_uuid();
  result JSONB;
  fixed_reason CONSTANT TEXT := 'Versioned document requirement created';
BEGIN
  PERFORM platform_private.lock_p2e_request(p_request_id);

  IF p_target_country IS NULL
    OR btrim(p_target_country) = ''
    OR p_target_degree IS NULL
    OR btrim(p_target_degree) = ''
    OR p_program_direction IS NULL
    OR btrim(p_program_direction) = ''
    OR p_checklist_version IS NULL
    OR p_checklist_version <= 0
    OR p_requirement_key IS NULL
    OR btrim(p_requirement_key) !~ '^[a-z][a-z0-9_.-]*$'
    OR p_label IS NULL
    OR btrim(p_label) = ''
    OR p_instructions IS NULL
    OR btrim(p_instructions) = ''
  THEN
    RAISE EXCEPTION
      'Complete versioned document requirement fields are required'
      USING ERRCODE = '22023';
  END IF;

  SELECT *
  INTO actor
  FROM platform_private.require_p2e_admin_actor(
    p_organization_id,
    'document.manage'
  );

  replayed := platform_private.replay_audit(
    p_request_id,
    'document.requirement.create',
    'document_requirement',
    NULL,
    fixed_reason,
    jsonb_build_object(
      'organization_id', p_organization_id,
      'target_country', btrim(p_target_country),
      'target_degree', btrim(p_target_degree),
      'program_direction', btrim(p_program_direction),
      'checklist_version', p_checklist_version,
      'requirement_key', btrim(p_requirement_key),
      'label', btrim(p_label),
      'instructions', btrim(p_instructions),
      'status', 'active'
    )
  );
  IF replayed IS NOT NULL THEN
    RETURN replayed;
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      'evo:p2e:document-requirement:'
        || p_organization_id::TEXT
        || ':'
        || btrim(p_target_country)
        || ':'
        || btrim(p_target_degree)
        || ':'
        || btrim(p_program_direction)
        || ':'
        || p_checklist_version::TEXT
        || ':'
        || btrim(p_requirement_key),
      0
    )
  );

  SELECT *
  INTO actor
  FROM platform_private.require_p2e_admin_actor(
    p_organization_id,
    'document.manage'
  );

  replayed := platform_private.replay_audit(
    p_request_id,
    'document.requirement.create',
    'document_requirement',
    NULL,
    fixed_reason,
    jsonb_build_object(
      'organization_id', p_organization_id,
      'target_country', btrim(p_target_country),
      'target_degree', btrim(p_target_degree),
      'program_direction', btrim(p_program_direction),
      'checklist_version', p_checklist_version,
      'requirement_key', btrim(p_requirement_key),
      'label', btrim(p_label),
      'instructions', btrim(p_instructions),
      'status', 'active'
    )
  );
  IF replayed IS NOT NULL THEN
    RETURN replayed;
  END IF;

  INSERT INTO platform.document_requirements (
    id,
    organization_id,
    target_country,
    target_degree,
    program_direction,
    checklist_version,
    requirement_key,
    label,
    instructions,
    status,
    created_by_membership_id
  )
  VALUES (
    created_requirement_id,
    p_organization_id,
    btrim(p_target_country),
    btrim(p_target_degree),
    btrim(p_program_direction),
    p_checklist_version,
    btrim(p_requirement_key),
    btrim(p_label),
    btrim(p_instructions),
    'active',
    actor.actor_membership_id
  );

  result := jsonb_build_object(
    'organization_id', p_organization_id,
    'document_requirement_id', created_requirement_id,
    'target_country', btrim(p_target_country),
    'target_degree', btrim(p_target_degree),
    'program_direction', btrim(p_program_direction),
    'checklist_version', p_checklist_version,
    'requirement_key', btrim(p_requirement_key),
    'label', btrim(p_label),
    'instructions', btrim(p_instructions),
    'status', 'active'
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
    'document.requirement.create',
    'document_requirement',
    created_requirement_id,
    NULL,
    result,
    fixed_reason,
    p_request_id
  );

  RETURN result;
END
$$;

CREATE OR REPLACE FUNCTION platform.retire_document_requirement(
  p_organization_id UUID,
  p_document_requirement_id UUID,
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
  requirement_row platform.document_requirements%ROWTYPE;
  replayed JSONB;
  retired_at_value TIMESTAMPTZ := statement_timestamp();
  result JSONB;
BEGIN
  PERFORM platform_private.lock_p2e_request(p_request_id);

  IF p_document_requirement_id IS NULL
    OR p_reason IS NULL
    OR char_length(btrim(p_reason)) NOT BETWEEN 1 AND 1000
  THEN
    RAISE EXCEPTION
      'Requirement and retirement reason are required'
      USING ERRCODE = '22023';
  END IF;

  SELECT *
  INTO actor
  FROM platform_private.require_p2e_admin_actor(
    p_organization_id,
    'document.manage'
  );

  replayed := platform_private.replay_audit(
    p_request_id,
    'document.requirement.retire',
    'document_requirement',
    p_document_requirement_id,
    btrim(p_reason),
    jsonb_build_object(
      'organization_id', p_organization_id,
      'document_requirement_id', p_document_requirement_id,
      'status', 'retired'
    )
  );
  IF replayed IS NOT NULL THEN
    RETURN replayed;
  END IF;

  SELECT *
  INTO requirement_row
  FROM platform.document_requirements AS requirement
  WHERE requirement.organization_id = p_organization_id
    AND requirement.id = p_document_requirement_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Document requirement is unavailable'
      USING ERRCODE = '42501';
  END IF;

  SELECT *
  INTO actor
  FROM platform_private.require_p2e_admin_actor(
    p_organization_id,
    'document.manage'
  );

  replayed := platform_private.replay_audit(
    p_request_id,
    'document.requirement.retire',
    'document_requirement',
    p_document_requirement_id,
    btrim(p_reason),
    jsonb_build_object(
      'organization_id', p_organization_id,
      'document_requirement_id', p_document_requirement_id,
      'status', 'retired'
    )
  );
  IF replayed IS NOT NULL THEN
    RETURN replayed;
  END IF;

  IF requirement_row.status <> 'active' THEN
    RAISE EXCEPTION
      'Only an active document requirement can be retired'
      USING ERRCODE = '22023';
  END IF;

  UPDATE platform.document_requirements AS requirement
  SET
    status = 'retired',
    retired_at = retired_at_value
  WHERE requirement.organization_id = p_organization_id
    AND requirement.id = p_document_requirement_id;

  result := jsonb_build_object(
    'organization_id', p_organization_id,
    'document_requirement_id', p_document_requirement_id,
    'status', 'retired',
    'retired_at', retired_at_value
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
    'document.requirement.retire',
    'document_requirement',
    p_document_requirement_id,
    jsonb_build_object(
      'status', requirement_row.status,
      'retired_at', requirement_row.retired_at
    ),
    result,
    btrim(p_reason),
    p_request_id
  );

  RETURN result;
END
$$;

CREATE OR REPLACE FUNCTION platform.create_document_slot(
  p_organization_id UUID,
  p_student_case_id UUID,
  p_document_requirement_id UUID,
  p_deadline TIMESTAMPTZ,
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
  actor RECORD;
  target_case platform.student_cases%ROWTYPE;
  requirement_row platform.document_requirements%ROWTYPE;
  replayed JSONB;
  created_slot_id UUID := gen_random_uuid();
  result JSONB;
  fixed_reason CONSTANT TEXT := 'Assigned document slot created';
BEGIN
  PERFORM platform_private.lock_p2e_request(p_request_id);

  IF p_student_case_id IS NULL
    OR p_document_requirement_id IS NULL
    OR (
      p_next_action IS NOT NULL
      AND btrim(p_next_action) = ''
    )
  THEN
    RAISE EXCEPTION
      'Case, requirement and normalized next action are required'
      USING ERRCODE = '22023';
  END IF;

  SELECT *
  INTO actor
  FROM platform_private.require_case_operator(
    p_organization_id,
    p_student_case_id,
    'document.manage'
  );

  replayed := platform_private.replay_audit(
    p_request_id,
    'document.slot.create',
    'document_slot',
    NULL,
    fixed_reason,
    jsonb_build_object(
      'organization_id', p_organization_id,
      'student_case_id', p_student_case_id,
      'document_requirement_id', p_document_requirement_id,
      'deadline', p_deadline,
      'next_action', NULLIF(btrim(p_next_action), ''),
      'status', 'required'
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
  INTO requirement_row
  FROM platform.document_requirements AS requirement
  WHERE requirement.organization_id = p_organization_id
    AND requirement.id = p_document_requirement_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Document requirement is unavailable'
      USING ERRCODE = '42501';
  END IF;

  SELECT *
  INTO actor
  FROM platform_private.require_case_operator(
    p_organization_id,
    p_student_case_id,
    'document.manage'
  );

  replayed := platform_private.replay_audit(
    p_request_id,
    'document.slot.create',
    'document_slot',
    NULL,
    fixed_reason,
    jsonb_build_object(
      'organization_id', p_organization_id,
      'student_case_id', p_student_case_id,
      'document_requirement_id', p_document_requirement_id,
      'deadline', p_deadline,
      'next_action', NULLIF(btrim(p_next_action), ''),
      'status', 'required'
    )
  );
  IF replayed IS NOT NULL THEN
    RETURN replayed;
  END IF;

  IF requirement_row.status <> 'active'
    OR requirement_row.target_country <> target_case.target_country
    OR requirement_row.target_degree <> target_case.target_degree
    OR requirement_row.program_direction IS DISTINCT FROM
      target_case.program_direction
  THEN
    RAISE EXCEPTION
      'Active requirement route must match the student case route'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO platform.document_slots (
    id,
    organization_id,
    student_case_id,
    requirement_id,
    status,
    deadline,
    next_action,
    created_by_membership_id
  )
  VALUES (
    created_slot_id,
    p_organization_id,
    p_student_case_id,
    p_document_requirement_id,
    'required',
    p_deadline,
    NULLIF(btrim(p_next_action), ''),
    actor.actor_membership_id
  );

  result := jsonb_build_object(
    'organization_id', p_organization_id,
    'document_slot_id', created_slot_id,
    'student_case_id', p_student_case_id,
    'document_requirement_id', p_document_requirement_id,
    'deadline', p_deadline,
    'next_action', NULLIF(btrim(p_next_action), ''),
    'status', 'required'
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
    'document.slot.create',
    'document_slot',
    created_slot_id,
    NULL,
    result,
    fixed_reason,
    p_request_id
  );

  RETURN result;
END
$$;

CREATE OR REPLACE FUNCTION platform.record_document_version_metadata(
  p_organization_id UUID,
  p_document_slot_id UUID,
  p_submitted_by_membership_id UUID,
  p_original_filename TEXT,
  p_declared_mime_type TEXT,
  p_byte_size BIGINT,
  p_sha256_hex TEXT,
  p_ingest_evidence_ref TEXT,
  p_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  preliminary_case_id UUID;
  target_case platform.student_cases%ROWTYPE;
  slot_row platform.document_slots%ROWTYPE;
  submitter RECORD;
  replayed JSONB;
  created_version_id UUID := gen_random_uuid();
  next_version_no BIGINT;
  result JSONB;
  fixed_reason CONSTANT TEXT :=
    'Pending document metadata recorded without Storage claim';
BEGIN
  IF (SELECT auth.jwt() ->> 'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION
      'Service role is required'
      USING ERRCODE = '42501';
  END IF;

  PERFORM platform_private.lock_p2e_request(p_request_id);

  IF p_document_slot_id IS NULL
    OR p_submitted_by_membership_id IS NULL
    OR p_original_filename IS NULL
    OR btrim(p_original_filename) = ''
    OR lower(btrim(p_declared_mime_type)) NOT IN (
      'application/pdf',
      'image/jpeg',
      'image/png'
    )
    OR p_byte_size IS NULL
    OR p_byte_size NOT BETWEEN 1 AND 26214400
    OR lower(btrim(p_sha256_hex)) !~ '^[0-9a-f]{64}$'
    OR p_ingest_evidence_ref IS NULL
    OR btrim(p_ingest_evidence_ref) = ''
  THEN
    RAISE EXCEPTION
      'Valid pending document metadata is required'
      USING ERRCODE = '22023';
  END IF;

  replayed := platform_private.replay_audit(
    p_request_id,
    'document.version.record',
    'document_version',
    NULL,
    fixed_reason,
    jsonb_build_object(
      'organization_id', p_organization_id,
      'document_slot_id', p_document_slot_id,
      'submitted_by_membership_id', p_submitted_by_membership_id,
      'original_filename', btrim(p_original_filename),
      'declared_mime_type', lower(btrim(p_declared_mime_type)),
      'byte_size', p_byte_size,
      'sha256_hex', lower(btrim(p_sha256_hex)),
      'ingest_evidence_ref', btrim(p_ingest_evidence_ref),
      'integrity_status', 'pending',
      'malware_status', 'pending'
    )
  );
  IF replayed IS NOT NULL THEN
    RETURN replayed;
  END IF;

  SELECT slot.student_case_id
  INTO preliminary_case_id
  FROM platform.document_slots AS slot
  WHERE slot.organization_id = p_organization_id
    AND slot.id = p_document_slot_id;

  IF preliminary_case_id IS NULL THEN
    RAISE EXCEPTION
      'Document slot is unavailable'
      USING ERRCODE = '42501';
  END IF;

  SELECT *
  INTO target_case
  FROM platform.student_cases AS student_case
  WHERE student_case.organization_id = p_organization_id
    AND student_case.id = preliminary_case_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Student case is unavailable'
      USING ERRCODE = '42501';
  END IF;

  SELECT *
  INTO slot_row
  FROM platform.document_slots AS slot
  WHERE slot.organization_id = p_organization_id
    AND slot.id = p_document_slot_id
    AND slot.student_case_id = target_case.id
  FOR UPDATE;

  IF NOT FOUND OR slot_row.status = 'approved' THEN
    RAISE EXCEPTION
      'Document slot is unavailable for a new version'
      USING ERRCODE = '42501';
  END IF;

  SELECT
    membership.id AS membership_id,
    membership."current_role" AS business_role,
    profile.id AS profile_id
  INTO submitter
  FROM platform.organization_memberships AS membership
  JOIN platform.profiles AS profile
    ON profile.id = membership.profile_id
  JOIN platform.organizations AS organization
    ON organization.id = membership.organization_id
  JOIN platform.role_bundle_versions AS bundle
    ON bundle.id = membership.current_bundle_id
    AND bundle.role = membership."current_role"
  WHERE membership.organization_id = p_organization_id
    AND membership.id = p_submitted_by_membership_id
    AND membership.status = 'active'
    AND profile.status = 'active'
    AND organization.status = 'active'
    AND bundle.status = 'published'
    AND (
      (
        membership."current_role" = 'student'
        AND membership.id = target_case.student_membership_id
        AND target_case.state IN ('active', 'closed')
        AND target_case.portal_activated_at IS NOT NULL
        AND platform_private.membership_has_active_scope(
          p_organization_id,
          membership.id,
          'student_case',
          target_case.id
        )
      )
      OR (
        membership."current_role" = 'curator'
        AND membership.id = target_case.current_curator_membership_id
        AND target_case.state IN ('active', 'closed')
        AND platform_private.membership_has_active_scope(
          p_organization_id,
          membership.id,
          'student_case',
          target_case.id
        )
      )
      OR (
        membership."current_role" = 'admin'
        AND platform_private.membership_has_active_scope(
          p_organization_id,
          membership.id,
          'organization',
          p_organization_id
        )
      )
    )
  FOR UPDATE OF membership, profile, organization;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Live scoped document submitter is required'
      USING ERRCODE = '42501';
  END IF;

  replayed := platform_private.replay_audit(
    p_request_id,
    'document.version.record',
    'document_version',
    NULL,
    fixed_reason,
    jsonb_build_object(
      'organization_id', p_organization_id,
      'document_slot_id', p_document_slot_id,
      'submitted_by_membership_id', p_submitted_by_membership_id,
      'original_filename', btrim(p_original_filename),
      'declared_mime_type', lower(btrim(p_declared_mime_type)),
      'byte_size', p_byte_size,
      'sha256_hex', lower(btrim(p_sha256_hex)),
      'ingest_evidence_ref', btrim(p_ingest_evidence_ref),
      'integrity_status', 'pending',
      'malware_status', 'pending'
    )
  );
  IF replayed IS NOT NULL THEN
    RETURN replayed;
  END IF;

  next_version_no := COALESCE(slot_row.current_version_no, 0) + 1;

  INSERT INTO platform.document_versions (
    id,
    organization_id,
    student_case_id,
    document_slot_id,
    version_no,
    original_filename,
    declared_mime_type,
    byte_size,
    sha256_hex,
    ingest_evidence_ref,
    submitted_by_membership_id,
    integrity_status,
    malware_status
  )
  VALUES (
    created_version_id,
    p_organization_id,
    target_case.id,
    p_document_slot_id,
    next_version_no,
    btrim(p_original_filename),
    lower(btrim(p_declared_mime_type)),
    p_byte_size,
    lower(btrim(p_sha256_hex)),
    btrim(p_ingest_evidence_ref),
    p_submitted_by_membership_id,
    'pending',
    'pending'
  );

  UPDATE platform.document_slots AS slot
  SET
    status = 'submitted',
    current_version_id = created_version_id,
    current_version_no = next_version_no
  WHERE slot.organization_id = p_organization_id
    AND slot.id = p_document_slot_id;

  result := jsonb_build_object(
    'organization_id', p_organization_id,
    'document_version_id', created_version_id,
    'document_slot_id', p_document_slot_id,
    'student_case_id', target_case.id,
    'version_no', next_version_no,
    'submitted_by_membership_id', p_submitted_by_membership_id,
    'original_filename', btrim(p_original_filename),
    'declared_mime_type', lower(btrim(p_declared_mime_type)),
    'byte_size', p_byte_size,
    'sha256_hex', lower(btrim(p_sha256_hex)),
    'ingest_evidence_ref', btrim(p_ingest_evidence_ref),
    'integrity_status', 'pending',
    'malware_status', 'pending',
    'storage_proof', FALSE
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
    'service:platform-document-metadata',
    'document.version.record',
    'document_version',
    created_version_id,
    NULL,
    result,
    fixed_reason,
    p_request_id
  );

  RETURN result;
END
$$;

CREATE OR REPLACE FUNCTION platform.attest_document_validation(
  p_organization_id UUID,
  p_document_version_id UUID,
  p_integrity_status platform.document_integrity_status,
  p_malware_status platform.document_malware_status,
  p_validation_source TEXT,
  p_evidence_ref TEXT,
  p_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  preliminary_case_id UUID;
  target_case platform.student_cases%ROWTYPE;
  version_row platform.document_versions%ROWTYPE;
  replayed JSONB;
  validation_time TIMESTAMPTZ := statement_timestamp();
  result JSONB;
  fixed_reason CONSTANT TEXT :=
    'Document validation metadata attested without scanner claim';
BEGIN
  IF (SELECT auth.jwt() ->> 'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION
      'Service role is required'
      USING ERRCODE = '42501';
  END IF;

  PERFORM platform_private.lock_p2e_request(p_request_id);

  IF p_document_version_id IS NULL
    OR p_integrity_status IS NULL
    OR p_malware_status IS NULL
    OR p_validation_source IS NULL
    OR btrim(p_validation_source) = ''
    OR p_evidence_ref IS NULL
    OR btrim(p_evidence_ref) = ''
  THEN
    RAISE EXCEPTION
      'Complete validation metadata and evidence are required'
      USING ERRCODE = '22023';
  END IF;

  replayed := platform_private.replay_audit(
    p_request_id,
    'document.validation.attest',
    'document_version',
    p_document_version_id,
    fixed_reason,
    jsonb_build_object(
      'organization_id', p_organization_id,
      'document_version_id', p_document_version_id,
      'integrity_status', p_integrity_status,
      'malware_status', p_malware_status,
      'validation_source', btrim(p_validation_source),
      'evidence_ref', btrim(p_evidence_ref)
    )
  );
  IF replayed IS NOT NULL THEN
    RETURN replayed;
  END IF;

  SELECT version.student_case_id
  INTO preliminary_case_id
  FROM platform.document_versions AS version
  WHERE version.organization_id = p_organization_id
    AND version.id = p_document_version_id;

  IF preliminary_case_id IS NULL THEN
    RAISE EXCEPTION
      'Document version is unavailable'
      USING ERRCODE = '42501';
  END IF;

  SELECT *
  INTO target_case
  FROM platform.student_cases AS student_case
  WHERE student_case.organization_id = p_organization_id
    AND student_case.id = preliminary_case_id
  FOR UPDATE;

  SELECT *
  INTO version_row
  FROM platform.document_versions AS version
  WHERE version.organization_id = p_organization_id
    AND version.id = p_document_version_id
    AND version.student_case_id = target_case.id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Document version is unavailable'
      USING ERRCODE = '42501';
  END IF;

  replayed := platform_private.replay_audit(
    p_request_id,
    'document.validation.attest',
    'document_version',
    p_document_version_id,
    fixed_reason,
    jsonb_build_object(
      'organization_id', p_organization_id,
      'document_version_id', p_document_version_id,
      'integrity_status', p_integrity_status,
      'malware_status', p_malware_status,
      'validation_source', btrim(p_validation_source),
      'evidence_ref', btrim(p_evidence_ref)
    )
  );
  IF replayed IS NOT NULL THEN
    RETURN replayed;
  END IF;

  IF version_row.integrity_status = p_integrity_status
    AND version_row.malware_status = p_malware_status
  THEN
    RAISE EXCEPTION
      'Document validation attestation must change state'
      USING ERRCODE = '22023';
  END IF;

  UPDATE platform.document_versions AS version
  SET
    integrity_status = p_integrity_status,
    malware_status = p_malware_status,
    validation_updated_at = validation_time
  WHERE version.organization_id = p_organization_id
    AND version.id = p_document_version_id;

  INSERT INTO platform.document_validation_events (
    organization_id,
    student_case_id,
    document_slot_id,
    document_version_id,
    previous_integrity_status,
    new_integrity_status,
    previous_malware_status,
    new_malware_status,
    validation_source,
    evidence_ref,
    service_principal,
    request_id
  )
  VALUES (
    p_organization_id,
    version_row.student_case_id,
    version_row.document_slot_id,
    p_document_version_id,
    version_row.integrity_status,
    p_integrity_status,
    version_row.malware_status,
    p_malware_status,
    btrim(p_validation_source),
    btrim(p_evidence_ref),
    'service:platform-document-validation',
    p_request_id
  );

  result := jsonb_build_object(
    'organization_id', p_organization_id,
    'document_version_id', p_document_version_id,
    'document_slot_id', version_row.document_slot_id,
    'student_case_id', version_row.student_case_id,
    'integrity_status', p_integrity_status,
    'malware_status', p_malware_status,
    'validation_source', btrim(p_validation_source),
    'evidence_ref', btrim(p_evidence_ref),
    'validation_updated_at', validation_time,
    'scanner_proof', FALSE
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
    'service:platform-document-validation',
    'document.validation.attest',
    'document_version',
    p_document_version_id,
    jsonb_build_object(
      'integrity_status', version_row.integrity_status,
      'malware_status', version_row.malware_status,
      'validation_updated_at', version_row.validation_updated_at
    ),
    result,
    fixed_reason,
    p_request_id
  );

  RETURN result;
END
$$;

CREATE OR REPLACE FUNCTION platform.review_document_version(
  p_organization_id UUID,
  p_document_version_id UUID,
  p_decision platform.document_review_decision,
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
  preliminary_version RECORD;
  actor RECORD;
  target_case platform.student_cases%ROWTYPE;
  slot_row platform.document_slots%ROWTYPE;
  version_row platform.document_versions%ROWTYPE;
  replayed JSONB;
  result JSONB;
  fixed_reason CONSTANT TEXT := 'Current document version reviewed';
BEGIN
  PERFORM platform_private.lock_p2e_request(p_request_id);

  IF p_document_version_id IS NULL
    OR p_decision IS NULL
    OR (
      p_decision IN ('correction_required', 'rejected')
      AND (
        p_reason IS NULL
        OR btrim(p_reason) = ''
      )
    )
    OR (
      p_reason IS NOT NULL
      AND char_length(btrim(p_reason)) > 2000
    )
  THEN
    RAISE EXCEPTION
      'Decision and required negative-review reason are required'
      USING ERRCODE = '22023';
  END IF;

  SELECT
    version.student_case_id,
    version.document_slot_id
  INTO preliminary_version
  FROM platform.document_versions AS version
  WHERE version.organization_id = p_organization_id
    AND version.id = p_document_version_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Document version is unavailable'
      USING ERRCODE = '42501';
  END IF;

  SELECT *
  INTO actor
  FROM platform_private.require_case_operator(
    p_organization_id,
    preliminary_version.student_case_id,
    'document.review'
  );

  replayed := platform_private.replay_audit(
    p_request_id,
    'document.version.review',
    'document_version',
    p_document_version_id,
    fixed_reason,
    jsonb_build_object(
      'organization_id', p_organization_id,
      'document_version_id', p_document_version_id,
      'decision', p_decision,
      'reason', NULLIF(btrim(p_reason), '')
    )
  );
  IF replayed IS NOT NULL THEN
    RETURN replayed;
  END IF;

  SELECT *
  INTO target_case
  FROM platform.student_cases AS student_case
  WHERE student_case.organization_id = p_organization_id
    AND student_case.id = preliminary_version.student_case_id
  FOR UPDATE;

  SELECT *
  INTO slot_row
  FROM platform.document_slots AS slot
  WHERE slot.organization_id = p_organization_id
    AND slot.id = preliminary_version.document_slot_id
    AND slot.student_case_id = target_case.id
  FOR UPDATE;

  SELECT *
  INTO version_row
  FROM platform.document_versions AS version
  WHERE version.organization_id = p_organization_id
    AND version.id = p_document_version_id
    AND version.student_case_id = target_case.id
    AND version.document_slot_id = slot_row.id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Document version is unavailable'
      USING ERRCODE = '42501';
  END IF;

  SELECT *
  INTO actor
  FROM platform_private.require_case_operator(
    p_organization_id,
    target_case.id,
    'document.review'
  );

  replayed := platform_private.replay_audit(
    p_request_id,
    'document.version.review',
    'document_version',
    p_document_version_id,
    fixed_reason,
    jsonb_build_object(
      'organization_id', p_organization_id,
      'document_version_id', p_document_version_id,
      'decision', p_decision,
      'reason', NULLIF(btrim(p_reason), '')
    )
  );
  IF replayed IS NOT NULL THEN
    RETURN replayed;
  END IF;

  IF slot_row.status <> 'submitted'
    OR slot_row.current_version_id <> p_document_version_id
    OR slot_row.current_version_no <> version_row.version_no
  THEN
    RAISE EXCEPTION
      'Only the current submitted document version can be reviewed'
      USING ERRCODE = '22023';
  END IF;

  IF p_decision = 'approved'
    AND (
      version_row.integrity_status <> 'verified'
      OR version_row.malware_status <> 'clean'
    )
  THEN
    RAISE EXCEPTION
      'Approval requires verified integrity and clean malware state'
      USING ERRCODE = '22023';
  END IF;

  UPDATE platform.document_slots AS slot
  SET status = p_decision::TEXT::platform.document_slot_status
  WHERE slot.organization_id = p_organization_id
    AND slot.id = slot_row.id;

  INSERT INTO platform.document_reviews (
    organization_id,
    student_case_id,
    document_slot_id,
    document_version_id,
    decision,
    reason,
    reviewer_membership_id,
    request_id
  )
  VALUES (
    p_organization_id,
    target_case.id,
    slot_row.id,
    p_document_version_id,
    p_decision,
    NULLIF(btrim(p_reason), ''),
    actor.actor_membership_id,
    p_request_id
  );

  result := jsonb_build_object(
    'organization_id', p_organization_id,
    'document_version_id', p_document_version_id,
    'document_slot_id', slot_row.id,
    'student_case_id', target_case.id,
    'decision', p_decision,
    'reason', NULLIF(btrim(p_reason), ''),
    'slot_status', p_decision
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
    'document.version.review',
    'document_version',
    p_document_version_id,
    jsonb_build_object(
      'slot_status', slot_row.status,
      'integrity_status', version_row.integrity_status,
      'malware_status', version_row.malware_status
    ),
    result,
    fixed_reason,
    p_request_id
  );

  RETURN result;
END
$$;

CREATE OR REPLACE FUNCTION platform.sales_document_checklist()
RETURNS TABLE (
  case_id UUID,
  document_slot_id UUID,
  requirement_key TEXT,
  requirement_label TEXT,
  instructions TEXT,
  checklist_version BIGINT,
  slot_status platform.document_slot_status,
  deadline TIMESTAMPTZ,
  next_action TEXT
)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    student_case.id,
    slot.id,
    requirement.requirement_key,
    requirement.label,
    requirement.instructions,
    requirement.checklist_version,
    slot.status,
    slot.deadline,
    slot.next_action
  FROM platform.student_cases AS student_case
  JOIN platform.organization_memberships AS membership
    ON membership.organization_id = student_case.organization_id
    AND membership.id = student_case.responsible_sales_membership_id
  JOIN platform.profiles AS profile
    ON profile.id = membership.profile_id
  JOIN platform.document_slots AS slot
    ON slot.organization_id = student_case.organization_id
    AND slot.student_case_id = student_case.id
  JOIN platform.document_requirements AS requirement
    ON requirement.organization_id = slot.organization_id
    AND requirement.id = slot.requirement_id
  WHERE profile.auth_user_id = (SELECT auth.uid())
    AND membership.status = 'active'
    AND membership."current_role" = 'sales'
    AND profile.status = 'active'
    AND student_case.state = 'pending'
    AND private.platform_has_permission(
      student_case.organization_id,
      'document.read.sales'
    )
    AND private.platform_has_scope(
      student_case.organization_id,
      'student_case',
      student_case.id
    )
  ORDER BY slot.deadline NULLS LAST, slot.id
$$;

CREATE OR REPLACE FUNCTION platform.student_portal_documents()
RETURNS TABLE (
  case_id UUID,
  document_slot_id UUID,
  requirement_key TEXT,
  requirement_label TEXT,
  instructions TEXT,
  slot_status platform.document_slot_status,
  deadline TIMESTAMPTZ,
  next_action TEXT,
  document_version_id UUID,
  version_no BIGINT,
  original_filename TEXT,
  declared_mime_type TEXT,
  byte_size BIGINT,
  submitted_at TIMESTAMPTZ,
  review_decision platform.document_review_decision,
  rework_reason TEXT,
  reviewed_at TIMESTAMPTZ
)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    slot.student_case_id,
    slot.id,
    requirement.requirement_key,
    requirement.label,
    requirement.instructions,
    slot.status,
    slot.deadline,
    slot.next_action,
    version.id,
    version.version_no,
    version.original_filename,
    version.declared_mime_type,
    version.byte_size,
    version.created_at,
    review.decision,
    CASE
      WHEN review.decision IN ('correction_required', 'rejected')
      THEN review.reason
      ELSE NULL
    END,
    review.created_at
  FROM platform.document_slots AS slot
  JOIN platform.document_requirements AS requirement
    ON requirement.organization_id = slot.organization_id
    AND requirement.id = slot.requirement_id
  LEFT JOIN platform.document_versions AS version
    ON version.organization_id = slot.organization_id
    AND version.document_slot_id = slot.id
    AND version.student_case_id = slot.student_case_id
  LEFT JOIN LATERAL (
    SELECT
      document_review.decision,
      document_review.reason,
      document_review.created_at
    FROM platform.document_reviews AS document_review
    WHERE document_review.organization_id = slot.organization_id
      AND document_review.document_version_id = version.id
    ORDER BY document_review.created_at DESC, document_review.id DESC
    LIMIT 1
  ) AS review ON TRUE
  WHERE private.platform_can_read_student_portal_case(
    slot.organization_id,
    slot.student_case_id
  )
    AND private.platform_has_permission(
      slot.organization_id,
      'document.read.self'
    )
  ORDER BY slot.deadline NULLS LAST, slot.id, version.version_no
$$;

CREATE OR REPLACE FUNCTION platform_private.derive_obligation_status(
  p_amount_minor BIGINT,
  p_total_paid_minor BIGINT,
  p_total_refunded_minor BIGINT,
  p_due_at TIMESTAMPTZ,
  p_as_of TIMESTAMPTZ
)
RETURNS platform.obligation_status
LANGUAGE SQL
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_total_paid_minor - p_total_refunded_minor = p_amount_minor
      THEN 'paid'::platform.obligation_status
    WHEN p_due_at < p_as_of
      AND p_amount_minor - (
        p_total_paid_minor - p_total_refunded_minor
      ) > 0
      THEN 'overdue'::platform.obligation_status
    WHEN p_total_paid_minor - p_total_refunded_minor > 0
      THEN 'partially_paid'::platform.obligation_status
    ELSE 'pending'::platform.obligation_status
  END
$$;

REVOKE ALL ON FUNCTION platform_private.derive_obligation_status(
  BIGINT,
  BIGINT,
  BIGINT,
  TIMESTAMPTZ,
  TIMESTAMPTZ
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

CREATE OR REPLACE FUNCTION platform.create_payment_obligation(
  p_organization_id UUID,
  p_student_case_id UUID,
  p_label TEXT,
  p_category platform.obligation_category,
  p_amount_minor BIGINT,
  p_currency TEXT,
  p_due_at TIMESTAMPTZ,
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
  created_obligation_id UUID := gen_random_uuid();
  result JSONB;
BEGIN
  PERFORM platform_private.lock_p2e_request(p_request_id);

  IF p_student_case_id IS NULL
    OR p_label IS NULL
    OR btrim(p_label) = ''
    OR p_category IS NULL
    OR p_amount_minor IS NULL
    OR p_amount_minor <= 0
    OR upper(btrim(p_currency)) !~ '^[A-Z]{3}$'
    OR p_due_at IS NULL
    OR p_next_action IS NULL
    OR btrim(p_next_action) = ''
    OR p_reason IS NULL
    OR char_length(btrim(p_reason)) NOT BETWEEN 1 AND 1000
  THEN
    RAISE EXCEPTION
      'Complete manual payment obligation fields and reason are required'
      USING ERRCODE = '22023';
  END IF;

  SELECT *
  INTO actor
  FROM platform_private.require_finance_actor(
    p_organization_id,
    'finance.manage'
  );

  replayed := platform_private.replay_audit(
    p_request_id,
    'finance.obligation.create',
    'payment_obligation',
    NULL,
    btrim(p_reason),
    jsonb_build_object(
      'organization_id', p_organization_id,
      'student_case_id', p_student_case_id,
      'label', btrim(p_label),
      'category', p_category,
      'amount_minor', p_amount_minor,
      'currency', upper(btrim(p_currency)),
      'due_at', p_due_at,
      'next_action', btrim(p_next_action),
      'total_paid_minor', 0,
      'total_refunded_minor', 0
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
  FROM platform_private.require_finance_actor(
    p_organization_id,
    'finance.manage'
  );

  replayed := platform_private.replay_audit(
    p_request_id,
    'finance.obligation.create',
    'payment_obligation',
    NULL,
    btrim(p_reason),
    jsonb_build_object(
      'organization_id', p_organization_id,
      'student_case_id', p_student_case_id,
      'label', btrim(p_label),
      'category', p_category,
      'amount_minor', p_amount_minor,
      'currency', upper(btrim(p_currency)),
      'due_at', p_due_at,
      'next_action', btrim(p_next_action),
      'total_paid_minor', 0,
      'total_refunded_minor', 0
    )
  );
  IF replayed IS NOT NULL THEN
    RETURN replayed;
  END IF;

  INSERT INTO platform.payment_obligations (
    id,
    organization_id,
    student_case_id,
    label,
    category,
    amount_minor,
    currency,
    due_at,
    next_action,
    total_paid_minor,
    total_refunded_minor,
    created_by_membership_id
  )
  VALUES (
    created_obligation_id,
    p_organization_id,
    p_student_case_id,
    btrim(p_label),
    p_category,
    p_amount_minor,
    upper(btrim(p_currency)),
    p_due_at,
    btrim(p_next_action),
    0,
    0,
    actor.actor_membership_id
  );

  result := jsonb_build_object(
    'organization_id', p_organization_id,
    'payment_obligation_id', created_obligation_id,
    'student_case_id', p_student_case_id,
    'label', btrim(p_label),
    'category', p_category,
    'amount_minor', p_amount_minor,
    'currency', upper(btrim(p_currency)),
    'due_at', p_due_at,
    'next_action', btrim(p_next_action),
    'total_paid_minor', 0,
    'total_refunded_minor', 0
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
    'finance.obligation.create',
    'payment_obligation',
    created_obligation_id,
    NULL,
    result,
    btrim(p_reason),
    p_request_id
  );

  RETURN result;
END
$$;

CREATE OR REPLACE FUNCTION platform.record_payment_event(
  p_organization_id UUID,
  p_payment_obligation_id UUID,
  p_event_type platform.payment_event_type,
  p_referenced_payment_event_id UUID,
  p_amount_minor BIGINT,
  p_currency TEXT,
  p_occurred_at TIMESTAMPTZ,
  p_source_key TEXT,
  p_evidence_ref TEXT,
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
  preliminary_case_id UUID;
  actor RECORD;
  target_case platform.student_cases%ROWTYPE;
  obligation_row platform.payment_obligations%ROWTYPE;
  referenced_payment_row platform.payment_events%ROWTYPE;
  replayed JSONB;
  created_event_id UUID := gen_random_uuid();
  created_evidence_id UUID := gen_random_uuid();
  next_paid BIGINT;
  next_refunded BIGINT;
  referenced_refunded_minor BIGINT;
  result JSONB;
BEGIN
  PERFORM platform_private.lock_p2e_request(p_request_id);

  IF p_payment_obligation_id IS NULL
    OR p_event_type IS NULL
    OR (
      p_event_type = 'payment'
      AND p_referenced_payment_event_id IS NOT NULL
    )
    OR (
      p_event_type = 'refund'
      AND p_referenced_payment_event_id IS NULL
    )
    OR p_amount_minor IS NULL
    OR p_amount_minor <= 0
    OR upper(btrim(p_currency)) !~ '^[A-Z]{3}$'
    OR p_occurred_at IS NULL
    OR p_source_key IS NULL
    OR btrim(p_source_key) = ''
    OR p_evidence_ref IS NULL
    OR btrim(p_evidence_ref) = ''
    OR p_reason IS NULL
    OR char_length(btrim(p_reason)) NOT BETWEEN 1 AND 1000
  THEN
    RAISE EXCEPTION
      'Payment/refund amount, source, evidence and reason are required'
      USING ERRCODE = '22023';
  END IF;

  SELECT *
  INTO actor
  FROM platform_private.require_finance_actor(
    p_organization_id,
    'finance.event.confirm'
  );

  replayed := platform_private.replay_audit(
    p_request_id,
    'finance.payment.record',
    'payment_event',
    NULL,
    btrim(p_reason),
    jsonb_build_object(
      'organization_id', p_organization_id,
      'payment_obligation_id', p_payment_obligation_id,
      'event_type', p_event_type,
      'referenced_payment_event_id', p_referenced_payment_event_id,
      'amount_minor', p_amount_minor,
      'currency', upper(btrim(p_currency)),
      'occurred_at', p_occurred_at,
      'source_key', btrim(p_source_key),
      'evidence_ref', btrim(p_evidence_ref)
    )
  );
  IF replayed IS NOT NULL THEN
    RETURN replayed;
  END IF;

  SELECT obligation.student_case_id
  INTO preliminary_case_id
  FROM platform.payment_obligations AS obligation
  WHERE obligation.organization_id = p_organization_id
    AND obligation.id = p_payment_obligation_id;

  IF preliminary_case_id IS NULL THEN
    RAISE EXCEPTION
      'Payment obligation is unavailable'
      USING ERRCODE = '42501';
  END IF;

  SELECT *
  INTO target_case
  FROM platform.student_cases AS student_case
  WHERE student_case.organization_id = p_organization_id
    AND student_case.id = preliminary_case_id
  FOR UPDATE;

  SELECT *
  INTO obligation_row
  FROM platform.payment_obligations AS obligation
  WHERE obligation.organization_id = p_organization_id
    AND obligation.id = p_payment_obligation_id
    AND obligation.student_case_id = target_case.id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Payment obligation is unavailable'
      USING ERRCODE = '42501';
  END IF;

  SELECT *
  INTO actor
  FROM platform_private.require_finance_actor(
    p_organization_id,
    'finance.event.confirm'
  );

  replayed := platform_private.replay_audit(
    p_request_id,
    'finance.payment.record',
    'payment_event',
    NULL,
    btrim(p_reason),
    jsonb_build_object(
      'organization_id', p_organization_id,
      'payment_obligation_id', p_payment_obligation_id,
      'event_type', p_event_type,
      'referenced_payment_event_id', p_referenced_payment_event_id,
      'amount_minor', p_amount_minor,
      'currency', upper(btrim(p_currency)),
      'occurred_at', p_occurred_at,
      'source_key', btrim(p_source_key),
      'evidence_ref', btrim(p_evidence_ref)
    )
  );
  IF replayed IS NOT NULL THEN
    RETURN replayed;
  END IF;

  IF upper(btrim(p_currency)) <> obligation_row.currency THEN
    RAISE EXCEPTION
      'Payment event currency must match the obligation'
      USING ERRCODE = '22023';
  END IF;

  next_paid := obligation_row.total_paid_minor;
  next_refunded := obligation_row.total_refunded_minor;

  IF p_event_type = 'payment' THEN
    next_paid := next_paid + p_amount_minor;
    IF next_paid - next_refunded > obligation_row.amount_minor THEN
      RAISE EXCEPTION
        'Payment would exceed the obligation balance'
        USING ERRCODE = '22023';
    END IF;
  ELSE
    SELECT *
    INTO referenced_payment_row
    FROM platform.payment_events AS payment_event
    WHERE payment_event.organization_id = p_organization_id
      AND payment_event.id = p_referenced_payment_event_id
      AND payment_event.student_case_id = target_case.id
      AND payment_event.payment_obligation_id = p_payment_obligation_id
      AND payment_event.event_type = 'payment'
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION
        'Refund must reference an exact confirmed payment'
        USING ERRCODE = '22023';
    END IF;

    SELECT COALESCE(SUM(refund.amount_minor), 0)
    INTO referenced_refunded_minor
    FROM platform.payment_events AS refund
    WHERE refund.organization_id = p_organization_id
      AND refund.student_case_id = target_case.id
      AND refund.payment_obligation_id = p_payment_obligation_id
      AND refund.event_type = 'refund'
      AND refund.referenced_payment_event_id =
        p_referenced_payment_event_id;

    IF referenced_refunded_minor + p_amount_minor >
      referenced_payment_row.amount_minor
    THEN
      RAISE EXCEPTION
        'Refund would exceed the referenced confirmed payment'
        USING ERRCODE = '22023';
    END IF;

    next_refunded := next_refunded + p_amount_minor;
    IF next_refunded > next_paid THEN
      RAISE EXCEPTION
        'Refund would exceed confirmed net paid amount'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  INSERT INTO platform.payment_events (
    id,
    organization_id,
    student_case_id,
    payment_obligation_id,
    event_type,
    referenced_payment_event_id,
    amount_minor,
    currency,
    occurred_at,
    source_key,
    actor_membership_id,
    request_id
  )
  VALUES (
    created_event_id,
    p_organization_id,
    target_case.id,
    p_payment_obligation_id,
    p_event_type,
    p_referenced_payment_event_id,
    p_amount_minor,
    obligation_row.currency,
    p_occurred_at,
    btrim(p_source_key),
    actor.actor_membership_id,
    p_request_id
  );

  INSERT INTO platform.payment_evidence (
    id,
    organization_id,
    student_case_id,
    payment_obligation_id,
    payment_event_id,
    evidence_ref,
    recorded_by_membership_id
  )
  VALUES (
    created_evidence_id,
    p_organization_id,
    target_case.id,
    p_payment_obligation_id,
    created_event_id,
    btrim(p_evidence_ref),
    actor.actor_membership_id
  );

  UPDATE platform.payment_obligations AS obligation
  SET
    total_paid_minor = next_paid,
    total_refunded_minor = next_refunded
  WHERE obligation.organization_id = p_organization_id
    AND obligation.id = p_payment_obligation_id;

  result := jsonb_build_object(
    'organization_id', p_organization_id,
    'payment_event_id', created_event_id,
    'payment_evidence_id', created_evidence_id,
    'payment_obligation_id', p_payment_obligation_id,
    'student_case_id', target_case.id,
    'event_type', p_event_type,
    'referenced_payment_event_id', p_referenced_payment_event_id,
    'amount_minor', p_amount_minor,
    'currency', obligation_row.currency,
    'occurred_at', p_occurred_at,
    'source_key', btrim(p_source_key),
    'evidence_ref', btrim(p_evidence_ref),
    'total_paid_minor', next_paid,
    'total_refunded_minor', next_refunded
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
    'finance.payment.record',
    'payment_event',
    created_event_id,
    jsonb_build_object(
      'total_paid_minor', obligation_row.total_paid_minor,
      'total_refunded_minor', obligation_row.total_refunded_minor
    ),
    result,
    btrim(p_reason),
    p_request_id
  );

  RETURN result;
END
$$;

CREATE OR REPLACE FUNCTION platform.create_stop_factor(
  p_organization_id UUID,
  p_student_case_id UUID,
  p_payment_obligation_id UUID,
  p_owner_membership_id UUID,
  p_reason TEXT,
  p_blocked_action TEXT,
  p_next_action TEXT,
  p_created_evidence_ref TEXT,
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
  obligation_row platform.payment_obligations%ROWTYPE;
  owner_row RECORD;
  replayed JSONB;
  created_stop_factor_id UUID := gen_random_uuid();
  result JSONB;
BEGIN
  PERFORM platform_private.lock_p2e_request(p_request_id);

  IF p_student_case_id IS NULL
    OR p_payment_obligation_id IS NULL
    OR p_owner_membership_id IS NULL
    OR p_reason IS NULL
    OR char_length(btrim(p_reason)) NOT BETWEEN 1 AND 1000
    OR p_blocked_action IS NULL
    OR btrim(p_blocked_action) = ''
    OR p_next_action IS NULL
    OR btrim(p_next_action) = ''
    OR p_created_evidence_ref IS NULL
    OR btrim(p_created_evidence_ref) = ''
  THEN
    RAISE EXCEPTION
      'Complete stop factor fields and evidence are required'
      USING ERRCODE = '22023';
  END IF;

  SELECT *
  INTO actor
  FROM platform_private.require_finance_actor(
    p_organization_id,
    'finance.stop.manage'
  );

  replayed := platform_private.replay_audit(
    p_request_id,
    'finance.stop.create',
    'stop_factor',
    NULL,
    btrim(p_reason),
    jsonb_build_object(
      'organization_id', p_organization_id,
      'student_case_id', p_student_case_id,
      'payment_obligation_id', p_payment_obligation_id,
      'owner_membership_id', p_owner_membership_id,
      'reason', btrim(p_reason),
      'blocked_action', btrim(p_blocked_action),
      'next_action', btrim(p_next_action),
      'created_evidence_ref', btrim(p_created_evidence_ref),
      'status', 'active'
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
  INTO obligation_row
  FROM platform.payment_obligations AS obligation
  WHERE obligation.organization_id = p_organization_id
    AND obligation.id = p_payment_obligation_id
    AND obligation.student_case_id = p_student_case_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Payment obligation is unavailable'
      USING ERRCODE = '42501';
  END IF;

  SELECT
    membership.id,
    membership."current_role",
    profile.id AS profile_id
  INTO owner_row
  FROM platform.organization_memberships AS membership
  JOIN platform.profiles AS profile
    ON profile.id = membership.profile_id
  JOIN platform.organizations AS organization
    ON organization.id = membership.organization_id
  JOIN platform.role_bundle_versions AS bundle
    ON bundle.id = membership.current_bundle_id
    AND bundle.role = membership."current_role"
  WHERE membership.organization_id = p_organization_id
    AND membership.id = p_owner_membership_id
    AND membership.status = 'active'
    AND membership."current_role" IN ('admin', 'finance')
    AND profile.status = 'active'
    AND organization.status = 'active'
    AND bundle.status = 'published'
    AND platform_private.membership_has_active_scope(
      p_organization_id,
      membership.id,
      'organization',
      p_organization_id
    )
  FOR UPDATE OF membership, profile, organization;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Live organization-scoped Admin or Finance owner is required'
      USING ERRCODE = '42501';
  END IF;

  SELECT *
  INTO actor
  FROM platform_private.require_finance_actor(
    p_organization_id,
    'finance.stop.manage'
  );

  replayed := platform_private.replay_audit(
    p_request_id,
    'finance.stop.create',
    'stop_factor',
    NULL,
    btrim(p_reason),
    jsonb_build_object(
      'organization_id', p_organization_id,
      'student_case_id', p_student_case_id,
      'payment_obligation_id', p_payment_obligation_id,
      'owner_membership_id', p_owner_membership_id,
      'reason', btrim(p_reason),
      'blocked_action', btrim(p_blocked_action),
      'next_action', btrim(p_next_action),
      'created_evidence_ref', btrim(p_created_evidence_ref),
      'status', 'active'
    )
  );
  IF replayed IS NOT NULL THEN
    RETURN replayed;
  END IF;

  INSERT INTO platform.stop_factors (
    id,
    organization_id,
    student_case_id,
    payment_obligation_id,
    status,
    reason,
    owner_membership_id,
    blocked_action,
    next_action,
    created_evidence_ref,
    created_by_membership_id
  )
  VALUES (
    created_stop_factor_id,
    p_organization_id,
    p_student_case_id,
    p_payment_obligation_id,
    'active',
    btrim(p_reason),
    p_owner_membership_id,
    btrim(p_blocked_action),
    btrim(p_next_action),
    btrim(p_created_evidence_ref),
    actor.actor_membership_id
  );

  INSERT INTO platform.stop_factor_events (
    organization_id,
    student_case_id,
    payment_obligation_id,
    stop_factor_id,
    previous_status,
    new_status,
    resolution_kind,
    resolution_payment_event_id,
    evidence_ref,
    reason,
    actor_membership_id,
    request_id
  )
  VALUES (
    p_organization_id,
    p_student_case_id,
    p_payment_obligation_id,
    created_stop_factor_id,
    NULL,
    'active',
    NULL,
    NULL,
    btrim(p_created_evidence_ref),
    btrim(p_reason),
    actor.actor_membership_id,
    p_request_id
  );

  result := jsonb_build_object(
    'organization_id', p_organization_id,
    'stop_factor_id', created_stop_factor_id,
    'student_case_id', p_student_case_id,
    'payment_obligation_id', p_payment_obligation_id,
    'owner_membership_id', p_owner_membership_id,
    'reason', btrim(p_reason),
    'blocked_action', btrim(p_blocked_action),
    'next_action', btrim(p_next_action),
    'created_evidence_ref', btrim(p_created_evidence_ref),
    'status', 'active'
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
    'finance.stop.create',
    'stop_factor',
    created_stop_factor_id,
    NULL,
    result,
    btrim(p_reason),
    p_request_id
  );

  RETURN result;
END
$$;

CREATE OR REPLACE FUNCTION platform.resolve_stop_factor(
  p_organization_id UUID,
  p_stop_factor_id UUID,
  p_resolution_kind platform.stop_factor_resolution_kind,
  p_payment_event_id UUID,
  p_reason TEXT,
  p_evidence_ref TEXT,
  p_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  preliminary_parent RECORD;
  actor RECORD;
  target_case platform.student_cases%ROWTYPE;
  obligation_row platform.payment_obligations%ROWTYPE;
  stop_row platform.stop_factors%ROWTYPE;
  payment_row platform.payment_events%ROWTYPE;
  payment_evidence_ref TEXT;
  replayed JSONB;
  resolved_at_value TIMESTAMPTZ := statement_timestamp();
  resolved_evidence_ref TEXT;
  result JSONB;
BEGIN
  PERFORM platform_private.lock_p2e_request(p_request_id);

  IF p_stop_factor_id IS NULL
    OR p_resolution_kind IS NULL
    OR p_reason IS NULL
    OR char_length(btrim(p_reason)) NOT BETWEEN 1 AND 1000
    OR (
      p_resolution_kind = 'payment_event'
      AND (
        p_payment_event_id IS NULL
        OR p_evidence_ref IS NOT NULL
      )
    )
    OR (
      p_resolution_kind = 'admin_override'
      AND (
        p_payment_event_id IS NOT NULL
        OR p_evidence_ref IS NULL
        OR btrim(p_evidence_ref) = ''
      )
    )
  THEN
    RAISE EXCEPTION
      'Valid payment-event or Admin-override resolution is required'
      USING ERRCODE = '22023';
  END IF;

  SELECT *
  INTO actor
  FROM platform_private.require_finance_actor(
    p_organization_id,
    'finance.stop.manage'
  );

  IF p_resolution_kind = 'admin_override'
    AND actor.actor_role <> 'admin'
  THEN
    RAISE EXCEPTION
      'Only Admin may resolve a stop factor by override'
      USING ERRCODE = '42501';
  END IF;

  replayed := platform_private.replay_audit(
    p_request_id,
    'finance.stop.resolve',
    'stop_factor',
    p_stop_factor_id,
    btrim(p_reason),
    jsonb_build_object(
      'organization_id', p_organization_id,
      'stop_factor_id', p_stop_factor_id,
      'resolution_kind', p_resolution_kind,
      'payment_event_id', p_payment_event_id,
      'reason', btrim(p_reason),
      'evidence_ref', NULLIF(btrim(p_evidence_ref), ''),
      'status', 'resolved'
    )
  );
  IF replayed IS NOT NULL THEN
    RETURN replayed;
  END IF;

  SELECT
    stop.student_case_id,
    stop.payment_obligation_id
  INTO preliminary_parent
  FROM platform.stop_factors AS stop
  WHERE stop.organization_id = p_organization_id
    AND stop.id = p_stop_factor_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Stop factor is unavailable'
      USING ERRCODE = '42501';
  END IF;

  SELECT *
  INTO target_case
  FROM platform.student_cases AS student_case
  WHERE student_case.organization_id = p_organization_id
    AND student_case.id = preliminary_parent.student_case_id
  FOR UPDATE;

  SELECT *
  INTO obligation_row
  FROM platform.payment_obligations AS obligation
  WHERE obligation.organization_id = p_organization_id
    AND obligation.id = preliminary_parent.payment_obligation_id
    AND obligation.student_case_id = target_case.id
  FOR UPDATE;

  SELECT *
  INTO stop_row
  FROM platform.stop_factors AS stop
  WHERE stop.organization_id = p_organization_id
    AND stop.id = p_stop_factor_id
    AND stop.student_case_id = target_case.id
    AND stop.payment_obligation_id = obligation_row.id
  FOR UPDATE;

  IF NOT FOUND OR stop_row.status <> 'active' THEN
    RAISE EXCEPTION
      'Active stop factor is unavailable'
      USING ERRCODE = '42501';
  END IF;

  SELECT *
  INTO actor
  FROM platform_private.require_finance_actor(
    p_organization_id,
    'finance.stop.manage'
  );

  IF p_resolution_kind = 'admin_override'
    AND actor.actor_role <> 'admin'
  THEN
    RAISE EXCEPTION
      'Only Admin may resolve a stop factor by override'
      USING ERRCODE = '42501';
  END IF;

  IF p_resolution_kind = 'payment_event' THEN
    SELECT *
    INTO payment_row
    FROM platform.payment_events AS payment
    WHERE payment.organization_id = p_organization_id
      AND payment.id = p_payment_event_id
      AND payment.student_case_id = target_case.id
      AND payment.payment_obligation_id = obligation_row.id
      AND payment.event_type = 'payment'
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION
        'Linked confirmed payment event is unavailable'
        USING ERRCODE = '22023';
    END IF;

    SELECT evidence.evidence_ref
    INTO payment_evidence_ref
    FROM platform.payment_evidence AS evidence
    WHERE evidence.organization_id = p_organization_id
      AND evidence.payment_event_id = p_payment_event_id
      AND evidence.student_case_id = target_case.id
      AND evidence.payment_obligation_id = obligation_row.id
    ORDER BY evidence.created_at, evidence.id
    LIMIT 1
    FOR UPDATE;

    IF payment_evidence_ref IS NULL THEN
      RAISE EXCEPTION
        'Linked payment evidence is unavailable'
        USING ERRCODE = '22023';
    END IF;

    resolved_evidence_ref := payment_evidence_ref;
  ELSE
    resolved_evidence_ref := btrim(p_evidence_ref);
  END IF;

  replayed := platform_private.replay_audit(
    p_request_id,
    'finance.stop.resolve',
    'stop_factor',
    p_stop_factor_id,
    btrim(p_reason),
    jsonb_build_object(
      'organization_id', p_organization_id,
      'stop_factor_id', p_stop_factor_id,
      'resolution_kind', p_resolution_kind,
      'payment_event_id', p_payment_event_id,
      'reason', btrim(p_reason),
      'evidence_ref', NULLIF(btrim(p_evidence_ref), ''),
      'status', 'resolved'
    )
  );
  IF replayed IS NOT NULL THEN
    RETURN replayed;
  END IF;

  UPDATE platform.stop_factors AS stop
  SET
    status = 'resolved',
    resolution_kind = p_resolution_kind,
    resolution_payment_event_id = p_payment_event_id,
    resolution_reason = btrim(p_reason),
    resolution_evidence_ref = CASE
      WHEN p_resolution_kind = 'admin_override'
      THEN resolved_evidence_ref
      ELSE NULL
    END,
    resolved_by_membership_id = actor.actor_membership_id,
    resolved_at = resolved_at_value
  WHERE stop.organization_id = p_organization_id
    AND stop.id = p_stop_factor_id;

  INSERT INTO platform.stop_factor_events (
    organization_id,
    student_case_id,
    payment_obligation_id,
    stop_factor_id,
    previous_status,
    new_status,
    resolution_kind,
    resolution_payment_event_id,
    evidence_ref,
    reason,
    actor_membership_id,
    request_id
  )
  VALUES (
    p_organization_id,
    target_case.id,
    obligation_row.id,
    p_stop_factor_id,
    'active',
    'resolved',
    p_resolution_kind,
    p_payment_event_id,
    resolved_evidence_ref,
    btrim(p_reason),
    actor.actor_membership_id,
    p_request_id
  );

  result := jsonb_build_object(
    'organization_id', p_organization_id,
    'stop_factor_id', p_stop_factor_id,
    'student_case_id', target_case.id,
    'payment_obligation_id', obligation_row.id,
    'resolution_kind', p_resolution_kind,
    'payment_event_id', p_payment_event_id,
    'reason', btrim(p_reason),
    'evidence_ref', NULLIF(btrim(p_evidence_ref), ''),
    'status', 'resolved',
    'resolved_at', resolved_at_value
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
    'finance.stop.resolve',
    'stop_factor',
    p_stop_factor_id,
    jsonb_build_object(
      'status', stop_row.status,
      'resolution_kind', stop_row.resolution_kind,
      'resolved_at', stop_row.resolved_at
    ),
    result,
    btrim(p_reason),
    p_request_id
  );

  RETURN result;
END
$$;

CREATE OR REPLACE FUNCTION platform.case_finance_summaries()
RETURNS TABLE (
  case_id UUID,
  payment_obligation_id UUID,
  obligation_label TEXT,
  category platform.obligation_category,
  amount_minor BIGINT,
  currency TEXT,
  due_at TIMESTAMPTZ,
  derived_status platform.obligation_status,
  overdue BOOLEAN,
  next_action TEXT,
  has_active_stop_factor BOOLEAN,
  blocked_action TEXT
)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    student_case.id,
    obligation.id,
    obligation.label,
    obligation.category,
    obligation.amount_minor,
    obligation.currency,
    obligation.due_at,
    platform_private.derive_obligation_status(
      obligation.amount_minor,
      obligation.total_paid_minor,
      obligation.total_refunded_minor,
      obligation.due_at,
      transaction_timestamp()
    ),
    (
      obligation.due_at < transaction_timestamp()
      AND obligation.amount_minor - (
        obligation.total_paid_minor - obligation.total_refunded_minor
      ) > 0
    ),
    obligation.next_action,
    active_stop.id IS NOT NULL,
    active_stop.blocked_action
  FROM platform.student_cases AS student_case
  JOIN platform.organization_memberships AS membership
    ON membership.organization_id = student_case.organization_id
  JOIN platform.profiles AS profile
    ON profile.id = membership.profile_id
  JOIN platform.payment_obligations AS obligation
    ON obligation.organization_id = student_case.organization_id
    AND obligation.student_case_id = student_case.id
  LEFT JOIN LATERAL (
    SELECT
      stop.id,
      stop.blocked_action
    FROM platform.stop_factors AS stop
    WHERE stop.organization_id = obligation.organization_id
      AND stop.payment_obligation_id = obligation.id
      AND stop.status = 'active'
    ORDER BY stop.created_at, stop.id
    LIMIT 1
  ) AS active_stop ON TRUE
  WHERE profile.auth_user_id = (SELECT auth.uid())
    AND membership.status = 'active'
    AND profile.status = 'active'
    AND membership."current_role" IN ('sales', 'curator')
    AND private.platform_has_permission(
      student_case.organization_id,
      'finance.read.summary'
    )
    AND (
      (
        membership."current_role" = 'sales'
        AND student_case.state = 'pending'
        AND student_case.responsible_sales_membership_id = membership.id
        AND private.platform_has_scope(
          student_case.organization_id,
          'student_case',
          student_case.id
        )
      )
      OR (
        membership."current_role" = 'curator'
        AND student_case.state IN ('active', 'closed')
        AND student_case.current_curator_membership_id = membership.id
        AND private.platform_has_scope(
          student_case.organization_id,
          'student_case',
          student_case.id
        )
      )
    )
  ORDER BY obligation.due_at, obligation.id
$$;

CREATE OR REPLACE FUNCTION platform.student_portal_finance()
RETURNS TABLE (
  case_id UUID,
  payment_obligation_id UUID,
  obligation_label TEXT,
  category platform.obligation_category,
  amount_minor BIGINT,
  currency TEXT,
  due_at TIMESTAMPTZ,
  derived_status platform.obligation_status,
  overdue BOOLEAN,
  next_action TEXT
)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    obligation.student_case_id,
    obligation.id,
    obligation.label,
    obligation.category,
    obligation.amount_minor,
    obligation.currency,
    obligation.due_at,
    platform_private.derive_obligation_status(
      obligation.amount_minor,
      obligation.total_paid_minor,
      obligation.total_refunded_minor,
      obligation.due_at,
      transaction_timestamp()
    ),
    (
      obligation.due_at < transaction_timestamp()
      AND obligation.amount_minor - (
        obligation.total_paid_minor - obligation.total_refunded_minor
      ) > 0
    ),
    obligation.next_action
  FROM platform.payment_obligations AS obligation
  WHERE private.platform_can_read_student_portal_case(
    obligation.organization_id,
    obligation.student_case_id
  )
    AND private.platform_has_permission(
      obligation.organization_id,
      'finance.read.self'
    )
  ORDER BY obligation.due_at, obligation.id
$$;

-- Notification authorization is evaluated against the case owner at the
-- moment of mutation. The function intentionally accepts one scalar category
-- and one case; there is no recipient array or broadcast surface.
CREATE OR REPLACE FUNCTION platform_private.require_notification_actor(
  p_organization_id UUID,
  p_student_case_id UUID,
  p_category TEXT
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
  normalized_category TEXT := lower(btrim(p_category));
BEGIN
  IF p_student_case_id IS NULL
    OR p_category IS NULL
    OR normalized_category !~ '^[a-z][a-z0-9_.-]*$'
  THEN
    RAISE EXCEPTION
      'A valid notification case and category are required'
      USING ERRCODE = '22023';
  END IF;

  SELECT *
  INTO actor
  FROM platform_private.require_domain_actor(
    p_organization_id,
    'notification.create'
  );

  SELECT *
  INTO target_case
  FROM platform.student_cases AS student_case
  WHERE student_case.organization_id = p_organization_id
    AND student_case.id = p_student_case_id;

  IF NOT FOUND OR NOT (
    (
      actor.actor_role = 'admin'
      AND platform_private.membership_has_active_scope(
        p_organization_id,
        actor.actor_membership_id,
        'organization',
        p_organization_id
      )
    )
    OR (
      actor.actor_role = 'sales'
      AND target_case.state = 'pending'
      AND target_case.responsible_sales_membership_id =
        actor.actor_membership_id
      AND platform_private.membership_has_active_scope(
        p_organization_id,
        actor.actor_membership_id,
        'student_case',
        p_student_case_id
      )
    )
    OR (
      actor.actor_role = 'curator'
      AND target_case.state IN ('active', 'closed')
      AND target_case.current_curator_membership_id =
        actor.actor_membership_id
      AND platform_private.membership_has_active_scope(
        p_organization_id,
        actor.actor_membership_id,
        'student_case',
        p_student_case_id
      )
    )
    OR (
      actor.actor_role = 'finance'
      AND normalized_category = 'finance'
      AND platform_private.membership_has_active_scope(
        p_organization_id,
        actor.actor_membership_id,
        'organization',
        p_organization_id
      )
    )
  ) THEN
    RAISE EXCEPTION
      'Student case is unavailable for this notification'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY SELECT
    actor.actor_profile_id,
    actor.actor_membership_id,
    actor.actor_auth_user_id,
    actor.actor_role;
END
$$;

REVOKE ALL ON FUNCTION platform_private.require_notification_actor(
  UUID,
  UUID,
  TEXT
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

CREATE OR REPLACE FUNCTION platform.set_own_notification_consent(
  p_organization_id UUID,
  p_status platform.notification_consent_status,
  p_policy_ref TEXT,
  p_evidence_ref TEXT,
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
  prior_consent platform.notification_consents%ROWTYPE;
  consent_exists BOOLEAN;
  replayed JSONB;
  consent_id UUID := gen_random_uuid();
  changed_at TIMESTAMPTZ := statement_timestamp();
  fixed_reason TEXT;
  result JSONB;
BEGIN
  PERFORM platform_private.lock_p2e_request(p_request_id);

  IF p_status IS NULL
    OR p_policy_ref IS NULL
    OR btrim(p_policy_ref) = ''
    OR p_evidence_ref IS NULL
    OR btrim(p_evidence_ref) = ''
  THEN
    RAISE EXCEPTION
      'Consent status, policy and evidence are required'
      USING ERRCODE = '22023';
  END IF;

  fixed_reason := CASE p_status
    WHEN 'granted'
      THEN 'Individual WhatsApp notification consent granted'
    ELSE 'Individual WhatsApp notification consent withdrawn'
  END;

  SELECT *
  INTO actor
  FROM platform_private.require_domain_actor(
    p_organization_id,
    'notification.consent.self'
  );

  replayed := platform_private.replay_audit(
    p_request_id,
    'notification.consent.set',
    'notification_consent',
    NULL,
    fixed_reason,
    jsonb_build_object(
      'organization_id', p_organization_id,
      'membership_id', actor.actor_membership_id,
      'channel', 'individual_whatsapp',
      'status', p_status,
      'policy_ref', btrim(p_policy_ref),
      'evidence_ref', btrim(p_evidence_ref)
    )
  );
  IF replayed IS NOT NULL THEN
    RETURN replayed;
  END IF;

  SELECT *
  INTO prior_consent
  FROM platform.notification_consents AS consent
  WHERE consent.organization_id = p_organization_id
    AND consent.membership_id = actor.actor_membership_id
    AND consent.channel = 'individual_whatsapp'
  FOR UPDATE;
  consent_exists := FOUND;

  SELECT *
  INTO actor
  FROM platform_private.require_domain_actor(
    p_organization_id,
    'notification.consent.self'
  );

  replayed := platform_private.replay_audit(
    p_request_id,
    'notification.consent.set',
    'notification_consent',
    NULL,
    fixed_reason,
    jsonb_build_object(
      'organization_id', p_organization_id,
      'membership_id', actor.actor_membership_id,
      'channel', 'individual_whatsapp',
      'status', p_status,
      'policy_ref', btrim(p_policy_ref),
      'evidence_ref', btrim(p_evidence_ref)
    )
  );
  IF replayed IS NOT NULL THEN
    RETURN replayed;
  END IF;

  IF consent_exists AND prior_consent.status = p_status THEN
    RAISE EXCEPTION
      'Consent already has the requested state; reuse the original request_id'
      USING ERRCODE = '22023';
  END IF;

  IF consent_exists THEN
    consent_id := prior_consent.id;

    UPDATE platform.notification_consents AS consent
    SET
      status = p_status,
      policy_ref = btrim(p_policy_ref),
      evidence_ref = btrim(p_evidence_ref),
      granted_at = CASE
        WHEN p_status = 'granted' THEN changed_at
        ELSE consent.granted_at
      END,
      withdrawn_at = CASE
        WHEN p_status = 'withdrawn' THEN changed_at
        ELSE NULL
      END
    WHERE consent.organization_id = p_organization_id
      AND consent.id = consent_id;
  ELSE
    INSERT INTO platform.notification_consents (
      id,
      organization_id,
      membership_id,
      channel,
      status,
      policy_ref,
      evidence_ref,
      granted_at,
      withdrawn_at
    )
    VALUES (
      consent_id,
      p_organization_id,
      actor.actor_membership_id,
      'individual_whatsapp',
      p_status,
      btrim(p_policy_ref),
      btrim(p_evidence_ref),
      CASE WHEN p_status = 'granted' THEN changed_at END,
      CASE WHEN p_status = 'withdrawn' THEN changed_at END
    );
  END IF;

  INSERT INTO platform.notification_consent_events (
    organization_id,
    membership_id,
    notification_consent_id,
    previous_status,
    new_status,
    policy_ref,
    evidence_ref,
    actor_membership_id,
    request_id
  )
  VALUES (
    p_organization_id,
    actor.actor_membership_id,
    consent_id,
    CASE WHEN consent_exists THEN prior_consent.status END,
    p_status,
    btrim(p_policy_ref),
    btrim(p_evidence_ref),
    actor.actor_membership_id,
    p_request_id
  );

  result := jsonb_build_object(
    'organization_id', p_organization_id,
    'notification_consent_id', consent_id,
    'membership_id', actor.actor_membership_id,
    'channel', 'individual_whatsapp',
    'status', p_status,
    'policy_ref', btrim(p_policy_ref),
    'evidence_ref', btrim(p_evidence_ref),
    'changed_at', changed_at
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
    'notification.consent.set',
    'notification_consent',
    consent_id,
    CASE
      WHEN consent_exists THEN jsonb_build_object(
        'status', prior_consent.status,
        'policy_ref', prior_consent.policy_ref,
        'evidence_ref', prior_consent.evidence_ref
      )
    END,
    result,
    fixed_reason,
    p_request_id
  );

  RETURN result;
END
$$;

CREATE OR REPLACE FUNCTION platform.create_individual_notification(
  p_organization_id UUID,
  p_student_case_id UUID,
  p_category TEXT,
  p_title TEXT,
  p_body TEXT,
  p_dedupe_key TEXT,
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
  recipient RECORD;
  consent_row platform.notification_consents%ROWTYPE;
  consent_exists BOOLEAN;
  existing_notification RECORD;
  existing_whatsapp_intent platform.notification_delivery_intents%ROWTYPE;
  replayed JSONB;
  notification_id UUID := gen_random_uuid();
  in_app_intent_id UUID := gen_random_uuid();
  whatsapp_intent_id UUID := gen_random_uuid();
  normalized_category TEXT := lower(btrim(p_category));
  normalized_title TEXT := btrim(p_title);
  normalized_body TEXT := btrim(p_body);
  normalized_dedupe_key TEXT := btrim(p_dedupe_key);
  whatsapp_status platform.notification_intent_status;
  fixed_reason TEXT :=
    'Create one individual in-app and WhatsApp notification intent';
  result JSONB;
BEGIN
  PERFORM platform_private.lock_p2e_request(p_request_id);

  IF p_student_case_id IS NULL
    OR p_category IS NULL
    OR normalized_category !~ '^[a-z][a-z0-9_.-]*$'
    OR p_title IS NULL
    OR normalized_title = ''
    OR p_body IS NULL
    OR normalized_body = ''
    OR p_dedupe_key IS NULL
    OR normalized_dedupe_key = ''
  THEN
    RAISE EXCEPTION
      'One case, category, title, body and dedupe key are required'
      USING ERRCODE = '22023';
  END IF;

  SELECT *
  INTO actor
  FROM platform_private.require_notification_actor(
    p_organization_id,
    p_student_case_id,
    normalized_category
  );

  replayed := platform_private.replay_audit(
    p_request_id,
    'notification.create',
    'notification',
    NULL,
    fixed_reason,
    jsonb_build_object(
      'organization_id', p_organization_id,
      'student_case_id', p_student_case_id,
      'category', normalized_category,
      'title', normalized_title,
      'body', normalized_body,
      'dedupe_key', normalized_dedupe_key
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
  FROM platform_private.require_notification_actor(
    p_organization_id,
    p_student_case_id,
    normalized_category
  );

  SELECT
    membership.id,
    profile.id AS profile_id,
    profile.auth_user_id
  INTO recipient
  FROM platform.organization_memberships AS membership
  JOIN platform.profiles AS profile
    ON profile.id = membership.profile_id
  JOIN platform.organizations AS organization
    ON organization.id = membership.organization_id
  JOIN platform.role_bundle_versions AS bundle
    ON bundle.id = membership.current_bundle_id
    AND bundle.role = membership."current_role"
  WHERE membership.organization_id = p_organization_id
    AND membership.id = target_case.student_membership_id
    AND membership.status = 'active'
    AND membership."current_role" = 'student'
    AND profile.status = 'active'
    AND organization.status = 'active'
    AND bundle.status = 'published'
  FOR UPDATE OF membership, profile, organization;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'The case must have one live Student recipient'
      USING ERRCODE = '42501';
  END IF;

  replayed := platform_private.replay_audit(
    p_request_id,
    'notification.create',
    'notification',
    NULL,
    fixed_reason,
    jsonb_build_object(
      'organization_id', p_organization_id,
      'student_case_id', p_student_case_id,
      'recipient_membership_id', recipient.id,
      'category', normalized_category,
      'title', normalized_title,
      'body', normalized_body,
      'dedupe_key', normalized_dedupe_key
    )
  );
  IF replayed IS NOT NULL THEN
    RETURN replayed;
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      'evo:p2e:notification:'
        || p_organization_id::TEXT
        || ':'
        || recipient.id::TEXT
        || ':'
        || normalized_dedupe_key,
      0
    )
  );

  SELECT
    notification.*,
    intent.id AS in_app_intent_id,
    intent.status AS in_app_intent_status
  INTO existing_notification
  FROM platform.notifications AS notification
  JOIN platform.notification_delivery_intents AS intent
    ON intent.organization_id = notification.organization_id
    AND intent.notification_id = notification.id
    AND intent.student_case_id = notification.student_case_id
    AND intent.recipient_membership_id =
      notification.recipient_membership_id
    AND intent.channel = 'in_app'
  WHERE notification.organization_id = p_organization_id
    AND notification.recipient_membership_id = recipient.id
    AND intent.dedupe_key = normalized_dedupe_key
  FOR UPDATE OF notification, intent;

  IF FOUND THEN
    IF existing_notification.student_case_id <> p_student_case_id
      OR existing_notification.category <> normalized_category
      OR existing_notification.title <> normalized_title
      OR existing_notification.body <> normalized_body
      OR existing_notification.dedupe_key <> normalized_dedupe_key
    THEN
      RAISE EXCEPTION
        'Notification dedupe key was already used for another payload'
        USING ERRCODE = '22023';
    END IF;

    SELECT *
    INTO existing_whatsapp_intent
    FROM platform.notification_delivery_intents AS intent
    WHERE intent.organization_id = p_organization_id
      AND intent.notification_id = existing_notification.id
      AND intent.student_case_id = p_student_case_id
      AND intent.recipient_membership_id = recipient.id
      AND intent.channel = 'individual_whatsapp'
      AND intent.dedupe_key = normalized_dedupe_key
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION
        'Notification intent pair is incomplete'
        USING ERRCODE = '55000';
    END IF;

    result := jsonb_build_object(
      'organization_id', p_organization_id,
      'notification_id', existing_notification.id,
      'student_case_id', p_student_case_id,
      'recipient_membership_id', recipient.id,
      'category', normalized_category,
      'title', normalized_title,
      'body', normalized_body,
      'dedupe_key', normalized_dedupe_key,
      'in_app_intent_id', existing_notification.in_app_intent_id,
      'in_app_intent_status',
        existing_notification.in_app_intent_status,
      'whatsapp_intent_id', existing_whatsapp_intent.id,
      'whatsapp_intent_status', existing_whatsapp_intent.status,
      'notification_consent_id',
        existing_whatsapp_intent.notification_consent_id,
      'consent_status_snapshot',
        existing_whatsapp_intent.consent_status_snapshot,
      'created_at', existing_notification.created_at,
      'deduplicated', TRUE,
      'delivery_proof', FALSE
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
      'notification.create',
      'notification',
      existing_notification.id,
      NULL,
      result,
      fixed_reason,
      p_request_id
    );

    RETURN result;
  END IF;

  SELECT *
  INTO consent_row
  FROM platform.notification_consents AS consent
  WHERE consent.organization_id = p_organization_id
    AND consent.membership_id = recipient.id
    AND consent.channel = 'individual_whatsapp'
  FOR UPDATE;
  consent_exists := FOUND;

  whatsapp_status := CASE
    WHEN consent_exists AND consent_row.status = 'granted'
      THEN 'pending'::platform.notification_intent_status
    ELSE 'consent_blocked'::platform.notification_intent_status
  END;

  INSERT INTO platform.notifications (
    id,
    organization_id,
    student_case_id,
    recipient_membership_id,
    category,
    title,
    body,
    dedupe_key,
    created_by_membership_id
  )
  VALUES (
    notification_id,
    p_organization_id,
    p_student_case_id,
    recipient.id,
    normalized_category,
    normalized_title,
    normalized_body,
    normalized_dedupe_key,
    actor.actor_membership_id
  );

  INSERT INTO platform.notification_delivery_intents (
    id,
    organization_id,
    notification_id,
    student_case_id,
    recipient_membership_id,
    channel,
    status,
    dedupe_key,
    notification_consent_id,
    consent_status_snapshot,
    consent_policy_ref
  )
  VALUES
    (
      in_app_intent_id,
      p_organization_id,
      notification_id,
      p_student_case_id,
      recipient.id,
      'in_app',
      'pending',
      normalized_dedupe_key,
      NULL,
      NULL,
      NULL
    ),
    (
      whatsapp_intent_id,
      p_organization_id,
      notification_id,
      p_student_case_id,
      recipient.id,
      'individual_whatsapp',
      whatsapp_status,
      normalized_dedupe_key,
      CASE WHEN consent_exists THEN consent_row.id END,
      CASE WHEN consent_exists THEN consent_row.status END,
      CASE WHEN consent_exists THEN consent_row.policy_ref END
    );

  INSERT INTO platform.notification_events (
    organization_id,
    notification_id,
    student_case_id,
    recipient_membership_id,
    event_type,
    actor_membership_id,
    reason,
    request_id
  )
  VALUES (
    p_organization_id,
    notification_id,
    p_student_case_id,
    recipient.id,
    'created',
    actor.actor_membership_id,
    fixed_reason,
    p_request_id
  );

  result := jsonb_build_object(
    'organization_id', p_organization_id,
    'notification_id', notification_id,
    'student_case_id', p_student_case_id,
    'recipient_membership_id', recipient.id,
    'category', normalized_category,
    'title', normalized_title,
    'body', normalized_body,
    'dedupe_key', normalized_dedupe_key,
    'in_app_intent_id', in_app_intent_id,
    'in_app_intent_status', 'pending',
    'whatsapp_intent_id', whatsapp_intent_id,
    'whatsapp_intent_status', whatsapp_status,
    'notification_consent_id',
      CASE WHEN consent_exists THEN consent_row.id END,
    'consent_status_snapshot',
      CASE WHEN consent_exists THEN consent_row.status END,
    'created_at', statement_timestamp(),
    'deduplicated', FALSE,
    'delivery_proof', FALSE
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
    'notification.create',
    'notification',
    notification_id,
    NULL,
    result,
    fixed_reason,
    p_request_id
  );

  RETURN result;
END
$$;

CREATE OR REPLACE FUNCTION platform.mark_own_notification_read(
  p_organization_id UUID,
  p_notification_id UUID,
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
  target_notification platform.notifications%ROWTYPE;
  replayed JSONB;
  read_at_value TIMESTAMPTZ := statement_timestamp();
  fixed_reason TEXT := 'Recipient marked the in-app notification as read';
  result JSONB;
BEGIN
  PERFORM platform_private.lock_p2e_request(p_request_id);

  IF p_notification_id IS NULL THEN
    RAISE EXCEPTION
      'notification_id is required'
      USING ERRCODE = '22023';
  END IF;

  SELECT *
  INTO actor
  FROM platform_private.require_domain_actor(
    p_organization_id,
    'notification.read.self'
  );

  replayed := platform_private.replay_audit(
    p_request_id,
    'notification.read',
    'notification',
    p_notification_id,
    fixed_reason,
    jsonb_build_object(
      'organization_id', p_organization_id,
      'notification_id', p_notification_id,
      'recipient_membership_id', actor.actor_membership_id,
      'read', TRUE
    )
  );
  IF replayed IS NOT NULL THEN
    RETURN replayed;
  END IF;

  SELECT *
  INTO target_notification
  FROM platform.notifications AS notification
  WHERE notification.organization_id = p_organization_id
    AND notification.id = p_notification_id
    AND notification.recipient_membership_id =
      actor.actor_membership_id
  FOR UPDATE;

  IF NOT FOUND
    OR NOT private.platform_can_read_student_portal_case(
      p_organization_id,
      target_notification.student_case_id
    )
  THEN
    RAISE EXCEPTION
      'Notification is unavailable'
      USING ERRCODE = '42501';
  END IF;

  SELECT *
  INTO actor
  FROM platform_private.require_domain_actor(
    p_organization_id,
    'notification.read.self'
  );

  IF target_notification.read_at IS NOT NULL THEN
    RAISE EXCEPTION
      'Notification is already read; reuse the original request_id'
      USING ERRCODE = '22023';
  END IF;

  UPDATE platform.notifications AS notification
  SET read_at = read_at_value
  WHERE notification.organization_id = p_organization_id
    AND notification.id = p_notification_id;

  INSERT INTO platform.notification_events (
    organization_id,
    notification_id,
    student_case_id,
    recipient_membership_id,
    event_type,
    actor_membership_id,
    reason,
    request_id
  )
  VALUES (
    p_organization_id,
    p_notification_id,
    target_notification.student_case_id,
    actor.actor_membership_id,
    'read',
    actor.actor_membership_id,
    fixed_reason,
    p_request_id
  );

  result := jsonb_build_object(
    'organization_id', p_organization_id,
    'notification_id', p_notification_id,
    'student_case_id', target_notification.student_case_id,
    'recipient_membership_id', actor.actor_membership_id,
    'read', TRUE,
    'read_at', read_at_value
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
    'notification.read',
    'notification',
    p_notification_id,
    jsonb_build_object('read_at', target_notification.read_at),
    result,
    fixed_reason,
    p_request_id
  );

  RETURN result;
END
$$;

CREATE OR REPLACE FUNCTION platform.my_notifications()
RETURNS TABLE (
  notification_id UUID,
  student_case_id UUID,
  category TEXT,
  title TEXT,
  body TEXT,
  created_at TIMESTAMPTZ,
  read_at TIMESTAMPTZ,
  in_app_status platform.notification_intent_status,
  individual_whatsapp_status platform.notification_intent_status
)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    notification.id,
    notification.student_case_id,
    notification.category,
    notification.title,
    notification.body,
    notification.created_at,
    notification.read_at,
    in_app.status,
    individual_whatsapp.status
  FROM platform.notifications AS notification
  JOIN platform.organization_memberships AS recipient
    ON recipient.organization_id = notification.organization_id
    AND recipient.id = notification.recipient_membership_id
  JOIN platform.profiles AS profile
    ON profile.id = recipient.profile_id
  JOIN platform.notification_delivery_intents AS in_app
    ON in_app.organization_id = notification.organization_id
    AND in_app.notification_id = notification.id
    AND in_app.student_case_id = notification.student_case_id
    AND in_app.recipient_membership_id =
      notification.recipient_membership_id
    AND in_app.channel = 'in_app'
  JOIN platform.notification_delivery_intents AS individual_whatsapp
    ON individual_whatsapp.organization_id =
      notification.organization_id
    AND individual_whatsapp.notification_id = notification.id
    AND individual_whatsapp.student_case_id =
      notification.student_case_id
    AND individual_whatsapp.recipient_membership_id =
      notification.recipient_membership_id
    AND individual_whatsapp.channel = 'individual_whatsapp'
  WHERE profile.auth_user_id = (SELECT auth.uid())
    AND recipient.status = 'active'
    AND recipient."current_role" = 'student'
    AND profile.status = 'active'
    AND private.platform_has_permission(
      notification.organization_id,
      'notification.read.self'
    )
    AND private.platform_can_read_student_portal_case(
      notification.organization_id,
      notification.student_case_id
    )
  ORDER BY notification.created_at DESC, notification.id DESC
$$;

-- Base rows remain deny-by-default. Authenticated callers receive SELECT only
-- where an explicit RLS policy exists; all mutations stay behind reviewed
-- SECURITY DEFINER RPCs. Notification bodies are available only through the
-- fixed self projection, never through base tables.
REVOKE ALL PRIVILEGES ON TABLE
  platform.document_requirements,
  platform.document_slots,
  platform.document_versions,
  platform.document_validation_events,
  platform.document_reviews,
  platform.document_access_events,
  platform.payment_obligations,
  platform.payment_events,
  platform.payment_evidence,
  platform.stop_factors,
  platform.stop_factor_events,
  platform.notification_consents,
  platform.notification_consent_events,
  platform.notifications,
  platform.notification_delivery_intents,
  platform.notification_events
FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

GRANT SELECT ON TABLE
  platform.document_requirements,
  platform.document_slots,
  platform.document_versions,
  platform.document_validation_events,
  platform.document_reviews,
  platform.document_access_events,
  platform.payment_obligations,
  platform.payment_events,
  platform.payment_evidence,
  platform.stop_factors,
  platform.stop_factor_events
TO authenticated;

REVOKE ALL PRIVILEGES ON TYPE
  platform.document_requirement_status,
  platform.document_slot_status,
  platform.document_integrity_status,
  platform.document_malware_status,
  platform.document_review_decision,
  platform.obligation_category,
  platform.obligation_status,
  platform.payment_event_type,
  platform.stop_factor_status,
  platform.stop_factor_resolution_kind,
  platform.notification_channel,
  platform.notification_consent_status,
  platform.notification_intent_status,
  platform.notification_event_type
FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

GRANT USAGE ON TYPE
  platform.document_requirement_status,
  platform.document_slot_status,
  platform.document_integrity_status,
  platform.document_malware_status,
  platform.document_review_decision,
  platform.obligation_category,
  platform.obligation_status,
  platform.payment_event_type,
  platform.stop_factor_status,
  platform.stop_factor_resolution_kind,
  platform.notification_channel,
  platform.notification_consent_status,
  platform.notification_intent_status,
  platform.notification_event_type
TO authenticated;

GRANT USAGE ON TYPE
  platform.document_integrity_status,
  platform.document_malware_status
TO service_role;

REVOKE ALL ON FUNCTION platform.create_document_requirement(
  UUID,
  TEXT,
  TEXT,
  TEXT,
  BIGINT,
  TEXT,
  TEXT,
  TEXT,
  UUID
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.create_document_requirement(
  UUID,
  TEXT,
  TEXT,
  TEXT,
  BIGINT,
  TEXT,
  TEXT,
  TEXT,
  UUID
) TO authenticated;

REVOKE ALL ON FUNCTION platform.retire_document_requirement(
  UUID,
  UUID,
  TEXT,
  UUID
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.retire_document_requirement(
  UUID,
  UUID,
  TEXT,
  UUID
) TO authenticated;

REVOKE ALL ON FUNCTION platform.create_document_slot(
  UUID,
  UUID,
  UUID,
  TIMESTAMPTZ,
  TEXT,
  UUID
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.create_document_slot(
  UUID,
  UUID,
  UUID,
  TIMESTAMPTZ,
  TEXT,
  UUID
) TO authenticated;

REVOKE ALL ON FUNCTION platform.record_document_version_metadata(
  UUID,
  UUID,
  UUID,
  TEXT,
  TEXT,
  BIGINT,
  TEXT,
  TEXT,
  UUID
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.record_document_version_metadata(
  UUID,
  UUID,
  UUID,
  TEXT,
  TEXT,
  BIGINT,
  TEXT,
  TEXT,
  UUID
) TO service_role;

REVOKE ALL ON FUNCTION platform.attest_document_validation(
  UUID,
  UUID,
  platform.document_integrity_status,
  platform.document_malware_status,
  TEXT,
  TEXT,
  UUID
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.attest_document_validation(
  UUID,
  UUID,
  platform.document_integrity_status,
  platform.document_malware_status,
  TEXT,
  TEXT,
  UUID
) TO service_role;

REVOKE ALL ON FUNCTION platform.review_document_version(
  UUID,
  UUID,
  platform.document_review_decision,
  TEXT,
  UUID
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.review_document_version(
  UUID,
  UUID,
  platform.document_review_decision,
  TEXT,
  UUID
) TO authenticated;

REVOKE ALL ON FUNCTION platform.sales_document_checklist()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.sales_document_checklist()
  TO authenticated;

REVOKE ALL ON FUNCTION platform.student_portal_documents()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.student_portal_documents()
  TO authenticated;

REVOKE ALL ON FUNCTION platform.create_payment_obligation(
  UUID,
  UUID,
  TEXT,
  platform.obligation_category,
  BIGINT,
  TEXT,
  TIMESTAMPTZ,
  TEXT,
  TEXT,
  UUID
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.create_payment_obligation(
  UUID,
  UUID,
  TEXT,
  platform.obligation_category,
  BIGINT,
  TEXT,
  TIMESTAMPTZ,
  TEXT,
  TEXT,
  UUID
) TO authenticated;

REVOKE ALL ON FUNCTION platform.record_payment_event(
  UUID,
  UUID,
  platform.payment_event_type,
  UUID,
  BIGINT,
  TEXT,
  TIMESTAMPTZ,
  TEXT,
  TEXT,
  TEXT,
  UUID
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.record_payment_event(
  UUID,
  UUID,
  platform.payment_event_type,
  UUID,
  BIGINT,
  TEXT,
  TIMESTAMPTZ,
  TEXT,
  TEXT,
  TEXT,
  UUID
) TO authenticated;

REVOKE ALL ON FUNCTION platform.create_stop_factor(
  UUID,
  UUID,
  UUID,
  UUID,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  UUID
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.create_stop_factor(
  UUID,
  UUID,
  UUID,
  UUID,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  UUID
) TO authenticated;

REVOKE ALL ON FUNCTION platform.resolve_stop_factor(
  UUID,
  UUID,
  platform.stop_factor_resolution_kind,
  UUID,
  TEXT,
  TEXT,
  UUID
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.resolve_stop_factor(
  UUID,
  UUID,
  platform.stop_factor_resolution_kind,
  UUID,
  TEXT,
  TEXT,
  UUID
) TO authenticated;

REVOKE ALL ON FUNCTION platform.case_finance_summaries()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.case_finance_summaries()
  TO authenticated;

REVOKE ALL ON FUNCTION platform.student_portal_finance()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.student_portal_finance()
  TO authenticated;

REVOKE ALL ON FUNCTION platform.set_own_notification_consent(
  UUID,
  platform.notification_consent_status,
  TEXT,
  TEXT,
  UUID
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.set_own_notification_consent(
  UUID,
  platform.notification_consent_status,
  TEXT,
  TEXT,
  UUID
) TO authenticated;

REVOKE ALL ON FUNCTION platform.create_individual_notification(
  UUID,
  UUID,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  UUID
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.create_individual_notification(
  UUID,
  UUID,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  UUID
) TO authenticated;

REVOKE ALL ON FUNCTION platform.mark_own_notification_read(
  UUID,
  UUID,
  UUID
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.mark_own_notification_read(
  UUID,
  UUID,
  UUID
) TO authenticated;

REVOKE ALL ON FUNCTION platform.my_notifications()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.my_notifications()
  TO authenticated;

COMMENT ON TABLE platform.document_requirements IS
  'Versioned operational checklists. No Storage object or provider-validation proof is claimed.';
COMMENT ON TABLE platform.document_slots IS
  'Case-scoped document requests matched to the approved admissions route.';
COMMENT ON TABLE platform.document_versions IS
  'Immutable private-file metadata only; Storage bytes remain outside database backup evidence.';
COMMENT ON TABLE platform.document_validation_events IS
  'Append-only service attestations for integrity and malware states; not scanner-provider proof by themselves.';
COMMENT ON TABLE platform.document_reviews IS
  'Append-only Admin or assigned-Curator review decisions over validated versions.';
COMMENT ON TABLE platform.document_access_events IS
  'Append-only audited access contract; this migration does not implement signed Storage downloads.';
COMMENT ON TABLE platform.payment_obligations IS
  'Manual operational obligations in integer minor units; not an accounting-system connector.';
COMMENT ON TABLE platform.payment_events IS
  'Append-only evidence-backed payment or exact-payment-linked refund confirmations.';
COMMENT ON TABLE platform.payment_evidence IS
  'Opaque evidence references for manual payment and refund confirmations.';
COMMENT ON TABLE platform.stop_factors IS
  'Operational finance holds with evidence-backed resolution and no automatic external action.';
COMMENT ON TABLE platform.stop_factor_events IS
  'Append-only stop-factor lifecycle evidence.';
COMMENT ON TABLE platform.notification_consents IS
  'Current self-managed consent for individual WhatsApp notification intents only.';
COMMENT ON TABLE platform.notification_consent_events IS
  'Append-only consent transition evidence.';
COMMENT ON TABLE platform.notifications IS
  'Exactly one case Student recipient per durable in-app notification.';
COMMENT ON TABLE platform.notification_delivery_intents IS
  'Durable in-app and individual-WhatsApp intents. Pending is authorization to process, not provider delivery proof.';
COMMENT ON TABLE platform.notification_events IS
  'Append-only created/read/cancelled business events; no provider identifiers or delivery acknowledgements.';
COMMENT ON FUNCTION platform.record_document_version_metadata(
  UUID,
  UUID,
  UUID,
  TEXT,
  TEXT,
  BIGINT,
  TEXT,
  TEXT,
  UUID
) IS
  'Service-only metadata persistence after private upload handling; returns storage_proof false.';
COMMENT ON FUNCTION platform.attest_document_validation(
  UUID,
  UUID,
  platform.document_integrity_status,
  platform.document_malware_status,
  TEXT,
  TEXT,
  UUID
) IS
  'Service-only validation attestation; database state is not external scanner-provider proof.';
COMMENT ON FUNCTION platform.record_payment_event(
  UUID,
  UUID,
  platform.payment_event_type,
  UUID,
  BIGINT,
  TEXT,
  TIMESTAMPTZ,
  TEXT,
  TEXT,
  TEXT,
  UUID
) IS
  'Finance/Admin confirmation with evidence; every refund references and is capped by one exact payment.';
COMMENT ON FUNCTION platform.create_individual_notification(
  UUID,
  UUID,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  UUID
) IS
  'Creates exactly two durable intents for one case Student. It does not send WhatsApp or claim delivery.';
COMMENT ON FUNCTION platform.my_notifications() IS
  'Fixed activated-Portal self history with no provider IDs, consent evidence or staff internals.';

COMMIT;
