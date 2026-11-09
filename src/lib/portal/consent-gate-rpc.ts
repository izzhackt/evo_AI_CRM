import type { SupabaseClient } from "@supabase/supabase-js";

import {
  CONSENT_GATE_AI_POLICY_VERSION,
  CONSENT_GATE_PATH,
  CONSENT_GATE_SOURCE,
  consentGateRequired,
  PRIVACY_POLICY_VERSION,
  isConsentRequestId,
  parseConsentStatus,
  type ConsentAcceptResult,
  type ConsentStatus,
} from "./consent-gate.ts";

/**
 * Транспорт двух RPC экрана «Конфиденциальность» (миграция 356, схема platform). Клиент - Supabase-клиент сессии
 * студента: «кто спрашивает» решает `auth.uid()` внутри RPC. Версии и источник выбирает сервер этого модуля.
 */

/** Чтение состояния; `null` - сбой RPC или чужая форма ответа. */
export async function readConsentStatusWith(client: SupabaseClient): Promise<ConsentStatus | null> {
  const { data, error } = await client.schema("platform").rpc("portal_consent_status_v1");
  if (error) return null;
  return parseConsentStatus(data);
}

/**
 * Принятие обеих галочек одной транзакцией. `requestId` стабилен на попытку (повтор после сбоя сети безопасен).
 * Успех - только если ответ подтверждает принятие по текущим версиям и больше не требует решения.
 */
export async function acceptConsentsWith(client: SupabaseClient, requestId: unknown): Promise<ConsentAcceptResult> {
  if (!isConsentRequestId(requestId)) return { ok: false };
  const { data, error } = await client.schema("platform").rpc("portal_consents_accept_v1", {
    p_policy_version: PRIVACY_POLICY_VERSION,
    p_ai_policy_version: CONSENT_GATE_AI_POLICY_VERSION,
    p_source: CONSENT_GATE_SOURCE,
    p_request_id: requestId,
  });
  if (error) return { ok: false };
  const status = parseConsentStatus(data);
  if (status === null || status.needsDecision || status.policyAcceptedVersion !== PRIVACY_POLICY_VERSION
    || status.aiStatus !== "granted") return { ok: false };
  return { ok: true, status };
}

/**
 * Чтение для слоя кабинета: сбой клиента, RPC или формы - `null`. Решение о том, что делать при сбое, принимает
 * вызывающий (кабинет не запирается: доступ ИИ к данным закрывает база, см. 320).
 */
export async function readConsentStatusFrom(openClient: () => Promise<SupabaseClient>): Promise<ConsentStatus | null> {
  try {
    return await readConsentStatusWith(await openClient());
  } catch {
    return null;
  }
}

/** Принятие из действия формы; не бросает. */
export async function acceptConsentsFrom(
  openClient: () => Promise<SupabaseClient>,
  requestId: unknown,
): Promise<ConsentAcceptResult> {
  try {
    return await acceptConsentsWith(await openClient(), requestId);
  } catch {
    return { ok: false };
  }
}

/**
 * Куда вести студента сразу после входа или одобрения: на экран «Конфиденциальность», если решения ещё нет, иначе в
 * кабинет. Нужно действиям с мягким переходом (`redirect` из серверного действия): слой кабинета при мягком переходе
 * в его же дочернюю страницу перенаправляет в пустоту (клиент считает слой загруженным, а он прервался редиректом, и
 * бесконечно перезапрашивает экран). Прямой заход по адресу слой по-прежнему перенаправляет сам. Сбой чтения - «/portal».
 */
export async function portalTargetAfterSignIn(client: SupabaseClient): Promise<typeof CONSENT_GATE_PATH | "/portal"> {
  try {
    const status = await readConsentStatusWith(client);
    return status !== null && consentGateRequired(status) ? CONSENT_GATE_PATH : "/portal";
  } catch {
    return "/portal";
  }
}
