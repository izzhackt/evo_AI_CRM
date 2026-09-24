"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useId, useRef, useState, type FocusEvent, type PointerEvent } from "react";

import type { ActivePlatformActor } from "@/lib/platform-auth";
import { isStaffPreview, staffHasPermission, staffHomeRoute } from "@/lib/platform-access";
import {
  logoutStaffAction,
  selectStaffRolePreviewAction,
} from "@/lib/staff-auth-actions";
import { EvoLogo } from "@/components/platform/brand/EvoLogo";
import { Icon, type IconName } from "@/components/icons";
import { cn } from "@/components/ui";
import { TopLayerMenu } from "@/components/v3/board/TopLayerMenu";
import { isBoardRoute } from "@/lib/v3/board-layout";
import {
  buildV3Navigation,
  type V3Navigation,
  type V3NavigationGroup,
  type V3NavigationLink,
  type V3NavigationLinkId,
} from "@/lib/v3/navigation";
import { roleTitle } from "@/lib/v3/wording";
import { StaffNotifications } from "@/components/v3/StaffNotifications";
import type { StaffNotificationPage } from "@/lib/platform-staff-notifications-contract";

const LINK_ICONS = {
  home: "grid",
  requests: "file-check",
  pipeline: "funnel",
  "sales-report": "bar-chart",
  "admissions-pipeline": "funnel",
  messages: "message-square",
  "admissions-worklist": "users",
  "evo-docs": "folder",
  universities: "building",
  inbox: "message-square",
  calendar: "calendar",
  tasks: "check-square",
  "team-chat": "message-circle",
  knowledge: "book-open",
  documents: "book-open",
  "reply-snippets": "book-open",
  settings: "settings",
} as const satisfies Record<V3NavigationLinkId, IconName>;

/**
 * Рейка: на маршрутах досок при ширине окна 768–1535 px боковое меню
 * сворачивается до 64 px из иконок (решение владельца 25.09.2026). Классы
 * `md:max-2xl:*` включают рейку медиазапросом, а маршрут известен уже на
 * сервере, поэтому при загрузке нет мигания полного меню.
 */
const RAIL_MEDIA = "(width >= 48rem) and (width < 96rem)";

type RailHint = Readonly<{ label: string; top: number }>;
type HintHandlers = Readonly<{
  onPointerEnter?: (event: PointerEvent<HTMLElement>) => void;
  onPointerLeave?: () => void;
  onFocus?: (event: FocusEvent<HTMLElement>) => void;
  onBlur?: () => void;
}>;

function NavigationLink({
  link,
  activeId,
  nested = false,
  rail = false,
  hint = {},
  onNavigate,
}: {
  link: V3NavigationLink;
  activeId: V3NavigationLinkId | null;
  nested?: boolean;
  rail?: boolean;
  hint?: HintHandlers;
  onNavigate: () => void;
}) {
  return (
    <Link
      href={link.href}
      aria-current={activeId === link.id ? "page" : undefined}
      onNavigate={onNavigate}
      className={cn(
        "v3-choice flex min-h-11 min-w-0 items-center gap-3 rounded-nav px-3 py-2 text-sm leading-5 text-fg-2 transition-colors hover:bg-surface-2 hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring",
        rail && "md:max-2xl:justify-center md:max-2xl:px-0",
      )}
      {...hint}
    >
      {nested ? null : <Icon name={LINK_ICONS[link.id]} size={20} className="shrink-0" />}
      <span className={cn("min-w-0", rail && "md:max-2xl:sr-only")}>{link.label}</span>
    </Link>
  );
}

