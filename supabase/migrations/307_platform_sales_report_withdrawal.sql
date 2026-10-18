-- «Отчёт продаж»: «Убрать» продажу с отметкой отказа, чтение с отметкой и три служебные
-- правки данных (слова владельца 18.10.2026, docs/design/v3/product.md «18.10 — Отчёт продаж:
-- «Убрать» продажу»). docs/PLAN_CHANGES.md «2026-10-18 · Отчёт продаж: «Убрать» продажу с
-- отметкой отказа и служебные правки данных (миграция 307, запись до кода)». Номер 307 -
-- следующий за 306 на origin/main d787cd40e; сверяется ещё раз перед слиянием.
--
-- Forward-only. v1-v4 чтения, строки v1/v2, manage v1/v2, link 254 и все остальные
-- выпущенные функции остаются побайтово прежними (откат приложения продолжает работать);
-- исключение - три тела, где «Продажа» считается по определению 247 (g). SECURITY DEFINER с
-- пустым search_path; клиентские функции только в `platform`.
--
--  a) Отметка отказа - ОТДЕЛЬНЫЕ колонки platform_private.sales_register, не `fields`:
--     withdrawal_kind (partial | unpaid), withdrawn_at, withdrawn_by_membership_id,
--     withdrawal_note (до 500 символов). `fields` замещается целиком обычной правкой, а лишний
--     ключ в нём попал бы во все выпущенные чтения, которые приложение разбирает по точному
--     набору ключей (так решили 253 и 254). Деньги paid_* остаются в `fields` как были.
--  b) platform_private.sales_withdrawal_service_receipts: квитанция служебных вызовов (а) и
--     (б) - идемпотентность по (организация, источник, ссылка), md5 тела, актёр, запись, итог и
--     что было до. Закрытая, принудительный RLS, без прав клиентским ролям, без изменений.
--  c) platform_private.sales_register_row_v3: строка v2 + ключ `withdrawal` (null или
--     {kind, at, by, note}).
--  d) platform.read_sales_register_v5: v4 (253) со строкой v3. Отказные записи остаются в
--     таблице, но не входят в суммы и числа неуточнённых значений; их число и сумма оплаты по
--     ним - объект `withdrawn`. Срезы `sale` не содержат отказных записей (они объясняют
--     число «Продажи»).
--  e) platform.set_sales_register_withdrawal_v1: «Убрать» / «Вернуть» из интерфейса. Ворота -
--     ровно manage_sales_register_v2: Sales Manager (208) и sales.register.manage на записи.
--     Версия, повтор по request_id, журнал `sales.register.update` (действие уже есть в
--     allowlist журнала, поэтому он не расширяется и прежнее приложение журнал разбирает).
--  f) Три служебные функции (service_role, без пользовательского JWT, актёр - Admin владельца):
--       platform.mark_sales_report_row_withdrawn_v1  - поставить / снять отметку по source_key;
--       platform.archive_sales_report_row_v1         - архив строки-дубля по source_key;
--       platform.create_sales_report_student_case_v1 - дело студента на проданном лиде отчёта
--                                                       (281: та же нагрузка и те же проверки
--                                                       содержания, но клиент и лид - данные).
--  g) «Продажа» без отказа: staff_sales_count_v1 (247), marketing_cohort и marketing_overview_v1
--     (265) получают условие «и без отметки отказа» самопроверяемой заменой куска.
BEGIN;

-- ---------------------------------------------------------------------------
-- Якоря: что читается и копируется - это живые определения 001-306.
-- ---------------------------------------------------------------------------
DO $a307_anchor$
DECLARE anchor RECORD;
BEGIN
  FOR anchor IN SELECT * FROM (VALUES
    ('platform.read_sales_register_v4(uuid,integer,integer,integer,uuid,boolean,text,text,boolean,text,text)', 'ea3f0a2000c65d8aed60cf2be3ec78a8'),
    ('platform_private.sales_register_row_v2(platform_private.sales_register)', 'be1745aa63531ddad26480ba8c2b2361'),
    ('platform_private.sales_register_row(platform_private.sales_register)', '17df8ac76544087f7f93410c26e734cc'),
    ('platform.manage_sales_register_v2(uuid,text,uuid,bigint,jsonb,bigint,text,text,uuid)', '1ae50564608769f594cf76c13e52eb9b'),
    ('platform.link_sales_record_lead_v1(uuid,uuid,bigint,uuid,uuid)', '65d87280f3f7f9c3c2ea7d5f96be5305'),
    ('platform.staff_sales_count_v1(uuid,date,date)', '337764b28cf8ed13103c04847726f827'),
    ('platform_private.marketing_cohort(uuid,date,date)', '2d1ffe23dc5f15ffc2563fef6ea1c192'),
    ('platform.marketing_overview_v1(date,date)', '3c83f3ebb1020d086424f44d298fa817')
  ) AS a(signature, expected)
  LOOP
    IF (SELECT md5(p.prosrc) FROM pg_catalog.pg_proc p WHERE p.oid = anchor.signature::regprocedure)
      IS DISTINCT FROM anchor.expected THEN
      RAISE EXCEPTION 'a307_anchor_drift: % is not the expected definition', anchor.signature;
    END IF;
  END LOOP;
  IF to_regclass('platform_private.sales_register') IS NULL
    OR to_regclass('platform_private.sales_register_requests') IS NULL
    OR to_regclass('platform_private.admissions_direct_case_receipts') IS NULL
    OR to_regclass('platform_private.lead_sale_conditions') IS NULL
    OR to_regprocedure('platform_private.sales_register_actor(uuid)') IS NULL
    OR to_regprocedure('platform_private.staff_is_sales_manager(uuid,uuid)') IS NULL
    OR to_regprocedure('platform_private.staff_can_access(uuid,uuid,text,text,uuid)') IS NULL
    OR to_regprocedure('platform_private.staff_has_permission(uuid,uuid,text)') IS NULL
    OR to_regprocedure('platform_private.staff_membership_identity(uuid,uuid)') IS NULL
    OR to_regprocedure('platform_private.staff_can_create_for_owner(uuid,uuid,text,text,uuid)') IS NULL
    OR to_regprocedure('platform_private.staff_can_receive_assignment(uuid,uuid,text,text,uuid)') IS NULL
    OR to_regprocedure('platform_private.block_append_only_mutation()') IS NULL
    OR to_regprocedure('platform_private.lock_p2d_request(uuid)') IS NULL
    OR to_regprocedure('platform_private.admissions_direct_text(jsonb,text,integer,boolean)') IS NULL
    OR to_regprocedure('platform_private.admissions_direct_object(jsonb,text,text[])') IS NULL
    OR to_regprocedure('platform_private.admissions_direct_minor(jsonb,text,text)') IS NULL
    OR to_regprocedure('platform_private.admissions_direct_date(jsonb,text,date,date,text)') IS NULL
    OR to_regprocedure('platform_private.admissions_direct_phone(text)') IS NULL
    OR to_regprocedure('platform_private.admissions_direct_actor_may_name(uuid,uuid,uuid,text)') IS NULL
    OR to_regprocedure('platform_private.assign_student_case_curator_authorized_e1(uuid,uuid,uuid,text,uuid,uuid,uuid,uuid)') IS NULL
    OR to_regprocedure('platform_private.lead_sale_condition_fields(jsonb)') IS NULL
    OR to_regprocedure('platform_private.student_application_direction(text)') IS NULL
    OR to_regprocedure('platform_private.normalize_student_profile_field_value(text,text)') IS NULL
    OR to_regprocedure('platform_private.is_eligible_staff_responsibility(uuid,uuid,text)') IS NULL
    OR to_regprocedure('public.uuid_generate_v5(uuid,text)') IS NULL
    -- 281: the case origin that lets a case ride on an existing lead.
    OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c
      WHERE c.conrelid = 'platform.student_cases'::regclass AND c.conname = 'student_cases_intake_origin_check'
        AND pg_get_constraintdef(c.oid) LIKE '%admissions-direct:%')
    -- 253 / 254: the columns the row keeps next to the new ones.
    OR NOT EXISTS (SELECT 1 FROM information_schema.columns c
      WHERE c.table_schema = 'platform_private' AND c.table_name = 'sales_register' AND c.column_name = 'paid_contract_minor')
    OR NOT EXISTS (SELECT 1 FROM information_schema.columns c
      WHERE c.table_schema = 'platform_private' AND c.table_name = 'sales_register' AND c.column_name = 'linked_lead_id')
  THEN
    RAISE EXCEPTION 'a307_anchor_drift';
  END IF;
END
$a307_anchor$;

-- Rollback proof: the released reads and commands are compared after this migration.
CREATE TEMP TABLE a307_released ON COMMIT DROP AS
  SELECT p.oid::REGPROCEDURE::TEXT AS signature, md5(p.prosrc) AS body
  FROM pg_catalog.pg_proc p
  WHERE p.oid IN (
    'platform.read_sales_register_v1(uuid,integer,integer,integer,uuid,boolean,text,text,boolean)'::regprocedure,
    'platform.read_sales_register_v2(uuid,integer,integer,integer,uuid,boolean,text,text,boolean,text)'::regprocedure,
    'platform.read_sales_register_v3(uuid,integer,integer,integer,uuid,boolean,text,text,boolean,text,text)'::regprocedure,
    'platform.read_sales_register_v4(uuid,integer,integer,integer,uuid,boolean,text,text,boolean,text,text)'::regprocedure,
    'platform.manage_sales_register_v1(uuid,text,uuid,bigint,jsonb,text,uuid)'::regprocedure,
    'platform.manage_sales_register_v2(uuid,text,uuid,bigint,jsonb,bigint,text,text,uuid)'::regprocedure,
    'platform.link_sales_record_lead_v1(uuid,uuid,bigint,uuid,uuid)'::regprocedure,
    'platform.staff_lead_handoff_strip_v1(uuid,uuid)'::regprocedure,
    'platform.staff_lead_handoff_strip_v2(uuid,uuid)'::regprocedure,
    'platform.import_sales_report_row_v1(uuid,uuid,text,text,jsonb,text)'::regprocedure,
    'platform.create_admissions_student_case_v1(uuid,uuid,jsonb)'::regprocedure,
    'platform.import_admissions_student_case_v1(uuid,uuid,text,text,jsonb,text)'::regprocedure,
    'platform.update_admissions_direct_case_v1(uuid,uuid,uuid,text,text,jsonb,text)'::regprocedure,
    'platform_private.create_admissions_student_case(uuid,uuid,uuid,jsonb,text,text,text)'::regprocedure,
    'platform_private.sales_register_row(platform_private.sales_register)'::regprocedure,
    'platform_private.sales_register_row_v2(platform_private.sales_register)'::regprocedure,
    'platform_private.sales_register_fields(jsonb,boolean)'::regprocedure);

-- Self-verifying replace inside one function body (the 173 / 244 / 281 / 304 pattern).
CREATE FUNCTION pg_temp.a307_replace(p_signature TEXT, p_old TEXT, p_new TEXT, p_count INTEGER)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE body TEXT; matches INTEGER;
BEGIN
  body := pg_get_functiondef(to_regprocedure(p_signature));
  matches := (length(body) - length(replace(body, p_old, ''))) / length(p_old);
  IF body IS NULL OR matches IS DISTINCT FROM p_count THEN
    RAISE EXCEPTION 'a307_replace_drift: % expected %, found %', p_signature, p_count, matches;
  END IF;
  EXECUTE replace(body, p_old, p_new);
