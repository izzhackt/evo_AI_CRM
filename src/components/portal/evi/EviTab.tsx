import { aiConsentState, type AiConsentRead } from "@/lib/portal/ai-consent";
import type { PortalStrings } from "@/lib/portal/i18n";

import { EviChat } from "./EviChat";
import { EviConsentGate } from "./EviConsentGate";

/**
 * Вкладка «Подбор с Эви». Ученик без действующего согласия на ИИ-помощников видит одну кнопку «Разрешить»; сбой
 * чтения согласия чат не прячет — сервер разговора проверяет согласие заново перед каждым ответом. Разговор с
 * моделью подключается отдельным шагом (решение владельца 16.11.2026: сначала интерфейс); до этого чат `offline`:
 * с первого экрана «Эви сейчас недоступен» и «Открыть каталог», поле закрыто (17.11.2026). С моделью `offline` → `ask`.
 */
export function EviTab({ consent, strings }: Readonly<{
  consent: AiConsentRead;
  strings: PortalStrings<"professions">;
}>) {
  if (consent.status === "ready" && aiConsentState(consent.consent) !== "granted") {
    return <EviConsentGate strings={strings} />;
  }
  return <EviChat strings={strings} offline />;
}
