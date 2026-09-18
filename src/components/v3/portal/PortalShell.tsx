"use client";

import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { useRef, useState } from "react";

import { EvoLogo } from "@/components/platform/brand/EvoLogo";
import { logoutStudentPortalAction } from "@/lib/student-portal-auth-actions";

const SECTIONS = [
  { href: "/portal", label: "Поступление" },
  { href: "/portal/documents", label: "Документы" },
  { href: "/portal/universities", label: "Университеты" },
  { href: "/portal/payments", label: "Оплата" },
  { href: "/portal/notifications", label: "Уведомления" },
  { href: "/portal/tests", label: "Тесты" },
] as const;

function NavigationLabel({ label }: { label: string }) {
  const { pending } = useLinkStatus();
  return <>
    <span className="min-w-0">{label}</span>
    <span aria-hidden="true" className="ms-auto shrink-0 text-xs text-accent-text">{pending ? "…" : ""}</span>
    <span className="sr-only" role="status">{pending ? `Открываем раздел «${label}»` : ""}</span>
  </>;
}

export function PortalShell({
  children,
  displayName,
}: {
  children: React.ReactNode;
  displayName: string;
}) {
  const pathname = usePathname();
  const [expandedForPath, setExpandedForPath] = useState<string | null>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const sidebar = useRef<HTMLElement>(null);
  const navigationOpen = expandedForPath === pathname;
  const currentSection = SECTIONS.find((section) => pathname === section.href
    || (section.href !== "/portal" && pathname.startsWith(`${section.href}/`)));
  const closeMenu = () => setExpandedForPath(null);

  // Derived from the route, not an effect: a navigation to a new path always
  // starts with the mobile panel closed again.
  if (expandedForPath !== null && expandedForPath !== pathname) {
    closeMenu();
  }

  return (
    <div
      className="v3-world flex min-h-dvh min-w-0 flex-col bg-bg text-fg md:flex-row"
      data-testid="student-portal-shell"
      onPointerDown={(event) => {
        if (navigationOpen && !sidebar.current?.contains(event.target as Node)) {
          closeMenu();
        }
      }}
    >
      <a
        href="#portal-content"
        onClick={closeMenu}
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:start-3 focus:z-[100] focus:max-w-[calc(100vw-24px)] focus:rounded-nav focus:bg-accent focus:px-4 focus:py-3 focus:text-sm focus:font-semibold focus:text-on-accent"
      >
        Перейти к содержимому
      </a>

      <aside
        ref={sidebar}
        aria-label="Кабинет студента"
        className="sticky top-0 z-30 flex flex-col border-b border-border bg-surface md:h-dvh md:w-[216px] md:shrink-0 md:overflow-y-auto md:border-b-0 md:border-e"
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) closeMenu();
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape" && navigationOpen) {
            closeMenu();
            menuButton.current?.focus();
          }
        }}
      >
        <div className="flex items-center justify-between gap-3 px-4 py-3 md:px-5 md:py-5">
          <Link
            href="/portal"
            aria-label="EVO Admissions — кабинет студента"
            onClick={closeMenu}
            className="inline-flex shrink-0 rounded-nav focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-focus-ring"
          >
            <EvoLogo width={116} />
          </Link>
          <button
            ref={menuButton}
            type="button"
            aria-expanded={navigationOpen}
            aria-controls="portal-navigation-panel"
            onClick={() => setExpandedForPath(navigationOpen ? null : pathname)}
            className="flex min-h-11 shrink-0 items-center gap-2 rounded-nav border border-control-edge px-3 text-sm font-semibold text-accent-text transition-colors hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring md:hidden"
          >
            <svg width="16" height="16" viewBox="0 0 18 18" fill="none" aria-hidden="true">
              <path
                d={navigationOpen ? "m5 5 8 8M13 5l-8 8" : "M3 5h12M3 9h12M3 13h12"}
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
            {navigationOpen ? "Закрыть" : "Меню"}
          </button>
        </div>

        <p className="px-4 pb-2 text-xs text-fg-3 md:hidden">{currentSection?.label ?? "Кабинет студента"}</p>

        <div
          id="portal-navigation-panel"
          className={`${navigationOpen ? "flex" : "hidden"} absolute inset-x-0 top-full min-w-0 max-h-[calc(100dvh-4.5rem)] flex-col overflow-y-auto border-b border-border bg-surface shadow-evo-lg md:static md:flex md:max-h-none md:min-h-0 md:flex-1 md:border-b-0 md:shadow-none`}
          data-open={navigationOpen}
        >
          <nav aria-label="Разделы кабинета" className="px-3 pb-4 md:flex-1 md:pb-8">
            <ul aria-label="Навигация по разделам кабинета" className="grid gap-1">
              {SECTIONS.map((section) => {
                const href = section.href;
                const active = pathname === href || (section.href !== "/portal" && pathname.startsWith(`${href}/`));
                return (
                  <li key={section.href} className="min-w-0">
                    <Link
                      href={href}
                      aria-current={active ? "page" : undefined}
                      onClick={() => { if (active) closeMenu(); }}
                      className={`flex min-h-11 min-w-0 items-center gap-2 rounded-nav px-3 py-2 text-sm font-medium leading-5 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring ${
                        active ? "bg-accent-weak font-semibold text-accent-text" : "text-fg-2 hover:bg-surface-2 hover:text-fg"
                      }`}
                    >
                      <NavigationLabel label={section.label} />
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>

          <div className="mt-auto border-t border-border p-3 md:p-4">
            <p className="text-xs text-fg-3">Ваш аккаунт</p>
            <p className="mt-1 break-words text-sm font-semibold text-fg">{displayName}</p>
            <form action={logoutStudentPortalAction} className="mt-2">
              <button
                type="submit"
                className="min-h-11 w-full rounded-nav border border-control-edge px-3 text-start text-sm font-medium text-fg-2 transition-colors hover:bg-surface-2 hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
              >
                Выйти
              </button>
            </form>
          </div>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <div id="portal-content" tabIndex={-1} className="min-w-0 outline-none">
          {children}
        </div>
      </div>
    </div>
  );
}