END $$;

-- ---------------------------------------------------------------------------
-- a) The refusal mark: columns, not `fields`
-- ---------------------------------------------------------------------------
ALTER TABLE platform_private.sales_register
  ADD COLUMN withdrawal_kind TEXT,
  ADD COLUMN withdrawn_at TIMESTAMPTZ,
  ADD COLUMN withdrawn_by_membership_id UUID,
  ADD COLUMN withdrawal_note TEXT,
  ADD CONSTRAINT sales_register_withdrawal_kind
    CHECK (withdrawal_kind IS NULL OR withdrawal_kind IN ('partial', 'unpaid')),
  -- The mark is whole or absent; the note rides only on a mark (one line, up to 500 characters).
  ADD CONSTRAINT sales_register_withdrawal_shape
    CHECK ((withdrawal_kind IS NULL) = (withdrawn_at IS NULL)
      AND (withdrawal_kind IS NULL) = (withdrawn_by_membership_id IS NULL)
      AND (withdrawal_note IS NULL OR (withdrawal_kind IS NOT NULL
        AND char_length(withdrawal_note) BETWEEN 1 AND 500 AND withdrawal_note !~ '[[:cntrl:]]'))),
  ADD CONSTRAINT sales_register_withdrawn_by_fkey
    FOREIGN KEY (organization_id, withdrawn_by_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id);
COMMENT ON COLUMN platform_private.sales_register.withdrawal_kind IS
  'Отметка отказа (307): partial - оплачено частично, unpaid - без оплаты. Запись остаётся в отчёте и не входит в «Продажи»; деньги paid_* не меняются.';

-- ---------------------------------------------------------------------------
-- b) Receipts of the service calls (a) and (b)
-- ---------------------------------------------------------------------------
CREATE TABLE platform_private.sales_withdrawal_service_receipts (
  organization_id UUID NOT NULL REFERENCES platform.organizations(id) ON DELETE RESTRICT,
  operation TEXT NOT NULL CHECK (operation IN ('withdraw', 'archive')),
  import_source TEXT NOT NULL CHECK (import_source ~ '^[a-z][a-z0-9_.-]{1,63}$'),
  external_ref TEXT NOT NULL CHECK (char_length(external_ref) BETWEEN 1 AND 200 AND external_ref !~ '[[:cntrl:]]'),
  actor_membership_id UUID NOT NULL,
  payload_md5 TEXT NOT NULL CHECK (payload_md5 ~ '^[0-9a-f]{32}$'),
  register_id UUID NOT NULL,
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
ALTER TABLE platform_private.sales_withdrawal_service_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.sales_withdrawal_service_receipts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE platform_private.sales_withdrawal_service_receipts
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
CREATE TRIGGER sales_withdrawal_service_receipts_append_only
  BEFORE UPDATE OR DELETE ON platform_private.sales_withdrawal_service_receipts
  FOR EACH ROW EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER sales_withdrawal_service_receipts_no_truncate
  BEFORE TRUNCATE ON platform_private.sales_withdrawal_service_receipts
  FOR EACH STATEMENT EXECUTE FUNCTION platform_private.block_append_only_mutation();
COMMENT ON TABLE platform_private.sales_withdrawal_service_receipts IS
  'Migration 307: one row per accepted mark_sales_report_row_withdrawn_v1 / archive_sales_report_row_v1 call (idempotency by organization, import source and external reference; payload md5, actor, the record, the answer and the before_state). Backend only, append-only.';

-- ---------------------------------------------------------------------------
-- c) Row v3: row v2 + the refusal mark
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform_private.sales_register_row_v3(p_row platform_private.sales_register)
RETURNS JSONB
LANGUAGE plpgsql STABLE SET search_path = '' AS $$
DECLARE who TEXT;
BEGIN
  IF p_row.withdrawal_kind IS NOT NULL THEN
    SELECT left(btrim(regexp_replace(coalesce(pr.display_name, ''), '[[:cntrl:]]', ' ', 'g')), 300) INTO who
    FROM platform.organization_memberships m JOIN platform.profiles pr ON pr.id = m.profile_id
    WHERE m.organization_id = p_row.organization_id AND m.id = p_row.withdrawn_by_membership_id;
  END IF;
  RETURN platform_private.sales_register_row_v2(p_row) || jsonb_build_object('withdrawal',
    CASE WHEN p_row.withdrawal_kind IS NULL THEN NULL
      ELSE jsonb_build_object('kind', p_row.withdrawal_kind, 'at', p_row.withdrawn_at,
        'by', coalesce(who, ''), 'note', p_row.withdrawal_note) END);
END
$$;
REVOKE ALL ON FUNCTION platform_private.sales_register_row_v3(platform_private.sales_register)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

