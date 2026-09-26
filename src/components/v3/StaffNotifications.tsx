"use client";
import { useCallback, useEffect, useId, useRef, useState, type ButtonHTMLAttributes } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icons";
import { placeMenu } from "@/components/v3/board/menu-position";
import { loadStaffNotificationsAction, markAllStaffNotificationsReadAction, markStaffNotificationReadAction } from "@/lib/v3/staff-notification-actions";
import type { StaffNotification, StaffNotificationCursor, StaffNotificationPage } from "@/lib/platform-staff-notifications-contract";
import { dayInOrganizationTimezone, projectPlatformTaskDeadline } from "@/lib/platform-task-deadline";
import { caseMessageNotificationCopy } from "@/components/v3/staff-notification-copy";

const TIME = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bishkek" });
const EXACT_TIME = new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bishkek" });
const DATE_ONLY = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", timeZone: "Asia/Bishkek" });
const CONTROL = "min-h-11 rounded-ctl border border-control-edge px-3 text-sm text-fg-2 hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring";
/**
 * Новый облик (Э1.2, временно до Э1.5): колокольчик — квадратная кнопка в
 * боковом меню и в листе «Ещё», число — на ней; панель живёт в верхнем слое
 * (popover), поэтому ни меню, ни лист её не обрезают.
 */
const MENU_TRIGGER = "v3-raised relative flex size-11 shrink-0 items-center justify-center rounded-ctl border border-control-edge bg-surface text-fg-2 hover:bg-surface-2 hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring";
const PHONE_MEDIA = "(width < 48rem)";

function addDaysToIsoDate(day: string, delta: number): string {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, date + delta)).toISOString().slice(0, 10);
}

/** task_due row label, computed from the row's own subjectDueOn/subjectDueAt
 * against now in the org timezone (Asia/Bishkek) via the shared deadline
 * projection -- never a hardcoded "Завтра" regardless of the actual due. */
function taskDueLabel(item: StaffNotification, now: Date): string {
  const projection = projectPlatformTaskDeadline(item.subjectDueOn, item.subjectDueAt, now);
  if (projection.day === null) return "Срок задачи";
  const today = dayInOrganizationTimezone(now);
  const tomorrow = addDaysToIsoDate(today, 1);
  const date = DATE_ONLY.format(new Date(`${projection.day}T00:00:00Z`));
  const time = item.subjectDueAt ? ` в ${EXACT_TIME.format(new Date(item.subjectDueAt))}` : "";
  if (projection.overdue) return `Срок задачи прошёл (${date}${time})`;
  if (projection.day === tomorrow) return `Срок задачи завтра${time}`;
  if (projection.day === today) return `Срок задачи сегодня${time}`;
  return `Срок задачи ${date}${time}`;
}

/** Row copy is built from kind + read-time enrichment; a fixed phrase is the
 * fallback only when the actor or subject could not be resolved. */
function rowCopy(item: StaffNotification): string {
  switch (item.kind) {
    case "task_assigned":
      return item.actorDisplayName && item.subjectTitle
        ? `${item.actorDisplayName} назначил(а) вам задачу «${item.subjectTitle}»`
        : "Вам назначили задачу";
    case "task_updated":
      return item.actorDisplayName && item.subjectTitle
        ? `${item.actorDisplayName} изменил(а) вашу задачу «${item.subjectTitle}»`
        : "Изменилась ваша задача";
    case "case_task_assigned":
      return item.actorDisplayName && item.subjectTitle
        ? `${item.actorDisplayName} назначил(а) задачу «${item.subjectTitle}»${item.studentDisplayName ? ` · ${item.studentDisplayName}` : ""}`
        : "Вам назначили задачу по делу студента";
    case "task_due": {
      const prefix = taskDueLabel(item, new Date());
      return item.subjectTitle ? `${prefix} «${item.subjectTitle}»` : prefix;
    }
    case "chat_mention":
      return item.actorDisplayName ? `${item.actorDisplayName} упомянул(а) вас в чате` : "Вас упомянули в чате";
    case "case_help":
      return item.studentDisplayName ? `Новое обращение по делу студента · ${item.studentDisplayName}` : "Новое обращение по делу студента";
    case "case_message":
      return caseMessageNotificationCopy(item.actorDisplayName, item.studentDisplayName);
    default:
      return "Событие";
  }
}

