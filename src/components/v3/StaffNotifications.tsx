"use client";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icons";
import { loadStaffNotificationsAction, markStaffNotificationReadAction } from "@/lib/v3/staff-notification-actions";
import type { StaffNotification, StaffNotificationCursor, StaffNotificationPage } from "@/lib/platform-staff-notifications-contract";

const TITLES = { task_assigned: "Вам назначили задачу", task_updated: "Изменилась ваша задача", chat_mention: "Вас упомянули в чате" };
const TIME = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bishkek" });
const CONTROL = "min-h-11 rounded-ctl border border-control-edge px-3 text-sm text-fg-2 hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring";

export function StaffNotifications({ initialPage }: { initialPage: StaffNotificationPage | null }) {
  const router = useRouter();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState<StaffNotificationPage | null>(initialPage);
  const [error, setError] = useState<string | null>(initialPage ? null : "Уведомления пока недоступны. Повторите загрузку.");
  const [busy, setBusy] = useState(false);
  const serial = useRef(0);
  const toggle = useRef<HTMLButtonElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const invalidate = useCallback(() => { serial.current++; }, []);

  const load = useCallback(async (cursor: StaffNotificationCursor | null = null) => {
    const request = ++serial.current;
    try {
      const result = await loadStaffNotificationsAction(cursor);
      if (serial.current !== request) return;
      if (!result.ok) { setError(result.message); setPage(null); return; }
      setError(null);
      setPage((previous) => cursor && previous ? {
        ...result.page,
        items: [...previous.items, ...result.page.items.filter((item) => !previous.items.some((old) => old.id === item.id))],
      } : result.page);
    } catch {
      if (serial.current === request) { setError("Нет связи. Повторите загрузку уведомлений."); setPage(null); }
    } finally { if (serial.current === request) setBusy(false); }
  }, []);

  useEffect(() => {
    const refresh = () => { if (!open && document.visibilityState === "visible") void load(); };
    const timer = window.setInterval(refresh, 60000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, [load, open]);
  useEffect(() => () => invalidate(), [invalidate]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false); };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);

  async function openItem(item: StaffNotification) {
    setBusy(true);
    try {
      const result = await markStaffNotificationReadAction(item.id);
      if (!result.ok) { setError(result.message ?? "Уведомление недоступно."); return; }
      setOpen(false); router.push(item.href);
    } catch { setError("Не удалось открыть уведомление. Повторите."); }
    finally { setBusy(false); }
  }
  const count = page?.unreadCount;
  return (
    <div ref={root} className="relative" onKeyDown={(event) => {
      if (event.key === "Escape" && open) { event.stopPropagation(); setOpen(false); toggle.current?.focus(); }
    }}>
      <button ref={toggle} type="button" aria-expanded={open} aria-controls={id}
        aria-label={count && count !== "0" ? `Уведомления: ${count} непрочитанных` : "Уведомления"}
        className={`${CONTROL} flex items-center gap-2`} onClick={() => { if (!open) { setBusy(true); void load(); } setOpen((value) => !value); }}>
        <Icon name="bell" size={18} /><span className="hidden sm:inline">Уведомления</span>
        {count && count !== "0" ? <span className="rounded-full bg-accent px-2 text-xs text-on-accent">{BigInt(count) > BigInt(99) ? "99+" : count}</span> : null}
      </button>
      {open ? <section id={id} aria-label="Уведомления сотрудников" aria-busy={busy}
        className="absolute end-0 top-full z-40 mt-2 max-h-[70dvh] w-[min(24rem,calc(100vw-2rem))] overflow-y-auto rounded-card border border-border bg-surface p-4 shadow-lg">
        <div className="flex items-center justify-between gap-3"><h2 className="font-semibold text-fg">Уведомления</h2>
          <button type="button" className={CONTROL} disabled={busy} onClick={() => { setBusy(true); void load(); }}>Обновить</button></div>
        <p className="mt-2 text-sm text-fg-3">Задачи и упоминания. Время — Бишкек.</p>
        {error ? <p role="alert" className="my-3 text-sm text-danger">{error}</p> : null}
        {busy && !page ? <p role="status" className="py-6 text-sm text-fg-2">Загружаем…</p> : null}
        {page?.items.length === 0 ? <p className="py-6 text-sm text-fg-2">Новых событий пока нет.</p> : null}
        <ul className="mt-3 divide-y divide-border">{page?.items.map((item) => <li key={item.id}>
          <button type="button" disabled={busy} onClick={() => void openItem(item)}
            className="min-h-11 w-full rounded-nav py-3 text-start focus-visible:outline-2 focus-visible:outline-focus-ring">
            <span className={`block text-sm ${item.readAt ? "text-fg-2" : "font-semibold text-fg"}`}>{TITLES[item.kind]}</span>
            <span className="mt-1 block text-xs text-fg-3">{TIME.format(new Date(item.createdAt))}{item.readAt ? " · Прочитано" : " · Не прочитано"}</span>
          </button>
        </li>)}</ul>
        {page?.nextCursor ? <button type="button" disabled={busy} className={`${CONTROL} mt-3 w-full`} onClick={() => { setBusy(true); void load(page.nextCursor); }}>Раньше</button> : null}
      </section> : null}
    </div>
  );
}
