-- O2: expose existing finance ledger operations, never reinterpret report rows as money.
CREATE FUNCTION platform.staff_finance_entry_workspace(p_student_case_id UUID) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor RECORD; base JSONB; obligations JSONB; events JSONB; active BOOLEAN; read_events BOOLEAN;
BEGIN
  -- Preserve the canonical case read gate before reading ledger identities.
  base:=platform.staff_case_finance_control(p_student_case_id,20);
  SELECT a.* INTO actor FROM platform.current_actor_authority() a;
  IF NOT FOUND OR actor.platform_role NOT IN ('admin','curator') THEN RAISE EXCEPTION 'finance_entry_forbidden' USING ERRCODE='42501'; END IF;
  SELECT c.state='active' INTO active FROM platform.student_cases c WHERE c.id=p_student_case_id AND c.organization_id=actor.organization_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'finance_entry_forbidden' USING ERRCODE='42501'; END IF;
  IF (SELECT count(*) FROM platform.payment_obligations o WHERE o.student_case_id=p_student_case_id AND o.organization_id=actor.organization_id)>200
    OR (SELECT count(*) FROM platform.payment_events e WHERE e.student_case_id=p_student_case_id AND e.organization_id=actor.organization_id)>1000
    THEN RAISE EXCEPTION 'finance_entry_history_limit' USING ERRCODE='54000'; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',o.id,'label',o.label,'currency',o.currency,'amount_minor',o.amount_minor::TEXT,
    'outstanding_minor',(o.amount_minor-o.total_paid_minor+o.total_refunded_minor)::TEXT,'due_at',o.due_at) ORDER BY o.due_at,o.id),'[]')
    INTO obligations FROM platform.payment_obligations o WHERE o.student_case_id=p_student_case_id AND o.organization_id=actor.organization_id;
  read_events:=private.platform_can_read_finance_full(actor.organization_id)
    OR (private.platform_has_permission(actor.organization_id,'finance.event.confirm')
      AND private.platform_has_scope(actor.organization_id,'organization',actor.organization_id));
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',e.id,'obligation_id',e.payment_obligation_id,'type',e.event_type,
    'amount_minor',e.amount_minor::TEXT,'currency',e.currency,'occurred_at',e.occurred_at,
    'refundable_minor',CASE WHEN e.event_type='payment' THEN (e.amount_minor-coalesce((SELECT sum(r.amount_minor)
      FROM platform.payment_events r WHERE r.organization_id=e.organization_id AND r.referenced_payment_event_id=e.id AND r.event_type='refund'),0))::TEXT ELSE '0' END)
    ORDER BY e.occurred_at DESC,e.id),'[]') INTO events FROM platform.payment_events e
    WHERE e.student_case_id=p_student_case_id AND e.organization_id=actor.organization_id AND read_events;
  RETURN jsonb_build_object('case_id',p_student_case_id,'organization_id',actor.organization_id,'obligations',obligations,'events',events,
    'can_read_events',read_events,'can_create',active AND private.platform_has_permission(actor.organization_id,'finance.manage')
      AND private.platform_has_scope(actor.organization_id,'organization',actor.organization_id),
    'can_record',active AND private.platform_has_permission(actor.organization_id,'finance.event.confirm')
      AND private.platform_has_scope(actor.organization_id,'organization',actor.organization_id));
END $$;

CREATE FUNCTION platform.staff_monthly_payment_summary(p_organization_id UUID,p_year INTEGER,p_month INTEGER) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor RECORD; starts TIMESTAMPTZ; ends TIMESTAMPTZ; totals JSONB;
BEGIN
  SELECT a.* INTO actor FROM platform.current_actor_authority() a WHERE a.organization_id=p_organization_id AND a.platform_role='admin';
  IF NOT FOUND THEN RAISE EXCEPTION 'finance_summary_forbidden' USING ERRCODE='42501'; END IF;
  PERFORM platform_private.require_finance_actor(p_organization_id,'finance.read.full');
  IF p_year IS NULL OR p_year NOT BETWEEN 1900 AND 2100 OR p_month IS NULL OR p_month NOT BETWEEN 1 AND 12
    THEN RAISE EXCEPTION 'finance_summary_invalid' USING ERRCODE='22023'; END IF;
  starts:=make_date(p_year,p_month,1)::TIMESTAMP AT TIME ZONE 'Asia/Bishkek';
  ends:=(make_date(p_year,p_month,1)+INTERVAL '1 month')::TIMESTAMP AT TIME ZONE 'Asia/Bishkek';
  SELECT coalesce(jsonb_agg(jsonb_build_object('currency',currency,'payments_minor',payments::TEXT,'refunds_minor',refunds::TEXT,
    'net_minor',(payments-refunds)::TEXT,'event_count',event_count::TEXT) ORDER BY currency),'[]') INTO totals FROM (
      SELECT e.currency,coalesce(sum(e.amount_minor) FILTER(WHERE e.event_type='payment'),0) payments,
        coalesce(sum(e.amount_minor) FILTER(WHERE e.event_type='refund'),0) refunds,count(*) event_count
      FROM platform.payment_events e WHERE e.organization_id=p_organization_id AND e.occurred_at>=starts AND e.occurred_at<ends GROUP BY e.currency
    ) amounts;
  RETURN jsonb_build_object('organization_id',p_organization_id,'year',p_year,'month',p_month,'totals',totals);