function NavigationGroup({
  group,
  activeId,
  rail,
  hint,
  onNavigate,
}: {
  group: V3NavigationGroup;
  activeId: V3NavigationLinkId | null;
  rail: boolean;
  hint: (label: string) => HintHandlers;
  onNavigate: () => void;
}) {
  const [open, setOpen] = useState(group.active);
  const contentId = useId();
  const groupIcon: IconName = group.id === "sales" ? "bar-chart" : "users";

  return (
    <li>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={contentId}
        onClick={() => setOpen((previous) => !previous)}
        className={cn(
          "flex min-h-11 w-full items-center gap-3 rounded-nav px-3 py-2 text-start text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring",
          group.active ? "bg-accent-weak text-accent-text" : "text-fg-2 hover:bg-surface-2 hover:text-fg",
          rail && "md:max-2xl:hidden",
        )}
      >
        <Icon name={groupIcon} size={20} className="shrink-0" />
        <span className="min-w-0 flex-1">{group.label}</span>
        <Icon name="chevron-right" size={16} className={`shrink-0 ${open ? "rotate-90" : ""}`} />
      </button>
      {/* В рейке пункты группы открываются списком в top layer справа от
          иконки: структура «Продажи» / «Поступление» остаётся доступной. */}
      {rail ? (
        <TopLayerMenu
          label={group.label}
          placement="right-start"
          trigger={<Icon name={groupIcon} size={20} className="shrink-0" />}
          triggerClassName={cn(
            "hidden min-h-11 w-full items-center justify-center rounded-nav transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring md:max-2xl:flex",
            group.active ? "bg-accent-weak text-accent-text" : "text-fg-2 hover:bg-surface-2 hover:text-fg",
          )}
          triggerProps={hint(group.label)}
          menuClassName="w-60 rounded-ctl border border-border bg-surface p-1 shadow-evo-lg"
        >
          {(close) => (
            <>
              <p className="t-caption px-3 pb-1 pt-2 text-fg-3">{group.label}</p>
              <ul className="space-y-0.5">
                {group.links.map((link) => (
                  <li key={link.id}>
                    <NavigationLink
                      link={link}
                      activeId={activeId}
                      nested
                      onNavigate={() => {
                        close();
                        onNavigate();
                      }}
                    />
                  </li>
                ))}
              </ul>
            </>
          )}
        </TopLayerMenu>
      ) : null}
      <ul id={contentId} hidden={!open} className={cn("ms-8 mt-1 space-y-1", rail && "md:max-2xl:hidden")}>
        {group.links.map((link) => (
          <li key={link.id}>
            <NavigationLink link={link} activeId={activeId} nested onNavigate={onNavigate} />
          </li>
        ))}
      </ul>
    </li>
  );
}

