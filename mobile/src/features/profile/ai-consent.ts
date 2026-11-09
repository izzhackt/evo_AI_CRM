// Согласие на ИИ-помощников (Apple 5.1.2(i), решение владельца 25.10.2026, миграции 320/345). Те же RPC и
// строгий разбор, что на вебе (`ai-consent-rpc.ts`): чтение `portal_ai_consent_get_v1`, запись
// `portal_ai_consent_set_v1` с версией текста и замороженным `p_request_id`. Ответ записи принимается,
// только если он подтверждает именно этот выбор по текущей версии текста.
import { Platform } from "react-native";
import {
  AI_CONSENT_POLICY_VERSION,
  isAiConsentStatus,
  parseAiConsent,
  type AiConsent,
  type AiConsentStatus,
} from "@web/lib/portal/ai-consent";

import { createWrite, rpcRead, rpcWrite, type FrozenWrite, type RpcTransport } from "@/lib/rpc";

export class AiConsentDecodeError extends Error {
  constructor() {
    super("ai-consent:decode");
    this.name = "AiConsentDecodeError";
  }
}

export type AiConsentSource = "ios" | "android" | "portal_web";

/**
 * Миграция 355 (на production с 09.11.2026, d53a1f0e) добавила источник `android`
 * к `portal_web` и `ios` (CHECK student_ai_consents_source_check и проверка в RPC).
 */
export const ANDROID_CONSENT_SOURCE_READY = true;

/** Единственное место выбора источника (используется и профилем, и регистрацией). */
export function aiConsentSource(os: string = Platform.OS): AiConsentSource {
  if (os === "ios") return "ios";
  if (os === "android" && ANDROID_CONSENT_SOURCE_READY) return "android";
  return "portal_web";
}

export async function readAiConsent(transport: RpcTransport): Promise<AiConsent> {
  const consent = parseAiConsent(await rpcRead(transport, "portal_ai_consent_get_v1"));
  if (!consent) throw new AiConsentDecodeError();
  return consent;
}

export function aiConsentWrite(status: AiConsentStatus, source: AiConsentSource = aiConsentSource()): FrozenWrite {
  if (!isAiConsentStatus(status)) throw new Error("ai-consent:status");
  return createWrite("portal_ai_consent_set_v1", { p_status: status, p_policy_version: AI_CONSENT_POLICY_VERSION, p_source: source });
}

export async function saveAiConsent(transport: RpcTransport, write: FrozenWrite): Promise<AiConsent> {
  const consent = parseAiConsent(await rpcWrite(transport, write));
  if (!consent || consent.status !== write.args.p_status || consent.policyVersion !== AI_CONSENT_POLICY_VERSION) {
    throw new AiConsentDecodeError();
  }
  return consent;
}
