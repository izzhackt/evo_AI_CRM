"use client";

import Link from "next/link";
import type { Locale } from "@/lib/i18n-data";
import { formatPortalString, getPortalStrings } from "@/lib/portal/i18n";
import { usePathname, useRouter } from "next/navigation";
import { startTransition, useEffect, useRef, useState } from "react";
import { POLL_BASE_MS, createLightPoller, fetchLightPoll } from "@/lib/light-poll";
import { PORTAL_MESSAGES_CHANGED_EVENT, portalPollSectionForPath, portalPollUrl } from "@/lib/portal-poll-section";
import { isStaleDeployment, noteServerRelease } from "@/lib/stale-deployment";
import { useStaleDeployment } from "@/lib/use-stale-deployment";

/**
 * Опрос кабинета (A4, docs/PLAN_CHANGES.md 19.10.2026): один GET раз в минуту
 * с одним RPC. Он отдаёт число непрочитанных и версию данных раздела;
 * страница перечитывается (`router.refresh()`) только при смене версии, а
 * переписка читает свою страницу сама, когда меняется её версия. Расписание,
 * задержка после сбоев, скрытая вкладка и фокус — в `light-poll.ts`.
 * Устаревшую сборку узнаёт `noteServerRelease`: сервер в ответе называет
 * свою ревизию, и она сравнивается с ревизией страницы.
 */
export function PortalNotificationUpdates({ locale, release }: { locale: Locale; release?: string | null }) {
  const strings = getPortalStrings("shell", locale);
  const router = useRouter();
  const pathname = usePathname();
  const [unread, setUnread] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const retry = useRef<() => void>(() => {});
  const unreadKnown = useRef(false);
  const lastPoll = useRef(0);
  // Вкладка пережила выпуск: опрос стоит до перезагрузки, подсказку
  // показывает оболочка (PortalStaleDeploymentNotice), а не «Не удалось».
  const stale = useStaleDeployment();

  // Ревизия страницы запоминается один раз за загрузку (модуль), не от обновлений.
  useEffect(() => { noteServerRelease(release ?? null); }, [release]);

  useEffect(() => {
    if (stale) return;
    const section = portalPollSectionForPath(pathname);
    const url = portalPollUrl(section);
    const poller = createLightPoller({
      now: () => Date.now(),
      setTimer: (callback, delay) => window.setTimeout(callback, delay),
      clearTimer: (handle) => window.clearTimeout(handle as number),
      isVisible: () => document.visibilityState === "visible",
      isStale: isStaleDeployment,
      fetchState: (signal) => fetchLightPoll(url, signal),
      onRelease: (serverRelease) => { noteServerRelease(serverRelease); },
      onState: (state) => { lastPoll.current = Date.now(); unreadKnown.current = true; setFailed(false); setUnread(state.unread); },
      onFailure: () => { lastPoll.current = Date.now(); setFailed(true); setUnread(null); unreadKnown.current = false; },
      onChange: () => {
        if (section === "messages") window.dispatchEvent(new Event(PORTAL_MESSAGES_CHANGED_EVENT));
        else if (section !== null) startTransition(() => router.refresh());
      },
    });
    retry.current = poller.retry;
    const resume = () => poller.resume();
    const online = () => poller.online();
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("focus", resume);
    window.addEventListener("online", online);
    // Раздел с версией сверяется сразу, чтобы запомнить её; остальным страницам
    // хватает числа, которое опрос получил в последнюю минуту.
    poller.start({ immediate: section !== null || !unreadKnown.current || Date.now() - lastPoll.current >= POLL_BASE_MS });
    return () => {
      poller.stop();
      retry.current = () => {};
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("focus", resume);
      window.removeEventListener("online", online);
    };
  }, [pathname, router, stale]);

  const label = unread === null ? strings.notifications
    : unread > 0 ? formatPortalString(strings.notificationsUnread, { count: String(unread) })
      : strings.notificationsNone;

  return (
    <div className="pt-notification-updates">
      <Link href="/portal/notifications" className="pt-bell" aria-label={label}>
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <path d="M10 3a4.5 4.5 0 0 1 4.5 4.5c0 3.2 1 4.5 1.5 5H4c.5-.5 1.5-1.8 1.5-5A4.5 4.5 0 0 1 10 3zM8.5 15.5a1.5 1.5 0 0 0 3 0"
            stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {unread !== null && unread > 0 ? <span className="pt-notification-count" aria-hidden="true">{unread > 99 ? "99+" : unread}</span> : null}
      </Link>
      <span className="pt-sr-only" role="status">{label}</span>
      {failed && !stale ? (
        <div className="pt-notification-error">
          <p role="alert">{strings.notificationsFailed}</p>
          <button type="button" className="pt-link" onClick={() => retry.current()}>{strings.notificationsRetry}</button>
        </div>
      ) : null}
    </div>
  );
}
