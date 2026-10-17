-- «Отчёт продаж»: служебный перенос строк отчёта с созданием и связыванием карточек
-- лидов (поручение владельца 17.10.2026). docs/PLAN_CHANGES.md «2026-10-18 · Отчёт
-- продаж: перенос строк с созданием и связыванием карточек лидов (миграция 299,
-- запись до кода)».
--
-- Forward-only and additive. One table, three helper functions, one client-facing
-- function and one body edit of an existing private read (marketing_cohort). The
-- migration 134 / 253 / 254 / 281 objects it reuses are only read and called.
-- SECURITY DEFINER with the empty search_path throughout; the one callable
-- function lives in `platform`.
--
-- Why: 134's import_sales_register_v1 only lays rows down (an Admin session, no
-- people), 254's link is one record at a time from the interface, and 281 /
-- 287 import and complete student CASES. The owner's report (xlsx) has to enter
-- the CRM «as it should»: a row the student already put in the CRM is tied to
-- that student's lead, a person who is not in the CRM gets a lead card, the
-- people in work get their cases from the existing 281 import. This is the same
-- service-only boundary and the same actor (the owner's Admin membership).
--
--  a) platform_private.sales_report_import_receipts: the idempotency receipt of
--     one call (organization, import source, external reference) with the md5 of
--     the payload, the actor, the report record and the version this call left,
--     the lead note, the answer returned and the before_state: the previous values
--     of the record a `refresh` overwrote. Append-only, forced RLS, no client
--     grant (like 281's and 287's receipts); the before_state is never returned
--     and never written to platform.audit_events.
--  b) platform_private.sales_report_import_text / _object / _snapshot_ok: strict
--     parsing helpers (281's and 287's, with this function's error names; the
--     snapshot check is 134's, key for key).
--  c) platform.import_sales_report_row_v1 (service_role only, no user JWT): one
--     transaction that, for one report row, (1) lays it down (`insert`), brings an
--     untouched import row up to the new source (`refresh`) or leaves it alone
--     (`link_only`), and (2) ties it to a lead (`link_lead`, 254's rules) or
--     creates the person's client and lead and ties the row to it (`create_lead`).
--     The row's fields go through 134's own validator
--     (platform_private.sales_register_fields; USD / EUR / KGS).
--  d) A lead created here is a person who bought, not a sales enquiry: lifecycle
--     `converted`, no sales owner (as 281), source `sales_report`. Marketing reads
--     leads by their creation day, so `marketing_cohort` leaves them out exactly
--     as it leaves out 281's `admissions_direct` (body edit, number of
--     replacements checked).
--  e) Journal: every change writes platform.audit_events with the principal
--     `service:sales-report-import`, the Admin actor's profile and membership and
--     request ids derived from the receipt key (uuid v5 by event name). Only
--     actions already in the journal allowlist are used (sales.register.import,
--     sales.register.lead.link, lead.manual.create): the allowlist stays as it is.
--     No name, phone, e-mail, note or field value reaches the journal.
BEGIN;

-- ---------------------------------------------------------------------------
-- Anchors: what this migration reuses is the live 134 / 253 / 254 / 281 shape.
-- ---------------------------------------------------------------------------
DO $a299_anchor$
BEGIN
  IF to_regprocedure('platform_private.sales_register_fields(jsonb,boolean)') IS NULL
    -- 253's anchor: the validator is the 134 definition.
    OR (SELECT md5(p.prosrc) FROM pg_catalog.pg_proc p
        WHERE p.oid = 'platform_private.sales_register_fields(jsonb,boolean)'::regprocedure)
      IS DISTINCT FROM '3afe9eec0198bd830ef7b6ca9af2878b'
    OR to_regclass('platform_private.sales_register') IS NULL
    OR to_regprocedure('platform_private.admissions_direct_phone(text)') IS NULL
    OR to_regprocedure('platform_private.admissions_direct_phone_keys(text)') IS NULL
    OR to_regprocedure('platform_private.staff_membership_identity(uuid,uuid)') IS NULL
    OR to_regprocedure('platform_private.staff_has_permission(uuid,uuid,text)') IS NULL
    OR to_regprocedure('platform_private.staff_can_access(uuid,uuid,text,text,uuid)') IS NULL
    OR to_regprocedure('platform_private.normalize_person_email(text)') IS NULL
    OR to_regprocedure('platform_private.lock_p2d_request(uuid)') IS NULL
    OR to_regprocedure('platform_private.block_append_only_mutation()') IS NULL
    OR to_regprocedure('platform_private.create_or_link_client(uuid,text,text,text,text,text,text,text,timestamptz,timestamptz,text)') IS NULL
    OR to_regprocedure('platform_private.create_or_link_lead(uuid,uuid,uuid,text,text,text,text,text,text,timestamptz,timestamptz,text)') IS NULL
    OR to_regprocedure('public.uuid_generate_v5(uuid,text)') IS NULL
    OR to_regprocedure('platform_private.marketing_cohort(uuid,date,date)') IS NULL
    -- 254: the context link and its one-lead-one-row index.
    OR NOT EXISTS (SELECT 1 FROM information_schema.columns c
      WHERE c.table_schema = 'platform_private' AND c.table_name = 'sales_register' AND c.column_name = 'linked_lead_id')
    OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_indexes i
      WHERE i.schemaname = 'platform_private' AND i.indexname = 'sales_register_linked_lead_unique_idx')
    -- 143: the lead's interest direction.
    OR NOT EXISTS (SELECT 1 FROM information_schema.columns c
      WHERE c.table_schema = 'platform' AND c.table_name = 'leads' AND c.column_name = 'interest_direction')
  THEN
    RAISE EXCEPTION 'a299_anchor_drift';
  END IF;
END
$a299_anchor$;

-- Self-verifying replace inside one function body (the 173 / 244 / 281 pattern).
CREATE FUNCTION pg_temp.a299_replace(p_signature TEXT, p_old TEXT, p_new TEXT, p_count INTEGER)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE body TEXT; matches INTEGER;
BEGIN
  body := pg_get_functiondef(to_regprocedure(p_signature));
  matches := (length(body) - length(replace(body, p_old, ''))) / length(p_old);
  IF body IS NULL OR matches IS DISTINCT FROM p_count THEN
    RAISE EXCEPTION 'a299_replace_drift: % expected %, found %', p_signature, p_count, matches;
  END IF;
  EXECUTE replace(body, p_old, p_new);
