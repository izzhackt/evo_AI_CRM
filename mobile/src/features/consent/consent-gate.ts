// Экран «Конфиденциальность» при первом входе (решение владельца 09.11.2026, миграция 356, веб c049cd4e6 и 4b682db96).
// Те же две команды, версии и строгий разбор, что у веба (`@/features/consent/consent-contract`): принятие считается
// успешным, только если ответ подтверждает Политику и «разрешено» для ИИ по текущим версиям и больше не просит решения.
import {
  CONSENT_GATE_AI_POLICY_VERSION,
  PRIVACY_POLICY_VERSION,
  parseConsentStatus,
  type ConsentStatus,
} from "@/features/consent/consent-contract";

import { aiConsentSource, type AiConsentSource } from "@/features/profile/ai-consent";
import { createWrite, rpcWrite, type FrozenWrite, type RpcTransport } from "@/lib/rpc";

export class ConsentDecodeError extends Error {
  constructor() {
    super("consent-gate:decode");
    this.name = "ConsentDecodeError";
  }
}

/** Принятие обеих галочек. `p_request_id` создаётся здесь один раз; повтор шлёт тот же замороженный запрос. */
export function consentAcceptWrite(source: AiConsentSource = aiConsentSource(), newId?: () => string): FrozenWrite {
  return createWrite(
    "portal_consents_accept_v1",
    { p_policy_version: PRIVACY_POLICY_VERSION, p_ai_policy_version: CONSENT_GATE_AI_POLICY_VERSION, p_source: source },
    newId ? { newId } : {},
  );
}

export function isConsentAccepted(status: ConsentStatus | null): status is ConsentStatus {
  return status !== null && !status.needsDecision && status.policyAcceptedVersion === PRIVACY_POLICY_VERSION && status.aiStatus === "granted";
}

/** Отправить принятие. Чужой или не подтверждающий ответ - `ConsentDecodeError` (ничего не считается принятым). */
export async function acceptConsents(transport: RpcTransport, write: FrozenWrite): Promise<ConsentStatus> {
  const status = parseConsentStatus(await rpcWrite(transport, write));
  if (!isConsentAccepted(status)) throw new ConsentDecodeError();
  return status;
}
