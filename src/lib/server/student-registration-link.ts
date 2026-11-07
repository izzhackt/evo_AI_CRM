import "server-only";

import { createHash, randomBytes } from "node:crypto";

import { studentInviteCallbackUrl } from "../student-invite-callback-contract.ts";
import { getPlatformSupabaseBackendConfig } from "./platform-supabase-backend-config";
import { createPlatformSupabaseServiceClient } from "./platform-supabase-service-client";

/**
 * Регистрация по ссылке (341, решение 07.11.2026). Ссылка — 32 случайных символа base64url; в базе только её sha256.
 * Проверка и использование — только сервер (service_role).
 */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32}$/u;

export type RegistrationLinkCheck =
  | Readonly<{ status: "valid"; displayName: string | null }>
  | Readonly<{ status: "unknown" | "used" | "expired" | "unavailable" }>;

export function newRegistrationToken(): Readonly<{ token: string; hash: string }> {
  const token = randomBytes(24).toString("base64url");
  return { token, hash: registrationTokenHash(token)! };
}

export function registrationTokenHash(token: string): string | null {
  return TOKEN_PATTERN.test(token) ? createHash("sha256").update(token, "utf8").digest("hex") : null;
}

/** Адрес страницы регистрации по ссылке: на боевом — кабинет студента, локально — разрешённый локальный адрес. */
export function registrationLinkUrl(token: string): string {
  const origin = new URL(studentInviteCallbackUrl(process.env.NODE_ENV, process.env.EVO_STUDENT_INVITE_LOCAL_ORIGIN)).origin;
  return `${origin}/apply?invite=${encodeURIComponent(token)}`;
}

function service() {
  return createPlatformSupabaseServiceClient(getPlatformSupabaseBackendConfig());
}

export async function checkRegistrationLink(token: string | null | undefined): Promise<RegistrationLinkCheck> {
  const hash = typeof token === "string" ? registrationTokenHash(token) : null;
  if (!hash) return { status: "unknown" };
  try {
    const { data, error } = await service().schema("platform")
      .rpc("check_student_registration_link_v1", { p_token_hash: hash })
      .abortSignal(AbortSignal.timeout(10000));
    if (error || !data || typeof data !== "object" || Array.isArray(data)) return { status: "unavailable" };
    const status = (data as Record<string, unknown>).status;
    if (status === "valid") {
      const name = (data as Record<string, unknown>).display_name;
      return { status: "valid", displayName: typeof name === "string" ? name : null };
    }
    return status === "used" || status === "expired" ? { status } : { status: "unknown" };
  } catch {
    return { status: "unavailable" };
  }
}

export type RegistrationLinkUse = "consumed" | "unknown" | "used" | "expired" | "unavailable";

export async function consumeRegistrationLink(token: string, authUserId: string): Promise<RegistrationLinkUse> {
  const hash = registrationTokenHash(token);
  if (!hash) return "unknown";
  try {
    const { data, error } = await service().schema("platform")
      .rpc("consume_student_registration_link_v1", { p_token_hash: hash, p_auth_user_id: authUserId })
      .abortSignal(AbortSignal.timeout(10000));
    if (error) return "unavailable";
    return data === "consumed" || data === "used" || data === "expired" ? data : "unknown";
  } catch {
    return "unavailable";
  }
}