END $$;

-- ---------------------------------------------------------------------------
-- a) The receipt of one call (idempotency by source and external reference)
-- ---------------------------------------------------------------------------
CREATE TABLE platform_private.sales_report_import_receipts (
  organization_id UUID NOT NULL REFERENCES platform.organizations(id) ON DELETE RESTRICT,
  import_source TEXT NOT NULL CHECK (import_source ~ '^[a-z][a-z0-9_.-]{1,63}$'),
  external_ref TEXT NOT NULL CHECK (char_length(external_ref) BETWEEN 1 AND 200 AND external_ref !~ '[[:cntrl:]]'),
  actor_membership_id UUID NOT NULL,
  payload_md5 TEXT NOT NULL CHECK (payload_md5 ~ '^[0-9a-f]{32}$'),
  -- The record this call is about and, only when the call itself changed it, the
  -- version it left (NULL otherwise): `refresh` tells its own writes from a
  -- person's edits by this number.
  register_id UUID,
  register_version BIGINT CHECK (register_version IS NULL OR register_version >= 1),
  -- The lead has no note of its own: a note sent with `create_lead` is kept here.
  lead_note TEXT CHECK (lead_note IS NULL OR char_length(lead_note) BETWEEN 1 AND 3500),
  result JSONB NOT NULL CHECK (jsonb_typeof(result) = 'object'),
  -- The previous values of what the call changed ('{}' when it changed nothing).
  before_state JSONB NOT NULL CHECK (jsonb_typeof(before_state) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  receipt_seq BIGINT GENERATED ALWAYS AS IDENTITY,
  PRIMARY KEY (organization_id, import_source, external_ref),
  FOREIGN KEY (organization_id, actor_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, register_id)
    REFERENCES platform_private.sales_register(organization_id, id) ON DELETE RESTRICT
);
CREATE INDEX sales_report_import_receipts_register_idx
  ON platform_private.sales_report_import_receipts (organization_id, register_id, receipt_seq DESC)
  WHERE register_id IS NOT NULL;
ALTER TABLE platform_private.sales_report_import_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.sales_report_import_receipts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE platform_private.sales_report_import_receipts
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
CREATE TRIGGER sales_report_import_receipts_append_only
  BEFORE UPDATE OR DELETE ON platform_private.sales_report_import_receipts
  FOR EACH ROW EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER sales_report_import_receipts_no_truncate
  BEFORE TRUNCATE ON platform_private.sales_report_import_receipts
  FOR EACH STATEMENT EXECUTE FUNCTION platform_private.block_append_only_mutation();
COMMENT ON TABLE platform_private.sales_report_import_receipts IS
  'Migration 299: one row per accepted import_sales_report_row_v1 call (idempotency by organization, import source and external reference; payload md5, actor, the record and the version the call left, the lead note, the answer and the before_state with the previous values of what a refresh overwrote). Backend only, append-only.';

-- ---------------------------------------------------------------------------
-- b) Strict parsing helpers
-- ---------------------------------------------------------------------------
-- Optional text of a payload key: NULL when absent, null or blank; a refusal
-- names the key when it is not a string, too long or carries control
-- characters (newlines only where p_multiline). 281's admissions_direct_text.
CREATE FUNCTION platform_private.sales_report_import_text(
  p_object JSONB, p_key TEXT, p_max INTEGER, p_multiline BOOLEAN DEFAULT FALSE
) RETURNS TEXT LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE value TEXT;
BEGIN
  IF p_object IS NULL OR NOT (p_object ? p_key) OR jsonb_typeof(p_object -> p_key) = 'null' THEN RETURN NULL; END IF;
  IF jsonb_typeof(p_object -> p_key) <> 'string' THEN
    RAISE EXCEPTION 'sales_report_import_invalid:%', p_key USING ERRCODE = '22023';
  END IF;
  value := btrim(p_object ->> p_key, E' \t\r\n');
  IF value = '' THEN RETURN NULL; END IF;
  IF char_length(value) > p_max
    OR (NOT p_multiline AND value ~ '[[:cntrl:]]')
    OR (p_multiline AND value ~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]') THEN
    RAISE EXCEPTION 'sales_report_import_invalid:%', p_key USING ERRCODE = '22023';
  END IF;
  RETURN value;
END $$;

-- An object (or absent/null) whose keys are all in p_allowed. The refusal names
-- the first offending key (sorted); a key that is not a plain word is reported
-- as the object (nothing a caller typed is echoed back). 287's helper.
CREATE FUNCTION platform_private.sales_report_import_object(p_value JSONB, p_label TEXT, p_allowed TEXT[])
RETURNS JSONB LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE offending TEXT;
BEGIN
  IF p_value IS NULL OR jsonb_typeof(p_value) = 'null' THEN RETURN NULL; END IF;
  IF jsonb_typeof(p_value) <> 'object' THEN
    RAISE EXCEPTION 'sales_report_import_invalid:%', p_label USING ERRCODE = '22023';
  END IF;
  SELECT min(k) INTO offending FROM jsonb_object_keys(p_value) k WHERE NOT (k = ANY (p_allowed));
  IF offending IS NOT NULL THEN
    RAISE EXCEPTION 'sales_report_import_invalid:%',
      CASE WHEN offending ~ '^[A-Za-z][A-Za-z0-9_]{0,39}$' THEN offending ELSE p_label END
      USING ERRCODE = '22023';
  END IF;
  RETURN p_value;
END $$;