export function StaffNotifications({ initialPage, variant = "bar", onCountChange, triggerProps }: {
  initialPage: StaffNotificationPage | null;
  /** «bar» — верхняя панель прежнего облика; «menu» — меню нового облика (Э1.2). */
  variant?: "bar" | "menu";
  /** Новый облик: число непрочитанных для «Ещё» нижней панели телефона. */
  onCountChange?: (count: string | undefined) => void;
  /** Новый облик: подпись рейки при наведении и фокусе. */
  triggerProps?: Pick<ButtonHTMLAttributes<HTMLButtonElement>, "onPointerEnter" | "onPointerLeave" | "onFocus" | "onBlur">;
}) {
  const router = useRouter();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [page, setPage] = useState<StaffNotificationPage | null>(initialPage);
  const [error, setError] = useState<string | null>(initialPage ? null : "Уведомления пока недоступны.");
  const [busy, setBusy] = useState(false);
  const serial = useRef(0);
  const toggle = useRef<HTMLButtonElement>(null);
  const root = useRef<HTMLDivElement>(null);
  // Shared in-flight guard for both mutations below (mark-all and the
  // single-item mark-read in openItem): while either is pending, the polling
  // refresh must not fetch a stale snapshot that could overwrite that
  // mutation's own optimistic local state change.
  const mutationsInFlight = useRef(0);
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
    // Live also while open, but never mid-flight of a mark-read/mark-all
    // command: a background refresh landing between click and navigation
    // must not clobber that command's own local state change.
    const refresh = () => { if (document.visibilityState === "visible" && mutationsInFlight.current === 0) void load(); };
    const timer = window.setInterval(refresh, 60000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, [load]);
  useEffect(() => () => invalidate(), [invalidate]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false); };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);

  async function openItem(item: StaffNotification) {
    setBusy(true); mutationsInFlight.current++;
    try {
      const result = await markStaffNotificationReadAction(item.id);
      if (!result.ok) { setError(result.message ?? "Уведомление недоступно."); return; }
      setPage((previous) => previous && !previous.items.some((row) => row.id === item.id) ? previous : previous ? {
        ...previous, items: previous.items.map((row) => row.id === item.id ? { ...row, readAt: row.readAt ?? new Date().toISOString() } : row),
      } : previous);
      setOpen(false); router.push(item.href);
    } catch { setError("Не удалось открыть уведомление. Повторите."); }
    finally { mutationsInFlight.current--; setBusy(false); }
  }
  async function markAll() {
    setMenuOpen(false); mutationsInFlight.current++; setBusy(true);
    try {
      const result = await markAllStaffNotificationsReadAction();
      if (!result.ok) { setError(result.message ?? "Не удалось отметить уведомления прочитанными."); return; }
      await load();
    } catch { setError("Не удалось отметить уведомления прочитанными. Повторите."); }
    finally { mutationsInFlight.current--; setBusy(false); }
  }
  const count = page?.unreadCount;
  const failed = error !== null;
  useEffect(() => { onCountChange?.(count); }, [count, onCountChange]);
  const menu = variant === "menu";
  // Новый облик: панель в верхнем слое у своей кнопки — справа от бокового
  // меню, на телефоне — под кнопкой в листе «Ещё».
  const panel = useRef<HTMLElement | null>(null);
  const placePanel = useCallback(() => {
    const trigger = toggle.current;
    const element = panel.current;
    if (!trigger || !element) return;
    const box = trigger.getBoundingClientRect();
    const phone = window.matchMedia(PHONE_MEDIA).matches;
    // На компьютере — справа от самого меню, а не от кнопки: панель не наезжает на его край.
    const edge = phone ? null : trigger.closest("nav")?.getBoundingClientRect().right ?? null;
    const position = placeMenu(
      { top: box.top, bottom: box.bottom, left: box.left, right: edge === null ? box.right : Math.max(box.right, edge) },
      { width: element.offsetWidth, height: element.scrollHeight },
      { width: window.innerWidth, height: window.innerHeight },
      phone ? "bottom-end" : "right-start",
    );
    element.style.top = `${position.top}px`;
    element.style.left = `${position.left}px`;
    element.style.maxHeight = `${Math.min(position.maxHeight, window.innerHeight * 0.7)}px`;
  }, []);
  const panelRef = useCallback((element: HTMLElement | null) => {
    panel.current = element;
    if (!element || typeof element.showPopover !== "function" || element.matches(":popover-open")) return;
    element.showPopover();
    placePanel();
  }, [placePanel]);
  useEffect(() => {
    if (!open || !menu) return;
    window.addEventListener("resize", placePanel);
    window.addEventListener("scroll", placePanel, true);
    return () => {
      window.removeEventListener("resize", placePanel);
      window.removeEventListener("scroll", placePanel, true);
    };
  }, [open, menu, placePanel]);
  return (
    <div ref={root} className="relative" onKeyDown={(event) => {
      if (event.key === "Escape" && open) { event.stopPropagation(); setOpen(false); toggle.current?.focus(); }
    }}>
      <button ref={toggle} type="button" aria-expanded={open} aria-controls={id}
        aria-label={count && count !== "0" ? `Уведомления: ${count} непрочитанных` : "Уведомления"}
        className={menu ? MENU_TRIGGER : `${CONTROL} flex items-center gap-2`} onClick={() => { if (!open) { setBusy(true); setMenuOpen(false); void load(); } setOpen((value) => !value); }}
        {...(menu ? triggerProps : undefined)}>
        {menu ? <>
          <Icon name="bell" size={20} />
          {count && count !== "0" ? <span className="t-caption absolute -end-2 -top-2 min-w-5 rounded-full bg-fg px-1 text-center tabular-nums text-surface">{BigInt(count) > BigInt(99) ? "99+" : count}</span> : null}
        </> : <>
          <Icon name="bell" size={18} /><span className="hidden sm:inline">Уведомления</span>
          {count && count !== "0" ? <span className="rounded-full bg-fg px-2 text-xs font-semibold text-surface">{BigInt(count) > BigInt(99) ? "99+" : count}</span> : null}
        </>}
      </button>
      {open ? <section id={id} aria-label="Уведомления сотрудников" aria-busy={busy}
        ref={menu ? panelRef : undefined} popover={menu ? "manual" : undefined}
        className={menu
          ? "inset-auto m-0 w-[min(24rem,calc(100vw-2rem))] overflow-y-auto rounded-card border border-border bg-surface p-4 text-fg shadow-evo-lg"
          : "absolute end-0 top-full z-40 mt-2 max-h-[70dvh] w-[min(24rem,calc(100vw-2rem))] overflow-y-auto rounded-card border border-border bg-surface p-4 shadow-evo-lg"}>
        <div className="flex items-center justify-between gap-3">
          <h2 className="t-section text-fg">Уведомления</h2>
          <div className="relative">
            <button type="button" aria-haspopup="menu" aria-expanded={menuOpen} className={CONTROL}
              onClick={() => setMenuOpen((value) => !value)}>⋯</button>
            {menuOpen ? <div role="menu" className="absolute end-0 top-full z-50 mt-1 w-52 rounded-card border border-border bg-surface p-1 shadow-evo-lg">
              <button type="button" role="menuitem" disabled={busy} onClick={() => void markAll()}
                className="min-h-11 w-full rounded-nav px-3 py-2 text-start text-sm hover:bg-surface-2">Прочитать всё</button>
            </div> : null}
          </div>
        </div>
        {failed ? <div role="alert" className="my-3 flex flex-wrap items-center justify-between gap-2 rounded-ctl border border-danger/30 bg-danger-weak px-3 py-2 text-sm text-danger">
          <span>{error}</span>
          <button type="button" disabled={busy} onClick={() => { setBusy(true); void load(); }} className="min-h-11 shrink-0 font-semibold underline">Повторить</button>
        </div> : null}
        {busy && !page ? <p role="status" className="py-6 text-sm text-fg-2">Загружаем…</p> : null}
        {page?.items.length === 0 ? <p className="py-6 text-sm text-fg-2">Новых событий пока нет.</p> : null}
        <ul className="mt-3 divide-y divide-border">{page?.items.map((item) => <li key={item.id}>
          <button type="button" disabled={busy} onClick={() => void openItem(item)}
            className="min-h-11 w-full rounded-nav py-3 text-start focus-visible:outline-2 focus-visible:outline-focus-ring">
            <span className={`block text-sm ${item.readAt ? "text-fg-2" : "font-semibold text-fg"}`}>{rowCopy(item)}</span>
            <span className="mt-1 block text-xs text-fg-3">{TIME.format(new Date(item.createdAt))}{item.readAt ? " · Прочитано" : " · Не прочитано"}</span>
          </button>
        </li>)}</ul>
        {page?.nextCursor ? <button type="button" disabled={busy} className={`${CONTROL} mt-3 w-full`} onClick={() => { setBusy(true); void load(page.nextCursor); }}>Раньше</button> : null}
      </section> : null}
    </div>
  );
}
