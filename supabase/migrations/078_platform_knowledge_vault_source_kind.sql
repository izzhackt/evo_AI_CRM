-- ============================================================
-- 078_platform_knowledge_vault_source_kind.sql
--
-- Adds the `knowledge_vault` value to platform.workflow_source_kind and does
-- nothing else. PostgreSQL cannot use an enum value inside the transaction
-- that adds it, so every use of the new value lives in migration 079. The
-- fail-closed ELSE branch of platform_private.is_safe_workflow_source_url
-- keeps rejecting sources of this kind until 079 adds its pattern, so this
-- migration cannot widen what the catalog accepts on its own.
--
-- No table, policy, grant or data changes here. See ADR 0021.
-- ============================================================

ALTER TYPE platform.workflow_source_kind ADD VALUE 'knowledge_vault';