-- 134's check of an import row's source snapshot, key for key: an object of at
-- most 40000 bytes whose keys are the documented ones, scalars of at most 2000
-- characters, and review_flags an array of at most 30 strings of 150.
CREATE FUNCTION platform_private.sales_report_import_snapshot_ok(p_snapshot JSONB)
RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE snapshot_key TEXT;
BEGIN
  IF p_snapshot IS NULL OR jsonb_typeof(p_snapshot) <> 'object' OR pg_column_size(p_snapshot) > 40000 THEN RETURN FALSE; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_object_keys(p_snapshot) k WHERE k NOT IN ('signing_date_raw', 'signing_date_type',
      'intake_raw', 'status_raw', 'status_column_present', 'service_cost_raw', 'paid_raw', 'service_cost_number_format',
      'paid_number_format', 'source_period_year_inferred', 'review_flags', 'applicant_name', 'phone', 'country',
      'university', 'program', 'direction', 'intake', 'contract_number', 'manager_label')) THEN
    RETURN FALSE;
  END IF;
  FOR snapshot_key IN SELECT jsonb_object_keys(p_snapshot) LOOP
    IF snapshot_key = 'review_flags' THEN
      IF jsonb_typeof(p_snapshot -> snapshot_key) <> 'array' OR jsonb_array_length(p_snapshot -> snapshot_key) > 30
        OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_snapshot -> snapshot_key) f
          WHERE jsonb_typeof(f) <> 'string' OR length(f #>> '{}') > 150) THEN
        RETURN FALSE;
      END IF;
    ELSIF jsonb_typeof(p_snapshot -> snapshot_key) NOT IN ('string', 'number', 'boolean', 'null')
      OR length(p_snapshot ->> snapshot_key) > 2000 THEN
      RETURN FALSE;
    END IF;
  END LOOP;
  RETURN TRUE;
END $$;

REVOKE ALL ON FUNCTION platform_private.sales_report_import_text(JSONB, TEXT, INTEGER, BOOLEAN),
  platform_private.sales_report_import_object(JSONB, TEXT, TEXT[]),
  platform_private.sales_report_import_snapshot_ok(JSONB)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

-- ---------------------------------------------------------------------------
-- c) The service-only import of one report row
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform.import_sales_report_row_v1(
  p_organization_id UUID, p_actor_membership_id UUID, p_import_source TEXT, p_external_ref TEXT,
  p_payload JSONB, p_reason TEXT
) RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  c_principal CONSTANT TEXT := 'service:sales-report-import';
  c_observed CONSTANT TIMESTAMPTZ := statement_timestamp();
  c_namespace CONSTANT UUID := '6ba7b811-9dad-11d1-80b4-00c04fd430c8';
  c_row_keys CONSTANT TEXT[] := ARRAY['mode', 'source_key', 'source_sheet', 'source_row', 'source_sha256',
    'source_snapshot', 'report_month', 'fields'];
  c_field_keys CONSTANT TEXT[] := ARRAY['signing_date', 'applicant_name', 'phone', 'country', 'university', 'program',
    'direction', 'intake', 'contract_number', 'manager_label', 'status_raw', 'service_cost_raw', 'service_cost_minor',
    'service_cost_currency', 'paid_raw', 'paid_minor', 'paid_currency', 'needs_review', 'notes'];
  v_ref TEXT := btrim(p_external_ref);
  v_reason TEXT := btrim(p_reason);
  v_actor RECORD;
  v_base UUID;
  v_hash TEXT;
  v_prior platform_private.sales_report_import_receipts%ROWTYPE;
  -- parsed payload
  v_payload JSONB; v_row JSONB; v_person JSONB; v_client JSONB; v_input_fields JSONB;
  v_row_mode TEXT; v_person_mode TEXT;
  v_key TEXT; v_sheet TEXT; v_src_row INTEGER; v_sha TEXT; v_snapshot JSONB; v_month DATE; v_fields JSONB;
  v_fingerprint TEXT;
  v_lead_raw TEXT; v_lead UUID;
  v_name TEXT; v_phone_raw TEXT; v_phone TEXT; v_email_raw TEXT; v_email TEXT; v_keys TEXT[] := ARRAY[]::TEXT[];
  v_direction TEXT; v_interest TEXT; v_note TEXT; v_lock TEXT;
  -- the report row
  v_reg platform_private.sales_register%ROWTYPE;
  v_reg_found BOOLEAN;
  v_row_status TEXT := 'none';
  v_last_version BIGINT;
  v_changed TEXT[] := ARRAY[]::TEXT[];
  v_before_version BIGINT;
  -- the person
  v_person_status TEXT := 'none';
  v_do_link BOOLEAN := FALSE;
  v_case UUID; v_found_lead UUID; v_matched_client UUID; v_new_client UUID; v_new_lead UUID;
  v_client_reused BOOLEAN := FALSE;
  v_lead_out UUID; v_client_out UUID;
  v_before JSONB := '{}'::JSONB;
  v_status TEXT;
  v_result JSONB;
