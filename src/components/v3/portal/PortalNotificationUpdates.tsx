"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { startTransition, useEffect, useRef, useState } from "react";
import { loadStudentPortalNotificationState } from "@/lib/student-portal-notification-updates";

export function PortalNotificationUpdates() {
  const router = useRouter();
  const pathname = usePathname();
  const [unread, setUnread] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const retry = useRef<() => void>(() => {});

  useEffect(() => {
    let disposed = false;
    let running = false;
    const refreshPage = ["/portal", "/portal/documents", "/portal/applications", "/portal/payments", "/portal/notifications"].includes(pathname)
      || pathname.startsWith("/portal/notifications/");
    async function update() {
      if (disposed || running || document.visibilityState !== "visible") return;
      running = true;
      try {
        const result = await loadStudentPortalNotificationState();
        if (disposed) return;
        if (!result.ok) { setFailed(true); return; }
        setFailed(false);
        setUnread(result.unread);
        // Refresh operational pages even when no notification was emitted (for
        // example, approval). Assessment runners keep their own save lifecycle.
        if (refreshPage) {
          startTransition(() => router.refresh());
        }
      } catch {
        if (!disposed) setFailed(true);
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
    void update();
    return () => {
      disposed = true;
      retry.current = () => {};
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("focus", resume);
      window.removeEventListener("online", resume);
    };
  }, [pathname, router]);

  return (
    <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-1 border-b border-border px-4 py-1 sm:px-6">
      <Link href="/portal/notifications" className="inline-flex min-h-11 items-center text-sm font-medium text-accent-text underline">
        <span aria-live="polite">{unread === null ? "Уведомления" : unread > 0 ? `Новых уведомлений: ${unread}` : "Новых уведомлений нет"}</span>
      </Link>
      {failed ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <p role="alert" className="text-danger">Не удалось обновить уведомления.</p>
          <button type="button" className="min-h-11 font-medium text-accent-text underline" onClick={() => retry.current()}>
            Повторить
          </button>
        </div>
      ) : null}
    </div>
  );
}
