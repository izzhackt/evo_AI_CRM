-- CRM-02b: literal sales search within the same scoped rows, before totals/page.
-- Contract3afb4bb2; source reader144+156/live SHA256
-- cb0ea74933ca57685096602683527c1cc152a8b6419671eb07f5ff75b86d27aa.
-- Existing v1 and all writes remain unchanged. No business data mutation.
-- PostgreSQL17: https://www.postgresql.org/docs/17/functions-string.html
-- SECURITY DEFINER/grants: https://www.postgresql.org/docs/17/sql-createfunction.html
BEGIN;

CREATE FUNCTION private.read_sales_register_v2(p_organization_id uuid, p_year integer, p_month integer DEFAULT NULL::integer, p_offset integer DEFAULT 0, p_record_id uuid DEFAULT NULL::uuid, p_archived boolean DEFAULT false, p_manager_label text DEFAULT NULL::text, p_direction text DEFAULT NULL::text, p_needs_review boolean DEFAULT NULL::boolean, p_query text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE actor RECORD; selected JSONB:=NULL; rows JSONB; total BIGINT; totals JSONB; targets JSONB; labels JSONB; owners JSONB;
 unresolved_cost BIGINT; unresolved_paid BIGINT; first_month DATE; last_month DATE;
 normalized_query TEXT := NULLIF(btrim(p_query),''); query_lower TEXT; query_digits TEXT;
BEGIN
 SELECT * INTO actor FROM platform_private.sales_register_actor(p_organization_id);
 IF p_year IS NULL OR p_year NOT BETWEEN 1900 AND 2100 OR (p_month IS NOT NULL AND p_month NOT BETWEEN 1 AND 12)
   OR p_offset IS NULL OR p_offset NOT BETWEEN 0 AND 1000000 OR p_archived IS NULL
   OR (p_manager_label IS NOT NULL AND (length(p_manager_label) NOT BETWEEN 1 AND 300 OR p_manager_label ~ '[[:cntrl:]]'))
   OR (p_direction IS NOT NULL AND (length(p_direction) NOT BETWEEN 1 AND 500 OR p_direction ~ '[[:cntrl:]]'))
   OR (p_query IS NOT NULL AND (length(p_query)>200 OR p_query ~ '[[:cntrl:]]')) THEN
   RAISE EXCEPTION 'sales_register_invalid_filter' USING ERRCODE='22023'; END IF;
 query_lower:=lower(normalized_query);
 query_digits:=CASE WHEN normalized_query ~ '^[+0-9 ().-]+$'
   THEN NULLIF(regexp_replace(normalized_query,'[^0-9]','','g'),'') ELSE NULL END;
 first_month:=make_date(p_year,coalesce(p_month,1),1);
 last_month:=CASE WHEN p_month IS NULL THEN make_date(p_year,12,1) ELSE first_month END;
 IF p_record_id IS NOT NULL THEN
   SELECT platform_private.sales_register_row(r) INTO selected FROM platform_private.sales_register r
     WHERE r.organization_id=p_organization_id AND r.id=p_record_id AND platform_private.staff_can_access(p_organization_id, actor.membership_id,
      'sales.register.read', 'sales_register', r.id);
   IF NOT FOUND THEN RAISE EXCEPTION 'sales_register_forbidden' USING ERRCODE='42501'; END IF;
 END IF;
 WITH filtered AS MATERIALIZED (SELECT r.* FROM platform_private.sales_register r WHERE r.organization_id=p_organization_id
   AND platform_private.staff_can_access(p_organization_id, actor.membership_id,
      'sales.register.read', 'sales_register', r.id) AND r.archived=p_archived
   AND r.report_month BETWEEN first_month AND last_month
   AND (p_manager_label IS NULL OR r.fields->>'manager_label'=p_manager_label)
   AND (p_direction IS NULL OR r.fields->>'direction'=p_direction)
   AND (p_needs_review IS NULL OR (r.fields->>'needs_review')::BOOLEAN=p_needs_review)
   AND (normalized_query IS NULL
     OR strpos(lower(coalesce(r.fields->>'applicant_name','')),query_lower)>0
     OR strpos(lower(coalesce(r.fields->>'contract_number','')),query_lower)>0
     OR (query_digits IS NOT NULL AND strpos(regexp_replace(coalesce(r.fields->>'phone',''),'[^0-9]','','g'),query_digits)>0)))
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
   FROM platform_private.sales_register r WHERE r.organization_id=p_organization_id AND platform_private.staff_can_access(p_organization_id, actor.membership_id,
      'sales.register.read', 'sales_register', r.id)
   AND r.fields->>'manager_label'<>'' LIMIT 1000) label_rows;
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
 RETURN jsonb_build_object('query',normalized_query,'organization_id',p_organization_id,'year',p_year,'month',p_month,'offset',p_offset,
   'total_count',total,'rows',rows,'selected',selected,'has_more',p_offset+50<total,'totals',totals,
   'unresolved_cost_count',unresolved_cost,'unresolved_paid_count',unresolved_paid,'targets',targets,'manager_labels',labels,'owner_options',owners);
END $function$;

CREATE FUNCTION platform.read_sales_register_v2(p_organization_id UUID,p_year INTEGER,p_month INTEGER DEFAULT NULL,
 p_offset INTEGER DEFAULT 0,p_record_id UUID DEFAULT NULL,p_archived BOOLEAN DEFAULT false,
 p_manager_label TEXT DEFAULT NULL,p_direction TEXT DEFAULT NULL,p_needs_review BOOLEAN DEFAULT NULL,
 p_query TEXT DEFAULT NULL) RETURNS JSONB
LANGUAGE SQL STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT private.read_sales_register_v2(p_organization_id,p_year,p_month,p_offset,p_record_id,p_archived,p_manager_label,p_direction,p_needs_review,p_query)
$$;
REVOKE ALL ON FUNCTION private.read_sales_register_v2(UUID,INTEGER,INTEGER,INTEGER,UUID,BOOLEAN,TEXT,TEXT,BOOLEAN,TEXT),
 platform.read_sales_register_v2(UUID,INTEGER,INTEGER,INTEGER,UUID,BOOLEAN,TEXT,TEXT,BOOLEAN,TEXT) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION private.read_sales_register_v2(UUID,INTEGER,INTEGER,INTEGER,UUID,BOOLEAN,TEXT,TEXT,BOOLEAN,TEXT),
 platform.read_sales_register_v2(UUID,INTEGER,INTEGER,INTEGER,UUID,BOOLEAN,TEXT,TEXT,BOOLEAN,TEXT) TO authenticated;
COMMIT;
