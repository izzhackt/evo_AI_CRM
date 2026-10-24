"use server";

import { revalidatePath } from "next/cache";

import { requireStudentPortalActor } from "../student-portal-guards";
import { createSupabaseServerClient } from "../supabase/server";
import { writeAiConsentWith } from "./ai-consent-rpc.ts";
import type { AiConsentActionResult } from "./ai-consent.ts";

/**
 * «Разрешить» / «Не разрешать» / «Отозвать согласие» (миграция 320, Apple
 * 5.1.2(i)). Выбор записывает RPC сессии студента, она же решает, кто спрашивает;
 * request_id стабилен на попытку, поэтому повтор и сбой сети безопасны. Версию
 * текста и источник подставляет сервер, из браузера приходят только выбор и
 * идентификатор попытки.
 */
export async function setOwnAiConsentAction(
  status: unknown,
  requestId: unknown,
): Promise<AiConsentActionResult> {
  await requireStudentPortalActor();
  try {
    const result = await writeAiConsentWith(await createSupabaseServerClient(), status, requestId);
    if (!result.ok) return result;
    revalidatePath("/portal/home");
    revalidatePath("/portal/profile");
    return result;
  } catch {
    return { ok: false };
  }
}
