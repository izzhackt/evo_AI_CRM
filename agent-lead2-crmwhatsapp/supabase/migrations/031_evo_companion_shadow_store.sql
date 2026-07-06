-- ============================================================
-- 031_evo_companion_shadow_store.sql
--
-- EVO Inbox companion data-store bootstrap.
--
-- This migration keeps the WACRM account/RLS foundation and adds only
-- the EVO-specific store pieces needed before WAHA and amoCRM adapter
-- work starts:
--
--   1. Nullable amoCRM shadow identifiers on local companion records.
--      These are cache/link fields only. amoCRM remains canonical for
--      contact identity, lead identity, pipeline status, and sales state.
--   2. Account-scoped integration settings for future WAHA and amoCRM
--      configuration/status.
--   3. A separate encrypted-secret table with no authenticated SELECT
--      policy. Server routes may read it with a service-role client only
--      after their own authorization checks.
--
-- No provider credentials or live integration state are inserted here.
-- Idempotent: safe to run multiple times.
-- ============================================================

-- ============================================================
-- amoCRM shadow identifiers
-- ============================================================

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS amo_contact_id text,
  ADD COLUMN IF NOT EXISTS amo_contact_synced_at timestamptz;

COMMENT ON COLUMN contacts.amo_contact_id IS
  'Shadow amoCRM contact id for fast EVO Inbox lookup. amoCRM remains the canonical contact identity source.';
COMMENT ON COLUMN contacts.amo_contact_synced_at IS
  'Last time this local contact shadow identity was resolved or refreshed from amoCRM.';

CREATE INDEX IF NOT EXISTS idx_contacts_account_amo_contact_id
  ON contacts (account_id, amo_contact_id)
  WHERE amo_contact_id IS NOT NULL;

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS amo_lead_id text,
  ADD COLUMN IF NOT EXISTS amo_lead_synced_at timestamptz;

COMMENT ON COLUMN conversations.amo_lead_id IS
  'Shadow amoCRM lead id for conversation context. amoCRM remains canonical for lead identity and sales status.';
COMMENT ON COLUMN conversations.amo_lead_synced_at IS
  'Last time this local conversation lead shadow was resolved or refreshed from amoCRM.';

CREATE INDEX IF NOT EXISTS idx_conversations_account_amo_lead_id
  ON conversations (account_id, amo_lead_id)
  WHERE amo_lead_id IS NOT NULL;

ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS amo_lead_id text,
  ADD COLUMN IF NOT EXISTS amo_lead_synced_at timestamptz;

COMMENT ON COLUMN deals.amo_lead_id IS
  'Optional shadow amoCRM lead id for retained pipeline context. Do not treat local deal status as canonical amoCRM sales state.';
COMMENT ON COLUMN deals.amo_lead_synced_at IS
  'Last time this local deal shadow was resolved or refreshed from amoCRM.';

CREATE INDEX IF NOT EXISTS idx_deals_account_amo_lead_id
  ON deals (account_id, amo_lead_id)
  WHERE amo_lead_id IS NOT NULL;

-- ============================================================
-- Provider-neutral integration status/settings
-- ============================================================

CREATE TABLE IF NOT EXISTS integration_settings (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id      uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  provider        text NOT NULL CHECK (provider IN ('waha', 'amocrm')),
  status          text NOT NULL DEFAULT 'not_configured'
                    CHECK (status IN ('not_configured', 'configured', 'blocked')),
  public_config   jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_checked_at timestamptz,
  last_error      text,
  created_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, provider)
);

COMMENT ON TABLE integration_settings IS
  'Account-scoped non-secret configuration and status for EVO Inbox companion integrations. Secrets live in integration_secrets.';
COMMENT ON COLUMN integration_settings.public_config IS
  'Non-secret provider settings safe for authorized staff to inspect, such as labels, base URLs, or account domain names.';
COMMENT ON COLUMN integration_settings.status IS
  'Operator-visible integration state. Live provider success may only be claimed after real provider validation.';

CREATE INDEX IF NOT EXISTS integration_settings_account_provider_idx
  ON integration_settings (account_id, provider);

ALTER TABLE integration_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS integration_settings_select ON integration_settings;
CREATE POLICY integration_settings_select ON integration_settings FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS integration_settings_insert ON integration_settings;
CREATE POLICY integration_settings_insert ON integration_settings FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS integration_settings_update ON integration_settings;
CREATE POLICY integration_settings_update ON integration_settings FOR UPDATE
  USING (is_account_member(account_id, 'admin'))
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS integration_settings_delete ON integration_settings;
CREATE POLICY integration_settings_delete ON integration_settings FOR DELETE
  USING (is_account_member(account_id, 'admin'));

DROP TRIGGER IF EXISTS set_updated_at ON integration_settings;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON integration_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- Encrypted provider secrets
-- ============================================================

CREATE TABLE IF NOT EXISTS integration_secrets (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  setting_id      uuid NOT NULL REFERENCES integration_settings(id) ON DELETE CASCADE,
  secret_name     text NOT NULL CHECK (secret_name ~ '^[a-z][a-z0-9_]{1,63}$'),
  encrypted_value text NOT NULL,
  updated_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (setting_id, secret_name)
);

COMMENT ON TABLE integration_secrets IS
  'AES-256-GCM encrypted provider secrets for EVO Inbox companion integrations. No plaintext secrets belong in Supabase.';
COMMENT ON COLUMN integration_secrets.encrypted_value IS
  'Ciphertext produced by the app encryption layer using ENCRYPTION_KEY. Authenticated clients have no SELECT policy on this table.';

CREATE INDEX IF NOT EXISTS integration_secrets_setting_name_idx
  ON integration_secrets (setting_id, secret_name);

ALTER TABLE integration_secrets ENABLE ROW LEVEL SECURITY;

-- Deliberately no SELECT policy. Dashboard routes should expose only
-- has-secret booleans after authorizing the caller. Runtime provider
-- adapters read encrypted values with the service-role client and then
-- decrypt inside server-only code.

DROP POLICY IF EXISTS integration_secrets_insert ON integration_secrets;
CREATE POLICY integration_secrets_insert ON integration_secrets FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM integration_settings s
      WHERE s.id = integration_secrets.setting_id
        AND is_account_member(s.account_id, 'admin')
    )
  );

DROP POLICY IF EXISTS integration_secrets_update ON integration_secrets;
CREATE POLICY integration_secrets_update ON integration_secrets FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM integration_settings s
      WHERE s.id = integration_secrets.setting_id
        AND is_account_member(s.account_id, 'admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM integration_settings s
      WHERE s.id = integration_secrets.setting_id
        AND is_account_member(s.account_id, 'admin')
    )
  );

DROP POLICY IF EXISTS integration_secrets_delete ON integration_secrets;
CREATE POLICY integration_secrets_delete ON integration_secrets FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM integration_settings s
      WHERE s.id = integration_secrets.setting_id
        AND is_account_member(s.account_id, 'admin')
    )
  );

DROP TRIGGER IF EXISTS set_updated_at ON integration_secrets;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON integration_secrets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
