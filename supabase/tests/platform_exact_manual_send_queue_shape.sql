\set ON_ERROR_STOP on
\set p8r4_canonical_pointer 1

-- Reuse the complete manual-send runtime acceptance at the schema tip, but
-- exercise the authenticated enqueue shape introduced before migration 101:
-- v + organization_id + work_item_id + kind. The included transaction also
-- proves that the former three-field pointer now fails closed.
\i /workspace/supabase/tests/platform_manual_send_waha_runtime_current.sql

SELECT 'platform migration 101 exact manual-send queue shape passed'
  AS result;
