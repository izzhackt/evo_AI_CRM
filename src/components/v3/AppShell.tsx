"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import {
  fixedRoleCanAccessRoute,
  fixedRoleHomeRoute,
  type FixedRole,
  type FixedRoleRoute,
} from "@/lib/fixed-role-policy";
import {
  logoutStaffAction,
  selectStaffRolePreviewAction,
} from "@/lib/staff-auth-actions";
import { EvoLogo } from "@/components/platform/brand/EvoLogo";
import { roleTitle } from "@/lib/v3/wording";

/**
 * Оболочка продукта.
 *
 * До этого части V3 лежали каталогом и открывались по одной — так они и
 * собирались. Теперь это один интерфейс, поэтому вместо ссылки «назад к
 * каталогу» у каждой страницы одна и та же навигация.
 *
 * «Студенты» доступны и из рабочих карточек, и из меню: их собственный
 * каталог нужен, чтобы найти любое разрешённое дело, включая закрытое.
 */
const SECTIONS = [
  { href: "/v3/main", label: "Главная" },
  { href: "/v3/pipeline", label: "Воронка" },
  { href: "/v3/inbox", label: "Входящие" },
  { href: "/v3/profile", label: "Студенты" },
  { href: "/v3/calendar", label: "Календарь" },
  { href: "/v3/knowledge", label: "База знаний" },
  { href: "/v3/settings", label: "Настройки" },
] as const satisfies readonly Readonly<{
  href: FixedRoleRoute;
  label: string;
}>[];

const FIXED_ROLES = ["admin", "sales", "admissions"] as const satisfies readonly FixedRole[];

export function AppShell({
  children,
  displayName,
  authorityRole,
  presentationRole,
}: {
  children: React.ReactNode;
  displayName: string;
  authorityRole: FixedRole;
  presentationRole: FixedRole;
}) {
  const pathname = usePathname();
  const sections = SECTIONS.filter((section) =>
    fixedRoleCanAccessRoute(presentationRole, section.href));
  const previewing = authorityRole === "admin" && presentationRole !== "admin";

  return (
    <div
      className="flex min-h-dvh flex-col md:flex-row"
      data-testid="v3-shell"
      data-authority-role={authorityRole}
      data-presentation-role={presentationRole}
    >
      <nav
        aria-label="Разделы"
        tabIndex={0}
        className="flex flex-col border-b border-border bg-surface md:sticky md:top-0 md:h-dvh md:w-[224px] md:shrink-0 md:overflow-y-auto md:border-b-0 md:border-e"
      >
        <div className="px-5 py-3 md:px-6 md:py-5">
          <Link
            href={fixedRoleHomeRoute(presentationRole)}
            aria-label="EVO Admissions — начало работы"
            className="inline-flex rounded-nav focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-focus-ring"
          >
            <EvoLogo width={132} />
          </Link>
        </div>

        <ul
          aria-label="Навигация по разделам"
          tabIndex={0}
          className="flex min-w-0 gap-1 overflow-x-auto px-3 pb-3 md:flex-col md:overflow-x-visible"
        >
          {sections.map((section) => {
            const active = pathname === section.href;
            return (
              <li key={section.href} className="shrink-0">
                <Link
                  href={section.href}
                  aria-current={active ? "page" : undefined}
                  onFocus={(event) =>
                    event.currentTarget.scrollIntoView({
                      block: "nearest",
                      inline: "nearest",
                    })
                  }
                  className={`flex min-h-11 items-center whitespace-nowrap rounded-nav px-3 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring ${
                    active
                      ? "bg-accent-weak font-semibold text-accent"
                      : "text-fg-2 hover:bg-surface-2 hover:text-fg"
                  }`}
                >
                  {section.label}
                </Link>
              </li>
            );
          })}
        </ul>

        <div className="md:mt-auto">
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
      </nav>

      {/* Контейнер, а не окно: рельс забирает 224px, и раскладки внутри должны
          считать доступную им ширину, иначе двухколоночный экран включается
          раньше, чем в него что-то помещается. */}
      <div className="@container min-w-0 flex-1">{children}</div>
    </div>
  );
}