BEGIN
  IF p_organization_id IS NULL OR p_actor_membership_id IS NULL THEN
    RAISE EXCEPTION 'sales_report_import_forbidden' USING ERRCODE = '42501';
  END IF;
  -- Service path only: no end-user identity may reach it (the grants already
  -- exclude anon and authenticated).
  IF NULLIF(current_setting('request.jwt.claims', TRUE), '')::JSONB ->> 'sub' IS NOT NULL
    OR COALESCE(NULLIF(current_setting('request.jwt.claims', TRUE), '')::JSONB ->> 'role', '') IN ('anon', 'authenticated') THEN
    RAISE EXCEPTION 'sales_report_import_forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_import_source IS NULL OR p_import_source !~ '^[a-z][a-z0-9_.-]{1,63}$' THEN
    RAISE EXCEPTION 'sales_report_import_invalid:importSource' USING ERRCODE = '22023';
  END IF;
  IF v_ref IS NULL OR char_length(v_ref) NOT BETWEEN 1 AND 200 OR v_ref ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'sales_report_import_invalid:externalRef' USING ERRCODE = '22023';
  END IF;
  IF v_reason IS NULL OR char_length(v_reason) NOT BETWEEN 1 AND 500 OR v_reason ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'sales_report_import_invalid:reason' USING ERRCODE = '22023';
  END IF;
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' OR pg_column_size(p_payload) > 200000 THEN
    RAISE EXCEPTION 'sales_report_import_invalid:payload' USING ERRCODE = '22023';
  END IF;

  -- The actor first: the owner's Admin membership (the import's actor), holding
  -- the right 134's import checks (156: sales.register.import).
  SELECT * INTO v_actor FROM platform_private.staff_membership_identity(p_organization_id, p_actor_membership_id);
  IF NOT FOUND OR v_actor.system_role IS DISTINCT FROM 'admin'
    OR NOT platform_private.staff_has_permission(p_organization_id, v_actor.membership_id, 'sales.register.import') THEN
    RAISE EXCEPTION 'sales_report_import_forbidden' USING ERRCODE = '42501';
  END IF;

  -- ---- payload (strict; the fields through 134's own validator) --------------------------
  v_payload := platform_private.sales_report_import_object(p_payload, 'payload', ARRAY['row', 'person']);
  v_row := platform_private.sales_report_import_object(v_payload -> 'row', 'row', c_row_keys);
  IF v_row IS NULL THEN RAISE EXCEPTION 'sales_report_import_invalid:row' USING ERRCODE = '22023'; END IF;
  v_person := platform_private.sales_report_import_object(v_payload -> 'person', 'person',
    ARRAY['mode', 'lead_id', 'client', 'interest_direction', 'note']);

  v_row_mode := platform_private.sales_report_import_text(v_row, 'mode', 20);
  IF v_row_mode IS NULL OR v_row_mode NOT IN ('insert', 'refresh', 'link_only') THEN
    RAISE EXCEPTION 'sales_report_import_invalid:rowMode' USING ERRCODE = '22023';
  END IF;
  v_person_mode := COALESCE(platform_private.sales_report_import_text(v_person, 'mode', 20), 'none');
  IF v_person_mode NOT IN ('none', 'link_lead', 'create_lead') THEN
    RAISE EXCEPTION 'sales_report_import_invalid:personMode' USING ERRCODE = '22023';
  END IF;
  IF v_row_mode = 'link_only' AND v_person_mode = 'none' THEN
    RAISE EXCEPTION 'sales_report_import_invalid:person' USING ERRCODE = '22023';
  END IF;

  -- The stable key of the row, as 134 checks it (no trimming: it is an identifier).
  IF jsonb_typeof(v_row -> 'source_key') IS DISTINCT FROM 'string'
    OR char_length(v_row ->> 'source_key') NOT BETWEEN 1 AND 400 OR (v_row ->> 'source_key') ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'sales_report_import_invalid:source_key' USING ERRCODE = '22023';
  END IF;
  v_key := v_row ->> 'source_key';

  IF v_row_mode IN ('insert', 'refresh') THEN
    IF jsonb_typeof(v_row -> 'source_sheet') IS DISTINCT FROM 'string'
      OR char_length(v_row ->> 'source_sheet') NOT BETWEEN 1 AND 150 OR (v_row ->> 'source_sheet') ~ '[[:cntrl:]]' THEN
      RAISE EXCEPTION 'sales_report_import_invalid:source_sheet' USING ERRCODE = '22023';
    END IF;
    v_sheet := v_row ->> 'source_sheet';
    -- 134 reads the row number as text, so a JSON number and a digit string both pass.
    IF jsonb_typeof(v_row -> 'source_row') NOT IN ('number', 'string')
      OR coalesce(v_row ->> 'source_row', '') !~ '^[1-9][0-9]{0,5}$' THEN
      RAISE EXCEPTION 'sales_report_import_invalid:source_row' USING ERRCODE = '22023';
    END IF;
    v_src_row := (v_row ->> 'source_row')::INTEGER;
    IF v_src_row > 100000 THEN
      RAISE EXCEPTION 'sales_report_import_invalid:source_row' USING ERRCODE = '22023';
    END IF;
    IF jsonb_typeof(v_row -> 'source_sha256') IS DISTINCT FROM 'string'
      OR coalesce(v_row ->> 'source_sha256', '') !~ '^[a-f0-9]{64}$' THEN
      RAISE EXCEPTION 'sales_report_import_invalid:source_sha256' USING ERRCODE = '22023';
    END IF;
    v_sha := v_row ->> 'source_sha256';
    v_snapshot := v_row -> 'source_snapshot';
    IF NOT platform_private.sales_report_import_snapshot_ok(v_snapshot) THEN
      RAISE EXCEPTION 'sales_report_import_invalid:source_snapshot' USING ERRCODE = '22023';
    END IF;
    IF jsonb_typeof(v_row -> 'report_month') IS DISTINCT FROM 'string'
      OR coalesce(v_row ->> 'report_month', '') !~ '^(19|20|21)[0-9]{2}-[0-9]{2}-01$' THEN
      RAISE EXCEPTION 'sales_report_import_invalid:report_month' USING ERRCODE = '22023';
    END IF;
    BEGIN v_month := (v_row ->> 'report_month')::DATE;
    EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'sales_report_import_invalid:report_month' USING ERRCODE = '22023';
    END;
    v_input_fields := platform_private.sales_report_import_object(v_row -> 'fields', 'fields', c_field_keys);
    IF v_input_fields IS NULL THEN RAISE EXCEPTION 'sales_report_import_invalid:fields' USING ERRCODE = '22023'; END IF;
    -- 134's validator: the month rides inside the fields, the owner never (an
    -- import row has no owner; it is a person's explicit edit afterwards).
    v_fields := platform_private.sales_register_fields(v_input_fields || jsonb_build_object('report_month', v_row ->> 'report_month'));
    v_fingerprint := md5((v_row - 'mode')::TEXT);
  END IF;

  IF v_person_mode = 'link_lead' THEN
    IF (v_person ? 'client' AND jsonb_typeof(v_person -> 'client') <> 'null')
      OR (v_person ? 'interest_direction' AND jsonb_typeof(v_person -> 'interest_direction') <> 'null')
      OR (v_person ? 'note' AND jsonb_typeof(v_person -> 'note') <> 'null') THEN
      RAISE EXCEPTION 'sales_report_import_invalid:person' USING ERRCODE = '22023';
    END IF;
    v_lead_raw := lower(platform_private.sales_report_import_text(v_person, 'lead_id', 36));
    IF v_lead_raw IS NULL OR v_lead_raw !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION 'sales_report_import_invalid:lead_id' USING ERRCODE = '22023';
    END IF;
    v_lead := v_lead_raw::UUID;
  ELSIF v_person_mode = 'create_lead' THEN
    IF v_person ? 'lead_id' AND jsonb_typeof(v_person -> 'lead_id') <> 'null' THEN
      RAISE EXCEPTION 'sales_report_import_invalid:person' USING ERRCODE = '22023';
    END IF;
    v_client := platform_private.sales_report_import_object(v_person -> 'client', 'client', ARRAY['name', 'phone', 'email']);
    IF v_client IS NULL THEN RAISE EXCEPTION 'sales_report_import_invalid:client' USING ERRCODE = '22023'; END IF;
    v_name := platform_private.sales_report_import_text(v_client, 'name', 300);
    IF v_name IS NULL THEN RAISE EXCEPTION 'sales_report_import_invalid:name' USING ERRCODE = '22023'; END IF;
    -- One form for every phone (281's admissions_direct_phone): the match below,
    -- the client and the WhatsApp intake all see the same number.
    v_phone_raw := platform_private.sales_report_import_text(v_client, 'phone', 40);
    IF v_phone_raw IS NOT NULL THEN
      v_phone := platform_private.admissions_direct_phone(v_phone_raw);
      IF v_phone IS NULL THEN RAISE EXCEPTION 'sales_report_import_invalid:phone' USING ERRCODE = '22023'; END IF;
      v_keys := platform_private.admissions_direct_phone_keys(v_phone);
    END IF;
    v_email_raw := platform_private.sales_report_import_text(v_client, 'email', 120);
    IF v_email_raw IS NOT NULL THEN
      v_email := platform_private.normalize_person_email(v_email_raw);
      IF v_email IS NULL OR v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
        RAISE EXCEPTION 'sales_report_import_invalid:email' USING ERRCODE = '22023';
      END IF;
    END IF;
    v_direction := platform_private.sales_report_import_text(v_person, 'interest_direction', 10);
    IF v_direction IS NOT NULL AND v_direction NOT IN ('CN', 'MY', 'EUROPE', 'AE', 'TR') THEN
      RAISE EXCEPTION 'sales_report_import_invalid:interest_direction' USING ERRCODE = '22023';
    END IF;
    -- Stored as 143 and 281 store it: EUROPE is EU.
    v_interest := CASE v_direction WHEN 'EUROPE' THEN 'EU' ELSE v_direction END;
    v_note := platform_private.sales_report_import_text(v_person, 'note', 3500, TRUE);
  ELSE
    IF (v_person ? 'lead_id' AND jsonb_typeof(v_person -> 'lead_id') <> 'null')
      OR (v_person ? 'client' AND jsonb_typeof(v_person -> 'client') <> 'null')
      OR (v_person ? 'interest_direction' AND jsonb_typeof(v_person -> 'interest_direction') <> 'null')
      OR (v_person ? 'note' AND jsonb_typeof(v_person -> 'note') <> 'null') THEN
      RAISE EXCEPTION 'sales_report_import_invalid:person' USING ERRCODE = '22023';
    END IF;
  END IF;

  -- ---- one call, one request: locks, replay -------------------------------------------------
  -- The request id is derived from the receipt key: the same row sent twice is
  -- the same request. The organization's sales-register lock is the one every
  -- register command takes (134, 253, 254), so this call and the interface never
  -- write the same record at once.
  v_base := public.uuid_generate_v5(c_namespace,
    'evo:sales-report-import:' || p_organization_id::TEXT || ':' || p_import_source || ':' || v_ref);
  v_hash := md5(p_payload::TEXT);
  PERFORM platform_private.lock_p2d_request(v_base);
  PERFORM pg_advisory_xact_lock(hashtextextended('sales-register:' || p_organization_id::TEXT, 0));
  SELECT * INTO v_prior FROM platform_private.sales_report_import_receipts r
  WHERE r.organization_id = p_organization_id AND r.import_source = p_import_source AND r.external_ref = v_ref;
  IF FOUND THEN
    IF v_prior.payload_md5 <> v_hash OR v_prior.actor_membership_id <> p_actor_membership_id THEN
      RAISE EXCEPTION 'sales_report_import_request_conflict' USING ERRCODE = 'PT409';
    END IF;
    RETURN v_prior.result || jsonb_build_object('replayed', TRUE);
  END IF;

  -- ---- the report row ---------------------------------------------------------------------------
  SELECT * INTO v_reg FROM platform_private.sales_register r
  WHERE r.organization_id = p_organization_id AND r.source_key = v_key FOR UPDATE;
  v_reg_found := FOUND;

  IF v_row_mode = 'insert' THEN
    IF v_reg_found THEN
      -- The row is already there: the same source changes nothing, another source
      -- is a conflict (it is `refresh` that brings a row up to a new source).
      IF v_reg.source_sha256 IS DISTINCT FROM v_sha THEN
        RAISE EXCEPTION 'sales_report_import_conflict' USING ERRCODE = 'PT409';
      END IF;
      v_row_status := 'unchanged';
    ELSE
      INSERT INTO platform_private.sales_register (organization_id, report_month, fields, source_kind, source_key,
        source_sha256, source_sheet, source_row, source_snapshot, source_fingerprint)
      VALUES (p_organization_id, v_month, v_fields, 'import', v_key, v_sha, v_sheet, v_src_row, v_snapshot, v_fingerprint)
      RETURNING * INTO v_reg;
      v_row_status := 'inserted';
      INSERT INTO platform.audit_events (organization_id, actor_kind, actor_profile_id, actor_principal, actor_membership_id,
        action, resource_type, resource_id, before_state, after_state, reason, request_id)
      VALUES (p_organization_id, 'user', v_actor.profile_id, c_principal, v_actor.membership_id, 'sales.register.import',
        'sales_register', v_reg.id, NULL,
        jsonb_build_object('record_id', v_reg.id, 'operation', 'insert', 'version', v_reg.version::TEXT,
          'source_kind', 'import', 'import_source', p_import_source, 'external_ref', v_ref,
          'needs_review', (v_fields ->> 'needs_review')::BOOLEAN),
        v_reason, public.uuid_generate_v5(v_base, 'sales-report-import:row'));
    END IF;
  ELSIF v_row_mode = 'refresh' THEN
    IF NOT v_reg_found THEN
      RAISE EXCEPTION 'sales_report_row_missing' USING ERRCODE = 'PT404';
    END IF;
    IF v_reg.source_sha256 IS NOT DISTINCT FROM v_sha AND v_reg.report_month IS NOT DISTINCT FROM v_month
      AND v_reg.fields IS NOT DISTINCT FROM v_fields AND v_reg.source_snapshot IS NOT DISTINCT FROM v_snapshot
      AND v_reg.source_sheet IS NOT DISTINCT FROM v_sheet AND v_reg.source_row IS NOT DISTINCT FROM v_src_row THEN
      -- Nothing to bring up: the row already carries exactly this source (compared by
      -- content, so a row laid down by 134's import in its own shape is recognised too).
      v_row_status := 'unchanged';
    ELSE
      -- Not archived, no owner, no hand edit. A person's edit (the interface,
      -- archive and 254's link included) raises the version above the one this
      -- import last left; an untouched row is at version 1 or at exactly that one.
      SELECT r.register_version INTO v_last_version
      FROM platform_private.sales_report_import_receipts r
      WHERE r.organization_id = p_organization_id AND r.register_id = v_reg.id AND r.register_version IS NOT NULL
      ORDER BY r.receipt_seq DESC LIMIT 1;
      IF v_reg.archived OR v_reg.owner_membership_id IS NOT NULL
        OR NOT (v_reg.version = 1 OR v_reg.version IS NOT DISTINCT FROM v_last_version) THEN
        RAISE EXCEPTION 'sales_report_row_edited' USING ERRCODE = 'PT409';
      END IF;
      v_before := jsonb_build_object('register', jsonb_build_object('id', v_reg.id, 'version', v_reg.version::TEXT,
        'report_month', v_reg.report_month, 'fields', v_reg.fields, 'source_sheet', v_reg.source_sheet,
        'source_row', v_reg.source_row, 'source_sha256', v_reg.source_sha256, 'source_snapshot', v_reg.source_snapshot,
        'source_fingerprint', v_reg.source_fingerprint, 'updated_at', v_reg.updated_at));
      -- The names (never the values) of what changes, for the journal and the answer.
      SELECT COALESCE(array_agg(d.field_name ORDER BY d.field_name), ARRAY[]::TEXT[]) INTO v_changed
      FROM (SELECT COALESCE(o.key, n.key) AS field_name
        FROM jsonb_each(v_reg.fields) AS o(key, value) FULL JOIN jsonb_each(v_fields) AS n(key, value) ON n.key = o.key
        WHERE o.value IS DISTINCT FROM n.value) d;
      IF v_reg.report_month IS DISTINCT FROM v_month THEN v_changed := array_append(v_changed, 'report_month'::TEXT); END IF;
      IF v_reg.source_snapshot IS DISTINCT FROM v_snapshot THEN v_changed := array_append(v_changed, 'source_snapshot'::TEXT); END IF;
      v_before_version := v_reg.version;
      UPDATE platform_private.sales_register r
      SET report_month = v_month, fields = v_fields, source_sheet = v_sheet, source_row = v_src_row,
        source_sha256 = v_sha, source_snapshot = v_snapshot, source_fingerprint = v_fingerprint,
        version = r.version + 1, updated_at = now()
      WHERE r.organization_id = p_organization_id AND r.id = v_reg.id
      RETURNING * INTO v_reg;
      v_row_status := 'refreshed';
      INSERT INTO platform.audit_events (organization_id, actor_kind, actor_profile_id, actor_principal, actor_membership_id,
        action, resource_type, resource_id, before_state, after_state, reason, request_id)
      VALUES (p_organization_id, 'user', v_actor.profile_id, c_principal, v_actor.membership_id, 'sales.register.import',
        'sales_register', v_reg.id,
        jsonb_build_object('version', v_before_version::TEXT),
        jsonb_build_object('record_id', v_reg.id, 'operation', 'refresh', 'version', v_reg.version::TEXT,
          'changed', to_jsonb(v_changed), 'import_source', p_import_source, 'external_ref', v_ref),
        v_reason, public.uuid_generate_v5(v_base, 'sales-report-import:row'));
    END IF;
  ELSE
    -- link_only: the row is not changed, only the person below.
    IF NOT v_reg_found THEN
      RAISE EXCEPTION 'sales_report_row_missing' USING ERRCODE = 'PT404';
    END IF;
  END IF;

  -- ---- the person -------------------------------------------------------------------------------
  IF v_person_mode = 'link_lead' THEN
    PERFORM 1 FROM platform.leads l WHERE l.organization_id = p_organization_id AND l.id = v_lead;
    IF NOT FOUND THEN RAISE EXCEPTION 'sales_report_invalid_lead' USING ERRCODE = '22023'; END IF;
    IF NOT platform_private.staff_can_access(p_organization_id, v_actor.membership_id, 'lead.read', 'lead', v_lead) THEN
      RAISE EXCEPTION 'sales_report_import_forbidden' USING ERRCODE = '42501';
    END IF;
    v_lead_out := v_lead;
    IF v_reg.linked_lead_id IS NOT DISTINCT FROM v_lead THEN
      v_person_status := 'link_unchanged';
    ELSE
      IF v_reg.archived THEN RAISE EXCEPTION 'sales_report_row_archived' USING ERRCODE = 'PT409'; END IF;
      -- 254: one lead, one row; another lead on the row, a lead with a sale of its
      -- own (pipeline) or a lead tied to another row is a conflict.
      IF v_reg.linked_lead_id IS NOT NULL
        OR EXISTS (SELECT 1 FROM platform_private.sales_register r
          WHERE r.organization_id = p_organization_id AND r.lead_id = v_lead AND r.source_kind = 'pipeline')
        OR EXISTS (SELECT 1 FROM platform_private.sales_register r
          WHERE r.organization_id = p_organization_id AND r.linked_lead_id = v_lead AND r.id <> v_reg.id) THEN
        RAISE EXCEPTION 'sales_report_link_conflict' USING ERRCODE = 'PT409';
      END IF;
      v_do_link := TRUE;
    END IF;
  ELSIF v_person_mode = 'create_lead' THEN
    -- The contact locks of create_manual_sales_lead (143) and 281, in their sorted
    -- order, under every spelling of the phone: a manual lead, a direct case and
    -- this call for the same contact serialize.
    FOR v_lock IN SELECT DISTINCT v FROM unnest(v_keys || ARRAY[v_email]) v WHERE v IS NOT NULL ORDER BY v LOOP
      PERFORM pg_advisory_xact_lock(hashtextextended('manual-lead-contact:' || p_organization_id::TEXT || ':' || v_lock, 0));
    END LOOP;
    IF v_phone IS NOT NULL OR v_email IS NOT NULL THEN
      -- A case of this person (any state; a case in work first): find it in «Студенты».
      SELECT sc.id, sc.canonical_lead_id, cl.id INTO v_case, v_found_lead, v_matched_client
      FROM platform.clients cl
      JOIN platform.student_cases sc ON sc.organization_id = cl.organization_id
        AND (sc.canonical_client_id = cl.id OR sc.canonical_lead_id IN (
          SELECT l.id FROM platform.leads l WHERE l.organization_id = cl.organization_id AND l.client_id = cl.id))
      WHERE cl.organization_id = p_organization_id AND cl.lifecycle_state = 'active'
        AND (cl.normalized_phone = ANY (v_keys) OR (v_email IS NOT NULL AND cl.normalized_email = v_email))
      ORDER BY (sc.state IN ('pending', 'active')) DESC, sc.created_at, sc.id LIMIT 1;
      IF FOUND THEN
        v_person_status := 'case_exists';
        v_lead_out := v_found_lead;
        v_client_out := v_matched_client;
      ELSE
        -- A lead of this person (any lifecycle; an open one, then a converted one first).
        SELECT l.id, cl.id INTO v_found_lead, v_matched_client
        FROM platform.clients cl
        JOIN platform.leads l ON l.organization_id = cl.organization_id AND l.client_id = cl.id
        WHERE cl.organization_id = p_organization_id AND cl.lifecycle_state = 'active'
          AND (cl.normalized_phone = ANY (v_keys) OR (v_email IS NOT NULL AND cl.normalized_email = v_email))
        ORDER BY (l.lifecycle_state = 'open') DESC, (l.lifecycle_state = 'converted') DESC, l.updated_at DESC, l.id LIMIT 1;
        IF FOUND THEN
          v_person_status := 'lead_exists';
          v_lead_out := v_found_lead;
          v_client_out := v_matched_client;
        END IF;
      END IF;
    END IF;
    IF v_person_status = 'none' THEN
      -- Nobody of this name is in the CRM, so the row needs a new lead: an archived
      -- row cannot be tied, and a row already tied to a lead cannot be tied to
      -- another (a person found above is only reported, so a re-run of a row that
      -- was tied before answers lead_exists instead of failing). Nothing is created.
      IF v_reg.archived THEN RAISE EXCEPTION 'sales_report_row_archived' USING ERRCODE = 'PT409'; END IF;
      IF v_reg.linked_lead_id IS NOT NULL THEN RAISE EXCEPTION 'sales_report_link_conflict' USING ERRCODE = 'PT409'; END IF;
      -- The canonical identity path, with provenance.
      -- An exact e-mail + phone match is the same client (084's strong identity);
      -- anything weaker becomes a new client and a duplicate candidate.
      v_client_reused := v_phone IS NOT NULL AND v_email IS NOT NULL AND EXISTS (
        SELECT 1 FROM platform.clients cl
        WHERE cl.organization_id = p_organization_id AND cl.lifecycle_state = 'active'
          AND cl.normalized_phone = v_phone AND cl.normalized_email = v_email);
      v_new_client := platform_private.create_or_link_client(p_organization_id, v_name, v_email_raw, v_phone,
        'evo_sales_report', 'client', v_base::TEXT, 'imported', c_observed, c_observed, v_ref);
      -- 084's candidates compare the stored spelling; a client holding the same
      -- number in another spelling (no open lead or case: those were found above)
      -- is a phone candidate too. A pair already flagged keeps its basis.
      IF NOT v_client_reused AND v_phone IS NOT NULL THEN
        INSERT INTO platform_private.client_duplicate_candidates (organization_id, left_client_id, right_client_id, match_basis)
        SELECT p_organization_id, LEAST(v_new_client, cl.id), GREATEST(v_new_client, cl.id), 'phone'
        FROM platform.clients cl
        WHERE cl.organization_id = p_organization_id AND cl.lifecycle_state = 'active' AND cl.id <> v_new_client
          AND cl.normalized_phone = ANY (v_keys) AND cl.normalized_phone <> v_phone
        ON CONFLICT (organization_id, left_client_id, right_client_id) DO NOTHING;
      END IF;
      -- No sales owner (as 281): the person already bought; the Admin actor is the
      -- author in the journal and the receipt.
      v_new_lead := platform_private.create_or_link_lead(p_organization_id, v_new_client, NULL, 'new',
        'sales_report', 'evo_sales_report', 'lead', v_base::TEXT, 'imported', c_observed, c_observed, v_ref);
      -- Already a client, never a sales lead (084's guard allows open -> converted).
      UPDATE platform.leads l SET lifecycle_state = 'converted', interest_direction = v_interest
      WHERE l.organization_id = p_organization_id AND l.id = v_new_lead;
      INSERT INTO platform.audit_events (organization_id, actor_kind, actor_profile_id, actor_principal, actor_membership_id,
        action, resource_type, resource_id, before_state, after_state, reason, request_id)
      VALUES (p_organization_id, 'user', v_actor.profile_id, c_principal, v_actor.membership_id, 'lead.manual.create',
        'lead', v_new_lead, NULL,
        jsonb_build_object('lead_id', v_new_lead, 'client_id', v_new_client, 'source_key', 'sales_report',
          'interest_direction', v_interest, 'origin', 'sales_report_import', 'import_source', p_import_source,
          'external_ref', v_ref),
        v_reason, public.uuid_generate_v5(v_base, 'sales-report-import:lead'));
      v_lead := v_new_lead;
      v_lead_out := v_new_lead;
      v_client_out := v_new_client;
      v_do_link := TRUE;
    END IF;
  END IF;

  IF v_do_link THEN
    v_before_version := v_reg.version;
    UPDATE platform_private.sales_register r
    SET linked_lead_id = v_lead, version = r.version + 1, updated_at = now()
    WHERE r.organization_id = p_organization_id AND r.id = v_reg.id
    RETURNING * INTO v_reg;
    v_person_status := CASE WHEN v_person_mode = 'create_lead' THEN 'lead_created' ELSE 'linked' END;
    -- No personal data in the shared audit projection: only whether a link exists
    -- (254's link event).
    INSERT INTO platform.audit_events (organization_id, actor_kind, actor_profile_id, actor_principal, actor_membership_id,
      action, resource_type, resource_id, before_state, after_state, reason, request_id)
    VALUES (p_organization_id, 'user', v_actor.profile_id, c_principal, v_actor.membership_id, 'sales.register.lead.link',
      'sales_register', v_reg.id,
      jsonb_build_object('version', v_before_version::TEXT, 'linked', FALSE),
      jsonb_build_object('version', v_reg.version::TEXT, 'linked', TRUE, 'import_source', p_import_source, 'external_ref', v_ref),
      v_reason, public.uuid_generate_v5(v_base, 'sales-report-import:link'));
  END IF;

  -- ---- answer, receipt ------------------------------------------------------------------------------
  v_lead_out := COALESCE(v_lead_out, v_reg.linked_lead_id);
  IF v_client_out IS NULL AND v_lead_out IS NOT NULL THEN
    SELECT l.client_id INTO v_client_out FROM platform.leads l WHERE l.organization_id = p_organization_id AND l.id = v_lead_out;
  END IF;
  v_status := CASE
    WHEN v_person_status IN ('lead_created', 'lead_exists', 'case_exists') THEN v_person_status
    WHEN v_person_status = 'linked' THEN 'linked'
    WHEN v_row_status IN ('inserted', 'refreshed', 'unchanged') THEN v_row_status
    ELSE 'unchanged' END;
  v_result := jsonb_build_object(
    'organization_id', p_organization_id,
    'status', v_status,
    'row_status', v_row_status,
    'person_status', v_person_status,
    'register_id', v_reg.id,
    'register_version', v_reg.version::TEXT,
    'lead_id', v_lead_out,
    'client_id', v_client_out,
    'student_case_id', v_case,
    'linked_lead_id', v_reg.linked_lead_id,
    'changed', to_jsonb(v_changed),
    'import_source', p_import_source,
    'external_ref', v_ref,
    'replayed', FALSE);
  INSERT INTO platform_private.sales_report_import_receipts (organization_id, import_source, external_ref,
    actor_membership_id, payload_md5, register_id, register_version, lead_note, result, before_state)
  VALUES (p_organization_id, p_import_source, v_ref, v_actor.membership_id, v_hash, v_reg.id,
    CASE WHEN v_row_status IN ('inserted', 'refreshed') OR v_person_status IN ('linked', 'lead_created')
      THEN v_reg.version END,
    v_note, v_result - 'replayed', v_before);
  RETURN v_result;
END
$$;
REVOKE ALL ON FUNCTION platform.import_sales_report_row_v1(UUID, UUID, TEXT, TEXT, JSONB, TEXT)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.import_sales_report_row_v1(UUID, UUID, TEXT, TEXT, JSONB, TEXT) TO service_role;
COMMENT ON FUNCTION platform.import_sales_report_row_v1(UUID, UUID, TEXT, TEXT, JSONB, TEXT) IS
  'Migration 299: service-only import of one «Отчёт продаж» row, attributed to the owner''s Admin membership. Lays the row down (insert), brings an untouched import row up to a new source (refresh) or leaves it (link_only), and ties it to a lead (link_lead, 254''s rules) or creates the person''s client and a converted lead and ties the row to it (create_lead; a person who already has a case or a lead is reported as case_exists / lead_exists and nothing is created). Idempotent by (organization, import source, external reference); one transaction.';

-- ---------------------------------------------------------------------------
-- d) A lead made from the sales report is not a marketing lead
-- ---------------------------------------------------------------------------
-- 281 left leads of source `admissions_direct` out of the marketing cohort
-- (leads are counted by the day they were created). The people carried over from
-- the sales report are customers of earlier months, not enquiries of this one.
SELECT pg_temp.a299_replace('platform_private.marketing_cohort(uuid,date,date)',
  $old$l.source_key<>'admissions_direct'$old$,
  $new$l.source_key NOT IN ('admissions_direct','sales_report')$new$, 1);

-- ---------------------------------------------------------------------------
-- Self-check: definer, empty search_path, service_role-only EXECUTE, receipts private.
-- ---------------------------------------------------------------------------
DO $a299_verify$
DECLARE routine RECORD;
BEGIN
  SELECT p.oid, p.prosecdef, p.proconfig INTO routine FROM pg_catalog.pg_proc p
  WHERE p.oid = 'platform.import_sales_report_row_v1(uuid,uuid,text,text,jsonb,text)'::regprocedure;
  IF NOT routine.prosecdef OR routine.proconfig IS DISTINCT FROM ARRAY['search_path=""']
    OR NOT has_function_privilege('service_role', routine.oid, 'EXECUTE')
    OR has_function_privilege('authenticated', routine.oid, 'EXECUTE')
    OR has_function_privilege('anon', routine.oid, 'EXECUTE')
    OR has_function_privilege('authenticated', 'platform_private.sales_report_import_text(jsonb,text,integer,boolean)', 'EXECUTE')
    OR has_function_privilege('service_role', 'platform_private.sales_report_import_text(jsonb,text,integer,boolean)', 'EXECUTE')
    OR has_function_privilege('service_role', 'platform_private.sales_report_import_object(jsonb,text,text[])', 'EXECUTE')
    OR has_function_privilege('service_role', 'platform_private.sales_report_import_snapshot_ok(jsonb)', 'EXECUTE')
    OR has_table_privilege('service_role', 'platform_private.sales_report_import_receipts', 'SELECT')
    OR has_table_privilege('authenticated', 'platform_private.sales_report_import_receipts', 'SELECT')
    OR NOT (SELECT c.relforcerowsecurity FROM pg_catalog.pg_class c
      WHERE c.oid = 'platform_private.sales_report_import_receipts'::regclass)
  THEN
    RAISE EXCEPTION 'a299_verification_failed: import_sales_report_row_v1';
  END IF;
  IF (SELECT prosrc FROM pg_catalog.pg_proc WHERE oid = 'platform_private.marketing_cohort(uuid,date,date)'::regprocedure)
      NOT LIKE '%l.source_key NOT IN (''admissions_direct'',''sales_report'')%' THEN
    RAISE EXCEPTION 'a299_verification_failed: marketing_cohort';
  END IF;
END
$a299_verify$;

NOTIFY pgrst, 'reload schema';
COMMIT;