function Sidebar({
  actor,
  navigation,
  rail,
}: {
  actor: ActivePlatformActor;
  navigation: V3Navigation;
  rail: boolean;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [railHint, setRailHint] = useState<RailHint | null>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const navigationId = useId();
  const { displayName, systemRole, presentationRole } = actor;
  const accessLabel = presentationRole !== null ? roleTitle(presentationRole)
    : systemRole === "admin" ? "Администратор"
    : [...new Set(actor.assignments.map((assignment) => assignment.label))].join(", ") || "Права ещё не назначены";
  const closeMobileNavigation = () => setMobileOpen(false);
  // Подпись иконки рейки при наведении и при фокусе клавиатуры. Она стоит
  // `position: fixed`, поэтому прокручиваемый список рейки её не обрезает;
  // доступное имя у пункта своё, подпись — только видимая копия.
  const showRailHint = (element: HTMLElement, label: string) => {
    if (!window.matchMedia(RAIL_MEDIA).matches) return;
    const rect = element.getBoundingClientRect();
    setRailHint({ label, top: rect.top + rect.height / 2 });
  };
  const hint = (label: string): HintHandlers => rail ? {
    onPointerEnter: (event) => showRailHint(event.currentTarget, label),
    onPointerLeave: () => setRailHint(null),
    onFocus: (event) => showRailHint(event.currentTarget, label),
    onBlur: () => setRailHint(null),
  } : {};

  return (
    <nav
      aria-label="Разделы"
      className={cn(
        "relative z-30 flex flex-col border-b border-border bg-surface md:sticky md:top-0 md:h-dvh md:shrink-0 md:border-b-0 md:border-e",
        rail ? "md:w-16 2xl:w-[260px]" : "md:w-[260px]",
      )}
      onKeyDown={(event) => {
        if (event.key === "Escape" && mobileOpen) {
          event.preventDefault();
          closeMobileNavigation();
          toggleRef.current?.focus();
        }
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) closeMobileNavigation();
      }}
    >
      <div className={cn("flex items-center justify-between gap-3 px-5 py-2 md:px-6 md:py-5", rail && "md:max-2xl:hidden")}>
        <Link
          href={staffHomeRoute(actor)}
          aria-label="EVO Admissions — начало работы"
          onNavigate={closeMobileNavigation}
          className="inline-flex rounded-nav focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-focus-ring"
        >
          <EvoLogo width={132} />
        </Link>
        <button
          ref={toggleRef}
          type="button"
          aria-label={mobileOpen ? "Закрыть навигацию" : "Открыть навигацию"}
          aria-expanded={mobileOpen}
          aria-controls={navigationId}
          onClick={() => setMobileOpen((previous) => !previous)}
          className="flex size-11 shrink-0 items-center justify-center rounded-nav border border-control-edge text-fg-2 hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring md:hidden"
        >
          <Icon name={mobileOpen ? "x" : "menu"} size={22} />
        </button>
      </div>

      <div
        id={navigationId}
        className={cn(
          `${mobileOpen ? "flex" : "hidden"} absolute inset-x-0 top-full max-h-[calc(100dvh-6rem)] min-w-0 flex-col overflow-y-auto border-b border-border bg-surface shadow-lg md:static md:flex md:max-h-none md:min-h-0 md:flex-1 md:border-b-0 md:shadow-none`,
          rail && "md:max-2xl:pt-3",
        )}
      >
        <ul aria-label="Навигация по разделам" className={cn("space-y-1 px-3 pb-4", rail && "md:max-2xl:px-2")}>
          {navigation.home ? (
            <li>
              <NavigationLink link={navigation.home} activeId={navigation.activeId} rail={rail} hint={hint(navigation.home.label)} onNavigate={closeMobileNavigation} />
            </li>
          ) : null}
          {navigation.groups.map((group) => (
            <NavigationGroup key={group.id} group={group} activeId={navigation.activeId} rail={rail} hint={hint} onNavigate={closeMobileNavigation} />
          ))}
        </ul>

        <section aria-label="Общее" className={cn("mx-3 border-t border-border pb-4 pt-4", rail && "md:max-2xl:mx-2 md:max-2xl:pb-2 md:max-2xl:pt-2")}>
          <h2 className={cn("t-caption mb-2 px-3 text-fg-3", rail && "md:max-2xl:sr-only")}>Общее</h2>
          <ul className="space-y-1">
            {navigation.common.map((link) => (
              <li key={link.id}>
                <NavigationLink link={link} activeId={navigation.activeId} rail={rail} hint={hint(link.label)} onNavigate={closeMobileNavigation} />
              </li>
            ))}
          </ul>
        </section>

        <div className="mt-auto">
          {navigation.settings ? (
            <div className={cn("border-t border-border p-3", rail && "md:max-2xl:p-2")}>
              <NavigationLink link={navigation.settings} activeId={navigation.activeId} rail={rail} hint={hint(navigation.settings.label)} onNavigate={closeMobileNavigation} />
            </div>
          ) : null}
          <div className={cn("flex items-center gap-3 border-t border-border p-3 md:flex-col md:items-stretch md:gap-3 md:p-4", rail && "md:max-2xl:p-2")}>
            <p className={cn("min-w-0 flex-1 text-sm text-fg-3", rail && "md:max-2xl:sr-only")}>
              <span className="block truncate font-medium text-fg">{displayName}</span>
              <span
                className="mt-0.5 block text-xs"
                data-testid="active-role"
                data-role={presentationRole ?? systemRole}
                data-system-role={systemRole}
              >
                {accessLabel}
              </span>
            </p>
            <form action={logoutStaffAction} className="shrink-0">
              <button
                type="submit"
                data-testid="staff-logout"
                className={cn(
                  "min-h-11 w-full rounded-nav border border-control-edge px-3 text-sm font-medium text-fg-2 transition-colors hover:bg-surface-2 hover:text-fg",
                  rail && "md:max-2xl:flex md:max-2xl:items-center md:max-2xl:justify-center md:max-2xl:px-0",
                )}
                {...hint("Выйти")}
              >
                {rail ? <Icon name="log-out" size={20} className="hidden md:max-2xl:block" /> : null}
                <span className={rail ? "md:max-2xl:sr-only" : undefined}>Выйти</span>
              </button>
            </form>
          </div>
        </div>
      </div>
      {rail && railHint ? (
        <span
          aria-hidden="true"
          className="t-caption pointer-events-none fixed start-[4.5rem] z-50 hidden -translate-y-1/2 whitespace-nowrap rounded-nav bg-fg px-2 py-1 text-surface shadow-evo-lg md:max-2xl:block"
          style={{ top: railHint.top }}
        >
          {railHint.label}
        </span>
      ) : null}
    </nav>
  );
}

