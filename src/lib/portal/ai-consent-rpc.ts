import type { SupabaseClient } from "@supabase/supabase-js";

import {
  AI_CONSENT_POLICY_VERSION,
  AI_CONSENT_SOURCE,
  isAiConsentRequestId,
  isAiConsentStatus,
  parseAiConsent,
  type AiConsent,
  type AiConsentActionResult,
} from "./ai-consent.ts";

/**
 * Транспорт двух RPC согласия на ИИ-помощников (схема platform). Клиент
 * приходит снаружи — это Supabase-клиент сессии студента: «кто спрашивает»
 * решает `auth.uid()` внутри RPC, веб никакой идентификатор не передаёт.
 * Версию политики и источник выбирает сервер этого модуля, не браузер.
 */

/** Чтение своего решения; `null` — сбой RPC или чужая форма ответа. */
export async function readAiConsentWith(client: SupabaseClient): Promise<AiConsent | null> {
  const { data, error } = await client.schema("platform").rpc("portal_ai_consent_get_v1");
  if (error) return null;
  return parseAiConsent(data);
}

/**
 * Запись выбора. `requestId` стабилен на попытку: повтор после сбоя сети
 * возвращает уже записанное решение, второе событие журнала не появляется.
 * Ответ принимается, только если он подтверждает именно этот выбор по текущей
 * версии текста; иначе — отказ, а не выдуманный успех.
 */
export async function writeAiConsentWith(
  client: SupabaseClient,
  status: unknown,
  requestId: unknown,
): Promise<AiConsentActionResult> {
  if (!isAiConsentStatus(status) || !isAiConsentRequestId(requestId)) return { ok: false };
  const { data, error } = await client.schema("platform").rpc("portal_ai_consent_set_v1", {
    p_status: status,
    p_policy_version: AI_CONSENT_POLICY_VERSION,
    p_source: AI_CONSENT_SOURCE,
    p_request_id: requestId,
  });
  if (error) return { ok: false };
  const consent = parseAiConsent(data);
  if (consent === null || consent.status !== status || consent.policyVersion !== AI_CONSENT_POLICY_VERSION) {
    return { ok: false };
  }
  return { ok: true, consent };
}
