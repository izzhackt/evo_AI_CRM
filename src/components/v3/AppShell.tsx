"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useId, useRef, useState } from "react";

import type { ActivePlatformActor } from "@/lib/platform-auth";
import { isStaffPreview, staffHasPermission, staffHomeRoute } from "@/lib/platform-access";
import {
  logoutStaffAction,
  selectStaffRolePreviewAction,
} from "@/lib/staff-auth-actions";
import { EvoLogo } from "@/components/platform/brand/EvoLogo";
import { Icon, type IconName } from "@/components/icons";
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
  "admissions-worklist": "users",
  "evo-docs": "folder",
  "admissions-summary": "plane",
  universities: "building",
  inbox: "message-square",
  calendar: "calendar",
  tasks: "check-square",
  "team-chat": "message-circle",
  knowledge: "book-open",
  settings: "settings",
} as const satisfies Record<V3NavigationLinkId, IconName>;

function NavigationLink({
  link,
  activeId,
  nested = false,
  onNavigate,
}: {
  link: V3NavigationLink;
  activeId: V3NavigationLinkId | null;
  nested?: boolean;
  onNavigate: () => void;
}) {
  return (
    <Link
      href={link.href}
      aria-current={activeId === link.id ? "page" : undefined}
      onNavigate={onNavigate}
      className={`flex min-h-11 min-w-0 items-center gap-3 rounded-nav px-3 py-2 text-sm leading-5 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring ${
        activeId === link.id
          ? "bg-accent-weak font-semibold text-accent-text"
          : "text-fg-2 hover:bg-surface-2 hover:text-fg"
      }`}
    >
      {nested ? null : <Icon name={LINK_ICONS[link.id]} size={20} className="shrink-0" />}
      <span className="min-w-0">{link.label}</span>
    </Link>
  );
}

function NavigationGroup({
  group,
  activeId,
  onNavigate,
}: {
  group: V3NavigationGroup;
  activeId: V3NavigationLinkId | null;
  onNavigate: () => void;
}) {
  const [open, setOpen] = useState(group.active);
  const contentId = useId();

  return (
    <li>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={contentId}
        onClick={() => setOpen((previous) => !previous)}
        className={`flex min-h-11 w-full items-center gap-3 rounded-nav px-3 py-2 text-start text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring ${
          group.active
            ? "bg-accent-weak text-accent-text"
            : "text-fg-2 hover:bg-surface-2 hover:text-fg"
        }`}
      >
        <Icon name={group.id === "sales" ? "bar-chart" : "users"} size={20} className="shrink-0" />
        <span className="min-w-0 flex-1">{group.label}</span>
        <Icon name="chevron-right" size={16} className={`shrink-0 ${open ? "rotate-90" : ""}`} />
      </button>
      <ul id={contentId} hidden={!open} className="ms-8 mt-1 space-y-1">
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
}: {
  actor: ActivePlatformActor;
  navigation: V3Navigation;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const navigationId = useId();
  const { displayName, systemRole, presentationRole } = actor;
  const accessLabel = presentationRole !== null ? roleTitle(presentationRole)
    : systemRole === "admin" ? "Администратор"
    : [...new Set(actor.assignments.map((assignment) => assignment.label))].join(", ") || "Права ещё не назначены";
  const closeMobileNavigation = () => setMobileOpen(false);

  return (
    <nav
      aria-label="Разделы"
      className="relative z-30 flex flex-col border-b border-border bg-surface md:sticky md:top-0 md:h-dvh md:w-[260px] md:shrink-0 md:border-b-0 md:border-e"
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
      <div className="flex items-center justify-between gap-3 px-5 py-3 md:px-6 md:py-5">
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
        className={`${mobileOpen ? "flex" : "hidden"} absolute inset-x-0 top-full max-h-[calc(100dvh-6rem)] min-w-0 flex-col overflow-y-auto border-b border-border bg-surface shadow-lg md:static md:flex md:max-h-none md:min-h-0 md:flex-1 md:border-b-0 md:shadow-none`}
      >
        <ul aria-label="Навигация по разделам" className="space-y-1 px-3 pb-4">
          {navigation.home ? (
            <li>
              <NavigationLink link={navigation.home} activeId={navigation.activeId} onNavigate={closeMobileNavigation} />
            </li>
          ) : null}
          {navigation.groups.map((group) => (
            <NavigationGroup key={group.id} group={group} activeId={navigation.activeId} onNavigate={closeMobileNavigation} />
          ))}
        </ul>

        <section aria-label="Общее" className="mx-3 border-t border-border pb-4 pt-4">
          <h2 className="mb-2 px-3 text-xs font-medium uppercase tracking-wider text-fg-3">Общее</h2>
          <ul className="space-y-1">
            {navigation.common.map((link) => (
              <li key={link.id}>
                <NavigationLink link={link} activeId={navigation.activeId} onNavigate={closeMobileNavigation} />
              </li>
            ))}
          </ul>
        </section>

        <div className="mt-auto">
          {navigation.settings ? (
            <div className="border-t border-border p-3">
              <NavigationLink link={navigation.settings} activeId={navigation.activeId} onNavigate={closeMobileNavigation} />
            </div>
          ) : null}
          <div className="flex items-center gap-3 border-t border-border p-3 md:flex-col md:items-stretch md:gap-3 md:p-4">
            <p className="min-w-0 flex-1 text-sm text-fg-3">
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
                className="min-h-11 w-full rounded-nav border border-control-edge px-3 text-sm font-medium text-fg-2 transition-colors hover:bg-surface-2 hover:text-fg"
              >
                Выйти
              </button>
            </form>
          </div>
        </div>
      </div>
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

  return (
    <div
      className="flex min-h-dvh flex-col md:flex-row"
      data-testid="v3-shell"
      data-system-role={actor.systemRole}
      data-presentation-role={actor.presentationRole ?? "actual"}
    >
      <Sidebar
        key={navigation.destinationKey}
        actor={actor}
        navigation={navigation}
      />
      {/* Container queries use the width remaining after the 260px sidebar. */}
      <div className="@container min-w-0 flex-1">
        <div className="flex min-h-16 flex-wrap items-center justify-end gap-3 border-b border-border bg-surface px-4 py-2 md:px-6">
          {!previewing && staffHasPermission(actor, "staff.task.create") ? <Link href="/v3/tasks?create=staff" onClick={(event) => {
            if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            event.preventDefault();
            router.push(`/v3/tasks?create=staff&open=${crypto.randomUUID()}`);
          }} className="inline-flex min-h-11 items-center gap-2 rounded-ctl bg-accent px-3 text-sm font-medium text-on-accent hover:bg-accent-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring">
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
        {children}
      </div>
    </div>
  );
}
