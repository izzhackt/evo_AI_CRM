// Чтения и запись «Моих данных»: профиль (196), логин для входа (340), язык портала (196).
import { isPortalLanguage, parsePortalProfile, type PortalLanguage, type PortalProfile } from "@web/lib/portal/portal-profile";
import { normalizeStudentLogin } from "@web/lib/student-login";

import { rpcRead, type RpcTransport } from "@/lib/rpc";

export class ProfileDecodeError extends Error {
  constructor() {
    super("profile:decode");
    this.name = "ProfileDecodeError";
  }
}

export async function readOwnProfile(transport: RpcTransport): Promise<PortalProfile> {
  const profile = parsePortalProfile(await rpcRead(transport, "get_own_portal_profile_v1"));
  if (!profile) throw new ProfileDecodeError();
  return profile;
}

/** Логин `имя.фамилия`; нет логина или сбой — `null` (как на вебе: строки просто нет). */
export async function readOwnLogin(transport: RpcTransport): Promise<string | null> {
  try {
    const data = await rpcRead(transport, "own_student_login_v1");
    return typeof data === "string" ? normalizeStudentLogin(data) : null;
  } catch {
    return null;
  }
}

/** Язык портала в БД (RPC без p_request_id, идемпотентна по значению). Ответ обязан подтвердить именно этот язык: иначе интерфейс не меняем. */
export async function saveOwnLanguage(transport: RpcTransport, language: PortalLanguage): Promise<PortalLanguage> {
  if (!isPortalLanguage(language)) throw new ProfileDecodeError();
  const data = await rpcRead(transport, "set_own_portal_language_v1", { p_language: language });
  const echoed = typeof data === "object" && data !== null ? (data as Record<string, unknown>).portalLanguage : null;
  if (echoed !== language) throw new ProfileDecodeError();
  return language;
}
