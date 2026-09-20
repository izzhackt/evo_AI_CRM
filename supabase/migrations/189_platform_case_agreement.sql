-- OTH-3 «Договор и оплата»: one card block replacing the split money/contract
-- surfaces (docs/EVO_OTHER_FABLE_PLAN_2026-09-19.md §«Деньги и договоры»).
-- Tranches and payments are NOT a new ledger: they ARE
-- platform.payment_obligations / platform.payment_events (+payment_evidence),
-- the same tables 043's admin finance tool already writes. This migration
-- only (a) relaxes two columns that assumed the old admin-only entry form,
-- (b) adds resource-scoped write doors so Sales/Curator can use them from the
-- card without holding the sensitive finance.manage/finance.event.confirm
-- grants, (c) adds contract/receipt FILE metadata tables (the one genuinely
-- new thing — no binary-file table existed anywhere before), and (d) adds one
-- read RPC that assembles the whole block. 043's own RPCs
-- (create_payment_obligation/record_payment_event/staff_case_finance_control/
-- staff_finance_control_queue) and 144's staff_finance_entry_workspace are
-- NOT modified — the admin finance-control tooling keeps working exactly as
-- before, reading the same rows this migration's new doors also write.
--
-- ---------------------------------------------------------------------------
-- Consumer NULL-safety audit (due_at/next_action becoming nullable) — every
-- reader of platform.payment_obligations checked by hand before (a) below:
--
--  1. platform.staff_finance_entry_workspace (144:2-32) — SQL passes
--     `o.due_at` straight into jsonb_build_object (JSON null is fine) and
--     ORDERs BY it (NULLs sort last on the default ASC order — acceptable,
--     new undated tranches simply list after dated ones). No SQL change.
--     TS reader src/lib/platform-finance-entry-contract.ts (`FinanceObligation
--     .dueAt` via `time(o.due_at)`) was a STRICT decoder that throws on null
--     -> WIDENED below to accept null (`optionalTime`).
--  2. platform.staff_case_finance_control (107:2175) — CORRECTED below: this
--     was first (wrongly) assessed as NULL-safe. `obligation.due_at <
--     transaction_timestamp()` is NOT NULL-safe for the JSON it produces:
--     `NULL AND TRUE` is SQL NULL, not FALSE, so an undated tranche makes the
--     'overdue' key emit a JSON null instead of a boolean — the strict TS
--     decoder (`PlatformFinanceControlObligation.overdue`, `typeof value
--     .overdue === "boolean"`) throws on it. `derive_obligation_status` (043)
--     is unaffected (it already treats NULL due_at as never-overdue — a
--     different code path). Live-anchor-patched below ("NULL-safety patch")
--     to `due_at IS NOT NULL AND due_at < transaction_timestamp() AND ...`;
--     the decoder itself stays strict per plan (SQL now guarantees a
--     boolean), only `.dueAt`/`.nextAction` were WIDENED below.
--  3. platform.staff_finance_control_queue (090:313) — its own overdue
--     predicate (same shape as #2) only ever feeds `count(*) FILTER (WHERE
--     obligation.overdue)` / `min(obligation.due_at) FILTER (WHERE
--     obligation.overdue)`; FILTER already treats a NULL condition as
--     excluded (same as false), so no JSON-null boolean is ever returned by
--     this function (it has no 'overdue' output column at all — unlike #2,
--     it is NOT read by the same TS normalizer, correcting an earlier draft
--     of this note) — no null-safety patch needed for that reason. Reading
--     the whole function for this audit did turn up one real, narrow
--     misclassification the nullable due_at introduces: the representative-
--     stop tie-break `ORDER BY obligation.overdue DESC, ...` relies on
--     Postgres's default NULL placement, which for DESC is NULLS FIRST — an
--     undated (never-overdue) tranche would outrank a genuinely overdue one
--     in that tie-break. Live-anchor-patched below (search "finance queue
--     archived tranches") alongside the unrelated archived-tranche exclusion
--     this function also needed (see that section's own comment).
--  4. platform.staff_monthly_payment_summary (144:34) — aggregates
--     payment_events only, never reads obligations.due_at/next_action. Not
--     affected.
--  5. platform.case_finance_summaries (043:4753) — reads amount/paid/
--     refunded only, not due_at/next_action; grep confirms no TS caller
--     exists anywhere in src/ (dead for the application). Audited, no change.
--  6. platform.student_portal_finance_v2 (127:472) — Student Portal reader;
--     `obligation.due_at`/`obligation.next_action` pass straight through with
--     no COALESCE, and the SAME table will now carry the new tranches (their
--     category is 'evo_service_fee', shown to the student like any other
--     obligation). Its TS decoder `normalizeStudentPortalPayment`
--     (src/lib/v3/portal-source.ts) was strict on both fields -> this is the
--     ONE allowed portal exception the plan pre-authorizes: WIDENED to accept
--     null, plus the one display call site
--     (src/components/v3/portal/PaymentsView.tsx `<time dateTime=…>`) that
--     needed a null-safe prop. No portal UX/behaviour otherwise touched. This
--     function ALSO returns its own `overdue BOOLEAN` column, computed with
--     the exact same NULL-unsafe `due_at < transaction_timestamp()` shape as
--     #2 above — missed in the first pass of this audit, caught on review and
--     live-anchor-patched below in the same "NULL-safety patch" block. The
--     student portal's own overdue decoder was already strict boolean-only
--     and stays that way (unaffected — the SQL now guarantees a boolean).
--  7. src/lib/v3/platform-finance-control.ts is used by
--     ProfileAdmissionsWorkspace.tsx's `<ProfileFinanceControls>` (stop-factor
--     admin UI): its only obligation.nextAction usage is `{obligation
--     .nextAction}` inside JSX, which already renders `null` as nothing — no
--     UI change required beyond the type/decoder widening.
--
-- Every consumer above was opened and read, not inferred. None required a
-- SQL change; three TS decoders (platform-finance-control.ts, platform-
-- finance-entry-contract.ts, portal-source.ts) plus one portal display call
-- site were widened to accept null, all shipped in this same migration/PR.
-- ---------------------------------------------------------------------------

BEGIN;

-- ---------------------------------------------------------------------------
-- (a) Free the columns the old admin-only form required but a staff-entered
-- tranche does not: a due date is «при необходимости», and «следующий шаг»
-- free text has no equivalent in the new, quiet form (plan §«Стоимость и
-- транши»: «сумма своя. Срок — при необходимости»).
-- ---------------------------------------------------------------------------
ALTER TABLE platform.payment_obligations
  ALTER COLUMN due_at DROP NOT NULL,
  ALTER COLUMN next_action DROP NOT NULL;

-- Soft-archive for a mis-entered tranche: never deletes, never renumbers.
-- Every reader that sums/lists obligations for a case (the new read RPC
-- below, and any future one) MUST filter WHERE archived_at IS NULL — 043's
-- own admin tools (staff_case_finance_control / staff_finance_control_queue /
-- staff_finance_entry_workspace) intentionally keep showing archived rows
-- too (admin history must not silently vanish rows); only the new card block
-- excludes them from its totals, per the "no silent history loss" plan
-- requirement — archiving is a visibility hint for the new block, not an
-- erasure.
ALTER TABLE platform.payment_obligations
  ADD COLUMN archived_at TIMESTAMPTZ NULL;

COMMENT ON COLUMN platform.payment_obligations.archived_at IS
  'Soft-archive for a tranche created in error (never used once paid). '
  'NULL = live. Rows stay forever; only case-agreement totals exclude them.';

-- ---------------------------------------------------------------------------
-- b½) Tranche-aware update guards. 043 designed payment_obligations as fully
-- immutable facts: payment_obligations_identity_immutable froze label/amount/
-- currency/due_at/next_action forever, and payment_obligations_transition_guard
-- rejected any UPDATE that does not change the paid/refunded totals. The plan
-- («Деньги и договоры») makes an UNPAID tranche editable and archivable, so
-- both guards are replaced with tranche-aware equivalents that keep the
-- original safety where money has actually moved:
--   * id/organization_id/student_case_id/category/created_by/created_at stay
--     frozen forever;
--   * amount_minor and currency stay frozen once total_paid_minor or
--     total_refunded_minor is non-zero (the RPC additionally rejects earlier
--     with case_agreement_tranche_paid);
--   * label/due_at/next_action are editable (quiet corrections, plan-level
--     facts, not money);
--   * archived_at may only transition NULL -> NOT NULL, and only while both
--     totals are zero — un-archiving or archiving paid money stays impossible
--     at the trigger level, whatever the caller;
--   * an UPDATE must still change SOMETHING meaningful: totals (payment
--     path), or at least one tranche field — the original "no stray updates"
--     intent survives.
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform_private.guard_payment_obligation_update()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
    OR NEW.student_case_id IS DISTINCT FROM OLD.student_case_id
    OR NEW.category IS DISTINCT FROM OLD.category
    OR NEW.created_by_membership_id IS DISTINCT FROM OLD.created_by_membership_id
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION
      'platform.payment_obligations identity is immutable'
      USING ERRCODE = '55000';
  END IF;

  IF (NEW.amount_minor IS DISTINCT FROM OLD.amount_minor
      OR NEW.currency IS DISTINCT FROM OLD.currency)
    AND (OLD.total_paid_minor <> 0 OR OLD.total_refunded_minor <> 0)
  THEN
    RAISE EXCEPTION
      'platform.payment_obligations money columns are immutable once paid'
      USING ERRCODE = '55000';
  END IF;

  IF NEW.archived_at IS DISTINCT FROM OLD.archived_at THEN
    IF OLD.archived_at IS NOT NULL
      OR NEW.archived_at IS NULL
      OR OLD.total_paid_minor <> 0
      OR OLD.total_refunded_minor <> 0
    THEN
      RAISE EXCEPTION
        'platform.payment_obligations archive is one-way and unpaid-only'
        USING ERRCODE = '55000';
    END IF;
  END IF;

  IF NEW.total_paid_minor = OLD.total_paid_minor
    AND NEW.total_refunded_minor = OLD.total_refunded_minor
    AND NEW.label IS NOT DISTINCT FROM OLD.label
    AND NEW.amount_minor IS NOT DISTINCT FROM OLD.amount_minor
    AND NEW.currency IS NOT DISTINCT FROM OLD.currency
    AND NEW.due_at IS NOT DISTINCT FROM OLD.due_at
    AND NEW.next_action IS NOT DISTINCT FROM OLD.next_action
    AND NEW.archived_at IS NOT DISTINCT FROM OLD.archived_at
  THEN
    RAISE EXCEPTION
      'Payment obligation update requires a totals or tranche-field change'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION platform_private.guard_payment_obligation_update()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

DROP TRIGGER payment_obligations_identity_immutable ON platform.payment_obligations;
DROP TRIGGER payment_obligations_transition_guard ON platform.payment_obligations;
CREATE TRIGGER payment_obligations_update_guard
  BEFORE UPDATE ON platform.payment_obligations
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.guard_payment_obligation_update();

-- ---------------------------------------------------------------------------
-- NULL-safety patch (corrects the audit above): live-anchor-patch the two
-- readers whose 'overdue' JSON key can now come out as a null instead of a
-- boolean now that due_at is nullable — same pg_get_functiondef + exact-
-- anchor-occurs-exactly-once + EXECUTE technique as
-- 137/149/156/157/175/176/177/180/182/185 (the length(body)-length(replace(
-- body,anchor,''))/length(anchor)=1 form specifically, per 149/157/173's
-- helper). Neither function's authorization predicate is touched (156/173
-- already own that); only the 'overdue' computation itself changes, and only
-- by adding a leading `due_at IS NOT NULL` guard — the rest stays byte-
-- identical. The decoders stay strict; see
-- tests/v3-case-agreement.test.mjs for the runtime proof (fixture with
-- overdue=false decodes, overdue=null throws) and the source pins below.
-- ---------------------------------------------------------------------------
DO $overdue_null_safety$
DECLARE
  patch RECORD;
  original TEXT;
  occurrences INTEGER;
BEGIN
  FOR patch IN SELECT * FROM (VALUES
    (
      'platform.staff_case_finance_control(uuid,integer)'::TEXT,
      'staff_case_finance_control'::TEXT,
      $$        'overdue', (
          obligation.due_at < transaction_timestamp()
          AND obligation.amount_minor - (
            obligation.total_paid_minor - obligation.total_refunded_minor
          ) > 0
        ),$$::TEXT,
      $$        'overdue', (
          obligation.due_at IS NOT NULL
          AND obligation.due_at < transaction_timestamp()
          AND obligation.amount_minor - (
            obligation.total_paid_minor - obligation.total_refunded_minor
          ) > 0
        ),$$::TEXT
    ),
    (
      'platform.student_portal_finance_v2()'::TEXT,
      'student_portal_finance_v2'::TEXT,
      $$    (
      obligation.due_at < transaction_timestamp()
      AND obligation.amount_minor
        - obligation.total_paid_minor
        + obligation.total_refunded_minor > 0
    ),$$::TEXT,
      $$    (
      obligation.due_at IS NOT NULL
      AND obligation.due_at < transaction_timestamp()
      AND obligation.amount_minor
        - obligation.total_paid_minor
        + obligation.total_refunded_minor > 0
    ),$$::TEXT
    )
  ) AS patches(signature, short_name, anchor, replacement)
  LOOP
    original := pg_catalog.pg_get_functiondef(patch.signature::regprocedure);
    occurrences := (pg_catalog.length(original) -
      pg_catalog.length(pg_catalog.replace(original, patch.anchor, '')))
      / pg_catalog.length(patch.anchor);
    IF occurrences <> 1 THEN
      RAISE EXCEPTION '%_overdue_anchor_drift', patch.short_name;
    END IF;
    EXECUTE pg_catalog.replace(original, patch.anchor, patch.replacement);
  END LOOP;
END
$overdue_null_safety$;

-- ---------------------------------------------------------------------------
-- Finance queue archived tranches (adversarial review, FIX 3): the new
-- archived_at soft-flag above is only excluded by this migration's own new
-- read RPC (staff_case_agreement_v1, 'e' below); the pre-existing admin
-- queue platform.staff_finance_control_queue (090:313, its own read-
-- authorization predicate already anchor-patched once by 156) was never
-- taught about archived_at at all, so an archived (mis-entered, never paid)
-- tranche still inflated that case's overdue/outstanding counts in the
-- queue. Live-anchor-patched below, same technique as the NULL-safety patch
-- above, to add `obligation.archived_at IS NULL` to the CTE that reads
-- payment_obligations — response shape stays byte-identical (no new
-- columns), only the row set feeding the counts narrows. The SAME NULL audit
-- that produced the block above also read this function in full (per FIX 1's
-- own instruction to audit every overdue-computing consumer); its 'overdue'
-- CTE column only ever reaches `count(*) FILTER (WHERE obligation.overdue)`/
-- `min(obligation.due_at) FILTER (WHERE obligation.overdue)`, and FILTER
-- already excludes a NULL condition (same as false) — no JSON-null boolean
-- is possible here (this function has no 'overdue' output column at all), so
-- that half needed no patch. The audit did catch one real, narrow
-- misclassification: the representative-stop tie-break `ORDER BY
-- obligation.overdue DESC, ...` relies on Postgres's default NULL placement,
-- which for DESC is NULLS FIRST — an undated (never-overdue) tranche's stop
-- factor would incorrectly outrank a genuinely overdue one whenever a case
-- has active stops on more than one obligation. Patched alongside the
-- archived-tranche fix below with an explicit NULLS LAST, since both land in
-- the same function body.
-- ---------------------------------------------------------------------------
DO $finance_queue_archived_and_order$
DECLARE
  patch RECORD;
  original TEXT;
  occurrences INTEGER;
BEGIN
  FOR patch IN SELECT * FROM (VALUES
    (
      'staff_finance_control_queue_archived'::TEXT,
      $$    WHERE (
      p_student_case_ids IS NULL
      OR obligation.student_case_id = ANY (p_student_case_ids)
    )
    AND ($$::TEXT,
      $$    WHERE (
      p_student_case_ids IS NULL
      OR obligation.student_case_id = ANY (p_student_case_ids)
    )
    AND obligation.archived_at IS NULL
    AND ($$::TEXT
    ),
    (
      'staff_finance_control_queue_overdue_order'::TEXT,
      $$    ORDER BY
      obligation.overdue DESC,
      obligation.due_at,
      stop_factor.created_at DESC,
      stop_factor.id DESC
    LIMIT 1$$::TEXT,
      $$    ORDER BY
      obligation.overdue DESC NULLS LAST,
      obligation.due_at,
      stop_factor.created_at DESC,
      stop_factor.id DESC
    LIMIT 1$$::TEXT
    )
  ) AS patches(short_name, anchor, replacement)
  LOOP
    original := pg_catalog.pg_get_functiondef(
      'platform.staff_finance_control_queue(integer,uuid[])'::regprocedure
    );
    occurrences := (pg_catalog.length(original) -
      pg_catalog.length(pg_catalog.replace(original, patch.anchor, '')))
      / pg_catalog.length(patch.anchor);
    IF occurrences <> 1 THEN
      RAISE EXCEPTION '%_anchor_drift', patch.short_name;
    END IF;
    EXECUTE pg_catalog.replace(original, patch.anchor, patch.replacement);
  END LOOP;
END
$finance_queue_archived_and_order$;

-- ---------------------------------------------------------------------------
-- (b) Contract + receipt files — the genuinely new tables. Same bucket as
-- documents ('platform-documents'), same file shape as
-- platform.document_versions (043), distinct object prefix.
-- ---------------------------------------------------------------------------
CREATE TABLE platform.case_contract_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  student_case_id UUID NOT NULL,
  original_filename TEXT NOT NULL CHECK (btrim(original_filename) <> ''),
  declared_mime_type TEXT NOT NULL CHECK (
    declared_mime_type IN ('application/pdf', 'image/jpeg', 'image/png')
  ),
  byte_size BIGINT NOT NULL CHECK (byte_size BETWEEN 1 AND 26214400),
  sha256_hex TEXT NOT NULL CHECK (sha256_hex ~ '^[0-9a-f]{64}$'),
  storage_object_name TEXT NOT NULL CHECK (btrim(storage_object_name) <> ''),
  uploaded_by_membership_id UUID NOT NULL,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  -- Newest row with superseded_at IS NULL is current; every earlier upload
  -- gets superseded_at set in the SAME statement that inserts the new one
  -- (record_case_contract_file_metadata below) — never deleted, so
  -- "новый — актуален, старый — в истории" holds with zero data loss.
  superseded_at TIMESTAMPTZ NULL,
  CONSTRAINT case_contract_files_organization_id_id_key
    UNIQUE (organization_id, id),
  CONSTRAINT case_contract_files_case_fkey
    FOREIGN KEY (organization_id, student_case_id)
    REFERENCES platform.student_cases(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT case_contract_files_uploader_fkey
    FOREIGN KEY (organization_id, uploaded_by_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id)
    ON DELETE RESTRICT
);
-- At most one CURRENT contract file per case — "новый договор становится
-- актуальным" is a replace, not an append to a set of current files.
CREATE UNIQUE INDEX case_contract_files_current_idx
  ON platform.case_contract_files (organization_id, student_case_id)
  WHERE superseded_at IS NULL;
CREATE INDEX case_contract_files_case_idx
  ON platform.case_contract_files (organization_id, student_case_id, uploaded_at DESC);

CREATE TABLE platform.payment_receipt_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  student_case_id UUID NOT NULL,
  payment_obligation_id UUID NOT NULL,
  payment_event_id UUID NOT NULL,
  original_filename TEXT NOT NULL CHECK (btrim(original_filename) <> ''),
  declared_mime_type TEXT NOT NULL CHECK (
    declared_mime_type IN ('application/pdf', 'image/jpeg', 'image/png')
  ),
  byte_size BIGINT NOT NULL CHECK (byte_size BETWEEN 1 AND 26214400),
  sha256_hex TEXT NOT NULL CHECK (sha256_hex ~ '^[0-9a-f]{64}$'),
  storage_object_name TEXT NOT NULL CHECK (btrim(storage_object_name) <> ''),
  uploaded_by_membership_id UUID NOT NULL,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT payment_receipt_files_organization_id_id_key
    UNIQUE (organization_id, id),
  -- Same three-part parent identity payment_evidence (043) already uses, so
  -- a receipt file can never point at an event/obligation pair that does not
  -- actually exist together.
  CONSTRAINT payment_receipt_files_event_fkey
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
  CONSTRAINT payment_receipt_files_uploader_fkey
    FOREIGN KEY (organization_id, uploaded_by_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id)
    ON DELETE RESTRICT
);
-- Deliberately NOT unique on payment_event_id — "несколько оплат и чеков за
-- время работы — нормальный сценарий" (plan) allows several receipt files
-- for one payment.
CREATE INDEX payment_receipt_files_event_idx
  ON platform.payment_receipt_files (organization_id, payment_event_id, uploaded_at DESC);
CREATE INDEX payment_receipt_files_case_idx
  ON platform.payment_receipt_files (organization_id, student_case_id);

ALTER TABLE platform.case_contract_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.case_contract_files FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.payment_receipt_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.payment_receipt_files FORCE ROW LEVEL SECURITY;

-- Defense-in-depth direct-REST read policies, mirroring 043's
-- payment_evidence_full_read / document_versions_full_read shape. The
-- sanctioned read path is platform.staff_case_agreement_v1 below (SECURITY
-- DEFINER, does its own resource-scoped check so Sales/Curator card access
-- also reads without holding finance.read.full); these policies only cover a
-- direct PostgREST table read and intentionally stay at the stricter
-- finance-full/document-full bar, same as every other file/finance table.
CREATE POLICY case_contract_files_full_read
  ON platform.case_contract_files
  FOR SELECT
  TO authenticated
  USING (
    (SELECT private.platform_can_read_document_full(organization_id, student_case_id))
  );
CREATE POLICY payment_receipt_files_full_read
  ON platform.payment_receipt_files
  FOR SELECT
  TO authenticated
  USING (
    (SELECT private.platform_can_read_finance_full(organization_id))
  );

-- ---------------------------------------------------------------------------
-- (c) Service-role-only metadata RPCs, mirroring
-- platform.record_document_version_metadata (043:2780) exactly: same
-- service_role check, same shape validation, same lock_p2e_request use.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION platform.record_case_contract_file_metadata(
  p_organization_id UUID,
  p_student_case_id UUID,
  p_uploaded_by_membership_id UUID,
  p_original_filename TEXT,
  p_declared_mime_type TEXT,
  p_byte_size BIGINT,
  p_sha256_hex TEXT,
  p_storage_object_name TEXT,
  p_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  target_case platform.student_cases%ROWTYPE;
  uploader RECORD;
  replayed JSONB;
  created_file_id UUID := gen_random_uuid();
  result JSONB;
  fixed_reason CONSTANT TEXT := 'Contract file uploaded';
BEGIN
  IF (SELECT auth.jwt() ->> 'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role is required' USING ERRCODE = '42501';
  END IF;

  PERFORM platform_private.lock_p2e_request(p_request_id);

  IF p_student_case_id IS NULL
    OR p_uploaded_by_membership_id IS NULL
    OR p_original_filename IS NULL
    OR btrim(p_original_filename) = ''
    OR lower(btrim(p_declared_mime_type)) NOT IN
      ('application/pdf', 'image/jpeg', 'image/png')
    OR p_byte_size IS NULL
    OR p_byte_size NOT BETWEEN 1 AND 26214400
    OR lower(btrim(p_sha256_hex)) !~ '^[0-9a-f]{64}$'
    OR p_storage_object_name IS NULL
    OR btrim(p_storage_object_name) = ''
  THEN
    RAISE EXCEPTION
      'Complete contract file metadata is required'
      USING ERRCODE = '22023';
  END IF;

  replayed := platform_private.replay_audit(
    p_request_id, 'case.contract_file.upload', 'case_contract_file', NULL,
    fixed_reason,
    jsonb_build_object(
      'organization_id', p_organization_id,
      'student_case_id', p_student_case_id,
      'original_filename', btrim(p_original_filename),
      'sha256_hex', lower(btrim(p_sha256_hex))
    )
  );
  IF replayed IS NOT NULL THEN RETURN replayed; END IF;

  SELECT * INTO target_case FROM platform.student_cases AS student_case
  WHERE student_case.organization_id = p_organization_id
    AND student_case.id = p_student_case_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Student case is unavailable' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO uploader
  FROM platform_private.staff_membership_identity(
    p_organization_id, p_uploaded_by_membership_id
  );
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Uploader membership is unavailable' USING ERRCODE = '42501';
  END IF;

  -- Newest becomes current; every earlier row for this case is superseded in
  -- the same statement — the uniqueness index above only ever admits one
  -- live current row per case, so this can never race into two currents.
  UPDATE platform.case_contract_files
  SET superseded_at = statement_timestamp()
  WHERE organization_id = p_organization_id
    AND student_case_id = p_student_case_id
    AND superseded_at IS NULL;

  INSERT INTO platform.case_contract_files (
    id, organization_id, student_case_id, original_filename,
    declared_mime_type, byte_size, sha256_hex, storage_object_name,
    uploaded_by_membership_id
  ) VALUES (
    created_file_id, p_organization_id, p_student_case_id,
    btrim(p_original_filename), lower(btrim(p_declared_mime_type)),
    p_byte_size, lower(btrim(p_sha256_hex)), btrim(p_storage_object_name),
    p_uploaded_by_membership_id
  );

  result := jsonb_build_object(
    'organization_id', p_organization_id,
    'student_case_id', p_student_case_id,
    'case_contract_file_id', created_file_id,
    'original_filename', btrim(p_original_filename),
    'sha256_hex', lower(btrim(p_sha256_hex))
  );

  INSERT INTO platform.audit_events(
    organization_id, actor_kind, actor_principal, action, resource_type,
    resource_id, before_state, after_state, reason, request_id
  ) VALUES (
    p_organization_id, 'system', 'service_role:document_ingest',
    'case.contract_file.upload', 'case_contract_file', created_file_id,
    NULL, result, fixed_reason, p_request_id
  );

  RETURN result;
END
$$;

REVOKE ALL ON FUNCTION platform.record_case_contract_file_metadata(
  UUID, UUID, UUID, TEXT, TEXT, BIGINT, TEXT, TEXT, UUID
) FROM PUBLIC, anon, authenticated, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.record_case_contract_file_metadata(
  UUID, UUID, UUID, TEXT, TEXT, BIGINT, TEXT, TEXT, UUID
) TO service_role;

CREATE OR REPLACE FUNCTION platform.record_payment_receipt_file_metadata(
  p_organization_id UUID,
  p_payment_event_id UUID,
  p_uploaded_by_membership_id UUID,
  p_original_filename TEXT,
  p_declared_mime_type TEXT,
  p_byte_size BIGINT,
  p_sha256_hex TEXT,
  p_storage_object_name TEXT,
  p_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  event_row platform.payment_events%ROWTYPE;
  uploader RECORD;
  replayed JSONB;
  created_file_id UUID := gen_random_uuid();
  result JSONB;
  fixed_reason CONSTANT TEXT := 'Payment receipt file uploaded';
BEGIN
  IF (SELECT auth.jwt() ->> 'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role is required' USING ERRCODE = '42501';
  END IF;

  PERFORM platform_private.lock_p2e_request(p_request_id);

  IF p_payment_event_id IS NULL
    OR p_uploaded_by_membership_id IS NULL
    OR p_original_filename IS NULL
    OR btrim(p_original_filename) = ''
    OR lower(btrim(p_declared_mime_type)) NOT IN
      ('application/pdf', 'image/jpeg', 'image/png')
    OR p_byte_size IS NULL
    OR p_byte_size NOT BETWEEN 1 AND 26214400
    OR lower(btrim(p_sha256_hex)) !~ '^[0-9a-f]{64}$'
    OR p_storage_object_name IS NULL
    OR btrim(p_storage_object_name) = ''
  THEN
    RAISE EXCEPTION
      'Complete receipt file metadata is required'
      USING ERRCODE = '22023';
  END IF;

  replayed := platform_private.replay_audit(
    p_request_id, 'case.payment_receipt.upload', 'payment_receipt_file', NULL,
    fixed_reason,
    jsonb_build_object(
      'organization_id', p_organization_id,
      'payment_event_id', p_payment_event_id,
      'original_filename', btrim(p_original_filename),
      'sha256_hex', lower(btrim(p_sha256_hex))
    )
  );
  IF replayed IS NOT NULL THEN RETURN replayed; END IF;

  SELECT * INTO event_row FROM platform.payment_events AS payment_event
  WHERE payment_event.organization_id = p_organization_id
    AND payment_event.id = p_payment_event_id
    AND payment_event.event_type = 'payment';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment event is unavailable' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO uploader
  FROM platform_private.staff_membership_identity(
    p_organization_id, p_uploaded_by_membership_id
  );
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Uploader membership is unavailable' USING ERRCODE = '42501';
  END IF;

  -- Additive only — a second/third receipt for the SAME payment_event_id
  -- never touches payment_obligations.total_paid_minor (only
  -- record_case_payment_v1's own INSERT into payment_events does that), so
  -- an extra evidence file can never double-count the money.
  INSERT INTO platform.payment_receipt_files (
    id, organization_id, student_case_id, payment_obligation_id,
    payment_event_id, original_filename, declared_mime_type, byte_size,
    sha256_hex, storage_object_name, uploaded_by_membership_id
  ) VALUES (
    created_file_id, p_organization_id, event_row.student_case_id,
    event_row.payment_obligation_id, p_payment_event_id,
    btrim(p_original_filename), lower(btrim(p_declared_mime_type)),
    p_byte_size, lower(btrim(p_sha256_hex)), btrim(p_storage_object_name),
    p_uploaded_by_membership_id
  );

  result := jsonb_build_object(
    'organization_id', p_organization_id,
    'payment_event_id', p_payment_event_id,
    'payment_receipt_file_id', created_file_id,
    'original_filename', btrim(p_original_filename),
    'sha256_hex', lower(btrim(p_sha256_hex))
  );

  INSERT INTO platform.audit_events(
    organization_id, actor_kind, actor_principal, action, resource_type,
    resource_id, before_state, after_state, reason, request_id
  ) VALUES (
    p_organization_id, 'system', 'service_role:document_ingest',
    'case.payment_receipt.upload', 'payment_receipt_file', created_file_id,
    NULL, result, fixed_reason, p_request_id
  );

  RETURN result;
END
$$;

REVOKE ALL ON FUNCTION platform.record_payment_receipt_file_metadata(
  UUID, UUID, UUID, TEXT, TEXT, BIGINT, TEXT, TEXT, UUID
) FROM PUBLIC, anon, authenticated, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.record_payment_receipt_file_metadata(
  UUID, UUID, UUID, TEXT, TEXT, BIGINT, TEXT, TEXT, UUID
) TO service_role;

-- ---------------------------------------------------------------------------
-- (d) Resource-scoped write RPCs. Base authorization door:
-- platform_private.staff_can_access(org, actor.membership_id,
-- 'case.update.append','student_case', case) — the existing, registered,
-- non-sensitive, 'own'-scope-eligible permission (see
-- platform_private.staff_can_access catalog row set in 155) already held by
-- the Admissions/Curator role template. Curators therefore need no further
-- change (case.update.append is already in 173's admissions_keys).
--
-- The Sales role template (173's sales_keys) does NOT hold
-- 'case.update.append', even though the plan requires "продажник ...
-- загружает договор" at the lead/pre-handoff stage. An EARLIER draft of this
-- migration widened every organization's Sales role bundle to grant
-- 'case.update.append' globally — rejected on review: that grant is not
-- resource-scoped (it would let Sales append to ANY case org-wide, not just
-- their own) and it leaked two unrelated RPCs
-- (append_student_case_update/answer_case_help_request_v1) that also gate on
-- 'case.update.append' to the entire Sales role, well past this feature's
-- scope. Replaced below with a resource-scoped OR: the case's OWN
-- responsible Sales rep may use these two RPCs while (and only while) the
-- case is still 'pending' — the exact pre-handoff ownership window
-- platform_private.staff_resource_context (155:598-604) already recognizes
-- for 'own'-scope student_case resources (responsible_sales_membership_id
-- while pending, current_curator_membership_id once active/closed), the same
-- resource-scoped-to-Sales'-own-record, pre-handoff-only shape 180/184/185
-- already establish for lead/cabinet ownership. No role, bundle or
-- staff_role_assignments row is touched by this door; staff_case_agreement_v1
-- below carries the identical OR clause so the read side (can_write) and the
-- write doors never disagree about who may act.
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform.save_case_tranche_v1(
  p_organization_id UUID,
  p_request_id UUID,
  p_student_case_id UUID,
  p_payment_obligation_id UUID,
  p_amount_minor BIGINT,
  p_currency TEXT,
  p_due_on DATE,
  p_label TEXT,
  p_archive BOOLEAN
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
  existing platform.payment_obligations%ROWTYPE;
  replay_shape JSONB;
  replayed JSONB;
  created_id UUID := gen_random_uuid();
  effective_label TEXT;
  effective_amount BIGINT;
  effective_currency TEXT;
  effective_due_at TIMESTAMPTZ;
  tranche_seq BIGINT;
  result JSONB;
  fixed_reason CONSTANT TEXT := 'Договор и оплата: транш сохранён';
BEGIN
  PERFORM platform_private.lock_p2e_request(p_request_id);

  SELECT a.* INTO actor FROM platform.current_actor_authority() a
    WHERE a.organization_id = p_organization_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'case_agreement_forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_student_case_id IS NULL
    OR NOT (
      platform_private.staff_can_access(
        p_organization_id, actor.membership_id, 'case.update.append',
        'student_case', p_student_case_id
      )
      OR EXISTS (
        SELECT 1 FROM platform.student_cases AS sales_window_case
        WHERE sales_window_case.organization_id = p_organization_id
          AND sales_window_case.id = p_student_case_id
          AND sales_window_case.state = 'pending'
          AND sales_window_case.responsible_sales_membership_id = actor.membership_id
      )
    )
  THEN
    RAISE EXCEPTION 'case_agreement_forbidden' USING ERRCODE = '42501';
  END IF;

  IF p_archive IS NULL THEN
    RAISE EXCEPTION 'case_agreement_invalid' USING ERRCODE = '22023';
  END IF;

  replay_shape := jsonb_build_object(
    'organization_id', p_organization_id,
    'student_case_id', p_student_case_id,
    'payment_obligation_id', p_payment_obligation_id,
    'amount_minor', p_amount_minor,
    'currency', CASE WHEN p_currency IS NULL THEN NULL ELSE upper(btrim(p_currency)) END,
    'due_on', p_due_on,
    'label', p_label,
    'archive', p_archive
  );
  replayed := platform_private.replay_audit(
    p_request_id, 'case.tranche.save', 'payment_obligation', NULL,
    fixed_reason, replay_shape
  );
  IF replayed IS NOT NULL THEN RETURN replayed; END IF;

  SELECT * INTO target_case FROM platform.student_cases AS student_case
  WHERE student_case.organization_id = p_organization_id
    AND student_case.id = p_student_case_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'case_agreement_forbidden' USING ERRCODE = '42501';
  END IF;

  effective_due_at := CASE WHEN p_due_on IS NULL THEN NULL
    ELSE (p_due_on::TIMESTAMP AT TIME ZONE 'Asia/Bishkek') END;

  IF p_payment_obligation_id IS NULL THEN
    -- Create. Amount/currency/label are required; label defaults to the
    -- next sequential «Транш N» for this case when left blank.
    IF p_amount_minor IS NULL
      OR p_amount_minor <= 0
      OR p_currency IS NULL
      OR upper(btrim(p_currency)) !~ '^[A-Z]{3}$'
      OR p_archive
    THEN
      RAISE EXCEPTION 'case_agreement_invalid' USING ERRCODE = '22023';
    END IF;

    SELECT count(*) + 1 INTO tranche_seq
    FROM platform.payment_obligations AS obligation
    WHERE obligation.organization_id = p_organization_id
      AND obligation.student_case_id = p_student_case_id
      AND obligation.category = 'evo_service_fee';
    effective_label := NULLIF(btrim(p_label), '');
    IF effective_label IS NULL THEN
      effective_label := 'Транш ' || tranche_seq::TEXT;
    END IF;

    INSERT INTO platform.payment_obligations (
      id, organization_id, student_case_id, label, category, amount_minor,
      currency, due_at, next_action, created_by_membership_id
    ) VALUES (
      created_id, p_organization_id, p_student_case_id, effective_label,
      'evo_service_fee', p_amount_minor, upper(btrim(p_currency)),
      effective_due_at, NULL, actor.membership_id
    );
  ELSE
    -- Edit. Label/due are always editable; amount/currency only while
    -- nothing has been paid against this tranche yet (plan requires history
    -- to stay honest once money has actually moved). Archive is the same
    -- soft guard: only while total_paid_minor = 0, and never a DELETE.
    SELECT * INTO existing FROM platform.payment_obligations AS obligation
    WHERE obligation.organization_id = p_organization_id
      AND obligation.id = p_payment_obligation_id
      AND obligation.student_case_id = p_student_case_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'case_agreement_forbidden' USING ERRCODE = '42501';
    END IF;
    created_id := existing.id;

    IF p_archive THEN
      IF existing.total_paid_minor <> 0 THEN
        RAISE EXCEPTION
          'case_agreement_tranche_paid' USING ERRCODE = '22023';
      END IF;
      UPDATE platform.payment_obligations
      SET archived_at = statement_timestamp()
      WHERE organization_id = p_organization_id AND id = existing.id
        AND archived_at IS NULL;
    ELSE
      IF existing.archived_at IS NOT NULL THEN
        RAISE EXCEPTION 'case_agreement_invalid' USING ERRCODE = '22023';
      END IF;
      effective_label := NULLIF(btrim(p_label), '');
      -- Edit semantics: NULL amount/currency/label mean "keep the stored
      -- value" (a label-only or due-only edit never has to re-send money
      -- fields); p_due_on is a plain passthrough (NULL clears the optional
      -- due — the form always round-trips it). "Editable only while unpaid"
      -- therefore means the EFFECTIVE amount/currency differ from the stored
      -- ones while total_paid_minor <> 0.
      effective_amount := COALESCE(p_amount_minor, existing.amount_minor);
      effective_currency := COALESCE(upper(btrim(p_currency)), existing.currency);
      IF effective_amount IS DISTINCT FROM existing.amount_minor
        OR effective_currency IS DISTINCT FROM existing.currency
      THEN
        IF existing.total_paid_minor <> 0 THEN
          RAISE EXCEPTION
            'case_agreement_tranche_paid' USING ERRCODE = '22023';
        END IF;
        IF effective_amount <= 0 OR effective_currency !~ '^[A-Z]{3}$' THEN
          RAISE EXCEPTION 'case_agreement_invalid' USING ERRCODE = '22023';
        END IF;
      END IF;
      UPDATE platform.payment_obligations
      SET amount_minor = effective_amount,
        currency = effective_currency,
        due_at = effective_due_at,
        label = COALESCE(effective_label, label),
        updated_at = statement_timestamp()
      WHERE organization_id = p_organization_id AND id = existing.id;
    END IF;
  END IF;

  result := replay_shape || jsonb_build_object('payment_obligation_id', created_id);

  INSERT INTO platform.audit_events(
    organization_id, actor_kind, actor_profile_id, actor_principal, action,
    resource_type, resource_id, before_state, after_state, reason, request_id
  ) VALUES (
    p_organization_id, 'user', actor.profile_id,
    'auth:' || actor.auth_user_id::TEXT, 'case.tranche.save',
    'payment_obligation', created_id, NULL, result, fixed_reason, p_request_id
  );

  RETURN result;
END
$$;

REVOKE ALL ON FUNCTION platform.save_case_tranche_v1(
  UUID, UUID, UUID, UUID, BIGINT, TEXT, DATE, TEXT, BOOLEAN
) FROM PUBLIC, anon, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.save_case_tranche_v1(
  UUID, UUID, UUID, UUID, BIGINT, TEXT, DATE, TEXT, BOOLEAN
) TO authenticated;

-- record_case_payment_v1 mirrors platform.record_payment_event (043:3871)
-- body exactly for the shared ledger mechanics (case-then-obligation lock
-- order, currency match, balance check, event+evidence insert, aggregate
-- update) — deliberately NOT refactored into a shared private core, so the
-- existing, already-audited 043 function and its callers are untouched byte
-- for byte (architecture requirement: "old RPCs untouched, zero
-- degradation"). Differences from 043's version, all intentional: (1)
-- authorization is the resource-scoped case.update.append door instead of
-- require_finance_actor('finance.event.confirm'), so Sales can use it; (2)
-- event_type is always 'payment' (refunds stay an admin-tool-only operation
-- via the untouched 043 RPC — the card's plan scope is "recording a
-- payment", not refund workflow); (3) evidence_ref/source_key are not
-- free-typed by the user (the new UX has no such fields) — they are fixed,
-- non-blank system markers so the underlying NOT-NULL/non-blank CHECKs on
-- payment_evidence still hold; the actual "чек" is the FILE recorded
-- separately via record_payment_receipt_file_metadata against the returned
-- payment_event_id, which is why a second evidence file can never
-- double-count: only THIS insert into payment_events / this aggregate UPDATE
-- moves the "оплачено" total, and it runs at most once per request_id.
CREATE FUNCTION platform.record_case_payment_v1(
  p_organization_id UUID,
  p_request_id UUID,
  p_student_case_id UUID,
  p_payment_obligation_id UUID,
  p_amount_minor BIGINT,
  p_currency TEXT,
  p_occurred_on DATE,
  p_note TEXT
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
  replay_shape JSONB;
  replayed JSONB;
  created_event_id UUID := gen_random_uuid();
  created_evidence_id UUID := gen_random_uuid();
  next_paid BIGINT;
  occurred_at TIMESTAMPTZ;
  effective_reason TEXT;
  result JSONB;
BEGIN
  PERFORM platform_private.lock_p2e_request(p_request_id);

  SELECT a.* INTO actor FROM platform.current_actor_authority() a
    WHERE a.organization_id = p_organization_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'case_agreement_forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_student_case_id IS NULL
    OR NOT (
      platform_private.staff_can_access(
        p_organization_id, actor.membership_id, 'case.update.append',
        'student_case', p_student_case_id
      )
      OR EXISTS (
        SELECT 1 FROM platform.student_cases AS sales_window_case
        WHERE sales_window_case.organization_id = p_organization_id
          AND sales_window_case.id = p_student_case_id
          AND sales_window_case.state = 'pending'
          AND sales_window_case.responsible_sales_membership_id = actor.membership_id
      )
    )
  THEN
    RAISE EXCEPTION 'case_agreement_forbidden' USING ERRCODE = '42501';
  END IF;

  IF p_payment_obligation_id IS NULL
    OR p_amount_minor IS NULL
    OR p_amount_minor <= 0
    OR p_currency IS NULL
    OR upper(btrim(p_currency)) !~ '^[A-Z]{3}$'
    OR p_occurred_on IS NULL
    OR (p_note IS NOT NULL AND char_length(p_note) > 1000)
  THEN
    RAISE EXCEPTION 'case_agreement_invalid' USING ERRCODE = '22023';
  END IF;
  effective_reason := COALESCE(
    NULLIF(btrim(p_note), ''),
    'Оплата зафиксирована через блок «Договор и оплата»'
  );
  occurred_at := p_occurred_on::TIMESTAMP AT TIME ZONE 'Asia/Bishkek';

  replay_shape := jsonb_build_object(
    'organization_id', p_organization_id,
    'student_case_id', p_student_case_id,
    'payment_obligation_id', p_payment_obligation_id,
    'amount_minor', p_amount_minor,
    'currency', upper(btrim(p_currency)),
    'occurred_at', occurred_at
  );
  -- Same request_id + same payload replays the stored result (idempotent
  -- resubmit-safe); same request_id + a DIFFERENT payload raises 22023 —
  -- this is the "one payment must never double-count on a form resubmit"
  -- guarantee, identical to 043's own record_payment_event.
  replayed := platform_private.replay_audit(
    p_request_id, 'finance.payment.record', 'payment_event', NULL,
    effective_reason, replay_shape
  );
  IF replayed IS NOT NULL THEN RETURN replayed; END IF;

  -- Lock order: case before obligation — matches 043's record_payment_event
  -- and the 070 concurrency proof (scripts/test-postgres-authorization.sh
  -- :1049, "case-before-obligation lock order at migration 070"). Both
  -- writers therefore can never deadlock against each other.
  SELECT * INTO target_case FROM platform.student_cases AS student_case
  WHERE student_case.organization_id = p_organization_id
    AND student_case.id = p_student_case_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'case_agreement_forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO obligation_row FROM platform.payment_obligations AS obligation
  WHERE obligation.organization_id = p_organization_id
    AND obligation.id = p_payment_obligation_id
    AND obligation.student_case_id = target_case.id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'case_agreement_forbidden' USING ERRCODE = '42501';
  END IF;
  IF obligation_row.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'case_agreement_invalid' USING ERRCODE = '22023';
  END IF;
  IF upper(btrim(p_currency)) <> obligation_row.currency THEN
    RAISE EXCEPTION 'case_agreement_invalid' USING ERRCODE = '22023';
  END IF;

  next_paid := obligation_row.total_paid_minor + p_amount_minor;
  IF next_paid - obligation_row.total_refunded_minor > obligation_row.amount_minor THEN
    RAISE EXCEPTION 'case_agreement_exceeds_balance' USING ERRCODE = '22023';
  END IF;

  INSERT INTO platform.payment_events (
    id, organization_id, student_case_id, payment_obligation_id, event_type,
    referenced_payment_event_id, amount_minor, currency, occurred_at,
    source_key, actor_membership_id, request_id
  ) VALUES (
    created_event_id, p_organization_id, target_case.id,
    p_payment_obligation_id, 'payment', NULL, p_amount_minor,
    obligation_row.currency, occurred_at, 'case_agreement',
    actor.membership_id, p_request_id
  );

  INSERT INTO platform.payment_evidence (
    id, organization_id, student_case_id, payment_obligation_id,
    payment_event_id, evidence_ref, recorded_by_membership_id
  ) VALUES (
    created_evidence_id, p_organization_id, target_case.id,
    p_payment_obligation_id, created_event_id,
    'case-agreement:' || created_event_id::TEXT, actor.membership_id
  );

  UPDATE platform.payment_obligations
  SET total_paid_minor = next_paid
  WHERE organization_id = p_organization_id AND id = p_payment_obligation_id;

  result := replay_shape || jsonb_build_object(
    'payment_event_id', created_event_id,
    'payment_evidence_id', created_evidence_id
  );

  INSERT INTO platform.audit_events(
    organization_id, actor_kind, actor_profile_id, actor_principal, action,
    resource_type, resource_id, before_state, after_state, reason, request_id
  ) VALUES (
    p_organization_id, 'user', actor.profile_id,
    'auth:' || actor.auth_user_id::TEXT, 'finance.payment.record',
    'payment_event', created_event_id, NULL, result, effective_reason,
    p_request_id
  );

  RETURN result;
END
$$;

REVOKE ALL ON FUNCTION platform.record_case_payment_v1(
  UUID, UUID, UUID, UUID, BIGINT, TEXT, DATE, TEXT
) FROM PUBLIC, anon, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.record_case_payment_v1(
  UUID, UUID, UUID, UUID, BIGINT, TEXT, DATE, TEXT
) TO authenticated;

-- ---------------------------------------------------------------------------
-- (e) Read RPC — the whole block in one call. Read gate: full-finance
-- readers, OR anyone who can read the case AND holds finance.read.summary
-- (Sales and Curator both carry this in 173's templates already), OR —
-- symmetric with the write doors above — the case's own responsible Sales
-- rep while the case is still 'pending', so a Sales rep who has not yet
-- earned finance.read.summary through some other role still sees their own
-- pending case's block. can_write below carries the identical resource-scope
-- OR, so the read and write authorization can never disagree about who may
-- act. Cost/currency resolve through the case's linked lead exactly the way
-- 184's prepare_lead_cabinet_v1 / staff_lead_cabinet_case_v1 link a case back
-- to its lead: student_cases.canonical_lead_id.
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform.staff_case_agreement_v1(p_student_case_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  target_organization_id UUID;
  target_lead_id UUID;
  actor_membership_id UUID;
  sale_conditions RECORD;
  cost_minor BIGINT;
  cost_currency TEXT;
  contract_current JSONB;
  contract_history JSONB;
  tranches JSONB;
  payments JSONB;
  tranche_sum_minor BIGINT;
  currencies_count INTEGER;
  paid_minor BIGINT;
  remaining_minor BIGINT;
  result JSONB;
BEGIN
  IF p_student_case_id IS NULL THEN
    RAISE EXCEPTION 'case_agreement_invalid' USING ERRCODE = '22023';
  END IF;

  SELECT student_case.organization_id, student_case.canonical_lead_id
  INTO target_organization_id, target_lead_id
  FROM platform.student_cases AS student_case
  WHERE student_case.id = p_student_case_id
    AND (
      private.platform_can_read_finance_full(student_case.organization_id)
      OR (
        private.platform_can_read_student_case(
          student_case.organization_id, student_case.id
        )
        AND private.platform_has_permission(
          student_case.organization_id, 'finance.read.summary'
        )
      )
      OR (
        student_case.state = 'pending'
        AND student_case.responsible_sales_membership_id = (
          SELECT a.membership_id FROM platform.current_actor_authority() a
          WHERE a.organization_id = student_case.organization_id
        )
      )
    )
  LIMIT 1;
  IF target_organization_id IS NULL THEN
    RAISE EXCEPTION 'case_agreement_forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT a.membership_id INTO actor_membership_id
  FROM platform.current_actor_authority() a
  WHERE a.organization_id = target_organization_id;

  -- Cost + currency: entered once at the sales stage, reused here — never
  -- re-entered on the card.
  IF target_lead_id IS NOT NULL THEN
    SELECT
      NULLIF(conditions.fields ->> 'service_cost_minor', '')::BIGINT,
      NULLIF(conditions.fields ->> 'service_cost_currency', '')
    INTO cost_minor, cost_currency
    FROM platform_private.lead_sale_conditions AS conditions
    WHERE conditions.organization_id = target_organization_id
      AND conditions.lead_id = target_lead_id;
  END IF;

  SELECT jsonb_build_object(
    'case_contract_file_id', file.id,
    'original_filename', file.original_filename,
    'uploaded_at', file.uploaded_at,
    'uploaded_by_display_name', identity.display_name
  ) INTO contract_current
  FROM platform.case_contract_files AS file
  LEFT JOIN LATERAL platform_private.staff_membership_identity(
    target_organization_id, file.uploaded_by_membership_id
  ) AS identity ON TRUE
  WHERE file.organization_id = target_organization_id
    AND file.student_case_id = p_student_case_id
    AND file.superseded_at IS NULL;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'case_contract_file_id', file.id,
    'original_filename', file.original_filename,
    'uploaded_at', file.uploaded_at,
    'uploaded_by_display_name', identity.display_name
  ) ORDER BY file.uploaded_at DESC), '[]'::JSONB) INTO contract_history
  FROM platform.case_contract_files AS file
  LEFT JOIN LATERAL platform_private.staff_membership_identity(
    target_organization_id, file.uploaded_by_membership_id
  ) AS identity ON TRUE
  WHERE file.organization_id = target_organization_id
    AND file.student_case_id = p_student_case_id
    AND file.superseded_at IS NOT NULL;

  SELECT
    COALESCE(jsonb_agg(jsonb_build_object(
      'payment_obligation_id', obligation.id,
      'label', obligation.label,
      'amount_minor', obligation.amount_minor::TEXT,
      'currency', obligation.currency,
      'due_on', (obligation.due_at AT TIME ZONE 'Asia/Bishkek')::DATE,
      'total_paid_minor', obligation.total_paid_minor::TEXT,
      'outstanding_minor', (
        obligation.amount_minor - obligation.total_paid_minor
        + obligation.total_refunded_minor
      )::TEXT
    ) ORDER BY obligation.created_at, obligation.id), '[]'::JSONB),
    COALESCE(SUM(obligation.amount_minor), 0)
  INTO tranches, tranche_sum_minor
  FROM platform.payment_obligations AS obligation
  WHERE obligation.organization_id = target_organization_id
    AND obligation.student_case_id = p_student_case_id
    AND obligation.category = 'evo_service_fee'
    AND obligation.archived_at IS NULL;

  SELECT
    COALESCE(jsonb_agg(jsonb_build_object(
      'payment_event_id', event.id,
      -- FIX 4 (adversarial review): the payments array previously omitted
      -- event_type, so a refund (043's admin ledger can record one; this
      -- slice's own record_case_payment_v1 only ever writes 'payment') was
      -- indistinguishable from a payment in the card's history — this field
      -- was already being read (event.event_type feeds paid_minor's FILTER
      -- above), just never projected. CaseAgreementBlock.tsx now renders a
      -- «Возврат» label + minus-prefixed amount for event_type='refund'.
      'event_type', event.event_type,
      'payment_obligation_id', event.payment_obligation_id,
      'amount_minor', event.amount_minor::TEXT,
      'currency', event.currency,
      'occurred_on', (event.occurred_at AT TIME ZONE 'Asia/Bishkek')::DATE,
      'actor_display_name', identity.display_name,
      'receipts', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'payment_receipt_file_id', receipt.id,
          'original_filename', receipt.original_filename,
          'uploaded_at', receipt.uploaded_at
        ) ORDER BY receipt.uploaded_at DESC)
        FROM platform.payment_receipt_files AS receipt
        WHERE receipt.organization_id = target_organization_id
          AND receipt.payment_event_id = event.id
      ), '[]'::JSONB)
    ) ORDER BY event.occurred_at DESC, event.id DESC), '[]'::JSONB),
    COALESCE(SUM(event.amount_minor) FILTER (
      WHERE event.event_type = 'payment'
    ), 0) - COALESCE(SUM(event.amount_minor) FILTER (
      WHERE event.event_type = 'refund'
    ), 0)
  INTO payments, paid_minor
  FROM platform.payment_events AS event
  JOIN platform.payment_obligations AS obligation
    ON obligation.organization_id = event.organization_id
    AND obligation.id = event.payment_obligation_id
  LEFT JOIN LATERAL platform_private.staff_membership_identity(
    target_organization_id, event.actor_membership_id
  ) AS identity ON TRUE
  WHERE event.organization_id = target_organization_id
    AND event.student_case_id = p_student_case_id
    AND obligation.category = 'evo_service_fee'
    AND obligation.archived_at IS NULL;

  -- Honest arithmetic: count every DISTINCT currency across cost + every
  -- non-archived tranche together (payment currencies always match their own
  -- obligation's currency — enforced at write time by both record_payment_event
  -- and record_case_payment_v1 — so tranche currencies already cover them).
  -- remaining_minor is only ever computed when that set has at most one
  -- member; otherwise it stays NULL and currency_mismatch is surfaced instead
  -- of a fabricated total.
  SELECT COUNT(DISTINCT currency_value) INTO currencies_count
  FROM (
    SELECT cost_currency AS currency_value WHERE cost_currency IS NOT NULL
    UNION
    SELECT obligation.currency FROM platform.payment_obligations AS obligation
    WHERE obligation.organization_id = target_organization_id
      AND obligation.student_case_id = p_student_case_id
      AND obligation.category = 'evo_service_fee'
      AND obligation.archived_at IS NULL
  ) AS distinct_currencies;

  remaining_minor := CASE
    WHEN cost_minor IS NOT NULL AND currencies_count <= 1
    THEN cost_minor - paid_minor
    ELSE NULL
  END;

  result := jsonb_build_object(
    'organization_id', target_organization_id,
    'student_case_id', p_student_case_id,
    'cost_minor', cost_minor::TEXT,
    'cost_currency', cost_currency,
    'contract_current', contract_current,
    'contract_history', contract_history,
    'tranches', tranches,
    'tranche_sum_minor', tranche_sum_minor::TEXT,
    'cost_mismatch', cost_minor IS NOT NULL
      AND currencies_count <= 1
      AND tranche_sum_minor <> cost_minor,
    'payments', payments,
    'paid_minor', paid_minor::TEXT,
    'remaining_minor', remaining_minor::TEXT,
    'currency_mismatch', currencies_count > 1,
    'can_write', (
      platform_private.staff_can_access(
        target_organization_id, actor_membership_id,
        'case.update.append', 'student_case', p_student_case_id
      )
      OR EXISTS (
        SELECT 1 FROM platform.student_cases AS sales_window_case
        WHERE sales_window_case.organization_id = target_organization_id
          AND sales_window_case.id = p_student_case_id
          AND sales_window_case.state = 'pending'
          AND sales_window_case.responsible_sales_membership_id = actor_membership_id
      )
    )
  );
  RETURN result;
END
$$;

REVOKE ALL ON FUNCTION platform.staff_case_agreement_v1(UUID)
  FROM PUBLIC, anon, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.staff_case_agreement_v1(UUID)
  TO authenticated;

COMMIT;