END $$;
REVOKE ALL ON FUNCTION platform.staff_finance_entry_workspace(UUID),platform.staff_monthly_payment_summary(UUID,INTEGER,INTEGER)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION platform.staff_finance_entry_workspace(UUID),platform.staff_monthly_payment_summary(UUID,INTEGER,INTEGER) TO authenticated;

-- One active signature: avoid overloaded PostgREST functions with default arguments.
DROP FUNCTION platform.read_sales_register_v1(UUID,INTEGER,INTEGER,INTEGER,UUID,BOOLEAN);
DROP FUNCTION private.read_sales_register_v1(UUID,INTEGER,INTEGER,INTEGER,UUID,BOOLEAN);
CREATE FUNCTION private.read_sales_register_v1(p_organization_id UUID,p_year INTEGER,p_month INTEGER DEFAULT NULL,
 p_offset INTEGER DEFAULT 0,p_record_id UUID DEFAULT NULL,p_archived BOOLEAN DEFAULT false,
 p_manager_label TEXT DEFAULT NULL,p_direction TEXT DEFAULT NULL,p_needs_review BOOLEAN DEFAULT NULL) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor RECORD; selected JSONB:=NULL; rows JSONB; total BIGINT; totals JSONB; targets JSONB; labels JSONB; owners JSONB;
 unresolved_cost BIGINT; unresolved_paid BIGINT; first_month DATE; last_month DATE;
