// Второе обязательное согласие регистрации — на ИИ-помощников EVO (345). До подтверждения
// почты сессии нет, поэтому выбор ждёт в user_metadata.student_ai_consent_choice и
// записывается командой portal_ai_consent_set_v1 от имени студента, как это делает веб
// (src/lib/server/student-registration-ai-consent.ts). Версии и ключи берутся у веба.
import { CryptoDigestAlgorithm, digestStringAsync } from "expo-crypto";

import { aiConsentSource } from "@/features/profile/ai-consent";
import { createWrite, rpcRead, rpcWrite, type RpcTransport } from "@/lib/rpc";
import { AI_CONSENT_POLICY_VERSION } from "@web/lib/portal/ai-consent";
import { STUDENT_AI_CONSENT_METADATA_KEY } from "@/features/registration/application-contract";

export type AiConsentChoice = Readonly<{ status: "granted"; policyVersion: string; requestId: string }>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Номер запроса из номера анкеты: повтор после обрыва не пишет второе событие журнала. */
export async function registrationAiConsentChoice(questionnaireRequestId: string): Promise<AiConsentChoice> {
  const hex = await digestStringAsync(CryptoDigestAlgorithm.SHA256, `evo:registration-ai-consent:${questionnaireRequestId.toLowerCase()}`);
  return {
    status: "granted",
    policyVersion: AI_CONSENT_POLICY_VERSION,
    requestId: `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`,
  };
}

/** Выбор, сохранённый с новым аккаунтом: только целый и по текущему тексту согласия. */
export function pendingAiConsentFromMetadata(metadata: unknown): AiConsentChoice | null {
  if (typeof metadata !== "object" || metadata === null) return null;
  const value = (metadata as Record<string, unknown>)[STUDENT_AI_CONSENT_METADATA_KEY];
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const { status, policyVersion, requestId } = value as Record<string, unknown>;
  if (status !== "granted" || policyVersion !== AI_CONSENT_POLICY_VERSION) return null;
  if (typeof requestId !== "string" || !UUID.test(requestId)) return null;
  return { status, policyVersion, requestId };
}

/**
 * Записать согласие, если у студента ещё нет своего решения. Не бросает:
 * при сбое анкета уже сохранена, а решение спросит карточка в кабинете.
 */
export async function replayAiConsent(transport: RpcTransport, choice: AiConsentChoice): Promise<"written" | "decided" | "failed"> {
  try {
    const current = await rpcRead<unknown>(transport, "portal_ai_consent_get_v1");
    const status = typeof current === "object" && current !== null ? (current as Record<string, unknown>).status : undefined;
    if (typeof status === "string") return "decided";
    const write = createWrite(
      "portal_ai_consent_set_v1",
      { p_status: choice.status, p_policy_version: choice.policyVersion, p_source: aiConsentSource() },
      { requestId: choice.requestId },
    );
    await rpcWrite(transport, write);
    return "written";
  } catch {
    return "failed";
  }
}
