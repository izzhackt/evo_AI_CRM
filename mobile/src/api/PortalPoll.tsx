// Лёгкий опрос оболочки: раз в минуту на переднем плане `student_portal_poll_v1`
// (число непрочитанного для колокольчика и значка вкладки и отпечаток раздела). Смена отпечатка или
// числа перечитывает открытые экраны. Выключен в фоне и у approved (чата и ленты нет).
//
// Расписание то же, что у веба (`src/lib/light-poll.ts`, числа берутся оттуда же): после сбоя задержка удваивается (120, 240,
// 480 с, не больше 600 с) и сбрасывается первым успехом; возврат из фона опрашивает сразу, только если прошлый опрос был не
// меньше 30 с назад. Сбой виден: число сбрасывается (колокольчик без числа), `usePortalPollFailure` отдаёт признак сбоя и
// «Повторить» для карточки «Не удалось обновить уведомления»; последнее известное число и версии раздела помнятся через сбой
// (как `known` у веба), поэтому изменение за время сбоя перечитывает открытые экраны. Сбоем считается и ответ «нет доступа»
// (`access: false`): веб (`decodeLightPollRpc`) отдаёт его как 403, и карточка, сброс числа и задержка там те же. Предел ожидания
// ответа (20 с) стоит в самом транспорте (`lib/supabase.ts`, TRANSPORT_TIMEOUT_MS), как REQUEST_TIMEOUT_MS у веба.
import { POLL_BASE_MS, RESUME_MIN_GAP_MS, nextPollDelay } from "@web/lib/light-poll";
import { useQueryClient } from "@tanstack/react-query";
import { usePathname } from "expo-router";
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AppState } from "react-native";

import { readPoll } from "@/api/inbox-api";
import { usePortalApi } from "@/api/PortalApi";
import { pollSectionFor, versionChanged, type PollResult } from "@/domain/inbox-model";
import { createPoller, isForeground, type Poller } from "@/lib/poll";
import { SECTIONS, type SectionId } from "@/shell/sections";

export const POLL_INTERVAL_MS = POLL_BASE_MS;

/** Сервер ответил «нет доступа»: для расписания это сбой, как отказ 403 у веба. */
class PollDeniedError extends Error {
  constructor() {
    super("portal:poll-denied");
    this.name = "PollDeniedError";
  }
}

type PollValue = Readonly<{ unread: number | null; failed: boolean; poke: () => void; retry: () => void }>;
const PollContext = createContext<PollValue>({ unread: null, failed: false, poke: () => undefined, retry: () => undefined });

/** Число непрочитанного из последнего опроса; `null`, пока опроса не было и после сбоя. */
export function usePortalUnread(): number | null {
  return useContext(PollContext).unread;
}

/** Внеочередной опрос (после «прочитано» или отправки). */
export function usePokePoll(): () => void {
  return useContext(PollContext).poke;
}

/** Последний опрос не удался (веб: карточка «Не удалось обновить уведомления»); `retry` опрашивает сразу. */
export function usePortalPollFailure(): Readonly<{ failed: boolean; retry: () => void }> {
  const { failed, retry } = useContext(PollContext);
  return { failed, retry };
}

function sectionOf(pathname: string): SectionId | null {
  const first = pathname.split("/").filter(Boolean)[0] ?? "home";
  return SECTIONS.find((s) => s.id === first)?.id ?? null;
}

export function PortalPoll({ children }: { children: ReactNode }) {
  const { transport, tier, userKey } = usePortalApi();
  const client = useQueryClient();
  const pathname = usePathname();
  const [unread, setUnread] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const [foreground, setForeground] = useState(isForeground(AppState.currentState));
  const section = pollSectionFor(sectionOf(pathname));
  const sectionRef = useRef(section);
  const pollerRef = useRef<Poller | null>(null);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (status) => setForeground(isForeground(status)));
    return () => subscription.remove();
  }, []);

  // Опрос живёт, пока открыт кабинет assisted; фон только ставит его на паузу (см. следующий эффект).
  useEffect(() => {
    if (tier !== "assisted") return undefined;
    const last: { unread: number | null; versions: Map<string, string | null> } = { unread: null, versions: new Map() };
    const poller = createPoller({
      intervalMs: POLL_BASE_MS,
      delayAfterFailures: nextPollDelay,
      resumeMinGapMs: RESUME_MIN_GAP_MS,
      run: async () => {
        const current = sectionRef.current;
        let result: PollResult;
        try {
          result = await readPoll(transport, current);
        } catch (error) {
          // Как у веба: число для колокольчика сбрасывается, показывается карточка сбоя; планировщик удлиняет задержку. Последнее
          // известное число (`last.unread`) остаётся: как `known` у веба, оно живёт через сбои, и если за время сбоя число изменилось,
          // первый успех перечитывает открытые экраны.
          setUnread(null);
          setFailed(true);
          throw error;
        }
        if (!result.access) {
          // Как у веба: «нет доступа» - это отказ (403): число для колокольчика сброшено, карточка сбоя, планировщик удлиняет задержку;
          // последнее известное число, как после любого сбоя, остаётся.
          setUnread(null);
          setFailed(true);
          throw new PollDeniedError();
        }
        setFailed(false);
        const changed = last.unread !== null && last.unread !== result.unread;
        const versionMoved = versionChanged(last.versions.get(current), result.version);
        last.unread = result.unread;
        last.versions.set(current, result.version);
        setUnread(result.unread);
        if (changed || versionMoved) {
          void client.invalidateQueries({ queryKey: ["portal", userKey], refetchType: "active" });
        }
      },
    });
    pollerRef.current = poller;
    // Первый опрос сразу и по расписанию (его сбой удлиняет задержку, как у веба); в фоне только пауза.
    poller.start({ immediate: isForeground(AppState.currentState) });
    if (!isForeground(AppState.currentState)) poller.pause();
    return () => {
      poller.stop();
      if (pollerRef.current === poller) pollerRef.current = null;
    };
  }, [transport, tier, client, userKey]);

  // Фон: пауза. Возврат: опрос сразу, если прошлый был не меньше 30 с назад, иначе обычный отсчёт.
  useEffect(() => {
    const poller = pollerRef.current;
    if (!poller) return;
    if (foreground) poller.resume();
    else poller.pause();
  }, [foreground]);

  useEffect(() => {
    if (sectionRef.current === section) return;
    sectionRef.current = section;
    pollerRef.current?.poke();
  }, [section]);

  const value = useMemo<PollValue>(
    () => ({ unread, failed, poke: () => pollerRef.current?.poke(), retry: () => pollerRef.current?.poke() }),
    [unread, failed],
  );
  return <PollContext.Provider value={value}>{children}</PollContext.Provider>;
}
