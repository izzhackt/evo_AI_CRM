import "server-only";

import { createSupabaseServerClient } from "../supabase/server";
import { readAiConsentForTier } from "./ai-consent-rpc.ts";
import type { AiConsentAccessTier, AiConsentRead } from "./ai-consent.ts";

export type { AiConsentRead } from "./ai-consent.ts";

/**
 * Своё согласие на ИИ-помощников (миграция 320) для вошедшего студента.
 * Вопрос есть только у клиента EVO с делом на сопровождении (`assisted`):
 * самостоятельному студенту (`approved`) база не читается совсем — итог
 * «not_applicable», экран не показывает ни карточку, ни строку. Для клиента
 * сбой RPC или чужая форма ответа — «unavailable»: «Главная» не показывает
 * вопрос, который могла бы задать поверх уже данного ответа, а «Профиль»
 * честно пишет, что выбор не проверен. Уровень берётся из серверного
 * `actor.accessTier`, который уже известен сессии: лишнего чтения нет.
 */
export function readOwnAiConsent(accessTier: AiConsentAccessTier): Promise<AiConsentRead> {
  return readAiConsentForTier(accessTier, createSupabaseServerClient);
}
