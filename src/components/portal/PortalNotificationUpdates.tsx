"use client";

import Link from "next/link";
import type { Locale } from "@/lib/i18n-data";
import { formatPortalString, getPortalStrings } from "@/lib/portal/i18n";
import { usePathname, useRouter } from "next/navigation";
import { startTransition, useEffect, useRef, useState } from "react";
import { loadStudentPortalNotificationState, type StudentPortalUpdateSection } from "@/lib/student-portal-notification-updates";
import { isStaleDeployment, noteStaleDeployment } from "@/lib/stale-deployment";
import { useStaleDeployment } from "@/lib/use-stale-deployment";

/** Опрос раз в минуту; возврат на вкладку — не чаще раза в 30 с (план A). */
const POLL_MS = 60_000;
const RESUME_MIN_MS = 30_000;

/** Раздел, чьи данные опрос сверяет подписью; null — только колокольчик. */
function updateSection(pathname: string): StudentPortalUpdateSection | null {
  if (pathname === "/portal/home") return "home";
  if (pathname === "/portal") return "admission";
  if (pathname === "/portal/documents") return "documents";
  if (pathname === "/portal/payments") return "payments";
  if (pathname === "/portal/notifications" || pathname.startsWith("/portal/notifications/")) return "notifications";
  return null;
}

export function PortalNotificationUpdates({ locale }: { locale: Locale }) {
  const strings = getPortalStrings("shell", locale);
  const router = useRouter();
  const pathname = usePathname();
  const [unread, setUnread] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const retry = useRef<() => void>(() => {});
  // Вкладка пережила выпуск: опрос стоит до перезагрузки, подсказку
  // показывает оболочка (PortalStaleDeploymentNotice), а не «Не удалось».
  const stale = useStaleDeployment();

  useEffect(() => {
    if (stale) return;
    let disposed = false;
    let running = false;
    let lastUpdate = 0;
    // Подпись данных раздела на момент последнего чтения. Первое чтение на
    // входе в раздел только запоминает её: содержимое уже пришло с маршрутом.
    let known: string | null = null;
    const section = updateSection(pathname);
    async function update() {
      if (disposed || running || isStaleDeployment() || document.visibilityState !== "visible") return;
      running = true;
      lastUpdate = Date.now();
      try {
        const result = await loadStudentPortalNotificationState(section);
        if (disposed) return;
        if (!result.ok) { setFailed(true); setUnread(null); return; }
        setFailed(false);
        setUnread(result.unread);
        // Раздел перечитывается, только если его данные изменились (в том
        // числе без уведомления, например одобрение). Тренажёры тестов
        // живут своим циклом сохранения.
        const changed = known !== null && result.signature !== known;
        known = result.signature;
        if (changed && section !== null) {
          startTransition(() => router.refresh());
        }
      } catch (cause) {
        if (noteStaleDeployment(cause)) { if (!disposed) setFailed(false); return; }
        if (!disposed) { setFailed(true); setUnread(null); }
      } finally {
        running = false;
      }
    }
    retry.current = () => { void update(); };
    const timer = window.setInterval(() => { void update(); }, POLL_MS);
    const resume = () => { if (Date.now() - lastUpdate >= RESUME_MIN_MS) void update(); };
    const online = () => { void update(); };
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("focus", resume);
    window.addEventListener("online", online);
    // Route entry already fetched its content: this read sets the badge and
    // the section signature.
    void update();
    return () => {
      disposed = true;
      retry.current = () => {};
      window.clearInterval(timer);
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
