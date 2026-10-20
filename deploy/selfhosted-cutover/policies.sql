CREATE POLICY case_chat_broadcast_read ON realtime.messages AS PERMISSIVE FOR SELECT TO authenticated USING (((extension = 'broadcast'::text) AND (topic = ( SELECT realtime.topic() AS topic)) AND ( SELECT platform_private.case_chat_can_subscribe(( SELECT realtime.topic() AS topic)) AS case_chat_can_subscribe)));
CREATE POLICY platform_messaging_broadcast_read ON realtime.messages AS PERMISSIVE FOR SELECT TO authenticated USING (((extension = 'broadcast'::text) AND (topic = ( SELECT realtime.topic() AS topic)) AND ( SELECT platform_private.can_subscribe_platform_messaging(( SELECT realtime.topic() AS topic)) AS can_subscribe_platform_messaging)));
CREATE POLICY student_portal_notifications_broadcast_read ON realtime.messages AS PERMISSIVE FOR SELECT TO authenticated USING (((extension = 'broadcast'::text) AND (topic = ( SELECT realtime.topic() AS topic)) AND ( SELECT platform_private.can_subscribe_student_portal_notifications(( SELECT realtime.topic() AS topic)) AS can_subscribe_student_portal_notifications)));
CREATE POLICY team_chat_broadcast_read ON realtime.messages AS PERMISSIVE FOR SELECT TO authenticated USING (((extension = 'broadcast'::text) AND (topic = ( SELECT realtime.topic() AS topic)) AND ( SELECT platform_private.team_chat_can_subscribe(( SELECT realtime.topic() AS topic)) AS team_chat_can_subscribe)));
CREATE POLICY "Avatars are publicly readable" ON storage.objects AS PERMISSIVE FOR SELECT TO public USING ((bucket_id = 'avatars'::text));
CREATE POLICY "Flow media is publicly readable" ON storage.objects AS PERMISSIVE FOR SELECT TO public USING ((bucket_id = 'flow-media'::text));
CREATE POLICY "Members can delete chat media" ON storage.objects AS PERMISSIVE FOR DELETE TO authenticated USING (((bucket_id = 'chat-media'::text) AND (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.user_id = auth.uid()) AND (('account-'::text || (p.account_id)::text) = (storage.foldername(objects.name))[1]))))));
CREATE POLICY "Members can delete flow media" ON storage.objects AS PERMISSIVE FOR DELETE TO public USING (((bucket_id = 'flow-media'::text) AND ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.user_id = auth.uid()) AND (('account-'::text || (p.account_id)::text) = (storage.foldername(objects.name))[1])))) OR ((auth.uid())::text = (storage.foldername(name))[1]))));
CREATE POLICY "Members can read chat media" ON storage.objects AS PERMISSIVE FOR SELECT TO authenticated USING (((bucket_id = 'chat-media'::text) AND (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.user_id = auth.uid()) AND (('account-'::text || (p.account_id)::text) = (storage.foldername(objects.name))[1]))))));
CREATE POLICY "Members can update flow media" ON storage.objects AS PERMISSIVE FOR UPDATE TO public USING (((bucket_id = 'flow-media'::text) AND ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.user_id = auth.uid()) AND (('account-'::text || (p.account_id)::text) = (storage.foldername(objects.name))[1])))) OR ((auth.uid())::text = (storage.foldername(name))[1]))));
CREATE POLICY "Members can upload chat media" ON storage.objects AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((bucket_id = 'chat-media'::text) AND (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.user_id = auth.uid()) AND (('account-'::text || (p.account_id)::text) = (storage.foldername(objects.name))[1]))))));
CREATE POLICY "Members can upload flow media" ON storage.objects AS PERMISSIVE FOR INSERT TO public WITH CHECK (((bucket_id = 'flow-media'::text) AND ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.user_id = auth.uid()) AND (('account-'::text || (p.account_id)::text) = (storage.foldername(objects.name))[1])))) OR ((auth.uid())::text = (storage.foldername(name))[1]))));
CREATE POLICY "Users can delete their own avatar" ON storage.objects AS PERMISSIVE FOR DELETE TO public USING (((bucket_id = 'avatars'::text) AND ((auth.uid())::text = (storage.foldername(name))[1])));
CREATE POLICY "Users can update their own avatar" ON storage.objects AS PERMISSIVE FOR UPDATE TO public USING (((bucket_id = 'avatars'::text) AND ((auth.uid())::text = (storage.foldername(name))[1])));
CREATE POLICY "Users can upload their own avatar" ON storage.objects AS PERMISSIVE FOR INSERT TO public WITH CHECK (((bucket_id = 'avatars'::text) AND ((auth.uid())::text = (storage.foldername(name))[1])));
CREATE POLICY ai_agent_knowledge_server_only ON storage.objects AS RESTRICTIVE FOR ALL TO anon, authenticated USING ((bucket_id <> 'platform-ai-agent-knowledge'::text)) WITH CHECK ((bucket_id <> 'platform-ai-agent-knowledge'::text));
CREATE POLICY knowledge_library_server_only ON storage.objects AS RESTRICTIVE FOR ALL TO anon, authenticated USING ((bucket_id <> 'platform-knowledge-library'::text)) WITH CHECK ((bucket_id <> 'platform-knowledge-library'::text));
