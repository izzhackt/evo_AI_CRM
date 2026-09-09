-- Fictional upstream CRM inputs only. No Auth credentials, cases, handoff rows,
-- admissions gates, or business-event snapshots are inserted here.
-- E5 confirms synthetic contract/payment with actual Admin Auth RPCs, then
-- hands each lead over with actual Sales Auth/RPC authority.
DO $$
DECLARE
  org UUID := current_setting('e5.organization')::UUID;
  sales UUID := current_setting('e5.sales')::UUID;
  scenario TEXT;
  client UUID;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM platform.organization_memberships AS membership WHERE membership.id=sales
    AND membership.organization_id=org AND membership.current_role='sales' AND membership.status='active') THEN
    RAISE EXCEPTION 'E5 synthetic Sales identity missing';
  END IF;
  FOREACH scenario IN ARRAY ARRAY['cn-desktop','my-desktop','stale','offline','cn-mobile','my-mobile'] LOOP
    client := gen_random_uuid();
    INSERT INTO platform.clients(id,organization_id,display_name,normalized_name)
      VALUES(client,org,'E5 Fictional '||scenario,'e5 fictional '||scenario);
    INSERT INTO platform.leads(id,organization_id,client_id,current_owner_membership_id,stage_key,source_key,lifecycle_state)
      VALUES(gen_random_uuid(),org,client,sales,'qualified','e5-browser.'||scenario,'open');
  END LOOP;
END $$;
