"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useId, useRef, useState } from "react";

import {
  fixedRoleHomeRoute,
  type FixedRole,
} from "@/lib/fixed-role-policy";
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

const FIXED_ROLES = ["admin", "sales", "admissions"] as const satisfies readonly FixedRole[];
const LINK_ICONS = {
  home: "grid",
  pipeline: "funnel",
  "sales-report": "bar-chart",
  "admissions-worklist": "users",
  "admissions-summary": "plane",
  universities: "folder",
  inbox: "message-square",
  calendar: "calendar",
  tasks: "check-square",
  "team-chat": "message-circle",
  knowledge: "folder",
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
  displayName,
  authorityRole,
  presentationRole,
  navigation,
}: {
  displayName: string;
  authorityRole: FixedRole;
  presentationRole: FixedRole;
  navigation: V3Navigation;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const navigationId = useId();
  const previewing = authorityRole === "admin" && presentationRole !== "admin";
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
          href={fixedRoleHomeRoute(presentationRole)}
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
          {authorityRole === "admin" ? (
            <section
              className="border-t border-border px-3 py-2"
              data-testid="staff-role-preview"
            >
              <details open={previewing}>
                <summary className="min-h-11 cursor-pointer content-center rounded-nav px-2 py-2 text-sm font-medium text-fg-2 transition-colors hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring">
                  Предпросмотр роли
                </summary>
                <form
                  action={selectStaffRolePreviewAction}
                  className="mt-2 grid grid-cols-1 gap-2 pb-2 sm:grid-cols-3 md:grid-cols-1"
                  data-testid="admin-role-preview"
                >
                  {FIXED_ROLES.map((role) => (
                    <button
                      key={role}
                      type="submit"
                      name="role"
                      value={role}
                      data-testid={`preview-role-${role}`}
                      aria-pressed={presentationRole === role}
                      className="min-h-11 rounded-nav border border-control-edge px-3 text-sm text-fg-2 transition-colors hover:bg-surface-2 aria-pressed:border-accent aria-pressed:bg-accent-weak aria-pressed:font-medium aria-pressed:text-accent-text"
                    >
                      {roleTitle(role)}
                    </button>
                  ))}
                </form>
              </details>
              {previewing ? (
                <p
                  className="mt-2 px-2 pb-2 text-sm leading-5 text-accent"
                  data-testid="preview-active"
                >
                  Администратор видит интерфейс роли «{roleTitle(presentationRole)}».
                </p>
              ) : null}
            </section>
          ) : null}

          <div className="flex items-center gap-3 border-t border-border p-3 md:flex-col md:items-stretch md:gap-3 md:p-4">
            <p className="min-w-0 flex-1 text-sm text-fg-3">
              <span className="block truncate font-medium text-fg">{displayName}</span>
              <span
                className="mt-0.5 block text-xs"
                data-testid="active-role"
                data-role={presentationRole}
                data-authority-role={authorityRole}
              >
                {roleTitle(presentationRole)}
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
  displayName,
  authorityRole,
  presentationRole,
  initialNotifications,
}: {
  children: React.ReactNode;
  displayName: string;
  authorityRole: FixedRole;
  presentationRole: FixedRole;
  initialNotifications: StaffNotificationPage | null;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const query = useSearchParams();
  const navigation = buildV3Navigation(presentationRole, pathname, query);

  return (
    <div
      className="flex min-h-dvh flex-col md:flex-row"
      data-testid="v3-shell"
      data-authority-role={authorityRole}
      data-presentation-role={presentationRole}
    >
      <Sidebar
        key={navigation.destinationKey}
        displayName={displayName}
        authorityRole={authorityRole}
        presentationRole={presentationRole}
        navigation={navigation}
      />
      {/* Container queries use the width remaining after the 260px sidebar. */}
      <div className="@container min-w-0 flex-1">
        <div className="flex min-h-16 flex-wrap items-center justify-end gap-3 border-b border-border bg-surface px-4 py-2 md:px-6">
          <Link href="/v3/tasks?create=staff" onClick={(event) => {
            if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            event.preventDefault();
            router.push(`/v3/tasks?create=staff&open=${crypto.randomUUID()}`);
          }} className="inline-flex min-h-11 items-center gap-2 rounded-ctl bg-accent px-3 text-sm font-medium text-on-accent hover:bg-accent-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring">
            <Icon name="plus" size={18} />Создать задачу
          </Link>
          {authorityRole === presentationRole ? <StaffNotifications key={presentationRole} initialPage={initialNotifications} /> : <span className="text-sm text-fg-3">Уведомления скрыты в предпросмотре роли</span>}
        </div>
        {children}
      </div>
    </div>
  );
}
