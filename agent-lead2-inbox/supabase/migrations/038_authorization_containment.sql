-- ============================================================
-- 038_authorization_containment.sql
--
-- Block A: critical authorization containment.
--
-- PostgreSQL privileges and RLS are independent controls. This migration
-- deliberately uses both:
--   * direct profile/account membership and ownership mutation is removed;
--   * authenticated account_id/user_id values are derived by the database and
--     cannot be moved after insert;
--   * provider shadow and sync/audit columns cannot be written by browser/SSR
--     authenticated sessions;
--   * anonymous DML and implicit function execution are removed;
--   * only the reviewed client RPC surface is granted back.
--
-- service_role remains the server-only bypass role. Application routes using
-- it must still authorize and scope the human caller before each operation.
--
-- Current primary references reviewed for this migration:
--   https://www.postgresql.org/docs/current/ddl-rowsecurity.html
--   https://www.postgresql.org/docs/current/sql-createpolicy.html
--   https://supabase.com/docs/guides/database/postgres/row-level-security
--   https://supabase.com/docs/guides/api/securing-your-api
-- ============================================================

-- No API caller may create objects in the exposed schema. This also makes the
-- fixed `search_path = public` on older SECURITY DEFINER functions non-writable
-- by anon/authenticated callers while those functions are migrated over time.
REVOKE CREATE ON SCHEMA public FROM PUBLIC, anon, authenticated;

-- Anonymous access is read-only where an explicit SELECT policy allows it.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON ALL TABLES IN SCHEMA public
  FROM anon;

-- Profiles are created by the auth.users trigger. A signed-in user can only
-- edit presentation fields; identity, account membership, roles, feature
-- gates, and timestamps remain server-owned.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.profiles
  FROM anon, authenticated;
GRANT SELECT ON TABLE public.profiles TO authenticated;
GRANT UPDATE (full_name, avatar_url) ON TABLE public.profiles TO authenticated;

-- Account ownership changes only through transfer_account_ownership(). Direct
-- account edits are limited to operator-facing settings.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.accounts
  FROM anon, authenticated;
GRANT SELECT ON TABLE public.accounts TO authenticated;
GRANT UPDATE (name, default_currency) ON TABLE public.accounts TO authenticated;

-- Invitations remain admin-scoped by RLS. Accepted state is written only by
-- redeem_invitation(); the insert policy below also binds creator/account.
REVOKE UPDATE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.account_invitations
  FROM anon, authenticated;

DROP POLICY IF EXISTS account_invitations_modify ON public.account_invitations;
DROP POLICY IF EXISTS account_invitations_insert ON public.account_invitations;
DROP POLICY IF EXISTS account_invitations_delete ON public.account_invitations;
CREATE POLICY account_invitations_insert
  ON public.account_invitations
  FOR INSERT
  TO authenticated
  WITH CHECK (
    is_account_member(account_id, 'admin')
    AND created_by_user_id = auth.uid()
    AND accepted_at IS NULL
    AND accepted_by_user_id IS NULL
  );
CREATE POLICY account_invitations_delete
  ON public.account_invitations
  FOR DELETE
  TO authenticated
  USING (
    is_account_member(account_id, 'admin')
    AND accepted_at IS NULL
  );

-- Every authenticated insert into an account-scoped table is rebound to the
-- caller's single profile membership. Existing rows cannot be moved to another
-- account or reassigned to another user. SECURITY DEFINER/server-role paths are
-- intentionally unaffected.
CREATE OR REPLACE FUNCTION public.enforce_authenticated_tenancy()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_account_id UUID;
  v_has_user_id BOOLEAN := COALESCE(TG_ARGV[0], '') = 'user_id';
BEGIN
  IF current_user <> 'authenticated' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    SELECT p.account_id
    INTO v_account_id
    FROM public.profiles AS p
    WHERE p.user_id = auth.uid();

    IF v_account_id IS NULL THEN
      RAISE EXCEPTION 'Authenticated user has no account membership'
        USING ERRCODE = '42501';
    END IF;

    NEW.account_id := v_account_id;
    IF v_has_user_id THEN
      NEW.user_id := auth.uid();
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.account_id IS DISTINCT FROM OLD.account_id THEN
    RAISE EXCEPTION 'account_id is server-owned'
      USING ERRCODE = '42501';
  END IF;
  IF v_has_user_id AND NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'user_id is server-owned'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_authenticated_tenancy() FROM PUBLIC;

DO $$
DECLARE
  table_record RECORD;
  trigger_argument TEXT;