BEGIN
 SELECT * INTO actor FROM platform_private.sales_register_actor(p_organization_id);
 IF p_year IS NULL OR p_year NOT BETWEEN 1900 AND 2100 OR (p_month IS NOT NULL AND p_month NOT BETWEEN 1 AND 12)
   OR p_offset IS NULL OR p_offset NOT BETWEEN 0 AND 1000000 OR p_archived IS NULL
   OR (p_manager_label IS NOT NULL AND (length(p_manager_label) NOT BETWEEN 1 AND 300 OR p_manager_label ~ '[[:cntrl:]]'))
   OR (p_direction IS NOT NULL AND (length(p_direction) NOT BETWEEN 1 AND 500 OR p_direction ~ '[[:cntrl:]]')) THEN
   RAISE EXCEPTION 'sales_register_invalid_filter' USING ERRCODE='22023'; END IF;
 first_month:=make_date(p_year,coalesce(p_month,1),1);
 last_month:=CASE WHEN p_month IS NULL THEN make_date(p_year,12,1) ELSE first_month END;
 IF p_record_id IS NOT NULL THEN
   SELECT platform_private.sales_register_row(r) INTO selected FROM platform_private.sales_register r
     WHERE r.organization_id=p_organization_id AND r.id=p_record_id AND (actor.platform_role='admin' OR r.owner_membership_id=actor.membership_id);
   IF NOT FOUND THEN RAISE EXCEPTION 'sales_register_forbidden' USING ERRCODE='42501'; END IF;
 END IF;
 WITH filtered AS MATERIALIZED (SELECT r.* FROM platform_private.sales_register r WHERE r.organization_id=p_organization_id
   AND (actor.platform_role='admin' OR r.owner_membership_id=actor.membership_id) AND r.archived=p_archived
   AND r.report_month BETWEEN first_month AND last_month
   AND (p_manager_label IS NULL OR r.fields->>'manager_label'=p_manager_label)
   AND (p_direction IS NULL OR r.fields->>'direction'=p_direction)
   AND (p_needs_review IS NULL OR (r.fields->>'needs_review')::BOOLEAN=p_needs_review))
 SELECT (SELECT count(*) FROM filtered),
   coalesce((SELECT jsonb_agg(platform_private.sales_register_row(page::platform_private.sales_register) ORDER BY page.report_month DESC,page.id) FROM
      (SELECT * FROM filtered ORDER BY report_month DESC,id LIMIT 50 OFFSET p_offset) page),'[]'),
   (SELECT count(*) FROM filtered WHERE fields->>'service_cost_minor' IS NULL),
   (SELECT count(*) FROM filtered WHERE fields->>'paid_minor' IS NULL),
   coalesce((SELECT jsonb_agg(jsonb_build_object('currency',currency,'cost_minor',cost_minor::TEXT,'paid_minor',paid_minor::TEXT) ORDER BY currency)
     FROM (SELECT currency,sum(cost_minor) cost_minor,sum(paid_minor) paid_minor FROM (
       SELECT fields->>'service_cost_currency' currency,(fields->>'service_cost_minor')::BIGINT cost_minor,0::BIGINT paid_minor FROM filtered WHERE fields->>'service_cost_minor' IS NOT NULL
       UNION ALL SELECT fields->>'paid_currency',0::BIGINT,(fields->>'paid_minor')::BIGINT FROM filtered WHERE fields->>'paid_minor' IS NOT NULL) amounts GROUP BY currency) sums),'[]')
 INTO total,rows,unresolved_cost,unresolved_paid,totals;
 IF p_archived THEN totals:='[]'; unresolved_cost:=0; unresolved_paid:=0; END IF;
 SELECT coalesce(jsonb_agg(label ORDER BY label),'[]') INTO labels FROM (SELECT DISTINCT r.fields->>'manager_label' label
   FROM platform_private.sales_register r WHERE r.organization_id=p_organization_id AND (actor.platform_role='admin' OR r.owner_membership_id=actor.membership_id)
   AND r.fields->>'manager_label'<>'' LIMIT 1000) label_rows;
 IF actor.platform_role='admin' THEN
   SELECT coalesce(jsonb_agg(jsonb_build_object('id',t.id,'version',t.version::TEXT,'report_month',t.report_month,
     'manager_label',t.manager_label,'target_count',t.target_count) ORDER BY t.report_month,t.manager_label),'[]') INTO targets
     FROM platform_private.sales_register_targets t WHERE t.organization_id=p_organization_id AND t.report_month BETWEEN first_month AND last_month;
 ELSE targets:='[]'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',m.id,'label',left(btrim(regexp_replace(coalesce(p.display_name,''),'[[:cntrl:]]',' ','g')),300)) ORDER BY p.display_name,m.id),'[]') INTO owners
 FROM platform.organization_memberships m JOIN platform.profiles p ON p.id=m.profile_id
 WHERE m.organization_id=p_organization_id AND platform_private.is_eligible_sales_owner(p_organization_id,m.id)
   AND (actor.platform_role='admin' OR m.id=actor.membership_id);
 RETURN jsonb_build_object('organization_id',p_organization_id,'year',p_year,'month',p_month,'offset',p_offset,
   'total_count',total,'rows',rows,'selected',selected,'has_more',p_offset+50<total,'totals',totals,
   'unresolved_cost_count',unresolved_cost,'unresolved_paid_count',unresolved_paid,'targets',targets,'manager_labels',labels,'owner_options',owners);
END $$;
CREATE FUNCTION platform.read_sales_register_v1(p_organization_id UUID,p_year INTEGER,p_month INTEGER DEFAULT NULL,
 p_offset INTEGER DEFAULT 0,p_record_id UUID DEFAULT NULL,p_archived BOOLEAN DEFAULT false,
 p_manager_label TEXT DEFAULT NULL,p_direction TEXT DEFAULT NULL,p_needs_review BOOLEAN DEFAULT NULL) RETURNS JSONB
LANGUAGE SQL STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT private.read_sales_register_v1(p_organization_id,p_year,p_month,p_offset,p_record_id,p_archived,p_manager_label,p_direction,p_needs_review)
$$;
REVOKE ALL ON FUNCTION private.read_sales_register_v1(UUID,INTEGER,INTEGER,INTEGER,UUID,BOOLEAN,TEXT,TEXT,BOOLEAN),
 platform.read_sales_register_v1(UUID,INTEGER,INTEGER,INTEGER,UUID,BOOLEAN,TEXT,TEXT,BOOLEAN) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION private.read_sales_register_v1(UUID,INTEGER,INTEGER,INTEGER,UUID,BOOLEAN,TEXT,TEXT,BOOLEAN),
 platform.read_sales_register_v1(UUID,INTEGER,INTEGER,INTEGER,UUID,BOOLEAN,TEXT,TEXT,BOOLEAN) TO authenticated;
