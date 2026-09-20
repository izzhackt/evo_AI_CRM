"use client";

import Link from "next/link";
import type { Locale } from "@/lib/i18n-data";
import { formatPortalString, getPortalStrings } from "@/lib/portal/i18n";
import { usePathname, useRouter } from "next/navigation";
import { startTransition, useEffect, useRef, useState } from "react";
import { loadStudentPortalNotificationState } from "@/lib/student-portal-notification-updates";

export function PortalNotificationUpdates({ locale }: { locale: Locale }) {
  const strings = getPortalStrings("shell", locale);
  const router = useRouter();
  const pathname = usePathname();
  const [unread, setUnread] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const retry = useRef<() => void>(() => {});

  useEffect(() => {
    let disposed = false;
    let running = false;
    const refreshPage = ["/portal/home", "/portal", "/portal/documents", "/portal/applications", "/portal/payments", "/portal/notifications"].includes(pathname)
      || pathname.startsWith("/portal/notifications/");
    async function update(refreshContent = true) {
      if (disposed || running || document.visibilityState !== "visible") return;
      running = true;
      try {
        const result = await loadStudentPortalNotificationState();
        if (disposed) return;
        if (!result.ok) { setFailed(true); setUnread(null); return; }
        setFailed(false);
        setUnread(result.unread);
        // Refresh operational pages even when no notification was emitted (for
        // example, approval). Assessment runners keep their own save lifecycle.
        if (refreshContent && refreshPage) {
          startTransition(() => router.refresh());
        }
      } catch {
        if (!disposed) { setFailed(true); setUnread(null); }
      } finally {
        running = false;
      }
    }
    retry.current = () => { void update(); };
    const timer = window.setInterval(() => { void update(); }, 30_000);
    const resume = () => { void update(); };
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("focus", resume);
    window.addEventListener("online", resume);
    // Route entry already fetched its content. Read the badge now, but only
    // periodic/resume/manual updates need another operational-page render.
    void update(false);
    return () => {
      disposed = true;
      retry.current = () => {};
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("focus", resume);
      window.removeEventListener("online", resume);
    };
  }, [pathname, router]);


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
      {failed ? (
        <div className="pt-notification-error">
          <p role="alert">{strings.notificationsFailed}</p>
          <button type="button" className="pt-link" onClick={() => retry.current()}>{strings.notificationsRetry}</button>
        </div>
      ) : null}
    </div>
  );
}
