"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";

import { parsePlatformAdmissionsUuid } from "../platform-admissions";
import { exactActionStringFields } from "../server/action-form-fields.ts";
import { requireStudentPortalActor } from "../student-portal-guards";
import { createSupabaseServerClient } from "../supabase/server";
import {
  isPortalLanguage,
  normalizePortalNamePart,
  type PortalLanguageActionResult,
  type PortalNameState,
} from "./portal-profile";

/**
 * Server actions экрана «Профиль» (PORT-5a). Язык персистится через RPC
 * миграции 196 И обновляет cookie `locale` в том же действии (решение
 * PORT-0 «Локализация»: БД — источник, cookie — request-time умолчание).
 * Запрос на удаление аккаунта с 280 — src/lib/account-deletion/own-actions.ts.
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
 * «Имя и фамилия» (355, 09.11.2026): студент правит их сам; команда базы пишет их в профиль кабинета и в имя дела в
 * CRM, логин для входа не трогает. request_id стабилен на попытку: повтор после обрыва сети второе событие не пишет.
 */
export async function setPortalNameAction(_previous: PortalNameState, form: FormData): Promise<PortalNameState> {
  await requireStudentPortalActor();
  const fields = exactActionStringFields(form, ["first_name", "last_name", "request_id"]);
  if (!fields) return { status: "unavailable" };
  const firstName = normalizePortalNamePart(fields.get("first_name"));
  const lastName = normalizePortalNamePart(fields.get("last_name"));
  const requestId = parsePlatformAdmissionsUuid(fields.get("request_id") ?? "");
  if (!firstName || !lastName) return { status: "invalid" };
  if (!requestId) return { status: "unavailable" };
  try {
    const client = await createSupabaseServerClient();
    const { data, error } = await client.schema("platform").rpc("set_own_portal_name_v1", {
      p_first_name: firstName, p_last_name: lastName, p_request_id: requestId,
    });
    const displayName = data !== null && typeof data === "object" && !Array.isArray(data)
      ? (data as Record<string, unknown>).displayName : null;
    if (error) return { status: error.code === "22023" ? "invalid" : "unavailable" };
    if (displayName !== `${firstName} ${lastName}`) return { status: "unavailable" };
    revalidatePath("/", "layout");
    return { status: "done", displayName };
  } catch {
    return { status: "unavailable" };
  }
}
