import { AiConsentHomeCard } from "@/components/portal/consent/AiConsent";
import type { Locale } from "@/lib/i18n-data";
import { readOwnAiConsent } from "@/lib/portal/ai-consent-source";
import { getPortalStrings } from "@/lib/portal/i18n";

/**
 * Карточка согласия на ИИ-помощников на «Моём поступлении» (/portal): после
 * логина студент попадает сюда, а не на «Главную», поэтому вопрос задаём и
 * здесь (решение владельца 25.10.2026, ревью веб-потока). Это отдельный
 * серверный компонент-сосед: его чтение идёт одновременно с чтениями экрана,
 * а сбой RPC прячет карточку и не трогает остальной экран. Пока решения нет,
 * внутри лежит та же `AiConsentHomeCard`, что на «Главной»; когда карточки
 * нет, слот пуст и не занимает места (`.pt-consent-slot:empty`).
 */
export async function AiConsentSlot({ locale }: Readonly<{ locale: Locale }>) {
  const read = await readOwnAiConsent();
  return (
    <div className="pt-consent-slot">
      {read.status === "ready" ? (
        <AiConsentHomeCard
          initialConsent={read.consent}
          strings={getPortalStrings("aiConsent", locale)}
        />
      ) : null}
    </div>
  );
}
