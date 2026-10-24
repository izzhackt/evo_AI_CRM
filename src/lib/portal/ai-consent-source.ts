import "server-only";

import { createSupabaseServerClient } from "../supabase/server";
import { readAiConsentWith } from "./ai-consent-rpc.ts";
import type { AiConsent } from "./ai-consent.ts";

export type AiConsentRead =
  | Readonly<{ status: "ready"; consent: AiConsent }>
  | Readonly<{ status: "unavailable" }>;

/**
 * Своё согласие на ИИ-помощников (миграция 320): любой вошедший студент.
 * Сбой RPC или чужая форма ответа — «unavailable»: «Главная» не показывает
 * вопрос, который могла бы задать поверх уже данного ответа, а «Профиль»
 * честно пишет, что выбор не проверен.
 */
export async function readOwnAiConsent(): Promise<AiConsentRead> {
  try {
    const consent = await readAiConsentWith(await createSupabaseServerClient());
    return consent === null ? { status: "unavailable" } : { status: "ready", consent };
  } catch {
    return { status: "unavailable" };
  }
}
