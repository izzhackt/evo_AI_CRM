-- Block C: private, account-scoped Inbox media and content-free audit evidence.
-- Storage object bytes must still be created/deleted through the Storage API.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'chat-media',
  'chat-media',
  FALSE,
  16777216,
  ARRAY[
    'image/jpeg', 'image/png', 'image/webp',
    'video/mp4', 'video/3gpp',
    'application/pdf', 'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain',
    'audio/ogg', 'audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/amr'
  ]
)
ON CONFLICT (id) DO UPDATE
SET public = FALSE,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "Public can read chat media" ON storage.objects;
DROP POLICY IF EXISTS "Chat media is publicly readable" ON storage.objects;
DROP POLICY IF EXISTS "Members can read chat media" ON storage.objects;
CREATE POLICY "Members can read chat media"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'chat-media'
    AND EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
    )
  );

DROP POLICY IF EXISTS "Members can upload chat media" ON storage.objects;
CREATE POLICY "Members can upload chat media"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'chat-media'
    AND EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
    )
  );

DROP POLICY IF EXISTS "Members can update chat media" ON storage.objects;
DROP POLICY IF EXISTS "Members can delete chat media" ON storage.objects;
CREATE POLICY "Members can delete chat media"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'chat-media'
    AND EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
    )
  );

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS media_bucket TEXT,
  ADD COLUMN IF NOT EXISTS media_path TEXT,
  ADD COLUMN IF NOT EXISTS media_mime_type TEXT,
  ADD COLUMN IF NOT EXISTS media_file_name TEXT,
  ADD COLUMN IF NOT EXISTS media_size_bytes BIGINT,
  ADD COLUMN IF NOT EXISTS media_retention_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS media_deleted_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS public.media_audit_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  message_id UUID REFERENCES public.messages(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL CHECK (
    event_type IN ('upload', 'access_grant', 'deletion', 'retention_deletion')
  ),
  actor_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  object_key_sha256 TEXT NOT NULL CHECK (object_key_sha256 ~ '^[0-9a-f]{64}$'),
  size_bytes BIGINT CHECK (size_bytes IS NULL OR size_bytes >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.media_audit_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members can read account media audit" ON public.media_audit_events;
CREATE POLICY "Members can read account media audit"
  ON public.media_audit_events FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND p.account_id = media_audit_events.account_id
    )
  );

REVOKE INSERT, UPDATE, DELETE ON public.media_audit_events FROM anon, authenticated;
GRANT SELECT ON public.media_audit_events TO authenticated;
GRANT SELECT, INSERT ON public.media_audit_events TO service_role;

CREATE INDEX IF NOT EXISTS idx_messages_media_retention
  ON public.messages (media_retention_until)
  WHERE media_path IS NOT NULL AND media_deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_media_audit_account_created
  ON public.media_audit_events (account_id, created_at DESC);
