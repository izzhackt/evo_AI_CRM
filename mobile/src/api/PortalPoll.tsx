// Лёгкий опрос оболочки: раз в минуту на переднем плане `student_portal_poll_v1`
// (число непрочитанного для значка вкладки и отпечаток раздела). Смена отпечатка или
// числа перечитывает открытые экраны. Выключен в фоне и у approved (чата и ленты нет).
import { useQueryClient } from "@tanstack/react-query";
import { usePathname } from "expo-router";
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AppState } from "react-native";

import { readPoll } from "@/api/inbox-api";
import { usePortalApi } from "@/api/PortalApi";
import { pollSectionFor, versionChanged } from "@/domain/inbox-model";
import { createPoller, isForeground } from "@/lib/poll";
import { SECTIONS, type SectionId } from "@/shell/sections";

export const POLL_INTERVAL_MS = 60_000;

type PollValue = Readonly<{ unread: number | null; poke: () => void }>;
const PollContext = createContext<PollValue>({ unread: null, poke: () => undefined });

/** Число непрочитанного из последнего опроса; `null`, пока опроса не было. */
export function usePortalUnread(): number | null {
  return useContext(PollContext).unread;
}

/** Внеочередной опрос (после «прочитано» или отправки). */
export function usePokePoll(): () => void {
  return useContext(PollContext).poke;
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
  const [foreground, setForeground] = useState(isForeground(AppState.currentState));
  const section = pollSectionFor(sectionOf(pathname));
  const sectionRef = useRef(section);
  const pokeRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (status) => setForeground(isForeground(status)));
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (tier !== "assisted" || !foreground) return undefined;
    const last: { unread: number | null; versions: Map<string, string | null> } = { unread: null, versions: new Map() };
    const poller = createPoller({
      intervalMs: POLL_INTERVAL_MS,
      run: async () => {
        const current = sectionRef.current;
        const result = await readPoll(transport, current);
        if (!result.access) return;
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
    pokeRef.current = () => poller.poke();
    poller.start();
    poller.poke();
    return () => {
      poller.stop();
      pokeRef.current = () => undefined;
    };
  }, [transport, tier, foreground, client, userKey]);

  useEffect(() => {
    if (sectionRef.current === section) return;
    sectionRef.current = section;
    pokeRef.current();
  }, [section]);

  const value = useMemo<PollValue>(() => ({ unread, poke: () => pokeRef.current() }), [unread]);
  return <PollContext.Provider value={value}>{children}</PollContext.Provider>;
}
