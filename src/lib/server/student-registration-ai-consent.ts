import "server-only";

import { createHash } from "node:crypto";

import type { SupabaseClient, User } from "@supabase/supabase-js";

import { AI_CONSENT_POLICY_VERSION, isAiConsentRequestId } from "../portal/ai-consent";
import { writeAiConsentWith } from "../portal/ai-consent-rpc";
import { STUDENT_AI_CONSENT_METADATA_KEY } from "../student-application-contract";

/**
 * Вторая обязательная галочка регистрации (345, решение пользователя 07.11.2026): согласие на ИИ-помощников пишется
 * той же командой 320, что карточка кабинета, от имени самого студента и по той же версии текста. Номер запроса
 * выводится из номера анкеты, поэтому повтор после сбоя сети не пишет второе событие журнала.
 */
export type RegistrationAiConsentChoice = Readonly<{ status: "granted"; policyVersion: string; requestId: string }>;

export function registrationAiConsentChoice(questionnaireRequestId: string): RegistrationAiConsentChoice {
  const hex = createHash("sha256").update(`evo:registration-ai-consent:${questionnaireRequestId.toLowerCase()}`).digest("hex");
  return {
    status: "granted",
    policyVersion: AI_CONSENT_POLICY_VERSION,
    requestId: `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`,
  };
}

/**
 * Выбор, сохранённый с новым аккаунтом до подтверждения почты. Только целый и по текущему тексту: выбор по другой
 * версии не пишется, тогда спросит карточка в кабинете.
 */
export function pendingRegistrationAiConsent(user: Pick<User, "user_metadata">): RegistrationAiConsentChoice | null {
  const value = user.user_metadata?.[STUDENT_AI_CONSENT_METADATA_KEY];
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const { status, policyVersion, requestId } = value as Record<string, unknown>;
  if (status !== "granted" || policyVersion !== AI_CONSENT_POLICY_VERSION || !isAiConsentRequestId(requestId)) return null;
  return { status, policyVersion, requestId };
}

/** Запись от имени вошедшего студента; true — только когда база подтвердила именно это решение. Не бросает. */
export async function recordRegistrationAiConsent(client: SupabaseClient, choice: RegistrationAiConsentChoice): Promise<boolean> {
  try {
    return (await writeAiConsentWith(client, choice.status, choice.requestId)).ok;
  } catch {
    return false;
  }
}