export function AppShell({
  children,
  actor,
  initialNotifications,
}: {
  children: React.ReactNode;
  actor: ActivePlatformActor;
  initialNotifications: StaffNotificationPage | null;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const query = useSearchParams();
  const navigation = buildV3Navigation(actor, pathname, query);
  const previewing = isStaffPreview(actor);
  const contentId = useId();
  const contentRef = useRef<HTMLDivElement>(null);
  // Доска занимает высоту окна: от 768 px страница не прокручивается,
  // прокручиваются колонки доски (PartShell width="board").
  const board = isBoardRoute(pathname);

  return (
    <div
      className="flex min-h-dvh flex-col md:flex-row"
      data-testid="v3-shell"
      data-shell-layout={board ? "board" : "page"}
      data-system-role={actor.systemRole}
      data-presentation-role={actor.presentationRole ?? "actual"}
    >
      <a
        href={`#${contentId}`}
        onClick={(event) => {
          event.preventDefault();
          contentRef.current?.focus();
        }}
        className="sr-only focus-visible:not-sr-only focus-visible:fixed focus-visible:left-2 focus-visible:top-2 focus-visible:z-50 focus-visible:inline-flex focus-visible:min-h-11 focus-visible:items-center focus-visible:rounded-ctl focus-visible:bg-accent focus-visible:px-4 focus-visible:py-2 focus-visible:text-sm focus-visible:font-medium focus-visible:text-on-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
      >
        К содержимому
      </a>
      <Sidebar
        key={navigation.destinationKey}
        actor={actor}
        navigation={navigation}
        rail={board}
      />
      {/* Container queries use the width remaining after the sidebar (260px, or the 64px rail on boards). */}
      <div className={cn("@container min-w-0 flex-1", board && "md:flex md:h-dvh md:flex-col")}>
        <div className="flex min-h-14 shrink-0 flex-wrap items-center justify-end gap-3 border-b border-border bg-surface px-4 py-1 md:min-h-16 md:px-6 md:py-2">
          {/* В рейке нет места полному логотипу — он стоит в верхней панели. */}
          {board ? (
            <Link
              href={staffHomeRoute(actor)}
              aria-label="EVO Admissions — начало работы"
              className="me-auto hidden rounded-nav focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-focus-ring md:max-2xl:inline-flex"
            >
              <EvoLogo width={116} />
            </Link>
          ) : null}
          {/* Общее действие оболочки — нейтральное: красным остаётся главное
              действие самой страницы (решение владельца 25.09.2026). */}
          {!previewing && staffHasPermission(actor, "staff.task.create") ? <Link href="/v3/tasks?create=staff" onClick={(event) => {
            if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            event.preventDefault();
            router.push(`/v3/tasks?create=staff&open=${crypto.randomUUID()}`);
          }} className="inline-flex min-h-11 items-center gap-2 rounded-ctl border border-control-edge bg-surface px-3 text-sm font-medium text-fg-2 hover:bg-surface-2 hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring">
            <Icon name="plus" size={18} />Создать задачу
          </Link> : null}
          {!previewing ? <StaffNotifications initialPage={initialNotifications} /> : (
            <div className="flex w-full flex-wrap items-center justify-between gap-2" data-testid="preview-active">
              <span className="text-sm text-fg-2">Интерфейс: {roleTitle(actor.presentationRole!)}</span>
              <form action={selectStaffRolePreviewAction}>
                <button type="submit" name="role" value="admin" data-testid="preview-role-admin"
                  className="min-h-11 rounded-ctl border border-control-edge px-3 text-sm font-medium text-fg-2 hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring">
                  Вернуться к Администратору
                </button>
              </form>
            </div>
          )}
        </div>
        <div
          id={contentId}
          ref={contentRef}
          tabIndex={-1}
          className={cn("min-w-0 outline-none", board && "md:flex md:min-h-0 md:flex-1 md:flex-col md:overflow-y-auto")}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