BEGIN
  FOR table_record IN
    SELECT c.relname AS table_name,
           EXISTS (
             SELECT 1
             FROM pg_attribute a
             WHERE a.attrelid = c.oid
               AND a.attname = 'user_id'
               AND a.attnum > 0
               AND NOT a.attisdropped
           ) AS has_user_id
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
      AND c.relname NOT IN ('accounts', 'profiles')
      AND EXISTS (
        SELECT 1
        FROM pg_attribute a
        WHERE a.attrelid = c.oid
          AND a.attname = 'account_id'
          AND a.attnum > 0
          AND NOT a.attisdropped
      )
  LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS enforce_authenticated_tenancy ON public.%I',
      table_record.table_name
    );
    trigger_argument := CASE
      WHEN table_record.has_user_id THEN ', ''user_id'''
      ELSE ''
    END;
    EXECUTE format(
      'CREATE TRIGGER enforce_authenticated_tenancy
       BEFORE INSERT OR UPDATE ON public.%I
       FOR EACH ROW EXECUTE FUNCTION public.enforce_authenticated_tenancy(%s)',
      table_record.table_name,
      ltrim(trigger_argument, ', ')
    );
  END LOOP;
END;
$$;

-- Generic immutable-column guard for values written by external-provider and
-- delivery/audit server paths. It compares the real OLD/NEW records and fails
-- rather than silently discarding a hostile update.
CREATE OR REPLACE FUNCTION public.protect_authenticated_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  column_name TEXT;
BEGIN
  IF current_user <> 'authenticated' THEN
    RETURN NEW;
  END IF;

  FOREACH column_name IN ARRAY TG_ARGV
  LOOP
    IF to_jsonb(NEW) -> column_name IS DISTINCT FROM to_jsonb(OLD) -> column_name THEN
      RAISE EXCEPTION '% is server-owned', column_name
        USING ERRCODE = '42501';
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.protect_authenticated_columns() FROM PUBLIC;

DROP TRIGGER IF EXISTS protect_contact_provider_fields ON public.contacts;
CREATE TRIGGER protect_contact_provider_fields
  BEFORE UPDATE ON public.contacts
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_authenticated_columns(
    'amo_contact_id',
    'amo_contact_synced_at'
  );

DROP POLICY IF EXISTS contacts_server_fields_insert
  ON public.contacts;
CREATE POLICY contacts_server_fields_insert
  ON public.contacts
  AS RESTRICTIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (
    amo_contact_id IS NULL
    AND amo_contact_synced_at IS NULL
  );

DROP TRIGGER IF EXISTS protect_conversation_provider_fields ON public.conversations;
CREATE TRIGGER protect_conversation_provider_fields
  BEFORE UPDATE ON public.conversations
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_authenticated_columns(
    'amo_lead_id',
    'amo_lead_synced_at',
    'crm_sync_status',
    'crm_sync_error',
    'crm_sync_attempted_at'
  );

DROP POLICY IF EXISTS conversations_server_fields_insert
  ON public.conversations;
CREATE POLICY conversations_server_fields_insert
  ON public.conversations
  AS RESTRICTIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (
    amo_lead_id IS NULL
    AND amo_lead_synced_at IS NULL
    AND crm_sync_status = 'pending'
    AND crm_sync_error IS NULL
    AND crm_sync_attempted_at IS NULL
  );

DROP TRIGGER IF EXISTS protect_deal_provider_fields ON public.deals;
CREATE TRIGGER protect_deal_provider_fields
  BEFORE UPDATE ON public.deals
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_authenticated_columns(
    'amo_lead_id',
    'amo_lead_synced_at'
  );

DROP POLICY IF EXISTS deals_server_fields_insert
  ON public.deals;
CREATE POLICY deals_server_fields_insert
  ON public.deals
  AS RESTRICTIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (
    amo_lead_id IS NULL
    AND amo_lead_synced_at IS NULL
  );

-- Function EXECUTE defaults to PUBLIC in PostgreSQL. Remove the implicit API
-- surface, then grant only reviewed RPC entry points.
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.peek_invitation(TEXT)
  TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.redeem_invitation(TEXT)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_member_role(UUID, account_role_enum)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.remove_account_member(UUID)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.transfer_account_ownership(UUID)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.touch_presence(TEXT)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.filter_contacts_by_tags(UUID[], TEXT, INT, INT)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_account_member(UUID, account_role_enum)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.match_ai_knowledge_fts(UUID, TEXT, INTEGER)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.match_ai_knowledge_semantic(UUID, TEXT, INTEGER)
  TO service_role;

-- Server-only routines used by the retained engines and provider adapters.
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;
