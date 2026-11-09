// Порт чистой части `src/lib/portal/consent-gate.ts` веба (миграция 356, веб c049cd4e6). Сам модуль веба тянет
// `student-application-contract` с серверной цепочкой, которую страж общих импортов (ADR 0038) и tsc приложения
// не пускают, поэтому разбор ответа и правило показа повторены здесь; совпадение с вебом держит
// `__tests__/consent-contract-parity.test.ts`.
import { AI_CONSENT_POLICY_VERSION } from "@web/lib/portal/ai-consent";

import { STUDENT_APPLICATION_CONSENT_VERSION } from "@/features/registration/application-contract";

/** Версия текста Политики, которую принимает студент: та же, что у галочки анкеты (345). */
export const PRIVACY_POLICY_VERSION = STUDENT_APPLICATION_CONSENT_VERSION;

/** Версия текста согласия на ИИ-помощников (320). */
export const CONSENT_GATE_AI_POLICY_VERSION = AI_CONSENT_POLICY_VERSION;

export type ConsentStatus = Readonly<{
  policyVersionCurrent: string;
  policyAcceptedVersion: string | null;
  aiStatus: "granted" | "declined" | null;
  aiPolicyVersion: string | null;
  aiPolicyVersionCurrent: string;
  needsDecision: boolean;
}>;

const VERSION = /^[0-9A-Za-z._-]{1,32}$/u;

function version(value: unknown): value is string {
  return typeof value === "string" && VERSION.test(value);
}

/** Строгий разбор ответа: ровно шесть полей, любая другая форма - null (экран не выдумывает состояние). */
export function parseConsentStatus(value: unknown): ConsentStatus | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (Object.keys(row).sort().join(",")
    !== "aiPolicyVersion,aiPolicyVersionCurrent,aiStatus,needsDecision,policyAcceptedVersion,policyVersionCurrent") return null;
  if (!version(row.policyVersionCurrent) || !version(row.aiPolicyVersionCurrent) || typeof row.needsDecision !== "boolean") return null;
  if (row.policyAcceptedVersion !== null && !version(row.policyAcceptedVersion)) return null;
  if (row.aiStatus === null) {
    if (row.aiPolicyVersion !== null) return null;
  } else if (row.aiStatus !== "granted" && row.aiStatus !== "declined") {
    return null;
  } else if (!version(row.aiPolicyVersion)) {
    return null;
  }
  return {
    policyVersionCurrent: row.policyVersionCurrent,
    policyAcceptedVersion: row.policyAcceptedVersion,
    aiStatus: row.aiStatus,
    aiPolicyVersion: row.aiPolicyVersion,
    aiPolicyVersionCurrent: row.aiPolicyVersionCurrent,
    needsDecision: row.needsDecision,
  };
}

/**
 * Нужен ли экран: база говорит `needsDecision` И версии базы равны версиям этой сборки. Иначе принятие было бы
 * отвергнуто (`consent_*_version_mismatch`), а экран нельзя закрыть - расхождение версий не повод запирать кабинет.
 */
export function consentGateRequired(status: ConsentStatus): boolean {
  return status.needsDecision
    && status.policyVersionCurrent === PRIVACY_POLICY_VERSION
    && status.aiPolicyVersionCurrent === CONSENT_GATE_AI_POLICY_VERSION;
}
