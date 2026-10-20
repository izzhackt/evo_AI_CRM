-- Steps that the cloud dump does not carry (selfhosted-cutover.md, step 4). Run as postgres, ON_ERROR_STOP.
-- The password of evo_ai_agent is set separately by cutover-restore.sh (never in a file).
begin;

-- 1. Signup trigger on auth.users (auth schema is not dumped). Definition as in the cloud.
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- 2. Realtime publication: exactly the six tables of the cloud.
alter publication supabase_realtime set table
  public.conversations, public.flow_runs, public.member_presence,
  public.message_reactions, public.messages, public.notifications;

-- 3. Hook of the access token: Auth must be able to call it.
grant usage on schema platform_private to supabase_auth_admin;
grant execute on function platform_private.custom_access_token_hook(jsonb) to supabase_auth_admin;

commit;