-- ---------------------------------------------------------------------------
-- d) platform.read_sales_register_v5: v4 + row v3; refusals out of the sums
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform.read_sales_register_v5(p_organization_id UUID, p_year INTEGER, p_month INTEGER DEFAULT NULL,
  p_offset INTEGER DEFAULT 0, p_record_id UUID DEFAULT NULL, p_archived BOOLEAN DEFAULT false,
  p_manager_key TEXT DEFAULT NULL, p_direction TEXT DEFAULT NULL, p_needs_review BOOLEAN DEFAULT NULL,
  p_query TEXT DEFAULT NULL, p_sale_slice TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor RECORD; selected JSONB:=NULL; rows JSONB; total BIGINT; totals JSONB; targets JSONB; owners JSONB;
 managers JSONB; facets JSONB; withdrawn JSONB;
 unresolved_cost BIGINT; unresolved_paid BIGINT; first_month DATE; last_month DATE; period_end DATE;
 normalized_query TEXT := NULLIF(btrim(p_query),''); query_lower TEXT; query_digits TEXT;
 manager_key TEXT := CASE WHEN p_manager_key IS NULL THEN NULL ELSE platform_private.sales_manager_label_key(p_manager_key) END;
BEGIN
 SELECT * INTO actor FROM platform_private.sales_register_actor(p_organization_id);
 IF p_year IS NULL OR p_year NOT BETWEEN 1900 AND 2100 OR (p_month IS NOT NULL AND p_month NOT BETWEEN 1 AND 12)
   OR p_offset IS NULL OR p_offset NOT BETWEEN 0 AND 1000000 OR p_archived IS NULL
   OR (p_manager_key IS NOT NULL AND (length(p_manager_key) NOT BETWEEN 1 AND 300 OR p_manager_key ~ '[[:cntrl:]]' OR manager_key = ''))
   OR (p_direction IS NOT NULL AND (length(p_direction) NOT BETWEEN 1 AND 500 OR p_direction ~ '[[:cntrl:]]'))
   OR (p_query IS NOT NULL AND (length(p_query)>200 OR p_query ~ '[[:cntrl:]]'))
   OR (p_sale_slice IS NOT NULL AND (p_sale_slice NOT IN ('undated','other_sale_date','filed_elsewhere') OR p_archived)) THEN
   RAISE EXCEPTION 'sales_register_invalid_filter' USING ERRCODE='22023'; END IF;
 query_lower:=lower(normalized_query);
 query_digits:=CASE WHEN normalized_query ~ '^[+0-9 ().-]+$'
   THEN NULLIF(regexp_replace(normalized_query,'[^0-9]','','g'),'') ELSE NULL END;
 first_month:=make_date(p_year,coalesce(p_month,1),1);
 last_month:=CASE WHEN p_month IS NULL THEN make_date(p_year,12,1) ELSE first_month END;
 period_end:=(last_month + INTERVAL '1 month' - INTERVAL '1 day')::DATE;
 IF p_record_id IS NOT NULL THEN
   SELECT platform_private.sales_register_row_v3(r) INTO selected FROM platform_private.sales_register r
     WHERE r.organization_id=p_organization_id AND r.id=p_record_id AND platform_private.staff_can_access(p_organization_id, actor.membership_id,
      'sales.register.read', 'sales_register', r.id);
   IF NOT FOUND THEN RAISE EXCEPTION 'sales_register_forbidden' USING ERRCODE='42501'; END IF;
 END IF;
 -- `base` is v3's selection without the manager filter: the manager options
 -- count what choosing each of them would show.
 WITH base AS MATERIALIZED (SELECT r.* FROM platform_private.sales_register r WHERE r.organization_id=p_organization_id
   AND platform_private.staff_can_access(p_organization_id, actor.membership_id,
      'sales.register.read', 'sales_register', r.id) AND r.archived=p_archived
   -- The slices explain the number «Продажи», which has no refusals (307).
   AND (p_sale_slice IS NULL OR r.withdrawal_kind IS NULL)
   AND CASE WHEN p_sale_slice = 'filed_elsewhere'
     THEN NULLIF(r.fields->>'signing_date','')::DATE BETWEEN first_month AND period_end
       AND r.report_month NOT BETWEEN first_month AND last_month
     ELSE r.report_month BETWEEN first_month AND last_month END
   AND (p_sale_slice IS NULL OR p_sale_slice = 'filed_elsewhere'
     OR (p_sale_slice = 'undated' AND NULLIF(r.fields->>'signing_date','') IS NULL)
     OR (p_sale_slice = 'other_sale_date'
       AND NULLIF(r.fields->>'signing_date','')::DATE NOT BETWEEN first_month AND period_end))
   AND (p_direction IS NULL OR r.fields->>'direction'=p_direction)
   AND (p_needs_review IS NULL OR (r.fields->>'needs_review')::BOOLEAN=p_needs_review)
   AND (normalized_query IS NULL
     OR strpos(lower(coalesce(r.fields->>'applicant_name','')),query_lower)>0
     OR strpos(lower(coalesce(r.fields->>'contract_number','')),query_lower)>0
     OR (query_digits IS NOT NULL AND strpos(regexp_replace(coalesce(r.fields->>'phone',''),'[^0-9]','','g'),query_digits)>0))),
 filtered AS MATERIALIZED (SELECT b.* FROM base b
   WHERE manager_key IS NULL OR platform_private.sales_manager_label_key(b.fields->>'manager_label')=manager_key),
 -- Paid side of the totals: «Оплачено в валюте договора» for a record paid in
 -- another currency when that amount is in the cost currency; else as v3.
 paid AS (SELECT (f.withdrawal_kind IS NOT NULL) AS refused, CASE WHEN f.paid_contract_minor IS NOT NULL AND f.paid_contract_currency=f.fields->>'service_cost_currency'
       AND f.fields->>'paid_currency' IS DISTINCT FROM f.fields->>'service_cost_currency'
     THEN f.paid_contract_currency ELSE f.fields->>'paid_currency' END AS currency,
   CASE WHEN f.paid_contract_minor IS NOT NULL AND f.paid_contract_currency=f.fields->>'service_cost_currency'
       AND f.fields->>'paid_currency' IS DISTINCT FROM f.fields->>'service_cost_currency'
     THEN f.paid_contract_minor ELSE (f.fields->>'paid_minor')::BIGINT END AS minor
   FROM filtered f WHERE f.fields->>'paid_minor' IS NOT NULL)
 SELECT (SELECT count(*) FROM filtered),
   coalesce((SELECT jsonb_agg(platform_private.sales_register_row_v3(page::platform_private.sales_register) ORDER BY page.report_month DESC,page.id) FROM
      (SELECT * FROM filtered ORDER BY report_month DESC,id LIMIT 50 OFFSET p_offset) page),'[]'),
   (SELECT count(*) FROM filtered WHERE withdrawal_kind IS NULL AND fields->>'service_cost_minor' IS NULL),
   (SELECT count(*) FROM filtered WHERE withdrawal_kind IS NULL AND fields->>'paid_minor' IS NULL),
   coalesce((SELECT jsonb_agg(jsonb_build_object('currency',currency,'cost_minor',cost_minor::TEXT,'paid_minor',paid_minor::TEXT) ORDER BY currency)
     FROM (SELECT currency,sum(cost_minor) cost_minor,sum(paid_minor) paid_minor FROM (
       SELECT fields->>'service_cost_currency' currency,(fields->>'service_cost_minor')::BIGINT cost_minor,0::BIGINT paid_minor FROM filtered WHERE withdrawal_kind IS NULL AND fields->>'service_cost_minor' IS NOT NULL
       UNION ALL SELECT p.currency,0::BIGINT,p.minor FROM paid p WHERE NOT p.refused) amounts GROUP BY currency) sums),'[]'),
   coalesce((SELECT jsonb_object_agg(k.key, k.n) FROM (SELECT platform_private.sales_manager_label_key(b.fields->>'manager_label') AS key, count(*) AS n
     FROM base b GROUP BY 1) k WHERE k.key<>''),'{}'),
   -- Refusals stay in the table but not in the sums above; what was paid on them is named apart.
   jsonb_build_object('count',(SELECT count(*) FROM filtered WHERE withdrawal_kind IS NOT NULL),
     'paid',coalesce((SELECT jsonb_agg(jsonb_build_object('currency',w.currency,'paid_minor',w.minor::TEXT) ORDER BY w.currency)
       FROM (SELECT p.currency,sum(p.minor) minor FROM paid p WHERE p.refused GROUP BY p.currency) w),'[]'))
 INTO total,rows,unresolved_cost,unresolved_paid,totals,facets,withdrawn;
 IF p_archived THEN totals:='[]'; unresolved_cost:=0; unresolved_paid:=0; withdrawn:=jsonb_build_object('count',0,'paid','[]'::JSONB); END IF;
 -- Menu of managers: every key the actor can read (as v3's labels), named by
 -- the owner's mapping or, unmapped, by its most frequent tidy spelling.
 WITH spelled AS (SELECT platform_private.sales_manager_label_key(r.fields->>'manager_label') AS key,
     regexp_replace(btrim(r.fields->>'manager_label'),'[[:space:]]+',' ','g') AS tidy, count(*) AS n
   FROM platform_private.sales_register r WHERE r.organization_id=p_organization_id AND platform_private.staff_can_access(p_organization_id, actor.membership_id,
      'sales.register.read', 'sales_register', r.id)
   AND r.fields->>'manager_label'<>'' GROUP BY 1,2),
 best AS (SELECT DISTINCT ON (s.key) s.key, s.tidy FROM spelled s WHERE s.key<>'' ORDER BY s.key, s.n DESC, s.tidy),
 named AS (SELECT b.key, left(coalesce(m.display_name, b.tidy),300) AS name FROM best b
   LEFT JOIN platform_private.sales_manager_labels m ON m.organization_id=p_organization_id AND m.label_key=b.key AND m.display_name IS NOT NULL
   ORDER BY 2, 1 LIMIT 1000)
 SELECT coalesce(jsonb_agg(jsonb_build_object('key',n.key,'name',n.name,'count',coalesce((facets->>n.key)::BIGINT,0)) ORDER BY n.name,n.key),'[]')
   INTO managers FROM named n;
 IF platform_private.staff_can_access(p_organization_id, actor.membership_id,
      'sales.register.target.manage', 'organization', p_organization_id) THEN
   SELECT coalesce(jsonb_agg(jsonb_build_object('id',t.id,'version',t.version::TEXT,'report_month',t.report_month,
     'manager_label',t.manager_label,'target_count',t.target_count) ORDER BY t.report_month,t.manager_label),'[]') INTO targets
     FROM platform_private.sales_register_targets t WHERE t.organization_id=p_organization_id AND t.report_month BETWEEN first_month AND last_month;
 ELSE targets:='[]'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',m.id,'label',left(btrim(regexp_replace(coalesce(p.display_name,''),'[[:cntrl:]]',' ','g')),300)) ORDER BY p.display_name,m.id),'[]') INTO owners
 FROM platform.organization_memberships m JOIN platform.profiles p ON p.id=m.profile_id
 WHERE m.organization_id=p_organization_id AND platform_private.staff_can_receive_assignment(p_organization_id, m.id, 'sales.register.read', 'sales_register', NULL)
   AND platform_private.staff_can_create_for_owner(p_organization_id, actor.membership_id,
     'sales.register.manage', 'sales_register', m.id);
 RETURN jsonb_build_object('query',normalized_query,'manager_key',manager_key,'organization_id',p_organization_id,'year',p_year,'month',p_month,'offset',p_offset,
   'total_count',total,'rows',rows,'selected',selected,'has_more',p_offset+50<total,'totals',totals,
   'unresolved_cost_count',unresolved_cost,'unresolved_paid_count',unresolved_paid,'targets',targets,'manager_options',managers,'owner_options',owners,
   'withdrawn',withdrawn);
END $$;

-- ---------------------------------------------------------------------------
-- e) platform.set_sales_register_withdrawal_v1: «Убрать» / «Вернуть» from the interface
-- ---------------------------------------------------------------------------
-- p_kind partial | unpaid sets (or changes) the mark; NULL removes it («Вернуть»). The gates are
-- manage_sales_register_v2's (208 Sales Manager + sales.register.manage on this record).
CREATE FUNCTION platform.set_sales_register_withdrawal_v1(
  p_organization_id UUID, p_record_id UUID, p_expected_version BIGINT, p_kind TEXT, p_note TEXT, p_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor RECORD; old platform_private.sales_register%ROWTYPE; changed platform_private.sales_register%ROWTYPE;
 fingerprint TEXT; prior platform_private.sales_register_requests%ROWTYPE; receipt JSONB;
 note TEXT := NULLIF(btrim(p_note, E' \t\r\n'), '');
BEGIN
 PERFORM 1 FROM platform.organizations WHERE id = p_organization_id FOR KEY SHARE;
 SELECT * INTO actor FROM platform_private.sales_register_actor(p_organization_id);
 IF NOT platform_private.staff_is_sales_manager(p_organization_id, actor.membership_id) THEN
   RAISE EXCEPTION 'sales_register_forbidden' USING ERRCODE = '42501'; END IF;
 IF p_request_id IS NULL OR p_record_id IS NULL OR p_expected_version IS NULL
   OR p_expected_version < 1 OR p_expected_version > 9007199254740991
   OR (p_kind IS NOT NULL AND p_kind NOT IN ('partial', 'unpaid'))
   OR (p_kind IS NULL AND note IS NOT NULL)
   OR (note IS NOT NULL AND (char_length(note) > 500 OR note ~ '[[:cntrl:]]')) THEN
   RAISE EXCEPTION 'sales_register_invalid_command' USING ERRCODE = '22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('sales-register:' || p_organization_id::TEXT, 0));
 SELECT * INTO actor FROM platform_private.sales_register_actor(p_organization_id);
 IF NOT platform_private.staff_is_sales_manager(p_organization_id, actor.membership_id) THEN
   RAISE EXCEPTION 'sales_register_forbidden' USING ERRCODE = '42501'; END IF;
 fingerprint := md5(jsonb_build_object('command', 'withdrawal', 'actor', actor.membership_id, 'record', p_record_id,
   'version', p_expected_version, 'kind', p_kind, 'note', note)::TEXT);
 SELECT * INTO prior FROM platform_private.sales_register_requests WHERE organization_id = p_organization_id AND request_id = p_request_id;
 IF FOUND THEN
   IF prior.fingerprint <> fingerprint OR prior.actor_membership_id <> actor.membership_id THEN
     RAISE EXCEPTION 'sales_register_request_id_conflict' USING ERRCODE = '22023'; END IF;
   -- Ownership may change after a successful command; do not replay foreign details.
   IF NOT platform_private.staff_can_access(p_organization_id, actor.membership_id,
      'sales.register.manage', 'sales_register', (prior.receipt->>'record_id')::UUID) THEN
     RAISE EXCEPTION 'sales_register_forbidden' USING ERRCODE = '42501'; END IF;
   RETURN prior.receipt;
 END IF;
 SELECT * INTO old FROM platform_private.sales_register WHERE organization_id = p_organization_id AND id = p_record_id FOR UPDATE;
 IF NOT FOUND OR NOT platform_private.staff_can_access(p_organization_id, actor.membership_id,
    'sales.register.manage', 'sales_register', old.id) THEN
   RAISE EXCEPTION 'sales_register_forbidden' USING ERRCODE = '42501'; END IF;
 IF old.version <> p_expected_version THEN RAISE EXCEPTION 'sales_register_stale' USING ERRCODE = 'PT409'; END IF;
 -- A record in the archive is already outside the sales; restore it first.
 IF old.archived THEN RAISE EXCEPTION 'sales_register_archived' USING ERRCODE = '22023'; END IF;
 IF p_kind IS NULL AND old.withdrawal_kind IS NULL THEN
   RAISE EXCEPTION 'sales_register_withdrawal_missing' USING ERRCODE = '22023'; END IF;
 IF p_kind IS NOT NULL AND old.withdrawal_kind IS NOT DISTINCT FROM p_kind AND old.withdrawal_note IS NOT DISTINCT FROM note THEN
   RAISE EXCEPTION 'sales_register_withdrawal_unchanged' USING ERRCODE = '22023'; END IF;
 UPDATE platform_private.sales_register SET
   withdrawal_kind = p_kind,
   withdrawn_at = CASE WHEN p_kind IS NULL THEN NULL ELSE statement_timestamp() END,
   withdrawn_by_membership_id = CASE WHEN p_kind IS NULL THEN NULL ELSE actor.membership_id END,
   withdrawal_note = CASE WHEN p_kind IS NULL THEN NULL ELSE note END,
   version = version + 1, updated_at = now()
 WHERE id = old.id RETURNING * INTO changed;
 receipt := jsonb_build_object('organization_id', p_organization_id, 'record_id', changed.id, 'version', changed.version::TEXT,
   'operation', CASE WHEN p_kind IS NULL THEN 'withdraw_undo' ELSE 'withdraw' END, 'request_id', p_request_id);
 -- The human explanation stays private; the shared audit projection receives no free text.
 INSERT INTO platform_private.sales_register_requests VALUES (p_organization_id, p_request_id, actor.membership_id, fingerprint, receipt,
   coalesce(note, 'Sales register withdrawal'));
 INSERT INTO platform.audit_events(organization_id, actor_kind, actor_profile_id, actor_principal, action, resource_type, resource_id, before_state, after_state, reason, request_id)
 VALUES (p_organization_id, 'user', actor.profile_id, 'auth:' || actor.auth_user_id::TEXT, 'sales.register.update', 'sales_register', changed.id,
   jsonb_build_object('version', old.version::TEXT, 'archived', old.archived, 'withdrawal_kind', old.withdrawal_kind),
   jsonb_build_object('version', changed.version::TEXT, 'archived', changed.archived, 'withdrawal_kind', changed.withdrawal_kind),
   'Sales register withdrawal', p_request_id);
 RETURN receipt;
END $$;


-- ---------------------------------------------------------------------------
-- f) Service-only data fixes for the owner's report (service_role, the Admin actor)
-- ---------------------------------------------------------------------------
-- The shared gate of (a) and (b): no end-user identity, an active Admin membership holding
-- sales.register.manage (an Admin holds every non-sensitive key; the actor is the owner's Admin).
CREATE FUNCTION platform_private.sales_withdrawal_service_actor(p_organization_id UUID, p_actor_membership_id UUID)
RETURNS TABLE(profile_id UUID, membership_id UUID)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF p_organization_id IS NULL OR p_actor_membership_id IS NULL THEN
    RAISE EXCEPTION 'sales_withdrawal_service_forbidden' USING ERRCODE = '42501';
  END IF;
  -- Service path only: no end-user identity may reach it (the grants already exclude anon and authenticated).
  IF NULLIF(current_setting('request.jwt.claims', TRUE), '')::JSONB ->> 'sub' IS NOT NULL
    OR COALESCE(NULLIF(current_setting('request.jwt.claims', TRUE), '')::JSONB ->> 'role', '') IN ('anon', 'authenticated') THEN
    RAISE EXCEPTION 'sales_withdrawal_service_forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT i.profile_id, i.membership_id
    FROM platform_private.staff_membership_identity(p_organization_id, p_actor_membership_id) i
    WHERE i.system_role = 'admin'
      AND platform_private.staff_has_permission(p_organization_id, i.membership_id, 'sales.register.manage');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'sales_withdrawal_service_forbidden' USING ERRCODE = '42501';
  END IF;
END
$$;
REVOKE ALL ON FUNCTION platform_private.sales_withdrawal_service_actor(UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

-- (a) Put the refusal mark on a report row by its source key, or take it off (p_kind NULL).
CREATE FUNCTION platform.mark_sales_report_row_withdrawn_v1(
  p_organization_id UUID, p_actor_membership_id UUID, p_import_source TEXT, p_external_ref TEXT,
  p_source_key TEXT, p_kind TEXT, p_note TEXT, p_reason TEXT
) RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  c_principal CONSTANT TEXT := 'service:sales-withdrawal';
  c_namespace CONSTANT UUID := '6ba7b811-9dad-11d1-80b4-00c04fd430c8';
  v_ref TEXT := btrim(p_external_ref);
  v_reason TEXT := btrim(p_reason);
  v_note TEXT := NULLIF(btrim(p_note, E' \t\r\n'), '');
  v_actor RECORD;
  v_base UUID;
  v_hash TEXT;
  v_prior platform_private.sales_withdrawal_service_receipts%ROWTYPE;
  v_reg platform_private.sales_register%ROWTYPE;
  v_before JSONB := '{}'::JSONB;
  v_status TEXT;
  v_result JSONB;
BEGIN
  SELECT * INTO v_actor FROM platform_private.sales_withdrawal_service_actor(p_organization_id, p_actor_membership_id);
  IF p_import_source IS NULL OR p_import_source !~ '^[a-z][a-z0-9_.-]{1,63}$' THEN
    RAISE EXCEPTION 'sales_withdrawal_invalid:importSource' USING ERRCODE = '22023';
  END IF;
  IF v_ref IS NULL OR char_length(v_ref) NOT BETWEEN 1 AND 200 OR v_ref ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'sales_withdrawal_invalid:externalRef' USING ERRCODE = '22023';
  END IF;
  IF v_reason IS NULL OR char_length(v_reason) NOT BETWEEN 1 AND 500 OR v_reason ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'sales_withdrawal_invalid:reason' USING ERRCODE = '22023';
  END IF;
  IF p_source_key IS NULL OR char_length(p_source_key) NOT BETWEEN 1 AND 400 OR p_source_key ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'sales_withdrawal_invalid:sourceKey' USING ERRCODE = '22023';
  END IF;
  IF p_kind IS NOT NULL AND p_kind NOT IN ('partial', 'unpaid') THEN
    RAISE EXCEPTION 'sales_withdrawal_invalid:kind' USING ERRCODE = '22023';
  END IF;
  IF (p_kind IS NULL AND v_note IS NOT NULL)
    OR (v_note IS NOT NULL AND (char_length(v_note) > 500 OR v_note ~ '[[:cntrl:]]')) THEN
    RAISE EXCEPTION 'sales_withdrawal_invalid:note' USING ERRCODE = '22023';
  END IF;

  -- One call, one request: the same pair sent twice is the same request. The organization's
  -- sales-register lock is the one every register command takes (134, 253, 254, 304).
  v_base := public.uuid_generate_v5(c_namespace,
    'evo:sales-withdrawal:' || p_organization_id::TEXT || ':' || p_import_source || ':' || v_ref);
  v_hash := md5(jsonb_build_object('operation', 'withdraw', 'actor', p_actor_membership_id, 'sourceKey', p_source_key,
    'kind', p_kind, 'note', v_note, 'reason', v_reason)::TEXT);
  PERFORM platform_private.lock_p2d_request(v_base);
  PERFORM pg_advisory_xact_lock(hashtextextended('sales-register:' || p_organization_id::TEXT, 0));
  SELECT * INTO v_prior FROM platform_private.sales_withdrawal_service_receipts r
  WHERE r.organization_id = p_organization_id AND r.import_source = p_import_source AND r.external_ref = v_ref;
  IF FOUND THEN
    IF v_prior.payload_md5 <> v_hash OR v_prior.actor_membership_id <> v_actor.membership_id THEN
      RAISE EXCEPTION 'sales_withdrawal_request_conflict' USING ERRCODE = 'PT409';
    END IF;
    RETURN v_prior.result || jsonb_build_object('replayed', TRUE);
  END IF;

  SELECT * INTO v_reg FROM platform_private.sales_register r
  WHERE r.organization_id = p_organization_id AND r.source_key = p_source_key FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'sales_report_row_missing' USING ERRCODE = 'PT404';
  END IF;
  IF p_kind IS NOT NULL AND v_reg.archived THEN
    RAISE EXCEPTION 'sales_report_row_archived' USING ERRCODE = 'PT409';
  END IF;

  IF (p_kind IS NULL AND v_reg.withdrawal_kind IS NULL)
    OR (p_kind IS NOT NULL AND v_reg.withdrawal_kind IS NOT DISTINCT FROM p_kind AND v_reg.withdrawal_note IS NOT DISTINCT FROM v_note) THEN
    v_status := 'unchanged';
  ELSE
    v_before := jsonb_build_object('withdrawal_kind', v_reg.withdrawal_kind, 'withdrawn_at', v_reg.withdrawn_at,
      'withdrawn_by_membership_id', v_reg.withdrawn_by_membership_id, 'withdrawal_note', v_reg.withdrawal_note,
      'version', v_reg.version::TEXT);
    UPDATE platform_private.sales_register r SET
      withdrawal_kind = p_kind,
      withdrawn_at = CASE WHEN p_kind IS NULL THEN NULL ELSE statement_timestamp() END,
      withdrawn_by_membership_id = CASE WHEN p_kind IS NULL THEN NULL ELSE v_actor.membership_id END,
      withdrawal_note = CASE WHEN p_kind IS NULL THEN NULL ELSE v_note END,
      version = r.version + 1, updated_at = now()
    WHERE r.organization_id = p_organization_id AND r.id = v_reg.id
    RETURNING * INTO v_reg;
    v_status := CASE WHEN p_kind IS NULL THEN 'cleared' ELSE 'withdrawn' END;
    -- No name, phone, note or value of the row reaches the journal: ids, versions and the kind only.
    INSERT INTO platform.audit_events (organization_id, actor_kind, actor_profile_id, actor_principal, actor_membership_id,
      action, resource_type, resource_id, before_state, after_state, reason, request_id)
    VALUES (p_organization_id, 'user', v_actor.profile_id, c_principal, v_actor.membership_id, 'sales.register.update',
      'sales_register', v_reg.id,
      jsonb_build_object('version', (v_before ->> 'version'), 'archived', v_reg.archived,
        'withdrawal_kind', v_before -> 'withdrawal_kind'),
      jsonb_build_object('version', v_reg.version::TEXT, 'archived', v_reg.archived, 'withdrawal_kind', v_reg.withdrawal_kind,
        'import_source', p_import_source, 'external_ref', v_ref),
      v_reason, public.uuid_generate_v5(v_base, 'sales-withdrawal:row'));
  END IF;

  v_result := jsonb_build_object(
    'organization_id', p_organization_id,
    'operation', 'withdraw',
    'status', v_status,
    'register_id', v_reg.id,
    'register_version', v_reg.version::TEXT,
    'withdrawal_kind', v_reg.withdrawal_kind,
    'import_source', p_import_source,
    'external_ref', v_ref,
    'replayed', FALSE);
  INSERT INTO platform_private.sales_withdrawal_service_receipts (organization_id, operation, import_source, external_ref,
    actor_membership_id, payload_md5, register_id, result, before_state)
  VALUES (p_organization_id, 'withdraw', p_import_source, v_ref, v_actor.membership_id, v_hash, v_reg.id,
    v_result - 'replayed', v_before);
  RETURN v_result;
END
$$;

-- (b) Archive a report row by its source key: manage_sales_register_v2's archive (archived = true,
-- version + 1, the journal action sales.register.archive), for the one row that duplicates a pipeline sale.
CREATE FUNCTION platform.archive_sales_report_row_v1(
  p_organization_id UUID, p_actor_membership_id UUID, p_import_source TEXT, p_external_ref TEXT,
  p_source_key TEXT, p_reason TEXT
) RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  c_principal CONSTANT TEXT := 'service:sales-withdrawal';
  c_namespace CONSTANT UUID := '6ba7b811-9dad-11d1-80b4-00c04fd430c8';
  v_ref TEXT := btrim(p_external_ref);
  v_reason TEXT := btrim(p_reason);
  v_actor RECORD;
  v_base UUID;
  v_hash TEXT;
  v_prior platform_private.sales_withdrawal_service_receipts%ROWTYPE;
  v_reg platform_private.sales_register%ROWTYPE;
  v_before JSONB := '{}'::JSONB;
  v_status TEXT;
  v_result JSONB;
  v_old_version BIGINT;
BEGIN
  SELECT * INTO v_actor FROM platform_private.sales_withdrawal_service_actor(p_organization_id, p_actor_membership_id);
  IF p_import_source IS NULL OR p_import_source !~ '^[a-z][a-z0-9_.-]{1,63}$' THEN
    RAISE EXCEPTION 'sales_withdrawal_invalid:importSource' USING ERRCODE = '22023';
  END IF;
  IF v_ref IS NULL OR char_length(v_ref) NOT BETWEEN 1 AND 200 OR v_ref ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'sales_withdrawal_invalid:externalRef' USING ERRCODE = '22023';
  END IF;
  IF v_reason IS NULL OR char_length(v_reason) NOT BETWEEN 1 AND 500 OR v_reason ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'sales_withdrawal_invalid:reason' USING ERRCODE = '22023';
  END IF;
  IF p_source_key IS NULL OR char_length(p_source_key) NOT BETWEEN 1 AND 400 OR p_source_key ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'sales_withdrawal_invalid:sourceKey' USING ERRCODE = '22023';
  END IF;

  v_base := public.uuid_generate_v5(c_namespace,
    'evo:sales-withdrawal:' || p_organization_id::TEXT || ':' || p_import_source || ':' || v_ref);
  v_hash := md5(jsonb_build_object('operation', 'archive', 'actor', p_actor_membership_id, 'sourceKey', p_source_key,
    'reason', v_reason)::TEXT);
  PERFORM platform_private.lock_p2d_request(v_base);
  PERFORM pg_advisory_xact_lock(hashtextextended('sales-register:' || p_organization_id::TEXT, 0));
  SELECT * INTO v_prior FROM platform_private.sales_withdrawal_service_receipts r
  WHERE r.organization_id = p_organization_id AND r.import_source = p_import_source AND r.external_ref = v_ref;
  IF FOUND THEN
    IF v_prior.payload_md5 <> v_hash OR v_prior.actor_membership_id <> v_actor.membership_id THEN
      RAISE EXCEPTION 'sales_withdrawal_request_conflict' USING ERRCODE = 'PT409';
    END IF;
    RETURN v_prior.result || jsonb_build_object('replayed', TRUE);
  END IF;

  SELECT * INTO v_reg FROM platform_private.sales_register r
  WHERE r.organization_id = p_organization_id AND r.source_key = p_source_key FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'sales_report_row_missing' USING ERRCODE = 'PT404';
  END IF;

  IF v_reg.archived THEN
    v_status := 'unchanged';
  ELSE
    v_old_version := v_reg.version;
    v_before := jsonb_build_object('archived', FALSE, 'version', v_old_version::TEXT);
    UPDATE platform_private.sales_register r SET archived = TRUE, version = r.version + 1, updated_at = now()
    WHERE r.organization_id = p_organization_id AND r.id = v_reg.id
    RETURNING * INTO v_reg;
    v_status := 'archived';
    INSERT INTO platform.audit_events (organization_id, actor_kind, actor_profile_id, actor_principal, actor_membership_id,
      action, resource_type, resource_id, before_state, after_state, reason, request_id)
    VALUES (p_organization_id, 'user', v_actor.profile_id, c_principal, v_actor.membership_id, 'sales.register.archive',
      'sales_register', v_reg.id,
      jsonb_build_object('version', v_old_version::TEXT, 'archived', FALSE, 'paid_contract_set', v_reg.paid_contract_minor IS NOT NULL),
      jsonb_build_object('version', v_reg.version::TEXT, 'archived', TRUE, 'paid_contract_set', v_reg.paid_contract_minor IS NOT NULL,
        'import_source', p_import_source, 'external_ref', v_ref),
      v_reason, public.uuid_generate_v5(v_base, 'sales-withdrawal:archive'));
  END IF;

  v_result := jsonb_build_object(
    'organization_id', p_organization_id,
    'operation', 'archive',
    'status', v_status,
    'register_id', v_reg.id,
    'register_version', v_reg.version::TEXT,
    'import_source', p_import_source,
    'external_ref', v_ref,
    'replayed', FALSE);
  INSERT INTO platform_private.sales_withdrawal_service_receipts (organization_id, operation, import_source, external_ref,
    actor_membership_id, payload_md5, register_id, result, before_state)
  VALUES (p_organization_id, 'archive', p_import_source, v_ref, v_actor.membership_id, v_hash, v_reg.id,
    v_result - 'replayed', v_before);
  RETURN v_result;
END
$$;

-- (c) A student case on a lead the report already sold. 281's creation path with its identity step
-- replaced: the client and the lead are the given ones, nothing is created for them (the lead is
-- not touched; 287 may complete and close the case afterwards, its receipt has an import source).
CREATE FUNCTION platform_private.create_sales_report_student_case(
  p_organization_id UUID,
  p_actor_membership_id UUID,
  p_request_id UUID,
  p_lead_id UUID,
  p_payload JSONB,
  p_reason TEXT,
  p_import_source TEXT,
  p_external_ref TEXT
) RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  today DATE := (statement_timestamp() AT TIME ZONE 'Asia/Bishkek')::DATE;
  stages CONSTANT TEXT[] := ARRAY['new', 'shortlist', 'documents', 'ready_to_submit', 'awaiting_decision',
    'confirmed', 'visa', 'predeparture', 'arrived'];
  currencies CONSTANT TEXT[] := ARRAY['USD', 'EUR', 'KGS'];
  actor RECORD;
  prior platform_private.admissions_direct_case_receipts%ROWTYPE;
  request_fingerprint TEXT;
  principal CONSTANT TEXT := 'service:sales-report-case';
  payload JSONB; student JSONB; parent JSONB; route JSONB; education JSONB; money JSONB; cost JSONB;
  payment JSONB; payments JSONB := '[]'::JSONB;
  student_name TEXT; first_name TEXT; last_name TEXT; phone_raw TEXT; email_raw TEXT;
  phone_norm TEXT; email_norm TEXT; birth_date DATE; age_years INTEGER; age_raw TEXT;
  parent_relation TEXT; parent_first TEXT; parent_last TEXT; parent_phone TEXT; parent_phone_norm TEXT;
  country_code TEXT; direction TEXT; degree_text TEXT; program_text TEXT; intake_text TEXT;
  education_current TEXT; english_text TEXT; chinese_text TEXT;
  curator UUID; curator_raw TEXT; stage TEXT; note_text TEXT; note_body TEXT;
  cost_minor BIGINT; cost_currency TEXT; signed_on DATE;
  paid_same BIGINT := 0;
  lead_row platform.leads%ROWTYPE; client_row platform.clients%ROWTYPE;
  client_id_value UUID; client_reused BOOLEAN := FALSE;
  lead_id_value UUID;
  existing_case_id UUID;
  field_value TEXT; profile_values JSONB := '[]'::JSONB;
  case_id UUID := gen_random_uuid();
  scope_id UUID := gen_random_uuid();
  profile_id_value UUID;
  obligation_id UUID; obligation_currency TEXT; obligation_amount BIGINT;
  obligation_ids JSONB := '[]'::JSONB; event_ids JSONB := '[]'::JSONB;
  event_id UUID; event_request UUID; i INTEGER := 0; t INTEGER := 0;
  field RECORD;
  changed platform.student_cases%ROWTYPE;
  result JSONB;
BEGIN
  IF p_organization_id IS NULL OR p_actor_membership_id IS NULL OR p_lead_id IS NULL
    OR p_import_source IS NULL OR p_external_ref IS NULL THEN
    RAISE EXCEPTION 'sales_report_case_forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_reason IS NULL OR char_length(btrim(p_reason)) NOT BETWEEN 1 AND 500 OR btrim(p_reason) ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'sales_report_case_invalid:reason' USING ERRCODE = '22023';
  END IF;
  PERFORM platform_private.lock_p2d_request(p_request_id);
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' OR pg_column_size(p_payload) > 40000 THEN
    RAISE EXCEPTION 'sales_report_case_invalid:payload' USING ERRCODE = '22023';
  END IF;

  -- The actor first: the owner's Admin membership (as 287), holding the permission 281 checks.
  SELECT * INTO actor FROM platform_private.staff_membership_identity(p_organization_id, p_actor_membership_id);
  IF NOT FOUND OR actor.system_role IS DISTINCT FROM 'admin'
    OR NOT platform_private.staff_has_permission(p_organization_id, actor.membership_id, 'case.create.direct') THEN
    RAISE EXCEPTION 'sales_report_case_forbidden' USING ERRCODE = '42501';
  END IF;

  request_fingerprint := md5(jsonb_build_object('payload', p_payload, 'leadId', p_lead_id, 'importSource', p_import_source,
    'externalRef', p_external_ref, 'reason', btrim(p_reason))::TEXT);
  SELECT * INTO prior FROM platform_private.admissions_direct_case_receipts r WHERE r.request_id = p_request_id;
  IF FOUND THEN
    IF prior.organization_id <> p_organization_id OR prior.actor_membership_id <> p_actor_membership_id
      OR prior.fingerprint <> request_fingerprint THEN
      RAISE EXCEPTION 'sales_report_case_conflict' USING ERRCODE = 'PT409';
    END IF;
    RETURN prior.receipt || jsonb_build_object('replayed', TRUE);
  END IF;

  -- ---- the sold lead: this organization, from the sales report, already a client ----------
  -- The lead row is locked: two calls for one lead serialize, and 088's one-open-case-per-lead
  -- index and the case source key are the database's last word.
  SELECT * INTO lead_row FROM platform.leads l
  WHERE l.organization_id = p_organization_id AND l.id = p_lead_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'sales_report_case_lead_missing' USING ERRCODE = 'PT404';
  END IF;
  SELECT * INTO client_row FROM platform.clients cl
  WHERE cl.organization_id = p_organization_id AND cl.id = lead_row.client_id;
  IF NOT FOUND OR lead_row.source_key IS DISTINCT FROM 'sales_report' OR lead_row.lifecycle_state::TEXT <> 'converted'
    OR client_row.lifecycle_state::TEXT <> 'active' THEN
    RAISE EXCEPTION 'sales_report_case_invalid_lead' USING ERRCODE = '22023';
  END IF;
  client_id_value := client_row.id;
  lead_id_value := lead_row.id;
  -- A case of this lead, or an open case of the same person: nothing is created, the report says where it is.
  SELECT sc.id INTO existing_case_id
  FROM platform.student_cases sc
  WHERE sc.organization_id = p_organization_id
    AND (sc.canonical_lead_id = lead_id_value
      OR (sc.state IN ('pending', 'active')
        AND (sc.canonical_client_id = client_id_value
          OR sc.canonical_lead_id IN (SELECT l.id FROM platform.leads l
            WHERE l.organization_id = p_organization_id AND l.client_id = client_id_value))))
  ORDER BY (sc.canonical_lead_id = lead_id_value) DESC, sc.created_at, sc.id LIMIT 1;
  IF existing_case_id IS NOT NULL THEN
    RETURN jsonb_build_object('organization_id', p_organization_id, 'status', 'case_exists',
      'student_case_id', existing_case_id, 'lead_id', lead_id_value, 'client_id', client_id_value,
      'import_source', p_import_source, 'external_ref', p_external_ref, 'replayed', FALSE);
  END IF;
  -- The client is shared when it has other leads: 287 then leaves its contacts alone.
  client_reused := EXISTS (SELECT 1 FROM platform.leads l
    WHERE l.organization_id = p_organization_id AND l.client_id = client_id_value AND l.id <> lead_id_value);

  -- ---- payload ----------------------------------------------------------------
  payload := platform_private.admissions_direct_object(p_payload, 'payload',
    ARRAY['student', 'parent', 'route', 'education', 'curatorMembershipId', 'pipelineStage', 'money', 'note']);
  student := platform_private.admissions_direct_object(payload -> 'student', 'student',
    ARRAY['name', 'firstName', 'lastName', 'phone', 'email', 'birthDate', 'age']);
  parent := platform_private.admissions_direct_object(payload -> 'parent', 'parent',
    ARRAY['relation', 'firstName', 'lastName', 'phone']);
  route := platform_private.admissions_direct_object(payload -> 'route', 'route',
    ARRAY['country', 'degree', 'program', 'intake']);
  education := platform_private.admissions_direct_object(payload -> 'education', 'education',
    ARRAY['current', 'english', 'chinese']);
  money := platform_private.admissions_direct_object(payload -> 'money', 'money',
    ARRAY['cost', 'signedOn', 'payments']);

  first_name := platform_private.admissions_direct_text(student, 'firstName', 60);
  last_name := platform_private.admissions_direct_text(student, 'lastName', 60);
  student_name := COALESCE(platform_private.admissions_direct_text(student, 'name', 200),
    NULLIF(btrim(concat_ws(' ', first_name, last_name)), ''),
    NULLIF(btrim(client_row.display_name), ''));
  IF student_name IS NULL THEN RAISE EXCEPTION 'sales_report_case_invalid:name' USING ERRCODE = '22023'; END IF;
  -- One form for every phone (admissions_direct_phone): the анкета stores the same number
  -- as every other intake. The client row is never rewritten here (287 does that, by its rules).
  phone_raw := platform_private.admissions_direct_text(student, 'phone', 40);
  IF phone_raw IS NOT NULL THEN
    phone_norm := platform_private.admissions_direct_phone(phone_raw);
    IF phone_norm IS NULL THEN
      RAISE EXCEPTION 'sales_report_case_invalid:phone' USING ERRCODE = '22023';
    END IF;
  END IF;
  email_raw := platform_private.admissions_direct_text(student, 'email', 120);
  IF email_raw IS NOT NULL THEN
    email_norm := platform_private.normalize_person_email(email_raw);
    IF email_norm IS NULL OR email_norm !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
      RAISE EXCEPTION 'sales_report_case_invalid:email' USING ERRCODE = '22023';
    END IF;
  END IF;
  birth_date := platform_private.admissions_direct_date(student, 'birthDate', DATE '1940-01-01', today, 'birthDate');
  IF student ? 'age' AND jsonb_typeof(student -> 'age') <> 'null' THEN
    age_raw := student ->> 'age';
    IF jsonb_typeof(student -> 'age') NOT IN ('number', 'string') OR age_raw !~ '^[0-9]{1,2}$'
      OR age_raw::INTEGER NOT BETWEEN 5 AND 99 THEN
      RAISE EXCEPTION 'sales_report_case_invalid:age' USING ERRCODE = '22023';
    END IF;
    age_years := age_raw::INTEGER;
  END IF;

  IF parent IS NOT NULL THEN
    parent_relation := platform_private.admissions_direct_text(parent, 'relation', 10);
    parent_first := platform_private.admissions_direct_text(parent, 'firstName', 60);
    parent_last := platform_private.admissions_direct_text(parent, 'lastName', 60);
    parent_phone := platform_private.admissions_direct_text(parent, 'phone', 40);
    IF parent_phone IS NOT NULL THEN
      parent_phone_norm := platform_private.admissions_direct_phone(parent_phone);
      IF parent_phone_norm IS NULL THEN
        RAISE EXCEPTION 'sales_report_case_invalid:parentPhone' USING ERRCODE = '22023';
      END IF;
    END IF;
    IF (parent_first IS NOT NULL OR parent_last IS NOT NULL OR parent_phone IS NOT NULL)
      AND parent_relation IS DISTINCT FROM 'mother' AND parent_relation IS DISTINCT FROM 'father' THEN
      RAISE EXCEPTION 'sales_report_case_invalid:relation' USING ERRCODE = '22023';
    END IF;
  END IF;

  country_code := platform_private.admissions_direct_text(route, 'country', 2);
  IF country_code IS NOT NULL AND country_code !~ '^[A-Z]{2}$' THEN
    RAISE EXCEPTION 'sales_report_case_invalid:country' USING ERRCODE = '22023';
  END IF;
  direction := platform_private.student_application_direction(country_code);
  degree_text := platform_private.admissions_direct_text(route, 'degree', 60);
  program_text := platform_private.admissions_direct_text(route, 'program', 100);
  intake_text := platform_private.admissions_direct_text(route, 'intake', 30);
  education_current := platform_private.admissions_direct_text(education, 'current', 100);
  english_text := platform_private.admissions_direct_text(education, 'english', 60);
  chinese_text := platform_private.admissions_direct_text(education, 'chinese', 40);

  curator_raw := platform_private.admissions_direct_text(payload, 'curatorMembershipId', 36);
  IF curator_raw IS NOT NULL THEN
    IF curator_raw !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION 'sales_report_case_invalid:curator' USING ERRCODE = '22023';
    END IF;
    curator := curator_raw::UUID;
  END IF;
  stage := COALESCE(platform_private.admissions_direct_text(payload, 'pipelineStage', 40), 'new');
  IF NOT (stage = ANY (stages)) THEN
    RAISE EXCEPTION 'sales_report_case_invalid:pipelineStage' USING ERRCODE = '22023';
  END IF;
  note_text := platform_private.admissions_direct_text(payload, 'note', 3500, TRUE);

  IF money IS NOT NULL THEN
    cost := platform_private.admissions_direct_object(money -> 'cost', 'cost', ARRAY['amountMinor', 'currency']);
    IF cost IS NOT NULL THEN
      cost_minor := platform_private.admissions_direct_minor(cost, 'amountMinor', 'cost');
      cost_currency := platform_private.admissions_direct_text(cost, 'currency', 3);
      IF cost_currency IS NULL OR NOT (cost_currency = ANY (currencies)) THEN
        RAISE EXCEPTION 'sales_report_case_invalid:costCurrency' USING ERRCODE = '22023';
      END IF;
    END IF;
    -- The contract of a student added with its money is already signed: a
    -- signing day after today (Bishkek) is a typo, as a payment day would be.
    -- A payment before the signing day stays valid (an advance).
    signed_on := platform_private.admissions_direct_date(money, 'signedOn', DATE '2000-01-01', today, 'signedOn');
    IF money ? 'payments' AND jsonb_typeof(money -> 'payments') <> 'null' THEN
      IF jsonb_typeof(money -> 'payments') <> 'array' OR jsonb_array_length(money -> 'payments') > 20 THEN
        RAISE EXCEPTION 'sales_report_case_invalid:payments' USING ERRCODE = '22023';
      END IF;
      FOR payment IN SELECT value FROM jsonb_array_elements(money -> 'payments') LOOP
        payment := platform_private.admissions_direct_object(payment, 'payment', ARRAY['amountMinor', 'currency', 'paidOn']);
        IF payment IS NULL THEN RAISE EXCEPTION 'sales_report_case_invalid:payment' USING ERRCODE = '22023'; END IF;
        -- Received money is paid on a past day or today (Bishkek), never later.
        IF platform_private.admissions_direct_text(payment, 'currency', 3) IS NULL
          OR NOT (platform_private.admissions_direct_text(payment, 'currency', 3) = ANY (currencies))
          OR platform_private.admissions_direct_date(payment, 'paidOn', DATE '2000-01-01', today, 'paidOn') IS NULL THEN
          RAISE EXCEPTION 'sales_report_case_invalid:payment' USING ERRCODE = '22023';
        END IF;
        payments := payments || jsonb_build_array(jsonb_build_object(
          'amountMinor', platform_private.admissions_direct_minor(payment, 'amountMinor', 'payment'),
          'currency', platform_private.admissions_direct_text(payment, 'currency', 3),
          'paidOn', platform_private.admissions_direct_date(payment, 'paidOn', DATE '2000-01-01', today, 'paidOn')));
      END LOOP;
    END IF;
    IF cost_minor IS NOT NULL THEN
      SELECT COALESCE(sum((p ->> 'amountMinor')::BIGINT), 0) INTO paid_same
      FROM jsonb_array_elements(payments) p WHERE p ->> 'currency' = cost_currency;
      IF paid_same > cost_minor THEN
        RAISE EXCEPTION 'sales_report_case_invalid:paymentsExceedCost' USING ERRCODE = '22023';
      END IF;
    END IF;
  END IF;

  -- ---- анкета values, in the form the анкета itself stores ----------------------------
  -- Every value passes normalize_student_profile_field_value (the rule of
  -- every анкета write): phones in the E.164 form above, e-mail in lower
  -- case. The intake («набор», free text such as «сентябрь 2027») is not the
  -- date field desired_start_date; it stays on student_cases.intake. date_of_birth is a
  -- canonical column (student_profiles.date_of_birth): its field row has no value.
  FOR field IN SELECT * FROM (VALUES
    ('student_first_name', first_name, 'firstName'), ('student_last_name', last_name, 'lastName'),
    ('mobile_phone', phone_norm, 'phone'), ('student_email', email_raw, 'email'),
    ('current_study_status', education_current, 'current'), ('english_level', english_text, 'english'),
    ('chinese_level_hsk', chinese_text, 'chinese'),
    ('program_level', degree_text, 'degree'), ('field_major', program_text, 'program'),
    (parent_relation || '_first_name', parent_first, 'parentFirstName'),
    (parent_relation || '_last_name', parent_last, 'parentLastName'),
    (parent_relation || '_mobile_phone', parent_phone_norm, 'parentPhone')
  ) AS fields(key, value, label)
  WHERE fields.key IS NOT NULL AND fields.value IS NOT NULL LOOP
    BEGIN
      field_value := platform_private.normalize_student_profile_field_value(field.key, field.value);
    EXCEPTION WHEN invalid_parameter_value THEN
      RAISE EXCEPTION 'sales_report_case_invalid:%', field.label USING ERRCODE = '22023';
    END;
    profile_values := profile_values || jsonb_build_array(jsonb_build_object('key', field.key, 'value', field_value));
  END LOOP;
  IF birth_date IS NOT NULL THEN
    profile_values := profile_values || jsonb_build_array(jsonb_build_object('key', 'date_of_birth', 'value', NULL));
  END IF;

  -- ---- scoped authority ------------------------------------------------------------
  -- The future owner of the case: its curator, or the author while it waits
  -- for one. Own scope admits only oneself; another curator, or none, also
  -- needs case.curator.assign in the same scope. The actor holds the
  -- permission (checked above): a refusal here is about the chosen curator.
  IF NOT platform_private.admissions_direct_actor_may_name(p_organization_id, actor.membership_id, curator, direction) THEN
    RAISE EXCEPTION 'sales_report_case_curator_forbidden' USING ERRCODE = '42501';
  END IF;
  IF curator IS NOT NULL AND (
      NOT EXISTS (SELECT 1 FROM platform_private.staff_membership_identity(p_organization_id, curator))
      OR NOT platform_private.is_eligible_staff_responsibility(p_organization_id, curator, 'curator')) THEN
    RAISE EXCEPTION 'sales_report_case_invalid:curator' USING ERRCODE = '22023';
  END IF;

  -- ---- case ------------------------------------------------------------------------
  INSERT INTO platform.record_scopes (id, organization_id, scope_kind, scope_key, scope_version)
    VALUES (scope_id, p_organization_id, 'student_case', case_id, 1);
  INSERT INTO platform.student_cases (id, organization_id, source_key, student_display_name, target_country,
    target_degree, program_direction, intake, language_assumption, operational_stage, state, current_scope_id,
    current_scope_version, canonical_client_id, canonical_lead_id, admissions_direction, pipeline_stage)
  VALUES (case_id, p_organization_id, 'admissions-direct:' || lead_id_value::TEXT, student_name, country_code,
    degree_text, program_text, intake_text,
    NULLIF(concat_ws('; ', english_text, chinese_text), ''),
    'intake', 'pending', scope_id, 1, client_id_value, lead_id_value, direction, stage);
  IF curator IS NOT NULL THEN
    PERFORM platform_private.assign_student_case_curator_authorized_e1(p_organization_id, case_id, curator,
      btrim(p_reason), public.uuid_generate_v5(p_request_id, 'sales-report-case:assign'),
      actor.profile_id, actor.membership_id, actor.auth_user_id);
  END IF;

  -- ---- student profile (анкета) ----------------------------------------------------------
  INSERT INTO platform.student_profiles (organization_id, student_case_id, revision, preferred_display_name,
    date_of_birth, current_education_summary, language_summary, decision_participant_labels, consent_status,
    created_by_membership_id, updated_by_membership_id)
  VALUES (p_organization_id, case_id, 1, left(student_name, 200), birth_date, education_current,
    NULLIF(concat_ws('; ', english_text, chinese_text), ''), ARRAY[]::TEXT[], 'not_recorded',
    actor.membership_id, actor.membership_id)
  RETURNING id INTO profile_id_value;
  INSERT INTO platform.student_profile_fields (organization_id, student_case_id, student_profile_id, field_key,
    value, review_state, profile_revision)
  SELECT p_organization_id, case_id, profile_id_value, f ->> 'key', f ->> 'value', 'needs_review', 1
  FROM jsonb_array_elements(profile_values) f;

  -- ---- first case note: age without a birth date, and the free note ----------------
  note_body := NULLIF(concat_ws(E'\n\n',
    CASE WHEN age_years IS NOT NULL AND birth_date IS NULL
      THEN 'Возраст: ' || age_years::TEXT || ' (на ' || to_char(today, 'DD.MM.YYYY') || ')' END,
    note_text), '');
  IF note_body IS NOT NULL THEN
    INSERT INTO platform.case_notes (organization_id, student_case_id, body, created_by_membership_id)
    VALUES (p_organization_id, case_id, note_body, actor.membership_id);
  END IF;

  -- ---- money: contract cost, tranches and the payments already received ------------
  IF cost_minor IS NOT NULL OR signed_on IS NOT NULL THEN
    -- The lead already carries its conditions: they are not overwritten from a payload.
    IF EXISTS (SELECT 1 FROM platform_private.lead_sale_conditions c
        WHERE c.organization_id = p_organization_id AND c.lead_id = lead_id_value) THEN
      RAISE EXCEPTION 'sales_report_case_invalid:conditionsExist' USING ERRCODE = '22023';
    END IF;
    INSERT INTO platform_private.lead_sale_conditions (lead_id, organization_id, fields, revision, updated_by_membership_id)
    VALUES (lead_id_value, p_organization_id, platform_private.lead_sale_condition_fields(jsonb_strip_nulls(jsonb_build_object(
      'service_cost_minor', cost_minor::TEXT, 'service_cost_currency', cost_currency,
      'signing_date', to_char(signed_on, 'YYYY-MM-DD')))), 1, actor.membership_id);
  END IF;
  -- One tranche for the contract cost; one fully paid tranche per other currency.
  FOR obligation_currency, obligation_amount IN
    SELECT x.currency, x.amount FROM (
      SELECT cost_currency AS currency, cost_minor AS amount, 0 AS ord WHERE cost_minor IS NOT NULL
      UNION ALL
      SELECT p ->> 'currency', sum((p ->> 'amountMinor')::BIGINT), 1
      FROM jsonb_array_elements(payments) p
      WHERE cost_minor IS NULL OR p ->> 'currency' <> cost_currency
      GROUP BY p ->> 'currency'
    ) x ORDER BY x.ord, x.currency
  LOOP
    t := t + 1;
    obligation_id := gen_random_uuid();
    INSERT INTO platform.payment_obligations (id, organization_id, student_case_id, label, category, amount_minor,
      currency, due_at, next_action, created_by_membership_id)
    VALUES (obligation_id, p_organization_id, case_id,
      CASE WHEN cost_minor IS NOT NULL AND obligation_currency = cost_currency THEN 'Оплата по договору'
        ELSE 'Получено в ' || obligation_currency END,
      'evo_service_fee', obligation_amount, obligation_currency, NULL, NULL, actor.membership_id);
    obligation_ids := obligation_ids || to_jsonb(obligation_id);
    INSERT INTO platform.audit_events (organization_id, actor_kind, actor_profile_id, actor_principal,
      actor_membership_id, action, resource_type, resource_id, after_state, reason, request_id)
    VALUES (p_organization_id, 'user', actor.profile_id, principal, actor.membership_id, 'case.tranche.save',
      'payment_obligation', obligation_id, jsonb_build_object('organization_id', p_organization_id,
        'student_case_id', case_id, 'payment_obligation_id', obligation_id, 'amount_minor', obligation_amount,
        'currency', obligation_currency), btrim(p_reason),
      public.uuid_generate_v5(p_request_id, 'sales-report-case:tranche:' || t::TEXT));
    i := 0;
    FOR payment IN SELECT p FROM jsonb_array_elements(payments) WITH ORDINALITY AS e(p, n)
      WHERE e.p ->> 'currency' = obligation_currency ORDER BY e.n LOOP
      i := i + 1;
      event_id := gen_random_uuid();
      event_request := public.uuid_generate_v5(p_request_id, 'sales-report-case:payment:' || obligation_currency || ':' || i::TEXT);
      INSERT INTO platform.payment_events (id, organization_id, student_case_id, payment_obligation_id, event_type,
        referenced_payment_event_id, amount_minor, currency, occurred_at, source_key, actor_membership_id, request_id)
      VALUES (event_id, p_organization_id, case_id, obligation_id, 'payment', NULL, (payment ->> 'amountMinor')::BIGINT,
        obligation_currency, ((payment ->> 'paidOn')::DATE)::TIMESTAMP AT TIME ZONE 'Asia/Bishkek', 'admissions_direct',
        actor.membership_id, event_request);
      INSERT INTO platform.payment_evidence (organization_id, student_case_id, payment_obligation_id, payment_event_id,
        evidence_ref, recorded_by_membership_id)
      VALUES (p_organization_id, case_id, obligation_id, event_id, 'sales-report-case:' || event_id::TEXT, actor.membership_id);
      UPDATE platform.payment_obligations o SET total_paid_minor = o.total_paid_minor + (payment ->> 'amountMinor')::BIGINT
      WHERE o.organization_id = p_organization_id AND o.id = obligation_id;
      event_ids := event_ids || to_jsonb(event_id);
      INSERT INTO platform.audit_events (organization_id, actor_kind, actor_profile_id, actor_principal,
        actor_membership_id, action, resource_type, resource_id, after_state, reason, request_id)
      VALUES (p_organization_id, 'user', actor.profile_id, principal, actor.membership_id, 'finance.payment.record',
        'payment_event', event_id, jsonb_build_object('organization_id', p_organization_id, 'student_case_id', case_id,
          'payment_obligation_id', obligation_id, 'amount_minor', (payment ->> 'amountMinor')::BIGINT,
          'currency', obligation_currency, 'occurred_on', payment ->> 'paidOn', 'payment_event_id', event_id),
        btrim(p_reason), event_request);
    END LOOP;
  END LOOP;

  -- ---- receipt and journal -------------------------------------------------------------
  SELECT * INTO changed FROM platform.student_cases sc WHERE sc.organization_id = p_organization_id AND sc.id = case_id;
  result := jsonb_build_object(
    'organization_id', p_organization_id,
    'status', 'created',
    'student_case_id', case_id,
    'client_id', client_id_value,
    'lead_id', lead_id_value,
    'client_reused', client_reused,
    'state', changed.state::TEXT,
    'curator_membership_id', changed.current_curator_membership_id,
    'pipeline_stage', changed.pipeline_stage,
    'payment_obligation_ids', obligation_ids,
    'payment_event_ids', event_ids,
    'replayed', FALSE);
  INSERT INTO platform_private.admissions_direct_case_receipts (request_id, organization_id, actor_membership_id,
    fingerprint, import_source, external_ref, student_case_id, client_id, lead_id, receipt)
  VALUES (p_request_id, p_organization_id, actor.membership_id, request_fingerprint, p_import_source, p_external_ref,
    case_id, client_id_value, lead_id_value, result);
  INSERT INTO platform.audit_events (organization_id, actor_kind, actor_profile_id, actor_principal, actor_membership_id,
    action, resource_type, resource_id, after_state, reason, request_id)
  VALUES (p_organization_id, 'user', actor.profile_id, principal, actor.membership_id, 'case.create', 'student_case',
    case_id, result || jsonb_build_object('origin', 'sales_report', 'import_source', p_import_source,
      'external_ref', p_external_ref), btrim(p_reason), p_request_id);
  RETURN result;
END
$$;
REVOKE ALL ON FUNCTION platform_private.create_sales_report_student_case(UUID, UUID, UUID, UUID, JSONB, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
COMMENT ON FUNCTION platform_private.create_sales_report_student_case(UUID, UUID, UUID, UUID, JSONB, TEXT, TEXT, TEXT) IS
  'Migration 307: 281''s creation path for a lead the sales report already sold (source sales_report, converted): case, profile, money and journal for an explicit Admin actor; no client, no lead. Caller: create_sales_report_student_case_v1.';

CREATE FUNCTION platform.create_sales_report_student_case_v1(
  p_organization_id UUID, p_actor_membership_id UUID, p_import_source TEXT, p_external_ref TEXT,
  p_lead_id UUID, p_payload JSONB, p_reason TEXT
) RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE ref TEXT := btrim(p_external_ref);
BEGIN
  -- Service path only: no end-user identity may reach it (the grants already exclude anon and authenticated).
  IF NULLIF(current_setting('request.jwt.claims', TRUE), '')::JSONB ->> 'sub' IS NOT NULL
    OR COALESCE(NULLIF(current_setting('request.jwt.claims', TRUE), '')::JSONB ->> 'role', '') IN ('anon', 'authenticated') THEN
    RAISE EXCEPTION 'sales_report_case_forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_import_source IS NULL OR p_import_source !~ '^[a-z][a-z0-9_.-]{1,63}$' THEN
    RAISE EXCEPTION 'sales_report_case_invalid:importSource' USING ERRCODE = '22023';
  END IF;
  IF ref IS NULL OR char_length(ref) NOT BETWEEN 1 AND 200 OR ref ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'sales_report_case_invalid:externalRef' USING ERRCODE = '22023';
  END IF;
  -- The request id is derived from the external reference: the same row sent twice is the same request.
  RETURN platform_private.create_sales_report_student_case(p_organization_id, p_actor_membership_id,
    public.uuid_generate_v5('6ba7b811-9dad-11d1-80b4-00c04fd430c8'::UUID,
      'evo:sales-report-case:' || p_organization_id::TEXT || ':' || p_import_source || ':' || ref),
    p_lead_id, p_payload, p_reason, p_import_source, ref);
END
$$;

-- ---------------------------------------------------------------------------
-- g) «Продажа» without a refusal: the 247 definition and what is reconciled with it
-- ---------------------------------------------------------------------------
-- staff_sales_count_v1: non-archived records with a sale date in the period, and now not refused.
SELECT pg_temp.a307_replace('platform.staff_sales_count_v1(uuid,date,date)',
  $old$WHERE r.organization_id = p_organization_id AND NOT r.archived$old$,
  $new$WHERE r.organization_id = p_organization_id AND NOT r.archived AND r.withdrawal_kind IS NULL$new$, 1);
-- marketing_cohort: «Договор лида» is a record of the lead that was not refused (by lead_id first, then by link).
SELECT pg_temp.a307_replace('platform_private.marketing_cohort(uuid,date,date)',
  $old$AND NOT r.archived AND r.lead_id IN (SELECT cc.id FROM cohort cc)
      UNION ALL$old$,
  $new$AND NOT r.archived AND r.withdrawal_kind IS NULL AND r.lead_id IN (SELECT cc.id FROM cohort cc)
      UNION ALL$new$, 1);
SELECT pg_temp.a307_replace('platform_private.marketing_cohort(uuid,date,date)',
  $old$AND NOT r.archived AND r.linked_lead_id IN (SELECT cc.id FROM cohort cc)$old$,
  $new$AND NOT r.archived AND r.withdrawal_kind IS NULL AND r.linked_lead_id IN (SELECT cc.id FROM cohort cc)$new$, 1);
-- marketing_overview_v1: the sales of the period it reconciles with staff_sales_count_v1.
SELECT pg_temp.a307_replace('platform.marketing_overview_v1(date,date)',
  $old$WHERE r.organization_id=actor.organization_id AND NOT r.archived$old$,
  $new$WHERE r.organization_id=actor.organization_id AND NOT r.archived AND r.withdrawal_kind IS NULL$new$, 1);

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION
  platform.read_sales_register_v5(UUID, INTEGER, INTEGER, INTEGER, UUID, BOOLEAN, TEXT, TEXT, BOOLEAN, TEXT, TEXT),
  platform.set_sales_register_withdrawal_v1(UUID, UUID, BIGINT, TEXT, TEXT, UUID),
  platform.mark_sales_report_row_withdrawn_v1(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT),
  platform.archive_sales_report_row_v1(UUID, UUID, TEXT, TEXT, TEXT, TEXT),
  platform.create_sales_report_student_case_v1(UUID, UUID, TEXT, TEXT, UUID, JSONB, TEXT)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION
  platform.read_sales_register_v5(UUID, INTEGER, INTEGER, INTEGER, UUID, BOOLEAN, TEXT, TEXT, BOOLEAN, TEXT, TEXT),
  platform.set_sales_register_withdrawal_v1(UUID, UUID, BIGINT, TEXT, TEXT, UUID)
  TO authenticated;
GRANT EXECUTE ON FUNCTION
  platform.mark_sales_report_row_withdrawn_v1(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT),
  platform.archive_sales_report_row_v1(UUID, UUID, TEXT, TEXT, TEXT, TEXT),
  platform.create_sales_report_student_case_v1(UUID, UUID, TEXT, TEXT, UUID, JSONB, TEXT)
  TO service_role;

COMMENT ON FUNCTION platform_private.sales_register_row_v3(platform_private.sales_register) IS
  'Report row v3 (307): row v2 + withdrawal (null or {kind, at, by, note}).';
COMMENT ON FUNCTION platform.read_sales_register_v5(UUID, INTEGER, INTEGER, INTEGER, UUID, BOOLEAN, TEXT, TEXT, BOOLEAN, TEXT, TEXT) IS
  'read_sales_register_v4 (253) with row v3 (the refusal mark). Refusals stay in the rows but not in the sums or the unresolved counts; withdrawn = {count, paid per currency}. The sale slices hold no refusals.';
COMMENT ON FUNCTION platform.set_sales_register_withdrawal_v1(UUID, UUID, BIGINT, TEXT, TEXT, UUID) IS
  '«Убрать» / «Вернуть» (307): set (partial | unpaid) or remove (kind NULL) the refusal mark of a report row. manage_sales_register_v2''s gates (208 Sales Manager + sales.register.manage on the record); optimistic version, request-id replay, journal sales.register.update.';
COMMENT ON FUNCTION platform.mark_sales_report_row_withdrawn_v1(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) IS
  'Migration 307: service-only refusal mark of a report row by its source key (kind NULL removes it), attributed to the owner''s Admin membership. Idempotent by (organization, import source, external reference).';
COMMENT ON FUNCTION platform.archive_sales_report_row_v1(UUID, UUID, TEXT, TEXT, TEXT, TEXT) IS
  'Migration 307: service-only archive of a report row by its source key (manage_sales_register_v2''s archive), attributed to the owner''s Admin membership. Idempotent by (organization, import source, external reference).';
COMMENT ON FUNCTION platform.create_sales_report_student_case_v1(UUID, UUID, TEXT, TEXT, UUID, JSONB, TEXT) IS
  'Migration 307: service-only student case on a lead the sales report sold (source sales_report, converted), 281''s payload, no new client or lead; a lead or a person with a case is reported as case_exists. Receipt in admissions_direct_case_receipts with an import source, so 287 can complete and close the case.';

-- ---------------------------------------------------------------------------
-- Self-check: definer, empty search_path, the right grants; released functions untouched.
-- ---------------------------------------------------------------------------
DO $a307_verify$
DECLARE routine RECORD;
BEGIN
  FOR routine IN SELECT p.oid::REGPROCEDURE AS signature, p.prosecdef, p.proconfig
    FROM pg_catalog.pg_proc AS p
    WHERE p.oid IN (
      'platform_private.sales_register_row_v3(platform_private.sales_register)'::regprocedure,
      'platform_private.sales_withdrawal_service_actor(uuid,uuid)'::regprocedure,
      'platform_private.create_sales_report_student_case(uuid,uuid,uuid,uuid,jsonb,text,text,text)'::regprocedure,
      'platform.read_sales_register_v5(uuid,integer,integer,integer,uuid,boolean,text,text,boolean,text,text)'::regprocedure,
      'platform.set_sales_register_withdrawal_v1(uuid,uuid,bigint,text,text,uuid)'::regprocedure,
      'platform.mark_sales_report_row_withdrawn_v1(uuid,uuid,text,text,text,text,text,text)'::regprocedure,
      'platform.archive_sales_report_row_v1(uuid,uuid,text,text,text,text)'::regprocedure,
      'platform.create_sales_report_student_case_v1(uuid,uuid,text,text,uuid,jsonb,text)'::regprocedure)
  LOOP
    IF routine.proconfig IS DISTINCT FROM ARRAY['search_path=""']
      OR has_function_privilege('anon', routine.signature, 'EXECUTE')
      OR has_function_privilege('supabase_auth_admin', routine.signature, 'EXECUTE')
      OR (routine.signature::TEXT LIKE 'platform_private.%'
        AND (has_function_privilege('authenticated', routine.signature, 'EXECUTE')
          OR has_function_privilege('service_role', routine.signature, 'EXECUTE')))
      OR (routine.signature::TEXT LIKE 'platform.%' AND NOT routine.prosecdef)
    THEN
      RAISE EXCEPTION 'a307_verification_failed: %', routine.signature;
    END IF;
  END LOOP;
  IF NOT has_function_privilege('authenticated', 'platform.read_sales_register_v5(uuid,integer,integer,integer,uuid,boolean,text,text,boolean,text,text)', 'EXECUTE')
    OR NOT has_function_privilege('authenticated', 'platform.set_sales_register_withdrawal_v1(uuid,uuid,bigint,text,text,uuid)', 'EXECUTE')
    OR has_function_privilege('service_role', 'platform.read_sales_register_v5(uuid,integer,integer,integer,uuid,boolean,text,text,boolean,text,text)', 'EXECUTE')
    OR has_function_privilege('service_role', 'platform.set_sales_register_withdrawal_v1(uuid,uuid,bigint,text,text,uuid)', 'EXECUTE')
    OR NOT has_function_privilege('service_role', 'platform.mark_sales_report_row_withdrawn_v1(uuid,uuid,text,text,text,text,text,text)', 'EXECUTE')
    OR NOT has_function_privilege('service_role', 'platform.archive_sales_report_row_v1(uuid,uuid,text,text,text,text)', 'EXECUTE')
    OR NOT has_function_privilege('service_role', 'platform.create_sales_report_student_case_v1(uuid,uuid,text,text,uuid,jsonb,text)', 'EXECUTE')
    OR has_function_privilege('authenticated', 'platform.mark_sales_report_row_withdrawn_v1(uuid,uuid,text,text,text,text,text,text)', 'EXECUTE')
    OR has_function_privilege('authenticated', 'platform.archive_sales_report_row_v1(uuid,uuid,text,text,text,text)', 'EXECUTE')
    OR has_function_privilege('authenticated', 'platform.create_sales_report_student_case_v1(uuid,uuid,text,text,uuid,jsonb,text)', 'EXECUTE')
    OR has_function_privilege('anon', 'platform.create_sales_report_student_case_v1(uuid,uuid,text,text,uuid,jsonb,text)', 'EXECUTE')
    OR has_table_privilege('service_role', 'platform_private.sales_withdrawal_service_receipts', 'SELECT')
    OR has_table_privilege('authenticated', 'platform_private.sales_withdrawal_service_receipts', 'SELECT')
    OR NOT (SELECT c.relforcerowsecurity FROM pg_catalog.pg_class c
      WHERE c.oid = 'platform_private.sales_withdrawal_service_receipts'::regclass)
  THEN
    RAISE EXCEPTION 'a307_verification_failed: grants';
  END IF;
  -- Released reads and commands are byte-identical.
  IF EXISTS (SELECT 1 FROM a307_released r JOIN pg_catalog.pg_proc p ON p.oid = r.signature::regprocedure
      WHERE md5(p.prosrc) IS DISTINCT FROM r.body)
    OR (SELECT count(*) FROM a307_released) <> 17 THEN
    RAISE EXCEPTION 'a307_verification_failed: a released read or command changed';
  END IF;
  -- The three edited bodies carry the condition exactly where the replacements put it.
  IF (SELECT prosrc FROM pg_catalog.pg_proc WHERE oid = 'platform.staff_sales_count_v1(uuid,date,date)'::regprocedure)
      NOT LIKE '%NOT r.archived AND r.withdrawal_kind IS NULL%'
    OR (SELECT prosrc FROM pg_catalog.pg_proc WHERE oid = 'platform_private.marketing_cohort(uuid,date,date)'::regprocedure)
      NOT LIKE '%NOT r.archived AND r.withdrawal_kind IS NULL AND r.lead_id IN%'
    OR (SELECT prosrc FROM pg_catalog.pg_proc WHERE oid = 'platform_private.marketing_cohort(uuid,date,date)'::regprocedure)
      NOT LIKE '%NOT r.archived AND r.withdrawal_kind IS NULL AND r.linked_lead_id IN%'
    OR (SELECT prosrc FROM pg_catalog.pg_proc WHERE oid = 'platform.marketing_overview_v1(date,date)'::regprocedure)
      NOT LIKE '%NOT r.archived AND r.withdrawal_kind IS NULL%' THEN
    RAISE EXCEPTION 'a307_verification_failed: sale definition';
  END IF;
END
$a307_verify$;

NOTIFY pgrst, 'reload schema';
COMMIT;
