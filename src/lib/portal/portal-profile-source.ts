import "server-only";

import { createSupabaseServerClient } from "../supabase/server";
import { parsePortalProfile, type PortalProfile } from "./portal-profile";

/**
 * Серверное чтение собственного портального профиля (PORT-5a, миграция 196).
 * RPC выводит актора из живой Student-сессии; здесь — транспорт и строгий
 * разбор, неполная форма — честная ошибка.
 */
export async function readOwnPortalProfile(): Promise<PortalProfile> {
  const client = await createSupabaseServerClient();
  const { data, error } = await client
    .schema("platform")
    .rpc("get_own_portal_profile_v1");
  const profile = !error && parsePortalProfile(data);
  if (!profile) throw new Error("Profile unavailable");
  return profile;
}
