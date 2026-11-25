// Что решает, показывать ли «Подбор с Эви» и пускать ли в него. Двойник решений страницы «Профессии» веба (professions/page.tsx):
// - `eviOnline` - на сервере есть ключ Эви: приложение спрашивает его GET-ом того же маршрута (`useEviAvailable`);
// - `eviAvailable(consent)` - согласие на ИИ-помощников не отозвано; сбой чтения согласия Эви не прячет, сервер проверит его сам;
// - `?view=evi` без согласия ведёт в каталог (`useEviGate`: то же чтение согласия, что у карточки-входа на «Профессиях»).
// Всё, что не удалось узнать, ведёт себя как раньше: Эви показана, ответит или откажет сервер.
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { aiConsentState } from "@web/lib/portal/ai-consent";

import { usePortalApi } from "@/api/PortalApi";
import { createEviApi, type EviApi } from "@/features/learning/evi/api";
import { useAiConsent } from "@/features/profile/use-profile";

/** Клиент маршрута Эви кабинета (или подмена из проверки). */
export function useEviApi(injected?: EviApi): EviApi {
  const { portalBaseUrl, getAccessToken, refreshAccessToken } = usePortalApi();
  return useMemo(
    () => injected ?? createEviApi({ baseUrl: portalBaseUrl, getToken: getAccessToken, refreshToken: refreshAccessToken }),
    [injected, portalBaseUrl, getAccessToken, refreshAccessToken],
  );
}

/** Ответ сервера живёт пять минут; «не узнали» - полминуты, чтобы короткий сбой не прятал настоящий ответ на весь сеанс. */
const KNOWN_FRESH_MS = 5 * 60_000;
const UNKNOWN_FRESH_MS = 30_000;

/** Есть ли у сервера ключ Эви: `true` / `false`, пока не ответил или не удалось узнать - `null` (ведём себя как прежде). */
export function useEviAvailable(injected?: EviApi): boolean | null {
  const { userKey } = usePortalApi();
  const evi = useEviApi(injected);
  const query = useQuery({
    queryKey: ["portal", userKey, "evi-available"],
    queryFn: async () => (evi.available ? await evi.available() : null),
    staleTime: (current) => (typeof current.state.data === "boolean" ? KNOWN_FRESH_MS : UNKNOWN_FRESH_MS),
    retry: false,
    refetchOnWindowFocus: false,
  });
  return query.data ?? null;
}

/**
 * Вход в Эви показан, когда ключ есть (или не узнали) и согласие не отозвано (или не прочиталось). Нет согласия на ИИ-помощников
 * у студента, которому вопрос задают (`aiConsentInProfile`), - Эви не показывается, как на вебе.
 */
export function useEviEntry(injected?: EviApi): Readonly<{ shown: boolean }> {
  const consent = useAiConsent();
  const available = useEviAvailable(injected);
  const revoked = consent.data !== undefined && aiConsentState(consent.data) !== "granted";
  return { shown: !revoked && available !== false };
}

export type EviGate = Readonly<{
  /** `checking` - согласие ещё читается; `redirect` - отозвано, экран уходит в каталог; `open` - чат. */
  state: "checking" | "open" | "redirect";
  /** Ключа нет: чат открывается сразу с «Эви сейчас недоступен» и «Открыть каталог», поле закрыто. */
  offline: boolean;
}>;

/** Решение для экрана самой Эви. Сбой чтения согласия не запирает чат: ждём только первую попытку, остальное решит сервер. */
export function useEviGate(injected?: EviApi): EviGate {
  const consent = useAiConsent();
  const available = useEviAvailable(injected);
  if (consent.data !== undefined && aiConsentState(consent.data) !== "granted") return { state: "redirect", offline: false };
  const reading = consent.isPending && consent.fetchStatus !== "idle" && consent.failureCount === 0;
  return { state: reading ? "checking" : "open", offline: available === false };
}
