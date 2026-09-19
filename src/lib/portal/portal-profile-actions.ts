"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";

import { universityUuid } from "../platform-university-catalog";
import { requireStudentPortalActor } from "../student-portal-guards";
import { createSupabaseServerClient } from "../supabase/server";
import {
  isPortalLanguage,
  parseAccountDeletionReceipt,
  type AccountDeletionActionResult,
  type PortalLanguageActionResult,
} from "./portal-profile";

/**
 * Server actions экрана «Профиль» (PORT-5a). Язык персистится через RPC
 * миграции 196 И обновляет cookie `locale` в том же действии (решение
 * PORT-0 «Локализация»: БД — источник, cookie — request-time умолчание).
 */
export async function setPortalLanguageAction(
  language: unknown,
): Promise<PortalLanguageActionResult> {
  await requireStudentPortalActor();
  if (!isPortalLanguage(language)) return { ok: false };
  try {
    const client = await createSupabaseServerClient();
    const { data, error } = await client
      .schema("platform")
      .rpc("set_own_portal_language_v1", { p_language: language });
    if (
      error
      || data === null || typeof data !== "object" || Array.isArray(data)
      || (data as Record<string, unknown>).portalLanguage !== language
    ) return { ok: false };
  } catch {
    return { ok: false };
  }
  // Cookie — только после подтверждённой записи в БД: интерфейс не должен
  // сменить язык «понарошку», потеряв его на следующем устройстве.
  const store = await cookies();
  store.set("locale", language, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
  revalidatePath("/", "layout");
  return { ok: true, portalLanguage: language };
}

/**
 * Инициирование удаления аккаунта (план §13). RPC идемпотентен по
 * request_id и держит не более одного открытого запроса на участника —
 * повтор нажатия и retry сети безопасны.
 */
export async function requestAccountDeletionAction(
  requestId: unknown,
): Promise<AccountDeletionActionResult> {
  await requireStudentPortalActor();
  const id = universityUuid(requestId);
  if (!id) return { ok: false };
  try {
    const client = await createSupabaseServerClient();
    const { data, error } = await client
      .schema("platform")
      .rpc("request_account_deletion_v1", { p_request_id: id });
    if (error) return { ok: false };
    const result = parseAccountDeletionReceipt(data);
    if (result.ok) revalidatePath("/portal/profile");
    return result;
  } catch {
    return { ok: false };
  }
}
